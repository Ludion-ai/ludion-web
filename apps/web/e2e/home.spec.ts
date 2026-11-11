import { expect, test, type Page } from '@playwright/test';
import { cardBoxes, cardTitles, countWorks, openHome, pageOverflow, pretendMac, pretendWindows, TOTAL } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const FILTERS = 'カテゴリで絞り込む';
const PLACEHOLDER = 'UI、作品、作者をさがす';
const firstCard = (page: Page) => page.locator('article').first();

test.describe('幅1440の骨組み（SPEC 3）', () => {
  test('ヘッダー：検索欄は中央、右は「ダークモード」「メニュー」「ログイン」（T035）', async ({ page }) => {
    await openHome(page);
    const header = await page.locator('header').boundingBox();
    expect(header).toMatchObject({ x: 0, y: 0, width: 1440, height: 88 });

    const search = (await page.getByRole('searchbox').boundingBox())!;
    expect(search.height).toBe(44);
    expect(search.x + search.width / 2).toBeCloseTo(720, 0);
    expect(search.width).toBeCloseTo(1440 * 0.46, 0);

    const banner = page.getByRole('banner');
    await expect(banner.locator('a:visible')).toHaveCount(2); // ロゴとログイン
    // テストのデータにはスイッチの作品がないので、太陽と月のボタン。「…」のメニューはどの幅でも出る（T035「1」）
    await expect(banner.locator('button:visible')).toHaveCount(2);
    await expect(banner.getByRole('switch', { name: 'ダークモード' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'メニュー' })).toBeVisible();
    const login = (await banner.getByRole('link', { name: 'ログイン', exact: true }).boundingBox())!;
    expect(login.height).toBe(44);
    expect(login.x + login.width).toBe(1416); // グリッドの右端と揃う
    await expect(banner.getByRole('link', { name: 'ログイン', exact: true })).toHaveCSS('border-top-width', '0px');
  });

  test('サイドバー：幅68、46×46の3項目、間隔8。今いる項目だけ地がある。右の区切り線はない', async ({ page }) => {
    await openHome(page);
    const items = page.getByRole('complementary').getByRole('navigation', { name: 'メイン' }).getByRole('link');
    await expect(items).toHaveCount(3);
    const boxes = await Promise.all((await items.all()).map((item) => item.boundingBox()));
    boxes.forEach((box, index) => {
      expect(box).toMatchObject({ width: 46, height: 46, x: 11, y: 108 + index * 54 });
    });
    const sidebar = page.getByRole('complementary');
    expect((await sidebar.boundingBox())!.width).toBe(68);
    await expect(sidebar).toHaveCSS('box-shadow', 'none');
    await expect(sidebar).toHaveCSS('border-right-width', '0px');

    const backgrounds = await items.evaluateAll((links) => links.map((link) => getComputedStyle(link).backgroundColor));
    expect(backgrounds[0]).toBe('rgb(241, 241, 244)');
    expect(backgrounds.slice(1)).toEqual(Array(2).fill('rgba(0, 0, 0, 0)'));
  });

  test('サイドバーはスクロールしても動かない', async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => window.scrollTo(0, 600));
    const home = page.getByRole('complementary').getByRole('link', { name: 'ホーム' });
    // スクロールの直後は sticky の位置がまだ反映されていないことがあるので、落ち着くまで待つ
    await expect.poll(async () => (await home.boundingBox())!.y).toBe(20);
  });

  test('チップ9個は文字だけで、右端に小さく「人気」「新着」', async ({ page }) => {
    await openHome(page);
    const group = page.getByRole('group', { name: FILTERS });
    const chips = group.getByRole('link');
    await expect(chips).toHaveText(['すべて', 'Web', 'モバイル', 'ダッシュボード', 'EC', 'ミニマル', '実験', 'モーション', '壁紙']);
    await expect(group.locator('svg')).toHaveCount(0);
    const boxes = await Promise.all((await chips.all()).map((chip) => chip.boundingBox()));
    expect(boxes[0]!.x).toBe(92);
    for (const box of boxes) expect(box!.y).toBe(101);

    const styles = await chips.evaluateAll((list) =>
      list.map((chip) => {
        const style = getComputedStyle(chip);
        return { border: style.borderTopWidth, shadow: style.boxShadow, bg: style.backgroundColor, color: style.color, radius: style.borderRadius };
      }),
    );
    expect(styles[0]).toEqual({ border: '0px', shadow: 'none', bg: 'rgb(22, 22, 29)', color: 'rgb(255, 255, 255)', radius: '999px' });
    expect(styles[1]).toEqual({ border: '0px', shadow: 'none', bg: 'rgba(0, 0, 0, 0)', color: 'rgb(17, 17, 20)', radius: '999px' });

    const sort = page.getByRole('group', { name: '並び' });
    await expect(sort.getByRole('link')).toHaveText(['人気', '新着']);
    const sortBox = (await sort.boundingBox())!;
    expect(sortBox.y + sortBox.height / 2).toBe(boxes[0]!.y + boxes[0]!.height / 2);
    expect(sortBox.x + sortBox.width).toBe(1416);
    await expect(page.getByText('Sort:')).toHaveCount(0);
  });

  test('グリッド：幅1440は5列、各252、間隔16、左右24', async ({ page }) => {
    await openHome(page);
    const boxes = await cardBoxes(page);
    expect(boxes).toHaveLength(TOTAL);
    const lefts = [...new Set(boxes.map((box) => box.left))].sort((a, b) => a - b);
    expect(lefts).toEqual([92, 360, 628, 896, 1164]);
    for (const box of boxes) expect(box.width).toBe(252);
    expect(Math.min(...boxes.map((box) => box.top))).toBe(155);
  });

  test('書体：日本語はシステムの書体に任せ、見出しは palt', async ({ page }) => {
    await openHome(page);
    const styles = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      font: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector('h1')!).fontFeatureSettings,
    }));
    expect(styles.lang).toBe('ja');
    expect(styles.font).toBe('"Inter Variable", "Hiragino Sans", "Noto Sans JP", "BIZ UDPGothic", "Yu Gothic UI", system-ui, sans-serif');
    expect(styles.heading).toBe('"palt"');
  });

  test('日本語の書体をダウンロードしない', async ({ page }) => {
    const fonts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'font') fonts.push(new URL(request.url()).pathname);
    });
    await openHome(page);
    await page.waitForLoadState('networkidle');
    expect(fonts.filter((font) => !/inter/i.test(font))).toEqual([]);
  });

  test('Inter が読み込まれている', async ({ page }) => {
    await openHome(page);
    expect(await page.evaluate(() => document.fonts.check('600 14px "Inter Variable"'))).toBe(true);
  });
});

