import { expect, test, type Page } from '@playwright/test';
import { cardBoxes, countWorks, openHome, pretendMac, pretendWindows, popularOrder, TOTAL, withoutNoscript } from './helpers';

const sizes = [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

/** React の本体が届かないようにする。release() で届く。 */
async function holdAppBundle(page: Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/index-*.js', async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test.describe('HTML の中身', () => {
  test('カードが全部入っていて、サムネイルは先頭8枚だけ読み込みが始まる', async ({ request }) => {
    const html = withoutNoscript(await (await request.get('/')).text());
    expect(html.match(/<article/g)).toHaveLength(TOTAL);
    expect(html.match(/<img[^>]*thumb\.webp[^>]*>/g)).toHaveLength(8);
    expect(html).toContain('Studio Portfolio Landing');
    expect(html).toContain('@seed_a');
    expect(html).toMatch(/<img[^>]*seed-portfolio-landing[^>]*fetchPriority="high"/);
  });

  test('同じ URL なら、誰にでも同じ HTML を返す（人によって変えない。SPEC 10）', async ({ request }) => {
    const first = await (await request.get('/')).text();
    const second = await (await request.get('/')).text();
    expect(second).toBe(first);
  });
});

test.describe('React が届く前', () => {
  for (const { width, height } of sizes) {
    test(`幅${width}：カードは置かれていて、サムネイルが見える。React が届いても動かない`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors = collectErrors(page);
      const release = await holdAppBundle(page);

      await page.goto('/', { waitUntil: 'commit' });
      // HTML は流れてくるので、途中のカードではなく、beforeApp が全部を置いたところから測る
      await page.locator('[data-masonry][style]').waitFor({ state: 'attached' });
      await page.waitForFunction(() => {
        const thumb = document.querySelector<HTMLImageElement>('article > a > img');
        return thumb?.complete && thumb.naturalWidth > 0;
      });
      await expect(page.locator('[data-masonry]')).not.toHaveAttribute('data-placed');

      const before = await cardBoxes(page);
      expect(before).toHaveLength(TOTAL);
      const firstRowLefts = new Set(before.map((box) => box.left));
      expect(firstRowLefts.size).toBe({ 1440: 5, 1100: 4, 768: 3, 390: 2 }[width]);

      release();
      await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });

      const after = await cardBoxes(page);
      after.forEach((box, index) => {
        expect(box.left).toBeCloseTo(before[index].left, 1);
        expect(box.top).toBeCloseTo(before[index].top, 1);
        expect(box.width).toBeCloseTo(before[index].width, 1);
        expect(box.height).toBeCloseTo(before[index].height, 1);
      });
      expect(errors).toEqual([]);
    });
  }

  test('キーの表示：Mac なら ⌘ K が最初から出る', async ({ page }) => {
    await page.addInitScript(pretendMac);
    await holdAppBundle(page);
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('kbd').getByText('⌘')).toBeVisible();
    await expect(page.locator('kbd').getByText('Ctrl')).toBeHidden();
  });

  test('キーの表示：Mac 以外なら Ctrl K が最初から出る', async ({ page }) => {
    await page.addInitScript(pretendWindows);
    await holdAppBundle(page);
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('kbd').getByText('Ctrl')).toBeVisible();
    await expect(page.locator('kbd').getByText('⌘')).toBeHidden();
  });

  test('幅768：文字の見本は最初から日本語', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await holdAppBundle(page);
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('article').first().waitFor();
    await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', 'UI、作品、作者をさがす');
  });
});

test.describe('チップと並びの項目は、React が届く前でも押せる', () => {
  test('チップを押すと /?c=web に移り、React が届くと絞られる', async ({ page }) => {
    const release = await holdAppBundle(page);
    await page.goto('/', { waitUntil: 'commit' });
    await page.getByRole('link', { name: 'Web', exact: true }).click();
    await expect(page).toHaveURL('/?c=web');

    release();
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
    await expect(page.locator('article')).toHaveCount(countWorks((work) => work.platform === 'web'));
    await expect(page.getByRole('link', { name: 'Web', exact: true })).toHaveAttribute('aria-current', 'true');
  });

  test('「新着」を押すと /?sort=new に移る', async ({ page }) => {
    const release = await holdAppBundle(page);
    await page.goto('/', { waitUntil: 'commit' });
    await page.getByRole('group', { name: '並び' }).getByRole('link', { name: '新着' }).click();
    await expect(page).toHaveURL('/?sort=new');

    release();
    await expect(page.locator('article h2').first()).toHaveText('Weather Glance');
  });
});

test.describe('JS を止めた状態', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  test('チップの Web を押すと /?c=web に移る', async ({ page }) => {
    await page.goto('/');
    const web = page.getByRole('link', { name: 'Web', exact: true });
    await expect(web).toHaveAttribute('href', '/?c=web');
    await web.click();
    await expect(page).toHaveURL('/?c=web');
  });

  test('「新着」を押すと /?sort=new に移る', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('group', { name: '並び' }).getByRole('link', { name: '新着' }).click();
    await expect(page).toHaveURL('/?sort=new');
  });

  test('選ばれた項目には、最初から aria-current が付いている', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'すべて', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('link', { name: 'Web', exact: true })).not.toHaveAttribute('aria-current');
  });
});

