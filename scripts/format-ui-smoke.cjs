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
const snapshot = () => JSON.parse(fs.readFileSync(path.join(runtime, 'format-source.json')));
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await until(async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:9359');}catch{return false;}},'Cursor 调试端口');
  const context = browser.contexts()[0], page = context.pages()[0], result = { rounds: [] };
  const stage = name => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'format-stage.json'))).stage === name; } catch { return false; }
  }, name);
  const done = name => fs.writeFileSync(path.join(runtime, `format-${name}-done`), '');
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const preview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const { value } = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,base:d?.baseURI,ready:!!d?.querySelector("h1")}})()', returnByValue: true
        })).result;
        if (value?.visible === 'visible' && value.ready && value.base?.includes(`format-${round}.md`)
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
  const select = async (p, selector, text, occurrence = 0) => {
    await click(p, selector);
    await evaluate(p, `const e=d.querySelector(${JSON.stringify(selector)}),text=${JSON.stringify(text)};let start=-1;for(let i=0;i<=${occurrence};i++)start=e.textContent.indexOf(text,start+1);if(start<0)throw new Error('选区不存在');
      const w=d.createTreeWalker(e,4),r=d.createRange();let n,o=0,b=false;while(n=w.nextNode()){if(!b&&start<=o+n.length){r.setStart(n,start-o);b=true;}if(b&&start+text.length<=o+n.length){r.setEnd(n,start+text.length-o);break;}o+=n.length;}
      const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
    await until(() => evaluate(p, "return !d.querySelector('.folio-format-toolbar').hidden;"), '选区工具条');
  };
  const format = async (p, kind) => { await click(p, `[data-format=${kind}]`); };
  const color = async (p, kind, value) => { await format(p, kind); await click(p, `.folio-format-swatch[data-color='${value}']`); };
  const textAt = async (p, text) => {
    await evaluate(p, `d.querySelectorAll('[data-test-target]').forEach(e=>e.removeAttribute('data-test-target'));const e=[...d.querySelectorAll('main p,main h1,main .folio-task-label,main td')].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!e)throw new Error('找不到正文');e.dataset.testTarget='true';`);
    return '[data-test-target]';
  };
  const saved = async p => { await page.keyboard.press('Meta+s'); await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '保存'); };
  const reopen = async (p, round) => { await saved(p); await page.keyboard.press('Escape'); await page.keyboard.press('Meta+w'); await action('folio.preview').click(); return preview(round); };
  const history = async (p, key, expected) => {
    await evaluate(p, "d.__oldBlock=d.querySelector('main .folio-block');"); await page.keyboard.press(key); await until(() => source() === expected, '撤销或重做写回');
    await until(() => evaluate(p, "return !d.__oldBlock.isConnected;"), '历史重绘');
  };
  try {
    for (const round of ['1', '2', '3']) {
      await stage(round); await action('folio.preview').click(); let p = await preview(round); await page.setViewportSize({ width: 1200, height: 950 });
      let target = await textAt(p, '让重要'); await select(p, target, '重要的文字'); const original = source();
      await format(p, 'bold'); await until(() => source().includes('**重要的文字**'), '加粗写回'); const bold = source();
      await page.keyboard.press('Alt+F10'); await history(p, 'Meta+z', original); await history(p, 'Meta+Shift+z', bold);
      target = await textAt(p, '让重要'); await select(p, target, '重要的文字'); await page.keyboard.press('Alt+F10'); await page.keyboard.press('Meta+i'); await page.keyboard.press('Meta+e');
      await color(p, 'color', '#8aadf4'); await color(p, 'background', '#50462f');
      assert(await evaluate(p, `return d.querySelector(${JSON.stringify(target)}).querySelector('span em strong code').textContent==='重要的文字';`));
      await format(p, 'underline'); await format(p, 'strike'); await format(p, 'strike'); await format(p, 'underline');
      if (round === '1') { await format(p, 'color'); await evaluate(p, 'return Promise.allSettled(d.getAnimations().map(a=>a.finished));'); await page.screenshot({ path: path.join(evidence, 'format-toolbar.png') }); await format(p, 'color'); }
      p = await reopen(p, round); target = await textAt(p, '让重要');
      assert(await evaluate(p, `const e=d.querySelector(${JSON.stringify(target)});return e.querySelector('code')?.textContent==='重要的文字'&&e.querySelector('strong')&&e.querySelector('em')&&e.querySelector('span')?.style.backgroundColor==='rgb(80, 70, 47)';`), '重新打开保留复合样式');
      await select(p, target, '重要的文字'); assert(await evaluate(p, "return !d.querySelector('.folio-source-input');"));
      await format(p, 'clear'); await until(() => source().includes('让重要的文字更清楚'), '清除样式');
      // Remove a mark from the middle while preserving the two styled sides.
      target = await textAt(p, '原有加粗内容'); await select(p, target, '加粗'); await format(p, 'bold');
      await until(() => source().includes('**原有**加粗**内容**'), '部分取消加粗'); p = await reopen(p, round);
      target = await textAt(p, '原有加粗内容'); assert.deepEqual(await evaluate(p, `return [...d.querySelector(${JSON.stringify(target)}).querySelectorAll('strong')].map(e=>e.textContent);`), ['原有', '内容']);
      // Code delimiter choice must preserve literal backticks and spaces.
      target = await textAt(p, '代码示例'); await select(p, target, 'hello world end'); await format(p, 'code'); p = await reopen(p, round);
      target = await textAt(p, '代码示例'); assert.equal(await evaluate(p, `return d.querySelector(${JSON.stringify(target)}).querySelector('code').textContent;`), 'hello world end');
      await select(p, target, 'hello world end'); await page.keyboard.press('Meta+e');
      await until(() => source().includes('代码示例： hello world end 。'), '取消行内代码');
      target = await textAt(p, '符号示例'); await select(p, target, '`raw`'); await format(p, 'code'); p = await reopen(p, round);
      target = await textAt(p, '符号示例'); assert.equal(await evaluate(p, `return d.querySelector(${JSON.stringify(target)}).querySelector('code').textContent;`), '`raw`');
      await select(p, target, '☕️'); await format(p, 'bold');
      target = await textAt(p, '空格示例'); await select(p, target, ' 空格 '); await format(p, 'code'); p = await reopen(p, round);
      target = await textAt(p, '空格示例'); assert.equal(await evaluate(p, `return d.querySelector(${JSON.stringify(target)}).querySelector('code').textContent;`), ' 空格 ');
      target = await textAt(p, '边界：'); await select(p, target, '文字。'); await format(p, 'bold'); p = await reopen(p, round);
      target = await textAt(p, '边界：'); assert.equal(await evaluate(p, `return d.querySelector(${JSON.stringify(target)}).querySelector('strong').textContent;`), '文字。');
      await select(p, target, '文字。'); await format(p, 'code'); p = await reopen(p, round);
      target = await textAt(p, '边界：'); assert.equal(await evaluate(p, `return d.querySelector(${JSON.stringify(target)}).querySelector('strong code').textContent;`), '文字。');
      // Todo controls, nested siblings and link destinations remain intact.
      target = await textAt(p, '整理提纲'); await select(p, target, '提纲'); await color(p, 'color', '#f5bde6');
      await until(() => source().includes('  - [ ] 整理<span style="color:#f5bde6">提纲</span>'), '子任务样式');
      assert(source().includes('- [/] 准备资料') && source().includes('  - [x] 校对旧稿'));
      target = await textAt(p, '项目文档'); await select(p, target, '文档'); await format(p, 'italic'); assert(source().includes('[项目*文档*](./format-link.md)'));
      target = await textAt(p, '单元格文字'); await select(p, target, '单元格'); await format(p, 'code'); await color(p, 'background', '#34483f');
      target = await textAt(p, '引用中的文字'); await select(p, target, '引用'); await format(p, 'underline'); await format(p, 'strike');
      await page.keyboard.press('Alt+F10'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
      await until(() => source().includes('> 引用中的文字'), '键盘清除格式');
      target = await textAt(p, '让重要'); await select(p, target, '重要的文字');
      if (round === '1') {
        await page.setViewportSize({ width: 760, height: 720 }); await format(p, 'background');
        assert(await evaluate(p, "const r=d.querySelector('.folio-format-palette').getBoundingClientRect();return r.left>=0&&r.right<=d.defaultView.innerWidth&&r.top>=0&&r.bottom<=d.defaultView.innerHeight;"));
        await evaluate(p, 'return Promise.allSettled(d.getAnimations().map(a=>a.finished));'); await page.screenshot({ path: path.join(evidence, 'format-narrow.png') }); await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1200, height: 950 });
      }
      await format(p, 'bold'); await format(p, 'italic'); await color(p, 'color', '#eed49f');
      p = await reopen(p, round); target = await textAt(p, '单元格文字'); assert(await evaluate(p, `return !!d.querySelector(${JSON.stringify(target)}).querySelector('code');`));
      target = await textAt(p, '整理提纲'); await select(p, target, '提纲'); await page.keyboard.insertText('提纲更新'); await until(() => source().includes('提纲更新'), '格式后继续输入');
      await select(p, target, '提纲更新'); await page.keyboard.press('Alt+F10'); await saved(p); await until(() => fs.readFileSync(path.join(runtime, `format-${round}.md`), 'utf8') === snapshot().source, '保存读回');
      result.rounds.push({ round, status: 'passed', toggle: true, partialToggle: true, colorBackground: true, code: true, todo: true, table: true, link: true, keyboard: true, undoRedo: true, persistence: true }); done(round);
    }
    await stage('readonly'); await action('folio.preview').click(); let p = await preview('readonly'); const before = source();
    await click(p, 'main p'); await evaluate(p, "const r=d.createRange();r.selectNodeContents(d.querySelector('main p'));d.getSelection().removeAllRanges();d.getSelection().addRange(r);");
    await frames(p); assert(await evaluate(p, "return d.querySelector('.folio-format-toolbar').hidden;")); assert.equal(source(), before); done('readonly');
    await stage('failure'); await action('folio.preview').click(); p = await preview('failure'); await select(p, 'main p', '保留文字'); await format(p, 'bold');
    await page.keyboard.press('Meta+s'); await until(() => evaluate(p, "return d.querySelector('.folio-status').textContent.includes('保存失败');"), '保存失败反馈');
    assert(source().includes('**保留文字**')); assert(await evaluate(p, "return d.querySelector('main strong')?.textContent==='保留文字';")); done('failure');
    await stage('complete'); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; await page.screenshot({ path: path.join(evidence, 'format-failure.png') }).catch(() => {}); throw error; }
  finally { fs.writeFileSync(path.join(evidence, 'format-ui-verification.json'), JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
