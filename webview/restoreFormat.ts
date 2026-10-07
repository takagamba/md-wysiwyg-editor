// Vditor は編集のたびに文書全体を Markdown に書き出し直すため、触っていない行の書き方まで変わる
// （`[x]` → `[X]  `、表の列幅揃え、空行の追加、`***` → `---` など）。
// ここでは次の 3 つを行単位で比較し、ユーザーが編集していない部分は元の書き方に戻す。
//
//   original   … Webview に読み込ませた文書（ファイルの書き方そのまま）
//   normalized … original を読み込んだ直後の Vditor の出力（Vditor の書き方）
//   current    … 現在の Vditor の出力
//
// normalized と current で変わっていない行 = ユーザーが触っていない行なので、original の該当行を使う。
// 変わった行・追加された行は current（Vditor の書き方）を使い、目立つ癖だけ直す（fixVditorStyle）。

/** diff の 1 区間。equal なら a[aStart, aEnd) と b[bStart, bEnd) は同じ内容 */
interface Hunk {
  equal: boolean;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/** Myers 法の編集距離の上限。超えたら差分の中間部分を 1 つの変更として扱う（結果は正しいが粒度が粗くなる） */
const MAX_EDIT_DISTANCE = 2000;

/** 行配列の差分。先頭・末尾の一致部分を除いてから Myers 法で求める */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const hunks: Hunk[] = [];
  const push = (equal: boolean, aLen: number, bLen: number) => {
    if (aLen === 0 && bLen === 0) return;
    const last = hunks[hunks.length - 1];
    const aStart = last ? last.aEnd : 0;
    const bStart = last ? last.bEnd : 0;
    // 隣り合う同種の区間はまとめる
    if (last && last.equal === equal) {
      last.aEnd += aLen;
      last.bEnd += bLen;
    } else {
      hunks.push({ equal, aStart, aEnd: aStart + aLen, bStart, bEnd: bStart + bLen });
    }
  };

  push(true, pre, pre);
  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  const script = myers(midA, midB);
  if (script) {
    for (const op of script) {
      if (op === '=') push(true, 1, 1);
      else if (op === '-') push(false, 1, 0);
      else push(false, 0, 1);
    }
  } else {
    push(false, midA.length, midB.length);
  }
  push(true, suf, suf);
  return hunks;
}

/** 編集スクリプト（'=' 一致 / '-' a から削除 / '+' b から挿入）。上限を超えたら undefined */
function myers(a: readonly string[], b: readonly string[]): ('=' | '-' | '+')[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // snapshots[d][k + d] = d 回目の探索後の、対角線 k 上で最も進んだ x
  const snapshots: Int32Array[] = [];

  for (let d = 0; d <= Math.min(max, MAX_EDIT_DISTANCE); d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
    }
    snapshots.push(v.slice(off - d, off + d + 1));
    if (v[off + n - m] >= n && Math.abs(n - m) <= d && (d - Math.abs(n - m)) % 2 === 0) {
      return backtrack(snapshots, n, m);
    }
  }
  return undefined;
}

