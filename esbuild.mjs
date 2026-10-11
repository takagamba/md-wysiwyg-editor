import * as esbuild from 'esbuild';
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'out/extension.js',
  external: ['vscode'],
  loader: { '.css': 'text' },
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: { vditor: 'webview/vditor.ts' },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outdir: 'out/webview',
  assetNames: 'assets/[name]-[hash]',
  loader: {
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
    '.eot': 'file',
    '.svg': 'file',
    '.png': 'file',
    '.gif': 'file',
  },
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// Vditor は lute（Markdown エンジン）・i18n・KaTeX・Mermaid などを実行時に cdn から読み込む。
// Webview からは外部 CDN を使わず、拡張に同梱したコピーを読み込ませる。
async function copyVditorAssets() {
  const dest = 'out/vditor/dist';
  if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
  // MathJax は数式エンジンに MathJax を指定したときだけ読み込まれる。KaTeX に固定しているので同梱しない
  const unused = new Set(['node_modules/vditor/dist/js/mathjax']);
  for (const dir of ['js', 'css', 'images']) {
    await cp(`node_modules/vditor/dist/${dir}`, `${dest}/${dir}`, {
      recursive: true,
      filter: (src) => !unused.has(src.replaceAll('\\', '/')),
    });
  }
}

// 配布用ビルドでは、開発ビルドの残り（ソースマップなど）が .vsix に入らないよう out/ を作り直す
if (production) await rm('out', { recursive: true, force: true });
await copyVditorAssets();

if (watch) {
  const contexts = await Promise.all([esbuild.context(extensionConfig), esbuild.context(webviewConfig)]);
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}
