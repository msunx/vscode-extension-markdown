const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = [
  '# 2026-10-23', '', '准备好下一步，再专心完成眼前的一件事。', '',
  '- [ ] 准备资料', '  - [ ] 整理提纲', '  - [x] 校对旧稿', '- [/] 撰写说明', '- [x] 发布文档', '- [/]', '',
  '3. [/] 有序任务', '', '> - [/] 引用任务', '', '`[/] 原样代码`', '', '- \\[/] 字面标记', '',
  '- [/] 多段任务', '', '  说明段落', '', '- [ ] 后续任务', ''
].join('\n');
const until = async fn => { const start=Date.now(); while(!fn()) { if(Date.now()-start>240000) throw new Error('任务状态验证超时'); await new Promise(r=>setTimeout(r,60)); } };
exports.run = async () => {
  fs.mkdirSync(runtime,{recursive:true}); fs.mkdirSync(evidence,{recursive:true});
  for(const name of fs.readdirSync(runtime)) if(/^task-state-.*-done$/.test(name)) fs.unlinkSync(path.join(runtime,name));
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  let watched;
  const snapshot=()=>{
    fs.writeFileSync(path.join(runtime,'task-state-source-next.json'),JSON.stringify({source:watched.getText(),version:watched.version}));
    fs.renameSync(path.join(runtime,'task-state-source-next.json'),path.join(runtime,'task-state-source.json'));
  };
  const listener=vscode.workspace.onDidChangeTextDocument(e=>{if(e.document===watched)snapshot();});
  const stage=name=>fs.writeFileSync(path.join(runtime,'task-state-stage.json'),JSON.stringify({stage:name})), result={rounds:[]};
  try {
    for(const round of ['1','2','3']) {
      const uri=vscode.Uri.file(path.join(runtime,`task-state-${round}.md`)); fs.writeFileSync(uri.fsPath,round==='2'?fixture.replace(/\n/g,'\r\n'):fixture);
      watched=await vscode.workspace.openTextDocument(uri); snapshot(); await vscode.window.showTextDocument(watched); stage(round);
      await until(()=>fs.existsSync(path.join(runtime,`task-state-${round}-done`)));
      const content=watched.getText(), normalized=content.replace(/\r\n/g,'\n');
      for(const text of ['- [/] 准备资料','  - [/] 整理提纲','  - [x] 校对旧稿','- [/] 撰写说明更新','- [/] 新建任务','- [x] 发布文档','- [/]','3. [/] 有序任务','> - [/] 引用任务','`[/] 原样代码`']) {
        assert(normalized.includes(text),`状态或内容丢失：${text}`);
      }
      assert(!normalized.includes('进行中')&&!normalized.includes('今天'),'界面文字不能写入原文');
      assert.equal(fs.readFileSync(uri.fsPath,'utf8'),content,'保存读回');
      if(round==='2') assert(!/(?<!\r)\n/.test(content),'CRLF 保留');
      const {updateTask}=require('../src/preview'); const line=normalized.split('\n').findIndex(line=>line==='- [/] 准备资料');
      await assert.rejects(updateTask(watched,{version:watched.version-1,line,character:3,source:'- [/] 准备资料',state:'done'}),'拒绝过期状态');
      await assert.rejects(updateTask(watched,{version:watched.version,line,character:3,source:'- [/] 准备资料',state:'invalid'}),'拒绝非法状态');
      assert.equal(watched.getText(),content); result.rounds.push({round,status:'passed',saved:true,staleRejected:true});
    }
    for(const mode of ['readonly','failure']) {
      const bytes=Buffer.from('# 任务状态\n\n- [/] 保留任务\n'), events=new vscode.EventEmitter();
      const scheme=`folio-task-state-${mode}`, provider=vscode.workspace.registerFileSystemProvider(scheme,{
        onDidChangeFile:events.event,watch:()=>new vscode.Disposable(()=>{}),stat:()=>({type:vscode.FileType.File,ctime:0,mtime:0,size:bytes.length}),
        readFile:()=>bytes,readDirectory:()=>[],writeFile:()=>{throw vscode.FileSystemError.NoPermissions('验证保存失败');},createDirectory(){},delete(){},rename(){}
      },{isReadonly:mode==='readonly'});
      try {
        watched=await vscode.workspace.openTextDocument(vscode.Uri.parse(`${scheme}:/task-state-${mode}.md`)); snapshot();
        await vscode.window.showTextDocument(watched); stage(mode); await until(()=>fs.existsSync(path.join(runtime,`task-state-${mode}-done`)));
        if(mode==='readonly') assert.equal(watched.getText(),bytes.toString());
        else {assert(watched.isDirty && watched.getText().includes('- [/] 保留任务更新')); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');}
        result[mode]='passed';
      } finally {provider.dispose();events.dispose();}
    }
    result.status='passed'; stage('complete');
  } catch(error) {result.status='failed';result.error=error.stack;stage('failed');throw error;}
  finally {listener.dispose();fs.writeFileSync(path.join(evidence,'task-state-host-verification.json'),JSON.stringify(result,null,2));}
};
