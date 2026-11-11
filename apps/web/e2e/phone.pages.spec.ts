// スマホ（指で触る端末で、画面の幅が狭い）の作品のページのプレビュー（SPEC.md 13「プレビュー」）。
// 「モバイル」だけを見せ、枠を縮めずにその大きさのまま描く。枠は最初の画面に収まり、下のボタンが見える。
import { expect, test, type Page } from '@playwright/test';

const WALLPAPER = 'fx-wallpaper';
const MOBILE_FRAME = `/frame/${WALLPAPER}/1/mobile.html`;

/** ヘッダー64px、main の上の余白8px、枠の下に残す72px（src/lib/frame.ts の BOX_CLASS.mobile） */
const HEADER = 64;
const TOP_GAP = 8;
const BELOW = 72;

const PHONES = [
  { label: 'iPhone（390×844、DPR 3）', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
  { label: '小さい iPhone（375×667、DPR 2）', viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 },
] as const;

/**
 * 見本の作品には canvas を持つ画面がないので、枠の文書に、作品の決まり（CLAUDE.md「動きの決まり」：devicePixelRatio は2まで）
 * どおりに描く canvas を1つ足す。枠の守り（応答の頭、sandbox）はそのまま。Mobile の枠を読んだ回数も数える。
 */
async function addCanvas(page: Page): Promise<{ loads: () => number }> {
  let loads = 0;
  await page.route(`**${MOBILE_FRAME}`, async (route) => {
    loads += 1;
    const response = await route.fetch({ headers: { ...route.request().headers(), 'sec-fetch-dest': 'iframe' } });
    const script =
      `<script type="module">` +
      `const root=document.querySelector('[data-ld-id]').shadowRoot.querySelector('[data-ld-part]');` +
      `const canvas=document.createElement('canvas');canvas.setAttribute('data-test-canvas','');` +
      `canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:0';root.append(canvas);` +
      `const fit=()=>{const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(canvas.clientWidth*dpr);canvas.height=Math.round(canvas.clientHeight*dpr)};` +
      `new ResizeObserver(fit).observe(canvas);fit();` +
      `</script>`;
    await route.fulfill({ response, body: (await response.text()).replace('</body>', `${script}</body>`) });
  });
  return { loads: () => loads };
}

async function openWork(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

const frameOf = (page: Page) => page.locator('iframe[data-ld-frame]');

/** 入れ物（枠の線の外側）、iframe、下のボタンの位置を、同じ瞬間に読む。 */
const layout = (page: Page) =>
  page.evaluate(() => {
    const rect = (el: Element) => {
      const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-ld-frame]')!;
    const box = frame.parentElement!;
    const main = document.querySelector('main')!;
    const mainStyle = getComputedStyle(main);
    const buttons = [...document.querySelectorAll('button[aria-haspopup="dialog"]')].filter((el) => el.getBoundingClientRect().height > 0);
    return {
      box: rect(box),
      frame: rect(frame),
      frameClient: [frame.clientWidth, frame.clientHeight],
      transform: getComputedStyle(frame).transform,
      size: box.dataset.frameSize,
      body: main.clientWidth - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
      buttons: buttons.map(rect),
      viewport: [window.innerWidth, window.innerHeight],
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollY: window.scrollY,
    };
  });

for (const phone of PHONES) {
  test.describe(phone.label, () => {
    test.use({ viewport: phone.viewport, deviceScaleFactor: phone.deviceScaleFactor, hasTouch: true, isMobile: true });

    test('Web の画面：切り替えは出ず、Mobile の枠だけ。枠は縮めずに描き、最初の画面に収まり、下のボタンが見える。canvas は枠の大きさ × 2 以下', async ({ page }) => {
      const canvasFrame = await addCanvas(page);
      await openWork(page, WALLPAPER);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

      // 1. 「モバイル」だけ。切り替えは出さない
      await expect(page.getByRole('button', { name: 'デスクトップ' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'モバイル' })).toHaveCount(0);
      await expect(frameOf(page)).toHaveCount(1);
      await expect(frameOf(page)).toHaveAttribute('src', MOBILE_FRAME);

      const now = await layout(page);
      const height = now.viewport[1];
      expect(now.size).toBe('mobile');
      expect(now.scrollY).toBe(0);
      expect(now.overflow).toBe(0);

      // 2. 枠の幅は本文の幅。縮めない（CSS の scale を使わない）：iframe は入れ物の線の内側いっぱい
      expect(now.box.width).toBeCloseTo(now.body, 1);
      expect(now.transform).toBe('none');
      expect(now.frame.width).toBeCloseTo(now.box.width - 2, 1);
      expect(now.frame.height).toBeCloseTo(now.box.height - 2, 1);
      // clientWidth と clientHeight は整数に丸まる（高さは 613.6px などの端数になる）
      expect(Math.abs(now.frame.width - now.frameClient[0])).toBeLessThan(1);
      expect(Math.abs(now.frame.height - now.frameClient[1])).toBeLessThan(1);

      // 高さは「見えている画面の高さ − ヘッダー − 余白」。3. 縦÷横は 1.3 から 1.8
      const wanted = Math.min(Math.max(height - HEADER - TOP_GAP - BELOW, now.box.width * 1.3), now.box.width * 1.8);
      expect(Math.abs(now.box.height - wanted)).toBeLessThan(1);
      expect(now.box.height / now.box.width).toBeGreaterThanOrEqual(1.3 - 0.01);
      expect(now.box.height / now.box.width).toBeLessThanOrEqual(1.8 + 0.01);

      // 枠の下の端が画面の中に収まり、「リミックス」「壁紙にする」が見える（枠のすぐ下。画面の中に20px以上）
      expect(now.box.top).toBeCloseTo(HEADER + TOP_GAP, 0);
      expect(now.box.bottom).toBeLessThanOrEqual(height - BELOW + 0.5);
      expect(now.buttons.length).toBe(2);
      for (const button of now.buttons) {
        expect(button.top - now.box.bottom).toBeCloseTo(12, 0);
        expect(height - button.top).toBeGreaterThanOrEqual(20);
      }
      await expect(page.getByRole('button', { name: 'リミックス' })).toBeVisible();
      await expect(page.getByRole('button', { name: '壁紙にする' })).toBeVisible();

      // 枠の中の画面は、枠と同じ大きさ（390×844 を縮めたものではない）
      const inside = page.frameLocator('iframe[data-ld-frame]');
      await expect(inside.locator(`[data-ld-part="${WALLPAPER}"]`)).toBeVisible();
      const canvas = inside.locator('canvas[data-test-canvas]');
      await expect(canvas).toHaveCount(1);
      const drawn = await canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height, inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio }));
      // 高さに端数があるとき（例：613.6px）、ブラウザが整数に丸めるので、1px の差は認める
      expect(Math.abs(drawn.inner[0] - now.frame.width)).toBeLessThan(1);
      expect(Math.abs(drawn.inner[1] - now.frame.height)).toBeLessThan(1);
      expect(drawn.dpr).toBe(phone.deviceScaleFactor);

      // canvas の画素数は「枠の大きさ × 2」以下（端数は切り上げて比べる）
      expect(drawn.width).toBeGreaterThan(0);
      expect(drawn.height).toBeGreaterThan(0);
      expect(drawn.width).toBeLessThanOrEqual(Math.ceil(now.frame.width) * 2);
      expect(drawn.height).toBeLessThanOrEqual(Math.ceil(now.frame.height) * 2);

      // React が載っても、枠を作り直さない（Mobile の枠を読むのは1回）
      await page.waitForTimeout(500);
      expect(canvasFrame.loads()).toBe(1);
      await expect(frameOf(page)).toHaveAttribute('src', MOBILE_FRAME);
    });

    test('スマホの画面（platform が mobile）：同じ形。枠は縮めずに描く', async ({ page }) => {
      await openWork(page, 'fx-habits');
      await expect(frameOf(page)).toHaveAttribute('src', '/frame/fx-habits/1/mobile.html');
      const now = await layout(page);
      expect(now.transform).toBe('none');
      expect(now.box.width).toBeCloseTo(now.body, 1);
      expect(now.frame.width).toBeCloseTo(now.box.width - 2, 1);
      expect(now.box.height / now.box.width).toBeGreaterThanOrEqual(1.3 - 0.01);
      expect(now.box.height / now.box.width).toBeLessThanOrEqual(1.8 + 0.01);
      expect(now.box.bottom).toBeLessThanOrEqual(now.viewport[1] - BELOW + 0.5);
      expect(now.overflow).toBe(0);
    });
  });
}

