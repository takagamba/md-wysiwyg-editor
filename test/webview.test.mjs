// Webview（out/webview/vditor.js）のテスト。npm run build の後に実行する。
// ビルド済みの Webview をローカルの HTTP サーバーから配信し、acquireVsCodeApi をモックしたページを
// 本番と同じ CSP で Chrome / Edge（ヘッドレス）から開いて、拡張ホストとのメッセージをやり取りする
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { changedLines, importTs, readText, ROOT } from './helpers.mjs';

const { findBrowser } = await importTs('src/findBrowser.ts');
const browserPath = findBrowser(process.env.CHROME_PATH ?? '');
const built = fs.existsSync(path.join(ROOT, 'out/webview/vditor.js'));
const skip = !browserPath ? 'Chrome / Edge が見つからない（CHROME_PATH で指定できる）' : !built ? 'npm run build を先に実行する' : false;

const SAMPLE = readText('test/fixtures/basic.md');
/** Vditor が input を通知するまでの時間（undoDelay 800ms + デバウンス 150ms）より長く待つ */
const SETTLE_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'nonce-test' 'self'; connect-src 'self'">
<link rel="stylesheet" href="/out/webview/vditor.css"></head>
<body class="vscode-light"><div id="readonly-badge" hidden>閲覧モード</div><div id="editor"></div>
<script nonce="test">window.sent = []; window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m) });</script>
<script nonce="test" id="vditorIconScript" src="/out/vditor/dist/js/icons/ant.js"></script>
<script nonce="test" src="/out/webview/vditor.js"></script></body></html>`;

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png' };
let server;
let browser;
let origin;

before(async () => {
  if (skip) return;
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE);
      return;
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(path.join(ROOT, 'out')) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** Webview を開いて init まで済ませる */
async function openEditor({ text = SAMPLE, readOnly = false, preserveFormatting = true } = {}) {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  await page.goto(origin + '/');
  await page.waitForFunction(() => window.sent.some((m) => m.type === 'ready'));
  const send = (message) => page.evaluate((m) => window.postMessage(m, '*'), message);
  await send({ type: 'init', options: { text, readOnly, vditorCdn: `${origin}/out/vditor`, vditorMode: 'ir', preserveFormatting } });
  await page.waitForSelector('.vditor-ir .vditor-reset');
  await sleep(500);
  const edits = () => page.evaluate(() => window.sent.filter((m) => m.type === 'edit').map((m) => m.text));
  const flush = async (id) => {
    await send({ type: 'flush', id });
    await page.waitForFunction((i) => window.sent.some((m) => m.type === 'flushed' && m.id === i), { timeout: 3000 }, id);
    return page.evaluate((i) => window.sent.find((m) => m.type === 'flushed' && m.id === i).text, id);
  };
  /** 本文の段落（テキストで探す）の末尾に入力する */
  const typeAtEndOf = async (selector, includes, text) => {
    const index = await page.$$eval(selector, (els, s) => els.findIndex((e) => e.textContent.includes(s)), includes);
    assert.ok(index >= 0, `${selector} に「${includes}」がない`);
    await (await page.$$(selector))[index].click();
    await page.keyboard.press('End');
    await page.keyboard.type(text);
  };
  return { page, errors, requests, send, edits, flush, typeAtEndOf };
}

const P = '.vditor-ir .vditor-reset > p';

test('開いただけでは edit を送らない', { skip }, async () => {
  const { page, errors, edits } = await openEditor();
  await sleep(SETTLE_MS);
  assert.deepEqual(await edits(), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('段落に入力すると、その行だけが変わる', { skip }, async () => {
  const { page, edits, typeAtEndOf } = await openEditor();
  await typeAtEndOf(P, '動作確認用', '追記');
  await sleep(SETTLE_MS);
  const { removed, added } = changedLines(SAMPLE, (await edits()).at(-1));
  assert.equal(removed.length, 1);
  assert.deepEqual(added, [removed[0] + '追記']);
  await page.close();
});

test('タスクにチェックを入れると、その行だけが [x] になる', { skip }, async () => {
  const { page, edits } = await openEditor();
  const boxes = await page.$$('.vditor-ir .vditor-task input[type=checkbox]');
  await boxes[1].click();
  await sleep(SETTLE_MS);
  assert.deepEqual(changedLines(SAMPLE, (await edits()).at(-1)), {
    removed: ['- [ ] 未完了のタスク'],
    added: ['- [x] 未完了のタスク'],
  });
  await page.close();
});

test('外部変更（update）を反映した後の入力では、外部変更が保たれる', { skip }, async () => {
  const { page, send, edits, typeAtEndOf } = await openEditor();
  const external = SAMPLE.replace('## 画像', '## 画像（外部で変更）');
  await send({ type: 'update', text: external });
  await sleep(300);
  await typeAtEndOf('.vditor-ir .vditor-reset > h2', 'Mermaid', '!');
  await sleep(SETTLE_MS);
  assert.deepEqual(changedLines(external, (await edits()).at(-1)), { removed: ['## Mermaid'], added: ['## Mermaid!'] });
  await page.close();
});

test('flush: 入力直後でも最新の内容を返し、未編集なら null を返す', { skip }, async () => {
  const { page, edits, flush, typeAtEndOf } = await openEditor();
  assert.equal(await flush(1), null);
  await typeAtEndOf(P, '動作確認用', 'XYZ');
  const flushed = await flush(2);
  assert.ok(flushed.includes('動作確認用です。'), '本文が含まれる');
  assert.equal(changedLines(SAMPLE, flushed).added.length, 1);
  assert.match(changedLines(SAMPLE, flushed).added[0], /XYZ$/);
  // Vditor の通知が後から届いても、flush と違う内容は送らない（保存後に未保存へ戻らない）
  await sleep(SETTLE_MS);
  assert.deepEqual((await edits()).filter((t) => t !== flushed), []);
  await page.close();
});

test('入力は Vditor の通知（800ms 後）を待たずに送る（直後にタブを閉じても失われない）', { skip }, async () => {
  const { page, edits, typeAtEndOf } = await openEditor();
  await typeAtEndOf(P, '動作確認用', 'Q');
  await sleep(500);
  assert.match((await edits()).at(-1) ?? '', /動作確認用です。.*Q$/m);
  // 後から届く Vditor の通知では、同じ内容を送り直さない
  await sleep(SETTLE_MS);
  assert.equal((await edits()).length, 1);
  await page.close();
});

test('IME の変換中は送らず、確定してから送る', { skip }, async () => {
  const { page, edits, typeAtEndOf } = await openEditor();
  await typeAtEndOf(P, '動作確認用', '');
  const cdp = await page.createCDPSession();
  await cdp.send('Input.imeSetComposition', { text: 'へんかん', selectionStart: 4, selectionEnd: 4 });
  await sleep(500);
  assert.deepEqual(await edits(), [], '変換中は送らない');
  await cdp.send('Input.insertText', { text: '変換' });
  await sleep(500);
  assert.match((await edits()).at(-1) ?? '', /動作確認用です。.*変換$/m);
  assert.ok(!(await edits()).some((t) => t.includes('へんかん')), '確定前の文字を送らない');
  await page.close();
});

test('blur で入力直後の内容をすぐに送る', { skip }, async () => {
  const { page, edits, typeAtEndOf } = await openEditor();
  await typeAtEndOf(P, '動作確認用', 'W');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(50);
  assert.match((await edits()).at(-1) ?? '', /動作確認用です。.*W$/m);
  await page.close();
});

test('閲覧モードでは入力も flush も文書を変えない', { skip }, async () => {
  const { page, edits, flush } = await openEditor({ readOnly: true });
  assert.equal(await page.$eval('#readonly-badge', (e) => e.hidden), false, '閲覧モードの表示が出る');
  assert.equal(await flush(1), null);
  await sleep(SETTLE_MS);
  assert.deepEqual(await edits(), []);
  await page.close();
});

test('数式は KaTeX で表示し、MathJax は読み込まない', { skip }, async () => {
  const { page, requests } = await openEditor();
  await sleep(SETTLE_MS);
  assert.ok((await page.$$('.katex')).length > 0, 'KaTeX で描画されている');
  assert.ok(!requests.some((u) => /mathjax/i.test(u)), 'MathJax を読み込まない');
  await page.close();
});
