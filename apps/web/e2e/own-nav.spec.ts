// 左のナビとスマホのシートの「自分の作品」（WS001）。手元の偽の GitHub と本物の workerd で通す。
// 1つのテストごとに別の人でログインし、別の作品を作るので、互いの行に触らない。

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Visitor, ownOrigin } from './visitor';

const WEB = join(import.meta.dirname, '..');
const REPO = join(WEB, '../..');
const WRANGLER = join(REPO, 'node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const unique = (label: string) => `${label}${randomBytes(4).toString('hex')}`;

function d1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

/** 手元で作る PNG。 */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const name = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
    return Buffer.concat([length, name, data, crc]);
  };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at++] = 0;
    for (let x = 0; x < width; x += 1) for (const value of [x % 256, y % 256, 140, 255]) raw[at++] = value;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const THUMB = png(800, 500);

function formOf(id: string, title: string, thumb: boolean) {
  const form = new FormData();
  form.append('meta', JSON.stringify({ id, title, category: 'Components', subtype: 'Toggle', tags: ['minimal'], motion: false, made_with: 'human' }));
  form.append('part.html', `<div data-ld-part="${id}"><button type="button">押す</button></div>`);
  form.append('part.css', `[data-ld-part="${id}"] { color: #123456; border-radius: 3px; }`);
  if (thumb) form.append('thumb', new Blob([new Uint8Array(THUMB)], { type: 'image/png' }), 'x.png');
  return form;
}

const CONFIRM = { own: true, mit: true, terms: true };
type Revision = { id: string; content_hash: string };

async function person(label: string) {
  const visitor = new Visitor();
  const login = unique(label);
  expect((await visitor.login(login)).status).toBe(302);
  const { handle } = (await visitor.me()).user as { handle: string };
  return { visitor, login, handle };
}

async function draft(visitor: Visitor, title: string, thumb = true) {
  const id = unique('nav-');
  const response = await visitor.fetch('/api/post/works', { method: 'POST', body: formOf(id, title, thumb), headers: { Origin: ownOrigin() } });
  expect(response.status, await response.clone().text()).toBe(201);
  return { id, revision: ((await response.json()) as { revision: Revision }).revision };
}

async function privateWork(visitor: Visitor, title: string) {
  const made = await draft(visitor, title);
  expect((await visitor.post(`/api/post/revisions/${made.revision.id}/place`, CONFIRM)).status).toBe(200);
  return made;
}

async function publicWork(visitor: Visitor, title: string) {
  const reviewer = await person('navreviewer');
  d1(`UPDATE users SET is_operator = 1 WHERE handle = ${quote(reviewer.handle)}`);
  const made = await draft(visitor, title);
  expect((await visitor.post(`/api/post/revisions/${made.revision.id}/submit`, CONFIRM)).status).toBe(200);
  expect((await reviewer.visitor.post(`/api/review/revisions/${made.revision.id}/approve`, { content_hash: made.revision.content_hash })).status).toBe(200);
  return made;
}

