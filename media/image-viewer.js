(() => {
  'use strict';
  if (window.__folioImageViewerLoaded) return;
  window.__folioImageViewerLoaded = true;
  const selector = '.markdown-body img, #preview img';
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  function start() {
    let opener, previousFocus, ranges = [], original = false, backdropPress = false;
    const dialog = el('dialog', 'folio-image-viewer'); dialog.setAttribute('aria-label', '图片放大预览');
    const header = el('header', 'folio-image-viewer-header'), caption = el('span', 'folio-image-viewer-caption');
    const zoom = el('button', '', '原始尺寸'), close = el('button', 'folio-dialog-close', '×'); zoom.type = close.type = 'button';
    close.setAttribute('aria-label', '关闭图片预览'); close.title = '关闭（Esc）';
    const stage = el('div', 'folio-image-viewer-stage'), image = el('img', 'folio-image-viewer-content'); image.draggable = false;
    const feedback = el('div', 'folio-image-viewer-feedback'), status = el('p', ''), retry = el('button', '', '重试'); retry.type = 'button';
    status.setAttribute('role', 'status'); feedback.append(status, retry); stage.append(image, feedback);
    header.append(caption, zoom, close); dialog.append(header, stage); document.body.append(dialog);
    function fit() {
      original = false; stage.classList.remove('is-original'); image.style.removeProperty('width'); image.style.removeProperty('height');
      zoom.textContent = '原始尺寸'; zoom.setAttribute('aria-pressed', 'false'); stage.scrollTo(0, 0);
    }
    function toggleZoom() {
      if (zoom.disabled) return;
      if (original) fit();
      else {
        original = true; stage.classList.add('is-original'); image.style.width = `${image.naturalWidth}px`; image.style.height = `${image.naturalHeight}px`;
        zoom.textContent = '适应窗口'; zoom.setAttribute('aria-pressed', 'true');
      }
    }
    function load() {
      fit(); zoom.disabled = true; image.hidden = true; feedback.hidden = false; retry.hidden = true; status.textContent = '正在加载图片…';
      image.removeAttribute('src'); image.src = opener.currentSrc || opener.src;
    }
    image.onload = () => { if (!dialog.open) return; image.hidden = false; feedback.hidden = true; zoom.disabled = false; };
    image.onerror = () => { if (!dialog.open) return; image.hidden = true; feedback.hidden = false; zoom.disabled = true; status.textContent = '图片加载失败，请重试。'; retry.hidden = false; };
    function open(source) {
      if (dialog.open || document.querySelector('dialog[open]')) return;
      opener = source; previousFocus = document.activeElement;
      const selection = window.getSelection();
      ranges = previousFocus?.isContentEditable && selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
      caption.textContent = source.alt || '图片预览'; image.alt = source.alt || '放大的图片';
      document.documentElement.classList.add('folio-image-viewer-open'); dialog.showModal(); load(); close.focus({ preventScroll: true });
    }
    function hide() { if (dialog.open) dialog.close(); }
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('folio-image-viewer-open'); image.removeAttribute('src'); fit();
      const focus = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : opener;
      if (focus?.isConnected) focus.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (ranges.length && ranges.every(range => range.startContainer.isConnected && range.endContainer.isConnected)) {
        selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range));
      }
      ranges = []; opener = previousFocus = null;
    });
    close.onclick = hide; retry.onclick = load; zoom.onclick = image.onclick = toggleZoom;
    dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
    const background = target => target === dialog || target === stage;
    dialog.addEventListener('pointerdown', event => { backdropPress = background(event.target); event.stopPropagation(); });
    dialog.addEventListener('click', event => { if (backdropPress && background(event.target)) hide(); backdropPress = false; event.stopPropagation(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    const target = event => event.target instanceof HTMLImageElement && event.target.matches(selector) && !event.target.closest('dialog, .folio-template-preview');
    const plain = event => !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
    document.addEventListener('pointerdown', event => { if (event.button === 0 && plain(event) && target(event)) { event.preventDefault(); event.stopPropagation(); } }, true);
    document.addEventListener('click', event => {
      if (event.button !== 0 || !plain(event) || !target(event)) return;
      event.preventDefault(); event.stopImmediatePropagation(); open(event.target);
    }, true);
    window.addEventListener('keydown', event => {
      // Cursor can return focus to the webview body after a toolbar click. Keep Escape and editing shortcuts inside the modal in that case too.
      if (dialog.open) { if (event.key === 'Escape') { event.preventDefault(); hide(); } event.stopImmediatePropagation(); return; }
      if (!['Enter', ' '].includes(event.key) || !plain(event) || !target(event)) return;
      event.preventDefault(); event.stopImmediatePropagation(); open(event.target);
    }, true);
    function enhance() {
      for (const image of document.querySelectorAll(selector)) {
        if (image.closest('dialog, .folio-template-preview')) continue;
        image.tabIndex = 0; image.setAttribute('aria-haspopup', 'dialog'); image.setAttribute('aria-label', `${image.alt || '图片'}，点击放大`);
      }
    }
    enhance();
    const observer = new MutationObserver(enhance); observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
