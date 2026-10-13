// 見出しビューに表示する見出しの解析（src/headings.ts）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, readText } from './helpers.mjs';

const { parseHeadings } = await importTs('src/headings.ts');
/** 階層を [レベル, 文字, 子] の形にして比べやすくする */
const shape = (hs) => hs.map((h) => [h.level, h.text, ...(h.children.length ? [shape(h.children)] : [])]);
const flat = (hs) => hs.flatMap((h) => [h, ...flat(h.children)]);

test('見出しを階層にし、文書の先頭からの順番を付ける', () => {
  const hs = parseHeadings('# A\n\n## B\n\n### C\n\n## D\n\n# E\n');
  assert.deepEqual(shape(hs), [[1, 'A', [[2, 'B', [[3, 'C']]], [2, 'D']]], [1, 'E']]);
  assert.deepEqual(flat(hs).map((h) => [h.index, h.line]), [[0, 0], [1, 2], [2, 4], [3, 6], [4, 8]]);
});

test('レベルが飛んでも、直前の浅い見出しの子にする', () => {
  assert.deepEqual(shape(parseHeadings('## A\n#### B\n# C\n### D\n')), [[2, 'A', [[4, 'B']]], [1, 'C', [[3, 'D']]]]);
});

test('コードブロック内の # は見出しにしない。下線形式の見出しは見出しにする', () => {
  const text = '# A\n\n```sh\n# comment\n```\n\n    # indented code\n\nB\n===\n\nC\n---\n';
  assert.deepEqual(shape(parseHeadings(text)), [[1, 'A'], [1, 'B', [[2, 'C']]]]);
});

test('見出しの文字は書式の記号を除く。front matter は見出しにしない', () => {
  const text = '---\ntitle: x\n---\n# **太字** と `code` と [リンク](a.md)\n';
  const hs = parseHeadings(text);
  assert.deepEqual(shape(hs), [[1, '太字 と code と リンク']]);
  assert.equal(hs[0].line, 3);
});

test('サンプル文書の見出し', () => {
  const hs = flat(parseHeadings(readText('test/fixtures/basic.md')));
  assert.ok(hs.length >= 5);
  assert.ok(hs.some((h) => h.text === 'Mermaid'));
});
