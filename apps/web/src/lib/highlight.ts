// 作品のページの本文の色付け（WS003）：HTML、CSS、JS、GLSL。
// 字句に分けるだけで、構文の木は作らない。1回なめるだけ（後戻りする正規表現を、作り手の入れた長い文字に当てない）。
// 結果は「どこからどこまでが、どの種類か」の並びだけ。画面には React の文字として描く（HTML の文字列にしない。CLAUDE.md 原則7）。

import { lex, type Token } from '@ludion/outline/lex';

/** 色の種類。0 は地の文字（並びには入れない） */
export const TOKEN_COMMENT = 1;
export const TOKEN_STRING = 2;
export const TOKEN_KEYWORD = 3;
export const TOKEN_NUMBER = 4;
export const TOKEN_NAME = 5;

/** 色付けの結果：start の順に並んだ、重ならない区間 */
export interface Tokens {
  starts: Int32Array;
  ends: Int32Array;
  types: Uint8Array;
}

export type CodeLanguage = 'html' | 'css' | 'js' | 'glsl';

/** JS の文字列の中の GLSL（地図のシェーダーの分け目）。行は 1 から数え、end を含む */
export interface ShaderRange {
  start: number;
  end: number;
}

class Builder {
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  private readonly types: number[] = [];

  add(start: number, end: number, type: number): void {
    if (end > start) {
      this.starts.push(start);
      this.ends.push(end);
      this.types.push(type);
    }
  }

  build(): Tokens {
    return { starts: Int32Array.from(this.starts), ends: Int32Array.from(this.ends), types: Uint8Array.from(this.types) };
  }
}

const JS_KEYWORDS = new Set(
  'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield'.split(
    ' ',
  ),
);
const JS_VALUES = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const GLSL_KEYWORDS = new Set(
  'attribute break case const continue default discard do else flat for highp if in inout invariant layout lowp mediump out precision return smooth struct switch uniform varying while centroid'.split(
    ' ',
  ),
);
const GLSL_TYPES = new Set(
  'void bool int uint float double vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 mat2x3 mat3x2 mat2x4 mat4x2 mat3x4 mat4x3 sampler2D sampler3D samplerCube sampler2DArray sampler2DShadow isampler2D usampler2D'.split(
    ' ',
  ),
);
const GLSL_VALUES = new Set(['true', 'false']);

const isIdentStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36 || c >= 0x80;
const isIdentPart = (c: number) => isIdentStart(c) || (c >= 48 && c <= 57);
const isDigit = (c: number) => c >= 48 && c <= 57;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;

/** 行の頭の位置（0 から数える行 → 文字の位置） */
export function lineStartsOf(text: string): Int32Array {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return Int32Array.from(starts);
}

/** 文字の位置が入っている行（0 から数える） */
function lineAt(lineStarts: Int32Array, offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** GLSL：コメント、#で始まる行、数、決まった語、型。${ … }（JS のテンプレートの差し込み）は文字列の色 */
function scanGlsl(text: string, start: number, end: number, out: Builder): void {
  let i = start;
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === 47 && text.charCodeAt(i + 1) === 47) {
      let j = text.indexOf('\n', i);
      if (j === -1 || j > end) j = end;
      out.add(i, j, TOKEN_COMMENT);
      i = j;
    } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const close = text.indexOf('*/', i + 2);
      const j = close === -1 || close + 2 > end ? end : close + 2;
      out.add(i, j, TOKEN_COMMENT);
      i = j;
    } else if (c === 35) {
      // #version、#define など：その語だけ
      let j = i + 1;
      while (j < end && isIdentPart(text.charCodeAt(j))) j++;
      out.add(i, j, TOKEN_KEYWORD);
      i = j;
    } else if (c === 36 && text.charCodeAt(i + 1) === 123) {
      // ${ … }：閉じ括弧まで（入れ子は数える）
      let depth = 1;
      let j = i + 2;
      while (j < end && depth > 0) {
        const d = text.charCodeAt(j);
        if (d === 123) depth++;
        else if (d === 125) depth--;
        j++;
      }
      out.add(i, j, TOKEN_STRING);
      i = j;
    } else if (isDigit(c) || (c === 46 && isDigit(text.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text.charCodeAt(j) === 46)) j++;
      out.add(i, j, TOKEN_NUMBER);
      i = j;
    } else if (isIdentStart(c)) {
      let j = i + 1;
      while (j < end && isIdentPart(text.charCodeAt(j))) j++;
      const word = text.slice(i, j);
      if (GLSL_KEYWORDS.has(word)) out.add(i, j, TOKEN_KEYWORD);
      else if (GLSL_TYPES.has(word)) out.add(i, j, TOKEN_NAME);
      else if (GLSL_VALUES.has(word)) out.add(i, j, TOKEN_NUMBER);
      i = j;
    } else i++;
  }
}

