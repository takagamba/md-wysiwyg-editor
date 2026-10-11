// VS Code を起動して拡張機能のテスト（suite.js）を実行する: npm run test:vscode（先に npm run build）
// 環境変数 VSCODE_EXECUTABLE でインストール済みの VS Code を使える。指定がなければ安定版をダウンロードする
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { ROOT } from '../helpers.mjs';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mdw-ws-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mdw-ud-'));
fs.copyFileSync(path.join(ROOT, 'test/fixtures/basic.md'), path.join(workspace, 'test.md'));

try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
    extensionDevelopmentPath: ROOT,
    extensionTestsPath: path.join(ROOT, 'test/vscode/suite.js'),
    // ユーザー設定を分けて起動する（普段の VS Code の設定に影響させない）
    launchArgs: [workspace, `--user-data-dir=${userData}`, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { MDW_TEST_WORKSPACE: workspace },
  });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
}
