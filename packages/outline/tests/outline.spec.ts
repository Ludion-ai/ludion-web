// 地図（WS002）：作品と見本の全部で地図が作れて、どの行もそのファイルのその行を指す。雨の窓ぎわの数。速さ。見分け方。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildOutline, verifyOutline, type Outline, type OutlineInput } from '../src/index.ts';

const ROOT = join(import.meta.dirname, '../../..');

function readDir(dir: string): OutlineInput | null {
  const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  const html = read('part.html');
  if (html !== null) return { html, css: read('part.css') ?? '', js: read('part.js') };
  const document = read('index.html');
  return document === null ? null : { html: '', css: '', js: null, document };
}

/** 作品と見本：works/、fixtures/works/、fixtures/malicious/、fixtures/documents/、fixtures/t033-real/*.html */
function corpus(): { name: string; input: OutlineInput }[] {
  const out: { name: string; input: OutlineInput }[] = [];
  for (const root of ['works', 'fixtures/works', 'fixtures/malicious', 'fixtures/documents', 'fixtures/t033-real']) {
    const base = join(ROOT, root);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const path = join(base, name);
      if (statSync(path).isDirectory()) {
        const input = readDir(path);
        if (input) out.push({ name: `${root}/${name}`, input });
      } else if (name.endsWith('.html')) {
        out.push({ name: `${root}/${name}`, input: { html: '', css: '', js: null, document: readFileSync(path, 'utf8') } });
      }
    }
  }
  return out;
}

const techIds = (outline: Outline) => outline.tech.map((t) => t.id);

test.describe('作品と見本の全部', () => {
  test('今の公開の20作品と見本：地図が作れて、どの分け目と技術の行も、そのファイルのその行を指す', () => {
    const all = corpus();
    expect(all.filter((item) => item.name.startsWith('works/'))).toHaveLength(20);
    for (const { name, input } of all) {
      const outline = buildOutline(input);
      expect(verifyOutline(input, outline), name).toEqual([]);
      // 地図は JSON にできて、戻すと同じ
      expect(JSON.parse(JSON.stringify(outline)), name).toEqual(outline);
    }
  });

  test('DOC001 の試験の20本（OUTLINE_DOCS_DIR があるときだけ。内部の置き場の物なので、このリポジトリには置かない）', () => {
    const dir = process.env.OUTLINE_DOCS_DIR;
    test.skip(!dir, 'OUTLINE_DOCS_DIR がない');
    const files = readdirSync(dir!).filter((name) => name.endsWith('.html'));
    expect(files).toHaveLength(20);
    for (const name of files) {
      const input = { html: '', css: '', js: null, document: readFileSync(join(dir!, name), 'utf8') };
      expect(verifyOutline(input, buildOutline(input)), name).toEqual([]);
    }
  });

  test('途中で切れたファイルでも、投げずに地図を作り、行はファイルの中', () => {
    for (const { name, input } of corpus()) {
      const text = input.document ?? input.js ?? input.css;
      for (let k = 1; k <= 12; k++) {
        const cut = Math.floor((text.length * k) / 13);
        const part = input.document != null ? { ...input, document: text.slice(0, cut) } : input.js != null ? { ...input, js: text.slice(0, cut) } : { ...input, css: text.slice(0, cut) };
        const outline = buildOutline(part);
        const lines = new Map(outline.files.map((file) => [file.name, Math.max(1, file.lines)]));
        for (const s of outline.sections) {
          expect(s.start >= 1 && s.end >= s.start && s.end <= lines.get(s.file)!, `${name} ${cut} ${s.kind} ${s.name}`).toBe(true);
        }
      }
    }
  });
});

