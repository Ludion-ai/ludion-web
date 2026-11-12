// T007：作品のページと作り手のページ（docs/tasks/T007.md の終わりの条件）。
// このテストのサーバーは開発のデータ全部で動く：seed の50作品、fixtures の良い見本、悪意のある見本（scripts/test-server.mjs）。
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copy } from '../src/copy';
import { copyEn } from '../src/copy.en';
import { formatCount } from '../src/lib/format';
import type { Work } from '../src/data/works';
import { framedAt, pageOverflow, seed } from './helpers';

const REPO = join(import.meta.dirname, '../../..');
const FRAME_CSP =
  "sandbox allow-scripts allow-forms; form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; frame-ancestors 'self'";
/** 枠の中から読むときの見出し。ブラウザの iframe はこれを付ける。 */
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const EVIL = 'https://evil.example/**';
const SECRET = 'ld-secret-cookie-value';

const baseUrl = () => test.info().project.use.baseURL!;
const ownOrigin = () => new URL(baseUrl()).origin;

async function worksFromApi(request: APIRequestContext): Promise<Work[]> {
  return ((await (await request.get('/api/works')).json()) as { works: Work[] }).works;
}

async function workFromApi(request: APIRequestContext, id: string): Promise<Work> {
  return (await worksFromApi(request)).find((work) => work.id === id)!;
}

