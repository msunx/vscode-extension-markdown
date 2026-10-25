const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime');
const evidence = path.join(root, 'design/outline-update');
const until = async (predicate, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(`超时：${label}`);
};
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'outline-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9364');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'outline-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `outline-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector(".folio-outline")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`outline-${round}.md`)
          && await page.locator(`iframe[src*="id=${value.id}"]`).isVisible()) return { session, id: value.id };
        await session.detach();
      } catch {}
    }
  }, '任务状态预览加载');
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
        if(r.top<0||r.bottom>d.defaultView.innerHeight){e.scrollIntoView({block:'center'});return null;}const hit=d.elementFromPoint(x,y);if(!r.width||!r.height||!hit||!e.contains(hit))return null;
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
    await evaluate(p, 'return Promise.allSettled(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished));');
    const settled = await point(p, selector, false); await page.mouse.move(settled.x, settled.y); return settled;
  };
  const click = async (p, selector) => { const target = await hover(p, selector); await page.mouse.click(target.x, target.y); await frames(p); };
  const source=()=>snapshot().source.replace(/\r\n/g,'\n');
  const saved=async p=>{await page.keyboard.press('Meta+s');await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已保存';"),'保存');};
  const heading = async (p, text, part = '', occurrence = 0) => {
    await evaluate(p, `d.querySelectorAll('[data-outline-test]').forEach(e=>e.removeAttribute('data-outline-test'));
      const h=[...d.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6)')].filter(e=>e.textContent===${JSON.stringify(text)})[${occurrence}];
      if(!h)throw new Error('找不到标题');h.closest('.folio-block').dataset.outlineTest='target';`);
    return '[data-outline-test=target]' + (part || ' :is(h1,h2,h3,h4,h5,h6)');
  };
  const row = async (p, text, part = '.folio-outline-link', occurrence = 0) => {
    await evaluate(p, `d.querySelectorAll('[data-row-test]').forEach(e=>e.removeAttribute('data-row-test'));
      const r=[...d.querySelectorAll('.folio-outline-row')].filter(e=>e.querySelector('.folio-outline-text').textContent===${JSON.stringify(text)})[${occurrence}];
      if(!r)throw new Error('找不到目录');r.dataset.rowTest='target';`);
    return '[data-row-test=target] ' + part;
  };
  const visible = (p, text) => evaluate(p, `const e=[...d.querySelectorAll('main p,main h1,main h2,main h3')].find(e=>e.textContent===${JSON.stringify(text)});return !!e&&!!e.getClientRects().length;`);
  const folded = (p, text) => evaluate(p, `const h=[...d.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6)')].find(e=>e.textContent===${JSON.stringify(text)});return h?.closest('.folio-block').classList.contains('folio-heading-collapsed');`);
  const fold = async (p, text, occurrence = 0) => { console.log('fold', text); await click(p, await heading(p, text, ' > .folio-heading-fold', occurrence)); await until(()=>evaluate(p,"return d.querySelector('.folio-outline').getAttribute('aria-busy')==='false';"),'章节操作完成'); };
  const jump = async (p, text, occurrence = 0) => { console.log('jump', text); if (await evaluate(p,"return d.querySelector('.folio-outline').hidden;")) await click(p,'.folio-outline-toggle'); await click(p, await row(p,text,'.folio-outline-link',occurrence)); await until(()=>evaluate(p,"return d.querySelector('.folio-outline').getAttribute('aria-busy')==='false';"),'目录跳转完成'); };
  const shot = async (p, name) => { await evaluate(p,'return Promise.allSettled(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished));'); await page.screenshot({path:path.join(evidence,name)}); };
  const reopen = async (p, round) => { await page.keyboard.press('Escape'); await page.keyboard.press('Meta+w'); await action('folio.preview').click(); return preview(round); };
  const expand = async p => {
    if(await evaluate(p,"return d.querySelector('.folio-outline').hidden;")) await click(p,'.folio-outline-toggle');
    while(await evaluate(p,"return [...d.querySelectorAll('.folio-heading-fold[aria-expanded=false]')].some(e=>e.getClientRects().length);")) {
      const text=await evaluate(p,"return [...d.querySelectorAll('.folio-heading-fold[aria-expanded=false]')].find(e=>e.getClientRects().length).parentElement.querySelector('h1,h2,h3,h4,h5,h6').textContent;");
      await fold(p,text);
    }
  };
  const collapse = async p => { for(const text of ['星光手记','附录']) if(!await folded(p,text)) await fold(p,text); };
  try {
    for (const round of ['1','2','3']) {
      await stage(round); await page.setViewportSize({width:1800,height:1000}); await action('folio.preview').click(); let p = await preview(round);
      while(await page.locator('.notifications-toasts .codicon-notifications-clear:visible, .notifications-toasts .codicon-close:visible').count())await page.locator('.notifications-toasts .codicon-notifications-clear:visible, .notifications-toasts .codicon-close:visible').first().click();await expand(p); const original=source(), version=snapshot().version;
      assert(await evaluate(p,"const nav=d.querySelector('.folio-outline'),css=d.defaultView.getComputedStyle(nav);return !d.querySelector('.folio-outline-header,.folio-outline-all,.folio-outline-close')&&css.borderTopWidth==='0px'&&css.boxShadow==='none'&&[...nav.querySelectorAll('button')].every(e=>e.matches('.folio-outline-link,.folio-outline-fold'));"));
      await click(p,'.folio-outline-toggle'); assert(await evaluate(p,"return d.querySelector('.folio-outline').hidden&&d.querySelector('.folio-outline-toggle').getAttribute('aria-label')==='显示目录';"));
      await click(p,'.folio-outline-toggle'); assert(await evaluate(p,"return !d.querySelector('.folio-outline').hidden&&d.querySelector('.folio-outline-toggle').getAttribute('aria-label')==='隐藏目录';"));
      assert(await evaluate(p,"return d.body.classList.contains('folio-outline-pinned')&&d.querySelectorAll('.folio-outline-row').length===12;"));
      assert(await evaluate(p,"const list=d.querySelector('.folio-outline-list'),s=d.defaultView.getComputedStyle(list),bar=d.defaultView.getComputedStyle(list,'::-webkit-scrollbar');return s.scrollbarWidth==='none'&&bar.display==='none';"));
      await click(p,await row(p,'准备','.folio-outline-fold'));await until(()=>evaluate(p,"return [...d.querySelectorAll('.folio-outline-row')].find(e=>e.textContent==='灵感').inert;"),'子目录收起');
      assert(await visible(p,'灵感'));assert.equal(source(),original);assert.equal(snapshot().version,version);
      p=await reopen(p,round);assert(await evaluate(p,"return [...d.querySelectorAll('.folio-outline-row')].find(e=>e.textContent==='灵感').inert;"));await click(p,'.folio-outline-toggle');
      await click(p,await row(p,'准备','.folio-outline-fold'));await click(p,await row(p,'灵感','.folio-outline-fold'));await click(p,await row(p,'准备','.folio-outline-fold'));await click(p,await row(p,'准备','.folio-outline-fold'));
      assert(await evaluate(p,"return [...d.querySelectorAll('.folio-outline-row')].find(e=>e.textContent==='草图').inert;"));await click(p,await row(p,'灵感','.folio-outline-fold'));
      await page.setViewportSize({width:1500,height:1000});await frames(p);assert(await evaluate(p,"const nav=d.querySelector('.folio-outline').getBoundingClientRect(),body=d.querySelector('main').getBoundingClientRect();return d.body.classList.contains('folio-outline-pinned')&&body.left-30>nav.right;"));if(round==='1')await shot(p,'outline-intermediate-width.png');await page.setViewportSize({width:1800,height:1000});await frames(p);
      const long='一段较长的中文标题，用来说明在有限的目录宽度中如何保持清楚的阅读层级和定位';const longRow=await row(p,long);
      assert(await evaluate(p,"const e=d.querySelector('[data-row-test] .folio-outline-text'),s=d.defaultView.getComputedStyle(e);return s.whiteSpace==='nowrap'&&s.textOverflow==='ellipsis'&&!e.closest('button').hasAttribute('title')&&e.scrollWidth>e.clientWidth;"));
      const beforeWidth=await evaluate(p,"return d.querySelector('[data-row-test]').getBoundingClientRect().width;");await hover(p,longRow);
      assert(await evaluate(p,`const r=d.querySelector('[data-row-test]');return r.getBoundingClientRect().width>${beforeWidth}+10&&r.getBoundingClientRect().right<=d.defaultView.innerWidth;`));
      if(round==='1')await shot(p,'outline-title-expanded.png');await page.mouse.move(1300,60);await frames(p);
      if(round==='1') await shot(p,'outline-wide.png');
      await fold(p,'灵感'); assert(!await visible(p,'灵感内容：记录值得继续探索的细节。')); assert(await visible(p,'制作'));
      await fold(p,'准备'); assert(!await visible(p,'灵感')); await fold(p,'准备'); assert(await folded(p,'灵感')); assert(await visible(p,'准备内容：先留下想法，再整理顺序。'));
      await fold(p,'星光手记'); assert(!await visible(p,'收尾')); assert(await visible(p,'附录')); assert.equal(source(),original); assert.equal(snapshot().version,version);
      await jump(p,'素材'); assert(!await folded(p,'星光手记')&&!await folded(p,'灵感')); assert(await visible(p,'素材内容保持完整。'));
      assert.equal(await evaluate(p,"return d.querySelector('.folio-outline-link[aria-current=location]').textContent;"),'素材');
      await fold(p,'记录',0); assert(!await visible(p,'第一份记录。')); assert(await visible(p,'第二份记录。'));
      p=await reopen(p,round); assert(!await visible(p,'第一份记录。')); assert(await visible(p,'第二份记录。')); assert.equal(source(),original);
      await expand(p); await jump(p,'准备');
      await evaluate(p,"const e=[...d.querySelectorAll('main p')].find(e=>e.textContent.startsWith('准备内容'));e.dataset.paragraphTest='true';");
      await click(p,'[data-paragraph-test]'); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.insertText('追加文字'); await fold(p,'准备');
      await until(()=>source().includes('追加文字'),'编辑同步'); assert(await folded(p,'准备')); await fold(p,'准备');
      await saved(p); const edited=source(); assert(edited.includes('准备内容：先留下想法，再整理顺序。追加文字'));
      await page.keyboard.press('Meta+z'); await until(()=>source()===original,'折叠不占用撤销记录');
      await page.keyboard.press('Meta+Shift+z'); await until(()=>source()===edited,'重做恢复正文'); await saved(p);
      await jump(p,'收尾'); await click(p,await heading(p,'收尾')); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.insertText('记录');
      await until(()=>evaluate(p,"return [...d.querySelectorAll('.folio-outline-text')].some(e=>e.textContent==='收尾记录');"),'标题改名实时更新');await fold(p,'收尾记录'); await until(()=>source().includes('## 收尾记录'),'标题同步'); assert(await folded(p,'收尾记录'));
      await expand(p); await saved(p);
      await page.setViewportSize({width:760,height:760}); await frames(p); assert(await evaluate(p,"return d.querySelector('.folio-outline').hidden&&!d.querySelector('.folio-outline-toggle').hidden;"));
      await click(p,'.folio-outline-toggle'); assert(await evaluate(p,"const r=d.querySelector('.folio-outline').getBoundingClientRect();return r.left>=0&&r.right<=d.defaultView.innerWidth&&r.bottom<=d.defaultView.innerHeight;"));
      if(round==='1') await shot(p,'outline-narrow.png');
      await page.keyboard.press('End'); await page.keyboard.press('Home'); assert.equal(await evaluate(p,'return d.activeElement.textContent;'),'星光手记');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await until(()=>evaluate(p,"return d.querySelector('.folio-outline').hidden;"),'窄窗口跳转后收起');
      await click(p,'.folio-outline-toggle'); await page.keyboard.press('Escape'); assert(await evaluate(p,"return d.querySelector('.folio-outline').hidden&&d.activeElement.classList.contains('folio-outline-toggle');"));
      await page.setViewportSize({width:1800,height:1000}); await click(p,'.folio-outline-toggle'); await collapse(p);
      assert(await visible(p,'星光手记')&&await visible(p,'附录')&&!await visible(p,'准备'));
      if(round==='1') await shot(p,'outline-folded.png');
      await click(p,'.folio-document-end'); await until(()=>evaluate(p,"return !!d.querySelector('.is-editing')&&!d.querySelector('.is-editing.folio-section-hidden');"),'折叠时仍可在文末输入');
      await page.keyboard.insertText('文末补充'); await until(()=>source().includes('文末补充'),'文末内容同步'); await page.keyboard.press('Escape');
      await expand(p); await collapse(p); await jump(p,'附录'); assert(await visible(p,'附录内容，不属于前一个一级标题。')); assert.equal(await evaluate(p,"return d.querySelector('.folio-outline-link[aria-current=location]').textContent;"),'附录');
      await expand(p);await jump(p,'准备');await evaluate(p,"const e=[...d.querySelectorAll('main p')].find(e=>e.textContent.startsWith('准备内容'));e.dataset.liveInput='true';");await click(p,'[data-live-input]');await page.keyboard.press('Meta+ArrowRight');await page.keyboard.press('Enter');await page.keyboard.insertText('/');
      await until(()=>evaluate(p,"return !d.querySelector('.folio-insert-menu').hidden;"),'新行模块菜单');await click(p,'[data-module=h2]');await page.keyboard.insertText('实时新标题');
      await until(()=>evaluate(p,"return [...d.querySelectorAll('.folio-outline-text')].some(e=>e.textContent==='实时新标题');"),'同一编辑块内新增标题实时出现');
      assert(await evaluate(p,"const h=[...d.querySelectorAll('main h2')].find(e=>e.textContent==='实时新标题');return h.closest('.is-editing')&&h.previousElementSibling?.tagName==='P';"));
      await page.keyboard.press('Enter');await page.keyboard.insertText('/');await until(()=>evaluate(p,"return !d.querySelector('.folio-insert-menu').hidden;"),'连续模块菜单');await click(p,'[data-module=h3]');await page.keyboard.insertText('实时子标题');
      await until(()=>evaluate(p,"return [...d.querySelectorAll('.folio-outline-text')].some(e=>e.textContent==='实时子标题');"),'同一块内多个标题实时出现');
      await page.keyboard.press('Escape');await saved(p);p=await reopen(p,round);assert(await evaluate(p,"return [...d.querySelectorAll('.folio-outline-text')].some(e=>e.textContent==='实时子标题');"));
      await until(()=>fs.readFileSync(path.join(runtime,`outline-project/outline-${round}.md`),'utf8')===snapshot().source,'磁盘读回');
      result.rounds.push({round,status:'passed',liveHeadings:true,hiddenScrollbars:true,titleExpansion:true,independentTree:true,nestedFolds:true,sourceUntouched:true,reopen:true,duplicateHeadings:true,jumpReveal:true,editBeforeFold:true,rename:true,undoRedo:true,narrowKeyboard:true,appendWhileFolded:true,targetUnfolded:true,shortDocumentHighlight:true}); done(round);
    }
    await stage('plain'); await action('folio.preview').click(); let p=await preview('plain'); assert(await evaluate(p,"return d.querySelector('.folio-outline').hidden&&d.querySelector('.folio-outline-toggle').hidden;")); done('plain');
    await stage('failure'); await action('folio.preview').click(); p=await preview('failure'); const before=source(); fs.writeFileSync(path.join(runtime,'outline-fail-state'),'');
    await fold(p,'准备'); await until(()=>evaluate(p,"return d.querySelector('.folio-status').textContent.includes('暂时无法记住');"),'状态写入失败反馈'); assert(await folded(p,'准备')); assert.equal(source(),before);
    await shot(p,'outline-state-failure.png'); fs.unlinkSync(path.join(runtime,'outline-fail-state')); await fold(p,'准备'); await until(()=>evaluate(p,"return d.querySelector('.folio-status').hidden;"),'状态恢复后移除过期错误'); p=await reopen(p,'failure'); assert(!await folded(p,'准备')); done('failure');
    await stage('readonly'); await action('folio.preview').click(); p=await preview('readonly'); await fold(p,'准备'); assert(await folded(p,'准备')); await jump(p,'素材'); assert(await visible(p,'素材内容保持完整。')); done('readonly');
    await stage('complete'); result.status='passed'; result.plain=result.stateFailure=result.readonly='passed';
  } catch(error) { result.status='failed'; result.error=error.stack; await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{}); throw error; }
  finally { fs.writeFileSync(path.join(evidence,'ui-verification.json'),JSON.stringify(result,null,2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
