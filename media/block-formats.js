(() => {
  'use strict';
  const formats = [
    ['text', '正文', 'p'], ...['一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题'].map((label, i) => [`h${i + 1}`, label, 'heading']),
    ['quote', '引用', 'blockquote'], ['code', '代码块', 'code'], ['bullet', '无序列表', 'list'], ['ordered', '有序列表', 'list'], ['task', '任务列表', 'task']
  ];
  const listTypes = ['bullet', 'ordered', 'task'];
  const ownTask = item => item.querySelector(':scope > input.task-list-item-checkbox, :scope > p > input.task-list-item-checkbox');
  const itemPattern = /^([ \t]*)([-+*]|\d+[.)])([ \t]+)(?:\[([ xX/])\](?:[ \t]+|$))?/;
  const columns = text => [...text].reduce((n, char) => char === '\t' ? n + 4 - n % 4 : n + 1, 0);
  function protectStart(text) {
    return text.split('\n').map(line => {
      if (/^\[!/.test(line)) return '\\' + line;
      if (/^ {0,3}(?:#{1,6}(?:\s|$)|>|[-+*](?:\s|$)|(?:[-*_]\s*){3,}$)/.test(line)) return line.replace(/^( {0,3})/, '$1\\');
      return line.replace(/^( {0,3}\d+)([.)])(?=\s)/, '$1\\$2');
    }).join('\n');
  }
  function literal(text) {
    return text.split('\n').map(line => line.replace(/&/g, '&amp;').replace(/([\\`*_[\]<>~#!|])/g, '\\$1')
      .replace(/^[ \t]+/, space => [...space].map(char => char === '\t' ? '&#9;' : '&#32;').join(''))
      .replace(/^([-+]|\d+[.)])(?=\s|$)/, marker => /\d/.test(marker) ? marker.slice(0, -1) + '\\' + marker.slice(-1) : '\\' + marker)
      .replace(/^([-=_])(?=\1{2,}\s*$)/, '\\$1')).join('  \n');
  }
  function describe(base, unit) {
    const raw = base.slice(unit.start, unit.end).replace(/\r\n/g, '\n').replace(/\n$/, '');
    const element = unit.element;
    if (unit.kind === 'task' || unit.kind === 'list' && element.matches('ul,ol')) {
      if (unit.kind === 'task' && unit.depth > 0) return null;
      const items = unit.kind === 'task' ? [element] : [...element.children].filter(item => item.tagName === 'LI');
      if (!items.length || items.some(item => !item.hasAttribute('data-folio-move-start-line'))) return null;
      const checked = items.map(ownTask), current = checked.every(Boolean) ? 'task' : checked.some(Boolean) ? null : element.tagName === 'OL' ? 'ordered' : 'bullet';
      return { raw, current, items, allowed: listTypes };
    }
    let body, current, simple = true;
    if (unit.kind === 'p' && element.tagName === 'P' && !element.querySelector('img')) { body = raw; current = 'text'; }
    else if (unit.kind === 'heading') {
      const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(raw), setext = /\n {0,3}([=-]+)[ \t]*$/.exec(raw);
      if (atx) { body = atx[2].replace(/[ \t]+#+[ \t]*$/, ''); current = `h${atx[1].length}`; }
      else if (setext) { body = raw.slice(0, setext.index); current = setext[1][0] === '=' ? 'h1' : 'h2'; }
      else return null;
    } else if (unit.kind === 'blockquote') {
      if (!/^ {0,3}>/.test(raw)) return null;
      body = raw.split('\n').map(line => line.replace(/^ {0,3}>[ \t]?/, '')).join('\n'); current = 'quote';
      simple = [...element.children].every(child => child.tagName === 'P') && !element.querySelector('img');
    } else if (unit.kind === 'code') {
      const code = element.querySelector('code'); if (!code) return null;
      body = code.textContent.replace(/\r\n/g, '\n').replace(/\n$/, ''); current = 'code';
    } else return null;
    if (!body.trim()) return null;
    const single = simple && !body.includes('\n');
    const allowed = formats.map(([id]) => id).filter(id => id === 'code' || id === 'quote' || id === 'text' && simple || single);
    return { raw, body, current, allowed };
  }
  function listSource(base, unit, data, target) {
    const eol = base.includes('\r\n') ? '\r\n' : '\n', lines = base.split(eol), replacements = [];
    for (const [index, item] of data.items.entries()) {
      const start = Number(item.dataset.folioMoveStartLine), end = Number(item.dataset.folioMoveEndLine), prefix = itemPattern.exec(lines[start] || '');
      if (!prefix || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
      const marker = target === 'ordered' ? `${index + 1}. ` : '- ', indent = prefix[1];
      const oldWidth = columns(indent + prefix[2] + prefix[3]), delta = columns(indent + marker) - oldWidth;
      const state = target === 'task' ? `[${prefix[4] || ' '}] ` : '';
      const replacement = [indent + marker + state + lines[start].slice(prefix[0].length)];
      for (let n = start + 1; n < end; n++) {
        const line = lines[n], whitespace = line.match(/^[ \t]*/)[0], width = columns(whitespace);
        replacement.push(delta && line.trim() && width >= oldWidth ? ' '.repeat(width + delta) + line.slice(whitespace.length) : line);
      }
      replacements.push({ start, end, replacement });
    }
    for (const change of replacements.reverse()) lines.splice(change.start, change.end - change.start, ...change.replacement);
    return lines.join(eol);
  }
  function convert(base, unit, target) {
    const data = describe(base, unit); if (!data || !data.allowed.includes(target) || data.current === target) return null;
    if (data.items) return listSource(base, unit, data, target);
    const eol = base.includes('\r\n') ? '\r\n' : '\n';
    const body = data.current === 'code' ? literal(data.body) : data.body;
    let text;
    if (target === 'code') {
      const fence = '`'.repeat(Math.max(2, ...(data.body.match(/`+/g) || []).map(run => run.length)) + 1);
      text = `${fence}\n${data.body}\n${fence}`;
    } else if (target === 'text') text = protectStart(body);
    else if (target === 'quote') text = protectStart(body).split('\n').map(line => '> ' + line).join('\n');
    else if (/^h[1-6]$/.test(target)) text = '#'.repeat(Number(target[1])) + ' ' + body.replace(/([ \t]+)(#+)([ \t]*)$/, '$1\\$2$3');
    else {
      const marker = target === 'ordered' ? '1. ' : '- ';
      text = marker + (target === 'task' ? '[ ] ' : '') + protectStart(body);
    }
    const before = base.slice(0, unit.start), after = base.slice(unit.end);
    const trailing = (before.match(/(?:\r?\n)+$/)?.[0].match(/\n/g) || []).length, leading = (after.match(/^(?:\r?\n)+/)?.[0].match(/\n/g) || []).length;
    return before + (before ? eol.repeat(Math.max(0, 2 - trailing)) : '') + text.replace(/\n/g, eol)
      + (after ? eol.repeat(Math.max(1, 2 - leading)) : /\r?\n$/.test(base) ? eol : '') + after;
  }
  window.FolioBlockFormats = {
    options(base, unit) {
      const data = describe(base, unit); if (!data) return [];
      return formats.filter(([id]) => data.allowed.includes(id)).map(([id, label, icon]) => ({ id, label, icon, current: id === data.current }));
    }, convert
  };
})();
