# Markdown WYSIWYG Editor (Milkdown / Vditor)

`.md` ファイルを **タブを分割せずに**、レンダリングされた表示のまま編集できる VS Code 拡張です。
エディタエンジンを 2 種類同梱しているので、同じファイルで使い比べられます。

- **Milkdown（Crepe）** … Notion 風。記号は隠れ、`/` でブロック挿入、選択でツールバー
- **Vditor** … Typora 風の「即時レンダリング（IR）」。カーソルのある部分だけ Markdown 記号が見える

共通機能:

- 閲覧モード（読み取り専用）切替 — タイトルバーの 🔒 ボタン / `Ctrl+Alt+R`
- PDF 出力 — タイトルバーの PDF ボタン / エクスプローラーの右クリック
- 正のデータは VS Code の TextDocument なので、保存・未保存マーク・Git 差分・テキストエディタとの同時編集がそのまま使える
- VS Code のライト / ダークテーマに追従
- リンク: 編集モードでは `Ctrl+クリック`、閲覧モードではクリックで開く（相対パスの `.md` は VS Code で開く）

## 開発・実行

```bash
npm install
npm run build      # out/ に拡張と Webview をビルド
```

VS Code でこのフォルダを開き **F5**（「拡張機能を実行」）→ `sample/` フォルダが開いた新しいウィンドウが起動します。

1. `sample.md` を右クリック → **Milkdown で開く** / **Vditor で開く**
2. テキストエディタで開いている場合は、タイトルバーのアイコンからも切り替え可能
3. `.md` を常にどちらかで開きたい場合は、コマンドパレットで
   **「Markdown WYSIWYG: \*.md を開く既定のエディタを設定」**

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `mdWysiwyg.readOnlyByDefault` | `false` | 開いた時点で閲覧モードにする |
| `mdWysiwyg.vditor.mode` | `ir` | Vditor のモード（`ir` 即時レンダリング / `wysiwyg` / `sv` 分割） |
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

## Milkdown と Vditor の違い（保存時の書式）

どちらのエディタも、内部のデータ構造から Markdown を書き出し直すため、**編集すると元の書き方が多少変わる**ことがあります。
（開いただけでは変更扱いになりません）

| 元の書き方 | Milkdown | Vditor |
| --- | --- | --- |
| `- [x] タスク` | そのまま | `- [X]  タスク`（大文字・空白 2 つ） |
| `\| a \| b \|` の表 | 列幅を揃えて整形 | 列幅を揃えて整形 |
| ネストしたリストの後 | 空行が入ることがある | 空行が入ることがある |
| 画像の alt テキスト | そのまま | そのまま |

その他の比較:

| | Milkdown（Crepe） | Vditor |
| --- | --- | --- |
| 操作感 | Notion 風（記号を見せない） | Typora 風（カーソル位置だけ記号を表示） |
| ツールバー | 選択時のフローティング + `/` メニュー | 上部の固定ツールバー |
| 数式 | ○（KaTeX） | ○（KaTeX） |
| Mermaid 等の図 | ×（コードブロックとして表示） | ○（Mermaid、ECharts、Graphviz なども） |
| バンドルサイズ | 約 5MB | 約 0.8MB + アセット 24MB（オフライン用に同梱） |
| 拡張性 | ProseMirror ベースでプラグインを書きやすい | 設定項目は多いが内部の改造はしにくい |

## 既知の制約

- 大きなファイル（数千行以上）では WYSIWYG エディタの動作が重くなります
- Webview 内の Undo は各エディタ自身の履歴です（VS Code 側の Undo 履歴とは別）
- 同じファイルをテキストエディタと並べて編集すると、外部変更の反映時に Webview 側のカーソル位置がリセットされます

## パッケージ化

```bash
npm run package    # md-wysiwyg-editor-0.1.0.vsix を生成
code --install-extension md-wysiwyg-editor-0.1.0.vsix
```
