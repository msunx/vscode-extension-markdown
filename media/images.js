(() => {
  'use strict';
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  window.FolioImages = function ({ host, insert, restore }) {
    let sequence = 0, pending = null, items = [], selected = null, limit = 80, ready = false, busy = false, replacement = false;
    const dialog = el('dialog', 'folio-images'); dialog.setAttribute('aria-label', '选择项目图片');
    const header = el('header', 'folio-picker-header'), heading = el('h2', '', '选择项目图片'), close = el('button', 'folio-dialog-close', '×');
    close.type = 'button'; close.setAttribute('aria-label', '关闭图片选择'); header.append(heading, close);
    const filters = el('div', 'folio-image-searchbar'), search = el('input', 'folio-control'); search.type = 'search'; search.placeholder = '搜索图片名称或项目路径'; search.setAttribute('aria-label', '搜索项目图片');
    const refresh = el('button', 'folio-picker-refresh', '刷新'); refresh.type = 'button'; filters.append(search, refresh);
    const body = el('div', 'folio-image-body'), grid = el('div', 'folio-image-grid'); grid.setAttribute('aria-label', '项目中的图片');
    const detail = el('div', 'folio-image-detail'), preview = el('img', 'folio-image-preview'), file = el('p', 'folio-image-path'), label = el('label', '', '图片说明');
    const description = el('input', 'folio-control'); description.placeholder = '为图片写一句说明'; label.append(description); preview.alt = ''; preview.hidden = true;
    detail.append(preview, file, label); body.append(grid, detail);
    const footer = el('footer', 'folio-picker-footer'), status = el('p', 'folio-picker-status'); status.setAttribute('role', 'status');
    const cancel = el('button', '', '取消'), submit = el('button', 'is-primary', '插入图片'); cancel.type = submit.type = 'button';
    footer.append(status, cancel, submit); dialog.append(header, filters, body, footer); document.body.append(dialog);
    function state() {
      submit.disabled = !selected || !ready || busy; refresh.disabled = busy; dialog.setAttribute('aria-busy', String(busy));
      search.disabled = description.disabled = busy && pending?.action === 'select';
      grid.querySelectorAll('button').forEach(button => { button.disabled = busy && pending?.action === 'select'; });
    }
    function request(action, extra = {}) { pending = { id: ++sequence, action }; busy = true; state(); host.postMessage({ type: 'images', ...pending, ...extra }); }
    function choose(item) {
      selected = item; ready = false; description.value = item ? item.name.replace(/\.[^.]+$/, '') : ''; preview.hidden = !item; file.textContent = item?.path || '选择一张图片，查看内容和说明';
      grid.querySelectorAll('[data-image]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.image === item?.id)));
      if (item) { preview.src = item.preview; status.textContent = '正在预览图片…'; if (innerWidth <= 620) detail.scrollIntoView({ block: 'nearest' }); }
      else { preview.removeAttribute('src'); status.textContent = ''; }
      state();
    }
    preview.onload = () => { ready = true; status.textContent = `${preview.naturalWidth} × ${preview.naturalHeight}`; state(); };
    preview.onerror = () => { ready = false; status.textContent = '无法预览这张图片，请刷新或选择其他图片。'; state(); };
    function render() {
      grid.replaceChildren(); const query = search.value.trim().toLowerCase(), filtered = items.filter(item => item.path.toLowerCase().includes(query));
      if (selected && !filtered.some(item => item.id === selected.id)) choose(null);
      for (const item of filtered.slice(0, limit)) {
        const button = el('button', 'folio-image-option'); button.type = 'button'; button.dataset.image = item.id; button.setAttribute('aria-pressed', String(item.id === selected?.id));
        button.title = item.path; const image = el('img', ''); image.src = item.preview; image.alt = ''; image.loading = 'lazy';
        const thumbnail = el('span', 'folio-image-thumbnail'); thumbnail.append(image); image.onerror = () => { thumbnail.replaceChildren(el('span', '', '无法预览')); };
        button.append(thumbnail, el('span', 'folio-image-name', item.name), el('span', 'folio-image-directory', item.path)); button.onclick = () => choose(item); grid.append(button);
      }
      if (!filtered.length) grid.append(el('p', 'folio-picker-empty', items.length ? '没有匹配的图片，试试其他名称或路径。' : '本项目还没有图片。把图片放入项目文件夹后，点击刷新。'));
      if (filtered.length > limit) { const more = el('button', 'folio-image-more', `显示更多（${filtered.length - limit}）`); more.onclick = () => { limit += 80; render(); }; grid.append(more); }
    }
    function load() { status.textContent = '正在读取项目图片…'; grid.replaceChildren(el('p', 'folio-picker-empty', '正在读取项目图片…')); request('list'); }
    function hide(returnFocus = true) { if (!dialog.open) return; pending = null; dialog.close(); busy = false; if (returnFocus) restore(); }
    close.onclick = cancel.onclick = () => hide(); refresh.onclick = load;
    search.addEventListener('input', () => { limit = 80; if (pending?.action !== 'list') render(); });
    submit.onclick = () => { if (selected && ready && !busy) { status.textContent = '正在确认图片…'; request('select', { image: selected.id }); } };
    dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
    dialog.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit.click(); }
      if (event.key === 'ArrowDown' && event.target === search) { event.preventDefault(); grid.querySelector('button')?.focus(); }
      if (event.target.matches('.folio-image-option') && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); const buttons = [...grid.querySelectorAll('.folio-image-option')], index = buttons.indexOf(event.target);
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length, step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
        buttons[Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
      }
    });
    return { element: dialog, close: hide,
      open(replace = false) { replacement = replace; items = []; search.value = ''; limit = 80; choose(null); heading.textContent = replace ? '更换项目图片' : '选择项目图片';
        submit.textContent = replace ? '更换图片' : '插入图片'; dialog.showModal(); search.focus(); load(); },
      receive(message) {
        if (message.type !== 'images-result') return false;
        if (!dialog.open || message.id !== pending?.id) return true;
        const action = pending.action; pending = null; busy = false;
        if (!message.ok) { status.textContent = message.error || '读取失败，请重试。'; if (action === 'list') grid.replaceChildren(el('p', 'folio-picker-empty', '读取图片失败，请点击刷新重试。')); state(); return true; }
        if (action === 'list') { items = message.items || []; heading.textContent = `${replacement ? '更换图片' : '选择图片'} · ${message.project}`; render(); status.textContent = `${items.length} 张项目图片`; state(); }
        else { const error = insert({ ...message, description: description.value }); if (error) { status.textContent = error; state(); } else hide(false); }
        return true;
      }
    };
  };
})();