/** 作品のページを開き、React が載るまで待つ（全部をコピーが押せる）。 */
async function openWork(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

/**
 * ブラウザの本物の document.cookie（Document.prototype の取り出し）を読む。投げたら、その名前を返す。
 * 枠の中の document.cookie はメモリだけの代わり（FRAME001）なので、本物に届かないことはこれで見る。evaluate に渡すので、外の名前を使わない。
 */
function readNativeCookie(): string {
  try {
    return Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!.get!.call(document) as string;
  } catch (error) {
    return (error as Error).name;
  }
}

/** 外（evil.example）へのリクエストをすべて受け止めて記録する。CSP で止まれば、ここには来ない。 */
async function watchEvil(context: BrowserContext): Promise<string[]> {
  const seen: string[] = [];
  await context.route(EVIL, (route) => {
    seen.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>evil</title>' });
  });
  return seen;
}

async function runAxe(page: Page, label: string) {
  // 枠の中（作品）は ld check が見る。ここではサイトの側を見る。枠には題名があることを別に確かめる
  const { violations } = await new AxeBuilder({ page }).exclude('iframe').analyze();
  const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  console.log(`axe [${label}] 違反 ${violations.length}（critical+serious ${blocking.length}）${violations.map((v) => `\n  - ${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('')}`);
  return blocking;
}

// ---------------------------------------------------------------- 悪意のある見本

const MALICIOUS = ['mal-cookie', 'mal-top', 'mal-parent'] as const;

test.describe('悪意のある見本は、作品のページで3つとも失敗する', () => {
  // 枠の中の document.cookie は、メモリだけの代わり（FRAME001。packages/render の storage.ts）。作品が読むと投げずに空が返り、本物の cookie には届かない
  test('mal-cookie：本物の cookie は読めず、外へも、サイトの API へも何も届かない', async ({ context, page }) => {
    await context.addCookies([{ name: 'ld_session', value: SECRET, url: baseUrl() }]);
    const evil = await watchEvil(context);
    const apiFromFrame: string[] = [];
    page.on('request', (request) => {
      if (request.frame() !== page.mainFrame() && new URL(request.url()).pathname.startsWith('/api/')) apiFromFrame.push(request.url());
    });
    await openWork(page, 'mal-cookie');
    const root = page.frameLocator('iframe').locator('[data-ld-part="mal-cookie"]');
    await expect(root).toHaveAttribute('data-cookie', 'read');
    expect(await root.evaluate(() => document.cookie)).toBe('');
    expect(await root.evaluate(readNativeCookie)).toBe('SecurityError');
    await expect(root).toHaveAttribute('data-fetch', 'blocked');
    await expect(root).toHaveAttribute('data-api', 'blocked');
    await page.waitForLoadState('networkidle');
    expect(evil).toEqual([]);
    expect(apiFromFrame).toEqual([]);
    expect((await workFromApi(page.request, 'mal-cookie')).copies).toBe(0);
  });

  test('mal-top：親のページは移らない', async ({ context, page }) => {
    const evil = await watchEvil(context);
    await openWork(page, 'mal-top');
    const root = page.frameLocator('iframe').locator('[data-ld-part="mal-top"]');
    await expect(root).toHaveAttribute('data-top', /^blocked:|^navigated$/);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300); // 遷移が遅れて起きないこと
    expect(new URL(page.url()).pathname).toBe('/p/mal-top');
    expect(evil).toEqual([]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Malicious: Navigates Top');
  });

  test('mal-parent：親の DOM に触れない', async ({ page }) => {
    await openWork(page, 'mal-parent');
    const root = page.frameLocator('iframe').locator('[data-ld-part="mal-parent"]');
    await expect(root).toHaveAttribute('data-parent', 'blocked:SecurityError');
    await expect(page.locator('#hacked')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Malicious: Rewrites Parent');
    await expect(page.getByRole('button', { name: '全部をコピー' })).toBeVisible();
  });

  test('枠は sandbox="allow-scripts allow-forms" だけ。allow-same-origin がない', async ({ page }) => {
    for (const id of MALICIOUS) {
      await page.goto(`/p/${id}`);
      await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
      await expect(page.locator('iframe')).toHaveAttribute('src', framedAt(`/frame/${id}/1/desktop.html`));
      await expect(page.locator('iframe')).toHaveAttribute('title', /のプレビュー$/);
    }
  });

  test('対照：sandbox と CSP を外すと、3つとも攻撃が成功する（見本が本当に攻撃している）', async ({ context, page, request }) => {
    await context.addCookies([{ name: 'ld_session', value: SECRET, url: baseUrl() }]);
    const evil = await watchEvil(context);
    // 枠を外すと mal-cookie はサイトの API に届く。ほかのテストが見る数を増やさないよう、ここで止める
    await page.route('**/api/count', (route) => route.abort());
    const unguarded = async (id: string) => {
      const html = (await (await request.get(`/frame/${id}/1/desktop.html`, { headers: FROM_IFRAME })).text()).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
      const body = `<!doctype html><title>control</title><h1 id="marker">parent</h1><iframe srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`;
      await page.route('**/__control__', (route) => route.fulfill({ status: 200, contentType: 'text/html', body }));
      await page.goto('/__control__');
    };

    await unguarded('mal-cookie');
    await expect(page.frameLocator('iframe').locator('[data-ld-part="mal-cookie"]')).toHaveAttribute('data-cookie', 'read');
    await expect.poll(() => evil.some((url) => url.includes(SECRET))).toBe(true);

    await unguarded('mal-parent');
    await expect(page.locator('#hacked')).toHaveText('Hacked');
    await expect(page.locator('#marker')).toHaveCount(0);

    await unguarded('mal-top');
    await expect(page).toHaveURL('https://evil.example/hijacked');
  });
});

// 枠が外へ移るのを止めること（到達が0）は、全部のブラウザで e2e/frame-escape.spec.ts が確かめる（docs/tasks/T022.md「1」）
test.describe('親の見張りは、ふつうの作品を読み直さない（T012）', () => {
  test('ふつうの作品は読み直さない。枠を読むのは1回', async ({ page }) => {
    const frames: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/frame/')) frames.push(request.url());
    });
    await openWork(page, 'fx-toggle');
    await expect(page.frameLocator('iframe').locator('[data-ld-mount="ok"]')).toHaveCount(1);
    await page.waitForLoadState('load');
    expect(frames).toHaveLength(1);
  });

  test('もう一度（Replay）で作り直した枠を、移動と数えない', async ({ page }) => {
    const frames: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/frame/')) frames.push(request.url());
    });
    await openWork(page, 'fx-motion');
    const mounted = page.frameLocator('iframe').locator('[data-ld-mount="ok"]');
    await expect(mounted).toHaveCount(1);
    for (let replay = 2; replay <= 3; replay += 1) {
      await page.getByRole('button', { name: copy.work.replay }).click();
      await expect.poll(() => frames.length).toBe(replay);
      await expect(mounted).toHaveCount(1);
    }
    await page.waitForLoadState('load');
    expect(frames).toHaveLength(3);
  });
});

test.describe('フレームの URL は、枠の中で読んだときだけ作品を返す（T008）', () => {
  /** 枠の外から読んだ応答を、作品を動かさずに見る。 */
  const direct = (request: APIRequestContext, path: string, headers: Record<string, string> = {}) => request.get(path, { headers, maxRedirects: 0 });

  for (const file of ['desktop', 'mobile']) {
    test(`/frame/…/${file}.html：Sec-Fetch-Dest が iframe なら作品を返し、CSP は決まりどおり`, async ({ request }) => {
      const response = await request.get(`/frame/mal-cookie/1/${file}.html`, { headers: FROM_IFRAME });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-security-policy']).toBe(FRAME_CSP);
      expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
      expect(response.headers()['content-type']).toBe('text/html; charset=utf-8');
      expect(response.headers()['cache-control']).toBe('private, no-store');
      expect(response.headers().vary).toBe('Sec-Fetch-Dest');
      expect(await response.text()).toContain('data-ld-part="mal-cookie"');
    });

    test(`/frame/…/${file}.html：見出しがなければ、作品を返さず /p/<id> へ 302`, async ({ request }) => {
      const response = await direct(request, `/frame/mal-cookie/1/${file}.html`);
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe('/p/mal-cookie');
      expect(response.headers()['cache-control']).toBe('private, no-store');
      expect(response.headers().vary).toBe('Sec-Fetch-Dest');
      expect(await response.text()).not.toContain('data-ld-part');
    });
  }

  for (const dest of ['document', 'empty', 'embed', 'object', 'frame', 'script', 'IFRAME']) {
    test(`Sec-Fetch-Dest: ${dest} も iframe ではないので 302`, async ({ request }) => {
      const response = await direct(request, '/frame/fx-button/1/desktop.html', { 'Sec-Fetch-Dest': dest });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe('/p/fx-button');
    });
  }

  test('戻り先は自分のサイトの /p/ の中だけ', async ({ request }) => {
    for (const [path, location] of [
      ['/frame/%2F%2Fevil.example/1/desktop.html', '/p/%2F%2Fevil.example'],
      ['/frame/https%3A%2F%2Fevil.example/1/desktop.html', '/p/https%3A%2F%2Fevil.example'],
      ['/frame/a%0d%0aSet-Cookie:x=1/1/desktop.html', '/p/a%0D%0ASet-Cookie%3Ax%3D1'],
    ]) {
      const response = await direct(request, path);
      expect(response.status(), path).toBe(302);
      expect(response.headers().location, path).toBe(location);
      expect(response.headers()['set-cookie'], path).toBeUndefined();
    }
  });

  test('ブラウザで直接開くと作品のページへ戻り、mal-top は外へ移れない', async ({ context, page }) => {
    const evil = await watchEvil(context);
    await page.goto('/frame/mal-top/1/desktop.html');
    await expect(page).toHaveURL('/p/mal-top');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Malicious: Navigates Top');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300); // 遷移が遅れて起きないこと
    await expect(page).toHaveURL('/p/mal-top');
    expect(evil).toEqual([]);
  });

  test('ない作品を直接開くと、戻った先が 404', async ({ page }) => {
    const response = await page.goto('/frame/nothing-here/1/desktop.html');
    expect(new URL(page.url()).pathname).toBe('/p/nothing-here');
    expect(response?.status()).toBe(404);
  });

  test('作品のページの中では、ブラウザの iframe が Sec-Fetch-Dest: iframe で読み、今までどおり動く', async ({ page }) => {
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/frame/fx-toggle/1/desktop.html');
    await openWork(page, 'fx-toggle');
    const response = await answered;
    expect(await response.request().headerValue('sec-fetch-dest')).toBe('iframe');
    expect(response.status()).toBe(200);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('[data-ld-part="fx-toggle"]')).toBeVisible();
    await expect(frame.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
  });

  test('知らない枠の名前は作品の HTML を返さない', async ({ request }) => {
    const body = await (await request.get('/frame/mal-cookie/1/other.html', { headers: FROM_IFRAME })).text();
    expect(body).not.toContain('data-ld-part');
  });

  test.describe('見出しを偽って開いても、サイトのオリジンでは動かない', () => {
    /** 枠の外で開いたページのリクエストに、Sec-Fetch-Dest: iframe を足す。応答の CSP はそのまま使う。 */
    async function forgeHeader(context: BrowserContext) {
      await context.route('**/frame/**', async (route) => {
        const response = await route.fetch({ headers: { ...route.request().headers(), ...FROM_IFRAME } });
        await route.fulfill({ response });
      });
    }

    test('mal-cookie：オリジンは null で、cookie は読めず、外へも届かない', async ({ context, page }) => {
      await forgeHeader(context);
      await context.addCookies([{ name: 'ld_session', value: SECRET, url: baseUrl() }]);
      const evil = await watchEvil(context);
      await page.goto('/frame/mal-cookie/1/desktop.html');
      expect(new URL(page.url()).pathname).toBe('/frame/mal-cookie/1/desktop.html');
      expect(await page.evaluate(() => self.origin)).toBe('null');
      // 作品が読む document.cookie はメモリだけの代わり（FRAME001）。本物の cookie は、オリジンがないので読めない
      expect(await page.evaluate(() => document.cookie)).toBe('');
      expect(await page.evaluate(readNativeCookie)).toBe('SecurityError');
      const root = page.locator('[data-ld-part="mal-cookie"]');
      await expect(root).toHaveAttribute('data-cookie', 'read');
      await expect(root).toHaveAttribute('data-fetch', 'blocked');
      await page.waitForLoadState('networkidle');
      expect(evil).toEqual([]);
    });

    test('mal-parent：親は自分自身で、オリジンは null。サイトには触れない', async ({ context, page }) => {
      await forgeHeader(context);
      await page.goto('/frame/mal-parent/1/desktop.html');
      expect(await page.evaluate(() => self.origin)).toBe('null');
      expect(await page.evaluate(() => window.parent === window)).toBe(true);
    });
  });

  test.describe('frame-ancestors', () => {
    const framePath = '/frame/fx-button/1/desktop.html';
    /** 同じ番号のポートで、ホスト名だけ変えた別のオリジン。 */
    const otherOrigin = () => {
      const url = new URL(baseUrl());
      url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      return url.origin;
    };
    /** origin のページを作り、サイトの枠を iframe で入れて開く。 */
    async function embedIn(page: Page, origin: string) {
      const src = new URL(framePath, baseUrl()).href;
      await page.route(`${origin}/__embed__`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>embed</title><iframe sandbox="allow-scripts allow-forms" src="${src}"></iframe>` }),
      );
      await page.goto(`${origin}/__embed__`);
    }

    test('ほかのオリジンのページから枠に入れると、表示されない', async ({ page }) => {
      await embedIn(page, otherOrigin());
      // ブラウザが枠の読み込みを断り、エラーのページになる。戻された（302）なら /p/fx-button になる
      await expect.poll(() => page.frames()[1]?.url()).toMatch(/^chrome-error:/);
      await expect(page.frameLocator('iframe').locator('[data-ld-part]')).toHaveCount(0);
    });

    test('対照：自分のオリジンのページなら表示される', async ({ page }) => {
      await embedIn(page, new URL(baseUrl()).origin);
      await expect(page.frameLocator('iframe').locator('[data-ld-part="fx-button"]')).toBeVisible();
    });

    test('対照：frame-ancestors を外すと、ほかのオリジンでも表示される（止めているのはこの指定）', async ({ page }) => {
      await page.route(`**${framePath}`, async (route) => {
        // route.fetch は Sec-Fetch-Dest を引き継がないので、ここで足す
        const response = await route.fetch({ headers: { ...route.request().headers(), ...FROM_IFRAME } });
        const csp = response.headers()['content-security-policy'];
        expect(csp).toContain("frame-ancestors 'self'");
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp.replace("; frame-ancestors 'self'", '') } });
      });
      await embedIn(page, otherOrigin());
      await expect(page.frameLocator('iframe').locator('[data-ld-part="fx-button"]')).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------- プレビュー

