const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtime');
const evidence = path.join(root, 'design/image-viewer');
const until = async (predicate, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(`超时：${label}`);
};
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'image-viewer-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9371');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: process.env.FOLIO_VIEWER_START_ROUND ? JSON.parse(fs.readFileSync(path.join(evidence,'ui-verification.json'))).rounds : [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'image-viewer-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `image-viewer-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      if(!frame.url()||frame.url()==='about:blank')continue;
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,interactive:d?.body.dataset.folioInteractive,ready:!!d?.querySelector("h1")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && (round==='builtin'?!value.interactive:value.base?.includes(`image-viewer-${round}.md`))
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
        if(y<0||y>d.defaultView.innerHeight){e.scrollIntoView({block:'center',inline:'nearest'});return null;}
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
    await evaluate(p, 'return Promise.allSettled(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished));');
    const settled = await point(p, selector, false); await page.mouse.move(settled.x, settled.y); return settled;
  };
  const click = async (p, selector) => { const target = await hover(p, selector); await page.mouse.click(target.x, target.y); await frames(p); };
  const image=alt=>`main img[alt="${alt}"]`, viewer='.folio-image-viewer';
  const settle=p=>evaluate(p,'return Promise.allSettled(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished));');
  const opened=p=>until(()=>evaluate(p,"return d.querySelector('.folio-image-viewer').open&&!d.querySelector('.folio-image-viewer-content').hidden;"),'放大图片加载');
  const closed=p=>until(()=>evaluate(p,"return !d.querySelector('.folio-image-viewer').open&&!d.documentElement.classList.contains('folio-image-viewer-open');"),'关闭并解除滚动锁');
  const shot=async(p,name)=>{await settle(p);await page.screenshot({path:path.join(evidence,name+'.png')});};
  const background=async p=>{const r=await evaluate(p,"const s=d.querySelector('.folio-image-viewer-stage').getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();return{x:s.left+4+f.left,y:s.top+4+f.top};"),f=await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox();await page.mouse.click(f.x+r.x,f.y+r.y);await closed(p);};
  const source=()=>snapshot().source;
  const fit=p=>evaluate(p,"const s=d.querySelector('.folio-image-viewer-stage').getBoundingClientRect(),i=d.querySelector('.folio-image-viewer-content').getBoundingClientRect();return i.width>0&&i.height>0&&i.left>=s.left&&i.right<=s.right+1&&i.top>=s.top&&i.bottom<=s.bottom+1;");
  try{
    for(const round of ['1','2','3'].filter(value=>Number(value)>=Number(process.env.FOLIO_VIEWER_START_ROUND||1))){
      await stage(round);console.log('Round '+round);await page.setViewportSize({width:1480,height:1000});await action('folio.preview').click();const p=await preview(round),before=source(),v=snapshot().version;
      await until(()=>evaluate(p,"return !!d.querySelector('main img[aria-haspopup=dialog]');"),'图片入口就绪');
      await click(p,image('阅读界面'));await opened(p);assert(await fit(p));assert.equal(source(),before);assert.equal(snapshot().version,v);
      if(round==='1')await shot(p,'wide');
      await click(p,viewer+'-header button:first-of-type');assert(await evaluate(p,"return d.querySelector('.folio-image-viewer-stage').classList.contains('is-original');"));
      const size=await evaluate(p,"const i=d.querySelector('.folio-image-viewer-content');return [i.getBoundingClientRect().width,i.naturalWidth];");assert.equal(size[0],size[1]);
      await click(p,viewer+'-header button:first-of-type');assert(await fit(p));await page.keyboard.press('Escape');await closed(p);
      for(const alt of ['链接中的图片','行内图标','单元格图片']){await click(p,image(alt));await opened(p);assert.equal(source(),before);await background(p);}
      await click(p,image('长图'));await opened(p);assert(await fit(p));await page.setViewportSize({width:760,height:720});await frames(p);assert(await fit(p));
      await click(p,viewer+'-header button:first-of-type');assert(await evaluate(p,"const s=d.querySelector('.folio-image-viewer-stage');return s.scrollHeight>s.clientHeight;"));
      await page.mouse.wheel(0,400);assert(await evaluate(p,"return d.documentElement.classList.contains('folio-image-viewer-open');"));
      await click(p,viewer+'-header button:first-of-type');assert(await fit(p));if(round==='1')await shot(p,'narrow');await click(p,viewer+' .folio-dialog-close');await closed(p);await page.setViewportSize({width:1480,height:1000});
      await click(p,image('暂时不可用'));await until(()=>evaluate(p,"return d.querySelector('.folio-image-viewer').open&&d.querySelector('.folio-image-viewer-feedback p').textContent.includes('失败');"),'加载失败可恢复');
      await click(p,'.folio-image-viewer-feedback button');await until(()=>evaluate(p,"return d.querySelector('.folio-image-viewer-feedback p').textContent.includes('失败');"),'重试失败反馈');await page.keyboard.press('Escape');await closed(p);
      await evaluate(p,"const p=[...d.querySelectorAll('main p')].find(p=>p.textContent==='编辑位置保持不变。');p.dataset.editProbe='true';");
      await click(p,'[data-edit-probe]');await page.keyboard.press('Meta+ArrowRight');
      const caret=await evaluate(p,"const s=d.defaultView.getSelection();return {text:s.anchorNode.textContent,offset:s.anchorOffset,focus:d.activeElement.className,scroll:d.defaultView.scrollY};");
      await click(p,image('阅读界面'));await opened(p);await page.keyboard.press('Escape');await closed(p);
      const restored=await evaluate(p,"const s=d.defaultView.getSelection();return {text:s.anchorNode.textContent,offset:s.anchorOffset,focus:d.activeElement.className};");assert.equal(restored.text,caret.text);assert.equal(restored.offset,caret.offset);assert.equal(restored.focus,caret.focus);
      await page.keyboard.insertText('继续写作');await until(()=>source().includes('编辑位置保持不变。继续写作'),'关闭后接着输入');await page.keyboard.press('Meta+s');await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已保存';"),'保存');
      await evaluate(p,"d.querySelector('main img').focus();");await page.keyboard.press('Enter');await opened(p);await page.keyboard.press('Escape');await closed(p);await page.keyboard.press('Space');await opened(p);await background(p);
      await page.emulateMedia({reducedMotion:'reduce'});await click(p,image('阅读界面'));await opened(p);assert(await evaluate(p,"return d.defaultView.getComputedStyle(d.querySelector('.folio-image-viewer')).animationName==='none';"));await page.keyboard.press('Escape');await closed(p);await page.emulateMedia({reducedMotion:'no-preference'});
      assert(!source().includes('folio-image-viewer'));result.rounds.push({round,status:'passed',fitted:true,original:true,narrow:true,linked:true,inline:true,table:true,caret:true,keyboard:true,retry:true,reducedMotion:true});await page.keyboard.press('Escape');await page.keyboard.press('Meta+w');await p.session.detach();await until(async()=>!await page.locator(`iframe[src*="id=${p.id}"]`).isVisible(),'预览标签关闭');done(round);
    }
    await stage('readonly');await action('folio.preview').click();let p=await preview('readonly'),before=source();await click(p,image('只读图'));await opened(p);assert(await fit(p));await page.keyboard.press('Escape');await closed(p);assert.equal(source(),before);result.readonly='passed';await page.keyboard.press('Meta+w');done('readonly');
    await stage('builtin');p=await preview('builtin');assert(await evaluate(p,"return !d.body.dataset.folioInteractive;"));
    const selector=await evaluate(p,"const i=d.querySelector('.markdown-body img, #preview img');if(!i)throw Error('No built-in image');i.dataset.builtinProbe='true';return '[data-builtin-probe]';");await click(p,selector);await opened(p);await page.keyboard.press('Escape');await closed(p);result.builtin='passed';done('builtin');
    await stage('review');result.status='passed';
  }catch(error){result.status='failed';result.error=error.stack;await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(evidence,'ui-verification.json'),JSON.stringify(result,null,2));await browser.close();}
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
