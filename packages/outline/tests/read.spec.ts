// 地図から要る部分だけを読む（WS006）：行の範囲、分け目の呼び名、上限、技術で絞る言葉、AI が読む地図の文。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  MAX_PART_READ_BYTES,
  TECH_LIST,
  buildOutline,
  findSection,
  formatMap,
  innerSections,
  numberLines,
  parseLineRange,
  readLines,
  selectorNames,
  techQuery,
  workFiles,
  type OutlineInput,
} from '../src/index.ts';

const ROOT = join(import.meta.dirname, '../../..');

function readDir(dir: string): OutlineInput | null {
  const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  const html = read('part.html');
  if (html !== null) return { html, css: read('part.css') ?? '', js: read('part.js') };
  const document = read('index.html');
  return document === null ? null : { html: '', css: '', js: null, document };
}

function corpus(): { name: string; input: OutlineInput }[] {
  const out: { name: string; input: OutlineInput }[] = [];
  for (const root of ['works', 'fixtures/works', 'fixtures/documents']) {
    const base = join(ROOT, root);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const path = join(base, name);
      const input = statSync(path).isDirectory() ? readDir(path) : null;
      if (input) out.push({ name: `${root}/${name}`, input });
    }
  }
  return out;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

test.describe('行の範囲', () => {
  test('書き方：200-760、200、L200-L760。だめな形は null', () => {
    expect(parseLineRange('200-760')).toEqual({ start: 200, end: 760 });
    expect(parseLineRange(' 12 ')).toEqual({ start: 12, end: 12 });
    expect(parseLineRange('L3-L9')).toEqual({ start: 3, end: 9 });
    for (const bad of ['', '0', '0-5', '9-3', 'a-b', '1-2-3', '-5', '12345678', '1.5']) expect(parseLineRange(bad), bad).toBeNull();
  });

  test('読んだ行は、ファイルのその行そのまま。終わりはファイルの終わりで止める。外は null', () => {
    const text = 'one\ntwo\r\nthree\n\nfive\n';
    expect(readLines(text, 2, 3)).toEqual({ start: 2, end: 3, total: 5, bytes: 10, text: 'two\r\nthree' });
    expect(readLines(text, 4, 4)).toMatchObject({ text: '', bytes: 0 });
    expect(readLines(text, 5, 99)).toMatchObject({ start: 5, end: 5, text: 'five' });
    expect(readLines('no newline', 1, 1)).toMatchObject({ total: 1, text: 'no newline' });
    for (const [start, end] of [[0, 1], [6, 6], [3, 2], [1.5, 2]]) expect(readLines(text, start, end), `${start}-${end}`).toBeNull();
    expect(readLines('', 1, 1)).toBeNull();
    // 行の番号：その行の頭に、番号とタブ。CR は外す
    expect(numberLines('two\r\nthree', 2)).toBe('2\ttwo\n3\tthree');
    expect(numberLines('', 7)).toBe('7\t');
  });

  test('全部の作品：分け目の行を読むと、split で数えた同じ行と1文字も違わない', () => {
    for (const { name, input } of corpus()) {
      const outline = buildOutline(input);
      const files = new Map(workFiles(input).map((file) => [file.name, file.text]));
      expect([...files.keys()], name).toEqual(outline.files.map((file) => file.name));
      for (const section of outline.sections) {
        const text = files.get(section.file)!;
        const read = readLines(text, section.start, section.end)!;
        const expected = text.split('\n').slice(section.start - 1, section.end).join('\n').replace(/\r$/, '');
        expect(read.text, `${name} ${section.kind}:${section.name}`).toBe(expected);
        expect(read.bytes).toBe(bytes(expected));
        expect(read.total).toBe(outline.files.find((file) => file.name === section.file)!.lines);
      }
    }
  });
});

