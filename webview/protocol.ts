// 拡張ホスト ⇔ Webview 間のメッセージ定義（両側から import する）

export interface InitOptions {
  text: string;
  readOnly: boolean;
  /** 同梱した Vditor アセットのベース URL */
  vditorCdn: string;
  vditorMode: 'ir' | 'wysiwyg' | 'sv';
  /** 編集していない部分を元の書き方のまま保存する */
  preserveFormatting: boolean;
}

export type HostToWebview =
  | { type: 'init'; options: InitOptions }
  | { type: 'update'; text: string }
  | { type: 'setReadOnly'; readOnly: boolean }
  /** 保存の直前に、エディタの最新の内容を求める */
  | { type: 'flush'; id: number }
  /** カーソル位置に Markdown を挿入する（ファイル選択の結果） */
  | { type: 'insert'; text: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  /** flush への応答。変更がなければ text は null */
  | { type: 'flushed'; id: number; text: string | null }
  | { type: 'openLink'; href: string }
  /** ファイルを選んでリンク・画像を挿入する（ツールバーのボタン） */
  | { type: 'pickFile'; kind: 'link' | 'image' }
  /** 貼り付け・ドロップした画像を文書のフォルダに保存して挿入する */
  | { type: 'saveImages'; files: { name: string; type: string; data: Uint8Array }[] }
  /** VS Code のエクスプローラーからドロップしたファイルへのリンク・画像を挿入する */
  | { type: 'linkFiles'; uris: string[] }
  | { type: 'error'; message: string };