test.describe('プレビュー', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('2列：左が約65%、右が約35%、間隔32px。1023px以下は1列で、プレビューが上', async ({ page }) => {
    await openWork(page, 'fx-button');
    const left = (await page.locator('iframe').boundingBox())!;
    // 右の列は、タブの中身（「この作品について」から。WS003）
    const right = (await page.locator('[data-work-about]').boundingBox())!;
    expect(right.x - (left.x + left.width)).toBeGreaterThanOrEqual(31);
    expect(right.x - (left.x + left.width)).toBeLessThanOrEqual(33);
    const total = 1440 - 68 - 48 - 32;
    expect(Math.abs(left.width + 2 - total * 0.65)).toBeLessThan(3);

    await page.setViewportSize({ width: 1023, height: 900 });
    const narrowFrame = (await page.locator('iframe').boundingBox())!;
    const narrowAbout = (await page.locator('[data-work-about]').boundingBox())!;
    expect(narrowAbout.y).toBeGreaterThan(narrowFrame.y + narrowFrame.height);
    // 枠の線（1px）の外側と、箱の左の端がそろう
    expect(Math.abs(narrowFrame.x - 1 - narrowAbout.x)).toBeLessThan(2);
    // 頭（題名）は枠の上
    const narrowTitle = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(narrowTitle.y + narrowTitle.height).toBeLessThanOrEqual(narrowFrame.y);
  });

  test('部品：切り替えがなく、枠の中央に置かれ、地は作品の背景', async ({ page }) => {
    await openWork(page, 'fx-button');
    await expect(page.getByRole('button', { name: 'デスクトップ' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'もう一度' })).toHaveCount(0);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('[data-ld-part="fx-button"]')).toBeVisible();

    const iframe = (await page.locator('iframe').boundingBox())!;
    const part = (await frame.locator('[data-ld-part="fx-button"]').boundingBox())!;
    expect(Math.abs(part.x + part.width / 2 - (iframe.x + iframe.width / 2))).toBeLessThan(2);
    expect(Math.abs(part.y + part.height / 2 - (iframe.y + iframe.height / 2))).toBeLessThan(2);

    const box = page.locator('[class*="rounded-card"]:has(> iframe)');
    await expect(box).toHaveCSS('border-radius', '16px');
    await expect(box).toHaveCSS('border-color', 'rgb(236, 236, 240)');
    await expect(box).toHaveCSS('border-top-width', '1px');
  });

  test('Webの画面：Desktop は幅1280で描いて枠の幅に縮め、Mobile は幅390で中央に置く', async ({ page }) => {
    await openWork(page, 'fx-landing');
    const desktop = page.getByRole('button', { name: 'デスクトップ' });
    const mobile = page.getByRole('button', { name: 'モバイル' });
    await expect(desktop).toHaveAttribute('aria-pressed', 'true');
    await expect(mobile).toHaveAttribute('aria-pressed', 'false');

    const iframe = page.locator('iframe');
    const box = iframe.locator('..');
    await expect(iframe).toHaveAttribute('src', framedAt('/frame/fx-landing/1/desktop.html'));
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    expect(await iframe.evaluate((el: HTMLIFrameElement) => el.clientWidth)).toBe(1280);
    const boxWidth = (await box.evaluate((el) => el.clientWidth)) as number;
    const scaled = (await iframe.boundingBox())!;
    expect(Math.abs(scaled.width - boxWidth)).toBeLessThan(1);
    const hostWidth = await page.frameLocator('iframe').locator('#ld-host').evaluate((el) => el.ownerDocument.documentElement.clientWidth);
    expect(hostWidth).toBe(1280);

    await mobile.click();
    await expect(mobile).toHaveAttribute('aria-pressed', 'true');
    await expect(desktop).toHaveAttribute('aria-pressed', 'false');
    await expect(iframe).toHaveAttribute('src', framedAt('/frame/fx-landing/1/mobile.html'));
    expect(await iframe.evaluate((el: HTMLIFrameElement) => el.clientWidth)).toBe(390);
    const phone = (await iframe.boundingBox())!;
    expect(phone.width).toBe(390);
    const boxBounds = (await box.boundingBox())!;
    expect(Math.abs(phone.x + phone.width / 2 - (boxBounds.x + boxBounds.width / 2))).toBeLessThan(1);
    await expect(box).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('枠の地：枠の文書から「読み込めた」が来るまではページの地のまま、来たら作品の背景', async ({ page }) => {
    // 枠の文書の応答を止めておき、その間の入れ物の地を見る
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/frame/fx-landing/**', async (route) => {
      // route.fetch は Sec-Fetch-Dest を引き継がないので、ここで足す
      const response = await route.fetch({ headers: { ...route.request().headers(), ...FROM_IFRAME } });
      await held;
      await route.fulfill({ response });
    });
    // 枠の読み込みを止めているので、ページの load は待たない
    await page.goto('/p/fx-landing', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
    const iframe = page.locator('iframe[data-ld-frame]');
    const box = iframe.locator('..');
    await expect(iframe).toHaveAttribute('src', framedAt('/frame/fx-landing/1/desktop.html'));
    await expect(box).toHaveAttribute('data-frame-bg', '');
    await page.waitForTimeout(300);
    await expect(iframe).not.toHaveAttribute('data-ld-loaded');
    expect(await box.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

    release();
    await expect(iframe).toHaveAttribute('data-ld-loaded', '');
    await expect(box).toHaveCSS('background-color', 'rgb(247, 247, 244)');
  });

  test('スマホの画面：Mobile だけで、切り替えを出さない', async ({ page }) => {
    await openWork(page, 'fx-habits');
    await expect(page.getByRole('button', { name: 'デスクトップ' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'モバイル' })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveAttribute('src', framedAt('/frame/fx-habits/1/mobile.html'));
    expect(await page.locator('iframe').evaluate((el: HTMLIFrameElement) => el.clientWidth)).toBe(390);
  });

  test('幅390でも、スマホの枠は枠の幅に縮み、横にはみ出さない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-habits');
    const iframe = (await page.locator('iframe').boundingBox())!;
    const box = (await page.locator('iframe').locator('..').boundingBox())!;
    expect(iframe.width).toBeLessThanOrEqual(box.width);
    expect(iframe.height).toBeLessThanOrEqual(box.height + 1);
    expect(await pageOverflow(page)).toBe(0);
  });

  test('motion の作品：枠の右下の「もう一度」 でフレームを読み直す', async ({ page }) => {
    await openWork(page, 'fx-motion');
    const replay = page.getByRole('button', { name: 'もう一度' });
    const button = (await replay.boundingBox())!;
    const box = (await page.locator('iframe').locator('..').boundingBox())!;
    expect(box.x + box.width - (button.x + button.width)).toBeLessThan(20);
    expect(box.y + box.height - (button.y + button.height)).toBeLessThan(20);

    const loaded = page.waitForRequest((request) => request.url().endsWith('/frame/fx-motion/1/desktop.html'));
    await replay.click();
    await loaded;
    await expect(page.frameLocator('iframe').locator('[data-ld-part="fx-motion"]')).toBeAttached();
  });

  test('フォームの作品は枠の中で submit が届き、外へは出ない', async ({ context, page }) => {
    const evil = await watchEvil(context);
    await openWork(page, 'fx-form');
    const frame = page.frameLocator('iframe');
    await frame.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(frame.locator('[data-ld-part="fx-form"]').getByRole('alert').first()).toBeVisible();
    expect(evil).toEqual([]);
  });
});

// ---------------------------------------------------------------- コピー

test.describe('コピー', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('コピーした文字列の1行目がクレジット行と1文字も違わない。「全部をコピー」を押すと、ボタンが1.5秒「コピーしました」になり、コピー数が1増える', async ({ context, page, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ownOrigin() });
    const before = (await workFromApi(request, 'fx-button')).copies;
    await openWork(page, 'fx-button');
    await expect(page.getByTestId('copy-count')).toHaveText(String(before));

    const posted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/count' && response.request().postDataJSON().type === 'copy');
    const button = page.getByRole('button', { name: '全部をコピー' });
    const box = (await button.boundingBox())!;
    expect(box.height).toBe(44);
    await button.click();
    const response = await posted;
    expect(response.status()).toBe(204);
    const pressed = Date.now();

    // Windows のクリップボードは改行を CRLF にする。行の中身は1文字も変わらない
    const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(clipboard.split('\n')[0]).toBe('<!-- UI by @fixture — ludion.ai/p/fx-button (MIT) -->');
    expect(clipboard).toContain('/* UI by @fixture — ludion.ai/p/fx-button (MIT) */');
    expect(clipboard).toContain(readFileSync(join(REPO, 'fixtures/works/fx-button/part.css'), 'utf8').trim());
    // Worker が buildCopySnippet で作ったもの（/p/:id/code と同じ文字列）と全部同じ
    expect(clipboard).toBe(await (await request.get('/p/fx-button/code')).text());

    await expect(page.getByRole('button', { name: 'コピーしました' })).toBeVisible();
    await expect(page.getByTestId('copy-count')).toHaveText(String(before + 1));
    expect((await workFromApi(request, 'fx-button')).copies).toBe(before + 1);

    await expect(page.getByRole('button', { name: '全部をコピー' })).toBeVisible({ timeout: 3000 });
    const elapsed = Date.now() - pressed;
    expect(elapsed).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(2500);

    // 次に開いたときの数も D1 から入る
    await page.reload();
    await expect(page.getByTestId('copy-count')).toHaveText(String(before + 1));
  });

  test('コードの箱：コピー用の文字列を等幅で出す。高さは最大320pxでスクロールし、1行目のクレジット行が最初に見える', async ({ page }) => {
    await openWork(page, 'fx-landing');
    const code = page.locator('pre:has([data-ld-code])');
    await expect(code).toHaveCSS('font-family', /mono|consolas|courier/i);
    const box = (await code.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(320);
    const metrics = await code.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, text: el.textContent ?? '' }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.scrollTop).toBe(0);
    expect(metrics.text.split('\n')[0]).toBe('<!-- UI by @fixture — ludion.ai/p/fx-landing (MIT) -->');
    // 1行目が箱の中に見えている（折り返すので横に切れない）
    const firstLineFits = await code.evaluate((el) => {
      const range = document.createRange();
      const text = el.querySelector('code')!.firstChild!;
      range.setStart(text, 0);
      range.setEnd(text, text.textContent!.indexOf('\n'));
      const rect = range.getBoundingClientRect();
      const outer = el.getBoundingClientRect();
      return rect.left >= outer.left && rect.right <= outer.right && rect.top >= outer.top && rect.bottom <= outer.bottom;
    });
    expect(firstLineFits).toBe(true);
  });

  test('ライセンスの行。いいねとしおりは押す前の状態（押した後は e2e/accounts.spec.ts）', async ({ page }) => {
    await openWork(page, 'seed-trail-guide');
    await expect(page.getByText('MIT · コードの1行目に作者の名前が残ります')).toBeVisible();
    const like = page.getByRole('button', { name: /^いいね/ });
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(like.locator('svg')).toHaveAttribute('fill', 'none');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------- 作り方とレーベル

const byKind = (kind: Work['creator']['kind']) => seed.find((work) => work.creator.kind === kind)!;

test.describe('作り方は出さない（CLAUDE.md 原則9）', () => {
  // made_with は seed のデータにはあるが、公開の型にはない
  const seedMade = seed as (Work & { made_with: string })[];

  for (const made of ['human', 'ai-assisted']) {
    test(`${made} の作品：画面に作り方の文字がなく、HTML にも made_with がない`, async ({ page, request }) => {
      const work = seedMade.find((item) => item.made_with === made)!;
      await openWork(page, work.id);
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/(?<![A-Za-z])AI(?![A-Za-z])|手で作った/);
      expect(await (await request.get(`/p/${work.id}`)).text()).not.toContain('made_with');
    });
  }
});

test.describe('レーベルの表示（CLAUDE.md 原則10）', () => {
  test('label の作者：作品のページの名前の後ろに「· Ludion Studio のレーベル」、作り手のページの名前の下に1行', async ({ page }) => {
    const work = byKind('label');
    await openWork(page, work.id);
    const label = page.getByText('· Ludion Studio のレーベル', { exact: true });
    await expect(label).toBeVisible();
    await expect(label).toHaveCSS('font-size', '13px');
    await expect(label).toHaveCSS('color', 'rgb(107, 107, 118)');
    // 名前は数の行にある（頭の1行目は @handle。WS003）
    const name = (await page.locator('[data-work-counts]').getByRole('link', { name: work.creator.name }).boundingBox())!;
    expect((await label.boundingBox())!.x).toBeGreaterThan(name.x + name.width - 1);

    await page.goto(`/c/${work.creator.handle}`);
    const note = page.getByText('Ludion Studio のレーベル（運営が制作）', { exact: true });
    await expect(note).toBeVisible();
    await expect(note).toHaveCSS('font-size', '14px');
    await expect(note).toHaveCSS('color', 'rgb(107, 107, 118)');
    expect((await note.boundingBox())!.y).toBeGreaterThan((await page.getByRole('heading', { level: 1 }).boundingBox())!.y);
  });

  test('person の作者：どちらのページにも出ない', async ({ page }) => {
    const work = byKind('person');
    await openWork(page, work.id);
    await expect(page.getByText(/Ludion Studio のレーベル/)).toHaveCount(0);
    await page.goto(`/c/${work.creator.handle}`);
    await expect(page.getByText(/Ludion Studio のレーベル/)).toHaveCount(0);
    await expect(page.getByText(/made by the Ludion team/)).toHaveCount(0);
  });

  test('Worker の HTML にもレーベルの表示が入っている（JS なしでも、共有のプレビューでも）', async ({ request }) => {
    const work = byKind('label');
    expect(await (await request.get(`/p/${work.id}`)).text()).toContain('· Ludion Studio のレーベル');
    expect(await (await request.get(`/c/${work.creator.handle}`)).text()).toContain('Ludion Studio のレーベル（運営が制作）');
    const person = byKind('person');
    const personPage = (await (await request.get(`/p/${person.id}`)).text()).replace(/<script[\s\S]*?<\/script>/g, '');
    expect(personPage).not.toContain('Ludion Studio のレーベル');
  });
});

// ---------------------------------------------------------------- 閲覧数とコピー数

test.describe('POST /api/count', () => {
  const data = { work_id: 'fx-toggle', type: 'view' };

  test('外の Origin は 403。Origin がなくても、作品の枠（null）でも 403。数は増えない', async ({ request }) => {
    const before = await workFromApi(request, 'fx-toggle');
    const cases: Record<string, string>[] = [{ Origin: 'https://evil.example' }, { Origin: 'null' }, {}, { Origin: `${ownOrigin()}.evil.example` }];
    for (const headers of cases) {
      const response = await request.post('/api/count', { headers, data });
      expect(response.status(), JSON.stringify(headers)).toBe(403);
      expect(response.headers()['cache-control']).toBe('private, no-store');
    }
    const after = await workFromApi(request, 'fx-toggle');
    expect(after.views).toBe(before.views);
  });

  test('承認済みの作品でなければ 400。type が違っても 400', async ({ request }) => {
    const headers = { Origin: ownOrigin() };
    expect((await request.post('/api/count', { headers, data: { work_id: 'nothing-here', type: 'view' } })).status()).toBe(400);
    for (const body of [{ work_id: 'fx-toggle', type: 'like' }, { work_id: 'fx-toggle', type: 'constructor' }, { work_id: 'fx-toggle' }, { type: 'view' }, { work_id: 1, type: 'view' }]) {
      expect((await request.post('/api/count', { headers, data: body })).status(), JSON.stringify(body)).toBe(400);
    }
    expect((await request.post('/api/count', { headers, data: 'not json' })).status()).toBe(400);
  });

  test('その日の行を1つ増やす。cookie を返さない', async ({ request }) => {
    const headers = { Origin: ownOrigin() };
    const before = await workFromApi(request, 'seed-course-landing');
    const view = await request.post('/api/count', { headers, data: { work_id: 'seed-course-landing', type: 'view' } });
    expect(view.status()).toBe(204);
    expect(view.headers()['set-cookie']).toBeUndefined();
    await request.post('/api/count', { headers, data: { work_id: 'seed-course-landing', type: 'copy' } });
    const after = await workFromApi(request, 'seed-course-landing');
    expect(after.views).toBe(before.views + 1);
    expect(after.copies).toBe(before.copies + 1);
    expect(after.copies_30d).toBe(before.copies_30d + 1);
  });

  test('作品のページを開くと閲覧を1回だけ送り、数は Worker が D1 から入れる', async ({ page, request }) => {
    const id = 'seed-film-catalog';
    const before = await workFromApi(request, id);
    const posts: unknown[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/count') posts.push(r.postDataJSON());
    });
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/count');
    await openWork(page, id);
    expect((await answered).status()).toBe(204);
    await page.waitForLoadState('networkidle');
    expect(posts).toEqual([{ work_id: id, type: 'view' }]);
    expect((await workFromApi(request, id)).views).toBe(before.views + 1);
  });

  test('閲覧の数は作品のページに API と同じ値で出る。ホームの並びには出さない', async ({ page, request }) => {
    const id = 'fx-nav';
    const work = await workFromApi(request, id);
    const html = await (await request.get('/?q=harbor')).text();
    expect(html).not.toContain('見られた数');
    await page.goto(`/p/${id}`);
    await expect(page.getByText(`見られた数 ${work.views}`, { exact: true }).first()).toBeAttached();
  });
});

// ---------------------------------------------------------------- 作者とリンク

test.describe('作品のページの情報', () => {
  test('題名、2行目、アバター32px、作者のリンク、X のリンク', async ({ page }) => {
    const work = seed.find((item) => item.creator.handle === 'seed_a')!;
    await openWork(page, work.id);
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toHaveText(work.title);
    await expect(title).toHaveCSS('font-size', '24px');
    await expect(title).toHaveCSS('font-weight', '700');
    // 種類は、頭の札（WS003）
    const meta = page.getByText(`${copy.categories[work.category] ?? work.category} · ${copy.subtypes[work.subtype] ?? work.subtype}`, { exact: true }).first();
    await expect(meta).toHaveCSS('font-size', '12px');
    await expect(meta).toHaveCSS('color', 'rgb(74, 74, 85)');
    // 頭の1行目に @handle（作り手のページへ）
    await expect(page.locator('[data-work-head]').getByRole('link', { name: '@seed_a', exact: true })).toHaveAttribute('href', '/c/seed_a');

    const author = page.getByRole('link', { name: work.creator.name }).first();
    await expect(author).toHaveAttribute('href', '/c/seed_a');
    const avatar = page.locator('img[width="32"]');
    await expect(avatar).toHaveJSProperty('complete', true);
    expect((await avatar.boundingBox())!.width).toBe(32);

    // X はロゴと矢印で出し、別のタブで開くことを読み上げでも伝える
    const x = page.getByRole('link', { name: 'X を新しいタブで開く', exact: true });
    await expect(x).toHaveAttribute('href', 'https://x.com/seed_a');
    await expect(x).toHaveAttribute('target', '_blank');
    await expect(x).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(x.locator('svg')).toHaveCount(2);
    await expect(x).toHaveText('');
  });

  for (const width of [1440, 390]) {
    test(`幅${width}：作者の名前は、作品のページ、作り手のページ、コピーするコードの1行目に出る（原則4）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openWork(page, 'fx-button');
      await expect(page.getByRole('main').getByRole('link', { name: 'Fixture', exact: true })).toBeVisible();
      const code = await page.locator('pre code').textContent();
      expect(code!.split('\n')[0]).toBe('<!-- UI by @fixture — ludion.ai/p/fx-button (MIT) -->');

      await page.goto('/c/fixture');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture');
      await expect(page.getByText('@fixture', { exact: true }).first()).toBeVisible();
    });
  }

  test('X のURLがない作者には、リンクを出さない（作品のページ）', async ({ page }) => {
    await openWork(page, 'fx-button');
    await expect(page.getByRole('link', { name: 'X を新しいタブで開く', exact: true })).toHaveCount(0);
  });

  test('ほかの作品を全部並べる：同じ作者が先、次にほかの作者、それぞれ Popular の順。ホームと同じカードで（T018）', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-button');
    const works = (await worksFromApi(request)).filter((work) => work.id !== 'fx-button');
    const same = works.filter((work) => work.creator.handle === 'fixture');
    const other = works.filter((work) => work.creator.handle !== 'fixture');
    expect(same.length).toBeGreaterThan(4);
    expect(other.length).toBeGreaterThan(0);

    const headings = page.locator('section:has([data-masonry]) > h2');
    await expect(headings).toHaveText(['@fixture のほかの作品', 'ほかの作品']);
    const lists = page.locator('[data-masonry][data-placed]');
    await expect(lists).toHaveCount(2);
    const hrefs = (index: number) => lists.nth(index).locator('> article > a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(await hrefs(0)).toEqual(same.map((work) => `/p/${work.id}`));
    expect(await hrefs(1)).toEqual(other.map((work) => `/p/${work.id}`));
    expect((await lists.nth(0).locator('> article').first().boundingBox())!.width).toBeGreaterThan(200);
    // 下の並びは重ならない
    const first = (await lists.nth(0).boundingBox())!;
    const second = (await lists.nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    await expect(page.locator('iframe')).toHaveCount(1); // 並びでは作品を動かさない（CLAUDE.md「描画」）
  });

  test('下の並びは先に読まない：eager も fetchpriority も持たず、load の後に読む（T018。LCP の画像と回線を取り合わない）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const html = await (await page.request.get('/p/fx-button')).text();
    expect(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').match(/<article[\s\S]*?<\/article>/g)?.join('')).not.toMatch(/\bsrc=|fetchPriority|loading="eager"/);
    await openWork(page, 'fx-button');
    const thumb = page.locator('[data-masonry] > article > a > img').first();
    await thumb.scrollIntoViewIfNeeded();
    await expect.poll(() => thumb.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const shapes = await page.locator('[data-masonry] > article > a > img').evaluateAll((images) => images.map((image) => [image.getAttribute('loading'), image.getAttribute('fetchpriority')]));
    for (const [loading, priority] of shapes) {
      expect(loading).toBe('lazy');
      expect(priority).toBeNull();
    }
  });

  test('並びは React を待たずに2つとも置かれる（beforeApp）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto('/p/fx-button');
    const lists = page.locator('[data-masonry]');
    await expect(lists).toHaveCount(2);
    for (const index of [0, 1]) {
      expect((await lists.nth(index).boundingBox())!.height).toBeGreaterThan(0);
      const lefts = await lists.nth(index).locator('> article').evaluateAll((cards) => cards.map((card) => (card as HTMLElement).style.left));
      expect(lefts.every(Boolean)).toBe(true);
    }
  });

  test('カードから作品のページへ移ると、Worker が描いたページが開く', async ({ page }) => {
    await page.goto('/?q=ember');
    await page.locator('article > a').first().click();
    await expect(page).toHaveURL('/p/fx-button');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ember Buttons');
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  });

  test('ヘッダーとサイドバーはホームと同じ。ロゴからホームへ戻ると一覧が出て、題名も戻る', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-button');
    await expect(page.locator('header').getByRole('link', { name: 'Ludion' })).toBeVisible();
    await expect(page.getByRole('complementary').getByRole('link', { name: 'ホーム' })).toBeVisible();
    await expect(page).toHaveTitle('Ember Buttons（@fixture）· Ludion');
    await page.locator('header').getByRole('link', { name: 'Ludion' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('article').first()).toBeVisible();
    await expect(page).toHaveTitle('Ludion');
  });

  test('ない作品は 404', async ({ page, request }) => {
    expect((await request.get('/p/nothing-here')).status()).toBe(404);
    await page.goto('/p/nothing-here');
    await expect(page.getByText('このページはありません')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  // docs/tasks/T013.md「1」
  test('知らない道は 404 のページ。ホームへ戻れる。深い道、ドットで始まる道、HEAD も同じ', async ({ page, request }) => {
    for (const path of ['/nothing-here', '/a/b/c', '/.prod.vars', '/assets/nothing.js', '/index.htm']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()['cache-control'], path).toBe('private, no-store');
      expect(await response.text(), path).toContain('このページはありません');
      expect((await request.head(path)).status(), `HEAD ${path}`).toBe(404);
    }
    const response = await page.goto('/nothing-here');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle('ページが見つかりません · Ludion');
    await page.getByRole('link', { name: 'ホームに戻る' }).click();
    await expect(page).toHaveURL('/');
  });

  test('robots.txt はテキストで返り、作品のページと OG 画像の道を止めない', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    const text = await response.text();
    expect(text).toContain('User-agent: *');
    expect(text).not.toContain('<html');
    // コードを文字で返す口は検索に出さない（docs/tasks/T031.md「1」）。作品のページそのものは止めない
    expect(text).toContain('Disallow: /p/*/code');
    for (const line of text.split('\n').filter((row) => row.startsWith('Disallow:'))) {
      expect(['/p/', '/c/', '/w/'].some((path) => path.startsWith(line.slice('Disallow:'.length).trim())), line).toBe(false);
    }
  });
});

test.describe('作り手のページ', () => {
  test('アバター64px、名前、@handle、X とサイトのリンク、作品数、閲覧数とコピー数の合計、カードと石組み', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const works = (await worksFromApi(request)).filter((work) => work.creator.handle === 'seed_a');
    await page.goto('/c/seed_a');
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('@seed_a');
    await expect(page.getByText('@seed_a', { exact: true }).nth(1)).toBeVisible();
    expect((await page.locator('img[width="64"]').boundingBox())!.width).toBe(64);
    const x = page.getByRole('link', { name: 'X を新しいタブで開く', exact: true });
    await expect(x).toHaveAttribute('href', 'https://x.com/seed_a');
    await expect(x).toHaveAttribute('target', '_blank');
    await expect(x.locator('svg')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'サイト', exact: true })).toHaveAttribute('href', 'https://seed-a.example');

    await expect(page.getByText(`${works.length}作品`, { exact: true })).toBeVisible();
    const fmt = formatCount;
    await expect(page.getByText(`見られた数 ${fmt(works.reduce((sum, work) => sum + work.views, 0))}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`コピーされた数 ${fmt(works.reduce((sum, work) => sum + work.copies, 0))}`, { exact: true })).toBeVisible();

    await expect(page.locator('[data-masonry] > article')).toHaveCount(works.length);
    const hrefs = await page.locator('article > a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(works.map((work) => `/p/${work.id}`)); // Popular の順
    await expect(page.locator('iframe')).toHaveCount(0); // 一覧では作品を動かさない（CLAUDE.md「描画」）
  });

  test('handle は大文字と小文字を区別しない。ない作者は 404', async ({ page, request }) => {
    expect((await request.get('/c/SEED_A')).status()).toBe(200);
    await page.goto('/c/SEED_A');
    await expect(page.locator('[data-masonry] > article').first()).toBeAttached();
    expect((await request.get('/c/nobody-here')).status()).toBe(404);
  });

  test('作者の名前から作り手のページへ移れる', async ({ page }) => {
    await openWork(page, 'fx-button');
    await page.getByRole('link', { name: 'Fixture', exact: true }).first().click();
    await expect(page).toHaveURL('/c/fixture');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture');
  });
});

