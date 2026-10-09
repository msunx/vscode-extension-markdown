const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
const evidence = path.join(root, `design/evidence/extension-${require('../package.json').version}`);

async function until(get, label) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const value = await get();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`超时：${label}`);
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9336');
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  const action = command => page.locator(`.editor-group-container.active .editor-actions [data-command-id="${command}"] .action-label`);
  const stage = expected => until(() => {
    try { return JSON.parse(fs.readFileSync(path.join(runtime, 'entry-stage.json'))).stage === expected; } catch { return false; }
  }, expected);
  const done = name => fs.writeFileSync(path.join(runtime, `entry-${name}-done.json`), '{}');
  const findPreview = () => until(async () => {
    for (const frame of page.frames().slice(1)) {
      try {
        const session = await context.newCDPSession(frame);
        const state = await session.send('Runtime.evaluate', {
          expression: '(()=>{const d=document.getElementById("active-frame")?.contentDocument;return {id:new URL(location.href).searchParams.get("id"),visible:d?.visibilityState,interactive:d?.body.dataset.folioInteractive,title:d?.querySelector("h1")?.textContent,tasks:d?.querySelectorAll("input:not(:disabled)").length}})()', returnByValue: true
        });
        if (state.result.value?.title === 'Folio · 入口回归' && state.result.value.interactive === 'true' && state.result.value.tasks && state.result.value.visible === 'visible') {
          const iframe = page.locator(`iframe[src*="id=${state.result.value.id}"]`);
          if (await iframe.isVisible()) return { session, id: state.result.value.id };
        }
        await session.detach();
      } catch { /* A closed preview can disappear while switching. */ }
    }
    return false;
  }, '可交互预览');
  const evaluate = async (preview, source) => (await preview.session.send('Runtime.evaluate', {
    expression: `(()=>{const d=document.getElementById('active-frame').contentDocument;${source}})()`, returnByValue: true
  })).result.value;
  const toggle = async (preview, line, expected) => {
    await preview.session.send('Runtime.evaluate', { expression: 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))', awaitPromise: true });
    const rect = await evaluate(preview, `const e=d.querySelector('input[data-folio-task-line="${line}"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const f=document.getElementById('active-frame').getBoundingClientRect();return {x:r.x+r.width/2+f.x,y:r.y+r.height/2+f.y};`);
    const outer = await page.locator(`iframe[src*="id=${preview.id}"]`).boundingBox();
    await page.mouse.click(outer.x + rect.x, outer.y + rect.y);
    await until(() => evaluate(preview, `const e=d.querySelector('input[data-folio-task-line="${line}"]');return !e.disabled && e.checked===${expected} && e.dataset.folioTaskSource.includes('${expected ? '[x]' : '[ ]'}');`), 'Todo 确认回写');
  };
  const result = { status: 'running', rounds: [] };
  for (let round = 1; round <= 3; round++) {
    await stage(`round-${round}`);
    await action('folio.preview').waitFor({ state: 'visible', timeout: 10000 });
    if (await action('markdown.showPreviewToSide').count()) throw new Error('仍存在重复的只读预览按钮');
    if (round === 1) await page.screenshot({ path: path.join(evidence, 'entry-visible.png') });
    await action('folio.preview').click({ timeout: 10000 });
    const preview = await findPreview();
    await toggle(preview, 2, true);
    if (round === 1) await page.screenshot({ path: path.join(evidence, 'todo-checked.png') });
    await toggle(preview, 2, false);
    await action('folio.edit').click({ timeout: 10000 });
    await action('folio.preview').waitFor({ state: 'visible', timeout: 10000 });
    result.rounds.push({ run: round, status: 'passed' });
    done(`round-${round}`);
  }
  await stage('native');
  await action('folio.preview').click({ timeout: 10000 });
  const migrated = await findPreview();
  await toggle(migrated, 3, true);
  await page.screenshot({ path: path.join(evidence, 'native-migrated.png') });
  await action('folio.edit').click({ timeout: 10000 });
  await action('folio.preview').waitFor({ state: 'visible', timeout: 10000 });
  done('native');
  await stage('plaintext');
  await until(async () => !(await action('folio.preview').count()) && !(await action('folio.edit').count()), '非 Markdown 按钮排除');
  result.status = 'passed';
  result.checks = ['真实标题栏按钮可见', '物理鼠标点击三轮勾选/取消并收到源文档回写', '原生预览标题栏迁移及勾选', '非 Markdown 活动编辑器没有 Folio 按钮'];
  fs.writeFileSync(path.join(evidence, 'entry-ui-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  done('plaintext');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
