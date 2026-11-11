// PREVIEW-DPR：プレビューの枠に、実際に見えている細かさ（実際の DPR × 縮めた割合。上限は実際の DPR）を伝える。
// 親が iframe の src の # に ldpr を付け、枠の最初のスクリプト（packages/render の DPR_SCRIPT）が window.devicePixelRatio を置き換える。
// 枠を縮めて見せるのに、作品が実際の DPR で描くと、DPR 3 の端末で 4K 近くまで描いて重いため。
// playwright.config.ts の preview-dpr-chromium、-webkit、-firefox で流す。
import { expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { frameDpr, frameScale, type FrameSize } from '../src/lib/frame';

const FRAME = 'iframe[data-ld-frame]';
const SWITCH_FRAME = 'iframe[data-ld-switch-frame]';
/** 親の見張りが「読み込めた」の知らせを待つ時間（src/frameGuard.ts の CONFIRM_WAIT_MS）より長く */
const AFTER_GUARD_MS = 2500;

async function openWork(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

/** 親から見た、その枠に伝えるはずの値（今の枠の入れ物の幅から）。部品の枠とスイッチの枠は縮めないので、実際の DPR */
async function expectedDpr(page: Page, selector: string): Promise<number> {
  const { size, width, dpr } = await page.locator(selector).evaluate((frame) => {
    const box = frame.closest<HTMLElement>('[data-frame-size]');
    return { size: box?.dataset.frameSize ?? null, width: box?.clientWidth ?? 0, dpr: window.devicePixelRatio };
  });
  return frameDpr(size ? frameScale(size as FrameSize, width) : 1, dpr);
}

/** 枠の中の作品が読む devicePixelRatio */
async function dprInFrame(page: Page, selector: string): Promise<number> {
  const host = page.frameLocator(selector).locator('#ld-host');
  await host.waitFor({ state: 'attached' });
  return host.evaluate(() => window.devicePixelRatio);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 枠の src が「path#ldpr=<値>」で、値が親から見た今の値と合い（枠を読み始めた後に縦のスクロールバーが出ると幅が少し変わるので、0.02 まで）、
 * 枠の中の作品が読む devicePixelRatio がその値と同じこと。値を返す。
 */
async function checkFrame(page: Page, path: string, selector = FRAME): Promise<number> {
  const frame = page.locator(selector);
  await expect(frame).toHaveAttribute('src', new RegExp(`^${escape(path)}#ldpr=\\d+(?:\\.\\d+)?$`));
  const sent = Number(/#ldpr=([\d.]+)$/.exec((await frame.getAttribute('src'))!)![1]);
  expect(Math.abs(sent - (await expectedDpr(page, selector)))).toBeLessThanOrEqual(0.02);
  expect(await dprInFrame(page, selector)).toBe(sent);
  return sent;
}

/** 枠の URL への要求（# は要求に入らない） */
function frameRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/frame/') || path.startsWith('/draft-frame/')) seen.push(path);
  });
  return seen;
}

test.describe('iPhone と同じ DPR 3、幅 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

  test('Web の画面：Desktop の枠は縮めた割合だけ細かさを下げ、Mobile に切り替えても同じ。見張りは読み直さない', async ({ page }) => {
    const requests = frameRequests(page);
    await openWork(page, 'fx-landing');

    // Worker が描いた枠（beforeApp が src を入れる）。幅 390 の画面では 1280 の枠を 3 分の 1 より小さく縮めるので、
    // 作品が描く画素は 3 × 1280 ではなく、見えている分（1 より下）だけ
    const desktop = await checkFrame(page, '/frame/fx-landing/1/desktop.html');
    expect(desktop).toBeGreaterThan(0.5);
    expect(desktop).toBeLessThan(1);

    // React が作った枠（幅の切り替え）。390 の枠を入れ物の幅まで縮める分だけ下げる
    await page.getByRole('button', { name: copy.work.mobile }).click();
    const mobile = await checkFrame(page, '/frame/fx-landing/1/mobile.html');
    expect(mobile).toBeGreaterThan(2);
    expect(mobile).toBeLessThan(3);

    // src のない枠（about:blank）の load を、見張りが「移った」と数えない。どちらの枠も1回ずつだけ読む
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(requests.filter((path) => path.startsWith('/frame/fx-landing/'))).toEqual(['/frame/fx-landing/1/desktop.html', '/frame/fx-landing/1/mobile.html']);
    expect(await dprInFrame(page, FRAME)).toBe(mobile);
  });

  test('スマホの画面：枠の幅が 390 に足りない分だけ下げる', async ({ page }) => {
    await openWork(page, 'fx-habits');
    const value = await checkFrame(page, '/frame/fx-habits/1/mobile.html');
    expect(value).toBeLessThan(3);
  });

  test('部品：縮めないので、実際の DPR のまま', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    expect(await checkFrame(page, '/frame/fx-toggle/1/desktop.html')).toBe(3);
  });

  test('もう一度：作り直した枠にも付く', async ({ page }) => {
    await openWork(page, 'fx-motion');
    expect(await checkFrame(page, '/frame/fx-motion/1/desktop.html')).toBe(3);
    await page.getByRole('button', { name: copy.work.replay }).click();
    expect(await checkFrame(page, '/frame/fx-motion/1/desktop.html')).toBe(3);
  });

  test('ヘッダーのスイッチの枠：縮めないので、実際の DPR のまま', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ldThemeSwitch: string }).__ldThemeSwitch = 'fx-toggle';
    });
    await page.goto('/about');
    expect(await checkFrame(page, '/frame/fx-toggle/1/inline.html', SWITCH_FRAME)).toBe(3);
  });
});

test.describe('デスクトップ、DPR 2', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  test('Desktop の枠は 2 × 縮めた割合。Mobile の枠は縮めないので 2 のまま', async ({ page }) => {
    await openWork(page, 'fx-landing');
    const desktop = await checkFrame(page, '/frame/fx-landing/1/desktop.html');
    expect(desktop).toBeGreaterThan(1);
    expect(desktop).toBeLessThan(2);

    await page.getByRole('button', { name: copy.work.mobile }).click();
    expect(await checkFrame(page, '/frame/fx-landing/1/mobile.html')).toBe(2);
  });
});

test.describe('DPR 1 の画面', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  test('縮めた分だけ 1 より下げる', async ({ page }) => {
    await openWork(page, 'fx-landing');
    expect(await checkFrame(page, '/frame/fx-landing/1/desktop.html')).toBeLessThan(1);
  });
});
