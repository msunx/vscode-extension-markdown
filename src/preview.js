'use strict';

const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { taskMarker } = require('./markdown');
const { pickProjectFile } = require('./files');
const { TemplateStore } = require('./templates');
const viewType = 'folio.markdownPreview';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function updateTask(document, message) {
  const state = message.state ?? (typeof message.checked === 'boolean' ? message.checked ? 'done' : 'pending' : null);
  const markers = { pending: ' ', progress: '/', done: 'x' };
  if (document.languageId !== 'markdown' || !Number.isInteger(message.line) || message.line < 0 || message.line >= document.lineCount) throw new Error('无法定位此任务，请刷新预览后重试。');
  if (message.version !== document.version || !Object.hasOwn(markers, state)) throw new Error('文档已更新或任务状态无效，请重新选择。');
  const source = document.lineAt(message.line).text;
  const marker = taskMarker(source);
  if (source !== message.source || !marker || marker[1].length + 1 !== message.character) throw new Error('任务内容已变化，预览已刷新，请重新勾选。');
  if (vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === false) throw new Error('此文档为只读，无法修改待办。');
  if (marker[2].toLowerCase() === markers[state]) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(message.line, message.character, message.line, message.character + 1), markers[state]);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('未能修改待办，请检查文档是否可写后重试。');
}

async function updateBlock(document, message) {
  if (document.languageId !== 'markdown' || typeof message.base !== 'string' || typeof message.text !== 'string'
    || !Number.isInteger(message.start) || !Number.isInteger(message.end) || message.start < 0 || message.end < message.start || message.end > message.base.length) throw new Error('无法定位编辑内容，草稿已保留。');
  if (vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === false) throw new Error('文档为只读，未写入。草稿已保留，可复制后保存到其他文件。');
  if (document.getText() !== message.base) throw new Error('源文件已被其他编辑更新，未覆盖原文。请复制草稿后重新载入。');
  const before = message.base.slice(message.start, message.end);
  let prefix = 0;
  while (prefix < before.length && prefix < message.text.length && before[prefix] === message.text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < message.text.length - prefix && before[before.length - 1 - suffix] === message.text[message.text.length - 1 - suffix]) suffix++;
  if (prefix === before.length && prefix === message.text.length) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(message.start + prefix), document.positionAt(message.end - suffix)), message.text.slice(prefix, message.text.length - suffix));
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('文档写入失败，草稿已保留，请检查文件权限。');
}

class PreviewProvider {
  constructor(context) {
    this.context = context;
    this.documents = new Map();
    this.flushers = new Map();
    this.templates = new TemplateStore(context.globalState);
  }

  get activeDocument() {
    for (const [panel, document] of this.documents) if (panel.active) return document;
  }

  reveal(document, column) {
    for (const [panel, current] of this.documents) {
      if (current.uri.toString() === document.uri.toString() && panel.viewColumn === column) { panel.reveal(column); return true; }
    }
    return false;
  }

  async flushActive() {
    for (const [panel, flush] of this.flushers) if (panel.active) return flush();
    return true;
  }

