// media/ の画像を作る: アイコン（icon.svg → icon.png）と README 用のスクリーンショット。
// npm run build の後に node scripts/render-media.mjs で実行する（Chrome / Edge が必要）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { importTs, ROOT } from '../test/helpers.mjs';

const { findBrowser } = await importTs('src/findBrowser.ts');
const browserPath = findBrowser(process.env.CHROME_PATH ?? '');
if (!browserPath) throw new Error('Chrome / Edge が見つからない（CHROME_PATH で指定できる）');
const MEDIA = path.join(ROOT, 'media');

// スクリーンショットに使う文書
const SHOWCASE = `# Markdown WYSIWYG + PDF

Edit Markdown **as it looks**, right in the same tab. 見たまま、同じタブで編集できます。

## Tasks

- [x] Typora-like live rendering
- [x] Read-only mode and PDF export
- [ ] Write your document

## Table

| Feature | Supported |
| --- | --- |
| Math | KaTeX |
| Diagrams | Mermaid, ECharts, Graphviz |

## Math

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Code

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Mermaid

\`\`\`mermaid
graph LR
  A[Markdown] --> B[WYSIWYG]
  B --> C[PDF]
\`\`\`
`;

// VS Code の既定テーマ（Light Modern / Dark Modern）の色
const THEMES = {
  light: {
    bodyClass: 'vscode-light',
    vars: { 'editor-background': '#ffffff', 'editor-foreground': '#3b3b3b', 'editorWidget-background': '#f8f8f8', 'panel-border': '#e5e5e5', 'icon-foreground': '#424242', 'textLink-foreground': '#005fb8', 'badge-background': '#cccccc', 'badge-foreground': '#3b3b3b' },
  },
  dark: {
    bodyClass: 'vscode-dark',
    vars: { 'editor-background': '#1f1f1f', 'editor-foreground': '#cccccc', 'editorWidget-background': '#202020', 'panel-border': '#2b2b2b', 'icon-foreground': '#cccccc', 'textLink-foreground': '#4daafc', 'badge-background': '#616161', 'badge-foreground': '#f8f8f8' },
  },
};

const page = (theme) => {
  const vars = Object.entries(theme.vars).map(([k, v]) => `--vscode-${k}:${v};`).join('');
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<style>body{--vscode-font-family:"Segoe WPC","Segoe UI",sans-serif;${vars}}</style>
<link rel="stylesheet" href="/out/webview/vditor.css"></head>
<body class="${theme.bodyClass}"><div id="readonly-badge" hidden>閲覧モード</div><div id="editor"></div>
<script>window.acquireVsCodeApi = () => ({ postMessage() {} });</script>
<script id="vditorIconScript" src="/out/vditor/dist/js/icons/ant.js"></script>
<script src="/out/webview/vditor.js"></script></body></html>`;
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const theme = THEMES[url.slice(1)];
  if (theme) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(theme));
    return;
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(path.join(ROOT, 'out')) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });

try {
  // アイコン（Marketplace は 128×128 以上の PNG）
  const icon = await browser.newPage();
  await icon.setViewport({ width: 256, height: 256 });
  await icon.setContent(`<style>html,body{margin:0;background:transparent}</style>${fs.readFileSync(path.join(MEDIA, 'icon.svg'), 'utf8').replace('<svg ', '<svg width="256" height="256" ')}`);
  await icon.screenshot({ path: path.join(MEDIA, 'icon.png'), omitBackground: true });
  console.log('media/icon.png');

  for (const name of Object.keys(THEMES)) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1000, height: 1180 });
    await p.goto(`${origin}/${name}`);
    await p.evaluate(
      (text, cdn) => window.postMessage({ type: 'init', options: { text, readOnly: false, vditorCdn: cdn, vditorMode: 'ir', preserveFormatting: true } }, '*'),
      SHOWCASE,
      `${origin}/out/vditor`,
    );
    await p.waitForSelector('.vditor-ir .vditor-reset');
    await p.waitForSelector('.vditor-ir .katex');
    await p.waitForSelector('.vditor-ir svg[id^="mermaid"], .vditor-ir .language-mermaid svg', { timeout: 10000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    // カーソルのある見出しだけ記法（##）が見える様子を写す
    const h2 = (await p.$$('.vditor-ir .vditor-reset > h2'))[1];
    await h2.click();
    await p.keyboard.press('End');
    await new Promise((r) => setTimeout(r, 300));
    const file = `screenshot-${name}.png`;
    await p.screenshot({ path: path.join(MEDIA, file) });
    console.log(`media/${file}`);
  }
} finally {
  await browser.close();
  server.close();
}
