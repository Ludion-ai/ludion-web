// FIX-motion：「動きを減らす」設定や WebGL のない端末で、作品が止まって見えるとき、理由を出す（docs/tasks/FIX-motion.md「3」）。
// fx-motion は 2D の canvas の見本。「減らす」では1枚描いて止まり、そうでなければ動き続ける。
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { copyEn } from '../src/copy.en';

const MOVING = 'fx-motion';
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const STORAGE_KEY = 'ld-show-motion';
const FRAME = 'iframe[data-ld-frame]';
/** 枠を撮る間隔 */
const GAP_MS = 1200;

const notice = (page: Page) => page.locator('[data-motion-notice]');
const webglNotice = (page: Page) => page.locator('[data-webgl-notice]');
const button = (page: Page, name: string) => notice(page).getByRole('button', { name });
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);

/** 作品のページを開き、React が載るまで待つ。 */
async function openWork(page: Page, id = MOVING) {
  await page.goto(`/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

/** 枠が読み込めて mount が済むまで待ち、時間をあけて2回撮って比べる。 */
async function frameMoves(page: Page): Promise<boolean> {
  await expect(page.frameLocator(FRAME).locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
  const frame = page.locator(FRAME);
  const first = await frame.screenshot();
  await page.waitForTimeout(GAP_MS);
  const second = await frame.screenshot();
  return !first.equals(second);
}

const frameSrc = (page: Page) => page.locator(FRAME).getAttribute('src');

test.describe('端末が「動きを減らす」のとき', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('知らせが出る → 動きを見る → 再読み込みしても覚えている → 動きを止める', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // 知らせが出て、作品は止まっている
    await openWork(page);
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText(copy.work.motionStopped);
    await expect(button(page, copy.work.motionShow)).toBeVisible();
    expect(await frameSrc(page)).toBe(`/frame/${MOVING}/1/desktop.html`);
    expect(await frameMoves(page), '止まっている').toBe(false);
    expect(await stored(page)).toBeNull();

    // 動きを見る（キーボードで押す。文が変わってもフォーカスがボタンに残る）
    await button(page, copy.work.motionShow).focus();
    await page.keyboard.press('Enter');
    await expect(notice(page)).toContainText(copy.work.motionShown);
    await expect(button(page, copy.work.motionStop)).toBeFocused();
    await expect(page.locator(FRAME)).toHaveAttribute('src', `/frame/${MOVING}/1/desktop.html?motion=1`);
    expect(await frameMoves(page), '動く').toBe(true);
    expect(await stored(page)).toBe('1');

    // 再読み込みしても覚えている
    await page.reload();
    await page.getByRole('heading', { level: 1 }).waitFor();
    await expect(button(page, copy.work.motionStop)).toBeVisible();
    await expect(page.locator(FRAME)).toHaveAttribute('src', `/frame/${MOVING}/1/desktop.html?motion=1`);
    expect(await frameMoves(page), '読み直しても動く').toBe(true);

    // ほかの作品へ移っても同じ
    await page.goto('/p/fx-toggle');
    await expect(page.locator(FRAME)).toHaveAttribute('src', '/frame/fx-toggle/1/desktop.html?motion=1');
    await page.goto(`/p/${MOVING}`);
    await expect(page.locator(FRAME)).toHaveAttribute('src', /\?motion=1$/);

    // 動きを止める
    await button(page, copy.work.motionStop).click();
    await expect(notice(page)).toContainText(copy.work.motionStopped);
    await expect(page.locator(FRAME)).toHaveAttribute('src', `/frame/${MOVING}/1/desktop.html`);
    expect(await frameMoves(page), '止まる').toBe(false);
    expect(await stored(page)).toBeNull();

    // 止めたことも読み直しで残る
    await page.reload();
    await expect(button(page, copy.work.motionShow)).toBeVisible();
    expect(await frameMoves(page), '読み直しても止まっている').toBe(false);
    expect(errors).toEqual([]);
  });

  test('もう一度を押しても、動きを見る枠のまま', async ({ page }) => {
    await openWork(page);
    await button(page, copy.work.motionShow).click();
    await expect(page.locator(FRAME)).toHaveAttribute('src', /\?motion=1$/);
    await page.getByRole('button', { name: copy.work.replay }).click();
    await expect(page.locator(FRAME)).toHaveAttribute('src', /\?motion=1$/);
    expect(await frameMoves(page)).toBe(true);
  });

  test('localStorage が使えなくても動く（覚えられないだけ）', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
      Storage.prototype.removeItem = blocked;
    });
    await openWork(page);
    await button(page, copy.work.motionShow).click();
    await expect(page.locator(FRAME)).toHaveAttribute('src', /\?motion=1$/);
    expect(await frameMoves(page)).toBe(true);
    await button(page, copy.work.motionStop).click();
    await expect(page.locator(FRAME)).not.toHaveAttribute('src', /\?motion/);
    await page.reload();
    await expect(button(page, copy.work.motionShow)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('知らせは Worker の HTML に入っているので、読み込みの後に枠がずれない', async ({ browser, baseURL, browserName }) => {
    const box = async (javaScriptEnabled: boolean) => {
      const context = await browser.newContext({ baseURL, javaScriptEnabled, reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(`/p/${MOVING}`);
      await expect(notice(page)).toBeVisible();
      await expect(notice(page)).toContainText(copy.work.motionStopped);
      const place = await page.locator('[data-ld-frame]').evaluate((frame) => frame.getBoundingClientRect().top);
      await context.close();
      return place;
    };
    test.skip(browserName !== 'chromium', 'レイアウトの比べは1つのブラウザで足りる');
    expect(await box(true)).toBe(await box(false));
  });

  for (const shown of [false, true]) {
    test(`axe：知らせ（${shown ? '動きを見せている' : '止めている'}）に critical と serious がない`, async ({ page }) => {
      await openWork(page);
      if (shown) await button(page, copy.work.motionShow).click();
      await expect(notice(page)).toContainText(shown ? copy.work.motionShown : copy.work.motionStopped);
      const { violations } = await new AxeBuilder({ page }).include('[data-motion-notice]').analyze();
      expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    });
  }

  test('幅390でも、はみ出さない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page);
    await expect(notice(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const { x, width } = (await button(page, copy.work.motionShow).boundingBox())!;
    expect(x + width).toBeLessThanOrEqual(390);
  });
});

test.describe('ふつうの端末', () => {
  test('知らせが出ず、作品は動く', async ({ page }) => {
    await openWork(page);
    await expect(notice(page)).toBeHidden();
    await expect(page.getByRole('button', { name: copy.work.motionShow })).toHaveCount(0);
    expect(await frameSrc(page)).toBe(`/frame/${MOVING}/1/desktop.html`);
    expect(await frameMoves(page)).toBe(true);
  });

  test('前に「動きを見る」を選んでいても、ふつうの枠を読む', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), STORAGE_KEY);
    await openWork(page);
    await expect(notice(page)).toBeHidden();
    expect(await frameSrc(page)).toBe(`/frame/${MOVING}/1/desktop.html`);
  });
});

test.describe('英語のページ', () => {
  test.use({ locale: 'en-US', contextOptions: { reducedMotion: 'reduce' } });

  test('知らせとボタンが英語で、動きを見ると枠が動く。選んだことは日本語のページと同じ', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === 'webgl' || type === 'webgl2' ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await page.goto(`/en/p/${MOVING}`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await expect(notice(page)).toContainText(copyEn.work.motionStopped);
    await expect(webglNotice(page)).toHaveText(copyEn.work.noWebgl);

    await button(page, copyEn.work.motionShow).click();
    await expect(notice(page)).toContainText(copyEn.work.motionShown);
    await expect(page.locator(FRAME)).toHaveAttribute('src', `/frame/${MOVING}/1/desktop.html?motion=1`);
    expect(await frameMoves(page), '動く').toBe(true);
    expect(await stored(page)).toBe('1');

    await button(page, copyEn.work.motionStop).click();
    await expect(notice(page)).toContainText(copyEn.work.motionStopped);
    await expect(page.locator(FRAME)).toHaveAttribute('src', `/frame/${MOVING}/1/desktop.html`);
  });
});

test.describe('枠の守りは ?motion=1 でも同じ', () => {
  const PATH = `/frame/${MOVING}/1/desktop.html`;

  test('見出しが同じで、枠の外から開くと作品のページへ戻す', async ({ request }) => {
    const plain = await request.get(PATH, { headers: FROM_IFRAME });
    const motion = await request.get(`${PATH}?motion=1`, { headers: FROM_IFRAME });
    expect(motion.status()).toBe(200);
    const picked = (headers: Record<string, string>) => Object.fromEntries(['cache-control', 'content-security-policy', 'content-type', 'vary', 'x-content-type-options'].map((name) => [name, headers[name]]));
    expect(picked(motion.headers())).toEqual(picked(plain.headers()));
    expect(motion.headers()['cache-control']).toBe('private, no-store');
    expect(motion.headers()['content-security-policy']).toContain("sandbox allow-scripts allow-forms; form-action 'none'");

    const outside = await request.get(`${PATH}?motion=1`, { maxRedirects: 0 });
    expect(outside.status()).toBe(302);
    expect(outside.headers().location).toBe(`/p/${MOVING}`);
  });

  test('1 のときだけ書き換える', async ({ request }) => {
    const body = async (query: string) => (await request.get(`${PATH}${query}`, { headers: FROM_IFRAME })).text();
    const plain = await body('');
    expect(plain).not.toContain('window.matchMedia=');
    expect(await body('?motion=1')).toContain('window.matchMedia=');
    for (const query of ['?motion=0', '?motion=', '?motion=true', '?motion=1x', '?Motion=1']) expect(await body(query), query).toBe(plain);
  });

  test('親のページの sandbox は変わらない', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await openWork(page);
    await button(page, copy.work.motionShow).click();
    await expect(page.locator(FRAME)).toHaveAttribute('src', /\?motion=1$/);
    await expect(page.locator(FRAME)).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    await context.close();
  });
});

test.describe('WebGL の知らせ', () => {
  test('ふつうでは出ない', async ({ page, browserName }) => {
    await openWork(page);
    const available = await page.evaluate(() => !!(document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')));
    // Windows の Playwright の WebKit は WebGL を持つかが環境で変わる。Chromium はこの環境で必ず持つ
    if (browserName === 'chromium') expect(available).toBe(true);
    if (available) await expect(webglNotice(page)).toHaveCount(0);
  });

  test('本当に WebGL のない Chromium で出る', async ({ baseURL, browserName }) => {
    test.skip(browserName !== 'chromium', '起動の引数で WebGL を切れるのは Chromium だけ');
    // --disable-gpu だけだと、ソフトウェアの描画で WebGL が残る
    const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-software-rasterizer'] });
    try {
      const page = await browser.newPage({ baseURL });
      await openWork(page);
      expect(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'))).toBe(false);
      await expect(webglNotice(page)).toBeVisible();
      await expect(webglNotice(page)).toHaveText(copy.work.noWebgl);
      // 動きを減らす設定ではないので、もう1つの知らせは出ない
      await expect(notice(page)).toBeHidden();
    } finally {
      await browser.close();
    }
  });

  for (const [label, fake] of [
    ['null を返す', 'null'],
    ['例外を投げる', 'throw'],
  ] as const) {
    test(`getContext が${label}端末で出る`, async ({ page }) => {
      await page.addInitScript((kind) => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          if (type === 'webgl' || type === 'webgl2') {
            if (kind === 'throw') throw new Error('no webgl');
            return null;
          }
          return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
        } as typeof original;
      }, fake);
      await openWork(page);
      await expect(webglNotice(page)).toHaveText(copy.work.noWebgl);
    });
  }

  test('両方の知らせが同時に出ても、はみ出さない', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === 'webgl' || type === 'webgl2' ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await openWork(page);
    await expect(notice(page)).toBeVisible();
    await expect(webglNotice(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await context.close();
  });
});