// ---------------------------------------------------------------- OG

/** Worker の HTML の <head> から、meta の値を読む。 */
function metaOf(html: string, attribute: 'property' | 'name', key: string): string | undefined {
  return new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`).exec(html)?.[1];
}

test.describe('共有されるページの OG', () => {
  test('作品のページ：title、og:title、og:image（og.png）、twitter:card', async ({ request }) => {
    const html = await (await request.get('/p/fx-button')).text();
    expect(/<title>([^<]*)<\/title>/.exec(html)![1]).toBe('Ember Buttons（@fixture）· Ludion');
    expect(metaOf(html, 'property', 'og:title')).toBe('Ember Buttons（@fixture）· Ludion');
    expect(metaOf(html, 'name', 'twitter:card')).toBe('summary_large_image');
    const image = metaOf(html, 'property', 'og:image')!;
    expect(image).toBe(new URL('/w/fx-button/1/og.png', baseUrl()).href);

    const response = await request.get(image);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    // OG 画像はキャッシュを許す一覧に入っていない（docs/tasks/T012.md「1」）
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect((await response.body()).equals(readFileSync(join(REPO, 'fixtures/works/fx-button/og.png')))).toBe(true);
  });

  test('作り手のページ：og:image は最初の作品の og.png', async ({ page, request }) => {
    const html = await (await request.get('/c/fixture')).text();
    expect(/<title>([^<]*)<\/title>/.exec(html)![1]).toBe('Fixture（@fixture）· Ludion');
    expect(metaOf(html, 'property', 'og:title')).toBe('Fixture（@fixture）· Ludion');
    expect(metaOf(html, 'name', 'twitter:card')).toBe('summary_large_image');
    await page.goto('/c/fixture');
    const first = await page.locator('article > a').first().getAttribute('href');
    expect(metaOf(html, 'property', 'og:image')).toBe(new URL(`/w/${first!.replace('/p/', '')}/1/og.png`, baseUrl()).href);
  });

  test('作品のページと作り手のページの canonical は ludion.ai（T016）', async ({ request }) => {
    expect(await (await request.get('/p/fx-button')).text()).toContain('<link rel="canonical" href="https://ludion.ai/p/fx-button">');
    expect(await (await request.get('/c/FIXTURE')).text()).toContain('<link rel="canonical" href="https://ludion.ai/c/fixture">');
  });
});

// ---------------------------------------------------------------- アクセシビリティと画面幅

test.describe('axe-core（critical と serious が0件）', () => {
  const PAGES = [
    { label: '部品', path: '/p/fx-button' },
    { label: 'Webの画面', path: '/p/fx-landing' },
    { label: 'スマホの画面', path: '/p/fx-habits' },
    { label: '動く部品', path: '/p/fx-motion' },
    { label: 'レーベルの作品', path: `/p/${byKind('label').id}` },
    { label: '作り手', path: '/c/fixture' },
    { label: 'レーベルの作り手', path: `/c/${byKind('label').creator.handle}` },
    { label: '404', path: '/p/nothing-here' },
  ];
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const { label, path } of PAGES) {
      test(`幅${width}：${label}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await runAxe(page, `${width} ${label}`)).toEqual([]);
        expect(await pageOverflow(page)).toBe(0);
      });
    }
  }

  test('「コピーしました」の間', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ownOrigin() });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-toggle');
    await page.getByRole('button', { name: '全部をコピー' }).click();
    expect(await runAxe(page, '1440 押した後')).toEqual([]);
  });
});

