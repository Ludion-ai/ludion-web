// GitHub のログイン、いいね、しおり（docs/tasks/T009.md）。手元の偽の GitHub（scripts/fake-github.mjs）で通す。
// 1つのテストごとに別の人でログインするので、互いの行に触らない。順に走る（playwright.config.ts に理由）。

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageOverflow } from './helpers';
import { flowCookies } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;
const WORK = 'seed-trail-guide';
const OTHER_WORK = 'seed-portfolio-landing';
const CARD_SAVE = 'Trail Guide Appを保存';
const RETRY = '/login?error=login_retry';

const ownOrigin = () => new URL(test.info().project.use.baseURL!).origin;
const newLogin = (label: string) => `${label}-${randomBytes(5).toString('hex')}`;
const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** テストの D1 に SQL を投げる（wrangler の手元の D1。サーバーと同じ場所）。 */
async function d1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const userRow = async (login: string) =>
  (
    await d1<{ id: string; handle: string; display_name: string | null; avatar_url: string; subject: string; label: string }>(
      `SELECT u.id, u.handle, u.display_name, u.avatar_url, i.subject, i.label FROM users u JOIN identities i ON i.user_id = u.id WHERE i.provider = 'github' AND i.label = ${quote(login)}`,
    )
  )[0];

const countRows = async (table: 'likes' | 'bookmarks' | 'sessions', userId: string, workId?: string) => {
  const where = workId ? ` AND work_id = ${quote(workId)}` : '';
  return (await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ${quote(userId)}${where}`))[0].n;
};

/** ブラウザではない訪問者。cookie の見出しをそのまま確かめるため、自分で持つ。 */
class Visitor {
  cookies = new Map<string, string>();
  /** いちばん新しい応答の Set-Cookie の生の行 */
  lastSetCookie: string[] = [];

  async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    const response = await fetch(new URL(path, ownOrigin()), { redirect: 'manual', ...init, headers });
    this.lastSetCookie = response.headers.getSetCookie();
    for (const line of this.lastSetCookie) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  post(path: string, origin: string | null = ownOrigin()) {
    return this.fetch(path, { method: 'POST', headers: origin === null ? {} : { Origin: origin } });
  }

  /** ログインの最初の一歩。GitHub へ送られる URL を返す。 */
  async startLogin(next = '/') {
    const response = await this.fetch(`/auth/github?next=${encodeURIComponent(next)}`);
    expect(response.status).toBe(302);
    return new URL(response.headers.get('location')!);
  }

  /** ログインを最後まで通す。callback の応答を返す。 */
  async login(login: string, { next = '/', name }: { next?: string; name?: string } = {}) {
    const authorize = await this.startLogin(next);
    authorize.searchParams.set('login_as', login);
    if (name) authorize.searchParams.set('name_as', name);
    const back = await fetch(authorize, { redirect: 'manual' });
    return this.fetch(back.headers.get('location')!);
  }

  async me() {
    return (await this.fetch('/api/me')).json();
  }
}

async function loggedIn(login: string) {
  const visitor = new Visitor();
  const response = await visitor.login(login);
  expect(response.status).toBe(302);
  return visitor;
}

const avatarButton = (page: Page) => page.getByRole('button', { name: 'アカウントのメニュー' });
/** ログインの画面で GitHub を選ぶ。 */
const chooseGitHub = (page: Page) => page.getByRole('link', { name: 'GitHub でログイン' }).click();

/** 偽の GitHub に「この人でログインする」と伝える。 */
async function signInAs(context: BrowserContext, login: string) {
  await context.addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
}

/** ブラウザでログインして、path を開く。 */
async function openLoggedIn(page: Page, login: string, path = '/') {
  await signInAs(page.context(), login);
  await page.goto(`/auth/github?next=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(path);
  await expect(avatarButton(page)).toBeVisible();
}

const toggleResponse = (page: Page, kind: 'like' | 'bookmark') =>
  page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/${kind}`));

async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}：${v.nodes[0]?.target}`);
}

test.beforeAll(async () => {
  // 承認済みでない作品（何度流してもよい。ワーカーごとに動くので、作者も行も作り直さない）
  const sql = (id: string, status: string) =>
    `INSERT OR IGNORE INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at)
     SELECT ${quote(id)}, creator_id, 'Not public', type, category, subtype, made_with, version, ${quote(status)}, thumb_key, thumb_w, thumb_h, created_at FROM works WHERE id = ${quote(WORK)}`;
  await d1(sql('acc-draft', 'draft'));
  await d1(sql('acc-rejected', 'rejected'));
});

// ---------------------------------------------------------------- 通しの動き