test.describe('React が載ったあと', () => {
  for (const { width, height } of sizes) {
    test(`幅${width}：ハイドレーションでエラーが出ない`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors = collectErrors(page);
      await openHome(page);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });
  }

  test('作り直さず、HTML の要素をそのまま使っている', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('article').first().waitFor();
    await page.evaluate(() => {
      document.querySelector('article')!.setAttribute('data-from-html', '');
    });
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
    await expect(page.locator('article').first()).toHaveAttribute('data-from-html');
  });

  test('操作が効く：チップ、検索', async ({ page }) => {
    await openHome(page);
    await page.getByRole('link', { name: 'モバイル', exact: true }).click();
    await expect(page.locator('article')).toHaveCount(countWorks((work) => work.platform === 'mobile'));
    await page.getByRole('searchbox').fill('trail');
    await expect(page.locator('article')).toHaveCount(1);
  });
});

test.describe('サムネイルの読み込みの順（SPEC 10）', () => {
  test('load までは先頭8枚だけ。load のあとで残りが始まる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.addEventListener('load', () => {
        const thumbs = performance.getEntriesByType('resource').filter((entry) => entry.name.endsWith('thumb.webp'));
        (window as unknown as { __atLoad: number }).__atLoad = thumbs.length;
      });
    });
    await openHome(page);
    await page.waitForFunction(() => document.readyState === 'complete');
    expect(await page.evaluate(() => (window as unknown as { __atLoad: number }).__atLoad)).toBe(8);

    await expect
      .poll(() => page.locator('article > a > img[src]').count())
      .toBe(TOTAL);

    const last = page.locator('article > a > img').last();
    await last.scrollIntoViewIfNeeded();
    await expect.poll(() => last.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  });

  test('先頭のサムネイルの通信が止まっても、5秒で残りが始まる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/seed-trail-guide/**/thumb.webp', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
    expect(await page.locator('article > a > img[src]').count()).toBe(8);

    await expect.poll(() => page.locator('article > a > img[src]').count(), { timeout: 8000 }).toBe(TOTAL);
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
    release();
  });

  test('まだ src のないカードにも、場所は取ってある', async ({ page }) => {
    await page.route('**/thumb.webp', (route) => route.abort());
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    const heights = await page.locator('article > a > img').evaluateAll((images) =>
      images.map((image) => image.getBoundingClientRect().height),
    );
    for (const height of heights) expect(height).toBeGreaterThan(50);
  });
});

test.describe('絞り込み付きの URL と、別のページ', () => {
  test('絞り込み付き：最初から絞った結果だけが出て、全件は一度も見えない', async ({ page }) => {
    await page.addInitScript(() => {
      const seen = { count: 0 };
      (window as unknown as { __seen: typeof seen }).__seen = seen;
      const check = () => {
        const root = document.getElementById('root');
        if (root && getComputedStyle(root).visibility === 'visible') {
          seen.count = Math.max(seen.count, document.querySelectorAll('article').length);
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    const expected = countWorks((work) => work.platform === 'web');
    await openHome(page, '/?c=web');
    await expect(page.locator('article')).toHaveCount(expected);
    expect(await page.evaluate(() => (window as unknown as { __seen: { count: number } }).__seen.count)).toBe(expected);
  });

  test('別のページ：ホームの中身が残らない', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/not-built');
    await expect(page.getByText('このページはありません')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);
    // 文書そのものが 404 なので、ブラウザがこの1行だけ出す。ほかのエラーは許さない
    expect(errors).toEqual(['Failed to load resource: the server responded with a status of 404 (Not Found)']);
  });

  test('作品のページへ行って戻ると、ホームが元どおり', async ({ page }) => {
    await openHome(page);
    await page.getByRole('link', { name: /^Trail Guide App/ }).click();
    await expect(page).toHaveURL('/p/seed-trail-guide');
    await page.goBack();
    await expect(page.locator('article')).toHaveCount(TOTAL);
  });
});

test.describe('一覧は HTML の中にある（SPEC 10）', () => {
  test('HTML に JSON で全件入っていて、ホームを開いてもブラウザで取り直さない。API は GET /api/me の1本だけ', async ({ page, request }) => {
    const html = await (await request.get('/?c=web')).text();
    const json = /<script type="application\/json" id="ld-works">([^<]*)<\/script>/.exec(html)![1];
    const works = JSON.parse(json);
    // 絞り込み付きの URL でも全件を埋め込む（ブラウザで絞り直すため）
    expect(works.map((work: { id: string }) => work.id)).toEqual(popularOrder());
    for (const work of works) {
      expect(work).not.toHaveProperty('liked');
      expect(work).not.toHaveProperty('bookmarked');
      expect(work).not.toHaveProperty('made_with'); // データとして持つが、公開しない（CLAUDE.md 原則9）
      expect(['person', 'label']).toContain(work.creator.kind);
    }

    const api: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) api.push(new URL(r.url()).pathname);
    });
    await openHome(page);
    await page.getByRole('link', { name: 'モバイル', exact: true }).click();
    await expect(page.locator('article')).toHaveCount(countWorks((work) => work.platform === 'mobile'));
    await page.waitForLoadState('networkidle');
    expect(api).toEqual(['/api/me']);
  });

  test('別のページからホームへ移ったときは、GET /api/works を1回だけ呼ぶ', async ({ page }) => {
    const api: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) api.push(new URL(r.url()).pathname);
    });
    await page.goto('/not-built');
    await page.getByRole('link', { name: 'ホーム' }).first().click();
    await expect(page.locator('article')).toHaveCount(TOTAL);
    await page.waitForLoadState('networkidle');
    expect(api).toEqual(['/api/me', '/api/works']);
  });
});

