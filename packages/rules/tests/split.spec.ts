// 1つの箱に貼った HTML を3つに分ける（docs/tasks/T033.md 段階 A2）。works/ の全作品は packages/ld/tests/split-works.spec.ts。
import { expect, test } from '@playwright/test';
import { exportMount, fixParts, joinParts, partIdOf, removeMountCall, splitSnippet } from '../src/split.ts';

const ID = 'my-ui';

test.describe('分ける', () => {
  test('コピーされるコードの形：HTML、CSS、JS。mount を export に戻し、最後の呼び出しを外す', () => {
    const split = splitSnippet(`<!-- UI by @a — ludion.ai/p/x (MIT) -->
<!-- Remixed by Claude -->
<div data-ld-part="x"><button type="button">押す</button></div>
<style>
/* UI by @a — ludion.ai/p/x (MIT) */
/* Remix of UI by @b — ludion.ai/p/y (MIT) */
[data-ld-part="x"] { color: red; }
</style>
<script type="module">
/* UI by @a — ludion.ai/p/x (MIT) */
function mount(root) {
  const b = root.querySelector('button');
  return () => {};
}
mount(document.querySelector('[data-ld-part="x"]'));
</script>
`);
    expect(split).toEqual({
      ok: true,
      notes: ['credits'],
      parts: {
        html: '<div data-ld-part="x"><button type="button">押す</button></div>',
        css: '[data-ld-part="x"] { color: red; }',
        js: "export function mount(root) {\n  const b = root.querySelector('button');\n  return () => {};\n}\n",
      },
    });
  });

  test('<!doctype>、<html>、<head>、<body> で包まれていても拾う。書体の link は @import にする。title と meta は捨てる', () => {
    const split = splitSnippet(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>t</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<style>[data-ld-part="x"] { color: red; }</style></head>
<body>
<div data-ld-part="x">a</div>
<script type="module">export function mount(root) { return () => {}; }
mount(document.querySelector('[data-ld-part="x"]'))</script>
</body></html>`);
    expect(split.ok && split.parts).toEqual({
      html: '<div data-ld-part="x">a</div>',
      css: '@import url("https://fonts.googleapis.com/css2?family=Inter");\n\n[data-ld-part="x"] { color: red; }',
      js: 'export function mount(root) { return () => {}; }\n',
    });
    expect(split.ok && split.notes).toEqual(['unwrapped', 'font_link']);
  });

  test('JS がなければ null。HTML の中の文字参照と書き方は変えない（元の文字のまま切り出す）', () => {
    const html = `<div data-ld-part="x" class=a>&amp; <br> <img alt="" src="data:image/png;base64,AA"></div>`;
    const split = splitSnippet(`${html}\n<style>a{}</style>`);
    expect(split.ok && split.parts).toEqual({ html, css: 'a{}', js: null });
  });

  test('分けられない：空、外のスクリプト、script が2つ、知らない種類の script', () => {
    expect(splitSnippet('  \n')).toEqual({ ok: false, error: 'empty' });
    expect(splitSnippet('<div></div><script src="https://x.example/a.js"></script>')).toEqual({ ok: false, error: 'external_script' });
    expect(splitSnippet('<div></div><script>function mount(){}</script><script>a()</script>')).toEqual({ ok: false, error: 'many_scripts' });
    expect(splitSnippet('<div></div><script type="importmap">{}</script>')).toEqual({ ok: false, error: 'unknown_script' });
  });

  test('改行は LF に揃える', () => {
    const split = splitSnippet('<div data-ld-part="x">\r\na</div>\r\n<style>\r\na{}\r\n</style>');
    expect(split.ok && split.parts.html).toBe('<div data-ld-part="x">\na</div>');
  });

  test('mount の呼び出しを外すのは最後の文だけ。中の mount(…) と、文字列の中のかっこはそのまま', () => {
    expect(removeMountCall("function mount(r) { mount2(r); }\nmount(document.querySelector('[a=\")\"]'));\n")).toBe('function mount(r) { mount2(r); }\n');
    expect(removeMountCall('mount(a);\nmore();')).toBe('mount(a);\nmore();');
    expect(exportMount('const mount = (root) => {};')).toBe('export const mount = (root) => {};');
    expect(exportMount('export function mount(root) {}')).toBe('export function mount(root) {}');
  });
});

test.describe('直す（見た目と動きを変えないものだけ）', () => {
  test('根の要素が1つで data-ld-part がなければ付ける。CSS の値が1つなら合わせる', () => {
    const fixed = fixParts({ html: '<main class="a">x</main>', css: '[data-ld-part="old"] { color: red }', js: null }, ID);
    expect(fixed.parts.html).toBe(`<main data-ld-part="${ID}" class="a">x</main>`);
    expect(fixed.parts.css).toBe(`[data-ld-part="${ID}"] { color: red }`);
    expect(fixed.notes).toEqual([
      { kind: 'added_root', id: ID },
      { kind: 'renamed', from: 'old', id: ID },
    ]);
  });

  test('data-ld-part の値を作品の ID に合わせる（HTML、CSS、JS の同じ値。ほかの値は変えない）', () => {
    const fixed = fixParts(
      {
        html: '<div data-ld-part="toggle-daylight" lang="ja"><i data-ld-part="inner"></i></div>',
        css: "[data-ld-part=\"toggle-daylight\"] .a {} [data-ld-part='toggle-daylight'] {} [data-ld-part=toggle-daylight] {} [data-ld-part=\"other\"] {}",
        js: "export function mount(root) { root.closest('[data-ld-part=\"toggle-daylight\"]'); return () => {}; }",
      },
      ID,
    );
    expect(fixed.parts.html).toBe(`<div data-ld-part="${ID}" lang="ja"><i data-ld-part="inner"></i></div>`);
    expect(fixed.parts.css).toBe(`[data-ld-part="${ID}"] .a {} [data-ld-part='${ID}'] {} [data-ld-part="${ID}"] {} [data-ld-part="other"] {}`);
    expect(fixed.parts.js).toContain(`'[data-ld-part="${ID}"]'`);
    expect(fixed.notes).toEqual([{ kind: 'renamed', from: 'toggle-daylight', id: ID }]);
  });

  test('根が2つなら直さない（包むと見た目が変わるおそれがある）。JS の document は直さない', () => {
    const parts = { html: '<div>a</div><div>b</div>', css: '', js: "export function mount() { document.querySelector('x'); }" };
    expect(fixParts(parts, ID)).toEqual({ parts, notes: [] });
  });

  test('ID の案：根の値、なければ CSS の値が1つのとき', () => {
    expect(partIdOf({ html: '<div data-ld-part="a-b">x</div>', css: '', js: null })).toBe('a-b');
    expect(partIdOf({ html: '<div>x</div>', css: '[data-ld-part="c"] {}', js: null })).toBe('c');
    expect(partIdOf({ html: '<div>x</div><p></p>', css: '', js: null })).toBe(null);
  });

  test('3つを箱の形に戻して、もう一度分けると同じ3つになる', () => {
    const parts = { html: `<div data-ld-part="${ID}">a</div>`, css: `[data-ld-part="${ID}"] { color: red; }`, js: 'export function mount(root) {\n  return () => {};\n}\n' };
    const again = splitSnippet(joinParts(parts, ID));
    expect(again.ok && again.parts).toEqual(parts);
    const noJs = splitSnippet(joinParts({ ...parts, js: null }, ID));
    expect(noJs.ok && noJs.parts).toEqual({ ...parts, js: null });
  });
});
