'use strict';
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'];
const isImage = uri => extensions.includes(path.posix.extname(uri.path).slice(1).toLowerCase());
const inside = (root, file) => file === root || file.startsWith(root.replace(/[\\/]$/, '') + path.sep);

class ProjectImages {
  constructor(document, webview) { this.document = document; this.webview = webview; this.items = new Map(); }
  folder() {
    const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
    if (!folder) throw new Error('请先将文档保存到已打开的项目，再选择项目内的图片。');
    return folder;
  }
  async validate(uri, folder) {
    if (!isImage(uri) || uri.scheme !== folder.uri.scheme || uri.authority !== folder.uri.authority || !uri.path.startsWith(folder.uri.path.replace(/\/$/, '') + '/')) return false;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (!(stat.type & vscode.FileType.File)) return false;
      if (uri.scheme === 'file') return inside(await fs.realpath(folder.uri.fsPath), await fs.realpath(uri.fsPath));
      return !(stat.type & vscode.FileType.SymbolicLink);
    } catch { return false; }
  }
  async list() {
    const folder = this.folder(), configured = vscode.workspace.getConfiguration('files', folder.uri).get('exclude', {});
    const exclusions = ['**/.git/**', '**/node_modules/**', ...Object.keys(configured).filter(key => configured[key] === true)];
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `**/*.{${[...extensions, ...extensions.map(value => value.toUpperCase())].join(',')}}`), `{${exclusions.join(',')}}`);
    const items = []; let next = 0;
    await Promise.all(Array.from({ length: Math.min(12, files.length) }, async () => {
      while (next < files.length) {
        const uri = files[next++]; if (!await this.validate(uri, folder)) continue;
        const relative = path.posix.relative(folder.uri.path, uri.path);
        items.push({ id: relative, name: path.posix.basename(uri.path), path: relative, preview: this.webview.asWebviewUri(uri).toString() });
      }
    }));
    items.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
    this.items = new Map(items.map(item => [item.id, vscode.Uri.joinPath(folder.uri, item.path)]));
    return { project: folder.name, items };
  }
  async select(id) {
    const folder = this.folder(), uri = this.items.get(id);
    if (!uri || !await this.validate(uri, folder)) throw new Error('图片已移动、删除或不在本项目中，请刷新后重新选择。');
    const relative = path.posix.relative(path.posix.dirname(this.document.uri.path), uri.path);
    const href = (relative.startsWith('../') ? relative : './' + relative).split('/').map(part => encodeURIComponent(part)
      .replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/');
    return { href, name: path.posix.basename(uri.path), preview: this.webview.asWebviewUri(uri).toString() };
  }
}
module.exports = { ProjectImages };
