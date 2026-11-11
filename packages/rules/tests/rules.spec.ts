import { expect, test } from '@playwright/test';
import { HANDLE_PATTERN, checkCreator, checkCssShape, checkHtml, checkJs, checkJsPurity, checkMeta, checkPurity, checkReducedMotion, checkTokenUse, checkTokensLocked, colorLiterals, imageSize, sameHandle } from '../src/rules.ts';

const ID = 'card-x';
const ROOT = `[data-ld-part="${ID}"]`;
const TOKENS = `${ROOT} {
  --_bg: var(--ld-bg, #ffffff); --_surface: var(--ld-surface, #f4f4f5); --_fg: var(--ld-fg, #111111);
  --_muted: var(--ld-muted, #555555); --_accent: #ff6a3d; --_radius: var(--ld-radius, 8px);
  --_font: var(--ld-font, system-ui, sans-serif); --_space: var(--ld-space, 8px);
  --_shadow: var(--ld-shadow, 0 1px 3px rgb(0 0 0 / .12)); --_motion: var(--ld-motion, 150ms);
}`;

const META = {
  id: ID,
  title: 'Card',
  type: 'component',
  platform: null,
  category: 'Components',
  subtype: 'Card',
  tags: ['minimal'],
  creator: 'fixture',
  license: 'MIT',
  made_with: 'ai-assisted',
  version: '1',
  published_at: '2026-11-09',
  pin_order: null,
};
const yes = () => true;

test.describe('meta.json', () => {
  test('契約どおりなら問題なし', () => {
    expect(checkMeta(META, ID, yes)).toEqual([]);
  });

  test('capture は任意。delay_ms は 0〜8000 の整数だけ', () => {
    const messages = (capture: unknown) => checkMeta({ ...META, capture }, ID, yes).map((p) => p.message);
    for (const delay_ms of [0, 2600, 8000]) expect(messages({ delay_ms })).toEqual([]);
    for (const delay_ms of [-1, 8001, 1.5, '100', null]) expect(messages({ delay_ms })).toContain(`capture.delay_ms "${String(delay_ms)}" は使えない`);
    expect(messages({})).toContain('capture.delay_ms "undefined" は使えない');
    expect(messages({ delay_ms: 1, wait: 2 })).toContain('capture に知らない項目 "wait" がある');
    for (const capture of [null, 100, 'x', [1]]) expect(messages(capture)).toContain('capture がオブジェクトではない');
  });

  test('made_with がない、または値が違えば落とす（CLAUDE.md 原則9）', () => {
    const { made_with: _, ...without } = META;
    expect(checkMeta(without, ID, yes).map((p) => p.message)).toContain('meta.json に "made_with" がない');
    expect(checkMeta({ ...META, made_with: 'ai' }, ID, yes).map((p) => p.message)).toContain('made_with "ai" は使えない');
  });

  test('id とフォルダ名、作者、画面の platform、知らない項目', () => {
    const messages = (raw: unknown, creator = yes) => checkMeta(raw, ID, creator).map((p) => p.message);
    expect(messages({ ...META, id: 'other' })).toEqual(['id "other" がフォルダ名 "card-x" と違う']);
    expect(messages(META, () => false)[0]).toMatch(/^作者 @fixture がいない/);
    expect(messages({ ...META, type: 'screen', platform: null })).toEqual(['画面（screen）なのに platform が null']);
    expect(messages({ ...META, colour: 'red' })).toEqual(['meta.json に知らない項目 "colour" がある']);
    expect(messages({ ...META, tags: ['cool'] })).toEqual(['tags の "cool" は使えない']);
    expect(messages({ ...META, category: 'Apps' })).toEqual(['category "Apps" は使えない']);
    expect(messages({ ...META, published_at: '2026-02-30' })).toEqual(['published_at "2026-02-30" が日付ではない']);
    expect(messages({ ...META, license: 'Apache-2.0' })).toEqual(['license "Apache-2.0" は使えない']);
  });
});

