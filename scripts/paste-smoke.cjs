const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime');
const fixture = '# 粘贴验证\n\n前文后文\n\n- [ ] 父任务\n  - [ ] 子任务\n\n| 项目 | 内容 |\n| --- | --- |\n| 原文 | 保留 |\n\n```text\n原始代码\n```\n';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true });
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  const uri = vscode.Uri.file(path.join(runtime, 'paste.md'));
  fs.writeFileSync(uri.fsPath, fs.existsSync(path.join(runtime, 'paste-crlf')) ? fixture.replace(/\n/g, '\r\n') : fixture);
  const document = await vscode.workspace.openTextDocument(uri);
  const snapshot = () => {
    fs.writeFileSync(path.join(runtime, 'paste-source-next.json'), JSON.stringify({ source: document.getText(), version: document.version }));
    fs.renameSync(path.join(runtime, 'paste-source-next.json'), path.join(runtime, 'paste-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === document) snapshot(); });
  snapshot(); await vscode.window.showTextDocument(document); await vscode.commands.executeCommand('folio.preview');
  fs.writeFileSync(path.join(runtime, 'paste-ready'), '');
  let lastId;
  try {
    const deadline = Date.now() + 240000;
    while (!fs.existsSync(path.join(runtime, 'paste-done'))) {
      if (Date.now() > deadline) throw new Error('粘贴验证超时');
      let request; try { request = JSON.parse(fs.readFileSync(path.join(runtime, 'paste-command.json'))); } catch {}
      if (request && request.id !== lastId) {
        lastId = request.id;
        if (request.type === 'clipboard') await vscode.env.clipboard.writeText(request.text);
        if (request.type === 'save') await document.save();
        fs.writeFileSync(path.join(runtime, 'paste-command-done.json'), JSON.stringify({ id: lastId }));
      }
      await pause(40);
    }
  } finally { listener.dispose(); }
};
