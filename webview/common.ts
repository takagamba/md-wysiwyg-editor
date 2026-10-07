import type { HostToWebview, InitOptions, WebviewToHost } from './protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscodeApi = acquireVsCodeApi();

export const post = (message: WebviewToHost) => vscodeApi.postMessage(message);

/** 各エディタ実装（Milkdown / Vditor）が満たすインターフェース */
export interface EditorAdapter {
  init(root: HTMLElement, options: InitOptions, emitEdit: (markdown: string) => void): Promise<void>;
  /** 外部（テキストエディタ・Git 等）での変更を反映する */
  update(markdown: string): void;
  setReadOnly(readOnly: boolean): void;
}

const EDIT_DEBOUNCE_MS = 150;

export function bootstrap(adapter: EditorAdapter): void {
  const root = document.getElementById('editor')!;
  const badge = document.getElementById('readonly-badge')!;
  let readOnly = false;
  let initialized: Promise<void> | undefined;

  let timer: number | undefined;
  let pending: string | undefined;
  const flush = () => {
    if (pending !== undefined) post({ type: 'edit', text: pending });
    pending = undefined;
    timer = undefined;
  };
  const emitEdit = (markdown: string) => {
    if (readOnly) return;
    pending = markdown;
    clearTimeout(timer);
    timer = window.setTimeout(flush, EDIT_DEBOUNCE_MS);
  };
  // タブを閉じる・切り替える直前の入力を取りこぼさない
  window.addEventListener('blur', flush);

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
        initialized = adapter.init(root, message.options, emitEdit);
        await initialized;
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
          break;
        case 'setReadOnly':
          flush();
          applyReadOnly(message.readOnly);
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
