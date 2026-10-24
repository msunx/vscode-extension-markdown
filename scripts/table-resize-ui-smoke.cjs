const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const until = async (predicate, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(`超时：${label}`);
};
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'table-resize-source.json')));
const stored = () => (snapshot().source.match(/<!-- folio:table-widths ([\d., ]+) -->/)?.[1] || '').split(',').filter(Boolean).map(Number);
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 2, `${label}：${actual} / ${expected}`);
const sum = widths => widths.reduce((total, value) => total + value, 0);
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9352');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'table-resize-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `table-resize-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("table")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`table-resize-${round}.md`)
          && await page.locator(`iframe[src*="id=${value.id}"]`).isVisible()) return { session, id: value.id };
        await session.detach();
      } catch {}
    }
  }, '列宽验证预览加载');
  const evaluate = async (p, code) => {
    const response = await p.session.send('Runtime.evaluate', {
      expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${code}})()`, returnByValue: true, awaitPromise: true
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const frames = p => evaluate(p, 'return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');
  const point = async (p, selector, scroll = true) => {
    if (scroll) await evaluate(p, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'});`);
    await frames(p);
    let position, previous;
    await until(async () => {
      const rect = await evaluate(p, `const e=d.querySelector(${JSON.stringify(selector)});if(!e||e.hidden)return null;
        const r=e.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
        const hit=d.elementFromPoint(x,y);if(!r.width||!r.height||!hit||!e.contains(hit))return null;
        if(document.elementFromPoint(x+f.x,y+f.y)!==document.getElementById('active-frame'))return null;return {x:x+f.x,y:y+f.y};`);
      const outer = await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox();
      if (!rect || !outer) return false;
      position = { x: outer.x + rect.x, y: outer.y + rect.y };
      const bounds = JSON.stringify(position), stable = previous === bounds; previous = bounds;
      return stable && await page.evaluate(({ x, y, id }) => document.elementFromPoint(x, y)?.getAttribute('src')?.includes(`id=${id}`), { ...position, id: p.id });
    }, `控件可见、未遮挡且完成布局：${selector}`);
    return position;
  };
  const hover = async (p, selector, scroll = true) => {
    const target = await point(p, selector, scroll); await page.mouse.move(target.x, target.y);
    await evaluate(p, 'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
    const settled = await point(p, selector, false); await page.mouse.move(settled.x, settled.y); return settled;
  };
  const click = async (p, selector) => { const target = await hover(p, selector); await page.mouse.click(target.x, target.y); await frames(p); };
  const widths = p => evaluate(p, 'return Array.from(d.querySelector("table").rows[0].cells,c=>c.getBoundingClientRect().width);');
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '列宽写回');
  const handle = index => `.folio-block[data-kind=table] [data-table-resize][data-index="${index}"]`;
  const firstTable = '.folio-block[data-kind=table]';
  const drag = async (p, index, delta, cancel = false) => {
    await hover(p, '.folio-table-shell'); const target = await hover(p, handle(index));
    const before = snapshot();
    assert.equal(await evaluate(p, `return d.defaultView.getComputedStyle(d.querySelector(${JSON.stringify(handle(index))})).cursor;`), 'col-resize');
    assert(await page.evaluate(({ x, y, id }) => document.elementFromPoint(x, y)?.getAttribute('src')?.includes(`id=${id}`),
      { x: target.x + delta, y: target.y, id: p.id }), '拖动终点必须处于预览页面内，避免跨入 Cursor 面板');
    await page.mouse.down(); await page.mouse.move(target.x + delta, target.y, { steps: 10 }); await frames(p);
    assert.deepEqual(snapshot(), before, '拖动过程中不能多次改写 Markdown');
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await frames(p);
    if (cancel) { assert.deepEqual(snapshot(), before, '取消列宽调整不写入'); return; }
    await until(() => snapshot().version > before.version, '松手后列宽写入'); await synced(p);
    assert.equal(snapshot().version, before.version + 1, '一次拖动必须只有一次文档变更');
  };
  const history = async (p, key, expected) => {
    await evaluate(p, 'd.defaultView.__folioResizeOldTable=d.querySelector("table");');
    await page.keyboard.press(key); await until(() => snapshot().source === expected, '列宽撤销重做');
    await until(() => evaluate(p, 'return !d.defaultView.__folioResizeOldTable.isConnected && d.querySelector("table")'
      + ' && d.querySelector(".folio-recovery").hidden;'), '列宽历史重新渲染');
  };
  const save = async p => {
    await page.keyboard.press('Meta+s');
    await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '保存列宽');
  };
  try {
    for (const round of ['lf', 'crlf']) {
      await stage(round); await action('folio.preview').click(); let p = await preview(round);
      await page.setViewportSize({ width: 1440, height: 900 }); await hover(p, 'table th');
      const initial = snapshot(), initialWidths = await widths(p);
      assert.equal(await evaluate(p, 'return d.querySelectorAll("table")[1].dataset.folioTableWidths || "";'), '');
      await click(p, handle(0)); assert.deepEqual(snapshot(), initial, '只点击分隔线不改写文件');
      await drag(p, 0, 60); const resized = snapshot().source, resizedWidths = stored();
      assert.equal(resizedWidths.length, 3); close(resizedWidths[0], initialWidths[0] + 60, '第一列变宽');
      close(resizedWidths[1], initialWidths[1] - 60, '相邻列变窄'); close(sum(resizedWidths), sum(initialWidths), '内部边界保持总宽');
      const rendered = await widths(p); rendered.forEach((width, index) => close(width, resizedWidths[index], '渲染宽度与保存宽度一致'));
      await history(p, 'Meta+z', initial.source); await history(p, 'Meta+Shift+z', resized);
      (await widths(p)).forEach((width, index) => close(width, resizedWidths[index], '重做恢复列宽'));
      await drag(p, 0, 45, true); (await widths(p)).forEach((width, index) => close(width, resizedWidths[index], 'Esc 恢复拖动前宽度'));
      const beforeMinimum = snapshot().source;
      await drag(p, 0, -resizedWidths[0]); close(stored()[0], 90, '最小列宽');
      await history(p, 'Meta+z', beforeMinimum);
      const beforeLast = stored(), shrink = Math.min(100, beforeLast[2] - 90), grow = Math.min(60, shrink * .6);
      assert(shrink > 0, '末列具有可缩窄空间'); await drag(p, 2, -shrink); close(stored()[2], beforeLast[2] - shrink, '末列向左拖动缩窄');
      await drag(p, 2, grow);
      const last = stored(); close(last[0], beforeLast[0], '末列拖动保留第一列'); close(last[1], beforeLast[1], '末列拖动保留第二列');
      close(last[2], beforeLast[2] - shrink + grow, '末列向右拖动加宽'); close(sum(last), sum(beforeLast) - shrink + grow, '末列拖动调整表格总宽');
      const beforeInsert = snapshot().source, beforeInsertWidths = stored();
      await click(p, `${firstTable} [data-table-insert=column][data-index="1"]`); await synced(p);
      assert.equal(stored().length, 4, '插入列同步增加列宽'); assert(stored().every(width => width >= 90));
      const inserted = stored(); [inserted[0], inserted[2], inserted[3]].forEach((width, index) => close(width, beforeInsertWidths[index], '插入列保留原有列宽'));
      await click(p, `${firstTable} [data-table-select=column][data-index="1"]`); await click(p, '.folio-table-menu button'); await synced(p);
      assert.deepEqual(stored(), beforeInsertWidths, '删除列移除对应列宽'); assert.equal(snapshot().source, beforeInsert, '增删同一列不改变原表格');
      await click(p, `${firstTable} tbody td`); const beforeTyping = snapshot().source;
      await page.keyboard.press('End'); await page.keyboard.insertText('继续编辑'); await synced(p);
      assert.deepEqual(stored(), beforeInsertWidths, '单元格编辑保留列宽'); await history(p, 'Meta+z', beforeTyping);
      await page.setViewportSize({ width: 900, height: 850 });
      await evaluate(p, 'const wrapper=d.querySelector("table").closest(".folio-table");wrapper.scrollLeft=wrapper.scrollWidth;'); await frames(p);
      const geometry = await evaluate(p, `const t=d.querySelector('table'),w=t.closest('.folio-table'),r=t.rows[0].cells[2].getBoundingClientRect();
        const b=d.querySelector(${JSON.stringify(handle(2))}),h=b.getBoundingClientRect();return {overflow:w.scrollWidth>w.clientWidth,hidden:b.hidden,boundary:r.right,handle:h.x+h.width/2};`);
      assert(geometry.overflow && !geometry.hidden, '窄视图横滚后末列拖动条可见'); close(geometry.handle, geometry.boundary, '横滚后拖动条对齐');
      await drag(p, 2, -35); const finalWidths = stored();
      assert.equal(await evaluate(p, 'return d.querySelectorAll("table")[1].dataset.folioTableWidths || "";'), '', '其他表格不受影响');
      assert(await evaluate(p, 'return !d.querySelector(".folio-source-input") && !d.querySelector(".folio-block[data-kind=html_block]");'), '隐藏列宽不会成为源码编辑块');
      await save(p); const saved = snapshot().source;
      await page.keyboard.press('Meta+w'); await action('folio.preview').click(); p = await preview(round);
      assert.equal(snapshot().source, saved);
      (await widths(p)).forEach((width, index) => close(width, finalWidths[index], '重新打开恢复列宽'));
      await page.setViewportSize({ width: 1440, height: 900 }); await hover(p, 'table th');
      await evaluate(p, `d.querySelector(${JSON.stringify(handle(0))}).focus();`);
      await page.keyboard.press('ArrowLeft'); await synced(p); close(stored()[0], finalWidths[0] - 10, '未激活编辑时键盘也可调宽');
      await history(p, 'Meta+z', saved); await save(p); await hover(p, handle(0));
      assert(await evaluate(p, `const t=d.querySelector('table'),w=t.closest('.folio-table');
        return Math.abs(w.getBoundingClientRect().width-Math.min(t.getBoundingClientRect().width+2,w.parentElement.clientWidth))<2;`), '表格外边框跟随列宽');
      await page.screenshot({ path: path.join(evidence, `table-resize-${round}.png`) });
      result.rounds.push({ round, status: 'passed', actualDrag: true, cancel: true, singleWrite: true, undoRedo: true, columns: true, horizontalScroll: true, savedReopened: true }); done(round);
    }
    await stage('readonly'); await action('folio.preview').click(); const p = await preview('readonly');
    assert.equal(await evaluate(p, 'return d.querySelectorAll("[data-table-resize]").length;'), 0, '只读文档禁止调整列宽');
    const readonly = await widths(p); close(readonly[0], 160, '只读文档恢复第一列宽'); close(readonly[1], 240, '只读文档恢复第二列宽'); done('readonly');
    await stage('complete'); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; await page.screenshot({ path: path.join(evidence, 'table-resize-failure.png') }); throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'table-resize-ui-verification.json'), JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