test.describe('石組み（SPEC 6）', () => {
  for (const width of [1440, 1100, 800, 390]) {
    test(`幅${width}：並び順に、いちばん低い列へ置いている`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      const boxes = await cardBoxes(page);
      const lefts = [...new Set(boxes.map((box) => box.left))].sort((a, b) => a - b);
      const bottoms = new Map(lefts.map((left) => [left, 0]));
      const gap = width <= 767 ? 8 : 16;

      for (const box of boxes) {
        const lowest = Math.min(...bottoms.values());
        // 画面の座標は 1/64px に丸められるので、同じ高さの列は 0.1px の差まで同じとみなす
        const expectedLeft = lefts.find((left) => bottoms.get(left)! <= lowest + 0.1);
        expect(box.left).toBe(expectedLeft);
        bottoms.set(box.left, box.bottom + gap);
      }
    });
  }

  test('1枚目から5枚目は左上から右へ並ぶ', async ({ page }) => {
    await openHome(page);
    const boxes = (await cardBoxes(page)).slice(0, 5);
    expect(boxes.map((box) => box.left)).toEqual([92, 360, 628, 896, 1164]);
  });

  test('画像の読み込みを待たずに置き、読み込んでもカードが動かない', async ({ page }) => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/thumb.webp', async (route) => {
      await blocked;
      await route.continue();
    });
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
    const before = await cardBoxes(page);
    expect(before).toHaveLength(TOTAL);

    release();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLImageElement>('article img[loading=eager]')].every((img) => img.complete),
    );
    expect(await cardBoxes(page)).toEqual(before);
  });

  test('カードの高さは絵の高さだけで、列の中の間隔が揃う', async ({ page }) => {
    for (const width of [1440, 1100, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      const gap = width <= 767 ? 8 : 16;
      const boxes = await cardBoxes(page);
      for (const left of new Set(boxes.map((box) => box.left))) {
        const column = boxes.filter((box) => box.left === left);
        for (let i = 1; i < column.length; i += 1) {
          expect(column[i].top - column[i - 1].bottom, `幅${width}`).toBeCloseTo(gap, 0);
        }
      }
      const difference = await page.locator('article').evaluateAll((cards) =>
        Math.max(...cards.map((card) => Math.abs(card.getBoundingClientRect().height - card.querySelector('img')!.getBoundingClientRect().height))),
      );
      expect(difference, `幅${width}`).toBeLessThan(0.1);
    }
  });

  test('サムネイル：width と height、先頭8枚は eager、1枚目だけ fetchpriority=high、読み込み中の地（SPEC 10）', async ({ page }) => {
    await openHome(page);
    const thumbs = await page.locator('article > a > img').evaluateAll((images) =>
      images.map((image) => ({
        width: image.getAttribute('width'),
        height: image.getAttribute('height'),
        loading: image.getAttribute('loading'),
        priority: image.getAttribute('fetchpriority'),
        fit: getComputedStyle(image).objectFit,
        position: getComputedStyle(image).objectPosition,
        background: getComputedStyle(image).backgroundColor,
      })),
    );
    expect(thumbs).toHaveLength(TOTAL);
    thumbs.forEach((thumb, index) => {
      expect(Number(thumb.width)).toBe(800);
      expect(Number(thumb.height)).toBeGreaterThan(0);
      expect(thumb.loading).toBe(index < 8 ? 'eager' : 'lazy');
      expect(thumb.priority).toBe(index === 0 ? 'high' : null);
      expect(thumb.fit).toBe('cover');
      expect(thumb.position).toBe('50% 0%');
      expect(thumb.background).toBe('rgb(244, 244, 246)');
    });
  });
});

