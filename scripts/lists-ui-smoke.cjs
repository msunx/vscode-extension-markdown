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
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9337');
  const context = browser.contexts()[0], page = context.pages()[0];
  const action = name => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${name}"] .action-label`);
  const stage = name => until(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'lists-stage.json'))).round === name; } catch { return false; } }, name);
  const findPreview = round => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const state = (await session.send('Runtime.evaluate', { expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),visible:d?.visibilityState,title:d?.querySelector("h1")?.textContent,base:d?.baseURI,ready:!!d?.querySelector(".folio-block-content")}})()', returnByValue: true })).result.value;
        if ((round === 'empty' || state?.title === 'Folio · 列表编辑') && state.ready && state.base?.includes(round === 'failure' ? 'save.md' : `lists-${round}.md`) && state.visible === 'visible' && await page.locator(`iframe[src*="id=${state.id}"]`).isVisible()) return { session, id: state.id };
        await session.detach();
      } catch {}
    }
  }, '编辑预览加载');
  const evaluate = async (preview, code) => {
    const r = await preview.session.send('Runtime.evaluate', { expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${code}})()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description);
    return r.result.value;
  };
  const click = async (preview, selector, caret = false, inset = 15) => {
    await evaluate(preview, `d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    const rect = await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect(),f=document.getElementById('active-frame').getBoundingClientRect();return {x:r.x+Math.min(${inset},r.width/2)+f.x,y:r.y+r.height/2+f.y};`);
    const outer = await page.locator(`iframe[src*="id=${preview.id}"]`).boundingBox();
    await page.mouse.click(outer.x + rect.x, outer.y + rect.y);
    if (caret) await evaluate(preview, `const e=d.querySelector(${JSON.stringify(selector)}),r=d.createRange();r.selectNodeContents(e);r.collapse(false);const s=d.getSelection();s.removeAllRanges();s.addRange(r);`);
  };
  const synced = p => until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已同步' && d.querySelector('.folio-status').hidden;"), '编辑写回');
  const menuVisible = p => until(() => evaluate(p, "return !d.querySelector('.folio-insert-menu').hidden;"), '模块菜单');
  const source = () => JSON.parse(fs.readFileSync(path.join(runtime, 'lists-source.json'))).source.replace(/\r\n/g, '\n');
  const result = { rounds: [] };
  for (let round = 1; round <= 3; round++) {
    await stage(round); await action('folio.preview').click(); let p = await findPreview(round);
    const observeSource = () => evaluate(p, `d.defaultView.__folioObservedSource=${JSON.stringify(source())};d.defaultView.addEventListener('message',event=>{if(event.data?.type==='content')d.defaultView.__folioObservedSource=event.data.source.replace(/\\r\\n/g,'\\n');});return true;`);
    await observeSource();
    const reopen = async () => {
      const old = p;
      await page.keyboard.press('Meta+s');
      await until(() => evaluate(p, "return d.querySelector('.folio-editor-feedback').textContent==='已保存';"), '关闭前保存');
      await page.locator('.editor-group-container.active .tab.active .tab-actions .codicon-close').click();
      await action('folio.preview').click(); p = await findPreview(round);
      assert.notEqual(p.id, old.id, '必须关闭并重建预览，不能复用旧 DOM');
      await old.session.detach().catch(() => {}); await observeSource();
    };
    const locate = label => evaluate(p, `for(const e of d.querySelectorAll('li')){const own=Array.from(e.childNodes).filter(n=>!['UL','OL'].includes(n.nodeName)).map(n=>n.textContent).join('').trim();if(own.startsWith(${JSON.stringify(label)})){e.dataset.listTarget='${label}';return true;}}return false;`);
    const target = label => `[data-list-target="${label}"]`;
    const choose = async label => {
      assert(await locate(label), `找不到列表项 ${label}`);
      const line = await evaluate(p, `
        const e=d.querySelector(${JSON.stringify(target(label))});
        return e.querySelector(':scope > p > label') ? ' > p:first-of-type > label'
          : e.querySelector(':scope > label') ? ' > label' : e.querySelector(':scope > p') ? ' > p:first-of-type' : '';
      `);
      await click(p, target(label) + line);
      await evaluate(p, `
        const e=d.querySelector(${JSON.stringify(target(label))});e.closest('.folio-block-content').focus();
        const w=d.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;
        while(n=w.nextNode()){
          if(n.textContent.trim()){
            const r=d.createRange();r.setStart(n,n.textContent.trimEnd().length);r.collapse(true);
            d.getSelection().removeAllRanges();d.getSelection().addRange(r);break;
          }
        }
        return true;
      `);
    };
    const depth = label => evaluate(p, `const e=d.querySelector(${JSON.stringify(target(label))});let n=e,count=0;while(n=n.parentElement)if(['UL','OL'].includes(n.tagName))count++;return count;`);
    const key = async name => { await page.keyboard.press(name); await synced(p); };
    const changed = async (name, predicate) => {
      const history = name.includes('Meta');
      if (history) await evaluate(p, "d.querySelector('.folio-block').dataset.listHistoryStamp='pending';return true;");
      await page.keyboard.press(name); await until(() => predicate(source()), name + ' 源码回写');
      if (history) await until(() => evaluate(p, "return !d.querySelector('[data-list-history-stamp]') && d.activeElement.isContentEditable;"), '历史已渲染');
      else await synced(p);
    };
    const leave = async () => { await page.keyboard.press('Escape'); await until(() => evaluate(p, `return !d.querySelector('.is-editing') && d.defaultView.__folioObservedSource === ${JSON.stringify(source())};`), '退出并刷新'); };
    const taskLayout = async (preview = p) => {
      const rows = await evaluate(preview, `
        return new Promise(resolve=>d.defaultView.requestAnimationFrame(()=>resolve(Array.from(d.querySelectorAll('.task-list-item-checkbox')).map(box=>{
          const item=box.closest('li'),rect=box.getBoundingClientRect(),row=item.getBoundingClientRect();
          return {top:rect.top,bottom:rect.bottom,height:row.height,lineHeight:parseFloat(d.defaultView.getComputedStyle(item).lineHeight)};
        }))));
      `);
      assert(rows.length > 0, '未找到任务行');
      rows.forEach((row, index) => {
        assert(row.height >= row.lineHeight - 0.5, `任务 ${index} 的行高塌缩`);
        if (index) assert(row.top >= rows[index - 1].bottom, `任务 ${index} 与上一行重叠`);
      });
    };
    await taskLayout();
    await choose('子项');
    await changed('Tab', s => s.includes('- 父项\n  - 子项 **重点**\n    - 已有子项'));
    assert.equal(await depth('子项'), 2); assert(await evaluate(p, "return d.activeElement.isContentEditable;"));
    await key('Shift+Tab'); assert.equal(await depth('子项'), 1);
    await changed('Tab', s => s.includes('- 父项\n  - 子项'));
    await changed('Meta+z', s => s.includes('- 父项\n- 子项'));
    await until(() => evaluate(p, "return !d.querySelector('[data-list-target]') && d.activeElement.isContentEditable && d.querySelector('.folio-recovery').hidden;"), '撤销后编辑状态');
    await page.keyboard.insertText('续写'); await synced(p);
    assert(source().includes('子项续写 **重点**'), '撤销后光标未留在原列表项');
    await changed('Meta+z', s => !s.includes('续写'));
    await changed('Meta+z', s => s.includes('- 父项\n  - 子项'));
    await changed('Meta+Shift+z', s => s.includes('- 父项\n- 子项'));
    await leave();
    await choose('父项'); const unchanged = source(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    assert.equal(source(), unchanged); assert(await evaluate(p, "return d.activeElement.isContentEditable;"));
    await leave();

    await choose('计划乙'); await changed('Tab', s => s.includes('7. 计划甲\n   1. 计划乙\n8. 计划丙\n9. 计划丁'));
    assert.equal(await depth('计划乙'), 2); await key('Shift+Tab');
    assert(source().includes('7. 计划甲\n8. 计划乙\n9. 计划丙\n10. 计划丁'));
    await leave();

    await choose('混合乙'); await changed('Shift+Tab', s => s.includes('- 混合乙\n  1. 混合丙'));
    assert.equal(await depth('混合乙'), 1); assert.equal(await locate('混合丙'), true); assert.equal(await depth('混合丙'), 2);
    await changed('Meta+z', s => s.includes('2. 混合乙')); await leave();

    await choose('任务乙'); await changed('Tab', s => s.includes('- [ ] 任务甲\n  - [x] 任务乙\n    - [ ] 任务子项'));
    assert.equal(await depth('任务乙'), 2); assert(await evaluate(p, `return d.querySelector(${JSON.stringify(target('任务乙'))}).querySelector('input').checked;`));
    await key('Shift+Tab');
    const beforeFocusNavigation = source();
    await evaluate(p, `d.querySelector(${JSON.stringify(target('任务乙'))}).querySelector('input').focus();return true;`);
    await page.keyboard.press('Tab');
    assert(await evaluate(p, `return d.activeElement !== d.querySelector(${JSON.stringify(target('任务乙'))}).querySelector('input');`), '复选框 Tab 焦点导航被拦截');
    assert.equal(source(), beforeFocusNavigation); await leave();

    await choose('选区甲'); assert(await locate('选区乙'));
    await evaluate(p, `const a=d.querySelector(${JSON.stringify(target('选区甲'))}).firstChild,b=d.querySelector(${JSON.stringify(target('选区乙'))}).firstChild;d.getSelection().setBaseAndExtent(b,b.textContent.length,a,0);return true;`);
    await changed('Tab', s => s.includes('- 选区父项\n  - 选区甲\n  - 选区乙\n- 选区丙'));
    assert.equal(await depth('选区甲'), 2); assert.equal(await depth('选区乙'), 2);
    await key('Shift+Tab'); assert.equal(await depth('选区乙'), 1); await leave();

    await choose('选区乙'); await changed('Tab', s => s.includes('- 选区甲\n  - 选区乙'));
    await page.keyboard.press('Enter'); await page.keyboard.insertText('回车新项'); await synced(p);
    assert(source().includes('  - 回车新项'), '回车未延续列表层级');
    await page.keyboard.press('Shift+Tab'); await synced(p);
    assert(source().includes('\n- 回车新项'), '新项退级失败'); await leave();
    const richList = async () => assert(await evaluate(p, "return !d.querySelector('.folio-source-input') && d.activeElement.isContentEditable && d.querySelector('.folio-recovery').hidden;"), '列表意外切换成源码框');
    const beforeClick = source();
    await choose('留白父项'); await richList(); await leave();
    await choose('留白子项'); await richList(); await leave();
    await choose('留白同级'); await richList(); await leave();
    assert.equal(source(), beforeClick, '仅点击含空行的列表不应改写源文件');
    await choose('留白尾项'); await page.keyboard.insertText('续写'); await synced(p); await richList();
    assert(source().includes('[ ] 留白尾项续写'));
    await changed('Meta+z', s => !s.includes('留白尾项续写')); await richList();
    await changed('Meta+Shift+z', s => s.includes('留白尾项续写')); await richList(); await leave();
    await choose('留白同级');
    await changed('Tab', s => s.includes('  - [x] 留白同级 **重点**'));
    assert.equal(await depth('留白同级'), 2); await richList();
    await changed('Shift+Tab', s => s.includes('\n- [x] 留白同级 **重点**'));
    assert.equal(await depth('留白同级'), 1);
    const checkbox = target('留白同级') + ' > p > input';
    await click(p, checkbox); await until(() => source().includes('[ ] 留白同级 **重点**'), '留白任务取消完成');
    await click(p, checkbox); await until(() => source().includes('[x] 留白同级 **重点**'), '留白任务完成');
    await choose('留白尾项'); await richList();
    await page.screenshot({ path: path.join(evidence, `loose-tasks-editing-${round}.png`) });
    await leave();

    await choose('段落首行'); await richList(); await page.keyboard.insertText('续写'); await synced(p); await leave();
    await locate('段落首行');
    assert.deepEqual(await evaluate(p, `return Array.from(d.querySelector(${JSON.stringify(target('段落首行'))}).children).map(e=>e.tagName);`), ['P', 'P', 'UL', 'P', 'BLOCKQUOTE'], '列表中的段落、子列表与引用顺序被改变');
    assert(source().includes('段落首行续写\n\n  第二段 **重点**\n\n  - 段内子项\n\n  第三段尾行\n\n  > 段内引用'));
    await choose('段落同级'); await page.keyboard.press('Enter'); await page.keyboard.insertText('留白新项'); await synced(p);
    assert(source().includes('- 留白新项'), '含空行的列表回车未延续列表'); await leave();
    await choose('空行计划乙'); await richList();
    await changed('Tab', s => s.includes('   1. 空行计划乙'));
    assert.equal(await depth('空行计划乙'), 2); await key('Shift+Tab'); await leave();
    assert(source().includes('7. 空行计划甲\n\n8. 空行计划乙\n\n9. 空行计划丙'), '留白编号或段间空行被改变');
    const exits = [
      { label: '回车子项', depth: 2, task: true, checked: true, markdown: '  - [x] 回车子项' },
      { label: '回车留白子项', depth: 2, task: true, checked: false, markdown: '  - [ ] 回车留白子项' },
      { label: '回车留白后项', depth: 1, task: true, checked: false, markdown: '- [ ] 回车留白后项' },
      { label: '回车内层', depth: 3, task: false, markdown: '    - 回车内层' },
      { label: '回车步骤', depth: 2, task: false, markdown: '   1. 回车步骤' }
    ];
    for (const scenario of exits) {
      const { label } = scenario;
      await choose(label);
      const beforeEnter = source();
      await key('Enter');
      const first = await evaluate(p, `
        const s=d.getSelection(),n=s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement,item=n.closest('li');
        const previous=d.querySelector(${JSON.stringify(target(label))});
        return { sameLevel:item?.parentElement===previous.parentElement,empty:!item?.textContent.trim(),checkbox:!!item?.querySelector('input'),checked:!!item?.querySelector('input')?.checked };
      `);
      assert.deepEqual(first, { sameLevel: true, empty: true, checkbox: scenario.task, checked: false }, label + ' 首次回车应新建同级空项');
      await taskLayout();
      await key('Enter');
      assert.equal(await depth(label), scenario.depth, label + ' 层级被连带改变');
      assert(source().includes(scenario.markdown), label + ' 已有内容或状态丢失');
      assert(await evaluate(p, `
        const s=d.getSelection(),n=s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement,paragraph=n.closest('p');
        return paragraph?.parentElement.matches('.folio-block-content') && !paragraph.closest('li,ul,ol') && !paragraph.querySelector('input');
      `), label + ' 第二次回车没有进入列表外普通正文');
      await page.keyboard.insertText(label + '后的正文'); await synced(p);
      assert(source().includes('\n\n' + label + '后的正文'), label + ' 新正文仍带有列表格式');
      if (label === '回车子项') {
        await changed('Meta+z', s => !s.includes(label + '后的正文'));
        await page.keyboard.insertText('撤销后继续正文'); await synced(p);
        assert(source().includes('\n\n撤销后继续正文'), '退出列表后撤销输入，光标未留在普通正文');
        await changed('Meta+z', s => !s.includes('撤销后继续正文'));
        await changed('Meta+z', s => /回车子项\n  - \[ \]/.test(s));
        await changed('Meta+z', s => s === beforeEnter);
        assert(await evaluate(p, `
          const s=d.getSelection(),n=s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement,item=n.closest('li');
          if(!item)return false;
          const r=d.createRange();r.selectNodeContents(item);r.setStart(s.anchorNode,s.anchorOffset);
          return item.textContent.trim()==='回车子项' && !r.toString().trim();
        `), '撤销首次回车后光标未留在原任务末尾');
        await changed('Meta+Shift+z', s => /回车子项\n  - \[ \]/.test(s));
        await changed('Meta+Shift+z', s => !/回车子项\n  - \[ \]/.test(s));
        await page.keyboard.insertText(label + '后的正文'); await synced(p);
        assert(source().includes('\n\n' + label + '后的正文'), '重做退出列表后光标未留在正文');
      }
      await leave(); await choose(label);
      assert.equal(await depth(label), scenario.depth, label + ' 重新渲染后层级错误');
      if (scenario.task) assert.equal(await evaluate(p, `return d.querySelector(${JSON.stringify(target(label))}).querySelector('input').checked;`), scenario.checked);
      await leave();
    }
    const deletions = [
      { label: '删除中间项', previous: '保留前项' },
      { label: '删除唯一子项', previous: '唯一父项' },
      { label: '删除留白子项', previous: '留白保留前项' },
      { label: '删除首项', previous: null },
      { label: '删除单独项', previous: null }
    ];
    const taskTree = () => evaluate(p, `return Array.from(d.querySelectorAll('li')).map(e=>{
      const text=Array.from(e.childNodes).filter(n=>!['UL','OL'].includes(n.nodeName)).map(n=>n.textContent).join('').trim();
      let parent=e,depth=0;while(parent=parent.parentElement)if(['UL','OL'].includes(parent.tagName))depth++;
      const box=e.querySelector(':scope > input, :scope > p > input');return { text, depth, task:!!box, checked:!!box?.checked };
    });`);
    for (const { label, previous } of deletions) {
      await choose(label);
      const expected = (await taskTree()).filter(item => item.text !== label);
      await evaluate(p, `
        const s=d.getSelection(),text=s.anchorNode,r=d.createRange();
        r.setStart(text,text.textContent.length-text.textContent.trimStart().length);r.setEnd(text,s.anchorOffset);
        s.removeAllRanges();s.addRange(r);return true;
      `);
      await key('Backspace');
      assert(await evaluate(p, `const item=d.querySelector(${JSON.stringify(target(label))});return !item.textContent.trim() && !!item.querySelector('input');`), '删空文字时不应一并删除 Todo');
      await taskLayout();
      const emptyIndex = await evaluate(p, `return Array.from(d.querySelectorAll('li')).indexOf(d.querySelector(${JSON.stringify(target(label))}));`);
      const clickReopenedTask = async () => {
        await reopen();
        await evaluate(p, `d.querySelectorAll('li')[${emptyIndex}].dataset.listTarget=${JSON.stringify(label)};return true;`);
        const inset = await evaluate(p, `const item=d.querySelector(${JSON.stringify(target(label))});return item.querySelector('input').getBoundingClientRect().right-item.getBoundingClientRect().left+3;`);
        await click(p, target(label), false, inset);
        assert(await evaluate(p, `
          const s=d.getSelection(),n=s.anchorNode?.nodeType===1?s.anchorNode:s.anchorNode?.parentElement;
          const item=d.querySelector(${JSON.stringify(target(label))}),text=item.querySelector('.folio-task-label');
          return s.isCollapsed && d.activeElement.isContentEditable && n?.closest('li')===item && text.contains(s.anchorNode);
        `), label + ' 重新打开后鼠标无法进入空任务');
      };
      await clickReopenedTask();
      const emptySource = source();
      await page.keyboard.insertText('重新输入'); await synced(p);
      assert(await evaluate(p, `return d.querySelector(${JSON.stringify(target(label))}).textContent.trim()==='重新输入';`), '重新打开后文字未输入到空任务');
      for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
      await synced(p); assert.equal(source(), emptySource, '重新输入并删空后任务结构改变');
      await clickReopenedTask();
      const beforeDelete = source();
      await key('Backspace');
      const afterDelete = source();
      assert.notEqual(afterDelete, beforeDelete, '空 Todo 退格没有写回');
      assert.deepEqual(await taskTree(), expected, '空任务删除影响了相邻项、层级或完成状态');
      const caretLabel = () => evaluate(p, `
        const s=d.getSelection(),n=s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement,item=n.closest('li');
        return item ? Array.from(item.childNodes).filter(n=>!['UL','OL'].includes(n.nodeName)).map(n=>n.textContent).join('').trim() : null;
      `);
      assert.equal(await caretLabel(), previous, '删除空任务后的光标位置错误');
      await changed('Meta+z', value => value === beforeDelete);
      assert.equal((await taskTree()).length, expected.length + 1, '撤销未恢复空任务');
      assert(await evaluate(p, `
        const s=d.getSelection(),n=s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement,item=n.closest('li');
        return item && !item.textContent.trim() && !!item.querySelector('input');
      `), '撤销后光标未恢复到空任务');
      await taskLayout();
      await changed('Meta+Shift+z', value => value === afterDelete);
      assert.equal(await caretLabel(), previous, '重做删除后的光标位置错误');
      const continuation = previous ? '继续输入' : label + '后的正文';
      await page.keyboard.insertText(continuation); await synced(p);
      assert(source().includes(previous ? previous + continuation : '\n\n' + continuation), '删除后无法在正确位置继续输入');
      await changed('Meta+z', value => value === afterDelete);
      assert.equal(await caretLabel(), previous, '撤销续写后的光标位置错误');
      await page.keyboard.insertText(continuation); await synced(p); await leave();
      if (previous) assert(await locate(previous + continuation));
      assert(source().includes('结束内容保持原位。'), '删除空任务误改了后续正文');
    }
    await action('folio.edit').click(); await action('folio.preview').click();
    const restored = await findPreview(round);
    await taskLayout(restored);
    assert(await evaluate(restored, "return d.querySelector('.markdown-body').textContent.includes('回车新项') && d.querySelectorAll('li ul, li ol').length >= 3;"));
    await page.screenshot({ path: path.join(evidence, `lists-round-${round}.png`) });
    result.rounds.push({
      round, status: 'passed', indentOutdent: true, mixedLists: true, preservesSubtrees: true, orderedStart: true, tasks: true, rangeSelection: true, boundaryNoop: true,
      checkboxFocusNavigation: true, undoRedoCaret: true, enterContinuesLevel: true, looseListsStayRich: true, clickWithoutMutation: true, looseTasksUndoRedo: true,
      looseIndentOutdent: true, paragraphOrder: true, looseEnter: true, doubleEnterExitsList: true, exitPreservesHierarchy: true, exitUndoRedoCaret: true,
      emptyTaskBackspace: true, deletePreservesNeighbors: true, deleteUndoRedoCaret: true, emptyTaskRowHeight: true, tasksNeverOverlap: true,
      emptyTaskReopenClick: true, emptyTaskReopenTyping: true, emptyTaskReopenBackspace: true, reopen: true
    });
    fs.writeFileSync(path.join(runtime, `lists-${round}-done`), '');
  }
  await stage('complete'); result.status = 'passed';
  fs.writeFileSync(path.join(evidence, 'lists-ui-verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
