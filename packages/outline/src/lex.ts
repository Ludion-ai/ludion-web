// JS の字句の分け方。コメント、文字列、テンプレート文字列、正規表現を、コードと分ける（WS002「読み方」）。
// 構文の木は作らない。1回なめるだけ（234 KB で数 ms）。後戻りする正規表現は使わない（作り手の入れた文字で遅くならないように）。

export type TokenType = 'ident' | 'punct' | 'string' | 'template' | 'regex' | 'number' | 'comment';

export interface Token {
  type: TokenType;
  /** 文字の位置 [start, end) */
  start: number;
  end: number;
  /** ident と punct：その文字。string：中身（引用符を外し、よくある \ の書き方を戻したもの）。template：` の間の生の文字 */
  value: string;
  /** 開き括弧（( [ {）：対になる閉じ括弧の、sig の中の番号。閉じていない、または括弧でなければ -1 */
  match: number;
  /** コメント：そのコメントを囲む開き括弧の、sig の中の番号（なければ -1）。閉じ括弧：対になる開き括弧の番号 */
  enclosing: number;
  /** テンプレート：${ … } を含むか */
  hasExpr: boolean;
}

export interface Lexed {
  /** コメントを除いた字句 */
  sig: Token[];
  comments: Token[];
}

/** 記号の長さ（=== や => を1つの字句にする） */
function punctWidth(text: string, i: number): number {
  const n = text.charCodeAt(i + 1);
  const n2 = text.charCodeAt(i + 2);
  switch (text.charCodeAt(i)) {
    case 61: // =
      if (n === 61) return n2 === 61 ? 3 : 2;
      return n === 62 ? 2 : 1;
    case 33: // !
      if (n === 61) return n2 === 61 ? 3 : 2;
      return 1;
    case 62: // >
      if (n === 62) {
        if (n2 === 62) return text.charCodeAt(i + 3) === 61 ? 4 : 3;
        return n2 === 61 ? 3 : 2;
      }
      return n === 61 ? 2 : 1;
    case 60: // <
      if (n === 60) return n2 === 61 ? 3 : 2;
      return n === 61 ? 2 : 1;
    case 38: // &
    case 124: // |
    case 42: // *
      if (n === text.charCodeAt(i)) return n2 === 61 ? 3 : 2;
      return n === 61 ? 2 : 1;
    case 63: // ?
      if (n === 63) return n2 === 61 ? 3 : 2;
      // ?. の後に数字が来るときは ? と . （a?.5:b）
      return n === 46 && !(n2 >= 48 && n2 <= 57) ? 2 : 1;
    case 46: // .
      return n === 46 && n2 === 46 ? 3 : 1;
    case 43: // +
    case 45: // -
      return n === text.charCodeAt(i) || n === 61 ? 2 : 1;
    case 47: // /
    case 37: // %
    case 94: // ^
      return n === 61 ? 2 : 1;
    default:
      return 1;
  }
}

const token = (type: TokenType, start: number, end: number, value: string, hasExpr = false, enclosing = -1): Token => ({ type, start, end, value, match: -1, enclosing, hasExpr });
/** この言葉の後の / は正規表現の始まり */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

const isIdentStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95 || c >= 0x80 || c === 92;
const isIdentPart = (c: number) => isIdentStart(c) || (c >= 48 && c <= 57);
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029 || (c >= 0x2000 && c <= 0x200a) || c === 0x3000;

/** この言葉の ( … ) の後の / は正規表現の始まり（if (x) /re/.test(s)） */
const CONTROL = new Set(['if', 'while', 'for', 'with']);

function regexAllowed(sig: Token[]): boolean {
  const prev = sig[sig.length - 1];
  if (!prev) return true;
  switch (prev.type) {
    case 'punct':
      if (prev.value === ')') {
        // 閉じ括弧の enclosing は、対になる開き括弧の番号
        const before = sig[prev.enclosing - 1];
        return before !== undefined && before.type === 'ident' && CONTROL.has(before.value);
      }
      return !(prev.value === ']' || prev.value === '++' || prev.value === '--');
    case 'ident':
      return REGEX_AFTER_WORD.has(prev.value);
    default:
      return false;
  }
}

/** 引用符で囲んだ文字列の終わり（閉じる引用符の次）。改行で閉じていなければ、そこで終わる。 */
function skipQuoted(text: string, i: number, end: number): number {
  const quote = text.charCodeAt(i);
  let j = i + 1;
  while (j < end) {
    const c = text.charCodeAt(j);
    if (c === 92) j += 2;
    else if (c === quote) return j + 1;
    else if (c === 10) return j;
    else j++;
  }
  return end;
}

/** ブロックのコメントの終わり */
function skipBlockComment(text: string, i: number, end: number): number {
  const close = text.indexOf('*/', i + 2);
  return close === -1 || close + 2 > end ? end : close + 2;
}

/**
 * テンプレート文字列の終わり（` の次）。${ … } の中は、文字列、コメント、入れ子のテンプレートを飛ばして括弧を数える。
 * 入れ子は再帰でなく、自分の積み重ね（frames）で数える（深い入れ子でも止まらないように）。
 */
