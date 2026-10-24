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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'auto-list-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9353');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'auto-list-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `auto-list-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("table")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`auto-list-${round}.md`)
          && await page.locator(`iframe[src*="id=${value.id}"]`).isVisible()) return { session, id: value.id };
        await session.detach();
      } catch {}
    }
  }, '行首列表预览加载');
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
  const source = () => snapshot().source.replace(/\r\n/g, '\n');
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '列表写回');
  const history = async (p, key, expected) => {
    await evaluate(p, "d.__oldAutoList=d.querySelector('.is-editing');"); await page.keyboard.press(key);
    await until(() => source() === expected, '列表撤销重做');
    await until(() => evaluate(p, "return !d.__oldAutoList.isConnected && d.querySelector('.folio-recovery').hidden && d.activeElement.isContentEditable;"), '恢复列表光标');
  };
  const select = async (p, selector, mode = 'all') => {
    await click(p, selector);
    await evaluate(p, `const e=d.querySelector(${JSON.stringify(selector)}),r=d.createRange();r.selectNodeContents(e);
      ${mode === 'all' ? '' : `r.collapse(${mode === 'start'});`}const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
  };
  const locate = async (p, text) => {
    await evaluate(p, `const e=[...d.querySelectorAll('p')].find(e=>e.textContent===${JSON.stringify(text)});e.dataset.autoListTarget='true';`);
    await select(p, '[data-auto-list-target]');
    await evaluate(p, "d.querySelector('[data-auto-list-target]').removeAttribute('data-auto-list-target');");
  };
  const input = async (p, text) => { await page.keyboard.insertText(text); await synced(p); };
  const save = async p => {
    await page.keyboard.press('Meta+s'); await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '保存列表');
  };
  try {
    for (const round of ['lf', 'crlf']) {
      await stage(round); await action('folio.preview').click(); let p = await preview(round);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await locate(p, '无序位置'); await input(p, '-'); const literal = source(); assert(literal.includes('\\-'));
      await page.keyboard.press('Space'); await synced(p); const converted = source();
      assert(await evaluate(p, "const n=d.getSelection().anchorNode;return !!(n.nodeType===1?n:n.parentElement).closest('li') && !!d.querySelector('.is-editing ul');"));
      await history(p, 'Meta+z', literal);
      assert(await evaluate(p, "return d.querySelector('.is-editing p').textContent==='-' && !d.querySelector('.is-editing ul');"));
      await history(p, 'Meta+Shift+z', converted); await input(p, '自动无序第一项');
      await page.keyboard.press('Enter'); await input(p, '自动无序第二项');
      await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await input(p, '退出列表正文');
      assert(await evaluate(p, "return d.getSelection().anchorNode.parentElement.closest('p') && !d.getSelection().anchorNode.parentElement.closest('li');"));
      await page.keyboard.press('Escape');
      await locate(p, '数字位置'); await input(p, '3'); await page.keyboard.press('Space'); await synced(p);
      assert(await evaluate(p, "return d.querySelector('.is-editing ol').getAttribute('start')==='3';"));
      await input(p, '第三项'); await page.keyboard.press('Enter'); await input(p, '第四项'); await page.keyboard.press('Escape');
      for (const [label, marker, text, start] of [['句点位置', '12.', '十二项', '12'], ['零号位置', '0', '零号项', '0']]) {
        await locate(p, label); await input(p, marker); await page.keyboard.press('Space'); await synced(p);
        assert.equal(await evaluate(p, "return d.querySelector('.is-editing ol').getAttribute('start');"), start);
        await input(p, text); await page.keyboard.press('Escape');
      }
      await evaluate(p, "[...d.querySelectorAll('p')].find(e=>e.textContent.startsWith('保留 ')).dataset.autoListTarget='true';");
      await select(p, '[data-auto-list-target]', 'start'); await input(p, '-'); await page.keyboard.press('Space'); await synced(p); await input(p, '新增');
      assert(await evaluate(p, "const l=d.querySelector('.is-editing li');return l.textContent==='新增保留 粗体 和 链接' && !!l.querySelector('strong') && !!l.querySelector('a');"));
      await page.keyboard.press('Escape');
      await locate(p, '正文位置'); await input(p, '正文-'); await page.keyboard.press('Space');
      assert(await evaluate(p, "return !!d.querySelector('.is-editing p') && !d.querySelector('.is-editing ul');"));
      await input(p, '正常输入'); await page.keyboard.press('Escape');
      await select(p, 'p code', 'end'); await page.keyboard.press('Space'); await input(p, '代码');
      assert(await evaluate(p, "return !!d.querySelector('.is-editing p code') && !d.querySelector('.is-editing ul');")); await page.keyboard.press('Escape');
      for (const [selector, marker] of [['h2', '-'], ['table tbody td', '1'], ['li .folio-task-label', '-']]) {
        await select(p, selector); await input(p, marker); await page.keyboard.press('Space'); await input(p, '保持文字');
        assert(await evaluate(p, `return !d.querySelector('.is-editing .folio-block-content > ol') && !d.querySelector('.is-editing li li');`));
        await page.keyboard.press('Escape');
      }
      await click(p, '.folio-document-end'); await input(p, '-'); await page.keyboard.press('Space'); await synced(p); await input(p, '末尾自动列表');
      assert(source().endsWith('- 末尾自动列表\n\n')); await save(p); const saved = source();
      await page.keyboard.press('Meta+w'); await action('folio.preview').click(); p = await preview(round); assert.equal(source(), saved);
      assert(await evaluate(p, "return !!d.querySelector('ol[start=\"0\"]') && !!d.querySelector('ol[start=\"3\"]') && !!d.querySelector('ol[start=\"12\"]');"));
      await page.screenshot({ path: path.join(evidence, `auto-list-${round}.png`) });
      result.rounds.push({ round, status: 'passed', spaceShortcut: true, startNumber: true, undoRedo: true, formattedRemainder: true, noInlineTrigger: true, savedReopened: true }); done(round);
    }
    await stage('complete'); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; await page.screenshot({ path: path.join(evidence, 'auto-list-failure.png') }); throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'auto-list-ui-verification.json'), JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
