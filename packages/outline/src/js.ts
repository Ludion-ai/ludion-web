// JS を読む：シェーダー、設定の塊、見出し、関数、技術。コメントと文字列の中は、決まった形の文字列のほかは数えない。

import type { Unit } from './collect.ts';
import { findHeadings, headingRanges } from './headings.ts';
import { lex, type Token } from './lex.ts';
import { classifyUrl } from './urls.ts';
import { closeLimit, utf8Bytes } from './text.ts';

/** 文字列の中身がシェーダーか（WORKSPACE.md「6」） */
export function isShaderText(value: string): boolean {
  return value.trimStart().startsWith('#version') || value.includes('gl_Position') || value.includes('gl_FragColor') || /\bvoid\s+main\s*\(/.test(value.length > 200_000 ? value.slice(0, 200_000) : value);
}

export function shaderFacts(value: string): { glsl?: string; stage?: 'vertex' | 'fragment' } {
  const facts: { glsl?: string; stage?: 'vertex' | 'fragment' } = {};
  const version = /^\s*#version[ \t]+(\d+(?:[ \t]+es)?)/.exec(value);
  if (version) facts.glsl = version[1].replace(/[ \t]+/, ' ');
  if (value.includes('gl_Position')) facts.stage = 'vertex';
  else if (value.includes('gl_FragColor') || value.includes('gl_FragData') || /\bout\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\b/.test(value)) facts.stage = 'fragment';
  return facts;
}

const POINTER_EVENTS = [
  'pointerdown', 'pointermove', 'pointerup', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'gotpointercapture', 'lostpointercapture',
  'mousedown', 'mousemove', 'mouseup', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'click', 'dblclick', 'contextmenu',
  'touchstart', 'touchmove', 'touchend', 'touchcancel', 'dragstart', 'dragover', 'dragend', 'dragenter', 'dragleave',
];
const EVENT_TECH = new Map<string, 'pointer' | 'keyboard' | 'wheel' | 'tilt' | 'pause-hidden'>([
  ...POINTER_EVENTS.map((name) => [name, 'pointer'] as const),
  ['keydown', 'keyboard'],
  ['keyup', 'keyboard'],
  ['keypress', 'keyboard'],
  ['wheel', 'wheel'],
  ['mousewheel', 'wheel'],
  ['DOMMouseScroll', 'wheel'],
  ['deviceorientation', 'tilt'],
  ['deviceorientationabsolute', 'tilt'],
  ['devicemotion', 'tilt'],
  ['visibilitychange', 'pause-hidden'],
]);
export const eventTech = (name: string) => EVENT_TECH.get(name);

const IDENT_TECH = new Map<string, Parameters<Unit['col']['hit']>[0]>([
  ['AudioContext', 'webaudio'],
  ['webkitAudioContext', 'webaudio'],
  ['OfflineAudioContext', 'webaudio'],
  ['createOscillator', 'webaudio-synth'],
  ['createPeriodicWave', 'webaudio-synth'],
  ['createConstantSource', 'webaudio-synth'],
  ['getChannelData', 'webaudio-synth'],
  ['decodeAudioData', 'webaudio-decode'],
  ['requestAnimationFrame', 'raf'],
  ['webkitRequestAnimationFrame', 'raf'],
  ['IntersectionObserver', 'pause-hidden'],
  ['visibilityState', 'pause-hidden'],
  ['localStorage', 'localstorage'],
  ['sessionStorage', 'sessionstorage'],
  ['indexedDB', 'indexeddb'],
  ['DeviceOrientationEvent', 'tilt'],
  ['DeviceMotionEvent', 'tilt'],
  ['KeyframeEffect', 'web-animations'],
]);

const CONTEXTS = new Map<string, 'webgl2' | 'webgl' | 'webgpu' | 'canvas2d'>([
  ['webgl2', 'webgl2'],
  ['webgl', 'webgl'],
  ['experimental-webgl', 'webgl'],
  ['webgpu', 'webgpu'],
  ['2d', 'canvas2d'],
]);

const REDUCED_MOTION = /^\s*(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*prefers-reduced-motion\b/;
const STATEMENT_WORDS = new Set(['const', 'let', 'var', 'function', 'class', 'return', 'if', 'for', 'while', 'do', 'switch', 'try', 'throw', 'export', 'import', 'async']);
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'with', 'return', 'typeof', 'new', 'await', 'yield', 'else', 'do', 'try', 'super', 'import', 'delete', 'void', 'in', 'of', 'instanceof', 'case']);
const METHOD_PREV = new Set(['{', ',', '}', ';', 'static', 'async', 'get', 'set', '*']);