test.describe('雨の窓ぎわ（版 3）', () => {
  const input = readDir(join(ROOT, 'works/wallpaper-rain-window'))!;
  const outline = buildOutline(input);

  test('シェーダー16本（FILL … BIT_FRAG）、GLSL ES 3.00', () => {
    const shaders = outline.sections.filter((s) => s.kind === 'shader');
    expect(shaders.map((s) => s.name)).toEqual([
      'FILL', 'MIST_FRAG', 'FADE_FRAG', 'STAMP_VERT', 'STAMP_FRAG', 'DROP_VERT', 'DROP_FRAG', 'CRACK_VERT',
      'CRACK_FRAG', 'CELL_VERT', 'CELL_FRAG', 'WINDOW_FRAG', 'SHARD_VERT', 'SHARD_FRAG', 'BIT_VERT', 'BIT_FRAG',
    ]);
    expect(shaders.every((s) => s.glsl === '300 es' && s.language === 'glsl' && s.file === 'part.js')).toBe(true);
    expect(shaders.filter((s) => s.name.endsWith('_VERT')).every((s) => s.stage === 'vertex')).toBe(true);
    expect(shaders.filter((s) => s.name.endsWith('_FRAG')).every((s) => s.stage === 'fragment')).toBe(true);
  });

  test('設定の塊 TUNE と、その中の見出し11', () => {
    const tune = outline.sections.find((s) => s.kind === 'settings' && s.name === 'TUNE')!;
    expect(tune).toBeTruthy();
    const inner = outline.sections.filter((s) => s.kind === 'heading' && s.start > tune.start && s.end <= tune.end);
    expect(inner.map((s) => s.name.split(/[（。]/)[0])).toEqual(['ガラス', 'くもり', '雨粒', 'ひび', '落ちる破片', '張り替え', '窓の外の街', 'テーブルに残るもの', '時刻', '音', '軽さ']);
    expect(inner.every((s) => s.depth === tune.depth + 1)).toBe(true);
  });

  test('言語の帯：JavaScript 87.8%、GLSL 8.7%、CSS 3.2%、HTML 0.4%（1%以内）', () => {
    const percent = Object.fromEntries(outline.languages.map((item) => [item.language, item.percent]));
    for (const [language, target] of Object.entries({ js: 87.8, glsl: 8.7, css: 3.2, html: 0.4 })) {
      expect(Math.abs(percent[language] - target), language).toBeLessThanOrEqual(1);
    }
  });

  test('技術：WebGL2、Canvas 2D、Web Audio（合成。録音を読まない）、ポインター、動きを減らす、見えないと止まる', () => {
    const ids = techIds(outline);
    for (const id of ['webgl2', 'canvas2d', 'webaudio', 'webaudio-synth', 'pointer', 'reduced-motion', 'pause-hidden', 'raf']) expect(ids, id).toContain(id);
    for (const id of ['webgl', 'webgpu', 'webaudio-decode', 'audio-element', 'keyboard', 'google-fonts', 'cdn', 'external', 'localstorage']) expect(ids, id).not.toContain(id);
    const webgl2 = outline.tech.find((t) => t.id === 'webgl2')!;
    expect(webgl2.hits[0].file).toBe('part.js');
    expect(input.js!.split('\n')[webgl2.hits[0].line - 1]).toContain("getContext('webgl2'");
  });

  test('地図を作る時間：234 KB の part.js で 50ms 以内', () => {
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const start = performance.now();
      buildOutline(input);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(`雨の窓ぎわの地図：${times.map((t) => t.toFixed(1)).join(' ')} ms`);
    expect(times[4]).toBeLessThan(50);
  });
});

