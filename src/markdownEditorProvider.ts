import * as vscode from 'vscode';
import type { HostToWebview, WebviewToHost } from '../webview/protocol';
import { IMAGE_EXTENSIONS, imageFileName, isImagePath, markdownForFile, numberedFileName } from './fileLink';

export const VIEW_TYPE = 'mdWysiwyg.vditor';

const READONLY_CONTEXT_KEY = 'mdWysiwyg.readOnly';

/** 保存前に Webview の応答を待つ上限。VS Code は保存前処理全体に約 1.5 秒の上限を設けている */
const FLUSH_TIMEOUT_MS = 1000;

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
  private flushSeq = 0;
  private readonly flushWaiters = new Map<number, (text: string | null) => void>();

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
      // 保存の直前に Webview の最新の内容を取り込む（Vditor は入力から 800ms 経つまで通知しないため）
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || this.readOnly) return;
        e.waitUntil(this.editsBeforeSave());
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
            preserveFormatting: config.get('preserveFormatting', true),
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
      case 'flushed':
        this.flushWaiters.get(m.id)?.(m.text);
        break;
      case 'openLink':
        void this.openLink(m.href);
        break;
      case 'pickFile':
        void this.pickFile(m.kind);
        break;
      case 'saveImages':
        this.saveImages(m.files).catch((e) =>
          vscode.window.showErrorMessage(`画像を保存できませんでした: ${e instanceof Error ? e.message : String(e)}`),
        );
        break;
      case 'linkFiles':
        this.linkFiles(m.uris);
        break;
      case 'error':
        void vscode.window.showErrorMessage(`Markdown WYSIWYG: ${m.message}`);
        break;
    }
  }

  /** Webview に最新の内容を求め、保存前に適用する編集を返す */
  private async editsBeforeSave(): Promise<vscode.TextEdit[]> {
    const text = await this.requestFlush();
    await this.pendingEdit;
    if (text === null || this.readOnly) return [];
    this.webviewText = text;
    const edit = this.diffEdit(text);
    return edit ? [edit] : [];
  }

  private requestFlush(): Promise<string | null> {
    const id = ++this.flushSeq;
    return new Promise((resolve) => {
      const done = (text: string | null) => {
        clearTimeout(timer);
        this.flushWaiters.delete(id);
        resolve(text);
      };
      // Webview が初期化前などで応答しない場合は、何もせずに保存させる
      const timer = setTimeout(() => done(null), FLUSH_TIMEOUT_MS);
      this.flushWaiters.set(id, done);
      this.post({ type: 'flush', id });
    });
  }

  private async applyToDocument(newTextLf: string): Promise<void> {
    const edit = this.diffEdit(newTextLf);
    if (!edit) return;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(this.document.uri, [edit]);
    await vscode.workspace.applyEdit(workspaceEdit);
  }

  /** 変更された範囲だけを置き換える編集（Undo の粒度と差分表示をなるべく小さくする）。変更がなければ undefined */
  private diffEdit(newTextLf: string): vscode.TextEdit | undefined {
    const doc = this.document;
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const oldText = doc.getText();
    const newText = eol === '\n' ? newTextLf : newTextLf.replace(/\n/g, eol);
    if (oldText === newText) return undefined;

    let start = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
      oldEnd--;
      newEnd--;
    }

    return vscode.TextEdit.replace(
      new vscode.Range(doc.positionAt(start), doc.positionAt(oldEnd)),
      newText.slice(start, newEnd),
    );
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

  /** ファイルを選ばせ、文書からの相対パスのリンク・画像を Webview に挿入させる */
  private async pickFile(kind: 'link' | 'image'): Promise<void> {
    if (this.readOnly) return;
    const picked = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.joinPath(this.document.uri, '..'),
      canSelectMany: false,
      openLabel: kind === 'image' ? '画像を挿入' : 'リンクを挿入',
      filters: kind === 'image' ? { 画像: IMAGE_EXTENSIONS } : undefined,
    });
    if (!picked?.[0]) return;
    const documentPath = this.document.uri.scheme === 'file' ? this.document.uri.fsPath : undefined;
    this.post({ type: 'insert', text: markdownForFile(documentPath, picked[0].fsPath, kind) });
  }

  /** 貼り付け・ドロップした画像を設定 imageFolder（文書のフォルダからの相対パス）に保存し、Webview に挿入させる */
  private async saveImages(files: { name: string; type: string; data: Uint8Array }[]): Promise<void> {
    if (this.readOnly || files.length === 0) return;
    if (this.document.uri.scheme === 'untitled') {
      void vscode.window.showWarningMessage('画像を貼り付けるには、先に文書を保存してください。');
      return;
    }
    const setting = vscode.workspace.getConfiguration('mdWysiwyg').get('imageFolder', 'images');
    const folder = vscode.Uri.joinPath(this.document.uri, '..', ...setting.split(/[\\/]/).filter(Boolean));
    await vscode.workspace.fs.createDirectory(folder);
    const now = new Date();
    const lines: string[] = [];
    for (const file of files) {
      const name = imageFileName(file.name, file.type, now);
      let target = vscode.Uri.joinPath(folder, name);
      for (let n = 1; await exists(target); n++) target = vscode.Uri.joinPath(folder, numberedFileName(name, n));
      await vscode.workspace.fs.writeFile(target, file.data);
      lines.push(markdownForFile(this.document.uri.fsPath, target.fsPath, 'image'));
    }
    this.post({ type: 'insert', text: lines.join('\n') });
  }

  /** エクスプローラーからドロップされたファイルへの相対パスのリンク（画像なら画像）を挿入させる */
  private linkFiles(uris: string[]): void {
    if (this.readOnly) return;
    const documentPath = this.document.uri.scheme === 'file' ? this.document.uri.fsPath : undefined;
    const lines = uris
      .map((u) => vscode.Uri.parse(u))
      .filter((u) => u.scheme === this.document.uri.scheme)
      .map((u) => markdownForFile(documentPath, u.fsPath, isImagePath(u.fsPath) ? 'image' : 'link'));
    if (lines.length > 0) this.post({ type: 'insert', text: lines.join('\n') });
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
  <link rel="stylesheet" href="${out('webview', 'vditor.css')}">
</head>
<body>
  <div id="readonly-badge" hidden>閲覧モード</div>
  <div id="editor"></div>
  <!-- Vditor はアイコンを同期 XHR + インライン script で読み込み CSP に弾かれるため、
       同じ id で先に読み込んでおく（id が既にあれば Vditor は読み込みをスキップする） -->
  <script nonce="${nonce}" id="vditorIconScript" src="${out('vditor', 'dist', 'js', 'icons', 'ant.js')}"></script>
  <script nonce="${nonce}" src="${out('webview', 'vditor.js')}"></script>
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
  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, new MarkdownEditorProvider(context), {
      // 非表示タブの状態を保持（切り替えのたびに再初期化しない）
      // enableFindWidget: Ctrl+F で VS Code の検索バーを出す
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
      supportsMultipleEditorsPerDocument: true,
    });
  }

  private constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    new EditorSession(this.context, document, panel);
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
