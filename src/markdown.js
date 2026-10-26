'use strict';

const installed = Symbol.for('muyang.folio.markdown');
const highlight = require('highlight.js');
const codeLanguages = highlight.listLanguages().map(id => ({ id, name: highlight.getLanguage(id).name || id, aliases: highlight.getLanguage(id).aliases || [] }));
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
  md.core.ruler.before('github-task-lists', 'folio_empty_tasks', state => {
    const lines = state.src.split('\n');
    for (let i = 2; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' || state.tokens[i - 2].type !== 'list_item_open') continue;
      if (taskMarker(lines[token.map?.[0]] || '')?.[2] === '/' && token.children?.[0]?.type === 'text' && /^\[\/\](?=\s|$)/.test(token.content)) {
        // Let the existing task-list parser build the list; the source marker retains the third state.
        token.content = '[ ]' + token.content.slice(3); token.children[0].content = '[ ]' + token.children[0].content.slice(3);
      }
      if (!/^\[[ xX]\]$/.test(token.content) || token.children?.length !== 1 || token.children[0].type !== 'text') continue;
      // Markdown-it trims the trailing space of an empty task; restore it only for the task renderer.
      token.content += ' '; token.children[0].content += ' ';
    }
  });
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
      checkbox.meta = { line, character: match[1].length + 1, source, state: match[2] === '/' ? 'progress' : match[2].toLowerCase() === 'x' ? 'done' : 'pending' };
    }
  });
  md.renderer.rules.folio_task_checkbox = (tokens, index) => {
    const task = tokens[index].meta;
    const attributes = `data-folio-task-line="${task.line}" data-folio-task-character="${task.character}" data-folio-task-source="${md.utils.escapeHtml(task.source)}"`;
    return `<input class="task-list-item-checkbox" type="checkbox" disabled ${task.state === 'done' ? 'checked' : ''} data-folio-task-state="${task.state}" ${attributes}>`;
  };
}

function taskMarker(line) {
  return /^((?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+))+)\[([ xX/])\](?=[ \t]|$)/.exec(line);
}

function addTableSources(md) {
  md.core.ruler.push('folio_table_sources', state => {
    const lines = state.src.split('\n');
    const metadata = new Set();
    let table = false, cells = [], column = 0;
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token.type === 'table_open' && token.level === 0) {
        table = true; token.attrSet('data-folio-table', 'true');
        token.attrSet('data-folio-table-source', lines.slice(...token.map).join('\n').trimEnd());
        const previous = state.tokens[index - 1];
        const match = previous?.type === 'html_block' && /^<!-- folio:table-widths ([\d,]+) -->\s*$/.exec(previous.content);
        if (match && previous.level === 0 && lines.slice(previous.map[1], token.map[0]).every(line => !line.trim())) {
          const widths = match[1].split(',').map(Number), headerEnd = state.tokens.findIndex((item, i) => i > index && item.type === 'thead_close');
          const count = state.tokens.slice(index, headerEnd).filter(item => item.type === 'th_open').length;
          if (widths.length === count && widths.every(width => Number.isInteger(width) && width >= 90 && width <= 3000)) {
            token.attrSet('data-folio-table-widths', widths.join(','));
            token.attrSet('data-folio-table-prefix', lines.slice(previous.map[0], token.map[0]).join('\n') + '\n');
            token.map = [previous.map[0], token.map[1]]; metadata.add(previous);
          }
        }
      }
      if (token.type === 'table_close') table = false;
      if (!table) continue;
      if (token.type === 'tr_open') {
        // Match Markdown-it's pipe boundaries, retaining escapes in the original cell source.
        cells = (lines[token.map[0]] || '').trim().split(/(?<!\\)\|/);
        if (!cells[0].trim()) cells.shift();
        if (!cells.at(-1)?.trim()) cells.pop();
        column = 0;
      }
      if (token.type === 'th_open' || token.type === 'td_open') token.attrSet('data-folio-cell-source', (cells[column++] || '').trim());
    }
    state.tokens = state.tokens.filter(token => !metadata.has(token));
  });
}

