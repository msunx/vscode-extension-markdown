const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

function requireState(condition, message) {
  if (!condition) throw new Error(message);
}

async function until(predicate, label) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 12000) throw new Error(`等待超时：${label}`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
}

function previewIsActive() {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom && input.viewType === 'folio.markdownPreview';
}

async function run() {
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, '.runtime'), { recursive: true });
  const results = { hostVersion: vscode.version, extension: 'muyang.folio-markdown', rounds: [], checks: [] };
  try {
    const extension = vscode.extensions.getExtension(results.extension);
    requireState(extension, 'Folio 扩展未被宿主发现');
    await extension.activate();
    results.checks.push('扩展激活');
    const uri = vscode.Uri.file(path.join(root, 'examples/preview.md'));
    const document = await vscode.workspace.openTextDocument(uri);
    const original = document.getText();
    for (let i = 1; i <= 3; i++) {
      await vscode.window.showTextDocument(document, { preview: false });
      requireState(await vscode.commands.executeCommand('folio.preview'), '预览命令未执行');
      await until(previewIsActive, 'Folio Markdown 预览');
      requireState(await vscode.commands.executeCommand('folio.edit'), '返回编辑命令未执行');
      await until(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(), '返回同一文件');
      requireState(document.getText() === original, '切换改变了原始 Markdown');
      results.rounds.push({ run: i, status: 'passed' });
    }
    const rendered = await vscode.commands.executeCommand('markdown.api.render', original);
    fs.writeFileSync(path.join(root, '.runtime/host-rendered.html'), rendered);
    for (const marker of ['folio-code-block', 'folio-table', 'task-list-item', 'footnotes', 'folio-alert-note', 'folio-alert-warning', '<mark>', '<sub>', '<sup>', 'katex']) {
      requireState(rendered.includes(marker), `实际 Markdown 渲染缺少：${marker}`);
    }
    requireState(/<dl(?:\s|>)/.test(rendered), '实际 Markdown 渲染缺少定义列表');
    results.checks.push('宿主渲染基础模块、脚注、提示块、高亮、上下标、定义列表、公式');

    const { updateTask } = require('../src/preview');
    const fixtureUri = vscode.Uri.file(path.join(root, '.runtime/todo-smoke.md'));
    const fixture = '# Todo 验证\r\n\r\n- [ ] 父任务\r\n  - [x] 子任务\r\n- [ ] 同名\r\n- [ ] 同名\r\n> - [ ] 引用任务\r\n1. [X] 有序任务\r\n\r\n```md\r\n- [ ] 代码示例\r\n```\r\n';
    fs.writeFileSync(fixtureUri.fsPath, fixture);
    const tasks = await vscode.workspace.openTextDocument(fixtureUri);
    const send = (line, checked, extra = {}) => updateTask(tasks, { version: tasks.version, line, source: tasks.lineAt(line).text,
      character: require('../src/markdown').taskMarker(tasks.lineAt(line).text)[1].length + 1, checked, ...extra });
    for (let round = 1; round <= 3; round++) {
      await send(2, true);
      requireState(tasks.lineAt(2).text === '- [x] 父任务', '父任务勾选没有回写');
      requireState(tasks.lineAt(3).text === '  - [x] 子任务', '错误修改嵌套子任务');
      await send(2, false);
      await send(5, true);
      requireState(tasks.lineAt(4).text === '- [ ] 同名', '错误修改同名任务');
      await send(5, false);
      await send(6, true); await send(6, false);
      await send(7, false); await send(7, true);
      requireState(tasks.lineAt(10).text === '- [ ] 代码示例', '错误修改代码中的任务文本');
    }
    await send(2, true);
    await vscode.window.showTextDocument(tasks);
    await vscode.commands.executeCommand('undo');
    requireState(tasks.lineAt(2).text === '- [ ] 父任务', '撤销没有恢复任务');
    await vscode.commands.executeCommand('redo');
    requireState(tasks.lineAt(2).text === '- [x] 父任务', '重做没有恢复任务');
    requireState(await tasks.save(), '任务文件保存失败');
    requireState(fs.readFileSync(fixtureUri.fsPath, 'utf8').includes('- [x] 父任务\r\n'), '任务状态未持久化或破坏 CRLF');
    let rejected = false;
    try { await send(2, false, { version: tasks.version - 1 }); } catch { rejected = true; }
    requireState(rejected && tasks.lineAt(2).text === '- [x] 父任务', '过期预览没有拒绝写入');
    results.checks.push('Todo 三轮勾选/取消、嵌套、同名、有序、引用、代码隔离、撤销/重做、保存读回与 CRLF、过期请求拒绝');
    const readOnlyContent = Buffer.from('- [ ] 只读任务\n');
    const events = new vscode.EventEmitter();
    const provider = vscode.workspace.registerFileSystemProvider('folio-readonly', {
      onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}),
      stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: readOnlyContent.length }), readFile: () => readOnlyContent,
      readDirectory: () => [], createDirectory: () => { throw vscode.FileSystemError.NoPermissions(); },
      writeFile: () => { throw vscode.FileSystemError.NoPermissions(); }, delete: () => { throw vscode.FileSystemError.NoPermissions(); }, rename: () => { throw vscode.FileSystemError.NoPermissions(); }
    }, { isReadonly: true });
    try {
      const readonly = await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-readonly:/tasks.md'));
      let failure;
      try { await updateTask(readonly, { line: 0, character: 3, source: '- [ ] 只读任务', version: readonly.version, checked: true }); } catch (error) { failure = error.message; }
      requireState(failure?.includes('只读') && readonly.getText() === readOnlyContent.toString(), '只读失败处理没有保留原始任务');
      results.checks.push('只读文档拒绝写入并保留原文');
    } finally { provider.dispose(); events.dispose(); }

    const draft = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# 未保存的笔记\n\n保留这段内容。' });
    await vscode.window.showTextDocument(draft);
    await vscode.commands.executeCommand('folio.toggle');
    await until(previewIsActive, '未保存文档预览');
    await vscode.commands.executeCommand('folio.toggle');
    await until(() => vscode.window.activeTextEditor?.document === draft, '返回未保存文档');
    requireState(draft.getText().includes('保留这段内容'), '未保存内容丢失');
    results.checks.push('切换快捷命令与未保存文档内容保留');

    const plain = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'plain text' });
    await vscode.window.showTextDocument(plain);
    const ignored = await vscode.commands.executeCommand('folio.preview');
    requireState(ignored === false && vscode.window.activeTextEditor?.document === plain, '非 Markdown 文档未被正确排除');
    results.checks.push('非 Markdown 文档被排除');
    if (process.env.FOLIO_UI_SMOKE === '1') {
      const uiUri = vscode.Uri.file(path.join(root, '.runtime/ui-todo.md'));
      fs.writeFileSync(uiUri.fsPath, '# Todo 交互验证\n\n- [ ] 父任务\n  - [x] 子任务\n- [ ] 同名任务\n- [ ] 同名任务\n\n[跳到说明](#说明)\n\n## 说明\n\n```ts\nconst theme = "twilight";\n```\n\n$E=mc^2$\n\n![Folio](../media/icon.png)\n');
      const uiDocument = await vscode.workspace.openTextDocument(uiUri);
      await vscode.window.showTextDocument(uiDocument);
      await vscode.commands.executeCommand('folio.preview');
      fs.writeFileSync(path.join(root, '.runtime/ui-ready.json'), JSON.stringify({ path: uiUri.fsPath }));
      const started = Date.now();
      while (!fs.existsSync(path.join(root, '.runtime/ui-done.json'))) {
        if (Date.now() - started > 240000) throw new Error('等待实际预览交互验证超时');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      requireState(uiDocument.lineAt(2).text === '- [x] 父任务' && uiDocument.lineAt(4).text === '- [ ] 同名任务' && uiDocument.lineAt(5).text === '- [x] 同名任务', '预览点击没有正确回写源文档');
      requireState(await uiDocument.save(), '实际预览变更保存失败');
      requireState(fs.readFileSync(uiUri.fsPath, 'utf8').includes('- [x] 父任务'), '实际预览变更未持久化');
      await vscode.commands.executeCommand('folio.edit');
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      const reopened = await vscode.workspace.openTextDocument(uiUri);
      requireState(reopened.lineAt(2).text === '- [x] 父任务', '重新打开文件后任务状态丢失');
      results.checks.push('真实 Webview 点击勾选与键盘操作、源文档回写、保存读回');
    }
    results.status = 'passed';
  } catch (error) {
    results.status = 'failed';
    results.error = String(error.stack || error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(root, '.runtime/host-verification.json'), JSON.stringify(results, null, 2));
  }
}

module.exports = { run };
