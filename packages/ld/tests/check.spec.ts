import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { checkWork, type ItemKey } from '../src/check.ts';
import { findWork } from '../src/workspace.ts';
import { makeTempRoot, runLd } from './helpers.ts';

// 良い見本は全部通り、壊した見本は狙った項目だけで落ちる（docs/tasks/T002.md「4」）。
const EXPECTED: Record<string, ItemKey[]> = {
  'fx-toggle': [],
  'fx-button': [],
  'fx-landing': [],
  'fx-habits': [],
  'fx-nav': [],
  'fx-form': [],
  'fx-motion': [],
  'fx-wallpaper': [],
  'fx-counter': [],
  'fx-bad-color': ['purity'],
  'fx-bad-overflow': ['layout'],
  'fx-bad-contrast': ['a11y'],
  'fx-bad-radius': ['shape'],
  'fx-bad-danger': ['shape'],
  'fx-bad-motion': ['shape'],
  'fx-bad-nav': ['shape'],
  'fx-bad-link': ['shape'],
};

test.describe('見本17個', () => {
  for (const [id, failing] of Object.entries(EXPECTED)) {
    test(`${id}：${failing.length === 0 ? '全部通る' : `${failing.join('、')} だけで落ちる`}（30秒以内）`, async () => {
      const location = findWork(id);
      expect(location?.library.name).toBe('fixtures');
      const result = await checkWork(location!);
      const failed = result.items.filter((i) => !i.ok).map((i) => i.key);
      expect(failed, JSON.stringify(result.items, null, 2)).toEqual(failing);
      expect(result.ok).toBe(failing.length === 0);
      expect(result.ms).toBeLessThan(30_000);
    });
  }
});

test('ld check --all --fixtures：9/17 が通り、落ちた項目と直し方を1行ずつ出す', () => {
  const { code, out } = runLd(['check', '--all', '--fixtures']);
  expect(code).toBe(1);
  expect(out).toContain('9/17 が通った');
  expect(out).toMatch(/fx-bad-link[\s\S]*?✗ 形\n\s+✗ part\.html の <a href="https:\/\/example\.com\/pricing"> が外へ移る → /);
  expect(out).toMatch(/fx-bad-danger[\s\S]*?✗ 形\n\s+✗ part\.css \d+行目 color が var\(--_danger\) を使っているのに、根で --_danger を宣言していない → /);
  expect(out).toMatch(/fx-bad-motion[\s\S]*?✗ 形\n\s+✗ tags に motion があるのに、prefers-reduced-motion: reduce に対応していない → /);
  expect(out).toMatch(/fx-bad-nav[\s\S]*?✗ 形\n\s+✗ part\.js 6行目 が location\.href に代入している → /);
  expect(out).toMatch(/fx-bad-color[\s\S]*✗ トークンの純度\n\s+✗ part\.css \d+行目 border の色 #e11d48 → /);
  expect(out).toMatch(/fx-bad-overflow[\s\S]*✗ 崩れ\n\s+✗ 幅390で \d+ 個の要素が右端をはみ出す/);
  expect(out).toMatch(/fx-bad-contrast[\s\S]*✗ アクセシビリティ\n\s+✗ 作者の配色で serious color-contrast/);
  expect(out).toMatch(/fx-bad-radius[\s\S]*✗ 形\n\s+✗ part\.css 47行目 border-radius が 6px → var\(--_radius\) か/);
});

test('外への通信：CSP で止めたものも数え、書体は数えない', async () => {
  const { root, cleanup } = makeTempRoot();
  try {
    const id = 'leaky-card';
    const dir = join(root, 'works', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        id,
        title: 'Leaky',
        type: 'component',
        platform: null,
        category: 'Components',
        subtype: 'Card',
        tags: [],
        creator: 'fixture',
        license: 'MIT',
        made_with: 'human',
        version: '1',
        published_at: '2026-11-08',
        pin_order: null,
      }),
    );
    writeFileSync(join(dir, 'part.html'), `<div data-ld-part="${id}"><img alt="Logo" src="https://example.com/logo.png"><p>Hello</p></div>`);
    writeFileSync(
      join(dir, 'part.css'),
      `@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");
[data-ld-part="${id}"] {
  --_bg: var(--ld-bg, #ffffff); --_surface: var(--ld-surface, #ffffff); --_fg: var(--ld-fg, #111111);
  --_muted: var(--ld-muted, #555555); --_accent: var(--ld-accent, #2563eb); --_radius: var(--ld-radius, 8px);
  --_font: var(--ld-font, Inter, sans-serif); --_space: var(--ld-space, 8px); --_shadow: var(--ld-shadow, none);
  --_motion: var(--ld-motion, 150ms);
  color: var(--_fg);
}
[data-ld-part="${id}"] img { width: 40px; height: 40px; }`,
    );
    writeFileSync(join(dir, 'part.js'), `export function mount(root) {\n  fetch('https://example.com/beacon').catch(() => {});\n  return () => {};\n}\n`);

    process.env.LD_ROOT = root;
    const result = await checkWork(findWork(id)!);
    delete process.env.LD_ROOT;
    const network = result.items.find((i) => i.key === 'network')!;
    const urls = network.problems.map((p) => p.message);
    expect(network.ok).toBe(false);
    expect(urls.some((u) => u.includes('https://example.com/logo.png'))).toBe(true);
    expect(urls.some((u) => u.includes('https://example.com/beacon'))).toBe(true);
    expect(urls.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toBe(false);
    expect(result.items.filter((i) => !i.ok).map((i) => i.key)).toEqual(['network']);
  } finally {
    delete process.env.LD_ROOT;
    cleanup();
  }
});

test('mount が片付けの関数を返さなければ「形」で落ちる', async () => {
  const { root, cleanup } = makeTempRoot(['fx-toggle']);
  try {
    writeFileSync(join(root, 'works/fx-toggle/part.js'), 'export function mount(root) {\n  root.dataset.ready = "1";\n}\n');
    process.env.LD_ROOT = root;
    const result = await checkWork(findWork('fx-toggle')!);
    const shape = result.items.find((i) => i.key === 'shape')!;
    expect(shape.ok).toBe(false);
    expect(shape.problems.map((p) => p.message)).toContain('mount が片付けの関数を返さない');
  } finally {
    delete process.env.LD_ROOT;
    cleanup();
  }
});
