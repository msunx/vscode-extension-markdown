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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'templates-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9357');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'templates-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `templates-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("h1")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`templates-${round}.md`)
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
  const fill=async(p,selector,value)=>{await click(p,selector);await page.keyboard.press('Meta+a');await page.keyboard.insertText(value);};
  const byText=async(p,selector,text)=>{
    await evaluate(p,`d.querySelectorAll('[data-template-target]').forEach(e=>e.removeAttribute('data-template-target')); const e=[...d.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('找不到 '+${JSON.stringify(text)});e.dataset.templateTarget='true';`);
    await click(p,'[data-template-target]');
  };
  const open=async(p,initial=false)=>{
    if(initial) {
      await byText(p,'main p','入口'); await evaluate(p,`const e=[...d.querySelectorAll('main p')].find(e=>e.textContent==='入口');const r=d.createRange();r.selectNodeContents(e);const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
      await page.keyboard.insertText('、模板');
    } else await page.keyboard.press('Meta+/');
    await until(()=>evaluate(p,"return !!d.querySelector('.folio-insert-menu:not([hidden]) [data-module=template]');"),'模板组件入口');
    await click(p,'[data-module=template]');
    await until(()=>evaluate(p,"return d.querySelector('.folio-templates').open && d.querySelector('.folio-templates').getAttribute('aria-busy')==='false' && !!d.querySelector('.folio-template-preview h1');"),'模板库和预览加载');
  };
  const textButton=(p,text)=>byText(p,'.folio-templates button',text);
  const saved=async p=>until(()=>evaluate(p,"return !d.querySelector('.folio-template-form').hidden ? false : d.querySelector('.folio-template-message').textContent.includes('已保存');"),'模板保存成功');
  const close=async p=>{await page.keyboard.press('Escape');await until(()=>evaluate(p,"return !d.querySelector('.folio-templates').open;"),'关闭模板库');};
  const fresh=async p=>{await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已同步' || d.querySelector('.folio-editor-feedback').hidden;"),'同步');};
  const history=async(p,key,text)=>{
    await evaluate(p,"d.__oldBlock=d.querySelector('main .folio-block');");await page.keyboard.press(key);
    await until(()=>source()===text,'模板撤销重做');await until(()=>evaluate(p,"return !d.__oldBlock.isConnected;"),'历史重绘');
  };
  try {
    for(const round of ['1','2','3']) {
      await stage(round);await action('folio.preview').click();let p=await preview(round);await page.setViewportSize({width:1200,height:950});
      await open(p,true); const before=source();
      if(round==='1') await page.screenshot({path:path.join(evidence,'templates-library.png')});
      await close(p);assert.equal(source(),before);await open(p);
      await textButton(p,'＋ 新建模板');await textButton(p,'保存模板');
      assert(await evaluate(p,"return d.querySelector('.folio-template-message').textContent.includes('请填写模板名称');"));
      const title='日记模板 '+round, markdown='# 日记 {{date}}\n\n{{weekday}}\n\n## 正文\n\n本轮记录'+round+'\n\n- [/] 整理笔记\n\n| 项目 | 内容 |\n| --- | --- |\n| 日期 | {{date}} |\n';
      await fill(p,'#folio-template-name',title);await fill(p,'#folio-template-content',markdown);
      await close(p);await open(p);await textButton(p,'继续未保存的模板');
      assert.equal(await evaluate(p,"return d.querySelector('#folio-template-content').value;"),markdown);
      if(round==='1') await page.screenshot({path:path.join(evidence,'templates-form.png')});
      await page.keyboard.press('Meta+s');await saved(p);
      await textButton(p,'编辑');await fill(p,'#folio-template-content',markdown.replace('本轮记录'+round,'本轮记录'+round+' 已修改'));
      await textButton(p,'保存模板');await saved(p);
      await textButton(p,'另存为');await fill(p,'#folio-template-name',title);await textButton(p,'保存模板');
      await until(()=>evaluate(p,"return d.querySelector('.folio-template-message').textContent.includes('同名');"),'同名校验');
      assert((await evaluate(p,"return d.querySelector('#folio-template-content').value;")).includes('已修改'));
      await fill(p,'#folio-template-name',title+' 副本');await textButton(p,'保存模板');await saved(p);
      await textButton(p,'删除');await textButton(p,'取消');assert(await evaluate(p,"return [...d.querySelectorAll('.folio-template-option')].some(e=>e.textContent.includes('副本'));"));
      await textButton(p,'删除');await textButton(p,'确认删除');
      await until(()=>evaluate(p,"return d.querySelector('.folio-template-message').textContent==='模板已删除。';"),'删除模板');
      await fill(p,'.folio-template-search','不存在的名称');
      assert(await evaluate(p,"return d.querySelector('.folio-template-actions .is-primary').disabled;"));
      await fill(p,'.folio-template-search',title);await until(()=>evaluate(p,"return d.querySelector('.folio-template-preview').textContent.includes('已修改');"),'预览自定义内容');
      assert(await evaluate(p,"return !d.querySelector('.folio-template-tools button').disabled;"),'重新选中模板可编辑');
      assert(await evaluate(p,"const e=d.querySelector('.folio-template-preview input');return e.disabled&&e.indeterminate&&e.dataset.folioTaskState==='progress';"),'预览保留进行中状态且只读');
      if(round==='1') {
        await page.setViewportSize({width:760,height:720});
        assert(await evaluate(p,"const r=d.querySelector('.folio-templates').getBoundingClientRect();return r.left>=0&&r.right<=d.defaultView.innerWidth&&r.bottom<=d.defaultView.innerHeight;"));
        await page.screenshot({path:path.join(evidence,'templates-narrow.png')});await page.setViewportSize({width:1200,height:950});
      }
      await textButton(p,'插入模板');await until(()=>source().includes('本轮记录'+round+' 已修改'),'原位插入');
      await until(()=>evaluate(p,"return !!d.querySelector('main h1') && d.querySelector('main').textContent.includes('本轮记录') && !!d.querySelector('main .is-editing p');"),'插入渲染与光标');
      const inserted=source();await history(p,'Meta+z',before);await history(p,'Meta+Shift+z',inserted);
      await page.keyboard.insertText('继续写作'+round);await until(()=>source().includes('继续写作'+round),'插入后继续输入');
      assert(source().indexOf('继续写作'+round)<source().indexOf('## 后续内容'));
      await page.keyboard.press('Meta+s');await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已保存';"),'文档保存');
      await page.keyboard.press('Escape');await page.keyboard.press('Meta+w');await action('folio.preview').click();p=await preview(round);
      await click(p,'.folio-document-end');await page.keyboard.insertText('、模板');await open(p);
      assert(await evaluate(p,`return [...d.querySelectorAll('.folio-template-option')].some(e=>e.textContent.includes(${JSON.stringify(title)}));`));
      await close(p);await page.keyboard.press('Meta+z');await until(()=>!source().includes('、模板'),'撤回重开入口');
      await page.keyboard.press('Meta+s');await until(()=>fs.readFileSync(path.join(runtime,`templates-${round}.md`),'utf8')===snapshot().source,'保存读回');
      result.rounds.push({round,status:'passed',createEditDelete:true,cancelDraft:true,duplicateValidation:true,search:true,insertAtCaret:true,undoRedo:true,persistence:true});done(round);
    }
    await stage('failure');let p=await preview('3');await click(p,'.folio-document-end');await page.keyboard.insertText('、模板');await open(p);
    await textButton(p,'＋ 新建模板');await fill(p,'#folio-template-name','保存失败验证');await fill(p,'#folio-template-content','# 保留输入\n\n请勿丢失');await textButton(p,'保存模板');
    await until(()=>evaluate(p,"return d.querySelector('.folio-template-message').textContent.includes('存储暂不可用');"),'实际存储失败反馈');
    assert.equal(await evaluate(p,"return d.querySelector('#folio-template-content').value;"),'# 保留输入\n\n请勿丢失');
    await textButton(p,'保存模板');await saved(p);await close(p);done('failure');await stage('complete');result.status='passed';
  }catch(error){result.status='failed';result.error=error.stack;await page.screenshot({path:path.join(evidence,'templates-failure.png')}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(evidence,'templates-ui-verification.json'),JSON.stringify(result,null,2));await browser.close();}
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