test.describe('通しの動き', () => {
  test('ログイン → しおり → /saved に出る → ログアウト', async ({ page, context }) => {
    const login = newLogin('flow');
    await signInAs(context, login);

    // ログイン：今のパスに戻る
    await page.goto('/?c=mobile');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await chooseGitHub(page);
    await expect(page).toHaveURL('/?c=mobile');

    // 2つのボタンの場所に、36px の円のアバター
    await expect(avatarButton(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toHaveCount(0);
    const avatar = avatarButton(page).locator('img');
    await expect(avatar).toHaveAttribute('src', `${FAKE_GITHUB}/avatars/${login}.svg`);
    await expect(avatar).toHaveCSS('width', '36px');
    await expect(avatar).toHaveCSS('height', '36px');
    await expect(avatar).toHaveCSS('border-radius', '999px');
    await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    // しおり：その場で切り替わる
    const save = page.getByRole('button', { name: CARD_SAVE });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    const saved = toggleResponse(page, 'bookmark');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(save).toHaveText('保存済み');
    expect((await saved).status()).toBe(200);
    await expect(page).toHaveURL('/?c=mobile');

    // メニューの Saved から /account/saved へ。同じカードと石組み
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: '保存した作品' }).click();
    await expect(page).toHaveURL('/account/saved');
    await expect(page).toHaveTitle('保存した作品 · Ludion');
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('[data-masonry][data-placed]')).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Trail Guide App' })).toBeVisible();
    await expect(page.getByRole('button', { name: CARD_SAVE })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.locator('article a > img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    // ログアウト：アカウントのページにいたらホームへ。ボタンが戻り、cookie も行も消える
    const user = await userRow(login);
    expect(await countRows('sessions', user.id)).toBe(1);
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    await expect(avatarButton(page)).toHaveCount(0);
    expect((await context.cookies()).filter((cookie) => cookie.name === 'ld_session')).toEqual([]);
    expect(await countRows('sessions', user.id)).toBe(0);
    expect(await (await page.request.get('/api/me')).json()).toEqual({ user: null });

    // しおりは残っている（次にログインしたら見える）
    expect(await countRows('bookmarks', user.id, WORK)).toBe(1);
  });

  test('ログアウトは、アカウントのページでなければ今のページのまま', async ({ page }) => {
    await openLoggedIn(page, newLogin('stay'), `/p/${WORK}`);
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    await expect(page).toHaveURL(`/p/${WORK}`);
  });

  test('ログインは、絞り込みと検索を保って戻る', async ({ page, context }) => {
    await signInAs(context, newLogin('signup'));
    await page.goto('/?q=trail&c=mobile');
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await chooseGitHub(page);
    await expect(page).toHaveURL('/?q=trail&c=mobile');
    await expect(avatarButton(page)).toBeVisible();
    await expect(page.locator('article')).toHaveCount(1);
  });

  test('Log in の href は、検索で変わった URL も next に入れる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox').fill('trail');
    await expect(page).toHaveURL('/?q=trail');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toHaveAttribute('href', `/login?next=${encodeURIComponent('/?q=trail')}`);
  });

  test('日本語の検索語の URL にも、そのまま戻る', async ({ page, context }) => {
    await signInAs(context, newLogin('kana'));
    await page.goto('/?q=%E6%97%A5%E6%9C%AC%E8%AA%9E');
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await chooseGitHub(page);
    await expect(avatarButton(page)).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveValue('日本語');
  });
});

test.describe('ログインしていないとき', () => {
  const VIA_LOGIN = async (page: Page, press: () => Promise<void>, path: string) => {
    const authorize: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(`${FAKE_GITHUB}/login/oauth/authorize`)) authorize.push(request.url());
    });
    await press();
    await chooseGitHub(page);
    await expect(avatarButton(page)).toBeVisible();
    await expect(page).toHaveURL(path);
    expect(authorize).toHaveLength(1);
  };

  test('カードのしおりを押すと、GitHub へ行って元の URL に戻る。切り替えはしない', async ({ page, context }) => {
    const login = newLogin('card');
    await signInAs(context, login);
    await page.goto('/?c=mobile');
    await expect(page.getByRole('button', { name: CARD_SAVE })).toBeVisible();
    await VIA_LOGIN(page, () => page.getByRole('button', { name: CARD_SAVE }).click(), '/?c=mobile');
    await expect(page.getByRole('button', { name: CARD_SAVE })).toHaveAttribute('aria-pressed', 'false');
    expect(await countRows('bookmarks', (await userRow(login)).id)).toBe(0);
  });

  test('作品のページのしおりといいねも、GitHub へ行って元の URL に戻る', async ({ page, context }) => {
    await signInAs(context, newLogin('page-a'));
    await page.goto(`/p/${WORK}`);
    await VIA_LOGIN(page, () => page.getByRole('button', { name: '保存', exact: true }).click(), `/p/${WORK}`);

    const other = await context.browser()!.newContext({ baseURL: ownOrigin() });
    await signInAs(other, newLogin('page-b'));
    const second = await other.newPage();
    await second.goto(`/p/${WORK}`);
    await VIA_LOGIN(second, () => second.getByRole('button', { name: /^いいね/ }).click(), `/p/${WORK}`);
    await other.close();
  });

  test('読み込みの途中で押しても、/api/me の答えを待ってからログインへ行く', async ({ page, context }) => {
    await signInAs(context, newLogin('early'));
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    await page.route('**/api/me', async (route) => {
      if (first) {
        first = false;
        await held;
      }
      await route.continue();
    });
    await page.goto('/');
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: CARD_SAVE }).click();
    expect(new URL(page.url()).origin).toBe(ownOrigin());
    release();
    await chooseGitHub(page);
    await expect(avatarButton(page)).toBeVisible();
  });

  test('/saved を開くと GitHub へ行き、終わると /account/saved に戻る。空なら文が出る', async ({ page, context }) => {
    await signInAs(context, newLogin('empty'));
    await page.goto('/saved');
    await expect(page).toHaveURL('/login?next=%2Faccount%2Fsaved');
    await chooseGitHub(page);
    await expect(page).toHaveURL('/account/saved');
    await expect(avatarButton(page)).toBeVisible();
    await expect(page.getByText('まだ何も保存していません')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);
  });

  test('Worker は /saved を /account/saved へ転送し、そこから HTML を返さずログインへ送る', async () => {
    const visitor = new Visitor();
    const moved = await visitor.fetch('/saved?from=old');
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/account/saved?from=old');
    expect(moved.headers.get('cache-control')).toBe('private, no-store');
    const english = await visitor.fetch('/en/saved');
    expect(english.status).toBe(301);
    expect(english.headers.get('location')).toBe('/en/account/saved');

    const response = await visitor.fetch('/account/saved');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?next=%2Faccount%2Fsaved');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  test('サイドバーの Saved からも GitHub へ行き、/account/saved に戻る', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAs(context, newLogin('side'));
    await page.goto('/');
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
    await page.getByRole('navigation').getByRole('link', { name: '保存' }).first().click();
    await chooseGitHub(page);
    await expect(avatarButton(page)).toBeVisible();
    await expect(page).toHaveURL('/account/saved');
  });

  test('GitHub の画面で断ると、ログインせずにホームへ戻る', async ({ page, context }) => {
    await context.addCookies([{ name: 'fake_deny', value: '1', url: FAKE_GITHUB }]);
    await page.goto('/saved');
    await chooseGitHub(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    expect((await context.cookies()).filter((cookie) => cookie.name === 'ld_session')).toEqual([]);
  });
});

