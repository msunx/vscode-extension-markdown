const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = '# 拖动验证\n\n## 目标标题\n\n第一逻辑行 **加粗**\n第二逻辑行 [链接](./target.md)\n第三逻辑行\n\n- [ ] 父任务\n  - [x] 保留子项\n  - [ ] 移动子项\n- [ ] 同级任务\n\n可编辑正文\n\n- 普通条目一\n  - 普通子项\n- 普通条目二\n\n<!-- folio:table-widths 160,240 -->\n\n| 项目 | 说明 |\n| --- | :---: |\n| 保留 | **表格格式** |\n\n```js\nconst example = 1;\n```\n\n> 引用第一行\n> 引用第二行\n\n10. [ ] 有序任务\n    - [x] 有序任务子项\n\n末尾正文\n';
const until = async fn => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 240000) throw new Error('块拖动验证超时'); await new Promise(r => setTimeout(r, 60)); } };
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  for (const name of fs.readdirSync(runtime)) if (/^blocks-.*-done$/.test(name)) fs.unlinkSync(path.join(runtime, name));
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  let watched;
  const snapshot = () => {
    fs.writeFileSync(path.join(runtime, 'blocks-source-next.json'), JSON.stringify({ source: watched.getText(), version: watched.version }));
    fs.renameSync(path.join(runtime, 'blocks-source-next.json'), path.join(runtime, 'blocks-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === watched) snapshot(); });
  const stage = name => fs.writeFileSync(path.join(runtime, 'blocks-stage.json'), JSON.stringify({ stage: name })), result = { rounds: [] };
  try {
    for (const round of ['lf', 'crlf']) {
      const uri = vscode.Uri.file(path.join(runtime, `blocks-${round}.md`)); fs.writeFileSync(uri.fsPath, round === 'crlf' ? fixture.replace(/\n/g, '\r\n') : fixture);
      watched = await vscode.workspace.openTextDocument(uri); snapshot(); await vscode.window.showTextDocument(watched); stage(round);
      await until(() => fs.existsSync(path.join(runtime, `blocks-${round}-done`)));
      const content = watched.getText(), normalized = content.replace(/\r\n/g, '\n');
      for (const expected of ['- [ ] 父任务\n  - [x] 保留子项', '- [ ] 移动子项', '- 普通条目一\n  - 普通子项\n- 普通条目二', '<!-- folio:table-widths 160,240 -->\n\n| 项目 | 说明 |\n| --- | :---: |\n| 保留 | **表格格式** |', '第二逻辑行 [链接](./target.md)', 'const example = 1 + 1;', '> 引用第一行\n> 引用第二行', '可编辑正文更新', '新建正文块', '- [ ] 新任务', '10. [ ] 有序任务\n    - [x] 有序任务子项', '末尾正文']) {
        assert.equal(normalized.split(expected).length - 1, 1, `内容完整且不重复：${expected}`);
      }
      if (round === 'crlf') assert(!/(?<!\r)\n/.test(content), '保留 CRLF');
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), content); result.rounds.push({ round, status: 'passed', saved: true });
    }
    const bytes = Buffer.from(fixture), events = new vscode.EventEmitter();
    const provider = vscode.workspace.registerFileSystemProvider('folio-blocks-readonly', {
      onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
      readFile: () => bytes, readDirectory: () => [], writeFile: () => { throw vscode.FileSystemError.NoPermissions(); },
      createDirectory() {}, delete() {}, rename() {}
    }, { isReadonly: true });
    try {
      watched = await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-blocks-readonly:/blocks-readonly.md')); snapshot();
      await vscode.window.showTextDocument(watched); stage('readonly'); await until(() => fs.existsSync(path.join(runtime, 'blocks-readonly-done')));
      assert.equal(watched.getText(), bytes.toString()); result.readonly = 'passed';
    } finally { provider.dispose(); events.dispose(); }
    result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'blocks-host-verification.json'), JSON.stringify(result, null, 2)); }
};
