const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime'), evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const fixture = '# 行首列表验证\n\n无序位置\n\n### 数字示例\n\n数字位置\n\n### 句点示例\n\n句点位置\n\n### 零号示例\n\n零号位置\n\n保留 **粗体** 和 [链接](https://example.com)\n\n正文位置\n\n行内 `-` 代码\n\n'
  + '## 标题位置\n\n- [ ] 现有任务\n\n| 列一 | 列二 |\n| --- | --- |\n| 单元格 | 保留 |\n\n```text\n代码保留\n```\n\n后文保持原样。\n';
const until = async fn => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 240000) throw new Error('行首列表验证超时'); await new Promise(r => setTimeout(r, 60)); } };
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  for (const name of fs.readdirSync(runtime)) if (/^auto-list-.*-done$/.test(name)) fs.unlinkSync(path.join(runtime, name));
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  let watched;
  const snapshot = () => {
    fs.writeFileSync(path.join(runtime, 'auto-list-source-next.json'), JSON.stringify({ source: watched.getText(), version: watched.version }));
    fs.renameSync(path.join(runtime, 'auto-list-source-next.json'), path.join(runtime, 'auto-list-source.json'));
  };
  const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === watched) snapshot(); });
  const stage = name => fs.writeFileSync(path.join(runtime, 'auto-list-stage.json'), JSON.stringify({ stage: name })), result = { rounds: [] };
  try {
    for (const round of ['lf', 'crlf']) {
      const uri = vscode.Uri.file(path.join(runtime, `auto-list-${round}.md`)); fs.writeFileSync(uri.fsPath, round === 'crlf' ? fixture.replace(/\n/g, '\r\n') : fixture);
      watched = await vscode.workspace.openTextDocument(uri); snapshot(); await vscode.window.showTextDocument(watched); stage(round);
      await until(() => fs.existsSync(path.join(runtime, `auto-list-${round}-done`)));
      const content = watched.getText(), normalized = content.replace(/\r\n/g, '\n');
      for (const expected of ['- 自动无序第一项', '- 自动无序第二项', '3. 第三项\n4. 第四项', '12. 十二项', '0. 零号项', '**粗体**', '[链接](https://example.com)', '后文保持原样。']) {
        assert(normalized.includes(expected), `缺少 ${expected}`);
      }
      if (round === 'crlf') assert(!/(?<!\r)\n/.test(content), '保留 CRLF');
      assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), content); result.rounds.push({ round, status: 'passed', saved: true });
    }
    result.status = 'passed'; stage('complete');
  } catch (error) { result.status = 'failed'; result.error = error.stack; stage('failed'); throw error; }
  finally { listener.dispose(); fs.writeFileSync(path.join(evidence, 'auto-list-host-verification.json'), JSON.stringify(result, null, 2)); }
};
