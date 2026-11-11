// 1つの箱に貼った HTML を、part.html、part.css、part.js に分ける（docs/tasks/T033.md 段階 A2）。ブラウザで流す。Node の API を使わない。
//
// 「コピーされるコード」（@ludion/render の buildCopySnippet）の逆：最初の <style> の前までが HTML、<style> の中が CSS、
// <script type="module"> の中が JS。JS は最後の mount(...) の呼び出しを外し、mount を export に戻す。頭のクレジット行と「Remixed by」の行は外す。
// <!doctype>、<html>、<head>、<body> で包まれていても拾う。
//
// 機械で直すのは、見た目と動きを変えないものだけ（fixParts）：根の要素が1つで data-ld-part がなければ付ける。data-ld-part の値を作品の ID に合わせる。
// JS の書き換え（document を探す書き方を直す、など）はしない。動きが変わるおそれがあるため。

import { exportsMount } from '@ludion/render';
import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.ChildNode;

export interface Parts {
  html: string;
  css: string;
  /** 動きがないときは null */
  js: string | null;
}

/** 分けるときにしたこと。画面に1行で出す。 */
export type SplitNote = 'unwrapped' | 'credits' | 'font_link';

/** 分けられない理由。 */
export type SplitError = 'empty' | 'external_script' | 'many_scripts' | 'unknown_script';

export type SplitResult = { ok: true; parts: Parts; notes: SplitNote[] } | { ok: false; error: SplitError };

/** 直したこと。 */
export type FixNote = { kind: 'added_root'; id: string } | { kind: 'renamed'; from: string; id: string };

/** クレジット行（UI by @…、Remix of UI by @…、Remixed by …）。 */
const CREDIT = /\bUI by @|\bRemix(?:ed)?\s+(?:of|by)\b/i;
/** 書体の読み込み（契約で許された、ただ1つの外への通信）。 */
const FONT_HOST = /^https:\/\/fonts\.googleapis\.com\//i;
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);

const isElement = (node: Node): node is Element => 'tagName' in node;
const attr = (element: Element, name: string) => element.attrs.find((a) => a.name === name)?.value ?? null;
/** <style> と <script> の中身。パーサーは中を文字のまま読む。 */
const rawText = (element: Element) =>
  element.childNodes.map((child) => ('value' in child && typeof child.value === 'string' ? child.value : '')).join('');

/** 先頭の要素の前にあるのが、空白とコメントだけのときの、最初のタグの名前。 */
function firstTagName(text: string): string | null {
  const rest = text.replace(/^(?:\s|<!--[\s\S]*?-->)*/, '');
  const match = /^<(!doctype|[a-z][a-z0-9-]*)/i.exec(rest);
  return match ? match[1].toLowerCase() : null;
}

/** コメントの /* … *\/ と // … のうち、頭にあるクレジット行を外す。 */
function stripLeadingCredits(code: string): { code: string; removed: boolean } {
  let rest = code;
  let removed = false;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '');
    const block = /^\/\*[\s\S]*?\*\//.exec(trimmed);
    const line = /^\/\/[^\n]*/.exec(trimmed);
    const comment = block?.[0] ?? line?.[0];
    if (!comment || !CREDIT.test(comment)) return { code: removed ? trimmed : code, removed };
    rest = trimmed.slice(comment.length);
    removed = true;
  }
}