/** 並びのカードの中で「見えているもの」を集める。opacity 0、display none、1px に切られたものは見えていない。 */
function visibleInCards() {
  const hidden = (element: Element): boolean => {
    for (let node: Element | null = element; node && node.tagName !== 'ARTICLE'; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.opacity === '0' || style.clipPath !== 'none' || style.clip === 'rect(0px, 0px, 0px, 0px)') return true;
    }
    return false;
  };
  const found = { borders: 0, shadows: 0, surfaces: 0, icons: 0, text: [] as string[], images: 0 };
  for (const card of document.querySelectorAll('article')) {
    for (const element of [card, ...card.querySelectorAll('*')]) {
      if (hidden(element)) continue;
      const style = getComputedStyle(element);
      if (['Top', 'Right', 'Bottom', 'Left'].some((side) => style[`border${side}Width` as 'borderTopWidth'] !== '0px')) found.borders += 1;
      if (style.boxShadow !== 'none') found.shadows += 1;
      // 読み込み中の地は絵の中のものなので除く
      if (element.tagName !== 'IMG' && (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none')) found.surfaces += 1;
      if (element.tagName.toLowerCase() === 'svg') found.icons += 1;
      if (element.tagName === 'IMG') found.images += 1;
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) found.text.push(child.textContent.trim());
      }
    }
  }
  return found;
}

test.describe('カードは絵だけ（SPEC 3）', () => {
  for (const { width, height } of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    test(`幅${width}：並びに、枠線、影、面、題名、アイコン、数が1つもない`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openHome(page);
      expect(await page.evaluate(visibleInCards)).toEqual({ borders: 0, shadows: 0, surfaces: 0, icons: 0, text: [], images: TOTAL });
    });
  }

  test('サムネイルは角丸16px。縦横比は作品ごと', async ({ page }) => {
    await openHome(page);
    await expect(firstCard(page).locator('> a')).toHaveCSS('border-radius', '16px');
    const ratios = await page.locator('article').evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect();
        return Math.round((box.height / box.width) * 100);
      }),
    );
    expect(new Set(ratios).size).toBeGreaterThan(5);
  });

  test('押すと作品のページへ。リンクの中にボタンを入れない', async ({ page }) => {
    await openHome(page);
    await expect(firstCard(page).locator('a button')).toHaveCount(0);
    await firstCard(page).locator('> a > img').click();
    await expect(page).toHaveURL('/p/seed-portfolio-landing');
  });

  test('題名と作者は、スマホでも読み上げには残る', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    const card = firstCard(page);
    await expect(card).toHaveAccessibleName('Studio Portfolio Landing');
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('Studio Portfolio Landing');
    await expect(card.getByRole('link')).toHaveAccessibleName('Studio Portfolio Landing @seed_a');
  });

  test('いいねは数を出さず、カードでは押せない（SPEC 4）', async ({ page }) => {
    await openHome(page);
    await expect(firstCard(page).getByRole('button')).toHaveCount(1);
    await expect(page.locator('article svg')).toHaveCount(0);
  });
});

/** 重ねるものが出ているか。 */
async function overlayState(page: Page, index = 0) {
  return page.locator('article').nth(index).evaluate((card) => {
    const opacity = (selector: string) => {
      const element = card.querySelector(selector)!;
      return getComputedStyle(element.closest('.card-scrim') ?? element.parentElement!).opacity;
    };
    return {
      scrim: getComputedStyle(card.querySelector('.card-scrim')!).opacity,
      title: opacity('h2'),
      save: getComputedStyle(card.querySelector('button')!).opacity,
    };
  });
}
const SHOWN = { scrim: '1', title: '1', save: '1' };
const HIDDEN = { scrim: '0', title: '0', save: '0' };

