// テスト共通の処理
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** LF に揃えて読む */
export const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** TypeScript のモジュールを esbuild で一時ファイルにバンドルして import する */
export async function importTs(rel) {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdw-test-'));
  const outfile = path.join(outdir, path.basename(rel).replace(/\.ts$/, '.mjs'));
  await esbuild.build({ entryPoints: [path.join(ROOT, rel)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

let lute;
/**
 * Vditor の Markdown エンジン Lute を Node で動かす（Vditor と同じオプション）。
 * roundTrip は Vditor に読み込ませて書き出したときとほぼ同じ結果になる。
 * Vditor の書き出しは冪等でないため、比較には html（空白を正規化した HTML）を使う
 */
export function vditorEngine() {
  if (!lute) {
    globalThis.window ??= globalThis;
    createRequire(import.meta.url)(path.join(ROOT, 'node_modules/vditor/dist/js/lute/lute.min.js'));
    lute = globalThis.Lute.New();
    lute.SetCallout(true);
    lute.SetGFMAutoLink(true);
    lute.SetFootnotes(true);
    lute.SetSanitize(true);
    lute.SetVditorCodeBlockPreview(true);
    lute.SetVditorMathBlockPreview(true);
    lute.SetHeadingAnchor(false);
    lute.SetAutoSpace(false);
    lute.SetFixTermTypo(false);
  }
  return {
    roundTrip: (md) => lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(md)).replace(/ /g, ' '),
    html: (md) => lute.Md2HTML(md).replace(/\s+/g, ' ').replace(/> </g, '><'),
  };
}

/** 再現可能な乱数（線形合同法） */
export function random(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
}

/** 行単位の差分のうち、変わった部分（前後の一致を除いた範囲）を返す */
export function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { removed: a.slice(start, a.length - end), added: b.slice(start, b.length - end) };
}
