// キー操作と読み上げ（WS003）：役目、状態、名前、キー、フォーカスの枠、知らせを、コードに書いてある所から見つける。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { OUTLINE_VERSION, buildOutline, verifyOutline, type Outline, type OutlineInput } from '../src/index.ts';

const ROOT = join(import.meta.dirname, '../../..');
const tech = (outline: Outline, id: string) => outline.tech.find((item) => item.id === id);
const built = (input: OutlineInput) => {
  const outline = buildOutline(input);
  expect(verifyOutline(input, outline)).toEqual([]);
  return outline;
};

test('地図の形の版は 2（キー操作と読み上げを足した。置き場の古い地図は、読むときに作り直す）', () => {
  expect(OUTLINE_VERSION).toBe(2);
});

test('HTML：role、状態、名前（aria-label、aria-labelledby、<label>）、aria-live。行はその行', () => {
  const html = [
    '<div data-ld-part="x">',
    '  <div role="radiogroup" aria-labelledby="t">',
    '    <button role="radio" aria-checked="false" aria-label="One">1</button>',
    '  </div>',
    '  <label for="v">Volume</label>',
    '  <input id="v" type="range" aria-valuetext="50%">',
    '  <p aria-live="polite" aria-hidden="true"></p>',
    '</div>',
  ].join('\n');
  const outline = built({ html, css: '', js: null });
  expect(tech(outline, 'aria-role')).toMatchObject({ group: 'a11y', count: 2, values: ['radiogroup', 'radio'] });
  expect(tech(outline, 'aria-role')!.hits.map((hit) => hit.line)).toEqual([2, 3]);
  expect(tech(outline, 'aria-state')).toMatchObject({ count: 2, values: ['aria-checked', 'aria-valuetext'] });
  expect(tech(outline, 'aria-name')).toMatchObject({ count: 3, values: ['aria-labelledby', 'aria-label', '<label>'] });
  expect(tech(outline, 'aria-live')).toMatchObject({ count: 1, values: ['polite'] });
  // aria-hidden は、状態にも名前にも数えない
  expect(JSON.stringify(outline.tech)).not.toContain('aria-hidden');
});

test('JS：setAttribute、el.ariaChecked、el.role（役目の名前のときだけ）、文字列の中のマークアップ', () => {
  const js = [
    'export function mount(root) {',
    "  const knob = root.querySelector('.knob');",
    "  knob.setAttribute('role', 'switch');",
    "  knob.setAttribute('aria-checked', 'false');",
    '  knob.ariaPressed = "true";',
    "  knob.role = 'slider';",
    "  user.role = 'admin';",
    '  root.innerHTML = `<div role="tablist" aria-label="${name}"><button role="tab" aria-selected="true">A</button></div><label>B</label>`;',
    "  const note = 'role and aria-checked are words here';",
    "  knob.getAttribute('aria-checked');",
    '  return () => {};',
    '}',
  ].join('\n');
  const outline = built({ html: '<div data-ld-part="x"></div>', css: '', js });
  expect(tech(outline, 'aria-role')).toMatchObject({ values: ['switch', 'slider', 'tablist', 'tab'] });
  expect(tech(outline, 'aria-role')!.hits.map((hit) => hit.line)).toEqual([3, 6, 8, 8]);
  expect(tech(outline, 'aria-state')).toMatchObject({ values: ['aria-checked', 'aria-pressed', 'aria-selected'] });
  expect(tech(outline, 'aria-state')!.hits.map((hit) => hit.line)).toEqual([4, 5, 8]);
  expect(tech(outline, 'aria-name')).toMatchObject({ values: ['aria-label', '<label>'] });
});

