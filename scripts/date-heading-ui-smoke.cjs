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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'date-heading-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9355');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'date-heading-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `date-heading-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("h1")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`date-heading-${round}.md`)
          && await page.locator(`iframe[src*="id=${value.id}"]`).isVisible()) return { session, id: value.id };
        await session.detach();
      } catch {}
    }
  }, '日期标题预览加载');
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
  const heading = '.folio-block:first-child h1';
  const clock = (p, day, midnight = false) => evaluate(p, `const w=d.defaultView;w.__RealDate ||= w.Date;
    const RealDate=w.__RealDate, epoch=new RealDate(2026,9,${day},${midnight ? '23,59,59,850' : '0,30'}).getTime(), started=w.performance.now();
    const time=()=>epoch+${midnight ? 'w.performance.now()-started' : '0'};
    w.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[time()]));}static now(){return time();} };
    w.dispatchEvent(new w.Event('focus'));`);
  const state = (p, selector = heading) => evaluate(p, `const h=d.querySelector(${JSON.stringify(selector)}),w=d.defaultView,r=h.getBoundingClientRect();
    return {text:h.textContent,id:h.id,today:h.classList.contains('folio-today-heading'),label:w.getComputedStyle(h,'::before').content,
      fill:w.getComputedStyle(h).webkitTextFillColor,color:w.getComputedStyle(h).color,separator:w.getComputedStyle(h,'::after').borderTopColor,
      background:w.getComputedStyle(h).backgroundImage,width:r.width,height:r.height};`);
  const away = async p => { await hover(p,'.folio-block:nth-child(2) p'); await frames(p); };
  const source = () => snapshot().source.replace(/\r\n/g, '\n');
  const reading = async p => {
    await away(p); await until(async () => (await state(p)).label === '"今天"', '阅读状态今天别名');
    const s = await state(p); assert.equal(s.text, '2026-10-23'); assert.equal(s.fill, 'rgba(0, 0, 0, 0)');
    assert.notEqual(s.separator, 'rgba(0, 0, 0, 0)'); assert.notEqual(s.background, 'none'); return s;
  };
  try {
    for (const round of ['lf','crlf']) {
      await stage(round); await action('folio.preview').click(); let p=await preview(round); await page.setViewportSize({width:1440,height:1100});
      await clock(p,23); const original=source(), initialVersion=snapshot().version, initial=await reading(p);
      assert.equal(await evaluate(p,"return d.querySelectorAll('h1.folio-today-heading').length;"),2,'只匹配当天完整日期 H1');
      assert(await evaluate(p,"return !d.querySelector('h2').classList.contains('folio-today-heading');"),'H2 保持原样');
      await evaluate(p,`const h=d.querySelector('h1'),r=d.createRange();r.selectNodeContents(h);const s=d.getSelection();
        s.removeAllRanges();s.addRange(r);d.__dateSelection=s.toString();s.removeAllRanges();`);
      assert.equal(await evaluate(p,'return d.__dateSelection;'),'2026-10-23','选区取实际日期');
      if(round==='lf') await page.screenshot({path:path.join(evidence,'date-heading-reading.png')});
      await hover(p,heading); const hovered=await state(p); assert.equal(hovered.label,'none'); assert.equal(hovered.fill,hovered.color);
      assert.equal(hovered.height,initial.height); assert.equal(hovered.width,initial.width); assert.equal(hovered.id,initial.id);
      if(round==='lf') await page.screenshot({path:path.join(evidence,'date-heading-hover.png')});
      await reading(p); assert.equal(snapshot().version,initialVersion,'显示切换不产生编辑');
      await click(p,heading); await away(p);
      assert(await evaluate(p,'return d.querySelector("h1").isContentEditable;'));
      const focused=await state(p); assert.equal(focused.label,'none'); assert.equal(focused.fill,focused.color);
      await evaluate(p,"const r=d.createRange();r.selectNodeContents(d.querySelector('h1'));const s=d.getSelection();s.removeAllRanges();s.addRange(r);");
      await page.keyboard.insertText('2026-10-22'); await until(()=>source().startsWith('# 2026-10-22\n'),'编辑实际日期');
      assert.equal((await state(p)).today,false); assert(!source().includes('今天'));
      await evaluate(p,"d.__oldDateNode=d.querySelector('h1');"); await page.keyboard.press('Meta+z');
      await until(()=>source()===original,'撤销恢复日期');
      await until(()=>evaluate(p,"return !d.__oldDateNode.isConnected && d.querySelector('.folio-recovery').hidden;"),'撤销重绘');
      await page.keyboard.press('Escape'); await reading(p);
      const beforeClock=snapshot().version;
      // A local near-midnight clock tests both local-day matching and the live rollover timer, without changing the OS clock.
      await clock(p,23,true); await until(()=>evaluate(p,`return !d.querySelector('h1').classList.contains('folio-today-heading')
        && [...d.querySelectorAll('h1.folio-today-heading')].every(h=>h.textContent==='2026-10-24');`),'自动跨天');
      assert.equal(await evaluate(p,"return d.querySelectorAll('h1.folio-today-heading').length;"),1);
      await clock(p,23); await reading(p); assert.equal(snapshot().version,beforeClock,'跨天不改写文档');
      // Return from a hidden/suspended preview also refreshes the current date immediately.
      await evaluate(p,`const w=d.defaultView,R=w.__RealDate;w.Date=class extends R {constructor(...a){super(...(a.length?a:[new R(2026,9,24,0,30).getTime()]));}};
        d.dispatchEvent(new w.Event('visibilitychange'));`);
      assert.equal((await state(p)).today,false); await clock(p,23); await reading(p);
      await click(p,heading); await page.keyboard.press('Meta+s');
      await until(()=>fs.readFileSync(path.join(runtime,`date-heading-${round}.md`),'utf8')===snapshot().source,'保存日期原文');
      await page.keyboard.press('Escape'); await page.keyboard.press('Meta+w'); await action('folio.preview').click(); p=await preview(round);
      await clock(p,23); const reopened=await reading(p); assert.equal(reopened.id,initial.id); assert.equal(source(),original);
      result.rounds.push({round,status:'passed',exactH1:true,hover:true,caret:true,selection:true,editUndo:true,localMidnight:true,resume:true,sourceAndAnchorsPreserved:true,savedReopened:true});
      done(round);
    }
    await stage('readonly'); await action('folio.preview').click(); const p=await preview('readonly'); await clock(p,23); await reading(p);
    await hover(p,heading); assert.equal((await state(p)).label,'none'); assert(await evaluate(p,"return !d.querySelector('[contenteditable=true]');"));
    result.readonly='passed'; done('readonly'); await stage('complete'); result.status='passed';
  } catch(error) { result.status='failed'; result.error=error.stack; await page.screenshot({path:path.join(evidence,'date-heading-failure.png')}); throw error; }
  finally { fs.writeFileSync(path.join(evidence,'date-heading-ui-verification.json'),JSON.stringify(result,null,2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
