import type { MarkdownIt, StateBlock, StateCore, StateInline } from 'markdown-it';

/**
 * $...$（インライン）と $$...$$（ブロック）を KaTeX 描画用の要素として出力する。
 * 実際の描画は PDF 用ページ内で katex.render() が行う。
 */
export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    if (src[start] !== '$' || src[start + 1] === '$' || src[start + 1] === ' ') return false;
    let end = start + 1;
    while ((end = src.indexOf('$', end)) !== -1) {
      if (src[end - 1] !== '\\' && src[end - 1] !== ' ') break;
      end++;
    }
    if (end === -1 || end === start + 1) return false;
    if (!silent) {
      const token = state.push('math_inline', 'span', 0);
      token.content = src.slice(start + 1, end);
    }
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.after('blockquote', 'math_block', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    const lineText = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
    const first = lineText(startLine);
    if (!first.startsWith('$$')) return false;
    if (silent) return true;

    const lines: string[] = [];
    let line = startLine;
    let rest = first.slice(2);
    // 1 行で完結する $$ ... $$
    if (rest.trimEnd().endsWith('$$') && rest.trim().length > 2) {
      lines.push(rest.trimEnd().slice(0, -2));
    } else {
      if (rest.trim()) lines.push(rest);
      for (line = startLine + 1; line < endLine; line++) {
        rest = lineText(line);
        if (rest.trimEnd().endsWith('$$')) {
          const before = rest.trimEnd().slice(0, -2);
          if (before.trim()) lines.push(before);
          break;
        }
        lines.push(rest);
      }
    }
    const token = state.push('math_block', 'div', 0);
    token.block = true;
    token.content = lines.join('\n');
    token.map = [startLine, line + 1];
    state.line = line + 1;
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline">${md.utils.escapeHtml(tokens[idx].content)}</span>`;
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${md.utils.escapeHtml(tokens[idx].content)}</div>\n`;
}

/** GitHub 形式のタスクリスト（- [ ] / - [x]）をチェックボックスにする */
export function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'task_list', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
      const m = /^\[([ xX])\]\s/.exec(inline.content);
      const firstChild = inline.children?.[0];
      if (!m || !firstChild || firstChild.type !== 'text') continue;
      firstChild.content = firstChild.content.slice(m[0].length);
      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content = `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `;
      inline.children!.unshift(checkbox);
      tokens[i - 2].attrJoin('class', 'task-list-item');
    }
  });
}
