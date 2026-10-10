(() => {
  'use strict';
  if (window.__folioPreviewLoaded) return;
  window.__folioPreviewLoaded = true;
  const interactive = document.body.dataset.folioInteractive === 'true';
  const host = interactive ? acquireVsCodeApi() : null;
  let version;
  let pendingTask = null;
  let editor;

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
      if (!force && editor?.receive(message)) return;
      if (message?.type === 'error') {
        if (pendingTask) {
          const checkbox = document.querySelector(taskSelector(pendingTask));
          if (checkbox) checkbox.checked = !pendingTask.checked;
        }
        pendingTask = null;
        enhanceContent();
        showError(message.error);
        return;
      }
      if (message?.type !== 'content' || typeof message.html !== 'string') return;
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
      const checkbox = focusedTask && main.querySelector(taskSelector(focusedTask));
      checkbox?.focus({ preventScroll: true });
      window.scrollTo(0, scroll);
      if (checkbox && oldTaskTop !== undefined) window.scrollBy(0, checkbox.getBoundingClientRect().top - oldTaskTop);
    }
    editor = window.FolioEditor?.({ host, showError, applyContent: message => applyMessage(message, true), enhance: enhanceContent });
    window.addEventListener('message', event => applyMessage(event.data));
    window.addEventListener('scroll', () => host.setState({ ...host.getState(), scroll: window.scrollY }), { passive: true });
    document.addEventListener('change', event => {
      const checkbox = event.target;
      if (!(checkbox instanceof HTMLInputElement) || !checkbox.matches('.task-list-item-checkbox')) return;
      if (editor?.handleTask(checkbox)) return;
      if (!checkbox.hasAttribute('data-folio-task-line') || (editor && !editor.allowTask(checkbox))) return;
      if (pendingTask || version === undefined) return;
      pendingTask = {
        type: 'task', version, line: Number(checkbox.dataset.folioTaskLine), character: Number(checkbox.dataset.folioTaskCharacter),
        source: checkbox.dataset.folioTaskSource, checked: checkbox.checked
      };
      showError('');
      enhanceContent();
      host.postMessage(pendingTask);
    });
    document.addEventListener('dblclick', event => {
      if (!event.altKey || editor?.editing || !(event.target instanceof Element) || event.target.closest('a, button, input, summary')) return;
      const line = event.target.closest('[data-line]')?.getAttribute('data-line');
      if (line !== null && line !== undefined) host.postMessage({ type: 'source', line: Number(line) });
    });
  }

  async function copyCode(button) {
    const code = button.closest('.folio-code-block')?.querySelector('pre code');
    if (!code) return;
    const text = code.textContent || '';
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch { /* Use the selection-based fallback supported by editor webviews. */ }
    if (!copied) {
      const selection = window.getSelection();
      const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      if (copied) {
        selection?.removeAllRanges();
        ranges.forEach(saved => selection?.addRange(saved));
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
        try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); } catch { /* Ignore malformed anchors. */ }
      } else {
        const target = link.getAttribute('data-href') || href;
        void (editor ? editor.flush() : Promise.resolve(true)).then(ok => { if (ok) host.postMessage({ type: 'link', href: target }); });
      }
    }
  }
  document.addEventListener('click', handleClick);
  document.addEventListener('auxclick', handleClick);

  function enhanceContent() {
    document.querySelectorAll('.folio-copy:not([data-folio-ready])').forEach(button => {
      button.dataset.folioReady = 'true';
      button.setAttribute('aria-live', 'polite');
    });
    document.querySelectorAll('input.task-list-item-checkbox').forEach((checkbox, index) => {
      const item = checkbox.closest('li.task-list-item');
      if (!item) return;
      if (editor?.owns(checkbox)) { checkbox.disabled = !editor.allowTask(checkbox); item.classList.toggle('folio-task-complete', checkbox.checked); return; }
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
      item.classList.toggle('folio-task-complete', checkbox.checked);
      checkbox.disabled = !host || version === undefined || !checkbox.hasAttribute('data-folio-task-line') || Boolean(pendingTask) || Boolean(editor && !editor.allowTask(checkbox));
      checkbox.classList.toggle('is-pending', Boolean(pendingTask && Number(checkbox.dataset.folioTaskLine) === pendingTask.line));
      const label = checkbox.nextElementSibling?.textContent.trim() || '待办';
      checkbox.setAttribute('aria-label', `${checkbox.checked ? '取消完成' : '完成'}：${label}`);
      checkbox.title = host ? '勾选后同步到 Markdown，可撤销' : '使用右上角 Folio 图标打开可交互预览';
    });
    // The labels just created are already initialized; do not scan the entire document again for our own mutations.
    observer.takeRecords();
  }
  let scheduled = false;
  const observer = new MutationObserver(mutations => {
    if (scheduled || !mutations.some(mutation => mutation.addedNodes.length)) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhanceContent(); });
  });
  function start() {
    enhanceContent();
    observer.observe(document.body, { childList: true, subtree: true });
    host?.postMessage({ type: 'ready' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
})();
