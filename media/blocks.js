(() => {
  'use strict';
  const icons = {
    p: 'M4 5h16M12 5v14M8 19h8', heading: 'M5 4v16M19 4v16M5 12h14',
    task: 'M9 11l3 3 7-8M19 12v7H4V4h11', list: 'M4 6h1M4 12h1M4 18h1M9 6h11M9 12h11M9 18h11',
    table: 'M3 4h18v16H3ZM3 10h18M10 4v16', code: 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16',
    blockquote: 'M4 6h6v7H4ZM10 13c0 4-2 6-5 6M14 6h6v7h-6ZM20 13c0 4-2 6-5 6',
    hr: 'M3 12h7M14 12h7M12 10l2 2-2 2-2-2Z', image: 'M3 3h18v18H3ZM3 17l6-6 5 5 3-3 4 4M16 7h1',
    block: 'M4 4h16v16H4ZM4 10h16'
  };
  const labels = { p: '正文', heading: '标题', task: '任务', list: '列表', table: '表格', code: '代码块', blockquote: '引用', hr: '分隔线', image: '图片', block: '内容块' };
  const ownTask = item => item.querySelector(':scope > input.task-list-item-checkbox, :scope > p > input.task-list-item-checkbox');
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const trimEol = text => text.replace(/\r?\n$/, '');
  function lineOffsets(text) {
    const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1); starts.push(text.length); return starts;
  }
  function lineRanges(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
    let node, position = 0;
    while ((node = walker.nextNode())) { nodes.push({ node, start: position }); position += node.length; }
    const text = element.textContent, parts = text.split('\n'), ranges = [];
    let offset = 0;
    for (const part of parts) {
      const first = nodes.find(entry => entry.start + entry.node.length > offset);
      const last = nodes.find(entry => entry.start + entry.node.length >= offset + part.length);
      if (part.length && first && last) {
        const range = document.createRange(); range.setStart(first.node, offset - first.start); range.setEnd(last.node, offset + part.length - last.start); ranges.push(range);
      } else ranges.push(null);
      offset += part.length + 1;
    }
    return ranges;
  }
  function moveSource(base, unit, target, after) {
    let destination = after ? target.end : target.start;
    if (destination > unit.start && destination < unit.end) return base;
    const eol = base.includes('\r\n') ? '\r\n' : '\n';
    let text = trimEol(base.slice(unit.start, unit.end));
    if (!text.trim()) return base;
    if (unit.kind === 'task') {
      const indent = text.match(/^[ \t]*/)[0], next = target.kind === 'task' ? base.slice(target.start).match(/^[ \t]*/)[0] : '';
      text = text.split(eol).map(line => line.startsWith(indent) ? next + line.slice(indent.length) : line).join(eol);
    }
    if ((destination === unit.start || destination === unit.end) && text === trimEol(base.slice(unit.start, unit.end))) return base;
    const rest = base.slice(0, unit.start) + base.slice(unit.end);
    if (destination >= unit.end) destination -= unit.end - unit.start;
    const before = rest.slice(0, destination), tail = rest.slice(destination);
    const contiguous = unit.kind === 'task' && target.kind === 'task' || unit.kind === 'p' && target.kind === 'p' && unit.block === target.block;
    const gap = contiguous ? 1 : 2;
    const trailing = (before.match(/(?:\r?\n)+$/)?.[0].match(/\n/g) || []).length;
    const leading = (tail.match(/^(?:\r?\n)+/)?.[0].match(/\n/g) || []).length;
    const left = before ? eol.repeat(Math.max(0, gap - trailing)) : '';
    // The payload lost its final EOL; always restore it before the existing suffix.
    // Otherwise a list's separating blank line becomes a soft break and absorbs the next paragraph.
    const right = tail ? eol.repeat(Math.max(1, gap - leading)) : /\r?\n$/.test(base) ? eol : '';
    return before + left + text + right + tail;
  }
  window.FolioBlocks = function ({ main, read, canMove, prepare, commit }) {
    const handle = document.createElement('button'), guide = document.createElement('div'), ghost = document.createElement('div'), status = document.createElement('div');
    handle.type = 'button'; handle.className = 'folio-drag-handle'; handle.hidden = true; handle.setAttribute('aria-label', '拖动内容块');
    const menu = document.createElement('div'), remove = document.createElement('button'), divider = document.createElement('div'), choices = document.createElement('div');
    menu.className = 'folio-block-menu'; menu.id = 'folio-block-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '内容块操作');
    remove.type = 'button'; remove.setAttribute('role', 'menuitem'); remove.className = 'is-destructive';
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg><span>删除</span>';
    divider.className = 'folio-block-menu-divider'; divider.setAttribute('role', 'separator');
    choices.className = 'folio-convert-choices'; choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '转换格式');
    menu.append(remove, divider, choices); handle.setAttribute('aria-haspopup', 'menu'); handle.setAttribute('aria-controls', menu.id); handle.setAttribute('aria-expanded', 'false');
    guide.className = 'folio-drop-guide'; guide.hidden = true; guide.setAttribute('aria-hidden', 'true');
    ghost.className = 'folio-drag-ghost'; ghost.hidden = true; ghost.setAttribute('aria-hidden', 'true');
    status.className = 'folio-drag-status'; status.setAttribute('role', 'status');
    main.tabIndex = -1;
    document.body.append(handle, guide, ghost, status, menu);
    let hovered = null, drag = null, menuTarget = null, frame = 0, hoverFrame = 0, lastPointer = null;
    function collect(fresh = false) {
      const source = read(), lines = lineOffsets(source), units = [];
      const add = (block, element, kind, start, end, range = null, depth = 0) => {
        while (end > start && !trimEol(source.slice(lines[end - 1], lines[end])).trim()) end--;
        const begin = lines[start] ?? (!fresh ? Number(block.dataset.sourceStart) : undefined), finish = lines[end] ?? (!fresh ? Number(block.dataset.sourceEnd) : undefined);
        if (begin === undefined || finish === undefined || finish <= begin) return;
        const label = kind === 'task' ? element.querySelector(':scope > .folio-task-label, :scope > p > .folio-task-label') : null;
        const anchor = label || (kind === 'table' ? element.querySelector('table') : null) || element;
        const title = kind === 'table' ? anchor : kind === 'code' ? element.querySelector('code') || element : label || element;
        const name = normalize(range ? range.toString() : title.textContent);
        const unit = { block, element, anchor, kind, start: begin, end: finish, range, depth, name };
        unit.key = `${kind}:${name}`; unit.occurrence = units.filter(other => other.key === unit.key).length;
        units.push(unit);
      };
      for (const block of main.querySelectorAll(':scope > .folio-block')) {
        if (block.classList.contains('folio-section-hidden')) continue;
        if (block.dataset.documentEnd === 'true' && !source.slice(Number(block.dataset.sourceStart), Number(block.dataset.sourceEnd)).trim()) continue;
        const content = block.querySelector('.folio-block-content');
        const elements = !fresh && block.classList.contains('is-editing') && block.dataset.editMode === 'rich' ? [...content.children] : [content?.firstElementChild];
        for (const element of elements) {
          if (!element) continue;
          const start = Number(block.dataset.startLine), end = Number(block.dataset.endLine), tag = element.tagName.toLowerCase();
          if (/^(ul|ol)$/.test(tag) && [...element.children].every(item => item.tagName === 'LI' && ownTask(item))) {
            const tasks = (list, depth) => {
              for (const item of list.children) {
                if (item.tagName !== 'LI' || !ownTask(item)) continue;
                add(block, item, 'task', Number(item.dataset.folioMoveStartLine), Number(item.dataset.folioMoveEndLine), null, depth);
                for (const child of item.querySelectorAll(':scope > ul, :scope > ol')) if ([...child.children].every(ownTask)) tasks(child, depth + 1);
              }
            };
            tasks(element, 0);
          } else if (tag === 'p' && block.dataset.editMode === 'rich') {
            const ranges = lineRanges(element);
            const spansLines = [...element.querySelectorAll('a, strong, em, code, del, s, mark, sup, sub, span, u, b, i, font')].some(inline => inline.textContent.includes('\n'));
            if (!spansLines && ranges.length === end - start && ranges.every(Boolean)) ranges.forEach((range, index) => add(block, element, 'p', start + index, start + index + 1, range));
            else add(block, element, 'p', start, end);
          } else {
            const kind = /^h[1-6]$/.test(tag) ? 'heading' : /^(ul|ol|dl)$/.test(tag) ? 'list'
              : element.matches('.folio-table, .folio-table-shell') ? 'table' : element.matches('.folio-code-block, pre') ? 'code'
                : element.querySelector('img') && tag === 'p' ? 'image' : icons[tag] ? tag : 'block';
            add(block, element, kind, start, end);
          }
        }
        const input = !fresh && block.querySelector('.folio-source-input');
        if (input && units.at(-1)?.block === block) {
          const unit = units.at(-1); unit.element = input; unit.anchor = input; unit.rawText = input.value.replace(/\r\n/g, '\n').trimEnd();
        }
        const codeInput = !fresh && block.querySelector('.folio-code-input');
        if (codeInput && units.at(-1)?.block === block) {
          const unit = units.at(-1); unit.element = codeInput; unit.anchor = codeInput; unit.codeText = codeInput.value.replace(/\r\n/g, '\n').trimEnd();
        }
      }
      return units;
    }
    function bounds(unit, full = false) {
      const rect = unit.range ? unit.range.getBoundingClientRect() : (full ? unit.element : unit.anchor).getBoundingClientRect();
      const root = unit.block.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: unit.kind === 'task' ? unit.element.getBoundingClientRect().left : root.left, right: root.right, height: rect.height };
    }
    function setHover(unit) {
      hovered = unit;
      if (!unit || !canMove()) { handle.hidden = true; return; }
      const rect = bounds(unit), root = unit.block.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { handle.hidden = true; return; }
      const icon = icons[unit.kind] || icons.block;
      handle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg><svg class="folio-drag-grip" viewBox="0 0 12 20" aria-hidden="true">`
        + [4, 10, 16].map(y => `<circle cx="3" cy="${y}" r="1.3"/><circle cx="9" cy="${y}" r="1.3"/>`).join('') + '</svg>';
      handle.dataset.kind = unit.kind; handle.setAttribute('aria-label', `${labels[unit.kind]}操作，按住可拖动`);
      handle.title = `点击打开菜单 · 按住拖动${labels[unit.kind]}`;
      const folding = unit.kind === 'heading' && unit.block.querySelector('.folio-heading-fold');
      handle.style.left = `${Math.max(4, root.left - (folding && root.left >= 90 ? 86 : 58))}px`;
      handle.style.top = `${Math.max(4, unit.kind === 'table' || folding && root.left < 90 ? rect.top - 32 : rect.top + Math.min(rect.height, 32) / 2 - 14)}px`;
      handle.hidden = false;
    }
    function hoverAt(event) {
      if (drag || menuTarget || !canMove()) return;
      if (handle.contains(event.target)) return;
      if (!main.contains(event.target)) {
        // Keep the handle available while crossing the small gutter from its block.
        const r = hovered && bounds(hovered);
        if (r && event.clientX >= Number.parseFloat(handle.style.left) && event.clientX <= r.right && event.clientY >= r.top - 34 && event.clientY <= r.bottom + 8) return;
        setHover(null); return;
      }
      if (event.target.closest('button, .folio-resource-form, .folio-table-controls')) { setHover(null); return; }
      const candidates = collect().filter(unit => unit.element.contains(event.target));
      const unit = candidates.reverse().find(item => {
        if (item.range) return [...item.range.getClientRects()].some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top - 4 && event.clientY <= r.bottom + 4);
        const r = bounds(item); return event.clientY >= r.top - 4 && event.clientY <= r.bottom + 4;
      }) || candidates.at(-1);
      setHover(unit || null);
    }
    function closeMenu(restore = false) {
      if (!menuTarget) return;
      const unit = menuTarget.unit; menuTarget = null; menu.hidden = true; handle.setAttribute('aria-expanded', 'false');
      if (restore && unit.element.isConnected && canMove()) { setHover(unit); handle.focus({ preventScroll: true }); }
    }
    function openMenu(current) {
      if (read() !== current.base || !canMove() || !current.unit.element.isConnected) return;
      menuTarget = { unit: current.unit, base: current.base }; setHover(current.unit);
      menu.hidden = false; menu.setAttribute('aria-label', `${labels[current.unit.kind]}操作`); handle.setAttribute('aria-expanded', 'true');
      populateFormats(); positionMenu(); remove.focus({ preventScroll: true });
    }
    function positionMenu() {
      const rect = handle.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
      const preferred = rect.bottom + menu.offsetHeight + 6 <= innerHeight - 8 ? rect.bottom + 6 : rect.top - menu.offsetHeight - 6;
      menu.style.top = `${Math.max(8, Math.min(preferred, innerHeight - menu.offsetHeight - 8))}px`;
    }
    function validTarget(selected) { return selected && read() === selected.base && canMove() && selected.unit.element.isConnected; }
    function populateFormats() {
      choices.replaceChildren();
      const options = window.FolioBlockFormats.options(menuTarget.base, menuTarget.unit);
      choices.hidden = divider.hidden = !options.some(option => !option.current);
      for (const option of choices.hidden ? [] : options) {
        const item = document.createElement('button'); item.type = 'button'; item.dataset.convertFormat = option.id;
        item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(option.current)); item.disabled = option.current;
        item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[option.icon]}"/></svg>`;
        const label = document.createElement('span'); label.textContent = option.label; item.append(label);
        if (option.current) { const checked = document.createElement('span'); checked.className = 'folio-format-check'; checked.textContent = '✓'; checked.setAttribute('aria-hidden', 'true'); item.append(checked); }
        choices.append(item);
      }
      choices.scrollTop = 0;
    }
    choices.addEventListener('click', event => {
      const option = event.target.closest('[data-convert-format]'); if (!option || option.disabled) return;
      const selected = menuTarget;
      if (!validTarget(selected)) { closeMenu(); status.textContent = '内容已更新，请重新选择。'; return; }
      const updated = window.FolioBlockFormats.convert(selected.base, selected.unit, option.dataset.convertFormat);
      if (updated === null || updated === selected.base) { status.textContent = '此内容暂时无法转换，请选择其他格式。'; return; }
      const label = option.textContent; closeMenu(); setHover(null); main.focus({ preventScroll: true });
      if (commit(selected.base, updated)) status.textContent = `已转换为${label}，可撤销`;
    });
    remove.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); const selected = menuTarget;
      closeMenu();
      if (!validTarget(selected)) { status.textContent = '内容已更新，请重新选择。'; return; }
      const { unit, base } = selected, updated = base.slice(0, unit.start) + base.slice(unit.end);
      setHover(null); main.focus({ preventScroll: true });
      if (commit(base, updated)) status.textContent = `${labels[unit.kind]}已删除，可撤销`;
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items = [...menu.querySelectorAll('button:not([disabled])')].filter(item => item.getClientRects().length), index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        items[next]?.focus();
      }
    });
    document.addEventListener('pointerdown', event => { if (menuTarget && !menu.contains(event.target) && !handle.contains(event.target)) closeMenu(); }, true);
    function chooseTarget() {
      if (!drag?.ready || !drag.moved) return;
      if (read() !== drag.base || !canMove()) { cancel(); return; }
      const { x, y, unit } = drag;
      const root = main.getBoundingClientRect();
      if (x < root.left - 65 || x > root.right + 45 || y < 0 || y > innerHeight) { drag.drop = null; guide.hidden = true; return; }
      const candidates = drag.units.filter(candidate => candidate !== unit && !(candidate.start >= unit.start && candidate.end <= unit.end)
        && (unit.kind === 'task' || candidate.depth === 0));
      let best = null, distance = Infinity;
      for (const target of candidates) {
        const r = bounds(target, true);
        for (const after of [false, true]) {
          const offset = after ? target.end : target.start;
          if (offset > unit.start && offset < unit.end) continue;
          const edge = after ? r.bottom : r.top;
          // Horizontal indentation resolves shared boundaries between a parent and its final child.
          const score = Math.abs(y - edge) + Math.min(36, Math.abs(x - r.left) * .06);
          if (score < distance) { distance = score; best = { target, after, rect: r, y: edge }; }
        }
      }
      drag.drop = best;
      guide.hidden = !best;
      if (best) {
        guide.style.left = `${best.rect.left}px`; guide.style.top = `${best.y}px`; guide.style.width = `${best.rect.right - best.rect.left}px`;
      }
      ghost.style.left = `${Math.min(x + 16, innerWidth - 210)}px`; ghost.style.top = `${Math.max(8, Math.min(y + 18, innerHeight - 44))}px`;
    }
    function tick() {
      if (!drag) return;
      if (drag.ready && drag.moved) {
        const speed = drag.y < 64 ? -Math.ceil((64 - drag.y) / 5) : drag.y > innerHeight - 64 ? Math.ceil((drag.y - innerHeight + 64) / 5) : 0;
        if (speed) window.scrollBy(0, speed);
        chooseTarget();
      }
      frame = requestAnimationFrame(tick);
    }
    function cancel() {
      const previous = drag; drag = null; cancelAnimationFrame(frame);
      if (previous && handle.hasPointerCapture(previous.pointerId)) handle.releasePointerCapture(previous.pointerId);
      document.body.classList.remove('folio-is-dragging'); ghost.hidden = true; guide.hidden = true; setHover(null);
    }
    async function prepareGesture(current, selected) {
      const identity = { key: selected.key, occurrence: selected.occurrence };
      try {
        if (!await prepare()) { if (drag === current) cancel(); return; }
        if (drag !== current) return;
        current.units = collect(true);
        current.unit = selected.rawText ? current.units.filter(unit => read().slice(unit.start, unit.end).replace(/\r\n/g, '\n').trimEnd() === selected.rawText)
          .sort((a, b) => Math.abs(a.start - Number(selected.block.dataset.sourceStart)) - Math.abs(b.start - Number(selected.block.dataset.sourceStart)))[0]
          : selected.codeText !== undefined ? current.units.filter(unit => unit.kind === 'code' && unit.element.querySelector('code')?.textContent.trimEnd() === selected.codeText)
            .sort((a, b) => Math.abs(a.start - Number(selected.block.dataset.sourceStart)) - Math.abs(b.start - Number(selected.block.dataset.sourceStart)))[0]
          : current.units.find(unit => unit.key === identity.key && unit.occurrence === identity.occurrence);
        if (!current.unit) { cancel(); status.textContent = '内容已更新，请重新选择。'; return; }
        current.base = read(); current.ready = true;
        ghost.textContent = `${labels[current.unit.kind]} · ${current.unit.name || '空内容'}`;
        if (current.moved) { document.body.classList.add('folio-is-dragging'); ghost.hidden = false; chooseTarget(); }
        frame = requestAnimationFrame(tick);
      } catch { if (drag === current) cancel(); }
    }
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !hovered || !canMove()) return;
      event.preventDefault(); event.stopPropagation();
      if (menuTarget) { closeMenu(true); return; }
      main.focus({ preventScroll: true });
      const current = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY, moved: false, ready: false };
      drag = current; handle.setPointerCapture(event.pointerId); current.prepared = prepareGesture(current, hovered);
    });
    document.addEventListener('pointermove', event => {
      if (!drag) {
        lastPointer = event;
        if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; hoverAt(lastPointer); });
        return;
      }
      if (event.pointerId !== drag.pointerId || drag.released) return;
      event.preventDefault(); drag.x = event.clientX; drag.y = event.clientY;
      if (Math.hypot(drag.x - drag.originX, drag.y - drag.originY) > 5) drag.moved = true;
      if (drag.ready && drag.moved) { document.body.classList.add('folio-is-dragging'); ghost.hidden = false; chooseTarget(); }
    }, { passive: false });
    document.addEventListener('pointerup', async event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const current = drag; current.released = true;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      await current.prepared;
      if (drag !== current || !current.ready) return;
      if (current.ready && current.moved) chooseTarget();
      const drop = drag?.drop; cancel();
      if (!current.moved) openMenu(current);
      else if (drop && read() === current.base && canMove()) {
        const updated = moveSource(current.base, current.unit, drop.target, drop.after);
        if (updated !== current.base && commit(current.base, updated)) status.textContent = `${labels[current.unit.kind]}已移动`;
      }
    }, true);
    handle.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      if (event.detail !== 0 || drag || !hovered || !canMove()) return;
      if (menuTarget) { closeMenu(true); return; }
      const current = { moved: false, ready: false }, selected = hovered; drag = current;
      await prepareGesture(current, selected);
      if (drag !== current || !current.ready) return;
      cancel(); openMenu(current);
    });
    handle.addEventListener('lostpointercapture', () => { if (drag && !drag.released) cancel(); });
    document.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', () => { closeMenu(); cancel(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { closeMenu(); cancel(); } });
    document.addEventListener('keydown', event => {
      if (!drag) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); status.textContent = '已取消移动'; }
      else if (event.metaKey || event.ctrlKey) cancel();
      else { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('scroll', () => { closeMenu(); if (!drag) setHover(null); }, { passive: true });
    window.addEventListener('resize', () => { closeMenu(); cancel(); });
    return { refresh() { closeMenu(); if (drag?.ready) cancel(); else if (!drag) setHover(null); } };
  };
})();