test.describe('見分け方', () => {
  const js = (code: string, html = '<div data-ld-part="x"><canvas></canvas></div>') => buildOutline({ html, css: '', js: code });
  const doc = (body: string) => buildOutline({ html: '', css: '', js: null, document: `<!doctype html>\n<html><head><title>t</title></head><body>\n${body}\n</body></html>\n` });

  test('コメントと、ふつうの文字列の中は数えない', () => {
    const outline = js(
      [
        "// getContext('webgl2') で描く。requestAnimationFrame と AudioContext と localStorage も使う",
        "/* canvas.getContext('2d'); addEventListener('click', f); matchMedia('(prefers-reduced-motion: reduce)') */",
        "const note = 'requestAnimationFrame と AudioContext と WebGL2 を使う';",
        "const tip = `getContext('webgl') の説明`;",
        "const re = /requestAnimationFrame|localStorage/g;",
        'export function mount(root) { return () => {}; }',
      ].join('\n'),
    );
    expect(techIds(outline)).toEqual([]);
  });

  test('決まった形の文字列は数える：getContext の種類、出来事の名前の引数、メディアクエリ', () => {
    const outline = js(
      [
        'export function mount(root) {',
        "  const gl = root.querySelector('canvas').getContext('webgl2');",
        "  const listen = (el, type, fn) => el.addEventListener(type, fn);",
        "  listen(root, 'pointerdown', () => {});",
        "  root.addEventListener('keydown', () => {});",
        "  const q = matchMedia('(prefers-reduced-motion: reduce)');",
        "  document.addEventListener('visibilitychange', () => {});",
        "  play('click');",
        '  return () => {};',
        '}',
      ].join('\n'),
    );
    expect(techIds(outline)).toEqual(['webgl2', 'pointer', 'keyboard', 'reduced-motion', 'pause-hidden']);
    // play('click') は出来事の名前の引数ではない（後ろに , がない）
    expect(outline.tech.find((t) => t.id === 'pointer')!.count).toBe(1);
  });

  test('シェーダー：#version のテンプレート、+ でつないだ文字列、文字列の配列、x-shader の script', () => {
    const outline = js(
      [
        'const VERT = `#version 300 es',
        'in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;',
        "const frag = 'precision mediump float;' +",
        "  'void main() { gl_FragColor = vec4(1.); }';",
        "const lines = ['attribute vec2 p;',",
        "  'void main() { gl_Position = vec4(p, 0., 1.); }'].join('\\n');",
        "const CHUNK = `float n(vec2 p) { return 0.; }`;",
        'export function mount(root) { return () => {}; }',
      ].join('\n'),
    );
    const shaders = outline.sections.filter((s) => s.kind === 'shader');
    expect(shaders.map((s) => [s.name, s.start, s.end, s.stage])).toEqual([
      ['VERT', 1, 2, 'vertex'],
      ['frag', 3, 4, 'fragment'],
      ['lines', 5, 6, 'vertex'],
    ]);
    const glsl = outline.languages.find((item) => item.language === 'glsl')!;
    expect(glsl.bytes).toBeGreaterThan(100);

    const html = doc('<script type="x-shader/x-fragment" id="fs">\nvoid main() { gl_FragColor = vec4(1.); }\n</script>\n<canvas></canvas>');
    expect(html.sections.filter((s) => s.kind === 'shader').map((s) => [s.name, s.language])).toEqual([['fs', 'glsl']]);
  });

  test('関数：function、矢印、メソッド。名前、行、大きさ、入れ子の深さ', () => {
    const outline = js(
      [
        'export function mount(root) {', //   1
        '  const add = (a, b) => a + b;', //   2
        '  const big = async (x) => {', //    3
        '    function inner() {', //         4
        '      return 1;', //                5
        '    }', //                          6
        '    return inner();', //            7
        '  };', //                           8
        '  const api = {', //                9
        '    start() { return 1; },', //    10
        '    stop: function () {},', //     11
        '  };', //                          12
        '  class A { tick(t) { return t; } }', // 13
        '  if (add(1, 2)) { big(1); }', //  14
        '  return () => {};', //            15
        '}', //                             16
      ].join('\n'),
    );
    const fns = outline.sections.filter((s) => s.kind === 'function').map((s) => [s.name, s.start, s.end, s.depth]);
    expect(fns).toEqual([
      ['mount', 1, 16, 0],
      ['add', 2, 2, 1],
      ['big', 3, 8, 1],
      ['inner', 4, 6, 2],
      ['start', 10, 10, 1],
      ['stop', 11, 11, 1],
      ['tick', 13, 13, 1],
    ]);
  });

  test('見出し：線の見出しと深さ、線で挟んだ見出し、CSS の見出し', () => {
    const outline = buildOutline({
      html: '<div data-ld-part="x"></div>',
      css: '/* ---- 色 ---- */\n[data-ld-part="x"] { color: red; }\n\n/* ==== 大きさ ==== */\n[data-ld-part="x"] { width: 1px; }\n',
      js: [
        '// ==========', //            1
        '// 決まりの数値', //            2
        '// ==========', //            3
        'const A = 1;', //             4
        '', //                         5
        '// ---- 描く', //              6
        'export function mount(root) {', // 7
        '  // ---- 準備', //            8
        '  const a = 1;', //           9
        '  // ---- 片付け', //          10
        '  return () => {};', //       11
        '}', //                        12
        '// ---- 音', //               13
        'const B = 2;', //             14
      ].join('\n'),
    });
    const headings = outline.sections.filter((s) => s.kind === 'heading').map((s) => [s.file, s.name, s.start, s.end, s.depth]);
    expect(headings).toEqual([
      ['part.css', '色', 1, 2, 0],
      ['part.css', '大きさ', 4, 5, 0],
      ['part.js', '決まりの数値', 2, 4, 0],
      ['part.js', '描く', 6, 12, 0],
      ['part.js', '準備', 8, 9, 2],
      ['part.js', '片付け', 10, 11, 2],
      ['part.js', '音', 13, 14, 0],
    ]);
  });

  test('文書の作品：style、script、インラインの SVG、data: の素材、言語の帯、外から読む物', () => {
    const png = `data:image/png;base64,${'A'.repeat(400)}`;
    const outline = doc(
      [
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
        '<script src="https://cdn.jsdelivr.net/npm/x@1/x.js"></script>',
        '<style>',
        `  body { background: url("${png}"); animation: spin 1s; }`,
        '</style>',
        '<h1>題</h1>',
        '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>',
        '<script type="module">',
        "  const c = document.querySelector('canvas').getContext('2d');",
        '  requestAnimationFrame(() => {});',
        '</script>',
      ].join('\n'),
    );
    expect(verifyOutline({ html: '', css: '', js: null, document: '' }, outline).length).toBeGreaterThan(0); // 別の文書では合わない
    expect(outline.format).toBe('document');
    expect(outline.sections.map((s) => [s.kind, s.name])).toEqual([
      ['style', '<style>'],
      ['asset', 'image/png'],
      ['asset', 'svg'],
      ['script', '<script type="module">'],
    ]);
    expect(techIds(outline)).toEqual(['canvas2d', 'svg', 'dom-css', 'raf', 'css-animation', 'google-fonts', 'cdn']);
    expect(outline.tech.find((t) => t.id === 'cdn')!.hosts).toEqual(['cdn.jsdelivr.net']);
    expect(outline.languages.map((item) => item.language).sort()).toEqual(['css', 'html', 'js']);
  });

  test('見つからない物は出さない', () => {
    const outline = buildOutline({ html: '<div data-ld-part="x"></div>', css: '', js: null });
    expect(outline.tech).toEqual([]);
    expect(outline.sections).toEqual([]);
    expect(outline.languages).toEqual([{ language: 'html', bytes: 28, percent: 100 }]);
  });
});

