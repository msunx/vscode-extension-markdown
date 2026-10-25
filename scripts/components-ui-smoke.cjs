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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'components-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9362');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'components-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `components-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("h1")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`components-${round}.md`)
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
  const saved=async p=>{await page.keyboard.press('Meta+s');await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent==='已保存';"),'保存');};
  const ready=async p=>until(()=>evaluate(p,"return d.querySelector('.folio-images').open&&d.querySelector('.folio-images').getAttribute('aria-busy')==='false';"),'图片列表完成');
  const fill=async(p,selector,text)=>{await click(p,selector);await page.keyboard.press('Meta+a');await page.keyboard.insertText(text);};
  const target=async(p,text)=>{await evaluate(p,`d.querySelectorAll('[data-test-target]').forEach(e=>e.removeAttribute('data-test-target'));const e=[...d.querySelectorAll('main p')].find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw new Error('找不到段落');e.dataset.testTarget='true';`);return '[data-test-target]';};
  const openImages=async p=>{const t=await target(p,'图片入口');await fill(p,t,'/image');await until(()=>evaluate(p,"return !!d.querySelector('.folio-insert-menu:not([hidden]) [data-module=image]');"),'图片模块');await click(p,'[data-module=image]');await ready(p);};
  const choose=async(p,name)=>{await fill(p,'.folio-image-searchbar input',name);await click(p,'.folio-image-option');await until(()=>evaluate(p,"return !d.querySelector('.folio-picker-footer .is-primary').disabled;"),'图片预览加载');};
  const reopen=async(p,round)=>{await saved(p);await page.keyboard.press('Escape');await page.keyboard.press('Meta+w');await action('folio.preview').click();return preview(round);};
  const history=async(p,key,text)=>{await evaluate(p,"d.__oldBlock=d.querySelector('main .folio-block');");await page.keyboard.press(key);await until(()=>source()===text,'撤销重做');await until(()=>evaluate(p,"return !d.__oldBlock.isConnected;"),'历史重绘');};
  const shot=async(p,name)=>{await evaluate(p,'return Promise.allSettled(d.getAnimations().map(a=>a.finished));');await page.screenshot({path:path.join(evidence,name)});};
  try{
    for(const round of ['1','2','3']){
      await stage(round);await action('folio.preview').click();let p=await preview(round);await page.setViewportSize({width:1200,height:950});
      const code='.folio-code-block';assert(await evaluate(p,"const c=d.querySelector('.folio-code-block pre');return c.scrollWidth<=c.clientWidth+1&&!!c.querySelector('.hljs-keyword');"));
      assert.equal(await evaluate(p,"return d.querySelector('.folio-code-block[data-language=mystery-lang] code').textContent;"),'<unknown> & raw text\n');
      const before=source();await click(p,code+' .folio-code-wrap');assert(await evaluate(p,"const c=d.querySelector('.folio-code-block pre');return c.scrollWidth>c.clientWidth;"));assert.equal(source(),before);
      await click(p,code+' .folio-code-wrap');await click(p,code+' .folio-code-edit');assert(await evaluate(p,"return !d.querySelector('.folio-source-input')&&d.querySelector('.folio-code-input').value.startsWith('const message');"));
      await click(p,code+' .folio-code-edit');await click(p,code+' .folio-code-edit');assert.equal(await evaluate(p,"return d.querySelectorAll('.folio-code-input').length;"),1);await click(p,code+' .folio-code-edit');assert.equal(source(),before);
      await click(p,code+' .folio-code-language');await fill(p,'.folio-language-menu input','python');await click(p,'[data-language=python]');
      await until(()=>source().includes('```python\nconst message'),'语言写回');await until(()=>evaluate(p,"return !!d.querySelector('.folio-code-block[data-language=python]');"),'语言重绘');
      await click(p,code+' .folio-code-edit');await fill(p,'.folio-code-input','def greet(name):\n    return "Hello, " + name\n');await page.keyboard.press('Tab');await page.keyboard.insertText('# 尾行');
      await click(p,code+' .folio-code-edit');await until(()=>evaluate(p,"return !!d.querySelector('.folio-code-block pre .hljs-keyword')&&!d.querySelector('.folio-code-input');"),'编辑后高亮');
      assert(source().includes('  # 尾行'));await click(p,code+' .folio-copy');await until(()=>evaluate(p,"return d.querySelector('.folio-copy').textContent==='已复制';"),'复制反馈');
      if(round==='1')await shot(p,'code-redesign.png');
      p=await reopen(p,round);assert(await evaluate(p,"return d.querySelector('.folio-code-block').dataset.language==='python'&&d.querySelector('.folio-code-block code').textContent.includes('尾行');"));
      await openImages(p);const original=source();assert(await evaluate(p,"return [...d.querySelectorAll('.folio-image-option')].every(e=>!e.dataset.image.includes('excluded')&&!e.dataset.image.includes('outside'));"));
      await fill(p,'.folio-image-searchbar input','no-match');assert(await evaluate(p,"return d.querySelector('.folio-image-grid').textContent.includes('没有匹配')&&d.querySelector('.folio-picker-footer .is-primary').disabled;"));
      await fill(p,'.folio-image-searchbar input','broken');await click(p,'.folio-image-option');await until(()=>evaluate(p,"return d.querySelector('.folio-picker-status').textContent.includes('无法预览');"),'损坏图片反馈');
      assert(await evaluate(p,"return d.querySelector('.folio-picker-footer .is-primary').disabled;"));await choose(p,'delete-before-insert');
      fs.unlinkSync(path.join(runtime,'components-project/assets/delete-before-insert.png'));await click(p,'.folio-picker-footer .is-primary');await until(()=>evaluate(p,"return d.querySelector('.folio-picker-status').textContent.includes('已移动');"),'已删除图片拦截');assert.equal(source(),original);
      await choose(p,'folio.png');await fill(p,'.folio-image-detail input','架构草图');
      if(round==='1'){await shot(p,'images-gallery.png');await page.setViewportSize({width:760,height:720});assert(await evaluate(p,"const r=d.querySelector('.folio-images').getBoundingClientRect();return r.left>=0&&r.right<=d.defaultView.innerWidth&&r.bottom<=d.defaultView.innerHeight;"));await shot(p,'images-narrow.png');await page.setViewportSize({width:1200,height:950});}
      await page.keyboard.press('Escape');assert.equal(source(),original);await page.keyboard.press('Meta+/');await click(p,'[data-module=image]');await ready(p);await choose(p,'folio.png');await fill(p,'.folio-image-detail input','架构草图');
      await click(p,'.folio-picker-footer .is-primary');await until(()=>source().includes('![架构草图](./assets/folio.png)'),'插入原位相对路径');await until(()=>evaluate(p,"return !!d.querySelector('[data-edit-mode=image] img')&&!d.querySelector('.folio-images').open;"),'插入图片渲染');
      await page.keyboard.insertText('图片后的记录');await until(()=>source().includes('图片后的记录'),'图片后继续写作');assert(source().indexOf('图片后的记录')<source().indexOf('## 记录'));
      p=await reopen(p,round);await click(p,'.folio-image-tools button');await ready(p);await choose(p,'阅读预览');await click(p,'.folio-picker-footer .is-primary');await until(()=>source().includes('%E9%98%85%E8%AF%BB'),'替换中文路径图片');
      await until(()=>evaluate(p,"return !d.querySelector('.folio-images').open&&!!d.querySelector('[data-edit-mode=image]');"),'替换渲染');const imageSource=source();
      await click(p,'.folio-image-tools button:last-child');await until(()=>!source().includes('!['),'删除图片');await history(p,'Meta+z',imageSource);
      const link=await target(p,'链接入口');await fill(p,link,'/link');await click(p,'[data-module=link]');await click(p,'.folio-resource-form button[type=submit]');
      assert(await evaluate(p,"return d.querySelector('.folio-form-error').textContent.includes('请填写');"));await fill(p,'.folio-resource-form input[inputmode=url]','javascript:alert(1)');await click(p,'.folio-resource-form button[type=submit]');
      assert(await evaluate(p,"return d.querySelector('.folio-form-error').textContent.includes('网页');"));await page.keyboard.press('Escape');await page.keyboard.press('Meta+z');
      await saved(p);await until(()=>fs.readFileSync(path.join(runtime,`components-project/components-${round}.md`),'utf8')===snapshot().source,'磁盘读回');
      result.rounds.push({round,status:'passed',wrap:true,language:true,editCode:true,copy:true,imagePicker:true,projectBoundary:true,imageFailure:true,imageReplaceDeleteUndo:true,saveReopen:true,linkValidation:true});done(round);
    }
    await stage('readonly');await action('folio.preview').click();let p=await preview('readonly');assert(await evaluate(p,"return d.querySelector('.folio-code-edit').disabled&&d.querySelector('.folio-code-language').disabled;"));done('readonly');
    await stage('failure');await action('folio.preview').click();p=await preview('failure');await click(p,'.folio-code-edit');await fill(p,'.folio-code-input','print("keep update")\n');await page.keyboard.press('Meta+s');
    await until(()=>evaluate(p,"return d.querySelector('.folio-status').textContent.includes('保存失败');"),'保存失败');assert(await evaluate(p,"return d.querySelector('.folio-code-input').value.includes('keep update');"));done('failure');await stage('complete');result.status='passed';
  }catch(error){result.status='failed';result.error=error.stack;await page.screenshot({path:path.join(evidence,'components-failure.png')}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(evidence,'components-ui-verification.json'),JSON.stringify(result,null,2));await browser.close();}
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
