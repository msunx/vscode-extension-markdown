const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = '# Folio · 编辑预览\n\n在阅读的位置继续写作，保留 **重点** 和 `代码`。\n\n## 今日计划\n\n- [ ] 整理文档\n- [x] 确定方向\n\n> 写作时，工具应当退后一步。\n\n```js\nconst color = "#24273A";\n```\n\n| 项目 | 状态 |\n| --- | --- |\n| 预览 | 完成 |\n';
const until = async (predicate, label) => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 180000) throw new Error(`超时：${label}`); await new Promise(resolve => setTimeout(resolve, 80)); }
};
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  const result = { rounds: [], checks: [] };
  const stage = name => fs.writeFileSync(path.join(runtime, 'editing-stage.json'), JSON.stringify({ stage: name }));
  const done = name => until(() => fs.existsSync(path.join(runtime, `editing-${name}-done`)), name);
  let watchedDocument;
  const snapshot = () => {
    if (!watchedDocument) return;
    fs.writeFileSync(path.join(runtime, 'editing-source-next.json'), JSON.stringify({ source: watchedDocument.getText(), version: watchedDocument.version }));
    fs.renameSync(path.join(runtime, 'editing-source-next.json'), path.join(runtime, 'editing-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === watchedDocument) snapshot(); });
  try {
    await vscode.extensions.getExtension('muyang.folio-markdown').activate();
    const { updateBlock } = require('../src/preview');
    for (let round = 1; round <= 3; round++) {
      const uri = vscode.Uri.file(path.join(runtime, `editing-${round}.md`));
      const ending = round === 2 ? '\n## 末尾任务\n\n- [ ] 保留父任务\n  - [x] 保留子任务' : round === 3 ? '\n```text\n末尾代码保持原样\n```' : '';
      const original = round === 2 ? (fixture + ending).replace(/\n/g, '\r\n') : fixture + ending;
      fs.writeFileSync(uri.fsPath, original);
      const document = await vscode.workspace.openTextDocument(uri);
      watchedDocument = document; snapshot(); await vscode.window.showTextDocument(document);
      stage(`round-${round}`); await done(`round-${round}`);
      const content = document.getText();
      assert(content.startsWith('# Folio · 编辑预览'), '标题编辑与撤销改变了原文');
      assert(content.includes('新增内容'), '正文未回写');
      assert(content.includes('## 新的章节'), '模块选择没有生成标题');
      assert(content.includes('- [x] 预览里写下的任务'), '新任务未回写');
      assert(content.includes('**重点**') && content.includes('`代码`'), '行内格式丢失');
      assert(content.includes('const color = "#24273A";'), '未编辑的代码变化');
      assert(content.includes('| 项目 | 状态 |'), '未编辑表格变化');
      assert(content.includes('撤销后末尾续写') && content.includes('- [ ] 新增末尾任务'), '末尾新增内容丢失');
      if (ending) assert(content.includes(ending.replace(/\n/g, round === 2 ? '\r\n' : '\n')), '追加内容改变了原来的末尾组件');
      if (round === 2) assert(!/(?<!\r)\n/.test(content), 'CRLF 被破坏');
      assert(await document.save());
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), content, '保存读回不一致');
      await vscode.commands.executeCommand('folio.edit');
      await until(() => vscode.window.activeTextEditor?.document === document, '回到源码');
      await vscode.commands.executeCommand('undo');
      assert.notEqual(document.getText(), content, '宿主撤销没有生效');
      await vscode.commands.executeCommand('redo');
      assert.equal(document.getText(), content, '宿主重做没有恢复');
      await document.save();
      let failure;
      try { await updateBlock(document, { base: original, start: 0, end: 1, text: 'x' }); } catch (error) { failure = error; }
      assert(failure && document.getText() === content, '过期编辑覆盖了原文');
      result.rounds.push({
        round, status: 'passed', crlf: round === 2, saveReadback: true, undoRedo: true, staleRejected: true, appendEnd: true, ending: round === 1 ? 'table' : round === 2 ? 'todo' : 'code'
      });
    }
    result.checks.push('真实预览输入、模块选择与任务回写', '保存读回、CRLF、宿主撤销/重做、过期版本拒绝');
    const emptyUri = vscode.Uri.file(path.join(runtime, 'editing-empty.md')); fs.writeFileSync(emptyUri.fsPath, '');
    const emptyDocument = await vscode.workspace.openTextDocument(emptyUri); await vscode.window.showTextDocument(emptyDocument);
    stage('empty'); await done('empty');
    assert(emptyDocument.getText().includes('回到空白后继续编辑'), '空白文档撤销后无法继续编辑');
    const externalEdit = new vscode.WorkspaceEdit(); externalEdit.insert(emptyUri, emptyDocument.positionAt(emptyDocument.getText().length), '\n外部修订\n');
    assert(await vscode.workspace.applyEdit(externalEdit)); stage('external'); await done('external');
    assert(await emptyDocument.save()); assert(fs.readFileSync(emptyUri.fsPath, 'utf8').includes('外部修订'));
    result.checks.push('空白文档输入、撤销至空白后继续编辑、真实外部更新仍保留草稿');
    const events = new vscode.EventEmitter();
    const readonlyContent = Buffer.from('# 只读文档\n');
    const provider = vscode.workspace.registerFileSystemProvider('folio-edit-readonly', {
      onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: readonlyContent.length }),
      readFile: () => readonlyContent, readDirectory: () => [], writeFile: () => { throw vscode.FileSystemError.NoPermissions(); },
      createDirectory() {}, delete() {}, rename() {}
    }, { isReadonly: true });
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-edit-readonly:/draft.md'));
      let failure; try { await updateBlock(document, { base: document.getText(), start: 0, end: 1, text: 'x' }); } catch (error) { failure = error; }
      assert(failure?.message.includes('只读'));
      await vscode.window.showTextDocument(document); stage('readonly'); await done('readonly');
      assert.equal(document.getText(), readonlyContent.toString());
    } finally { provider.dispose(); events.dispose(); }
    result.checks.push('只读文档拒绝写入');
    const failedEvents = new vscode.EventEmitter();
    const failedContent = Buffer.from('# Folio · 编辑预览\n\n保存失败时保留输入。\n');
    const failedProvider = vscode.workspace.registerFileSystemProvider('folio-edit-failure', {
      onDidChangeFile: failedEvents.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: failedContent.length }),
      readFile: () => failedContent, readDirectory: () => [], writeFile: () => { throw vscode.FileSystemError.NoPermissions('Folio 保存失败回归'); },
      createDirectory() {}, delete() {}, rename() {}
    }, { isReadonly: false });
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-edit-failure:/save.md'));
      await vscode.window.showTextDocument(document); stage('save-failure'); await done('save-failure');
      assert(document.getText().includes('保存失败草稿'), '保存失败后草稿丢失'); assert(document.isDirty, '保存失败不应标记已保存');
      result.checks.push('真实保存失败提示、编辑内容保留且文档保持未保存');
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    } finally { failedProvider.dispose(); failedEvents.dispose(); }
    result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'editing-host-verification.json'), JSON.stringify(result, null, 2)); }
};
