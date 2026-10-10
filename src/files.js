'use strict';

const vscode = require('vscode');
const path = require('node:path').posix;

async function pickProjectFile(document, token) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) throw new Error('请先将此 Markdown 保存到已打开的项目文件夹，再插入项目文件。');
  const picker = vscode.window.createQuickPick();
  picker.title = `插入项目文件 · ${folder.name}`;
  picker.placeholder = '搜索文件名或路径，Enter 插入，Esc 取消';
  picker.matchOnDescription = true;
  picker.busy = true;
  const selected = await new Promise((resolve, reject) => {
    let closed = false;
    const listeners = [];
    const finish = (item, error) => {
      if (closed) return;
      closed = true;
      listeners.forEach(listener => listener.dispose());
      picker.dispose();
      if (error) reject(error); else resolve(item);
    };
    listeners.push(picker.onDidAccept(() => { if (picker.selectedItems[0]) finish(picker.selectedItems[0]); }), picker.onDidHide(() => finish()), token.onCancellationRequested(() => finish()));
    if (token.isCancellationRequested) { finish(); return; }
    picker.show();
    const configured = vscode.workspace.getConfiguration('files', folder.uri).get('exclude', {});
    const exclusions = ['**/.git/**', '**/node_modules/**', ...Object.keys(configured).filter(pattern => configured[pattern] === true)];
    void vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), `{${exclusions.join(',')}}`, undefined, token).then(files => {
      if (closed) return;
      picker.items = files.filter(uri => uri.scheme === folder.uri.scheme && uri.authority === folder.uri.authority && uri.path.startsWith(folder.uri.path.replace(/\/$/, '') + '/'))
        .map(uri => ({ label: path.basename(uri.path).replace(/\$\(/g, '\\$('), description: path.relative(folder.uri.path, uri.path), iconPath: new vscode.ThemeIcon('file'), uri }))
        .sort((a, b) => a.description.localeCompare(b.description, 'zh-CN', { numeric: true }));
      picker.busy = false;
      if (!picker.items.length) picker.placeholder = '当前项目没有可选文件，按 Esc 返回';
    }, () => finish(undefined, new Error('读取项目文件失败，请检查项目是否可访问后重试。')));
  });
  if (!selected || token.isCancellationRequested) return {};
  const stat = await vscode.workspace.fs.stat(selected.uri);
  if (!(stat.type & vscode.FileType.File)) throw new Error('所选文件已不可用，请重新选择。');
  const relative = path.relative(path.dirname(document.uri.path), selected.uri.path);
  const href = (relative.startsWith('../') ? relative : './' + relative).split('/').map(part => encodeURIComponent(part)
    .replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/');
  return { name: path.basename(selected.uri.path).replace(/[\r\n]/g, ' '), href };
}

module.exports = { pickProjectFile };
