const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = '# 列宽拖动验证\n\n前文保持原样。\n\n'
  + '| 项目 | 说明 | 价格 |\n| :--- | :---: | ---: |\n| 第一项 | **保留粗体** | 120 |\n| 第二项 | `a\\|b` 和 [说明][guide] | 240 |\n\n'
  + '后文保持原样。\n\n| 另一张表 | 状态 |\n| --- | --- |\n| 不受影响 | 保留 |\n\n[guide]: https://example.com/guide\n';
const stripWidths = text => text.replace(/^<!-- folio:table-widths [\d., ]+ -->\r?\n/gm, '');
const until = async (predicate, label) => {
  const deadline = Date.now() + 240000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`超时：${label}`); await new Promise(resolve => setTimeout(resolve, 60)); }
};
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  for (const entry of fs.readdirSync(runtime)) if (/^table-resize-.*-done$/.test(entry)) fs.unlinkSync(path.join(runtime, entry));
  const result = { rounds: [] }, stage = name => fs.writeFileSync(path.join(runtime, 'table-resize-stage.json'), JSON.stringify({ stage: name }));
  const done = name => until(() => fs.existsSync(path.join(runtime, `table-resize-${name}-done`)), name);
  let document;
  const snapshot = () => {
    fs.writeFileSync(path.join(runtime, 'table-resize-source-next.json'), JSON.stringify({ source: document.getText(), version: document.version }));
    fs.renameSync(path.join(runtime, 'table-resize-source-next.json'), path.join(runtime, 'table-resize-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === document) snapshot(); });
  try {
    await vscode.extensions.getExtension('muyang.folio-markdown').activate();
    for (const round of ['lf', 'crlf']) {
      const original = round === 'crlf' ? fixture.replace(/\n/g, '\r\n') : fixture;
      const uri = vscode.Uri.file(path.join(runtime, `table-resize-${round}.md`));
      fs.writeFileSync(uri.fsPath, original); document = await vscode.workspace.openTextDocument(uri); snapshot();
      await vscode.window.showTextDocument(document); stage(round); await done(round);
      const source = document.getText();
      assert.equal(stripWidths(source), original, '表格 Markdown、行内格式、相邻段落和另一张表均须保持原样');
      assert.equal((source.match(/<!-- folio:table-widths /g) || []).length, 1, '仅调整过的表格应写入列宽');
      if (round === 'crlf') assert(!/(?<!\r)\n/.test(source), 'CRLF 必须保持');
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), source, '保存后读回列宽和内容');
      result.rounds.push({ round, status: 'passed', markdownUnchanged: true, saved: true });
    }
    const events = new vscode.EventEmitter(), bytes = Buffer.from('# 列宽拖动验证\n\n<!-- folio:table-widths 160,240 -->\n| 项目 | 状态 |\n| --- | --- |\n| 保留 | 只读 |\n');
    const provider = vscode.workspace.registerFileSystemProvider('folio-resize-readonly', {
      onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
      readFile: () => bytes, readDirectory: () => [], writeFile() { throw vscode.FileSystemError.NoPermissions(); }, createDirectory() {}, delete() {}, rename() {}
    }, { isReadonly: true });
    try {
      document = await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-resize-readonly:/table-resize-readonly.md')); snapshot();
      await vscode.window.showTextDocument(document); stage('readonly'); await done('readonly'); assert.equal(document.getText(), bytes.toString());
    } finally { provider.dispose(); events.dispose(); }
    result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'table-resize-host-verification.json'), JSON.stringify(result, null, 2)); }
};
