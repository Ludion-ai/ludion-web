// HTML を読む：<style>、<script>、x-shader の script、インラインの SVG、data: の素材、見出し、技術。
// 文書の作品（index.html）と、部品の作品の part.html の両方に使う。

import type { Unit } from './collect.ts';
import { analyzeCss } from './css.ts';
import { findHeadings, headingRanges, type CommentLike } from './headings.ts';
import { analyzeJs, eventTech, shaderFacts } from './js.ts';
import { utf8Bytes } from './text.ts';
import { classifyUrl } from './urls.ts';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RCDATA = new Set(['textarea', 'title']);
/** 中に文字がなくても、画面に DOM として出る物 */
const CONTROLS = new Set(['button', 'input', 'select', 'textarea', 'img', 'progress', 'meter', 'video']);
/** DOM として数えない物 */
const NOT_DOM = new Set(['html', 'head', 'body', 'title', 'meta', 'link', 'script', 'style', 'noscript', 'template', 'base', 'canvas']);
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript', 'text/babel']);
/** 読みに行く属性 */
const LOAD_ATTRS: Record<string, string[]> = {
  script: ['src'],
  link: ['href'],
  img: ['src', 'srcset'],
  audio: ['src'],
  video: ['src', 'poster'],
  source: ['src', 'srcset'],
  iframe: ['src'],
  embed: ['src'],
  object: ['data'],
  track: ['src'],
  image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href'],
  input: ['src'],
};

interface Attr {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  nameStart: number;
}

interface Open {
  name: string;
  start: number;
  inSvg: boolean;
  /** この要素が SVG の木の根 */
  svgRoot: boolean;
}

const isNameChar = (c: number) => !(c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 47 || c === 62 || c === 61);

function closeTag(text: string, name: string, from: number, end: number): number {
  const re = new RegExp(`</${name}[\\s/>]`, 'gi');
  re.lastIndex = from;
  const m = re.exec(text);
  return m && m.index < end ? m.index : end;
}

export interface HtmlResult {
  /** DOM と CSS で描いている印の候補（文字のある要素か、操作の部品）の位置 */
  dom: { offset: number; match: string } | null;
  /** style 属性があるか */
  styleAttr: boolean;
  /** <style> があるか */
  styleTag: boolean;
}

