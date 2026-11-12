// 文字の位置から行の番号を引く表と、UTF-8 のバイト数。

/** 1つのファイルの行の頭の位置。line(offset) は 1 から数える。 */
export class LineIndex {
  readonly starts: number[];
  readonly text: string;
  constructor(text: string) {
    this.text = text;
    const starts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    this.starts = starts;
  }

  line(offset: number): number {
    const { starts } = this;
    // 終わりの位置（text.length）は、最後の文字の行
    if (offset >= this.text.length && this.text.length > 0) offset = this.text.length - 1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** 行の文字（改行を除く） */
  lineText(line: number): string {
    const start = this.starts[line - 1] ?? this.text.length;
    const next = this.starts[line];
    const end = next === undefined ? this.text.length : next - 1;
    return this.text.slice(start, end).replace(/\r$/, '');
  }

  private nonBlank: Int32Array | null = null;

  /** line から前へ見て、空白だけでない最後の行（なければ 0）。表は初めて要るときに1回だけ作る */
  lastNonBlank(line: number): number {
    if (!this.nonBlank) {
      const table = new Int32Array(this.starts.length + 1);
      for (let l = 1; l <= this.starts.length; l++) {
        const start = this.starts[l - 1];
        const next = this.starts[l];
        const end = next === undefined ? this.text.length : next - 1;
        let blank = true;
        for (let i = start; i < end; i++) {
          const c = this.text.charCodeAt(i);
          if (!(c === 32 || c === 9 || c === 13 || c === 12 || c === 11 || c === 0xa0 || c === 0x3000 || c === 0xfeff)) {
            blank = false;
            break;
          }
        }
        table[l] = blank ? table[l - 1] : l;
      }
      this.nonBlank = table;
    }
    return this.nonBlank[Math.min(Math.max(line, 0), this.starts.length)];
  }

  /** 列（行の頭からの文字の数） */
  column(offset: number): number {
    return offset - this.starts[this.line(offset) - 1];
  }
}

/** text の [start, end) の UTF-8 のバイト数。 */
export function utf8Bytes(text: string, start = 0, end = text.length): number {
  let bytes = 0;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < end) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** 行の数。最後の改行の後の空の行は数えない。 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
  return text.endsWith('\n') ? lines - 1 : lines;
}

/** 行の頭から最初の文字の前までの、字下げの文字の数（タブは 2 と数える）。行の途中から始まるときは -1。後ろから数えるので、長い行でも速い。 */
export function indentOf(text: string, offset: number): number {
  let width = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text.charCodeAt(i);
    if (ch === 10) return width;
    if (ch === 32) width += 1;
    else if (ch === 9) width += 2;
    else if (ch === 13) continue;
    else return -1; // 行の途中から始まる（コードの後ろのコメント）
  }
  return width;
}

/** 見出しを囲む括弧が閉じる位置から、見出しの終わりの上限の行。閉じ括弧で始まる行なら、その前の行。 */
export function closeLimit(index: LineIndex, closeOffset: number): number {
  const line = index.line(closeOffset);
  const head = index.lineText(line).trimStart();
  return line > 1 && /^[}\])]/.test(head) && index.column(closeOffset) === index.lineText(line).length - head.length ? line - 1 : line;
}