test('キー：event.key の比べ、case、includes の配列、{ ArrowLeft: … }。ほかの文字列は数えない', () => {
  const js = [
    "root.addEventListener('keydown', (event) => {",
    "  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') step(1);",
    "  if ('Home' === event.key) first();",
    "  if (event.key === ' ' || event.code === 'Space') toggle();",
    '  switch (event.key) {',
    "    case 'End':",
    '      last();',
    '      break;',
    "    case 'Esc':",
    '      close();',
    '  }',
    "  if (['Enter', 'Tab'].includes(event.key)) commit();",
    '  const delta = { ArrowLeft: -1, ArrowDown: -1 }[event.key];',
    "  label.textContent = 'Enter';",
    "  const pad = text === ' ';",
    "  go('Home');",
    '});',
  ].join('\n');
  const outline = built({ html: '<div data-ld-part="x"></div>', css: '', js });
  expect(tech(outline, 'keyboard')).toMatchObject({ count: 1 });
  expect(tech(outline, 'keys')).toMatchObject({ group: 'a11y', values: ['ArrowRight', 'ArrowUp', 'Home', 'Space', 'End', 'Escape', 'Enter', 'Tab', 'ArrowLeft', 'ArrowDown'] });
  expect(tech(outline, 'keys')!.hits.map((hit) => hit.line)).toEqual([2, 2, 3, 4, 4, 6, 9, 12, 12, 13, 13]);
});

test('フォーカスの枠：セレクタの :focus-visible（コメントと値の中は数えない）', () => {
  const css = [
    '/* :focus-visible を付ける */',
    '[data-ld-part="x"] .knob:focus-visible {',
    '  outline: 2px solid var(--_accent);',
    '}',
    '[data-ld-part="x"] .a,',
    '[data-ld-part="x"] .b:focus-visible { outline-offset: 2px; }',
    '[data-ld-part="x"] .c:focus { content: ":focus-visible"; }',
  ].join('\n');
  const outline = built({ html: '<div data-ld-part="x"></div>', css, js: null });
  expect(tech(outline, 'focus-visible')).toMatchObject({ group: 'a11y', count: 2, values: [':focus-visible'] });
  expect(tech(outline, 'focus-visible')!.hits.map((hit) => hit.line)).toEqual([2, 6]);
});

test('文書の作品：style と script と要素の全部から', () => {
  const document = [
    '<!doctype html>',
    '<html lang="en"><head><title>Tabs</title>',
    '<style>',
    '  .tab:focus-visible { outline: 2px solid; }',
    '</style></head>',
    '<body>',
    '<div role="tablist"><button role="tab" aria-selected="true">A</button></div>',
    '<script>',
    "  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') prev(); });",
    '</script>',
    '</body></html>',
  ].join('\n');
  const outline = built({ html: '', css: '', js: null, document });
  expect(tech(outline, 'aria-role')).toMatchObject({ values: ['tablist', 'tab'] });
  expect(tech(outline, 'aria-state')!.hits[0]).toMatchObject({ file: 'index.html', line: 7 });
  expect(tech(outline, 'focus-visible')!.hits[0]).toMatchObject({ file: 'index.html', line: 4 });
  expect(tech(outline, 'keys')!.hits[0]).toMatchObject({ file: 'index.html', line: 9, match: "'ArrowLeft'" });
});

test('書いていない作品には出さない', () => {
  const outline = built({ html: '<div data-ld-part="x"><p>Hi</p></div>', css: '[data-ld-part="x"] { color: red; }', js: 'export function mount(root) { return () => {}; }' });
  expect(outline.tech.filter((item) => item.group === 'a11y')).toEqual([]);
});

test('今の作品：住人のいるスイッチは、役目・状態・名前・キー・フォーカスの枠が出る', () => {
  const dir = join(ROOT, 'works/toggle-daylight');
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  const outline = built({ html: read('part.html'), css: read('part.css'), js: read('part.js') });
  const found = outline.tech.filter((item) => item.group === 'a11y').map((item) => item.id);
  expect(found).toEqual(expect.arrayContaining(['aria-role', 'aria-state', 'aria-name', 'focus-visible']));
});
