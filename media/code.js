(() => {
  'use strict';
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  window.FolioCode = function ({ canEdit, edit, changeLanguage }) {
    let languages = [], target = null;
    const popup = el('div', 'folio-language-menu'); popup.hidden = true; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '选择代码语言');
    const search = el('input', 'folio-control'); search.placeholder = '搜索语言，如 Java、Python'; search.setAttribute('aria-label', '搜索代码语言');
    const list = el('div', 'folio-language-list'); popup.append(search, list); document.body.append(popup);
    const close = (focus = false) => { const button = target?.querySelector('.folio-code-language'); target = null; popup.hidden = true; button?.setAttribute('aria-expanded', 'false'); if (focus) button?.focus(); };
    function position() {
      if (!target?.isConnected) { close(); return; }
      const rect = target.querySelector('.folio-code-language').getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { close(); return; }
      popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
      popup.style.top = `${Math.max(8, rect.bottom + popup.offsetHeight + 8 < innerHeight ? rect.bottom + 6 : rect.top - popup.offsetHeight - 6)}px`;
    }
    function render() {
      list.replaceChildren(); const query = search.value.trim().toLowerCase();
      const items = languages.filter(item => `${item.id} ${item.name} ${(item.aliases || []).join(' ')}`.toLowerCase().includes(query));
      for (const item of items) {
        const button = el('button', '', item.name); button.type = 'button'; button.dataset.language = item.id;
        const selected = item.id === target?.dataset.language || item.aliases?.includes(target?.dataset.language); button.setAttribute('aria-pressed', String(selected));
        const alias = el('span', '', selected ? '✓' : item.id); button.append(alias);
        button.onclick = () => { const card = target; close(); changeLanguage(card, item.id); }; list.append(button);
      }
      if (!items.length) list.append(el('p', 'folio-picker-empty', '没有找到这个语言'));
      position();
    }
    search.addEventListener('input', render);
    popup.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      const buttons = [...list.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      } else if (event.key === 'Enter' && event.target === search) { event.preventDefault(); buttons[0]?.click(); }
      else if (event.key === 'Tab' && event.shiftKey && event.target === search) { event.preventDefault(); close(true); }
    });
    document.addEventListener('pointerdown', event => { if (!popup.contains(event.target) && !event.target.closest('.folio-code-language')) close(); });
    window.addEventListener('scroll', () => { if (!popup.hidden) position(); }, true); window.addEventListener('resize', () => { if (!popup.hidden) position(); });
    function enhance() {
      for (const card of document.querySelectorAll('main .folio-block[data-edit-mode=code] .folio-code-block')) {
        const header = card.querySelector('.folio-code-header');
        if (!header.querySelector('.folio-code-language')) {
          const button = el('button', 'folio-code-language', card.dataset.language === 'text' ? '纯文本' : card.dataset.language); button.type = 'button';
          button.setAttribute('aria-label', '选择代码语言'); button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
          header.querySelector('.folio-code-language-label').replaceWith(button);
          button.onclick = () => {
            if (target === card) { close(true); return; } close(); target = card; popup.hidden = false; button.setAttribute('aria-expanded', 'true'); search.value = ''; render(); search.focus();
          };
          const editing = el('button', 'folio-code-edit', '编辑'); editing.type = 'button'; editing.onclick = () => edit(card); editing.setAttribute('aria-label', '编辑代码');
          header.querySelector('.folio-code-actions').prepend(editing);
        }
        header.querySelector('.folio-code-language').disabled = !canEdit(); header.querySelector('.folio-code-edit').disabled = !canEdit();
      }
    }
    return { element: popup, close, enhance, attach(message) { languages = [{ id: 'text', name: '纯文本', aliases: ['plain', 'plaintext'] }, ...(message.codeLanguages || [])]; close(); },
      open(editor, original) {
        const card = editor.content.querySelector('.folio-code-block'), first = /^([ ]{0,3})(`{3,}|~{3,})([^\r\n]*)/.exec(original);
        if (!card || !first) return false;
        const body = card.querySelector('pre code').textContent, language = card.dataset.language;
        editor.code = { original, body, language, initialLanguage: language, indent: first[1], fence: first[2], extra: first[3].trim().slice(first[3].trim().split(/\s+/)[0].length) };
        const input = el('textarea', 'folio-code-input'); input.setAttribute('aria-label', '编辑代码正文'); input.spellcheck = false; input.value = body;
        card.querySelector('pre').hidden = true; card.append(input); editor.input = input;
        card.querySelector('.folio-code-edit').textContent = '完成'; card.querySelector('.folio-code-edit').setAttribute('aria-label', '完成代码编辑'); return true;
      },
      finish(editor) {
        const card = editor.content.querySelector('.folio-code-block');
        if (editor.changed) card.querySelector('pre code').textContent = editor.input.value;
        editor.input.remove(); card.querySelector('pre').hidden = false;
        card.querySelector('.folio-code-edit').textContent = '编辑'; card.querySelector('.folio-code-edit').setAttribute('aria-label', '编辑代码');
      },
      value(editor) {
        const code = editor.code, body = editor.input.value;
        if (body === code.body && code.language === code.initialLanguage) return code.original;
        const marker = code.fence[0], longest = Math.max(0, ...(body.match(marker === '`' ? /`+/g : /~+/g) || []).map(value => value.length));
        const fence = marker.repeat(Math.max(code.fence.length, longest + 1));
        const content = body.split('\n').map(line => line ? code.indent + line : '').join('\n');
        return code.indent + fence + (code.language === 'text' ? '' : code.language) + code.extra + '\n' + content + (content && !content.endsWith('\n') ? '\n' : '') + code.indent + fence + editor.tail;
      }
    };
  };
})();
