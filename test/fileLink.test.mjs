// ファイル選択で挿入するリンク・画像の Markdown（src/fileLink.ts）のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { importTs } from './helpers.mjs';

const { imageFileName, isImagePath, markdownForFile, numberedFileName } = await importTs('src/fileLink.ts');
const root = path.join(os.tmpdir(), 'ws');
const doc = path.join(root, 'docs', 'readme.md');

test('文書のフォルダからの相対パスで、区切りは /', () => {
  assert.equal(markdownForFile(doc, path.join(root, 'docs', 'images', 'a.png'), 'image'), '![a](images/a.png)');
  assert.equal(markdownForFile(doc, path.join(root, 'other', 'guide.md'), 'link'), '[guide](../other/guide.md)');
  assert.equal(markdownForFile(doc, path.join(root, 'docs', '設計書.md'), 'link'), '[設計書](設計書.md)');
});

test('空白・括弧・% は符号化し、表示名の [ ] はエスケープする', () => {
  assert.equal(
    markdownForFile(doc, path.join(root, 'docs', 'my file (1) 50%.png'), 'image'),
    '![my file (1) 50%](my%20file%20%281%29%2050%25.png)',
  );
  assert.equal(markdownForFile(doc, path.join(root, 'docs', 'a[b].md'), 'link'), '[a\\[b\\]](a[b].md)');
});

test('相対パスにできなければ file: URL', () => {
  const file = path.join(root, 'docs', 'a.png');
  assert.match(markdownForFile(undefined, file, 'image'), /^!\[a\]\(file:\/\/.*\/docs\/a\.png\)$/);
  if (process.platform === 'win32') {
    assert.equal(markdownForFile('C:\\docs\\readme.md', 'D:\\img\\b.png', 'image'), '![b](file:///D:/img/b.png)');
  }
});

test('貼り付けた画像の保存名: クリップボードの image.png は日時から名前を付け、それ以外は元の名前', () => {
  const now = new Date(2026, 9, 12, 9, 5, 3);
  assert.equal(imageFileName('image.png', 'image/png', now), 'image-20261012-090503.png');
  assert.equal(imageFileName('', 'image/jpeg', now), 'image-20261012-090503.jpg');
  assert.equal(imageFileName('構成図.PNG', 'image/png', now), '構成図.png');
  assert.equal(imageFileName('a:b?.gif', 'image/gif', now), 'a_b_.gif');
});

test('名前が重なるときの連番と、画像の判定', () => {
  assert.equal(numberedFileName('a.png', 2), 'a-2.png');
  assert.equal(numberedFileName('noext', 1), 'noext-1');
  assert.equal(isImagePath('x/y.JPG'), true);
  assert.equal(isImagePath('x/y.md'), false);
});
