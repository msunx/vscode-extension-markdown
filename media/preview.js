(() => {
  'use strict';
  if (window.__folioPreviewLoaded) return;
  window.__folioPreviewLoaded = true;
  const interactive = document.body.dataset.folioInteractive === 'true';
  const host = interactive ? acquireVsCodeApi() : null;
  let version;
  let pendingTask = null;
  let editor;
  let outline;
  let properties;
  let outlineError;
  let wrapCode = host?.getState()?.wrapCode !== false;
  const taskStates = { pending: '待办', progress: '进行中', done: '已完成' };
  let taskMenu, taskMenuTarget;
  const taskState = checkbox => checkbox.dataset.folioTaskState || (checkbox.checked ? 'done' : 'pending');

  function paintTask(checkbox, state = taskState(checkbox)) {
    checkbox.dataset.folioTaskState = state;
    checkbox.checked = state === 'done'; checkbox.indeterminate = state === 'progress';
    const item = checkbox.closest('li.task-list-item');
    item?.classList.toggle('folio-task-complete', state === 'done');
    item?.classList.toggle('folio-task-progress', state === 'progress');
    const label = checkbox.nextElementSibling?.matches('.folio-task-label') ? checkbox.nextElementSibling.textContent.trim() : '';
    checkbox.setAttribute('aria-label', `${taskStates[state]}：${label || '待办'}。右键切换状态`);
    checkbox.title = host ? `${taskStates[state]} · 点击${state === 'done' ? '取消完成' : '完成'}；右键选择状态；Shift＋点击轮换` : '使用右上角 Folio 图标切换任务状态';
    if (host) { checkbox.setAttribute('aria-haspopup', 'menu'); checkbox.setAttribute('aria-keyshortcuts', 'Shift+Space Shift+F10'); }
  }

  function changeTask(checkbox, state) {
    const previous = taskState(checkbox);
    if (!host || !Object.hasOwn(taskStates, state) || checkbox.disabled || pendingTask || version === undefined || (editor && !editor.allowTask(checkbox))) {
      paintTask(checkbox, previous); return;
    }
    paintTask(checkbox, state);
    if (previous === state) return;
    showError('');
    if (editor?.handleTask(checkbox)) return;
    if (!checkbox.hasAttribute('data-folio-task-line')) { paintTask(checkbox, previous); return; }
    pendingTask = {
      type: 'task', version, line: Number(checkbox.dataset.folioTaskLine), character: Number(checkbox.dataset.folioTaskCharacter),
      source: checkbox.dataset.folioTaskSource, state, previous
    };
    enhanceContent(); host.postMessage(pendingTask);
  }

  function closeTaskMenu(focus = false) {
    if (!taskMenuTarget) return;
    const target = taskMenuTarget; taskMenuTarget = null; taskMenu.hidden = true; target.setAttribute('aria-expanded', 'false');
    if (focus && target.isConnected) target.focus({ preventScroll: true });
  }

  function openTaskMenu(checkbox) {
    if (checkbox.disabled || !host || !editor?.allowTask(checkbox)) return;
    closeTaskMenu();
    if (!taskMenu) {
      taskMenu = document.createElement('div'); taskMenu.className = 'folio-task-menu'; taskMenu.hidden = true;
      taskMenu.setAttribute('role', 'menu'); taskMenu.setAttribute('aria-label', '任务状态');
      for (const [state, label] of Object.entries(taskStates)) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.taskState = state;
        button.setAttribute('role', 'menuitemradio');
        const icon = document.createElement('span'); icon.className = 'folio-task-state-icon'; icon.setAttribute('aria-hidden', 'true');
        button.append(icon, document.createTextNode(label)); taskMenu.append(button);
      }
      taskMenu.addEventListener('click', event => {
        const button = event.target.closest('button[data-task-state]'); if (!button || !taskMenuTarget) return;
        event.preventDefault(); event.stopPropagation(); const target = taskMenuTarget;
        closeTaskMenu(true); changeTask(target, button.dataset.taskState);
      });
      taskMenu.addEventListener('keydown', event => {
        const buttons = [...taskMenu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); closeTaskMenu(true); }
      });
      document.body.append(taskMenu);
    }
    taskMenuTarget = checkbox; taskMenu.hidden = false; checkbox.setAttribute('aria-expanded', 'true');
    const buttons = [...taskMenu.querySelectorAll('button')];
    for (const button of buttons) button.setAttribute('aria-checked', String(button.dataset.taskState === taskState(checkbox)));
    const rect = checkbox.getBoundingClientRect(), width = taskMenu.offsetWidth, height = taskMenu.offsetHeight;
    taskMenu.style.left = `${Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8))}px`;
    taskMenu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
    buttons.find(button => button.dataset.taskState === taskState(checkbox))?.focus({ preventScroll: true });
  }

  function taskSelector(task) {
    return `input[data-folio-task-line="${task.line}"][data-folio-task-character="${task.character}"]`;
  }

  function showError(message) {
    const status = document.querySelector('.folio-status');
    if (!status) return;
    status.textContent = message || '';
    status.hidden = !message;
  }

  if (host) {
    function applyMessage(message, force = false) {
      if (properties?.receive(message)) return;
      if (!force && editor?.receive(message)) return;
      if (message?.type === 'outline-error') { outlineError = message.error; showError(outlineError); return; }
      if (message?.type === 'outline-saved') {
        if (outlineError && document.querySelector('.folio-status')?.textContent === outlineError) showError('');
        outlineError = undefined; return;
      }
      if (message?.type === 'error') {
        if (pendingTask) {
          const checkbox = document.querySelector(taskSelector(pendingTask));
          if (checkbox) paintTask(checkbox, pendingTask.previous);
        }
        pendingTask = null;
        enhanceContent();
        showError(message.error);
        return;
      }
      if (message?.type !== 'content' || typeof message.html !== 'string') return;
      closeTaskMenu();
      const main = document.querySelector('.markdown-body');
      const focus = document.activeElement?.dataset;
      const focusedTask = focus?.folioTaskLine ? { line: Number(focus.folioTaskLine), character: Number(focus.folioTaskCharacter) } : pendingTask;
      const oldTaskTop = focusedTask && main.querySelector(taskSelector(focusedTask))?.getBoundingClientRect().top;
      const scroll = version === undefined ? host.getState()?.scroll || 0 : window.scrollY;
      const openDetails = Array.from(main.querySelectorAll('details'), element => element.open);
      const template = document.createElement('template');
      template.innerHTML = message.html;
      template.content.querySelectorAll('script, iframe, object, embed, base, meta, link').forEach(element => element.remove());
      main.replaceChildren(template.content);
      main.querySelectorAll('details').forEach((element, index) => { if (openDetails[index] !== undefined) element.open = openDetails[index]; });
      version = message.version;
      pendingTask = null;
      showError(message.error);
      enhanceContent();
      editor?.attach(message);
      outline?.attach(message);
      if (message.writable === false) enhanceContent();
      const checkbox = focusedTask && main.querySelector(taskSelector(focusedTask));
      checkbox?.focus({ preventScroll: true });
      window.scrollTo(0, scroll);
      if (checkbox && oldTaskTop !== undefined) window.scrollBy(0, checkbox.getBoundingClientRect().top - oldTaskTop);
    }
    editor = window.FolioEditor?.({ host, showError, applyContent: message => applyMessage(message, true), enhance: enhanceContent });
    outline = window.FolioOutline?.({ host, prepare: () => editor?.prepareView() ?? Promise.resolve(true), showError });
    properties = window.FolioProperties?.({ host, prepare: () => editor?.prepareView() ?? Promise.resolve(true) });
    window.addEventListener('message', event => applyMessage(event.data));
    window.addEventListener('scroll', () => host.setState({ ...host.getState(), scroll: window.scrollY }), { passive: true });
    document.addEventListener('change', event => {
      const checkbox = event.target;
      if (!(checkbox instanceof HTMLInputElement) || !checkbox.matches('.task-list-item-checkbox')) return;
      changeTask(checkbox, checkbox.checked ? 'done' : 'pending');
    });
    document.addEventListener('contextmenu', event => {
      const checkbox = event.target.closest?.('input.task-list-item-checkbox'); if (!checkbox || checkbox.disabled) return;
      event.preventDefault(); event.stopPropagation(); openTaskMenu(checkbox);
    });
    document.addEventListener('click', event => {
      const checkbox = event.target.closest?.('input.task-list-item-checkbox'); if (!checkbox || !event.shiftKey || checkbox.disabled) return;
      event.preventDefault(); event.stopPropagation();
      const next = { pending: 'progress', progress: 'done', done: 'pending' }[taskState(checkbox)];
      // Canceled checkbox clicks restore native state after dispatch; apply our state after that rollback.
      setTimeout(() => { if (checkbox.isConnected) changeTask(checkbox, next); }, 0);
    }, true);
    document.addEventListener('keydown', event => {
      const checkbox = event.target.closest?.('input.task-list-item-checkbox'); if (!checkbox || checkbox.disabled) return;
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); openTaskMenu(checkbox); }
      else if (event.shiftKey && event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); changeTask(checkbox, { pending: 'progress', progress: 'done', done: 'pending' }[taskState(checkbox)]);
      }
    }, true);
    document.addEventListener('pointerdown', event => { if (taskMenuTarget && !taskMenu.contains(event.target)) closeTaskMenu(); }, true);
    document.addEventListener('focusin', event => { if (taskMenuTarget && !taskMenu.contains(event.target)) closeTaskMenu(); });
    window.addEventListener('scroll', () => closeTaskMenu(), { passive: true });
    window.addEventListener('resize', () => closeTaskMenu());
    window.addEventListener('blur', () => closeTaskMenu());
    document.addEventListener('dblclick', event => {
      if (!event.altKey || editor?.editing || !(event.target instanceof Element) || event.target.closest('a, button, input, summary')) return;
      const line = event.target.closest('[data-line]')?.getAttribute('data-line');
      if (line !== null && line !== undefined) host.postMessage({ type: 'source', line: Number(line) });
    });
  }

  async function copyCode(button) {
    const code = button.closest('.folio-code-block')?.querySelector('pre code');
    if (!code) return;
    const text = button.closest('.folio-code-block').querySelector('.folio-code-input')?.value ?? code.textContent ?? '';
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch { /* Use the selection-based fallback supported by editor webviews. */ }
    if (!copied) {
      const input = button.closest('.folio-code-block').querySelector('.folio-code-input'), caret = input && [input.selectionStart, input.selectionEnd];
      const selection = window.getSelection();
      const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
      const range = document.createRange();
      range.selectNodeContents(code);
      if (input) input.select();
      else { selection?.removeAllRanges(); selection?.addRange(range); }
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      if (copied) {
        if (input) input.setSelectionRange(...caret);
        else { selection?.removeAllRanges(); ranges.forEach(saved => selection?.addRange(saved)); }
      }
    }
    button.textContent = copied ? '已复制' : '请按 ⌘C 复制';
    button.setAttribute('aria-label', copied ? '代码已复制' : '复制失败，已选中代码，请手动复制');
    button.classList.toggle('is-copied', copied);
    clearTimeout(button.__folioReset);
    button.__folioReset = setTimeout(() => {
      button.textContent = '复制';
      button.setAttribute('aria-label', '复制代码');
      button.classList.remove('is-copied');
    }, 3000);
  }

  function handleClick(event) {
    const wrapping = event.target.closest('.folio-code-wrap');
    if (wrapping && event.type === 'click') {
      event.preventDefault(); event.stopPropagation(); wrapCode = !wrapCode;
      host?.setState({ ...(host.getState() || {}), wrapCode }); enhanceCode(); editor?.resize(); return;
    }
    if (!(event.target instanceof Element)) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    const button = event.target.closest('.folio-copy');
    if (button && event.type === 'click') {
      event.preventDefault();
      event.stopPropagation();
      void copyCode(button);
      return;
    }
    const link = host && event.target.closest('a[href]');
    if (link) {
      const href = link.getAttribute('href');
      event.preventDefault();
      // Cursor's window-level link handler ignores defaultPrevented and would also open the resource URL externally.
      event.stopPropagation();
      if (href.startsWith('#')) {
        try { const target = document.getElementById(decodeURIComponent(href.slice(1))); outline?.reveal(target); target?.scrollIntoView(); } catch { /* Ignore malformed anchors. */ }
      } else {
        const target = link.getAttribute('data-href') || href;
        void (editor ? editor.flush() : Promise.resolve(true)).then(ok => { if (ok) host.postMessage({ type: 'link', href: target }); });
      }
    }
  }
  document.addEventListener('click', handleClick);
  document.addEventListener('auxclick', handleClick);

  function refreshDateHeadings() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    document.querySelectorAll('.markdown-body h1:not(.folio-template-preview h1)').forEach(heading => {
      // Keep real text and anchors intact for editing, copying and Markdown serialization.
      heading.classList.toggle('folio-today-heading', heading.textContent.trim() === today);
    });
  }

  let dateTimer;
  function watchLocalDate() {
    clearTimeout(dateTimer);
    refreshDateHeadings();
    outline?.refresh();
    const now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // Also notice clock/timezone changes; focus refreshes immediately after the app resumes.
    dateTimer = setTimeout(watchLocalDate, Math.min(60000, Math.max(100, midnight - now + 100)));
  }
  window.addEventListener('focus', watchLocalDate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) watchLocalDate(); });

  function enhanceCode() {
    for (const card of document.querySelectorAll('.folio-code-block')) {
      card.classList.toggle('is-unwrapped', !wrapCode);
      const button = card.querySelector('.folio-code-wrap');
      button?.setAttribute('aria-pressed', String(wrapCode));
      if (button) button.title = wrapCode ? '关闭本页代码自动换行' : '开启本页代码自动换行';
    }
  }
  function enhanceContent() {
    window.FolioVideos?.enhance();
    enhanceCode();
    refreshDateHeadings();
    document.querySelectorAll('.folio-copy:not([data-folio-ready])').forEach(button => {
      button.dataset.folioReady = 'true';
      button.setAttribute('aria-live', 'polite');
    });
    document.querySelectorAll('input.task-list-item-checkbox:not(.folio-template-preview input)').forEach((checkbox, index) => {
      const item = checkbox.closest('li.task-list-item');
      if (!item) return;
      if (editor?.owns(checkbox)) { checkbox.disabled = !editor.allowTask(checkbox); paintTask(checkbox); return; }
      if (!checkbox.id) checkbox.id = `folio-task-${checkbox.dataset.folioTaskLine || 'readonly'}-${index}`;
      if (!checkbox.nextElementSibling?.classList.contains('folio-task-label')) {
        const label = document.createElement('label');
        label.className = 'folio-task-label';
        label.htmlFor = checkbox.id;
        let sibling = checkbox.nextSibling;
        while (sibling && !(sibling instanceof Element && sibling.matches('ul, ol'))) {
          const next = sibling.nextSibling;
          label.append(sibling);
          sibling = next;
        }
        checkbox.after(label);
      }
      const taskText = checkbox.nextElementSibling;
      if (Array.from(taskText.childNodes).every(node => node.nodeType === Node.TEXT_NODE && !node.textContent.trim())) {
        // A real empty line lets Chromium place a caret after the checkbox on a fresh render.
        taskText.replaceChildren(document.createElement('br'));
      }
      // Nested task states must not mark their parent task as completed.
      paintTask(checkbox);
      checkbox.disabled = !host || version === undefined || !checkbox.hasAttribute('data-folio-task-line') || Boolean(pendingTask) || Boolean(editor && !editor.allowTask(checkbox));
      checkbox.classList.toggle('is-pending', Boolean(pendingTask && Number(checkbox.dataset.folioTaskLine) === pendingTask.line));
    });
    if (taskMenuTarget && (!taskMenuTarget.isConnected || taskMenuTarget.disabled)) closeTaskMenu();
    outline?.refresh();
    // The labels just created are already initialized; do not scan the entire document again for our own mutations.
    observer.takeRecords();
  }
  let scheduled = false;
  const observer = new MutationObserver(mutations => {
    if (scheduled || !mutations.some(mutation => mutation.type === 'characterData' || mutation.addedNodes.length || mutation.removedNodes.length)) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhanceContent(); });
  });
  function start() {
    enhanceContent();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    watchLocalDate();
    host?.postMessage({ type: 'ready' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.addEventListener('beforeunload', () => { observer.disconnect(); clearTimeout(dateTimer); }, { once: true });
})();
