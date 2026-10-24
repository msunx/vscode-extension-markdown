const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), evidence = path.join(root, 'design/evidence/extension-0.11.0');
const until = async fn => { const end = Date.now()+360000; while (!fn()) { if (Date.now()>end) throw new Error('模板验证超时'); await new Promise(resolve=>setTimeout(resolve,60)); } };
exports.run = async () => {
  fs.mkdirSync(runtime,{recursive:true}); fs.mkdirSync(evidence,{recursive:true});
  for(const name of fs.readdirSync(runtime)) if(/^templates-.*-done$/.test(name)) fs.unlinkSync(path.join(runtime,name));
  await vscode.extensions.getExtension('muyang.folio-markdown').activate(); await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('notifications.clearAll');
  let watched; const result={rounds:[]};
  const snapshot=()=>{fs.writeFileSync(path.join(runtime,'templates-source-next.json'),JSON.stringify({source:watched.getText(),version:watched.version}));
    fs.renameSync(path.join(runtime,'templates-source-next.json'),path.join(runtime,'templates-source.json'));};
  const listener=vscode.workspace.onDidChangeTextDocument(event=>{if(event.document===watched)snapshot();});
  const stage=name=>fs.writeFileSync(path.join(runtime,'templates-stage.json'),JSON.stringify({stage:name}));
  try {
    for(const round of ['1','2','3']) {
      const uri=vscode.Uri.file(path.join(runtime,`templates-${round}.md`));
      const fixture='# 模板写作\n\n入口\n\n## 后续内容\n\n这段内容需要保留。\n'; fs.writeFileSync(uri.fsPath,round==='2'?fixture.replace(/\n/g,'\r\n'):fixture);
      watched=await vscode.workspace.openTextDocument(uri);snapshot();await vscode.window.showTextDocument(watched);stage(round);
      await until(()=>fs.existsSync(path.join(runtime,`templates-${round}-done`)));
      const text=watched.getText(); assert(text.includes('本轮记录'+round+' 已修改')); assert(text.includes('继续写作'+round));
      assert(text.indexOf('本轮记录')<text.indexOf('## 后续内容')); assert(text.indexOf('继续写作')<text.indexOf('## 后续内容'));
      assert(!text.includes('{{date}}')&&!text.includes('、模板')); assert(text.includes('- [/] 整理笔记')); assert.equal(fs.readFileSync(uri.fsPath,'utf8'),text);
      if(round==='2') assert(!/(?<!\r)\n/.test(text),'CRLF 不改变'); result.rounds.push({round,status:'passed',saved:true});
    }
    const {TemplateStore}=require('../src/templates'), original=TemplateStore.prototype.update;
    let rejectSave=true; TemplateStore.prototype.update=function(message){
      if(rejectSave&&message.name==='保存失败验证') {rejectSave=false;return Promise.reject(new Error('模板存储暂不可用，请重试。当前输入已保留。'));}
      return original.call(this,message);
    };
    stage('failure'); await until(()=>fs.existsSync(path.join(runtime,'templates-failure-done'))); TemplateStore.prototype.update=original;
    result.failure='passed'; stage('complete'); result.status='passed';
  } catch(error){result.status='failed';result.error=error.stack;stage('failed');throw error;}
  finally {listener.dispose();fs.writeFileSync(path.join(evidence,'templates-host-verification.json'),JSON.stringify(result,null,2));}
};
