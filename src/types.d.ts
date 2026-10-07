// esbuild: 拡張側では CSS を文字列として、Webview 側では副作用 import として扱う
declare module '*.css' {
  const content: string;
  export default content;
}
