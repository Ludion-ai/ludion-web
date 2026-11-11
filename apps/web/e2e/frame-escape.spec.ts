// T022「1」：作品の枠が外へ移る穴（SEC001 の A01 の前半、R1）。
// 親のページの応答の CSP（frame-src 'self'）で、枠の移動そのものを止める。未許可の宛先への到達は0。
// playwright.config.ts の escape-* で、Chromium、WebKit、Firefox の全部で流す。サーバーは pages と同じ（悪意のある見本が入っている）。
// T035「3」：ヘッダーのスイッチの枠（/frame/<id>/<version>/inline.html）でも、同じ試験を流す（FORMS）。
// WALL001：全画面の住所（/p/<id>/wall の /frame/<id>/<version>/wall.html）でも、同じ試験を流す（FORMS）。
import { expect, test, type BrowserContext, type Frame, type Locator, type Page } from '@playwright/test';

const SYNTHETIC_INPUT = 'ld-synthetic-input';
/** 親の見張りが「読み込めた」の知らせを待つ時間（src/frameGuard.ts の CONFIRM_WAIT_MS）より長く */
const AFTER_GUARD_MS = 2500;

const ownOrigin = () => new URL(test.info().project.use.baseURL!).origin;

/**
 * 作品が動く枠の形。
 * - desktop：作品のページの主の枠（/p/<id> の /frame/<id>/<version>/desktop.html）
 * - inline：ヘッダーのスイッチの枠（T035「3」）。作品を固定して、作品の枠のない /about で開く
 * - wall：全画面の住所（WALL001）。サイトの頭も React もなく、枠だけがある
 */
const FORMS = [
  { name: 'desktop', file: 'desktop.html', frame: 'iframe[data-ld-frame]', pagePath: (id: string) => `/p/${id}` },
  { name: 'inline', file: 'inline.html', frame: 'iframe[data-ld-switch-frame]', pagePath: (_id: string) => '/about' },
  { name: 'wall', file: 'wall.html', frame: 'iframe[data-ld-frame]', pagePath: (id: string) => `/p/${id}/wall` },
] as const;
type Form = (typeof FORMS)[number];
const DESKTOP = FORMS[0];
const INLINE = FORMS[1];
const WALL = FORMS[2];

/**
 * 自分のサイトのほかへの要求を、すべて記録する。ここに来たら「届いた」。
 * route は転送の先を受け取らないので、記録は request の知らせで取る（CSP で止まった要求は、ブラウザが出さないのでここに来ない）。
 * 移った先は R1 と同じく、親の見張りが待つ知らせを真似る。
 */
