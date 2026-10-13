const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const until = async (predicate, label) => {
  const start = Date.now();
  while (Date.now() - start < 30000) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 70)); }
  throw new Error(`超时：${label}`);
};
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  const context = browser.contexts()[0], page = context.pages()[0];
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const stage = name => until(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'editing-stage.json'))).stage === name; } catch { return false; } }, name);
  const findPreview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const state = (await session.send('Runtime.evaluate', { expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),visible:d?.visibilityState,title:d?.querySelector("h1")?.textContent,base:d?.baseURI,ready:!!d?.querySelector(".folio-block-content")}})()', returnByValue: true })).result.value;
        if ((round === 'empty' || round === 'readonly' || state?.title === 'Folio · 编辑预览') && state.ready
          && state.base?.includes(round === 'failure' ? 'save.md' : round === 'readonly' ? 'draft.md' : `editing-${round}.md`)
          && state.visible === 'visible' && await page.locator(`iframe[src*="id=${state.id}"]`).isVisible()) return { session, id: state.id };
        await session.detach();
      } catch {}
    }
  }, '编辑预览加载');
  const evaluate = async (preview, code) => {
    const r = await preview.session.send('Runtime.evaluate', { expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${code}})()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description);
    return r.result.value;
  };
  const click = async (preview, selector, caret = false) => {
    await evaluate(preview, 'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
    await evaluate(preview, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    let point, lastBounds;
    await until(async () => {
      const rect = await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();
        return {x:r.x+Math.min(80,r.width/2)+f.x,y:r.y+r.height/2+f.y};`);
      const outer = await page.locator(`iframe[src*="id=${preview.id}"]`).boundingBox();
      if (!outer) return false;
      point = {x:outer.x+rect.x,y:outer.y+rect.y,id:preview.id};
      const bounds = JSON.stringify({outer,rect}), stable = bounds === lastBounds; lastBounds = bounds;
      return stable && await page.evaluate(({x,y,id}) => document.elementFromPoint(x,y)?.getAttribute('src')?.includes(`id=${id}`), point);
    }, '点击目标完成布局且未被遮挡');
    await page.mouse.click(point.x, point.y);
    if (caret) await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)}),r=d.createRange();r.selectNodeContents(e);r.collapse(false);const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
  };
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '编辑写回');
  const menuVisible = p => until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '模块菜单');
  const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'editing-source.json')));
  const result = { rounds: [] };
  for (let round = 1; round <= 3; round++) {
    await stage(`round-${round}`);
    while (await page.locator('.notifications-toasts .codicon-notifications-clear:visible, .notifications-toasts .codicon-close:visible').count()) {
      await page.locator('.notifications-toasts .codicon-notifications-clear:visible, .notifications-toasts .codicon-close:visible').first().click();
    }
    await action('folio.preview').click(); const p = await findPreview(round);
    assert(await evaluate(p, "return !d.querySelector('.folio-add-end, .folio-block-add');"), '添加内容或区块加号按钮仍存在');
    assert(await evaluate(p, "return d.defaultView.getComputedStyle(d.querySelector('h1')).textAlign === 'center';"), '一级标题没有居中');
    await click(p, '.folio-block[data-kind=h1] h1', true); await page.keyboard.insertText(' · 标题编辑'); await synced(p);
    await page.keyboard.press('Meta+z');
    await until(() => evaluate(p, "return d.querySelector('h1').textContent === 'Folio · 编辑预览' && d.querySelector('.folio-recovery').hidden;"), '居中标题编辑与撤销');
    await page.keyboard.press('Escape');
    await click(p, '.folio-block[data-kind="p"] p', true); await page.keyboard.insertText(' 新增内容'); await synced(p);
    assert(await evaluate(p, "return d.defaultView.getComputedStyle(d.querySelector('.is-editing > .folio-block-content')).boxShadow === 'none';"), '编辑区仍有竖线');
    const paragraph = "d.querySelector('.folio-block[data-kind=p] p')";
    const historyReady = condition => until(() => evaluate(p, `return ${condition} && d.querySelector('.folio-status').hidden && d.querySelector('.folio-recovery').hidden;`), '预览直接撤销/重做');
    await page.keyboard.press('Meta+z'); await historyReady(`!${paragraph}.textContent.includes('新增内容')`);
    await page.keyboard.press('Meta+Shift+z'); await historyReady(`${paragraph}.textContent.includes('新增内容')`);
    assert(await evaluate(p, "return !!d.activeElement.closest('.is-editing');"), '撤销/重做后编辑光标丢失');
    await page.keyboard.insertText('继续输入'); await synced(p); await page.keyboard.press('Meta+z'); await historyReady(`!${paragraph}.textContent.includes('继续输入')`);
    for (const word of ['撤销甲', '撤销乙', '撤销丙']) { await page.keyboard.insertText(word); await synced(p); }
    for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+z');
    await historyReady(`!${paragraph}.textContent.includes('撤销甲') && !${paragraph}.textContent.includes('撤销乙') && !${paragraph}.textContent.includes('撤销丙')`);
    await page.keyboard.press('Escape');
    await click(p, '.folio-block[data-kind="code"] code');
    const originalCode = await evaluate(p, "return d.querySelector('.folio-source-input').value;");
    await page.keyboard.press('Meta+a'); await page.keyboard.insertText(originalCode + '\n// 撤销原始代码编辑\n'); await synced(p);
    await page.keyboard.press('Meta+z');
    await historyReady(`d.querySelector('.folio-source-input')?.value === ${JSON.stringify(originalCode)}`);
    await page.keyboard.press('Escape');
    await click(p, '.folio-block[data-kind=p] p', true); await page.keyboard.press('Enter'); await page.keyboard.insertText(round === 2 ? '、h2' : '/h2'); await menuVisible(p);
    assert.equal(await evaluate(p, "return d.querySelectorAll('.folio-menu-item').length;"), 1, '筛选不唯一');
    if (round === 1) await page.screenshot({ path: path.join(evidence, 'editing-filter.png') });
    await page.keyboard.press('Enter'); await page.keyboard.insertText('新的章节'); await synced(p); await page.keyboard.press('Escape');
    await click(p, '.folio-block[data-kind=h2] h2', true); await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+/'); await menuVisible(p); await page.keyboard.press('Escape'); await page.keyboard.insertText('/task'); await menuVisible(p); await page.keyboard.press('Enter');
    await page.keyboard.insertText('预览里写下的任务'); await synced(p);
    await click(p, '.is-editing input.task-list-item-checkbox'); await synced(p);
    assert(await evaluate(p, "return d.querySelector('.is-editing input').checked;"));
    await page.keyboard.press('Meta+z'); await historyReady("d.querySelector('.is-editing input')?.checked === false");
    await page.keyboard.press('Meta+Shift+z'); await historyReady("d.querySelector('.is-editing input')?.checked === true");
    await page.keyboard.press('Escape');
    await until(() => evaluate(p, "return !d.querySelector('.is-editing');"), '退出就地编辑');
    if (round === 1) await page.screenshot({ path: path.join(evidence, 'editing-written.png') });

    const beforeAppend = snapshot();
    await click(p, '.folio-document-end');
    const count = await evaluate(p, "return d.querySelectorAll('.folio-block').length;");
    for (let i = 0; i < 2; i++) await click(p, '.folio-document-end');
    assert.equal(await evaluate(p, "return d.querySelectorAll('.folio-block').length;"), count, '重复点击创建了多个空段落');
    assert.deepEqual(snapshot(), beforeAppend, '仅点击末尾空白处不应写入文档');
    assert(await evaluate(p, "return d.activeElement.isContentEditable && d.activeElement.closest('.folio-block')===d.querySelector('.folio-block:last-child');"));
    await page.keyboard.press('Escape');
    await evaluate(p, "d.querySelector('.folio-document-end').focus();"); await page.keyboard.press('Enter');
    await page.keyboard.insertText('末尾追加正文'); await synced(p);
    const eol = round === 2 ? '\r\n' : '\n', appended = snapshot().source;
    assert(appended.startsWith(beforeAppend.source) && appended.endsWith('末尾追加正文' + eol + eol), '末尾追加改变了原文或插入位置');
    await page.keyboard.press('Meta+z');
    await until(() => snapshot().source === beforeAppend.source, '撤销末尾追加');
    await until(() => evaluate(p, "return d.activeElement.isContentEditable && d.querySelector('.folio-block:last-child .folio-block-content').textContent==='';"), '撤销后保留末尾光标');
    await page.keyboard.press('Meta+Shift+z'); await until(() => snapshot().source === appended, '重做末尾追加');
    await until(() => evaluate(p, "return d.querySelector('.folio-block:last-child .folio-block-content').textContent.includes('末尾追加正文') && d.activeElement.isContentEditable;"), '重做末尾渲染');
    await page.keyboard.press('Meta+z'); await until(() => snapshot().source === beforeAppend.source, '再次撤销末尾追加');
    await until(() => evaluate(p, "return d.activeElement.isContentEditable && d.querySelector('.folio-block:last-child .folio-block-content').textContent==='';"), '再次撤销光标');
    await page.keyboard.insertText('撤销后末尾续写'); await synced(p);
    assert(snapshot().source.startsWith(beforeAppend.source) && snapshot().source.endsWith('撤销后末尾续写' + eol + eol));
    await page.keyboard.press('Escape'); await click(p, '.folio-document-end');
    await page.keyboard.insertText('/task'); await menuVisible(p); await page.keyboard.press('Enter');
    await page.keyboard.insertText('新增末尾任务'); await synced(p);
    assert(snapshot().source.endsWith('- [ ] 新增末尾任务' + eol + eol));
    assert(await evaluate(p, "return d.querySelector('.folio-block:last-child li').textContent.trim()==='新增末尾任务';"));
    await page.keyboard.press('Meta+s');
    await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '末尾保存');
    const originalId = p.id;
    await page.locator('.editor-group-container.active .tab.active .tab-actions .codicon-close').click();
    await action('folio.preview').click(); const reopened = await findPreview(round);
    assert.notEqual(reopened.id, originalId);
    assert(await evaluate(reopened, "return d.querySelector('.markdown-body').textContent.includes('撤销后末尾续写') && d.querySelector('.markdown-body').textContent.includes('新增末尾任务');"));
    await click(reopened, '.folio-document-end');
    assert(await evaluate(reopened, "return d.activeElement.isContentEditable && !d.querySelector('.folio-source-input');"), '重开后末尾无法输入');
    if (round === 1) await page.screenshot({path:path.join(evidence, 'document-end-editing.png')});
    await page.keyboard.press('Escape');
    result.rounds.push({
      round, status: 'passed', previewUndoRedo: true, repeatedUndo: true, caretRestored: true, rawBlockUndo: true, taskUndoRedo: true, footerRemoved: true, guideRemoved: true,
      gutterButtonRemoved: true, keyboardInsert: true, centeredHeadingEditable: true, appendEnd: true, noClickMutation: true, noDuplicateEmptyBlocks: true,
      appendUndoRedo: true, appendModule: true, appendReopened: true
    });
    fs.writeFileSync(path.join(runtime, `editing-round-${round}-done`), '');
  }
  await stage('empty'); await action('folio.preview').click(); const empty = await findPreview('empty');
  assert(await evaluate(empty, "return !d.querySelector('.folio-add-end') && d.activeElement.isContentEditable;"));
  await click(empty, '.folio-document-end'); await click(empty, '.folio-document-end');
  assert.equal(await evaluate(empty, "return d.querySelectorAll('.folio-block').length;"), 1, '空文档产生了重复输入行');
  await page.keyboard.insertText('/h1'); await menuVisible(empty); await page.keyboard.press('Enter'); await page.keyboard.insertText('空白文档可写'); await synced(empty);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+z');
  await until(() => evaluate(empty, "return d.activeElement.isContentEditable && !d.querySelector('.markdown-body').textContent.trim() && d.querySelector('.folio-recovery').hidden;"), '撤销至空白文档');
  await page.keyboard.insertText('回到空白后继续编辑'); await synced(empty);
  fs.writeFileSync(path.join(runtime, 'editing-empty-done'), '');
  await stage('external');
  await until(() => evaluate(empty, "return !d.querySelector('.folio-recovery').hidden;"), '真实外部更新保留草稿');
  await click(empty, '.folio-recovery button:last-child');
  await until(() => evaluate(empty, "return d.querySelector('.markdown-body').textContent.includes('外部修订') && d.querySelector('.folio-recovery').hidden;"), '外部更新刷新');
  fs.writeFileSync(path.join(runtime, 'editing-external-done'), '');
  await stage('readonly'); await action('folio.preview').click(); const readonly = await findPreview('readonly');
  assert(await evaluate(readonly, "return d.querySelector('.folio-document-end').hidden && !d.querySelector('[contenteditable=true]');"), '只读文档开放了末尾编辑');
  fs.writeFileSync(path.join(runtime, 'editing-readonly-done'), '');
  await stage('save-failure'); await action('folio.preview').click(); const failed = await findPreview('failure');
  await click(failed, '.folio-document-end'); await page.keyboard.insertText('保存失败草稿'); await synced(failed);
  await page.keyboard.press('Meta+s');
  await until(() => evaluate(failed, "return !d.querySelector('.folio-status').hidden && d.querySelector('.folio-status').textContent.includes('保存失败');"), '真实保存失败反馈');
  assert(await evaluate(failed, "return d.querySelector('.is-editing').textContent.includes('保存失败草稿');"));
  await page.screenshot({ path: path.join(evidence, 'editing-save-failure.png') });
  fs.writeFileSync(path.join(runtime, 'editing-save-failure-done'), '');
  await stage('complete'); result.status = 'passed';
  fs.writeFileSync(path.join(evidence, 'editing-ui-verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
