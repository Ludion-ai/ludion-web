// T035：ライトとダーク、ヘッダーのスイッチ、左下のリンク（docs/tasks/T035.md）。
// 名前の .pages.spec.ts で、作品のページのテストのサーバー（playwright.config.ts の pages。fixtures/ の見本が入っている）で動く。
// テストのデータには toggle-* がないので、スイッチの作品は fx-toggle に固定する（window.__ldThemeSwitch）。
// fx-toggle の最初の [role="switch"]（Wi-Fi）は aria-checked="true" から始まる。
import { expect, test, type Frame, type Page } from '@playwright/test';
import { join } from 'node:path';
import { copy } from '../src/copy';
import { pickThemeSwitch, THEME_SWITCH_IDS } from '../src/lib/themeSwitches';

const SWITCH_FRAME = 'iframe[data-ld-switch-frame]';
const WORK = 'fx-toggle';
const text = copy.themeSwitch;

type Log = { atBody: string | null; atFirstFrame: string | null; changes: (string | null)[]; switchChanges: string[] };

/**
 * 親のページ：<html data-theme> の変化と、<body> ができたとき（最初の描画より前）と最初の requestAnimationFrame の値を記録する。
 * 枠の中：最初の [role="switch"] の aria-checked の変化を記録する（init script はどの枠でも動く）。
 */
async function record(page: Page, forced: string | null = WORK) {
  await page.addInitScript((pick) => {
    const log: Log = { atBody: null, atFirstFrame: null, changes: [], switchChanges: [] };
    Object.defineProperty(window, '__ldLog', { value: log });
    if (window !== window.top) {
      addEventListener('DOMContentLoaded', () => {
        const host = document.getElementById('ld-host');
        const button = host?.shadowRoot?.querySelector('[role="switch"]');
        if (!button) return;
        new MutationObserver(() => log.switchChanges.push(button.getAttribute('aria-checked')!)).observe(button, { attributes: true, attributeFilter: ['aria-checked'] });
      });
      return;
    }
    if (pick) (window as unknown as { __ldThemeSwitch: string }).__ldThemeSwitch = pick;
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target === document.documentElement) log.changes.push(document.documentElement.getAttribute('data-theme'));
        if (r.type === 'childList') for (const node of r.addedNodes) if (node.nodeName === 'BODY') log.atBody = document.documentElement.getAttribute('data-theme');
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme'] });
    requestAnimationFrame(() => (log.atFirstFrame = document.documentElement.getAttribute('data-theme')));
  }, forced);
}

const log = (target: Page | Frame) => target.evaluate(() => (window as unknown as { __ldLog: Log }).__ldLog);
const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('ld-theme'));
const switchFrame = (page: Page) => page.frames().find((frame) => frame.url().endsWith('/inline.html'))!;
/** 枠の中のスイッチ。ヘッダーの枠は小さく、作品の根を縮めて見えない部分を切るので、押すときは中で click を起こす */
const frameSwitch = (page: Page) => page.frameLocator(SWITCH_FRAME).locator('[role="switch"]').first();
/** 太陽と月のボタン。page の getByRole は枠の中に入らないので、枠の中のスイッチとは混ざらない */
const fallback = (page: Page) => page.getByRole('switch', { name: text.label, exact: true });

/** 開いて、React が載り、スイッチの枠が読めて（inert が外れて）、最初の合わせが終わるまで待つ。 */
async function openReady(page: Page, path = '/about') {
  await page.goto(path);
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
  await page.waitForFunction((selector) => {
    const frame = document.querySelector<HTMLIFrameElement>(selector);
    return !!frame && !frame.inert;
  }, SWITCH_FRAME);
  await expect(frameSwitch(page)).toHaveAttribute('aria-checked', String((await theme(page)) === 'dark'));
}

test.describe('最初は端末の設定に従い、最初の描画の前に data-theme が付く', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`端末が ${scheme}`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await record(page);
      await openReady(page);
      const { atBody, atFirstFrame, changes } = await log(page);
      expect(atBody).toBe(scheme);
      expect(atFirstFrame).toBe(scheme);
      expect(changes).toEqual([scheme]);
      // 選んでいないので、覚えていない
      expect(await stored(page)).toBeNull();
      // アドレスバーの色はサイトの地の色
      const [meta, bg] = await page.evaluate(() => [
        document.querySelector('meta[name="theme-color"]')!.getAttribute('content'),
        getComputedStyle(document.body).backgroundColor,
      ]);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(15, 15, 18)' : 'rgb(255, 255, 255)');
      expect(meta).toBe(scheme === 'dark' ? '#0f0f12' : '#ffffff');
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(scheme);
      await context.close();
    });
  }

  test('HTML は人で変えない：Worker の HTML に data-theme はなく、head の固定のスクリプトが決める', async ({ request }) => {
    const html = await (await request.get('/about')).text();
    expect(html).toMatch(/^<!doctype html>\s*<html lang="ja">/i);
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain("localStorage.getItem('ld-theme')");
    expect(head).toContain("root.setAttribute('data-theme', theme)");
  });
});

