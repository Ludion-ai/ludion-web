// 投稿の検査（docs/tasks/T021.md「2」、SEC001 A02）。ブラウザと Worker で同じものを流す。Node の API を使わない。
//
// - required（必須）：安全と形。根の data-ld-part、セレクタが根の下、外への通信なし、ページを移らない、外へのリンクなし、イベント属性なし、大きさの上限。
// - optional（任意）：10個のトークン。合っていなくても出せる。合っている作品には、後で「試着できる」印を付ける（今は印を作らない）。
//
// 通らなければ安全、という意味ではない。任意の JS の安全は機械では証明できないので、全部の投稿を公開の前に運営が見る。
// reviewFlags は、そのときに見る「気になる書き方」の印。検査と違って、文字列の中も含めて生のまま探す。

import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import { at, checkCssShape, checkJs, checkJsPurity, checkPurity, checkReducedMotion, CATEGORIES, insideKeyframes, isNested, leavesFrame, rootSelectors, scanJs, type Problem } from './rules.ts';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

export type Category = (typeof CATEGORIES)[number];

/** 種類は、今ある category と subtype から選ぶ（docs/tasks/T021.md 段階 B）。 */
export const SUBTYPES: Record<Category, readonly string[]> = {
  Web: ['Landing Page', 'Login Page', 'Portfolio', 'Documentation', 'Ecommerce', 'Media', 'Streaming', 'Event', 'Food', 'Education'],
  Mobile: ['Travel', 'Finance', 'Wellness', 'Weather', 'Food', 'Productivity', 'Ecommerce', 'Education', 'Fitness', 'Lifestyle'],
  Dashboard: ['Analytics', 'Productivity', 'CRM', 'Infrastructure', 'Helpdesk', 'Operations', 'Home'],
  Ecommerce: ['Ecommerce'],
  Components: ['UI Kit', 'Cards', 'Button', 'Toggle', 'Checkbox', 'Input', 'Form', 'Nav', 'Tabs', 'Slider', 'Progress Bar', 'Like Button', 'Overlay', 'Dashboard', 'Media'],
};

/** 差し戻しの理由。画面の文は copy.ts。 */
export const REJECT_CODES = ['dangerous', 'deceptive', 'rights', 'quality', 'broken', 'other'] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

/** 1ファイルの上限（バイト）。ld upload と同じ。 */
export const MAX_PART_BYTES = 256 * 1024;
export const MAX_TITLE_CHARS = 120;

/** 作品の形は、選んだ種類からサーバーが決める。送られてきた値を使わない。 */
export function workShape(category: Category): { type: 'screen' | 'component'; platform: 'web' | 'mobile' | null } {
  if (category === 'Components') return { type: 'component', platform: null };
  return { type: 'screen', platform: category === 'Mobile' ? 'mobile' : 'web' };
}

/** 画面に出す問題。en があれば、英語のページではそちらを出す。 */
export interface ProblemText extends Problem {
  en?: { message: string; fix: string };
}

const problem = (message: string, fix: string, enMessage: string, enFix: string): ProblemText => ({ message, fix, en: { message: enMessage, fix: enFix } });

// ---------------------------------------------------------------- part.html

/** 作品に入れられない要素。CSS は part.css、JS は part.js へ。埋め込みと、文書の頭に置くものと、文字のまま読まれて後ろを飲み込むもの。 */
const BANNED_ELEMENTS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'meta', 'head', 'html', 'body', 'noscript', 'noembed', 'noframes', 'plaintext', 'xmp', 'listing', 'template', 'portal', 'fencedframe',
]);
/** 読むと外へ通信する属性。a と area の href は「移るか」で別に見る。 */
const FETCHING_ATTRIBUTES = new Set(['src', 'srcset', 'href', 'poster', 'background', 'data', 'lowsrc', 'dynsrc', 'manifest', 'icon', 'code', 'codebase', 'archive', 'profile']);
/** パーサーがここまで読めなかった印。枠の中で後ろの決まった HTML まで飲み込むので断る。 */
const FATAL_PARSE_ERRORS = new Set(['eof-in-comment', 'eof-in-tag', 'eof-in-cdata', 'eof-in-doctype', 'eof-in-script-html-comment-like-text']);
const SVG_ANIMATION = new Set(['animate', 'set', 'animatetransform', 'animatemotion']);

