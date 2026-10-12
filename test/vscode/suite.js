// VS Code の拡張ホスト内で実行するテスト（test/vscode/run.mjs から起動する）。
// 例外を投げると run.mjs が失敗として終了する
const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');

const VIEW_TYPE = 'mdWysiwyg.vditor';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
const tabKind = () => {
  const input = activeTab()?.input;
  if (input instanceof vscode.TabInputCustom) return input.viewType;
  if (input instanceof vscode.TabInputText) return 'text';
  return String(input);
};
/** 条件を満たすまで待つ（VS Code の非同期処理の完了を待つため） */
async function waitFor(check, message, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return;
    await sleep(100);
  }
  assert.fail(message);
}
async function openFresh(file) {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  await waitFor(() => activeTab()?.input?.uri?.fsPath?.toLowerCase() === file.toLowerCase(), `${file} が開かない`);
  return tabKind();
}
const setOpenByDefault = (value) =>
  vscode.workspace.getConfiguration('mdWysiwyg').update('openByDefault', value, vscode.ConfigurationTarget.Global);
const associations = () => vscode.workspace.getConfiguration('workbench').inspect('editorAssociations').globalValue;

const tests = {
  async '設定なしで .md を開くと「Markdown を見たまま編集」で開き、ユーザー設定は書き換えない'(file) {
    assert.equal(await openFresh(file), VIEW_TYPE);
    assert.equal(associations(), undefined);
  },

  async '開いただけでは未保存にならない'(file) {
    await openFresh(file);
    await sleep(3000); // Webview の初期化と Vditor の通知（800ms 後）を待つ
    assert.equal(activeTab().isDirty, false);
  },

  async 'テキストエディタとの切り替えコマンド'(file) {
    await openFresh(file);
    await vscode.commands.executeCommand('mdWysiwyg.openAsText');
    await waitFor(() => tabKind() === 'text', 'テキストエディタに切り替わらない');
    await vscode.commands.executeCommand('mdWysiwyg.openWysiwyg');
    await waitFor(() => tabKind() === VIEW_TYPE, '見たまま編集に切り替わらない');
  },

  async 'openByDefault を切り替えると、開くエディタが変わる'(file) {
    await setOpenByDefault(false);
    await waitFor(() => associations()?.['*.md'] === 'default', 'editorAssociations が default にならない');
    assert.equal(associations()['*.markdown'], 'default');
    assert.equal(await openFresh(file), 'text');

    await setOpenByDefault(true);
    await waitFor(() => associations()?.['*.md'] === VIEW_TYPE, `editorAssociations が ${VIEW_TYPE} にならない`);
    assert.equal(await openFresh(file), VIEW_TYPE);
  },
};

exports.run = async () => {
  const file = path.join(process.env.MDW_TEST_WORKSPACE, 'test.md');
  // 拡張機能が有効になる（onStartupFinished）のを待つ
  const ext = vscode.extensions.all.find((e) => e.id === 'takagamba.markdown-wysiwyg-pdf');
  assert.ok(ext, '拡張機能が読み込まれていない');
  await ext.activate();

  const failures = [];
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn(file);
      console.log(`ok - ${name}`);
    } catch (e) {
      failures.push(name);
      console.log(`not ok - ${name}\n${e.stack ?? e}`);
    }
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  if (failures.length > 0) throw new Error(`${failures.length} 件のテストが失敗しました`);
};