test.describe('part.html の外へのリンク（T012）', () => {
  const link = (attrs: string, tag = 'a') => checkHtml(`<div data-ld-part="${ID}"><${tag} ${attrs}>x</${tag}></div>`, ID).map((p) => p.message);

  for (const href of [
    'https://example.com',
    'http://example.com',
    'HTTPS://example.com',
    '//example.com',
    '/\\example.com',
    '\\\\example.com',
    ' https://example.com',
    'ht\ntps://example.com',
    'javascript:alert(1)',
    '&#104;ttps://example.com',
    '&#x68;ttps://example.com',
    'https&colon;//example.com',
  ]) {
    test(`落ちる：${JSON.stringify(href)}`, () => {
      expect(link(`href="${href}"`)).toEqual([`part.html の <a href="${href}"> が外へ移る`]);
    });
  }

  test('引用符なし、単一引用符、area、xlink:href も見る', () => {
    expect(link('href=https://example.com')).toHaveLength(1);
    expect(link("href='https://example.com'")).toHaveLength(1);
    expect(checkHtml(`<div data-ld-part="${ID}"><map name="m"><area href="https://example.com"></map></div>`, ID)).toHaveLength(1);
    expect(link('xlink:href="https://example.com"')).toHaveLength(1);
  });

  for (const href of ['#', '#top', '', 'mailto:a@example.com', 'tel:+81000000000', 'next.html', '/about', '?a=1']) {
    test(`通る：${JSON.stringify(href)}`, () => {
      expect(link(`href="${href}"`)).toEqual([]);
    });
  }

  test('リンク以外の要素と、href 以外の属性は見ない', () => {
    expect(link('href="https://example.com"', 'span')).toEqual([]);
    expect(link('data-href="https://example.com"')).toEqual([]);
    expect(link('title="https://example.com"')).toEqual([]);
  });
});

test.describe('part.html', () => {
  test('根が1つで data-ld-part が合えば問題なし', () => {
    expect(checkHtml(`<!-- note -->\n<div data-ld-part="${ID}"><img alt="" src="data:,"><br><p>a</p><svg><path d="M0 0"/></svg></div>\n`, ID)).toEqual([]);
  });

  test('根の外の要素と文字、違う id、script、閉じ忘れ', () => {
    const messages = (html: string) => checkHtml(html, ID).map((p) => p.message);
    expect(messages(`<div data-ld-part="${ID}"></div><p>x</p>`)).toEqual(['part.html の一番外に要素が 2 個ある']);
    expect(messages(`hello <div data-ld-part="${ID}"></div>`)).toEqual(['part.html の根の外に文字がある']);
    expect(messages(`<div data-ld-part="other"></div>`)).toEqual(['根の data-ld-part が "other" で、id "card-x" と違う']);
    expect(messages(`<div class="x"></div>`)).toEqual(['根の要素 <div> に data-ld-part がない']);
    expect(messages(`<div data-ld-part="${ID}"><script>alert(1)</script></div>`)).toEqual(['part.html に <script> がある']);
    expect(messages(`<div data-ld-part="${ID}"><span>`)).toEqual(['part.html の <div> が閉じていない']);
  });
});

test.describe('part.css の形', () => {
  test('すべてのセレクタが根の下にあり、10個の --_* があれば問題なし', () => {
    const css = `${TOKENS}
${ROOT} .a, ${ROOT}:hover .b, ${ROOT}[data-on] > .c { color: var(--_fg); }
@media (max-width: 600px) { ${ROOT} .a { padding: 0; } }
@keyframes pulse { from { opacity: 0; } 50% { opacity: .5; } to { opacity: 1; } }
${ROOT} .d { & .e { color: var(--_muted); } }`;
    expect(checkCssShape(css, ID, 'component')).toEqual({ problems: [], warnings: [] });
  });

  test('根の外のセレクタを落とす（セレクタの並びの1つだけでも）', () => {
    const { problems } = checkCssShape(`${TOKENS}\n${ROOT} .a, .b { color: var(--_fg); }\nbody { margin: 0 }`, ID, 'component');
    expect(problems.map((p) => p.message)).toEqual(['part.css 7行目 のセレクタ ".b" が根の下にない', 'part.css 8行目 のセレクタ "body" が根の下にない']);
  });

  test('10個の --_* が足りなければ、部品は落とし、画面は警告', () => {
    const css = `${ROOT} { --_bg: var(--ld-bg, #fff); --_fg: var(--ld-bg, #000); }`;
    const component = checkCssShape(css, ID, 'component');
    expect(component.problems.map((p) => p.message)).toEqual([
      `根 ${ROOT} で --_surface、--_muted、--_accent、--_radius、--_font、--_space、--_shadow、--_motion を宣言していない`,
      '根の --_fg が --ld-bg を読んでいる',
    ]);
    const screen = checkCssShape(css, ID, 'screen');
    expect(screen.problems).toEqual([]);
    expect(screen.warnings).toHaveLength(2);
  });

  test('読めない CSS', () => {
    expect(checkCssShape(`${ROOT} { color: red`, ID, 'component').problems[0].message).toMatch(/^part\.css を読めない/);
  });
});

