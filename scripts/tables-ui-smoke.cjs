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
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9350');
  const context = browser.contexts()[0], page = context.pages()[0];
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const stage = name => until(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'tables-stage.json'))).stage === name; } catch { return false; } }, name);
  const findPreview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const state = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,title:d?.querySelector("h1")?.textContent,base:d?.baseURI,ready:!!d?.querySelector(".folio-block-content")}})()', returnByValue: true
        })).result.value;
        if ((round === 'empty' || round === 'readonly' || state?.title === '表格编辑') && state.ready
          && state.base?.includes(`tables-${round}.md`)
          && state.visible === 'visible' && await page.locator(`iframe[src*="id=${state.id}"]`).isVisible()) return { session, id: state.id };
        await session.detach();
      } catch {}
    }
  }, '编辑预览加载');
  const evaluate = async (preview, code) => {
    const r = await preview.session.send('Runtime.evaluate', {
      expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${code}})()`, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description);
    return r.result.value;
  };
  const click = async (preview, selector, caret = false) => {
    await evaluate(preview, 'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
    await evaluate(preview, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    let point, lastBounds;
    await until(async () => {
      const rect = await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();
        return {x:r.x+Math.min(80,r.width/2)+f.x,y:r.y+r.height/2+f.y};`);
      if (!rect) return false;
      const outer = await page.locator(`iframe[src*="id=${preview.id}"]`).boundingBox();
      if (!outer) return false;
      point = {x:outer.x+rect.x,y:outer.y+rect.y,id:preview.id};
      const bounds = JSON.stringify({outer,rect}), stable = bounds === lastBounds; lastBounds = bounds;
      return stable && await page.evaluate(({x,y,id}) => document.elementFromPoint(x,y)?.getAttribute('src')?.includes(`id=${id}`), point);
    }, '点击目标完成布局且未被遮挡');
    await page.mouse.click(point.x, point.y);
    if (caret) await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)}),r=d.createRange();r.selectNodeContents(e);r.collapse(false);
      const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
  };
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '编辑写回');
  const menuVisible = p => until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '模块菜单');
  const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'tables-source.json')));
  const result = { rounds: [], checks: [] };
  const done = name => fs.writeFileSync(path.join(runtime, `tables-${name}-done`), '');
  const source = () => snapshot().source;
  const hover = async (p, selector) => {
    await evaluate(p, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    const point = await evaluate(p, `const r=d.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();
      return {x:r.x+r.width/2+f.x,y:r.y+r.height/2+f.y};`);
    const outer = await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox(); await page.mouse.move(outer.x + point.x, outer.y + point.y);
    await evaluate(p, 'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
  };
  const first = '.folio-block[data-kind=table]';
  const small = `${first} ~ ${first} table`;
  const td = (r, c) => `${first} tbody tr:nth-child(${r}) td:nth-child(${c})`;
  const count = p => evaluate(p, `const t=d.querySelector('table');return [t.rows.length,t.rows[0].cells.length];`);
  const setText = async (p, selector, text) => { await click(p, selector); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(text); await synced(p); };
  const operation = async (p, action) => {
    const [axis, verb] = action.split('-');
    const index = await evaluate(p, `const c=d.querySelector('.is-selected-cell');return ${axis == 'row' ? 'c.parentElement.rowIndex' : 'c.cellIndex'};`);
    if (verb === 'delete') {
      await click(p, `.is-editing [data-table-select=${axis}][data-index="${index}"]`);
      await click(p, '.folio-table-menu button');
    } else await click(p, `.is-editing [data-table-insert=${axis}][data-index="${index + (verb === 'after' ? 1 : 0)}"]`);
    await synced(p);
  };
  const history = async (p, key, expected) => {
    await page.keyboard.press(key); await until(() => source() === expected, '撤销重做写回');
    await until(() => evaluate(p, "return d.querySelector('.folio-recovery').hidden && !d.querySelector('.folio-source-input') && !!d.activeElement.closest('td,th');"), '恢复单元格光标');
  };
  const save = async p => { await page.keyboard.press('Meta+s'); await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '保存'); };
  try {
    for (let round = 1; round <= 3; round++) {
      await stage(`round-${round}`); await action('folio.preview').click(); let p = await findPreview(round);
      const initial = snapshot();
      await hover(p, 'h1');
      await until(() => evaluate(p, "return d.defaultView.getComputedStyle(d.querySelector('.folio-table-controls')).opacity==='0';"), '离开表格隐藏控制条');
      const beforeHover = await evaluate(p, "return d.querySelector('table').getBoundingClientRect().height;");
      await hover(p, 'table th');
      await until(() => evaluate(p, "return d.defaultView.getComputedStyle(d.querySelector('.folio-table-controls')).opacity==='1';"), '悬停显示边框');
      assert.equal(await evaluate(p, "return d.querySelector('table').getBoundingClientRect().height;"), beforeHover, '悬停不应改变表格尺寸');
      assert(await evaluate(p, "return !d.querySelector('.folio-table-tools');"));
      await hover(p, '[data-table-insert=column][data-index="1"]');
      assert(await evaluate(p, "return !d.querySelector('.folio-table-guide').hidden && d.querySelector('.folio-table-guide').dataset.axis==='column';"));
      if (round === 1) await page.screenshot({ path: path.join(evidence, 'table-insert-column.png') });
      await click(p, '[data-table-select=row][data-index="1"]');
      assert.equal(await evaluate(p, "return d.querySelectorAll('table .is-selected-axis').length;"), 3);
      if (round === 1) await page.screenshot({ path: path.join(evidence, 'table-select-row.png') });
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      assert.equal(source(), initial.source, '悬停和选中不应改写文档');
      await hover(p, 'table th'); await click(p, '[data-table-insert=column][data-index="3"]'); await synced(p);
      assert.deepEqual(await count(p), [4, 4]); await history(p, 'Meta+z', initial.source); await page.keyboard.press('Escape');
      const before = snapshot(); await click(p, td(1, 1));
      assert(await evaluate(p, "return !d.querySelector('.folio-source-input') && d.activeElement.matches('td') && d.activeElement.isContentEditable;"));
      await page.keyboard.press('Escape'); assert.deepEqual(snapshot(), before, '只点击单元格不应改写源文件');
      await setText(p, td(1, 1), '第一项编辑 | 路径\\|值');
      const edited = source(); assert(edited.includes('第一项编辑 \\| 路径\\\\\\|值'));
      await history(p, 'Meta+z', before.source); await history(p, 'Meta+Shift+z', edited);
      assert(source().includes('**保留粗体**') && source().includes('`a\\|b` 和 [说明][guide]'));
      await operation(p, 'row-before'); assert.deepEqual(await count(p), [5, 3]);
      await page.keyboard.insertText('新增上行'); await synced(p);
      await operation(p, 'row-after'); await page.keyboard.insertText('新增下行'); await synced(p);
      const beforeDelete = source(); await operation(p, 'row-delete'); const deleted = source();
      await history(p, 'Meta+z', beforeDelete); await history(p, 'Meta+Shift+z', deleted);
      await operation(p, 'column-before'); assert.deepEqual(await count(p), [5, 4]);
      await page.keyboard.insertText('新增左列'); await synced(p);
      await operation(p, 'column-after'); assert.deepEqual(await count(p), [5, 5]);
      await page.keyboard.insertText('新增右列'); await synced(p);
      const beforeColumnDelete = source(); await operation(p, 'column-delete');
      await history(p, 'Meta+z', beforeColumnDelete); await operation(p, 'column-delete');
      await click(p, 'table th'); await operation(p, 'column-delete'); assert.deepEqual(await count(p), [5, 3]);
      assert(await evaluate(p, "return d.querySelector('table th:last-child').style.textAlign==='right';"));
      await click(p, '.is-editing [data-table-select=row][data-index=\"0\"]');
      assert(await evaluate(p, "return d.querySelector('.folio-table-menu button').disabled;")); await click(p, 'table th');
      const beforeKeyboardRow = source(); await page.keyboard.press('Shift+Tab');
      assert(await evaluate(p, "return d.activeElement.matches('[data-table-insert=row]');"));
      await page.keyboard.press('Enter'); await synced(p); assert.deepEqual(await count(p), [6, 3]);
      await history(p, 'Meta+z', beforeKeyboardRow);
      await click(p, `${first} tbody tr:last-child td:last-child`, true); await page.keyboard.press('Tab'); await synced(p);
      assert.deepEqual(await count(p), [6, 3]); await page.keyboard.insertText('Tab 新行'); await synced(p);
      await page.keyboard.press('Tab'); await page.keyboard.insertText('单元格换行'); await synced(p); await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('第二行'); await synced(p);
      assert(source().includes('单元格换行<br>第二行'));
      await page.keyboard.press('Shift+Tab'); assert.equal(await evaluate(p, 'return d.activeElement.cellIndex;'), 0);
      await page.keyboard.press('Enter'); await synced(p); assert.deepEqual(await count(p), [7, 3]);
      await page.keyboard.insertText('Enter 新行'); await synced(p);
      if (round === 1) {
        await page.screenshot({ path: path.join(evidence, 'table-editing.png') });
        await page.setViewportSize({ width: 1000, height: 860 });
        await click(p, '.is-editing td.is-selected-cell');
        assert(await evaluate(p, `const controls=d.querySelector('.is-editing .folio-table-controls');
          return [...controls.querySelectorAll('button:not([hidden])')].every(b=>{const q=b.getBoundingClientRect();return q.left>=-1 && q.right<=d.defaultView.innerWidth;});`), '窄窗口工具栏溢出');
        await page.screenshot({ path: path.join(evidence, 'table-narrow.png') }); await page.setViewportSize({ width: 1280, height: 800 });
        await evaluate(p, "const t=d.querySelector('table'),w=t.closest('.folio-table');t.style.minWidth='1000px';w.scrollLeft=w.scrollWidth;return new Promise(r=>requestAnimationFrame(r));");
        await hover(p, '.is-editing [data-table-insert=column][data-index="3"]');
        assert(await evaluate(p, `const t=d.querySelector('table'),w=t.closest('.folio-table').getBoundingClientRect(),b=d.querySelector('.is-editing [data-table-insert=column][data-index="3"]');
          const r=b.getBoundingClientRect();return !b.hidden && Math.abs(r.x+r.width/2-w.right)<3;`), '滚动后末列插入点应对齐右边界');
        await page.screenshot({ path: path.join(evidence, 'table-horizontal.png') });
        const beforeScrolledInsert = source();
        await click(p, '.is-editing [data-table-insert=column][data-index="3"]'); await synced(p); assert.deepEqual(await count(p), [7, 4]);
        await history(p, 'Meta+z', beforeScrolledInsert);
      }
      await page.keyboard.press('Escape');
      await click(p, `${small} td`); await operation(p, 'row-delete');
      assert.equal(await evaluate(p, `return d.querySelector(${JSON.stringify(small)}).rows.length;`), 1);
      await click(p, '.is-editing [data-table-select=column][data-index=\"0\"]');
      assert(await evaluate(p, "return d.querySelector('.folio-table-menu button').disabled;")); await click(p, `${small} th`);
      await operation(p, 'row-after'); await page.keyboard.insertText('空表继续写'); await synced(p);
      await page.keyboard.press('Escape'); await click(p, '.folio-document-end'); await page.keyboard.insertText('/table'); await menuVisible(p); await page.keyboard.press('Enter');
      assert(await evaluate(p, "return !d.querySelector('.folio-source-input') && d.activeElement.matches('td');"));
      await page.keyboard.insertText('新增表格内容'); await synced(p);
      await page.keyboard.press('Meta+/'); await menuVisible(p);
      assert.deepEqual(await evaluate(p, "return Array.from(d.querySelectorAll('.folio-menu-item'),e=>e.dataset.module);"), ['link', 'file', 'emoji']);
      await click(p, '[data-module=emoji]');
      await until(() => evaluate(p, "return !d.querySelector('.folio-emoji-picker').hidden;"), '表格内 Emoji');
      await click(p, '[data-emoji="😀"]'); await synced(p);
      assert(await evaluate(p, 'return d.activeElement.isContentEditable;'), '插入后应回到单元格');
      await page.keyboard.insertText('继续输入'); await synced(p);
      assert(source().includes('新增表格内容😀继续输入'));
      await save(p);
      const saved = source(); await page.keyboard.press('Meta+w');
      await action('folio.preview').click(); p = await findPreview(round);
      assert.equal(source(), saved); assert(await evaluate(p, "return d.querySelectorAll('table').length===3 && d.querySelector('table').textContent.includes('路径\\\\|值');"));
      await click(p, 'table tbody tr:last-child td:last-child'); await page.keyboard.insertText('重开继续写'); await synced(p); await save(p);
      await page.keyboard.press('Escape');
      result.rounds.push({ round, status: 'passed', cells: true, rowsColumns: true, undoRedo: true, saveReopen: true }); done(`round-${round}`);
    }
    await stage('external-ready'); let p = await findPreview(3); await setText(p, td(1, 1), '外部冲突前的草稿'); done('external-ready');
    await stage('external'); await until(() => evaluate(p, "return !d.querySelector('.folio-recovery').hidden;"), '外部冲突提示');
    const conflictSource = source(); await click(p, '.is-editing [data-table-insert=row][data-index=\"1\"]'); assert.equal(source(), conflictSource);
    await click(p, '.folio-recovery button:last-child');
    await until(() => evaluate(p, "return d.querySelector('.folio-recovery').hidden && d.body.textContent.includes('外部修订');"), '载入外部内容'); done('external');
    await stage('readonly'); await action('folio.preview').click(); p = await findPreview('readonly');
    await click(p, 'table td');
    assert(await evaluate(p, "return !d.querySelector('.folio-table-controls') && !d.querySelector('[contenteditable=true]') && !d.querySelector('.folio-source-input');")); done('readonly');
    await stage('failure'); await action('folio.preview').click(); p = await findPreview('failure'); await setText(p, 'table td', '失败草稿');
    await page.keyboard.press('Meta+s'); await until(() => evaluate(p, "return !d.querySelector('.folio-status').hidden;"), '保存失败提示');
    assert(await evaluate(p, "return d.querySelector('table td').textContent==='失败草稿' && d.activeElement.isContentEditable;"));
    await page.screenshot({ path: path.join(evidence, 'table-save-failure.png') }); done('failure');
    await stage('complete'); result.checks.push('只读、冲突拒绝行列操作、保存失败保留单元格输入'); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; await page.screenshot({ path: path.join(evidence, 'table-failure.png') }); throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'tables-ui-verification.json'), JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
