// アカウントのページ（docs/tasks/T020.md「2」「3」「4」）。手元の偽の GitHub で通す。
// 1つのテストごとに別の人でログインするので、互いの行に触らない。

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { parseProfile } from '../worker/profile';
import { handleBase, HANDLE_HOLD_MS, HANDLE_PATTERN, isReservedHandle } from '../worker/handleRules';
import { pageOverflow } from './helpers';
import { flowCookies, Visitor } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;
const WORK = 'seed-trail-guide';
const OTHER_WORK = 'seed-portfolio-landing';
const DAY = 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;

const ownOrigin = () => new URL(test.info().project.use.baseURL!).origin;
const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
/** login と、そこから決まる handle が同じ形（英小文字と数字）になるようにする。 */
const newLogin = (label: string) => `${label}${randomBytes(4).toString('hex')}`;

async function d1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const userId = async (login: string) => (await d1<{ user_id: string }>(`SELECT user_id FROM identities WHERE provider = 'github' AND label = ${quote(login)}`))[0].user_id;

async function loggedIn(login = newLogin('person')) {
  const visitor = new Visitor();
  expect((await visitor.login(login)).status).toBe(302);
  return visitor;
}

async function openAccount(page: Page, login: string, path = '/account') {
  await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
  await page.goto(`/auth/github?next=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(path);
}

/** 直近のログインから時間がたったことにする。 */
const ageSession = (id: string) => d1(`UPDATE sessions SET auth_at = auth_at - ${TEN_MINUTES + 1000} WHERE user_id = ${quote(id)}`);

async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}：${v.nodes[0]?.target}`);
}

test.describe('入口', () => {
  test('ログインしていなければログインへ送る。HTML を返さない', async () => {
    for (const path of ['/account', '/account/saved', '/account/likes', '/account/works', '/account/delete', '/en/account']) {
      const response = await new Visitor().fetch(path);
      expect(response.status, path).toBe(302);
      const login = path.startsWith('/en/') ? '/en/login' : '/login';
      expect(response.headers.get('location'), path).toBe(`${login}?next=${encodeURIComponent(path)}`);
      expect(response.headers.get('cache-control'), path).toBe('private, no-store');
    }
  });

  test('API もログインが要る', async () => {
    for (const path of ['/api/account', '/api/account/works', '/api/me/likes', '/api/account/handle-check?handle=abc']) {
      expect((await new Visitor().fetch(path)).status, path).toBe(401);
    }
    for (const path of ['/api/account/profile', '/api/account/handle', '/api/account/sessions/revoke-others', '/api/account/delete', '/api/account/identities/github/remove']) {
      expect((await new Visitor().post(path, {})).status, path).toBe(401);
    }
  });

  test('HTML は人で変えない。名前も handle も入らない', async () => {
    const login = newLogin('shell');
    const visitor = await loggedIn(login);
    const body = await (await visitor.fetch('/account')).text();
    expect(body).not.toContain(login);
    expect(body).not.toContain(`Name of ${login}`);
  });

  test('メニューの「アカウント」から開ける。下のタブの「保存」は /account/saved へ', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const login = newLogin('menu');
    await openAccount(page, login, '/');
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await page.getByRole('menuitem', { name: 'アカウント', exact: true }).click();
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('heading', { name: 'アカウント', level: 1 })).toBeVisible();
    await expect(page.getByText(`@${login}`).first()).toBeVisible();
    await expect(page).toHaveTitle('アカウント · Ludion');

    const tab = page.getByRole('navigation', { name: 'メイン' }).getByRole('link', { name: '保存' });
    await expect(tab).toHaveAttribute('href', '/account/saved');
    await tab.click();
    await expect(page).toHaveURL('/account/saved');
    await expect(tab).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('プロフィール', () => {
  test('変えて、読み直しても残る。x と サイトは https だけ', async ({ page }) => {
    await openAccount(page, newLogin('profile'));
    const name = page.getByLabel('表示の名前');
    await expect(name).toBeVisible();
    await name.fill('新しい名前');
    await page.getByLabel('X の URL').fill('https://x.com/someone');
    await page.getByLabel('自分のサイトの URL').fill('https://someone.example/');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('表示の名前')).toHaveValue('新しい名前');
    await expect(page.getByLabel('X の URL')).toHaveValue('https://x.com/someone');
    await expect(page.getByLabel('自分のサイトの URL')).toHaveValue('https://someone.example/');
    await expect(page.getByText('新しい名前', { exact: true })).toBeVisible();

    await page.getByLabel('自分のサイトの URL').fill('http://someone.example/');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page.getByText('https:// で始まる URL を入れてください')).toBeVisible();
    await expect(page.getByLabel('自分のサイトの URL')).toHaveAttribute('aria-invalid', 'true');
  });

  test('確かめ：だめな値は 400 で、どの項目かを返す。D1 は変わらない', async () => {
    const login = newLogin('values');
    const visitor = await loggedIn(login);
    const before = (await visitor.account()).profile;
    for (const [field, body] of [
      ['site_url', { site_url: 'http://a.example' }],
      ['site_url', { site_url: 'javascript:alert(1)' }],
      ['site_url', { site_url: 'https://user:pass@a.example' }],
      ['site_url', { site_url: `https://a.example/${'x'.repeat(200)}` }],
      ['x_url', { x_url: 'https://evil.example/someone' }],
      ['x_url', { x_url: 'http://x.com/someone' }],
      ['display_name', { display_name: 'x'.repeat(51) }],
      ['display_name', { display_name: `a${String.fromCodePoint(0x202e)}b` }],
      ['display_name', { display_name: 42 }],
    ] as const) {
      const response = await visitor.post('/api/account/profile', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json(), JSON.stringify(body)).toEqual({ error: 'invalid', field });
    }
    expect((await visitor.account()).profile).toEqual(before);
    expect((await visitor.post('/api/account/profile', 'not json')).status).toBe(400);
  });

  test('parseProfile：空は null。前後の空白を落とす。絵文字は1文字で数える', () => {
    expect(parseProfile({ display_name: '  ', x_url: '', site_url: null })).toEqual({ ok: true, values: { display_name: null, x_url: null, site_url: null } });
    expect(parseProfile({ display_name: ' 名前 ', x_url: 'https://x.com/a', site_url: 'https://a.example' })).toEqual({
      ok: true,
      values: { display_name: '名前', x_url: 'https://x.com/a', site_url: 'https://a.example/' },
    });
    expect(parseProfile({ display_name: '😀'.repeat(50) }).ok).toBe(true);
    expect(parseProfile({ display_name: '😀'.repeat(51) }).ok).toBe(false);
  });

  test('名前と URL の文字はエスケープして出す。HTML として動かない', async ({ page }) => {
    let dialog = false;
    page.on('dialog', async (open) => {
      dialog = true;
      await open.dismiss();
    });
    const login = newLogin('escape');
    await openAccount(page, login);
    const evil = '<img src=x onerror=alert(1)>';
    await page.getByLabel('表示の名前').fill(evil);
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await page.reload();
    await expect(page.getByText(evil, { exact: true })).toBeVisible();
    expect(await page.locator('main img[src="x"]').count()).toBe(0);
    expect(dialog).toBe(false);
  });

  test('外の Origin からは変えられない。Origin がなくても断る', async () => {
    const visitor = await loggedIn();
    const before = (await visitor.account()).profile;
    for (const origin of ['https://evil.example', null, 'null']) {
      expect((await visitor.post('/api/account/profile', { display_name: 'evil' }, origin)).status, String(origin)).toBe(403);
      expect((await visitor.post('/api/account/handle', { handle: 'evil_name' }, origin)).status, String(origin)).toBe(403);
      expect((await visitor.post('/api/account/sessions/revoke-others', undefined, origin)).status, String(origin)).toBe(403);
      expect((await visitor.post('/api/account/delete', undefined, origin)).status, String(origin)).toBe(403);
    }
    expect((await visitor.account()).profile).toEqual(before);
  });
});