// ---------------------------------------------------------------- 切り替え（画面）

test.describe('ログインしているとき', () => {
  test('カードのしおり：外すと戻り、再読み込みしても本人の状態が出る', async ({ page }) => {
    const login = newLogin('reload');
    await openLoggedIn(page, login);
    const save = page.getByRole('button', { name: CARD_SAVE });

    let response = toggleResponse(page, 'bookmark');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await response;

    await page.reload();
    await expect(avatarButton(page)).toBeVisible();
    await expect(save).toHaveAttribute('aria-pressed', 'true');

    // 絞り込みを変えても残る
    await page.getByRole('link', { name: 'Web', exact: true }).click();
    await page.getByRole('link', { name: 'すべて', exact: true }).click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');

    response = toggleResponse(page, 'bookmark');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await expect(save).toHaveText('保存');
    await response;
    await page.reload();
    await expect(avatarButton(page)).toBeVisible();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
  });

  test('作品のページのいいね：押すと数が増え、再読み込みしても本人の状態と数が合う。もう一度で戻る', async ({ page }) => {
    const login = newLogin('like');
    await openLoggedIn(page, login, `/p/${WORK}`);
    const like = page.getByRole('button', { name: /^いいね/ });
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    const before = Number(await like.textContent());

    let response = toggleResponse(page, 'like');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like.locator('svg')).toHaveAttribute('fill', 'currentColor');
    await expect(like).toHaveText(String(before + 1));
    await expect(like).toHaveAttribute('aria-label', `いいね、${before + 1}件`);
    expect(await (await response).json()).toEqual({ liked: true });

    await page.reload();
    await expect(avatarButton(page)).toBeVisible();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    const afterReload = Number(await like.textContent());
    expect(afterReload).toBe(before + 1);

    response = toggleResponse(page, 'like');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(like).toHaveText(String(afterReload - 1));
    expect(await (await response).json()).toEqual({ liked: false });
    expect(await countRows('likes', (await userRow(login)).id, WORK)).toBe(0);
  });

  test('作品のページのしおり：Save と Saved が切り替わり、再読み込みでも残る', async ({ page }) => {
    await openLoggedIn(page, newLogin('save'), `/p/${WORK}`);
    const main = page.getByRole('main');
    const response = toggleResponse(page, 'bookmark');
    await main.getByRole('button', { name: '保存', exact: true }).click();
    const saved = main.getByRole('button', { name: '保存済み', exact: true });
    await expect(saved).toHaveAttribute('aria-pressed', 'true');
    await response;
    await page.reload();
    await expect(avatarButton(page)).toBeVisible();
    await expect(saved).toHaveAttribute('aria-pressed', 'true');
    await expect(saved.locator('svg')).toHaveAttribute('fill', 'currentColor');
  });

  test('先に見た目を変え、失敗したら戻す', async ({ page }) => {
    await openLoggedIn(page, newLogin('rollback'));
    const save = page.getByRole('button', { name: CARD_SAVE });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/works/*/bookmark', async (route) => {
      await held;
      await route.fulfill({ status: 500, json: { error: 'internal_error' } });
    });
    await save.click();
    // 応答を待たずに変わる
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    release();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
  });

  test('通信そのものが失敗しても戻す', async ({ page }) => {
    await openLoggedIn(page, newLogin('offline'), `/p/${WORK}`);
    await page.route('**/api/works/*/like', (route) => route.abort());
    const like = page.getByRole('button', { name: /^いいね/ });
    const before = await like.textContent();
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(like).toHaveText(before!);
  });

  test('セッションが切れていたら（401）、ログインへ行って元の URL に戻る', async ({ page }) => {
    await openLoggedIn(page, newLogin('expired'), '/?c=mobile');
    // 画面はログインのまま、セッションだけが切れた形にする（本物の 401 が返る）
    await page.context().clearCookies({ name: 'ld_session' });
    const authorize = page.waitForRequest(`${FAKE_GITHUB}/login/oauth/authorize**`);
    await page.getByRole('button', { name: CARD_SAVE }).click();
    await chooseGitHub(page);
    await authorize;
    await expect(page).toHaveURL('/?c=mobile');
    await expect(avatarButton(page)).toBeVisible();
  });

  test('ほかのタブで付けた後でも、見た目はサーバーの答えに合う', async ({ page, context }) => {
    await openLoggedIn(page, newLogin('tabs'));
    const save = page.getByRole('button', { name: CARD_SAVE });
    await expect(save).toHaveAttribute('aria-pressed', 'false');

    // 別のタブで付ける。こちらの見た目は「付いていない」のまま
    const other = await context.newPage();
    const ok = await other.request.post(`/api/works/${WORK}/bookmark`, { headers: { Origin: ownOrigin() } });
    expect(ok.status()).toBe(200);
    await other.close();

    // こちらで押すと、サーバーでは外れる。見た目も「付いていない」に合う
    const response = toggleResponse(page, 'bookmark');
    await save.click();
    expect(await (await response).json()).toEqual({ bookmarked: false });
    await expect(save).toHaveAttribute('aria-pressed', 'false');
  });

  test('/saved：しおりを外しても、開いている間はカードが残り、次に開くと消える', async ({ page }) => {
    const login = newLogin('unsave');
    await openLoggedIn(page, login);
    const visitor = page.request;
    await visitor.post(`/api/works/${WORK}/bookmark`, { headers: { Origin: ownOrigin() } });
    await page.goto('/account/saved');
    await expect(page.locator('article')).toHaveCount(1);
    const save = page.getByRole('button', { name: CARD_SAVE });
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    const response = toggleResponse(page, 'bookmark');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await response;
    await expect(page.locator('article')).toHaveCount(1);
    await page.reload();
    await expect(page.getByText('まだ何も保存していません')).toBeVisible();
  });

  test('/saved の一覧が読めないときは、その旨を出す', async ({ page }) => {
    await openLoggedIn(page, newLogin('error'));
    await page.route('**/api/me/bookmarks', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: '保存した作品' }).click();
    await expect(page.getByText('保存した作品を読み込めませんでした')).toBeVisible();
  });

  for (const width of [1440, 768, 390]) {
    test(`幅${width}：アバターとメニューが出て、横にはみ出さない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLoggedIn(page, newLogin(`w${width}`));
      const banner = page.getByRole('banner');
      await expect(banner.getByRole('link', { name: 'ログイン', exact: true })).toHaveCount(0);
      await avatarButton(page).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await pageOverflow(page)).toBe(0);
    });
  }
});

test.describe('メニューの操作', () => {
  test('キーボード：Enter で開いて最初の項目へ。矢印は端で回る。Esc でボタンに戻る。Tab で閉じる', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLoggedIn(page, newLogin('keys'));
    const button = avatarButton(page);
    await button.focus();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const account = page.getByRole('menuitem', { name: 'アカウント', exact: true });
    const logout = page.getByRole('menuitem', { name: 'ログアウト' });
    await expect(account).toBeFocused();
    // 保存した作品、作品を置く（T021）、利用規約（T027）、プライバシー、運営者（T016）の次がログアウト
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: '保存した作品' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: '作品を置く' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: '利用規約' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'プライバシー' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: '運営者' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'View in English' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(logout).toBeFocused();
    await expect(logout).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('ArrowDown');
    await expect(account).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(logout).toBeFocused();
    await page.keyboard.press('Home');
    await expect(account).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(account).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('キーボードだけでログアウトできる', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLoggedIn(page, newLogin('keyout'));
    await avatarButton(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
  });

  test('外を押すと閉じる。もう一度押しても閉じる', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLoggedIn(page, newLogin('outside'));
    await avatarButton(page).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(600, 500);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await avatarButton(page).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await avatarButton(page).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('ログアウトに失敗したら、ログインのままにする', async ({ page }) => {
    await openLoggedIn(page, newLogin('nologout'));
    await page.route('**/auth/logout', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(avatarButton(page)).toBeVisible();
  });
});

test.describe('axe-core（critical と serious が0）', () => {
  for (const width of [1440, 768, 390]) {
    test(`幅${width}：ログイン中のヘッダーとメニュー`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLoggedIn(page, newLogin(`axe-menu-${width}`));
      expect(await runAxe(page)).toEqual([]);
      await avatarButton(page).click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
    });

    test(`幅${width}：/account/saved（空と、カードあり）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLoggedIn(page, newLogin(`axe-saved-${width}`), '/account/saved');
      await expect(page.getByText('まだ何も保存していません')).toBeVisible();
      expect(await runAxe(page)).toEqual([]);

      await page.request.post(`/api/works/${WORK}/bookmark`, { headers: { Origin: ownOrigin() } });
      await page.request.post(`/api/works/${OTHER_WORK}/bookmark`, { headers: { Origin: ownOrigin() } });
      await page.reload();
      await expect(page.locator('article')).toHaveCount(2);
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);
    });
  }

  test('作品のページで、いいねとしおりを押した後', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLoggedIn(page, newLogin('axe-page'), '/p/fx-toggle');
    await page.getByRole('button', { name: /^いいね/ }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('main').getByRole('button', { name: '保存済み', exact: true })).toBeVisible();
    expect(await runAxe(page)).toEqual([]);
  });
});