test.describe('カーソルとフォーカスで重ねるもの（SPEC 3）', () => {
  test('カーソルを乗せると、下の方が暗くなり、題名と @作者 と、右上に保存が出る', async ({ page }) => {
    await openHome(page);
    const card = firstCard(page);
    expect(await overlayState(page)).toEqual(HIDDEN);

    await card.hover();
    await expect.poll(() => overlayState(page)).toEqual(SHOWN);

    await expect(card.locator('h2')).toHaveText('Studio Portfolio Landing');
    await expect(card.locator('p')).toHaveText('@seed_a');
    const save = card.getByRole('button', { name: 'Studio Portfolio Landingを保存' });
    await expect(save).toHaveText('保存');
    await expect(save).toHaveAttribute('aria-pressed', 'false');

    const cardBox = (await card.boundingBox())!;
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.x + saveBox.width).toBe(cardBox.x + cardBox.width - 8);
    expect(saveBox.y).toBe(cardBox.y + 8);
    // 題名は絵の下の方
    const titleBox = (await card.locator('h2').boundingBox())!;
    expect(titleBox.y).toBeGreaterThan(cardBox.y + cardBox.height / 2);
    // 絵は拡大しない
    const thumb = (await card.locator('img').boundingBox())!;
    expect(thumb.width).toBe(cardBox.width);
    expect(thumb.height).toBeCloseTo(cardBox.height, 1);

    await page.mouse.move(0, 0);
    await expect.poll(() => overlayState(page)).toEqual(HIDDEN);
  });

  test('キーボードでカードにフォーカスしても、同じものが出る', async ({ page }) => {
    await openHome(page);
    await page.getByRole('group', { name: '並び' }).getByRole('link', { name: '新着' }).focus();

    await page.keyboard.press('Tab');
    const link = firstCard(page).locator('> a');
    await expect(link).toBeFocused();
    await expect.poll(() => overlayState(page)).toEqual(SHOWN);

    await page.keyboard.press('Tab');
    await expect(firstCard(page).getByRole('button')).toBeFocused();
    await expect.poll(() => overlayState(page)).toEqual(SHOWN);

    await page.keyboard.press('Tab');
    await expect(page.locator('article').nth(1).locator('> a')).toBeFocused();
    await expect.poll(() => overlayState(page, 1)).toEqual(SHOWN);
    await expect.poll(() => overlayState(page)).toEqual(HIDDEN);
  });

  test('暗くした下の方の濃さは、白い絵の上でも白い文字が読める', async ({ page }) => {
    await openHome(page);
    await expect(firstCard(page).locator('.card-scrim')).toHaveCSS('background-image', /rgba\(0, 0, 0, 0\.64\) 52px/);
    // 白の上に黒 64% を重ねた地（#5C5C5C）と白い文字のコントラストは約 6.9 で、4.5 を超える
    const channel = 255 * (1 - 0.64);
    const linear = ((channel / 255 + 0.055) / 1.055) ** 2.4;
    expect((1 + 0.05) / (linear + 0.05)).toBeGreaterThan(4.5);
  });

  test('保存の押す前の形', async ({ page }) => {
    await openHome(page);
    const button = page.getByRole('button', { name: 'Trail Guide Appを保存' });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toHaveText('保存');
  });

  test('幅390：カーソルを乗せても何も重ねない。保存のボタンは Tab でも入らない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    await firstCard(page).hover();
    await page.waitForTimeout(250);
    expect(await page.evaluate(visibleInCards)).toEqual({ borders: 0, shadows: 0, surfaces: 0, icons: 0, text: [], images: TOTAL });
    await expect(firstCard(page).getByRole('button')).toHaveCount(0);

    await firstCard(page).locator('> a').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('article').nth(1).locator('> a')).toBeFocused();
    expect(await page.evaluate(visibleInCards)).toEqual({ borders: 0, shadows: 0, surfaces: 0, icons: 0, text: [], images: TOTAL });
  });
});

test.describe('触る画面の広い幅', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true });

  test('見えない保存のボタンを押してしまわない', async ({ page }) => {
    await openHome(page);
    await expect(firstCard(page).getByRole('button')).toHaveCSS('pointer-events', 'none');
    const box = (await firstCard(page).getByRole('button').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL('/p/seed-portfolio-landing');
  });
});

