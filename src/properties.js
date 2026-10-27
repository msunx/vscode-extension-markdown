'use strict';

const YAML = require('yaml');
const limit = 100000;

function frontmatter(source) {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const opening = /^---[ \t]*\r?\n/.exec(source.slice(start));
  if (!opening) return { exists: false, start, end: start, raw: '', content: '', lines: 0 };
  const contentStart = start + opening[0].length, closing = /^(---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = contentStart;
  const match = closing.exec(source);
  if (!match) return { exists: false, start, end: start, raw: '', content: '', lines: 0,
    error: /^\s*[^\n:]+:[ \t]/.test(source.slice(contentStart)) ? '文件顶部的属性缺少结束分隔线，请在源码中补上 ---。' : '' };
  const end = match.index + match[0].length, raw = source.slice(start, end);
  return { exists: true, start, end, raw, content: source.slice(contentStart, match.index), lines: raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0) };
}

function parse(source) {
  const header = frontmatter(source);
  if (header.error) return { header, error: header.error };
  if (header.content.length > limit) return { header, error: '文件属性超过 100 KB，请在源码中编辑。' };
  let document;
  try { document = YAML.parseDocument(header.content, { strict: true, uniqueKeys: true, intAsBigInt: true }); }
  catch { return { header, error: '属性 YAML 无法解析，请在源码中修正。' }; }
  if (document.errors.length || document.warnings.length) {
    const line = (document.errors[0] || document.warnings[0]).linePos?.[0]?.line;
    return { header, error: `属性 YAML 格式有误${line ? `（第 ${line + 1} 行）` : ''}，请在源码中修正。` };
  }
  if (document.contents && !YAML.isMap(document.contents)) return { header, error: '文件属性需要使用 YAML 键值格式，请在源码中修正。' };
  if (document.contents?.items.some(pair => !YAML.isScalar(pair.key) || typeof pair.key.value !== 'string')) return { header, error: '属性名称需要是文本，请在源码中修正。' };
  if ((document.contents?.items.length || 0) > 128) return { header, error: '属性超过 128 项，请在源码中编辑。' };
  return { header, document };
}

function describeNode(key, node) {
  let type = 'locked', value = '', summary = '复杂属性，请在源码中编辑';
  if (YAML.isScalar(node)) {
    if (typeof node.value === 'string') { type = key === 'created' ? 'date' : key === 'source' ? 'url' : 'text'; value = node.value; }
    else if ((typeof node.value === 'number' || typeof node.value === 'bigint') && Number.isFinite(Number(node.value))
      && (!Number.isInteger(Number(node.value)) || Number.isSafeInteger(Number(node.value)))) { type = 'number'; value = String(node.value); }
    else if (typeof node.value === 'boolean') { type = 'boolean'; value = String(node.value); }
    else if (node.value === null) summary = '空值 · null';
  } else if (YAML.isSeq(node) && node.items.every(item => YAML.isScalar(item) && typeof item.value === 'string' && item.value && !item.value.includes('\n'))) {
    type = 'list'; value = node.items.map(item => item.value).join('\n');
  } else if (YAML.isMap(node)) summary = `对象 · ${node.items.length} 个字段`;
  else if (YAML.isSeq(node)) summary = `列表 · ${node.items.length} 项`;
  return { key, originalKey: key, type, value: type === 'locked' ? summary : value };
}

function readProperties(source) {
  const result = parse(source);
  return { exists: result.header.exists, base: result.header.raw, error: result.error || '',
    fields: result.document?.contents?.items.map(pair => describeNode(pair.key.value, pair.value)) || [] };
}

