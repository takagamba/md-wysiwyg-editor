import * as vscode from 'vscode';
import { EditorSession, MarkdownEditorProvider, VIEW_TYPES } from './markdownEditorProvider';
import { exportPdf } from './pdfExport';
import type { Engine } from '../webview/protocol';

export function activate(context: vscode.ExtensionContext): void {
  const setReadOnly = (value: boolean | 'toggle') => {
    const session = EditorSession.active;
    if (!session) return;
    session.setReadOnly(value === 'toggle' ? !session.isReadOnly : value);
  };

  const openWith = (engine: Engine | 'default') => async (uri?: vscode.Uri) => {
    const target = uri ?? activeMarkdownUri();
    if (!target) return;
    await vscode.commands.executeCommand('vscode.openWith', target, engine === 'default' ? 'default' : VIEW_TYPES[engine]);
  };

  context.subscriptions.push(
    MarkdownEditorProvider.register(context, 'milkdown'),
    MarkdownEditorProvider.register(context, 'vditor'),

    vscode.commands.registerCommand('mdWysiwyg.enterReadOnly', () => setReadOnly(true)),
    vscode.commands.registerCommand('mdWysiwyg.exitReadOnly', () => setReadOnly(false)),
    vscode.commands.registerCommand('mdWysiwyg.toggleReadOnly', () => setReadOnly('toggle')),

    vscode.commands.registerCommand('mdWysiwyg.openWithMilkdown', openWith('milkdown')),
    vscode.commands.registerCommand('mdWysiwyg.openWithVditor', openWith('vditor')),
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
        { label: 'Milkdown', viewType: VIEW_TYPES.milkdown },
        { label: 'Vditor', viewType: VIEW_TYPES.vditor },
        { label: 'テキストエディタ（VS Code 標準）', viewType: 'default' },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '*.md / *.markdown を開くエディタ' });
      if (!pick) return;
      const config = vscode.workspace.getConfiguration('workbench');
      const assoc = { ...(config.get<Record<string, string>>('editorAssociations') ?? {}) };
      assoc['*.md'] = pick.viewType;
      assoc['*.markdown'] = pick.viewType;
      await config.update('editorAssociations', assoc, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`*.md を ${pick.label} で開くように設定しました。`);
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
