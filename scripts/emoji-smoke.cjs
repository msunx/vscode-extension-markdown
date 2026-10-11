const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const until = async (predicate, label) => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 180000) throw new Error(`超时：${label}`); await new Promise(resolve => setTimeout(resolve, 70)); }
};
exports.run = async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const result = { rounds: [] }, stage = name => fs.writeFileSync(path.join(runtime, 'emoji-stage.json'), JSON.stringify({ stage: name }));
  const done = name => until(() => fs.existsSync(path.join(runtime, `emoji-${name}-done`)), name);
  try {
    await vscode.extensions.getExtension('muyang.folio-markdown').activate();
    for (let round = 1; round <= 3; round++) {
      const uri = vscode.Uri.file(path.join(runtime, `emoji-${round}.md`)), eol = round === 2 ? '\r\n' : '\n';
      const fixture = '# 表情写作\n\n句首 **重点** 尾文\n\n替换 这段文字 结束\n\n空行入口\n\n- [ ] 父任务\n  - [ ] 子任务\n\n> 引用内容\n';
      fs.writeFileSync(uri.fsPath, fixture.replace(/\n/g, eol));
      const document = await vscode.workspace.openTextDocument(uri);
      const snapshot = () => {
        fs.writeFileSync(path.join(runtime, 'emoji-source-next.json'), JSON.stringify({ source: document.getText() }));
        fs.renameSync(path.join(runtime, 'emoji-source-next.json'), path.join(runtime, 'emoji-source.json'));
      };
      const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === document) snapshot(); });
      try {
        snapshot(); await vscode.window.showTextDocument(document); stage(`round-${round}`); await done(`round-${round}`);
        const source = document.getText();
        assert(source.includes('句首 **重点** 😊继续尾文'));
        assert(source.includes('替换 ❤️ 结束'));
        assert(source.includes('☕新的段落'));
        assert(source.includes(`- [ ] 父任务${eol}  - [ ] 子任务🧑‍💻`));
        assert(source.includes('> 引用内容🚀'));
        assert(!source.includes('/emoji') && !source.includes('、表情'));
        assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), source, '保存读回不一致');
        if (round === 2) assert(!/(?<!\r)\n/.test(source), 'CRLF 被破坏');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await vscode.commands.executeCommand('vscode.openWith', uri, 'folio.markdownPreview'); stage(`reopen-${round}`); await done(`reopen-${round}`);
        assert.equal(document.getText(), source, '重新打开改变了文档');
        result.rounds.push({ round, status: 'passed', savedAndReopened: true, crlf: round === 2 });
        if (round === 3) {
          stage('conflict'); await done('picker-open');
          const edit = new vscode.WorkspaceEdit(); edit.insert(uri, document.positionAt(document.getText().length), eol + '外部更新' + eol);
          assert(await vscode.workspace.applyEdit(edit)); await done('conflict');
          assert.equal(document.getText(), source + eol + '外部更新' + eol, '过期表情插入覆盖了原文');
          await document.save(); result.conflictRejected = true;
        }
      } finally { listener.dispose(); }
    }
    result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'emoji-host-verification.json'), JSON.stringify(result, null, 2)); }
};
