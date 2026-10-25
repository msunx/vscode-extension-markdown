(() => {
  'use strict';
  const color = value => {
    if (/^#[\da-f]{6}$/i.test(value || '')) return value.toLowerCase();
    if (/^#[\da-f]{3}$/i.test(value || '')) return '#' + [...value.slice(1)].map(char => char + char).join('').toLowerCase();
    const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value || '');
    return rgb && rgb.slice(1).every(value => Number(value) <= 255) ? '#' + rgb.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('') : '';
  };
  const properties = ['bold', 'italic', 'underline', 'strike', 'code', 'mark', 'sup', 'sub', 'color', 'background'];
  const inlineTags = new Set('A STRONG B EM I U DEL S STRIKE CODE MARK SUP SUB SPAN FONT ABBR'.split(' '));
  const tagMarks = { STRONG: 'bold', B: 'bold', EM: 'italic', I: 'italic', U: 'underline', DEL: 'strike', S: 'strike', STRIKE: 'strike', CODE: 'code', MARK: 'mark', SUP: 'sup', SUB: 'sub' };
  const foreground = [['正文', '#cad3f5'], ['蓝色', '#8aadf4'], ['绿色', '#a6da95'], ['金色', '#eed49f'], ['桃色', '#f5a97f'], ['粉色', '#f5bde6'], ['紫色', '#c6a0f6'], ['青色', '#8bd5ca']];
  const backgrounds = [['无背景', ''], ['蓝色', '#354568'], ['绿色', '#34483f'], ['金色', '#50462f'], ['桃色', '#503b3b'], ['粉色', '#50394b'], ['紫色', '#443c5b'], ['青色', '#324a4c']];
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; };
  function marksOf(node, inherited) {
    const marks = { ...inherited }, tag = node.tagName;
    if (tagMarks[tag]) marks[tagMarks[tag]] = true;
    if (tag === 'A') marks.link = { href: node.getAttribute('data-href') || node.getAttribute('href') || '', title: node.getAttribute('title') };
    const foreground = color(node.style.color || (tag === 'FONT' ? node.getAttribute('color') : '')), background = color(node.style.backgroundColor);
    if (foreground) marks.color = foreground;
    if (background) marks.background = background;
    return marks;
  }
  function runsOf(scope) {
    const runs = []; let offset = 0;
    function visit(node, marks = {}) {
      if (node.nodeType === Node.TEXT_NODE) { runs.push({ text: node.textContent, marks, start: offset, end: offset + node.length }); offset += node.length; }
      else if (node instanceof Element && inlineTags.has(node.tagName) && !node.matches('[contenteditable=false], .folio-task-label')) {
        const next = marksOf(node, marks); for (const child of node.childNodes) visit(child, next);
      } else { runs.push({ node, marks, start: offset, end: offset + node.textContent.length }); offset += node.textContent.length; }
    }
    for (const child of scope.childNodes) visit(child);
    return runs;
  }
  function renderRun(run) {
    if (run.node) return run.node;
    let node = document.createTextNode(run.text); const marks = run.marks;
    const wrap = (tag, attributes = {}) => { const parent = document.createElement(tag); for (const [key, value] of Object.entries(attributes)) if (value !== null) parent.setAttribute(key, value); parent.append(node); node = parent; };
    for (const [mark, tag] of [['code', 'code'], ['bold', 'strong'], ['italic', 'em'], ['underline', 'u'], ['strike', 's'], ['mark', 'mark'], ['sup', 'sup'], ['sub', 'sub']]) if (marks[mark]) wrap(tag);
    if (marks.color || marks.background) wrap('span', { style: [marks.color && `color:${marks.color}`, marks.background && `background-color:${marks.background}`].filter(Boolean).join(';') });
    if (marks.link) wrap('a', marks.link);
    return node;
  }
  function mergeWrappers(scope) {
    // Rejoin split links and marks without touching list children or task controls.
    for (const child of [...scope.children]) if (inlineTags.has(child.tagName)) mergeWrappers(child);
    let node = scope.firstChild;
    while (node?.nextSibling) {
      const next = node.nextSibling;
      const signature = element => [...element.attributes].map(attribute => `${attribute.name}=${attribute.value}`).sort().join('\n');
      if (node.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) { node.appendData(next.data); next.remove(); }
      else if (node instanceof Element && next instanceof Element && inlineTags.has(node.tagName) && node.tagName === next.tagName && signature(node) === signature(next)) {
        node.append(...next.childNodes); next.remove(); mergeWrappers(node);
      } else node = next;
    }
  }
  function restoreRange(scope, start, end) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT), range = document.createRange(); let node, offset = 0, began = false;
    while ((node = walker.nextNode())) {
      if (!began && start <= offset + node.length) { range.setStart(node, Math.max(0, start - offset)); began = true; }
      if (began && end <= offset + node.length) { range.setEnd(node, Math.max(0, end - offset)); break; }
      offset += node.length;
    }
    if (!began) return;
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return range;
  }

  window.FolioFormatting = function ({ context, change }) {
    let saved = null, scheduled = false, pointer = false, paletteKind = null, applying = false, dismissed = null;
    const toolbar = el('div', 'folio-format-toolbar'); toolbar.hidden = true; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '文字样式');
    const controls = [
      ['bold', '加粗', 'B', '⌘B'], ['italic', '斜体', 'I', '⌘I'], ['underline', '下划线', 'U', ''], ['strike', '删除线', 'S', ''],
      ['code', '行内代码', '</>', '⌘E'], ['color', '文字颜色', 'A', ''], ['background', '背景色', 'A', ''], ['clear', '清除格式', 'Tx', '']
    ];
    for (const [id, label, icon, shortcut] of controls) {
      const button = el('button', `folio-format-${id}`, icon); button.type = 'button'; button.dataset.format = id;
      button.setAttribute('aria-label', label); button.title = label + (shortcut ? `（${navigator.platform.includes('Mac') ? shortcut : shortcut.replace('⌘', 'Ctrl+')}）` : '');
      if (id === 'color' || id === 'background') { button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); }
      else if (id !== 'clear') button.setAttribute('aria-pressed', 'false');
      toolbar.append(button);
    }
    const palette = el('div', 'folio-format-palette'); palette.hidden = true; palette.setAttribute('role', 'dialog'); palette.setAttribute('aria-label', '颜色选择');
    toolbar.append(palette); document.body.append(toolbar);
    function capture() {
      const current = context(), selection = window.getSelection();
      if (!current || !selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return null;
      const range = selection.getRangeAt(0), element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const scopeOf = node => element(node)?.closest('.folio-task-label, p, h1, h2, h3, h4, h5, h6, th, td, li');
      const scope = scopeOf(range.startContainer);
      if (!scope || scope !== scopeOf(range.endContainer) || !current.contains(scope) || !scope.isContentEditable || scope.closest('pre')
        || range.cloneContents().querySelector('input, img, button, [contenteditable=false]')) return null;
      const prefix = range.cloneRange(); prefix.selectNodeContents(scope); prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length, end = start + range.toString().length;
      return { scope, start, end, range: range.cloneRange(), html: scope.innerHTML, current };
    }
    function valid() { return saved && context() === saved.current && saved.scope.isConnected && saved.scope.innerHTML === saved.html; }
    function selectedRuns() { return runsOf(saved.scope).filter(run => run.text !== undefined && run.end > saved.start && run.start < saved.end); }
    function closePalette() {
      palette.hidden = true; paletteKind = null;
      toolbar.querySelectorAll('[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }
    function hide() { toolbar.hidden = true; saved = null; closePalette(); }
    function update() {
      if (applying || pointer || toolbar.contains(document.activeElement)) return;
      const next = capture();
      if (!next) { hide(); return; }
      if (dismissed && dismissed.scope === next.scope && dismissed.start === next.start && dismissed.end === next.end && dismissed.html === next.html) { hide(); return; }
      dismissed = null;
      if (!saved || saved.scope !== next.scope || saved.start !== next.start || saved.end !== next.end) closePalette();
      saved = next; const opening = toolbar.hidden; toolbar.hidden = false; toolbar.classList.toggle('is-opening', opening);
      const runs = selectedRuns();
      if (!runs.length) { hide(); return; }
      for (const button of toolbar.querySelectorAll('[aria-pressed]')) button.setAttribute('aria-pressed', String(runs.every(run => run.marks[button.dataset.format])));
      toolbar.style.setProperty('--folio-selected-color', runs.every(run => run.marks.color === runs[0].marks.color) ? runs[0].marks.color || 'var(--folio-fg)' : 'var(--folio-fg)');
      position();
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; update(); }); } }
    function position() {
      if (toolbar.hidden || !valid()) return;
      const rect = saved.range.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || !rect.height) { hide(); return; }
      const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
      toolbar.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
      const above = rect.top - height - 10;
      toolbar.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, above >= 8 ? above : rect.bottom + 10))}px`;
      const top = toolbar.getBoundingClientRect().top, paletteAbove = top >= palette.offsetHeight + 14;
      palette.classList.toggle('is-above', paletteAbove);
      palette.style.top = paletteAbove ? '' : `${Math.min(innerHeight - palette.offsetHeight - top - 8, Math.max(height + 6, rect.bottom - top + 10))}px`;
      palette.style.left = `${Math.min(0, innerWidth - 8 - toolbar.getBoundingClientRect().left - palette.offsetWidth)}px`;
    }
    function apply(kind, value) {
      if (!valid()) { hide(); return; }
      const snapshot = saved, { scope, start, end } = snapshot, runs = runsOf(scope);
      const selected = runs.filter(run => run.text !== undefined && run.end > start && run.start < end);
      if (!selected.length) return;
      const remove = selected.every(run => run.marks[kind]);
      applying = true;
      change(() => {
        const output = [];
        const append = run => {
          const previous = output.at(-1);
          if (!run.node && !run.text) return;
          if (!run.node && previous && !previous.node && JSON.stringify(previous.marks) === JSON.stringify(run.marks)) previous.text += run.text;
          else output.push(run);
        };
        for (const run of runs) {
          if (run.node || run.end <= start || run.start >= end) { append(run); continue; }
          const left = Math.max(0, start - run.start), right = Math.min(run.text.length, end - run.start), marks = { ...run.marks };
          if (kind === 'clear') for (const property of properties) delete marks[property];
          else if (kind === 'color' || kind === 'background') { if (value) marks[kind] = value; else delete marks[kind]; if (kind === 'background') delete marks.mark; }
          else if (remove) delete marks[kind]; else marks[kind] = true;
          append({ text: run.text.slice(0, left), marks: run.marks }); append({ text: run.text.slice(left, right), marks }); append({ text: run.text.slice(right), marks: run.marks });
        }
        scope.replaceChildren(...output.map(renderRun)); mergeWrappers(scope);
        (scope.closest('[contenteditable=true]') || scope).focus({ preventScroll: true }); restoreRange(scope, start, end);
      });
      applying = false; closePalette(); saved = null; dismissed = null; update();
    }
    function showPalette(kind) {
      if (!valid()) { hide(); return; }
      if (paletteKind === kind) { closePalette(); return; }
      closePalette(); paletteKind = kind; palette.replaceChildren(el('p', '', kind === 'color' ? '文字颜色' : '背景色'));
      const choices = kind === 'color' ? foreground : backgrounds, grid = el('div', 'folio-format-swatches');
      const selected = selectedRuns(), selectedColor = selected.every(run => run.marks[kind] === selected[0].marks[kind]) ? selected[0].marks[kind] || '' : null;
      for (const [name, value] of choices) {
        const button = el('button', 'folio-format-swatch', value ? 'A' : '／'); button.type = 'button'; button.dataset.color = value; button.title = name;
        button.setAttribute('aria-label', `${kind === 'color' ? '文字' : '背景'}：${name}`); button.setAttribute('aria-pressed', String(value === selectedColor));
        button.style.setProperty('--folio-swatch', value || 'transparent'); button.classList.toggle('is-background', kind === 'background');
        button.addEventListener('click', () => apply(kind, value)); grid.append(button);
      }
      palette.append(grid); palette.hidden = false; toolbar.querySelector(`[data-format=${kind}]`).setAttribute('aria-expanded', 'true'); position();
    }
    toolbar.addEventListener('pointerdown', event => event.preventDefault());
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('[data-format]'); if (!button) return;
      const kind = button.dataset.format; if (kind === 'color' || kind === 'background') showPalette(kind); else apply(kind);
    });
    toolbar.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (paletteKind) { const button = toolbar.querySelector(`[data-format=${paletteKind}]`); closePalette(); button.focus(); }
        else if (valid()) { const { scope, start, end } = saved; dismissed = saved; scope.closest('[contenteditable=true]')?.focus({ preventScroll: true }); restoreRange(scope, start, end); hide(); }
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); const buttons = [...toolbar.querySelectorAll('button')].filter(button => button.getClientRects().length);
        const index = buttons.indexOf(document.activeElement), direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + direction + buttons.length) % buttons.length]?.focus();
      }
    });
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', event => { if (toolbar.contains(event.target)) return; pointer = true; dismissed = null; hide(); }, true);
    document.addEventListener('pointerup', () => { pointer = false; schedule(); });
    document.addEventListener('pointercancel', () => { pointer = false; schedule(); });
    document.addEventListener('input', schedule); document.addEventListener('focusin', schedule);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return {
      element: toolbar, hide,
      keydown(event) {
        if (event.isComposing) return false;
        if (toolbar.contains(event.target)) {
          if ((event.metaKey || event.ctrlKey) && !event.altKey && ['s', 'z', 'y'].includes(event.key.toLowerCase()) && valid()) {
            const { scope, start, end } = saved; dismissed = saved;
            scope.closest('[contenteditable=true]')?.focus({ preventScroll: true }); restoreRange(scope, start, end); hide(); return false;
          }
          const shortcut = { b: 'bold', i: 'italic', e: 'code' }[event.key.toLowerCase()];
          if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && shortcut && valid()) {
            event.preventDefault(); event.stopPropagation(); apply(shortcut);
          }
          return true;
        }
        if (event.key === 'Escape' && !toolbar.hidden) {
          event.preventDefault(); event.stopPropagation(); if (paletteKind) closePalette(); else { dismissed = saved; hide(); } return true;
        }
        if (event.altKey && event.key === 'F10' && capture()) { event.preventDefault(); event.stopPropagation(); dismissed = null; update(); toolbar.querySelector('button').focus(); return true; }
        const kind = { b: 'bold', i: 'italic', e: 'code' }[event.key.toLowerCase()];
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && kind && capture()) {
          event.preventDefault(); event.stopPropagation(); saved = capture(); apply(kind); return true;
        }
        return false;
      }
    };
  };
  window.FolioFormatting.color = color;
})();
