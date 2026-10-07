import type { HostToWebview, InitOptions, WebviewToHost } from './protocol';
import { FormatRestorer } from './restoreFormat';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscodeApi = acquireVsCodeApi();

export const post = (message: WebviewToHost) => vscodeApi.postMessage(message);

/** エディタ実装が満たすインターフェース（現在は Vditor のみ） */
export interface EditorAdapter {
  init(root: HTMLElement, options: InitOptions, emitEdit: (markdown: string) => void): Promise<void>;
  /** 外部（テキストエディタ・Git 等）での変更を反映する */
  update(markdown: string): void;
  /** エディタが現在の内容を書き出した Markdown */
  getValue(): string;
  setReadOnly(readOnly: boolean): void;
}

const EDIT_DEBOUNCE_MS = 150;

export function bootstrap(adapter: EditorAdapter): void {
  const root = document.getElementById('editor')!;
  const badge = document.getElementById('readonly-badge')!;
  let readOnly = false;
  let initialized: Promise<void> | undefined;
  let ready = false;
  // 読み込んだ文書と、それをエディタが書き出した結果の組。編集していない部分を元の書き方に戻すのに使う
  let restorer: FormatRestorer | undefined;
  let preserveFormatting = true;
  /** 読み込み直後にエディタが書き出した Markdown */
  let baseValue = '';
  /** 読み込み後に edit を送ったか */
  let sentSinceBase = false;
  const resetBase = (original: string) => {
    baseValue = adapter.getValue();
    sentSinceBase = false;
    restorer = preserveFormatting ? new FormatRestorer(original, baseValue) : undefined;
  };
  const toDocumentText = (markdown: string) => (restorer ? restorer.restore(markdown) : markdown);

  let timer: number | undefined;
  let pending: string | undefined;
  const flush = () => {
    if (pending !== undefined) {
      sentSinceBase = true;
      post({ type: 'edit', text: toDocumentText(pending) });
    }
    pending = undefined;
    timer = undefined;
  };
  const emitEdit = (markdown: string) => {
    if (readOnly) return;
    pending = markdown;
    clearTimeout(timer);
    timer = window.setTimeout(flush, EDIT_DEBOUNCE_MS);
  };

  /**
   * エディタの通知を待たずに、今の内容を文書に書き込む形で返す。変更がなければ null。
   * Vditor は最後の入力から 800ms（undoDelay）経つまで input を通知しないため、
   * 保存や切り替えの直前はこれで直接読み取る
   */
  const takeCurrentText = (): string | null => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
    if (!ready || readOnly) return null;
    const value = adapter.getValue();
    if (value === baseValue && !sentSinceBase) return null;
    sentSinceBase = true;
    return toDocumentText(value);
  };

  // 別のタブ・テキストエディタへ移る直前の入力を取りこぼさない
  window.addEventListener('blur', () => {
    const text = takeCurrentText();
    if (text !== null) post({ type: 'edit', text });
  });

  const applyReadOnly = (value: boolean) => {
    readOnly = value;
    badge.hidden = !value;
    document.body.classList.toggle('is-readonly', value);
    adapter.setReadOnly(value);
  };

  window.addEventListener('message', async (event: MessageEvent<HostToWebview>) => {
    const message = event.data;
    try {
      if (message.type === 'init') {
        readOnly = message.options.readOnly;
        preserveFormatting = message.options.preserveFormatting;
        initialized = adapter.init(root, message.options, emitEdit);
        await initialized;
        resetBase(message.options.text);
        ready = true;
        applyReadOnly(message.options.readOnly);
        return;
      }
      await initialized;
      switch (message.type) {
        case 'update':
          // 外部変更が来たら、送信待ちの古い編集は捨てる
          clearTimeout(timer);
          pending = undefined;
          adapter.update(message.text);
          resetBase(message.text);
          break;
        case 'setReadOnly': {
          const text = takeCurrentText();
          if (text !== null) post({ type: 'edit', text });
          applyReadOnly(message.readOnly);
          break;
        }
        case 'flush':
          // 保存の直前に拡張ホストから呼ばれる
          post({ type: 'flushed', id: message.id, text: takeCurrentText() });
          break;
      }
    } catch (e) {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });

  installLinkHandler(() => readOnly);
  post({ type: 'ready' });
}

/**
 * リンクは Webview 内で遷移させず、拡張ホストに開かせる。
 * 編集モードでは Ctrl/Cmd + クリック、閲覧モードでは通常クリックで開く。
 */
function installLinkHandler(isReadOnly: () => boolean): void {
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest('a');
      // Vditor の即時レンダリング（IR）モードではリンクが span で表現される
      const irLink = target.closest<HTMLElement>('[data-type="a"]');
      const href =
        anchor?.getAttribute('href') ?? irLink?.querySelector('.vditor-ir__link ~ .vditor-ir__marker--link')?.textContent ?? null;
      if (anchor) e.preventDefault();
      if (!href) return;
      if (isReadOnly() || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        post({ type: 'openLink', href });
      }
    },
    true,
  );
}

export function isDarkTheme(): boolean {
  const c = document.body.classList;
  return c.contains('vscode-dark') || (c.contains('vscode-high-contrast') && !c.contains('vscode-high-contrast-light'));
}

/** VS Code のカラーテーマ変更（body の class が変わる）を監視する */
export function onThemeChange(callback: (dark: boolean) => void): void {
  let last = isDarkTheme();
  new MutationObserver(() => {
    const dark = isDarkTheme();
    if (dark !== last) callback((last = dark));
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
