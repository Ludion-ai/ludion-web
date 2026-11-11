import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openFramePage } from '../src/browser.ts';
import { OG_TITLE_SIZE, imageSize, makeThumb, renderOg } from '../src/images.ts';
import { findWork, readWork, toRenderable } from '../src/workspace.ts';
import { REPO } from './helpers.ts';

// 部品のサムネイル：部品の幅がサムネイルの幅の 55〜65%、高さは 70% まで、倍率は 1〜3（docs/tasks/T003.md「4」）。
test('部品のサムネイル：fx-toggle と fx-button が、800×600 の幅の 55〜65% を占める', async () => {
  const browser = await launch();
  try {
    for (const id of ['fx-toggle', 'fx-button']) {
      const work = toRenderable(readWork(findWork(id)!))!;
      const thumb = await makeThumb(browser, work);
      expect(imageSize(thumb.webp)).toEqual({ width: 800, height: 600 });
      expect(thumb.webp.length).toBeLessThanOrEqual(80 * 1024);
      const fit = thumb.fit!;
      expect(fit.wide, id).toBe(false);
      expect(fit.scale).toBeGreaterThanOrEqual(1);
      expect(fit.scale).toBeLessThanOrEqual(3);
      expect(fit.fill.width, id).toBeGreaterThanOrEqual(0.55);
      expect(fit.fill.width, id).toBeLessThanOrEqual(0.65);
      expect(fit.fill.height, id).toBeLessThanOrEqual(0.7);
    }
  } finally {
    await browser.close();
  }
});

// 幅いっぱいの部品は、幅1280で描いて枠の上に寄せ、800×480 に縮める（docs/tasks/T005.md「0」）。
test('幅いっぱいの部品：fx-nav は幅1280で描いて上に寄せ、800×480 に縮める（リンクが全部見える、幅1280の形）', async () => {
  const browser = await launch();
  try {
    const work = toRenderable(readWork(findWork('fx-nav')!))!;
    const thumb = await makeThumb(browser, work);
    expect(imageSize(thumb.webp)).toEqual({ width: 800, height: 480 });
    expect(thumb.webp.length).toBeLessThanOrEqual(80 * 1024);
    const fit = thumb.fit!;
    expect(fit.wide).toBe(true);
    expect(fit.viewport).toEqual({ width: 1280, height: 768 });
    expect(fit.scale).toBe(800 / 1280);
    expect(fit.fill.width).toBeGreaterThan(0.9);
    expect(fit.top).toBe(0); // 部品は枠の上に寄っている

    // 撮った画像でも確かめる：上の端は部品の色で、下の端は地の色（部品は下まで届いていない）
    const page = await browser.newPage();
    try {
      const [topRow, bottomRow] = await page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        /** ある高さより上の行に、下の端と違う色の画素がいくつあるか。 */
        const bottom = [...ctx.getImageData(400, canvas.height - 1, 1, 1).data];
        const differs = (y0: number, y1: number) => {
          const { data } = ctx.getImageData(0, y0, canvas.width, y1 - y0);
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (Math.abs(data[i] - bottom[0]) + Math.abs(data[i + 1] - bottom[1]) + Math.abs(data[i + 2] - bottom[2]) > 24) count += 1;
          }
          return count;
        };
        return [differs(0, 96), differs(240, 480)];
      }, `data:image/webp;base64,${thumb.webp.toString('base64')}`);
      expect(topRow).toBeGreaterThan(100); // 上の 96px（20%）に部品の文字や面がある
      expect(bottomRow).toBeLessThan(100); // 下半分は地のまま
    } finally {
      await page.close();
    }

    // 幅1280で描いたことの確かめ：狭い幅（760px 以下）で隠す「Sign in」が、撮った枠の中で見えている
    const frame = await openFramePage(browser);
    try {
      await frame.show(work, 'author', fit.viewport.width, fit.viewport.height, { placement: 'top' });
      const signIn = await frame.page.evaluate(() => {
        const el = document.getElementById('ld-host')!.shadowRoot!.querySelector('.signin')!;
        return getComputedStyle(el).display;
      });
      expect(signIn).not.toBe('none');
    } finally {
      await frame.close();
    }

    // リポジトリの見本のサムネイルも、この撮り方で作ったもの
    const committed = readFileSync(join(REPO, 'fixtures/works/fx-nav/thumb.webp'));
    expect(imageSize(committed)).toEqual({ width: 800, height: 480 });
  } finally {
    await browser.close();
  }
});