/** 最後の文が mount(...) の呼び出しなら外す。かっこの対応を、文字列の中を飛ばして数える。 */
export function removeMountCall(js: string): string {
  const pattern = /(^|[\n;])[ \t]*mount\s*\(/g;
  let last: RegExpExecArray | null = null;
  for (let match = pattern.exec(js); match; match = pattern.exec(js)) last = match;
  if (!last) return js;
  const start = last.index + last[1].length;
  let depth = 0;
  let quote: string | null = null;
  let at = js.indexOf('(', start);
  for (; at < js.length; at += 1) {
    const ch = js[at];
    if (quote) {
      if (ch === '\\') at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return js;
  const after = js.slice(at + 1);
  if (!/^\s*;?\s*$/.test(after)) return js;
  return js.slice(0, start).replace(/\s+$/, '') + '\n';
}

/** mount を export に戻す。もう export していれば、そのまま。 */
export function exportMount(js: string): string {
  if (exportsMount(js)) return js;
  const fn = /^([ \t]*)((?:async[ \t]+)?function[ \t]*\*?[ \t]*mount\b)/m;
  if (fn.test(js)) return js.replace(fn, '$1export $2');
  const binding = /^([ \t]*)((?:const|let|var)[ \t]+mount\b)/m;
  if (binding.test(js)) return js.replace(binding, '$1export $2');
  return js;
}

/** 貼った1つの HTML を3つに分ける。 */
export function splitSnippet(input: string): SplitResult {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (text.trim() === '') return { ok: false, error: 'empty' };
  const notes = new Set<SplitNote>();

  const tag = firstTagName(text);
  const wrapped = tag === '!doctype' || tag === 'html' || tag === 'head' || tag === 'body';
  let nodes: Node[];
  let headNodes: Node[] = [];
  if (wrapped) {
    notes.add('unwrapped');
    const document = parse(text, { sourceCodeLocationInfo: true });
    const html = document.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'html');
    const head = html?.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'head');
    const body = html?.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'body');
    headNodes = head?.childNodes ?? [];
    nodes = body?.childNodes ?? [];
    // <html> の前のコメント（クレジット行など）
    const before = document.childNodes.filter((node) => node.nodeName === '#comment');
    if (before.some((node) => 'data' in node && CREDIT.test(node.data))) notes.add('credits');
  } else {
    nodes = parseFragment(text, { sourceCodeLocationInfo: true }).childNodes;
  }

  const htmlSlices: string[] = [];
  const cssChunks: string[] = [];
  const fontImports: string[] = [];
  const jsChunks: string[] = [];
  let seenElement = false;
  let error: SplitError | null = null;

  const take = (node: Node, inHead: boolean) => {
    if (node.nodeName === '#comment') {
      const data = 'data' in node ? node.data : '';
      // 根の要素の前のクレジット行は外す。載せるときに、サーバーが作り直す
      if (!seenElement && CREDIT.test(data)) {
        notes.add('credits');
        return;
      }
      if (!inHead) htmlSlices.push(slice(node));
      return;
    }
    if (isElement(node)) {
      if (node.tagName === 'style') {
        cssChunks.push(rawText(node));
        return;
      }
      if (node.tagName === 'script') {
        if (attr(node, 'src') !== null) error ??= 'external_script';
        else if (!JS_TYPES.has((attr(node, 'type') ?? '').trim().toLowerCase())) error ??= 'unknown_script';
        else jsChunks.push(rawText(node));
        return;
      }
      if (node.tagName === 'link' && /\bstylesheet\b/i.test(attr(node, 'rel') ?? '') && FONT_HOST.test(attr(node, 'href') ?? '')) {
        fontImports.push(`@import url("${attr(node, 'href')!.replace(/"/g, '%22')}");`);
        notes.add('font_link');
        return;
      }
      // 頭のほかのもの（title、meta、link）は作品に入れない
      if (inHead) return;
      seenElement = true;
    }
    if (!inHead) htmlSlices.push(slice(node));
  };
  const slice = (node: Node) => {
    const location = node.sourceCodeLocation;
    return location ? text.slice(location.startOffset, location.endOffset) : '';
  };

  for (const node of headNodes) take(node, true);
  for (const node of nodes) take(node, false);
  if (error) return { ok: false, error };
  if (jsChunks.filter((chunk) => chunk.trim() !== '').length > 1) return { ok: false, error: 'many_scripts' };

  const css = cssChunks
    .map((chunk) => {
      const stripped = stripLeadingCredits(chunk);
      if (stripped.removed) notes.add('credits');
      return stripped.code.trim();
    })
    .filter(Boolean);
  let js: string | null = null;
  const script = jsChunks.find((chunk) => chunk.trim() !== '');
  if (script !== undefined) {
    const stripped = stripLeadingCredits(script);
    if (stripped.removed) notes.add('credits');
    const body = exportMount(removeMountCall(stripped.code)).trim();
    js = body === '' ? null : `${body}\n`;
  }

  return {
    ok: true,
    parts: {
      html: htmlSlices.join('').trim(),
      css: [...fontImports, ...css].join('\n\n'),
      js,
    },
    notes: [...notes],
  };
}