test.describe('スマホでないとき', () => {
  test('指で触る端末でも、幅が広ければ（768×1024）今のまま：切り替えが出て、既定はデスクトップ', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openWork(page, WALLPAPER);
    await expect(page.getByRole('button', { name: 'デスクトップ' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'モバイル' })).toHaveAttribute('aria-pressed', 'false');
    await expect(frameOf(page)).toHaveAttribute('src', `/frame/${WALLPAPER}/1/desktop.html`);
    expect((await layout(page)).size).toBe('desktop');
    await context.close();
  });

  test('マウスの端末は、幅390でも今のまま：切り替えが出て、Mobile は 390×844 を縮めて見せる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, WALLPAPER);
    await expect(page.getByRole('button', { name: 'デスクトップ' })).toHaveAttribute('aria-pressed', 'true');
    await expect(frameOf(page)).toHaveAttribute('src', `/frame/${WALLPAPER}/1/desktop.html`);
    await page.getByRole('button', { name: 'モバイル' }).click();
    await expect(frameOf(page)).toHaveAttribute('src', MOBILE_FRAME);
    const now = await layout(page);
    expect(now.frameClient).toEqual([390, 844]);
    expect(now.transform).not.toBe('none');
  });

  test('スマホを横にして幅が広くなると、切り替えが出て、デスクトップの枠に戻る', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openWork(page, WALLPAPER);
    await expect(frameOf(page)).toHaveAttribute('src', MOBILE_FRAME);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole('button', { name: 'デスクトップ' })).toHaveAttribute('aria-pressed', 'true');
    await expect(frameOf(page)).toHaveAttribute('src', `/frame/${WALLPAPER}/1/desktop.html`);
    expect((await layout(page)).size).toBe('desktop');
    await context.close();
  });
});