function backtrack(snapshots: Int32Array[], n: number, m: number): ('=' | '-' | '+')[] {
  const ops: ('=' | '-' | '+')[] = [];
  const get = (d: number, k: number) => snapshots[d][k + d];
  let x = n;
  let y = m;
  for (let d = snapshots.length - 1; d > 0; d--) {
    const k = x - y;
    const down = k === -d || (k !== d && get(d - 1, k - 1) < get(d - 1, k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = get(d - 1, prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('=');
      x--;
      y--;
    }
    ops.push(down ? '+' : '-');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push('=');
    x--;
    y--;
  }
  return ops.reverse();
}

/** original と normalized の対応。o[oStart, oEnd) を Vditor が書き直したものが n[nStart, nEnd) */
interface Segment {
  oStart: number;
  oEnd: number;
  nStart: number;
  nEnd: number;
}

const isTableRow = (line: string) => /^\s*\|/.test(line);

function buildSegments(original: string[], normalized: string[]): Segment[] {
  const segments: Segment[] = [];
  const isBlank = (line: string) => line.trim() === '';
  for (const h of diffLines(original, normalized)) {
    let { aStart, aEnd, bStart, bEnd } = h;
    // Vditor が足した・消した空行は単独の区間に切り出す（表の前の空行など）。
    // 残りの行数が揃えば、下の 1 行ずつの対応にできる
    const tail: Segment[] = [];
    while (!h.equal && aEnd - aStart !== bEnd - bStart) {
      if (bEnd - bStart > aEnd - aStart && isBlank(normalized[bStart])) {
        segments.push({ oStart: aStart, oEnd: aStart, nStart: bStart, nEnd: ++bStart });
      } else if (bEnd - bStart > aEnd - aStart && isBlank(normalized[bEnd - 1])) {
        tail.unshift({ oStart: aEnd, oEnd: aEnd, nStart: --bEnd, nEnd: bEnd + 1 });
      } else if (aEnd - aStart > bEnd - bStart && isBlank(original[aStart])) {
        segments.push({ oStart: aStart, oEnd: ++aStart, nStart: bStart, nEnd: bStart });
      } else if (aEnd - aStart > bEnd - bStart && isBlank(original[aEnd - 1])) {
        tail.unshift({ oStart: --aEnd, oEnd: aEnd + 1, nStart: bEnd, nEnd: bEnd });
      } else {
        break;
      }
    }

    const aLen = aEnd - aStart;
    if (aLen === bEnd - bStart) {
      // 一致した行や、行数が同じまま書き直された行（`[x]` → `[X]` など）は 1 行ずつ対応させる
      for (let i = 0; i < aLen; i++) {
        segments.push({ oStart: aStart + i, oEnd: aStart + i + 1, nStart: bStart + i, nEnd: bStart + i + 1 });
      }
    } else {
      segments.push({ oStart: aStart, oEnd: aEnd, nStart: bStart, nEnd: bEnd });
    }
    segments.push(...tail);
  }

  // 表は 1 つのまとまりとして扱う。Vditor は表全体の列幅を揃えるため、
  // 1 行だけ Vditor の書き方にすると元の行と混ざって崩れて見える
  const merged: Segment[] = [];
  const allTable = (s: Segment) => s.nEnd > s.nStart && normalized.slice(s.nStart, s.nEnd).every(isTableRow);
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && allTable(last) && allTable(s) && last.nEnd === s.nStart && last.oEnd === s.oStart) {
      last.oEnd = s.oEnd;
      last.nEnd = s.nEnd;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** Vditor の書き方のうち、目立つ癖だけ一般的な書き方に直す（ユーザーが編集・追加した行に適用） */
export function fixVditorStyle(line: string): string {
  // 空白だけの行は空行にする
  if (line.trim() === '') return '';
  // `- [X]  タスク` → `- [x] タスク`
  return line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\] {2,}(?=\S)/, (_, marker: string, mark: string) => {
    return `${marker}[${mark === ' ' ? ' ' : 'x'}] `;
  });
}

/**
 * 解析結果の再利用のため、original / normalized の組ごとに 1 つ作る。
 * restore() は current だけを受け取り、元の書き方に戻した Markdown を返す。
 */
export class FormatRestorer {
  private readonly originalLines: string[];
  private readonly normalizedLines: string[];
  private readonly segments: Segment[];

  constructor(original: string, normalized: string) {
    this.originalLines = original.split('\n');
    this.normalizedLines = normalized.split('\n');
    this.segments = buildSegments(this.originalLines, this.normalizedLines);
  }

  restore(current: string): string {
    const normalized = this.normalizedLines;
    const currentLines = current.split('\n');

    // normalized の各行が current に残っているか、normalized の各位置の直前に current で挿入された行は何か
    const kept = new Array<boolean>(normalized.length).fill(false);
    const inserted = new Map<number, string[]>();
    // 既存の行を置き換えずに、純粋に行が追加された位置
    const pureInsertions = new Set<number>();
    for (const h of diffLines(normalized, currentLines)) {
      if (h.equal) {
        for (let i = h.aStart; i < h.aEnd; i++) kept[i] = true;
      } else if (h.bEnd > h.bStart) {
        inserted.set(h.aStart, currentLines.slice(h.bStart, h.bEnd));
        if (h.aStart === h.aEnd) pureInsertions.add(h.aStart);
      }
    }

    const out: string[] = [];
    const emitted = new Set<number>();
    const emitInserted = (pos: number) => {
      const lines = inserted.get(pos);
      if (!lines || emitted.has(pos)) return;
      emitted.add(pos);
      for (const line of lines) out.push(fixVditorStyle(line));
    };

    for (const s of this.segments) {
      emitInserted(s.nStart);
      let untouched: boolean;
      if (s.nStart === s.nEnd) {
        // Vditor が消した行（例: 余分な空行）。前後どちらかが残っていれば元のまま残す
        const prevKept = s.nStart === 0 || kept[s.nStart - 1];
        const nextKept = s.nStart >= normalized.length || kept[s.nStart];
        untouched = prevKept || nextKept;
      } else {
        // Vditor が足した行（区切りの空行など）は、隣で行が追加されたら残す。
        // 消すと追加した行が直前のリストや引用の続きとして解釈されてしまう
        untouched = !(s.oStart === s.oEnd && (pureInsertions.has(s.nStart) || pureInsertions.has(s.nEnd)));
        for (let i = s.nStart; untouched && i < s.nEnd; i++) {
          if (!kept[i] || (i > s.nStart && inserted.has(i))) {
            untouched = false;
            break;
          }
        }
      }

      if (untouched) {
        for (let i = s.oStart; i < s.oEnd; i++) out.push(this.originalLines[i]);
      } else {
        // 編集された区間は、その区間の current（Vditor の書き方）をそのまま使う
        for (let i = s.nStart; i < s.nEnd; i++) {
          if (i > s.nStart) emitInserted(i);
          if (kept[i]) out.push(fixVditorStyle(normalized[i]));
        }
      }
    }
    emitInserted(normalized.length);
    return out.join('\n');
  }
}
