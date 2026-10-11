# Markdown WYSIWYG Editor (Vditor)

`.md` ファイルを **タブを分割せずに**、レンダリングされた表示のまま編集できる VS Code 拡張です。
エディタには [Vditor](https://github.com/Vanessa219/vditor) を使っています。既定は Typora 風の「即時レンダリング（IR）」で、カーソルのある部分だけ Markdown 記号が見えます。

機能:

- 閲覧モード（読み取り専用）切替 — タイトルバーの 🔒 ボタン / `Ctrl+Alt+R`
- PDF 出力 — タイトルバーの PDF ボタン / エクスプローラーの右クリック
- 正のデータは VS Code の TextDocument なので、保存・未保存マーク・Git 差分・テキストエディタとの同時編集がそのまま使える
- VS Code のライト / ダークテーマに追従
- リンク: 編集モードでは `Ctrl+クリック`、閲覧モードではクリックで開く（相対パスの `.md` は VS Code で開く）
- 編集していない部分は元の書き方のまま保存（後述）
- Mermaid・ECharts・Graphviz などの図、KaTeX の数式

## 開発・実行

```bash
npm install
npm run build      # out/ に拡張と Webview をビルド
```

VS Code でこのフォルダを開き **F5**（「拡張機能を実行」）→ `sample/` フォルダが開いた新しいウィンドウが起動します。

1. `sample.md` を開くと「Markdown を見たまま編集」で表示されます
2. テキストエディタとの切り替えは、タイトルバーのアイコンかエクスプローラーの右クリックから
3. `.md` を最初からテキストエディタで開きたい場合は、設定 `mdWysiwyg.openByDefault` をオフにします
   （コマンドパレットの **「Markdown WYSIWYG: \*.md を開く既定のエディタを設定」** でも切り替えられます）

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `mdWysiwyg.openByDefault` | `true` | `.md` を最初から「Markdown を見たまま編集」で開く（オフで VS Code 標準のテキストエディタ） |
| `mdWysiwyg.readOnlyByDefault` | `false` | 開いた時点で閲覧モードにする |
| `mdWysiwyg.vditor.mode` | `ir` | Vditor のモード（`ir` 即時レンダリング / `wysiwyg` / `sv` 分割） |
| `mdWysiwyg.preserveFormatting` | `true` | 編集していない部分を元の書き方のまま保存する |
| `mdWysiwyg.pdf.browserPath` | 自動検出 | PDF 出力に使う Chrome / Edge |
| `mdWysiwyg.pdf.format` | `A4` | 用紙サイズ |
| `mdWysiwyg.pdf.margin` | `20mm` | 余白 |
| `mdWysiwyg.pdf.pageNumbers` | `true` | フッターにページ番号 |
| `mdWysiwyg.pdf.openAfterExport` | `true` | 出力後に PDF を開く |

## PDF 出力の仕組み

VS Code の Webview からは印刷できないため、拡張側で `markdown-it` により HTML を生成し、
**PC にインストール済みの Edge / Chrome** をヘッドレスで起動（`puppeteer-core`）して PDF 化します。
Windows では標準の Edge が使われるので追加インストールは不要です。
コードハイライト、表、タスクリスト、数式（KaTeX）、Mermaid、相対パスの画像に対応しています。
PDF は保存前の編集内容も含めて出力されます。

## 保存時の書式（元の書き方を残す仕組み）

Vditor は編集のたびに文書全体を Markdown に書き出し直すため、そのままでは触っていない行の書き方まで変わります。

| 元の書き方 | Vditor がそのまま書き出すと |
| --- | --- |
| `- [x] タスク` | `- [X]  タスク`（大文字・空白 2 つ） |
| `| a | b |` の表 | 列幅を揃えて整形 |
| `***` / `___` の区切り線 | `---` |
| `<https://…>` の自動リンク | `[https://…](https://…)` |
| 行末の空白 2 つによる改行 | 空白が消える |
| ネストしたリストの後・表の前 | 空行が入る |

そこで、**読み込んだ直後の Vditor の出力**と**現在の出力**を行単位で比べ、変わっていない行（= 編集していない行）は元のファイルの行に戻してから保存します。

- 編集・追加した行は Vditor の書き方になります。ただし `[X]  ` は `[x] ` に直します
- 表は 1 つのまとまりとして扱います。表の中を編集すると、その表全体が列幅を揃えた書き方になります
- 開いただけでは変更扱いになりません
- `mdWysiwyg.preserveFormatting` を `false` にすると、この処理を行わず Vditor の出力をそのまま保存します

## 既知の制約

- 大きなファイル（数千行以上）では WYSIWYG エディタの動作が重くなります
- Webview 内の Undo は Vditor 自身の履歴です（VS Code 側の Undo 履歴とは別）
- 同じファイルをテキストエディタと並べて編集すると、外部変更の反映時に Webview 側のカーソル位置がリセットされます

## パッケージ化

```bash
npm run package    # md-wysiwyg-editor-0.1.0.vsix を生成
code --install-extension md-wysiwyg-editor-0.1.0.vsix
```

## ライセンス

[MIT](LICENSE)

配布物（.vsix）には Vditor・Lute・KaTeX・Mermaid・puppeteer-core などの第三者ソフトウェアが含まれます。
それぞれのライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
