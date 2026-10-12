# 開発

```bash
npm install
npm run build        # out/ に拡張と Webview をビルド
npm run typecheck    # 型チェック
npm test             # テスト（Chrome または Edge が必要）
npm run test:vscode  # VS Code を起動して拡張機能のテスト
npm run package      # .vsix を作成
```

VS Code でこのフォルダを開き **F5**（「拡張機能を実行」）を押すと、`sample/` フォルダが開いた新しいウィンドウが起動します。

- `sample/sample.md` を開くと「Markdown を見たまま編集」で表示されます
- `.vsix` は `code --install-extension markdown-wysiwyg-pdf-<version>.vsix` でインストールできます

## PDF 出力の仕組み

VS Code の Webview からは印刷できないため、拡張側で `markdown-it` により HTML を生成し、
PC にインストール済みの Edge / Chrome をヘッドレスで起動（`puppeteer-core`）して PDF 化します。
PDF は保存前の編集内容も含めて出力されます。

## 画像

`media/icon.svg` を編集したら、`npm run build` の後に `node scripts/render-media.mjs` を実行して
`media/icon.png` と README のスクリーンショット（`media/screenshot-*.png`）を作り直します。

## 依存関係を更新したら

`npm run notices` で THIRD_PARTY_NOTICES.md を再生成し、差分を確認します。
設計上の決まりごとや落とし穴は [CLAUDE.md](CLAUDE.md) にまとめています。
