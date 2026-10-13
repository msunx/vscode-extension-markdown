const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = '# 表格编辑\n\n前文保持原样。\n\n'
  + '| 项目 | 说明 | 价格 |\n| :--- | :---: | ---: |\n| 第一项 | **保留粗体** | 120 |\n| 第二项 | `a\\|b` 和 [说明][guide] | 240 |\n| 第三项 |  | 360 |\n\n'
  + '后文保持原样。\n\n| 单列 |\n| --- |\n| 删除此行 |\n\n[guide]: https://example.com/guide\n';
const until = async (fn, label) => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 180000) throw new Error(`超时：${label}`); await new Promise(r => setTimeout(r, 60)); } };
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  const result = { rounds: [], checks: [] }, stage = name => fs.writeFileSync(path.join(runtime, 'tables-stage.json'), JSON.stringify({ stage: name }));
  const done = name => until(() => fs.existsSync(path.join(runtime, `tables-${name}-done`)), name);
  let watched;
  const snapshot = () => {
    if (!watched) return;
    fs.writeFileSync(path.join(runtime, 'tables-source-next.json'), JSON.stringify({ source: watched.getText(), version: watched.version }));
    fs.renameSync(path.join(runtime, 'tables-source-next.json'), path.join(runtime, 'tables-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(e => { if (e.document === watched) snapshot(); });
  try {
    await vscode.extensions.getExtension('muyang.folio-markdown').activate();
    for (let round = 1; round <= 3; round++) {
      const uri = vscode.Uri.file(path.join(runtime, `tables-${round}.md`));
      const original = round === 2 ? fixture.replace(/\n/g, '\r\n') : fixture;
      fs.writeFileSync(uri.fsPath, original); watched = await vscode.workspace.openTextDocument(uri); snapshot();
      await vscode.window.showTextDocument(watched); stage(`round-${round}`); await done(`round-${round}`);
      const content = watched.getText();
      assert(content.includes('第一项编辑') && content.includes('新增表格内容'));
      assert(content.includes('**保留粗体**') && content.includes('`a\\|b` 和 [说明][guide]'));
      assert(content.includes('前文保持原样。') && content.includes('后文保持原样。'));
      if (round === 2) assert(!/(?<!\r)\n/.test(content), 'CRLF 丢失');
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), content, '保存读回');
      result.rounds.push({ round, status: 'passed', saveReadback: true, crlf: round === 2 });
    }
    const external = new vscode.WorkspaceEdit();
    stage('external-ready'); await done('external-ready');
    external.insert(watched.uri, watched.positionAt(watched.getText().length), '\n外部修订\n');
    assert(await vscode.workspace.applyEdit(external)); stage('external'); await done('external');
    assert(watched.getText().includes('外部修订')); await watched.save();
    result.checks.push('外部修订不会被表格草稿覆盖');
    for (const mode of ['readonly', 'failure']) {
      const events = new vscode.EventEmitter(), bytes = Buffer.from('# 表格编辑\n\n| 项目 | 状态 |\n| --- | --- |\n| 内容 | 保留 |\n');
      const provider = vscode.workspace.registerFileSystemProvider(`folio-table-${mode}`, {
        onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
        readFile: () => bytes, readDirectory: () => [], writeFile: () => { throw vscode.FileSystemError.NoPermissions('表格保存失败回归'); }, createDirectory() {}, delete() {}, rename() {}
      }, { isReadonly: mode === 'readonly' });
      try {
        watched = await vscode.workspace.openTextDocument(vscode.Uri.parse(`folio-table-${mode}:/tables-${mode}.md`)); snapshot();
        await vscode.window.showTextDocument(watched); stage(mode); await done(mode);
        if (mode === 'readonly') assert.equal(watched.getText(), bytes.toString());
        else { assert(watched.isDirty); assert(watched.getText().includes('失败草稿')); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor'); }
      } finally { provider.dispose(); events.dispose(); }
    }
    result.checks.push('只读表格禁止编辑、真实保存失败保留草稿'); result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'tables-host-verification.json'), JSON.stringify(result, null, 2)); }
};