/** JS：コメント、文字列、数、決まった語。シェーダーの分け目の中の文字列は、中身を GLSL として色付けする */
function scanJs(text: string, start: number, end: number, out: Builder, lineStarts: Int32Array, shaders: ShaderRange[]): void {
  const { sig, comments } = lex(text, start, end);
  const inShader = (token: Token) => {
    if (shaders.length === 0) return false;
    const first = lineAt(lineStarts, token.start) + 1;
    const last = lineAt(lineStarts, Math.max(token.start, token.end - 1)) + 1;
    return shaders.some((range) => first >= range.start && last <= range.end);
  };
  // コメントと字句は別の並びで来る。どちらも位置の順なので、前から混ぜる
  let c = 0;
  for (const token of sig) {
    while (c < comments.length && comments[c].start < token.start) {
      out.add(comments[c].start, comments[c].end, TOKEN_COMMENT);
      c++;
    }
    if (token.type === 'string' || token.type === 'template') {
      if (token.end - token.start > 2 && inShader(token)) {
        // 引用符は文字列の色、中身は GLSL
        out.add(token.start, token.start + 1, TOKEN_STRING);
        scanGlsl(text, token.start + 1, token.end - 1, out);
        out.add(token.end - 1, token.end, TOKEN_STRING);
      } else out.add(token.start, token.end, TOKEN_STRING);
    } else if (token.type === 'regex') out.add(token.start, token.end, TOKEN_STRING);
    else if (token.type === 'number') out.add(token.start, token.end, TOKEN_NUMBER);
    else if (token.type === 'ident') {
      if (JS_KEYWORDS.has(token.value)) out.add(token.start, token.end, TOKEN_KEYWORD);
      else if (JS_VALUES.has(token.value)) out.add(token.start, token.end, TOKEN_NUMBER);
    }
  }
  for (; c < comments.length; c++) out.add(comments[c].start, comments[c].end, TOKEN_COMMENT);
}

/** 引用符で囲んだ文字の終わり（閉じる引用符の次）。行の終わりでは止めない（CSS と HTML の値は行をまたげる） */
function skipQuoted(text: string, i: number, end: number, escapes: boolean): number {
  const quote = text.charCodeAt(i);
  let j = i + 1;
  while (j < end) {
    const c = text.charCodeAt(j);
    if (escapes && c === 92) j += 2;
    else if (c === quote) return j + 1;
    else j++;
  }
  return end;
}

/** CSS：コメント、文字列、@ の語、宣言の名前（{ } の中の「名前:」）、数と色。declarations：style 属性の中（宣言だけ） */
function scanCss(text: string, start: number, end: number, out: Builder, declarations = false): void {
  let depth = declarations ? 1 : 0;
  /** 今の文で、まだ名前（: の前）を読んでいない */
  let atNameStart = true;
  let i = start;
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const close = text.indexOf('*/', i + 2);
      const j = close === -1 || close + 2 > end ? end : close + 2;
      out.add(i, j, TOKEN_COMMENT);
      i = j;
    } else if (c === 34 || c === 39) {
      const j = skipQuoted(text, i, end, true);
      out.add(i, j, TOKEN_STRING);
      i = j;
      atNameStart = false;
    } else if (c === 64) {
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text.charCodeAt(j) === 45)) j++;
      out.add(i, j, TOKEN_KEYWORD);
      i = j;
      atNameStart = false;
    } else if (c === 123) {
      depth++;
      atNameStart = true;
      i++;
    } else if (c === 125) {
      depth = Math.max(0, depth - 1);
      atNameStart = true;
      i++;
    } else if (c === 59) {
      atNameStart = true;
      i++;
    } else if (isSpace(c)) i++;
    else if (depth > 0 && atNameStart && (isIdentStart(c) || c === 45)) {
      // 宣言の名前：次の空白でない文字が : のときだけ（入れ子のセレクタを名前にしない）
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text.charCodeAt(j) === 45)) j++;
      let k = j;
      while (k < end && isSpace(text.charCodeAt(k))) k++;
      if (text.charCodeAt(k) === 58 && text.charCodeAt(k + 1) !== 58) out.add(i, j, TOKEN_NAME);
      i = j;
      atNameStart = false;
    } else if (!atNameStart && (isDigit(c) || (c === 46 && isDigit(text.charCodeAt(i + 1))) || (c === 35 && depth > 0))) {
      // 数と単位、#色
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text.charCodeAt(j) === 46 || text.charCodeAt(j) === 37)) j++;
      out.add(i, j, TOKEN_NUMBER);
      i = j;
    } else if (c === 33) {
      // !important
      let j = i + 1;
      while (j < end && isIdentPart(text.charCodeAt(j))) j++;
      out.add(i, j, TOKEN_KEYWORD);
      i = j;
    } else if (isIdentStart(c) || c === 45) {
      // ほかの語（値、セレクタ）は地の色。数の途中から始めないよう、語の終わりまで進む
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text.charCodeAt(j) === 45)) j++;
      i = j;
      atNameStart = false;
    } else {
      i++;
      atNameStart = false;
    }
  }
}

/** 閉じタグ（</name）の位置。なければ end */
function closeTagAt(text: string, name: string, from: number, end: number): number {
  const lower = `</${name}`;
  let i = from;
  while (i < end) {
    const at = text.indexOf('</', i);
    if (at === -1 || at >= end) return end;
    if (text.slice(at, at + lower.length).toLowerCase() === lower) return at;
    i = at + 2;
  }
  return end;
}

