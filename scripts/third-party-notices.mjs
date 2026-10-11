// THIRD_PARTY_NOTICES.md を生成する: node scripts/third-party-notices.mjs
//
// .vsix に入る第三者のコードは 3 種類ある。
//   1. out/extension.js にバンドルされる npm パッケージ … esbuild の metafile から自動で集める
//   2. out/webview/vditor.js にバンドルされる npm パッケージ … 同上
//   3. out/vditor/dist にコピーする Vditor のアセット（MathJax は esbuild.mjs でコピー対象から外している） … VDITOR_ASSETS に手で列挙する
//      （ビルド済みファイルなのでライセンス文が同梱されていないものが多い。取得した原文を scripts/licenses/ に置く）
// 依存関係や Vditor を更新したら、このスクリプトを実行し直して差分を確認すること。

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const LICENSES = 'scripts/licenses';
const VDITOR_DIST = 'node_modules/vditor/dist/js';
const OUTPUT = 'THIRD_PARTY_NOTICES.md';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
const lic = (name) => read(path.join(LICENSES, name));

/** ライセンスファイルを同梱していない npm パッケージの補足 */
const NPM_FALLBACK = {
  'puppeteer-core': { copyright: 'Copyright 2017 Google Inc.', text: () => lic('apache-2.0.txt') },
  '@puppeteer/browsers': { copyright: 'Copyright 2023 Google Inc.', text: () => lic('apache-2.0.txt') },
};

/** npm パッケージの中に組み込まれている別のライブラリ */
const NPM_EMBEDDED = {
  vditor: [
    {
      name: 'diff-match-patch',
      version: pkgVersion('diff-match-patch'),
      license: 'Apache-2.0',
      url: 'https://github.com/google/diff-match-patch',
      text: () => read('node_modules/diff-match-patch/LICENSE'),
    },
  ],
};

