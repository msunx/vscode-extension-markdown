(() => {
  'use strict';
  const headingSelector = 'h1,h2,h3,h4,h5,h6';
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const chevron = icon('M9 5l7 7-7 7');
  const button = (className, label, html) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = className;
    node.setAttribute('aria-label', label); node.title = label; node.innerHTML = html; return node;
  };
  window.FolioOutline = function ({ host, prepare, showError }) {
    const main = document.querySelector('.markdown-body'), wide = matchMedia('(min-width: 1100px)');
    const openIcon = icon('M4 6h2M10 6h10M4 12h2M10 12h10M4 18h2M10 18h10'), closeIcon = icon('M14 6l-6 6 6 6M20 6l-6 6 6 6');
    const toggle = button('folio-outline-toggle', '显示目录', openIcon);
    toggle.setAttribute('aria-controls', 'folio-outline'); toggle.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('nav'); panel.id = 'folio-outline'; panel.className = 'folio-outline'; panel.setAttribute('aria-label', '文档目录'); panel.hidden = true;
    const list = document.createElement('div'); list.className = 'folio-outline-list';
    panel.append(list); document.body.append(toggle, panel);
    let entries = [], segments = [], folded = new Set(), collapsed = new Set(), expanded = wide.matches, initialized = false, signature = '', busy = false, frame = 0, refreshFrame = 0;
    let activeKey = null, jumpTarget = null, revealedRow = null;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const save = () => {
      const state = { folded: [...folded].slice(0, 512), collapsed: [...collapsed].slice(0, 512), open: expanded };
      host.setState({ ...(host.getState() || {}), outline: state }); host.postMessage({ type: 'outline-state', state });
    };
    function layout() {
      closeTitle();
      const exists = entries.length > 0;
      toggle.hidden = !exists; panel.hidden = !exists || !expanded;
      toggle.setAttribute('aria-expanded', String(exists && expanded));
      const label = expanded ? '隐藏目录' : '显示目录';
      if (toggle.getAttribute('aria-label') !== label) { toggle.setAttribute('aria-label', label); toggle.title = label; toggle.innerHTML = expanded ? closeIcon : openIcon; }
      document.body.classList.toggle('folio-has-outline', exists);
      document.body.classList.toggle('folio-outline-pinned', exists && expanded && wide.matches);
      schedulePosition();
    }
    function setOpen(value, focus = false) {
      expanded = value; layout(); save();
      if (focus) (value ? list.querySelector('[aria-current=location]') || list.querySelector('.folio-outline-link') || toggle : toggle).focus({ preventScroll: true });
    }
    function setBusy(value) {
      busy = value; panel.setAttribute('aria-busy', String(value));
      for (const control of document.querySelectorAll('.folio-heading-fold, .folio-outline-link')) control.disabled = value;
    }
    async function action(run) {
      if (busy) return;
      setBusy(true);
      try {
        if (!await prepare()) { showError('请先完成当前输入，或处理尚未同步的编辑内容。'); return; }
        refresh(); run(); save();
      } catch { showError('章节操作未完成，请稍后重试；当前编辑内容已保留。');
      } finally { setBusy(false); }
    }
    function applyFolds() {
      const children = [...main.children], stack = [];
      const at = new Map();
      for (const entry of entries) { if (!at.has(entry.block)) at.set(entry.block, []); at.get(entry.block).push(entry); }
      for (const node of children) {
        const headings = at.get(node) || [], first = headings.find(entry => entry.heading === node.querySelector('.folio-block-content')?.firstElementChild);
        if (first) while (stack.length && stack.at(-1).level >= first.level) stack.pop();
        node.classList.toggle('folio-section-hidden', !node.classList.contains('is-editing') && stack.some(parent => folded.has(parent.key)));
        for (const entry of headings) {
          while (stack.length && stack.at(-1).level >= entry.level) stack.pop();
          stack.push(entry);
        }
      }
      for (const entry of entries) {
        const collapsed = folded.has(entry.key), label = `${collapsed ? '展开' : '折叠'}“${entry.text || '未命名标题'}”章节`;
        if (entry.control) entry.block.classList.toggle('folio-heading-collapsed', collapsed);
        const control = entry.control;
        if (control) {
          control.setAttribute('aria-expanded', String(!collapsed)); control.setAttribute('aria-label', label); control.title = label;
        }
      }
      schedulePosition();
    }
    function toggleSection(key, focus = false) {
      const target = entries.find(item => item.key === key);
      void action(() => {
        const entry = resolveTarget(key, target); if (!entry?.foldable) return;
        key = entry.key;
        jumpTarget = null;
        const top = entry.heading.getBoundingClientRect().top;
        if (folded.has(key)) folded.delete(key); else folded.add(key);
        applyFolds();
        if (!entry.block.classList.contains('folio-section-hidden')) window.scrollBy(0, entry.heading.getBoundingClientRect().top - top);
        if (focus) entry.control?.focus({ preventScroll: true });
      });
    }
    function resolveTarget(key, target) {
      return entries.find(item => item.key === key) || (target && entries.find(item => item.heading === target.heading || item.order === target.order && item.text === target.heading.textContent.trim()));
    }
    function reveal(element) {
      const block = element?.closest('.folio-block'); if (!block) return;
      const index = segments.findIndex(segment => segment.node === element || segment.node.contains(element) || segment.block === element);
      for (const entry of entries) if (entry.index < index && entry.end > index) folded.delete(entry.key);
      applyFolds(); save();
    }
    function jump(key) {
      const target = entries.find(item => item.key === key);
      void action(() => {
        const entry = resolveTarget(key, target); if (!entry) return;
        folded.delete(entry.key);
        reveal(entry.heading);
        if (!wide.matches) { expanded = false; layout(); }
        entry.heading.tabIndex = -1; entry.heading.focus({ preventScroll: true });
        window.scrollBy({ top: entry.heading.getBoundingClientRect().top - 76, behavior: 'instant' });
        jumpTarget = { key: entry.key, scroll: scrollY };
        markActive(entry.key); entry.heading.classList.remove('folio-heading-arrival');
        requestAnimationFrame(() => entry.heading.isConnected && entry.heading.classList.add('folio-heading-arrival'));
      });
    }
    function markActive(key) {
      activeKey = key;
      let current = entries.find(entry => entry.key === key);
      while (current?.treeHidden) current = current.parent;
      for (const entry of entries) {
        const link = entry.row?.querySelector('.folio-outline-link');
        if (entry === current) link?.setAttribute('aria-current', 'location'); else link?.removeAttribute('aria-current');
      }
    }
    function applyTree() {
      for (const entry of entries) {
        entry.treeHidden = Boolean(entry.parent && (entry.parent.treeHidden || collapsed.has(entry.parent.key)));
        entry.row.classList.toggle('is-tree-hidden', entry.treeHidden); entry.row.inert = entry.treeHidden;
        entry.row.setAttribute('aria-hidden', String(entry.treeHidden));
        const control = entry.row.querySelector('.folio-outline-fold');
        if (control) {
          const closed = collapsed.has(entry.key);
          control.setAttribute('aria-expanded', String(!closed)); control.setAttribute('aria-label', `${closed ? '展开' : '收起'}“${entry.text || '未命名标题'}”的子目录`);
        }
      }
      markActive(activeKey);
    }
    function toggleTree(key, value) {
      const entry = entries.find(item => item.key === key); if (!entry?.hasChildren) return;
      closeTitle();
      if (value ?? !collapsed.has(key)) collapsed.add(key); else collapsed.delete(key);
      applyTree(); save();
    }
    function closeTitle() {
      if (!revealedRow) return;
      revealedRow.titleMotion?.cancel(); revealedRow.titleMotion = null;
      revealedRow.classList.remove('is-revealing'); revealedRow.style.removeProperty('--folio-title-width'); revealedRow = null;
    }
    function revealTitle(row) {
      if (!row || row.inert || row === revealedRow) return;
      closeTitle();
      const text = row.querySelector('.folio-outline-text'), title = row.querySelector('.folio-outline-title');
      const fullWidth = title.getBoundingClientRect().width;
      if (fullWidth <= text.clientWidth + 1) return;
      const rect = row.getBoundingClientRect(), width = Math.min(innerWidth - rect.left - 24, rect.width + fullWidth - text.clientWidth + 2);
      revealedRow = row; row.style.setProperty('--folio-title-width', `${Math.max(rect.width, width)}px`); row.classList.add('is-revealing');
      const overflow = fullWidth - (text.clientWidth + width - rect.width);
      if (overflow > 1 && !reducedMotion.matches) {
        row.titleMotion = title.animate([{ transform: 'translateX(0)', offset: 0 }, { transform: 'translateX(0)', offset: .15 },
          { transform: `translateX(-${overflow + 2}px)`, offset: .85 }, { transform: `translateX(-${overflow + 2}px)`, offset: 1 }],
        { delay: 450, duration: Math.max(4000, overflow / 36 * 1000 + 1600), iterations: Infinity, direction: 'alternate', easing: 'linear' });
      }
    }
    function position() {
      frame = 0;
      for (const entry of entries) {
        if (!entry.control || entry.block.classList.contains('folio-section-hidden')) continue;
        const rect = entry.heading.getBoundingClientRect(), block = entry.block.getBoundingClientRect(), height = parseFloat(getComputedStyle(entry.heading).lineHeight) || 28;
        entry.control.style.top = `${Math.max(0, rect.top - block.top + height / 2 - 14)}px`;
      }
      const visible = entries.filter(entry => !entry.block.classList.contains('folio-section-hidden'));
      if (jumpTarget && Math.abs(jumpTarget.scroll - scrollY) > 2) jumpTarget = null;
      const atEnd = document.documentElement.scrollHeight > innerHeight + 2 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
      const selected = jumpTarget && visible.find(entry => entry.key === jumpTarget.key);
      const current = selected || (atEnd ? visible.at(-1) : visible.filter(entry => entry.heading.getBoundingClientRect().top <= 120).at(-1) || visible[0]);
      if (current?.key !== activeKey) markActive(current?.key);
    }
    function schedulePosition() { if (!frame) frame = requestAnimationFrame(position); }
    function refresh() {
      cancelAnimationFrame(refreshFrame); refreshFrame = 0;
      const previous = new Map(entries.map(entry => [entry.heading, entry])), occurrences = new Map(), parents = [];
      entries = []; segments = []; let migrated = false;
      for (const block of main.querySelectorAll(':scope > .folio-block')) {
        const content = block.querySelector('.folio-block-content'); if (!content) continue;
        for (const node of content.children) {
          const index = segments.length; segments.push({ block, node });
          if (!node.matches(headingSelector)) continue;
          const text = node.textContent.trim(), level = Number(node.tagName[1]), identity = `${level}:${text}`;
          const ordinal = occurrences.get(identity) || 0; occurrences.set(identity, ordinal + 1);
          const key = JSON.stringify([level, text, ordinal]), old = previous.get(node);
          if (old && old.key !== key) for (const set of [folded, collapsed]) if (set.delete(old.key)) { set.add(key); migrated = true; }
          while (parents.length && parents.at(-1).level >= level) parents.pop();
          const entry = { key, text, level, index, block, heading: node, order: entries.length, parent: parents.at(-1) };
          if (entry.parent) entry.parent.hasChildren = true;
          if (!old && initialized && block.classList.contains('is-editing')) for (const parent of parents) if (collapsed.delete(parent.key)) migrated = true;
          entries.push(entry); parents.push(entry);
        }
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]; entry.end = entries.slice(i + 1).find(next => next.level <= entry.level)?.index ?? segments.length; entry.foldable = entry.end > entry.index + 1;
        const first = entry.heading === entry.block.querySelector('.folio-block-content').firstElementChild;
        let control = first && entry.block.querySelector(':scope > .folio-heading-fold');
        if (first && entry.foldable && !control) { control = button('folio-heading-fold', '', chevron); entry.block.append(control); }
        if (control) { control.hidden = !entry.foldable; control.dataset.outlineKey = entry.key; control.disabled = busy; }
        entry.control = control || null;
      }
      for (const control of main.querySelectorAll('.folio-heading-fold')) if (!entries.some(entry => entry.control === control)) { control.parentElement.classList.remove('folio-heading-collapsed'); control.remove(); }
      const nextSignature = JSON.stringify(entries.map(entry => [entry.key, Boolean(entry.hasChildren), entry.heading.classList.contains('folio-today-heading')]));
      if (nextSignature !== signature) {
        const scroll = list.scrollTop, focused = document.activeElement.closest('.folio-outline-row'), focusedKey = focused?.dataset.outlineKey;
        const focusedFold = document.activeElement.matches('.folio-outline-fold');
        closeTitle(); signature = nextSignature; list.replaceChildren();
        const min = Math.min(...entries.map(entry => entry.level));
        for (const entry of entries) {
          const row = document.createElement('div'); row.className = 'folio-outline-row'; row.dataset.outlineKey = entry.key;
          row.style.setProperty('--folio-outline-depth', entry.level - min); row.style.setProperty('--folio-outline-color', `var(--folio-heading-${entry.level})`);
          const link = button('folio-outline-link', `跳转到：${entry.text || '未命名标题'}`, ''); link.disabled = busy; link.removeAttribute('title');
          const marker = entry.hasChildren ? button('folio-outline-fold', '', chevron) : document.createElement('span');
          marker.removeAttribute('title'); if (!entry.hasChildren) { marker.className = 'folio-outline-dot'; marker.setAttribute('aria-hidden', 'true'); }
          const text = document.createElement('span'); text.className = 'folio-outline-text';
          const title = document.createElement('span'); title.className = 'folio-outline-title'; title.textContent = entry.heading.classList.contains('folio-today-heading') ? '今天' : entry.text || '未命名标题';
          text.append(title); link.append(text); row.append(marker, link); list.append(row); entry.row = row;
        }
        list.scrollTop = scroll;
        if (focusedKey) entries.find(entry => entry.key === focusedKey)?.row.querySelector(focusedFold ? '.folio-outline-fold' : '.folio-outline-link')?.focus({ preventScroll: true });
      } else entries.forEach((entry, index) => { entry.row = list.children[index]; });
      applyFolds(); applyTree();
      const editing = main.querySelector('.folio-section-hidden.is-editing');
      if (editing) reveal(editing);
      layout(); markActive(activeKey); if (migrated) save();
    }
    function scheduleRefresh() { if (!refreshFrame) refreshFrame = requestAnimationFrame(refresh); }
    const observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.target === main || (mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement)?.closest('.folio-block-content'))) scheduleRefresh();
    });
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    toggle.onclick = () => setOpen(!expanded, true);
    main.addEventListener('click', event => { const control = event.target.closest('.folio-heading-fold'); if (control) { event.preventDefault(); event.stopPropagation(); toggleSection(control.dataset.outlineKey, true); } });
    list.addEventListener('click', event => {
      const row = event.target.closest('.folio-outline-row'); if (!row) return;
      if (event.target.closest('.folio-outline-fold')) toggleTree(row.dataset.outlineKey);
      else if (event.target.closest('.folio-outline-link')) jump(row.dataset.outlineKey);
    });
    list.addEventListener('pointerover', event => revealTitle(event.target.closest('.folio-outline-row')));
    list.addEventListener('pointerout', event => {
      if (revealedRow && !revealedRow.contains(event.relatedTarget) && !revealedRow.contains(document.activeElement)) closeTitle();
    });
    list.addEventListener('focusin', event => revealTitle(event.target.closest('.folio-outline-row')));
    list.addEventListener('focusout', event => { if (revealedRow && !revealedRow.contains(event.relatedTarget)) closeTitle(); });
    list.addEventListener('scroll', closeTitle, { passive: true });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false, true); return; }
      const entry = entries.find(item => item.key === event.target.closest('.folio-outline-row')?.dataset.outlineKey);
      if (!entry) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const visible = entries.filter(item => !item.treeHidden), index = visible.indexOf(entry);
        visible[event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.row.querySelector('.folio-outline-link').focus();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.key === 'ArrowLeft') {
          if (entry.hasChildren && !collapsed.has(entry.key)) toggleTree(entry.key, true);
          else entry.parent?.row.querySelector('.folio-outline-link').focus();
        } else if (entry.hasChildren) {
          if (collapsed.has(entry.key)) toggleTree(entry.key, false);
          else entries[entry.order + 1]?.row.querySelector('.folio-outline-link').focus();
        }
      }
    });
    document.addEventListener('pointerdown', event => { if (expanded && !wide.matches && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false); }, true);
    window.addEventListener('scroll', schedulePosition, { passive: true }); window.addEventListener('resize', layout);
    wide.addEventListener('change', () => { if (!wide.matches) expanded = false; layout(); });
    reducedMotion.addEventListener('change', closeTitle);
    window.addEventListener('beforeunload', () => { observer.disconnect(); cancelAnimationFrame(refreshFrame); cancelAnimationFrame(frame); closeTitle(); }, { once: true });
    return { refresh, reveal, attach(message) {
      if (!initialized) {
        const state = host.getState()?.outline || message.outlineState || {};
        folded = new Set(Array.isArray(state.folded) ? state.folded.filter(key => typeof key === 'string') : []);
        collapsed = new Set(Array.isArray(state.collapsed) ? state.collapsed.filter(key => typeof key === 'string') : []);
        expanded = wide.matches && state.open !== false; initialized = true;
      }
      refresh();
    } };
  };
})();
