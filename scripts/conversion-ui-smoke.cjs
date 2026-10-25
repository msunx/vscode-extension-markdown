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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'conversion-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9366');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'conversion-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `conversion-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector(".folio-block")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`conversion-${round}.md`)
          && await page.locator(`iframe[src*="id=${value.id}"]`).isVisible()) return { session, id: value.id };
        await session.detach();
      } catch {}
    }
  }, '块拖动预览加载');
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
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '块写回');
  const mark = async (p, name, attribute = 'dragTarget') => {
    await evaluate(p, `for(const e of d.querySelectorAll('[data-${attribute.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}]')) delete e.dataset[${JSON.stringify(attribute)}];
      const e=[...d.querySelectorAll('.folio-task-label,h1,h2,h3,h4,h5,h6,p,pre,table,ul,ol,blockquote')].find(e=>e.textContent.trim()===${JSON.stringify(name)});
      if(!e) throw new Error('找不到内容：'+${JSON.stringify(name)});e.dataset[${JSON.stringify(attribute)}]='true';`);
    return `[data-${attribute.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}]`;
  };
  const blockMenu=async(p,name,selector)=>{
    await hover(p,selector||await mark(p,name));await until(()=>evaluate(p,"return !d.querySelector('.folio-drag-handle').hidden;"),'块手柄');
    const grip=await point(p,'.folio-drag-handle',false);await page.mouse.click(grip.x,grip.y);await until(()=>evaluate(p,"return !d.querySelector('.folio-block-menu').hidden;"),'块菜单');
  };
  const convert=async(p,name,target,selector)=>{
    console.log('convert',target,name?.slice(0,25));await blockMenu(p,name,selector);
    await until(()=>evaluate(p,"return !d.querySelector('.folio-convert-choices').hidden;"),'转换列表');const old=source();await evaluate(p,"d.__oldBlock=d.querySelector('main .folio-block');");
    await click(p,`[data-convert-format=${target}]`);await until(()=>source()!==old,'转换写回');await until(()=>evaluate(p,"return !d.__oldBlock.isConnected&&d.querySelector('.folio-block-menu').hidden;"),'转换重绘');return old;
  };
  const history=async(p,key,expected)=>{await evaluate(p,"d.__oldBlock=d.querySelector('main .folio-block');");await page.keyboard.press(key);await until(()=>source()===expected,'撤销重做');await until(()=>evaluate(p,"return !d.__oldBlock.isConnected;"),'历史重绘');};
  const shot=async(p,name)=>{await evaluate(p,'return Promise.allSettled(d.getAnimations().map(a=>a.finished));');await page.screenshot({path:path.join(evidence,name)});};
  const saved=async p=>{await page.keyboard.press('Meta+s');await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已保存';"),'保存');};
  try{
   for(const round of ['lf','crlf']){
    await stage(round);while(await page.locator('.notifications-toasts .codicon-notifications-clear:visible, .notifications-toasts .codicon-close:visible').count())await page.locator('.notifications-toasts .codicon-notifications-clear:visible, .notifications-toasts .codicon-close:visible').first().click();await action('folio.preview').click();let p=await preview(round);await page.setViewportSize({width:1440,height:1000});const initial=source(),title='待调整 重点 资料';
    await blockMenu(p,title);assert.equal(source(),initial);if(round==='lf')await shot(p,'conversion-menu.png');
    assert(await evaluate(p,"const m=d.querySelector('.folio-block-menu');return m.firstElementChild.matches('.is-destructive')&&m.children[1].getAttribute('role')==='separator'&&!m.children[1].hidden&&d.activeElement===m.firstElementChild&&!m.querySelector('[aria-haspopup]');"));
    await page.keyboard.press('ArrowDown');assert(await evaluate(p,"return d.activeElement.dataset.convertFormat==='text';"));await page.keyboard.press('End');assert(await evaluate(p,"return d.activeElement.dataset.convertFormat==='task';"));await page.keyboard.press('Home');assert(await evaluate(p,"return d.activeElement.matches('.is-destructive');"));
    assert(await evaluate(p,"return !d.querySelector('.folio-convert-choices').hidden&&d.querySelector('[data-convert-format=h2]').disabled&&d.querySelector('[data-convert-format=h2]').getAttribute('aria-checked')==='true';"));
    if(round==='lf'){await shot(p,'conversion-formats.png');await page.setViewportSize({width:760,height:620});await blockMenu(p,title);assert(await evaluate(p,"const r=d.querySelector('.folio-block-menu').getBoundingClientRect();return r.left>=0&&r.right<=d.defaultView.innerWidth&&r.bottom<=d.defaultView.innerHeight;"));await shot(p,'conversion-narrow.png');}
    await page.keyboard.press('Escape');assert(await evaluate(p,"return d.querySelector('.folio-block-menu').hidden&&d.activeElement.matches('.folio-drag-handle');"));assert.equal(source(),initial);
    await page.setViewportSize({width:1440,height:1000});await blockMenu(p,title);await click(p,'.folio-block-menu .is-destructive');const deleted=initial.replace('## 待调整 **重点** [资料](./guide.md)\n','');await until(()=>source()===deleted,'置顶删除');await history(p,'Meta+z',initial);await history(p,'Meta+Shift+z',deleted);await history(p,'Meta+z',initial);await convert(p,title,'h1');const h1=source();assert(h1.includes('# 待调整 **重点** [资料](./guide.md)'));
    await convert(p,title,'h6');const h6=source();assert(h6.includes('###### 待调整'));await history(p,'Meta+z',h1);await history(p,'Meta+Shift+z',h6);await convert(p,title,'h2');assert.equal(source(),initial);
    await convert(p,'正文 加粗 和 链接。','quote');assert(source().includes('> 正文 **加粗** 和 [链接](./guide.md)。'));
    await convert(p,'正文 加粗 和 链接。','code');assert(source().includes('```\n正文 **加粗** 和 [链接](./guide.md)。\n```'));
    const before=await convert(p,'正文 **加粗** 和 [链接](./guide.md)。','text');assert(await evaluate(p,"return [...d.querySelectorAll('main p')].some(e=>e.textContent.includes('正文 **加粗** 和 [链接](./guide.md)。'));"));
    await history(p,'Meta+z',before);await history(p,'Meta+z',initial.replace('正文 **加粗** 和 [链接](./guide.md)。','> 正文 **加粗** 和 [链接](./guide.md)。'));await history(p,'Meta+z',initial);
    const quoteText=await evaluate(p,"return [...d.querySelectorAll('blockquote')].find(e=>e.textContent.includes('第二段保留')).textContent.trim();");await convert(p,quoteText,'code');
    assert(source().includes('````\n引用 **重点**\n第二行包含 ``` 符号。\n\n第二段保留。\n````'));await history(p,'Meta+z',initial);
    const literal='# literal\n<script>keep & text</script>\n    const value = "**keep**";';await convert(p,literal,'text');
    assert(await evaluate(p,"return !d.querySelector('main script')&&[...d.querySelectorAll('main p')].some(e=>e.textContent.includes('<script>keep & text</script>')&&e.textContent.includes('**keep**'));"));await history(p,'Meta+z',initial);
    const list=await evaluate(p,"return [...d.querySelectorAll('main .folio-block-content > ul')].find(e=>e.textContent.includes('普通父项')).textContent.trim();");await convert(p,list,'ordered');
    assert(source().includes('1. 普通父项 **重点**\n   - [x] 保留子任务\n   - 子普通项\n2. 第二项'));
    const ordered=await evaluate(p,"return [...d.querySelectorAll('main .folio-block-content > ol')].find(e=>e.textContent.includes('普通父项')).textContent.trim();");await convert(p,ordered,'task');
    assert(source().includes('- [ ] 普通父项 **重点**\n  - [x] 保留子任务\n  - 子普通项\n- [ ] 第二项'));
    await convert(p,'普通父项 重点','bullet');assert(source().includes('- 普通父项 **重点**\n  - [x] 保留子任务\n  - 子普通项\n- [ ] 第二项'));
    const mixed=await evaluate(p,"return [...d.querySelectorAll('main .folio-block-content > ul')].find(e=>e.textContent.includes('普通父项')).textContent.trim();");await convert(p,mixed,'bullet');assert.equal(source(),initial);
    await convert(p,'父任务','ordered');assert(source().includes('1. 父任务\n   - [x] 保留完成状态\n   - [ ] 子任务'));await history(p,'Meta+z',initial);
    await blockMenu(p,'子任务');assert(await evaluate(p,"return d.querySelector('.folio-convert-choices').hidden&&d.querySelector('.folio-block-menu-divider').hidden;"));await page.keyboard.press('Escape');
    const table=await evaluate(p,"return d.querySelector('table').textContent.trim();");await blockMenu(p,table,'table td');assert(await evaluate(p,"return d.querySelector('.folio-convert-choices').hidden&&d.querySelector('.folio-block-menu-divider').hidden;"));await page.keyboard.press('Escape');
    await evaluate(p,"const p=[...d.querySelectorAll('main p')].find(e=>e.textContent.startsWith('第一逻辑行'));p.dataset.multiline='true';const t=p.firstChild;const r=d.createRange();r.setStart(t,t.textContent.indexOf('第二逻辑行'));r.setEnd(t,t.textContent.indexOf('第二逻辑行')+5);d.__lineRect=r.getBoundingClientRect().toJSON();");

    // Scroll via the paragraph first, then use the actual second line's range to target its handle.
    await evaluate(p,"d.querySelector('[data-multiline]').scrollIntoView({block:'center'});");await frames(p);
    const pointLine=await evaluate(p,"const t=d.querySelector('[data-multiline]').firstChild,r=d.createRange(),i=t.textContent.indexOf('第二逻辑行');r.setStart(t,i);r.setEnd(t,i+5);const b=r.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();return{x:b.x+10+f.x,y:b.y+b.height/2+f.y};");
    const outer=await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox();await page.mouse.move(outer.x+pointLine.x,outer.y+pointLine.y);await frames(p);let grip=await point(p,'.folio-drag-handle',false);await page.mouse.click(grip.x,grip.y);await click(p,'[data-convert-format=h3]');
    await until(()=>source().includes('第一逻辑行\n\n### 第二逻辑行\n\n第三逻辑行'),'按逻辑行转换并隔开邻行');await saved(p);const final=source();
    await page.keyboard.press('Meta+w');await action('folio.preview').click();p=await preview(round);assert.equal(source(),final);assert(await evaluate(p,"return [...d.querySelectorAll('h3')].some(e=>e.textContent==='第二逻辑行');"));
    result.rounds.push({round,status:'passed',headings:true,quoteCode:true,literalCode:true,listHierarchy:true,inlineFormatting:true,logicalLine:true,keyboard:true,unsupportedProtected:true,undoRedo:true,savedReopened:true});done(round);
   }
   await stage('readonly');await action('folio.preview').click();let p=await preview('readonly');await hover(p,await mark(p,'待调整 重点 资料'));assert(await evaluate(p,"return d.querySelector('.folio-drag-handle').hidden;"));done('readonly');
   await stage('failure');await action('folio.preview').click();p=await preview('failure');await convert(p,'待调整 重点 资料','h3');await page.keyboard.press('Meta+s');await until(()=>evaluate(p,"return d.querySelector('.folio-status').textContent.includes('保存失败');"),'保存失败反馈');assert(source().includes('### 待调整'));done('failure');await stage('complete');result.status='passed';
  }catch(error){result.status='failed';result.error=error.stack;await page.screenshot({path:path.join(evidence,'conversion-failure.png')}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(evidence,'conversion-ui-verification.json'),JSON.stringify(result,null,2));await browser.close();}
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