/** out/vditor/dist に同梱する Vditor のアセット（Vditor が実行時に読み込む） */
const VDITOR_ASSETS = [
  {
    name: 'Lute',
    path: 'lute/',
    license: 'MulanPSL-2.0',
    url: 'https://github.com/88250/lute',
    copyright: 'Copyright (c) 2019-present, b3log.org',
    text: () => lic('lute.txt'),
  },
  { name: 'abcjs', version: '5.10.3', path: 'abcjs/', license: 'MIT', url: 'https://github.com/paulrosen/abcjs', text: () => lic('abcjs.txt') },
  {
    name: 'Apache ECharts',
    version: '5.6.0',
    path: 'echarts/',
    license: 'Apache-2.0',
    url: 'https://github.com/apache/echarts',
    text: () => lic('echarts-LICENSE.txt'),
    notice: () => lic('echarts-NOTICE.txt'),
    embedded: [{ name: 'd3.js（ECharts に一部を含む）', license: 'BSD-3-Clause', text: () => lic('echarts-LICENSE-d3.txt') }],
  },
  {
    name: 'flowchart.js',
    version: '1.14.1',
    path: 'flowchart.js/',
    license: 'MIT',
    url: 'https://github.com/adrai/flowchart.js',
    text: () => lic('flowchart.txt'),
    embedded: [{ name: 'Raphaël', license: 'MIT', url: 'https://github.com/DmitryBaranovskiy/raphael', text: () => lic('raphael.txt') }],
  },
  {
    name: 'Viz.js',
    version: '2.1.2',
    path: 'graphviz/',
    license: 'MIT',
    url: 'https://github.com/mdaines/viz-js',
    text: () => lic('vizjs.txt'),
    embedded: [
      {
        name: 'Graphviz 2.40.1（オブジェクトコード）',
        license: 'EPL-1.0',
        url: 'https://graphviz.org',
        note: 'ソースコードは https://gitlab.com/graphviz/graphviz から入手できます。',
        text: () => lic('epl-1.0.txt'),
      },
      { name: 'Expat 2.2.5', license: 'MIT', url: 'https://libexpat.github.io', text: () => lic('expat.txt') },
      { name: 'zlib', license: 'Zlib', url: 'https://zlib.net', copyright: 'Copyright (C) 1995-2013 Jean-loup Gailly and Mark Adler', text: () => lic('zlib.txt') },
    ],
  },
  { name: 'highlight.js', version: '11.7.0', path: 'highlight.js/', license: 'BSD-3-Clause', url: 'https://github.com/highlightjs/highlight.js', text: () => read(`${VDITOR_DIST}/highlight.js/LICENSE`) },
  { name: 'KaTeX（mhchem 拡張を含む）', version: '0.16.9', path: 'katex/', license: 'MIT', url: 'https://github.com/KaTeX/KaTeX', text: () => lic('katex.txt') },
  {
    name: 'markmap',
    version: '0.14.3',
    path: 'markmap/',
    license: 'MIT',
    url: 'https://github.com/markmap/markmap',
    text: () => lic('markmap.txt'),
    embedded: [
      { name: 'D3 6.7.0', license: 'BSD-3-Clause', url: 'https://github.com/d3/d3', text: () => lic('d3.txt') },
      { name: 'Prism', license: 'MIT', url: 'https://github.com/PrismJS/prism', text: () => lic('prism.txt') },
    ],
  },
  {
    name: 'Mermaid',
    version: '11.16.1',
    path: 'mermaid/',
    license: 'MIT',
    url: 'https://github.com/mermaid-js/mermaid',
    note: '配布ファイルには Mermaid の依存ライブラリ（D3、DOMPurify、cytoscape.js、dagre など）が含まれます。各ライブラリのライセンスは Mermaid のリポジトリを参照してください。',
    text: () => lic('mermaid.txt'),
  },
  {
    name: 'plantuml-encoder',
    path: 'plantuml/',
    license: 'MIT',
    url: 'https://github.com/markushedvall/plantuml-encoder',
    text: () => lic('plantuml-encoder.txt'),
    embedded: [{ name: 'pako', license: 'MIT AND Zlib', url: 'https://github.com/nodeca/pako', text: () => lic('pako.txt') }],
  },
  { name: 'SmilesDrawer', version: '2.4.2', path: 'smiles-drawer/', license: 'MIT', url: 'https://github.com/reymond-group/smilesDrawer', text: () => lic('smiles-drawer.txt') },
  { name: 'WaveDrom', version: '3.6.2', path: 'wavedrom/', license: 'MIT', url: 'https://github.com/wavedrom/wavedrom', text: () => read(`${VDITOR_DIST}/wavedrom/LICENSE.WaveDrom`) },
];

function pkgVersion(name) {
  return JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
}

/** esbuild の metafile から、出力に 1 バイト以上含まれた npm パッケージを集める */
async function bundledPackages(options) {
  const result = await esbuild.build({ ...options, bundle: true, write: false, metafile: true, logLevel: 'silent' });
  const dirs = new Map();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const [input, info] of Object.entries(output.inputs)) {
      if (info.bytesInOutput === 0) continue;
      const matches = input.match(/node_modules\/(?:@[^/]+\/)?[^/]+/g);
      if (!matches) continue;
      const last = matches.at(-1);
      dirs.set(last.slice('node_modules/'.length), input.slice(0, input.lastIndexOf(last) + last.length));
    }
  }
  return [...dirs].sort(([a], [b]) => a.localeCompare(b));
}

function npmEntry(name, dir, where) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  const fallback = NPM_FALLBACK[name];
  if (!file && !fallback) throw new Error(`${name}: ライセンスファイルがありません。NPM_FALLBACK に追加してください`);
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license),
    url: (repo ?? pkg.homepage ?? `https://www.npmjs.com/package/${name}`).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:/, 'https:'),
    where,
    copyright: file ? undefined : fallback.copyright,
    text: () => (file ? read(path.join(dir, file)) : fallback.text()),
    embedded: NPM_EMBEDDED[name],
  };
}