test.describe('handle の決まり', () => {
  const statusOf = async (visitor: Visitor, handle: string) => (await (await visitor.fetch(`/api/account/handle-check?handle=${encodeURIComponent(handle)}`)).json()).status;

  test('形：短い、長い、使えない文字', async () => {
    const visitor = await loggedIn();
    for (const handle of ['', 'ab', 'x'.repeat(21), 'has-hyphen', 'has space', 'にほんご', 'a.b', '../etc']) {
      expect(await statusOf(visitor, handle), handle).toBe('format');
      const response = await visitor.post('/api/account/handle', { handle });
      expect(response.status, handle).toBe(400);
      expect(await response.json(), handle).toEqual({ error: 'handle_rejected', status: 'format' });
    }
    expect((await visitor.post('/api/account/handle', {})).status).toBe(400);
    for (const handle of ['abc', 'x'.repeat(20), 'a_b_1']) expect(await statusOf(visitor, handle), handle).toBe('ok');
    expect(HANDLE_PATTERN.test('abc')).toBe(true);
  });

  test('取れない言葉（大文字でも）', async () => {
    const visitor = await loggedIn();
    for (const handle of ['admin', 'API', 'auth', 'account', 'apply', 'ludion', 'saved', 'search', 'about', 'privacy', 'settings', 'frame', 'Ludion_Team', 'the_ludion']) {
      expect(await statusOf(visitor, handle), handle).toBe('reserved');
    }
    for (const word of ['p', 'c', 'w']) expect(isReservedHandle(word), word).toBe(true);
    expect((await visitor.post('/api/account/handle', { handle: 'admin' })).status).toBe(400);
  });

  test('結ばれていない作者の handle は、大文字小文字を変えても取れない', async () => {
    const visitor = await loggedIn();
    expect(await statusOf(visitor, 'seed_a')).toBe('reserved');
    expect(await statusOf(visitor, 'SEED_A')).toBe('reserved');
    expect((await visitor.post('/api/account/handle', { handle: 'seed_a' })).status).toBe(400);
  });

  test('他人の handle は、大文字小文字を変えても取れない。自分の今のものは same', async () => {
    const other = newLogin('other');
    await loggedIn(other);
    const visitor = await loggedIn();
    expect(await statusOf(visitor, other)).toBe('taken');
    expect(await statusOf(visitor, other.toUpperCase())).toBe('taken');
    const response = await visitor.post('/api/account/handle', { handle: other.toUpperCase() });
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe('taken');
    expect(await statusOf(other === '' ? visitor : await loggedIn(other), other)).toBe('same');
  });

  test('大文字で送っても小文字で入る', async () => {
    const visitor = await loggedIn();
    const wanted = newLogin('mixed');
    expect(await (await visitor.post('/api/account/handle', { handle: wanted.toUpperCase() })).json()).toEqual({ handle: wanted });
    expect((await visitor.account()).profile.handle).toBe(wanted);
  });

  test('前の handle は90日、ほかの人が取れない。本人は取り戻せる。過ぎたら取れる', async () => {
    const login = newLogin('holder');
    const holder = await loggedIn(login);
    const id = await userId(login);
    const next = newLogin('renamed');
    expect((await holder.post('/api/account/handle', { handle: next })).status).toBe(200);

    const [row] = await d1<{ released_at: number }>(`SELECT released_at FROM handle_history WHERE handle = ${quote(login)}`);
    const expected = Date.now() + HANDLE_HOLD_MS;
    expect(Math.abs(row.released_at - expected)).toBeLessThan(60_000);
    expect(HANDLE_HOLD_MS).toBe(90 * DAY);

    const stranger = await loggedIn();
    expect(await statusOf(stranger, login)).toBe('held');
    expect((await stranger.post('/api/account/handle', { handle: login })).status).toBe(400);

    // 89日たっても取れない。91日で取れる
    await d1(`UPDATE handle_history SET released_at = ${Date.now() + DAY} WHERE handle = ${quote(login)}`);
    expect(await statusOf(stranger, login)).toBe('held');
    await d1(`UPDATE handle_history SET released_at = ${Date.now() - 1000} WHERE handle = ${quote(login)}`);
    expect(await statusOf(stranger, login)).toBe('ok');

    // 本人は期間の中でも取り戻せる。記録は入れ替わる
    await d1(`UPDATE handle_history SET released_at = ${Date.now() + 50 * DAY} WHERE handle = ${quote(login)}`);
    expect(await statusOf(holder, login)).toBe('ok');
    expect((await holder.post('/api/account/handle', { handle: login })).status).toBe(200);
    const rows = await d1<{ handle: string }>(`SELECT handle FROM handle_history WHERE user_id = ${quote(id)}`);
    expect(rows.map(({ handle }) => handle)).toEqual([next]);
  });

  test('作者に結ばれた人が変えると、作者の handle も変わる。/c/前の handle は新しい方へ転送する', async ({ request }) => {
    const login = newLogin('creator');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    const creator = `Creator_${randomBytes(3).toString('hex')}`;
    const creatorId = `test-${creator}`;
    const workId = `test-work-${creator.toLowerCase()}`;
    await d1(`INSERT INTO creators (id, handle, name, kind, user_id, created_at) VALUES (${quote(creatorId)}, ${quote(creator)}, 'Public Name', 'person', ${quote(id)}, 1)`);
    await d1(
      `INSERT INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at, published_at)
       SELECT ${quote(workId)}, ${quote(creatorId)}, 'Own Work', type, category, subtype, made_with, version, 'approved', thumb_key, thumb_w, thumb_h, created_at, published_at FROM works WHERE id = ${quote(WORK)}`,
    );

    // 自分に結ばれた作者の handle は取れる（大文字小文字も区別しない）
    expect(await statusOf(visitor, creator)).toBe('ok');
    expect(await (await visitor.post('/api/account/handle', { handle: creator })).json()).toEqual({ handle: creator.toLowerCase() });
    const [kept] = await d1<{ handle: string }>(`SELECT handle FROM creators WHERE id = ${quote(creatorId)}`);
    expect(kept.handle.toLowerCase()).toBe(creator.toLowerCase());
    expect((await request.get(`/c/${creator}`)).status()).toBe(200);

    // 変えると、作者も一緒に移る
    const renamed = newLogin('moved');
    expect((await visitor.post('/api/account/handle', { handle: renamed })).status).toBe(200);
    expect(await d1(`SELECT handle FROM creators WHERE id = ${quote(creatorId)}`)).toEqual([{ handle: renamed }]);
    const moved = await new Visitor().fetch(`/c/${creator}?a=1`);
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe(`/c/${renamed}?a=1`);
    expect(moved.headers.get('cache-control')).toBe('private, no-store');
    expect((await new Visitor().fetch(`/en/c/${creator}`)).headers.get('location')).toBe(`/en/c/${renamed}`);
    expect((await request.get(`/c/${renamed}`)).status()).toBe(200);

    // プロフィールは、作り手のページにも写る
    expect((await visitor.post('/api/account/profile', { display_name: 'Changed Public', x_url: 'https://x.com/changed', site_url: '' })).status).toBe(200);
    const page = await (await request.get(`/c/${renamed}`)).text();
    expect(page).toContain('Changed Public');
    expect(page).toContain('https://x.com/changed');

    // 90日を過ぎたら転送しない
    await d1(`UPDATE handle_history SET released_at = ${Date.now() - 1000} WHERE handle = ${quote(creator.toLowerCase())}`);
    expect((await new Visitor().fetch(`/c/${creator}`)).status).toBe(404);
    await d1(`DELETE FROM works WHERE id = ${quote(workId)}`);
    await d1(`DELETE FROM creators WHERE id = ${quote(creatorId)}`);
  });

  test('作者に結ばれていない人の前の handle は、転送しない', async () => {
    const login = newLogin('plain');
    const visitor = await loggedIn(login);
    expect((await visitor.post('/api/account/handle', { handle: newLogin('plainer') })).status).toBe(200);
    expect((await new Visitor().fetch(`/c/${login}`)).status).toBe(404);
  });

  test('画面：先に確かめ、だめなら押せない。変えると新しい名前が出る', async ({ page }) => {
    const other = newLogin('rival');
    await loggedIn(other);
    const login = newLogin('screen');
    await openAccount(page, login);
    const input = page.getByLabel('ユーザー名');
    const button = page.getByRole('button', { name: '変える' });
    await expect(input).toHaveValue(login);
    await expect(button).toBeDisabled();

    await input.fill('ab');
    await expect(page.getByText('英小文字、数字、_ で3〜20文字にしてください')).toBeVisible();
    await expect(button).toBeDisabled();
    await input.fill('admin');
    await expect(page.getByText('このユーザー名は使えません')).toBeVisible();
    await expect(button).toBeDisabled();
    await input.fill(other);
    await expect(page.getByText('ほかの人が使っています')).toBeVisible();
    await expect(button).toBeDisabled();

    const wanted = newLogin('fresh');
    await input.fill(wanted);
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    await button.click();
    await expect(page.getByText('変えました')).toBeVisible();
    await expect(page.getByText(`@${wanted}`).first()).toBeVisible();
    await expect(page.getByText('変えると、前のユーザー名は90日間ほかの人が取れず', { exact: false })).toBeVisible();
  });

  test('手段の名前から作る候補：形に合わせる', () => {
    expect(handleBase('Foo-Bar')).toBe('foo_bar');
    expect(handleBase('--x--')).toBe('x');
    expect(handleBase('日本語')).toBeNull();
    expect(handleBase('a'.repeat(30))).toBe('a'.repeat(20));
  });

  test('新しい GitHub の人の handle は、取れない言葉と作者の handle を避ける', async () => {
    for (const [login, expected] of [
      ['admin', /^admin_\d$/],
      ['seed_a', /^seed_a_\d$/],
    ] as const) {
      await d1(`DELETE FROM identities WHERE provider = 'github' AND label = ${quote(login)}`);
      await d1(`DELETE FROM users WHERE handle GLOB ${quote(`${login}_[0-9]`)}`);
      const visitor = await loggedIn(login);
      expect((await visitor.account()).profile.handle, login).toMatch(expected);
    }
  });
});