test.describe('トークンの純度', () => {
  test('根の既定値の色は数えない', () => {
    expect(checkPurity(TOKENS, ID)).toEqual({ literals: 0, problems: [] });
  });

  test('本体の色のリテラルを数える', () => {
    const css = `${TOKENS}
${ROOT} .a { color: red; background: #fff; border: 1px solid rgb(0 0 0 / .1); outline-color: oklch(70% .1 200); }
${ROOT} .b { --_extra: #123456; }`;
    const result = checkPurity(css, ID);
    expect(result.literals).toBe(5);
    expect(result.problems.map((p) => p.message)).toEqual([
      'part.css 7行目 color の色 red',
      'part.css 7行目 background の色 #fff',
      'part.css 7行目 border の色 rgb(0 0 0 / .1)',
      'part.css 7行目 outline-color の色 oklch(70% .1 200)',
      'part.css 8行目 --_extra の色 #123456',
    ]);
  });

  test('color-mix で --_* を明るく・暗くするのは数えない。ほかの色を混ぜたら数える', () => {
    expect(colorLiterals('background', 'color-mix(in oklab, var(--_accent) 85%, black)')).toEqual([]);
    expect(colorLiterals('background', 'color-mix(in oklab, var(--_accent) 30%, white)')).toEqual([]);
    expect(colorLiterals('background', 'color-mix(in oklab, var(--_accent), var(--_bg))')).toEqual([]);
    expect(colorLiterals('background', 'color-mix(in oklab, var(--_accent), #000)')).toEqual(['#000']);
    expect(colorLiterals('background', 'color-mix(in oklab, var(--_accent), tomato)')).toEqual(['tomato']);
  });

  test('色ではない名前や、色相を足さないものは数えない', () => {
    expect(colorLiterals('color', 'transparent')).toEqual([]);
    expect(colorLiterals('color', 'currentColor')).toEqual([]);
    expect(colorLiterals('animation-name', 'red')).toEqual([]);
    expect(colorLiterals('font-family', 'Tomato, sans-serif')).toEqual([]);
    expect(colorLiterals('grid-template-areas', '"tan tan"')).toEqual([]);
    expect(colorLiterals('background', 'url("#red") var(--_redish)')).toEqual([]);
    expect(colorLiterals('transition', 'background var(--_motion) ease-in-out')).toEqual([]);
    expect(colorLiterals('color', 'color-mix(in oklab, var(--_fg) 60%, transparent)')).toEqual([]);
  });

  test('本体で --ld-* を直に読むのも数える', () => {
    const result = checkPurity(`${TOKENS}\n${ROOT} .a { color: var(--ld-accent); }`, ID);
    expect(result.problems.map((p) => p.message)).toEqual(['part.css 7行目 color が --ld-accent を直に読んでいる']);
  });
});

