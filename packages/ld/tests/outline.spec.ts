// ld outline（WS002）：手元の作品の地図を、人が読める形で出す。--check は行の確かめ。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { REPO, runLd } from './helpers.ts';

test('ld outline <id> --check：言語の帯、技術、分け目の木を出し、行の確かめが通る', () => {
  const result = runLd(['outline', 'wallpaper-rain-window', '--check'], REPO);
  expect(result.code, result.out).toBe(0);
  expect(result.out).toContain('言語：JavaScript 87.8%、GLSL 8.7%、CSS 3.2%、HTML 0.4%');
  expect(result.out).toContain('WebGL2（part.js:');
  expect(result.out).toContain('設定 TUNE');
  expect(result.out).toContain('シェーダー BIT_FRAG');
  expect(result.out).toContain('行の確かめ：すべての分け目と技術の行が、そのファイルのその行を指す');
  // 関数は数だけ。--functions で木に出す
  expect(result.out).not.toContain('関数 mount');
  expect(runLd(['outline', 'wallpaper-rain-window', '--functions'], REPO).out).toContain('関数 mount');
});

test('ld outline：HTML 文書の場所も読む。--json は地図の JSON。見つからなければ 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ld-outline-'));
  try {
    const file = join(dir, 'clock.html');
    writeFileSync(file, '<!doctype html>\n<title>t</title>\n<canvas></canvas>\n<script>\nconst c = document.querySelector("canvas").getContext("2d");\nrequestAnimationFrame(() => {});\n</script>\n');
    const json = runLd(['outline', file, '--json'], REPO);
    expect(json.code, json.out).toBe(0);
    const outline = JSON.parse(json.out);
    expect(outline).toMatchObject({ version: 2, format: 'document', files: [{ name: 'index.html', lines: 7 }] });
    expect(outline.tech.map((tech: { id: string }) => tech.id)).toEqual(['canvas2d', 'raf']);
    expect(runLd(['outline', join(dir, 'none')], REPO).code).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
