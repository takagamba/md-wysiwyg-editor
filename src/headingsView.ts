import * as vscode from 'vscode';
import { parseHeadings, type Heading } from './headings';
import { EditorSession } from './markdownEditorProvider';

export const HEADINGS_VIEW_ID = 'mdWysiwyg.headings';
const REVEAL_COMMAND = 'mdWysiwyg.revealHeading';
/** 入力のたびに解析し直さないよう、少し待ってから更新する */
const REFRESH_DELAY_MS = 300;

/**
 * サイドバーの「見出し」ビュー。見たまま編集で開いている文書の見出しを階層で表示し、
 * クリックするとエディタをその見出しまで移動させる（ビューの表示条件は package.json の when）
 */
export class HeadingsView implements vscode.TreeDataProvider<Heading>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  /** 最後にアクティブだったセッション。ビューにフォーカスが移ってもそのまま表示する */
  private session: EditorSession | undefined;
  private headings: Heading[] = [];
  private timer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      this.changed,
      vscode.window.createTreeView(HEADINGS_VIEW_ID, { treeDataProvider: this, showCollapseAll: true }),
      vscode.commands.registerCommand(REVEAL_COMMAND, (h: Heading) => this.session?.revealHeading(h.index, h.text)),
      EditorSession.onDidChangeActive((s) => {
        if (s && s !== this.session) {
          this.session = s;
          this.refresh();
        }
      }),
      EditorSession.onDidDispose((s) => {
        if (s !== this.session) return;
        this.session = undefined;
        this.refresh();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document !== this.session?.document) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
      }),
    );
    this.session = EditorSession.active;
    this.refresh();
  }

  private refresh(): void {
    clearTimeout(this.timer);
    this.headings = this.session ? parseHeadings(this.session.document.getText()) : [];
    this.changed.fire();
  }

  getChildren(element?: Heading): Heading[] {
    return element ? element.children : this.headings;
  }

  getTreeItem(h: Heading): vscode.TreeItem {
    const item = new vscode.TreeItem(
      h.text || '（空の見出し）',
      h.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    // 内容が変わっても開閉状態を保てるよう、位置と見出しから id を作る
    item.id = `${h.index}:${h.level}:${h.text}`;
    item.description = `H${h.level}`;
    item.tooltip = `${'#'.repeat(h.level)} ${h.text}（${h.line + 1} 行目）`;
    item.iconPath = new vscode.ThemeIcon('symbol-string');
    item.command = { command: REVEAL_COMMAND, title: '見出しへ移動', arguments: [h] };
    return item;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