test.describe('押すとモードが変わり、読み込み直しても残る', () => {
  test('枠の中のスイッチを押す → ダーク → 読み込み直してもダーク → 押す → ライト', async ({ page }) => {
    await record(page);
    await openReady(page);
    expect(await theme(page)).toBe('light');

    await frameSwitch(page).dispatchEvent('click');
    await expect.poll(() => theme(page)).toBe('dark');
    expect(await stored(page)).toBe('dark');

    await page.reload();
    await openReady(page);
    expect((await log(page)).atBody).toBe('dark');
    await expect(frameSwitch(page)).toHaveAttribute('aria-checked', 'true');

    // キーボード：Tab で枠に入り、Space で切り替わる
    await page.getByRole('searchbox').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('title'))).toBe(text.frameTitle('Quiet Switches', 'fixture'));
    await page.keyboard.press('Space');
    await expect.poll(() => theme(page)).toBe('light');
    expect(await stored(page)).toBe('light');
    await page.keyboard.press('Enter');
    await expect.poll(() => theme(page)).toBe('dark');
  });
});

test.describe('枠と親の合わせ方：親のモードが正。行ったり来たりしない', () => {
  test('ダークを選んだ人が開くと、スイッチが夜の側（true）。スイッチは1回も押されず、モードも変わらない', async ({ page }) => {
    await page.goto('/about');
    await page.evaluate(() => localStorage.setItem('ld-theme', 'dark'));
    await record(page);
    await openReady(page);
    await page.waitForTimeout(3000);
    await expect(frameSwitch(page)).toHaveAttribute('aria-checked', 'true');
    expect((await log(page)).changes).toEqual(['dark']);
    expect((await log(switchFrame(page))).switchChanges).toEqual([]);
  });

  test('ライトの人が開くと、昼の側（false）へ1回だけ動き、モードは変わらない', async ({ page }) => {
    await record(page);
    await openReady(page);
    await page.waitForTimeout(3000);
    await expect(frameSwitch(page)).toHaveAttribute('aria-checked', 'false');
    expect((await log(page)).changes).toEqual(['light']);
    expect((await log(switchFrame(page))).switchChanges).toEqual(['false']);
  });

  test('枠の外でモードを変えても（端末の設定が変わる）、枠は1回だけ合わせ、送り返しで戻らない', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await record(page);
    await openReady(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => theme(page)).toBe('dark');
    await expect(frameSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(2000);
    expect((await log(page)).changes).toEqual(['light', 'dark']);
    expect((await log(switchFrame(page))).switchChanges).toEqual(['false', 'true']);
  });
});