/** 根の要素（一番外の要素が1つのとき）。 */
function singleRoot(html: string): Element | null {
  const elements = parseFragment(html, { sourceCodeLocationInfo: true }).childNodes.filter(isElement);
  return elements.length === 1 ? elements[0] : null;
}

/** CSS と JS の [data-ld-part="…"] の値。 */
const PART_SELECTOR = /\[\s*data-ld-part\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"']+))\s*\]/g;
const selectorValues = (code: string) => [...code.matchAll(PART_SELECTOR)].map((match) => match[1] ?? match[2] ?? match[3]);

/** 今の作品の ID の候補（根の data-ld-part、なければ CSS の値が1つならそれ）。ID の案に使う。 */
export function partIdOf(parts: Parts): string | null {
  const root = singleRoot(parts.html);
  const value = root && attr(root, 'data-ld-part');
  if (value) return value;
  const values = new Set([...selectorValues(parts.css), ...selectorValues(parts.js ?? '')]);
  return values.size === 1 ? [...values][0] : null;
}

/** 機械で安全に直せるものを直す（見た目と動きを変えないものだけ）。 */
export function fixParts(parts: Parts, id: string): { parts: Parts; notes: FixNote[] } {
  const notes: FixNote[] = [];
  let { html } = parts;
  const root = singleRoot(html);
  if (!root) return { parts, notes };

  const current = attr(root, 'data-ld-part');
  const location = root.sourceCodeLocation;
  if (current === null && location?.startTag) {
    const at = location.startTag.startOffset + 1 + root.tagName.length;
    html = `${html.slice(0, at)} data-ld-part="${id}"${html.slice(at)}`;
    notes.push({ kind: 'added_root', id });
  } else if (current !== null && current !== id && location?.attrs?.['data-ld-part']) {
    const { startOffset, endOffset } = location.attrs['data-ld-part'];
    html = `${html.slice(0, startOffset)}data-ld-part="${id}"${html.slice(endOffset)}`;
  }

  // CSS と JS の値を合わせる。根に値がなければ、CSS と JS で使っている値が1つのときだけ
  const values = new Set([...selectorValues(parts.css), ...selectorValues(parts.js ?? '')]);
  const from = current ?? (values.size === 1 ? [...values][0] : null);
  const rename = (code: string) =>
    code.replace(PART_SELECTOR, (whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const value = double ?? single ?? bare;
      if (value !== from) return whole;
      return double !== undefined ? `[data-ld-part="${id}"]` : single !== undefined ? `[data-ld-part='${id}']` : `[data-ld-part="${id}"]`;
    });
  const css = from !== null && from !== id ? rename(parts.css) : parts.css;
  const js = parts.js !== null && from !== null && from !== id ? rename(parts.js) : parts.js;
  if (from !== null && from !== id && (current !== null || css !== parts.css || js !== parts.js)) notes.push({ kind: 'renamed', from, id });
  return { parts: { html, css, js }, notes };
}

/**
 * 3つを1つの箱の形に戻す（「細かく直す」で直したとき、箱を合わせるため）。splitSnippet に通すと同じ3つに戻る。
 * クレジット行は入れない（サーバーが「コピーされるコード」を作るときに付ける）。
 */
export function joinParts(parts: Parts, id: string): string {
  const lines = [parts.html.trim(), '<style>', parts.css.trim(), '</style>'];
  if (parts.js !== null && parts.js.trim() !== '') {
    lines.push('<script type="module">', parts.js.trim(), `mount(document.querySelector('[data-ld-part="${id}"]'));`, '</script>');
  }
  return `${lines.join('\n')}\n`;
}