test.describe('一覧', () => {
  test('保存、いいね、自分の作品', async ({ page }) => {
    const login = newLogin('lists');
    await openAccount(page, login);
    const origin = { Origin: ownOrigin() };
    await page.request.post(`/api/works/${WORK}/bookmark`, { headers: origin });
    await page.request.post(`/api/works/${OTHER_WORK}/like`, { headers: origin });

    // 空の自分の作品（左のナビにも同じ名前のリンクがある。WS001）
    await page.locator('main').getByRole('link', { name: '自分の作品' }).click();
    await expect(page).toHaveURL('/account/works');
    await expect(page.getByText('まだ作品がありません')).toBeVisible();
    await expect(page).toHaveTitle('自分の作品 · Ludion');
    await page.getByRole('link', { name: 'アカウント', exact: true }).click();
    await expect(page).toHaveURL('/account');

    await page.getByRole('link', { name: '保存した作品' }).click();
    await expect(page).toHaveURL('/account/saved');
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Trail Guide App' })).toBeVisible();

    await page.goto('/account/likes');
    await expect(page).toHaveTitle('いいねした作品 · Ludion');
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article').first()).toContainText('Portfolio');
  });

  test('自分の作品には、結ばれた作者の、承認済みのものだけが出る', async () => {
    const login = newLogin('owner');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    const creatorId = `test-owner-${login}`;
    await d1(`INSERT INTO creators (id, handle, kind, user_id, created_at) VALUES (${quote(creatorId)}, ${quote(`Owner${login}`.slice(0, 15))}, 'person', ${quote(id)}, 1)`);
    const copy = (workId: string, status: string) =>
      d1(
        `INSERT INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at, published_at)
         SELECT ${quote(workId)}, ${quote(creatorId)}, 'Mine', type, category, subtype, made_with, version, ${quote(status)}, thumb_key, thumb_w, thumb_h, created_at, published_at FROM works WHERE id = ${quote(WORK)}`,
      );
    await copy(`${creatorId}-public`, 'approved');
    await copy(`${creatorId}-draft`, 'draft');
    const { works } = await (await visitor.fetch('/api/account/works')).json();
    expect(works.map((work: { id: string }) => work.id)).toEqual([`${creatorId}-public`]);
    expect((await visitor.account()).works_count).toBe(1);
    await d1(`DELETE FROM works WHERE creator_id = ${quote(creatorId)}`);
    await d1(`DELETE FROM creators WHERE id = ${quote(creatorId)}`);
  });
});

