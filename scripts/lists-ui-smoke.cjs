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
  const stage = name => until(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'lists-stage.json'))).round === name; } catch { return false; } }, name);
  const findPreview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const state = (await session.send('Runtime.evaluate', { expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),visible:d?.visibilityState,title:d?.querySelector("h1")?.textContent,base:d?.baseURI,ready:!!d?.querySelector(".folio-block-content")}})()', returnByValue: true })).result.value;
        if ((round === 'empty' || state?.title === 'Folio · 列表编辑') && state.ready && state.base?.includes(round === 'failure' ? 'save.md' : `lists-${round}.md`) && state.visible === 'visible' && await page.locator(`iframe[src*="id=${state.id}"]`).isVisible()) return { session, id: state.id };
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
    await evaluate(preview, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    const rect = await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();return {x:r.x+Math.min(15,r.width/2)+f.x,y:r.y+r.height/2+f.y};`);
    const outer = await page.locator(`iframe[src*="id=${preview.id}"]`).boundingBox();
    await page.mouse.click(outer.x + rect.x, outer.y + rect.y);
    if (caret) await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)}),r=d.createRange();r.selectNodeContents(e);r.collapse(false);const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
  };
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '编辑写回');
  const menuVisible = p => until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '模块菜单');
  const source = () => JSON.parse(fs.readFileSync(path.join(runtime, 'lists-source.json'))).source.replace(/\r\n/g, '\n');
  const result = { rounds: [] };
  for (let round = 1; round <= 3; round++) {
    await stage(round); await action('folio.preview').click(); const p = await findPreview(round);
    const locate = label => evaluate(p, `for(const e of d.querySelectorAll('li')){const own=Array.from(e.childNodes).filter(n=>!['UL','OL'].includes(n.nodeName)).map(n=>n.textContent).join('').trim();if(own.startsWith(${JSON.stringify(label)})){e.dataset.listTarget='${label}';return true;}}return false;`);
    const target = label => `[data-list-target="${label}"]`;
    const choose = async label => {
      assert(await locate(label), `找不到列表项 ${label}`);
      await click(p, target(label));
      await evaluate(p, `const e=d.querySelector(${JSON.stringify(target(label))});const w=d.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.textContent.trim()){const r=d.createRange();r.setStart(n,n.textContent.trimEnd().length);r.collapse(true);d.getSelection().removeAllRanges();d.getSelection().addRange(r);break;}}return true;`);
    };
    const depth = label => evaluate(p, `const e=d.querySelector(${JSON.stringify(target(label))});let n=e,count=0;while(n=n.parentElement)if(['UL','OL'].includes(n.tagName))count++;return count;`);
    const key = async name => { await page.keyboard.press(name); await synced(p); };
    const changed = async (name, predicate) => {
      const history = name.includes('Meta');
      if (history) await evaluate(p, "d.querySelector('.folio-block').dataset.listHistoryStamp='pending';return true;");
      await page.keyboard.press(name); await until(() => predicate(source()), name + ' 源码回写');
      if (history) await until(() => evaluate(p, "return !d.querySelector('[data-list-history-stamp]') && d.activeElement.isContentEditable;"), '历史已渲染');
      else await synced(p);
    };
    const leave = async () => { await page.keyboard.press('Escape'); await until(() => evaluate(p, "return !d.querySelector('.is-editing') && d.querySelector('.folio-editor-feedback').textContent === '';"), '退出并刷新'); };
    await choose('子项');
    await changed('Tab', s => s.includes('- 父项\n  - 子项 **重点**\n    - 已有子项'));
    assert.equal(await depth('子项'), 2); assert(await evaluate(p, "return d.activeElement.isContentEditable;"));
    await key('Shift+Tab'); assert.equal(await depth('子项'), 1);
    await changed('Tab', s => s.includes('- 父项\n  - 子项'));
    await changed('Meta+z', s => s.includes('- 父项\n- 子项'));
    await until(() => evaluate(p, "return !d.querySelector('[data-list-target]') && d.activeElement.isContentEditable && d.querySelector('.folio-recovery').hidden;"), '撤销后编辑状态');
    await page.keyboard.insertText('续写'); await synced(p);
    assert(source().includes('子项续写 **重点**'), '撤销后光标未留在原列表项');
    await changed('Meta+z', s => !s.includes('续写'));
    await changed('Meta+z', s => s.includes('- 父项\n  - 子项'));
    await changed('Meta+Shift+z', s => s.includes('- 父项\n- 子项'));
    await leave();
    await choose('父项'); const unchanged = source(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    assert.equal(source(), unchanged); assert(await evaluate(p, "return d.activeElement.isContentEditable;"));
    await leave();

    await choose('计划乙'); await changed('Tab', s => s.includes('7. 计划甲\n   1. 计划乙\n8. 计划丙\n9. 计划丁'));
    assert.equal(await depth('计划乙'), 2); await key('Shift+Tab');
    assert(source().includes('7. 计划甲\n8. 计划乙\n9. 计划丙\n10. 计划丁'));
    await leave();

    await choose('混合乙'); await changed('Shift+Tab', s => s.includes('- 混合乙\n  1. 混合丙'));
    assert.equal(await depth('混合乙'), 1); assert.equal(await locate('混合丙'), true); assert.equal(await depth('混合丙'), 2);
    await changed('Meta+z', s => s.includes('2. 混合乙')); await leave();

    await choose('任务乙'); await changed('Tab', s => s.includes('- [ ] 任务甲\n  - [x] 任务乙\n    - [ ] 任务子项'));
    assert.equal(await depth('任务乙'), 2); assert(await evaluate(p, `return d.querySelector(${JSON.stringify(target('任务乙'))}).querySelector('input').checked;`));
    await key('Shift+Tab');
    const beforeFocusNavigation = source();
    await evaluate(p, `d.querySelector(${JSON.stringify(target('任务乙'))}).querySelector('input').focus();return true;`);
    await page.keyboard.press('Tab');
    assert(await evaluate(p, `return d.activeElement !== d.querySelector(${JSON.stringify(target('任务乙'))}).querySelector('input');`), '复选框 Tab 焦点导航被拦截');
    assert.equal(source(), beforeFocusNavigation); await leave();

    await choose('选区甲'); assert(await locate('选区乙'));
    await evaluate(p, `const a=d.querySelector(${JSON.stringify(target('选区甲'))}).firstChild,b=d.querySelector(${JSON.stringify(target('选区乙'))}).firstChild;d.getSelection().setBaseAndExtent(b,b.textContent.length,a,0);return true;`);
    await changed('Tab', s => s.includes('- 选区父项\n  - 选区甲\n  - 选区乙\n- 选区丙'));
    assert.equal(await depth('选区甲'), 2); assert.equal(await depth('选区乙'), 2);
    await key('Shift+Tab'); assert.equal(await depth('选区乙'), 1); await leave();

    await choose('选区乙'); await changed('Tab', s => s.includes('- 选区甲\n  - 选区乙'));
    await page.keyboard.press('Enter'); await page.keyboard.insertText('回车新项'); await synced(p);
    assert(source().includes('  - 回车新项'), '回车未延续列表层级');
    await page.keyboard.press('Shift+Tab'); await synced(p);
    assert(source().includes('\n- 回车新项'), '新项退级失败'); await leave();
    await action('folio.edit').click(); await action('folio.preview').click();
    const restored = await findPreview(round);
    assert(await evaluate(restored, "return d.querySelector('.markdown-body').textContent.includes('回车新项') && d.querySelectorAll('li ul, li ol').length >= 3;"));
    await page.screenshot({ path: path.join(evidence, `lists-round-${round}.png`) });
    result.rounds.push({ round, status: 'passed', indentOutdent: true, mixedLists: true, preservesSubtrees: true, orderedStart: true, tasks: true, rangeSelection: true, boundaryNoop: true, checkboxFocusNavigation: true, undoRedoCaret: true, enterContinuesLevel: true, reopen: true });
    fs.writeFileSync(path.join(runtime, `lists-${round}-done`), '');
  }
  await stage('complete'); result.status = 'passed';
  fs.writeFileSync(path.join(evidence, 'lists-ui-verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