test.describe('part.js', () => {
  test('mount を export していれば問題なし', () => {
    expect(checkJs('export function mount(root) { return () => {}; }')).toEqual([]);
    expect(checkJs('const mount = (root) => () => {};\nexport { mount };')).toEqual([]);
  });

  test('mount がない、document を直に探す', () => {
    expect(checkJs('export function start(root) {}').map((p) => p.message)).toEqual(['part.js が mount を export していない']);
    expect(checkJs('export function mount(root) { document.querySelector(".x"); return () => {}; }').map((p) => p.message)).toEqual([
      'part.js が document.querySelector を使っている',
    ]);
  });

  test.describe('ページを移る書き方と、枠の外への参照は「形」で落とす（T008）', () => {
    const inMount = (body: string) => `export function mount(root) {\n  ${body}\n  return () => {};\n}`;
    const messages = (body: string) => checkJs(inMount(body)).map((p) => p.message);

    const FAILS: [string, string][] = [
      ["location = 'https://x.example';", 'location に代入している'],
      ["window.location = 'https://x.example';", 'window.location に代入している'],
      ["location += '?a=1';", 'location に代入している'],
      ["location.href = 'https://x.example';", 'location.href に代入している'],
      ["window.location.href = 'https://x.example';", 'window.location.href に代入している'],
      ["self . location . search = '?a=1';", 'self.location.search に代入している'],
      ["globalThis.location.pathname = '/a';", 'globalThis.location.pathname に代入している'],
      ["location.hash = 'a';", 'location.hash に代入している'],
      ["location.assign('https://x.example');", 'location.assign() を呼んでいる'],
      ["location.replace('https://x.example');", 'location.replace() を呼んでいる'],
      ["window.location.replace ('https://x.example');", 'window.location.replace() を呼んでいる'],
      ["window.open('https://x.example');", 'window.open() を呼んでいる'],
      ['const a = document.location;', 'document.location を使っている'],
      ["document.location.href = 'https://x.example';", 'document.location を使っている'],
      ['top.postMessage(1, "*");', 'top. を使っている'],
      ["top.location.href = 'https://x.example';", 'top. を使っている'],
      ['parent.postMessage(1, "*");', 'parent. を使っている'],
      ['const a = [...parent.frames];', 'parent. を使っている'],
      ["window.top.location.href = 'https://x.example';", 'window.top を使っている'],
      ['const a = window.parent;', 'window.parent を使っている'],
      ['const a = `${location.href = "https://x.example"}`;', 'location.href に代入している'],
    ];
    for (const [body, message] of FAILS) {
      test(`落ちる：${body}`, () => {
        expect(messages(body)).toEqual([`part.js 2行目 が ${message}`]);
      });
    }

    const PASSES = [
      'const a = location.href;',
      'if (location.href === "x" || location.hash == "y") return;',
      'const f = location => location;',
      'const location = 1;',
      'let location = 1;',
      'const rect = root.getBoundingClientRect(); const y = rect.top + rect.left;',
      'const a = root.parent.x;',
      'const a = root?.parent.x;',
      'const a = root.top.x;',
      'const a = { top: 1, parent: 2, location: 3 };',
      'const top = 1; const b = top + 1;',
      'const s = "a".replace("a", "b");',
      'const a = root.open("x");',
      'dialog.open = true;',
      'data.location.href = "x";',
      '// location.href = "x"; top.location; window.open("x")',
      '/* parent.location = "x"; */',
      'const s = "float top = 1.0; v = parent.x; location.href = 1; window.open(";',
      'const s = `top.x ${root.id} location.href = 1`;',
      'const r = /location.href = 1/;',
    ];
    for (const body of PASSES) {
      test(`通る：${body}`, () => {
        expect(messages(body)).toEqual([]);
      });
    }

    test('1つずつ、行の順に、直し方と一緒に出す', () => {
      const problems = checkJs(inMount("location.href = 'a';\n  window.open('b');\n  top.x;"));
      expect(problems.map((p) => p.message)).toEqual(['part.js 2行目 が location.href に代入している', 'part.js 3行目 が window.open() を呼んでいる', 'part.js 4行目 が top. を使っている']);
      for (const problem of problems) expect(problem.fix).not.toBe('');
    });

    test('文字列での検査なので、すり抜ける形が残る。そこは公開前の審査で見る（T013）', () => {
      expect(messages('const l = location; l.href = "x";')).toEqual([]);
      expect(messages('location["href"] = "x";')).toEqual([]);
    });
  });
});

