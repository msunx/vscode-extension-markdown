const vscode=require('vscode'), fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'.runtime'),project=path.join(runtime,'components-project'),evidence=path.join(root,`design/evidence/extension-${require('../package.json').version}`);
const fixture='# 工作笔记\n\n把代码和图片留在思考发生的地方。\n\n## 代码\n\n```javascript\nconst message = "'+ '自动换行让长代码更容易阅读，'.repeat(22)+'";\nconsole.log(message);\n```\n\n```java\nclass Demo { int count = 42; }\n```\n\n```mystery-lang\n<unknown> & raw text\n```\n\n## 图片\n\n图片入口\n\n## 记录\n\n- [/] 整理思路\n  - [ ] 补充例子\n\n链接入口\n\n最后一段保持不变。\n';
const until=async fn=>{const start=Date.now();while(!fn()){if(fs.existsSync(path.join(runtime,'components-abort'))||Date.now()-start>600000)throw new Error('组件验证中断或超时');await new Promise(r=>setTimeout(r,60));}};
exports.run=async()=>{
 fs.mkdirSync(evidence,{recursive:true});fs.mkdirSync(path.join(project,'assets'),{recursive:true});
 for(const name of fs.readdirSync(runtime))if(/^components-.*-done$/.test(name)||name==='components-abort')fs.unlinkSync(path.join(runtime,name));
 for(const dir of ['assets','.git','node_modules'])fs.mkdirSync(path.join(project,dir),{recursive:true});
 for(const name of ['assets/folio.png','assets/UPPER.PNG','.git/excluded.png','node_modules/excluded.png'])fs.copyFileSync(path.join(root,'media/icon.png'),path.join(project,name));
 fs.copyFileSync(path.join(root,'assets/readme/preview.png'),path.join(project,'assets/阅读预览.png'));fs.writeFileSync(path.join(project,'assets/broken.png'),'not an image');
 fs.copyFileSync(path.join(root,'media/icon.png'),path.join(runtime,'outside-project.png'));const symlink=path.join(project,'assets/outside-link.png');if(!fs.existsSync(symlink))fs.symlinkSync(path.join(runtime,'outside-project.png'),symlink);
 await vscode.extensions.getExtension('muyang.folio-markdown').activate();await vscode.commands.executeCommand('workbench.action.closeSidebar');await vscode.commands.executeCommand('notifications.clearAll');
 let watched;const snapshot=()=>{fs.writeFileSync(path.join(runtime,'components-source-next.json'),JSON.stringify({source:watched.getText(),version:watched.version}));fs.renameSync(path.join(runtime,'components-source-next.json'),path.join(runtime,'components-source.json'));};
 const listener=vscode.workspace.onDidChangeTextDocument(e=>{if(e.document===watched)snapshot();});const stage=name=>fs.writeFileSync(path.join(runtime,'components-stage.json'),JSON.stringify({stage:name})),result={rounds:[]};
 try{
  for(const round of ['1','2','3']){
   const uri=vscode.Uri.file(path.join(project,`components-${round}.md`));fs.writeFileSync(uri.fsPath,round==='2'?fixture.replace(/\n/g,'\r\n'):fixture);
   fs.copyFileSync(path.join(root,'media/icon.png'),path.join(project,'assets/delete-before-insert.png'));
   watched=await vscode.workspace.openTextDocument(uri);snapshot();await vscode.window.showTextDocument(watched);stage(round);await until(()=>fs.existsSync(path.join(runtime,`components-${round}-done`)));
   assert.equal(fs.readFileSync(uri.fsPath,'utf8'),watched.getText());if(round==='2')assert(!/(?<!\r)\n/.test(watched.getText()));
   assert(watched.getText().includes('图片后的记录')&&watched.getText().includes('最后一段保持不变。'));assert(!watched.getText().includes('file:')&&!watched.getText().includes('vscode-resource'));
   result.rounds.push({round,saved:true,status:'passed'});
  }
  for(const mode of ['readonly','failure']){
   const bytes=Buffer.from('# 代码\n\n```python\nprint("keep")\n```\n'),events=new vscode.EventEmitter(),scheme=`folio-components-${mode}`;
   const provider=vscode.workspace.registerFileSystemProvider(scheme,{onDidChangeFile:events.event,watch:()=>new vscode.Disposable(()=>{}),stat:()=>({type:vscode.FileType.File,ctime:0,mtime:0,size:bytes.length}),readFile:()=>bytes,readDirectory:()=>[],writeFile:()=>{throw vscode.FileSystemError.NoPermissions('验证保存失败');},createDirectory(){},delete(){},rename(){}},{isReadonly:mode==='readonly'});
   try{watched=await vscode.workspace.openTextDocument(vscode.Uri.parse(`${scheme}:/components-${mode}.md`));snapshot();await vscode.window.showTextDocument(watched);stage(mode);await until(()=>fs.existsSync(path.join(runtime,`components-${mode}-done`)));
    if(mode==='readonly')assert.equal(watched.getText(),bytes.toString());else{assert(watched.isDirty&&watched.getText().includes('keep update'));await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');}result[mode]='passed';
   }finally{provider.dispose();events.dispose();}
  }
  stage('complete');result.status='passed';
 }catch(error){result.status='failed';result.error=error.stack;stage('failed');throw error;}
 finally{listener.dispose();fs.writeFileSync(path.join(evidence,'components-host-verification.json'),JSON.stringify(result,null,2));}
};
