const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'.runtime'),project=path.join(runtime,'image-viewer-project'),evidence=path.join(root,'design/image-viewer');
const fixture='# 图片笔记\n\n编辑位置保持不变。\n\n![阅读界面](./assets/wide.png)\n\n[![链接中的图片](./assets/icon.png)](https://example.com)\n\n行内 ![行内图标](./assets/icon.png) 文字。\n\n![长图](./assets/tall.svg)\n\n![暂时不可用](./assets/missing.png)\n\n| 图片 | 说明 |\n| --- | --- |\n| ![单元格图片](./assets/icon.png) | 保留内容 |\n\n最后一段。\n';
const until=async fn=>{const end=Date.now()+900000;while(!fn()){if(Date.now()>end||fs.existsSync(path.join(runtime,'image-viewer-abort')))throw Error('验证中断或超时');await new Promise(r=>setTimeout(r,60));}};
exports.run=async()=>{
 fs.mkdirSync(path.join(project,'assets'),{recursive:true});fs.mkdirSync(evidence,{recursive:true});
 for(const name of fs.readdirSync(runtime))if(/^image-viewer-.*-done$/.test(name)||name==='image-viewer-abort')fs.unlinkSync(path.join(runtime,name));
 fs.copyFileSync(path.join(root,'assets/readme/preview.png'),path.join(project,'assets/wide.png'));fs.copyFileSync(path.join(root,'media/icon.png'),path.join(project,'assets/icon.png'));
 fs.writeFileSync(path.join(project,'assets/tall.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2400"><rect width="800" height="2400" fill="#24273a"/><path d="M0 0L800 2400M800 0L0 2400" stroke="#8aadf4" stroke-width="40"/><circle cx="400" cy="1200" r="240" fill="#a6da95"/><text x="400" y="100" text-anchor="middle" fill="#cad3f5" font-size="60">Image study</text></svg>');
 await vscode.extensions.getExtension('muyang.folio-markdown').activate();await vscode.commands.executeCommand('workbench.action.closeSidebar');await vscode.commands.executeCommand('notifications.clearAll');
 let watched;const snapshot=()=>{fs.writeFileSync(path.join(runtime,'image-viewer-source-next.json'),JSON.stringify({source:watched.getText(),version:watched.version}));fs.renameSync(path.join(runtime,'image-viewer-source-next.json'),path.join(runtime,'image-viewer-source.json'));};
 const listener=vscode.workspace.onDidChangeTextDocument(e=>{if(e.document===watched)snapshot();});const stage=name=>fs.writeFileSync(path.join(runtime,'image-viewer-stage.json'),JSON.stringify({stage:name}));const result={rounds:[]};
 try{
  for(const round of ['1','2','3']){
   const uri=vscode.Uri.file(path.join(project,`image-viewer-${round}.md`));fs.writeFileSync(uri.fsPath,round==='2'?fixture.replace(/\n/g,'\r\n'):fixture);
   watched=await vscode.workspace.openTextDocument(uri);snapshot();await vscode.window.showTextDocument(watched);stage(round);await until(()=>fs.existsSync(path.join(runtime,`image-viewer-${round}-done`)));
   assert.equal(watched.getText(),fs.readFileSync(uri.fsPath,'utf8'));assert(watched.getText().includes('编辑位置保持不变。继续写作'));result.rounds.push({round,saved:true,status:'passed'});
  }
  const bytes=Buffer.from('# 只读图片\n\n![只读图](data:image/png;base64,'+fs.readFileSync(path.join(root,'media/icon.png')).toString('base64')+')\n');
  const events=new vscode.EventEmitter(),provider=vscode.workspace.registerFileSystemProvider('folio-viewer-readonly',{onDidChangeFile:events.event,watch:()=>new vscode.Disposable(()=>{}),stat:()=>({type:vscode.FileType.File,ctime:0,mtime:0,size:bytes.length}),readFile:()=>bytes,readDirectory:()=>[],writeFile(){},createDirectory(){},delete(){},rename(){}},{isReadonly:true});
  try{watched=await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-viewer-readonly:/image-viewer-readonly.md'));snapshot();await vscode.window.showTextDocument(watched);stage('readonly');await until(()=>fs.existsSync(path.join(runtime,'image-viewer-readonly-done')));assert.equal(watched.getText(),bytes.toString());result.readonly='passed';}finally{provider.dispose();events.dispose();}
  watched=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(project,'image-viewer-1.md')));snapshot();await vscode.window.showTextDocument(watched);await vscode.commands.executeCommand('markdown.showPreview');stage('builtin');await until(()=>fs.existsSync(path.join(runtime,'image-viewer-builtin-done')));result.builtin='passed';
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');await vscode.window.showTextDocument(watched);await vscode.commands.executeCommand('folio.preview');result.status='passed';stage('review');fs.writeFileSync(path.join(evidence,'host-verification.json'),JSON.stringify(result,null,2));await until(()=>fs.existsSync(path.join(runtime,'image-viewer-review-done')));
 }catch(error){result.status='failed';result.error=error.stack;stage('failed');throw error;}
 finally{listener.dispose();fs.writeFileSync(path.join(evidence,'host-verification.json'),JSON.stringify(result,null,2));}
};
