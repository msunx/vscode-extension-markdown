(() => {
  'use strict';
  const escapeText = text => text.replace(/([\\`*_[\]<>~])/g, '\\$1').replace(/^(\s*)(#{1,6}|[-+]|\d+\.)(?=\s|$)/gm, '$1\\$2');
  const adjacentCharacter = (node, previous) => {
    while (node) {
      const sibling = previous ? node.previousSibling : node.nextSibling;
      if (sibling) {
        if (sibling.nodeName === 'BR') return ' ';
        if (sibling.textContent) return previous ? [...sibling.textContent].at(-1) : [...sibling.textContent][0];
        node = sibling;
      } else {
        node = node.parentElement;
        if (!node?.matches('span, strong, b, em, i, u, s, del, strike, code, mark, a, sup, sub, font')) return '';
      }
    }
    return '';
  };
  const marked = (marker, text, node) => text.trim() ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, before, body, after) => {
    const punctuation = character => /[\p{P}\p{S}]/u.test(character || ''), word = character => character && !/\s/u.test(character) && !punctuation(character);
    // A delimiter beside punctuation inside a word is literal Markdown. Use semantic HTML for that selection so formatting survives reopening.
    if (!before && punctuation([...body][0]) && word(adjacentCharacter(node, true)) || !after && punctuation([...body].at(-1)) && word(adjacentCharacter(node, false))) {
      const tag = { '**': 'strong', '*': 'em', '~~': 's', '==': 'mark' }[marker];
      return `${before}<${tag}>${body}</${tag}>${after}`;
    }
    return `${before}${marker}${body}${marker}${after}`;
  }) : text;
  const inline = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\u00a0/g, ' ');
      // Markdown-it emits a formatting newline after <br>; the break itself already serializes that newline.
      return escapeText(node.previousSibling?.nodeName === 'BR' ? text.replace(/^\r?\n/, '') : text);
    }
    if (!(node instanceof Element)) return '';
    const inner = () => Array.from(node.childNodes, inline).join('');
    const tag = node.tagName.toLowerCase();
    if (node.matches('.folio-copy, .folio-code-header, .folio-block-tools, button, input')) return '';
    if (tag === 'br') return '  \n';
    if (tag === 'strong' || tag === 'b') return marked('**', inner(), node);
    if (tag === 'em' || tag === 'i') return marked('*', inner(), node);
    if (tag === 'del' || tag === 's' || tag === 'strike') return marked('~~', inner(), node);
    if (tag === 'mark') return marked('==', inner(), node);
    if (tag === 'u') return `<u>${inner()}</u>`;
    if (tag === 'span' || tag === 'font') {
      const color = window.FolioFormatting.color(node.style.color || node.getAttribute('color')), background = window.FolioFormatting.color(node.style.backgroundColor);
      const style = [color && `color:${color}`, background && `background-color:${background}`].filter(Boolean).join(';');
      return style ? `<span style="${style}">${inner()}</span>` : inner();
    }
    if (tag === 'sup') return `^${inner()}^`;
    if (tag === 'sub') return `~${inner()}~`;
    if (tag === 'code') {
      const value = node.textContent;
      const fence = '`'.repeat(Math.max(0, ...(value.match(/`+/g) || []).map(part => part.length)) + 1);
      const padding = value.startsWith('`') || value.endsWith('`') || value.startsWith(' ') && value.endsWith(' ') && value.trim() ? ' ' : '';
      return `${fence}${padding}${value}${padding}${fence}`;
    }
    const title = node.hasAttribute('title') ? ` "${node.getAttribute('title').replace(/([\\"])/g, '\\$1')}"` : '';
    if (tag === 'a') return `[${inner()}](${(node.getAttribute('data-href') || node.getAttribute('href') || '').replace(/([()\\])/g, '\\$1')}${title})`;
    if (tag === 'img') return `![${escapeText(node.getAttribute('alt') || '')}](${(node.getAttribute('data-href') || node.getAttribute('src') || '').replace(/([()\\])/g, '\\$1')}${title})`;
    return inner();
  };
  function quoteText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00a0/g, ' ');
    if (!(node instanceof Element)) return '';
    if (node.tagName === 'BR') return '\n';
    const text = Array.from(node.childNodes, quoteText).join('');
    return node.matches('p, div') ? (node.lastChild?.nodeName === 'BR' ? text.slice(0, -1) : text) + '\n' : text;
  }
  function serialize(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement?.matches('.folio-block-content') && !node.textContent.trim() ? '' : inline(node);
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    if (node.matches('.folio-block-tools, .folio-code-header, .folio-table-controls, button, input')) return '';
    if (tag === 'table') return window.FolioTables.serialize(node, inline);
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${Array.from(node.childNodes, inline).join('').trim()}\n\n`;
    if (tag === 'p') return `${Array.from(node.childNodes, inline).join('').trimEnd()}\n\n`;
    if (tag === 'pre') {
      const code = node.textContent.replace(/\n$/, '');
      const fence = '`'.repeat(Math.max(2, ...(code.match(/`+/g) || []).map(part => part.length)) + 1);
      const language = node.querySelector('code')?.className.match(/language-([\w+-]+)/)?.[1] || '';
      return `${fence}${language}\n${code}\n${fence}\n\n`;
    }
    if (tag === 'ul' || tag === 'ol') {
      let index = node.hasAttribute('start') ? Number(node.getAttribute('start')) : 1;
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
        let body = parts.map((part, i) => (i ? part.kind === 'list' && parts[i - 1].kind === 'inline' ? '\n' : '\n\n' : '') + part.text).join('');
        if (checkbox && parts[0]?.kind === 'list') body = '\n' + body;
        const lines = ((checkbox ? `[${checkbox.dataset.folioTaskState === 'progress' ? '/' : checkbox.checked ? 'x' : ' '}] ` : '') + body).split('\n');
        return marker + lines.map((line, i) => i && line ? ' '.repeat(marker.length) + line : line).join('\n');
      }).join(loose ? '\n\n' : '\n') + '\n\n';
    }
    if (tag === 'blockquote') {
      if (node.matches('.folio-plain-quote')) {
        const body = Array.from(node.childNodes).filter(child => child.nodeType !== Node.TEXT_NODE || child.textContent.trim()).map(quoteText).join('').replace(/\n$/, '');
        return body.split('\n').map(line => line ? '> ' + line : '>').join('\n') + '\n\n';
      }
      const body = Array.from(node.childNodes).filter(child => child.nodeType !== Node.TEXT_NODE || child.textContent.trim()).map(serialize).join('').trimEnd();
      const marker = node.matches('.folio-callout') ? `> [!CALLOUT] ${node.dataset.calloutEmoji || '🌈'}\n` : '';
      return marker + body.split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    }
    if (tag === 'hr') return '---\n\n';
    if (tag === 'div' && !Array.from(node.children).some(child => /^(P|H[1-6]|UL|OL|PRE|BLOCKQUOTE|DIV|HR|TABLE)$/.test(child.tagName))) return inline(node) + '\n\n';
    return Array.from(node.childNodes, serialize).join('');
  }

  const headingNumbers = [
    'M17 13l2-1v8m-2 0h4', 'M16 14a2.5 2.5 0 0 1 5 0c0 2-5 4-5 6h5', 'M16 12h5l-3 3c4 0 4 5 0 5h-2',
    'M20 20v-8l-5 5h7', 'M21 12h-5v4h2.5a2 2 0 0 1 0 4H16', 'M20 12c-4 0-5 8-1 8a2.5 2.5 0 0 0 0-5h-2'
  ];
  const modules = [
    ['text', '文本', 'M4 5h16M12 5v14M8 19h8', 'text paragraph wenben', '基础', 'blue'],
    ...['一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题'].map((label, i) => [
      `h${i + 1}`, label, `M3 5v14M11 5v14M3 12h8${headingNumbers[i]}`, `heading title biaoti ${i + 1}`, '基础', ['accent', 'blue', 'teal', 'peach', 'yellow', 'pink'][i]
    ]),
    ['ordered', '有序列表', 'M3 5l2-1v6M3 10h4M3 15a2 2 0 0 1 4 0c0 1.5-4 3-4 5h4M11 7h10M11 17h10', 'ordered list youxu', '基础', 'peach'],
    ['bullet', '无序列表', 'M6 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0M6 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0M6 18a1 1 0 1 0-2 0 1 1 0 0 0 2 0M10 6h11M10 12h11M10 18h11', 'unordered bullet list wuxu', '基础', 'teal'],
    ['code', '代码块', 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16', 'code daima', '基础', 'green'],
    ['quote', '引用', 'M10 6H4v7h6V6ZM10 13c0 4-2 6-5 6M20 6h-6v7h6V6ZM20 13c0 4-2 6-5 6', 'blockquote quote yinyong', '基础', 'teal'],
    ['callout', '高亮块', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 8h.01M12 8h5M7 13h10M7 17h7', 'callout highlight gaoliang 提示 强调', '基础', 'accent'],
    ['divider', '分隔线', 'M3 12h7M14 12h7M12 10l2 2-2 2-2-2 2-2Z', 'divider horizontal fengexian', '基础', 'peach'],
    ['link', '链接', 'M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2', 'link lianjie', '常用', 'blue'],
    ['file', '项目文件', 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6M8 13h8M8 17h5', 'file project workspace wenjian xiangmu 文件链接', '常用', 'teal'],
    ['emoji', 'Emoji 表情', 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0ZM8 9h.01M16 9h.01M8 14c1.5 4 6.5 4 8 0', 'emoji emote biaoqing 表情 笑脸', '常用', 'yellow'],
    ['template', '模板', 'M8 3h11a2 2 0 0 1 2 2v11M5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM7 12h6M7 16h4', 'template muban riji 日记', '常用', 'accent'],
    ['task', '任务', 'M19 11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h10M8 11l4 4 9-11', 'todo task checklist renwu', '常用', 'green'],
    ['image', '图片', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 17l6-6 5 5 3-3 4 4M17 7a1 1 0 1 0-2 0 1 1 0 0 0 2 0', 'image photo tupian', '常用', 'yellow'],
    ['table', '表格', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 9h18M3 15h18M10 9v12', 'table biaoge', '常用', 'blue']
  ];

  window.FolioEditor = function ({ host, showError, applyContent, enhance }) {
    const main = document.querySelector('.markdown-body');
    const pending = new Map();
    const waiters = [];
    const listEdits = [];
    const renderWaiters = new Set();
    let source = '', writable = true, active = null, deferred = null, sequence = 0, composing = false, conflicted = false, menuState = null;
    let renderedSource = null;
    let historyVersion = 0, historyCaret = null;
    let fileRequest = null;
    let emojiRequest = null;
    let templateRequest = null;
    let imageRequest = null;
    let savedSource = null;
    const codes = window.FolioCode({ canEdit: () => writable && !conflicted && !composing,
      edit: card => { if (active?.code && active.block === card.closest('.folio-block')) finish(); else open(card.closest('.folio-block'), true); },
      changeLanguage: (card, language) => {
        if (!card?.isConnected || !open(card.closest('.folio-block')) || !active.code) return;
        const before = source, caret = captureCaret(); active.code.language = language; sync(); rememberListEdit(before, caret, captureCaret()); finish();
      }
    });
    const images = window.FolioImages({ host, insert: insertProjectImage, restore: restoreImageCaret });
    const blocks = window.FolioBlocks({ main, read: () => source, canMove: () => writable && !conflicted && !composing, prepare: prepareMove, commit: moveContent });
    const tables = window.FolioTables({
      canEdit: () => writable && !conflicted && !composing,
      onActivate: table => table.isConnected && open(table.closest('.folio-block')),
      onSelect: () => { if (active) active.lastHTML = active.content.innerHTML; },
      onChange: change => {
        if (!active || !writable || conflicted || composing) return;
        sync(); const before = source, caret = captureCaret(); change(); sync(true); rememberListEdit(before, caret, captureCaret());
      }
    });
    const emojiPicker = window.FolioEmojiPicker({ onSelect: insertEmoji, onClose: closeEmoji });
    const templates = window.FolioTemplates({ host, insert: insertTemplate, restore: restoreTemplateCaret });
    const formatting = window.FolioFormatting({
      context: () => active && !active.raw && writable && !conflicted && !composing && menu.hidden && !emojiRequest && !templates.element.open && !images.element.open
        && !active.block.querySelector('.folio-resource-form') ? active.content : null,
      change: action => {
        if (!active || active.raw || !writable || conflicted || composing) return;
        sync(); const before = source, caret = captureCaret(); action(); sync(true); rememberListEdit(before, caret, captureCaret());
      }
    });
    const menu = document.createElement('div');
    menu.className = 'folio-insert-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox'); menu.id = 'folio-insert-menu'; menu.setAttribute('aria-label', '插入模块');
    const footer = document.createElement('div');
    footer.className = 'folio-editor-feedback'; footer.setAttribute('role', 'status'); footer.hidden = true;
    const recovery = document.createElement('div'); recovery.className = 'folio-recovery'; recovery.hidden = true;
    const copy = document.createElement('button'); copy.textContent = '复制草稿';
    const reload = document.createElement('button'); reload.textContent = '放弃草稿并刷新';
    recovery.append(copy, reload); document.body.append(menu, footer, recovery);
    const documentEnd = document.createElement('div'); documentEnd.className = 'folio-document-end'; documentEnd.hidden = true; documentEnd.tabIndex = 0;
    documentEnd.setAttribute('role', 'button'); documentEnd.setAttribute('aria-label', '在文档末尾继续输入'); main.after(documentEnd);
    const eol = () => source.includes('\r\n') ? '\r\n' : '\n';
    const state = () => host.getState() || {};
    const draft = () => active ? source.slice(0, active.start) + value() + source.slice(active.end) : source || state().draft?.markdown || '';
    function feedback(text) { if (!text && footer.textContent === '已保存' && source === savedSource) return; footer.textContent = text; footer.hidden = !text; }
    function remember() { host.setState({ ...state(), draft: { markdown: draft() } }); }
    function fail(message) {
      conflicted = true; documentEnd.hidden = true; closeMenu(); formatting.hide(); showError(message); feedback('草稿未同步'); recovery.hidden = false; remember(); settle();
    }
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(draft()); copy.textContent = '草稿已复制'; } catch { showError('复制失败，请选中编辑内容后手动复制。'); }
    });
    reload.addEventListener('click', () => {
      conflicted = false; pending.clear(); active = null; recovery.hidden = true; host.setState({ ...state(), draft: null }); showError(''); feedback(''); host.postMessage({ type: 'ready' });
    });
    function offsets(text) {
      const result = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') result.push(i + 1); result.push(text.length); return result;
    }
    function updatePlaceholders() {
      const unchanged = active && active.lastHTML === active.content.innerHTML;
      const paragraphs = new Set([...main.querySelectorAll('p[data-folio-placeholder]'), ...(!active || active.raw ? [] : active.content.querySelectorAll('p'))]);
      for (const paragraph of paragraphs) {
        // CSS :only-child ignores text nodes, so text followed by a single <br> is not necessarily an empty paragraph.
        const empty = !composing && active?.content.isContentEditable && active.content.contains(paragraph) && !paragraph.closest('.folio-plain-quote')
          && !paragraph.textContent && !paragraph.querySelector(':not(br)');
        paragraph.toggleAttribute('data-folio-placeholder', Boolean(empty));
      }
      // Presentation attributes must not turn an untouched empty paragraph into a document edit.
      if (unchanged) active.lastHTML = active.content.innerHTML;
    }
    function attach(message) {
      formatting.hide();
      codes.attach(message);
      closeEmoji(false);
      source = message.source || ''; writable = message.writable !== false;
      if (!footer.textContent || footer.textContent === '已保存') feedback(source === savedSource ? '已保存' : '');
      renderedSource = source;
      documentEnd.hidden = !writable || conflicted;
      const lines = offsets(source);
      for (const block of main.querySelectorAll('.folio-block')) {
        block.dataset.sourceStart = lines[Number(block.dataset.startLine)] ?? source.length;
        block.dataset.sourceEnd = lines[Number(block.dataset.endLine)] ?? source.length;
        const content = block.querySelector('.folio-block-content');
        tables.prepare(content, writable);
        if (writable) { content.tabIndex = 0; content.setAttribute('aria-label', '编辑此内容'); }
      }
      if (writable && !source.trim() && !historyCaret?.emptyBlock) insertEmptyBlock();
      if (historyCaret) { restoreCaret(historyCaret); historyCaret = null; }
      if (state().draft?.markdown && !pending.size && !active) { recovery.hidden = false; showError('有一份未同步的草稿，可复制后继续编辑，或放弃草稿并刷新。'); }
      blocks.refresh(); for (const resolve of renderWaiters) resolve(true); renderWaiters.clear();
      codes.enhance(); enhanceImages();
      for (const button of main.querySelectorAll('.folio-callout-emoji')) button.disabled = !writable || button.closest('.folio-block').dataset.editMode !== 'rich';
    }
    async function prepareMove() {
      const wasEditing = !!active;
      if (conflicted || composing || !await flush()) return false;
      finish();
      if (!wasEditing && renderedSource === source) return true;
      return new Promise(resolve => {
        const timer = setTimeout(() => { renderWaiters.delete(done); resolve(false); }, 5000);
        const done = ok => { clearTimeout(timer); resolve(ok); };
        renderWaiters.add(done); host.postMessage({ type: 'ready' });
      });
    }
    function moveContent(base, text) {
      if (!writable || conflicted || composing || active || pending.size || base !== source || text === base) return false;
      const message = { type: 'edit', id: ++sequence, historyVersion, start: 0, end: base.length, base, text };
      source = text; pending.set(message.id, message); rememberListEdit(base, null, null); remember(); host.postMessage(message); feedback('同步中…'); return true;
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
      // An untouched end paragraph still sits after its pending Markdown separator when redo restores it.
      const start = active.start + (active.changed || active.block.dataset.documentEnd === 'true' ? (active.prefix + before).replace(/\r?\n/g, eol()).length : 0);
      const saved = { start, offset: range.toString().length, atEnd: range.toString().length === target.textContent.length, raw: false };
      const cell = tables.atSelection();
      if (cell && active.content.contains(cell)) {
        const cellRange = document.createRange(); cellRange.selectNodeContents(cell); cellRange.setEnd(selection.anchorNode, selection.anchorOffset);
        saved.tableCell = { row: cell.parentElement.rowIndex, column: cell.cellIndex, offset: cellRange.toString().length };
      }
      if (active.block.dataset.documentEnd === 'true') saved.documentEnd = true;
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
      if (saved.emptyBlock) { insertEmptyBlock(saved.start, saved.end); return; }
      if (saved.documentEnd && saved.start >= source.length) { editDocumentEnd(); return; }
      const blocks = Array.from(main.querySelectorAll('.folio-block'));
      const block = blocks.find(item => Number(item.dataset.sourceStart) === saved.start)
        || blocks.find(item => Number(item.dataset.sourceStart) <= saved.start && Number(item.dataset.sourceEnd) > saved.start) || blocks.at(-1);
      if (!block || !open(block)) return;
      if (saved.documentEnd && block === blocks.at(-1)) block.dataset.documentEnd = 'true';
      if (saved.tableCell) {
        const table = active.content.querySelector('table[data-folio-table]'), position = saved.tableCell;
        const row = table?.rows[Math.min(position.row, table.rows.length - 1)], cell = row?.cells[Math.min(position.column, row.cells.length - 1)];
        if (cell) {
          tables.select(cell, true);
          let remaining = position.offset; const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT); let node;
          while ((node = walker.nextNode())) {
            if (remaining <= node.textContent.length) {
              const range = document.createRange(); range.setStart(node, remaining); range.collapse(true);
              const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); break;
            }
            remaining -= node.textContent.length;
          }
          return;
        }
      }
      active.input.focus({ preventScroll: true });
      if (active.raw) { const offset = Math.min(saved.offset, active.input.value.length); active.input.setSelectionRange(offset, offset); return; }
      if (saved.afterList) {
        // Empty paragraphs have no Markdown token; recreate the writing position when undo/redo returns here.
        const list = active.content.querySelector(':scope > ul, :scope > ol');
        if (list) {
          const paragraph = paragraphAfterListItem(list, saved.listItems);
          active.lastHTML = active.content.innerHTML; caretEnd(paragraph); return;
        }
        caretEnd(active.content); return;
      }
      if (Number.isInteger(saved.listItem) && saved.listItem >= 0) {
        const items = Array.from(active.content.querySelectorAll('li')), item = items[Math.min(saved.listItem, items.length - 1)];
        if (item) {
          const nodes = ownItemText(item), range = document.createRange();
          const label = item.querySelector(':scope > .folio-task-label, :scope > p > .folio-task-label');
          if (!nodes.length && label) { caretEnd(label); return; }
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
      active = { block, content, input: content, start, end, tail: original.match(/(?:\r?\n)*$/)?.[0] || '', prefix: block.dataset.prefix || '',
        raw: ['source', 'code'].includes(block.dataset.editMode), changed: false, lastHTML: content.innerHTML };
      block.classList.add('is-editing');
      if (block.dataset.editMode === 'code' && codes.open(active, original)) { resize(); active.input.focus(); }
      else if (active.raw) {
        content.hidden = true;
        const input = document.createElement('textarea'); input.className = 'folio-source-input'; input.setAttribute('aria-label', '编辑此块的 Markdown'); input.spellcheck = false;
        input.value = original; block.prepend(input); active.input = input; resize(); input.focus();
      } else if (!['table', 'image'].includes(block.dataset.editMode)) {
        content.contentEditable = 'true'; content.setAttribute('role', 'textbox'); content.setAttribute('aria-multiline', 'true'); content.spellcheck = false;
        document.execCommand('defaultParagraphSeparator', false, 'p');
      }
      if (!active.raw) { tables.activate(content); active.lastHTML = content.innerHTML; }
      feedback(''); updatePlaceholders(); enhance();
      if (focus) {
        const cell = block.dataset.editMode === 'table' && content.querySelector('th, td');
        if (cell) tables.select(cell, true);
        else { active.input.focus(); if (!active.raw) caretEnd(content); }
      }
      return true;
    }
    function caretEnd(element) {
      const leaf = Array.from(element.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, code')).at(-1) || element;
      const range = document.createRange(); range.selectNodeContents(leaf); range.collapse(false);
      if (leaf.lastChild?.nodeName === 'BR') { range.setStartBefore(leaf.lastChild); range.collapse(true); }
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.closest('[contenteditable]')?.focus();
    }
    function focusEmptyTask(event) {
      for (const checkbox of active.content.querySelectorAll('input.task-list-item-checkbox')) {
        const label = checkbox.nextElementSibling;
        if (!label?.matches('.folio-task-label') || label.textContent.trim() || label.querySelector(':not(br)')) continue;
        const item = checkbox.closest('li'), row = item.getBoundingClientRect(), box = checkbox.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(item).lineHeight);
        if (event.clientX < box.right || event.clientX > row.right || event.clientY < row.top || event.clientY >= row.top + lineHeight) continue;
        if (!label.querySelector('br')) label.replaceChildren(document.createElement('br'));
        caretEnd(label); return true;
      }
      return false;
    }
    function resize() { if (active?.raw) { active.input.style.height = 'auto'; active.input.style.height = `${Math.max(70, active.input.scrollHeight)}px`; } }
    function value() {
      if (!active) return '';
      if (active.code) return codes.value(active).replace(/\r?\n/g, eol());
      if (active.raw) return active.input.value.replace(/\r?\n/g, eol());
      return active.prefix + Array.from(active.content.childNodes, serialize).join('').trimEnd().replace(/\r?\n/g, eol()) + active.tail;
    }
    function sync(force = false, replacement) {
      updatePlaceholders();
      if (!active || conflicted || composing) return;
      if (!active.raw && !force && active.lastHTML === active.content.innerHTML) return;
      active.lastHTML = active.content.innerHTML;
      const text = replacement ?? value(), before = source.slice(active.start, active.end);
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
      pending.set(message.id, message);
      if (replacement !== undefined) host.setState({ ...state(), draft: { markdown: source } }); else remember();
      host.postMessage(message); feedback('同步中…'); enhance();
    }
    function finish(refresh = true) {
      if (!active || composing) return;
      formatting.hide();
      closeEmoji(false);
      cancelFileRequest();
      sync(); closeMenu(); active.block.classList.remove('is-editing'); active.content.contentEditable = 'false'; active.content.removeAttribute('role');
      tables.deactivate(active.content);
      if (active.code && !conflicted) codes.finish(active);
      else if (active.raw) { active.input.readOnly = true; active.input.classList.add('is-settling'); }
      if (conflicted) return;
      active = null; updatePlaceholders(); enhance();
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
      if (images.receive(message)) return true;
      if (templates.receive(message)) return true;
      if (message.type === 'edit-result') {
        if (!pending.has(message.id)) return true;
        pending.delete(message.id);
        if (!message.ok && (message.historyVersion || 0) <= historyVersion) fail(message.error || '同步失败，草稿已保留。');
        else if (!pending.size && !conflicted) { host.setState({ ...state(), draft: null }); feedback('已同步'); enhance(); settle(); }
        return true;
      }
      if (message.type === 'flush') { void flush().then(ok => host.postMessage({ type: 'flushed', id: message.id, ok })); return true; }
      if (message.type === 'save-result') { if (!message.ok) showError(message.error); else { savedSource = message.source ?? source; feedback('已保存'); } return true; }
      if (message.type === 'file-result') { insertProjectFile(message); return true; }
      if (message.type !== 'content') return false;
      if ((message.historyVersion || 0) > historyVersion) {
        historyCaret = captureCaret();
        for (const edit of [...listEdits].reverse()) {
          if (message.historyReason === 'undo' && source === edit.after && message.source === edit.before) { historyCaret = edit.beforeCaret; break; }
          if (message.source === edit.after && (message.historyReason === 'redo' && source === edit.before
            || message.historyReason === 'undo' && source !== edit.before)) { historyCaret = edit.afterCaret; break; }
        }
        historyVersion = message.historyVersion;
        closeEmoji(false);
        cancelFileRequest();
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
    function insertEmptyBlock(start = source.length, end = start) {
      if (!writable || conflicted || composing) return;
      finish(false);
      const prefix = source.slice(0, start).endsWith(eol() + eol()) || start === 0 ? '' : source.slice(0, start).endsWith(eol()) ? eol() : eol() + eol();
      const block = document.createElement('section'); block.className = 'folio-block'; block.dataset.editMode = 'rich'; block.dataset.sourceStart = start; block.dataset.sourceEnd = end;
      block.dataset.prefix = prefix; block.innerHTML = '<div class="folio-block-content"><p><br></p></div>';
      const next = Array.from(main.querySelectorAll('.folio-block')).find(item => Number(item.dataset.sourceStart) >= start);
      main.insertBefore(block, next || null);
      open(block, true); active.tail ||= eol() + eol(); return block;
    }
    function editDocumentEnd() {
      if (!writable || conflicted || composing) return;
      const last = main.querySelector('.folio-block:last-child'), paragraph = last?.querySelector('.folio-block-content')?.lastElementChild;
      if (last?.dataset.editMode === 'rich' && !source.slice(Number(last.dataset.sourceEnd)).trim() && paragraph?.matches('p')
        && !paragraph.textContent.trim() && !paragraph.querySelector(':not(br)')) {
        if (open(last)) {
          last.dataset.documentEnd = 'true';
          if (active.start === active.end) active.tail ||= eol() + eol();
          caretEnd(paragraph);
        }
        return;
      }
      finish(false);
      const block = insertEmptyBlock();
      if (block) block.dataset.documentEnd = 'true';
    }
    function paste(event) {
      if (!active || active.raw || !active.content.contains(event.target)) return;
      event.preventDefault();
      if (!writable || conflicted || composing || !event.clipboardData) return;
      const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
      const selection = window.getSelection();
      if (!text || !selection.rangeCount) return;
      const range = selection.getRangeAt(0).cloneRange();
      if (!active.content.contains(range.startContainer) || !active.content.contains(range.endContainer)) return;
      const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const cell = element(range.startContainer)?.closest('td, th');
      if (cell && !cell.contains(range.endContainer)) return;
      if (range.cloneContents().querySelector('input, table')) return;
      sync(); closeMenu();
      const before = source, beforeCaret = captureCaret();
      const paragraph = element(range.startContainer)?.closest('p');
      const markdown = /(?:^|\n) {0,3}(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s?|`{3}|~{3}|(?:-{3,}|\*{3,}|_{3,})\s*$)/m.test(text)
        || /\*\*[^\n]+\*\*|\[[^\]\n]+\]\([^\n]+\)|(?:^|\n)\s*\|?.*\|.*\n\s*\|?\s*:?-{3,}/m.test(text);
      if (paragraph?.parentElement === active.content && !paragraph.textContent.trim() && !paragraph.querySelector(':not(br)') && markdown) {
        const children = Array.from(active.content.childNodes), chunk = text.trimEnd() + '\n\n';
        const preceding = active.prefix + children.slice(0, children.indexOf(paragraph)).map(serialize).join('');
        const beforePosition = Math.min(active.start + preceding.replace(/\r?\n/g, eol()).length, active.end);
        const replacement = active.prefix + children.map(node => node === paragraph ? chunk : serialize(node)).join('').trimEnd().replace(/\r?\n/g, eol()) + active.tail;
        const end = active.start + (preceding + chunk).replace(/\r?\n/g, eol()).length;
        sync(true, replacement);
        const position = Math.min(end, active.end), afterCaret = { emptyBlock: true, start: position, end: position };
        rememberListEdit(before, { emptyBlock: true, start: beforePosition, end: beforePosition }, afterCaret); historyCaret = afterCaret; finish(); return;
      }
      // Cursor dispatches paste through execCommand; nesting another execCommand here is ignored by Chromium.
      const fragment = document.createDocumentFragment();
      for (const [index, line] of text.split('\n').entries()) {
        if (index) fragment.append(document.createElement('br'));
        fragment.append(document.createTextNode(line));
      }
      const last = fragment.lastChild;
      range.deleteContents(); range.insertNode(fragment); range.setStartAfter(last); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      sync(true); rememberListEdit(before, beforeCaret, captureCaret());
    }
    function lineAtCaret() {
      const selection = window.getSelection(); if (!active || active.raw || !selection.rangeCount) return null;
      const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
      let line = node?.closest('th, td') || node?.closest('p, h1, h2, h3, h4, h5, h6, li, pre');
      if (!line || !active.content.contains(line) || line.closest('pre')) return null;
      if (line.tagName === 'P' && line.parentElement.tagName === 'LI') line = line.parentElement;
      const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(line); range.setEnd(selection.anchorNode, selection.anchorOffset);
      return { line, before: range.toString(), range: selection.getRangeAt(0).cloneRange() };
    }
    function autoList(event) {
      if (event.inputType !== 'insertText' || event.data !== ' ' || !event.cancelable || event.isComposing || composing
        || !active || active.raw || !writable || conflicted || !active.content.contains(event.target)) return false;
      const selection = window.getSelection(), location = lineAtCaret();
      if (!selection.isCollapsed || !location || location.line.tagName !== 'P' || location.line.closest('li, pre, th, td, .folio-plain-quote')) return false;
      const match = /^(?:-|(\d{1,9})\.?)$/.exec(location.before);
      if (!match) return false;
      const prefix = location.range.cloneRange(); prefix.selectNodeContents(location.line); prefix.setEnd(location.range.startContainer, location.range.startOffset);
      // Only a literal marker at the beginning of a paragraph is a shortcut, never inline code or a soft-wrapped line.
      if (prefix.cloneContents().querySelector('*')) return false;
      event.preventDefault(); sync(); closeMenu();
      const before = source, beforeCaret = captureCaret();
      const list = document.createElement(match[1] === undefined ? 'ul' : 'ol'), item = document.createElement('li');
      if (match[1] !== undefined && Number(match[1]) !== 1) list.setAttribute('start', String(Number(match[1])));
      const remainder = location.range.cloneRange(); remainder.selectNodeContents(location.line); remainder.setStart(location.range.startContainer, location.range.startOffset);
      item.append(remainder.extractContents()); if (!item.textContent && !item.querySelector('img, br')) item.append(document.createElement('br'));
      list.append(item); location.line.replaceWith(list); active.content.focus({ preventScroll: true });
      const caret = document.createRange(); caret.selectNodeContents(item); caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret);
      sync(); rememberListEdit(before, beforeCaret, captureCaret()); return true;
    }
    function paragraphAfterListItem(list, count) {
      const items = Array.from(list.children).filter(child => child.tagName === 'LI');
      if (count < items.length) {
        const tail = list.cloneNode(false);
        if (list.tagName === 'OL') tail.setAttribute('start', String((list.hasAttribute('start') ? Number(list.getAttribute('start')) : 1) + count));
        tail.append(...items.slice(count)); list.after(tail);
      }
      const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); list.after(paragraph);
      if (!list.querySelector(':scope > li')) list.remove();
      return paragraph;
    }
    function enterList() {
      if (active.raw || conflicted || !writable) return false;
      const selection = window.getSelection();
      if (!selection.isCollapsed || !selection.rangeCount) return false;
      const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
      const item = node?.closest('li');
      if (!item || !active.content.contains(item) || node.closest('pre, blockquote:not(.folio-callout)')) return false;
      const empty = !item.textContent.trim() && !item.querySelector('ul, ol, img, pre, table, hr');
      if (empty) {
        // Chromium's native empty-item Enter can lift the previous child list out of its parent.
        // Keep the preceding subtree intact and split off following root items at the current position.
        let boundary = item, root = item.parentElement;
        while (root.parentElement.tagName === 'LI') { boundary = root.parentElement; root = boundary.parentElement; }
        const before = source, beforeCaret = captureCaret();
        const preceding = Array.from(active.content.childNodes).slice(0, Array.from(active.content.childNodes).indexOf(root)).map(serialize).join('');
        const rootItems = Array.from(root.children).filter(child => child.tagName === 'LI');
        const precedingItems = rootItems.slice(0, rootItems.indexOf(boundary) + (boundary === item ? 0 : 1));
        let container = item.parentElement;
        item.remove();
        while (container !== root && !container.textContent.trim() && !container.querySelector('li, input, img')) {
          const parent = container.parentElement; container.remove(); container = parent;
        }
        const count = precedingItems.filter(child => child.parentElement === root).length;
        const afterCaret = { start: active.start + (active.prefix + preceding).replace(/\r?\n/g, eol()).length, raw: false, afterList: true, listItems: count };
        const paragraph = paragraphAfterListItem(root, count);
        active.content.focus(); caretEnd(paragraph); sync();
        if (!count) {
          afterCaret.afterList = false; afterCaret.emptyBlock = true;
          afterCaret.end = afterCaret.start + (source.slice(afterCaret.start, active.end).match(/^[\r\n]*/)?.[0].length || 0);
        }
        rememberListEdit(before, beforeCaret, afterCaret);
        return true;
      }
      const after = selection.getRangeAt(0).cloneRange(); after.selectNodeContents(item); after.setStart(selection.anchorNode, selection.anchorOffset);
      const remaining = after.cloneContents(); remaining.querySelectorAll('ul, ol').forEach(list => list.remove());
      if (remaining.textContent.trim() || remaining.querySelector('img, pre, table, hr')) return false;
      const before = source, beforeCaret = captureCaret();
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
      active.content.focus(); caretEnd(text); sync();
      rememberListEdit(before, beforeCaret, captureCaret()); return true;
    }
    function rememberListEdit(before, beforeCaret, afterCaret) {
      listEdits.push({ before, after: source, beforeCaret, afterCaret });
      if (listEdits.length > 16) listEdits.shift();
    }
    function editableLines(content) {
      const lines = [];
      const visit = element => {
        if (element.matches('p, h1, h2, h3, h4, h5, h6') || element.matches('li') && !element.querySelector(':scope > p')) {
          lines.push({ node: element, text: element.querySelector(':scope > .folio-task-label') || element });
          if (!element.matches('li')) return;
        }
        for (const child of element.children) if (child.matches('p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote')) visit(child);
      };
      visit(content); return lines;
    }
    function backspaceAcrossLines() {
      if (!active || active.raw || !active.content.isContentEditable || conflicted || !writable) return false;
      const selection = window.getSelection();
      if (!selection.isCollapsed || !selection.rangeCount || !active.content.contains(selection.anchorNode)) return false;
      const lines = editableLines(active.content), current = lines.findLast(line => line.node.contains(selection.anchorNode));
      if (!current) return false;
      const prefix = document.createRange(); prefix.selectNodeContents(current.text.contains(selection.anchorNode) ? current.text : current.node);
      prefix.setEnd(selection.anchorNode, selection.anchorOffset);
      const preceding = prefix.cloneContents();
      // A soft line break or a visible character still belongs to native text deletion.
      if (preceding.querySelector('br, img, ul, ol, pre, table') || (current.text.matches('.folio-task-label') ? prefix.toString().trim() : prefix.toString())) return false;
      let previous = lines[lines.indexOf(current) - 1], previousBlock = null;
      if (!previous) {
        previousBlock = active.block.previousElementSibling;
        if (!previousBlock?.matches('.folio-block[data-edit-mode="rich"]') || previousBlock.classList.contains('folio-section-hidden')) return false;
        previous = editableLines(previousBlock.querySelector('.folio-block-content')).at(-1);
        if (!previous) return false;
      }
      sync(); closeMenu(); formatting.hide();
      const before = source, beforeCaret = captureCaret();
      if (previousBlock) {
        // Join the editable roots synchronously so a held Backspace keeps working without waiting for a host render.
        if (active.start === active.end) active.tail = source.slice(Number(previousBlock.dataset.sourceStart), active.end).match(/(?:\r?\n)*$/)?.[0] || '';
        active.start = Number(previousBlock.dataset.sourceStart); active.prefix = previousBlock.dataset.prefix || '';
        active.block.dataset.sourceStart = active.start; active.block.dataset.startLine = previousBlock.dataset.startLine;
        active.content.prepend(...previousBlock.querySelector('.folio-block-content').childNodes); previousBlock.remove();
        active.block.dataset.kind = active.content.firstElementChild?.tagName.toLowerCase() || 'p';
      }
      const nested = element => element instanceof Element && element.matches('ul, ol, blockquote, pre, table');
      const inlineNodes = line => Array.from(line.text.childNodes).filter(node => !nested(node) && !(node instanceof Element && node.matches('input')));
      const trimListWhitespace = line => {
        if (!line.node.matches('li') && !line.text.matches('.folio-task-label')) return;
        const nodes = inlineNodes(line), first = nodes[0], last = nodes.at(-1);
        if (first?.nodeType === Node.TEXT_NODE) first.textContent = first.textContent.replace(/^\s+/, '');
        if (last?.nodeType === Node.TEXT_NODE) last.textContent = last.textContent.replace(/\s+$/, '');
      };
      trimListWhitespace(previous); trimListWhitespace(current);
      for (const line of [previous, current]) {
        const nodes = inlineNodes(line);
        if (!nodes.some(node => node.textContent || node instanceof Element && !node.matches('br'))) for (const node of nodes) node.remove();
      }
      const marker = document.createTextNode(''), children = inlineNodes(current);
      const firstNested = Array.from(previous.text.children).find(nested);
      previous.text.insertBefore(marker, firstNested || null);
      for (const child of children) {
        if (previous.text.closest('.folio-plain-quote') && child instanceof Element && child.tagName !== 'BR') {
          previous.text.insertBefore(document.createTextNode(quoteText(child)), firstNested || null);
        }
        else previous.text.insertBefore(child, firstNested || null);
      }
      const item = current.node.parentElement;
      const removal = item.matches('li') && Array.from(item.childNodes).every(node => node === current.node || nested(node) || node.nodeType === Node.TEXT_NODE && !node.textContent.trim())
        ? item : current.node;
      const container = removal.parentElement;
      if (removal.matches('li')) {
        const descendants = Array.from(removal.children).filter(nested), parentItem = previous.node.closest('li');
        if (parentItem === container.parentElement) {
          for (const list of descendants) if (list.tagName === container.tagName) removal.before(...list.children); else container.before(list);
        } else if (parentItem) parentItem.append(...descendants);
        else previous.node.after(...descendants);
      }
      removal.remove();
      // Remove empty list/quote wrappers, but retain following items and nested content.
      let empty = container;
      while (empty !== active.content && (!empty.textContent.trim() || empty.matches('.folio-callout') && [...empty.children].every(child => child.matches('.folio-callout-emoji')))
        && !empty.querySelector('li, input, img, pre, table, hr, p, h1, h2, h3, h4, h5, h6')) {
        const parent = empty.parentElement; empty.remove(); empty = parent;
      }
      active.input.focus({ preventScroll: true });
      const caret = document.createRange(); caret.setStart(marker, 0); caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret);
      sync(); rememberListEdit(before, beforeCaret, captureCaret()); return true;
    }
    function backspaceEmptyTask() {
      if (active.raw || conflicted || !writable) return false;
      const selection = window.getSelection();
      if (!selection.isCollapsed || !selection.rangeCount) return false;
      const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
      const item = node?.closest('li');
      if (!item || !active.content.contains(item) || !item.querySelector(':scope > input.task-list-item-checkbox, :scope > p > input.task-list-item-checkbox')) return false;
      if (item.textContent.replace(/[\s\u200b]/g, '') || item.querySelector('ul, ol, img, pre, table, hr, blockquote')) return false;
      const before = source, beforeCaret = captureCaret(), list = item.parentElement;
      const previous = item.previousElementSibling;
      const parent = list.parentElement.tagName === 'LI' ? list.parentElement : null;
      const target = previous?.querySelectorAll('li').length ? Array.from(previous.querySelectorAll('li')).at(-1) : previous || parent;
      let paragraph;
      if (!target) { paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); list.before(paragraph); }
      // Only remove the empty leaf; keep its parent, siblings and their task states intact.
      item.remove();
      if (!list.querySelector(':scope > li')) list.remove();
      active.content.focus({ preventScroll: true });
      if (target) {
        const text = ownItemText(target).at(-1);
        if (text) {
          const range = document.createRange(); range.setStart(text, text.textContent.trimEnd().length); range.collapse(true);
          selection.removeAllRanges(); selection.addRange(range);
        } else caretEnd(target.querySelector(':scope > p, :scope > label') || target);
      } else caretEnd(paragraph);
      sync();
      const afterCaret = captureCaret();
      if (paragraph) {
        afterCaret.emptyBlock = true;
        afterCaret.end = afterCaret.start + (source.slice(afterCaret.start, active.end).match(/^[\r\n]*/)?.[0].length || 0);
      }
      rememberListEdit(before, beforeCaret, afterCaret);
      return true;
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
      const inlineMode = /^(TH|TD)$/.test(location.line.tagName) || force && !match && Boolean(location.line.textContent.trim());
      const standalone = location.line.parentElement === active.content && /^(P|H[1-6])$/.test(location.line.tagName);
      const inCallout = location.line.closest('.folio-callout');
      const items = modules.filter(item => (!inlineMode || ['link', 'file', 'emoji'].includes(item[0])) && (!['template', 'image', 'callout'].includes(item[0]) || standalone)
        && (!location.line.closest('.folio-plain-quote') || item[0] === 'emoji')
        && (!inCallout || !['code', 'table', 'divider', 'quote'].includes(item[0]))
        && `${item[0]} ${item[1]} ${item[3]}`.toLowerCase().includes(query));
      const selected = menuState?.query === query ? Math.min(menuState.selected, items.length - 1) : 0;
      const opening = menu.hidden;
      menuState = { ...location, query, trigger: Boolean(match), inlineMode, items, selected: Math.max(0, selected) };
      menu.replaceChildren();
      const search = document.createElement('div'); search.className = 'folio-menu-query';
      search.textContent = inlineMode ? '在光标处插入，保留前后文字' : query ? `搜索：${match[1]}` : '输入关键词筛选'; menu.append(search);
      const list = document.createElement('div'); list.className = 'folio-menu-list'; list.setAttribute('role', 'presentation'); menu.append(list);
      let group;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item[4] !== group) { group = item[4]; const label = document.createElement('div'); label.className = 'folio-menu-group'; label.textContent = inlineMode ? '行内插入' : group; list.append(label); }
        const button = document.createElement('button'); button.type = 'button'; button.className = 'folio-menu-item'; button.id = `folio-option-${item[0]}`; button.dataset.module = item[0];
        button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(i === menuState.selected));
        button.style.setProperty('--folio-module-color', `var(--folio-${item[5]})`);
        const icon = document.createElement('span'); icon.className = 'folio-module-icon'; icon.setAttribute('aria-hidden', 'true');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('focusable', 'false');
        const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', item[2]); svg.append(path); icon.append(svg);
        const label = document.createElement('span'); label.className = 'folio-menu-label'; label.textContent = item[1]; button.append(icon, label); list.append(button);
      }
      if (!items.length) { const empty = document.createElement('p'); empty.className = 'folio-menu-empty'; empty.textContent = '没有匹配的模块'; list.append(empty); }
      const hint = document.createElement('div'); hint.className = 'folio-menu-hint';
      for (const [key, text] of [['↑↓', '选择'], ['↵', '插入'], ['Esc', '关闭']]) {
        const part = document.createElement('span'), kbd = document.createElement('kbd'); kbd.textContent = key; part.append(kbd, document.createTextNode(text)); hint.append(part);
      }
      menu.append(hint);
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
      menu.style.top = `${Math.max(safe, Math.min(innerHeight - menu.offsetHeight - safe, up ? anchor.top - gap - menu.offsetHeight : anchor.bottom + gap))}px`;
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
      if (id === 'image') {
        sync(); const insertion = captureInsertion(menuState, true); if (!insertion) return;
        imageRequest = { ...insertion, beforeCaret: captureCaret() }; closeMenu(); formatting.hide(); images.open(); return;
      }
      if (id === 'template') {
        sync(); const insertion = captureInsertion(menuState, true); if (!insertion) return;
        templateRequest = { ...insertion, beforeCaret: captureCaret() }; closeMenu(); templates.open(); return;
      }
      if (id === 'file') { requestProjectFile(); return; }
      if (id === 'emoji') {
        const insertion = captureInsertion(menuState, true);
        if (!insertion) return;
        closeMenu(); showError(''); emojiRequest = insertion; emojiPicker.open(insertion.caret); return;
      }
      if (id === 'link') {
        const insertion = captureInsertion(menuState);
        if (!insertion) return;
        const text = menuState.trigger ? '' : menuState.range.toString();
        closeMenu(); resourceForm(id, insertion.target, text, insertion); return;
      }
      const target = menuState.line; const trigger = menuState.trigger;
      const remainder = trigger ? target.textContent.slice(menuState.before.length) : target.textContent;
      const preserved = !trigger && /^(P|H[1-6])$/.test(target.tagName) ? Array.from(target.childNodes, node => node.cloneNode(true)) : null;
      closeMenu();
      let node;
      if (id === 'bullet' || id === 'ordered' || id === 'task') {
        node = document.createElement(id === 'ordered' ? 'ol' : 'ul'); const item = document.createElement('li');
        if (id === 'task') { item.className = 'task-list-item'; const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'task-list-item-checkbox'; item.append(check); }
        item.append(document.createTextNode(remainder)); if (!remainder) item.append(document.createElement('br')); node.append(item);
      } else if (id === 'quote' || id === 'callout') {
        node = document.createElement('blockquote'); const paragraph = document.createElement('p'); paragraph.textContent = remainder; if (!remainder) paragraph.append(document.createElement('br')); node.append(paragraph);
        if (id === 'quote') node.className = 'folio-plain-quote';
        if (id === 'callout') {
          node.className = 'folio-callout'; node.dataset.calloutEmoji = '🌈';
          const button = document.createElement('button'); button.type = 'button'; button.className = 'folio-callout-emoji'; button.contentEditable = 'false'; button.textContent = '🌈';
          button.setAttribute('aria-label', '更换高亮块表情'); button.setAttribute('aria-haspopup', 'dialog'); button.title = '更换表情'; node.prepend(button);
        }
      } else if (id === 'code') {
        node = document.createElement('pre'); const code = document.createElement('code'); code.textContent = remainder || '\n'; node.append(code);
      } else if (id === 'divider') {
        node = document.createElement('div'); node.append(document.createElement('hr')); const p = document.createElement('p'); p.textContent = remainder; if (!remainder) p.append(document.createElement('br')); node.append(p);
      } else if (id === 'table') {
        node = window.FolioTables.create(remainder); replaceLine(node, target, false);
        tables.activate(active.content); tables.select(node.querySelector('tbody td'), true); return;
      } else { node = document.createElement(/^h[1-6]$/.test(id) ? id : 'p'); node.textContent = remainder; if (!remainder) node.append(document.createElement('br')); }
      if (preserved && !['code', 'divider'].includes(id)) (node.querySelector('li, p') || node).replaceChildren(...preserved);
      replaceLine(node, target);
      if (id === 'code' && active.content.children.length === 1) { historyCaret = { start: active.start, offset: 0, raw: true }; finish(); }
    }
    function cancelFileRequest() {
      if (fileRequest) host.postMessage({ type: 'cancel-pick-file' });
      fileRequest = null;
    }
    function captureInsertion(location, allowLink = false) {
      if (!active || !writable || conflicted) return;
      const range = location.range.cloneRange();
      if (!active.content.contains(range.startContainer) || !active.content.contains(range.endContainer)) { closeMenu(); showError('请将光标放在一个编辑区块内，再插入内容。'); return; }
      const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (!allowLink && (element(range.startContainer)?.closest('a') || element(range.endContainer)?.closest('a'))) {
        closeMenu(); showError('请将光标移到已有链接之外，再插入新链接。'); return;
      }
      if (location.trigger) {
        // Remove only the slash query, preserving task checkboxes, nested lists and surrounding inline formatting.
        const walker = document.createTreeWalker(location.line, NodeFilter.SHOW_TEXT);
        let first;
        while ((first = walker.nextNode()) && !first.textContent.length) {}
        if (!first) return;
        range.setStart(first, 0);
      }
      return { editor: active, source, range, caret: location.range.cloneRange(), target: location.line, html: location.line.innerHTML };
    }
    function requestProjectFile() {
      if (fileRequest) return;
      const insertion = captureInsertion(menuState);
      if (!insertion) return;
      fileRequest = { id: ++sequence, ...insertion };
      closeMenu(); showError('');
      host.postMessage({ type: 'pick-file', id: fileRequest.id });
    }
    function validInsertion(request) {
      return !conflicted && writable && active === request.editor && request.target.isConnected && source === request.source && request.target.innerHTML === request.html;
    }
    function restoreTemplateCaret() {
      const request = templateRequest; templateRequest = null;
      if (!request || !validInsertion(request)) return;
      active.input.focus({ preventScroll: true }); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(request.caret);
    }
    function insertTemplate(markdown) {
      const request = templateRequest;
      if (!request || !validInsertion(request) || request.target.parentElement !== active.content) return '插入位置已变化，请关闭模板库，在新的位置重新打开。模板已保留。';
      templateRequest = null; return insertBlockMarkdown(request, markdown);
    }
    function insertBlockMarkdown(request, markdown) {
      const children = Array.from(active.content.childNodes), index = children.indexOf(request.target);
      const beforeRange = document.createRange(); beforeRange.selectNodeContents(request.target); beforeRange.setEnd(request.range.startContainer, request.range.startOffset);
      const afterRange = document.createRange(); afterRange.selectNodeContents(request.target); afterRange.setStart(request.range.endContainer, request.range.endOffset);
      const fragmentMarkdown = fragment => {
        if (!fragment.textContent.trim() && !fragment.querySelector('img')) return '';
        const paragraph = document.createElement('p'); paragraph.append(fragment); return serialize(paragraph);
      };
      const preceding = active.prefix + children.slice(0, index).map(serialize).join('') + fragmentMarkdown(beforeRange.cloneContents());
      const chunk = markdown.replace(/\r\n?/g, '\n').trimEnd() + '\n\n';
      const following = fragmentMarkdown(afterRange.cloneContents()) + children.slice(index + 1).map(serialize).join('');
      const replacement = (preceding + chunk + following).replace(/\r?\n/g, eol());
      const position = active.start + (preceding + chunk).replace(/\r?\n/g, eol()).length;
      const before = source, afterCaret = { emptyBlock: true, start: position, end: position };
      sync(true, replacement); rememberListEdit(before, request.beforeCaret, afterCaret);
      historyCaret = afterCaret; finish(); return '';
    }
    function restoreImageCaret() {
      const request = imageRequest; imageRequest = null;
      if (!request || !validInsertion(request)) return;
      active.input.focus({ preventScroll: true }); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(request.caret);
    }
    function insertProjectImage(message) {
      const request = imageRequest;
      if (!request || !validInsertion(request) || request.target.parentElement !== active.content) return '文档已变化，请关闭选择框，在新的位置重新插入。';
      const image = document.createElement('img'); image.setAttribute('src', message.href); image.alt = message.description || message.name;
      imageRequest = null; return insertBlockMarkdown(request, inline(image));
    }
    function enhanceImages() {
      for (const block of main.querySelectorAll('.folio-block[data-edit-mode=image]')) {
        if (block.querySelector('.folio-image-tools')) continue;
        const tools = document.createElement('div'); tools.className = 'folio-image-tools';
        const replace = document.createElement('button'); replace.type = 'button'; replace.textContent = '更换图片'; replace.disabled = !writable;
        replace.onclick = () => {
          if (!open(block)) return; sync(); const target = active.content.querySelector('p'), range = document.createRange(); range.selectNodeContents(target);
          imageRequest = { editor: active, source, target, html: target.innerHTML, range, caret: range.cloneRange(), beforeCaret: captureCaret() }; images.open(true);
        };
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.disabled = !writable;
        remove.onclick = () => {
          if (!open(block)) return; const before = source, caret = captureCaret(), paragraph = document.createElement('p'); paragraph.append(document.createElement('br'));
          active.content.replaceChildren(paragraph); sync(true); historyCaret = { emptyBlock: true, start: active.start, end: active.start };
          rememberListEdit(before, caret, historyCaret); finish();
        };
        tools.append(replace, remove); block.append(tools);
      }
    }
    function closeEmoji(restore = false) {
      const request = emojiRequest; emojiRequest = null; emojiPicker.close();
      if (request?.callout) {
        const button = request.callout.querySelector('.folio-callout-emoji'); button?.setAttribute('aria-expanded', 'false');
        if (restore && button?.isConnected) button.focus({ preventScroll: true });
        return;
      }
      if (!restore || !request || !validInsertion(request)) return;
      active.input.focus({ preventScroll: true });
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(request.caret);
    }
    function insertEmoji(value) {
      const request = emojiRequest;
      if (!request) return;
      closeEmoji(false);
      if (request.callout) {
        if (active !== request.editor || source !== request.source || !request.callout.isConnected || !writable || conflicted) { showError('高亮块已变化，请重新选择表情。'); return; }
        const before = source, caret = captureCaret(), button = request.callout.querySelector('.folio-callout-emoji');
        request.callout.dataset.calloutEmoji = value; button.textContent = value; button.focus({ preventScroll: true });
        sync(); rememberListEdit(before, caret, captureCaret()); return;
      }
      if (!validInsertion(request)) { showError('插入位置已变化，请重新选择表情。'); return; }
      active.input.focus({ preventScroll: true });
      const text = document.createTextNode(value); request.range.deleteContents(); request.range.insertNode(text);
      request.range.setStart(text, text.length); request.range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(request.range);
      sync();
    }
    function insertLink(request, href, text) {
      if (!validInsertion(request)) { showError('插入位置已变化，请重新打开插入菜单。'); return false; }
      active.input.focus({ preventScroll: true });
      const link = document.createElement('a'); link.setAttribute('href', href); link.textContent = text;
      request.range.deleteContents(); request.range.insertNode(link);
      // A normal text node gives Chromium an unambiguous caret outside the link; subsequent typing stays plain text.
      const after = document.createTextNode(' '); link.after(after);
      request.range.setStart(after, 1); request.range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(request.range);
      sync(); return true;
    }
    function insertProjectFile(message) {
      if (!fileRequest || fileRequest.id !== message.id) return;
      const request = fileRequest; fileRequest = null;
      if (conflicted || !writable || active !== request.editor || !request.target.isConnected) return;
      if (!validInsertion(request)) { showError('插入位置已变化，请重新选择项目文件。'); return; }
      active.input.focus({ preventScroll: true });
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(request.caret);
      if (message.error) { showError(message.error); return; }
      if (typeof message.href !== 'string' || typeof message.name !== 'string') return;
      insertLink(request, message.href, message.name);
    }
    function resourceForm(kind, target, text, insertion) {
      const form = document.createElement('form'); form.className = 'folio-resource-form'; form.setAttribute('aria-label', '插入链接'); form.noValidate = true;
      const title = document.createElement('strong'); title.textContent = '插入链接';
      const nameLabel = document.createElement('label'); nameLabel.textContent = '链接文字';
      const name = document.createElement('input'); name.className = 'folio-control'; name.value = text; name.placeholder = '显示文字'; nameLabel.append(name);
      const urlLabel = document.createElement('label'); urlLabel.textContent = '链接地址';
      const url = document.createElement('input'); url.className = 'folio-control'; url.inputMode = 'url'; url.spellcheck = false; url.autocomplete = 'off'; url.placeholder = 'https://'; urlLabel.append(url);
      const error = document.createElement('p'); error.className = 'folio-form-error'; error.setAttribute('role', 'alert'); error.hidden = true;
      const actions = document.createElement('div'), cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = '插入链接'; actions.append(cancel, submit); form.append(title, nameLabel, urlLabel, error, actions);
      active.block.append(form); url.focus();
      const close = () => {
        form.remove(); if (!validInsertion(insertion)) return;
        active.input.focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(insertion.caret);
      };
      cancel.onclick = close;
      form.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
      form.onsubmit = event => {
        event.preventDefault(); const address = url.value.trim();
        if (!address || /^[a-z][a-z\d+.-]*:/i.test(address) && !/^(https?:|mailto:|file:)/i.test(address)) {
          error.textContent = address ? '请输入网页地址或文件路径。' : '请填写链接地址。'; error.hidden = false; url.setAttribute('aria-invalid', 'true'); url.focus(); return;
        }
        form.remove(); insertLink(insertion, address, name.value || address);
      };
      url.oninput = () => { error.hidden = true; url.removeAttribute('aria-invalid'); };
    }
    menu.addEventListener('mousedown', event => event.preventDefault());
    menu.addEventListener('click', event => { const button = event.target.closest('[data-module]'); if (button) selectModule(button.dataset.module); });
    document.addEventListener('pointerdown', event => {
      if (templates.element.open || images.element.open || formatting.element.contains(event.target) || codes.element.contains(event.target)) return;
      if (emojiPicker.element.contains(event.target)) return;
      if (emojiRequest) closeEmoji(false);
      if (!(event.target instanceof Element) || menu.contains(event.target) || recovery.contains(event.target)
        || event.target.closest('.folio-resource-form, .folio-table-controls, .folio-table-menu, .folio-task-menu')) return;
      if (event.altKey) { finish(); return; }
      if (event.target.closest('input, a, button, summary, textarea')) return;
      if (!documentEnd.hidden && event.button === 0 && !event.shiftKey && !event.metaKey && !event.ctrlKey
        && (event.target === documentEnd || (event.target === document.body || event.target === document.documentElement)
          && event.clientY >= documentEnd.getBoundingClientRect().top)) {
        event.preventDefault(); editDocumentEnd(); return;
      }
      const block = event.target.closest('.folio-block');
      if (block) {
        if (open(block)) {
          if (active.raw) { event.preventDefault(); active.input.focus(); }
          else if (event.target.closest('th, td')?.closest('table[data-folio-table]')) tables.select(event.target.closest('th, td'));
          else if (event.button === 0 && !event.shiftKey && focusEmptyTask(event)) event.preventDefault();
        }
      } else finish();
    });
    document.addEventListener('focusin', event => {
      if (emojiRequest && !emojiPicker.element.contains(event.target)) closeEmoji(false);
      const cell = event.target.closest?.('th, td');
      if (cell?.closest('table[data-folio-table]') && active?.content.contains(cell)) tables.select(cell);
    });
    main.addEventListener('click', event => {
      const button = event.target.closest('.folio-callout-emoji');
      if (button && !button.disabled) {
        event.preventDefault(); event.stopPropagation();
        if (!open(button.closest('.folio-block')) || active.raw) return;
        sync(); closeMenu(); formatting.hide(); const range = document.createRange(); range.selectNode(button);
        emojiRequest = { editor: active, source, callout: button.closest('.folio-callout') };
        button.setAttribute('aria-expanded', 'true'); emojiPicker.open(range, { action: '更换', title: '更换高亮块表情' }); return;
      }
      if (active?.content.contains(event.target) && event.target.closest('label.folio-task-label')) event.preventDefault();
    });
    const placeholderObserver = new MutationObserver(updatePlaceholders);
    placeholderObserver.observe(main, { childList: true, subtree: true, characterData: true });
    main.addEventListener('input', event => { if (active?.input.contains(event.target) || active?.input === event.target) { updatePlaceholders(); resize(); if (!composing && !event.isComposing) { sync(); updateMenu(); } } });
    main.addEventListener('compositionstart', () => { composing = true; updatePlaceholders(); closeMenu(); formatting.hide(); });
    main.addEventListener('compositionend', () => { composing = false; sync(); updateMenu(); });
    main.addEventListener('beforeinput', event => {
      if (/^format/.test(event.inputType) && lineAtCaret()?.line.closest('.folio-plain-quote')) { event.preventDefault(); return; }
      if (event.inputType === 'deleteContentBackward' && event.cancelable && !event.isComposing && !composing && active && event.target.isContentEditable
        && !event.target.closest('input, button, textarea, select') && (backspaceEmptyTask() || backspaceAcrossLines())) {
        event.preventDefault(); closeMenu(); return;
      }
      if (!autoList(event)) tables.beforeInput(event);
    });
    main.addEventListener('paste', paste);
    document.addEventListener('keydown', event => {
      if (event.target.closest?.('.folio-properties')) return;
      if (templates.element.open || images.element.open || codes.element.contains(event.target)) return;
      if (event.isComposing || composing) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && /^[biue]$/i.test(event.key) && lineAtCaret()?.line.closest('.folio-plain-quote')) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (formatting.keydown(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && writable) {
        event.preventDefault(); event.stopPropagation(); void flush().then(ok => { if (ok) host.postMessage({ type: 'save' }); }); return;
      }
      if (emojiPicker.element.contains(event.target)) return;
      if (event.target.closest?.('.folio-resource-form, .folio-task-menu')) return;
      if (event.target === documentEnd && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); editDocumentEnd(); return; }
      if (event.key === 'Enter' && event.target.classList?.contains('folio-block-content') && active?.content !== event.target) { event.preventDefault(); open(event.target.closest('.folio-block'), true); return; }
      if (!active) return;
      if (active.code && event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey && event.target === active.input) {
        event.preventDefault(); const input = active.input, start = input.selectionStart, end = input.selectionEnd;
        if (!event.shiftKey) input.setRangeText('  ', start, end, 'end');
        else { const line = input.value.lastIndexOf('\n', start - 1) + 1, count = Math.min(2, /^ */.exec(input.value.slice(line))[0].length); input.setRangeText('', line, line + count, 'end'); }
        resize(); sync(); return;
      }
      if (event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey && event.target.isContentEditable
        && !event.target.closest('input, button, textarea, select') && (backspaceEmptyTask() || backspaceAcrossLines())) {
        event.preventDefault(); event.stopPropagation(); closeMenu(); return;
      }
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey && event.target.isContentEditable
        && !event.target.closest('input, button, textarea, select') && changeListLevel(event.shiftKey)) {
        event.preventDefault(); event.stopPropagation(); closeMenu(); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '/') { event.preventDefault(); event.stopPropagation(); updateMenu(true); return; }
      if (!menu.hidden) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); menuState.selected = Math.max(0, Math.min(menuState.items.length - 1, menuState.selected + (event.key === 'ArrowDown' ? 1 : -1))); highlight(); }
        else if (event.key === 'Enter' && menuState.items.length) { event.preventDefault(); selectModule(menuState.items[menuState.selected][0]); }
        else if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
        return;
      }
      if (tables.keydown(event)) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !active.raw
        && !event.target.closest('input, button, textarea, select')) {
        if (enterList()) { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
        const location = lineAtCaret();
        const callout = location?.line.parentElement;
        if (callout?.matches('.folio-callout') && location.line.tagName === 'P' && !location.line.textContent && !location.line.querySelector(':not(br)')
          && !location.line.nextElementSibling && window.getSelection().isCollapsed) {
          event.preventDefault(); const before = source, caret = captureCaret(), paragraph = document.createElement('p'); paragraph.append(document.createElement('br'));
          callout.after(paragraph); location.line.remove();
          if ([...callout.children].every(child => child.matches('.folio-callout-emoji'))) callout.remove();
          caretEnd(paragraph); sync(); rememberListEdit(before, caret, captureCaret()); return;
        }
        if (location && /^H[1-6]$/.test(location.line.tagName) && window.getSelection().isCollapsed && location.before === location.line.textContent) {
          event.preventDefault(); const p = document.createElement('p'); p.append(document.createElement('br')); location.line.after(p); caretEnd(p); sync(); return;
        }
      }
      if (event.key === 'Escape') { event.preventDefault(); document.activeElement.blur(); finish(); }
    }, true);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, { passive: true });
    window.addEventListener('beforeunload', () => { placeholderObserver.disconnect(); sync(); if (pending.size || conflicted) remember(); });
    return {
      attach, receive, flush, resize, prepareView: prepareMove,
      owns: node => Boolean(active?.content.contains(node)),
      allowTask: node => writable && !composing && !conflicted && (active?.content.contains(node) || (!active && !pending.size)),
      handleTask: node => { if (active?.content.contains(node)) { sync(true); return true; } return false; },
      get editing() { return Boolean(active); }
    };
  };
})();