async function watchOutside(context: BrowserContext): Promise<string[]> {
  const seen: string[] = [];
  const own = ownOrigin();
  const outside = (url: URL) => url.protocol.startsWith('http') && url.origin !== own;
  context.on('request', (request) => {
    if (outside(new URL(request.url()))) seen.push(request.url());
  });
  await context.route(
    outside,
    (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><title>outside</title><script>parent.postMessage('ld-frame-loaded','*')</script>`,
      });
    },
  );
  return seen;
}

/** 親のページの CSP に引っかかったら記録する。正しい作品では0のはず。 */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const seen: string[] = [];
    Object.defineProperty(window, '__violations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);

/**
 * 作品のページ（ヘッダーの形では、スイッチの作品を固定した /about）を開き、React が載って、枠が置かれるまで待つ。
 * loaded：枠の中に作品の文書が入るまで待つ。ヘッダーの枠は load の後に置かれるので、待たずに中でスクリプトを動かすと、最初の空の文書で動いてしまう。
 * 読み込みの途中で移る見本（mal-nav-fake-ready、mal-nav-loop）では待たない。
 */
async function openWork(page: Page, id: string, form: Form = DESKTOP, loaded = true) {
  if (form.name === 'inline') await page.addInitScript((forced) => (window.__ldThemeSwitch = forced), id);
  await page.goto(form.pagePath(id));
  // 全画面の住所には見出しも React もない。枠は HTML に初めからある
  if (form.name !== 'wall') {
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
  }
  await page.locator(form.frame).waitFor({ state: 'attached' });
  if (loaded) await page.frameLocator(form.frame).locator('#ld-host').waitFor({ state: 'attached' });
}

/** 作品の枠（親のページのほかの1つ）。テストのデータにはヘッダーのスイッチの作品がないので、作品のページでも枠は1つだけ。 */
const workFrame = (page: Page): Frame => page.frames().find((frame) => frame !== page.mainFrame())!;

/** 対照のために、親のページの応答から CSP を外す。 */
async function dropParentCsp(page: Page, id: string, form: Form = DESKTOP) {
  await page.route(`**${form.pagePath(id)}`, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response, headers });
  });
}

const frameUrlPath = (page: Page) => new URL(workFrame(page).url(), ownOrigin()).pathname;

/** 枠の中の要素を押す。ヘッダーの枠は小さく、作品の根を縮めて見えない部分を切るので、中で click を起こす。 */
async function press(locator: Locator, form: Form) {
  if (form.name === 'inline') await locator.evaluate((element: HTMLElement) => element.click());
  else await locator.click();
}

/** 枠の中の入力欄に書く。ヘッダーの枠では、中で値を入れる。 */
async function fill(locator: Locator, value: string, form: Form) {
  if (form.name === 'inline') await locator.evaluate((element: HTMLInputElement, text: string) => (element.value = text), value);
  else await locator.fill(value);
}

/** ヘッダーの形では、固定する作品が init script に入るので、作品ごとに新しいページで開く。 */
const pageFor = async (page: Page, form: Form, first: boolean) => (form.name === 'inline' && !first ? page.context().newPage() : page);

for (const form of FORMS) {
  test.describe(`R1 の3つの形：未許可の宛先への到達が0（${form.name}）`, () => {
    test('クリックで移る（mal-nav）：外へ届かず、親のページは移らず、作品は動いたまま', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await openWork(page, 'mal-nav', form);
      const button = page.frameLocator(form.frame).locator('[data-ld-part="mal-nav"] .go');

      await press(button, form);
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(seen).toEqual([]);
      await expect(button).toBeAttached();
      expect(frameUrlPath(page)).toBe(`/frame/mal-nav/1/${form.file}`);
      expect(new URL(page.url()).pathname).toBe(form.pagePath('mal-nav'));

      // 読み直しの後でも同じ
      await press(button, form);
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(seen).toEqual([]);
      await expect(button).toBeAttached();
    });

    test('location を別名で参照して、入力を送ろうとする（mal-nav-alias）：外へ届かない', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await openWork(page, 'mal-nav-alias', form);
      const part = page.frameLocator(form.frame).locator('[data-ld-part="mal-nav-alias"]');

      await fill(part.locator('input'), SYNTHETIC_INPUT, form);
      await press(part.locator('.go'), form);
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(seen).toEqual([]);
      expect(new URL(page.url()).pathname).toBe(form.pagePath('mal-nav-alias'));
    });

    test('最初の load の前に移り、移った先が ld-frame-loaded を真似る（mal-nav-fake-ready）：外へ届かず、外に残らない', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await openWork(page, 'mal-nav-fake-ready', form, false);
      await page.waitForTimeout(AFTER_GUARD_MS * 2);
      expect(seen).toEqual([]);
      expect(workFrame(page).url()).not.toContain('evil.example');
      expect(new URL(page.url()).pathname).toBe(form.pagePath('mal-nav-fake-ready'));
    });

    test('読み込むたびに移る（mal-nav-loop）：1回も届かない。親のページは移らない', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await openWork(page, 'mal-nav-loop', form, false);
      await page.waitForTimeout(AFTER_GUARD_MS * 4);
      expect(seen).toEqual([]);
      expect(workFrame(page).url()).not.toContain('evil.example');
      expect(new URL(page.url()).pathname).toBe(form.pagePath('mal-nav-loop'));
    });

    test('対照：親のページの CSP を外すと、3つの形とも外へ届く（見本と見張りが本当に働いている）', async ({ context, page }) => {
      const seen = await watchOutside(context);

      const first = await pageFor(page, form, true);
      await dropParentCsp(first, 'mal-nav', form);
      await openWork(first, 'mal-nav', form);
      await press(first.frameLocator(form.frame).locator('[data-ld-part="mal-nav"] .go'), form);
      await expect.poll(() => seen.filter((url) => url.endsWith('/moved'))).not.toEqual([]);

      const second = await pageFor(page, form, false);
      await dropParentCsp(second, 'mal-nav-alias', form);
      await openWork(second, 'mal-nav-alias', form);
      const part = second.frameLocator(form.frame).locator('[data-ld-part="mal-nav-alias"]');
      await fill(part.locator('input'), SYNTHETIC_INPUT, form);
      await press(part.locator('.go'), form);
      await expect.poll(() => seen.filter((url) => url.includes(SYNTHETIC_INPUT))).not.toEqual([]);

      const third = await pageFor(page, form, false);
      await dropParentCsp(third, 'mal-nav-fake-ready', form);
      if (form.name === 'inline') await third.addInitScript(() => (window.__ldThemeSwitch = 'mal-nav-fake-ready'));
      await third.goto(form.pagePath('mal-nav-fake-ready'));
      await expect.poll(() => seen.filter((url) => url.endsWith('/fake-ready'))).not.toEqual([]);
    });
  });
}

test.describe('ほかの移り方（SEC001 の A01 の確かめの案）', () => {
  const moves: [string, string][] = [
    ['リンクを押す', `const a = document.createElement('a'); a.href = 'https://evil.example/link'; document.body.append(a); a.click();`],
    ['自分のサイトの転送を通る（/auth/github は GitHub へ 302）', `location.href = '/auth/github';`],
    ['data: の文書へ移り、そこから外の画像を読む', `location.href = 'data:text/html,<img src="https://evil.example/from-data">';`],
  ];

  for (const form of FORMS) {
    for (const [label, code] of moves) {
      test(`${label}：外へ届かない（${form.name}）`, async ({ context, page }) => {
        const seen = await watchOutside(context);
        await openWork(page, 'mal-nav', form);
        await workFrame(page).evaluate(code).catch(() => {}); // 移ると評価の結果は返らない
        await page.waitForTimeout(AFTER_GUARD_MS);
        expect(seen).toEqual([]);
        expect(new URL(page.url()).pathname).toBe(form.pagePath('mal-nav'));
      });
    }

    test(`対照：親のページの CSP を外すと、自分のサイトの転送を通って外へ届く（${form.name}）`, async ({ context, page }) => {
      const seen = await watchOutside(context);
      await dropParentCsp(page, 'mal-nav', form);
      await openWork(page, 'mal-nav', form);
      await workFrame(page).evaluate(`location.href = '/auth/github'`).catch(() => {});
      await expect.poll(() => seen.filter((url) => url.includes('/login/oauth/authorize'))).not.toEqual([]);
    });
  }

  test.describe('ほかのサイトの枠に、親のページは入らない（frame-ancestors none）', () => {
    const embedAbout = async (context: BrowserContext, page: Page) => {
      // 手元のサーバーは http なので、外のページも http にする。https だと WebKit が混在コンテンツとして枠を止め、何も確かめられない
      await context.route('http://outside.example/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>embed</title><iframe src="${ownOrigin()}/about"></iframe>` }),
      );
      await page.goto('http://outside.example/');
      // ブラウザが断ると、応答の知らせも出ない。読み込めたなら枠が /about になるだけの時間を待つ
      await page.waitForTimeout(AFTER_GUARD_MS);
    };

    /**
     * 枠の中の h1 の文字。なければ null。
     * 断られた枠は、WebKit では URL だけが /about になり、WebKit と Firefox では中を覗く Playwright の呼び出しが返らないことがあるので、時間で切る（返らないのも null）。
     */
    const frameHeading = (page: Page) =>
      Promise.race([
        workFrame(page)
          .evaluate(() => document.querySelector('h1')?.textContent ?? null)
          .catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), AFTER_GUARD_MS)),
      ]);

    test('枠の中にページの見出しが出ない', async ({ context, page }) => {
      await embedAbout(context, page);
      expect(await frameHeading(page)).toBeNull();
    });

    test('対照：CSP を外すと、枠の中に見出しが出る（止めているのはこの指定）', async ({ context, page }) => {
      await context.route(`${ownOrigin()}/about`, async (route) => {
        const response = await route.fetch();
        const headers = { ...response.headers() };
        delete headers['content-security-policy'];
        await route.fulfill({ response, headers });
      });
      await embedAbout(context, page);
      expect(await frameHeading(page)).toBeTruthy();
    });
  });
});

