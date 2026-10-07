// 拡張ホスト ⇔ Webview 間のメッセージ定義（両側から import する）

export type Engine = 'milkdown' | 'vditor';

export interface InitOptions {
  text: string;
  readOnly: boolean;
  /** Vditor 専用: 同梱アセットのベース URL */
  vditorCdn?: string;
  vditorMode?: 'ir' | 'wysiwyg' | 'sv';
}

export type HostToWebview =
  | { type: 'init'; options: InitOptions }
  | { type: 'update'; text: string }
  | { type: 'setReadOnly'; readOnly: boolean };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'openLink'; href: string }
  | { type: 'error'; message: string };