test.describe('分け目の呼び名', () => {
  const input = readDir(join(ROOT, 'works/wallpaper-rain-window'))!;
  const outline = buildOutline(input);
  const js = input.js!;

  test('雨の窓ぎわ：shader:WINDOW_FRAG は、そのシェーダーの行だけ。上限の中', () => {
    const match = findSection(outline, 'shader:WINDOW_FRAG');
    expect(match.ok).toBe(true);
    if (!match.ok) return;
    expect(match.section).toMatchObject({ kind: 'shader', name: 'WINDOW_FRAG', file: 'part.js', glsl: '300 es', stage: 'fragment' });
    const read = readLines(js, match.section.start, match.section.end)!;
    expect(read.text).toContain('WINDOW_FRAG');
    expect(read.text).toContain('#version 300 es');
    expect(read.text).not.toContain('SHARD_VERT');
    expect(read.bytes).toBeLessThan(MAX_PART_READ_BYTES);
  });

  test('上限：課題の 200-760（シェーダーの全部）は読める。mount とファイルの全部は超える', () => {
    expect(readLines(js, 200, 760)!.bytes).toBeLessThanOrEqual(MAX_PART_READ_BYTES);
    const mount = findSection(outline, 'function:mount');
    expect(mount.ok).toBe(true);
    if (!mount.ok) return;
    expect(readLines(js, mount.section.start, mount.section.end)!.bytes).toBeGreaterThan(MAX_PART_READ_BYTES);
    expect(readLines(js, 1, 999999)!.bytes).toBeGreaterThan(MAX_PART_READ_BYTES);
    // 断るときに返す、中の分け目：mount の中の見出し
    const inside = innerSections(outline, 'part.js', mount.section.start, mount.section.end);
    expect(inside.length).toBeGreaterThan(3);
    expect(inside.every((section) => section.start >= mount.section.start && section.end <= mount.section.end && section.depth === inside[0].depth)).toBe(true);
    expect(inside.some((section) => section.start === mount.section.start && section.end === mount.section.end)).toBe(false);
  });

  test('種類は省ける。大文字と小文字、名前の頭でも1つに決まれば当たる。file で絞れる', () => {
    const exact = findSection(outline, 'WINDOW_FRAG');
    expect(exact.ok && exact.section.kind).toBe('shader');
    const loose = findSection(outline, 'shader:window_frag');
    expect(loose.ok && loose.section.name).toBe('WINDOW_FRAG');
    const settings = findSection(outline, 'settings:TUNE');
    expect(settings.ok && settings.section.kind).toBe('settings');
    // 見出しは長いので、頭だけで当たる
    const heading = findSection(outline, 'heading:ガラスの面');
    expect(heading.ok && heading.section.name.startsWith('ガラスの面')).toBe(true);
    expect(findSection(outline, 'shader:WINDOW_FRAG', 'part.css')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(findSection(outline, 'shader:NO_SUCH')).toEqual({ ok: false, reason: 'not_found', candidates: [] });
    expect(findSection(outline, '  ')).toMatchObject({ ok: false, reason: 'not_found' });
    // 近い名前は候補に出る
    const near = findSection(outline, 'shader:FRAG');
    expect(near.ok).toBe(false);
    if (!near.ok) expect(near.candidates.every((section) => section.name.includes('FRAG'))).toBe(true);
  });

  test('同じ名前が2つ以上：選ばずに候補を返す。呼び名に始まりの行を付ければ決まる', () => {
    const names = selectorNames(outline);
    const all = outline.sections.map(names);
    // 呼び名は全部ちがう
    expect(new Set(all).size).toBe(all.length);
    const twice = outline.sections.filter((section) => section.kind === 'function' && section.name === 'step');
    expect(twice.length).toBe(2);
    const vague = findSection(outline, 'function:step');
    expect(vague).toMatchObject({ ok: false, reason: 'ambiguous' });
    if (!vague.ok) expect(vague.candidates.map(names)).toEqual(twice.map((section) => `function:step@${section.start}`));
    for (const section of twice) {
      const pinned = findSection(outline, names(section));
      expect(pinned.ok && pinned.section).toBe(section);
    }
    // どの呼び名も、そのまま渡すと、その分け目に決まる（全部の作品）
    for (const { name, input: work } of corpus()) {
      const map = buildOutline(work);
      const nameOf = selectorNames(map);
      for (const section of map.sections) {
        const found = findSection(map, nameOf(section));
        expect(found.ok && found.section, `${name} ${nameOf(section)}`).toBe(section);
      }
    }
  });
});

test.describe('技術で絞る言葉', () => {
  test('id、見せる名前、まとめた呼び方。知らない言葉は null', () => {
    expect(techQuery('webgl2')).toEqual(['webgl2']);
    expect(techQuery('WebGL2')).toEqual(['webgl2']);
    expect(techQuery('Web Audio')).toEqual(['webaudio']);
    expect(techQuery('Canvas 2D')).toEqual(['canvas2d']);
    expect(techQuery('webgl')).toEqual(['webgl', 'webgl2']);
    expect(techQuery('canvas')).toEqual(['canvas2d']);
    expect(techQuery('audio')).toEqual(['webaudio', 'webaudio-synth', 'webaudio-decode', 'audio-element']);
    expect(techQuery('prefers-reduced-motion')).toEqual(['reduced-motion']);
    for (const bad of ['', '  ', 'flash', 'webgl3']) expect(techQuery(bad), bad).toBeNull();
    // 地図が出す id は、どれも絞れる
    for (const tech of TECH_LIST) expect(techQuery(tech.id), tech.id).toContain(tech.id);
  });
});

test.describe('AI が読む地図の文', () => {
  test('雨の窓ぎわ：ファイル、言語、技術、分け目の呼び名と行。コードは入らず、地図の JSON より小さい', () => {
    const input = readDir(join(ROOT, 'works/wallpaper-rain-window'))!;
    const outline = buildOutline(input);
    const map = formatMap(outline);
    expect(map).toContain('- part.js — 5004 lines');
    expect(map).toContain('Languages: JavaScript 87.8%, GLSL 8.7%, CSS 3.2%, HTML 0.4%');
    expect(map).toMatch(/Tech \(first line found\): WebGL2 \(part\.js:\d+\), Canvas 2D/);
    const window = outline.sections.find((section) => section.name === 'WINDOW_FRAG')!;
    expect(map).toContain(`shader:WINDOW_FRAG — ${window.start}-${window.end} — `);
    expect(map).toContain('GLSL 300 es, fragment');
    expect(map).toContain('settings:TUNE — ');
    expect(map).toMatch(/function:step@\d+ — /);
    // 分け目は全部出る（上限の 400 より少ない）
    expect(map).not.toContain('deeper sections are not listed');
    expect(map.split('\n').filter((line) => / — \d+-\d+/.test(line)).length).toBe(outline.sections.length);
    // シェーダーの中身は入らない
    expect(map).not.toContain('#version');
    expect(bytes(map)).toBeLessThan(bytes(JSON.stringify(outline)));
    console.log(`雨の窓ぎわ：コード ${Math.round(outline.files.reduce((sum, file) => sum + file.bytes, 0) / 1024)} KB、地図の JSON ${(bytes(JSON.stringify(outline)) / 1024).toFixed(1)} KB、地図の文 ${(bytes(map) / 1024).toFixed(1)} KB`);
  });

  test('分け目が多いときは、深い関数から省き、数を書く。分け目のない作品も文になる', () => {
    const input = readDir(join(ROOT, 'works/wallpaper-rain-window'))!;
    const outline = buildOutline(input);
    const short = formatMap(outline, { maxSections: 80 });
    expect(short).toContain(`(${outline.sections.length - 80} deeper sections are not listed`);
    expect(short).toContain('shader:WINDOW_FRAG');
    expect(short).toContain('function:mount');
    const empty = formatMap(buildOutline({ html: '<div data-ld-part="x"></div>', css: '', js: null }));
    expect(empty).toContain('Sections (selector — lines — size):\n  (none found)');
  });
});