test.describe('キーボードでしおり（ログイン中）', () => {
  test('Space と Enter で切り替わり、フォーカスは動かない', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLoggedIn(page, newLogin('kbd'));
    const save = page.getByRole('button', { name: CARD_SAVE });
    await save.focus();
    let response = toggleResponse(page, 'bookmark');
    await page.keyboard.press('Space');
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(save).toBeFocused();
    await response;
    response = toggleResponse(page, 'bookmark');
    await page.keyboard.press('Enter');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await expect(save).toBeFocused();
    await response;
  });
});

// ---------------------------------------------------------------- 戻り先

test.describe('next（自分のサイトの外へ戻らない）', () => {
  const FOREIGN = [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\/evil.example',
    '\\\\evil.example',
    '///evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '\t//evil.example',
    '/.//evil.example',
    '/x/..//evil.example',
    'http:evil.example',
    'javascript:alert(1)',
    'evil.example',
    '',
    `/${'a'.repeat(1100)}`,
  ];

  for (const next of FOREIGN) {
    test(`Worker：${JSON.stringify(next.slice(0, 24))} は「/」へ戻る`, async () => {
      const response = await new Visitor().login(newLogin('next'), { next });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/');
    });
  }

  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
    test(`ブラウザ：${next} を入れても、自分のサイトに戻る`, async ({ page, context }) => {
      await signInAs(context, newLogin('next-browser'));
      const evil: string[] = [];
      await context.route((url) => url.hostname.endsWith('evil.example'), async (route) => {
        evil.push(route.request().url());
        await route.abort();
      });
      await page.goto(`/auth/github?next=${encodeURIComponent(next)}`);
      await expect(avatarButton(page)).toBeVisible();
      expect(new URL(page.url()).origin).toBe(ownOrigin());
      expect(new URL(page.url()).pathname).toBe('/');
      expect(evil).toEqual([]);
    });
  }

  test('戻り先は D1 にあり、cookie で書き換えられない', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startLogin('/p/x');
    visitor.cookies.set('ld_oauth_next', encodeURIComponent('//evil.example'));
    authorize.searchParams.set('login_as', newLogin('forged'));
    const back = await fetch(authorize, { redirect: 'manual' });
    const response = await visitor.fetch(back.headers.get('location')!);
    expect(response.headers.get('location')).toBe('/p/x');
  });

  for (const next of ['/', '/account/saved', `/p/${WORK}`, '/?q=trail&c=mobile', '/c/seed_a', '/?q=%E6%97%A5%E6%9C%AC']) {
    test(`自分のパス ${next} には戻る`, async () => {
      const response = await new Visitor().login(newLogin('own'), { next });
      expect(response.headers.get('location')).toBe(next);
    });
  }

  test('next がなければ「/」', async () => {
    const visitor = new Visitor();
    const start = await visitor.fetch('/auth/github');
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('login_as', newLogin('none'));
    const back = await fetch(authorize, { redirect: 'manual' });
    expect((await visitor.fetch(back.headers.get('location')!)).headers.get('location')).toBe('/');
  });
});

