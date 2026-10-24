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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'task-state-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9356');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'task-state-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `task-state-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("h1")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`task-state-${round}.md`)
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
  const source=()=>snapshot().source.replace(/\r\n/g,'\n');
  const mark=async(p,text)=>{
    await evaluate(p,`for(const e of d.querySelectorAll('[data-test-task],[data-test-label]')) {delete e.dataset.testTask;delete e.dataset.testLabel;}
      const e=[...d.querySelectorAll('input.task-list-item-checkbox')].find(e=>e.nextElementSibling?.textContent.trim()===${JSON.stringify(text)});
      if(!e)throw new Error('找不到任务：'+${JSON.stringify(text)});e.dataset.testTask='true';e.nextElementSibling.dataset.testLabel='true';`);
  };
  const taskState=(p,text)=>evaluate(p,`const e=[...d.querySelectorAll('input.task-list-item-checkbox')].find(e=>e.nextElementSibling?.textContent.trim()===${JSON.stringify(text)});
    return e && {state:e.dataset.folioTaskState,checked:e.checked,mixed:e.indeterminate,disabled:e.disabled,color:d.defaultView.getComputedStyle(e.nextElementSibling).color};`);
  const changed=async(p,text,state)=>{
    const marker={pending:' ',progress:'/',done:'x'}[state];
    await until(async()=>source().includes('['+marker+'] '+text) && (await taskState(p,text))?.state===state && !(await taskState(p,text)).disabled,'任务写回 '+text+' '+state);
    const visual=await taskState(p,text); assert.equal(visual.mixed,state==='progress'); assert.equal(visual.checked,state==='done');
    assert(await evaluate(p,"return d.querySelector('.folio-status').hidden && d.querySelector('.folio-recovery').hidden;"));
  };
  const menu=async(p,text)=>{
    await mark(p,text); const target=await hover(p,'[data-test-task]'); await page.mouse.click(target.x,target.y,{button:'right'});
    await until(()=>evaluate(p,"return !!d.querySelector('.folio-task-menu:not([hidden])');"),'打开状态菜单');
    await evaluate(p,'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
  };
  const choose=async(p,text,state)=>{
    await menu(p,text); await click(p,`.folio-task-menu [data-task-state="${state}"]`); await changed(p,text,state);
  };
  const toggle=async(p,text,state,shift=false)=>{
    await mark(p,text); const target=await hover(p,'[data-test-task]');
    if(shift) await page.keyboard.down('Shift'); await page.mouse.click(target.x,target.y); if(shift) await page.keyboard.up('Shift');
    await changed(p,text,state);
  };
  const selectEnd=async(p,text)=>{
    await mark(p,text); await click(p,'[data-test-label]');
    await evaluate(p,"const e=d.querySelector('[data-test-label]'),r=d.createRange();r.selectNodeContents(e);r.collapse(false);const s=d.getSelection();s.removeAllRanges();s.addRange(r);");
  };
  const history=async(p,key,expected)=>{
    await evaluate(p,"d.__oldTask=d.querySelector('.folio-block');"); await page.keyboard.press(key);
    await until(()=>source()===expected,'任务撤销重做'); await until(()=>evaluate(p,"return !d.__oldTask.isConnected;"),'任务历史重绘');
  };
  const finish=async p=>{
    await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已同步';"),'编辑同步完成');
    await evaluate(p,"d.__oldEdit=d.querySelector('.is-editing');"); await page.keyboard.press('Escape');
    await until(()=>evaluate(p,"return !d.__oldEdit.isConnected && !d.querySelector('.is-editing');"),'编辑结束并重绘');
  };
  try {
    for(const round of ['1','2','3']) {
      await stage(round); await action('folio.preview').click(); let p=await preview(round); await page.setViewportSize({width:1200,height:950});
      assert.equal((await taskState(p,'撰写说明')).state,'progress'); assert((await taskState(p,'撰写说明')).mixed);
      assert.equal(await evaluate(p,"return d.querySelectorAll('input.task-list-item-checkbox').length;"),10,'任务、代码、转义隔离');
      await menu(p,'准备资料'); const original=source();
      if(round==='1') await page.screenshot({path:path.join(evidence,'task-state-menu.png')});
      assert.equal(await evaluate(p,"return d.querySelector('.folio-task-menu [aria-checked=true]').dataset.taskState;"),'pending');
      await page.keyboard.press('Escape'); assert.equal(source(),original); assert(await evaluate(p,"return d.querySelector('.folio-task-menu').hidden;"));
      await choose(p,'准备资料','progress'); assert.notEqual((await taskState(p,'准备资料')).color,(await taskState(p,'整理提纲')).color,'父任务状态不染色子任务');
      const progress=source(); await toggle(p,'准备资料','done'); const completed=source();
      await history(p,'Meta+z',progress); await history(p,'Meta+Shift+z',completed); await toggle(p,'准备资料','pending'); await choose(p,'准备资料','progress');
      await toggle(p,'整理提纲','progress',true); await toggle(p,'整理提纲','done',true); await toggle(p,'整理提纲','pending',true);
      await mark(p,'整理提纲'); await evaluate(p,"d.querySelector('[data-test-task]').focus();"); await page.keyboard.press('Shift+Space'); await changed(p,'整理提纲','progress');
      await page.keyboard.press('Shift+F10'); await until(()=>evaluate(p,"return !d.querySelector('.folio-task-menu').hidden;"),'键盘状态菜单');
      await page.keyboard.press('End'); await page.keyboard.press('Enter'); await changed(p,'整理提纲','done'); await choose(p,'整理提纲','progress');
      await selectEnd(p,'撰写说明'); await page.keyboard.insertText('更新'); await changed(p,'撰写说明更新','progress');
      await choose(p,'撰写说明更新','pending'); await choose(p,'撰写说明更新','progress');
      await selectEnd(p,'撰写说明更新'); await page.keyboard.press('Enter'); await page.keyboard.insertText('新建任务'); await changed(p,'新建任务','pending');
      await toggle(p,'新建任务','progress',true); await toggle(p,'新建任务','done',true); await toggle(p,'新建任务','pending',true);
      await choose(p,'新建任务','progress'); await finish(p);
      await choose(p,'有序任务','pending'); await choose(p,'有序任务','progress');
      await choose(p,'引用任务','pending'); await choose(p,'引用任务','progress');
      await selectEnd(p,'多段任务'); await page.keyboard.insertText('更新'); await changed(p,'多段任务更新','progress'); await finish(p);
      assert(await evaluate(p,`const e=[...d.querySelectorAll('input')].find(e=>e.nextElementSibling?.textContent.trim()==='');
        return e.indeterminate&&e.closest('li').getBoundingClientRect().height>=20;`));
      await selectEnd(p,'准备资料'); await page.keyboard.press('Meta+s');
      await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已保存';"),'保存三态任务'); await page.keyboard.press('Escape');
      const saved=source(); await page.keyboard.press('Meta+w'); await action('folio.preview').click(); p=await preview(round);
      assert.equal(source(),saved); assert((await taskState(p,'准备资料')).mixed); assert((await taskState(p,'新建任务')).mixed);
      await hover(p,'.folio-block:nth-child(2) p');
      assert.equal(await evaluate(p,"return d.defaultView.getComputedStyle(d.querySelector('h1'),'::before').content;"),'"今天"');
      if(round==='1') {
        await page.screenshot({path:path.join(evidence,'task-state-reading.png')});
        await page.setViewportSize({width:760,height:720}); await menu(p,'准备资料');
        assert(await evaluate(p,"const r=d.querySelector('.folio-task-menu').getBoundingClientRect();return r.left>=0&&r.right<=d.defaultView.innerWidth&&r.bottom<=d.defaultView.innerHeight;"));
        await page.screenshot({path:path.join(evidence,'task-state-narrow.png')}); await page.keyboard.press('Escape');
      }
      result.rounds.push({round,status:'passed',contextMenu:true,quickCycle:true,keyboard:true,editNewEmptyNested:true,undoRedo:true,sourceSavedReopened:true}); done(round);
    }
    await stage('readonly'); await action('folio.preview').click(); let p=await preview('readonly');
    assert((await taskState(p,'保留任务')).mixed && (await taskState(p,'保留任务')).disabled); done('readonly');
    await stage('failure'); await action('folio.preview').click(); p=await preview('failure');
    await selectEnd(p,'保留任务'); await page.keyboard.insertText('更新'); await changed(p,'保留任务更新','progress'); await page.keyboard.press('Meta+s');
    await until(()=>evaluate(p,"return !d.querySelector('.folio-status').hidden && d.querySelector('.folio-status').textContent.includes('保存失败');"),'保存失败保留状态');
    assert.equal((await taskState(p,'保留任务更新')).state,'progress'); done('failure'); await stage('complete'); result.status='passed';
  } catch(error) {result.status='failed';result.error=error.stack;await page.screenshot({path:path.join(evidence,'task-state-failure.png')}).catch(()=>{});throw error;}
  finally {fs.writeFileSync(path.join(evidence,'task-state-ui-verification.json'),JSON.stringify(result,null,2));await browser.close();}
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
