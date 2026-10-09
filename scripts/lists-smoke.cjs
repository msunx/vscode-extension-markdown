const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const runtime = path.resolve(__dirname, '../.runtime');
const evidence = path.resolve(__dirname, `../design/evidence/extension-${require('../package.json').version}`);
const compactFixture = '# Folio · 列表编辑\n\n- 父项\n- 子项 **重点**\n  - 已有子项\n- 后项\n\n7. 计划甲\n8. 计划乙\n9. 计划丙\n10. 计划丁\n\n## 混合层级\n\n- 混合父项\n  1. 混合甲\n  2. 混合乙\n  3. 混合丙\n- 混合后项\n\n## 任务层级\n\n- [ ] 任务甲\n- [x] 任务乙\n  - [ ] 任务子项\n- [ ] 任务丙\n\n## 连续选区\n\n- 选区父项\n- 选区甲\n- 选区乙\n- 选区丙\n\n正文仍可通过 Tab 切换焦点。\n';
const fixture = compactFixture + `
## 留白任务

- [ ] 留白父项
  - [ ] 留白子项

- [x] 留白同级 **重点**

- [ ] 留白尾项

## 多段列表

- 段落首行

  第二段 **重点**

  - 段内子项

  第三段尾行

  > 段内引用

- 段落同级

## 留白编号

7. 空行计划甲

8. 空行计划乙

9. 空行计划丙

## 任务回车

- [ ] 回车父项
  - [x] 回车子项

## 留白回车

- [ ] 回车留白父项

  - [ ] 回车留白子项

- [ ] 回车留白后项

## 多层回车

- 回车外层
  - 回车中层
    - 回车内层

## 编号回车

7. 回车计划
   1. 回车步骤
`;

exports.fixture = fixture;
exports.run = async () => {
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  const result = { rounds: [] };
  await vscode.extensions.getExtension('muyang.folio-markdown').activate();
  for (let round = 1; round <= 3; round++) {
    const uri = vscode.Uri.file(path.join(runtime, `lists-${round}.md`));
    fs.writeFileSync(uri.fsPath, round === 2 ? fixture.replace(/\n/g, '\r\n') : fixture);
    const document = await vscode.workspace.openTextDocument(uri);
    const snapshot = () => {
      fs.writeFileSync(path.join(runtime, 'lists-source.tmp'), JSON.stringify({ source: document.getText(), version: document.version }));
      fs.renameSync(path.join(runtime, 'lists-source.tmp'), path.join(runtime, 'lists-source.json'));
    };
    const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === document) snapshot(); });
    try {
      await vscode.window.showTextDocument(document); snapshot();
      fs.writeFileSync(path.join(runtime, 'lists-stage.json'), JSON.stringify({ round }));
      const start = Date.now();
      while (!fs.existsSync(path.join(runtime, `lists-${round}-done`))) {
        if (Date.now() - start > 180000) throw new Error(`列表验证超时 ${round}`);
        await new Promise(resolve => setTimeout(resolve, 70));
      }
      const source = document.getText();
      assert(source.includes('**重点**') && source.includes('任务子项') && source.includes('[x] 任务乙'), '格式或任务状态丢失');
      assert(source.includes('7. 计划甲') && source.includes('7. 空行计划甲'), '有序列表起始编号丢失');
      assert(source.includes('第二段 **重点**') && source.includes('第三段尾行') && source.includes('> 段内引用'), '多段列表内容丢失');
      if (round === 2) assert(!/(?<!\r)\n/.test(source), 'CRLF 被破坏');
      assert(await document.save()); assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), source);
      result.rounds.push({ round, status: 'passed', savedReadback: true, crlf: round === 2 });
      await vscode.commands.executeCommand('folio.edit');
    } finally { listener.dispose(); }
  }
  result.status = 'passed';
  fs.writeFileSync(path.join(evidence, 'lists-host-verification.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(runtime, 'lists-stage.json'), JSON.stringify({ round: 'complete' }));
};