test.describe('キーボード', () => {
  test('デスクトップ／モバイル、いいね、しおり、全部をコピー、コードの箱にフォーカスが入り、枠が見える', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-landing');
    for (const target of [
      page.getByRole('button', { name: 'モバイル' }),
      page.getByRole('button', { name: /^いいね/ }),
      page.getByRole('button', { name: '保存', exact: true }),
      page.getByRole('button', { name: '共有', exact: true }),
      page.getByRole('button', { name: '全部をコピー' }),
      page.locator('pre'),
    ]) {
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS('outline-style', 'solid');
      await expect(target).toHaveCSS('outline-width', '2px');
    }
  });
});

// T018：バズで来た人の着地点（docs/tasks/T018.md）
test.describe('コードの箱のたたみ', () => {
  const CREDIT = '<!-- UI by @fixture — ludion.ai/p/fx-landing (MIT) -->';
  const toggle = (page: Page) => page.getByRole('button', { name: /^コードを(全部見る|たたむ)$/ });

  /** 1行目のクレジット行が、箱の見えている範囲に全部入っているか */
  const creditVisible = (page: Page) =>
    page.locator('pre').evaluate((el) => {
      const text = el.querySelector('code')!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, text.textContent!.indexOf('\n'));
      const rect = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom && rect.left >= box.left && rect.right <= box.right;
    });

  for (const width of [390, 767]) {
    test(`幅${width}：3行だけを見せ、aria-expanded で開閉する。開くと320pxまで`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openWork(page, 'fx-landing');
      const code = page.locator('pre');
      const button = toggle(page);

      await expect(button).toHaveText('コードを全部見る');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toHaveAttribute('aria-controls', (await code.getAttribute('id'))!);
      expect((await code.boundingBox())!.height).toBe(74); // 16px × 3行 ＋ 余白 ＋ 枠
      expect(await creditVisible(page)).toBe(true);

      await button.click();
      await expect(button).toHaveText('コードをたたむ');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      const open = (await code.boundingBox())!.height;
      expect(open).toBeGreaterThan(74);
      expect(open).toBeLessThanOrEqual(320);

      // 中をスクロールしてからたたんでも、クレジット行に戻る
      await code.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      expect((await code.boundingBox())!.height).toBe(74);
      expect(await creditVisible(page)).toBe(true);
    });
  }

  test('幅390：たたんだままでも「全部をコピー」は全部をコピーする', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-landing');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: '全部をコピー' }).click();
    await expect(page.getByRole('button', { name: 'コピーしました' })).toBeVisible();
    const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(clipboard).toBe(await (await page.request.get('/p/fx-landing/code')).text());
    expect(clipboard.split('\n')[0]).toBe(CREDIT);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  });

  for (const width of [768, 1440]) {
    test(`幅${width}：今のまま。開閉のボタンを出さず、たたまない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openWork(page, 'fx-landing');
      await expect(toggle(page)).toBeHidden();
      const box = (await page.locator('pre').boundingBox())!;
      expect(box.height).toBeGreaterThan(74);
      expect(box.height).toBeLessThanOrEqual(320);
      await expect(page.locator('pre')).toHaveCSS('overflow-y', 'auto');
    });
  }
});

test.describe('共有', () => {
  const SHARED_URL = 'https://ludion.ai/p/fx-toggle';

  /** navigator.share を置き換える。呼ばれた値は window.__shared、結果は failWith で決める */
  const stubShare = (page: Page, failWith?: string) =>
    page.addInitScript((name) => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      navigator.share = async (data) => {
        (window as unknown as { __shared: unknown[] }).__shared.push(data);
        if (name) throw new DOMException('stub', name);
      };
    }, failWith ?? '');
  const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared);
  const noShare = (page: Page) =>
    page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });

  test('navigator.share に題名と本番の URL を渡す', async ({ page }) => {
    await stubShare(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    const title = await page.getByRole('heading', { level: 1 }).textContent();
    await page.getByRole('button', { name: '共有', exact: true }).click();
    await expect.poll(() => shared(page)).toEqual([{ title, url: SHARED_URL }]);
    await expect(page.getByRole('button', { name: '共有', exact: true })).toBeVisible();
  });

  test('使えないブラウザ：URL をクリップボードに入れ、1.5秒だけ「リンクをコピーしました」と出す', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await noShare(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    await page.getByRole('button', { name: '共有', exact: true }).click();
    await expect(page.getByRole('button', { name: 'リンクをコピーしました' })).toBeVisible();
    const pressed = Date.now();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SHARED_URL);
    await expect(page.getByRole('status').filter({ hasText: 'リンクをコピーしました' })).toBeAttached();
    await expect(page.getByRole('button', { name: '共有', exact: true })).toBeVisible({ timeout: 3000 });
    const elapsed = Date.now() - pressed;
    expect(elapsed).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(2500);
  });

  test('共有の画面を閉じただけなら、クリップボードに触らない。ほかの失敗ならクリップボードへ', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubShare(page, 'AbortError');
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await page.getByRole('button', { name: '共有', exact: true }).click();
    await expect.poll(() => shared(page)).toHaveLength(1);
    await expect(page.getByRole('button', { name: '共有', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');

    const other = await context.newPage();
    await stubShare(other, 'NotAllowedError');
    await other.setViewportSize({ width: 390, height: 844 });
    await openWork(other, 'fx-toggle');
    await other.getByRole('button', { name: '共有', exact: true }).click();
    await expect(other.getByRole('button', { name: 'リンクをコピーしました' })).toBeVisible();
    expect(await other.evaluate(() => navigator.clipboard.readText())).toBe(SHARED_URL);
  });

  test('幅390：共有のボタンは、いいねとしおりと同じ行で、44pxの高さ。「リミックス」のすぐ下（WS003）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    const like = (await page.getByRole('button', { name: /^いいね/ }).boundingBox())!;
    const save = (await page.getByRole('button', { name: '保存', exact: true }).boundingBox())!;
    const share = (await page.getByRole('button', { name: '共有', exact: true }).boundingBox())!;
    const remix = (await page.getByRole('button', { name: 'リミックス', exact: true }).boundingBox())!;
    expect(share.height).toBe(44);
    expect([save.y, share.y]).toEqual([like.y, like.y]);
    expect(like.y).toBe(remix.y + remix.height + 12);
    // 3つで幅を分ける（間隔12px）
    expect(Math.abs(like.width - share.width)).toBeLessThan(1);
    expect(share.x + share.width).toBeCloseTo(390 - 24, 0);
  });
});

test.describe('GA4 のイベント（SPEC 15）', () => {
  type Sent = [name: string, params: Record<string, unknown>];

  /** ludion.ai の外では gtag を読まないので、置き換えて受け取る。ページを移っても残るよう、テストの側に記録する */
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

  test('share：work_id と method（native、clipboard）', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sent = await watchEvents(page);
    await page.addInitScript(() => {
      navigator.share = async () => {};
    });
    await openWork(page, 'fx-toggle');
    await page.getByRole('button', { name: '共有', exact: true }).click();
    await expect.poll(() => sent).toEqual([['share', { work_id: 'fx-toggle', method: 'native' }]]);

    sent.length = 0;
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }));
    await page.getByRole('button', { name: '共有', exact: true }).click();
    await expect.poll(() => sent).toEqual([['share', { work_id: 'fx-toggle', method: 'clipboard' }]]);
  });

  test('copy_code：コピーできたときだけ', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sent = await watchEvents(page);
    await openWork(page, 'fx-toggle');
    await page.getByRole('button', { name: '全部をコピー' }).click();
    await expect.poll(() => sent).toEqual([['copy_code', { work_id: 'fx-toggle' }]]);

    sent.length = 0;
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('stub'));
    });
    await expect(page.getByRole('button', { name: '全部をコピー' })).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '全部をコピー' }).click();
    await expect(page.getByRole('button', { name: 'コピーできませんでした' })).toBeVisible();
    expect(sent).toEqual([]);
  });

  test('save_click：ログインへ移る前に送る。ログインの情報は載せない（原則6）', async ({ page }) => {
    const sent = await watchEvents(page);
    await openWork(page, 'fx-toggle');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => sent).toEqual([['save_click', { work_id: 'fx-toggle' }]]);
  });

  test('select_work：並びのカードを押すと、元と先の作品を送って移る。ホームのカードでは送らない', async ({ page }) => {
    const sent = await watchEvents(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    const card = page.locator('[data-masonry][data-placed] > article > a').first();
    const to = (await card.getAttribute('href'))!.replace('/p/', '');
    await card.click();
    await expect(page).toHaveURL(`/p/${to}`);
    expect(sent).toEqual([['select_work', { from_work_id: 'fx-toggle', to_work_id: to }]]);

    sent.length = 0;
    await page.goto('/');
    await page.locator('[data-masonry][data-placed] > article > a').first().click();
    await page.getByRole('heading', { level: 1 }).waitFor();
    expect(sent).toEqual([]);
  });

  // ビルドの印の確かめは e2e/analytics.spec.ts
  test('手元では gtag を読まず、送らない', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      if (/googletagmanager|google-analytics/.test(request.url())) external.push(request.url());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    await page.getByRole('button', { name: '共有', exact: true }).focus();
    expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined');
    expect(external).toEqual([]);
  });
});

test.describe('下のタブ（幅390）', () => {
  test('最後のカードを隠さない。ページの下に余白がある', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    await page.locator('[data-masonry][data-placed]').first().waitFor({ state: 'attached' });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const { lowestCard, tabsTop } = await page.evaluate(() => ({
      lowestCard: Math.max(...[...document.querySelectorAll('article')].map((card) => card.getBoundingClientRect().bottom)),
      // サイドバーにも同じ名前の nav があり、この幅では隠れている
      tabsTop: Math.min(
        ...[...document.querySelectorAll('nav[aria-label="メイン"] a')]
          .map((tab) => tab.getBoundingClientRect())
          .filter((box) => box.height > 0)
          .map((box) => box.top),
      ),
    }));
    expect(lowestCard).toBeGreaterThan(0);
    expect(lowestCard).toBeLessThanOrEqual(tabsTop);
  });

  test('コピーのボタンの上に、下のタブが重ならない位置までスクロールできる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    const button = page.getByRole('button', { name: '全部をコピー' });
    await button.scrollIntoViewIfNeeded();
    await button.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const hit = await button.evaluate((el) => {
      const { left, right, top, bottom } = el.getBoundingClientRect();
      return document.elementFromPoint((left + right) / 2, (top + bottom) / 2) === el;
    });
    expect(hit).toBe(true);
  });
});

test.describe('英語のページ（SPEC 9）', () => {
  test('作品のページと作り手のページが英語で描かれ、リンクも英語のページへ行く', async ({ page, request }) => {
    const [work] = await worksFromApi(request);
    const response = await page.goto(`/en/p/${work.id}`);
    expect(response!.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: copyEn.work.copyCode })).toBeVisible();
    // 種類の札（幅で置き場所が変わるので2つ描いてある。見えているのは1つ）
    await expect(page.getByText(`${work.category} · ${work.subtype}`, { exact: true }).locator('visible=true')).toHaveCount(1);
    await expect(page).toHaveTitle(copyEn.work.pageTitle(work.title, work.creator.handle));
    const creatorLink = page.locator(`main a[href="/en/c/${work.creator.handle}"]`).first();
    await creatorLink.click();
    await expect(page).toHaveURL(new RegExp(`/en/c/${work.creator.handle}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-masonry] a[href^="/en/p/"]').first()).toBeVisible();
  });

  test('英語のブラウザが日本語の URL を開いても、閲覧数は1回だけ', async ({ browser, baseURL, request }) => {
    const [work] = await worksFromApi(request);
    const context = await browser.newContext({ locale: 'en-US', baseURL });
    const page = await context.newPage();
    const counts: string[] = [];
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/count') counts.push(new URL(sent.frame().url()).pathname);
    });
    await page.goto(`/p/${work.id}`);
    await expect(page).toHaveURL(new RegExp(`/en/p/${work.id}$`));
    await expect(page.getByRole('button', { name: copyEn.work.copyCode })).toBeVisible();
    await page.waitForTimeout(500);
    expect(counts).toEqual([`/en/p/${work.id}`]);
    await context.close();
  });
});