// ---------------------------------------------------------------- OAuth の決まり

test.describe('GET /auth/github', () => {
  test('GitHub の画面へ送る。scope は付けず、state は256ビットの乱数', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startLogin('/p/x');
    expect(authorize.origin + authorize.pathname).toBe(`${FAKE_GITHUB}/login/oauth/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe('fake-client-id');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${ownOrigin()}/auth/github/callback`);
    expect(authorize.searchParams.has('scope')).toBe(false);
    expect(authorize.searchParams.has('client_secret')).toBe(false);
    const state = authorize.searchParams.get('state')!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);

    const other = await new Visitor().startLogin('/p/x');
    expect(other.searchParams.get('state')).not.toBe(state);
  });

  test('途中の状態は D1 に置き、cookie は乱数だけで、短い寿命（10分）の HttpOnly', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startLogin('/p/x');
    const line = visitor.lastSetCookie.find((cookie) => cookie.startsWith('ld_github_flow_'))!;
    const token = line.split(';')[0].split('=')[1];
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe(authorize.searchParams.get('state'));
    const hash = createHash('sha256').update(token).digest('hex');
    const rows = await d1<{ kind: string; data: string; expires_at: number }>(`SELECT kind, data, expires_at FROM auth_flows WHERE token_hash = ${quote(hash)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('github');
    expect(JSON.parse(rows[0].data)).toEqual({ state: authorize.searchParams.get('state'), next: '/p/x', intent: 'login' });
    expect(rows[0].expires_at - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(line).toMatch(/;\s*Max-Age=600(;|$)/i);
    expect(line).toMatch(/;\s*HttpOnly(;|$)/i);
    expect(line).toMatch(/;\s*Secure(;|$)/i);
    expect(line).toMatch(/;\s*SameSite=Lax(;|$)/i);
    expect(line).toMatch(/;\s*Path=\/auth\/github(;|$)/i);
  });
});

test.describe('GET /auth/github/callback', () => {
  test('state が違うと、ログインの画面へ戻す。セッションはできない', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startLogin();
    authorize.searchParams.set('login_as', newLogin('badstate'));
    const back = new URL((await fetch(authorize, { redirect: 'manual' })).headers.get('location')!);
    back.searchParams.set('state', 'f'.repeat(64));
    const response = await visitor.fetch(back.href);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/')}&error=login_retry`);
    expect(visitor.cookies.has('ld_session')).toBe(false);
  });

  test('cookie がないと、ログインの画面へ戻す。セッションはできない', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startLogin();
    authorize.searchParams.set('login_as', newLogin('nocookie'));
    const back = (await fetch(authorize, { redirect: 'manual' })).headers.get('location')!;
    const stranger = new Visitor();
    const response = await stranger.fetch(back);
    // 行は残っているのに cookie がない。別のブラウザで戻った人に、開き直してもらう
    expect(response.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/')}&error=login_open_browser`);
    expect(stranger.cookies.has('ld_session')).toBe(false);
  });

  test('state が URL になければ、ログインの画面へ戻す', async () => {
    const visitor = new Visitor();
    await visitor.startLogin();
    const response = await visitor.fetch('/auth/github/callback?code=abc');
    expect(response.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/')}&error=login_retry`);
    expect(visitor.cookies.has('ld_session')).toBe(false);
  });

  test('同じ state は2回使えない', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startLogin();
    authorize.searchParams.set('login_as', newLogin('replay'));
    const back = (await fetch(authorize, { redirect: 'manual' })).headers.get('location')!;
    const saved = new Map(visitor.cookies);
    expect(flowCookies(saved, 'ld_github_flow')).toHaveLength(1);
    expect((await visitor.fetch(back)).headers.get('location')).toBe('/');
    // 途中の cookie は消えている
    expect(flowCookies(visitor.cookies, 'ld_github_flow')).toHaveLength(0);
    expect((await visitor.fetch(back)).headers.get('location')).toBe(RETRY);
    // cookie を元に戻しても、D1 の行がもうないので使えない
    const replay = new Visitor();
    replay.cookies = saved;
    expect((await replay.fetch(back)).headers.get('location')).toBe(RETRY);
    expect(replay.cookies.has('ld_session')).toBe(false);
  });

  test('code がないとき、GitHub が code を断ったときは、ログインの画面へ戻す。セッションはできない', async () => {
    const failed = `/login?next=${encodeURIComponent('/')}&error=login_failed`;
    const visitor = new Visitor();
    const state = (await visitor.startLogin()).searchParams.get('state')!;
    expect((await visitor.fetch(`/auth/github/callback?state=${state}`)).headers.get('location')).toBe(failed);

    const again = new Visitor();
    const stateAgain = (await again.startLogin()).searchParams.get('state')!;
    const response = await again.fetch(`/auth/github/callback?state=${stateAgain}&code=wrong`);
    expect(response.headers.get('location')).toBe(failed);
    expect(again.cookies.has('ld_session')).toBe(false);
  });

  test('応答は戻り先だけを教え、キャッシュさせない', async () => {
    const response = await new Visitor().login(newLogin('nocache'), { next: `/p/${WORK}` });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('location')).toBe(`/p/${WORK}`);
  });
});

