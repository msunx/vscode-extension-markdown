const vscode = require('vscode');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = '# 文字样式\n\n让重要的文字更清楚，继续记录今天。\n\n保留 **原有加粗内容** 与普通正文。\n\n代码示例： hello `world` end 。\n\n- [/] 准备资料\n  - [ ] 整理提纲\n  - [x] 校对旧稿\n\n[项目文档](./format-link.md) 与链接后正文。\n\n| 项目 | 内容 |\n| --- | --- |\n| 第一行 | 单元格文字 |\n\n> 引用中的文字\n\n符号示例： \\`raw\\` 与 ☕️。\n\n空格示例： 空格 。\n\n边界：前文字。后。\n\n最后一段保持不变。\n';
const until = async fn => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 600000) throw new Error('格式验证超时'); await new Promise(resolve => setTimeout(resolve, 60)); } };
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  for (const name of fs.readdirSync(runtime)) if (/^format-.*-done$/.test(name)) fs.unlinkSync(path.join(runtime, name));
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  await vscode.commands.executeCommand('workbench.action.closeSidebar'); await vscode.commands.executeCommand('notifications.clearAll');
  let watched;
  const snapshot = () => { fs.writeFileSync(path.join(runtime, 'format-source-next.json'), JSON.stringify({ source: watched.getText(), version: watched.version })); fs.renameSync(path.join(runtime, 'format-source-next.json'), path.join(runtime, 'format-source.json')); };
  const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === watched) snapshot(); });
  const stage = name => fs.writeFileSync(path.join(runtime, 'format-stage.json'), JSON.stringify({ stage: name })), result = { rounds: [] };
  try {
    for (const round of ['1', '2', '3']) {
      const uri = vscode.Uri.file(path.join(runtime, `format-${round}.md`)); fs.writeFileSync(uri.fsPath, round === '2' ? fixture.replace(/\n/g, '\r\n') : fixture);
      watched = await vscode.workspace.openTextDocument(uri); snapshot(); await vscode.window.showTextDocument(watched); stage(round);
      await until(() => fs.existsSync(path.join(runtime, `format-${round}-done`)));
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), watched.getText());
      if (round === '2') assert(!/(?<!\r)\n/.test(watched.getText()), 'CRLF 保留');
      assert(watched.getText().includes('最后一段保持不变。')); result.rounds.push({ round, saved: true, status: 'passed' });
    }
    for (const mode of ['readonly', 'failure']) {
      const bytes = Buffer.from('# 文字样式\n\n保留文字\n'), events = new vscode.EventEmitter();
      const scheme = `folio-format-${mode}`, provider = vscode.workspace.registerFileSystemProvider(scheme, {
        onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
        readFile: () => bytes, readDirectory: () => [], writeFile: () => { throw vscode.FileSystemError.NoPermissions('验证保存失败'); }, createDirectory() {}, delete() {}, rename() {}
      }, { isReadonly: mode === 'readonly' });
      try {
        watched = await vscode.workspace.openTextDocument(vscode.Uri.parse(`${scheme}:/format-${mode}.md`)); snapshot(); await vscode.window.showTextDocument(watched); stage(mode);
        await until(() => fs.existsSync(path.join(runtime, `format-${mode}-done`)));
        if (mode === 'readonly') assert.equal(watched.getText(), bytes.toString());
        else { assert(watched.isDirty && watched.getText().includes('**保留文字**')); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor'); }
        result[mode] = 'passed';
      } finally { provider.dispose(); events.dispose(); }
    }
    result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'format-host-verification.json'), JSON.stringify(result, null, 2)); }
};
