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
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9349');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  try {
    const stage = name => until(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'emoji-stage.json'))).stage === name; } catch { return false; } }, name);
    const done = name => fs.writeFileSync(path.join(runtime, `emoji-${name}-done`), '');
    const source = () => JSON.parse(fs.readFileSync(path.join(runtime, 'emoji-source.json'))).source;
    const evaluate = async (p, code) => {
      const r = await p.session.send('Runtime.evaluate', { expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${code}})()`, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value;
    };
    const preview = async (round, open = true) => {
      for (const button of await page.locator('.notifications-toasts .codicon-notifications-clear, .notifications-toasts .codicon-close:visible').all()) await button.click();
      if (open) await page.locator('.editor-group-container.active .editor-actions [data-command-id="folio.preview"] .action-label').click();
      return until(async () => {
        for (const frame of page.frames().slice(1)) {
          let session;
          try {
            session = await context.newCDPSession(frame);
            const state = (await session.send('Runtime.evaluate', {
              expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;'
                + 'return {id:new URL(location.href).searchParams.get("id"),title:d?.querySelector("h1")?.textContent,visible:d?.visibilityState,base:d?.baseURI}})()', returnByValue: true
            })).result.value;
            if (state?.title === '表情写作' && state.base.includes(`emoji-${round}.md`) && state.visible === 'visible' && await page.locator(`iframe[src*="id=${state.id}"]`).isVisible()) {
              const p = { session, id: state.id };
              await evaluate(p, `if(d.defaultView.__emojiSearchEscapes===undefined){d.defaultView.__emojiSearchEscapes=0;
                d.defaultView.addEventListener('keydown',e=>{if(e.target.matches('.folio-emoji-picker input') && (e.metaKey || e.ctrlKey)
                  && ['a','z','y'].includes(e.key.toLowerCase()))d.defaultView.__emojiSearchEscapes++;});}`);
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
    const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '表情写回');
    const closed = p => until(() => evaluate(p, "return d.querySelector('.folio-emoji-picker').hidden && d.activeElement.isContentEditable;"), '选择后恢复编辑');
    const menu = async p => {
      await page.keyboard.press('Meta+/');
      await until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '行内菜单');
      assert.deepEqual(await evaluate(p, "return Array.from(d.querySelectorAll('.folio-menu-item'),e=>e.dataset.module);"), ['link', 'file', 'emoji']);
      await click(p, '[data-module=emoji]');
      await until(() => evaluate(p, "return d.activeElement===d.querySelector('.folio-emoji-picker input');"), '表情搜索焦点');
    };
    const search = async (p, text) => {
      await click(p, '.folio-emoji-picker input'); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(text);
    };
    const mark = async (p, starts, name) => evaluate(p, `for(const e of d.querySelectorAll('p'))if(e.textContent.startsWith(${JSON.stringify(starts)}))e.dataset.emojiTarget=${JSON.stringify(name)};`);
    const selectText = async (p, selector, text, select = false) => {
      await click(p, selector);
      await evaluate(p, `const e=d.querySelector(${JSON.stringify(selector)}),w=d.createTreeWalker(e,4);let n;
        while(n=w.nextNode()){const i=n.textContent.indexOf(${JSON.stringify(text)});if(i>=0){const r=d.createRange();r.setStart(n,i);r.setEnd(n,i+${select ? text.length : 0});
        const s=d.getSelection();s.removeAllRanges();s.addRange(r);return;}}throw new Error('找不到插入位置');`);
    };
    const shot = async (p, name, waitForAnimation = true) => {
      if (waitForAnimation) await evaluate(p, 'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
      const rect = await evaluate(p, `const r=d.querySelector('.folio-emoji-picker').getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();
        return {x:r.x+f.x,y:r.y+f.y,width:r.width,height:r.height};`);
      const outer = await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox();
      await page.screenshot({path:path.join(evidence, name + '.png'),clip:{x:outer.x+rect.x,y:outer.y+rect.y,width:rect.width,height:rect.height}});
    };
    for (let round = 1; round <= 3; round++) {
      await stage(`round-${round}`); let p = await preview(round);
      await mark(p, '句首', 'inline'); await mark(p, '替换', 'replace'); await mark(p, '空行入口', 'slash');
      await selectText(p, '[data-emoji-target=inline]', '尾文'); const original = source(); await menu(p);
      assert.equal(source(), original, '打开选择框不应改动文档');
      if (round === 1) {
        await shot(p, 'emoji-all');
        await evaluate(p, `const e=d.querySelector('.folio-emoji-picker');e.style.animation='none';void e.offsetWidth;e.style.animation='';
          d.defaultView.__emojiMotion=e.getAnimations()[0];d.defaultView.__emojiMotion.pause();`);
        for (const time of [0,70,140]) {
          await evaluate(p, `d.defaultView.__emojiMotion.currentTime=${time};`); await shot(p, `emoji-motion-${time}`, false);
        }
        await evaluate(p, 'd.defaultView.__emojiMotion.finish();');
      }
      await click(p, '[data-category=food]');
      assert(await evaluate(p, "return !!d.querySelector('[data-emoji=\"☕\"]') && !d.querySelector('[data-emoji=\"😀\"]');"));
      await search(p, 'rocket');
      assert.equal(await evaluate(p, "return d.querySelector('.folio-emoji-grid').textContent;"), '🚀', '搜索应跨分类');
      if (round === 1) await shot(p, 'emoji-search');
      await search(p, 'zzznomatch'); assert(await evaluate(p, "return !d.querySelector('.folio-emoji-empty').hidden;"));
      await page.keyboard.press('Enter'); assert.equal(source(), original);
      if (round === 1) await shot(p, 'emoji-empty');
      await page.keyboard.press('Escape'); await closed(p); assert.equal(source(), original, '取消不应改动原文');
      await menu(p); await search(p, round === 2 ? 'blush' : '微笑');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await closed(p);
      await until(() => source().includes('😊尾文'), '行内插入位置'); await synced(p);
      assert.equal(await evaluate(p, 'return d.defaultView.__emojiSearchEscapes;'), 0, '搜索框快捷键泄漏到宿主');
      assert(await evaluate(p, 'return d.getSelection().isCollapsed;'), '插入后应保留折叠光标');
      await page.keyboard.insertText('继续'); await until(() => source().includes('😊继续尾文'), '插入后继续输入'); await synced(p);
      const inserted = source();
      await page.keyboard.press('Meta+z'); await until(() => !source().includes('继续') && source().includes('😊'), '撤销后续输入');
      await until(() => evaluate(p, "return !d.querySelector('.markdown-body').textContent.includes('继续') && d.activeElement.isContentEditable;"), '撤销光标');
      await page.keyboard.press('Meta+z'); await until(() => source() === original, '撤销 Emoji');
      await until(() => evaluate(p, "return !d.querySelector('.markdown-body').textContent.includes('😊') && d.activeElement.isContentEditable;"), '撤销表情渲染');
      await page.keyboard.press('Meta+Shift+z'); await until(() => source().includes('😊'), '重做表情');
      await until(() => evaluate(p, "return d.querySelector('.markdown-body').textContent.includes('😊') && d.activeElement.isContentEditable;"), '重做光标');
      await page.keyboard.press('Meta+Shift+z'); await until(() => source() === inserted, '重做正文');
      await until(() => evaluate(p, "return d.querySelector('.markdown-body').textContent.includes('😊继续尾文') && d.activeElement.isContentEditable;"), '重做正文渲染');
      await mark(p, '替换', 'replace'); await mark(p, '空行入口', 'slash');
      await selectText(p, '[data-emoji-target=replace]', '这段文字', true); await menu(p); await search(p, '红心');
      await click(p, '[data-emoji="❤️"]'); await closed(p); await until(() => source().includes('替换 ❤️ 结束'), '替换选中文字'); await synced(p);
      await menu(p); await click(p, '.folio-emoji-header button'); await closed(p);
      await click(p, '[data-emoji-target=slash]', true); await page.keyboard.press('Enter'); await page.keyboard.insertText(round === 2 ? '、表情' : '/emoji');
      await until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden && d.querySelectorAll('.folio-menu-item').length===1;"),
        '行首表情入口');
      await page.keyboard.press('Enter'); await search(p, '咖啡');
      await page.keyboard.press('Enter'); await closed(p);
      await until(() => source().includes('☕'), '行首插入'); await synced(p);
      await page.keyboard.insertText('新的段落'); await until(() => source().includes('☕新的段落'), '行首继续输入'); await synced(p);
      await click(p, 'li li .folio-task-label', true); await menu(p); await search(p, '程序员'); await page.keyboard.press('Enter'); await closed(p);
      await until(() => source().includes('子任务🧑‍💻'), '嵌套 Todo 插入'); await synced(p);
      assert(await evaluate(p, "return !!d.querySelector('li li input.task-list-item-checkbox');"));
      await click(p, 'blockquote p', true); await menu(p);
      if (round === 1) {
        await evaluate(p, "document.getElementById('active-frame').style.width='360px';d.defaultView.dispatchEvent(new d.defaultView.Event('resize')); ");
        assert(await evaluate(p, "const r=d.querySelector('.folio-emoji-picker').getBoundingClientRect();"
          + "return r.left>=0 && r.right<=d.defaultView.innerWidth && r.bottom<=d.defaultView.innerHeight;"));
        await shot(p, 'emoji-narrow');
        await evaluate(p, "document.getElementById('active-frame').style.width='';d.defaultView.dispatchEvent(new d.defaultView.Event('resize')); ");
      }
      await search(p, 'rocket'); await page.keyboard.press('Enter'); await closed(p);
      await until(() => source().includes('引用内容🚀'), '引用内插入'); await synced(p);
      const beforeCancel = source(); await menu(p); await click(p, 'h1');
      assert(await evaluate(p, "return d.querySelector('.folio-emoji-picker').hidden;")); assert.equal(source(), beforeCancel);
      await page.keyboard.press('Meta+s');
      await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '保存 Emoji'); done(`round-${round}`);
      await stage(`reopen-${round}`); p = await preview(round, false);
      assert(await evaluate(p, "return d.querySelector('.markdown-body').textContent.includes('😊继续尾文') && d.querySelector('li li').textContent.includes('🧑‍💻');"));
      done(`reopen-${round}`); result.rounds.push({round,status:'passed',inline:true,selection:true,search:true,cancel:true,undoRedo:true,list:true,reopened:true});
      if (round === 3) {
        await stage('conflict'); await mark(p, '句首', 'inline'); await selectText(p, '[data-emoji-target=inline]', '尾文'); await menu(p); done('picker-open');
        await until(() => source().includes('外部更新'), '源文件外部更新');
        await until(() => evaluate(p, "return d.querySelector('.markdown-body').textContent.includes('外部更新') && d.querySelector('.folio-emoji-picker').hidden;"), '过期选择关闭');
        done('conflict');
      }
    }
    await stage('complete'); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; await page.screenshot({path:path.join(evidence,'emoji-failure.png')}); throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'emoji-ui-verification.json'), JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