const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript', 'text/babel']);

/** HTML：コメント、タグの名前、属性の名前と値。<style> の中は CSS、<script> の中は JS（x-shader は GLSL） */
function scanHtml(text: string, start: number, end: number, out: Builder, lineStarts: Int32Array, shaders: ShaderRange[]): void {
  let i = start;
  while (i < end) {
    const lt = text.indexOf('<', i);
    if (lt === -1 || lt >= end) break;
    if (text.startsWith('<!--', lt)) {
      const close = text.indexOf('-->', lt + 4);
      const j = close === -1 || close + 3 > end ? end : close + 3;
      out.add(lt, j, TOKEN_COMMENT);
      i = j;
      continue;
    }
    const c = text.charCodeAt(lt + 1);
    if (c === 33 || c === 63) {
      // <!doctype>、<?xml?>
      const close = text.indexOf('>', lt + 2);
      const j = close === -1 || close >= end ? end : close + 1;
      out.add(lt, j, TOKEN_COMMENT);
      i = j;
      continue;
    }
    const closing = c === 47;
    let j = lt + (closing ? 2 : 1);
    const first = text.charCodeAt(j);
    if (!((first >= 97 && first <= 122) || (first >= 65 && first <= 90))) {
      i = lt + 1;
      continue;
    }
    while (j < end && !isSpace(text.charCodeAt(j)) && text.charCodeAt(j) !== 62 && text.charCodeAt(j) !== 47) j++;
    const name = text.slice(lt + (closing ? 2 : 1), j).toLowerCase();
    out.add(lt, j, TOKEN_KEYWORD);
    // 属性
    let type = '';
    let selfClosing = false;
    while (j < end) {
      const ch = text.charCodeAt(j);
      if (ch === 62) {
        out.add(j, j + 1, TOKEN_KEYWORD);
        j++;
        break;
      }
      if (ch === 47 && text.charCodeAt(j + 1) === 62) {
        out.add(j, j + 2, TOKEN_KEYWORD);
        selfClosing = true;
        j += 2;
        break;
      }
      if (isSpace(ch) || ch === 47 || ch === 61) {
        j++;
        continue;
      }
      const nameStart = j;
      while (j < end && !isSpace(text.charCodeAt(j)) && text.charCodeAt(j) !== 62 && text.charCodeAt(j) !== 61 && text.charCodeAt(j) !== 47) j++;
      const attr = text.slice(nameStart, j).toLowerCase();
      out.add(nameStart, j, TOKEN_NAME);
      let k = j;
      while (k < end && isSpace(text.charCodeAt(k))) k++;
      if (text.charCodeAt(k) !== 61) continue;
      k++;
      while (k < end && isSpace(text.charCodeAt(k))) k++;
      const q = text.charCodeAt(k);
      let valueEnd: number;
      if (q === 34 || q === 39) valueEnd = skipQuoted(text, k, end, false);
      else {
        valueEnd = k;
        while (valueEnd < end && !isSpace(text.charCodeAt(valueEnd)) && text.charCodeAt(valueEnd) !== 62) valueEnd++;
      }
      if (attr === 'type') type = text.slice(k, valueEnd).replace(/^["']|["']$/g, '').trim().toLowerCase();
      if (attr === 'style' && (q === 34 || q === 39) && valueEnd - k > 2) {
        out.add(k, k + 1, TOKEN_STRING);
        scanCss(text, k + 1, valueEnd - 1, out, true);
        out.add(valueEnd - 1, valueEnd, TOKEN_STRING);
      } else out.add(k, valueEnd, TOKEN_STRING);
      j = valueEnd;
    }
    if (!closing && !selfClosing && (name === 'script' || name === 'style')) {
      const close = closeTagAt(text, name, j, end);
      if (name === 'style') scanCss(text, j, close, out);
      else if (type.startsWith('x-shader') || type.endsWith('glsl')) scanGlsl(text, j, close, out);
      else if (JS_TYPES.has(type)) scanJs(text, j, close, out, lineStarts, shaders);
      j = close;
    }
    i = j;
  }
}

/** 1つのファイルを色付けする。shaders：JS の中のシェーダーの文字列の行の範囲（地図の分け目） */
export function tokenize(text: string, language: CodeLanguage, shaders: ShaderRange[] = [], lineStarts: Int32Array = lineStartsOf(text)): Tokens {
  const out = new Builder();
  if (language === 'js') scanJs(text, 0, text.length, out, lineStarts, shaders);
  else if (language === 'css') scanCss(text, 0, text.length, out);
  else if (language === 'glsl') scanGlsl(text, 0, text.length, out);
  else scanHtml(text, 0, text.length, out, lineStarts, shaders);
  return out.build();
}

/** start 以上で始まる（または start をまたぐ）最初の区間の番号 */
export function firstTokenAt(tokens: Tokens, start: number): number {
  let lo = 0;
  let hi = tokens.starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens.ends[mid] <= start) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