test.describe('セッションと D1', () => {
  test('ld_session に HttpOnly、Secure、SameSite=Lax、Path=/、30日。中身は256ビットの乱数', async () => {
    const visitor = await loggedIn(newLogin('cookie'));
    const line = visitor.lastSetCookie.find((cookie) => cookie.startsWith('ld_session='))!;
    expect(line).toMatch(/;\s*HttpOnly(;|$)/i);
    expect(line).toMatch(/;\s*Secure(;|$)/i);
    expect(line).toMatch(/;\s*SameSite=Lax(;|$)/i);
    expect(line).toMatch(/;\s*Path=\/(;|$)/i);
    expect(line).toMatch(/;\s*Max-Age=2592000(;|$)/i);
    expect(visitor.cookies.get('ld_session')).toMatch(/^[0-9a-f]{64}$/);
    // ログインの途中の cookie は消えている
    expect(flowCookies(visitor.cookies, 'ld_github_flow')).toHaveLength(0);
  });

  test('ブラウザにも同じ属性で入り、JS からは読めない', async ({ page, context }) => {
    await openLoggedIn(page, newLogin('browser-cookie'));
    const cookie = (await context.cookies()).find((item) => item.name === 'ld_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
    expect(await page.evaluate(() => document.cookie)).not.toContain('ld_session');
  });

  test('D1 にはトークンのハッシュだけがある。GitHub のトークンも cookie の値も、D1 のファイルのどこにもない', async () => {
    const login = newLogin('hash');
    const visitor = await loggedIn(login);
    const token = visitor.cookies.get('ld_session')!;
    const hash = createHash('sha256').update(token).digest('hex');

    const user = await userRow(login);
    const sessions = await d1<{ token_hash: string; user_id: string; expires_at: number }>(`SELECT * FROM sessions WHERE user_id = ${quote(user.id)}`);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].token_hash).toBe(hash);
    expect(sessions[0].token_hash).not.toBe(token);
    const days = (sessions[0].expires_at - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const { tokens } = (await (await fetch(`${FAKE_GITHUB}/__tokens`)).json()) as { tokens: string[] };
    expect(tokens.length).toBeGreaterThan(0);

    const dir = join(PERSIST, 'v3/d1');
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    expect(files.length).toBeGreaterThan(0);
    const dump = Buffer.concat(files.map((entry) => readFileSync(join(entry.parentPath, entry.name)))).toString('latin1');
    // 探し方が正しいことの対照：ハッシュと login は見つかる
    expect(dump).toContain(hash);
    expect(dump).toContain(login);
    expect(dump).not.toContain(token);
    for (const github of tokens) expect(dump.includes(github), 'GitHub のトークン').toBe(false);
    expect(dump).not.toContain('gho_fake_');
    expect(dump).not.toContain('fake-client-secret');
    // 持たないと決めた情報（原則6）も残らない
    expect(dump).not.toContain(`${login}@private.example`);
    expect(dump).not.toContain('Should Not Be Stored Inc');
  });

  test('持つのは決まった項目だけ（原則6）。2回目のログインは同じ人で、手段の情報だけを新しくする', async () => {
    const login = newLogin('upsert');
    const first = new Visitor();
    await first.login(login, { name: 'First Name' });
    const row = await userRow(login);
    const [user] = await d1<Record<string, unknown>>(`SELECT * FROM users WHERE id = ${quote(row.id)}`);
    expect(Object.keys(user).sort()).toEqual(['avatar_url', 'created_at', 'display_name', 'handle', 'id', 'is_operator', 'site_url', 'x_url']);
    const [identity] = await d1<Record<string, unknown>>(`SELECT * FROM identities WHERE user_id = ${quote(row.id)}`);
    expect(Object.keys(identity).sort()).toEqual(['avatar_url', 'created_at', 'label', 'last_used_at', 'provider', 'subject', 'user_id']);
    expect(row.display_name).toBe('First Name');
    expect(row.handle).toBe(login.replace(/-/g, '_'));
    expect(row.avatar_url).toBe(`${FAKE_GITHUB}/avatars/${login}.svg`);
    expect(row.label).toBe(login);

    const second = new Visitor();
    await second.login(login, { name: 'Second Name' });
    const rows = await d1<{ id: string; display_name: string }>(`SELECT u.id, u.display_name FROM users u JOIN identities i ON i.user_id = u.id WHERE i.label = ${quote(login)}`);
    // 表示の名前は本人のもの。GitHub の名前で上書きしない
    expect(rows).toEqual([{ id: row.id, display_name: 'First Name' }]);
    // 別の端末のセッションは残る
    expect(await countRows('sessions', row.id)).toBe(2);
    expect((await first.me()).user).toEqual({ handle: row.handle, display_name: 'First Name', avatar_url: row.avatar_url });
  });

  test('同じブラウザで2回ログインすると、前のセッションの行は消える', async () => {
    const login = newLogin('rotate');
    const visitor = await loggedIn(login);
    const before = visitor.cookies.get('ld_session');
    await visitor.login(login);
    expect(visitor.cookies.get('ld_session')).not.toBe(before);
    expect(await countRows('sessions', (await userRow(login)).id)).toBe(1);
  });

  test('切れたセッションは使えない', async () => {
    const login = newLogin('old');
    const visitor = await loggedIn(login);
    const user = await userRow(login);
    await d1(`UPDATE sessions SET expires_at = ${Date.now() - 1000} WHERE user_id = ${quote(user.id)}`);
    expect(await visitor.me()).toEqual({ user: null });
    expect((await visitor.post(`/api/works/${WORK}/like`)).status).toBe(401);
    // 次のログインで、切れた行は片付く
    await visitor.login(login);
    expect(await countRows('sessions', user.id)).toBe(1);
  });

  test('でたらめな cookie は、セッションにならない', async () => {
    const visitor = new Visitor();
    for (const value of ['abc', 'f'.repeat(64), "' OR 1=1 --"]) {
      visitor.cookies.set('ld_session', encodeURIComponent(value));
      expect(await visitor.me()).toEqual({ user: null });
    }
  });

  test('POST /auth/logout：行を消し、cookie を消す。古い cookie はもう使えない', async () => {
    const login = newLogin('logout');
    const visitor = await loggedIn(login);
    const old = visitor.cookies.get('ld_session')!;
    const response = await visitor.post('/auth/logout');
    expect(response.status).toBe(204);
    const line = visitor.lastSetCookie.find((cookie) => cookie.startsWith('ld_session='))!;
    expect(line).toMatch(/Max-Age=0/i);
    expect(line).toMatch(/;\s*Path=\/(;|$)/i);
    expect(await countRows('sessions', (await userRow(login)).id)).toBe(0);

    visitor.cookies.set('ld_session', old);
    expect(await visitor.me()).toEqual({ user: null });
  });

  test('POST /auth/logout：外の Origin からは 403 で、セッションは残る', async () => {
    const visitor = await loggedIn(newLogin('logout-origin'));
    for (const origin of ['https://evil.example', 'null', null]) {
      expect((await visitor.post('/auth/logout', origin)).status).toBe(403);
    }
    expect((await visitor.me()).user).not.toBeNull();
  });

  test('ログアウトは、ログインしていなくても 204', async () => {
    expect((await new Visitor().post('/auth/logout')).status).toBe(204);
  });
});

