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

/**
 * 貼り付け・ドロップした画像を保存するファイル名。
 * クリップボードの画像は名前が image.png などになるので、日時から名前を付ける
 */
export function imageFileName(name: string, mimeType: string, now: Date): string {
  // path.basename は Windows で「a:」をドライブとみなすので使わない（File.name にフォルダは含まれない）
  const rawExt = path.extname(name);
  const ext = rawExt.toLowerCase() || `.${MIME_EXTENSIONS[mimeType] ?? 'png'}`;
  let base = name
    .slice(0, name.length - rawExt.length)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim();
  if (!base || /^image$/i.test(base)) {
    const p = (n: number) => String(n).padStart(2, '0');
    base = `image-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  }
  return base + ext;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** 名前が重なるときに付ける連番（a.png → a-1.png） */
export function numberedFileName(name: string, n: number): string {
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)}-${n}${ext}`;
}

export const isImagePath = (filePath: string) => IMAGE_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase());
