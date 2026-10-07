# CLAUDE.md

VS Code 拡張。`.md` を同じタブ内の Webview で WYSIWYG 編集する（Custom Text Editor）。
エディタは **Vditor**（以前は Milkdown も同梱していたが一本化した）。閲覧モードと PDF 出力を持つ。
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

- `src/extension.ts` — コマンド登録、カスタムエディタ登録、既定エディタ設定
- `src/markdownEditorProvider.ts` — `EditorSession`（1 タブ = 1 セッション）。Webview HTML/CSP 生成、文書との同期、閲覧モード、リンクを開く処理
- `src/pdfExport.ts` — markdown-it で HTML 化 → 一時ファイル（file://）→ puppeteer-core でローカルの Edge/Chrome を起動して PDF 化
- `src/markdownItPlugins.ts` — PDF 用の数式（`$`/`$$`）とタスクリストのプラグイン
- `webview/protocol.ts` — ホスト⇔Webview のメッセージ型（両側から import）
- `webview/common.ts` — `EditorAdapter` インターフェースと `bootstrap()`（メッセージ処理、edit のデバウンス、閲覧モード、リンクのクリック処理）
- `webview/vditor.ts` — Vditor のアダプタ（`EditorAdapter` の実装）。別のエンジンを試す場合も `EditorAdapter` を実装する
- `webview/restoreFormat.ts` — 編集していない行を元の書き方に戻す（`FormatRestorer`）。Webview 側で edit を送る直前に適用する
- `esbuild.mjs` — 拡張（node/cjs、`.css` は文字列として読む）と Webview（browser/iife）の 2 ビルド

## 設計上の決まりごと

- **正のデータは常に `vscode.TextDocument`**。Webview は表示と編集の UI に過ぎない。保存・Undo・dirty 表示は VS Code に任せる
- Webview とやり取りするテキストは常に **LF**。文書が CRLF のときは `applyToDocument` で変換する。比較も LF 同士で行う（揃えないとエコーバックしてカーソルが飛ぶ）
- **エコーバック防止**: ホスト側は `webviewText` と一致する変更を Webview に送り返さない。Webview 側は外部 update を流し込んだ直後のシリアライズ結果を `suppressed` に保持し、同じ内容の通知は edit として送らない
- 文書への反映は前方一致・後方一致で差分範囲を求め、その範囲だけを置換する（全文置換にしない）
- 閲覧モードでは、ホスト側でも Webview からの edit を無視する（二重のガード）
- **書き方の復元**: 「読み込んだ文書（original）」「それを Vditor が書き出したもの（normalized）」「現在の出力（current）」を行 diff で比べ、normalized から変わっていない行は original の行を使う。基準（original / normalized）は init と外部 update のたびに作り直す。表は 1 まとまり扱い、Vditor が足した空行は隣に行が追加されたら残す（消すと追加行がリストや引用に吸い込まれる）
- CSP は nonce 方式。`'unsafe-inline'` のスクリプトは許可しない

## 落とし穴（実際に踏んだもの）

- **Vditor の書き出しは冪等でない**（同じ文書を 2 回往復させると結果が変わる）。往復結果の比較で検証する場合は、Markdown 同士ではなく `lute.Md2HTML` の結果（空白を正規化）を比べる
- Vditor の `input` コールバックは最後の入力から `undoDelay`（800ms）後に呼ばれる。さらに common.ts で 150ms デバウンスしている
  → 入力直後の保存で最後の入力が漏れないよう、保存前（`onWillSaveTextDocument`）にホストが `flush` を送り、Webview は `getValue()` で直接読んだ内容を `flushed` で返す。ホストはそれを `waitUntil` の TextEdit として保存に含める（応答がなければ 1 秒で諦めてそのまま保存）。blur・閲覧モード切替時も同様に直接読む
- Lute（Vditor の Markdown エンジン）は一部の入力で panic する（Vditor 自身の出力でも起きる）
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
- **書き方の復元**: `node_modules/vditor/dist/js/lute/lute.min.js` は `globalThis.window = globalThis` にしてから require すれば Node で動く。`lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(md))` が Vditor の往復とほぼ同じ。esbuild で `restoreFormat.ts` を cjs にして、(1) 未編集なら original と完全一致、(2) ランダム編集で復元結果と current の `Md2HTML` が一致、を確認する