function skipTemplate(text: string, i: number, end: number, flags: { expr: boolean }): number {
  // frames の各段：-1 はテンプレートの中、0 以上は ${ の中の { の深さ
  const frames: number[] = [-1];
  let j = i + 1;
  while (j < end) {
    const c = text.charCodeAt(j);
    const top = frames[frames.length - 1];
    if (top === -1) {
      if (c === 92) j += 2;
      else if (c === 96) {
        frames.pop();
        j++;
        if (frames.length === 0) return j;
      } else if (c === 36 && text.charCodeAt(j + 1) === 123) {
        if (frames.length === 1) flags.expr = true;
        frames.push(1);
        j += 2;
      } else j++;
      continue;
    }
    if (c === 123) {
      frames[frames.length - 1]++;
      j++;
    } else if (c === 125) {
      j++;
      if (--frames[frames.length - 1] === 0) frames.pop();
    } else if (c === 39 || c === 34) j = skipQuoted(text, j, end);
    else if (c === 96) {
      frames.push(-1);
      j++;
    } else if (c === 47 && text.charCodeAt(j + 1) === 47) {
      const nl = text.indexOf('\n', j);
      j = nl === -1 || nl > end ? end : nl;
    } else if (c === 47 && text.charCodeAt(j + 1) === 42) j = skipBlockComment(text, j, end);
    else j++;
  }
  return end;
}

/** 正規表現の終わり。改行までに閉じなければ -1（割り算として読む）。 */
function skipRegex(text: string, i: number, end: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < end) {
    const c = text.charCodeAt(j);
    if (c === 10 || c === 13) return -1;
    if (c === 92) j += 2;
    else if (c === 91) {
      inClass = true;
      j++;
    } else if (c === 93) {
      inClass = false;
      j++;
    } else if (c === 47 && !inClass) {
      j++;
      while (j < end && isIdentPart(text.charCodeAt(j))) j++;
      return j;
    } else j++;
  }
  return -1;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

/** 文字列の中身。よくある \ の書き方だけを戻す（見分けに使うだけなので、全部は要らない）。 */
function cook(raw: string): string {
  if (!raw.includes('\\')) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[++i] ?? '';
    if (next === '\n') continue;
    out += ESCAPES[next] ?? next;
  }
  return out;
}

/** text の [start, end) を字句に分ける。位置は text の中の位置のまま（文書の中の script でも、行の番号がそのまま使える）。 */
export function lex(text: string, start = 0, end = text.length): Lexed {
  const sig: Token[] = [];
  const comments: Token[] = [];
  const stack: number[] = [];
  let i = start;
  // 先頭の #!（hashbang）
  if (text.startsWith('#!', i)) {
    const nl = text.indexOf('\n', i);
    const stop = nl === -1 || nl > end ? end : nl;
    comments.push(token('comment', i, stop, text.slice(i, stop)));
    i = stop;
  }
  const push = (t: Token) => {
    if (t.type === 'punct') {
      const v = t.value;
      if (v === '(' || v === '[' || v === '{') {
        stack.push(sig.length);
      } else if (v === ')' || v === ']' || v === '}') {
        const open = v === ')' ? '(' : v === ']' ? '[' : '{';
        // 合わない閉じ括弧は、合う開き括弧まで戻る（壊れたコードでも、残りを読めるように）
        for (let k = stack.length - 1; k >= 0; k--) {
          if (sig[stack[k]].value === open) {
            sig[stack[k]].match = sig.length;
            t.enclosing = stack[k];
            stack.length = k;
            break;
          }
        }
      }
    }
    sig.push(t);
  };

  while (i < end) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    const next = text.charCodeAt(i + 1);
    if (c === 47 && next === 47) {
      const nl = text.indexOf('\n', i);
      const stop = nl === -1 || nl > end ? end : nl;
      comments.push(token('comment', i, stop, text.slice(i, stop), false, stack.length ? stack[stack.length - 1] : -1));
      i = stop;
      continue;
    }
    if (c === 47 && next === 42) {
      const stop = skipBlockComment(text, i, end);
      comments.push(token('comment', i, stop, text.slice(i, stop), false, stack.length ? stack[stack.length - 1] : -1));
      i = stop;
      continue;
    }
    if (c === 39 || c === 34) {
      const stop = skipQuoted(text, i, end);
      const closed = text.charCodeAt(stop - 1) === c && stop - 1 > i;
      push(token('string', i, stop, cook(text.slice(i + 1, closed ? stop - 1 : stop))));
      i = stop;
      continue;
    }
    if (c === 96) {
      const flags = { expr: false };
      const stop = skipTemplate(text, i, end, flags);
      const closed = text.charCodeAt(stop - 1) === 96 && stop - 1 > i;
      push(token('template', i, stop, text.slice(i + 1, closed ? stop - 1 : stop), flags.expr));
      i = stop;
      continue;
    }
    if (c === 47 && regexAllowed(sig)) {
      const stop = skipRegex(text, i, end);
      if (stop !== -1) {
        push(token('regex', i, stop, text.slice(i, stop)));
        i = stop;
        continue;
      }
    }
    if ((c >= 48 && c <= 57) || (c === 46 && next >= 48 && next <= 57)) {
      let j = i + 1;
      while (j < end) {
        const d = text.charCodeAt(j);
        if (isIdentPart(d) || d === 46) j++;
        else if ((d === 43 || d === 45) && (text.charCodeAt(j - 1) | 32) === 101 && !/^0[xX]/.test(text.slice(i, i + 2))) j++;
        else break;
      }
      push(token('number', i, j, text.slice(i, j)));
      i = j;
      continue;
    }
    if (isIdentStart(c) || c === 35) {
      let j = i + 1;
      while (j < end && isIdentPart(text.charCodeAt(j))) j++;
      push(token('ident', i, j, text.slice(i, j)));
      i = j;
      continue;
    }
    const width = punctWidth(text, i);
    const stop = Math.min(i + width, end);
    push(token('punct', i, stop, text.slice(i, stop)));
    i = stop;
  }
  return { sig, comments };
}
