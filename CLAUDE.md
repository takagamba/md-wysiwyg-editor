# CLAUDE.md

VS Code 拡張。`.md` を同じタブ内の Webview で WYSIWYG 編集する（Custom Text Editor）。
エディタは **Milkdown（Crepe）** と **Vditor** の 2 エンジンを同梱し、閲覧モードと PDF 出力を持つ。
ユーザー向けの説明・設定一覧は README.md。コメントと UI 文言は日本語。

## コマンド

```bash
npm run build       # esbuild で out/ に拡張・Webview をビルドし、Vditor アセットをコピー
npm run watch
npm run typecheck   # tsc --noEmit（esbuild は型チェックしないので変更後は必ず実行）
npm run package     # .vsix を生成（vscode:prepublish で --production ビルド）
```

デバッグ実行は VS Code で F5（`.vscode/launch.json`、`sample/` を開いた Extension Host が起動）。

## 構成

- `src/extension.ts` — コマンド登録、2 つのカスタムエディタ登録、既定エディタ設定
- `src/markdownEditorProvider.ts` — `EditorSession`（1 タブ = 1 セッション）。Webview HTML/CSP 生成、文書との同期、閲覧モード、リンクを開く処理
- `src/pdfExport.ts` — markdown-it で HTML 化 → 一時ファイル（file://）→ puppeteer-core でローカルの Edge/Chrome を起動して PDF 化
- `src/markdownItPlugins.ts` — PDF 用の数式（`$`/`$$`）とタスクリストのプラグイン
- `webview/protocol.ts` — ホスト⇔Webview のメッセージ型（両側から import）
- `webview/common.ts` — `EditorAdapter` インターフェースと `bootstrap()`（メッセージ処理、edit のデバウンス、閲覧モード、リンクのクリック処理）
- `webview/milkdown.ts` / `webview/vditor.ts` — 各エンジンのアダプタ。新しいエンジンを足す場合も `EditorAdapter` を実装する
- `esbuild.mjs` — 拡張（node/cjs、`.css` は文字列として読む）と Webview（browser/iife）の 2 ビルド

## 設計上の決まりごと

- **正のデータは常に `vscode.TextDocument`**。Webview は表示と編集の UI に過ぎない。保存・Undo・dirty 表示は VS Code に任せる
- Webview とやり取りするテキストは常に **LF**。文書が CRLF のときは `applyToDocument` で変換する。比較も LF 同士で行う（揃えないとエコーバックしてカーソルが飛ぶ）
- **エコーバック防止**: ホスト側は `webviewText` と一致する変更を Webview に送り返さない。Webview 側は外部 update を流し込んだ直後のシリアライズ結果を `suppressed` に保持し、同じ内容の通知は edit として送らない
- 文書への反映は前方一致・後方一致で差分範囲を求め、その範囲だけを置換する（全文置換にしない）
- 閲覧モードでは、ホスト側でも Webview からの edit を無視する（二重のガード）
- CSP は nonce 方式。`'unsafe-inline'` のスクリプトは許可しない

## 落とし穴（実際に踏んだもの）

- **Milkdown が操作なしに文書を更新する** → 開いただけで dirty になる。ユーザー入力（keydown/pointerdown 等）があるまで edit を送らない
- **Crepe の ImageBlock 機能は alt を表示倍率（`1.00`）で上書きする** → 無効化済み。再度有効にしないこと
- **Milkdown はタイトルなし画像の title が null になり、スキーマ検証で画像が消える** → `remarkImageTitleFix` で空文字に補正している
- **Vditor はアイコン JS を同期 XHR + インライン script で読み込む** → CSP で止められる。HTML 側で `id="vditorIconScript"` を nonce 付きで先に読み込んで回避している
- Vditor は lute・i18n・KaTeX・Mermaid などを `cdn` オプションの URL から実行時に読み込む。外部 CDN は使わず、`out/vditor/dist` に同梱したコピーを `asWebviewUri` で指定する
- Vditor 4 の hljs テーマに `native` は存在しない（存在しない名前は黙って `github` になる）。`dist/js/highlight.js/styles/` にある名前を使う
- 相対パスの画像は `<base href>` を文書のフォルダの webview URI にすることで解決している。`localResourceRoots` に文書のフォルダとワークスペースを含める必要がある
- `markdown-it` 15 は型を同梱している（`@types/markdown-it` は入れない）。型は `import type { MarkdownIt, StateBlock, ... } from 'markdown-it'`
- Webview から PDF 出力や印刷はできない。PDF は必ず拡張ホスト側で作る

## 検証方法

リポジトリに自動テストはまだない。変更後は次の観点で確認する。

- **Webview**: `out/webview/*.js` をローカル HTTP サーバーから配信し、`acquireVsCodeApi` をモックした HTML を本番と同じ CSP で puppeteer-core（Edge）から開く。`init`/`update`/`setReadOnly` を `postMessage` で送り、送信された `edit`/`openLink` を検査する。CSP 違反とコンソールエラーも確認する
- **拡張本体**: `@vscode/test-electron` に、インストール済みの `Code.exe` を `vscodeExecutablePath` で渡し、`--user-data-dir` を分けて起動する。`vscode.openWith` で開いてタブ種別、dirty にならないこと、コマンドの動作を確認する
- **PDF**: `vscode` を esbuild の `--alias` でモックして `exportPdf` を実行し、出力された PDF を確認する
- 往復変換で書式が変わること（表の整形、Vditor の `[X]` など）は既知の仕様。README の比較表に記載している