test.describe('任意のトークン --_danger（T006）', () => {
  const danger = '--_danger: var(--ld-danger, #c81e1e);';
  const declared = TOKENS.replace(/\}$/, `  ${danger}\n}`);
  const use = `${ROOT} .error { color: var(--_danger); }`;

  test('宣言しなくても、使わなければ何も言わない。10個は今までどおり必須', () => {
    expect(checkCssShape(TOKENS, ID, 'component')).toEqual({ problems: [], warnings: [] });
    const without = TOKENS.replace('--_motion: var(--ld-motion, 150ms);', '');
    expect(checkCssShape(without, ID, 'component').problems.map((p) => p.message)).toEqual([`根 ${ROOT} で --_motion を宣言していない`]);
  });

  test('宣言して使えば通る。根の値は色のリテラルとして数えない（固定した値も）', () => {
    expect(checkCssShape(`${declared}\n${use}`, ID, 'component')).toEqual({ problems: [], warnings: [] });
    expect(checkPurity(`${declared}\n${use}`, ID)).toEqual({ literals: 0, problems: [] });
    const locked = TOKENS.replace(/\}$/, '  --_danger: #c81e1e;\n}');
    expect(checkPurity(`${locked}\n${use}`, ID)).toEqual({ literals: 0, problems: [] });
  });

  test('宣言せずに使うと「形」で落ちる。部品でも画面でも、既定値を付けても、color-mix の中でも', () => {
    for (const type of ['component', 'screen']) {
      expect(checkCssShape(`${TOKENS}\n${use}`, ID, type).problems.map((p) => p.message)).toEqual([
        'part.css 7行目 color が var(--_danger) を使っているのに、根で --_danger を宣言していない',
      ]);
    }
    for (const value of ['var(--_danger, currentColor)', 'var( --_danger )', 'color-mix(in oklab, var(--_danger) 85%, black)']) {
      expect(checkCssShape(`${TOKENS}\n${ROOT} .a { color: ${value}; }`, ID, 'component').problems, value).toHaveLength(1);
    }
    // 根の外の宣言は、宣言に数えない。そこに書いた色はリテラルとして数える
    const elsewhere = `${TOKENS}\n${ROOT} .a { --_danger: #c81e1e; color: var(--_danger); }`;
    expect(checkCssShape(elsewhere, ID, 'component').problems).toHaveLength(1);
    expect(checkPurity(elsewhere, ID).literals).toBe(1);
  });

  test('--_danger が別の --ld-* を読む、本体で --ld-danger を直に読むのは今までどおり', () => {
    const wrong = TOKENS.replace(/\}$/, '  --_danger: var(--ld-accent, #c81e1e);\n}');
    expect(checkCssShape(wrong, ID, 'component').problems.map((p) => p.message)).toEqual(['根の --_danger が --ld-accent を読んでいる']);
    expect(checkPurity(`${TOKENS}\n${ROOT} .a { color: var(--ld-danger); }`, ID).problems.map((p) => p.message)).toEqual([
      'part.css 7行目 color が --ld-danger を直に読んでいる',
    ]);
  });

  test('D1 の tokens_locked：11個の名前を受け、ほかは落とす', () => {
    expect(checkTokensLocked([])).toEqual([]);
    expect(checkTokensLocked(['bg', 'surface', 'fg', 'muted', 'accent', 'radius', 'font', 'space', 'shadow', 'motion', 'danger'])).toEqual([]);
    expect(checkTokensLocked(['danger', 'warning']).map((p) => p.message)).toEqual(['tokens_locked の "warning" は使えない']);
    expect(checkTokensLocked('danger').map((p) => p.message)).toEqual(['tokens_locked が配列ではない']);
  });
});

