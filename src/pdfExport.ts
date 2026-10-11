import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import markdownIt, { type MarkdownIt } from 'markdown-it';
import hljs from 'highlight.js';
import puppeteer, { type PaperFormat } from 'puppeteer-core';
import hljsCss from 'highlight.js/styles/github.css';
import pdfCss from './pdf.css';
import { findBrowser } from './findBrowser';
import { mathPlugin, taskListPlugin } from './markdownItPlugins';

/**
 * Markdown を HTML に変換し、ローカルの Chrome / Edge（headless）で PDF に印刷する。
 * VS Code の Webview からは印刷できないため、拡張ホスト側で行う。
 */
export async function exportPdf(context: vscode.ExtensionContext, document: vscode.TextDocument): Promise<void> {
  const config = vscode.workspace.getConfiguration('mdWysiwyg.pdf');
  const browserPath = findBrowser(config.get<string>('browserPath', ''));
  if (!browserPath) {
    const pick = await vscode.window.showErrorMessage(
      'PDF 出力に使う Chrome / Edge が見つかりません。設定 mdWysiwyg.pdf.browserPath に実行ファイルのパスを指定してください。',
      '設定を開く',
    );
    if (pick) await vscode.commands.executeCommand('workbench.action.openSettings', 'mdWysiwyg.pdf.browserPath');
    return;
  }

  const defaultUri =
    document.uri.scheme === 'file'
      ? vscode.Uri.file(document.uri.fsPath.replace(/\.(md|markdown)$/i, '') + '.pdf')
      : undefined;
  const target = await vscode.window.showSaveDialog({ defaultUri, filters: { PDF: ['pdf'] } });
  if (!target) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'PDF を出力しています…' },
    async () => {
      const html = renderHtml(context, document);
      // file:// で開くことで、相対パスの画像やローカルの mermaid / KaTeX を読み込めるようにする
      const tmpHtml = path.join(os.tmpdir(), `md-wysiwyg-${process.pid}-${Date.now()}.html`);
      fs.writeFileSync(tmpHtml, html, 'utf8');
      const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--allow-file-access-from-files'] });
      try {
        const page = await browser.newPage();
        await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0', timeout: 60_000 });
        await page.waitForFunction('window.__renderDone === true', { timeout: 30_000 });
        const margin = config.get<string>('margin', '20mm');
        const pageNumbers = config.get<boolean>('pageNumbers', true);
        await page.pdf({
          path: target.fsPath,
          format: config.get<string>('format', 'A4') as PaperFormat,
          printBackground: true,
          margin: { top: margin, bottom: margin, left: margin, right: margin },
          displayHeaderFooter: pageNumbers,
          headerTemplate: '<div></div>',
          footerTemplate:
            '<div style="width:100%;font-size:9px;color:#888;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        });
      } finally {
        await browser.close();
        fs.rmSync(tmpHtml, { force: true });
      }
    },
  );

  if (config.get<boolean>('openAfterExport', true)) {
    await vscode.env.openExternal(target);
  } else {
    void vscode.window.showInformationMessage(`PDF を出力しました: ${target.fsPath}`);
  }
}

function renderHtml(context: vscode.ExtensionContext, document: vscode.TextDocument): string {
  const md: MarkdownIt = markdownIt({
    html: true,
    linkify: true,
    highlight(code, lang): string {
      if (lang === 'mermaid') return `<pre class="mermaid">${md.utils.escapeHtml(code)}</pre>`;
      if (lang && hljs.getLanguage(lang)) {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
    },
  })
    .use(mathPlugin)
    .use(taskListPlugin);

  const body = md.render(document.getText());
  const vditorJs = vscode.Uri.joinPath(context.extensionUri, 'out', 'vditor', 'dist', 'js');
  const asset = (...p: string[]) => pathToFileURL(vscode.Uri.joinPath(vditorJs, ...p).fsPath).href;
  const baseDir = document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : os.tmpdir();
  const title = path.basename(document.uri.path);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<base href="${pathToFileURL(baseDir).href}/">
<title>${md.utils.escapeHtml(title)}</title>
<link rel="stylesheet" href="${asset('katex', 'katex.min.css')}">
<style>${hljsCss}</style>
<style>${pdfCss}</style>
</head>
<body>
<article class="markdown-body">${body}</article>
<script src="${asset('katex', 'katex.min.js')}"></script>
<script src="${asset('mermaid', 'mermaid.min.js')}"></script>
<script>
(async () => {
  try {
    if (window.katex) {
      document.querySelectorAll('.math-inline, .math-block').forEach((el) => {
        katex.render(el.textContent, el, { displayMode: el.classList.contains('math-block'), throwOnError: false });
      });
    }
    if (window.mermaid && document.querySelector('.mermaid')) {
      mermaid.initialize({ startOnLoad: false, theme: 'default' });
      await mermaid.run({ querySelector: '.mermaid' });
    }
  } catch (e) {
    console.error(e);
  }
  window.__renderDone = true;
})();
</script>
</body>
</html>`;
}
