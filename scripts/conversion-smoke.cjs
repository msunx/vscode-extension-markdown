const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'.runtime'),project=path.join(runtime,'conversion-project'),evidence=path.join(root,`design/evidence/extension-${require('../package.json').version}`);
const fixture='# 格式转换\n\n## 待调整 **重点** [资料](./guide.md)\n\n正文 **加粗** 和 [链接](./guide.md)。\n\n> 引用 **重点**\n> 第二行包含 ``` 符号。\n>\n> 第二段保留。\n\n```javascript\n# literal\n<script>keep & text</script>\n    const value = "**keep**";\n```\n\n- 普通父项 **重点**\n  - [x] 保留子任务\n  - 子普通项\n- 第二项\n\n分开两组列表。\n\n- [/] 父任务\n  - [x] 保留完成状态\n  - [ ] 子任务\n- [x] 同级任务\n\n第一逻辑行\n第二逻辑行\n第三逻辑行\n\n| 项目 | 说明 |\n| --- | --- |\n| 保留 | 表格内容 |\n\n尾部不变。\n';
const until=async fn=>{const deadline=Date.now()+600000;while(!fn()){if(Date.now()>deadline||fs.existsSync(path.join(runtime,'conversion-abort')))throw Error('转换验证超时或中断');await new Promise(r=>setTimeout(r,60));}};
exports.run=async()=>{
 fs.mkdirSync(project,{recursive:true});fs.mkdirSync(evidence,{recursive:true});for(const name of fs.readdirSync(runtime))if(/^conversion-.*-done$/.test(name)||name==='conversion-abort')fs.unlinkSync(path.join(runtime,name));
 await vscode.extensions.getExtension('muyang.folio-markdown').activate();await vscode.commands.executeCommand('workbench.action.closeSidebar');
 let watched;const snapshot=()=>{fs.writeFileSync(path.join(runtime,'conversion-source-next.json'),JSON.stringify({source:watched.getText(),version:watched.version}));fs.renameSync(path.join(runtime,'conversion-source-next.json'),path.join(runtime,'conversion-source.json'));};
 const listener=vscode.workspace.onDidChangeTextDocument(e=>{if(e.document===watched)snapshot();}),stage=name=>fs.writeFileSync(path.join(runtime,'conversion-stage.json'),JSON.stringify({stage:name})),result={rounds:[]};
 try{
  for(const round of ['lf','crlf']){
   const uri=vscode.Uri.file(path.join(project,`conversion-${round}.md`));fs.writeFileSync(uri.fsPath,round==='crlf'?fixture.replace(/\n/g,'\r\n'):fixture);watched=await vscode.workspace.openTextDocument(uri);snapshot();await vscode.window.showTextDocument(watched);stage(round);
   await until(()=>fs.existsSync(path.join(runtime,`conversion-${round}-done`)));assert.equal(fs.readFileSync(uri.fsPath,'utf8'),watched.getText());assert(watched.getText().includes('尾部不变。'));assert(!watched.getText().includes('undefined'));
   if(round==='crlf')assert(!/(?<!\r)\n/.test(watched.getText()));result.rounds.push({round,saved:true,status:'passed'});
  }
  for(const mode of ['readonly','failure']){
   const bytes=Buffer.from(fixture),events=new vscode.EventEmitter(),scheme=`folio-conversion-${mode}`;
   const provider=vscode.workspace.registerFileSystemProvider(scheme,{onDidChangeFile:events.event,watch:()=>new vscode.Disposable(()=>{}),stat:()=>({type:vscode.FileType.File,ctime:0,mtime:0,size:bytes.length}),readFile:()=>bytes,readDirectory:()=>[],writeFile:()=>{throw vscode.FileSystemError.NoPermissions('验证保存失败');},createDirectory(){},delete(){},rename(){}},{isReadonly:mode==='readonly'});
   try{watched=await vscode.workspace.openTextDocument(vscode.Uri.parse(`${scheme}:/conversion-${mode}.md`));snapshot();await vscode.window.showTextDocument(watched);stage(mode);await until(()=>fs.existsSync(path.join(runtime,`conversion-${mode}-done`)));
    if(mode==='readonly')assert.equal(watched.getText(),fixture);else{assert(watched.isDirty&&watched.getText().includes('### 待调整'));await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');}result[mode]='passed';
   }finally{provider.dispose();events.dispose();}
  }
  stage('complete');result.status='passed';
 }catch(error){result.status='failed';result.error=error.stack;stage('failed');throw error;}
 finally{listener.dispose();fs.writeFileSync(path.join(evidence,'conversion-host-verification.json'),JSON.stringify(result,null,2));}
};
