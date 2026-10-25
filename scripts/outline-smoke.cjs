const vscode = require('vscode'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), project = path.join(runtime, 'outline-project'), evidence = path.join(root, 'design/outline-update');
const fixture = '# 星光手记\n\n把一个想法，慢慢做成作品。\n\n## 准备\n\n准备内容：先留下想法，再整理顺序。\n\n### 灵感\n\n灵感内容：记录值得继续探索的细节。\n\n#### 草图\n\n| 项目 | 说明 |\n| --- | --- |\n| 构图 | 保持清楚的层次 |\n\n##### 检查\n\n检查内容保持完整。\n\n###### 素材\n\n素材内容保持完整。\n\n## 制作\n\n- [ ] 整理材料\n  - [/] 调整配色\n\n```javascript\nconst note = "keep";\n```\n\n### 一段较长的中文标题，用来说明在有限的目录宽度中如何保持清楚的阅读层级和定位\n\n长标题下面的正文。\n\n## 记录\n\n第一份记录。\n\n## 记录\n\n第二份记录。\n\n## 收尾\n\n收尾内容：保留后续所有段落。\n\n# 附录\n\n附录内容，不属于前一个一级标题。\n';
const until = async fn => { const start = Date.now(); while (!fn()) { if (fs.existsSync(path.join(runtime, 'outline-abort')) || Date.now() - start > 900000) throw new Error('目录验证中断或超时'); await new Promise(r => setTimeout(r, 60)); } };
exports.run = async () => {
  fs.mkdirSync(evidence, { recursive: true }); fs.mkdirSync(project, { recursive: true });
  for (const name of fs.readdirSync(runtime)) if (/^outline-.*-done$/.test(name) || ['outline-abort', 'outline-fail-state'].includes(name)) fs.unlinkSync(path.join(runtime, name));
  const { PreviewProvider } = require('../src/preview'), original = PreviewProvider.prototype.resolveCustomTextEditor;
  let wrapped = false;
  PreviewProvider.prototype.resolveCustomTextEditor = function (...args) {
    if (!wrapped) {
      wrapped = true; const update = this.context.workspaceState.update.bind(this.context.workspaceState);
      this.context.workspaceState.update = (key, value) => key.startsWith('folio.outline:') && fs.existsSync(path.join(runtime, 'outline-fail-state'))
        ? Promise.reject(new Error('模拟阅读状态写入失败')) : update(key, value);
    }
    return original.apply(this, args);
  };
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('notifications.clearAll');
  let watched; const snapshot = () => {
    fs.writeFileSync(path.join(runtime, 'outline-source-next.json'), JSON.stringify({ source: watched.getText(), version: watched.version, dirty: watched.isDirty }));
    fs.renameSync(path.join(runtime, 'outline-source-next.json'), path.join(runtime, 'outline-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(e => { if (e.document === watched) snapshot(); });
  const stage = name => fs.writeFileSync(path.join(runtime, 'outline-stage.json'), JSON.stringify({ stage: name })), result = { rounds: [] };
  try {
    for (const round of ['1', '2', '3', 'plain', 'failure']) {
      const uri = vscode.Uri.file(path.join(project, `outline-${round}.md`));
      fs.writeFileSync(uri.fsPath, round === 'plain' ? '没有标题的普通文档。\n\n正文仍然可以编辑。\n' : round === '2' ? fixture.replace(/\n/g, '\r\n') : fixture);
      watched = await vscode.workspace.openTextDocument(uri); snapshot(); await vscode.window.showTextDocument(watched); stage(round);
      await until(() => fs.existsSync(path.join(runtime, `outline-${round}-done`)));
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), watched.getText());
      if (round === '2') assert(!/(?<!\r)\n/.test(watched.getText()));
      if (['1','2','3'].includes(round)) assert(watched.getText().includes('追加文字') && watched.getText().includes('const note = "keep";'));
      result.rounds.push({ round, saved: true, status: 'passed' });
    }
    const bytes = Buffer.from(fixture), events = new vscode.EventEmitter();
    const provider = vscode.workspace.registerFileSystemProvider('folio-outline-readonly', {
      onDidChangeFile: events.event, watch: () => new vscode.Disposable(() => {}), stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
      readFile: () => bytes, readDirectory: () => [], writeFile() {}, createDirectory() {}, delete() {}, rename() {}
    }, { isReadonly: true });
    try {
      watched = await vscode.workspace.openTextDocument(vscode.Uri.parse('folio-outline-readonly:/outline-readonly.md')); snapshot(); await vscode.window.showTextDocument(watched);
      stage('readonly'); await until(() => fs.existsSync(path.join(runtime, 'outline-readonly-done'))); assert.equal(watched.getText(), fixture); result.readonly = 'passed';
    } finally { provider.dispose(); events.dispose(); }
    stage('complete'); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'host-verification.json'), JSON.stringify(result, null, 2)); }
};
