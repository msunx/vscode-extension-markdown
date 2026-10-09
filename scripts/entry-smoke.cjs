const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');

async function until(predicate, label) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 200000) throw new Error(`超时：${label}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function requireState(value, message) { if (!value) throw new Error(message); }

exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true });
  const result = { version: require('../package.json').version, rounds: [], checks: [] };
  const evidence = path.join(root, `design/evidence/extension-${result.version}`);
  fs.mkdirSync(evidence, { recursive: true });
  const stagePath = path.join(runtime, 'entry-stage.json');
  const complete = async stage => {
    fs.writeFileSync(stagePath, JSON.stringify({ stage }));
    await until(() => fs.existsSync(path.join(runtime, `entry-${stage}-done.json`)), stage);
  };
  try {
    await vscode.extensions.getExtension('muyang.folio-markdown').activate();
    const pins = vscode.workspace.getConfiguration('cursor.general').get('pinnedTitleActions', []);
    requireState(pins.includes('folio.preview') && pins.includes('folio.edit'), 'Cursor 标题栏按钮未固定');
    const uri = vscode.Uri.file(path.join(runtime, 'entry-todo.md'));
    const original = '# Folio · 入口回归\n\n- [ ] 通过右上角进入预览\n- [ ] 勾选结果写回原文\n  - [x] 独立子任务\n\n## 阅读与操作\n\n使用书本按钮预览，使用铅笔返回编辑。\n\n```ts\nconst background = "#24273A";\n```\n';
    fs.writeFileSync(uri.fsPath, original);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    for (let i = 1; i <= 3; i++) {
      await complete(`round-${i}`);
      requireState(vscode.window.activeTextEditor?.document === document, '标题栏返回编辑未回到原文');
      requireState(document.getText() === original, '勾选/取消后原文没有恢复');
      result.rounds.push({ run: i, status: 'passed' });
    }
    await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    await until(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview, '原生侧边预览');
    const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
    await complete('native');
    await until(() => vscode.window.activeTextEditor?.document === document, '从原生预览迁移后返回源码');
    requireState(vscode.window.activeTextEditor?.document === document, '从原生预览切换后无法返回原文');
    requireState(vscode.window.tabGroups.activeTabGroup.viewColumn === column, '从原生预览切换后丢失所在分栏');
    requireState(document.lineAt(3).text === '- [x] 勾选结果写回原文', '原生预览迁移后 Todo 没有回写');
    requireState(await document.save(), '保存失败');
    requireState(fs.readFileSync(uri.fsPath, 'utf8').includes('- [x] 勾选结果写回原文'), 'Todo 变更未保存');
    result.checks.push('Cursor 固定按钮配置', '真实右上角入口三轮预览/勾选/取消/返回', '原生预览传入 webview-panel URI 的迁移', '侧边分栏保留', '勾选结果保存读回');
    const plain = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '非 Markdown' });
    await vscode.window.showTextDocument(plain);
    await complete('plaintext');
    result.checks.push('非 Markdown 活动编辑器不显示 Folio 按钮');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = String(error.stack || error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(evidence, 'entry-host-verification.json'), JSON.stringify(result, null, 2));
  }
};
