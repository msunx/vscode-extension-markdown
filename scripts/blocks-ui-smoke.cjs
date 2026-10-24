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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'blocks-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9354');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'blocks-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `blocks-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("table")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`blocks-${round}.md`)
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
      const e=[...d.querySelectorAll('.folio-task-label,h1,h2,p,pre,table,ul,blockquote')].find(e=>e.textContent.trim()===${JSON.stringify(name)});
      if(!e) throw new Error('找不到内容：'+${JSON.stringify(name)});e.dataset[${JSON.stringify(attribute)}]='true';`);
    return `[data-${attribute.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}]`;
  };
  const targetPoint = async (p, selector, after) => {
    await evaluate(p, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'});`); await frames(p);
    const rect = await evaluate(p, `let e=d.querySelector(${JSON.stringify(selector)});if(e.matches('.folio-task-label'))e=e.closest('li');
      const r=e.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();return{x:r.left+4+f.x,y:${after ? 'r.bottom-1' : 'r.top+1'}+f.y};`);
    const outer = await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox(); return {x:outer.x+rect.x,y:outer.y+rect.y};
  };
  const move = async (p, name, target, after=false, cancel=false, sourceSelector=null) => {
    const old=source(), selector=sourceSelector || await mark(p,name);
    await hover(p,selector);
    await until(()=>evaluate(p,"return !d.querySelector('.folio-drag-handle').hidden;"),'拖动手柄出现');
    const kind=await evaluate(p,"return d.querySelector('.folio-drag-handle').dataset.kind;");
    const grip=await point(p,'.folio-drag-handle',false); await page.mouse.move(grip.x,grip.y); await page.mouse.down();
    await page.mouse.move(grip.x+8,grip.y+5,{steps:3});
    await until(()=>evaluate(p,"return d.body.classList.contains('folio-is-dragging');"),'进入拖动'); await evaluate(p,"d.__moveNode=d.querySelector('.folio-block');");
    const targetSelector=await mark(p,target,'dropTarget'); const end=await targetPoint(p,targetSelector,after);
    await page.mouse.move(end.x,end.y,{steps:10}); await frames(p);
    assert(await evaluate(p,"return !d.querySelector('.folio-drop-guide').hidden;"),'显示落点');
    if(cancel) await page.keyboard.press('Escape');
    if(roundName==='lf' && kind==='table' && !cancel) await page.screenshot({path:path.join(evidence,'blocks-table-drag.png')});
    await page.mouse.up();
    if(cancel) {assert.equal(source(),old);return;}
    await until(()=>source()!==old,`移动${name}`); await synced(p); await until(()=>evaluate(p,"return !d.__moveNode.isConnected;"),'移动重新渲染');
    await until(()=>evaluate(p,"return !d.body.classList.contains('folio-is-dragging') && !d.querySelector('.folio-recovery:not([hidden])');"),'移动结束');
    return kind;
  };
  const history = async(p,key,expected)=>{
    await evaluate(p,"d.__oldBlocks=d.querySelector('.folio-block');"); await page.keyboard.press(key);
    await until(()=>source()===expected,'移动撤销重做');
    await until(()=>evaluate(p,"return !d.__oldBlocks.isConnected && d.querySelector('.folio-recovery').hidden;"),'移动重绘');
  };
  let roundName;
  try {
    for (const round of ['lf','crlf']) {
      roundName=round; await stage(round); await action('folio.preview').click(); let p=await preview(round);
      await page.setViewportSize({width:1440,height:1100});
      assert.equal(await move(p,'移动子项','同级任务'),'task');
      assert(source().includes('  - [x] 保留子项\n- [ ] 移动子项\n- [ ] 同级任务'));
      const before=source(); await move(p,'父任务','同级任务',true); const after=source();
      assert(source().indexOf('同级任务')<source().indexOf('父任务'));
      assert(source().includes('- [ ] 父任务\n  - [x] 保留子项'));
      await history(p,'Meta+z',before);await history(p,'Meta+Shift+z',after);
      await evaluate(p,"const e=[...d.querySelectorAll('.folio-block-content > ul')].find(e=>e.textContent.includes('普通条目一'));e.dataset.dragTarget='true';");
      const listName=await evaluate(p,"return [...d.querySelectorAll('.folio-block-content > ul')].find(e=>e.textContent.includes('普通条目一')).textContent.trim();");
      assert.equal(await move(p,listName,'目标标题'),'list');
      assert(source().indexOf('- 普通条目一')<source().indexOf('## 目标标题'));
      const tableName=await evaluate(p,"return d.querySelector('table').textContent.trim();");
      assert.equal(await move(p,tableName,'目标标题'),'table');
      assert(source().indexOf('<!-- folio:table-widths')<source().indexOf('## 目标标题'));
      assert(await evaluate(p,"return d.querySelector('table').dataset.folioTableWidths==='160,240';"));
      // Hover the second logical text line using its link, without clicking or activating it.
      await evaluate(p,"d.querySelector('a[href]').dataset.lineDrag='true';"); await hover(p,'[data-line-drag]');
      await until(()=>evaluate(p,"return !d.querySelector('.folio-drag-handle').hidden;"),'正文行手柄');
      let grip=await point(p,'.folio-drag-handle',false);await page.mouse.move(grip.x,grip.y);await page.mouse.down();await page.mouse.move(grip.x+8,grip.y+4);
      await until(()=>evaluate(p,"return d.body.classList.contains('folio-is-dragging');"),'正文行拖动'); await evaluate(p,"d.__moveNode=d.querySelector('.folio-block');");
      let end=await targetPoint(p,await mark(p,'目标标题','dropTarget'),false);await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();
      await until(()=>source().indexOf('第二逻辑行')<source().indexOf('## 目标标题'),'按逻辑行移动');await synced(p);await until(()=>evaluate(p,"return !d.__moveNode.isConnected;"),'正文行重新渲染');
      assert(source().includes('第一逻辑行 **加粗**\n第三逻辑行'));
      const edit=await mark(p,'可编辑正文');await click(p,edit);
      await evaluate(p,"const e=d.querySelector('[data-drag-target]'),r=d.createRange();r.selectNodeContents(e);r.collapse(false);d.getSelection().removeAllRanges();d.getSelection().addRange(r);");
      await page.keyboard.insertText('更新');await move(p,'可编辑正文更新','目标标题');
      assert(source().indexOf('可编辑正文更新')<source().indexOf('## 目标标题'));
      const edited=await mark(p,'可编辑正文更新');await click(p,edited);
      await evaluate(p,"const e=d.querySelector('[data-drag-target]'),r=d.createRange();r.selectNodeContents(e);r.collapse(false);d.getSelection().removeAllRanges();d.getSelection().addRange(r);");
      await page.keyboard.press('Enter');await page.keyboard.insertText('新建正文块');
      assert.equal(await move(p,'新建正文块','拖动验证'),'p');
      assert(source().includes('新建正文块'));
      const child=await mark(p,'保留子项');await click(p,child);
      await evaluate(p,"const e=d.querySelector('[data-drag-target]'),r=d.createRange();r.selectNodeContents(e);r.collapse(false);d.getSelection().removeAllRanges();d.getSelection().addRange(r);");
      await page.keyboard.press('Enter');await page.keyboard.insertText('新任务');assert.equal(await move(p,'新任务','同级任务'),'task');
      await click(p,'pre');
      await evaluate(p,"const e=d.querySelector('.folio-source-input'),i=e.value.indexOf(';');e.focus();e.setSelectionRange(i,i);");
      await page.keyboard.insertText(' + 1');
      assert.equal(await move(p,'代码块','末尾正文',false,false,'.folio-source-input'),'code');
      assert.equal(await move(p,'引用第一行\n引用第二行','目标标题'),'blockquote');
      await move(p,'父任务','有序任务');
      assert(source().includes('- [ ] 父任务\n  - [x] 保留子项\n10. [ ] 有序任务\n    - [x] 有序任务子项'));
      assert(await evaluate(p,"const l=[...d.querySelectorAll('.folio-task-label')].find(e=>e.textContent.trim()==='父任务').closest('li');return !!l.querySelector('ul li .task-list-item-checkbox:checked');"));
      await move(p,'同级任务','末尾正文',true,true);
      if(round==='lf') {
        await page.setViewportSize({width:1440,height:700});await hover(p,await mark(p,'同级任务'));
        const grip=await point(p,'.folio-drag-handle',false);await page.mouse.move(grip.x,grip.y);await page.mouse.down();await page.mouse.move(grip.x+8,grip.y+5);
        await until(()=>evaluate(p,"return d.body.classList.contains('folio-is-dragging');"),'滚动拖动');
        const start=await evaluate(p,'return d.defaultView.scrollY;');
        const inner=await evaluate(p,"const r=document.getElementById('active-frame').getBoundingClientRect();return{x:r.left+120,y:r.bottom-12};");
        const outer=await page.locator(`iframe[src*="id=${p.id}"]`).boundingBox();await page.mouse.move(outer.x+inner.x,outer.y+inner.y);
        await until(async()=>await evaluate(p,'return d.defaultView.scrollY;')>start+12,'边缘自动滚动');
        await page.keyboard.press('Escape');await page.mouse.up();await page.setViewportSize({width:1440,height:1100});
      }
      await page.keyboard.press('Meta+s');await until(()=>fs.readFileSync(path.join(runtime,`blocks-${round}.md`),'utf8')===snapshot().source,'保存拖动结果');
      const saved=source(); await page.keyboard.press('Meta+w'); await action('folio.preview').click();p=await preview(round);assert.equal(source(),saved);
      await hover(p,await mark(p,'父任务'));await page.screenshot({path:path.join(evidence,`blocks-${round}.png`)});
      result.rounds.push({round,status:'passed',taskSubtree:true,wholeList:true,tableMetadata:true,logicalLine:true,editedBlock:true,newParagraph:true,newTask:true,rawCode:true,mixedTaskMarkers:true,codeAndQuote:true,cancel:true,undoRedo:true,savedReopened:true});done(round);
    }
    await stage('readonly');await action('folio.preview').click();const p=await preview('readonly');
    await hover(p,await mark(p,'父任务'));assert(await evaluate(p,"return d.querySelector('.folio-drag-handle').hidden && !d.querySelector('[contenteditable=true]');"));
    result.readonly='passed';done('readonly');await stage('complete'); result.status='passed';
  }catch(error){result.status='failed';result.error=error.stack;await page.screenshot({path:path.join(evidence,'blocks-failure.png')});throw error;}
  finally{fs.writeFileSync(path.join(evidence,'blocks-ui-verification.json'),JSON.stringify(result,null,2));await browser.close();}
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