test.describe('チップ（SPEC 4）', () => {
  const hasTag = (tag: string) => countWorks((work) => work.tags.includes(tag));
  const cases: [string, string | null, number][] = [
    ['Web', 'web', countWorks((work) => work.platform === 'web')],
    ['モバイル', 'mobile', countWorks((work) => work.platform === 'mobile')],
    ['ダッシュボード', 'dashboard', hasTag('dashboard')],
    ['EC', 'ecommerce', hasTag('ecommerce')],
    ['ミニマル', 'minimal', hasTag('minimal')],
    ['実験', 'experimental', hasTag('experimental')],
    ['モーション', 'motion', hasTag('motion')], // seed にはないので 0。作品が出ることは upload.spec.ts で確かめる
    ['壁紙', 'wallpaper', countWorks((work) => work.subtype === 'Wallpaper')], // seed にはないので 0。作品が出ることは wallpaper.pages.spec.ts で確かめる
  ];

  for (const [label, param, count] of cases) {
    test(`${label} → ?c=${param}、${count}作品。選べるのは1つだけ`, async ({ page }) => {
      await openHome(page);
      await page.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(`/?c=${param}`);
      await expect(page.locator('article')).toHaveCount(count);

      const current = page.getByRole('group', { name: FILTERS }).locator('[aria-current=true]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(label);

      await page.getByRole('link', { name: 'すべて', exact: true }).click();
      await expect(page).toHaveURL('/');
      await expect(page.locator('article')).toHaveCount(TOTAL);
    });
  }

  test('URL から開くと、そのチップが選ばれている', async ({ page }) => {
    await openHome(page, '/?c=mobile');
    await expect(page.getByRole('link', { name: 'モバイル', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('article')).toHaveCount(countWorks((work) => work.platform === 'mobile'));
  });

  test('チップと並びの項目はリンクで、ほかの絞り込みを保つ', async ({ page }) => {
    await openHome(page, '/?q=landing&sort=new');
    await expect(page.getByRole('link', { name: 'Web', exact: true })).toHaveAttribute(
      'href',
      '/?q=landing&sort=new&c=web',
    );
    await expect(page.getByRole('link', { name: 'すべて', exact: true })).toHaveAttribute('href', '/?q=landing&sort=new');

    const sort = page.getByRole('group', { name: '並び' });
    await expect(sort.getByRole('link', { name: '人気' })).toHaveAttribute('href', '/?q=landing');
    await expect(sort.getByRole('link', { name: '新着' })).toHaveAttribute('href', '/?q=landing&sort=new');
  });

  test('選ばれた項目には aria-current="true"。aria-pressed は使わない', async ({ page }) => {
    await openHome(page, '/?c=web&sort=new');
    await expect(page.getByRole('link', { name: 'Web', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('link', { name: 'すべて', exact: true })).not.toHaveAttribute('aria-current');
    const sort = page.getByRole('group', { name: '並び' });
    await expect(sort.getByRole('link', { name: '新着' })).toHaveAttribute('aria-current', 'true');
    await expect(sort.getByRole('link', { name: '人気' })).not.toHaveAttribute('aria-current');
    await expect(page.getByRole('group', { name: FILTERS }).locator('[aria-pressed]')).toHaveCount(0);
    await expect(sort.locator('[aria-pressed]')).toHaveCount(0);
  });

  for (const [width, currents] of [[1440, 2], [390, 1]] as const) {
    test(`幅${width}：aria-current="page" は今いる移動の項目の1つだけ`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openHome(page);
      const current = page.locator('[aria-current=page]:visible');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAccessibleName('ホーム');
      // チップと、広い画面では並びの切り替え
      await expect(page.locator('[aria-current=true]:visible')).toHaveCount(currents);
    });
  }

  test('チップを押してもページは読み込み直さない（JS が届いたあと）', async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    await page.getByRole('link', { name: 'Web', exact: true }).click();
    await expect(page).toHaveURL('/?c=web');
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
  });

  test('チップを選んでも幅が変わらない（並びが跳ねない）', async ({ page }) => {
    await openHome(page);
    const chips = page.getByRole('group', { name: FILTERS }).getByRole('link');
    const before = await chips.evaluateAll((list) => list.map((chip) => chip.getBoundingClientRect().x));
    await page.getByRole('link', { name: 'Web', exact: true }).click();
    const after = await chips.evaluateAll((list) => list.map((chip) => chip.getBoundingClientRect().x));
    expect(after).toEqual(before);
  });
});

test.describe('並び（SPEC 4）', () => {
  test('既定は人気。新着で ?sort=new。戻すと消える', async ({ page }) => {
    await openHome(page);
    expect((await cardTitles(page)).slice(0, 3)).toEqual([
      'Studio Portfolio Landing',
      'Trail Guide App',
      'Revenue Overview',
    ]);

    const sort = page.getByRole('group', { name: '並び' });
    await sort.getByRole('link', { name: '新着' }).click();
    await expect(page).toHaveURL('/?sort=new');
    await expect(page.locator('article h2').first()).toHaveText('Weather Glance');

    await sort.getByRole('link', { name: '人気' }).click();
    await expect(page).toHaveURL('/');
  });

  test('並びとチップは同時に効く', async ({ page }) => {
    await openHome(page, '/?c=web&sort=new');
    await expect(page.locator('article h2').first()).toHaveText('Studio Portfolio Landing');
    await expect(page.locator('article')).toHaveCount(countWorks((work) => work.platform === 'web'));
  });
});

test.describe('検索（SPEC 4）', () => {
  test('入力から150ms後に絞り、?q= に入れる', async ({ page }) => {
    await openHome(page);
    const input = page.getByRole('searchbox');
    await input.pressSequentially('trail');
    expect(page.url()).not.toContain('q='); // 打った直後はまだ反映しない
    await expect(page).toHaveURL('/?q=trail');
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article h2')).toHaveText('Trail Guide App');
  });

  test('連打のあいだは1回も反映しない', async ({ page }) => {
    await openHome(page);
    const urls: string[] = [];
    page.on('framenavigated', (frame) => urls.push(frame.url()));
    await page.getByRole('searchbox').pressSequentially('seed_c', { delay: 30 });
    await expect(page).toHaveURL('/?q=seed_c');
    expect(urls.filter((url) => url.includes('q='))).toHaveLength(1);
  });

  test('チップと一緒に効き、URL を開き直しても同じ結果になる', async ({ page }) => {
    const expected = countWorks((work) => work.platform === 'mobile' && work.creator.handle === 'seed_b');
    await openHome(page, '/?c=mobile');
    await page.getByRole('searchbox').fill('seed_b');
    await expect(page).toHaveURL('/?c=mobile&q=seed_b');
    await expect(page.locator('article')).toHaveCount(expected);

    await page.reload();
    await expect(page.getByRole('searchbox')).toHaveValue('seed_b');
    await expect(page.locator('article')).toHaveCount(expected);
  });

  test('何も見つからないとき：文言と「条件をはずす」', async ({ page }) => {
    await page.goto('/?c=web&q=zzzz&sort=new');
    await expect(page.getByText('「zzzz」の作品が見つかりません')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);

    await page.getByRole('button', { name: '条件をはずす' }).click();
    await expect(page).toHaveURL('/?sort=new'); // 並びは絞り込みではないので残す
    await expect(page.locator('article')).toHaveCount(TOTAL);
    await expect(page.getByRole('searchbox')).toHaveValue('');
  });

  test('検索語なしで0件のときも、文言が崩れない', async ({ page }) => {
    await page.goto('/?c=ecommerce&type=component');
    await expect(page.getByText('作品が見つかりません', { exact: true })).toBeVisible();
  });

  test('戻るボタンでチップが戻り、検索欄も URL に揃う', async ({ page }) => {
    await openHome(page);
    await page.getByRole('link', { name: 'Web', exact: true }).click();
    await expect(page).toHaveURL('/?c=web');
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(page.locator('article')).toHaveCount(TOTAL);
  });

  test('ほかのページで検索すると、ホームへ行って絞る', async ({ page }) => {
    await page.goto('/p/seed-trail-guide');
    await page.getByRole('searchbox').fill('film');
    await expect(page).toHaveURL('/?q=film');
    await expect(page.locator('article h2')).toHaveText('Film Catalog');
  });
});

test.describe('⌘K／Ctrl+K（SPEC 1、4）', () => {
  for (const shortcut of ['Control+k', 'Meta+k']) {
    test(`${shortcut} で検索欄へ、Esc で外れる`, async ({ page }) => {
      await openHome(page);
      const input = page.getByRole('searchbox');
      await page.keyboard.press(shortcut);
      await expect(input).toBeFocused();

      await input.pressSequentially('film');
      await page.keyboard.press('Escape');
      await expect(input).not.toBeFocused();
      await expect(input).toHaveValue('film'); // type="search" の既定の消去を止めている
    });
  }

  test('キーの表示：Mac 以外は Ctrl K', async ({ page }) => {
    await page.addInitScript(pretendWindows);
    await openHome(page);
    await expect(page.locator('kbd').getByText('Ctrl')).toBeVisible();
    await expect(page.locator('kbd').getByText('⌘')).toBeHidden();
  });

  test('キーの表示：Mac は ⌘ K', async ({ page }) => {
    await page.addInitScript(pretendMac);
    await openHome(page);
    await expect(page.locator('kbd').getByText('⌘')).toBeVisible();
    await expect(page.locator('kbd').getByText('Ctrl')).toBeHidden();
  });
});

test.describe('サイドバー（SPEC 3、4）', () => {
  test('行き先と、今いる項目', async ({ page }) => {
    await openHome(page);
    const nav = page.getByRole('complementary');
    await nav.getByRole('link', { name: '探す' }).click();
    await expect(page).toHaveURL('/?sort=new');
    await expect(nav.getByRole('link', { name: '探す' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'ホーム' })).not.toHaveAttribute('aria-current', 'page');

    // 保存は要ログイン。偽の GitHub でログインして戻ってくる（e2e/accounts.spec.ts）
    await nav.getByRole('link', { name: '保存' }).click();
    await page.getByRole('link', { name: 'GitHub でログイン' }).click();
    await expect(page).toHaveURL('/account/saved');
    await expect(page.getByText('まだ何も保存していません')).toBeVisible();

    await nav.getByRole('link', { name: 'ホーム' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('article')).toHaveCount(TOTAL);
  });

  test('項目を消しても、部品だけの URL（?type=component）は動く', async ({ page }) => {
    await openHome(page, '/?type=component');
    await expect(page.locator('article')).toHaveCount(countWorks((work) => work.type === 'component'));
  });

  test('ツールチップは hover で右に出る', async ({ page }) => {
    await openHome(page);
    const link = page.getByRole('complementary').getByRole('link', { name: '探す' });
    const tip = link.locator('span');
    await expect(tip).toHaveText('探す');
    await expect(tip).toHaveCSS('opacity', '0');
    await link.hover();
    await expect(tip).toHaveCSS('opacity', '1');
    const tipBox = (await tip.boundingBox())!;
    const linkBox = (await link.boundingBox())!;
    expect(tipBox.x).toBeGreaterThanOrEqual(linkBox.x + linkBox.width);
  });
});

test.describe('ヘッダーのリンク（SPEC 4）', () => {
  test('ログインはログインの画面へのリンク', async ({ page }) => {
    await openHome(page);
    const href = `/login?next=${encodeURIComponent('/')}`;
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toHaveAttribute('href', href);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Sign up' })).toHaveCount(0);
  });
});

test.describe('画面幅ごとの形（SPEC 5）', () => {
  const shapes = [
    { width: 2560, columns: 10, gap: 16, sidebar: true },
    { width: 1920, columns: 7, gap: 16, sidebar: true },
    { width: 1440, columns: 5, gap: 16, sidebar: true },
    { width: 1280, columns: 5, gap: 16, sidebar: true },
    { width: 1279, columns: 5, gap: 16, sidebar: true },
    { width: 1024, columns: 4, gap: 16, sidebar: true },
    { width: 1023, columns: 4, gap: 16, sidebar: false },
    { width: 768, columns: 3, gap: 16, sidebar: false },
    { width: 767, columns: 2, gap: 8, sidebar: false },
    { width: 390, columns: 2, gap: 8, sidebar: false },
  ];

  for (const { width, columns, gap, sidebar } of shapes) {
    test(`幅${width}：${columns}列、間隔${gap}、${sidebar ? 'サイドバー' : '下のタブ'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      const boxes = await cardBoxes(page);
      const lefts = [...new Set(boxes.map((box) => box.left))].sort((a, b) => a - b);
      expect(lefts).toHaveLength(columns);
      expect(lefts[1] - lefts[0] - boxes[0].width).toBeCloseTo(gap, 5);
      // 広い画面の列の幅は約240px
      if (width >= 768) {
        expect(boxes[0].width).toBeGreaterThan(200);
        expect(boxes[0].width).toBeLessThan(280);
      }

      await expect(page.getByRole('complementary')).toBeVisible({ visible: sidebar });
      const tabs = page.locator('nav.fixed');
      await expect(tabs).toBeVisible({ visible: !sidebar });
      expect(await pageOverflow(page)).toBe(0);
    });
  }

  test('スマホ：2列、左右の余白8、列の間も縦も8', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    const boxes = await cardBoxes(page);
    const lefts = [...new Set(boxes.map((box) => box.left))].sort((a, b) => a - b);
    expect(lefts).toEqual([8, 199]);
    expect(boxes[0].width).toBe(183);
    expect(Math.max(...boxes.map((box) => box.right))).toBe(382);
  });

  for (const width of [390, 768, 1023]) {
    test(`幅${width}：下のタブは、画面の下の中央に浮いた3つのボタン。中身はその下を流れる`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      const tabs = page.locator('nav.fixed');
      const items = tabs.getByRole('link');
      await expect(items).toHaveCount(3);
      await expect(tabs).toHaveCSS('border-top-width', '0px');
      await expect(tabs).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

      const boxes = await Promise.all((await items.all()).map((item) => item.boundingBox()));
      for (const box of boxes) {
        expect(box).toMatchObject({ width: 48, height: 48 });
        expect(box!.y + box!.height).toBe(900 - 16);
      }
      expect(boxes[1]!.x - boxes[0]!.x).toBe(48 + 8);
      expect(boxes[1]!.x + 24).toBe(width / 2);

      const style = await items.first().evaluate((item) => {
        const { backgroundColor, backdropFilter, borderRadius } = getComputedStyle(item);
        return { backgroundColor, backdropFilter, borderRadius };
      });
      expect(style.backgroundColor).toBe('rgba(38, 38, 44, 0.78)');
      expect(style.backdropFilter).toContain('blur');
      expect(style.borderRadius).toBe('14px');

      // ボタンの間はカードを押せる（帯が中身を覆わない）
      const between = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('nav') ?? null, [boxes[0]!.x + 52, boxes[0]!.y + 24]);
      expect(between).toBeNull();
    });
  }

  for (const width of [320, 360, 390, 430, 600, 767, 768, 900, 1023, 1024, 1100, 1279, 1280, 1440, 1920, 2560]) {
    test(`幅${width}：横スクロールが出ない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      expect(await pageOverflow(page)).toBe(0);
      // 空の結果でも出ない
      await page.goto('/?q=zzzz');
      await expect(page.getByRole('button', { name: '条件をはずす' })).toBeVisible();
      expect(await pageOverflow(page)).toBe(0);
    });
  }

  test('検索欄は中央にあり、ロゴにも右のボタンにも重ならない', async ({ page }) => {
    for (const width of [768, 900, 1023, 1024, 1100, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      const search = (await page.getByRole('searchbox').boundingBox())!;
      const action = (await page.getByRole('link', { name: 'ログイン', exact: true }).boundingBox())!;
      const logo = (await page.getByRole('link', { name: 'Ludion' }).boundingBox())!;
      expect(search.x + search.width, `幅${width}`).toBeLessThanOrEqual(action.x);
      expect(logo.x + logo.width, `幅${width}`).toBeLessThanOrEqual(search.x);
      expect(search.x + search.width / 2, `幅${width}`).toBeCloseTo(width / 2, 0);
    }
  });

  test.describe('文字の見本', () => {
    for (const width of [768, 1024, 1440]) {
      test(`幅${width}：どの幅でも同じ文で、切れずに入る`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openHome(page);
        await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', PLACEHOLDER);
        const { fits } = await page.getByRole('searchbox').evaluate((input: HTMLInputElement) => {
          const style = getComputedStyle(input);
          const context = document.createElement('canvas').getContext('2d')!;
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return { fits: context.measureText(input.placeholder).width <= room };
        });
        expect(fits).toBe(true);
      });
    }

    test('幅390：開いた検索欄の文字の見本も同じ文', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openHome(page);
      await page.getByRole('button', { name: '検索を開く' }).click();
      await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', PLACEHOLDER);
    });
  });

  test.describe('767px以下のヘッダー', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('左に Ludion、右にダークモード、検索のボタン、メニューのボタン、「ログイン」の文字だけ', async ({ page }) => {
      await openHome(page);
      const banner = page.getByRole('banner');
      await expect(banner.getByRole('link', { name: 'Ludion' })).toBeVisible();
      await expect(banner.getByRole('button', { name: '検索を開く' })).toBeVisible();
      const login = banner.getByRole('link', { name: 'ログイン', exact: true });
      await expect(login).toBeVisible();
      await expect(login).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(banner.locator('a:visible')).toHaveCount(2);
      await expect(banner.getByRole('button', { name: 'メニュー' })).toBeVisible();
      await expect(banner.getByRole('switch', { name: 'ダークモード' })).toBeVisible();
      await expect(banner.locator('button:visible')).toHaveCount(3);
      await expect(page.getByRole('searchbox')).toBeHidden();
    });

    test('アイコンで検索欄が開き、絞り込め、閉じると元に戻る', async ({ page }) => {
      await openHome(page);
      const open = page.getByRole('button', { name: '検索を開く' });
      await open.click();
      const input = page.getByRole('searchbox');
      await expect(input).toBeFocused();

      await input.fill('film');
      await expect(page).toHaveURL('/?q=film');
      await expect(page.locator('article')).toHaveCount(1);

      await page.getByRole('button', { name: '検索を閉じる' }).click();
      await expect(input).toBeHidden();
      await expect(page).toHaveURL('/');
      await expect(page.locator('article')).toHaveCount(TOTAL);
      await expect(open).toBeFocused();
    });

    test('Ctrl+K でも開く。空のまま Esc で閉じる', async ({ page }) => {
      await openHome(page);
      await page.keyboard.press('Control+k');
      const input = page.getByRole('searchbox');
      await expect(input).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(input).toBeHidden();
      await expect(page.getByRole('button', { name: '検索を開く' })).toBeFocused();
    });

    test('?q= 付きで開くと、検索欄は開いている', async ({ page }) => {
      await openHome(page, '/?q=film');
      await expect(page.getByRole('searchbox')).toHaveValue('film');
      await expect(page.getByRole('searchbox')).toBeVisible();
    });

    test('チップは横にスクロールし、スクロールの線は出さず、ページは動かない', async ({ page }) => {
      await openHome(page);
      const group = page.getByRole('group', { name: FILTERS });
      const scroll = await group.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflowX: getComputedStyle(element).overflowX,
        scrollbar: getComputedStyle(element).scrollbarWidth,
        barHeight: (element as HTMLElement).offsetHeight - element.clientHeight,
      }));
      expect(scroll.overflowX).toBe('auto');
      expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
      expect(scroll.scrollbar).toBe('none');
      expect(scroll.barHeight).toBe(0);

      await page.getByRole('link', { name: 'モーション', exact: true }).scrollIntoViewIfNeeded();
      expect(await group.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      expect(await pageOverflow(page)).toBe(0);
    });

    test('並びの切り替えは出さない。新着は下のタブの「探す」から', async ({ page }) => {
      await openHome(page);
      await expect(page.getByRole('group', { name: '並び' })).toBeHidden();
      await page.locator('nav.fixed').getByRole('link', { name: '探す' }).click();
      await expect(page).toHaveURL('/?sort=new');
      await expect(page.locator('article h2').first()).toHaveText('Weather Glance');
    });
  });
});
