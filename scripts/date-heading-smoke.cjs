const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = '# 2026-10-23\n\n日期标题验证正文。\n\n## 2026-10-23\n\n# 2026-10-24\n\n# 2026-10-22\n\n# 2026-1-23\n\n# 2026-10-23 日记\n\n# 普通标题\n\n# **2026-10-23**\n\n[日期锚点](#2026-10-23)\n\n2026-10-23\n';
const until = async fn => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 240000) throw new Error('日期标题验证超时'); await new Promise(r => setTimeout(r, 60)); } };
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  for (const name of fs.readdirSync(runtime)) if (/^date-heading-.*-done$/.test(name)) fs.unlinkSync(path.join(runtime, name));
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  let watched;
  const snapshot = () => {
    fs.writeFileSync(path.join(runtime, 'date-heading-source-next.json'), JSON.stringify({ source: watched.getText(), version: watched.version }));
    fs.renameSync(path.join(runtime, 'date-heading-source-next.json'), path.join(runtime, 'date-heading-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === watched) snapshot(); });
  const stage = name => fs.writeFileSync(path.join(runtime, 'date-heading-stage.json'), JSON.stringify({ stage: name })), result = { rounds: [] };
  try {
    for (const round of ['lf', 'crlf']) {
      const uri = vscode.Uri.file(path.join(runtime, `date-heading-${round}.md`)), original = round === 'crlf' ? fixture.replace(/\n/g, '\r\n') : fixture;
      fs.writeFileSync(uri.fsPath, original); watched = await vscode.workspace.openTextDocument(uri); snapshot(); await vscode.window.showTextDocument(watched); stage(round);
      await until(() => fs.existsSync(path.join(runtime, `date-heading-${round}-done`)));
      assert.equal(watched.getText(), original, '显示切换、撤销和跨天不能改写原文');
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), original, '保存仍为日期原文');
      result.rounds.push({ round, status: 'passed', originalPreserved: true });
    }
    const bytes = Buffer.from(fixture), events = new vscode.EventEmitter();
    const provider = vscode.workspace.registerFileSystemProvider('folio-date-heading-readonly', {
      onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
      readFile: () => bytes, readDirectory: () => [], writeFile: () => { throw vscode.FileSystemError.NoPermissions(); }, createDirectory() {}, delete() {}, rename() {}
    }, { isReadonly: true });
    try {
      watched = await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-date-heading-readonly:/date-heading-readonly.md')); snapshot();
      await vscode.window.showTextDocument(watched); stage('readonly'); await until(() => fs.existsSync(path.join(runtime, 'date-heading-readonly-done')));
      assert.equal(watched.getText(), fixture); result.readonly = 'passed';
    } finally { provider.dispose(); events.dispose(); }
    result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'date-heading-host-verification.json'), JSON.stringify(result, null, 2)); }
};
