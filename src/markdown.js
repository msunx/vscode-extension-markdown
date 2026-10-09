'use strict';

const installed = Symbol.for('muyang.folio.markdown');
const alertNames = { NOTE: '提示', TIP: '建议', IMPORTANT: '重要', WARNING: '警告', CAUTION: '注意' };

function addAlerts(md) {
  md.core.ruler.after('inline', 'folio_alerts', state => {
    for (let i = 0; i < state.tokens.length - 2; i++) {
      const open = state.tokens[i];
      const paragraph = state.tokens[i + 1];
      const inline = state.tokens[i + 2];
      if (open.type !== 'blockquote_open' || paragraph.type !== 'paragraph_open' || inline.type !== 'inline') continue;
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(inline.content);
      if (!match) continue;
      let depth = 1;
      let end = i + 1;
      for (; end < state.tokens.length; end++) {
        if (state.tokens[end].type === 'blockquote_open') depth++;
        if (state.tokens[end].type === 'blockquote_close' && --depth === 0) break;
      }
      if (end >= state.tokens.length) continue;
      const kind = match[1].toUpperCase();
      open.tag = 'aside';
      open.attrJoin('class', `folio-alert folio-alert-${kind.toLowerCase()}`);
      state.tokens[end].tag = 'aside';
      inline.content = inline.content.slice(match[0].length);
      inline.children = [];
      state.md.inline.parse(inline.content, state.md, state.env, inline.children);
      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="folio-alert-title">${alertNames[kind]}</p>\n`;
      state.tokens.splice(i + 1, 0, title);
      i++;
    }
  });
}

function addTasks(md) {
  md.core.ruler.after('github-task-lists', 'folio_task_locations', state => {
    const lines = state.src.split('\n');
    for (const token of state.tokens) {
      const checkbox = token.type === 'inline' && token.children?.[0];
      if (!checkbox || checkbox.type !== 'html_inline' || !checkbox.content.startsWith('<input class="task-list-item-checkbox"')) continue;
      const line = token.map?.[0];
      const source = lines[line];
      const match = typeof source === 'string' && taskMarker(source);
      if (!match) continue;
      checkbox.type = 'folio_task_checkbox';
      checkbox.meta = { line, character: match[1].length + 1, source, checked: match[2].toLowerCase() === 'x' };
    }
  });
  md.renderer.rules.folio_task_checkbox = (tokens, index) => {
    const task = tokens[index].meta;
    const attributes = `data-folio-task-line="${task.line}" data-folio-task-character="${task.character}" data-folio-task-source="${md.utils.escapeHtml(task.source)}"`;
    return `<input class="task-list-item-checkbox" type="checkbox" disabled ${task.checked ? 'checked' : ''} ${attributes}>`;
  };
}

function taskMarker(line) {
  return /^((?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+))+)\[([ xX])\](?=[ \t]|$)/.exec(line);
}

function extendMarkdownIt(md) {
  if (md[installed]) return md;
  md[installed] = true;
  md.use(require('markdown-it-task-lists'), { enabled: false });
  md.use(require('markdown-it-footnote'));
  md.use(require('markdown-it-deflist'));
  md.use(require('markdown-it-mark'));
  md.use(require('markdown-it-sub'));
  md.use(require('markdown-it-sup'));
  md.use(require('markdown-it-abbr'));
  addTasks(md);
  addAlerts(md);

  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const language = tokens[index].info.trim().split(/\s+/)[0] || 'text';
    const label = md.utils.escapeHtml(language);
    const code = fence(tokens, index, options, env, self);
    const header = `<div class="folio-code-header"><span>${label}</span><button type="button" class="folio-copy" aria-label="复制代码">复制</button></div>`;
    return `<div class="folio-code-block">${header}${code}</div>\n`;
  };

  const openTable = md.renderer.rules.table_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  const closeTable = md.renderer.rules.table_close || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.table_open = (...args) => `<div class="folio-table" tabindex="0" role="region" aria-label="表格，可横向滚动">${openTable(...args)}`;
  md.renderer.rules.table_close = (...args) => `${closeTable(...args)}</div>`;
  return md;
}

module.exports = { extendMarkdownIt, taskMarker };
