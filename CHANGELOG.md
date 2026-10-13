# Changelog

## 0.3.0

- Paste or drop images: they are saved to the `images/` folder next to the document (setting `mdWysiwyg.imageFolder`) and inserted as relative links instead of base64 / 画像の貼り付け・ドロップに対応。文書のフォルダの `images/` に保存して相対パスで挿入する（base64 で埋め込まない）
- Drop files from VS Code's Explorer (with `Shift`) to insert relative links / エクスプローラーから Shift を押しながらドロップしたファイルを相対パスで挿入
- Headings panel in the Activity Bar: click a heading to jump to it / アクティビティバーに見出しの一覧を追加。クリックでその見出しへ移動
- Find with `Ctrl+F` / `Ctrl+F` で検索できるようにした

## 0.2.0

- Insert links and images by picking a file (toolbar buttons). The path is relative to the document. / ファイルを選んでリンク・画像を挿入するボタンを追加（文書からの相対パス）
- Show "Markdown を見たまま編集" without the category prefix in the Command Palette / コマンドパレットで「Markdown を見たまま編集」の前に分類名を付けない

## 0.1.0

Initial release. / 最初のリリース。

- Edit `.md` files in the same tab with Vditor (instant rendering mode), opened by default
- Keep the original text of lines you did not edit when saving
- Read-only mode and PDF export (Edge / Chrome)
- Math (KaTeX) and diagrams (Mermaid, ECharts, Graphviz, and more), working offline
