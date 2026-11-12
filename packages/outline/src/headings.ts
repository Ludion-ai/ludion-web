// 線の見出し（// ---- 名前、// ==== 名前 ====、/* ---- 名前 */、<!-- ==== 名前 ==== -->）と、線で挟んだ見出し。

import { indentOf, type LineIndex } from './text.ts';

/** 見出しの候補。level は字下げの順位で決める（findHeadings の後で）。 */
export interface HeadingMark {
  name: string;
  /** 名前が書いてある行 */
  line: number;
  /** 字下げの文字の数 */
  indent: number;
  /** 見出しを囲む括弧が閉じる行（なければ、その塊の終わり） */
  limit: number;
}

/** 線に使う文字 */
const RULE_CHARS = new Set(['-', '=', '─', '━', '═', '~', '*', '#', '_', '+', '•', '·', '—', '–']);
/** 長すぎる行は見出しとして見ない（作り手の入れた文字で遅くならないように） */
const MAX_LINE = 240;

/** 行の頭と終わりにある、同じ文字の3つ以上の並び（線）を外す。線がなければ null。 */
function stripRule(raw: string): { name: string; ruled: boolean } | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > MAX_LINE) return null;
  const first = s[0];
  if (!RULE_CHARS.has(first)) return null;
  let i = 0;
  while (i < s.length && s[i] === first) i++;
  if (i < 3) return null;
  let rest = s.slice(i).trim();
  // 後ろの線
  if (rest.length > 0) {
    const last = rest[rest.length - 1];
    if (RULE_CHARS.has(last)) {
      let j = rest.length;
      while (j > 0 && rest[j - 1] === last) j--;
      if (rest.length - j >= 3 || (last === first && rest.length - j >= 2)) rest = rest.slice(0, j).trim();
    }
  }
  return { name: rest, ruled: true };
}

/** 名前として読めるか（文字か数字を含む） */
const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);

export interface CommentLike {
  start: number;
  end: number;
  value: string;
  /** 見出しを囲む括弧が閉じる行（なければ -1） */
  limit: number;
}

/** コメントの中の文字。// と /* … *\/ と <!-- … --> の印を外し、行に分ける。 */
function commentLines(value: string): { lines: string[]; block: boolean } {
  if (value.startsWith('//')) return { lines: [value.slice(2)], block: false };
  let inner = value;
  if (inner.startsWith('/*')) inner = inner.slice(2, inner.endsWith('*/') ? -2 : undefined);
  else if (inner.startsWith('<!--')) inner = inner.slice(4, inner.endsWith('-->') ? -3 : undefined);
  const lines = inner.split('\n').map((line) => line.replace(/\r$/, '').replace(/^\s*\*(?!\*)/, ''));
  return { lines, block: true };
}

/**
 * コメントの並びから見出しを探す。comments は位置の順。
 * - 1行の見出し：線 + 名前（+ 線）
 * - 挟んだ見出し：線だけの行、名前の行（1行以上）、（線だけの行）。名前は最初の行
 */
export function findHeadings(text: string, index: LineIndex, comments: CommentLike[], unitEnd: number): HeadingMark[] {
  const marks: HeadingMark[] = [];
  let pendingRule: { line: number; indent: number } | null = null;
  let lastLine = -10;
  for (const comment of comments) {
    const indent = indentOf(text, comment.start);
    const line = index.line(comment.start);
    const limit = comment.limit === -1 ? unitEnd : comment.limit;
    // 行の途中から始まるコメントは見出しにしない
    if (indent < 0) {
      pendingRule = null;
      continue;
    }
    if (line !== lastLine + 1) pendingRule = null;
    const endLine = index.line(Math.max(comment.start, comment.end - 1));
    lastLine = endLine;
    const { lines, block } = commentLines(comment.value);
    if (lines.length > 30) {
      pendingRule = null;
      continue;
    }
    if (!block) {
      const raw = lines[0];
      const stripped = stripRule(raw);
      if (stripped && stripped.name.length > 0 && hasWord(stripped.name)) {
        marks.push({ name: stripped.name, line, indent, limit });
        pendingRule = null;
      } else if (stripped && stripped.name.length === 0) {
        pendingRule = { line, indent };
      } else if (pendingRule && raw.trim().length > 0 && raw.trim().length <= MAX_LINE && hasWord(raw)) {
        // 線の次の行の文字が、挟んだ見出しの名前
        marks.push({ name: raw.trim(), line, indent: pendingRule.indent, limit });
        pendingRule = null;
        lastLine = -10;
      } else pendingRule = null;
      continue;
    }
    pendingRule = null;
    // ブロックのコメント：中の最初の見出しの行か、線の次の名前の行
    let afterRule = false;
    for (let k = 0; k < lines.length; k++) {
      const raw = lines[k];
      if (raw.trim().length === 0) continue;
      const stripped = stripRule(raw);
      if (stripped && stripped.name.length > 0 && hasWord(stripped.name)) {
        marks.push({ name: stripped.name, line: line + k, indent, limit });
        break;
      }
      if (stripped && stripped.name.length === 0) {
        afterRule = true;
        continue;
      }
      if (afterRule && raw.trim().length <= MAX_LINE && hasWord(raw)) {
        marks.push({ name: raw.trim(), line: line + k, indent, limit });
      }
      break;
    }
  }
  return marks;
}

/** 見出しの終わりの行：次の、同じかより浅い見出しの前の行。囲む括弧の終わりで切る。後ろの空の行は外す。 */
export function headingRanges(index: LineIndex, marks: HeadingMark[], unitEnd: number): { mark: HeadingMark; level: number; end: number }[] {
  const indents = [...new Set(marks.map((mark) => mark.indent))].sort((a, b) => a - b);
  const levelOf = new Map(indents.map((indent, level) => [indent, level]));
  const out: { mark: HeadingMark; level: number; end: number }[] = [];
  // 後ろから見て、各の深さの次の見出しの行を持つ
  const nextAtOrAbove: number[] = new Array(indents.length).fill(Infinity);
  const ends: number[] = new Array(marks.length);
  for (let k = marks.length - 1; k >= 0; k--) {
    const level = levelOf.get(marks[k].indent)!;
    const next = nextAtOrAbove[level];
    let end = Math.min(next === Infinity ? unitEnd : next - 1, marks[k].limit, unitEnd);
    // 後ろの空の行を外す（空の行の表で1回で）
    ends[k] = Math.max(index.lastNonBlank(end), marks[k].line);
    for (let l = level; l < indents.length; l++) nextAtOrAbove[l] = marks[k].line;
  }
  for (let k = 0; k < marks.length; k++) out.push({ mark: marks[k], level: levelOf.get(marks[k].indent)!, end: ends[k] });
  return out;
}
