import Vditor from 'vditor';
import 'vditor/dist/index.css';
import './base.css';
import './vditor.css';
import { bootstrap, isDarkTheme, onThemeChange, type EditorAdapter } from './common';

let vditor: Vditor;
let suppressed: string | undefined;

const themeArgs = (dark: boolean) => [dark ? 'dark' : 'classic', dark ? 'dark' : 'light', dark ? 'github-dark' : 'github'] as const;

const adapter: EditorAdapter = {
  init(root, options, emitEdit) {
    const dark = isDarkTheme();
    return new Promise<void>((resolve) => {
      vditor = new Vditor(root, {
        // lute / i18n / KaTeX / Mermaid 等を拡張に同梱したコピーから読み込む（オフラインで動作）
        cdn: options.vditorCdn,
        lang: 'ja_JP',
        mode: options.vditorMode ?? 'ir',
        value: options.text,
        height: '100%',
        theme: dark ? 'dark' : 'classic',
        cache: { enable: false },
        counter: { enable: true },
        toolbarConfig: { pin: true },
        toolbar: [
          'headings', 'bold', 'italic', 'strike', 'link', '|',
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

  setReadOnly(readOnly) {
    if (readOnly) vditor.disabled();
    else vditor.enable();
  },
};

bootstrap(adapter);