/** 式の本体の矢印の関数の終わりを探すのに、1つの塊で見る字句の数の上限 */
const ARROW_BUDGET = 400_000;

const isStringish =(token: Token | undefined) => token !== undefined && (token.type === 'string' || (token.type === 'template' && !token.hasExpr));

interface FoundFunction {
  name: string;
  nameToken: Token;
  first: Token;
  last: Token;
}

/**
 * JS の1つの塊を読む。行の番号はファイルの中の番号（文書の作品の script でも同じ）。
 * 返すのは、その塊の中の GLSL のバイト数。
 */
export function analyzeJs(unit: Unit): number {
  const { text, index, file, col } = unit;
  const { sig, comments } = lex(text, unit.start, unit.end);
  const unitEndLine = index.line(Math.max(unit.start, unit.end - 1));
  const prev = (k: number) => sig[k - 1];
  const nextTok = (k: number) => sig[k + 1];
  const isPunct = (token: Token | undefined, value: string) => token !== undefined && token.type === 'punct' && token.value === value;
  const isIdent = (token: Token | undefined, value?: string) => token !== undefined && token.type === 'ident' && (value === undefined || token.value === value);
  const lineOf = (offset: number) => index.line(offset);

  // ---- シェーダー：文字列（+ でつないだもの、文字列だけの配列を join したもの）
  let glslBytes = 0;
  let shaderCount = 0;
  for (let k = 0; k < sig.length; k++) {
    const token = sig[k];
    let first = k;
    let last = k;
    let value = '';
    let arrayOpen = -1;
    if (isPunct(token, '[') && token.match > k + 1) {
      // 文字列だけの配列：[ '…', '…' ]（.join で1つにするもの）。前から1回だけ見る
      let allStrings = true;
      for (let m = k + 1; m < token.match; m++) {
        const t = sig[m];
        if (!(t.type === 'string' || t.type === 'template' || isPunct(t, ','))) {
          allStrings = false;
          break;
        }
      }
      if (!allStrings) continue;
      arrayOpen = k;
      first = k + 1;
      last = token.match - 1;
      if (isPunct(sig[last], ',')) last--;
      for (let j = first; j <= last; j++) if (sig[j].type !== 'punct') value += sig[j].value + '\n';
    } else if (token.type === 'string' || token.type === 'template') {
      // + でつないだ文字列
      while (isPunct(sig[last + 1], '+') && (sig[last + 2]?.type === 'string' || sig[last + 2]?.type === 'template')) last += 2;
      for (let j = first; j <= last; j += 2) value += sig[j].value + '\n';
    } else continue;
    if (!isShaderText(value)) {
      k = arrayOpen !== -1 ? sig[arrayOpen].match : last;
      continue;
    }
    shaderCount++;
    // 名前：代入先の変数の名前、プロパティの名前
    const before = arrayOpen !== -1 ? arrayOpen - 1 : first - 1;
    let nameToken: Token | undefined;
    const b = sig[before];
    if (b && b.type === 'punct' && (b.value === '=' || b.value === ':') && (isIdent(sig[before - 1]) || sig[before - 1]?.type === 'string')) nameToken = sig[before - 1];
    const name = nameToken ? (nameToken.type === 'string' ? nameToken.value : nameToken.value) : `shader-${shaderCount}`;
    const startTok = sig[first];
    const endTok = sig[last];
    let bytes = 0;
    for (let j = first; j <= last; j++) if (sig[j].type !== 'punct') bytes += utf8Bytes(text, sig[j].start, sig[j].end);
    glslBytes += bytes;
    const startOffset = nameToken && lineOf(nameToken.start) >= lineOf(startTok.start) - 2 ? nameToken.start : startTok.start;
    col.section({
      file,
      kind: 'shader',
      name: name.slice(0, 120),
      start: lineOf(startOffset),
      end: lineOf(endTok.end - 1),
      depth: 0,
      language: 'glsl',
      bytes,
      ...shaderFacts(value),
    });
    k = arrayOpen !== -1 ? sig[arrayOpen].match : last;
  }
  col.add(col.glsl, file, glslBytes);

  // ---- 設定の塊：頭近くの、括弧の外の大きなオブジェクト
  const firstLine = lineOf(unit.start);
  const headLimit = firstLine + Math.max(60, Math.floor((unitEndLine - firstLine + 1) * 0.3));
  let depth = 0;
  for (let k = 0; k < sig.length; k++) {
    const token = sig[k];
    if (token.type === 'punct') {
      if (token.value === '(' || token.value === '[' || token.value === '{') depth++;
      else if (token.value === ')' || token.value === ']' || token.value === '}') depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || !(isIdent(token, 'const') || isIdent(token, 'let') || isIdent(token, 'var'))) continue;
    if (lineOf(token.start) > headLimit) break;
    const nameToken = nextTok(k);
    if (!isIdent(nameToken) || !isPunct(sig[k + 2], '=')) continue;
    let open = k + 3;
    // Object.freeze({ … })
    if (isIdent(sig[open], 'Object') && isPunct(sig[open + 1], '.') && isIdent(sig[open + 2], 'freeze') && isPunct(sig[open + 3], '(')) open += 4;
    const brace = sig[open];
    if (!isPunct(brace, '{') || brace.match === undefined || brace.match < 0) continue;
    const close = sig[brace.match];
    const start = lineOf(token.start);
    const end = lineOf(close.start);
    // 大きい：10行以上で、3つ以上の名前を持つ
    let keys = 0;
    let inner = 0;
    for (let m = open + 1; m < brace.match; m++) {
      const t = sig[m];
      if (t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) inner++;
      else if (t.type === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) inner--;
      else if (inner === 0 && (t.type === 'ident' || t.type === 'string') && isPunct(sig[m + 1], ':')) keys++;
    }
    if (end - start + 1 < 10 || keys < 3) continue;
    col.section({ file, kind: 'settings', name: nameToken.value, start, end, depth: 0, language: 'js', bytes: utf8Bytes(text, token.start, close.end) });
    // 中に線の見出しがなければ、オブジェクトを値に持つ名前を見出しにする
    // コメントは位置の順なので、塊の中のものだけを見る（塊はたがいに重ならないので、全部で1回ずつ）
    let lo = 0;
    let hi = comments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (comments[mid].start <= brace.start) lo = mid + 1;
      else hi = mid;
    }
    let hasHeading = false;
    for (let c = lo; c < comments.length && comments[c].start < close.start; c++) {
      if (/^\/\/\s*([-=─━═~*#_+])\1\1/.test(comments[c].value)) {
        hasHeading = true;
        break;
      }
    }
    if (!hasHeading) {
      inner = 0;
      for (let m = open + 1; m < brace.match; m++) {
        const t = sig[m];
        if (t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) inner++;
        else if (t.type === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) inner--;
        else if (inner === 0 && (t.type === 'ident' || t.type === 'string') && isPunct(sig[m + 1], ':')) {
          const value = sig[m + 2];
          if (value && (isPunct(value, '{') || isPunct(value, '[')) && value.match !== undefined && value.match > 0) {
            col.section({ file, kind: 'heading', name: t.value.slice(0, 120), start: lineOf(t.start), end: lineOf(sig[value.match].start), depth: 0, language: 'js' });
          }
        }
      }
    }
    k = brace.match;
    depth = 0;
  }

  // ---- 見出し
  const marks = findHeadings(
    text,
    index,
    comments.map((comment) => ({
      start: comment.start,
      end: comment.end,
      value: comment.value,
      limit: comment.enclosing >= 0 && sig[comment.enclosing].match >= 0 ? closeLimit(index, sig[sig[comment.enclosing].match].start) : -1,
    })),
    unitEndLine,
  );
  for (const { mark, end } of headingRanges(index, marks, unitEndLine)) {
    col.section({ file, kind: 'heading', name: mark.name.slice(0, 120), start: mark.line, end, depth: 0, language: 'js' });
  }

  // ---- 関数
  const found: FoundFunction[] = [];
  const consumed = new Set<number>();
  /** 矢印の関数の本体の最後の字句 */
  let arrowBudget = ARROW_BUDGET;
  const arrowEnd = (arrow: number): Token => {
    const body = sig[arrow + 1];
    if (!body) return sig[arrow];
    if (isPunct(body, '{') && body.match !== undefined && body.match >= 0) return sig[body.match];
    let m = arrow + 1;
    let lastTok = sig[arrow];
    // 式の本体は、1つで 4000 字句まで、塊の全部で ARROW_BUDGET 字句までを見る（矢印の連なりで遅くならないように）
    const stop = Math.min(sig.length, arrow + 4000);
    while (m < stop && arrowBudget > 0) {
      arrowBudget--;
      const t = sig[m];
      if (t.type === 'punct' && (t.value === ',' || t.value === ';' || t.value === ')' || t.value === ']' || t.value === '}')) break;
      if (m > arrow + 1 && t.type === 'ident' && STATEMENT_WORDS.has(t.value) && lineOf(t.start) > lineOf(lastTok.end - 1) && !isPunct(sig[m - 1], '.') && !isPunct(sig[m - 1], '=>')) break;
      if (t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{') && t.match !== undefined && t.match >= 0) {
        lastTok = sig[t.match];
        m = t.match + 1;
        continue;
      }
      lastTok = t;
      m++;
    }
    return lastTok;
  };
  /** function の後：名前（任意）、( … )、{ … }。最後の } を返す */
  const functionBody = (fn: number): { name?: Token; close: Token } | null => {
    let m = fn + 1;
    if (isPunct(sig[m], '*')) m++;
    let name: Token | undefined;
    if (isIdent(sig[m])) {
      name = sig[m];
      m++;
    }
    const paren = sig[m];
    if (!isPunct(paren, '(') || paren.match === undefined || paren.match < 0) return null;
    const brace = sig[paren.match + 1];
    if (!isPunct(brace, '{') || brace.match === undefined || brace.match < 0) return null;
    return { name, close: sig[brace.match] };
  };
  /** 値の始まり（k）が関数なら、その終わり */
  const functionValue = (k: number): Token | null => {
    let m = k;
    if (isIdent(sig[m], 'async') && !isPunct(sig[m + 1], '=>')) m++;
    const t = sig[m];
    if (isIdent(t, 'function')) {
      const body = functionBody(m);
      if (!body) return null;
      consumed.add(m);
      return body.close;
    }
    if (isPunct(t, '(') && t.match !== undefined && t.match >= 0 && isPunct(sig[t.match + 1], '=>')) return arrowEnd(t.match + 1);
    if (isIdent(t) && isPunct(sig[m + 1], '=>')) return arrowEnd(m + 1);
    return null;
  };

  for (let k = 0; k < sig.length; k++) {
    const token = sig[k];
    if (token.type !== 'ident') continue;
    if (token.value === 'function' && !consumed.has(k)) {
      const body = functionBody(k);
      if (body?.name) {
        const first = isIdent(prev(k), 'async') ? prev(k) : token;
        found.push({ name: body.name.value, nameToken: body.name, first, last: body.close });
      }
      continue;
    }
    const after = nextTok(k);
    // 名前 = 関数、名前: 関数
    if (after && after.type === 'punct' && (after.value === '=' || after.value === ':')) {
      if (after.value === ':' && (isPunct(prev(k), '?') || isIdent(prev(k), 'case'))) continue;
      const last = functionValue(k + 2);
      if (last) {
        let first: Token = token;
        const p = prev(k);
        if (p && (isIdent(p, 'const') || isIdent(p, 'let') || isIdent(p, 'var'))) first = p;
        found.push({ name: token.value, nameToken: token, first, last });
      }
      continue;
    }
    // メソッド：名前( … ) { … }
    if (isPunct(after, '(') && !NOT_METHOD.has(token.value) && !isPunct(prev(k), '.')) {
      const p = prev(k);
      if (!p || !(p.type === 'punct' ? METHOD_PREV.has(p.value) : p.type === 'ident' && METHOD_PREV.has(p.value))) continue;
      if (after.match === undefined || after.match < 0) continue;
      const brace = sig[after.match + 1];
      if (!isPunct(brace, '{') || brace.match === undefined || brace.match < 0) continue;
      found.push({ name: token.value, nameToken: token, first: token, last: sig[brace.match] });
    }
  }
  for (const fn of found) {
    col.section({
      file,
      kind: 'function',
      name: fn.name.slice(0, 120),
      start: lineOf(fn.nameToken.start),
      end: lineOf(fn.last.end - 1),
      depth: 0,
      language: 'js',
      bytes: utf8Bytes(text, fn.first.start, fn.last.end),
    });
  }

  // ---- 技術
  for (let k = 0; k < sig.length; k++) {
    const token = sig[k];
    if (token.type === 'ident') {
      const id = IDENT_TECH.get(token.value);
      if (id) {
        col.hit(id, file, index, token.start, token.value);
        continue;
      }
      const v = token.value;
      if (v === 'getContext' && isPunct(nextTok(k), '(') && isStringish(sig[k + 2])) {
        const ctx = CONTEXTS.get(sig[k + 2].value);
        if (ctx) col.hit(ctx, file, index, sig[k + 2].start, text.slice(sig[k + 2].start, sig[k + 2].end));
      } else if (v === 'gpu' && isPunct(prev(k), '.') && isIdent(sig[k - 2], 'navigator')) {
        col.hit('webgpu', file, index, token.start, 'gpu');
      } else if (v === 'hidden' && isPunct(prev(k), '.') && isIdent(sig[k - 2], 'document')) {
        col.hit('pause-hidden', file, index, token.start, 'hidden');
      } else if (v === 'animate' && isPunct(prev(k), '.') && isPunct(nextTok(k), '(') && (isPunct(sig[k + 2], '[') || isPunct(sig[k + 2], '{'))) {
        col.hit('web-animations', file, index, token.start, 'animate');
      } else if (v === 'Audio' && isIdent(prev(k), 'new') && isPunct(nextTok(k), '(')) {
        col.hit('audio-element', file, index, token.start, 'Audio');
      } else if (v.startsWith('on') && v.length > 4 && isPunct(prev(k), '.') && isPunct(nextTok(k), '=')) {
        const event = eventTech(v.slice(2));
        if (event) col.hit(event, file, index, token.start, v);
      } else if (v === 'createElement' && isPunct(nextTok(k), '(') && isStringish(sig[k + 2]) && sig[k + 2].value.toLowerCase() === 'audio') {
        col.hit('audio-element', file, index, sig[k + 2].start, text.slice(sig[k + 2].start, sig[k + 2].end));
      }
      continue;
    }
    if (token.type !== 'string' && token.type !== 'template') continue;
    const value = token.value;
    const raw = text.slice(token.start, token.end);
    // ${ … } を含むテンプレートは、頭が <svg のものだけを見る（`<svg …>${path}</svg>`）
    if (!isStringish(token)) {
      if (value.trimStart().startsWith('<svg')) col.hit('svg', file, index, token.start, raw);
      continue;
    }
    // 出来事の名前：( か , の後で、後ろに , が来る引数（addEventListener('click', f)、listen(el, 'pointerdown', f)）
    const event = eventTech(value);
    if (event) {
      const p = prev(k);
      const n = nextTok(k);
      const asArgument = (isPunct(p, '(') || isPunct(p, ',')) && isPunct(n, ',');
      // [ 'pointerdown', 'pointermove' ].forEach(…)
      let inEventArray = false;
      if (!asArgument && (isPunct(p, '[') || isPunct(p, ','))) {
        let j = k;
        const stop = Math.min(sig.length, k + 64);
        while (j < stop && !isPunct(sig[j], ']') && (isStringish(sig[j]) || isPunct(sig[j], ','))) j++;
        inEventArray = isPunct(sig[j], ']') && isPunct(sig[j + 1], '.') && isIdent(sig[j + 2], 'forEach');
      }
      if (asArgument || inEventArray) col.hit(event, file, index, token.start, raw);
      continue;
    }
    if (value.length <= 200 && REDUCED_MOTION.test(value)) {
      col.hit('reduced-motion', file, index, token.start, raw);
      continue;
    }
    if (value === 'http://www.w3.org/2000/svg' || value.trimStart().startsWith('<svg')) {
      col.hit('svg', file, index, token.start, raw);
      continue;
    }
    if (value.startsWith('data:') && value.length > 5) {
      const mime = /^data:([\w.+-]+\/[\w.+-]+)?/.exec(value)?.[1] ?? 'text/plain';
      col.section({ file, kind: 'asset', name: mime, mime, start: lineOf(token.start), end: lineOf(token.end - 1), depth: 0, language: 'js', bytes: utf8Bytes(text, token.start, token.end) });
      continue;
    }
    if (value.length <= 2048 && /^(?:https?:)?\/\//i.test(value)) {
      const p = prev(k);
      const loads =
        isIdent(p, 'from') ||
        (isIdent(p, 'import') && !isPunct(sig[k - 2], '.')) ||
        (isPunct(p, '(') && (isIdent(sig[k - 2], 'import') || isIdent(sig[k - 2], 'fetch') || isIdent(sig[k - 2], 'importScripts') || isIdent(sig[k - 2], 'Worker') || isIdent(sig[k - 2], 'Audio') || isIdent(sig[k - 2], 'FontFace'))) ||
        // .src = '…'（画像、音、script）。.href = '…' は移る先のことが多いので数えない
        (isPunct(p, '=') && isIdent(sig[k - 2], 'src'));
      const url = classifyUrl(value, loads);
      if (url) col.hit(url.id, file, index, token.start, raw, url.host);
    }
  }
  return glslBytes;
}
