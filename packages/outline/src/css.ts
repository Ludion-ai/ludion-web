// CSS を読む：見出し、data: の素材、技術（CSS のアニメーション、トランジション、動きを減らす設定、外から読む物）。

import type { Unit } from './collect.ts';
import { findHeadings, headingRanges, type CommentLike } from './headings.ts';
import { closeLimit, utf8Bytes } from './text.ts';
import { classifyUrl } from './urls.ts';

const isIdentChar = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 45 || c === 95 || c >= 0x80;

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

/** data: の住所を素材として足し、それ以外を外から読む物として数える */
function addUrl(unit: Unit, value: string, offset: number, endOffset: number): void {
  const { col, file, index, text } = unit;
  const v = value.trim();
  if (v.startsWith('data:')) {
    const mime = /^data:([\w.+-]+\/[\w.+-]+)?/.exec(v)?.[1] ?? 'text/plain';
    col.section({ file, kind: 'asset', name: mime, mime, start: index.line(offset), end: index.line(endOffset - 1), depth: 0, language: unit.language, bytes: utf8Bytes(text, offset, endOffset) });
    return;
  }
  const url = classifyUrl(v, true);
  if (url) col.hit(url.id, file, index, offset, text.slice(offset, Math.min(endOffset, offset + 120)), url.host);
}

/**
 * CSS の1つの塊を読む。declarations：style 属性の中（宣言だけが並ぶ）。
 */
export function analyzeCss(unit: Unit, declarations = false): void {
  const { text, index, file, col } = unit;
  const { start, end } = unit;
  const comments: CommentLike[] = [];
  const commentOpen: number[] = [];
  const opens: number[] = [];
  /** 開き括弧の位置 → 閉じ括弧の位置 */
  const closeAt = new Map<number, number>();
  /** 今の文に、コメントと空白のほかの文字があるか */
  let content = false;
  let stmtStart = start;
  let atName: string | null = null;
  let atOffset = -1;
  let i = start;

  const endStatement = (stop: number, by: '{' | ';' | '}') => {
    if (atName !== null) {
      const prelude = text.slice(atOffset, Math.min(stop, atOffset + 400));
      if ((atName === 'keyframes' || atName === '-webkit-keyframes') && by === '{') col.hit('css-animation', file, index, atOffset, prelude.split('\n')[0]);
      if (atName === 'media' && /prefers-reduced-motion/i.test(prelude)) col.hit('reduced-motion', file, index, atOffset, prelude.split('\n')[0]);
    } else if (by !== '{' || declarations) {
      const head = text.slice(stmtStart, Math.min(stop, stmtStart + 200));
      const m = /^(\s*)(-?[a-zA-Z][\w-]*)\s*:/.exec(head);
      if (m && (by !== '{' || declarations)) {
        const property = m[2].toLowerCase();
        const valueText = head.slice(m[0].length);
        const at = stmtStart + m[1].length;
        if (/^(?:-webkit-)?animation(?:-name)?$/.test(property) && !/^\s*(?:none|initial|unset|inherit)\s*(?:!important)?\s*$/i.test(valueText)) col.hit('css-animation', file, index, at, m[2]);
        else if (/^(?:-webkit-)?transition(?:-property)?$/.test(property) && !/^\s*(?:none|initial|unset|inherit)\s*(?:!important)?\s*$/i.test(valueText)) col.hit('css-transition', file, index, at, m[2]);
      }
    }
    atName = null;
    stmtStart = stop + 1;
    content = false;
  };

  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 || close + 2 > end ? end : close + 2;
      comments.push({ start: i, end: stop, value: text.slice(i, stop), limit: -1 });
      commentOpen.push(opens.length ? opens[opens.length - 1] : -1);
      if (!content) stmtStart = stop;
      i = stop;
      continue;
    }
    if (c === 39 || c === 34) {
      const stop = skipQuoted(text, i, end);
      if (atName === 'import') addUrl(unit, text.slice(i + 1, Math.max(i + 1, stop - 1)), i, stop);
      i = stop;
      continue;
    }
    if ((c === 117 || c === 85) && text.slice(i, i + 4).toLowerCase() === 'url(' && !isIdentChar(text.charCodeAt(i - 1))) {
      let j = i + 4;
      while (j < end && /\s/.test(text[j])) j++;
      let valueStart = j;
      let valueEnd: number;
      if (text[j] === '"' || text[j] === "'") {
        const stop = skipQuoted(text, j, end);
        valueStart = j + 1;
        valueEnd = Math.max(valueStart, stop - 1);
        j = stop;
        const close = text.indexOf(')', j);
        j = close === -1 || close >= end ? end : close + 1;
      } else {
        const close = text.indexOf(')', j);
        valueEnd = close === -1 || close >= end ? end : close;
        j = close === -1 || close >= end ? end : close + 1;
      }
      addUrl(unit, text.slice(valueStart, valueEnd), i, j);
      i = j;
      continue;
    }
    if (c === 64 && atName === null && !content) {
      let j = i + 1;
      while (j < end && isIdentChar(text.charCodeAt(j))) j++;
      atName = text.slice(i + 1, j).toLowerCase();
      atOffset = i;
      i = j;
      continue;
    }
    if (c === 123) {
      endStatement(i, '{');
      opens.push(i);
    } else if (c === 59) {
      endStatement(i, ';');
    } else if (c === 125) {
      endStatement(i, '}');
      const open = opens.pop();
      if (open !== undefined) closeAt.set(open, i);
    } else if (!(c === 32 || c === 9 || c === 10 || c === 13 || c === 12)) content = true;
    i++;
  }
  if (text.slice(stmtStart, end).trim().length > 0) endStatement(end, ';');

  const unitEndLine = index.line(Math.max(start, end - 1));
  comments.forEach((comment, k) => {
    const open = commentOpen[k];
    const close = open === -1 ? undefined : closeAt.get(open);
    comment.limit = close === undefined ? -1 : closeLimit(index, close);
  });
  for (const { mark, end: last } of headingRanges(index, findHeadings(text, index, comments, unitEndLine), unitEndLine)) {
    col.section({ file, kind: 'heading', name: mark.name.slice(0, 120), start: mark.line, end: last, depth: 0, language: 'css' });
  }
}
