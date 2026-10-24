(() => {
  'use strict';
  const expand = value => {
    const now = new Date(), date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return value.replace(/\{\{(date|weekday)\}\}/g, (_, key) => key === 'date' ? date : `星期${'日一二三四五六'[now.getDay()]}`);
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
  };
  const button = (text, action, className = '') => {
    const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
  };

  window.FolioTemplates = function ({ host, insert, restore }) {
    let sequence = 0, library = { revision: '', items: [] }, selected = 'diary', editing = false, busy = false, previewVersion = 0, session = 0, deleting = false;
    const pending = new Map();
    const dialog = element('dialog', 'folio-templates'); dialog.setAttribute('aria-labelledby', 'folio-templates-title');
    const header = element('header', 'folio-templates-header'), heading = element('div');
    const title = element('h2', '', '模板'); title.id = 'folio-templates-title';
    const subtitle = element('p', '', '把常写的内容，留作下一次的起点。'); heading.append(title, subtitle);
    const closeButton = button('×', close, 'folio-template-close'); closeButton.setAttribute('aria-label', '关闭模板'); header.append(heading, closeButton);
    const body = element('div', 'folio-templates-body'), sidebar = element('aside', 'folio-template-sidebar');
    const search = element('input', 'folio-template-search'); search.type = 'search'; search.placeholder = '搜索模板'; search.setAttribute('aria-label', '搜索模板');
    const list = element('div', 'folio-template-list'); list.setAttribute('aria-label', '模板列表');
    const create = button('＋ 新建模板', () => {
      if (readDraft()) { status('还有未保存的模板，请先继续编辑或丢弃草稿。'); resume.focus(); return; }
      edit();
    }, 'folio-template-new');
    const resume = button('继续未保存的模板', () => edit(readDraft()), 'folio-template-resume');
    const discard = button('丢弃草稿', () => { host.setState({ ...(host.getState() || {}), templateDraft: null }); renderList(); status('草稿已丢弃。'); }, 'folio-template-discard');
    sidebar.append(search, list, create, resume, discard);
    const detail = element('section', 'folio-template-detail'), detailHeader = element('div', 'folio-template-detail-header');
    const detailName = element('h3'), badge = element('span', 'folio-template-badge');
    const tools = element('div', 'folio-template-tools');
    const editButton = button('编辑', () => edit(current())), copyButton = button('另存为', () => edit({ name: current().name + ' · 副本', content: current().content }));
    const deleteButton = button('删除', () => { deleting = true; updateFooter(); }, 'folio-template-danger');
    tools.append(editButton, copyButton, deleteButton); detailHeader.append(detailName, badge, tools);
    const preview = element('div', 'folio-template-preview markdown-body'); preview.setAttribute('aria-label', '模板预览');
    const previewHint = element('p', 'folio-template-preview-hint', '预览 · 日期和星期将在插入时更新');
    detail.append(detailHeader, previewHint, preview); body.append(sidebar, detail);
    const form = element('form', 'folio-template-form'); form.hidden = true;
    const nameLabel = element('label', '', '模板名称'), name = element('input'); name.id = 'folio-template-name'; name.maxLength = 60; name.autocomplete = 'off'; nameLabel.append(name);
    const contentLabel = element('label', 'folio-template-content-label', '模板内容'), content = element('textarea');
    content.id = 'folio-template-content'; content.spellcheck = false; content.maxLength = 50000; content.placeholder = '# {{date}}\n\n## 正文\n\n开始记录……'; contentLabel.append(content);
    const variables = element('div', 'folio-template-variables'); variables.append(element('span', '', '插入变量'));
    for (const [label, token] of [['当天日期', '{{date}}'], ['星期', '{{weekday}}']]) {
      const chip = button(label, () => {
        const start = content.selectionStart, end = content.selectionEnd;
        content.setRangeText(token, start, end, 'end'); content.focus(); keepDraft();
      }); chip.title = token; variables.append(chip);
    }
    const formHint = element('p', 'folio-template-form-hint', '支持 Markdown。模板保存在本机，所有项目都可使用；关闭时保留未保存的输入。');
    form.append(nameLabel, contentLabel, variables, formHint);
    const footer = element('footer', 'folio-template-footer'), message = element('div', 'folio-template-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    const actions = element('div', 'folio-template-actions'); footer.append(message, actions); dialog.append(header, body, form, footer); document.body.append(dialog);
    let draftId;
    const readDraft = () => host.getState()?.templateDraft;
    const keepDraft = () => {
      if (editing) host.setState({ ...(host.getState() || {}), templateDraft: { id: draftId, name: name.value, content: content.value } });
    };
    const current = () => library.items.find(item => item.id === selected);
    function status(text = '', error = false) { message.textContent = text; message.classList.toggle('is-error', error); message.setAttribute('role', error ? 'alert' : 'status'); }
    function request(action, payload = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error('响应超时，请重试。当前输入已保留。')); }, 12000);
        pending.set(id, { resolve, reject, timeout }); host.postMessage({ type: 'templates', id, action, ...payload });
      });
    }
    function lock(value) {
      busy = value; dialog.setAttribute('aria-busy', String(value));
      for (const node of dialog.querySelectorAll('button,input,textarea')) node.disabled = value;
      if (!value) { editButton.disabled = Boolean(current()?.builtin); deleteButton.disabled = Boolean(current()?.builtin); }
    }
    async function load() {
      const opening = session; lock(true); status('正在读取模板…');
      try {
        const result = await request('list'); if (opening !== session || !dialog.open) return;
        library = result; if (!current()) selected = library.items[0]?.id; renderList(); showDetail(); status('保存在本机 · 跨项目使用');
      } catch (error) { status(error.message, true); }
      finally { if (opening === session) { lock(false); updateFooter(); } }
    }
    function renderList() {
      list.replaceChildren(); const query = search.value.trim().toLowerCase();
      const items = library.items.filter(item => item.name.toLowerCase().includes(query));
      if (!items.some(item => item.id === selected)) selected = items[0]?.id;
      for (const [label, builtin] of [['内置', true], ['我的模板', false]]) {
        const group = items.filter(item => Boolean(item.builtin) === builtin); if (!group.length) continue;
        list.append(element('p', 'folio-template-group', label));
        for (const item of group) {
          const option = button('', () => { selected = item.id; deleting = false; renderList(); showDetail(); updateFooter(); });
          option.className = 'folio-template-option'; option.dataset.templateId = item.id; option.setAttribute('aria-pressed', String(item.id === selected));
          const icon = element('span', 'folio-template-symbol', item.builtin ? '日' : '文'); icon.setAttribute('aria-hidden', 'true');
          option.append(icon, element('span', '', item.name)); list.append(option);
        }
      }
      if (!items.length) list.append(element('p', 'folio-template-empty', '没有找到模板，试试其他名称，或新建一个。'));
      resume.hidden = !readDraft();
      discard.hidden = resume.hidden;
    }
    async function showDetail() {
      const item = current(), version = ++previewVersion;
      detail.hidden = !item; if (!item) return;
      detailName.textContent = item.name; badge.textContent = item.builtin ? '内置' : '我的模板';
      editButton.hidden = Boolean(item.builtin); deleteButton.hidden = Boolean(item.builtin);
      editButton.disabled = busy || Boolean(item.builtin); deleteButton.disabled = busy || Boolean(item.builtin);
      preview.classList.remove('is-plain'); preview.textContent = '正在生成预览…';
      try {
        const result = await request('render', { content: expand(item.content) });
        if (version !== previewVersion || !dialog.open) return;
        const parsed = new DOMParser().parseFromString(result.html, 'text/html');
        const allowed = new Set('P H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE STRONG EM DEL S MARK SUP SUB A BR HR TABLE THEAD TBODY TR TH TD INPUT'.split(' '));
        // Read-only, inert preview: no remote loads, links, IDs, handlers or editable controls from template HTML.
        for (const node of [...parsed.body.querySelectorAll('*')]) {
          if (/^(SCRIPT|STYLE|IFRAME|OBJECT|SVG|MATH|FORM|VIDEO|AUDIO)$/.test(node.tagName)) { node.remove(); continue; }
          if (node.tagName === 'IMG') { node.replaceWith(document.createTextNode(node.getAttribute('alt') || '图片')); continue; }
          if (!allowed.has(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
          const checked = node.hasAttribute('checked'), taskState = node.getAttribute('data-folio-task-state');
          const taskClasses = [...node.classList].filter(value => ['contains-task-list', 'task-list-item', 'task-list-item-checkbox'].includes(value));
          for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
          node.classList.add(...taskClasses);
          if (node.tagName === 'INPUT') { node.type = 'checkbox'; node.disabled = true; node.checked = checked; }
          if (node.matches('input.task-list-item-checkbox')) {
            const state = ['pending', 'progress', 'done'].includes(taskState) ? taskState : checked ? 'done' : 'pending';
            node.dataset.folioTaskState = state; node.indeterminate = state === 'progress';
            node.setAttribute('aria-label', { pending: '待办', progress: '进行中', done: '已完成' }[state]);
          }
        }
        for (const checkbox of parsed.body.querySelectorAll('input.task-list-item-checkbox')) {
          const state = checkbox.dataset.folioTaskState, item = checkbox.closest('li');
          item?.classList.toggle('folio-task-progress', state === 'progress'); item?.classList.toggle('folio-task-complete', state === 'done');
          const label = element('span', 'folio-task-label'); let sibling = checkbox.nextSibling;
          while (sibling && !(sibling.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(sibling.tagName))) {
            const next = sibling.nextSibling; label.append(sibling); sibling = next;
          }
          checkbox.after(label);
        }
        preview.replaceChildren(...parsed.body.childNodes);
      } catch { if (version === previewVersion) { preview.textContent = expand(item.content); preview.classList.add('is-plain'); } }
    }
    function updateFooter() {
      actions.replaceChildren();
      if (editing) {
        actions.append(button('返回模板库', back), button('保存模板', save, 'is-primary'));
      } else if (deleting) {
        status(`删除「${current().name}」？已插入文档的内容会保留。`);
        actions.append(button('取消', () => { deleting = false; status(''); updateFooter(); }), button('确认删除', remove, 'is-danger'));
      } else {
        const use = button('插入模板', useTemplate, 'is-primary'); use.disabled = !current();
        actions.append(button('取消', close), use);
        if (!library.items.length) actions.prepend(button('重试', load));
      }
      for (const node of actions.querySelectorAll('button')) node.disabled ||= busy;
    }
    function edit(item) {
      if (busy) return;
      editing = true; deleting = false; draftId = item?.id;
      name.value = item?.name || ''; content.value = item?.content || ''; body.hidden = true; form.hidden = false;
      title.textContent = draftId ? '编辑模板' : '新建模板'; subtitle.textContent = '写一次，留给以后反复使用。';
      status(''); keepDraft(); updateFooter(); name.focus();
    }
    async function back() {
      if (busy) return; keepDraft(); editing = false; form.hidden = true; body.hidden = false;
      title.textContent = '模板'; subtitle.textContent = '把常写的内容，留作下一次的起点。'; await load(); search.focus();
    }
    async function save() {
      if (busy) return;
      keepDraft();
      if (!name.value.trim()) { status('请填写模板名称。', true); name.focus(); return; }
      if (!content.value.trim()) { status('请填写模板内容。', true); content.focus(); return; }
      lock(true); status('正在保存…');
      try {
        const result = await request('save', { revision: library.revision, templateId: draftId, name: name.value, content: content.value });
        library = result; selected = result.selected; editing = false; host.setState({ ...(host.getState() || {}), templateDraft: null });
        form.hidden = true; body.hidden = false; search.value = ''; title.textContent = '模板'; subtitle.textContent = '把常写的内容，留作下一次的起点。';
        renderList(); showDetail(); status('模板已保存，可以直接插入。');
      } catch (error) { status(error.message, true); }
      finally { lock(false); updateFooter(); actions.querySelector('.is-primary')?.focus(); }
    }
    async function remove() {
      if (busy || !current() || current().builtin) return;
      lock(true); status('正在删除…');
      try {
        const result = await request('delete', { revision: library.revision, templateId: selected }); library = result; selected = library.items[0]?.id;
        deleting = false; renderList(); showDetail(); status('模板已删除。');
      } catch (error) { status(error.message, true); deleting = false; }
      finally { lock(false); updateFooter(); }
    }
    function useTemplate() {
      if (busy || !current()) return;
      const error = insert(expand(current().content));
      if (error) { status(error, true); return; }
      dialog.close(); session++; previewVersion++;
    }
    function close() {
      if (busy) return;
      keepDraft(); dialog.close(); session++; previewVersion++; restore();
    }
    search.addEventListener('input', () => { deleting = false; renderList(); showDetail(); updateFooter(); });
    name.addEventListener('input', keepDraft); content.addEventListener('input', keepDraft);
    form.addEventListener('submit', event => { event.preventDefault(); void save(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (editing) void save(); }
      if (event.key === 'Enter' && event.target === search && !event.isComposing) { event.preventDefault(); useTemplate(); }
      event.stopPropagation();
    });
    return {
      element: dialog,
      open() {
        session++; editing = false; deleting = false; busy = false; search.value = ''; form.hidden = true; body.hidden = false;
        title.textContent = '模板'; subtitle.textContent = '把常写的内容，留作下一次的起点。'; dialog.showModal(); updateFooter(); void load().then(() => search.focus());
      },
      receive(message) {
        if (message.type !== 'templates-result') return false;
        const job = pending.get(message.id); if (!job) return true;
        clearTimeout(job.timeout); pending.delete(message.id); if (message.ok) job.resolve(message); else job.reject(new Error(message.error)); return true;
      }
    };
  };
})();
