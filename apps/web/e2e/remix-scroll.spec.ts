// FIX-remix-button：「リミックス」は浮かせない。ページを送っても、作品の枠に重ならない（docs/tasks/FIX-remix-button.md）。
// 重なって見えるかどうかはブラウザのスクロールの結果なので、Chromium と WebKit で確かめる（playwright.config.ts の remix-scroll-*）。
import { expect, test, type Page } from '@playwright/test';

type Box = { left: number; right: number; top: number; bottom: number };

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** 同じ瞬間の座標を1回で読む。下のタブは position: fixed の nav の中のリンク（幅1024px以上にはない）。 */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element): Box => {
      const { left, right, top, bottom } = el.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const remix = [...document.querySelectorAll('button[aria-haspopup="dialog"]')].find((el) => el.getBoundingClientRect().height > 0)!;
    const frame = document.querySelector('iframe[data-ld-frame]')!.parentElement!;
    const replay = frame.querySelector('button');
    const tabs = [...document.querySelectorAll('nav')]
      .filter((nav) => getComputedStyle(nav).position === 'fixed')
      .flatMap((nav) => [...nav.querySelectorAll('a')])
      .filter((link) => link.getBoundingClientRect().height > 0);
    return {
      remix: box(remix),
      position: getComputedStyle(remix).position,
      frame: box(frame),
      replay: replay ? box(replay) : null,
      tabs: tabs.map(box),
      scrollY: window.scrollY,
      maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    };
  });

async function openWork(page: Page, id: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

async function scrollTo(page: Page, y: number) {
  await page.evaluate(async (top) => {
    window.scrollTo({ top, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, y);
}

const SCROLLS = [0, 40, 80, 120, 160, 200, 240, 320, 400, 480, 640, 800, 1000];

const WORKS = [
  ['部品', 'fx-toggle'],
  ['部品（もう一度のボタンあり）', 'fx-motion'],
  ['Web の画面', 'fx-landing'],
  ['スマホの画面（枠が画面より長い）', 'fx-habits'],
] as const;

test.describe('枠に重ならない', () => {
  for (const [width, height] of [
    [390, 844],
    [390, 664],
    [390, 600], // ブラウザの枠がもっと大きい端末。sticky のときは、ここで枠に重なっていた
    [768, 1024],
    [1440, 900],
  ] as const) {
    for (const [kind, id] of WORKS) {
      test(`${kind}、幅${width}×高さ${height}：どこまで送っても、ボタンが枠にも「もう一度」にも重ならない`, async ({ page }) => {
        await openWork(page, id, width, height);
        const { maxScroll } = await boxes(page);
        for (const y of [...SCROLLS, maxScroll]) {
          await scrollTo(page, y);
          const now = await boxes(page);
          const at = `y=${now.scrollY}`;
          expect(now.position, at).toBe('static');
          expect(overlaps(now.remix, now.frame), `${at} 枠 ${JSON.stringify([now.remix, now.frame])}`).toBe(false);
          if (now.replay) expect(overlaps(now.remix, now.replay), `${at} もう一度`).toBe(false);
          // 幅1023px以下は、枠のすぐ下で、送っても離れない（浮いていない）
          if (width <= 1023) expect(now.remix.top - now.frame.bottom, at).toBe(12);
        }
      });
    }
  }
});

// 枠が画面より長い作品は、送る途中でボタンが下のタブの後ろを通る。留まらなければよい（11/10 の CTO の決定。docs/reports/FIX-remix-button.md）
test.describe('枠が画面より長い作品：下のタブの後ろは通るだけで、留まらない', () => {
  for (const [width, height] of [
    [390, 844],
    [390, 664],
    [768, 1024],
  ] as const) {
    test(`スマホの画面、幅${width}×高さ${height}：ページと一緒に流れ、通り過ぎたら戻らない。タブの上に出た位置で押せる`, async ({ page }) => {
      await openWork(page, 'fx-habits', width, height);
      const first = await boxes(page);
      const documentTop = first.remix.top + first.scrollY;
      const behindTabs: boolean[] = [];
      for (const y of [...SCROLLS, first.maxScroll]) {
        await scrollTo(page, y);
        const now = await boxes(page);
        const at = `y=${now.scrollY}`;
        expect(now.position, at).toBe('static');
        expect(now.tabs.length, at).toBe(3);
        // 留まらない：ページの中の位置は変わらず、画面の上では送ったぶんだけ上へ動く
        expect(Math.abs(now.remix.top + now.scrollY - documentTop), at).toBeLessThan(0.5);
        behindTabs.push(now.tabs.some((tab) => overlaps(now.remix, tab)));
      }
      // 通り過ぎたら戻らない：重なるのは続いた1つの区間だけで、最後の位置では重なっていない
      expect(behindTabs.filter((behind, i) => behind && !behindTabs[i - 1]).length, JSON.stringify(behindTabs)).toBeLessThanOrEqual(1);
      expect(behindTabs.at(-1), JSON.stringify(behindTabs)).toBe(false);

      // ボタンの下の端が、タブの上端より16px上に来るまで送る
      const tabsTop = Math.min(...first.tabs.map((tab) => tab.top));
      await scrollTo(page, Math.max(0, Math.ceil(first.remix.bottom + first.scrollY - tabsTop + 16)));
      const now = await boxes(page);
      expect(now.tabs.filter((tab) => overlaps(now.remix, tab))).toEqual([]);
      expect(now.remix.top).toBeGreaterThanOrEqual(0);
      expect(now.remix.bottom).toBeLessThanOrEqual(tabsTop);
      const button = page.locator('button[aria-haspopup="dialog"]:visible');
      const hit = await button.evaluate((el) => {
        const { left, right, top, bottom } = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
      });
      expect(hit).toBe(true);
      await button.click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  }
});

test.describe('下のタブに重ならない', () => {
  // 枠が最初の画面に収まる作品。枠が画面より長いスマホの画面は、上の「留まらない」で確かめる
  const INSIDE = WORKS.filter(([, id]) => id !== 'fx-habits');

  for (const [width, height] of [
    [390, 844],
    [390, 664],
    [768, 1024],
  ] as const) {
    for (const [kind, id] of INSIDE) {
      test(`${kind}、幅${width}×高さ${height}：どこまで送っても重ならない`, async ({ page }) => {
        await openWork(page, id, width, height);
        const { maxScroll } = await boxes(page);
        for (const y of [...SCROLLS, maxScroll]) {
          await scrollTo(page, y);
          const now = await boxes(page);
          expect(now.tabs.length, `y=${now.scrollY}`).toBe(3);
          expect(
            now.tabs.filter((tab) => overlaps(now.remix, tab)),
            `y=${now.scrollY}`,
          ).toEqual([]);
        }
      });
    }
  }

  test('幅1440：下のタブはなく、ボタンは右の列にある', async ({ page }) => {
    await openWork(page, 'fx-toggle', 1440, 900);
    const now = await boxes(page);
    expect(now.tabs).toEqual([]);
    expect(now.remix.left).toBeGreaterThan(now.frame.right);
  });

  test('幅390×600でも、少し送れば重ならず、押せる', async ({ page }) => {
    await openWork(page, 'fx-toggle', 390, 600);
    await scrollTo(page, 40);
    const now = await boxes(page);
    expect(now.tabs.filter((tab) => overlaps(now.remix, tab))).toEqual([]);
    const button = page.locator('button[aria-haspopup="dialog"]:visible');
    await button.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
