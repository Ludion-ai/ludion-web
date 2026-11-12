// 2つの文字の、行の違い（WS004「2」）。依存を足さずに自分で書く。
//
// Myers の O(ND) の差を、線形のメモリで（真ん中のスネークで2つに分けて、両側を解く。GNU diff の compareseq と diag と同じ形）。
// - 行は文字のまま比べず、同じ行に同じ番号を振ってから比べる（Int32Array）。
// - 頭と尻の同じ行は、先に外す。
// - 再帰はしない（積み上げの配列で解く。違いの多いファイルでも、呼び出しの深さで落ちない）。
// - 手間の上限（maxCost）を超えたら、そのファイルは「全部を消して、全部を足した」と見なす（replaced）。
//   全く違う 5,000 行どうしでも、計算の時間に上限を付けるため。違いの数（増えた行、減った行）は、そのときも正しい上限になる。
// DOM と Node の API を使わない（Web Worker とテストで同じものを動かす）。

/** 行の違いの並び。op：0 同じ、1 消えた（前の版だけ）、2 増えた（後の版だけ）。a と b は、その塊の最初の行（0 から）。n は行の数 */
export interface DiffRun {
  op: 0 | 1 | 2;
  a: number;
  b: number;
  n: number;
}

export interface LineDiff {
  runs: DiffRun[];
  added: number;
  removed: number;
  /** 手間の上限を超えたので、全部を入れ替えたと見なした */
  replaced: boolean;
}

/** 既定の手間の上限（比べた回数）。全く違う 5,000 行どうし（約 2,500 万回）より大きく、手元の CPU を 4 倍遅くしても数秒で終わる大きさ */
export const DEFAULT_MAX_COST = 60_000_000;

/** 文字を行に分ける。最後の改行の後の空の行は数えない（地図の行の数と同じ数え方）。空の文字は 0 行 */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 2つの行の並びに、同じ行は同じ番号を振る */
function numberLines(a: string[], b: string[]): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const toIds = (lines: string[]) => {
    const out = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      let id = ids.get(lines[i]);
      if (id === undefined) {
        id = ids.size;
        ids.set(lines[i], id);
      }
      out[i] = id;
    }
    return out;
  };
  return [toIds(a), toIds(b)];
}

class TooExpensive extends Error {}