test.describe('ログインの手段', () => {
  test('一覧に GitHub が出る。最後の1つは外せない', async ({ page }) => {
    const login = newLogin('method');
    await openAccount(page, login);
    await expect(page.getByText(`（${login}）`)).toBeVisible();
    await expect(page.getByText('ほかに手段がないので、外せません')).toBeVisible();

    const response = await page.request.post('/api/account/identities/github/remove', { headers: { Origin: ownOrigin() } });
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: 'last_method' });
    expect(await d1(`SELECT provider FROM identities WHERE label = ${quote(login)}`)).toEqual([{ provider: 'github' }]);
  });

  test('外すのは、直近10分以内のログインが要る。手段があれば外せて、ほかのセッションは消える', async () => {
    const login = newLogin('remove');
    const visitor = await loggedIn(login);
    const other = await loggedIn(login);
    const id = await userId(login);
    await d1(`INSERT INTO identities (user_id, provider, subject, label, avatar_url, created_at, last_used_at) VALUES (${quote(id)}, 'google', ${quote(`sub-${login}`)}, 'Google Name', 'https://google.example/a.png', 1, 1)`);

    await ageSession(id);
    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(403);
    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(403);

    expect((await visitor.login(login)).status).toBe(302);
    const avatar = (await visitor.account()).profile.avatar_url;
    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(204);
    expect(await d1(`SELECT provider FROM identities WHERE user_id = ${quote(id)}`)).toEqual([{ provider: 'github' }]);
    // ほかのセッションは消え、今の端末はそのまま使える
    expect((await other.fetch('/api/account')).status).toBe(401);
    expect((await visitor.account()).profile.avatar_url).toBe(avatar);
    expect(await d1(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ n: 1 }]);
  });

  test('手段を外すと、その手段から来たアバターは、残る手段のものに替わる', async () => {
    const login = newLogin('avatar');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    const github = `${FAKE_GITHUB}/avatars/${login}.svg`;
    await d1(`INSERT INTO identities (user_id, provider, subject, label, avatar_url, created_at, last_used_at) VALUES (${quote(id)}, 'google', ${quote(`sub-${login}`)}, 'G', 'https://google.example/a.png', 1, 1)`);
    await d1(`UPDATE users SET avatar_url = 'https://google.example/a.png' WHERE id = ${quote(id)}`);
    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(204);
    expect((await visitor.account()).profile.avatar_url).toBe(github);
  });

  test('知らない手段は 404', async () => {
    const visitor = await loggedIn();
    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(404);
  });

  test('別の手段で同じ名前でも、同じ人にしない', async () => {
    const login = newLogin('samename');
    const first = await loggedIn(login);
    const firstId = (await first.account()).profile.handle;
    // Google の行が同じ名前でも、GitHub のログインは subject でしか人を引かない
    const id = await userId(login);
    await d1(`INSERT INTO identities (user_id, provider, subject, label, avatar_url, created_at, last_used_at) VALUES ('someone-else', 'google', ${quote(`sub-${login}`)}, ${quote(login)}, NULL, 1, 1)`);
    const again = await loggedIn(login);
    expect((await again.account()).profile.handle).toBe(firstId);
    expect(await userId(login)).toBe(id);
    await d1(`DELETE FROM identities WHERE user_id = 'someone-else' AND subject = ${quote(`sub-${login}`)}`);
  });
});

