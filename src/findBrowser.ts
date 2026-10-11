import * as fs from 'node:fs';

/**
 * PDF 出力に使う Chrome / Edge を探す。configured が指定されていればそれだけを使う。
 * vscode に依存しないので、テストからも使う
 */
export function findBrowser(configured: string): string | undefined {
  if (configured) return fs.existsSync(configured) ? configured : undefined;
  const env = process.env;
  const candidates: string[] =
    process.platform === 'win32'
      ? [
          `${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
            '/snap/bin/chromium',
          ];
  return candidates.find((p) => fs.existsSync(p));
}