/** 行の違い。a が前の版、b が後の版。 */
export function diffLines(aLines: string[], bLines: string[], maxCost = DEFAULT_MAX_COST): LineDiff {
  const [a, b] = numberLines(aLines, bLines);
  const n = a.length;
  const m = b.length;
  const deleted = new Uint8Array(n);
  const inserted = new Uint8Array(m);
  // 対角線の番号は x - y。いちばん小さいのは -m - 1、いちばん大きいのは n + 1
  const offset = m + 1;
  const fd = new Int32Array(n + m + 3);
  const bd = new Int32Array(n + m + 3);
  let cost = 0;

  /** 真ん中のスネークを探して、そこで2つに分ける点を返す */
  const middle = (xoff: number, xlim: number, yoff: number, ylim: number): [number, number] => {
    const dmin = xoff - ylim;
    const dmax = xlim - yoff;
    const fmid = xoff - yoff;
    const bmid = xlim - ylim;
    let fmin = fmid;
    let fmax = fmid;
    let bmin = bmid;
    let bmax = bmid;
    const odd = ((fmid - bmid) & 1) !== 0;
    fd[offset + fmid] = xoff;
    bd[offset + bmid] = xlim;
    for (;;) {
      // 上から（前から）、どの対角線も1手ずつ進める
      if (fmin > dmin) fd[offset + --fmin - 1] = -1;
      else ++fmin;
      if (fmax < dmax) fd[offset + ++fmax + 1] = -1;
      else --fmax;
      for (let d = fmax; d >= fmin; d -= 2) {
        const tlo = fd[offset + d - 1];
        const thi = fd[offset + d + 1];
        let x = tlo < thi ? thi : tlo + 1;
        let y = x - d;
        while (x < xlim && y < ylim && a[x] === b[y]) {
          x++;
          y++;
        }
        cost += x - (tlo < thi ? thi : tlo + 1) + 1;
        fd[offset + d] = x;
        if (odd && bmin <= d && d <= bmax && bd[offset + d] <= x) return [x, y];
      }
      // 下から（後ろから）も同じに
      if (bmin > dmin) bd[offset + --bmin - 1] = 0x7fffffff;
      else ++bmin;
      if (bmax < dmax) bd[offset + ++bmax + 1] = 0x7fffffff;
      else --bmax;
      for (let d = bmax; d >= bmin; d -= 2) {
        const tlo = bd[offset + d - 1];
        const thi = bd[offset + d + 1];
        let x = tlo < thi ? tlo : thi - 1;
        let y = x - d;
        while (xoff < x && yoff < y && a[x - 1] === b[y - 1]) {
          x--;
          y--;
        }
        cost += (tlo < thi ? tlo : thi - 1) - x + 1;
        bd[offset + d] = x;
        if (!odd && fmin <= d && d <= fmax && x <= fd[offset + d]) return [x, y];
      }
      if (cost > maxCost) throw new TooExpensive();
    }
  };

  let replaced = false;
  try {
    const stack: number[] = [0, n, 0, m];
    while (stack.length > 0) {
      let ylim = stack.pop()!;
      let yoff = stack.pop()!;
      let xlim = stack.pop()!;
      let xoff = stack.pop()!;
      while (xoff < xlim && yoff < ylim && a[xoff] === b[yoff]) {
        xoff++;
        yoff++;
      }
      while (xoff < xlim && yoff < ylim && a[xlim - 1] === b[ylim - 1]) {
        xlim--;
        ylim--;
      }
      if (xoff === xlim) {
        for (let y = yoff; y < ylim; y++) inserted[y] = 1;
      } else if (yoff === ylim) {
        for (let x = xoff; x < xlim; x++) deleted[x] = 1;
      } else {
        const [xmid, ymid] = middle(xoff, xlim, yoff, ylim);
        // 後ろの半分を先に積み、前の半分から解く（順は結果に関わらない）
        stack.push(xmid, xlim, ymid, ylim, xoff, xmid, yoff, ymid);
      }
    }
  } catch (error) {
    if (!(error instanceof TooExpensive)) throw error;
    replaced = true;
    // 頭と尻の同じ行だけは残し、間を全部入れ替えたと見なす
    deleted.fill(0);
    inserted.fill(0);
    let head = 0;
    while (head < n && head < m && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
    deleted.fill(1, head, n - tail);
    inserted.fill(1, head, m - tail);
  }

  // 印から、塊の並びを作る。変わった所は、消えた行を先に、増えた行を後に
  const runs: DiffRun[] = [];
  const push = (op: 0 | 1 | 2, x: number, y: number) => {
    const last = runs[runs.length - 1];
    const joins = last && last.op === op && (op === 2 || last.a + last.n === x) && (op === 1 || last.b + last.n === y);
    if (joins) {
      last.n++;
      return;
    }
    runs.push({ op, a: x, b: y, n: 1 });
  };
  let x = 0;
  let y = 0;
  let added = 0;
  let removed = 0;
  while (x < n || y < m) {
    if (x < n && deleted[x]) {
      push(1, x, y);
      removed++;
      x++;
    } else if (y < m && inserted[y]) {
      push(2, x, y);
      added++;
      y++;
    } else {
      push(0, x, y);
      x++;
      y++;
    }
  }
  return { runs, added, removed, replaced };
}

/** 画面に出す1行。kind：same（同じ）、del（消えた）、add（増えた）、fold（たたんだ同じ行。count 行） */
export type DiffRow =
  | { kind: 'same'; a: number; b: number }
  | { kind: 'del'; a: number }
  | { kind: 'add'; b: number }
  | { kind: 'fold'; a: number; b: number; count: number };

/**
 * 塊の並びを、画面の行にする。変わった所の前後 context 行だけを出し、ほかの同じ行は fold の1行にたたむ。
 * open に入っている fold（a の行の番号で見る）は、たたまずに出す。
 */
export function diffRows(runs: DiffRun[], context = 3, open: ReadonlySet<number> = new Set()): DiffRow[] {
  const rows: DiffRow[] = [];
  runs.forEach((run, index) => {
    if (run.op === 1) {
      for (let i = 0; i < run.n; i++) rows.push({ kind: 'del', a: run.a + i });
      return;
    }
    if (run.op === 2) {
      for (let i = 0; i < run.n; i++) rows.push({ kind: 'add', b: run.b + i });
      return;
    }
    const before = index > 0 ? context : 0;
    const after = index < runs.length - 1 ? context : 0;
    if (run.n <= before + after + 1 || open.has(run.a + before)) {
      for (let i = 0; i < run.n; i++) rows.push({ kind: 'same', a: run.a + i, b: run.b + i });
      return;
    }
    for (let i = 0; i < before; i++) rows.push({ kind: 'same', a: run.a + i, b: run.b + i });
    const count = run.n - before - after;
    rows.push({ kind: 'fold', a: run.a + before, b: run.b + before, count });
    for (let i = run.n - after; i < run.n; i++) rows.push({ kind: 'same', a: run.a + i, b: run.b + i });
  });
  return rows;
}