const extensionPackages = await bundledPackages({
  entryPoints: ['src/extension.ts'],
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  loader: { '.css': 'text' },
  outfile: 'out/extension.js',
});
const webviewPackages = await bundledPackages({
  entryPoints: ['webview/vditor.ts'],
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outdir: 'out/webview',
  loader: Object.fromEntries(['.woff', '.woff2', '.ttf', '.eot', '.svg', '.png', '.gif'].map((e) => [e, 'file'])),
});

const groups = [
  {
    title: '拡張機能本体（out/extension.js）',
    entries: extensionPackages.map(([n, d]) => npmEntry(n, d, 'out/extension.js')),
  },
  {
    title: 'Webview（out/webview/vditor.js）',
    entries: webviewPackages.map(([n, d]) =>
      npmEntry(n, d, n === 'vditor' ? 'out/webview/vditor.js, out/vditor/dist（アイコン・言語ファイル・テーマ・画像）' : 'out/webview/vditor.js'),
    ),
  },
  {
    title: `Vditor ${pkgVersion('vditor')} の同梱アセット（out/vditor/dist）`,
    entries: VDITOR_ASSETS.map((a) => ({ ...a, where: `out/vditor/dist/js/${a.path}` })),
  },
];

// 同じ本文（空白の違いを除く）のライセンスは付録に 1 回だけ載せる
const appendix = new Map();
const APACHE = lic('apache-2.0.txt');
const normalize = (s) => s.replace(/\s+/g, ' ').trim();
appendix.set(normalize(APACHE), { id: 'apache-2.0', title: 'Apache License 2.0', text: APACHE, used: false });

const lines = [];
const body = (text) => {
  const entry = appendix.get(normalize(text));
  if (entry) {
    entry.used = true;
    return [`ライセンス本文: [付録: ${entry.title}](#${entry.id})`];
  }
  return ['```text', text, '```'];
};
const section = (e, level) => {
  const h = '#'.repeat(level);
  lines.push(`${h} ${e.name}${e.version ? ` ${e.version}` : ''}`, '');
  lines.push(`- ライセンス: ${e.license}`);
  if (e.url) lines.push(`- 入手先: <${e.url}>`);
  if (e.where) lines.push(`- 含まれる場所: \`${e.where}\``);
  if (e.copyright) lines.push(`- 著作権表示: ${e.copyright}`);
  if (e.note) lines.push(`- 補足: ${e.note}`);
  lines.push('');
  lines.push(...body(e.text()), '');
  if (e.notice) lines.push('NOTICE:', '', '```text', e.notice(), '```', '');
  for (const sub of e.embedded ?? []) section(sub, level + 1);
};

lines.push(
  '# Third-Party Notices',
  '',
  'この拡張機能（Markdown WYSIWYG Editor）の配布物（.vsix）には、以下の第三者ソフトウェアが含まれています。',
  '各ソフトウェアの著作権は、それぞれの著作権者に帰属します。',
  '',
  'This extension includes the third-party software listed below. Each component is licensed under its own terms, reproduced in this file.',
  '',
  `<!-- このファイルは scripts/third-party-notices.mjs で生成しています。直接編集しないでください。 -->`,
  '',
  '## 一覧',
  '',
  '| ソフトウェア | バージョン | ライセンス | 含まれる場所 |',
  '| --- | --- | --- | --- |',
);
for (const g of groups) {
  for (const e of g.entries) lines.push(`| ${e.name} | ${e.version ?? '-'} | ${e.license} | ${g.title} |`);
}
lines.push('');
for (const g of groups) {
  lines.push(`## ${g.title}`, '');
  for (const e of g.entries) section(e, 3);
}
for (const a of appendix.values()) {
  if (!a.used) continue;
  lines.push(`## 付録: ${a.title}`, '', `<a id="${a.id}"></a>`, '', '```text', a.text, '```', '');
}

fs.writeFileSync(OUTPUT, lines.join('\n'));
const count = groups.reduce((n, g) => n + g.entries.length, 0);
console.log(`${OUTPUT}: ${count} 件（${groups.map((g) => `${g.title} ${g.entries.length}`).join(' / ')}）`);
