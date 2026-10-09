'use strict';

const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { taskMarker } = require('./markdown');
const viewType = 'folio.markdownPreview';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function updateTask(document, message) {
  if (document.languageId !== 'markdown' || !Number.isInteger(message.line) || message.line < 0 || message.line >= document.lineCount) throw new Error('无法定位此任务，请刷新预览后重试。');
  if (message.version !== document.version || typeof message.checked !== 'boolean') throw new Error('文档已更新，预览已刷新，请重新勾选。');
  const source = document.lineAt(message.line).text;
  const marker = taskMarker(source);
  if (source !== message.source || !marker || marker[1].length + 1 !== message.character) throw new Error('任务内容已变化，预览已刷新，请重新勾选。');
  if (vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === false) throw new Error('此文档为只读，无法修改待办。');
  if ((marker[2].toLowerCase() === 'x') === message.checked) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(message.line, message.character, message.line, message.character + 1), message.checked ? 'x' : ' ');
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('未能修改待办，请检查文档是否可写后重试。');
}

class PreviewProvider {
  constructor(context) {
    this.context = context;
    this.documents = new Map();
  }

  get activeDocument() {
    for (const [panel, document] of this.documents) if (panel.active) return document;
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
    let timer;
    let revision = 0;
    let queue = Promise.resolve();
    const render = async error => {
      clearTimeout(timer);
      const request = ++revision;
      const version = document.version;
      try {
        const rendered = await vscode.commands.executeCommand('markdown.api.render', document);
        const html = rendered.replace(/(\b(?:src|poster)=)(["'])(file:[^"']+)\2/gi, (match, attribute, quote, uri) => {
          try { return `${attribute}${quote}${escape(panel.webview.asWebviewUri(vscode.Uri.parse(uri.replace(/&amp;/g, '&'))).toString())}${quote}`; }
          catch { return match; }
        });
        if (disposed || request !== revision || version !== document.version) return;
        await panel.webview.postMessage({ type: 'content', html, version, error: error || '' });
      } catch {
        if (!disposed) await panel.webview.postMessage({ type: 'error', error: '预览加载失败，请返回编辑后重新打开。' });
      }
    };
    const listeners = [
      panel.webview.onDidReceiveMessage(message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') void render();
        if (message.type === 'task') {
          queue = queue.then(async () => {
            if (disposed) return;
            try { await updateTask(document, message); await render(); }
            catch (error) { await render(error.message); }
          }).catch(() => {});
        }
        if (message.type === 'link' && typeof message.href === 'string') void this.openLink(document, message.href, panel.viewColumn);
        if (message.type === 'source' && Number.isInteger(message.line)) {
          void vscode.window.showTextDocument(document, { viewColumn: panel.viewColumn, selection: new vscode.Range(Math.max(0, Math.min(message.line, document.lineCount - 1)), 0,
            Math.max(0, Math.min(message.line, document.lineCount - 1)), 0) });
        }
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document !== document) return;
        clearTimeout(timer);
        timer = setTimeout(() => void render(), 40);
      })
    ];
    panel.onDidDispose(() => {
      disposed = true;
      clearTimeout(timer);
      listeners.forEach(listener => listener.dispose());
      this.documents.delete(panel);
    });
    panel.webview.html = this.page(document, panel.webview, extensions);
  }

  page(document, webview, extensions) {
    const nonce = randomBytes(24).toString('base64');
    const resource = uri => escape(webview.asWebviewUri(uri).toString());
    const styles = extensions.flatMap(extension => (extension.packageJSON.contributes?.['markdown.previewStyles'] || [])
      .map(file => `<link rel="stylesheet" href="${resource(vscode.Uri.joinPath(extension.extensionUri, file))}">`));
    styles.push(`<link rel="stylesheet" href="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/preview.css'))}">`);
    const config = vscode.workspace.getConfiguration('markdown', document.uri);
    const fontSize = config.get('preview.fontSize');
    const fontFamily = config.get('preview.fontFamily');
    const customStyle = [Number.isFinite(fontSize) && fontSize > 0 ? `--markdown-font-size:${fontSize}px;` : '',
      typeof fontFamily === 'string' ? `--markdown-font-family:${fontFamily.replace(/[<>;{}]/g, '')};` : ''].join('');
    styles.push(`<style>:root{${customStyle}}</style>`);
    const policy = `default-src 'none'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource} https:; `
      + `style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; form-action 'none';`;
    return '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + `<meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><base href="${resource(document.uri)}">${styles.join('')}`
      + '</head><body data-folio-interactive="true"><div class="folio-status" role="status" aria-live="polite" hidden></div><main class="markdown-body" dir="auto"></main>'
      + `<script nonce="${nonce}" src="${resource(vscode.Uri.joinPath(this.context.extensionUri, 'media/preview.js'))}"></script></body></html>`;
  }

  async openLink(document, href, column) {
    try {
      if (/^(https?:|mailto:)/i.test(href)) { await vscode.env.openExternal(vscode.Uri.parse(href)); return; }
      if (/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('file:')) return;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
      const uri = href.startsWith('/') && folder ? vscode.Uri.joinPath(folder, href) : vscode.Uri.parse(new URL(href, document.uri.toString()).href);
      if (!['file', document.uri.scheme].includes(uri.scheme)) return;
      if (/\.(md|markdown|mdown|mkd|mkdn)$/i.test(uri.path)) await vscode.commands.executeCommand('vscode.openWith', uri, viewType, column);
      else await vscode.commands.executeCommand('vscode.open', uri, column);
    } catch { vscode.window.showWarningMessage('无法打开此链接，请检查目标路径。'); }
  }
}

module.exports = { PreviewProvider, viewType, updateTask };