function fieldValue(field) {
  if (typeof field.value !== 'string' || field.value.length > 20000) throw new Error('属性内容不能超过 20,000 个字符。');
  if (field.type === 'number') {
    if (!field.value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(field.value) || !Number.isFinite(Number(field.value))) throw new Error(`「${field.key}」需要填写有效数字。`);
    if (Number.isInteger(Number(field.value)) && !Number.isSafeInteger(Number(field.value))) throw new Error('超大整数请改用文本属性，避免精度丢失。');
    return Number(field.value);
  }
  if (field.type === 'boolean') {
    if (!['true', 'false'].includes(field.value)) throw new Error(`「${field.key}」需要选择是或否。`);
    return field.value === 'true';
  }
  if (field.type === 'list') return field.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!['text', 'date', 'url'].includes(field.type)) throw new Error('不支持此属性类型。');
  if (field.key === 'source' && field.value) {
    let url; try { url = new URL(field.value); } catch { /* Report alongside this field. */ }
    if (!url || !['https:', 'http:'].includes(url.protocol)) throw new Error('来源链接需要以 https:// 或 http:// 开头。');
  }
  if (field.key === 'created' && field.value) {
    const date = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(field.value);
    if (!date || !Number.isFinite(Date.parse(field.value)) || new Date(date[1]).toISOString().slice(0, 10) !== date[1]) throw new Error('创建时间请使用 YYYY-MM-DD，或包含时间的 ISO 日期。');
  }
  return field.value;
}

function updateProperties(source, message) {
  const { header, document, error } = parse(source);
  if (error) throw new Error(error);
  if (typeof message.base !== 'string' || message.base !== header.raw) throw new Error('属性已在别处修改，当前输入已保留；请重新读取后再编辑。');
  if (!Array.isArray(message.fields) || message.fields.length > 128) throw new Error('最多支持 128 项属性。');
  const previous = new Map((document.contents?.items || []).map(pair => [pair.key.value, pair]));
  const keys = new Set(), originals = new Set(), items = [];
  for (const field of message.fields) {
    if (!field || typeof field.key !== 'string' || !field.key.trim() || field.key.length > 120 || /[\r\n\x00-\x1f]/.test(field.key)) throw new Error('请填写有效属性名称（最多 120 个字符）。');
    const key = field.key.trim();
    if (keys.has(key)) throw new Error(`属性名称「${key}」重复了。`);
    keys.add(key);
    const pair = field.originalKey === null ? null : previous.get(field.originalKey);
    if (field.originalKey !== null && (!pair || originals.has(field.originalKey))) throw new Error('属性已变化，请重新读取后再编辑。');
    if (pair) originals.add(field.originalKey);
    const before = pair && describeNode(field.originalKey, pair.value);
    if (before?.type === 'locked') {
      if (key !== field.originalKey || field.type !== 'locked') throw new Error('复杂属性请在源码中编辑。');
      items.push(pair); continue;
    }
    if (pair && before.type === field.type && before.value === field.value && key === field.originalKey) { items.push(pair); continue; }
    let value;
    try { value = fieldValue({ ...field, key }); }
    catch (error) { error.field = key; throw error; }
    if (pair) {
      pair.key.value = key;
      if (YAML.isScalar(pair.value) && !Array.isArray(value)) pair.value.value = value;
      else {
        const node = document.createNode(value); node.comment = pair.value?.comment; node.commentBefore = pair.value?.commentBefore; node.anchor = pair.value?.anchor; pair.value = node;
      }
      items.push(pair);
    } else items.push(new YAML.Pair(document.createNode(key), document.createNode(value)));
  }
  for (const [key, pair] of previous) if (!originals.has(key) && describeNode(key, pair.value).type === 'locked') throw new Error('复杂属性不能在此删除，请在源码中编辑。');
  if (!header.exists && !items.length) return { start: header.start, end: header.end, text: '' };
  if (!document.contents) document.contents = document.createNode({});
  document.contents.items = items;
  const yaml = document.toString({ lineWidth: 0 });
  if (yaml.length > limit) throw new Error('文件属性不能超过 100 KB。');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const text = '---' + eol + yaml.replace(/\n/g, eol) + '---' + eol + (header.exists ? '' : eol);
  return { start: header.start, end: header.end, text };
}

function addFrontmatter(md) {
  md.block.ruler.before('hr', 'folio_frontmatter', (state, startLine, endLine, silent) => {
    if (startLine !== 0 || state.level !== 0) return false;
    const header = frontmatter(state.src);
    if (!header.exists) return false;
    if (silent) return true;
    state.push('folio_frontmatter', '', 0); state.line = header.lines; return true;
  });
  md.renderer.rules.folio_frontmatter = () => '';
}

module.exports = { frontmatter, readProperties, updateProperties, addFrontmatter };