/** ブラウザが URL を読むときと同じように、空白と制御文字を捨て、\ を / にする。 */
// eslint-disable-next-line no-control-regex
const normalizeUrl = (value: string) => value.replace(/[\u0000- ]+/g, '').replace(/\\/g, '/');

const isSafeResource = (value: string) => {
  const url = normalizeUrl(value);
  return url === '' || url.startsWith('#') || /^data:image\//i.test(url);
};

const isElement = (node: Node): node is Element => 'tagName' in node;

/** 根が1つで data-ld-part="<id>" を持ち、中に危ないものがないか。パーサーはブラウザと同じ読み方をする（文字参照を戻し、/ で区切った属性も読む）。 */
export function checkPartHtml(html: string, id: string): ProblemText[] {
  const found: ProblemText[] = [];
  const fatal = new Set<string>();
  const fragment = parseFragment(html, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (FATAL_PARSE_ERRORS.has(error.code)) fatal.add(error.code);
    },
  });
  if (fatal.size > 0) {
    found.push(problem('part.html の最後でタグかコメントが閉じていない', '<!-- … --> や <… > の閉じ忘れを直す', 'A tag or comment is not closed at the end of part.html', 'Close the <!-- … --> or <… >'));
  }
  // </template> は根の外へ抜けられる。パーサーは黙って捨てるので、文字で探す
  if (/<\/?template\b/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) {
    found.push(problem('part.html に <template> がある', '<template> を使わない', 'part.html has a <template>', 'Remove the <template>'));
  }

  const top = fragment.childNodes.filter((node) => isElement(node) || (node.nodeName === '#text' && (node as DefaultTreeAdapterTypes.TextNode).value.trim() !== ''));
  const elements = top.filter(isElement);
  if (elements.length === 0) {
    found.push(problem('part.html に要素がない', `<div data-ld-part="${id}">…</div> の形にする`, 'part.html has no element', `Use <div data-ld-part="${id}">…</div>`));
    return found;
  }
  if (top.length > 1) {
    found.push(problem('part.html の一番外に、根のほかの要素か文字がある', `すべてを <div data-ld-part="${id}"> の中に入れる`, 'part.html has more than one thing at the top level', `Put everything inside <div data-ld-part="${id}">`));
  }
  const root = elements[0];
  const part = root.attrs.find((attr) => attr.name === 'data-ld-part')?.value ?? null;
  if (part === null) {
    found.push(problem(`根の要素 <${root.tagName}> に data-ld-part がない`, `根の要素に data-ld-part="${id}" を付ける`, `The root <${root.tagName}> has no data-ld-part`, `Add data-ld-part="${id}" to the root element`));
  } else if (part !== id) {
    found.push(problem(`根の data-ld-part が "${part}" で、作品の ID "${id}" と違う`, `data-ld-part="${id}" にする`, `The root data-ld-part is "${part}", but the work ID is "${id}"`, `Use data-ld-part="${id}"`));
  }
  if (root.sourceCodeLocation && !root.sourceCodeLocation.endTag && part !== null) {
    found.push(problem(`根の要素 <${root.tagName}> が閉じていない`, `最後に </${root.tagName}> を足す`, `The root <${root.tagName}> is not closed`, `Add </${root.tagName}> at the end`));
  }

  // 深い入れ子でスタックを使い切らないよう、自分でたどる
  const stack: Node[] = [...fragment.childNodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    const line = node.sourceCodeLocation?.startLine;
    const where = line ? `part.html ${line}行目` : 'part.html';
    const whereEn = line ? `part.html line ${line}` : 'part.html';
    const name = node.tagName.toLowerCase();
    const isHtmlElement = node.namespaceURI === 'http://www.w3.org/1999/xhtml';
    if (BANNED_ELEMENTS.has(name) || (name === 'title' && isHtmlElement)) {
      const fix = name === 'script' ? 'JS は part.js に書き、export function mount(root) の中で動かす' : name === 'style' ? 'CSS は part.css に書く' : `<${name}> を使わない`;
      const fixEn = name === 'script' ? 'Put JS in part.js, inside export function mount(root)' : name === 'style' ? 'Put CSS in part.css' : `Remove the <${name}>`;
      found.push(problem(`${where} に <${name}> がある`, fix, `${whereEn} has a <${name}>`, fixEn));
    }
    for (const attr of node.attrs) {
      const full = attr.name.toLowerCase();
      const local = full.split(':').pop()!;
      if (local.startsWith('on')) {
        found.push(problem(`${where} の <${name}> にイベント属性 ${full} がある`, 'part.js の mount の中で addEventListener を使う', `${whereEn}: <${name}> has the event attribute ${full}`, 'Use addEventListener inside mount in part.js'));
      } else if (full === 'style') {
        for (const bad of outboundInCss(attr.value)) {
          found.push(problem(`${where} の style が外へ通信する（${bad}）`, '画像は data: で入れるか、外への URL を消す', `${whereEn}: style reaches outside (${bad})`, 'Use a data: image or remove the URL'));
        }
      } else if (full === 'ping') {
        found.push(problem(`${where} の <${name}> に ping がある`, 'ping を消す', `${whereEn}: <${name}> has ping`, 'Remove ping'));
      } else if ((name === 'a' || name === 'area') && local === 'href') {
        if (leavesFrame(attr.value)) {
          found.push(problem(`${where} の <${name} href="${attr.value}"> が外へ移る`, '作品からページを移らない。外への導線を見せたいときは href="#" にする', `${whereEn}: <${name} href="${attr.value}"> leaves the frame`, 'Works do not navigate. Use href="#" to show a link'));
        }
      } else if (full === 'action' || full === 'formaction') {
        const url = normalizeUrl(attr.value);
        if (url !== '' && !url.startsWith('#')) {
          found.push(problem(`${where} の <${name} ${full}="${attr.value}"> が外へ送る`, `${full} を消して、part.js で submit を受ける`, `${whereEn}: <${name} ${full}="${attr.value}"> sends data outside`, `Remove ${full} and handle submit in part.js`));
        }
      } else if (FETCHING_ATTRIBUTES.has(local) && !isSafeResource(attr.value)) {
        found.push(problem(`${where} の <${name} ${full}> が外へ通信する（${attr.value.slice(0, 80)}）`, '画像は data: で入れるか、消す', `${whereEn}: <${name} ${full}> reaches outside (${attr.value.slice(0, 80)})`, 'Use a data: image or remove it'));
      } else if (SVG_ANIMATION.has(name) && full === 'attributename' && /^(?:xlink:)?href$|^on/i.test(attr.value.trim())) {
        found.push(problem(`${where} の <${name}> が ${attr.value} を書き換える`, 'href とイベント属性を動かさない', `${whereEn}: <${name}> animates ${attr.value}`, 'Do not animate href or event attributes'));
      }
    }
    stack.push(...node.childNodes);
    if ('content' in node) stack.push(...(node as DefaultTreeAdapterTypes.Template).content.childNodes);
  }
  return found;
}

