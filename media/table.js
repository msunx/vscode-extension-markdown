(() => {
  'use strict';
  const originals = new WeakMap(), cells = new WeakMap();
  const tableOf = cell => cell?.closest('table[data-folio-table]');
  const emptyCell = tag => { const cell = document.createElement(tag); cell.append(document.createElement('br')); return cell; };
  function remember(table) {
    if (originals.has(table)) return;
    const rows = Array.from(table.rows, row => Array.from(row.cells));
    for (const row of rows) for (const cell of row) {
      if (!cell.hasChildNodes()) cell.append(document.createElement('br'));
      cells.set(cell, { html: cell.innerHTML, source: cell.dataset.folioCellSource });
    }
    originals.set(table, { rows, source: table.dataset.folioTableSource });
  }
  function cellSource(cell, inline) {
    const original = cells.get(cell);
    if (original?.html === cell.innerHTML && original.source !== undefined) return original.source;
    if (!cell.textContent && cell.children.length === 1 && cell.firstElementChild.tagName === 'BR') return '';
    return Array.from(cell.childNodes, (node, index) => (index && /^(DIV|P)$/.test(node.nodeName) ? '\n' : '') + inline(node))
      .join('').trim().replace(/\|/g, '\\|').replace(/ *\r?\n/g, '<br>');
  }
  function serialize(table, inline) {
    remember(table);
    const rows = Array.from(table.rows, row => Array.from(row.cells)), original = originals.get(table);
    if (!rows.length || !rows[0].length) return '';
    const values = rows.map(row => row.map(cell => cellSource(cell, inline)));
    const unchanged = original.source !== undefined && rows.length === original.rows.length && rows.every((row, r) => row.length === original.rows[r].length
      && row.every((cell, c) => cell === original.rows[r][c] && values[r][c] === cells.get(cell)?.source));
    if (unchanged) return original.source + '\n\n';
    const line = values => '| ' + values.join(' | ') + ' |';
    const alignment = rows[0].map(cell => ({ left: ':---', center: ':---:', right: '---:' })[cell.style.textAlign] || '---');
    return [line(values[0]), line(alignment), ...values.slice(1).map(line)].join('\n') + '\n\n';
  }
  function create(text = '') {
    const wrapper = document.createElement('div'); wrapper.className = 'folio-table'; wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', '表格，可横向滚动');
    const table = document.createElement('table'); table.dataset.folioTable = 'true';
    const header = table.createTHead().insertRow(), row = table.createTBody().insertRow();
    for (const label of ['列一', '列二']) { const cell = document.createElement('th'); cell.textContent = label; header.append(cell); }
    for (const value of [text, '']) { const cell = emptyCell('td'); if (value) cell.textContent = value; row.append(cell); }
    wrapper.append(table); return wrapper;
  }
  window.FolioTables = function ({ canEdit, onActivate, onChange, onSelect }) {
    const controls = new WeakMap(), live = new Set();
    let selected = null, axisSelection = null, scheduled = false;
    const menu = document.createElement('div'); menu.className = 'folio-table-menu'; menu.hidden = true; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '所选行列操作');
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.tableAction = 'delete'; menu.append(remove); document.body.append(menu);
    function clearAxis() {
      if (axisSelection) {
        axisSelection.table.querySelectorAll('.is-selected-axis').forEach(cell => cell.classList.remove('is-selected-axis'));
        const record = controls.get(axisSelection.table);
        record?.shell.classList.remove('has-axis-selection'); record?.layer.querySelectorAll('[aria-pressed]').forEach(button => button.setAttribute('aria-pressed', 'false'));
      }
      axisSelection = null; menu.hidden = true;
    }
    function positionMenu() {
      if (!axisSelection || menu.hidden) return;
      const { table, axis, index } = axisSelection, record = controls.get(table);
      const anchor = record?.layer.querySelector(`[data-table-select="${axis}"][data-index="${index}"]`);
      if (!anchor?.isConnected || anchor.hidden) { clearAxis(); return; }
      const r = anchor.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, axis === 'row' ? r.right + 8 : r.left))}px`;
      const above = r.top - menu.offsetHeight - 8;
      menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, above >= 8 ? above : r.bottom + 6))}px`;
    }
    function point(record, axis, index) {
      const { table, shell } = record, base = shell.getBoundingClientRect();
      if (axis === 'column') {
        const cells = Array.from(table.rows[0].cells), cell = cells[Math.min(index, cells.length - 1)].getBoundingClientRect();
        return (index === cells.length ? cell.right : cell.left) - base.left;
      }
      const rows = Array.from(table.rows), row = rows[Math.min(index, rows.length - 1)].getBoundingClientRect();
      return (index === rows.length ? row.bottom : row.top) - base.top;
    }
    function layout(record) {
      if (!record.table.isConnected) return;
      const { table, shell, wrapper, layer } = record, base = shell.getBoundingClientRect(), viewport = wrapper.getBoundingClientRect();
      const width = viewport.width, height = table.getBoundingClientRect().bottom - base.top;
      layer.style.width = `${width}px`; layer.style.height = `${height}px`;
      for (const button of layer.querySelectorAll('button')) {
        const axis = button.dataset.tableSelect || button.dataset.tableInsert, index = Number(button.dataset.index), position = point(record, axis, index);
        if (button.dataset.tableSelect) {
          const end = point(record, axis, index + 1), limit = axis === 'column' ? width : height;
          const start = Math.max(0, position), size = Math.min(limit, end) - start;
          button.hidden = size <= 2;
          button.style[axis === 'column' ? 'left' : 'top'] = `${start + 1}px`;
          button.style[axis === 'column' ? 'width' : 'height'] = `${Math.max(0, size - 2)}px`;
        } else {
          button.hidden = position < -1 || position > (axis === 'column' ? width : height) + 1;
          button.style[axis === 'column' ? 'left' : 'top'] = `${position}px`;
        }
      }
      if (record.guideAxis) showGuide(record, record.guideAxis, record.guideIndex);
    }
    function scheduleLayout() {
      if (scheduled) return; scheduled = true;
      requestAnimationFrame(() => { scheduled = false; for (const record of live) layout(record); positionMenu(); });
    }
    function showGuide(record, axis, index) {
      const position = point(record, axis, index), guide = record.guide;
      record.guideAxis = axis; record.guideIndex = index; guide.hidden = false; guide.dataset.axis = axis;
      guide.style.left = axis === 'column' ? `${position}px` : '0'; guide.style.top = axis === 'row' ? `${position}px` : '0';
    }
    function hideGuide(record) { record.guideAxis = null; record.guide.hidden = true; }
    function rebuild(record) {
      const { table, layer } = record, signature = `${table.rows.length}:${table.rows[0].cells.length}`;
      if (record.signature === signature) { scheduleLayout(); return; }
      record.signature = signature; layer.replaceChildren(record.guide);
      for (const axis of ['row', 'column']) {
        const count = axis === 'row' ? table.rows.length : table.rows[0].cells.length;
        for (let index = 0; index < count; index++) {
          const button = document.createElement('button'); button.type = 'button'; button.className = `folio-table-grip folio-table-${axis}`;
          button.dataset.tableSelect = axis; button.dataset.index = index; button.setAttribute('aria-pressed', 'false');
          const label = axis === 'row' ? index === 0 ? '选中表头' : `选中第 ${index} 行` : `选中第 ${index + 1} 列`;
          button.title = label; button.setAttribute('aria-label', label); layer.append(button);
        }
        for (let index = axis === 'row' ? 1 : 0; index <= count; index++) {
          const button = document.createElement('button'); button.type = 'button'; button.className = `folio-table-insert folio-table-${axis}`;
          button.dataset.tableInsert = axis; button.dataset.index = index;
          const label = axis === 'row' ? index === count ? '在末尾添加行' : `在第 ${index} 行前插入` : index === count ? '在末尾添加列' : `在第 ${index + 1} 列前插入`;
          button.title = label; button.setAttribute('aria-label', label); button.innerHTML = '<span aria-hidden="true">+</span>'; layer.append(button);
        }
      }
      layout(record);
    }
    function prepare(content, writable) {
      for (const record of live) if (!record.table.isConnected) { record.observer.disconnect(); live.delete(record); if (axisSelection?.table === record.table) clearAxis(); }
      for (const table of content.querySelectorAll('table[data-folio-table]')) {
        remember(table); table.contentEditable = 'false';
        if (!writable) continue;
        const existing = controls.get(table); if (existing) { rebuild(existing); continue; }
        const wrapper = table.closest('.folio-table'), shell = document.createElement('div'); shell.className = 'folio-table-shell';
        wrapper.before(shell); shell.append(wrapper);
        const layer = document.createElement('div'); layer.className = 'folio-table-controls'; layer.contentEditable = 'false';
        layer.setAttribute('role', 'group'); layer.setAttribute('aria-label', '表格行列边框');
        const guide = document.createElement('div'); guide.className = 'folio-table-guide'; guide.hidden = true; shell.append(layer);
        const record = { table, wrapper, shell, layer, guide, observer: new ResizeObserver(scheduleLayout) };
        controls.set(table, record); live.add(record); rebuild(record); record.observer.observe(table); record.observer.observe(wrapper);
        wrapper.addEventListener('scroll', scheduleLayout, { passive: true });
        layer.addEventListener('pointerdown', event => event.preventDefault());
        layer.addEventListener('click', event => {
          const button = event.target.closest('button');
          if (!button || !canEdit() || !onActivate(table)) return;
          const index = Number(button.dataset.index);
          if (button.dataset.tableSelect) selectAxis(table, button.dataset.tableSelect, index, button);
          else onChange(() => insert(table, button.dataset.tableInsert, index));
        });
        const hover = event => {
          const button = event.target.closest('[data-table-insert]');
          if (button && canEdit()) showGuide(record, button.dataset.tableInsert, Number(button.dataset.index));
        };
        layer.addEventListener('pointerover', hover); layer.addEventListener('focusin', hover);
        layer.addEventListener('pointerout', event => { if (!event.target.closest('button')?.contains(event.relatedTarget)) hideGuide(record); });
        layer.addEventListener('focusout', () => hideGuide(record));
      }
    }
    function activate(content) {
      prepare(content, true);
      for (const cell of content.querySelectorAll('table[data-folio-table] :is(th, td)')) {
        cell.contentEditable = 'true'; cell.spellcheck = false; cell.setAttribute('aria-label', cell.tagName === 'TH' ? '编辑表头' : '编辑单元格');
      }
    }
    function deactivate(content) {
      clearAxis();
      for (const cell of content.querySelectorAll('table[data-folio-table] :is(th, td)')) { cell.contentEditable = 'false'; cell.classList.remove('is-selected-cell'); }
      selected = null;
    }
    function select(cell, focus = false) {
      if (!tableOf(cell) || !canEdit()) return;
      clearAxis(); selected?.classList.remove('is-selected-cell'); selected = cell; cell.classList.add('is-selected-cell');
      if (focus) {
        cell.focus({ preventScroll: true });
        const range = document.createRange(); range.selectNodeContents(cell); range.collapse(false);
        if (cell.lastChild?.nodeName === 'BR') { range.setStartBefore(cell.lastChild); range.collapse(true); }
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      onSelect();
    }
    function selectAxis(table, axis, index, button) {
      const cell = axis === 'row' ? table.rows[index]?.cells[0] : table.rows[0]?.cells[index];
      if (!cell) return;
      select(cell, true); selected.classList.remove('is-selected-cell');
      axisSelection = { table, axis, index }; controls.get(table).shell.classList.add('has-axis-selection');
      for (const row of table.rows) for (const cell of row.cells) if (axis === 'row' ? row.rowIndex === index : cell.cellIndex === index) cell.classList.add('is-selected-axis');
      button.setAttribute('aria-pressed', 'true'); button.focus({ preventScroll: true });
      remove.disabled = axis === 'row' ? index === 0 : table.rows[0].cells.length === 1;
      remove.textContent = remove.disabled ? axis === 'row' ? '保留表头，可直接编辑' : '至少保留一列' : '删除';
      menu.hidden = false; positionMenu(); onSelect();
    }
    function addRow(table, index) {
      const body = table.tBodies[0] || table.createTBody(), row = body.insertRow(Math.max(0, index - 1));
      for (const header of table.rows[0].cells) { const cell = emptyCell('td'); cell.style.textAlign = header.style.textAlign; cell.contentEditable = 'true'; row.append(cell); }
      return row;
    }
    function insert(table, axis, index) {
      let target;
      if (axis === 'row') target = addRow(table, index).cells[0];
      else {
        for (const row of table.rows) { const cell = emptyCell(row.rowIndex === 0 ? 'th' : 'td'); cell.contentEditable = 'true'; row.insertBefore(cell, row.cells[index] || null); }
        target = table.rows[Math.min(selected?.parentElement.rowIndex || 0, table.rows.length - 1)].cells[index];
      }
      clearAxis(); const record = controls.get(table); hideGuide(record); activate(table.closest('.folio-block-content')); select(target, true);
    }
    function deleteAxis() {
      if (!axisSelection || !canEdit() || remove.disabled) return;
      const { table, axis, index } = axisSelection;
      if (!table.isConnected || !onActivate(table)) return;
      onChange(() => {
        clearAxis();
        let target;
        if (axis === 'row') { table.deleteRow(index); target = table.rows[Math.min(index, table.rows.length - 1)].cells[0]; }
        else { for (const row of table.rows) row.deleteCell(index); target = table.rows[0].cells[Math.min(index, table.rows[0].cells.length - 1)]; }
        activate(table.closest('.folio-block-content')); select(target, true);
      });
    }
    menu.addEventListener('pointerdown', event => event.preventDefault()); remove.addEventListener('click', deleteAxis);
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest?.('.folio-table-controls, .folio-table-menu')) clearAxis();
    });
    function atSelection() {
      const selection = window.getSelection(), node = selection.anchorNode;
      return (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('th, td');
    }
    function keydown(event) {
      if (event.target.closest?.('.folio-table-controls, .folio-table-menu')) {
        if (event.key === 'Escape') { clearAxis(); if (selected?.isConnected) select(selected, true); }
        else if (axisSelection && ['Backspace', 'Delete'].includes(event.key)) deleteAxis();
        else return false;
        event.preventDefault(); event.stopPropagation(); return true;
      }
      if (!event.target.isContentEditable) return false;
      const cell = atSelection();
      if (!tableOf(cell) || !cell.isContentEditable) return false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        const range = document.createRange(); range.selectNodeContents(cell); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      } else if (event.key === 'Tab' || event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        const table = tableOf(cell), row = cell.parentElement, all = Array.from(table.rows).flatMap(row => Array.from(row.cells));
        const next = event.key === 'Tab' ? all[all.indexOf(cell) + (event.shiftKey ? -1 : 1)] : table.rows[row.rowIndex + 1]?.cells[cell.cellIndex];
        if (next) select(next, true);
        else if (event.shiftKey) controls.get(table)?.layer.querySelector('[data-table-insert="row"]')?.focus();
        else onChange(() => {
          const row = addRow(table, table.rows.length); activate(table.closest('.folio-block-content')); select(row.cells[event.key === 'Tab' ? 0 : cell.cellIndex], true);
        });
      } else if (event.key === 'Enter' && event.shiftKey) document.execCommand('insertLineBreak');
      else return false;
      event.preventDefault(); event.stopPropagation(); return true;
    }
    function beforeInput(event) {
      const selection = window.getSelection(), cell = atSelection();
      if (!tableOf(cell)) return;
      if (!canEdit() || !cell.contains(selection.focusNode)) { event.preventDefault(); return; }
      if (event.inputType === 'insertParagraph') { event.preventDefault(); onChange(() => insert(tableOf(cell), 'row', cell.parentElement.rowIndex + 1)); }
    }
    window.addEventListener('resize', scheduleLayout); window.addEventListener('scroll', positionMenu, { passive: true });
    window.addEventListener('beforeunload', () => { for (const record of live) record.observer.disconnect(); });
    return { prepare, activate, deactivate, select, keydown, beforeInput, atSelection };
  };
  window.FolioTables.serialize = serialize;
  window.FolioTables.create = create;
})();