test.describe('動く作品（T006）', () => {
  test('tags に motion を使える', () => {
    expect(checkMeta({ ...META, tags: ['motion', 'minimal'] }, ID, yes)).toEqual([]);
  });

  const REDUCE_CSS = `${TOKENS}\n@media (prefers-reduced-motion: reduce) { ${ROOT} .a { animation: none; } }`;
  const REDUCE_JS = `export function mount(root) { const q = matchMedia('(prefers-reduced-motion: reduce)'); return () => q; }`;
  const NOPE = `export function mount(root) { return () => {}; }`;
  const failed = (tags: unknown, css: string | null, js: string | null) => checkReducedMotion(tags, css, js).length === 1;

  test('motion の作品は、CSS の @media か JS の matchMedia があれば通る', () => {
    expect(checkReducedMotion(['motion'], REDUCE_CSS, null)).toEqual([]);
    expect(checkReducedMotion(['motion'], REDUCE_CSS, NOPE)).toEqual([]);
    expect(checkReducedMotion(['motion'], TOKENS, REDUCE_JS)).toEqual([]);
    expect(checkReducedMotion(['motion'], `@media screen and (PREFERS-REDUCED-MOTION:reduce) { ${ROOT} .a { color: var(--_fg); } }`, null)).toEqual([]);
    // 問い合わせを変数に入れてもよい
    expect(checkReducedMotion(['motion'], TOKENS, `const Q = "(prefers-reduced-motion: reduce)";\nexport function mount() { const q = matchMedia(Q); return () => q; }`)).toEqual([]);
  });

  test('motion の作品で、どちらもなければ落ちる。コメントの中や no-preference は数えない', () => {
    expect(failed(['motion'], TOKENS, null)).toBe(true);
    expect(failed(['motion'], TOKENS, NOPE)).toBe(true);
    expect(failed(['motion'], `${TOKENS}\n/* @media (prefers-reduced-motion: reduce) {} */`, null)).toBe(true);
    expect(failed(['motion'], `@media (prefers-reduced-motion: no-preference) { ${ROOT} .a { color: var(--_fg); } }`, null)).toBe(true);
    expect(failed(['motion'], TOKENS, `// matchMedia('(prefers-reduced-motion: reduce)')\n${NOPE}`)).toBe(true);
    expect(failed(['motion'], TOKENS, `const note = '(prefers-reduced-motion: reduce)';\n${NOPE}`)).toBe(true);
  });

  test('motion でない作品には求めない', () => {
    expect(checkReducedMotion([], TOKENS, NOPE)).toEqual([]);
    expect(checkReducedMotion(['minimal'], TOKENS, null)).toEqual([]);
    expect(checkReducedMotion(undefined, TOKENS, null)).toEqual([]);
  });

  const literals = (js: string) => checkJsPurity(js).problems.map((p) => p.message);

  test('part.js の色のリテラルを数える：#hex、rgb()、hsl()、色の名前の文字列、テンプレート文字列', () => {
    expect(literals(`const a = '#ff6a3d';`)).toEqual(['part.js 1行目 の色 #ff6a3d']);
    expect(literals(`\n\nctx.fillStyle = "#FFF";`)).toEqual(['part.js 3行目 の色 #FFF']);
    expect(literals("el.style.border = `1px solid #00ff0080`;")).toEqual(['part.js 1行目 の色 #00ff0080']);
    expect(literals(`ctx.fillStyle = 'rgb(0, 0, 0)';`)).toEqual(['part.js 1行目 の色 rgb(0, 0, 0)']);
    expect(literals(`ctx.fillStyle = 'rgba(0,0,0,.5)';`)).toEqual(['part.js 1行目 の色 rgba(0,0,0,.5)']);
    expect(literals(`const c = 'hsl(200 80% 50%)';`)).toEqual(['part.js 1行目 の色 hsl(200 80% 50%)']);
    expect(literals("ctx.fillStyle = `hsl(${hue} 80% 50%)`;")).toEqual(['part.js 1行目 の色 hsl(${…} 80% 50%)']);
    expect(literals("ctx.fillStyle = `rgb(${r}, 0, 0)`;")).toEqual(['part.js 1行目 の色 rgb(${…}, 0, 0)']);
    expect(literals(`ctx.strokeStyle = 'red';`)).toEqual(['part.js 1行目 の色 red']);
    expect(literals("ctx.strokeStyle = `white`;")).toEqual(['part.js 1行目 の色 white']);
    expect(checkJsPurity(`const a = '#fff'; const b = 'black';`).literals).toBe(2);
  });

  test('part.js で数えないもの', () => {
    for (const js of [
      `// ctx.fillStyle = '#ff0000';`,
      `/* 'red' と rgb(0,0,0) */`,
      `const c = getComputedStyle(root).getPropertyValue('--_accent');`,
      "ctx.fillStyle = `color-mix(in oklab, ${accent} 85%, black)`;",
      `ctx.fillStyle = 'color-mix(in srgb, var(--_accent) 40%, white)';`,
      `ctx.fillStyle = 'transparent';`,
      `el.style.color = 'currentColor';`,
      `root.querySelector('#add');`,
      `root.querySelectorAll( "#fade" );`,
      `el.closest('#bad');`,
      `class A { #abc = 1; get() { return this.#abc; } }`,
      `const note = 'Order #1234 is ready';`,
      `const note = '注文 #1234';`,
      `const note = 'The red button';`,
      `const label = 'Red';`,
      `const re = /['"#fff]/; const s = 1;`,
      `const ratio = a / b; const other = c / d; // '#fff'`,
      "const t = `${a ? 'x' : `${b}`}`;",
      // トークンから計算した色を組み立てているだけで、色の値を書いていない
      "const css = ([r, g, b], a = 1) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${a})`;",
      "ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;",
      "ctx.fillStyle = `hsl(${h} ${s}% ${l}%)`;",
    ]) {
      expect(literals(js), js).toEqual([]);
    }
  });

  test('テンプレート文字列の ${…} の中の文字列も、閉じた後の断片も読む', () => {
    expect(literals("const t = `a ${x ? '#ff0000' : y} b`;")).toEqual(['part.js 1行目 の色 #ff0000']);
    expect(literals("const t = `${x} #00ff00`;")).toEqual(['part.js 1行目 の色 #00ff00']);
    // 断片が色の名前だけでも、文字列全体ではないので数えない
    expect(literals("const t = `${x}red`;")).toEqual([]);
    expect(literals("const t = { a: `${x}`, b: '#123456' };")).toEqual(['part.js 1行目 の色 #123456']);
  });

  test('正規表現の中の引用符で読み違えない', () => {
    expect(literals(`const re = /'/; const c = '#ff0000'; const d = /"/;`)).toEqual(['part.js 1行目 の色 #ff0000']);
    expect(literals(`const x = a / 2; const c = 'red'; const y = b / 2;`)).toEqual(['part.js 1行目 の色 red']);
  });
});