// ---------------------------------------------------------------- API

test.describe('POST /api/works/:id/like と bookmark', () => {
  for (const { kind, table, field } of [
    { kind: 'like', table: 'likes', field: 'liked' },
    { kind: 'bookmark', table: 'bookmarks', field: 'bookmarked' },
  ] as const) {
    test(`${kind}：2回押すと取り消しになり、D1 に重複した行ができない`, async () => {
      const login = newLogin(`twice-${kind}`);
      const visitor = await loggedIn(login);
      const user = await userRow(login);
      const path = `/api/works/${WORK}/${kind}`;

      const first = await visitor.post(path);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ [field]: true });
      expect(await countRows(table, user.id, WORK)).toBe(1);

      const second = await visitor.post(path);
      expect(await second.json()).toEqual({ [field]: false });
      expect(await countRows(table, user.id, WORK)).toBe(0);

      expect(await (await visitor.post(path)).json()).toEqual({ [field]: true });
      expect(await countRows(table, user.id, WORK)).toBe(1);
    });

    test(`${kind}：同時に何度押しても、行は1つ以下`, async () => {
      const login = newLogin(`race-${kind}`);
      const visitor = await loggedIn(login);
      const responses = await Promise.all(Array.from({ length: 7 }, () => visitor.post(`/api/works/${WORK}/${kind}`)));
      for (const response of responses) expect(response.status).toBe(200);
      const user = await userRow(login);
      // 7回の切り替えなので、順番がどうあれ1つ残る
      expect(await countRows(table, user.id, WORK)).toBe(1);
    });

    test(`${kind}：ログインしていなければ 401`, async () => {
      const response = await new Visitor().post(`/api/works/${WORK}/${kind}`);
      expect(response.status).toBe(401);
    });

    test(`${kind}：外の Origin からは 403（ログイン中でも）。行はできない`, async () => {
      const login = newLogin(`origin-${kind}`);
      const visitor = await loggedIn(login);
      const self = ownOrigin();
      for (const origin of ['https://evil.example', 'null', `${self}.evil.example`, null]) {
        expect((await visitor.post(`/api/works/${WORK}/${kind}`, origin)).status, String(origin)).toBe(403);
      }
      expect(await countRows(table, (await userRow(login)).id)).toBe(0);
    });

    test(`${kind}：外の Origin で、ログインしていなくても 403`, async () => {
      expect((await new Visitor().post(`/api/works/${WORK}/${kind}`, 'https://evil.example')).status).toBe(403);
    });

    test(`${kind}：承認済みの作品でなければ 400`, async () => {
      const login = newLogin(`status-${kind}`);
      const visitor = await loggedIn(login);
      for (const id of ['acc-draft', 'acc-rejected', 'no-such-work']) {
        expect((await visitor.post(`/api/works/${id}/${kind}`)).status, id).toBe(400);
      }
      expect(await countRows(table, (await userRow(login)).id)).toBe(0);
    });

    test(`${kind}：作品が取り下げられた後も 400 で、行は変わらない`, async () => {
      const login = newLogin(`withdrawn-${kind}`);
      const visitor = await loggedIn(login);
      const user = await userRow(login);
      await d1(`INSERT INTO ${table} (user_id, work_id, created_at) VALUES (${quote(user.id)}, 'acc-rejected', 1)`);
      expect((await visitor.post(`/api/works/acc-rejected/${kind}`)).status).toBe(400);
      expect(await countRows(table, user.id, 'acc-rejected')).toBe(1);
    });
  }

  test('いいねとしおりは別々に数える', async () => {
    const login = newLogin('separate');
    const visitor = await loggedIn(login);
    await visitor.post(`/api/works/${WORK}/like`);
    const me = await visitor.me();
    expect(me.liked).toEqual([WORK]);
    expect(me.bookmarked).toEqual([]);
  });

  test('いいねの数は、ホームと作品のページの HTML に D1 から入る', async () => {
    const visitor = await loggedIn(newLogin('count'));
    const likesOf = async () => {
      const works = (await (await fetch(new URL('/api/works', ownOrigin()))).json()) as { works: { id: string; likes: number }[] };
      return works.works.find((work) => work.id === 'fx-form')!.likes;
    };
    const before = await likesOf();
    await visitor.post('/api/works/fx-form/like');
    await expect.poll(likesOf).toBeGreaterThan(before);
  });
});