// ---------------------------------------------------------------- part.css

/** CSS の文字のエスケープを戻す（u\72l( は url( と同じ）。 */
const decodeCssEscapes = (value: string) =>
  value
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
    })
    .replace(/\\([^\n])/g, '$1');

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const QUOTED = /"([^"]*)"|'([^']*)'/g;
const FONT_HOST = /^https:\/\/fonts\.gstatic\.com\//i;

/** 値の中の、外へ通信する URL。data: と #（SVG の参照）はよい。fonts：@font-face の src で、書体の配信先を許す。 */
function outboundInCss(value: string, fonts = false): string[] {
  const bad: string[] = [];
  const text = decodeCssEscapes(value.replace(/\/\*[\s\S]*?\*\//g, ' '));
  const okUrl = (url: string) => {
    const u = normalizeUrl(url);
    return u === '' || u.startsWith('#') || /^data:(?:image|font|application\/(?:font|x-font))/i.test(u) || (fonts && FONT_HOST.test(u));
  };
  const rest = text.replace(CSS_URL, (_, a?: string, b?: string, c?: string) => {
    const url = a ?? b ?? c ?? '';
    if (!okUrl(url)) bad.push(url.slice(0, 80));
    return ' ';
  });
  // url() を通らない形：image-set("https://…" 1x)、src("…")
  for (const m of rest.matchAll(QUOTED)) {
    const url = normalizeUrl(m[1] ?? m[2] ?? '');
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^(?:https?|ftp):/i.test(url)) bad.push(url.slice(0, 80));
  }
  // 閉じていない url( は、ブラウザが最後まで URL として読む
  if (/url\(/i.test(rest)) bad.push('url(');
  return bad;
}

const POST_AT_RULES = /^(media|supports|container|layer|font-face|import|(-webkit-)?keyframes)$/i;
const FONT_IMPORT = /^(?:url\(\s*)?["']?https:\/\/fonts\.googleapis\.com\/[^"'()\s]*["']?\s*\)?$/i;

/** セレクタが根の下にあるか。外への通信がないか。トークンは見ない。 */
export function checkPartCss(css: string, id: string): ProblemText[] {
  const found: ProblemText[] = [];
  let root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    const e = error as { line?: number; reason?: string; message: string };
    const reason = `${e.line ? `${e.line}行目：` : ''}${e.reason ?? e.message}`;
    return [problem(`part.css を読めない（${reason}）`, '括弧や ; の閉じ忘れを直す', `part.css cannot be read (${e.line ? `line ${e.line}: ` : ''}${e.reason ?? e.message})`, 'Fix unclosed brackets or missing semicolons')];
  }
  const [prefix] = rootSelectors(id);
  const line = (node: { source?: { start?: { line: number } } }) => node.source?.start?.line;
  const whereEn = (node: { source?: { start?: { line: number } } }) => (line(node) ? `part.css line ${line(node)}` : 'part.css');

  root.walkAtRules((rule: AtRule) => {
    if (!POST_AT_RULES.test(rule.name)) {
      found.push(problem(`${at(rule)} の @${rule.name} は使えない`, '@media、@supports、@container、@layer、@keyframes、@font-face、書体の @import だけにする', `${whereEn(rule)}: @${rule.name} is not allowed`, 'Use only @media, @supports, @container, @layer, @keyframes, @font-face, and font @import'));
    } else if (/^import$/i.test(rule.name) && !FONT_IMPORT.test(decodeCssEscapes(rule.params.trim()))) {
      found.push(problem(`${at(rule)} の @import ${rule.params.slice(0, 80)} が外へ通信する`, '読み込めるのは Google Fonts の書体だけ', `${whereEn(rule)}: @import ${rule.params.slice(0, 80)} reaches outside`, 'Only Google Fonts can be imported'));
    }
  });
  root.walkRules((rule: Rule) => {
    if (insideKeyframes(rule)) return;
    if (isNested(rule)) {
      for (const selector of rule.selectors) {
        if (/^(?:&\s*)?[~+]/.test(selector.trim())) {
          found.push(problem(`${at(rule)} のセレクタ "${selector.trim()}" が根の外を指す`, '根の中だけを指す', `${whereEn(rule)}: selector "${selector.trim()}" points outside the root`, 'Point only inside the root'));
        }
      }
      return;
    }
    for (const selector of rule.selectors) {
      const s = selector.trim();
      const matched = rootSelectors(id).find((r) => s.startsWith(r));
      if (!matched) {
        found.push(problem(`${at(rule)} のセレクタ "${s}" が根の下にない`, `${prefix} ${s} の形にする`, `${whereEn(rule)}: selector "${s}" is not under the root`, `Use ${prefix} ${s}`));
      } else if (/^\s*[~+]/.test(s.slice(matched.length))) {
        found.push(problem(`${at(rule)} のセレクタ "${s}" が根の外を指す`, `${prefix} の中だけを指す`, `${whereEn(rule)}: selector "${s}" points outside the root`, `Point only inside ${prefix}`));
      }
    }
  });
  root.walkDecls((decl: Declaration) => {
    const inFontFace = decl.parent?.type === 'atrule' && /^font-face$/i.test((decl.parent as AtRule).name);
    for (const bad of outboundInCss(decl.value, inFontFace)) {
      found.push(problem(`${at(decl)} ${decl.prop} が外へ通信する（${bad}）`, '画像は data: で入れるか、外への URL を消す', `${whereEn(decl)}: ${decl.prop} reaches outside (${bad})`, 'Use a data: image or remove the URL'));
    }
  });
  return found;
}

// ---------------------------------------------------------------- part.js

/** 外へ通信する、または文字からコードを作る書き方。コメントと文字列の中は見ない。すり抜ける形はあるので、審査で見る。 */
const JS_OUTBOUND: { pattern: RegExp; name: string }[] = [
  { pattern: /(?<![.\w$])fetch(?![\w$])/g, name: 'fetch' },
  { pattern: /(?<![.\w$])XMLHttpRequest(?![\w$])/g, name: 'XMLHttpRequest' },
  { pattern: /(?<![.\w$])WebSocket(?![\w$])/g, name: 'WebSocket' },
  { pattern: /(?<![.\w$])EventSource(?![\w$])/g, name: 'EventSource' },
  { pattern: /(?<![.\w$])RTCPeerConnection(?![\w$])/g, name: 'RTCPeerConnection' },
  { pattern: /(?<![.\w$])WebTransport(?![\w$])/g, name: 'WebTransport' },
  { pattern: /\bsendBeacon\b/g, name: 'sendBeacon' },
  { pattern: /(?<![.\w$])importScripts(?![\w$])/g, name: 'importScripts' },
  { pattern: /(?<![.\w$])import\s*\(/g, name: 'import()' },
  { pattern: /(?:^|[;\n])\s*import\b(?!\s*[(.])/g, name: 'import' },
  { pattern: /\bnew\s+(?:Shared)?Worker\b/g, name: 'Worker' },
  { pattern: /\bserviceWorker\b/g, name: 'serviceWorker' },
  { pattern: /(?<![.\w$])eval(?![\w$])/g, name: 'eval' },
  { pattern: /(?<![.\w$])Function\s*\(/g, name: 'Function' },
  { pattern: /\.constructor\s*\(/g, name: '.constructor()' },
  { pattern: /\bdocument\s*\.\s*(?:cookie|write(?:ln)?)\b/g, name: 'document.cookie / document.write' },
  { pattern: /(?<![.\w$])(?:window|globalThis|self)\s*\[/g, name: 'window[…]' },
];
const CREATE_SCRIPT = /createElement(?:NS)?\s*\(\s*(?:[^,)]*,\s*)?["'`]script["'`]/i;

/** mount があり、document を直に探さず、ページを移らず、外へ通信しないか。 */
export function checkPartJs(js: string): ProblemText[] {
  const found: ProblemText[] = checkJs(js);
  const { code } = scanJs(js);
  for (const { pattern, name } of JS_OUTBOUND) {
    for (const m of code.matchAll(pattern)) {
      const line = code.slice(0, m.index).split('\n').length;
      found.push(problem(`part.js ${line}行目 が ${name} を使っている`, '作品から外へ通信しない。文字からコードを作らない', `part.js line ${line} uses ${name}`, 'Works do not reach outside or build code from text'));
    }
  }
  if (CREATE_SCRIPT.test(js)) {
    found.push(problem('part.js が <script> を作っている', '作品の中で <script> を作らない', 'part.js creates a <script>', 'Do not create <script> in a work'));
  }
  return found;
}

// ---------------------------------------------------------------- 全体

export interface Submission {
  id: string;
  type: 'screen' | 'component';
  tags: readonly string[];
  html: string;
  css: string;
  js: string | null;
}

export interface SubmissionResult {
  /** 直さないと出せないこと */
  required: ProblemText[];
  /** 10個のトークンに合っていないところ。直さなくても出せる */
  optional: ProblemText[];
}

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

/** 投げない。読めないものは required に入れる（例外で 500 にしないため。SEC001 A05）。 */
export function checkSubmission({ id, type, tags, html, css, js }: Submission): SubmissionResult {
  const required: ProblemText[] = [];
  const optional: ProblemText[] = [];
  const safely = (file: string, run: () => void) => {
    try {
      run();
    } catch {
      required.push(problem(`${file} を最後まで読めない`, '入れ子を浅くするか、小さくする', `${file} cannot be read to the end`, 'Nest less deeply or make it smaller'));
    }
  };
  for (const [file, text] of [['part.html', html], ['part.css', css], ['part.js', js ?? '']] as const) {
    const size = bytesOf(text);
    if (size > MAX_PART_BYTES) {
      required.push(problem(`${file} が ${(size / 1024).toFixed(1)}KB で、上限 ${MAX_PART_BYTES / 1024}KB を超える`, '小さくする', `${file} is ${(size / 1024).toFixed(1)}KB, over the ${MAX_PART_BYTES / 1024}KB limit`, 'Make it smaller'));
    }
  }
  if (required.length > 0) return { required, optional };

  safely('part.html', () => required.push(...checkPartHtml(html, id)));
  safely('part.css', () => required.push(...checkPartCss(css, id)));
  if (js !== null) safely('part.js', () => required.push(...checkPartJs(js)));

  safely('part.css', () => {
    optional.push(...checkCssShape(css, id, 'component').problems.filter((p) => !required.some((r) => r.message === p.message)));
    optional.push(...checkPurity(css, id).problems);
    if (js !== null) optional.push(...checkJsPurity(js).problems);
    optional.push(...checkReducedMotion(tags, css, js));
  });
  // 部品でなくても、合っていれば同じように扱える。type は今は使わないが、画面の検査を変えるときのために受け取る
  void type;
  return { required, optional };
}

// ---------------------------------------------------------------- 審査の印

export interface FlagHit {
  /** 何の印か */
  name: string;
  file: 'part.html' | 'part.css' | 'part.js';
  line: number;
  /** その行（長ければ切る） */
  excerpt: string;
}

const FLAG_PATTERNS: Record<FlagHit['file'], { name: string; pattern: RegExp }[]> = {
  'part.js': [
    { name: 'fetch', pattern: /\bfetch\b/ },
    { name: 'XMLHttpRequest', pattern: /XMLHttpRequest/ },
    { name: 'WebSocket', pattern: /WebSocket/ },
    { name: 'EventSource', pattern: /EventSource/ },
    { name: 'sendBeacon', pattern: /sendBeacon/ },
    { name: 'location', pattern: /\blocation\b/ },
    { name: 'eval', pattern: /\beval\b/ },
    { name: 'Function', pattern: /\bFunction\b/ },
    { name: 'import(', pattern: /\bimport\s*\(/ },
    { name: 'postMessage', pattern: /postMessage/ },
    { name: 'window[…]', pattern: /\b(?:window|globalThis|self|this)\s*\[/ },
    { name: 'open(', pattern: /(?<![\w$])open\s*\(/ },
    { name: 'innerHTML', pattern: /\b(?:inner|outer)HTML\b|insertAdjacentHTML/ },
    { name: '.src / .href', pattern: /\.(?:src|href|action|formAction)\s*=/ },
    { name: 'setAttribute', pattern: /setAttribute\s*\(\s*["'`](?:on|src|href|action)/i },
    { name: 'cookie / storage', pattern: /\bcookie\b|localStorage|sessionStorage|indexedDB/ },
    { name: 'navigator', pattern: /\bnavigator\b/ },
    { name: 'atob / fromCharCode', pattern: /\batob\b|fromCharCode|fromCodePoint/ },
    { name: 'setTimeout("…")', pattern: /set(?:Timeout|Interval)\s*\(\s*["'`]/ },
    { name: 'password', pattern: /password|credential/i },
    { name: 'parent / top', pattern: /\b(?:parent|top|opener|frameElement)\b/ },
  ],
  'part.html': [
    { name: 'on*=', pattern: /\son[a-z]+\s*=/i },
    { name: '<form', pattern: /<form\b/i },
    { name: 'type=password', pattern: /type\s*=\s*["']?password/i },
    { name: 'autocomplete', pattern: /autocomplete\s*=\s*["']?(?:cc-|current-password|new-password|one-time-code)/i },
    { name: 'href="/…"', pattern: /href\s*=\s*["']?\//i },
    { name: 'http(s)://', pattern: /https?:\/\//i },
    { name: 'data:', pattern: /\bdata:(?!image\/)/i },
  ],
  'part.css': [
    { name: 'url(', pattern: /url\(\s*["']?(?!data:|#)/i },
    { name: '@import', pattern: /@import/i },
    { name: 'position: fixed', pattern: /position\s*:\s*fixed/i },
    { name: 'z-index', pattern: /z-index\s*:\s*\d{4,}/i },
    { name: 'pointer-events', pattern: /pointer-events\s*:\s*none/i },
    { name: 'http(s)://', pattern: /https?:\/\//i },
  ],
};

const MAX_FLAGS = 60;
const MAX_EXCERPT = 160;

/** 審査で見る「気になる書き方」。悪いと決まったものではない。検査と違って、文字列とコメントの中も探す。 */
export function reviewFlags({ html, css, js }: { html: string; css: string; js: string | null }): FlagHit[] {
  const hits: FlagHit[] = [];
  const files: [FlagHit['file'], string | null][] = [['part.js', js], ['part.html', html], ['part.css', css]];
  for (const [file, text] of files) {
    if (text === null) continue;
    text.split(/\r?\n/).forEach((lineText, index) => {
      for (const { name, pattern } of FLAG_PATTERNS[file]) {
        if (hits.length < MAX_FLAGS && pattern.test(lineText)) hits.push({ name, file, line: index + 1, excerpt: lineText.trim().slice(0, MAX_EXCERPT) });
      }
    });
  }
  return hits;
}
