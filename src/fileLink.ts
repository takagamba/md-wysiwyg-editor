import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 画像として挿入できる拡張子（ファイル選択ダイアログの絞り込みに使う） */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'];

/**
 * 選んだファイルへのリンク（kind が image なら画像）の Markdown を作る。
 * パスは文書のフォルダからの相対パス（区切りは /）。別のドライブなど相対パスにできなければ file: URL にする
 */
export function markdownForFile(documentPath: string | undefined, filePath: string, kind: 'link' | 'image'): string {
  const name = path.basename(filePath, path.extname(filePath));
  const text = name.replace(/[\\[\]]/g, '\\$&');
  return kind === 'image' ? `![${text}](${linkTarget(documentPath, filePath)})` : `[${text}](${linkTarget(documentPath, filePath)})`;
}

function linkTarget(documentPath: string | undefined, filePath: string): string {
  const relative = documentPath ? path.relative(path.dirname(documentPath), filePath) : '';
  if (!relative || path.isAbsolute(relative)) return pathToFileURL(filePath).href;
  // 空白や括弧があるとリンクとして解釈されないので符号化する（開くときは decodeURIComponent で戻す）
  return relative
    .split(path.sep)
    .join('/')
    .replace(/[%\s()<>]/g, (c) => encodeURIComponent(c).replace(/[()]/g, (p) => `%${p.charCodeAt(0).toString(16).toUpperCase()}`));
}
