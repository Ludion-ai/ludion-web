// WALL001：動く壁紙（作品のページの「壁紙にする」、全画面の住所 /p/<id>/wall、ホームの「壁紙」のチップ）。
// 名前の .pages.spec.ts で、作品のページのテストのサーバー（playwright.config.ts の pages）で動く。見本は fixtures/works/fx-wallpaper。
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { copyEn } from '../src/copy.en';
import type { Work } from '../src/data/works';
import { PAGE_CACHE_CONTROL } from '../worker/cachePolicy';
import { pageOverflow, pretendMac, pretendWindows } from './helpers';

const text = copy.work.wallpaper;
const ID = 'fx-wallpaper';
const TITLE = 'Slow Dusk Wallpaper';
const WALL_URL = `https://ludion.ai/p/${ID}/wall`;

async function openWork(page: Page, id: string, base = '') {
  await page.goto(`${base}/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

const wallpaperButton = (page: Page, name = text.open) => page.getByRole('button', { name, exact: true }).locator('visible=true');
const sheet = (page: Page, name = text.heading) => page.getByRole('dialog', { name });

async function countsOf(request: APIRequestContext, id: string) {
  const { works } = (await (await request.get('/api/works')).json()) as { works: Work[] };
  const work = works.find((w) => w.id === id)!;
  return { views: work.views, copies: work.copies };
}

/** ページの JSON に入っている、コピーされるコード（「コードをコピー」と同じもの）。 */
const snippetOf = async (page: Page) => (JSON.parse((await page.locator('#ld-page').textContent())!) as { snippet: string }).snippet;

type Sent = [name: string, params: Record<string, unknown>];

/** ludion.ai の外では gtag を読まないので、置き換えて受け取る（remix.pages.spec.ts と同じ） */
async function watchEvents(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.exposeFunction('__sent', (name: string, params: Record<string, unknown>) => sent.push([name, params]));
  await page.addInitScript(() => {
    const record = (window as unknown as { __sent: (name: string, params: unknown) => void }).__sent;
    window.gtag = (command: unknown, name: unknown, params: unknown) => {
      if (command === 'event' && name !== 'page_view') record(name as string, params);
    };
  });
  return sent;
}

// ---------------------------------------------------------------- 「壁紙にする」

test.describe('作品のページの「壁紙にする」', () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

  test('壁紙の作品にだけ、「リミックス」の横に出る。ほかの作品には出ない', async ({ page }) => {
    await openWork(page, ID);
    const remix = page.getByRole('button', { name: copy.work.remix.open, exact: true }).locator('visible=true');
    await expect(wallpaperButton(page)).toBeVisible();
    const [a, b] = [(await remix.boundingBox())!, (await wallpaperButton(page).boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(b.x).toBeGreaterThan(a.x + a.width);

    for (const other of ['fx-toggle', 'fx-landing']) {
      await openWork(page, other);
      await expect(page.getByRole('button', { name: text.open, exact: true })).toHaveCount(0);
      await expect(remix).toBeVisible();
    }
  });

  test('Mac：Plash の住所の形、App Store のリンク、住所のコピー。閲覧数とコピー数は増えない', async ({ page, request }) => {
    await page.addInitScript(pretendMac);
    const sent = await watchEvents(page);
    await openWork(page, ID);
    await page.waitForLoadState('networkidle');
    const before = await countsOf(request, ID);
    // ほかの試験が同じ作品を並べて開くので、閲覧数は数ではなく、このページが送る要求で確かめる
    const counted: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/count') counted.push(r.postData() ?? '');
    });
    await wallpaperButton(page).click();
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();

    // Mac が先、Windows、ほかのアプリの順
    expect(await dialog.locator('section').evaluateAll((list) => list.map((s) => s.getAttribute('data-wallpaper')))).toEqual(['mac', 'windows', 'other']);

    const plash = dialog.getByRole('link', { name: text.plash });
    const href = (await plash.getAttribute('href'))!;
    expect(href).toBe(`plash:add?url=${encodeURIComponent(WALL_URL)}&title=${encodeURIComponent(TITLE)}`);
    const parsed = new URLSearchParams(href.slice('plash:add?'.length));
    expect(parsed.get('url')).toBe(WALL_URL);
    expect(parsed.get('title')).toBe(TITLE);

    await expect(dialog.getByRole('link', { name: text.plashStore })).toHaveAttribute('href', 'https://apps.apple.com/app/id1494023538');
    await expect(dialog.getByRole('link', { name: text.livelyStore })).toHaveAttribute('href', 'https://apps.microsoft.com/store/detail/9NTM2QC6QWS7');
    await expect(dialog.getByRole('textbox', { name: text.urlLabel }).first()).toHaveValue(WALL_URL);

    // Plash へは移らせない（試験の機械に Plash はない）。押した数だけを見る
    await page.evaluate(() =>
      document.addEventListener('click', (event) => {
        if ((event.target as Element).closest('a[href^="plash:"]')) event.preventDefault();
      }),
    );
    sent.length = 0;
    await plash.click();
    await expect.poll(() => sent).toEqual([['wallpaper_open', { work_id: ID, method: 'plash' }]]);

    sent.length = 0;
    await dialog.getByRole('button', { name: text.copyUrl }).first().click();
    await expect(dialog.getByRole('button', { name: text.copied })).toBeVisible();
    expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(WALL_URL);
    await expect.poll(() => sent).toEqual([['wallpaper_open', { work_id: ID, method: 'copy' }]]);

    await page.waitForLoadState('networkidle');
    // シートの操作では、閲覧数もコピー数も数えない
    expect(counted).toEqual([]);
    expect((await countsOf(request, ID)).copies).toBe(before.copies);
  });

  test('HTML を保存：<id>.html で、中身はコピーされるコードと1文字も違わない（クレジット行つき）', async ({ page }) => {
    const sent = await watchEvents(page);
    await openWork(page, ID);
    await wallpaperButton(page).click();
    sent.length = 0;
    const [download] = await Promise.all([page.waitForEvent('download'), sheet(page).getByRole('button', { name: text.download }).click()]);
    expect(download.suggestedFilename()).toBe(`${ID}.html`);
    const saved = readFileSync((await download.path())!, 'utf8');
    expect(saved).toBe(await snippetOf(page));
    expect(saved.split('\n')[0]).toBe(`<!-- UI by @fixture — ludion.ai/p/${ID} (MIT) -->`);
    await expect.poll(() => sent).toEqual([['wallpaper_open', { work_id: ID, method: 'download' }]]);
  });

  test('Windows の端末では Windows が先。Esc で閉じ、フォーカスはボタンへ戻る', async ({ page }) => {
    await page.addInitScript(pretendWindows);
    await openWork(page, ID);
    await wallpaperButton(page).click();
    const dialog = sheet(page);
    expect(await dialog.locator('section').evaluateAll((list) => list.map((s) => s.getAttribute('data-wallpaper')))).toEqual(['windows', 'mac', 'other']);
    await expect(dialog.getByText(text.livelySteps[0])).toBeVisible();
    await expect(dialog.getByText(text.livelySteps[1])).toBeVisible();
    await expect(dialog.getByText(text.power)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(wallpaperButton(page)).toBeFocused();
  });

  test('英語のページ：英語の文字', async ({ page }) => {
    await openWork(page, ID, '/en');
    await wallpaperButton(page, copyEn.work.wallpaper.open).click();
    const dialog = sheet(page, copyEn.work.wallpaper.heading);
    await expect(dialog.getByRole('link', { name: copyEn.work.wallpaper.plash })).toBeVisible();
    await expect(dialog.getByRole('button', { name: copyEn.work.wallpaper.download })).toBeVisible();
  });
});

test.describe('スマホ（幅390）', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  test('「PC で開いてください」と住所のコピーだけ。横にはみ出さない', async ({ page }) => {
    await openWork(page, ID);
    await expect(wallpaperButton(page)).toBeVisible();
    await wallpaperButton(page).click();
    const dialog = sheet(page);
    await expect(dialog.getByText(text.mobile)).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: text.urlLabel })).toHaveValue(WALL_URL);
    await expect(dialog.getByRole('button', { name: text.copyUrl })).toBeVisible();
    await expect(dialog.getByRole('link', { name: text.plash })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: text.download })).toHaveCount(0);
    expect(await pageOverflow(page)).toBe(0);
  });
});

// ---------------------------------------------------------------- 全画面の住所

test.describe('全画面の住所 /p/<id>/wall', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('作品だけを画面いっぱいに出す。頭も文もない。枠は守りの枠', async ({ page }) => {
    const response = (await page.goto(`/p/${ID}/wall`))!;
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers()['cache-control']).toBe(PAGE_CACHE_CONTROL);
    expect(response.headers()['content-security-policy']).toContain("frame-src 'self'");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('#root')).toHaveCount(0);
    await expect(page.locator('header, h1, a, button')).toHaveCount(0);

    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    await expect(frame).toHaveAttribute('src', `/frame/${ID}/1/wall.html`);
    expect(await frame.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 });

    const root = page.frameLocator('iframe').locator(`[data-ld-part="${ID}"]`);
    await expect(root).toBeVisible();
    const rect = await root.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, scroll: document.scrollingElement!.scrollHeight };
    });
    expect(rect).toEqual({ x: 0, y: 0, width: 1440, height: 900, scroll: 900 });
  });

  test('閲覧数とコピー数を数えない。/api/count も GA4 も読まない', async ({ page, request }) => {
    const before = (await countsOf(request, ID)).copies;
    const requests: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    await page.goto(`/p/${ID}/wall`);
    await expect(page.frameLocator('iframe').locator(`[data-ld-part="${ID}"]`)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(requests.filter((path) => path.startsWith('/api/'))).toEqual([]);
    expect(requests.filter((path) => path.startsWith('/assets/'))).toEqual([]);
    // 閲覧数はほかの試験が同じ作品を開くと増えるので、要求が0であることで確かめる
    expect((await countsOf(request, ID)).copies).toBe(before);
  });

  test.describe('端末が「動きを減らす」のとき', () => {
    test.use({ reducedMotion: 'reduce' });

    test('全画面の住所では動く。対照：作品のページの枠では止まる', async ({ page }) => {
      const sun = (frame: string) => page.frameLocator(frame).locator(`[data-ld-part="${ID}"] .sun`);
      await page.goto(`/p/${ID}/wall`);
      await expect.poll(() => sun('iframe').evaluate((el) => getComputedStyle(el).animationName)).toBe('fx-wallpaper-sink');

      await openWork(page, ID);
      await expect.poll(() => sun('iframe[data-ld-frame]').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    });
  });

  test('ない作品は 404。GA4 も React も読まない', async ({ page }) => {
    const response = (await page.goto('/p/no-such-work/wall'))!;
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('#root')).toHaveCount(0);
  });

  test('枠の URL を直接開くと、作品のページへ戻る（今の枠と同じ）', async ({ request }) => {
    const response = await request.get(`/frame/${ID}/1/wall.html`, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toBe(`/p/${ID}`);
  });
});

// ---------------------------------------------------------------- ホームの「壁紙」

test.describe('ホームの「壁紙」のチップ', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('/?c=wallpaper：壁紙の作品だけ。チップはリンクで、選ばれている', async ({ page }) => {
    await page.goto('/');
    const chip = page.getByRole('group', { name: copy.filters.label }).getByRole('link', { name: copy.filters.wallpaper, exact: true });
    await expect(chip).toHaveAttribute('href', '/?c=wallpaper');
    await page.goto('/?c=wallpaper');
    await expect(page.getByRole('group', { name: copy.filters.label }).getByRole('link', { name: copy.filters.wallpaper, exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const cards = page.locator('[data-masonry] > article');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator(`a[href$="/p/${ID}"]`).first()).toBeAttached();
  });
});
