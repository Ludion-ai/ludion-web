// 今ある作品と見本の全部が、「動きを見る」の書き換えで扱える書き方か（docs/tasks/FIX-motion.md「1」）。
// 扱えない書き方の作品が増えたら、ここで落ちて分かる。扱えない書き方の一覧は packages/render/tests/motion.spec.ts。
import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowMotionCss, motionLeftovers } from '@ludion/render';

const REPO = join(import.meta.dirname, '../../..');

test('今ある作品と見本に、扱えない書き方はない', () => {
  let checked = 0;
  let inCss = 0;
  let inJs = 0;
  for (const place of ['works', 'fixtures/works', 'fixtures/malicious']) {
    const dir = join(REPO, place);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const cssPath = join(dir, entry.name, 'part.css');
      if (!entry.isDirectory() || !existsSync(cssPath)) continue;
      const css = readFileSync(cssPath, 'utf8');
      const htmlPath = join(dir, entry.name, 'part.html');
      expect(motionLeftovers({ css, html: readFileSync(htmlPath, 'utf8') }), `${place}/${entry.name}`).toEqual([]);
      checked += 1;
      if (place === 'works') {
        inCss += (css.match(/@media[^{]*prefers-reduced-motion/gi) ?? []).length;
        // 書き換えた後に、条件としての語が残らない
        expect(allowMotionCss(css).match(/@media[^{]*prefers-reduced-motion/gi), entry.name).toBeNull();
        const jsPath = join(dir, entry.name, 'part.js');
        if (existsSync(jsPath)) inJs += (readFileSync(jsPath, 'utf8').match(/matchMedia\(\s*['"`]\(prefers-reduced-motion: reduce\)/g) ?? []).length;
      }
    }
  }
  console.log(`作品と見本 ${checked} 個。works/ の CSS の @media ${inCss} か所、JS の matchMedia ${inJs} か所`);
  expect(checked).toBeGreaterThanOrEqual(10);
  // 今の10作品が見つかっていること（0か所のまま通らないように）
  expect(inCss).toBeGreaterThanOrEqual(10);
  expect(inJs).toBeGreaterThanOrEqual(6);
});
