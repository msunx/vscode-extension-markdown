const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);
const until = async (predicate, label) => {
  const start = Date.now();
  while (Date.now() - start < 30000) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 70)); }
  throw new Error(`超时：${label}`);
};
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9351');
  const context = browser.contexts()[0], page = context.pages()[0];
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const findPreview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const state = (await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),'
            + 'visible:d?.visibilityState,title:d?.querySelector("h1")?.textContent,base:d?.baseURI,ready:!!d?.querySelector(".folio-block-content")}})()', returnByValue: true
        })).result.value;
        if ((round === 'empty' || round === 'readonly' || state?.title === '表格编辑') && state.ready
          && state.base?.includes('paste.md')
          && state.visible === 'visible' && await page.locator(`iframe[src*="id=${state.id}"]`).isVisible()) return { session, id: state.id };
        await session.detach();
      } catch {}
    }
  }, '编辑预览加载');
  const evaluate = async (preview, code) => {
    const r = await preview.session.send('Runtime.evaluate', {
      expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${code}})()`, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description);
    return r.result.value;
  };
  const click = async (preview, selector, caret = false) => {
    await evaluate(preview, 'return Promise.allSettled(d.getAnimations().map(animation=>animation.finished));');
    await evaluate(preview, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    let point, lastBounds;
    await until(async () => {
      const rect = await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)});if(!e)return null;
        const r=e.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();
        return {x:r.x+Math.min(80,r.width/2)+f.x,y:r.y+r.height/2+f.y};`);
      if (!rect) return false;
      const outer = await page.locator(`iframe[src*="id=${preview.id}"]`).boundingBox();
      if (!outer) return false;
      point = {x:outer.x+rect.x,y:outer.y+rect.y,id:preview.id};
      const bounds = JSON.stringify({outer,rect}), stable = bounds === lastBounds; lastBounds = bounds;
      return stable && await page.evaluate(({x,y,id}) => document.elementFromPoint(x,y)?.getAttribute('src')?.includes(`id=${id}`), point);
    }, '点击目标完成布局且未被遮挡');
    await page.mouse.click(point.x, point.y);
    if (caret) await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)}),r=d.createRange();r.selectNodeContents(e);r.collapse(false);
      const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
  };
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '编辑写回');
  const rawSource = () => JSON.parse(fs.readFileSync(path.join(runtime, 'paste-source.json'))).source;
  const source = () => rawSource().replace(/\r\n/g, '\n');
  const command = async request => {
    const id=Date.now(); fs.writeFileSync(path.join(runtime,'paste-command.json'),JSON.stringify({id,...request}));
    await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(runtime,'paste-command-done.json'))).id===id;}catch{return false;}},'宿主操作');
  };
  const { execFileSync } = require('node:child_process');
  const backup = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'folio-paste-'));
  const saved = path.join(backup, 'clipboard.json');
  const jxa = (script, args = []) => execFileSync('osascript', ['-l', 'JavaScript', '-', ...args], { input: script, encoding: 'utf8' });
  jxa(`ObjC.import('AppKit'); function run(args) {
    var pb=$.NSPasteboard.generalPasteboard, items=pb.pasteboardItems, saved=[];
    for(var i=0;i<items.count;i++){var item=items.objectAtIndex(i), types=item.types, values={};
      for(var j=0;j<types.count;j++){var type=types.objectAtIndex(j), data=item.dataForType(type);
        if(data)values[ObjC.unwrap(type)]=ObjC.unwrap(data.base64EncodedStringWithOptions(0));}saved.push(values);}
    $.NSString.stringWithString(JSON.stringify(saved)).writeToFileAtomicallyEncodingError(args[0],true,$.NSUTF8StringEncoding,null);return 'saved';
  }`, [saved]);
  let clipboardText;
  const clipboard = async text => {
    clipboardText=text; await command({type:'clipboard',text});
  };
  const result = {checks:[]}; fs.mkdirSync(evidence,{recursive:true});
  try {
    let p = await findPreview('empty');

    const original=source();
    const selectText = async (selector, start, end=start) => {
      await click(p,selector);
      await evaluate(p, `const e=d.querySelector(${JSON.stringify(selector)}),node=e.firstChild,r=d.createRange();r.setStart(node,${start});r.setEnd(node,${end});
        const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
    };
    const history = async (key, expected) => {
      await evaluate(p,"d.__pasteHistoryNode=d.querySelector('.is-editing');");
      await page.keyboard.press(key);await until(()=>source()===expected,'粘贴撤销重做');
      await until(()=>evaluate(p,"return !d.__pasteHistoryNode?.isConnected && d.querySelector('.folio-recovery').hidden && d.activeElement.isContentEditable;"),'恢复编辑光标');
    };
    const paste = async text => {
      const before = source(); await clipboard(text); await page.keyboard.press('Meta+v');
      await until(() => source() !== before, '粘贴写回');
      await until(() => evaluate(p, "return d.querySelector('.folio-status').hidden && d.querySelector('.folio-editor-feedback').textContent!=='同步中…';"), '粘贴同步完成');
    };
    await selectText('.folio-block[data-kind=p] p',2);
    await paste('粘贴文字'); assert(source().includes('前文粘贴文字后文'));
    const pasted=source(); await history('Meta+z',original); await history('Meta+Shift+z',pasted);
    await page.keyboard.insertText('继续'); await synced(p); assert(source().includes('粘贴文字继续后文'));
    result.checks.push('实际 Cmd+V 在光标处插入；撤销、重做和继续输入');
    await selectText('.folio-block[data-kind=p] p',2,6);
    await clipboard(''); await page.keyboard.press('Meta+v'); assert.equal(source(),pasted.replace('粘贴文字','粘贴文字继续'));
    await paste('替换'); assert(source().includes('前文替换继续后文') && !source().includes('粘贴文字'));
    await selectText('.folio-block[data-kind=p] p',2);
    await paste('首行\r\n次行\r末行'); assert(source().includes('首行  \n次行  \n末行'));
    result.checks.push('替换选区、多行文字与 CRLF 剪贴板');
    await page.keyboard.press('Escape'); await click(p,'li li .folio-task-label',true);
    await paste(' 子级粘贴\n第二行');
    assert(source().includes('  - [ ] 子任务 子级粘贴') && source().includes('    第二行'));
    assert.equal(await evaluate(p,"return d.querySelectorAll('li input').length;"),2);
    result.checks.push('嵌套 Todo 粘贴保留层级及勾选框');
    await page.keyboard.press('Escape'); await selectText('table tbody td',1,2);
    await paste('单元格 | 文字\n下一行');
    assert(source().includes('原单元格 \\| 文字<br>下一行'));
    assert.deepEqual(await evaluate(p,"const t=d.querySelector('table');return [t.rows.length,t.rows[0].cells.length];"),[2,2]);
    result.checks.push('表格粘贴保留换行与竖线，不改变行列结构');
    await page.keyboard.press('Escape');await click(p,'.folio-block[data-kind=code] code');
    await evaluate(p,"const t=d.querySelector('.folio-source-input');t.setSelectionRange(t.value.indexOf('原始代码'),t.value.indexOf('原始代码')+4);");
    await paste('const pasted = true;');assert(source().includes('const pasted = true;'));
    result.checks.push('源码编辑框保留原生粘贴');
    await page.keyboard.press('Escape'); await click(p,'.folio-block[data-kind=p] p',true); await page.keyboard.press('Enter');
    await until(()=>evaluate(p,"return d.querySelector('.folio-editor-feedback').textContent!=='同步中…';"),'回车完成同步');
    const beforeMiddle=source();await paste('## 中间标题\n\n中间内容');
    await until(()=>evaluate(p,"return !!d.querySelector('h2') && d.activeElement.isContentEditable;"),'文中 Markdown 刷新');
    assert(source().indexOf('## 中间标题')<source().indexOf('- [ ] 父任务'));
    const afterMiddle=source();await history('Meta+z',beforeMiddle);await history('Meta+Shift+z',afterMiddle);
    await page.keyboard.insertText('中间继续'); await synced(p);
    assert(source().indexOf('中间继续')<source().indexOf('- [ ] 父任务'));
    result.checks.push('文中空白段落粘贴 Markdown 保留前后内容及继续输入的位置');
    await page.keyboard.press('Escape');await click(p,'.folio-document-end');
    const beforeMarkdown=source(), markdown='## 粘贴的标题\n\n- [ ] 粘贴任务\n  - 子列表\n\n**粗体** 和 [链接](https://example.com)\n\n| 列一 | 列二 |\n| --- | --- |\n| A | B |\n\n```js\nconst pasted = 1;\n```';
    await paste(markdown);
    await until(()=>evaluate(p,"return !!d.querySelector('h2') && d.activeElement.isContentEditable;"),'Markdown 预览刷新');
    assert(source().includes(markdown)); const afterMarkdown=source();
    assert.equal(await evaluate(p,"return d.querySelectorAll('table').length;"),2);
    await history('Meta+z',beforeMarkdown);await history('Meta+Shift+z',afterMarkdown);
    await page.keyboard.insertText('粘贴后继续写');await synced(p);assert(source().endsWith('粘贴后继续写\n\n'));
    result.checks.push('空白正文粘贴 Markdown 生成标题、任务、列表、表格与代码；支持撤销重做及继续输入');
    await command({type:'save'});assert.equal(fs.readFileSync(path.join(runtime,'paste.md'),'utf8'),rawSource());
    if(fs.existsSync(path.join(runtime,'paste-crlf')))assert(!/(?<!\r)\n/.test(rawSource()),'保留 CRLF 文件换行');
    result.checks.push('保存读回一致');
    const savedSource=source(); await page.keyboard.press('Meta+w'); await action('folio.preview').click(); p=await findPreview('empty');
    assert.equal(source(),savedSource);await click(p,'.folio-block:last-child p',true);await paste('重开粘贴');
    assert(source().endsWith('粘贴后继续写重开粘贴\n\n'));await command({type:'save'});
    assert.equal(fs.readFileSync(path.join(runtime,'paste.md'),'utf8'),rawSource());result.checks.push('关闭重开后继续粘贴和保存');
    await page.screenshot({path:path.join(evidence,'paste-markdown.png')});
    result.status='passed';result.crlf=fs.existsSync(path.join(runtime,'paste-crlf'));
  } catch(error) {
    result.status='failed';result.error=error.stack;await page.screenshot({path:path.join(evidence,'paste-failure.png')});throw error;
  } finally {
    jxa(`ObjC.import('AppKit');function run(args){
      var pb=$.NSPasteboard.generalPasteboard;if(ObjC.unwrap(pb.stringForType($.NSPasteboardTypeString))!==args[1])return 'clipboard changed elsewhere; kept';
      var saved=JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(args[0],$.NSUTF8StringEncoding,null))),items=$.NSMutableArray.alloc.init;
      saved.forEach(function(values){var item=$.NSPasteboardItem.alloc.init;
        Object.keys(values).forEach(function(type){item.setDataForType($.NSData.alloc.initWithBase64EncodedStringOptions(values[type],0),type);});items.addObject(item);});
      pb.clearContents;pb.writeObjects(items);return 'restored';}`, [saved, clipboardText || '']);
    fs.rmSync(backup,{recursive:true,force:true}); fs.writeFileSync(path.join(evidence,`paste-ui-${fs.existsSync(path.join(runtime,'paste-crlf'))?'crlf':'lf'}.json`),JSON.stringify(result,null,2));
    if(result.status==='passed')fs.writeFileSync(path.join(runtime,'paste-done'),''); await browser.close();
    console.log(JSON.stringify(result));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
