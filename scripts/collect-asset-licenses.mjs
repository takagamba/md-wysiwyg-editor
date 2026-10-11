// Vditor の同梱アセット（ビルド済みファイル）に組み込まれている依存ライブラリのライセンスを集め、
// scripts/licenses/asset-deps.json に書き出す: node scripts/collect-asset-licenses.mjs
//
// 同梱アセットはライセンス情報を持たないため、同じバージョンのパッケージを一時フォルダに npm install し、
// 実行時の依存ツリー（dependencies）をたどってライセンスファイルを集める。
// CLI 専用など、配布ファイルに含まれないと確認したパッケージは EXCLUDE で除外する（その先の依存も除外される）。
// 判断に迷うものは除外しない（余分に載せても問題はないが、載せ漏れは問題になる）。
// ネットワークが必要。Vditor を更新したら ASSETS のバージョンを確認し直して実行し、その後 npm run notices を実行する。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUTPUT = 'scripts/licenses/asset-deps.json';

/** Node.js の CLI 用で、ブラウザ向けの配布ファイルには含まれないもの */
const NODE_ONLY = [
  'commander', 'iconv-lite', 'safer-buffer', 'rw',
  'yargs', 'yargs-parser', 'cliui', 'y18n', 'string-width', 'strip-ansi', 'ansi-regex', 'wrap-ansi', 'ansi-styles',
  'color-convert', 'color-name', 'emoji-regex', 'is-fullwidth-code-point', 'get-caller-file', 'require-directory', 'escalade',
  'fs-extra', 'graceful-fs', 'jsonfile', 'universalify',
];

/**
 * キーは third-party-notices.mjs の VDITOR_ASSETS の deps と対応する。
 * packages は同梱ファイルの元になったパッケージ（自身は notices 側に記載済みなので、その依存だけを集める）
 */
const ASSETS = {
  mermaid: {
    packages: ['mermaid@11.16.1'],
    // mermaid.min.js に含まれないことを確認済み（@iconify/utils の Node 用ローダーの依存）
    exclude: ['@antfu/install-pkg', 'package-manager-detector', 'tinyexec', 'import-meta-resolve'],
  },
  echarts: { packages: ['echarts@5.6.0'] },
  flowchart: { packages: ['flowchart.js@1.14.1'] },
  markmap: {
    packages: ['markmap-lib@0.14.3', 'markmap-view@0.14.3', 'markmap-common@0.14.2'],
    // markmap.min.js に含まれないことを確認済み（remarkable / js-yaml の CLI・オプション機能の依存）
    exclude: ['argparse', 'sprintf-js', 'autolinker'],
  },
  smilesDrawer: { packages: ['smiles-drawer@2.1.7'] },
  wavedrom: { packages: ['wavedrom@3.6.2'] },
};

/** package.json にライセンスの記載がないもの（ライセンスファイルの内容で確認済み） */
const LICENSE_OVERRIDES = { 'eve-raphael': 'Apache-2.0', khroma: 'MIT' };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'md-wysiwyg-asset-licenses-'));
fs.writeFileSync(path.join(work, 'package.json'), '{"name":"asset-licenses","private":true}');
const all = Object.values(ASSETS).flatMap((a) => a.packages);
console.log(`npm install（${work}）: ${all.join(' ')}`);
execSync(`npm install --ignore-scripts --no-audit --no-fund --omit=dev ${all.join(' ')}`, { cwd: work, stdio: 'inherit', shell: true });

const resolve = (from, name) => {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const p = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
    if (path.dirname(dir) === dir) return undefined;
  }
};

const result = {};
for (const [key, asset] of Object.entries(ASSETS)) {
  const roots = new Set(asset.packages.map((p) => p.slice(0, p.lastIndexOf('@'))));
  const exclude = new Set([...NODE_ONLY, ...(asset.exclude ?? [])]);
  const found = new Map();
  const visit = (from, name) => {
    if (exclude.has(name) || name.startsWith('@types/')) return;
    const dir = resolve(from, name);
    if (!dir) throw new Error(`${key}: ${name} が見つかりません`);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const id = `${pkg.name}@${pkg.version}`;
    if (found.has(id)) return;
    if (!roots.has(pkg.name)) {
      const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
      if (!file) throw new Error(`${id}: ライセンスファイルがありません`);
      const license = LICENSE_OVERRIDES[pkg.name] ?? (typeof pkg.license === 'string' ? pkg.license : undefined);
      if (!license) throw new Error(`${id}: package.json にライセンスの記載がありません。LICENSE_OVERRIDES に追加してください`);
      found.set(id, {
        name: pkg.name,
        version: pkg.version,
        license,
        text: fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim(),
      });
    } else {
      found.set(id, null);
    }
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dir, dep);
  };
  for (const name of roots) visit(work, name);
  result[key] = [...found.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  console.log(`${key}: ${result[key].length} 件`);
}

fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
fs.rmSync(work, { recursive: true, force: true });
console.log(`${OUTPUT} を書き出しました`);