test.describe('角丸・余白・動き（T003）', () => {
  const css = (body: string) => `${TOKENS}\n${ROOT} .a { ${body} }`;
  const shape = (body: string, type = 'component') => checkCssShape(css(body), ID, type);

  test('角丸：var(--_radius) を含むもの、0・50%・9999px・inherit はよい', () => {
    for (const value of [
      'var(--_radius)',
      'calc(var(--_radius) - 4px)',
      'var(--_radius) var(--_radius) 0 0',
      '0',
      '50%',
      '9999px',
      'inherit',
      '0 0 9999px 9999px',
    ]) {
      expect(shape(`border-radius: ${value};`), value).toEqual({ problems: [], warnings: [] });
    }
    expect(shape('border-top-left-radius: calc(var(--_radius) * 2);')).toEqual({ problems: [], warnings: [] });
  });

  test('角丸のリテラル：部品は「形」で落とし、画面は警告だけ', () => {
    const component = shape('border-radius: 6px;');
    expect(component.problems.map((p) => p.message)).toEqual(['part.css 7行目 border-radius が 6px']);
    expect(component.warnings).toEqual([]);
    expect(shape('border-bottom-right-radius: 12px;').problems).toHaveLength(1);
    expect(shape('border-start-start-radius: 1rem;').problems).toHaveLength(1);
    expect(shape('border-radius: 50% 4px;').problems).toHaveLength(1);
    expect(shape('border-radius: calc(12px - 4px);').problems).toHaveLength(1);

    const screen = shape('border-radius: 6px;', 'screen');
    expect(screen.problems).toEqual([]);
    expect(screen.warnings.map((p) => p.message)).toEqual(['part.css 7行目 border-radius が 6px']);
  });

  test('余白：var(--_space) を含まなければ、部品も画面も警告だけ。0 と 1px は警告しない', () => {
    for (const type of ['component', 'screen']) {
      const result = shape('padding: 12px; margin-top: 4px; gap: 2px; row-gap: 3px;', type);
      expect(result.problems).toEqual([]);
      expect(result.warnings.map((p) => p.message)).toEqual([
        'part.css 7行目 padding が 12px（var(--_space) を使っていない）',
        'part.css 7行目 margin-top が 4px（var(--_space) を使っていない）',
        'part.css 7行目 gap が 2px（var(--_space) を使っていない）',
        'part.css 7行目 row-gap が 3px（var(--_space) を使っていない）',
      ]);
    }
    expect(shape('padding: 0; margin: 1px 0; gap: 0 1px; margin-inline: auto; padding: calc(var(--_space) * 2) 0;')).toEqual({
      problems: [],
      warnings: [],
    });
  });

  test('動きの時間：var(--_motion) を含まなければ、部品も画面も警告だけ。0 は警告しない', () => {
    for (const type of ['component', 'screen']) {
      const result = shape('transition: transform 300ms ease; animation: spin 1s linear infinite; transition-duration: .2s;', type);
      expect(result.problems).toEqual([]);
      expect(result.warnings).toHaveLength(3);
    }
    expect(
      shape(
        'transition: transform var(--_motion) ease, opacity calc(var(--_motion) * 2); animation-duration: var(--_motion); transition: none; transition-duration: 0s;',
      ),
    ).toEqual({ problems: [], warnings: [] });
  });

  test('checkTokenUse だけを呼んでも同じ結果', () => {
    expect(checkTokenUse(css('border-radius: 6px; padding: 3px;'), 'component')).toEqual({
      problems: [expect.objectContaining({ message: 'part.css 7行目 border-radius が 6px' })],
      warnings: [expect.objectContaining({ message: 'part.css 7行目 padding が 3px（var(--_space) を使っていない）' })],
    });
  });
});

