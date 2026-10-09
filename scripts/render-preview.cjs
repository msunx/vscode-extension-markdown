const fs = require('node:fs');
const path = require('node:path');
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js');
const { extendMarkdownIt } = require('../src/markdown');
const { Resvg } = require('@resvg/resvg-js');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.runtime');
fs.mkdirSync(output, { recursive: true });
const icon = new Resvg(fs.readFileSync(path.join(root, 'media/icon.svg')), { fitTo: { mode: 'width', value: 256 } }).render().asPng();
fs.writeFileSync(path.join(root, 'media/icon.png'), icon);
const md = extendMarkdownIt(new MarkdownIt({
  html: true,
  highlight: (code, language) => language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : ''
}));
const source = fs.readFileSync(path.join(root, 'examples/preview.md'), 'utf8');
const hostRendered = process.argv.includes('--host');
const html = (hostRendered ? fs.readFileSync(path.join(output, 'host-rendered.html'), 'utf8') : md.render(source))
  .replace('src="../media/icon.png"', `src="data:image/png;base64,${icon.toString('base64')}"`);
const nativePath = '/Applications/Cursor.app/Contents/Resources/app/extensions/markdown-language-features/media/markdown.css';
const native = fs.existsSync(nativePath) ? fs.readFileSync(nativePath, 'utf8') : '';
const mathPath = '/Applications/Cursor.app/Contents/Resources/app/extensions/markdown-math';
const math = hostRendered ? ['notebook-out/katex.min.css', 'preview-styles/index.css'].map(file => {
  const location = path.join(mathPath, file);
  return fs.readFileSync(location, 'utf8').replace(/url\(([^)]+)\)/g, (_, value) => {
    const requested = path.resolve(path.dirname(location), value.replace(/["']/g, ''));
    const font = fs.existsSync(requested) ? requested : requested.replace(/\.(woff|ttf)$/, '.woff2');
    return `url(data:font/${path.extname(font).slice(1)};base64,${fs.readFileSync(font).toString('base64')})`;
  });
}).join('\n') : '';
const style = fs.readFileSync(path.join(root, 'media/preview.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'media/preview.js'), 'utf8');
const page = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<link rel="icon" href="data:,"><title>Folio 预览验收</title><style>' + native + '\n' + math + '\n' + style + '</style></head>'
  + '<body class="vscode-dark"><div class="markdown-body">' + html + '</div><script>' + script + '</script></body></html>';
fs.writeFileSync(path.join(output, 'preview.html'), page);
console.log(path.join(output, 'preview.html'));