test.describe('ほかの窓や、形の合わない知らせでは変わらない', () => {
  test('親の窓、作品のページの主の枠、形の違う知らせ：変わらない。対照：自分の枠からの正しい知らせで変わる。1秒に何回も来たら無視する', async ({ page }) => {
    await record(page);
    await openReady(page, `/p/${WORK}`);
    const workFrame = page.frames().find((frame) => frame.url().endsWith('/desktop.html'))!;
    const own = switchFrame(page);

    // 親の窓から（送り元が枠ではない）。押した知らせ（ld-switch-press）も同じ
    await page.evaluate(() => {
      window.postMessage({ type: 'ld-switch', checked: true }, '*');
      window.postMessage({ type: 'ld-switch-press' }, '*');
    });
    // 別の枠（作品のページの主の枠）から
    await workFrame.evaluate(() => {
      parent.postMessage({ type: 'ld-switch', checked: true }, '*');
      parent.postMessage({ type: 'ld-switch-press' }, '*');
    });
    // 自分の枠からでも、形が違うもの
    await own.evaluate(() => {
      const wrong: unknown[] = [
        { type: 'ld-switch', checked: 'true' },
        { type: 'ld-switch', checked: 1 },
        { type: 'ld-switch', checked: true, extra: 1 },
        { type: 'ld-switch-set', checked: true },
        { type: 'LD-SWITCH', checked: true },
        { type: 'ld-switch-press', checked: true },
        { type: 'ld-switch-press', extra: 1 },
        { type: 'LD-SWITCH-PRESS' },
        'ld-switch-press',
        'ld-switch',
        ['ld-switch', true],
        null,
      ];
      for (const data of wrong) parent.postMessage(data, '*');
    });
    await page.waitForTimeout(1500);
    expect(await theme(page)).toBe('light');
    expect((await log(page)).changes).toEqual(['light']);

    // 対照：自分の枠からの正しい知らせ
    await own.evaluate(() => parent.postMessage({ type: 'ld-switch', checked: true }, '*'));
    await expect.poll(() => theme(page)).toBe('dark');
    await page.waitForTimeout(1200);

    // 1秒に10回：はじめの2回より後は無視する
    const before = (await log(page)).changes.length;
    await own.evaluate(() => {
      for (let i = 0; i < 10; i += 1) parent.postMessage({ type: 'ld-switch', checked: i % 2 === 1 }, '*');
    });
    await page.waitForTimeout(1500);
    const flips = (await log(page)).changes.slice(before);
    expect(flips.length).toBeLessThanOrEqual(2);
    expect(await theme(page)).toBe('dark');

    // 押した知らせも、1秒に10回：はじめの2回より後は無視する
    await page.waitForTimeout(1200);
    const beforePress = (await log(page)).changes.length;
    await own.evaluate(() => {
      for (let i = 0; i < 10; i += 1) parent.postMessage({ type: 'ld-switch-press' }, '*');
    });
    await page.waitForTimeout(1500);
    expect((await log(page)).changes.slice(beforePress).length).toBeLessThanOrEqual(2);
    expect(await theme(page)).toBe('dark');
  });
});

test.describe('枠が読めないときは、太陽と月のボタンで切り替わる', () => {
  test('枠の応答が来ない：太陽と月のボタンが見えたまま。押すとダーク、読み込み直しても残る', async ({ page }) => {
    await page.route('**/frame/**/inline.html', (route) => route.abort());
    await record(page);
    await page.goto('/about');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3500);
    await expect(fallback(page)).toBeVisible();
    await expect(fallback(page)).toHaveAttribute('aria-checked', 'false');
    // 読めていない枠は、見えず、触れない
    await expect(page.locator(SWITCH_FRAME)).toHaveCSS('opacity', '0');
    expect(await page.locator(SWITCH_FRAME).evaluate((frame: HTMLIFrameElement) => frame.inert)).toBe(true);

    await fallback(page).click();
    await expect.poll(() => theme(page)).toBe('dark');
    expect(await stored(page)).toBe('dark');
    await expect(fallback(page)).toHaveAttribute('aria-checked', 'true');

    await page.reload();
    await page.waitForLoadState('load');
    expect((await log(page)).atBody).toBe('dark');
    await expect(fallback(page)).toHaveAttribute('aria-checked', 'true');
    await fallback(page).click();
    await expect.poll(() => theme(page)).toBe('light');
  });

  test('スイッチの作品が公開中の一覧にない：枠を置かず、太陽と月のボタンで切り替わる', async ({ page }) => {
    await record(page, 'toggle-not-published');
    await page.goto('/about');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    await expect(page.locator(SWITCH_FRAME)).toHaveCount(0);
    await fallback(page).click();
    await expect.poll(() => theme(page)).toBe('dark');
  });

  test('React が載る前（Worker の HTML）から、太陽と月のボタンがある', async ({ request }) => {
    const html = await (await request.get('/about')).text();
    expect(html).toContain(`aria-label="${text.label}"`);
    // 枠は React が load の後に置く。HTML にはない（見張りのスクリプトの中の名前は除く）
    expect(html).not.toMatch(/<iframe[^>]*data-ld-switch-frame/);
  });
});