async function logInPage(page: Page, path: string, login = unique('navscreen')) {
  await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
  await page.goto(`/auth/github?next=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(path);
  return login;
}

/** 公開、自分だけ、下書き（画像なし）の3つを、この順に作る（並びは新しい順なので、下書きが上） */
async function threeWorks(label: string) {
  const owner = await person(label);
  const pub = await publicWork(owner.visitor, `ナビの公開 ${label}`);
  const own = await privateWork(owner.visitor, `ナビの自分だけ ${label}`);
  const first = await draft(owner.visitor, `ナビの下書き ${label}`, false);
  return { ...owner, pub, own, first };
}

const aside = (page: Page) => page.getByRole('complementary');
const navWidth = async (page: Page) => (await aside(page).boundingBox())!.width;

test.describe('PC の左のナビ（WS001「1」）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('作品のある人：開いた形（264）が初め。新しい順、版、状態の印を言葉で読む。1回押すと作品のページで、その行に aria-current', async ({ page }) => {
    const { login, pub, own, first } = await threeWorks('navopen');
    await logInPage(page, '/', login);
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'open');
    expect(await navWidth(page)).toBe(264);

    const panel = aside(page).getByRole('region', { name: '自分の作品' });
    const rows = panel.locator('[data-own-nav-work]');
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-own-nav-work')))).toEqual([first.id, own.id, pub.id]);
    // 状態の印は、読み上げで言葉になる（自分の作品のページの札と同じ言葉）
    await expect(rows.nth(0).getByRole('link')).toHaveAccessibleName('ナビの下書き navopen 版 1 下書き');
    await expect(rows.nth(1).getByRole('link')).toHaveAccessibleName('ナビの自分だけ navopen 版 1 自分だけ');
    await expect(rows.nth(2).getByRole('link')).toHaveAccessibleName('ナビの公開 navopen 版 1 公開');
    // 画像のない作品はコードの印、ある作品は小さなサムネイル
    await expect(rows.nth(0).locator('img')).toHaveCount(0);
    await expect(rows.nth(1).locator('img')).toHaveCount(1);
    // ホーム、探す、保存には名前が付く
    await expect(aside(page).getByRole('navigation', { name: 'メイン' }).getByText('ホーム', { exact: true })).toBeVisible();

    // 1回押すと作品のページ。自分だけの作品も今の開き方（読み込み直す）
    await rows.nth(1).getByRole('link').click();
    await expect(page).toHaveURL(`/p/${own.id}`);
    const current = aside(page).locator(`[data-own-nav-work="${own.id}"]`).getByRole('link');
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(aside(page).locator(`[data-own-nav-work="${pub.id}"]`).getByRole('link')).not.toHaveAttribute('aria-current');

    // まだページのない下書きは、続きを書く画面へ
    await expect(aside(page).locator(`[data-own-nav-work="${first.id}"]`).getByRole('link')).toHaveAttribute('href', `/new?work=${first.id}`);

    // 題で絞る
    await aside(page).getByRole('searchbox', { name: '題で探す' }).fill('公開');
    await expect(aside(page).locator('[data-own-nav-work]')).toHaveCount(1);
    await aside(page).getByRole('searchbox', { name: '題で探す' }).fill('ない題');
    await expect(aside(page).getByText('合う作品はありません')).toBeVisible();

    // 「すべての作品」は自分の作品のページへ
    await aside(page).getByRole('link', { name: 'すべての作品' }).click();
    await expect(page).toHaveURL('/account/works');
  });

  test('たたむと68で、読み直してもたたんだまま。たたんだ形にも「自分の作品」。ひらくと戻る', async ({ page }) => {
    const { login, own } = await threeWorks('navfold');
    await logInPage(page, '/', login);
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'open');
    await aside(page).getByRole('button', { name: '左のナビをたたむ' }).click();
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'closed');
    expect(await navWidth(page)).toBe(68);

    // 読み直しても、最初の描画からたたんだ形（中身の幅が動かない）
    await page.reload();
    await expect(aside(page).getByRole('link', { name: '自分の作品' })).toHaveAttribute('href', '/account/works');
    expect(await navWidth(page)).toBe(68);
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'closed');

    await aside(page).getByRole('button', { name: '左のナビを広げる' }).click();
    await expect(aside(page).locator(`[data-own-nav-work="${own.id}"]`)).toBeVisible();
    expect(await navWidth(page)).toBe(264);

    // 開いた形の端末は、最初の描画の前から 264（ログインの答えを待たない）
    await page.route('**/api/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-nav'))).toBe('open');
    expect(await navWidth(page)).toBe(264);
  });

  test('localStorage が読めない端末でも、作品のある人は開いた形。押せば、開いている間はたためる', async ({ page }) => {
    const { login } = await threeWorks('navstore');
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await logInPage(page, '/', login);
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'open');
    await aside(page).getByRole('button', { name: '左のナビをたたむ' }).click();
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'closed');
  });

  test('作品が 0 の人：たたんだ形。「自分の作品」は自分の作品のページへ。ひらくと「AI につなぐと…」とつなぎ方へのリンク', async ({ page }) => {
    await logInPage(page, '/');
    await expect(aside(page).getByRole('button', { name: '左のナビを広げる' })).toBeVisible();
    expect(await navWidth(page)).toBe(68);
    await expect(aside(page).getByRole('link', { name: '自分の作品' })).toHaveAttribute('href', '/account/works');

    await aside(page).getByRole('button', { name: '左のナビを広げる' }).click();
    await expect(aside(page).getByText('AI につなぐと、作ったものがここに並ぶ')).toBeVisible();
    await aside(page).getByRole('link', { name: 'AI のつなぎ方' }).click();
    await expect(page).toHaveURL('/account#ai-connect');
    await expect(page.getByRole('heading', { name: 'AI につなぐ' })).toBeInViewport();
  });

  test('ログインしていない人：68 のまま。「自分の作品」はログインへ行き、「ログインすると…」の1行を読む', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    expect(await navWidth(page)).toBe(68);
    const folder = aside(page).getByRole('link', { name: '自分の作品' });
    await expect(folder).toHaveAttribute('href', `/login?next=${encodeURIComponent('/account/works')}`);
    await expect(folder).toHaveAccessibleDescription('ログインすると、作った作品がここに並ぶ');
    await expect(aside(page).getByRole('button')).toHaveCount(0);
  });

  test('作品のある人の API は GET /api/me と GET /api/post/works の2本。ページを移っても読み直さない', async ({ page }) => {
    const { login } = await threeWorks('navapi');
    await logInPage(page, '/account', login);
    const api: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/')) api.push(`${request.method()} ${pathname}`);
    });
    await page.goto('/');
    await expect(aside(page).locator('[data-own-nav-work]')).toHaveCount(3);
    await page.waitForLoadState('networkidle');
    // 自分の作品の一覧は、本人の答えの後に1回だけ
    expect(api.filter((line) => line === 'GET /api/post/works')).toHaveLength(1);
    expect(api.indexOf('GET /api/me')).toBeLessThan(api.indexOf('GET /api/post/works'));
    // 画面の中で移る（探す、保存）
    await aside(page).getByRole('link', { name: '探す' }).click();
    await expect(page).toHaveURL('/?sort=new');
    await aside(page).getByRole('link', { name: '保存' }).click();
    await expect(page).toHaveURL('/account/saved');
    await page.waitForLoadState('networkidle');
    expect(api.filter((line) => line === 'GET /api/post/works')).toHaveLength(1);
  });

  test('自分の作品のページで自分だけにすると、ナビの印も読み直さずに変わる', async ({ page }) => {
    const { login, pub } = await threeWorks('navsync');
    await logInPage(page, '/account/works', login);
    const mark = aside(page).locator(`[data-own-nav-work="${pub.id}"] [data-own-nav-state]`);
    await expect(mark).toHaveAttribute('data-own-nav-state', 'public');
    await page.getByRole('button', { name: 'ナビの公開 navsyncを自分だけにする' }).click();
    await page.locator('[data-own-work-confirm="private"]').getByRole('button', { name: '自分だけにする' }).click();
    await expect(mark).toHaveAttribute('data-own-nav-state', 'private');
  });

  test('キーだけで：ナビの全部（ホームから「たたむ」まで）を Tab でたどれ、枠が見える', async ({ page }) => {
    const { login } = await threeWorks('navkeys');
    await logInPage(page, '/', login);
    await expect(aside(page).locator('[data-own-nav-work]')).toHaveCount(3);
    await aside(page).getByRole('link', { name: 'ホーム' }).focus();
    const visited: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      visited.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || ''));
      await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Tab');
    }
    expect(visited).toEqual([
      'ホーム',
      '探す',
      '保存',
      '自分の作品',
      '新しい作品を置く',
      '題で探す',
      `ナビの下書き navkeys版 1下書き`,
      `ナビの自分だけ navkeys版 1自分だけ`,
      `ナビの公開 navkeys版 1公開`,
      'すべての作品',
    ]);
    await expect(aside(page).getByRole('button', { name: '左のナビをたたむ' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'closed');
  });
});

test.describe('スマホの「作品」とシート（WS001「2」）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const tabs = (page: Page) => page.locator('nav.fixed');

  test('ログインしていない人は3つのまま。している人は4つ（ホーム、探す、作品、保存）', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    await expect(tabs(page).locator('a, button')).toHaveCount(3);

    await logInPage(page, '/');
    await expect(tabs(page).getByRole('button', { name: '作品' })).toBeVisible();
    const names = await tabs(page).locator('a, button').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
    expect(names).toEqual(['ホーム', '探す', '作品', '保存']);
  });

  test('「作品」を押すと下からシート。絞り、触る所は高さ44以上。行を押すと作品のページ（2回）', async ({ page }) => {
    const { login, pub, own } = await threeWorks('navsheet');
    await logInPage(page, '/', login);
    await tabs(page).getByRole('button', { name: '作品' }).click();
    const sheet = page.getByRole('dialog', { name: '自分の作品' });
    await expect(sheet).toBeVisible();
    // 出てくる動き（160ms）が終わってから測る
    await expect.poll(async () => {
      const box = (await sheet.boundingBox())!;
      return Math.round(box.y + box.height);
    }).toBe(844);
    await expect(sheet.getByRole('link', { name: '新しい作品を置く' })).toHaveAttribute('href', '/new');
    await expect(sheet.getByRole('searchbox', { name: '題で探す' })).toBeVisible();

    const rows = sheet.locator('[data-own-nav-work]');
    await expect(rows).toHaveCount(3);
    for (const target of await sheet.locator('a, button, input').all()) {
      if (!(await target.isVisible())) continue;
      expect((await target.boundingBox())!.height, await target.evaluate((element) => element.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }

    await sheet.getByRole('button', { name: '自分だけ' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-own-nav-work', own.id);
    await sheet.getByRole('button', { name: '公開' }).click();
    await expect(rows.first()).toHaveAttribute('data-own-nav-work', pub.id);
    await rows.first().getByRole('link').click();
    await expect(page).toHaveURL(`/p/${pub.id}`);
  });

  test('Escape と外を押すと閉じて、押したボタンに戻る。開いている間はシートの中だけを Tab で回る', async ({ page }) => {
    const { login } = await threeWorks('navtrap');
    await logInPage(page, '/', login);
    const button = tabs(page).getByRole('button', { name: '作品' });
    const sheet = page.getByRole('dialog', { name: '自分の作品' });

    await button.click();
    await expect(sheet.locator('[data-own-nav-work]')).toHaveCount(3);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    for (let i = 0; i < 24; i += 1) {
      await page.keyboard.press('Tab');
      const outside = await page.evaluate(() => {
        const active = document.activeElement;
        return active !== null && active !== document.body && !document.querySelector('dialog[open]')!.contains(active);
      });
      expect(outside, `Tab ${i + 1}回目`).toBe(false);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.click();
    await expect(sheet).toBeVisible();
    // 後ろの暗い所（シートの上）を押す
    await page.mouse.click(195, 20);
    await expect(sheet).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});
