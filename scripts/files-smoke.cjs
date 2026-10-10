const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), project = path.join(runtime, 'files-project');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const until = async (predicate, label) => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 120000) throw new Error(`超时：${label}`); await new Promise(resolve => setTimeout(resolve, 60)); }
};
exports.run = async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const result = { checks: [] };
  const stage = name => fs.writeFileSync(path.join(runtime, 'files-stage.json'), JSON.stringify({ stage: name }));
  const done = name => until(() => fs.existsSync(path.join(runtime, `files-${name}-done`)), name);
  try {
    for (const dir of ['notes', 'docs', 'src', 'node_modules/ignored']) fs.mkdirSync(path.join(project, dir), { recursive: true });
    const markdownName = '项目 [说明] (v1)#%?.md';
    const markdown = vscode.Uri.file(path.join(project, 'docs', markdownName));
    const code = vscode.Uri.file(path.join(project, 'src', 'example.js'));
    fs.writeFileSync(markdown.fsPath, '# 项目说明\n\n目标文件内容。\n');
    fs.writeFileSync(code.fsPath, 'const example = true;\n');
    fs.writeFileSync(path.join(project, 'docs', 'example.js'), 'const duplicate = true;\n');
    fs.writeFileSync(path.join(project, 'node_modules/ignored', 'ignored.js'), 'ignored\n');
    const uri = vscode.Uri.file(path.join(project, 'notes', 'links.md'));
    const fixture = '# 文件链接\r\n\r\n插入位置\r\n\r\n代码位置 **重点**。后文\r\n\r\n行内位置 **保留格式** 尾文\r\n\r\n- [ ] 父任务\r\n  - [ ] 子任务\r\n';
    fs.writeFileSync(uri.fsPath, fixture);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.extensions.getExtension('muyang.folio-markdown').activate();
    const snapshot = () => fs.writeFileSync(path.join(runtime, 'files-source.json'), JSON.stringify({ source: document.getText() }));
    const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === document) snapshot(); });
    snapshot();
    try {
      await vscode.window.showTextDocument(document); stage('markdown'); await done('markdown');
      await until(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri?.toString() === markdown.toString(), 'Markdown 文件跳转');
      assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.viewType, 'folio.markdownPreview');
      assert(document.getText().includes('../docs/%E9%A1%B9%E7%9B%AE%20%5B%E8%AF%B4%E6%98%8E%5D%20%28v1%29%23%25%3F.md'));
      assert(!document.getText().includes('/file'));
      assert(document.getText().includes('代码位置 **重点**。后文'));
      assert(!/(?<!\r)\n/.test(document.getText()), 'CRLF 被破坏');
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), document.getText());
      result.checks.push('搜索、取消、特殊字符相对路径、保存读回、CRLF、Markdown 跳转');
      await vscode.commands.executeCommand('vscode.openWith', uri, 'default'); stage('code'); await done('code');
      await until(() => vscode.window.activeTextEditor?.document.uri.toString() === code.toString(), '代码文件跳转');
      assert(document.getText().includes('代码位置 **重点**。[example.js](../src/example.js) 继续写后文'));
      result.checks.push('同名文件按路径选择、行内插入保留格式、代码文件跳转');
      await vscode.commands.executeCommand('vscode.openWith', uri, 'default'); stage('list'); await done('list');
      assert(document.getText().includes('- [ ] 父任务\r\n  - [ ] 子任务[example.js](../src/example.js)'));
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), document.getText());
      result.checks.push('嵌套 Todo 插入链接保留任务与层级、撤销重做');
      stage('inline'); await done('inline');
      assert(document.getText().includes('行内位置 **保留格式** [网站](https://example.com/guide) 继续写尾文、正常标点/正常斜杠'));
      result.checks.push('行内菜单只包含链接组件、普通标点不触发、行内链接保留前后文字与格式、继续输入不延长链接');
      stage('stale'); await done('picker-open');
      const edit = new vscode.WorkspaceEdit(); edit.insert(uri, document.positionAt(document.getText().length), '\r\n外部新增\r\n');
      assert(await vscode.workspace.applyEdit(edit)); await done('stale');
      assert(document.getText().endsWith('外部新增\r\n'));
      assert.equal((document.getText().match(/\.\.\/src\/example\.js/g) || []).length, 2, '过期选择覆盖了新内容');
      result.checks.push('选择期间源文档变更不写入过期位置');
      await document.save();
      const outside = vscode.Uri.file(path.join(runtime, 'files-outside.md')); fs.writeFileSync(outside.fsPath, '# 项目外文档\n\n插入位置\n');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(outside)); stage('outside'); await done('outside');
      result.checks.push('项目外文档给出明确提示且不插入');
      result.status = 'passed'; stage('complete');
    } finally { listener.dispose(); }
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'files-host-verification.json'), JSON.stringify(result, null, 2)); }
};