test.describe('作者の handle（T003）', () => {
  test('X のハンドルと同じ形：英数字と _、15文字まで。大文字を通す', () => {
    for (const ok of ['Lattice_Node', 'fixture', 'A', 'abc_DEF_123', 'a23456789012345']) expect(HANDLE_PATTERN.test(ok), ok).toBe(true);
    for (const ng of ['', 'with-hyphen', 'a234567890123456', '@Lattice_Node', 'dot.name', 'ラティス']) expect(HANDLE_PATTERN.test(ng), ng).toBe(false);
  });

  test('同じ作者かは、大文字と小文字を区別せずに比べる', () => {
    expect(sameHandle('lattice_node', 'Lattice_Node')).toBe(true);
    expect(sameHandle('Lattice_Node', 'Lattice_Nod')).toBe(false);
    expect(checkMeta({ ...META, creator: 'Lattice_Node' }, ID, (h) => sameHandle(h, 'lattice_node'))).toEqual([]);
  });
});

test.describe('作者の種類（T004）', () => {
  const PERSON = { handle: 'Lattice_Node', name: 'Lattice', kind: 'person', x_url: 'https://x.com/Lattice_Node', site_url: null };
  const messages = (raw: unknown, handle?: string) => checkCreator(raw, handle).map((p) => p.message);

  test('person と label は通る。作品の creator とは大文字と小文字を区別せずに比べる', () => {
    expect(checkCreator(PERSON, 'lattice_node')).toEqual([]);
    expect(checkCreator({ ...PERSON, handle: 'studio_kiln', name: 'Studio Kiln', kind: 'label', x_url: null })).toEqual([]);
  });

  test('kind がない、または値が違えば落とす（CLAUDE.md 原則10）', () => {
    const { kind: _, ...without } = PERSON;
    expect(messages(without)).toEqual(['creator.json に "kind" がない']);
    expect(checkCreator(without)[0].fix).toContain('"label"');
    expect(messages({ ...PERSON, kind: 'studio' })).toEqual(['creator.json の kind "studio" は使えない']);
    expect(messages({ ...PERSON, kind: null })).toEqual(['creator.json の kind "null" は使えない']);
  });

  test('handle の違い、空の名前、URL の形、知らない項目', () => {
    expect(messages(PERSON, 'someone')).toEqual(['creator.json の handle @Lattice_Node が、作品の creator @someone と違う']);
    expect(messages({ ...PERSON, name: ' ' })).toEqual(['creator.json の name が空']);
    expect(messages({ ...PERSON, x_url: 'x.com/a' })).toEqual(['creator.json の x_url "x.com/a" が https:// の URL ではない']);
    expect(messages({ ...PERSON, email: 'a@b' })).toEqual(['creator.json に知らない項目 "email" がある']);
    expect(messages([])).toEqual(['creator.json が JSON のオブジェクトではない']);
  });
});

test('画像の縦横：png と webp（VP8X、VP8L）を Node の Buffer なしで読む', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  new DataView(png.buffer).setUint32(16, 1200);
  new DataView(png.buffer).setUint32(20, 630);
  expect(imageSize(png)).toEqual({ width: 1200, height: 630 });

  const riff = (chunk: string) => {
    const b = new Uint8Array(30);
    b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    b.set([...chunk].map((c) => c.charCodeAt(0)), 12);
    return b;
  };
  const vp8x = riff('VP8X');
  vp8x.set([799 & 0xff, 799 >> 8, 0, 599 & 0xff, 599 >> 8, 0], 24);
  expect(imageSize(vp8x)).toEqual({ width: 800, height: 600 });
  const vp8l = riff('VP8L');
  new DataView(vp8l.buffer).setUint32(21, 799 | (999 << 14), true);
  expect(imageSize(vp8l)).toEqual({ width: 800, height: 1000 });
  expect(imageSize(new Uint8Array(10))).toBeNull();
});
