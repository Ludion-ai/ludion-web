// WALL001「1」：全画面の住所（/p/<id>/wall）が、壁紙のアプリの中の大きさで画面いっぱいに描く。
// Plash（Mac）は WebKit、Lively Wallpaper（Windows）は Chromium で開くので、playwright.config.ts の wall-webkit と wall-chromium で流す。
import { expect, test } from '@playwright/test';

const ID = 'fx-wallpaper';

for (const size of [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test.describe(`${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test('枠と作品が画面いっぱい。スクロールしない。作品は動いている', async ({ page }) => {
      await page.goto(`/p/${ID}/wall`);
      const frame = page.locator('iframe');
      expect(await frame.boundingBox()).toEqual({ x: 0, y: 0, ...size });
      expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([size.width, size.height]);

      const root = page.frameLocator('iframe').locator(`[data-ld-part="${ID}"]`);
      await expect(root).toBeVisible();
      expect(
        await root.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, scroll: [document.scrollingElement!.scrollWidth, document.scrollingElement!.scrollHeight] };
        }),
      ).toEqual({ x: 0, y: 0, ...size, scroll: [size.width, size.height] });

      // 動き：太陽の位置が時間で変わる
      const sun = root.locator('.sun');
      const first = await sun.evaluate((el) => el.getBoundingClientRect().y);
      await expect.poll(() => sun.evaluate((el) => el.getBoundingClientRect().y), { timeout: 5000 }).not.toBe(first);
    });
  });
}