// capture.delay_ms：作品のコードに撮影の都合を入れず、登場の演出が終わってから撮る・測る（docs/tasks/T013.md「0」）
test('capture.delay_ms：読み込みからこの時間だけ待ってから撮る・測る。既定は待たない', async () => {
  const browser = await launch();
  const base = toRenderable(readWork(findWork('fx-button')!))!;
  const late = {
    ...base,
    js: `export function mount(root) {
  const id = setTimeout(() => root.setAttribute('data-late', ''), 700);
  return () => clearTimeout(id);
}`,
  };
  const frame = await openFramePage(browser);
  const lateSeen = () =>
    frame.page.evaluate(() => document.getElementById('ld-host')!.shadowRoot!.querySelector('[data-ld-part]')!.hasAttribute('data-late'));
  try {
    await frame.show(late, 'author', 800, 600);
    expect(await lateSeen()).toBe(false);
    const started = Date.now();
    await frame.show({ ...late, meta: { ...late.meta, capture: { delay_ms: 1000 } } }, 'author', 800, 600);
    expect(await lateSeen()).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
  } finally {
    await frame.close();
    await browser.close();
  }
});

// OG 画像の題：行頭禁則と文節で折り返し、2行に収まらなければ縮める（docs/tasks/T013.md「0」）
test.describe('OG 画像の題', () => {
  const titleOf = async (title: string) => {
    const browser = await launch();
    try {
      const work = toRenderable(readWork(findWork('fx-button')!))!;
      const creator = { handle: 'fixture', name: 'Fixture', kind: 'person' as const, x_url: null, site_url: null };
      const { png, title: laid } = await renderOg(browser, { ...work, meta: { ...work.meta, title } }, creator, readFileSync(join(REPO, 'fixtures/works/fx-button/thumb.webp')));
      expect(imageSize(png)).toEqual({ width: 1200, height: 630 });
      return laid;
    } finally {
      await browser.close();
    }
  };

  test('「住人のいるスイッチ」は文節で折り返す（「スイ／ッチ」にならない）', async () => {
    const { fontSize, lines } = await titleOf('住人のいるスイッチ');
    expect(lines).toEqual(['住人のいる', 'スイッチ']);
    expect(fontSize).toBe(OG_TITLE_SIZE.max);
  });

  test('短い題と英語の題は大きいまま。語の途中で切らない', async () => {
    expect((await titleOf('水面のいいね')).fontSize).toBe(OG_TITLE_SIZE.max);
    const { fontSize, lines } = await titleOf('Panel Switches');
    expect(fontSize).toBe(OG_TITLE_SIZE.max);
    expect(lines).toEqual(['Panel', 'Switches']);
  });

  test('2行に収まらない題は縮める。行頭に禁則の文字を置かない', async () => {
    const { fontSize, lines } = await titleOf('夕暮れの港に灯る小さな窓のあるスイッチ');
    expect(fontSize).toBeLessThan(OG_TITLE_SIZE.max);
    expect(lines.length).toBeLessThanOrEqual(2);
    const { lines: forbidden } = await titleOf('住人のいる、スイッチ。ゃゅょッー');
    for (const line of forbidden) expect(line).not.toMatch(/^[、。ゃゅょッー]/);
  });

  test('一番小さくしても入らない題は、2行で止める', async () => {
    const { fontSize, lines } = await titleOf('とても長い題名'.repeat(12));
    expect(fontSize).toBe(OG_TITLE_SIZE.min);
    expect(lines.length).toBe(2);
  });
});

test('画面のサムネイルは倍率を変えない（fit を持たない）', async () => {
  const browser = await launch();
  try {
    const landing = await makeThumb(browser, toRenderable(readWork(findWork('fx-landing')!))!);
    expect([landing.width, landing.height, landing.fit]).toEqual([800, 600, undefined]);
    const habits = await makeThumb(browser, toRenderable(readWork(findWork('fx-habits')!))!);
    expect([habits.width, habits.height, habits.fit]).toEqual([800, 1000, undefined]);
  } finally {
    await browser.close();
  }
});