test.describe('ログイン中の端末', () => {
  test('一覧：日の単位。IP と UA は持たない。「この端末」の印', async () => {
    const login = newLogin('sessions');
    const here = await loggedIn(login);
    await loggedIn(login);
    const id = await userId(login);
    const { sessions } = await here.account();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session: { current: boolean }) => session.current)).toHaveLength(1);
    for (const session of sessions) {
      expect(Object.keys(session).sort()).toEqual(['created_at', 'current', 'id', 'last_used_at']);
      expect(session.created_at % DAY).toBe(0);
      expect(session.last_used_at % DAY).toBe(0);
      expect(session.id).toMatch(/^[0-9a-f]{16}$/);
    }
    const [row] = await d1<Record<string, unknown>>(`SELECT * FROM sessions WHERE user_id = ${quote(id)} LIMIT 1`);
    expect(Object.keys(row).sort()).toEqual(['auth_at', 'created_at', 'expires_at', 'last_used_at', 'token_hash', 'user_id']);
  });

  test('最後に使った日は、日が変わったときだけ書く', async () => {
    const login = newLogin('lastused');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    const today = Math.floor(Date.now() / DAY) * DAY;
    await d1(`UPDATE sessions SET last_used_at = ${today - 3 * DAY} WHERE user_id = ${quote(id)}`);
    await visitor.account();
    expect(await d1(`SELECT last_used_at FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ last_used_at: today }]);
  });

  test('1つずつログアウトできる。他人のセッションは消せない', async () => {
    const login = newLogin('revoke');
    const here = await loggedIn(login);
    const there = await loggedIn(login);
    const { sessions } = await here.account();
    const other = sessions.find((session: { current: boolean }) => !session.current);

    const stranger = await loggedIn();
    expect((await stranger.post(`/api/account/sessions/${other.id}/revoke`)).status).toBe(404);
    expect((await there.fetch('/api/account')).status).toBe(200);

    expect((await here.post(`/api/account/sessions/${other.id}/revoke`)).status).toBe(204);
    expect((await there.fetch('/api/account')).status).toBe(401);
    expect((await here.account()).sessions).toHaveLength(1);
    expect((await here.post('/api/account/sessions/0000000000000000/revoke')).status).toBe(404);
  });

  test('今の端末を消すと cookie も消える', async () => {
    const here = await loggedIn();
    const current = (await here.account()).sessions.find((session: { current: boolean }) => session.current);
    expect((await here.post(`/api/account/sessions/${current.id}/revoke`)).status).toBe(204);
    expect(here.cookies.has('ld_session')).toBe(false);
    expect((await here.fetch('/api/account')).status).toBe(401);
  });

  test('ほかの端末を全部ログアウト。この端末は残る', async () => {
    const login = newLogin('others');
    const here = await loggedIn(login);
    const second = await loggedIn(login);
    const third = await loggedIn(login);
    expect(await (await here.post('/api/account/sessions/revoke-others')).json()).toEqual({ revoked: 2 });
    expect((await second.fetch('/api/account')).status).toBe(401);
    expect((await third.fetch('/api/account')).status).toBe(401);
    expect((await here.account()).sessions).toHaveLength(1);
  });

  test('画面：今の端末の印、ほかをログアウト、今の端末をログアウトするとホームへ', async ({ page }) => {
    const login = newLogin('devices');
    await loggedIn(login);
    await openAccount(page, login);
    await expect(page.getByText('この端末')).toBeVisible();
    await page.getByRole('button', { name: 'ほかの端末を全部ログアウト' }).click();
    await expect(page.getByRole('button', { name: 'ほかの端末を全部ログアウト' })).toHaveCount(0);
    await page.getByRole('button', { name: /にログインした端末をログアウト$/ }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
  });

  test('切れた行は、ログインのときに少しずつ消える。1人の上限を超えた行も消える', async () => {
    const login = newLogin('cleanup');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    const ghost = `ghost-${login}`;
    const values = Array.from({ length: 60 }, (_, index) => `('${index.toString(16).padStart(8, '0')}${ghost}', ${quote(ghost)}, 1)`).join(', ');
    await d1(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ${values}`);
    await visitor.login(login);
    const left = (await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ${quote(ghost)}`))[0].n;
    expect(left).toBeLessThanOrEqual(10);
    await d1(`DELETE FROM sessions WHERE user_id = ${quote(ghost)}`);

    const future = Date.now() + DAY;
    const many = Array.from({ length: 30 }, (_, index) => `('${index.toString(16).padStart(8, '0')}${id}', ${quote(id)}, ${future + index})`).join(', ');
    await d1(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ${many}`);
    await visitor.login(login);
    expect(await d1(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ n: 20 }]);
    expect((await visitor.fetch('/api/account')).status).toBe(200);
  });

  test('ログアウトの失敗は画面に出す', async ({ page }) => {
    const login = newLogin('failure');
    await loggedIn(login);
    await openAccount(page, login);
    await page.route('**/api/account/sessions/revoke-others', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await page.getByRole('button', { name: 'ほかの端末を全部ログアウト' }).click();
    await expect(page.getByText('ログアウトできませんでした')).toBeVisible();
  });
});

