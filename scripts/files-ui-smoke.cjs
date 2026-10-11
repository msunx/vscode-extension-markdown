const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const until = async (predicate, label) => {
  const start = Date.now();
  while (Date.now() - start < 30000) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 70)); }
  throw new Error(`超时：${label}`);
};
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9348');
  const context = browser.contexts()[0], page = context.pages()[0], result = { checks: [] };
  try {
    const stage = name => until(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'files-stage.json'))).stage === name; } catch { return false; } }, name);
    const done = name => fs.writeFileSync(path.join(runtime, `files-${name}-done`), '');
    const source = () => JSON.parse(fs.readFileSync(path.join(runtime, 'files-source.json'))).source;
    const evaluate = async (p, code) => {
      const r = await p.session.send('Runtime.evaluate', { expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${code}})()`, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value;
    };
    const preview = async (title = '文件链接') => {
      await page.locator('.editor-group-container.active .editor-actions [data-command-id="folio.preview"] .action-label').click();
      return until(async () => {
        for (const frame of page.frames().slice(1)) {
          let session;
          try {
            session = await context.newCDPSession(frame);
            const state = (await session.send('Runtime.evaluate', {
              expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;'
                + 'return {id:new URL(location.href).searchParams.get("id"),title:d?.querySelector("h1")?.textContent,visible:d?.visibilityState}})()', returnByValue: true
            })).result.value;
            if (state?.title === title && state.visible === 'visible' && await page.locator(`iframe[src*="id=${state.id}"]`).isVisible()) {
              const p = { session, id: state.id };
              await evaluate(p, `if(d.defaultView.__folioLinkEscapeCount===undefined){d.defaultView.__folioLinkEscapeCount=0;
                for(const type of ['click','auxclick'])d.defaultView.addEventListener(type,e=>{if(e.target.closest?.('a[href]'))d.defaultView.__folioLinkEscapeCount++;});}`);
              return p;
            }
          } catch {}
          await session?.detach().catch(() => {});
        }
      }, '预览加载');
    };
    const click = async (p, selector, end = false) => {
      await evaluate(p, 'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
      await evaluate(p, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      let point, lastBounds;
      await until(async () => {
        const rect = await evaluate(p, `const r=d.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();
          return {x:r.x+Math.min(80,r.width/2)+f.x,y:r.y+r.height/2+f.y};`);
        const outer = await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox();
        if (!outer) return false;
        point = {x:outer.x+rect.x,y:outer.y+rect.y,id:p.id};
        const bounds = JSON.stringify({outer,rect}), stable = bounds === lastBounds; lastBounds = bounds;
        return stable && await page.evaluate(({x,y,id}) => document.elementFromPoint(x,y)?.getAttribute('src')?.includes(`id=${id}`), point);
      }, '点击目标完成布局且未被遮挡');
      await page.mouse.click(point.x, point.y);
      if (end) await evaluate(p, `const e=d.querySelector(${JSON.stringify(selector)}),r=d.createRange();r.selectNodeContents(e);r.collapse(false);
        const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
    };
    const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '写回完成');
    const picker = page.locator('.quick-input-widget');
    const openPicker = async (p, mouse = false) => {
      await until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden && !!d.querySelector('[data-module=file]');"), '项目文件模块');
      const index = await evaluate(p, "return Array.from(d.querySelectorAll('.folio-menu-item')).findIndex(e=>e.dataset.module==='file');");
      if (index === 0 || mouse) await click(p, '[data-module=file]');
      else { for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); }
      await picker.waitFor({ state: 'visible' });
      await until(() => picker.locator('.monaco-list-row').count(), '项目文件列表');
    };
    const select = async text => {
      await picker.locator('input[type=text]').fill(text);
      await until(async () => await picker.locator('.monaco-list-row').count() === 1, '筛选到唯一文件');
      await page.keyboard.press('Enter'); await picker.waitFor({ state: 'hidden' });
    };
    const save = async p => { await page.keyboard.press('Meta+s'); await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '保存'); };
    const inlineMenu = async p => {
      await page.keyboard.press('Meta+/');
      await until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '行内菜单');
      assert.deepEqual(await evaluate(p, "return Array.from(d.querySelectorAll('.folio-menu-item'),e=>e.dataset.module);"), ['link', 'file', 'emoji']);
    };
    const beforeText = async (p, selector, text) => {
      await click(p, selector);
      await evaluate(p, `const e=d.querySelector(${JSON.stringify(selector)}),w=d.createTreeWalker(e,4);let n;
        while(n=w.nextNode()){const i=n.textContent.indexOf(${JSON.stringify(text)});if(i>=0){const r=d.createRange();r.setStart(n,i);r.collapse(true);
          const s=d.getSelection();s.removeAllRanges();s.addRange(r);return true;}}throw new Error('找不到光标位置');`);
    };
    await stage('markdown'); let p = await preview();
    await click(p, '.folio-block[data-kind=p] p', true); await page.keyboard.press('Enter'); await page.keyboard.insertText('/');
    await until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '行首菜单');
    assert(await evaluate(p, "return !!d.querySelector('[data-module=h1]') && !!d.querySelector('[data-module=divider]');"));
    await page.keyboard.insertText('file'); await synced(p);
    const beforeCancel = source(); await openPicker(p);
    assert(!(await picker.innerText()).includes('ignored.js'), '依赖目录不应出现在选择框');
    await page.screenshot({ path: path.join(evidence, 'project-file-picker.png') });
    await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' });
    await until(() => evaluate(p, 'return d.hasFocus() && d.activeElement.isContentEditable;'), '取消后恢复编辑'); assert.equal(source(), beforeCancel);
    await page.keyboard.press('Meta+/'); await openPicker(p); await select('项目');
    await until(() => source().includes('../docs/'), '文件链接写入'); await synced(p);
    const inserted = source(); assert(inserted.includes('../docs/'));
    await page.keyboard.press('Meta+z');
    await until(async () => source() === beforeCancel && await evaluate(p, "return !d.querySelector('a[href*=\"docs/\"]') && d.activeElement.isContentEditable;"), '撤销文件链接');
    await page.keyboard.press('Meta+Shift+z');
    await until(async () => source() === inserted && await evaluate(p, "return !!d.querySelector('a[href*=\"docs/\"]') && d.activeElement.isContentEditable;"), '重做文件链接');
    await save(p); await click(p, 'a[href*="docs/"]');
    assert.equal(await evaluate(p, 'return d.defaultView.__folioLinkEscapeCount;'), 0, '链接点击冒泡到 Cursor 的外部链接处理器'); done('markdown');
    result.checks.push('原生选择框、搜索、取消、撤销重做、特殊字符链接');
    await stage('code'); p = await preview();
    await evaluate(p, "for(const e of d.querySelectorAll('p'))if(e.textContent.startsWith('代码位置'))e.dataset.fileTarget='code';");
    await beforeText(p, '[data-file-target=code]', '后文'); await inlineMenu(p); await openPicker(p, true);
    await select('src/example.js'); await until(() => source().includes('../src/example.js'), '代码链接写入');
    await synced(p); await page.keyboard.insertText('继续写'); await until(() => source().includes('继续写后文'), '链接后继续输入'); await synced(p);
    assert.equal(await evaluate(p, "return d.querySelector('a[href=\"../src/example.js\"]').textContent;"), 'example.js');
    await save(p); await click(p, 'a[href="../src/example.js"]');
    assert.equal(await evaluate(p, 'return d.defaultView.__folioLinkEscapeCount;'), 0, '代码链接触发了第二次处理'); done('code');
    result.checks.push('同名文件路径筛选、行内格式保留、代码链接跳转');
    await stage('list'); p = await preview();
    await click(p, 'li li .folio-task-label', true); await page.keyboard.press('Meta+/'); await openPicker(p);
    await select('src/example.js'); await until(() => (source().match(/\.\.\/src\/example\.js/g) || []).length === 2, 'Todo 链接写入');
    await synced(p); await save(p); done('list');
    result.checks.push('子级 Todo 保留复选框和层级');
    await stage('inline');
    await evaluate(p, "for(const e of d.querySelectorAll('p'))if(e.textContent.startsWith('行内位置'))e.dataset.fileTarget='inline';");
    await click(p, '[data-file-target=inline]', true); await page.keyboard.insertText('、正常标点/正常斜杠'); await synced(p);
    assert(await evaluate(p, "return d.querySelector('.folio-insert-menu').hidden;"), '正文标点不应弹出菜单');
    await beforeText(p, '[data-file-target=inline]', '尾文'); await inlineMenu(p); await click(p, '[data-module=link]');
    await until(() => evaluate(p, "return !!d.querySelector('.folio-resource-form');"), '行内链接表单');
    await click(p, '.folio-resource-form label:first-of-type input'); await page.keyboard.insertText('网站');
    await click(p, '.folio-resource-form label:nth-of-type(2) input'); await page.keyboard.insertText('https://example.com/guide');
    await click(p, '.folio-resource-form button[type=submit]');
    await until(() => source().includes('[网站](https://example.com/guide)'), '行内链接写入'); await synced(p);
    await page.keyboard.insertText('继续写'); await until(() => source().includes('继续写尾文'), '行内链接后正文'); await synced(p);
    assert.equal(await evaluate(p, "return d.querySelector('a[href=\"https://example.com/guide\"]').textContent;"), '网站');
    const withLink = source(); await inlineMenu(p); await click(p, '[data-module=link]');
    await click(p, '.folio-resource-form button[type=button]'); assert.equal(source(), withLink, '取消链接表单不应改动原文');
    await save(p); done('inline');
    result.checks.push('行内菜单过滤、普通标点、链接插入及取消、后续输入不延长链接、点击不冒泡到宿主');
    await stage('stale');
    await page.keyboard.press('Meta+/'); await openPicker(p); done('picker-open');
    await until(() => source().includes('外部新增'), '外部更新'); await select('src/example.js');
    await until(() => evaluate(p, "return !d.querySelector('.folio-recovery').hidden;"), '冲突保留草稿');
    await click(p, '.folio-recovery button:last-child');
    await until(() => evaluate(p, "return d.querySelector('.markdown-body').textContent.includes('外部新增') && d.querySelector('.folio-recovery').hidden;"), '恢复外部版本'); done('stale');
    await stage('outside'); p = await preview('项目外文档');
    await click(p, '.folio-block[data-kind=p] p', true); await page.keyboard.press('Enter'); await page.keyboard.insertText('、文件');
    await until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '项目外菜单'); await click(p, '[data-module=file]');
    await until(() => evaluate(p, "return !d.querySelector('.folio-status').hidden && d.querySelector('.folio-status').textContent.includes('项目');"), '项目外文档提示');
    assert.equal(await evaluate(p, 'return d.querySelectorAll(".markdown-body a").length;'), 0); done('outside');
    await stage('complete'); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'files-ui-verification.json'), JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
