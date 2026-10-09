(() => {
  'use strict';
  const escapeText = text => text.replace(/([\\`*_[\]<>~])/g, '\\$1').replace(/^(\s*)(#{1,6}|[-+]|\d+\.)\s/gm, '$1\\$2 ');
  const inline = node => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent.replace(/\u00a0/g, ' '));
    if (!(node instanceof Element)) return '';
    const inner = () => Array.from(node.childNodes, inline).join('');
    const tag = node.tagName.toLowerCase();
    if (node.matches('.folio-copy, .folio-code-header, .folio-block-tools, input')) return '';
    if (tag === 'br') return '  \n';
    if (tag === 'strong' || tag === 'b') return `**${inner()}**`;
    if (tag === 'em' || tag === 'i') return `*${inner()}*`;
    if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${inner()}~~`;
    if (tag === 'mark') return `==${inner()}==`;
    if (tag === 'sup') return `^${inner()}^`;
    if (tag === 'sub') return `~${inner()}~`;
    if (tag === 'code') {
      const value = node.textContent;
      const fence = '`'.repeat(Math.max(0, ...(value.match(/`+/g) || []).map(part => part.length)) + 1);
      const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
      return `${fence}${padding}${value}${padding}${fence}`;
    }
    const title = node.hasAttribute('title') ? ` "${node.getAttribute('title').replace(/([\\"])/g, '\\$1')}"` : '';
    if (tag === 'a') return `[${inner()}](${(node.getAttribute('data-href') || node.getAttribute('href') || '').replace(/([()\\])/g, '\\$1')}${title})`;
    if (tag === 'img') return `![${escapeText(node.getAttribute('alt') || '')}](${(node.getAttribute('data-href') || node.getAttribute('src') || '').replace(/([()\\])/g, '\\$1')}${title})`;
    return inner();
  };
  function serialize(node) {
    if (node.nodeType === Node.TEXT_NODE) return inline(node);
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    if (node.matches('.folio-block-tools, .folio-code-header, button, input')) return '';
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${Array.from(node.childNodes, inline).join('').trim()}\n\n`;
    if (tag === 'p') return `${Array.from(node.childNodes, inline).join('').trimEnd()}\n\n`;
    if (tag === 'pre') {
      const code = node.textContent.replace(/\n$/, '');
      const fence = '`'.repeat(Math.max(2, ...(code.match(/`+/g) || []).map(part => part.length)) + 1);
      const language = node.querySelector('code')?.className.match(/language-([\w+-]+)/)?.[1] || '';
      return `${fence}${language}\n${code}\n${fence}\n\n`;
    }
    if (tag === 'ul' || tag === 'ol') {
      let index = Number(node.getAttribute('start')) || 1;
      const items = Array.from(node.children).filter(child => child.tagName === 'LI');
      const loose = items.some(item => Array.from(item.children).some(child => child.tagName === 'P'));
      return items.map(item => {
        const marker = tag === 'ol' ? `${index++}. ` : '- ';
        const checkbox = item.querySelector(':scope > input, :scope > p > input');
        // Loose items may have paragraphs before and after child lists; keep those blocks in DOM order.
        const parts = [];
        let text = '';
        const flushText = () => { if (text.trim()) parts.push({ kind: 'inline', text: text.trim() }); text = ''; };
        for (const child of item.childNodes) {
          if (child instanceof Element && /^(P|H[1-6]|UL|OL|PRE|BLOCKQUOTE|DIV|HR)$/.test(child.tagName)) {
            flushText();
            parts.push({ kind: /^(UL|OL)$/.test(child.tagName) ? 'list' : 'block', text: serialize(child).trim() });
          } else text += inline(child);
        }
        flushText();
        const body = parts.map((part, i) => (i ? part.kind === 'list' && parts[i - 1].kind === 'inline' ? '\n' : '\n\n' : '') + part.text).join('');
        const lines = ((checkbox ? `[${checkbox.checked ? 'x' : ' '}] ` : '') + body).split('\n');
        return marker + lines.map((line, i) => i && line ? ' '.repeat(marker.length) + line : line).join('\n');
      }).join(loose ? '\n\n' : '\n') + '\n\n';
    }
    if (tag === 'blockquote') return Array.from(node.childNodes).filter(child => child.nodeType !== Node.TEXT_NODE || child.textContent.trim())
      .map(serialize).join('').trimEnd().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (tag === 'hr') return '---\n\n';
    if (tag === 'div' && !Array.from(node.children).some(child => /^(P|H[1-6]|UL|OL|PRE|BLOCKQUOTE|DIV|HR)$/.test(child.tagName))) return inline(node) + '\n\n';
    return Array.from(node.childNodes, serialize).join('');
  }

  const modules = [
    ['text', '文本', 'T', 'text paragraph wenben', '基础', 'blue'],
    ...['一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题'].map((label, i) => [`h${i + 1}`, label, `H${i + 1}`, `heading title biaoti ${i + 1}`, '基础', ['accent', 'blue', 'teal', 'peach', 'yellow', 'pink'][i]]),
    ['ordered', '有序列表', '1.', 'ordered list youxu', '基础', 'peach'],
    ['bullet', '无序列表', '≡', 'unordered bullet list wuxu', '基础', 'teal'],
    ['code', '代码块', '{ }', 'code daima', '基础', 'green'],
    ['quote', '引用', '“', 'blockquote quote yinyong', '基础', 'teal'],
    ['divider', '分隔线', '—', 'divider horizontal fengexian', '基础', 'peach'],
    ['link', '链接', '↗', 'link lianjie', '常用', 'blue'],
    ['task', '任务', '☑', 'todo task checklist renwu', '常用', 'green'],
    ['image', '图片', '▧', 'image photo tupian', '常用', 'yellow'],
    ['table', '表格', '▦', 'table biaoge', '常用', 'blue']
  ];

  window.FolioEditor = function ({ host, showError, applyContent, enhance }) {
    const main = document.querySelector('.markdown-body');
    const pending = new Map();
    const waiters = [];
    const listExits = [];
    let source = '', writable = true, active = null, deferred = null, sequence = 0, composing = false, conflicted = false, menuState = null;
    let historyVersion = 0, historyCaret = null;
    const menu = document.createElement('div');
    menu.className = 'folio-insert-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox'); menu.id = 'folio-insert-menu'; menu.setAttribute('aria-label', '插入模块');
    const footer = document.createElement('div');
    footer.className = 'folio-editor-feedback'; footer.setAttribute('role', 'status'); footer.hidden = true;
    const recovery = document.createElement('div'); recovery.className = 'folio-recovery'; recovery.hidden = true;
    const copy = document.createElement('button'); copy.textContent = '复制草稿';
    const reload = document.createElement('button'); reload.textContent = '放弃草稿并刷新';
    recovery.append(copy, reload); document.body.append(menu, footer, recovery);
    const eol = () => source.includes('\r\n') ? '\r\n' : '\n';
    const state = () => host.getState() || {};
    const draft = () => active ? source.slice(0, active.start) + value() + source.slice(active.end) : source || state().draft?.markdown || '';
    function feedback(text) { footer.textContent = text; footer.hidden = !text; }
    function remember() { host.setState({ ...state(), draft: { markdown: draft() } }); }
    function fail(message) { conflicted = true; closeMenu(); showError(message); feedback('草稿未同步'); recovery.hidden = false; remember(); settle(); }
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(draft()); copy.textContent = '草稿已复制'; } catch { showError('复制失败，请选中编辑内容后手动复制。'); }
    });
    reload.addEventListener('click', () => {
      conflicted = false; pending.clear(); active = null; recovery.hidden = true; host.setState({ ...state(), draft: null }); showError(''); feedback(''); host.postMessage({ type: 'ready' });
    });
    function offsets(text) {
      const result = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') result.push(i + 1); result.push(text.length); return result;
    }
    function attach(message) {
      source = message.source || ''; writable = message.writable !== false;
      const lines = offsets(source);
      for (const block of main.querySelectorAll('.folio-block')) {
        block.dataset.sourceStart = lines[Number(block.dataset.startLine)] ?? source.length;
        block.dataset.sourceEnd = lines[Number(block.dataset.endLine)] ?? source.length;
        const content = block.querySelector('.folio-block-content');
        if (writable) { content.tabIndex = 0; content.setAttribute('aria-label', '编辑此内容'); }
      }
      if (writable && !source.trim()) appendEmptyBlock();
      if (historyCaret) { restoreCaret(historyCaret); historyCaret = null; }
      if (state().draft?.markdown && !pending.size && !active) { recovery.hidden = false; showError('有一份未同步的草稿，可复制后继续编辑，或放弃草稿并刷新。'); }
    }
    function captureCaret() {
      if (!active) return null;
      if (active.raw) return { start: active.start, offset: active.input.selectionStart, raw: true };
      const selection = window.getSelection();
      const focused = document.activeElement;
      let target = focused !== active.input && active.content.contains(focused) ? focused : selection.anchorNode;
      if (!target || !active.content.contains(target)) target = active.content;
      while (target !== active.content && target.parentNode !== active.content) target = target.parentNode;
      const range = document.createRange(); range.selectNodeContents(target);
      if (selection.anchorNode && target.contains(selection.anchorNode)) range.setEnd(selection.anchorNode, selection.anchorOffset);
      const siblings = Array.from(active.content.childNodes);
      const before = target === active.content ? '' : siblings.slice(0, siblings.indexOf(target)).map(serialize).join('');
      const start = active.start + (active.changed ? (active.prefix + before).replace(/\r?\n/g, eol()).length : 0);
      const saved = { start, offset: range.toString().length, atEnd: range.toString().length === target.textContent.length, raw: false };
      const item = (selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement)?.closest('li');
      if (item && target.contains(item)) {
        // Rendering nested lists adds whitespace nodes; restore by item and its own text, not those formatting newlines.
        saved.listItem = Array.from(target.querySelectorAll('li')).indexOf(item);
        saved.itemOffset = ownItemText(item).reduce((offset, node) => offset + (node === selection.anchorNode ? selection.anchorOffset
          : range.comparePoint(node, node.textContent.length) <= 0 ? node.textContent.length : 0), 0);
      }
      return saved;
    }
    function ownItemText(item) {
      const nodes = [], walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (node.textContent.trim() && node.parentElement.closest('li') === item) nodes.push(node);
      return nodes;
    }
    function restoreCaret(saved) {
      const blocks = Array.from(main.querySelectorAll('.folio-block'));
      const block = blocks.find(item => Number(item.dataset.sourceStart) === saved.start)
        || blocks.find(item => Number(item.dataset.sourceStart) <= saved.start && Number(item.dataset.sourceEnd) > saved.start) || blocks.at(-1);
      if (!block || !open(block)) return;
      active.input.focus({ preventScroll: true });
      if (active.raw) { const offset = Math.min(saved.offset, active.input.value.length); active.input.setSelectionRange(offset, offset); return; }
      if (saved.afterList) {
        // Empty paragraphs have no Markdown token; recreate the writing position when undo/redo returns here.
        const list = active.content.querySelector(':scope > ul, :scope > ol');
        if (list) {
          const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); list.after(paragraph);
          active.lastHTML = active.content.innerHTML; caretEnd(paragraph); return;
        }
        caretEnd(active.content); return;
      }
      if (Number.isInteger(saved.listItem) && saved.listItem >= 0) {
        const items = Array.from(active.content.querySelectorAll('li')), item = items[Math.min(saved.listItem, items.length - 1)];
        if (item) {
          const nodes = ownItemText(item), range = document.createRange();
          let offset = saved.listItem >= items.length ? nodes.reduce((length, node) => length + node.textContent.length, 0) : saved.itemOffset;
          range.selectNodeContents(item); range.collapse(true);
          for (const node of nodes) {
            range.setStart(node, Math.min(offset, node.textContent.length)); range.collapse(true);
            if (offset <= node.textContent.length) break;
            offset -= node.textContent.length;
          }
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
        }
      }
      if (saved.atEnd) { caretEnd(active.content); return; }
      let remaining = saved.offset;
      const walker = document.createTreeWalker(active.content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (remaining <= node.textContent.length) {
          const range = document.createRange(); range.setStart(node, remaining); range.collapse(true);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
        }
        remaining -= node.textContent.length;
      }
      caretEnd(active.content);
    }
    function open(block, focus = false) {
      if (!writable || conflicted || composing) return false;
      if (active?.block === block) { if (focus) active.input.focus(); return true; }
      finish(false);
      const start = Number(block.dataset.sourceStart), end = Number(block.dataset.sourceEnd);
      const original = source.slice(start, end);
      const content = block.querySelector('.folio-block-content');
      active = { block, content, input: content, start, end, tail: original.match(/(?:\r?\n)*$/)?.[0] || '', prefix: block.dataset.prefix || '', raw: block.dataset.editMode === 'source', changed: false, lastHTML: content.innerHTML };
      block.classList.add('is-editing');
      if (active.raw) {
        content.hidden = true;
        const input = document.createElement('textarea'); input.className = 'folio-source-input'; input.setAttribute('aria-label', '编辑此块的 Markdown'); input.spellcheck = false;
        input.value = original; block.prepend(input); active.input = input; resize(); input.focus();
      } else {
        content.contentEditable = 'true'; content.setAttribute('role', 'textbox'); content.setAttribute('aria-multiline', 'true'); content.spellcheck = false;
        document.execCommand('defaultParagraphSeparator', false, 'p');
      }
      feedback(''); enhance();
      if (focus) { active.input.focus(); if (!active.raw) caretEnd(content); }
      return true;
    }
    function caretEnd(element) {
      const leaf = Array.from(element.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, code')).at(-1) || element;
      const range = document.createRange(); range.selectNodeContents(leaf); range.collapse(false);
      if (leaf.lastChild?.nodeName === 'BR') { range.setStartBefore(leaf.lastChild); range.collapse(true); }
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.closest('[contenteditable]')?.focus();
    }
    function resize() { if (active?.raw) { active.input.style.height = 'auto'; active.input.style.height = `${Math.max(70, active.input.scrollHeight)}px`; } }
    function value() {
      if (!active) return '';
      if (active.raw) return active.input.value.replace(/\r?\n/g, eol());
      return active.prefix + Array.from(active.content.childNodes, serialize).join('').trimEnd().replace(/\r?\n/g, eol()) + active.tail;
    }
    function sync(force = false) {
      if (!active || conflicted || composing) return;
      if (!active.raw && !force && active.lastHTML === active.content.innerHTML) return;
      active.lastHTML = active.content.innerHTML;
      const text = value(), before = source.slice(active.start, active.end);
      if (text === before) return;
      const message = { type: 'edit', id: ++sequence, historyVersion, start: active.start, end: active.end, base: source, text };
      const delta = text.length - (active.end - active.start);
      for (const block of main.querySelectorAll('.folio-block')) {
        if (block === active.block) block.dataset.sourceEnd = active.end + delta;
        else if (Number(block.dataset.sourceStart) >= active.end) {
          block.dataset.sourceStart = Number(block.dataset.sourceStart) + delta; block.dataset.sourceEnd = Number(block.dataset.sourceEnd) + delta;
        }
      }
      source = source.slice(0, active.start) + text + source.slice(active.end); active.end += delta; active.changed = true;
      pending.set(message.id, message); remember(); host.postMessage(message); feedback('同步中…'); enhance();
    }
    function finish(refresh = true) {
      if (!active || composing) return;
      sync(); closeMenu(); active.block.classList.remove('is-editing'); active.content.contentEditable = 'false'; active.content.removeAttribute('role');
      if (active.raw) { active.input.readOnly = true; active.input.classList.add('is-settling'); }
      if (conflicted) return;
      active = null; enhance();
      if (refresh) settle();
    }
    function settle() {
      if (pending.size && !conflicted) return;
      for (const resolve of waiters.splice(0)) resolve(!conflicted);
      if (!conflicted && !active && deferred?.source === source) { const message = deferred; deferred = null; applyContent(message); feedback(''); }
    }
    async function flush() {
      if (composing) return false;
      sync();
      if (!pending.size || conflicted) return !conflicted;
      return new Promise(resolve => waiters.push(resolve));
    }
    function receive(message) {
      if (!message || typeof message !== 'object') return false;
      if (message.type === 'edit-result') {
        if (!pending.has(message.id)) return true;
        pending.delete(message.id);
        if (!message.ok && (message.historyVersion || 0) <= historyVersion) fail(message.error || '同步失败，草稿已保留。');
        else if (!pending.size && !conflicted) { host.setState({ ...state(), draft: null }); feedback('已同步'); enhance(); settle(); }
        return true;
      }
      if (message.type === 'flush') { void flush().then(ok => host.postMessage({ type: 'flushed', id: message.id, ok })); return true; }
      if (message.type === 'save-result') { if (!message.ok) showError(message.error); else feedback('已保存'); return true; }
      if (message.type !== 'content') return false;
      if ((message.historyVersion || 0) > historyVersion) {
        historyCaret = captureCaret();
        for (const exit of [...listExits].reverse()) {
          if (message.historyReason === 'undo' && source === exit.after && message.source === exit.before) { historyCaret = exit.beforeCaret; break; }
          if (message.source === exit.after && (message.historyReason === 'redo' && source === exit.before
            || message.historyReason === 'undo' && source !== exit.before)) { historyCaret = exit.afterCaret; break; }
        }
        historyVersion = message.historyVersion;
        closeMenu(); active = null; deferred = null; composing = false; conflicted = false; pending.clear();
        recovery.hidden = true; host.setState({ ...state(), draft: null }); showError(''); feedback(''); settle();
        return false;
      }
      if (active || pending.size || conflicted) {
        deferred = message;
        const expected = message.source === source || Array.from(pending.values()).some(item => item.base === message.source || item.base.slice(0, item.start) + item.text + item.base.slice(item.end) === message.source);
        if (!expected && active?.changed && !conflicted) fail('源文件已被其他编辑更新，草稿已保留。请复制草稿后重新载入。');
        if (!expected && active && !active.changed && !pending.size) { active = null; return false; }
        settle(); return true;
      }
      return false;
    }
    function appendEmptyBlock() {
      if (!writable || conflicted || composing) return;
      finish(false);
      const start = source.length;
      const prefix = source.slice(0, start).endsWith(eol() + eol()) || start === 0 ? '' : source.slice(0, start).endsWith(eol()) ? eol() : eol() + eol();
      const block = document.createElement('section'); block.className = 'folio-block'; block.dataset.editMode = 'rich'; block.dataset.sourceStart = start; block.dataset.sourceEnd = start;
      block.dataset.prefix = prefix; block.innerHTML = '<div class="folio-block-content"><p><br></p></div>';
      main.append(block);
      open(block, true); active.tail = eol() + eol(); return block;
    }
    function lineAtCaret() {
      const selection = window.getSelection(); if (!active || active.raw || !selection.rangeCount) return null;
      const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
      let line = node?.closest('p, h1, h2, h3, h4, h5, h6, li, pre');
      if (!line || !active.content.contains(line) || line.closest('pre')) return null;
      if (line.tagName === 'P' && line.parentElement.tagName === 'LI') line = line.parentElement;
      const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(line); range.setEnd(selection.anchorNode, selection.anchorOffset);
      return { line, before: range.toString(), range: selection.getRangeAt(0).cloneRange() };
    }
    function enterList() {
      if (active.raw || conflicted || !writable) return false;
      const selection = window.getSelection();
      if (!selection.isCollapsed || !selection.rangeCount) return false;
      const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
      const item = node?.closest('li');
      if (!item || !active.content.contains(item) || node.closest('pre, blockquote')) return false;
      const empty = !item.textContent.trim() && !item.querySelector('ul, ol, img, pre, table, hr');
      if (empty) {
        // Chromium's native empty-item Enter can lift the previous child list out of its parent.
        // Remove only the empty item and place a plain paragraph after the complete list.
        let root = item.parentElement;
        while (root.parentElement.tagName === 'LI') root = root.parentElement.parentElement;
        const before = source, beforeCaret = captureCaret();
        const preceding = Array.from(active.content.childNodes).slice(0, Array.from(active.content.childNodes).indexOf(root)).map(serialize).join('');
        const afterCaret = { start: active.start + (active.prefix + preceding).replace(/\r?\n/g, eol()).length, raw: false, afterList: true };
        const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); root.after(paragraph);
        let container = item.parentElement;
        item.remove();
        while (container !== active.content && !container.textContent.trim() && !container.querySelector('li, input, img')) {
          const parent = container.parentElement; container.remove(); container = parent;
        }
        active.content.focus(); caretEnd(paragraph); sync();
        listExits.push({ before, after: source, beforeCaret, afterCaret });
        if (listExits.length > 16) listExits.shift();
        return true;
      }
      const after = selection.getRangeAt(0).cloneRange(); after.selectNodeContents(item); after.setStart(selection.anchorNode, selection.anchorOffset);
      const remaining = after.cloneContents(); remaining.querySelectorAll('ul, ol').forEach(list => list.remove());
      if (remaining.textContent.trim() || remaining.querySelector('img, pre, table, hr')) return false;
      const next = document.createElement('li');
      const paragraph = item.querySelector(':scope > p') ? document.createElement('p') : next;
      if (paragraph !== next) next.append(paragraph);
      let text = paragraph;
      if (item.querySelector(':scope > input, :scope > p > input')) {
        next.className = 'task-list-item';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'task-list-item-checkbox';
        checkbox.setAttribute('aria-label', '完成：待办');
        text = document.createElement('label'); text.className = 'folio-task-label'; paragraph.append(checkbox, text);
      }
      text.append(document.createElement('br')); item.after(next);
      active.content.focus(); caretEnd(text); sync(); return true;
    }
    function changeListLevel(outdent) {
      if (active.raw || conflicted || !writable) return false;
      const selection = window.getSelection();
      const itemAt = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('li');
      let first = itemAt(selection.anchorNode), last = itemAt(selection.focusNode);
      if (!first || !last || !active.content.contains(first) || !active.content.contains(last)) return false;
      // Lift both ends to their nearest common list so a selection moves whole items, including children.
      let list = first.parentElement;
      while (!list.contains(last) && list.parentElement.closest('li')) list = list.parentElement.closest('li').parentElement;
      if (!list.contains(last)) return false;
      while (first.parentElement !== list) first = first.parentElement.closest('li');
      while (last.parentElement !== list) last = last.parentElement.closest('li');
      const siblings = Array.from(list.children).filter(node => node.tagName === 'LI');
      const ends = [siblings.indexOf(first), siblings.indexOf(last)].sort((a, b) => a - b);
      const items = siblings.slice(ends[0], ends[1] + 1);
      const saved = { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset, focus: selection.focusNode, focusOffset: selection.focusOffset };
      const childList = parent => {
        const existing = parent.lastElementChild;
        if (existing?.tagName === list.tagName) return existing;
        const nested = document.createElement(list.tagName.toLowerCase()); parent.append(nested); return nested;
      };
      if (outdent) {
        const parent = list.parentElement;
        // The outermost level has nowhere to move; keep focus and do not turn the list into prose.
        if (parent.tagName !== 'LI') return true;
        const trailing = siblings.slice(ends[1] + 1);
        if (trailing.length) childList(items.at(-1)).append(...trailing);
        parent.after(...items);
        if (!list.querySelector(':scope > li')) list.remove();
      } else {
        const previous = siblings[ends[0] - 1];
        if (!previous) return true;
        childList(previous).append(...items);
      }
      active.input.focus({ preventScroll: true });
      selection.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
      sync();
      return true;
    }
    function closeMenu() {
      menu.hidden = true; menuState = null;
      active?.input.removeAttribute('aria-activedescendant'); active?.input.removeAttribute('aria-controls'); active?.input.removeAttribute('aria-expanded');
    }
    function updateMenu(force = false) {
      if (composing || conflicted || active?.raw) return;
      const location = lineAtCaret();
      const match = location && /^[/、]([^\n/、]{0,50})$/.exec(location.before);
      if (!location || (!match && !force)) { closeMenu(); return; }
      const query = match ? match[1].toLowerCase() : '';
      const items = modules.filter(item => `${item[0]} ${item[1]} ${item[3]}`.toLowerCase().includes(query));
      const selected = menuState?.query === query ? Math.min(menuState.selected, items.length - 1) : 0;
      const opening = menu.hidden;
      menuState = { ...location, query, trigger: Boolean(match), items, selected: Math.max(0, selected) };
      menu.replaceChildren();
      const search = document.createElement('div'); search.className = 'folio-menu-query'; search.textContent = query ? `搜索：${match[1]}` : '输入关键词筛选'; menu.append(search);
      let group;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item[4] !== group) { group = item[4]; const label = document.createElement('div'); label.className = 'folio-menu-group'; label.textContent = group; menu.append(label); }
        const button = document.createElement('button'); button.type = 'button'; button.className = 'folio-menu-item'; button.id = `folio-option-${item[0]}`; button.dataset.module = item[0];
        button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(i === menuState.selected));
        const icon = document.createElement('span'); icon.className = 'folio-module-icon'; icon.style.color = `var(--folio-${item[5]})`; icon.textContent = item[2];
        const label = document.createElement('span'); label.textContent = item[1]; button.append(icon, label); menu.append(button);
      }
      if (!items.length) { const empty = document.createElement('p'); empty.className = 'folio-menu-empty'; empty.textContent = '没有匹配的模块'; menu.append(empty); }
      const hint = document.createElement('div'); hint.className = 'folio-menu-hint'; hint.textContent = '↑↓ 选择　↵ 插入　Esc 关闭'; menu.append(hint);
      menu.hidden = false; menu.classList.toggle('is-opening', opening); positionMenu();
      active.input.setAttribute('aria-controls', menu.id); active.input.setAttribute('aria-expanded', 'true'); highlight();
    }
    function positionMenu() {
      if (!menuState || menu.hidden) return;
      const rect = menuState.range.getBoundingClientRect(); const fallback = menuState.line.getBoundingClientRect(); const anchor = rect.height ? rect : fallback;
      const gap = 7, safe = 12, width = Math.min(288, innerWidth - safe * 2);
      const below = innerHeight - anchor.bottom - gap - safe, above = anchor.top - gap - safe;
      const up = below < 240 && above > below;
      menu.style.width = `${width}px`; menu.style.maxHeight = `${Math.max(120, Math.min(440, up ? above : below))}px`;
      menu.style.left = `${Math.max(safe, Math.min(anchor.left, innerWidth - width - safe))}px`;
      menu.style.top = `${Math.max(safe, up ? anchor.top - gap - menu.offsetHeight : anchor.bottom + gap)}px`;
      menu.style.transformOrigin = up ? 'bottom left' : 'top left';
    }
    function highlight() {
      const items = menu.querySelectorAll('.folio-menu-item');
      items.forEach((item, index) => item.setAttribute('aria-selected', String(index === menuState.selected)));
      const selected = items[menuState.selected];
      if (selected) { active.input.setAttribute('aria-activedescendant', selected.id); selected.scrollIntoView({ block: 'nearest' }); }
    }
    function replaceLine(node, target, focus = true) {
      if (target.tagName === 'LI' && /^(UL|OL)$/.test(target.parentElement.tagName)) {
        const list = target.parentElement;
        if (list.children.length === 1) list.replaceWith(node);
        else { const tail = list.cloneNode(false); while (target.nextElementSibling) tail.append(target.nextElementSibling); target.remove(); list.after(node); if (!list.children.length) list.remove(); if (tail.children.length) node.after(tail); }
      } else target.replaceWith(node);
      if (focus) { active.content.focus(); caretEnd(node); }
      sync();
    }
    function selectModule(id) {
      if (!menuState) return;
      const target = menuState.line; const trigger = menuState.trigger;
      const remainder = trigger ? target.textContent.slice(menuState.before.length) : target.textContent;
      const preserved = !trigger && /^(P|H[1-6])$/.test(target.tagName) ? Array.from(target.childNodes, node => node.cloneNode(true)) : null;
      closeMenu();
      if (id === 'link' || id === 'image') { resourceForm(id, target, remainder); return; }
      let node;
      if (id === 'bullet' || id === 'ordered' || id === 'task') {
        node = document.createElement(id === 'ordered' ? 'ol' : 'ul'); const item = document.createElement('li');
        if (id === 'task') { item.className = 'task-list-item'; const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'task-list-item-checkbox'; item.append(check); }
        item.append(document.createTextNode(remainder)); if (!remainder) item.append(document.createElement('br')); node.append(item);
      } else if (id === 'quote') {
        node = document.createElement('blockquote'); const paragraph = document.createElement('p'); paragraph.textContent = remainder; if (!remainder) paragraph.append(document.createElement('br')); node.append(paragraph);
      } else if (id === 'code') {
        node = document.createElement('pre'); const code = document.createElement('code'); code.textContent = remainder || '\n'; node.append(code);
      } else if (id === 'divider') {
        node = document.createElement('div'); node.append(document.createElement('hr')); const p = document.createElement('p'); p.textContent = remainder; if (!remainder) p.append(document.createElement('br')); node.append(p);
      } else if (id === 'table') {
        node = document.createElement('p'); node.textContent = `| 列一 | 列二 |\n| --- | --- |\n| ${remainder.replace(/\|/g, '\\|') || '内容'} | 内容 |`;
        replaceLine(node, target, false);
        // Tables use the source editor so alignment, escapes and extended cell syntax remain intact.
        const markdown = value().replace(/\\\|/g, '|');
        active.content.hidden = true; active.raw = true; const input = document.createElement('textarea'); input.className = 'folio-source-input'; input.setAttribute('aria-label', '编辑表格 Markdown');
        input.value = markdown; active.block.prepend(input); active.input = input; resize(); input.focus(); sync(); return;
      } else { node = document.createElement(/^h[1-6]$/.test(id) ? id : 'p'); node.textContent = remainder; if (!remainder) node.append(document.createElement('br')); }
      if (preserved && !['code', 'divider'].includes(id)) (node.querySelector('li, p') || node).replaceChildren(...preserved);
      replaceLine(node, target);
    }
    function resourceForm(kind, target, text) {
      const form = document.createElement('form'); form.className = 'folio-resource-form'; form.setAttribute('aria-label', kind === 'image' ? '插入图片' : '插入链接');
      const title = document.createElement('strong'); title.textContent = kind === 'image' ? '插入图片' : '插入链接';
      const nameLabel = document.createElement('label'); nameLabel.textContent = kind === 'image' ? '图片说明' : '链接文字';
      const name = document.createElement('input'); name.value = text; name.placeholder = kind === 'image' ? '图片内容' : '显示文字'; nameLabel.append(name);
      const urlLabel = document.createElement('label'); urlLabel.textContent = kind === 'image' ? '图片网址或相对路径' : '链接地址';
      const url = document.createElement('input'); url.required = true; url.placeholder = kind === 'image' ? './images/photo.png' : 'https://'; urlLabel.append(url);
      const actions = document.createElement('div'); const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = '插入'; actions.append(cancel, submit); form.append(title, nameLabel, urlLabel, actions);
      active.block.append(form); url.focus();
      const close = () => { form.remove(); active?.content.focus(); if (target.isConnected) caretEnd(target); };
      cancel.onclick = close;
      form.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
      form.onsubmit = event => {
        event.preventDefault(); const address = url.value.trim();
        if (/^[a-z][a-z\d+.-]*:/i.test(address) && !/^(https?:|mailto:|file:)/i.test(address)) { url.setCustomValidity('请输入网页地址或文件路径'); url.reportValidity(); return; }
        const p = document.createElement('p');
        if (kind === 'image') { const img = document.createElement('img'); img.setAttribute('src', address); img.alt = name.value; p.append(img); }
        else { const link = document.createElement('a'); link.setAttribute('href', address); link.textContent = name.value || address; p.append(link); }
        form.remove(); replaceLine(p, target);
      };
      url.oninput = () => url.setCustomValidity('');
    }
    menu.addEventListener('mousedown', event => event.preventDefault());
    menu.addEventListener('click', event => { const button = event.target.closest('[data-module]'); if (button) selectModule(button.dataset.module); });
    document.addEventListener('pointerdown', event => {
      if (!(event.target instanceof Element) || menu.contains(event.target) || recovery.contains(event.target) || event.target.closest('.folio-resource-form')) return;
      if (event.altKey) { finish(); return; }
      if (event.target.closest('input, a, button, summary, textarea')) return;
      const block = event.target.closest('.folio-block');
      if (block) {
        if (open(block) && active.raw) { event.preventDefault(); active.input.focus(); }
      } else finish();
    });
    main.addEventListener('click', event => {
      if (active?.content.contains(event.target) && event.target.closest('label.folio-task-label')) event.preventDefault();
    });
    main.addEventListener('input', event => { if (active?.input.contains(event.target) || active?.input === event.target) { resize(); if (!composing && !event.isComposing) { sync(); updateMenu(); } } });
    main.addEventListener('compositionstart', () => { composing = true; closeMenu(); });
    main.addEventListener('compositionend', () => { composing = false; sync(); updateMenu(); });
    main.addEventListener('paste', event => {
      if (!active || active.raw || !active.content.contains(event.target)) return;
      event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); sync();
    });
    document.addEventListener('keydown', event => {
      if (event.isComposing || composing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && active) { event.preventDefault(); event.stopPropagation(); void flush().then(ok => { if (ok) host.postMessage({ type: 'save' }); }); return; }
      if (event.target.closest?.('.folio-resource-form')) return;
      if (event.key === 'Enter' && event.target.classList?.contains('folio-block-content') && active?.content !== event.target) { event.preventDefault(); open(event.target.closest('.folio-block'), true); return; }
      if (!active) return;
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey && event.target.isContentEditable
        && !event.target.closest('input, button, textarea, select') && changeListLevel(event.shiftKey)) {
        event.preventDefault(); event.stopPropagation(); closeMenu(); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '/') { event.preventDefault(); updateMenu(true); return; }
      if (!menu.hidden) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); menuState.selected = Math.max(0, Math.min(menuState.items.length - 1, menuState.selected + (event.key === 'ArrowDown' ? 1 : -1))); highlight(); }
        else if (event.key === 'Enter' && menuState.items.length) { event.preventDefault(); selectModule(menuState.items[menuState.selected][0]); }
        else if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !active.raw
        && !event.target.closest('input, button, textarea, select')) {
        if (enterList()) { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
        const location = lineAtCaret();
        if (location && /^H[1-6]$/.test(location.line.tagName) && window.getSelection().isCollapsed && location.before === location.line.textContent) {
          event.preventDefault(); const p = document.createElement('p'); p.append(document.createElement('br')); location.line.after(p); caretEnd(p); sync(); return;
        }
      }
      if (event.key === 'Escape') { event.preventDefault(); active.input.blur(); finish(); }
    }, true);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, { passive: true });
    window.addEventListener('beforeunload', () => { sync(); if (pending.size || conflicted) remember(); });
    return {
      attach, receive, flush,
      owns: node => Boolean(active?.content.contains(node)),
      allowTask: node => !conflicted && (active?.content.contains(node) || (!active && !pending.size)),
      handleTask: node => { if (active?.content.contains(node)) { sync(true); return true; } return false; },
      get editing() { return Boolean(active); }
    };
  };
})();