test.describe('作者の名前と、作品のページへの道（原則4）', () => {
  /** 吹き出しは出さない（docs/tasks/T039.md）。スイッチの場所にはボタンと枠だけ。題と作者の文はページのどこにも出ない */
  async function expectNoTooltip(page: Page, when: string) {
    await expect(page.locator('[data-theme-switch] > :not(button, iframe)'), when).toHaveCount(0);
    await expect(page.getByText('Quiet Switches · @fixture'), when).toHaveCount(0);
  }

  for (const width of [390, 1440]) {
    test(`幅${width}：押しても、ホバーしても、Tab で入っても、吹き出しが出ない。読み上げの名前は残る`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await record(page);
      await openReady(page, '/');
      await expectNoTooltip(page, '開いたとき');

      // 押す：枠の真ん中を本当に押す（枠にフォーカスが入る。スマホで押した後に吹き出しが残っていた形）
      await page.locator(SWITCH_FRAME).click();
      await page.waitForTimeout(300);
      await expectNoTooltip(page, '押した後');

      await page.mouse.move(0, 600);
      await page.locator(SWITCH_FRAME).hover();
      await page.waitForTimeout(300);
      await expectNoTooltip(page, 'ホバー');

      await page.mouse.move(0, 600);
      // Tab：ヘッダーのロゴから Tab を押していき、枠に入る
      await page.getByRole('banner').getByRole('link', { name: copy.brand, exact: true }).focus();
      for (let i = 0; i < 6 && (await page.evaluate(() => document.activeElement?.tagName)) !== 'IFRAME'; i += 1) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('title'))).toBe(text.frameTitle('Quiet Switches', 'fixture'));
      await page.waitForTimeout(300);
      await expectNoTooltip(page, 'Tab');

      // 読み上げの名前：枠の title と、太陽と月のボタンの aria-label
      await expect(page.locator(SWITCH_FRAME)).toHaveAttribute('title', text.frameTitle('Quiet Switches', 'fixture'));
      await expect(page.locator('[data-theme-switch] > button')).toHaveAttribute('aria-label', text.label);

      if (process.env.LD_SHOTS && width === 390) {
        await page.locator(SWITCH_FRAME).click();
        await page.waitForTimeout(800);
        await expectNoTooltip(page, 'スクリーンショット');
        await page.screenshot({ path: join(import.meta.dirname, '../../../docs/screens/t039-pressed-390.png') });
      }
    });
  }

  test('「…」のメニューに「このスイッチの作品を見る」', async ({ page }) => {
    await record(page);
    await openReady(page);
    await page.getByRole('button', { name: copy.header.menu }).click();
    const item = page.getByRole('menuitem', { name: text.viewWork });
    await expect(item).toHaveAttribute('href', `/p/${WORK}`);
    await item.click();
    await page.waitForURL(`**/p/${WORK}`);
  });
});

test.describe('作品の選び方', () => {
  const works = THEME_SWITCH_IDS.map((id, index) => ({ id, version: String(index + 1), title: id, creator: { handle: 'a' } }));
  const others = [{ id: 'toggle-snow-cabin', version: '1', title: 'x', creator: { handle: 'a' } }, { id: 'fx-toggle', version: '1', title: 'x', creator: { handle: 'a' } }];

  test('並びの9つのどれもが選ばれうる。並びにないもの（toggle-snow-cabin など）は選ばない。版は一覧の版', () => {
    const picked = new Set<string>();
    for (let i = 0; i < 9; i += 1) {
      const work = pickThemeSwitch([...others, ...works], undefined, () => (i + 0.5) / 9)!;
      picked.add(work.id);
      expect(work.version).toBe(String(THEME_SWITCH_IDS.indexOf(work.id as (typeof THEME_SWITCH_IDS)[number]) + 1));
    }
    expect([...picked].sort()).toEqual([...THEME_SWITCH_IDS].sort());
    expect(THEME_SWITCH_IDS).not.toContain('toggle-snow-cabin');
  });

  test('取り下げた作品（公開中の一覧にない）は選ばない。どれもなければ null', () => {
    const one = works.slice(2, 3);
    for (const r of [0, 0.5, 0.99]) expect(pickThemeSwitch(one, undefined, () => r)!.id).toBe(one[0].id);
    expect(pickThemeSwitch(others, undefined)).toBeNull();
  });

  test('固定：公開中の一覧にある id なら、それを出す。none なら出さない', () => {
    expect(pickThemeSwitch([...others, ...works], 'fx-toggle')!.id).toBe('fx-toggle');
    expect(pickThemeSwitch(works, 'toggle-snow-cabin')).toBeNull();
    expect(pickThemeSwitch(works, 'none')).toBeNull();
  });

  test('サイトの中で別のページへ移っても選び直さない。読み込み直すと選び直す', async ({ page }) => {
    const frames: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/inline.html')) frames.push(request.url());
    });
    await record(page);
    await openReady(page, '/');
    // 見張りが読み直すことがある（重いときに「読み込めた」が遅れる）ので、数は前と後で比べる
    const before = frames.length;
    const src = await page.locator(SWITCH_FRAME).getAttribute('src');
    await page.getByRole('link', { name: copy.nav.explore }).first().click();
    await page.waitForURL('**/?sort=new');
    await page.waitForTimeout(1500);
    expect(frames).toHaveLength(before);
    await expect(page.locator(SWITCH_FRAME)).toHaveCount(1);
    await expect(page.locator(SWITCH_FRAME)).toHaveAttribute('src', src!);
    await page.reload();
    await openReady(page, '/?sort=new');
    expect(frames.length).toBeGreaterThan(before);
  });
});

