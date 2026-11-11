import { expect, test, type Page } from '@playwright/test';

const CLS_LIMIT = 0.05;

const observeCls = () => {
  const state = { cls: 0, shifts: [] as { value: number; sources: string[] }[] };
  (window as unknown as { __cls: typeof state }).__cls = state;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as {
      value: number;
      hadRecentInput: boolean;
      sources?: { node?: Element }[];
    }[]) {
      if (entry.hadRecentInput) continue;
      state.cls += entry.value;
      state.shifts.push({
        value: entry.value,
        sources: (entry.sources ?? []).map((s) => s.node?.nodeName ?? '?'),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
};

/** Lighthouse の mobile に近い遅さにする（Slow 4G、CPU 4倍遅い）。 */
async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function readCls(page: Page) {
  return page.evaluate(() => (window as unknown as { __cls: { cls: number; shifts: unknown[] } }).__cls);
}

const sizes = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

test.describe('CLS が 0.05 以下', () => {
  for (const { width, height } of sizes) {
    test(`幅${width}：遅い回線と遅い CPU でも`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(observeCls);
      await throttle(page);
      await page.goto('/', { waitUntil: 'load' });
      await page.locator('article').first().waitFor();
      await page.waitForLoadState('networkidle');
      await scrollThrough(page);
      const { cls, shifts } = await readCls(page);
      console.log(`CLS [幅${width} 遅い回線] ${cls.toFixed(4)}（ずれ ${shifts.length} 回）`, JSON.stringify(shifts));
      expect(cls).toBeLessThanOrEqual(CLS_LIMIT);
    });

    test(`幅${width}：書体が1.5秒遅れて届いても（差し替えのずれ）`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(observeCls);
      await page.route('**/*.woff2', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await page.goto('/');
      await page.locator('article').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const { cls, shifts } = await readCls(page);
      console.log(`CLS [幅${width} 書体が遅れる] ${cls.toFixed(4)}（ずれ ${shifts.length} 回）`, JSON.stringify(shifts));
      expect(cls).toBeLessThanOrEqual(CLS_LIMIT);
    });

    test(`幅${width}：サムネイルが2秒遅れて届いても`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(observeCls);
      await page.route('**/thumb.webp', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      });
      await page.goto('/');
      await page.locator('article').first().waitFor();
      await page.waitForTimeout(2500);
      const { cls, shifts } = await readCls(page);
      console.log(`CLS [幅${width} 画像が遅れる] ${cls.toFixed(4)}（ずれ ${shifts.length} 回）`, JSON.stringify(shifts));
      expect(cls).toBeLessThanOrEqual(CLS_LIMIT);
    });
  }
});
