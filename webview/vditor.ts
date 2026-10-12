import Vditor from 'vditor';
import 'vditor/dist/index.css';
import './base.css';
import './vditor.css';
import { bootstrap, isDarkTheme, onThemeChange, post, type EditorAdapter } from './common';

let vditor: Vditor;
let suppressed: string | undefined;

// ファイルを選んで相対パスのリンク・画像を挿入するボタン（ファイル選択は拡張ホストが行う）
const icon = (body: string) =>
  `<svg viewBox="0 0 16 16" style="fill: none; stroke-width: 1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const pickFileButtons: IMenuItem[] = [
  {
    name: 'insert-file-link',
    tip: 'ファイルへのリンクを挿入',
    tipPosition: 'n',
    icon: icon('<path d="M9 2H4v12h8V5z"/><path d="M9 2v3h3"/><path d="M6.5 10.5l3-3M7 8h2.5v2.5"/>'),
    click: () => post({ type: 'pickFile', kind: 'link' }),
  },
  {
    name: 'insert-image',
    tip: '画像を挿入',
    tipPosition: 'n',
    icon: icon('<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1"/><path d="M14 11l-3.5-3.5L4 13"/>'),
    click: () => post({ type: 'pickFile', kind: 'image' }),
  },
];

const themeArgs = (dark: boolean) => [dark ? 'dark' : 'classic', dark ? 'dark' : 'light', dark ? 'github-dark' : 'github'] as const;

const adapter: EditorAdapter = {
  init(root, options, emitEdit) {
    const dark = isDarkTheme();
    return new Promise<void>((resolve) => {
      vditor = new Vditor(root, {
        // lute / i18n / KaTeX / Mermaid 等を拡張に同梱したコピーから読み込む（オフラインで動作）
        cdn: options.vditorCdn,
        lang: 'ja_JP',
        mode: options.vditorMode,
        value: options.text,
        height: '100%',
        theme: dark ? 'dark' : 'classic',
        cache: { enable: false },
        counter: { enable: true },
        toolbarConfig: { pin: true },
        toolbar: [
          'headings', 'bold', 'italic', 'strike', 'link', ...pickFileButtons, '|',
          'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
          'quote', 'line', 'code', 'inline-code', 'table', '|',
          'undo', 'redo', '|',
          'edit-mode', 'outline', 'code-theme', 'content-theme',
        ],
        preview: {
          theme: { current: dark ? 'dark' : 'light' },
          hljs: { style: dark ? 'github-dark' : 'github', lineNumber: false },
          math: { engine: 'KaTeX' },
        },
        upload: {
          // 貼り付け・ドロップした画像は拡張ホストが文書のフォルダに保存する（Markdown に base64 で埋め込まない）
          accept: 'image/*',
          handler(files) {
            const images = files.filter((f) => f.type.startsWith('image/'));
            if (images.length > 0) {
              void Promise.all(
                images.map(async (f) => ({ name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) })),
              ).then((data) => post({ type: 'saveImages', files: data }));
            }
            return images.length < files.length
              ? '画像以外のファイルは、ツールバーの「ファイルへのリンクを挿入」から挿入してください'
              : null;
          },
        },
        input(value) {
          if (value === suppressed) return;
          suppressed = undefined;
          emitEdit(value);
        },
        after() {
          resolve();
        },
      });
      onThemeChange((d) => vditor.setTheme(...themeArgs(d)));
    });
  },

  update(markdown) {
    vditor.setValue(markdown, true);
    suppressed = vditor.getValue();
  },

  getValue() {
    return vditor.getValue();
  },

  insert(markdown) {
    vditor.insertValue(markdown);
  },

  setReadOnly(readOnly) {
    if (readOnly) vditor.disabled();
    else vditor.enable();
  },
};

bootstrap(adapter);