test.describe('GET /api/me', () => {
  test('ログインしていなければ { user: null }。private, no-store', async () => {
    const response = await new Visitor().fetch('/api/me');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: null });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  test('ログインしていれば本人と、いいね済みとしおり済みの id。内部の id は出さない', async () => {
    const login = newLogin('shape');
    const visitor = await loggedIn(login);
    await visitor.post(`/api/works/${WORK}/like`);
    await visitor.post(`/api/works/${OTHER_WORK}/bookmark`);
    const response = await visitor.fetch('/api/me');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      user: { handle: login.replace(/-/g, '_'), display_name: `Name of ${login}`, avatar_url: `${FAKE_GITHUB}/avatars/${login}.svg` },
      liked: [WORK],
      bookmarked: [OTHER_WORK],
      can_post: true,
      // 自分の作品の数（左のナビ、WS001）
      works_count: 0,
    });
  });

  test('2人が交互に取っても、相手の情報が返らない', async () => {
    const aliceLogin = newLogin('alice');
    const bobLogin = newLogin('bob');
    const alice = await loggedIn(aliceLogin);
    const bob = await loggedIn(bobLogin);
    await alice.post(`/api/works/${WORK}/bookmark`);
    await bob.post(`/api/works/${OTHER_WORK}/like`);

    const expectedAlice = { user: { handle: aliceLogin.replace(/-/g, '_'), display_name: `Name of ${aliceLogin}`, avatar_url: `${FAKE_GITHUB}/avatars/${aliceLogin}.svg` }, liked: [], bookmarked: [WORK], can_post: true, works_count: 0 };
    const expectedBob = { user: { handle: bobLogin.replace(/-/g, '_'), display_name: `Name of ${bobLogin}`, avatar_url: `${FAKE_GITHUB}/avatars/${bobLogin}.svg` }, liked: [OTHER_WORK], bookmarked: [], can_post: true, works_count: 0 };

    // 交互に
    for (let i = 0; i < 10; i += 1) {
      expect(await alice.me()).toEqual(expectedAlice);
      expect(await bob.me()).toEqual(expectedBob);
    }
    // 同時に
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? bob : alice).me()));
    results.forEach((result, i) => expect(result).toEqual(i % 2 ? expectedBob : expectedAlice));
  });
});

test.describe('GET /api/me/bookmarks', () => {
  test('ログインしていなければ 401', async () => {
    expect((await new Visitor().fetch('/api/me/bookmarks')).status).toBe(401);
  });

  test('本人のしおりだけを、新しく保存した順で返す。承認済みでない作品は出さない', async () => {
    const aliceLogin = newLogin('list-a');
    const alice = await loggedIn(aliceLogin);
    const bob = await loggedIn(newLogin('list-b'));
    await alice.post(`/api/works/${WORK}/bookmark`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await alice.post(`/api/works/${OTHER_WORK}/bookmark`);
    await bob.post('/api/works/fx-form/bookmark');
    await d1(`INSERT INTO bookmarks (user_id, work_id, created_at) VALUES (${quote((await userRow(aliceLogin)).id)}, 'acc-rejected', ${Date.now() + 1000})`);

    const response = await alice.fetch('/api/me/bookmarks');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { works } = (await response.json()) as { works: { id: string; title: string; creator: { handle: string } }[] };
    expect(works.map((work) => work.id)).toEqual([OTHER_WORK, WORK]);
    expect(works[0].creator.handle).toBeTruthy();
    expect(works[1].title).toBe('Trail Guide App');
  });
});

// ---------------------------------------------------------------- HTML は人によって変えない

test.describe('HTML はログインの有無で変わらない', () => {
  for (const path of ['/', '/?c=web', '/?q=trail', `/p/${WORK}`, '/p/fx-toggle', '/c/seed_a', '/nothing-here', '/p/no-such-work']) {
    test(path, async () => {
      const login = newLogin('same');
      const visitor = await loggedIn(login);
      await visitor.post(`/api/works/${WORK}/bookmark`);
      const anonymous = await new Visitor().fetch(path);
      const response = await visitor.fetch(path);
      const mine = await response.text();
      expect(response.status).toBe(anonymous.status);
      expect(mine).toBe(await anonymous.text());
      expect(response.headers.get('set-cookie')).toBeNull();
      // 200 はキャッシュする（SPEC.md「10」）。だから HTML が同じでなければならない。404 はキャッシュしない
      expect(response.headers.get('cache-control')).toBe(response.status === 200 && !path.startsWith('/nothing') ? 'public, max-age=0, s-maxage=60' : 'private, no-store');
      expect(mine).not.toContain(login);
    });
  }

  test('/account/saved の HTML も本人の情報を含まない', async () => {
    const login = newLogin('saved-html');
    const visitor = await loggedIn(login);
    await visitor.post(`/api/works/${WORK}/bookmark`);
    const response = await visitor.fetch('/account/saved');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain(login);
    expect(html).not.toContain(login.replace(/-/g, '_'));
    expect(html).not.toContain(WORK);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  test('ログインの有無に関わらず、ヘッダーの HTML は「ログイン」のリンク（読み込みの後で入れ替わる）', async () => {
    const visitor = await loggedIn(newLogin('header'));
    const html = await (await visitor.fetch('/?c=web')).text();
    const href = `/login?next=${encodeURIComponent('/?c=web')}`.replace(/&/g, '&amp;');
    expect(html.split(`href="${href}"`).length - 1).toBe(1);
  });

  test('ホームを開いたときの API は GET /api/me の1本だけ（SPEC.md 10）', async ({ page }) => {
    await openLoggedIn(page, newLogin('oneapi'));
    const api: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) api.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.reload();
    await expect(avatarButton(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(api).toEqual(['GET /api/me']);
  });

  test('読み込みの途中でアバターに替わっても、右端は揃ったまま', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const login = (await page.getByRole('link', { name: 'ログイン', exact: true }).boundingBox())!;

    await openLoggedIn(page, newLogin('stable'));
    const avatar = (await avatarButton(page).boundingBox())!;
    expect(avatar.x + avatar.width).toBe(login.x + login.width);
    expect(avatar.height).toBe(login.height);
  });
});