test.describe('Worker の並びと、ブラウザの並びが一致する（SPEC 0）', () => {
  // c、sort、q、type の組み合わせ10通り
  const combos = [
    '',
    'c=web',
    'sort=new',
    'type=component',
    'q=app',
    'c=mobile&sort=new',
    'c=web&q=landing',
    'c=minimal&sort=new&q=a',
    'type=component&sort=new&q=e',
    'c=dashboard&type=component',
  ];

  /** Worker が返した HTML のカードの id（カードのリンクの順）。 */
  const workerOrder = (html: string) => [...withoutNoscript(html).matchAll(/<article [^>]*><a [^>]*href="\/p\/([^"]+)"/g)].map((m) => m[1]);
  /** <noscript> の並びの id。 */
  const noscriptOrder = (html: string) =>
    [.../<noscript>([\s\S]*)<\/noscript>/.exec(html)?.[1].matchAll(/<a [^>]*href="\/p\/([^"]+)"/g) ?? []].map((m) => m[1]);

  for (const search of combos) {
    test(`?${search}`, async ({ page, request }) => {
      const html = await (await request.get(`/?${search}`)).text();
      const fromWorker = workerOrder(html);

      // 全件のホームを開き、ページを読み込み直さずに URL だけを変えて、ブラウザに絞らせる
      await openHome(page);
      await page.evaluate((next) => {
        (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
        window.history.pushState({}, '', next);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/?${search}`);
      await expect
        .poll(() => page.locator('article > a').evaluateAll((links) => links.map((a) => a.getAttribute('href')!.replace('/p/', ''))))
        .toEqual(fromWorker);
      expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);

      // 見本の答えとも、JS を止めたときの並びとも一致する
      expect(fromWorker).toEqual(popularOrder(search));
      expect(noscriptOrder(html)).toEqual(fromWorker);
    });
  }

  test('組み合わせの中に、絞られたものと空のものがある（テストが空回りしていない）', () => {
    const counts = combos.map((search) => popularOrder(search).length);
    expect(counts[0]).toBe(TOTAL);
    expect(counts.filter((count) => count > 0 && count < TOTAL).length).toBeGreaterThanOrEqual(8);
    expect(popularOrder('sort=new')).not.toEqual(popularOrder(''));
  });
});

test.describe('JS を止めたときの並び（SPEC 0）', () => {
  test.use({ javaScriptEnabled: false });

  test('/?c=web：Web の作品だけが、等幅のグリッドに同じ縦横比で出る。石組みは隠れる', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?c=web');
    const items = page.locator('noscript ul > li');
    await expect(items).toHaveCount(countWorks((work) => work.platform === 'web'));
    await expect(page.locator('[data-masonry]')).toBeHidden();
    expect(await page.locator('noscript ul > li a').evaluateAll((links) => links.map((a) => a.getAttribute('href')))).toEqual(
      popularOrder('c=web').map((id) => `/p/${id}`),
    );

    const boxes = await items.evaluateAll((list) => list.map((item) => item.getBoundingClientRect().toJSON()));
    expect(new Set(boxes.map((box) => box.width)).size).toBe(1);
    expect(new Set(boxes.map((box) => box.left)).size).toBe(5);
    const thumbs = await page.locator('noscript ul img').evaluateAll((images) =>
      images.map((image) => {
        const box = image.getBoundingClientRect();
        return Math.round((box.height / box.width) * 1000);
      }),
    );
    expect(new Set(thumbs)).toEqual(new Set([750]));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  for (const [width, columns] of [[1100, 4], [768, 3], [390, 2]] as const) {
    test(`幅${width}：${columns}列で、横にはみ出さない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const lefts = await page.locator('noscript ul > li').evaluateAll((list) => list.map((item) => item.getBoundingClientRect().left));
      expect(new Set(lefts).size).toBe(columns);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }
});