export function analyzeHtml(unit: Unit): HtmlResult {
  const { text, index, file, col } = unit;
  const { start, end } = unit;
  const comments: CommentLike[] = [];
  const stack: Open[] = [];
  const result: HtmlResult = { dom: null, styleAttr: false, styleTag: false };
  let shaders = 0;
  let i = start;

  const noteDom = (offset: number, name: string) => {
    if (!result.dom) result.dom = { offset, match: text.slice(offset, offset + 1 + name.length) };
  };

  while (i < end) {
    const lt = text.indexOf('<', i);
    if (lt === -1 || lt >= end) {
      checkText(i, end);
      break;
    }
    if (lt > i) checkText(i, lt);
    if (text.startsWith('<!--', lt)) {
      const close = text.indexOf('-->', lt + 4);
      const stop = close === -1 || close + 3 > end ? end : close + 3;
      comments.push({ start: lt, end: stop, value: text.slice(lt, stop), limit: -1 });
      i = stop;
      continue;
    }
    const c = text.charCodeAt(lt + 1);
    if (c === 33 || c === 63) {
      // <!doctype>、<?xml?>、<![CDATA[
      const close = text.indexOf('>', lt + 2);
      i = close === -1 || close >= end ? end : close + 1;
      continue;
    }
    if (c === 47) {
      let j = lt + 2;
      while (j < end && isNameChar(text.charCodeAt(j))) j++;
      const name = text.slice(lt + 2, j).toLowerCase();
      const close = text.indexOf('>', j);
      i = close === -1 || close >= end ? end : close + 1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) {
          for (let m = stack.length - 1; m >= k; m--) popped(stack[m], lt);
          stack.length = k;
          break;
        }
      }
      continue;
    }
    if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90))) {
      i = lt + 1;
      continue;
    }
    // 開きタグ
    let j = lt + 1;
    while (j < end && isNameChar(text.charCodeAt(j))) j++;
    const rawName = text.slice(lt + 1, j);
    const name = rawName.toLowerCase();
    const attrs: Attr[] = [];
    let selfClosing = false;
    while (j < end) {
      const ch = text.charCodeAt(j);
      if (ch === 62) {
        j++;
        break;
      }
      if (ch === 47 && text.charCodeAt(j + 1) === 62) {
        selfClosing = true;
        j += 2;
        break;
      }
      if (!isNameChar(ch) && ch !== 61) {
        j++;
        continue;
      }
      if (ch === 61 || ch === 47) {
        j++;
        continue;
      }
      const nameStart = j;
      while (j < end && isNameChar(text.charCodeAt(j))) j++;
      const attrName = text.slice(nameStart, j).toLowerCase();
      let k = j;
      while (k < end && /\s/.test(text[k])) k++;
      let value = '';
      let valueStart = j;
      let valueEnd = j;
      if (text[k] === '=') {
        k++;
        while (k < end && /\s/.test(text[k])) k++;
        const q = text[k];
        if (q === '"' || q === "'") {
          const close = text.indexOf(q, k + 1);
          valueStart = k + 1;
          valueEnd = close === -1 || close >= end ? end : close;
          j = valueEnd + 1;
        } else {
          valueStart = k;
          while (k < end && !/[\s>]/.test(text[k])) k++;
          valueEnd = k;
          j = k;
        }
        value = text.slice(valueStart, valueEnd);
      }
      attrs.push({ name: attrName, value, valueStart, valueEnd, nameStart });
    }
    const tagEnd = j;
    const parent = stack[stack.length - 1];
    const inSvg = parent?.inSvg ?? false;
    const svgRoot = name === 'svg' && !inSvg;
    const attr = (n: string) => attrs.find((a) => a.name === n);

    if (svgRoot) col.hit('svg', file, index, lt, `<${rawName}`);
    if (name === 'audio') col.hit('audio-element', file, index, lt, `<${rawName}`);
    if (!inSvg && !svgRoot && CONTROLS.has(name)) noteDom(lt, rawName);
    for (const a of attrs) {
      if (a.name.startsWith('on') && a.name.length > 2) {
        const event = eventTech(a.name.slice(2));
        if (event) col.hit(event, file, index, a.nameStart, text.slice(a.nameStart, a.nameStart + a.name.length));
      } else if (a.name === 'style' && a.valueEnd > a.valueStart) {
        result.styleAttr = true;
        analyzeCss({ ...unit, start: a.valueStart, end: a.valueEnd, language: unit.language }, true);
      } else if (a.value.trimStart().startsWith('data:') && a.value.length > 5) {
        const mime = /^\s*data:([\w.+-]+\/[\w.+-]+)?/.exec(a.value)?.[1] ?? 'text/plain';
        col.section({ file, kind: 'asset', name: mime, mime, start: index.line(a.valueStart), end: index.line(Math.max(a.valueStart, a.valueEnd - 1)), depth: 0, language: unit.language, bytes: utf8Bytes(text, a.valueStart, a.valueEnd) });
      } else if (LOAD_ATTRS[name]?.includes(a.name)) {
        const url = classifyUrl(a.value, true);
        if (url) col.hit(url.id, file, index, a.valueStart, a.value.slice(0, 120), url.host);
      }
    }

    if (name === 'script' && !selfClosing) {
      const contentStart = tagEnd;
      const close = closeTag(text, 'script', contentStart, end);
      const closeEnd = Math.min(end, (text.indexOf('>', close) + 1) || end);
      const type = (attr('type')?.value ?? '').trim().toLowerCase();
      const hasContent = text.slice(contentStart, close).trim().length > 0;
      const bytes = utf8Bytes(text, contentStart, close);
      if (type.startsWith('x-shader') || type.endsWith('glsl')) {
        shaders++;
        const content = text.slice(contentStart, close);
        const id = attr('id')?.value.trim();
        col.section({ file, kind: 'shader', name: (id || `shader-${shaders}`).slice(0, 120), start: index.line(lt), end: index.line(Math.max(lt, close)), depth: 0, language: 'glsl', bytes, ...shaderFacts(content) });
        col.add(col.glsl, file, bytes);
      } else if (JS_TYPES.has(type) && hasContent) {
        const id = attr('id')?.value.trim();
        const label = `<script${type === 'module' ? ' type="module"' : ''}>${id ? ` #${id}` : ''}`;
        col.section({ file, kind: 'script', name: label.slice(0, 120), start: index.line(lt), end: index.line(Math.max(lt, close)), depth: 0, language: 'js', bytes });
        const glsl = analyzeJs({ ...unit, start: contentStart, end: close, language: 'js' });
        col.add(col.js, file, bytes - glsl);
      }
      i = closeEnd;
      continue;
    }
    if (name === 'style' && !selfClosing) {
      const contentStart = tagEnd;
      const close = closeTag(text, 'style', contentStart, end);
      const closeEnd = Math.min(end, (text.indexOf('>', close) + 1) || end);
      result.styleTag = true;
      const bytes = utf8Bytes(text, contentStart, close);
      col.section({ file, kind: 'style', name: '<style>', start: index.line(lt), end: index.line(Math.max(lt, close)), depth: 0, language: 'css', bytes });
      analyzeCss({ ...unit, start: contentStart, end: close, language: 'css' });
      col.add(col.css, file, bytes);
      i = closeEnd;
      continue;
    }
    if (RCDATA.has(name) && !selfClosing) {
      const close = closeTag(text, name, tagEnd, end);
      if (name === 'textarea') noteDom(lt, rawName);
      i = Math.min(end, (text.indexOf('>', close) + 1) || end);
      continue;
    }
    if (!selfClosing && !VOID.has(name)) stack.push({ name, start: lt, inSvg: inSvg || svgRoot, svgRoot });
    i = tagEnd;
  }
  for (let m = stack.length - 1; m >= 0; m--) popped(stack[m], end);

  const unitEndLine = index.line(Math.max(start, end - 1));
  for (const { mark, end: last } of headingRanges(index, findHeadings(text, index, comments, unitEndLine), unitEndLine)) {
    col.section({ file, kind: 'heading', name: mark.name.slice(0, 120), start: mark.line, end: last, depth: 0, language: 'html' });
  }
  return result;

  function checkText(from: number, to: number) {
    const top = stack[stack.length - 1];
    if (!top || top.inSvg || NOT_DOM.has(top.name) || result.dom) return;
    for (let k = from; k < to; k++) {
      const ch = text.charCodeAt(k);
      if (!(ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12)) {
        noteDom(top.start, text.slice(top.start + 1, top.start + 1 + top.name.length));
        return;
      }
    }
  }

  function popped(open: Open, at: number) {
    if (!open.svgRoot) return;
    const close = text.indexOf('>', at);
    const stop = close === -1 || close >= end ? end : close + 1;
    col.section({ file, kind: 'asset', name: 'svg', mime: 'image/svg+xml', start: index.line(open.start), end: index.line(Math.max(open.start, stop - 1)), depth: 0, language: 'html', bytes: utf8Bytes(text, open.start, stop) });
  }
}
