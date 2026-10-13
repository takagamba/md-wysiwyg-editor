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
  /** カーソル位置に Markdown を挿入する */
  insert(markdown: string): void;
  /** 編集領域（見出しを探す範囲）。分割表示（sv）のように見出し要素がなければ undefined */
  contentElement(): HTMLElement | undefined;
  setReadOnly(readOnly: boolean): void;
}

const EDIT_DEBOUNCE_MS = 150;
/** キー入力から文書へ反映するまでの時間。Vditor の通知（800ms 後）を待たずに送る */
const QUICK_EDIT_MS = 200;

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
  /** 最後に文書へ送ったテキスト。同じ内容を何度も送らない */
  let lastSent: string | undefined;
  const resetBase = (original: string) => {
    baseValue = adapter.getValue();
    sentSinceBase = false;
    lastSent = undefined;
    restorer = preserveFormatting ? new FormatRestorer(original, baseValue) : undefined;
  };
  const toDocumentText = (markdown: string) => (restorer ? restorer.restore(markdown) : markdown);

  const postEdit = (text: string) => {
    if (text === lastSent) return;
    lastSent = text;
    post({ type: 'edit', text });
  };

  let timer: number | undefined;
  let quickTimer: number | undefined;
  let pending: string | undefined;
  const flush = () => {
    if (pending !== undefined) {
      sentSinceBase = true;
      postEdit(toDocumentText(pending));
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
    clearTimeout(quickTimer);
    timer = undefined;
    quickTimer = undefined;
    pending = undefined;
    if (!ready || readOnly) return null;
    const value = adapter.getValue();
    if (value === baseValue && !sentSinceBase) return null;
    sentSinceBase = true;
    return toDocumentText(value);
  };

  const sendCurrentText = () => {
    const text = takeCurrentText();
    if (text !== null) postEdit(text);
  };

  // 別のタブ・テキストエディタへ移る直前の入力を取りこぼさない
  window.addEventListener('blur', sendCurrentText);

  // Vditor の通知は最後の入力から 800ms 後なので、その間にタブを閉じると入力が失われる。
  // キー入力（DOM の input イベント）があれば短い間隔で直接読み取って送る。
  // IME の変換中は確定前の文字を送らないよう、確定（compositionend）を待つ
  const scheduleQuickEdit = () => {
    if (!ready || readOnly) return;
    clearTimeout(quickTimer);
    quickTimer = window.setTimeout(sendCurrentText, QUICK_EDIT_MS);
  };
  root.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing) scheduleQuickEdit();
  });
  root.addEventListener('compositionend', scheduleQuickEdit);

  // ドロップ: エディタ（Vditor）より先に受け取る。
  // Vditor はドロップした位置を使わないので、先にカーソルをそこへ移す（画像の保存結果もそこに挿入される）。
  // VS Code のエクスプローラーから（Shift を押して）ドロップしたファイルは、相対パスのリンク・画像にする
  root.addEventListener(
    'drop',
    (e) => {
      if (!ready || readOnly || !e.dataTransfer) return;
      const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (range) {
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      if (e.dataTransfer.types.includes('Files')) return;
      const uris = [e.dataTransfer.getData('application/vnd.code.uri-list'), e.dataTransfer.getData('text/uri-list')]
        .join('\n')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s, i, all) => /^(file|vscode-remote):/i.test(s) && all.indexOf(s) === i);
      if (uris.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      post({ type: 'linkFiles', uris });
    },
    true,
  );

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
          clearTimeout(quickTimer);
          pending = undefined;
          adapter.update(message.text);
          resetBase(message.text);
          break;
        case 'setReadOnly':
          sendCurrentText();
          applyReadOnly(message.readOnly);
          break;
        case 'revealHeading':
          revealHeading(adapter, message.index, message.text);
          break;
        case 'insert':
          if (readOnly) break;
          adapter.insert(message.text);
          scheduleQuickEdit();
          break;
        case 'flush': {
          // 保存の直前に拡張ホストから呼ばれる。返した内容はホストが文書に反映する
          const text = takeCurrentText();
          if (text !== null) lastSent = text;
          post({ type: 'flushed', id: message.id, text });
          break;
        }
      }
    } catch (e) {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });

  installLinkHandler(() => readOnly);
  post({ type: 'ready' });
}

/** 見出しの表示上の文字（IR モードで表示される ## などの記号を除く） */
const headingText = (el: Element) => {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('.vditor-ir__marker').forEach((m) => m.remove());
  return (clone.textContent ?? '').trim();
};

/**
 * 見出しまでスクロールし、見出しの末尾にカーソルを置く。
 * index 番目の見出しの文字が一致しなければ（数え方が拡張側とずれた場合）、同じ文字の見出しを探す
 */
function revealHeading(adapter: EditorAdapter, index: number, text: string): void {
  const content = adapter.contentElement();
  if (!content) return;
  const headings = [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  let target = headings[index];
  if (!target || headingText(target) !== text) target = headings.find((h) => headingText(h) === text) ?? target;
  if (!target) return;
  target.scrollIntoView({ block: 'start' });
  if (content.isContentEditable) {
    content.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
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