test.describe('ログインしていない人が、どの幅でも利用規約、プライバシー、運営者、English に届く', () => {
  const names = [copy.siteInfo.terms, copy.siteInfo.privacy, copy.siteInfo.about, copy.language.switchLabel];

  for (const width of [1440, 390]) {
    test(`${width}px：「…」のメニュー。左下のリンクはない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await record(page, 'none');
      await page.goto('/');
      await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
      await expect(page.getByRole('navigation', { name: copy.siteInfo.label })).toHaveCount(0);
      await page.getByRole('button', { name: copy.header.menu }).click();
      const items = page.getByRole('menuitem');
      await expect(items).toHaveText([copy.siteInfo.terms, copy.siteInfo.privacy, copy.siteInfo.about, copy.language.switchTo]);
      for (const [index, name] of names.entries()) await expect(items.nth(index)).toHaveAccessibleName(name);
      await expect(items.nth(0)).toHaveAttribute('href', '/terms');
      await expect(items.nth(1)).toHaveAttribute('href', '/privacy');
      await expect(items.nth(2)).toHaveAttribute('href', '/about');
      await expect(items.nth(3)).toHaveAttribute('href', '/en');
      // ヘッダーの中で、スイッチはメニューとログインの左
      const order = await page.locator('header').evaluate((header) =>
        [header.querySelector('[data-theme-switch]'), header.querySelector('[aria-haspopup="menu"]'), [...header.querySelectorAll('a')].at(-1)].map((el) => el!.getBoundingClientRect().left),
      );
      expect(order[0]).toBeLessThan(order[1]);
      expect(order[1]).toBeLessThan(order[2]);
      await page.getByRole('menuitem', { name: copy.siteInfo.privacy }).click();
      await page.waitForURL('**/privacy');
      await expect(page.getByText('ライトとダークの選択。ブラウザに残すだけで、サーバーには保存しません')).toBeVisible();
    });

    test(`${width}px：JS が動かないときは、ページの下の文字のリンク`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: copy.siteInfo.label });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link')).toHaveText([copy.siteInfo.terms, copy.siteInfo.privacy, copy.siteInfo.about, copy.language.switchTo]);
      await context.close();
    });
  }

  test('767px 以下では、スイッチは検索のボタンの左', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await record(page);
    await openReady(page, '/');
    const [switchLeft, searchLeft] = await Promise.all([
      page.locator('[data-theme-switch]').evaluate((el) => el.getBoundingClientRect()),
      page.getByRole('button', { name: copy.header.openSearch }).evaluate((el) => el.getBoundingClientRect()),
    ]);
    expect(switchLeft.right).toBeLessThanOrEqual(searchLeft.left);
    // 高さ：ヘッダー（64px）に収まり、ほかのボタンと縦の中心が揃う
    expect(switchLeft.height).toBe(42);
    expect(Math.abs(switchLeft.top + switchLeft.height / 2 - (searchLeft.top + searchLeft.height / 2))).toBeLessThanOrEqual(1);
  });

  test('374px 以下：ロゴの文字を隠してマークだけにし、ヘッダーが1行に収まる。読み上げの名前は残る（CTO の答え1）', async ({ page }) => {
    await record(page);
    for (const width of [320, 340, 359, 360, 374, 375, 390]) {
      await page.setViewportSize({ width, height: 700 });
      await openReady(page, '/');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), String(width)).toBe(0);
      const login = (await page.getByRole('link', { name: copy.header.login, exact: true }).boundingBox())!;
      expect(login.x + login.width, String(width)).toBe(width - 16);
      const frame = (await page.locator(SWITCH_FRAME).boundingBox())!;
      expect(frame.height, String(width)).toBe(42);
      const logo = page.getByRole('banner').getByRole('link', { name: copy.brand, exact: true });
      await expect(logo, String(width)).toHaveAccessibleName(copy.brand);
      const logoBox = (await logo.boundingBox())!;
      expect(logoBox.width, String(width)).toBe(width < 375 ? 20 : logoBox.width);
      if (width >= 375) expect(logoBox.width, String(width)).toBeGreaterThan(80);
      // スイッチはロゴにも検索のボタンにも重ならない
      const sw = (await page.locator('[data-theme-switch]').boundingBox())!;
      expect(sw.x, String(width)).toBeGreaterThanOrEqual(logoBox.x + logoBox.width);
    }
  });
});