test.describe('作り手の入れた文字で遅くならない', () => {
  // 文書の上限（768 KB）の、わざと読みにくい文書
  const SIZE = 768 * 1024;
  const fill = (unit: string) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
  const cases: [string, string][] = [
    ['閉じない /*', `<script>${fill('/*')}</script>`],
    ['閉じないテンプレートと ${', `<script>${fill('`${')}</script>`],
    ['割り算と正規表現が交互', `<script>${fill('a / b / c /x/g; ')}</script>`],
    ['@media だけ', `<style>${fill('@media ')}</style>`],
    ['url( だけ', `<style>${fill('url(')}</style>`],
    ['線の見出しだけ', `<script>${fill('// ---- 見出し\n')}</script>`],
    ['1行の長いコメント', `<script>// ${fill('-')}</script>`],
    ['矢印の関数の入れ子', `<script>const f = ${fill('a => ')}0</script>`],
    ['括弧の入れ子', `<script>${fill('(')}</script>`],
    ['開きタグだけ', fill('<div ')],
    ['属性の引用符が閉じない', `<div a="${fill('x')}`],
    ['シェーダーの文字列だらけ', `<script>${fill("const s = 'void main(){gl_Position=vec4(0.);}';\n")}</script>`],
    ['関数だらけ', `<script>${fill('function f(){}\n')}</script>`],
  ];
  for (const [name, text] of cases) {
    test(name, () => {
      const start = performance.now();
      const outline = buildOutline({ html: '', css: '', js: null, document: text });
      const ms = performance.now() - start;
      expect(ms, `${name}：${ms.toFixed(0)} ms`).toBeLessThan(2000);
      expect(outline.sections.length).toBeLessThanOrEqual(6000);
    });
  }
});