test.describe('もう一度のログイン', () => {
  test('intent=reauth は途中の状態に入り、ほかの値は login になる', async () => {
    const intentOf = async (visitor: Visitor) => {
      const hash = createHash('sha256').update(flowCookies(visitor.cookies, 'ld_github_flow').at(-1)![1]).digest('hex');
      const [row] = await d1<{ data: string }>(`SELECT data FROM auth_flows WHERE token_hash = ${quote(hash)}`);
      return JSON.parse(row.data).intent;
    };
    const visitor = new Visitor();
    await visitor.fetch('/auth/github?intent=reauth');
    expect(await intentOf(visitor)).toBe('reauth');
    const other = new Visitor();
    await other.fetch('/auth/github?intent=evil');
    expect(await intentOf(other)).toBe('login');
  });

  test('今の本人の GitHub なら、新しいセッションになり、前のセッションは消える', async () => {
    const login = newLogin('reauth');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    await ageSession(id);
    expect((await visitor.account()).recent_auth).toBe(false);
    const old = visitor.cookies.get('ld_session');
    expect((await visitor.login(login, '&intent=reauth')).status).toBe(302);
    expect(visitor.cookies.get('ld_session')).not.toBe(old);
    expect((await visitor.account()).recent_auth).toBe(true);
    expect(await d1(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ n: 1 }]);
  });

  test('別の GitHub の人だと断る。セッションは変わらない', async () => {
    const login = newLogin('owner');
    const stranger = newLogin('stranger');
    await loggedIn(stranger);
    const visitor = await loggedIn(login);
    const before = visitor.cookies.get('ld_session');
    const response = await visitor.login(stranger, '&intent=reauth');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?error=reauth_mismatch');
    expect(visitor.cookies.get('ld_session')).toBe(before);
    expect((await visitor.account()).profile.handle).toBe(login);
  });

  test('ログインしていないと断る。新しい人も作らない', async () => {
    const login = newLogin('nobody');
    const visitor = new Visitor();
    const response = await visitor.login(login, '&intent=reauth');
    expect(response.headers.get('location')).toBe('/?error=reauth_mismatch');
    expect(visitor.cookies.has('ld_session')).toBe(false);
    expect(await d1(`SELECT COUNT(*) AS n FROM identities WHERE label = ${quote(login)}`)).toEqual([{ n: 0 }]);
  });
});

