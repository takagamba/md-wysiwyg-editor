// webview/restoreFormat.ts（編集していない行を元の書き方に戻す処理）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedLines, importTs, random, readText, vditorEngine } from './helpers.mjs';

const { FormatRestorer, diffLines, fixVditorStyle } = await importTs('webview/restoreFormat.ts');
const { roundTrip, html } = vditorEngine();

const FIXTURES = {
  'test/fixtures/basic.md': readText('test/fixtures/basic.md'),
  'test/fixtures/styles.md': readText('test/fixtures/styles.md'),
};

for (const [name, original] of Object.entries(FIXTURES)) {
  test(`${name}: 編集していなければ元の文書と完全に一致する`, () => {
    const normalized = roundTrip(original);
    assert.notEqual(normalized, original, '前提: Vditor は書き方を変える');
    assert.equal(new FormatRestorer(original, normalized).restore(normalized), original);
  });

  test(`${name}: 1 行編集すると、その行だけが変わる`, () => {
    const lines = original.split('\n');
    const target = lines.findIndex((l) => /^(このファイル|Escaped)/.test(l));
    lines[target] += ' 追記';
    const edited = lines.join('\n');
    const restorer = new FormatRestorer(original, roundTrip(original));
    assert.equal(restorer.restore(roundTrip(edited)), edited);
  });

  test(`${name}: 末尾に追加したタスクは [x] の形になる`, () => {
    const restorer = new FormatRestorer(original, roundTrip(original));
    const result = restorer.restore(roundTrip(original + '\n- [x] 新しいタスク\n'));
    assert.deepEqual(changedLines(original, result).added.filter((l) => l !== ''), ['- [x] 新しいタスク']);
  });
}

test('表を編集すると表全体が Vditor の書き方になり、表の前に空行は増えない', () => {
  const original = FIXTURES['test/fixtures/basic.md'];
  const restorer = new FormatRestorer(original, roundTrip(original));
  const result = restorer.restore(roundTrip(original.replace('| 数式 | KaTeX | インライン / ブロック |', '| 数式 | KaTeX | 変更 |')));
  const { removed, added } = changedLines(original, result);
  assert.equal(removed.length, 4, '表の 4 行が置き換わる');
  assert.equal(added.length, 4);
  assert.ok(added.every((l) => l.startsWith('|')), `表の行だけが変わる: ${JSON.stringify(added)}`);
  assert.match(added.at(-1), /\| 変更 +\|$/);
});

test('ランダムな編集でも、復元結果は Vditor の現在の内容と同じ HTML になる', () => {
  const original = FIXTURES['test/fixtures/basic.md'];
  const normalized = roundTrip(original);
  const restorer = new FormatRestorer(original, normalized);
  const snippets = ['追記テキスト', '- [ ] 新タスク', '| x | y | z |', '', '# 見出し', '> 引用', '**太字**'];
  let checked = 0;
  for (const seed of [7, 11, 23, 99]) {
    const rnd = random(seed);
    for (let i = 0; i < 200; i++) {
      const lines = normalized.split('\n');
      for (let e = 0; e < 1 + rnd(3); e++) {
        const at = rnd(lines.length);
        const kind = rnd(3);
        if (kind === 0) lines[at] += snippets[rnd(snippets.length)];
        else if (kind === 1) lines.splice(at, 1);
        else lines.splice(at, 0, snippets[rnd(snippets.length)]);
      }
      let current;
      let expected;
      try {
        current = roundTrip(lines.join('\n'));
        expected = html(current);
      } catch {
        continue; // Lute 自体が panic する入力（Vditor の不具合）は対象外
      }
      const restored = restorer.restore(current);
      assert.equal(html(restored), expected, `seed=${seed} i=${i}\n--- current\n${current}\n--- restored\n${restored}`);
      checked++;
    }
  }
  assert.ok(checked > 700, `検証できた件数: ${checked}`);
});

test('数千行の文書でも十分に速い', () => {
  const original = Array.from({ length: 90 }, () => FIXTURES['test/fixtures/basic.md']).join('\n');
  const normalized = roundTrip(original);
  const t0 = performance.now();
  const restorer = new FormatRestorer(original, normalized);
  const lines = normalized.split('\n');
  lines[Math.floor(lines.length / 2)] += ' x';
  const result = restorer.restore(lines.join('\n'));
  const elapsed = performance.now() - t0;
  assert.equal(changedLines(original, result).added.length, 1);
  assert.ok(elapsed < 1000, `${original.split('\n').length} 行で ${elapsed.toFixed(0)}ms`);
});

test('fixVditorStyle: Vditor のタスク記法を一般的な形に直す', () => {
  assert.equal(fixVditorStyle('- [X]  完了'), '- [x] 完了');
  assert.equal(fixVditorStyle('- [ ]  未完了'), '- [ ] 未完了');
  assert.equal(fixVditorStyle('  * [x]  ネスト'), '  * [x] ネスト');
  assert.equal(fixVditorStyle('1. [X]  番号付き'), '1. [x] 番号付き');
  assert.equal(fixVditorStyle('   '), '');
  assert.equal(fixVditorStyle('[X]  リストではない'), '[X]  リストではない');
});

test('diffLines: 一致・削除・追加の区間を返す', () => {
  const hunks = diffLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
  assert.deepEqual(
    hunks.map((h) => [h.equal, h.aEnd - h.aStart, h.bEnd - h.bStart]),
    [
      [true, 1, 1],
      [false, 1, 1],
      [true, 2, 2],
      [false, 0, 1],
    ],
  );
  assert.deepEqual(diffLines([], []), []);
});
