(() => {
  'use strict';
  const labels = Object.assign(Object.create(null), { created: '创建时间', source: '来源链接' });
  const types = [['text', '文本'], ['number', '数字'], ['boolean', '是 / 否'], ['list', '文本列表']];
  const paths = {
    text: 'M5 5h14M12 5v14M8 19h8', number: 'M10 4L8 20M16 4l-2 16M5 9h15M4 15h15', boolean: 'M5 12l4 4L19 6',
    list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', date: 'M8 3v4M16 3v4M4 10h16M5 5h14v15H5z',
    url: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
    locked: 'M8 10V7a4 4 0 0 1 8 0v3M6 10h12v11H6zM12 14v3', chevron: 'M9 5l7 7-7 7', plus: 'M12 5v14M5 12h14',
    external: 'M14 4h6v6M20 4l-9 9M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
    remove: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5',
    panel: 'M4 5h16v14H4zM15 5v14', collapse: 'M4 6l6 6-6 6M10 6l6 6-6 6'
  };
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + `<path d="${paths[name]}"/></svg>`;
  const button = (label, action, className) => { const node = element('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node; };
  const title = row => labels[row.key] || row.key || '未命名属性';
  const urlOf = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; } catch { return null; } };
  function dateLabel(value) {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (day) return `${day[1]}年${Number(day[2])}月${Number(day[3])}日`;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  window.FolioProperties = function ({ host, prepare }) {
    let current = { exists: false, base: '', fields: [], error: '' }, base = '', rows = [], writable = true, busy = false, dirty = false, sequence = 0, suggestedCreated = '';
    let initialized = false, editing = null, menuIndex = null;
    const pending = new Map();
    const wide = matchMedia('(min-width: 1440px)');
    const root = element('aside', 'folio-properties'); root.hidden = true; root.setAttribute('aria-label', '文件属性');
    const header = element('div', 'folio-properties-header');
    const toggle = button('', () => { if (isOpen()) collapse(); else void open(); }, 'folio-properties-toggle');
    toggle.innerHTML = icon('panel');
    const heading = element('span', 'folio-properties-heading', '文件属性'), count = element('span', 'folio-properties-count');
    toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'folio-properties-panel');
    const summary = element('div', 'folio-properties-summary'); header.append(heading, count, summary, toggle);
    const panel = element('div', 'folio-properties-panel'); panel.id = 'folio-properties-panel'; panel.inert = true;
    const form = element('form', 'folio-properties-form'); form.noValidate = true;
    const fields = element('div', 'folio-properties-fields');
    const add = button('', () => {
      finishEdit(); rows.push({ key: '', originalKey: null, type: 'text', value: '' }); changed(); renderRows(); openMenu(rows.length - 1);
    }, 'folio-property-add'); add.innerHTML = icon('plus'); add.append(element('span', '', '添加属性'));
    const status = element('p', 'folio-properties-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
    const footer = element('div', 'folio-properties-footer');
    const source = button('查看源码', () => host.postMessage({ type: 'source', line: 0 }), 'folio-properties-source');
    const reload = button('重新读取', () => void load(), 'folio-properties-reload'); reload.hidden = true;
    const cancel = button('取消', () => {
      closeMenu(); finishEdit(); seed(); reload.hidden = !current.error; setStatus(''); if (!current.exists) collapse(); paintSummary();
    }, 'folio-properties-cancel');
    const save = element('button', 'folio-properties-save', '保存属性'); save.type = 'submit';
    const actions = element('div', 'folio-properties-actions'); actions.append(reload, cancel, save); footer.append(source, actions);
    form.append(fields, add, status, footer); panel.append(form);
    const menu = element('div', 'folio-property-menu'); menu.hidden = true; menu.id = 'folio-property-menu'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '属性设置');
    root.append(header, panel, menu); document.body.append(root);

    function isOpen() { return root.classList.contains('is-open'); }
    function expanded(value) {
      root.classList.toggle('is-open', value); panel.inert = !value; toggle.setAttribute('aria-expanded', String(value));
      toggle.innerHTML = icon(value ? 'collapse' : 'panel');
      host.setState({ ...host.getState(), propertiesOpen: value }); paintSummary();
    }
    function setStatus(text = '', error = false, index = -1) {
      for (const note of fields.querySelectorAll('.folio-property-error')) note.remove();
      for (const control of fields.querySelectorAll('[aria-invalid]')) { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-describedby'); }
      const item = error && fields.children[index];
      if (item) {
        const note = element('p', 'folio-property-error is-error', text); note.id = `folio-property-error-${index}`; note.setAttribute('role', 'alert'); item.append(note);
        for (const control of item.querySelectorAll('.folio-property-read, .folio-property-input')) {
          control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', note.id);
        }
      }
      status.textContent = item ? '' : text; status.hidden = !text || Boolean(item);
      status.classList.toggle('is-error', error); status.setAttribute('role', error ? 'alert' : 'status'); updateActions();
    }
    function request(action, data = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('响应超时，当前输入已保留，请重新读取确认保存结果。')); }, 15000);
        pending.set(id, { resolve, reject, timer }); host.postMessage({ type: 'properties', id, action, ...data });
      });
    }
    function updateActions() {
      root.classList.toggle('is-dirty', dirty); cancel.hidden = save.hidden = !dirty;
      source.hidden = !current.error && writable && !rows.some(row => row.type === 'locked');
      footer.hidden = !dirty && !current.error && reload.hidden && source.hidden;
      add.hidden = !writable || Boolean(current.error);
    }
    function lock(value, saving = false) {
      busy = value; root.setAttribute('aria-busy', String(value)); toggle.disabled = value;
      for (const control of form.querySelectorAll('input, textarea, select, button')) control.disabled = value;
      if (!value) {
        for (const row of fields.children) {
          const input = row.querySelector('.folio-property-input'), read = row.querySelector('.folio-property-read');
          if (input) input.disabled = !writable || Boolean(current.error) || row.dataset.locked === 'true';
          if (read) read.disabled = !writable || Boolean(current.error) || row.dataset.locked === 'true';
        }
        save.disabled = !writable || Boolean(current.error); source.disabled = false;
      }
      save.textContent = value && saving ? '保存中…' : '保存属性'; updateActions();
    }
    function paintSummary() {
      root.hidden = false;
      const label = isOpen() ? '隐藏文件属性' : current.exists || dirty ? '显示文件属性' : '添加文件属性';
      toggle.title = label; toggle.setAttribute('aria-label', label + (dirty ? '，有未保存的修改' : current.error ? '，属性需要修正' : ''));
      count.textContent = current.fields.length || ''; count.hidden = !current.fields.length;
      summary.replaceChildren();
      if (current.error) { summary.append(element('span', 'is-error', '属性需要修正')); return; }
      if (dirty) { summary.append(element('span', 'folio-properties-unsaved', '未保存')); return; }
    }
    function seed(suggest = false) {
      closeMenu(); finishEdit(); base = current.base; rows = current.fields.map(field => ({ ...field })); dirty = false;
      for (const key of ['source', 'created']) if (!current.exists && !rows.some(row => row.key === key)) {
        rows.unshift({ key, originalKey: null, type: key === 'created' ? 'date' : 'url', value: '', optional: true });
      }
      if (suggest && !current.exists && suggestedCreated) { rows.find(row => row.key === 'created').value = suggestedCreated; dirty = true; }
      renderRows(); updateActions();
    }
    function paintValue(index) {
      const row = rows[index], item = fields.children[index]; if (!row || !item) return;
      item.dataset.key = row.key; item.querySelector('.folio-property-name-text').textContent = title(row);
      const read = item.querySelector('.folio-property-read'); read.replaceChildren(); read.classList.toggle('is-empty', !row.value); read.title = row.value;
      let display = row.value || '未填写';
      if (row.value && row.type === 'date') display = dateLabel(row.value);
      if (row.type === 'boolean') display = row.value === 'true' ? '是' : '否';
      if (row.type === 'list') display = row.value.split('\n').filter(Boolean).join(' · ') || '未填写';
      const url = row.type === 'url' && urlOf(row.value); if (url) display = url.hostname.replace(/^www\./, '');
      read.classList.toggle('is-link', Boolean(url)); read.append(element('span', 'folio-property-display', display));
      read.setAttribute('aria-label', `${title(row)}：${display}，点击编辑`);
      const link = item.querySelector('.folio-property-open'); link.hidden = !url; link.title = row.value; link.setAttribute('aria-label', `打开${title(row)}`);
      const name = item.querySelector('.folio-property-name'); name.title = title(row); name.setAttribute('aria-label', `${title(row)}，属性设置`);
      item.querySelector('.folio-property-input').setAttribute('aria-label', `${title(row)}内容`);
    }
    function renderRows() {
      editing = null; fields.replaceChildren();
      rows.forEach((row, index) => {
        const item = element('div', 'folio-property-row'); item.dataset.locked = String(row.type === 'locked'); item.dataset.key = row.key;
        const name = button('', () => openMenu(index), 'folio-property-name'); name.innerHTML = icon(row.type);
        name.append(element('span', 'folio-property-name-text', title(row)));
        const arrow = element('span', 'folio-property-name-arrow'); arrow.innerHTML = icon('chevron'); name.append(arrow);
        name.setAttribute('aria-haspopup', 'dialog'); name.setAttribute('aria-expanded', 'false'); name.setAttribute('aria-controls', menu.id);
        const valueBox = element('div', 'folio-property-value');
        const read = button('', () => beginEdit(index), 'folio-property-read');
        const input = element(row.type === 'boolean' ? 'select' : ['text', 'list'].includes(row.type) ? 'textarea' : 'input', 'folio-property-input');
        if (row.type === 'boolean') for (const [value, text] of [['true', '是'], ['false', '否']]) { const option = element('option', '', text); option.value = value; input.append(option); }
        else if (input.tagName === 'TEXTAREA') { input.rows = 1; input.maxLength = 20000; }
        else { input.type = 'text'; input.maxLength = 20000; if (row.type === 'number') input.inputMode = 'decimal'; }
        input.id = `folio-property-${index}`; input.value = row.value; input.hidden = true; input.spellcheck = false;
        input.setAttribute('aria-label', `${title(row)}内容`);
        input.placeholder = { date: '2026-10-27 或 2026-10-27T12:30:00+08:00', url: 'https://…', list: '每行一项', text: '填写内容', number: '填写数字' }[row.type] || '';
        input.addEventListener('input', () => { if (row.value !== input.value) { row.value = input.value; changed(); grow(input); } });
        input.addEventListener('blur', () => { if (editing === index) finishEdit(); });
        input.addEventListener('keydown', event => {
          if (event.isComposing) return;
          if (event.key === 'Enter' && (row.type !== 'list' || event.metaKey || event.ctrlKey) && !event.shiftKey) {
            event.preventDefault(); event.stopPropagation(); finishEdit(true);
          }
        });
        const link = button('', () => { const url = urlOf(row.value); if (url) host.postMessage({ type: 'link', href: url.href }); }, 'folio-property-open'); link.innerHTML = icon('external');
        valueBox.append(read, input, link); item.append(name, valueBox); fields.append(item); paintValue(index);
      });
      lock(busy);
    }
    function grow(input) { if (input.tagName === 'TEXTAREA') { input.style.height = 'auto'; input.style.height = `${Math.min(180, Math.max(34, input.scrollHeight))}px`; } }
    function beginEdit(index) {
      const row = rows[index]; if (!row || row.type === 'locked' || busy || !writable || current.error) return;
      closeMenu(); finishEdit(); editing = index;
      const item = fields.children[index], input = item.querySelector('.folio-property-input');
      item.classList.add('is-editing'); item.querySelector('.folio-property-read').hidden = true; item.querySelector('.folio-property-open').hidden = true;
      input.hidden = false; input.value = row.value; grow(input); input.focus({ preventScroll: true });
    }
    function finishEdit(focus = false) {
      if (editing === null) return;
      const index = editing; editing = null; const item = fields.children[index]; if (!item) return;
      item.classList.remove('is-editing'); item.querySelector('.folio-property-input').hidden = true; const read = item.querySelector('.folio-property-read'); read.hidden = false;
      paintValue(index); if (focus) read.focus({ preventScroll: true });
    }
    function changed() { dirty = true; root.classList.remove('is-saved'); setStatus(''); paintSummary(); }
    function closeMenu(focus = false) {
      if (menuIndex === null) return;
      const anchor = fields.children[menuIndex]?.querySelector('.folio-property-name'); menuIndex = null; menu.hidden = true; anchor?.setAttribute('aria-expanded', 'false');
      if (focus) anchor?.focus({ preventScroll: true });
    }
    function positionMenu() {
      if (menuIndex === null) return;
      const anchor = fields.children[menuIndex]?.querySelector('.folio-property-name'); if (!anchor) return closeMenu();
      const rect = anchor.getBoundingClientRect(), height = menu.offsetHeight;
      menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12))}px`;
      menu.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12))}px`;
    }
    function openMenu(index) {
      if (busy) return; if (menuIndex === index) return closeMenu(true);
      closeMenu(); finishEdit(); menuIndex = index; const row = rows[index], fixed = ['date', 'url'].includes(row.type) && Boolean(labels[row.key]);
      menu.replaceChildren(); menu.hidden = false; fields.children[index].querySelector('.folio-property-name').setAttribute('aria-expanded', 'true');
      if (row.type === 'locked' || !writable || current.error) {
        menu.append(element('p', 'folio-property-menu-title', title(row)), element('p', 'folio-property-menu-note', row.type === 'locked' ? '复杂属性在源码中编辑' : '此属性当前只读'));
      } else {
        if (!fixed) {
          const label = element('label', 'folio-property-menu-label', '属性名称'); label.htmlFor = 'folio-property-name-input';
          const name = element('input', 'folio-property-key'); name.id = label.htmlFor; name.type = 'text'; name.maxLength = 120; name.value = row.key; name.placeholder = '例如：主题';
          name.addEventListener('input', () => { row.key = name.value; changed(); paintValue(index); });
          name.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); closeMenu(); beginEdit(index); } });
          menu.append(label, name, element('div', 'folio-property-menu-label', '属性类型'));
          for (const [value, text] of types) {
            const option = button('', () => {
              closeMenu(); row.type = value; if (value === 'boolean') row.value = ['true', '是', '1'].includes(row.value) ? 'true' : 'false'; changed(); renderRows(); beginEdit(index);
            }, 'folio-property-type-option');
            option.dataset.propertyType = value; option.setAttribute('aria-pressed', String(row.type === value)); option.innerHTML = icon(value); option.append(element('span', '', text));
            if (row.type === value) { const check = element('span', 'folio-property-type-check'); check.innerHTML = icon('boolean'); option.append(check); } menu.append(option);
          }
        } else {
          menu.append(element('p', 'folio-property-menu-title', title(row)));
          if (row.type === 'date' && !row.value) menu.append(button(suggestedCreated ? '填入文件创建时间' : '填入当前时间', () => {
            row.value = suggestedCreated || new Date().toISOString(); changed(); closeMenu(); renderRows();
          }, 'folio-property-menu-action'));
        }
        menu.append(element('div', 'folio-property-menu-separator'));
        const remove = button('', () => {
          closeMenu(); rows.splice(index, 1); changed(); renderRows(); (fields.children[Math.min(index, rows.length - 1)]?.querySelector('.folio-property-name') || add).focus();
        }, 'folio-property-remove'); remove.innerHTML = icon('remove'); remove.append(element('span', '', '删除属性')); menu.append(remove);
      }
      menu.append(button('查看源码', () => { closeMenu(); host.postMessage({ type: 'source', line: 0 }); }, 'folio-property-menu-source'));
      positionMenu(); (menu.querySelector('input') || menu.querySelector('button'))?.focus({ preventScroll: true });
    }
    function collapse() { if (busy) return; closeMenu(); finishEdit(); expanded(false); toggle.focus({ preventScroll: true }); }
    async function load() {
      closeMenu(); finishEdit(); lock(true); setStatus('正在读取属性…');
      try {
        if (!await prepare()) throw new Error('正文尚未同步，请先处理预览中的提示。');
        const result = await request('read'); current = result.properties; writable = result.writable; suggestedCreated = result.suggestedCreated || '';
        seed(true); reload.hidden = !current.error; paintSummary(); setStatus(current.error || (!writable ? '当前文档只读，可查看属性。' : ''), Boolean(current.error));
      } catch (error) { reload.hidden = false; setStatus(error.message, true); }
      finally { lock(false); }
    }
    async function open() { expanded(true); if (!dirty) await load(); }
    // Keep multiline inputs in place until the clicked action runs; blur would move its target before click.
    root.addEventListener('pointerdown', event => {
      if (editing !== null && event.button === 0 && event.target.closest('button')) event.preventDefault();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || !writable || current.error || !dirty) return;
      finishEdit(); closeMenu();
      const values = rows.filter(row => !(row.optional && row.originalKey === null && !row.value)).map(({ key, originalKey, type, value }) => ({ key, originalKey, type, value }));
      const keys = new Set();
      for (const row of values) {
        if (!row.key.trim() || keys.has(row.key.trim())) {
          setStatus(!row.key.trim() ? '请填写属性名称。' : `属性名称「${row.key.trim()}」重复了。`, true, rows.findIndex(item => item.key === row.key)); return;
        }
        keys.add(row.key.trim());
      }
      lock(true, true); setStatus('');
      try {
        if (!await prepare()) throw new Error('正文尚未同步，属性输入已保留。');
        const result = await request('save', { base, fields: values }); current = result.properties; seed(); reload.hidden = true;
        paintSummary(); setStatus('属性已保存'); root.classList.remove('is-saved'); void root.offsetWidth; root.classList.add('is-saved'); toggle.focus({ preventScroll: true });
      } catch (error) {
        if (error.applied && error.properties) { base = error.properties.base; current = error.properties; }
        reload.hidden = !/别处|超时/.test(error.message); setStatus(error.message, true, rows.findIndex(row => row.key.trim() === error.field));
      } finally { lock(false); }
    });
    root.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && event.target.matches('input,textarea')) event.stopPropagation();
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); form.requestSubmit(); }
      else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); if (menuIndex !== null) closeMenu(true); else if (editing !== null) finishEdit(true); else collapse();
      } else if (menuIndex !== null && ['ArrowDown', 'ArrowUp'].includes(event.key) && event.target.tagName === 'BUTTON') {
        const controls = [...menu.querySelectorAll('button')], index = controls.indexOf(event.target), next = (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
        event.preventDefault(); controls[next]?.focus();
      }
    });
    const outsideMenu = event => {
      if (menuIndex !== null && !menu.contains(event.target) && !fields.children[menuIndex]?.querySelector('.folio-property-name').contains(event.target)) closeMenu();
    };
    document.addEventListener('pointerdown', outsideMenu, true); document.addEventListener('focusin', outsideMenu);
    document.addEventListener('pointerdown', event => { if (!wide.matches && isOpen() && !root.contains(event.target)) collapse(); }, true);
    form.addEventListener('scroll', positionMenu, { passive: true });
    window.addEventListener('resize', positionMenu); window.addEventListener('scroll', positionMenu, { passive: true });
    return {
      receive(message) {
        if (message?.type === 'properties-result') {
          const item = pending.get(message.id); if (!item) return true; clearTimeout(item.timer); pending.delete(message.id);
          if (message.ok) item.resolve(message);
          else item.reject(Object.assign(new Error(message.error), { field: message.field, applied: message.applied, properties: message.properties })); return true;
        }
        if (message?.type === 'content' && message.properties) {
          const changedBase = current.base !== message.properties.base; current = message.properties; writable = message.writable !== false;
          if (!initialized) {
            initialized = true; seed(); expanded(host.getState()?.propertiesOpen ?? (wide.matches && Boolean(current.fields.length || current.error)));
            if (current.error) { reload.hidden = false; setStatus(current.error, true); }
          } else if (changedBase && !busy) {
            if (!dirty) { seed(); reload.hidden = !current.error; setStatus(current.error, Boolean(current.error)); }
            else { reload.hidden = false; setStatus('属性已在别处修改，当前输入已保留；请重新读取后再编辑。', true); }
          }
          paintSummary(); if (!busy) lock(false);
        }
        return false;
      }
    };
  };
})();