test.describe('退会', () => {
  test('直近10分以内のログインがなければ断る。何も消えない', async () => {
    const login = newLogin('stale');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    await ageSession(id);
    const response = await visitor.post('/api/account/delete');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'reauth_required' });
    expect(await d1(`SELECT COUNT(*) AS n FROM users WHERE id = ${quote(id)}`)).toEqual([{ n: 1 }]);
  });

  test('人、手段、セッション、いいね、しおり、前の handle の記録が消える。ほかの人の行は残る', async () => {
    const login = newLogin('leave');
    const visitor = await loggedIn(login);
    const second = await loggedIn(login);
    const id = await userId(login);
    const otherLogin = newLogin('stay');
    const other = await loggedIn(otherLogin);
    const otherId = await userId(otherLogin);
    for (const actor of [visitor, other]) {
      await actor.post(`/api/works/${WORK}/like`);
      await actor.post(`/api/works/${WORK}/bookmark`);
    }
    await visitor.post('/api/account/handle', { handle: newLogin('leaving') });

    expect((await visitor.post('/api/account/delete')).status).toBe(204);
    expect(visitor.cookies.has('ld_session')).toBe(false);
    for (const table of ['likes', 'bookmarks', 'sessions', 'identities', 'handle_history']) {
      expect(await d1(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ${quote(id)}`), table).toEqual([{ n: 0 }]);
    }
    expect(await d1(`SELECT COUNT(*) AS n FROM users WHERE id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    expect((await second.fetch('/api/account')).status).toBe(401);
    expect(await (await visitor.fetch('/api/me')).json()).toEqual({ user: null });

    // ほかの人はそのまま
    expect(await d1(`SELECT COUNT(*) AS n FROM likes WHERE user_id = ${quote(otherId)}`)).toEqual([{ n: 1 }]);
    expect((await other.fetch('/api/account')).status).toBe(200);

    // 同じ GitHub でまたログインすると、新しい人になる
    await visitor.login(login);
    expect(await userId(login)).not.toBe(id);
    expect(await (await visitor.fetch('/api/me')).json()).toMatchObject({ liked: [], bookmarked: [] });
  });

  test('結ばれた作者の作品は取り下がる。作者の handle は残って、ほかの人が取れない', async ({ request }) => {
    const login = newLogin('author');
    const visitor = await loggedIn(login);
    const id = await userId(login);
    const creator = `Author_${randomBytes(3).toString('hex')}`;
    const creatorId = `test-${creator}`;
    const workId = `test-gone-${creator.toLowerCase()}`;
    await d1(`INSERT INTO creators (id, handle, name, kind, x_url, user_id, created_at) VALUES (${quote(creatorId)}, ${quote(creator)}, 'Author Name', 'person', 'https://x.com/author', ${quote(id)}, 1)`);
    await d1(
      `INSERT INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at, published_at)
       SELECT ${quote(workId)}, ${quote(creatorId)}, 'Gone Soon', type, category, subtype, made_with, version, 'approved', thumb_key, thumb_w, thumb_h, created_at, published_at FROM works WHERE id = ${quote(WORK)}`,
    );
    expect((await request.get(`/c/${creator}`)).status()).toBe(200);
    expect(((await (await request.get('/api/works')).json()).works as { id: string }[]).map((work) => work.id)).toContain(workId);

    expect((await visitor.post('/api/account/delete')).status).toBe(204);

    expect(await d1(`SELECT status, reject_reason FROM works WHERE id = ${quote(workId)}`)).toEqual([{ status: 'rejected', reject_reason: 'account_deleted' }]);
    expect(((await (await request.get('/api/works')).json()).works as { id: string }[]).map((work) => work.id)).not.toContain(workId);
    expect((await request.get(`/p/${workId}`)).status()).toBe(404);
    expect((await request.get(`/c/${creator}`)).status()).toBe(404);
    expect(await d1(`SELECT handle, name, x_url, user_id FROM creators WHERE id = ${quote(creatorId)}`)).toEqual([{ handle: creator, name: null, x_url: null, user_id: null }]);

    const stranger = await loggedIn();
    expect((await (await stranger.fetch(`/api/account/handle-check?handle=${creator.toLowerCase()}`)).json()).status).toBe('reserved');
    await d1(`DELETE FROM works WHERE id = ${quote(workId)}`);
    await d1(`DELETE FROM creators WHERE id = ${quote(creatorId)}`);
  });

  test('画面：消えるものを出す。ログインし直してから消す。やめられる', async ({ page, context }) => {
    const login = newLogin('confirm');
    await openAccount(page, login, '/account');
    const id = await userId(login);
    await page.getByRole('link', { name: '退会の手続きへ' }).click();
    await expect(page).toHaveURL('/account/delete');
    await expect(page.getByRole('heading', { name: '退会', level: 1 })).toBeVisible();
    await expect(page.getByText('いいねとしおり')).toBeVisible();
    await expect(page.getByText('コピーされたコードのクレジット行', { exact: false })).toBeVisible();
    await expect(page).toHaveTitle('退会 · Ludion');
    // 作品のない人には作品の行を出さない
    await expect(page.getByText('取り下げます')).toHaveCount(0);

    // 時間がたつと、まずログインし直す
    await ageSession(id);
    await page.reload();
    await expect(page.getByRole('button', { name: '退会する' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'GitHub でもう一度ログインする' }).last()).toHaveAttribute('href', '/auth/github?intent=reauth&next=%2Faccount%2Fdelete');
    await page.getByRole('link', { name: 'GitHub でもう一度ログインする' }).last().click();
    await expect(page).toHaveURL('/account/delete');

    await page.getByRole('link', { name: 'やめる' }).click();
    await expect(page).toHaveURL('/account');
    await page.goBack();

    await page.getByRole('button', { name: '退会する' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    expect((await context.cookies()).filter((cookie) => cookie.name === 'ld_session')).toEqual([]);
    expect(await d1(`SELECT COUNT(*) AS n FROM users WHERE id = ${quote(id)}`)).toEqual([{ n: 0 }]);
  });

  test('画面：別のアカウントでログインし直すと断りを出す', async ({ page }) => {
    const login = newLogin('mismatch');
    const other = newLogin('wrong');
    await loggedIn(other);
    await openAccount(page, login, '/account/delete');
    const id = await userId(login);
    await ageSession(id);
    await page.reload();
    await page.context().addCookies([{ name: 'fake_user', value: other, url: FAKE_GITHUB }]);
    await page.getByRole('link', { name: 'GitHub でもう一度ログインする' }).click();
    await expect(page).toHaveURL('/account/delete?error=reauth_mismatch');
    await expect(page.getByRole('alert')).toContainText('別のアカウント');
    await expect(page.getByText(`@${login}`)).toBeVisible();
  });

  test('作品のある人には、取り下げる数を出す', async ({ page }) => {
    const login = newLogin('warns');
    await openAccount(page, login, '/account/delete');
    const id = await userId(login);
    const creatorId = `test-warn-${login}`;
    await d1(`INSERT INTO creators (id, handle, kind, user_id, created_at) VALUES (${quote(creatorId)}, ${quote(`W${login}`.slice(0, 15))}, 'person', ${quote(id)}, 1)`);
    await d1(
      `INSERT INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at, published_at)
       SELECT ${quote(`${creatorId}-w`)}, ${quote(creatorId)}, 'Warn', type, category, subtype, made_with, version, 'approved', thumb_key, thumb_w, thumb_h, created_at, published_at FROM works WHERE id = ${quote(WORK)}`,
    );
    await page.reload();
    await expect(page.getByText('あなたの作品 1 件は Ludion から取り下げます')).toBeVisible();
    await d1(`DELETE FROM works WHERE creator_id = ${quote(creatorId)}`);
    await d1(`DELETE FROM creators WHERE id = ${quote(creatorId)}`);
  });
});

test.describe('英語', () => {
  test('/en/account は英語で出て、言語を保つ', async ({ page }) => {
    const login = newLogin('english');
    await openAccount(page, login, '/en/account');
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Saved designs' }).click();
    await expect(page).toHaveURL('/en/account/saved');
    await expect(page.getByText('Nothing saved yet.')).toBeVisible();
    await page.goto('/en/account/delete');
    await expect(page.getByRole('heading', { name: 'Delete account', level: 1 })).toBeVisible();
  });
});

test.describe('見た目', () => {
  for (const width of [390, 1440]) {
    test(`幅${width}：axe の critical と serious が0。横にはみ出さない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const login = newLogin(`axe${width}`);
      await loggedIn(login);
      await openAccount(page, login);
      await expect(page.getByLabel('表示の名前')).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);

      for (const path of ['/account/delete', '/account/likes', '/account/works', '/account/saved']) {
        await page.goto(path);
        await expect(page.getByRole('link', { name: 'アカウント', exact: true }).or(page.getByRole('heading', { name: '退会', level: 1 })).first()).toBeVisible();
        expect(await runAxe(page), path).toEqual([]);
        expect(await pageOverflow(page), path).toBe(0);
      }
    });
  }

  test('幅390：押すものは高さ44px 以上', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const login = newLogin('touch');
    await loggedIn(login);
    await openAccount(page, login);
    await expect(page.getByRole('button', { name: '保存する' })).toBeVisible();
    for (const target of [
      page.getByRole('button', { name: '保存する' }),
      page.getByRole('button', { name: '変える' }),
      page.getByRole('link', { name: '保存した作品' }),
      page.getByRole('button', { name: 'ほかの端末を全部ログアウト' }),
      page.getByRole('link', { name: '退会の手続きへ' }),
    ]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('回数の制限', () => {
  test('LIMIT_ACCOUNT が /api/account の全部に効く', async () => {
    const visitor = await loggedIn();
    const headers = { 'CF-Connecting-IP': `203.0.113.${(Date.now() % 200) + 1}` };
    let limited = 0;
    const answers = await Promise.all(Array.from({ length: 70 }, () => visitor.fetch('/api/account/handle-check?handle=abc', { headers })));
    for (const response of answers) if (response.status === 429) limited += 1;
    expect(limited).toBeGreaterThan(0);
  });
});
