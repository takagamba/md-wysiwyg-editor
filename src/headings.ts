import MarkdownIt from 'markdown-it';

/** 文書中の見出し（文書の先頭からの順番 index で Webview の見出し要素と対応させる） */
export interface Heading {
  level: number;
  text: string;
  /** 0 始まりの行番号 */
  line: number;
  index: number;
  children: Heading[];
}

const md = new MarkdownIt({ html: true });

/**
 * 見出しを階層にして返す。コードブロック内の # は見出しにしない（markdown-it で解析する）。
 * 引用やリストの中の見出しも、Vditor の表示と同じく見出しとして数える
 */
export function parseHeadings(text: string): Heading[] {
  // 先頭の front matter（--- で囲んだ YAML）は Vditor では見出しにならないので、行数を保ったまま空にする
  const source = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/, (m) => m.replace(/[^\r\n]/g, ''));
  const tokens = md.parse(source, {});
  const flat: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const label = (inline?.children ?? [])
      .filter((c) => c.type === 'text' || c.type === 'code_inline')
      .map((c) => c.content)
      .join('')
      .trim();
    flat.push({ level: Number(t.tag.slice(1)), text: label, line: t.map?.[0] ?? 0, index: flat.length, children: [] });
  }
  return toTree(flat);
}

function toTree(flat: Heading[]): Heading[] {
  const roots: Heading[] = [];
  const stack: Heading[] = [];
  for (const h of flat) {
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    (stack.length > 0 ? stack[stack.length - 1].children : roots).push(h);
    stack.push(h);
  }
  return roots;
}
