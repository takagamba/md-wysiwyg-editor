import * as vscode from 'vscode';
import type { Engine, HostToWebview, WebviewToHost } from '../webview/protocol';

export const VIEW_TYPES: Record<Engine, string> = {
  milkdown: 'mdWysiwyg.milkdown',
  vditor: 'mdWysiwyg.vditor',
};

const READONLY_CONTEXT_KEY = 'mdWysiwyg.readOnly';

/** 改行コードを LF に揃える（Webview 側は常に LF で扱う） */
const toLf = (s: string) => s.replace(/\r\n?/g, '\n');

/**
 * 1 つのタブ（= 1 つの Webview）に対応する編集セッション。
 * 正のデータは常に vscode.TextDocument で、Webview はその表示・編集 UI。
 */
export class EditorSession implements vscode.Disposable {
  private static readonly sessions = new Set<EditorSession>();
  private static activeSession: EditorSession | undefined;

  /** Webview が最後に把握している本文（LF）。エコーバック防止に使う */
  private webviewText: string;
  private readOnly: boolean;
  private readonly disposables: vscode.Disposable[] = [];
  private pendingEdit: Promise<void> = Promise.resolve();

  static get active(): EditorSession | undefined {
    return EditorSession.activeSession;
  }

  static forUri(uri: vscode.Uri): EditorSession | undefined {
    for (const s of EditorSession.sessions) {
      if (s.document.uri.toString() === uri.toString()) return s;
    }
    return undefined;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: Engine,
    readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
  ) {
    this.webviewText = toLf(document.getText());
    this.readOnly = vscode.workspace.getConfiguration('mdWysiwyg').get<boolean>('readOnlyByDefault', false);

    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'out'),
        vscode.Uri.joinPath(document.uri, '..'),
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
      ],
    };
    webview.html = this.buildHtml();

    this.disposables.push(
      webview.onDidReceiveMessage((m: WebviewToHost) => this.onMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
        // Webview 発の変更なら送り返さない（送るとカーソルが飛ぶ）
        const text = toLf(e.document.getText());
        if (text === this.webviewText) return;
        this.webviewText = text;
        this.post({ type: 'update', text });
      }),
      panel.onDidChangeViewState(() => {
        if (panel.active) this.activate();
        else if (EditorSession.activeSession === this) EditorSession.activeSession = undefined;
      }),
      panel.onDidDispose(() => this.dispose()),
    );

    EditorSession.sessions.add(this);
    if (panel.active) this.activate();
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  setReadOnly(value: boolean): void {
    this.readOnly = value;
    this.post({ type: 'setReadOnly', readOnly: value });
    if (EditorSession.activeSession === this) {
      void vscode.commands.executeCommand('setContext', READONLY_CONTEXT_KEY, value);
    }
  }

  private activate(): void {
    EditorSession.activeSession = this;
    void vscode.commands.executeCommand('setContext', READONLY_CONTEXT_KEY, this.readOnly);
  }

  private post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private onMessage(m: WebviewToHost): void {
    switch (m.type) {
      case 'ready': {
        const config = vscode.workspace.getConfiguration('mdWysiwyg');
        this.post({
          type: 'init',
          options: {
            text: this.webviewText,
            readOnly: this.readOnly,
            vditorCdn: this.panel.webview
              .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'vditor'))
              .toString(),
            vditorMode: config.get('vditor.mode', 'ir'),
          },
        });
        break;
      }
      case 'edit':
        if (this.readOnly) return;
        this.webviewText = m.text;
        // 連続入力で WorkspaceEdit が追い越さないよう直列化する
        this.pendingEdit = this.pendingEdit.then(() => this.applyToDocument(m.text));
        break;
      case 'openLink':
        void this.openLink(m.href);
        break;
      case 'error':
        void vscode.window.showErrorMessage(`Markdown WYSIWYG (${this.engine}): ${m.message}`);
        break;
    }
  }

  /** 変更された範囲だけを置き換える（Undo の粒度と差分表示をなるべく小さくする） */
  private async applyToDocument(newTextLf: string): Promise<void> {
    const doc = this.document;
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const oldText = doc.getText();
    const newText = eol === '\n' ? newTextLf : newTextLf.replace(/\n/g, eol);
    if (oldText === newText) return;

    let start = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
      oldEnd--;
      newEnd--;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(start), doc.positionAt(oldEnd)),
      newText.slice(start, newEnd),
    );
    await vscode.workspace.applyEdit(edit);
  }

  private async openLink(href: string): Promise<void> {
    if (!href || href.startsWith('#')) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const [pathPart] = href.split('#');
    const target = /^file:/i.test(pathPart)
      ? vscode.Uri.parse(pathPart)
      : vscode.Uri.joinPath(this.document.uri, '..', decodeURIComponent(pathPart));
    await vscode.commands.executeCommand('vscode.open', target);
  }

  private buildHtml(): string {
    const webview = this.panel.webview;
    const out = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', ...p));
    const nonce = createNonce();
    // 相対パスの画像がドキュメントのフォルダから解決されるように <base> を設定する
    const baseHref = webview.asWebviewUri(vscode.Uri.joinPath(this.document.uri, '..')).toString() + '/';
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${baseHref}">
  <link rel="stylesheet" href="${out('webview', `${this.engine}.css`)}">
</head>
<body class="engine-${this.engine}">
  <div id="readonly-badge" hidden>閲覧モード</div>
  <div id="editor"></div>
  ${
    this.engine === 'vditor'
      ? // Vditor はアイコンを同期 XHR + インライン script で読み込み CSP に弾かれるため、
        // 同じ id で先に読み込んでおく（id が既にあれば Vditor は読み込みをスキップする）
        `<script nonce="${nonce}" id="vditorIconScript" src="${out('vditor', 'dist', 'js', 'icons', 'ant.js')}"></script>`
      : ''
  }
  <script nonce="${nonce}" src="${out('webview', `${this.engine}.js`)}"></script>
</body>
</html>`;
  }

  dispose(): void {
    EditorSession.sessions.delete(this);
    if (EditorSession.activeSession === this) {
      EditorSession.activeSession = undefined;
      void vscode.commands.executeCommand('setContext', READONLY_CONTEXT_KEY, false);
    }
    this.disposables.forEach((d) => d.dispose());
  }
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static register(context: vscode.ExtensionContext, engine: Engine): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPES[engine], new MarkdownEditorProvider(context, engine), {
      // 非表示タブの状態を保持（切り替えのたびに再初期化しない）
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    });
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: Engine,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    new EditorSession(this.context, this.engine, document, panel);
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
