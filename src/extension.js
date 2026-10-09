'use strict';

const vscode = require('vscode');
const { extendMarkdownIt } = require('./markdown');
const { PreviewProvider, viewType } = require('./preview');
let previews;

function isMarkdownPreview() {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputWebview) return input.viewType.includes('markdown.preview');
  return input instanceof vscode.TabInputCustom && [viewType, 'vscode.markdown.preview.editor'].includes(input.viewType);
}

async function openPreview(resource) {
  const group = vscode.window.tabGroups.activeTabGroup;
  const tab = group.activeTab;
  const nativePreview = isMarkdownPreview() && !previews.activeDocument;
  let uri = resource instanceof vscode.Uri && resource.scheme !== 'webview-panel' ? resource : undefined;
  if (nativePreview) {
    if (tab?.input instanceof vscode.TabInputCustom) uri = tab.input.uri;
    else {
      await vscode.commands.executeCommand('markdown.showSource');
      uri = vscode.window.activeTextEditor?.document.uri;
    }
  }
  uri ||= vscode.window.activeTextEditor?.document.uri;
  if (!uri) return false;
  const document = await vscode.workspace.openTextDocument(uri);
  if (document.languageId !== 'markdown') {
    vscode.window.showInformationMessage('Folio 仅用于 Markdown 文档。');
    return false;
  }
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType, group.viewColumn);
  if (nativePreview && tab?.input instanceof vscode.TabInputWebview) await vscode.window.tabGroups.close(tab, true);
  return true;
}

async function returnToEditor() {
  if (!isMarkdownPreview()) return false;
  const document = previews.activeDocument;
  if (document) {
    if (!await previews.flushActive()) { vscode.window.showWarningMessage('预览中还有未同步的草稿，请先处理预览里的提示。'); return false; }
    await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', vscode.window.tabGroups.activeTabGroup.viewColumn);
    return true;
  }
  await vscode.commands.executeCommand('markdown.showSource');
  return true;
}

async function activate(context) {
  previews = new PreviewProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(viewType, previews, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }),
    vscode.commands.registerCommand('folio.preview', openPreview),
    vscode.commands.registerCommand('folio.edit', returnToEditor),
    vscode.commands.registerCommand('folio.toggle', () => isMarkdownPreview() ? returnToEditor() : openPreview())
  );
  const cursor = vscode.workspace.getConfiguration('cursor.general');
  // Cursor hides third-party editor actions until they are pinned. Merge once, preserving existing pins and later user choices.
  if (cursor.inspect('pinnedTitleActions') && !context.globalState.get('titleActionsPinned')) {
    const pins = cursor.get('pinnedTitleActions', []);
    await cursor.update('pinnedTitleActions', [...new Set([...pins, 'folio.preview', 'folio.edit'])], vscode.ConfigurationTarget.Global);
    await context.globalState.update('titleActionsPinned', true);
  }
  // Cursor's built-in preview action explicitly yields this slot to custom Markdown previews.
  await vscode.commands.executeCommand('setContext', 'hasCustomMarkdownPreview', true);
  return { extendMarkdownIt };
}

function deactivate() {
  void vscode.commands.executeCommand('setContext', 'hasCustomMarkdownPreview', false);
}

module.exports = { activate, deactivate };