  async resolveCustomTextEditor(document, panel) {
    if (document.languageId !== 'markdown') {
      panel.dispose();
      await vscode.window.showTextDocument(document);
      vscode.window.showInformationMessage('Folio 仅用于 Markdown 文档。');
      return;
    }
    this.documents.set(panel, document);
    const extensions = ['vscode.markdown-language-features', 'vscode.markdown-math'].map(id => vscode.extensions.getExtension(id)).filter(Boolean);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri, vscode.Uri.joinPath(document.uri, '..'), ...extensions.map(extension => extension.extensionUri),
        ...(vscode.workspace.workspaceFolders || []).map(folder => folder.uri)]
    };
    let disposed = false;
    let ready = false;
    let timer;
    let revision = 0;
    let rendering;
    let bufferedContent;
    let filePicker;
    let historyVersion = 0;
    let historyReason;
    let queue = Promise.resolve();
    const flushRequests = new Map();
    this.flushers.set(panel, () => new Promise(resolve => {
      const id = randomBytes(8).toString('hex');
      const timeout = setTimeout(() => { flushRequests.delete(id); resolve(false); }, 8000);
      flushRequests.set(id, success => { clearTimeout(timeout); resolve(success); });
      if (ready) void panel.webview.postMessage({ type: 'flush', id });
    }));
    const render = async error => {
      if (disposed) return;
      clearTimeout(timer);
      const request = ++revision;
      rendering = request;
      const version = document.version;
      try {
        const rendered = await vscode.commands.executeCommand('markdown.api.render', document);
        const html = rendered.replace(/(\b(?:src|poster)=)(["'])(file:[^"']+)\2/gi, (match, attribute, quote, uri) => {
          try { return `${attribute}${quote}${escape(panel.webview.asWebviewUri(vscode.Uri.parse(uri.replace(/&amp;/g, '&'))).toString())}${quote}`; }
          catch { return match; }
        });
        if (disposed || request !== revision || version !== document.version) return;
        const message = { type: 'content', html, version, historyVersion, historyReason, source: document.getText(),
          writable: vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) !== false, error: error || '' };
        if (ready) await panel.webview.postMessage(message);
        else bufferedContent = message;
      } catch {
        if (!disposed && request === revision) {
          const message = { type: 'error', error: '预览加载失败，请返回编辑后重新打开。' };
          if (ready) await panel.webview.postMessage(message);
          else bufferedContent = message;
        }
      } finally {
        if (rendering === request) rendering = undefined;
      }
    };
    const listeners = [
      panel.webview.onDidReceiveMessage(message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'templates' && Number.isInteger(message.id)) {
          void (async () => {
            try {
              let result;
              if (message.action === 'list') result = this.templates.read();
              else if (message.action === 'render') {
                if (typeof message.content !== 'string' || message.content.length > 50000) throw new Error('模板内容过长，无法预览。');
                result = { html: await vscode.commands.executeCommand('markdown.api.render', message.content) };
              } else result = await this.templates.update(message);
              if (!disposed) await panel.webview.postMessage({ type: 'templates-result', id: message.id, ok: true, ...result });
            } catch (error) {
              if (!disposed) await panel.webview.postMessage({ type: 'templates-result', id: message.id, ok: false,
                error: error.message || '模板保存失败，请重试。当前输入已保留。' });
            }
          })();
        }
        if (message.type === 'ready') {
          ready = true;
          if (bufferedContent && (bufferedContent.type === 'error' || bufferedContent.version === document.version)) void panel.webview.postMessage(bufferedContent);
          else if (!rendering) void render();
          bufferedContent = undefined;
          for (const id of flushRequests.keys()) void panel.webview.postMessage({ type: 'flush', id });
        }
        if (message.type === 'edit') {
          queue = queue.then(async () => {
            try {
              if ((message.historyVersion || 0) >= historyVersion) await updateBlock(document, message);
              if (!disposed) await panel.webview.postMessage({ type: 'edit-result', id: message.id, ok: true, version: document.version });
            } catch (error) {
              if (!disposed) await panel.webview.postMessage({ type: 'edit-result', id: message.id, ok: false, historyVersion, error: error.message });
            }
            if (!disposed) { clearTimeout(timer); timer = setTimeout(() => void render(), 40); }
          }).catch(() => {});
        }
        if (message.type === 'save') {
          queue = queue.then(async () => {
            try {
              const ok = await document.save();
              if (!disposed) await panel.webview.postMessage({ type: 'save-result', ok, error: ok ? '' : '保存失败，编辑内容仍在文档中。请检查文件权限。' });
            } catch {
              if (!disposed) await panel.webview.postMessage({ type: 'save-result', ok: false, error: '保存失败，编辑内容仍在文档中。请检查文件权限。' });
            }
          }).catch(() => {});
        }
        if (message.type === 'flushed' && flushRequests.has(message.id)) {
          queue = queue.then(() => { flushRequests.get(message.id)?.(message.ok === true); flushRequests.delete(message.id); });
        }
        if (message.type === 'task') {
          queue = queue.then(async () => {
            if (disposed) return;
            try { await updateTask(document, message); await render(); }
            catch (error) { await render(error.message); }
          }).catch(() => {});
        }
        if (message.type === 'pick-file' && Number.isInteger(message.id) && !filePicker) {
          const cancellation = new vscode.CancellationTokenSource(); filePicker = cancellation;
          void (async () => {
            let result;
            try { result = await pickProjectFile(document, cancellation.token); }
            catch { result = { error: '无法选择文件，请确认此文档已保存到打开的项目中，且项目文件可访问。' }; }
            finally { cancellation.cancel(); cancellation.dispose(); if (filePicker === cancellation) filePicker = undefined; }
            if (!disposed) {
              if (panel.active) panel.reveal(panel.viewColumn);
              await panel.webview.postMessage({ type: 'file-result', id: message.id, ...result });
            }
          })();
        }
        if (message.type === 'cancel-pick-file') filePicker?.cancel();
        if (message.type === 'link' && typeof message.href === 'string') void this.openLink(document, message.href, panel.viewColumn);
        if (message.type === 'source' && Number.isInteger(message.line)) {
          void vscode.window.showTextDocument(document, { viewColumn: panel.viewColumn, selection: new vscode.Range(Math.max(0, Math.min(message.line, document.lineCount - 1)), 0,
            Math.max(0, Math.min(message.line, document.lineCount - 1)), 0) });
        }
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document !== document) return;
        if (event.reason === vscode.TextDocumentChangeReason.Undo || event.reason === vscode.TextDocumentChangeReason.Redo) {
          historyVersion = document.version; historyReason = event.reason === vscode.TextDocumentChangeReason.Undo ? 'undo' : 'redo';
        }
        clearTimeout(timer);
        timer = setTimeout(() => void render(), 40);
      })
    ];
    panel.onDidDispose(() => {
      disposed = true;
      filePicker?.cancel();
      bufferedContent = undefined;
      clearTimeout(timer);
      listeners.forEach(listener => listener.dispose());
      this.documents.delete(panel);
      this.flushers.delete(panel);
      for (const resolve of flushRequests.values()) resolve(false);
      flushRequests.clear();
    });
    panel.webview.html = this.page(document, panel.webview, extensions);
    // Render while Cursor initializes its webview instead of waiting for the frontend's ready handshake.
    void render();
  }

  page(document, webview, extensions) {
    const nonce = randomBytes(24).toString('base64');
    const resource = uri => escape(webview.asWebviewUri(uri).toString());
    const styles = extensions.flatMap(extension => (extension.packageJSON.contributes?.['markdown.previewStyles'] || [])
      .map(file => `<link rel="stylesheet" href="${resource(vscode.Uri.joinPath(extension.extensionUri, file))}">`));
    styles.push(`<link rel="stylesheet" href="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/preview.css'))}">`);
    const config = vscode.workspace.getConfiguration('markdown', document.uri);
    const fontSize = config.get('preview.fontSize');
    const customStyle = Number.isFinite(fontSize) && fontSize > 0 ? `--markdown-font-size:${fontSize}px;` : '';
    styles.push(`<style>:root{${customStyle}}</style>`);
    const policy = `default-src 'none'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource} https:; `
      + `style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; form-action 'none';`;
    return '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + `<meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><base href="${resource(document.uri)}">${styles.join('')}`
      + '</head><body data-folio-interactive="true"><div class="folio-status" role="status" aria-live="polite" hidden></div><main class="markdown-body" dir="auto"></main>'
      + `<script nonce="${nonce}" src="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/emoji.js'))}"></script>`
      + `<script nonce="${nonce}" src="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/table.js'))}"></script>`
      + `<script nonce="${nonce}" src="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/blocks.js'))}"></script>`
      + `<script nonce="${nonce}" src="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/templates.js'))}"></script>`
      + `<script nonce="${nonce}" src="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/editor.js'))}"></script>`
      + `<script nonce="${nonce}" src="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/preview.js'))}"></script></body></html>`;
  }

  async openLink(document, href, column) {
    try {
      if (/^(https?:|mailto:)/i.test(href)) { await vscode.env.openExternal(vscode.Uri.parse(href)); return; }
      if (/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('file:')) return;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
      const uri = href.startsWith('/') && folder ? vscode.Uri.joinPath(folder, href) : vscode.Uri.parse(new URL(href, document.uri.toString()).href);
      if (!['file', document.uri.scheme].includes(uri.scheme)) return;
      if (/\.(md|markdown|mdown|mkd|mkdn|mdwn|markdn|mdtxt|mdtext)$/i.test(uri.path)) await vscode.commands.executeCommand('vscode.openWith', uri, viewType, column);
      else await vscode.commands.executeCommand('vscode.open', uri, column);
    } catch { vscode.window.showWarningMessage('无法打开此链接，请检查目标路径。'); }
  }
}

module.exports = { PreviewProvider, viewType, updateTask, updateBlock };
