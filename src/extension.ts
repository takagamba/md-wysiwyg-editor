import * as vscode from 'vscode';
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
        { label: 'Markdown を見たまま編集', viewType: VIEW_TYPE },
        { label: 'テキストエディタ（VS Code 標準）', viewType: 'default' },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '*.md / *.markdown を開くエディタ' });
      if (!pick) return;
      const config = vscode.workspace.getConfiguration('workbench');
      const assoc = { ...(config.get<Record<string, string>>('editorAssociations') ?? {}) };
      assoc['*.md'] = pick.viewType;
      assoc['*.markdown'] = pick.viewType;
      await config.update('editorAssociations', assoc, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`*.md の既定のエディタを「${pick.label}」にしました。`);
    }),
  );
}

/** カスタムエディタ / テキストエディタのどちらがアクティブでも、表示中の Markdown の URI を返す */
function activeMarkdownUri(): vscode.Uri | undefined {
  if (EditorSession.active) return EditorSession.active.document.uri;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) return input.uri;
  return vscode.window.activeTextEditor?.document.uri;
}

export function deactivate(): void {}
