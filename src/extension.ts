import * as vscode from 'vscode';
import { HeadingsView } from './headingsView';
import { EditorSession, MarkdownEditorProvider, VIEW_TYPE } from './markdownEditorProvider';
import { exportPdf } from './pdfExport';

export function activate(context: vscode.ExtensionContext): void {
  const setReadOnly = (value: boolean | 'toggle') => {
    const session = EditorSession.active;
    if (!session) return;
    session.setReadOnly(value === 'toggle' ? !session.isReadOnly : value);
  };

  const openWith = (viewType: string) => async (uri?: vscode.Uri) => {
    const target = uri ?? activeMarkdownUri();
    if (!target) return;
    await vscode.commands.executeCommand('vscode.openWith', target, viewType);
  };

  context.subscriptions.push(
    MarkdownEditorProvider.register(context),
    new HeadingsView(),

    vscode.commands.registerCommand('mdWysiwyg.enterReadOnly', () => setReadOnly(true)),
    vscode.commands.registerCommand('mdWysiwyg.exitReadOnly', () => setReadOnly(false)),
    vscode.commands.registerCommand('mdWysiwyg.toggleReadOnly', () => setReadOnly('toggle')),

    vscode.commands.registerCommand('mdWysiwyg.openWysiwyg', openWith(VIEW_TYPE)),
    vscode.commands.registerCommand('mdWysiwyg.openAsText', openWith('default')),

    vscode.commands.registerCommand('mdWysiwyg.exportPdf', async (uri?: vscode.Uri) => {
      const target = uri ?? activeMarkdownUri();
      if (!target) {
        void vscode.window.showWarningMessage('PDF に出力する Markdown ファイルを開いてください。');
        return;
      }
      try {
        // 未保存の内容も含めて出力する（開いている TextDocument を使う）
        const document = await vscode.workspace.openTextDocument(target);
        await exportPdf(context, document);
      } catch (e) {
        void vscode.window.showErrorMessage(`PDF 出力に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),

    vscode.commands.registerCommand('mdWysiwyg.setDefaultEditor', async () => {
      const items = [
        { label: 'Markdown を見たまま編集', openByDefault: true },
        { label: 'テキストエディタ（VS Code 標準）', openByDefault: false },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '*.md / *.markdown を開くエディタ' });
      if (!pick) return;
      // 設定を変えると onDidChangeConfiguration で editorAssociations に反映される
      await vscode.workspace
        .getConfiguration('mdWysiwyg')
        .update('openByDefault', pick.openByDefault, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`*.md の既定のエディタを「${pick.label}」にしました。`);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mdWysiwyg.openByDefault')) void applyOpenByDefault();
    }),
  );
}

const MARKDOWN_PATTERNS = ['*.md', '*.markdown'];

/**
 * 設定 mdWysiwyg.openByDefault を VS Code 標準の workbench.editorAssociations（ユーザー設定）に反映する。
 * 何も設定していなければカスタムエディタの priority: "default" により見たまま編集で開くので、
 * インストールしただけではユーザー設定を書き換えない（設定を切り替えたときだけ書く）
 */
async function applyOpenByDefault(): Promise<void> {
  const openByDefault = vscode.workspace.getConfiguration('mdWysiwyg').get<boolean>('openByDefault', true);
  const viewType = openByDefault ? VIEW_TYPE : 'default';
  const workbench = vscode.workspace.getConfiguration('workbench');
  // ワークスペース設定の値をユーザー設定に書き写さないよう、ユーザー設定の値だけを読む
  const assoc = { ...(workbench.inspect<Record<string, string>>('editorAssociations')?.globalValue ?? {}) };
  if (MARKDOWN_PATTERNS.every((p) => assoc[p] === viewType)) return;
  for (const p of MARKDOWN_PATTERNS) assoc[p] = viewType;
  await workbench.update('editorAssociations', assoc, vscode.ConfigurationTarget.Global);
}

/** カスタムエディタ / テキストエディタのどちらがアクティブでも、表示中の Markdown の URI を返す */
function activeMarkdownUri(): vscode.Uri | undefined {
  if (EditorSession.active) return EditorSession.active.document.uri;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) return input.uri;
  return vscode.window.activeTextEditor?.document.uri;
}

export function deactivate(): void {}