test.describe('正しい作品は今までどおり動く', () => {
  test('fx-toggle：枠は1回だけ読まれ、動き、押せる。親の CSP の違反は0', async ({ page }) => {
    await watchViolations(page);
    const frames: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/frame/')) frames.push(request.url());
    });
    await openWork(page, 'fx-toggle');
    const frame = page.frameLocator(DESKTOP.frame);
    await expect(frame.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
    await expect(frame.locator('[data-ld-part="fx-toggle"]')).toBeVisible();
    await page.waitForLoadState('load');
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(frames).toHaveLength(1);
    expect(await violations(page)).toEqual([]);
    await expect(frame.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
  });

  test('fx-toggle（ヘッダーの枠、T035「3」）：枠は1回だけ読まれ、動く。CSP は今の枠と同じ。親の CSP の違反は0', async ({ page }) => {
    await watchViolations(page);
    const frames: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/frame/')) frames.push(request.url());
    });
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/frame/fx-toggle/1/inline.html'),
      openWork(page, 'fx-toggle', INLINE),
    ]);
    const desktop = await page.request.get('/frame/fx-toggle/1/desktop.html', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
    expect(response.headers()['content-security-policy']).toBe(desktop.headers()['content-security-policy']);
    await expect(page.locator(INLINE.frame)).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    const frame = page.frameLocator(INLINE.frame);
    await expect(frame.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(frames.map((url) => new URL(url).pathname)).toEqual(['/frame/fx-toggle/1/inline.html']);
    expect(await violations(page)).toEqual([]);
  });

  test('fx-wallpaper（全画面の住所、WALL001）：枠は1回だけ読まれる。sandbox と CSP は今の枠と同じ。親の CSP の違反は0', async ({ page }) => {
    await watchViolations(page);
    const frames: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/frame/')) frames.push(request.url());
    });
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/frame/fx-wallpaper/1/wall.html'),
      openWork(page, 'fx-wallpaper', WALL),
    ]);
    const desktop = await page.request.get('/frame/fx-wallpaper/1/desktop.html', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
    expect(response.headers()['content-security-policy']).toBe(desktop.headers()['content-security-policy']);
    await expect(page.locator(WALL.frame)).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    await expect(page.frameLocator(WALL.frame).locator('[data-ld-part="fx-wallpaper"]')).toBeVisible();
    await page.waitForLoadState('load');
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(frames.map((url) => new URL(url).pathname)).toEqual(['/frame/fx-wallpaper/1/wall.html']);
    expect(await violations(page)).toEqual([]);
  });
});