function addEditableBlocks(md) {
  md.core.ruler.push('folio_editable_blocks', state => {
    const output = [];
    const lines = state.src.split('\n');
    for (const token of state.tokens) if (token.type === 'list_item_open' && token.map) {
      token.attrSet('data-folio-move-start-line', String(token.map[0])); token.attrSet('data-folio-move-end-line', String(token.map[1]));
    }
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (!token.map || token.level !== 0 || token.nesting === -1 || token.type === 'inline') { output.push(token); continue; }
      let end = i;
      if (token.nesting === 1) {
        let depth = 1;
        while (++end < state.tokens.length) { depth += state.tokens[end].nesting; if (!depth) break; }
      } else if (token.type === 'html_block') {
        const tag = /^\s*<(details|div|section|table|figure|article)\b/i.exec(token.content)?.[1];
        if (tag) {
          let depth = 0;
          for (let j = i; j < state.tokens.length; j++) {
            for (const match of state.tokens[j].type === 'html_block' ? state.tokens[j].content.matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')) : []) depth += match[1] ? -1 : 1;
            end = j;
            if (depth <= 0) break;
          }
        }
      }
      if (end >= state.tokens.length) { output.push(token); continue; }
      const finish = Math.max(token.map[1], ...state.tokens.slice(i, end + 1).map(item => item.map?.[1] || 0));
      const source = lines.slice(token.map[0], finish).join('\n');
      const rich = ['paragraph_open', 'heading_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open'].includes(token.type)
        && !/(<\/?[a-z!]|\[\^|\]\s*\[|\$|^\s*>?\s*\[!|\*\[|!\[)/im.test(editableStyleSource(source))
        && !(Object.keys(state.env.references || {}).length && /\[[^\]]+\](?!\()/.test(source))
        && !state.tokens.slice(i, end + 1).some(item => ['fence', 'code_block', 'table_open', 'html_block'].includes(item.type)
          || item.children?.some(child => ['link_open', 'image'].includes(child.type) && child.meta?.isReference));
      const open = new state.Token('folio_block_open', 'section', 1);
      const image = token.type === 'paragraph_open' && state.tokens[i + 1]?.children?.length === 1 && state.tokens[i + 1].children[0].type === 'image';
      open.meta = { start: token.map[0], end: finish, mode: token.type === 'fence' ? 'code' : image ? 'image' : token.type === 'table_open' ? 'table' : rich ? 'rich' : 'source', kind: token.tag || token.type };
      output.push(open, ...state.tokens.slice(i, end + 1), new state.Token('folio_block_close', 'section', -1));
      i = end;
    }
    state.tokens = output;
  });
  md.renderer.rules.folio_block_open = (tokens, index) => {
    const block = tokens[index].meta;
    return `<section class="folio-block" data-start-line="${block.start}" data-end-line="${block.end}" data-edit-mode="${block.mode}" data-kind="${block.kind}"><div class="folio-block-content">`;
  };
  md.renderer.rules.folio_block_close = () => '</div></section>\n';
}

function editableStyleSource(source) {
  const stack = []; let valid = true;
  const text = source.replace(/<\/?(?:span|u|strong|em|s|mark)\b[^>]*>/gi, tag => {
    if (/^<\/(span|u|strong|em|s|mark)>$/i.test(tag)) { if (stack.pop() !== tag.slice(2, -1).toLowerCase()) valid = false; return ''; }
    if (/^<(u|strong|em|s|mark)>$/i.test(tag)) { stack.push(tag.slice(1, -1).toLowerCase()); return ''; }
    if (/^<span style="(?:color:#[\da-f]{6}(?:;background-color:#[\da-f]{6})?|background-color:#[\da-f]{6})">$/i.test(tag)) { stack.push('span'); return ''; }
    valid = false; return tag;
  });
  return valid && !stack.length ? text : source;
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

  const openParagraph = md.renderer.rules.paragraph_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.paragraph_open = (tokens, index, ...args) => {
    const children = tokens[index + 1]?.children?.filter(token => token.type !== 'text' || token.content.trim());
    const image = children?.length === 1 && children[0].type === 'image'
      || children?.length === 3 && children[0].type === 'link_open' && children[1].type === 'image' && children[2].type === 'link_close';
    if (image) tokens[index].attrJoin('class', 'folio-image-paragraph');
    return openParagraph(tokens, index, ...args);
  };

  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const language = tokens[index].info.trim().split(/\s+/)[0] || 'text';
    const label = md.utils.escapeHtml(language);
    let code = md.utils.escapeHtml(tokens[index].content);
    if (highlight.getLanguage(language) && tokens[index].content.length <= 200000) {
      try { code = highlight.highlight(tokens[index].content, { language, ignoreIllegals: true }).value; } catch { /* Unknown syntax stays readable as plain text. */ }
    }
    const header = `<div class="folio-code-header"><span class="folio-code-language-label">${label}</span><div class="folio-code-actions">`
      + '<button type="button" class="folio-code-wrap" aria-label="自动换行" aria-pressed="true" title="自动换行">换行</button>'
      + '<button type="button" class="folio-copy" aria-label="复制代码">复制</button></div></div>';
    return `<div class="folio-code-block" data-language="${label}">${header}<pre><code class="hljs language-${label}">${code}</code></pre></div>\n`;
  };

  const openTable = md.renderer.rules.table_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  const closeTable = md.renderer.rules.table_close || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.table_open = (...args) => `<div class="folio-table" tabindex="0" role="region" aria-label="表格，可横向滚动">${openTable(...args)}`;
  md.renderer.rules.table_close = (...args) => `${closeTable(...args)}</div>`;
  addTableSources(md);
  addEditableBlocks(md);
  return md;
}

module.exports = { extendMarkdownIt, taskMarker, codeLanguages };
