// FIX-nav-refresh：ほかの所（AI の口）で置いた作品が、開いているページの「自分の作品」に、画面に戻ったときに出る。
// playwright.config.ts の nav-refresh-* で、Chromium、WebKit、Firefox の全部で流す。サーバーは pages と同じ。
// 人と作品は HTTP だけで作る（偽の GitHub でログイン、AI の鍵、/api/v1）。手元の D1 のファイルを直に開かないので、ほかの pages のテストと並んで走ってよい。
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { Visitor, ownOrigin } from './visitor';

const CONFIRM = { own: true, mit: true, terms: true };
const WORKS = 'GET /api/post/works';
/**
 * ページを開いた時刻。時計（Date.now() とタイマー）をこの値で止めてから開き、進めるときだけ進める（stopClock、at）。
 * 15秒の境と、15秒の所で読むタイマーを、試験の速さに頼らずに確かめるため
 */
const OPENED = Date.UTC(2026, 10, 12, 3, 0, 0);

/** 時計を止める。ページを開く前に呼ぶ。開いた後は、at で進めたときだけ、時刻が進み、タイマーが動く */
async function stopClock(page: Page) {
  await page.clock.install({ time: OPENED - 1_000 });
  await page.clock.pauseAt(OPENED);
}
/** 開いた時刻から ms たった所まで、時計を進める（その間に来るタイマーは動く） */
const at = (page: Page, ms: number) => page.clock.pauseAt(OPENED + ms);
/**
 * 時計を 100ms ずつ進めながら、read が expected を返すまで待つ。「自分の作品」の中身とスマホのシートは lazy の部品で、
 * 初めて出すとき、React は代わりの物を出してからタイマーで中身に替えるので、時計を止めたままだと出ないことがある。
 * 進めるのは合わせて1秒ほどで、試験が見る15秒の境には届かない（境は開いた時刻から数え、at で決まった時刻に進める）
 */
async function stepUntil<T>(page: Page, read: () => Promise<T>, expected: T) {
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return read();
    })
    .toBe(expected);
}
/** 行が count 個になるまで、時計を進めながら待つ */
const shown = (page: Page, rows: Locator, count: number) => stepUntil(page, () => rows.count(), count);
const unique = (label: string) => `${label}${randomBytes(4).toString('hex')}`;

/** AI がふつうに書く1つの HTML 文書。 */
const doc = (title: string, text: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title><style>body { margin: 0; background: #0b1020; color: #f4f4f5; font: 600 40px system-ui, sans-serif; }</style></head>
<body><p>${text}</p></body>
</html>
`;

/** ログインして、AI の鍵を作る。 */
async function person(label: string) {
  const visitor = new Visitor();
  expect((await visitor.login(unique(label))).status).toBe(302);
  expect(visitor.cookies.get('ld_session')).toBeTruthy();
  const made = await visitor.post('/api/account/ai-keys', { name: 'Claude Code', ...CONFIRM });
  expect(made.status, await made.clone().text()).toBe(201);
  return { visitor, secret: ((await made.json()) as { secret: string }).secret };
}

/** AI の口で置く（path が /versions なら、今ある作品の新しい版）。自分だけの作品になる。 */
async function send(secret: string, path: string, title: string, text: string): Promise<string> {
  const response = await fetch(new URL(path, ownOrigin()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: doc(title, text) }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
const put = (secret: string, label: string) => send(secret, '/api/v1/works', unique(`${label} `), 'one');
const putVersion = (secret: string, id: string) => send(secret, `/api/v1/works/${id}/versions`, unique('Next '), 'two');

/**
 * ブラウザで、その人として開く。HTTP でログインしたセッションの cookie を渡す
 * （WebKit は http の手元で Secure の cookie を持たないので、ブラウザでログインの流れを通さない。thumb-capture.spec.ts と同じ）。
 */
async function openAs(page: Page, visitor: Visitor, path: string) {
  await page.context().addCookies([{ name: 'ld_session', value: visitor.cookies.get('ld_session')!, url: ownOrigin() }]);
  await page.goto(path);
  await expect(page).toHaveURL(path);
}

/**
 * 作品のある人として開き、開いたときの読み（GET /api/post/works）の答えが来るまで待つ。読みは止めた時計の OPENED に始まるので、
 * 前に読んだ時刻は OPENED になる。この後で shown が時計を進めても、15秒の境は開いた時刻から数えたまま
 */
async function openWithWorks(page: Page, visitor: Visitor) {
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/post/works');
  await openAs(page, visitor, '/');
  await (await answered).finished();
}

/** ページが出した API の要求を、出た順に集める。 */
function record(page: Page): string[] {
  const api: string[] = [];
  page.on('request', (request) => {
    const { pathname, search } = new URL(request.url());
    if (pathname.startsWith('/api/')) api.push(`${request.method()} ${pathname}${search}`);
  });
  return api;
}
const reads = (api: string[]) => api.filter((line) => line === WORKS).length;

/**
 * ここまでにページが出した要求が、全部集まるまで待つ。印の要求を1本出し、それが集まったら、その前の要求も集まっている
 * （合図で出る読み直しは、合図の中で出る）。「要求が出ない」を、待ち時間ではなく順で確かめるため。
 */
async function settled(page: Page, api: string[]) {
  const mark = `/api/me?mark=${unique('')}`;
  await page.evaluate(async (url) => {
    await (await fetch(url)).text();
  }, mark);
  await expect.poll(() => api.includes(`GET ${mark}`)).toBe(true);
}

// Playwright ではタブを本当には隠せないので、ブラウザが出すのと同じ合図を送る
const setVisibility = (page: Page, value: 'hidden' | 'visible') =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
/** タブを離れる */
const leave = (page: Page) => setVisibility(page, 'hidden');
/** タブに戻る（hidden から visible） */
const comeBack = (page: Page) => setVisibility(page, 'visible');
/** ウィンドウが選ばれる */
const focusWindow = (page: Page) => page.evaluate(() => void window.dispatchEvent(new Event('focus')));

const aside = (page: Page) => page.getByRole('complementary');
const idsOf = (rows: Locator) => rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-own-nav-work')));

test.describe('PC の左のナビ：画面に戻ったときに読み直す（FIX-nav-refresh）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('作品のある人：タブに戻ると、ほかで置いた作品が一番上に出る。読み直しの間も今の行は消えない。15秒以内は、その場では読まない。1回の戻りで要求は1本', async ({ page }) => {
    const owner = await person('navback');
    const a = await put(owner.secret, 'Back A');
    const b = await put(owner.secret, 'Back B');
    const api = record(page);
    await stopClock(page);
    await openWithWorks(page, owner.visitor);
    const rows = aside(page).locator('[data-own-nav-work]');
    await shown(page, rows, 2);
    expect(await idsOf(rows)).toEqual([b, a]);
    await settled(page, api);
    expect(reads(api), '開いたときの1回').toBe(1);

    // ほかの所で置く。開いているページには、まだ出ない
    const c = await put(owner.secret, 'Back C');
    // 開いてから15秒以内（1ミリ秒前）に戻っても、その場では読まない
    await leave(page);
    await at(page, 14_999);
    await comeBack(page);
    await focusWindow(page);
    await settled(page, api);
    expect(reads(api), '15秒以内は、その場では読まない').toBe(1);
    await expect(rows).toHaveCount(2);

    // 15秒たった。その前に離れたので、15秒の所でも読まない。離れる合図（hidden）でも読まない
    await leave(page);
    await at(page, 15_000);
    await focusWindow(page);
    await settled(page, api);
    expect(reads(api), '見えていない間は読まない').toBe(1);

    // 応答を止めておき、読み直しの間も今の行が残っていることを見る
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/post/works', async (route) => {
      await held;
      await route.continue();
    });
    await rows.evaluateAll((items) => items.forEach((item) => ((item as HTMLElement & { kept?: boolean }).kept = true)));
    const from = api.length;
    // 戻る。ブラウザは visibilitychange と focus を続けて出す（戻るで前のページが出たときは pageshow も）
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect.poll(() => reads(api)).toBe(2);
    await expect(rows).toHaveCount(2);
    await expect(aside(page).locator('[aria-busy="true"]')).toHaveCount(0);
    release();

    // 増えた行が一番上に入るだけ。前からある行は同じ要素のまま（作り直していない）
    await expect(rows).toHaveCount(3);
    expect(await idsOf(rows)).toEqual([c, b, a]);
    expect(await rows.evaluateAll((items) => items.map((item) => (item as HTMLElement & { kept?: boolean }).kept === true))).toEqual([false, true, true]);
    await page.unroute('**/api/post/works');
    // 読み上げの知らせは足していない
    await expect(aside(page).locator('[aria-live]')).toHaveCount(0);

    // 読んだすぐ後にもう一度戻っても、読まない
    await leave(page);
    await comeBack(page);
    await focusWindow(page);
    await settled(page, api);
    // 1回の戻り（3つの合図）で出た要求は、GET /api/post/works の1本だけ
    expect(api.slice(from).filter((line) => !line.includes('?mark='))).toEqual([WORKS]);
    expect(reads(api)).toBe(2);
  });

  test('ウィンドウが選ばれたとき（focus）も読み直す。行の順が変わっても、キーボードのフォーカスは同じ作品の行に残る', async ({ page }) => {
    const owner = await person('navfocus');
    const a = await put(owner.secret, 'Focus A');
    const b = await put(owner.secret, 'Focus B');
    const api = record(page);
    await stopClock(page);
    await openWithWorks(page, owner.visitor);
    const rows = aside(page).locator('[data-own-nav-work]');
    await shown(page, rows, 2);
    expect(await idsOf(rows)).toEqual([b, a]);

    const link = (id: string) => aside(page).locator(`[data-own-nav-work="${id}"]`).getByRole('link');
    await link(b).focus();
    await expect(link(b)).toBeFocused();

    // 下の作品 A に新しい版（A が B の上に来る）と、新しい作品 C
    await putVersion(owner.secret, a);
    const c = await put(owner.secret, 'Focus C');
    // 合図の前は、まだ出ていない
    await settled(page, api);
    expect(reads(api)).toBe(1);
    expect(await idsOf(rows)).toEqual([b, a]);
    await expect(link(a)).toHaveAccessibleName(/版 1 自分だけ$/);
    await at(page, 15_000);
    await focusWindow(page);
    await expect(rows).toHaveCount(3);
    expect(await idsOf(rows)).toEqual([c, a, b]);
    await expect(link(a)).toHaveAccessibleName(/版 2 自分だけ$/);
    await expect(link(b)).toBeFocused();
    await settled(page, api);
    expect(reads(api), '開いたときと、戻ったときの1回ずつ').toBe(2);
  });

  test('作品が 0 の人：開いたときは読まない。戻ると読み、初めての作品が出て、ナビが開いた形に変わる（0 → 1）', async ({ page }) => {
    const owner = await person('navzero');
    const api = record(page);
    await stopClock(page);
    await openAs(page, owner.visitor, '/');
    await expect(aside(page).getByRole('button', { name: '左のナビを広げる' })).toBeVisible();
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'closed');
    // 開いたとき、開いてすぐの合図では読まない（ホームの API は GET /api/me の1本だけ）
    await comeBack(page);
    await focusWindow(page);
    await settled(page, api);
    expect(reads(api), '開いたときは読まない').toBe(0);

    await leave(page);
    const first = await put(owner.secret, 'First');
    // 合図の前は、まだ出ていない（たたんだ形のまま）
    await settled(page, api);
    expect(reads(api)).toBe(0);
    await expect(aside(page).locator('[data-own-nav-work]')).toHaveCount(0);
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'closed');
    await at(page, 15_000);
    await comeBack(page);
    // 読んだ答えで、ナビが開いた形に変わる
    await expect(aside(page)).toHaveAttribute('data-nav-form', 'open');
    // 開いた形で初めて出す「自分の作品」の中身（lazy）は、時計を進めながら待つ（読み直しのタイマーは、読んだときに消えている。下で要求が増えていないことを見る）
    const rows = aside(page).locator('[data-own-nav-work]');
    await shown(page, rows, 1);
    expect(await idsOf(rows)).toEqual([first]);
    await settled(page, api);
    expect(reads(api)).toBe(1);
  });

  test('見る → 端末に戻る → 作品が置かれる → 15秒以内にまた見る：15秒の所で1回だけ読み、作品が出る。タイマーは1つで、その後は読まない', async ({ page }) => {
    const owner = await person('navlater');
    const a = await put(owner.secret, 'Later A');
    const api = record(page);
    await stopClock(page);
    await openWithWorks(page, owner.visitor);
    const rows = aside(page).locator('[data-own-nav-work]');
    await shown(page, rows, 1);
    await settled(page, api);
    expect(reads(api), '開いたときの1回').toBe(1);
    const from = api.length;

    // 端末に戻る（タブを離れる）。そこで作品が置かれる
    await at(page, 3_000);
    await leave(page);
    const b = await put(owner.secret, 'Later B');
    // 15秒以内にまた見る。その場では読まない
    await at(page, 8_000);
    await comeBack(page);
    await focusWindow(page);
    // 何度戻っても、タイマーは1つ
    await at(page, 10_000);
    await leave(page);
    await comeBack(page);
    await focusWindow(page);
    await settled(page, api);
    expect(reads(api), '15秒以内は、その場では読まない').toBe(1);
    await expect(rows).toHaveCount(1);

    // 15秒の1ミリ秒前は、まだ読まない
    await at(page, 14_999);
    await settled(page, api);
    expect(reads(api)).toBe(1);
    // 15秒の所で読み、作品が一番上に出る
    await at(page, 15_000);
    await expect.poll(() => reads(api)).toBe(2);
    await expect(rows).toHaveCount(2);
    expect(await idsOf(rows)).toEqual([b, a]);

    // その後は、戻らなければ読まない（定期的には読まない）
    await at(page, 60_000);
    await settled(page, api);
    expect(reads(api), 'タイマーは1回だけ').toBe(2);
    // 戻りの分の要求は、GET /api/post/works の1本だけ
    expect(api.slice(from).filter((line) => !line.includes('?mark='))).toEqual([WORKS]);
  });

  test('15秒以内に戻った後、15秒の所で見えていなければ読まず、次に戻ったときに読む', async ({ page }) => {
    const owner = await person('navlaterhidden');
    const a = await put(owner.secret, 'Hidden A');
    const api = record(page);
    await stopClock(page);
    await openWithWorks(page, owner.visitor);
    const rows = aside(page).locator('[data-own-nav-work]');
    await shown(page, rows, 1);
    await settled(page, api);
    expect(reads(api)).toBe(1);

    await leave(page);
    const b = await put(owner.secret, 'Hidden B');
    // 15秒以内に戻り、また離れる
    await at(page, 5_000);
    await comeBack(page);
    await at(page, 6_000);
    await leave(page);
    // 15秒の所では、見えていないので読まない。その後も読まない
    await at(page, 15_000);
    await at(page, 40_000);
    await settled(page, api);
    expect(reads(api), '見えていない間は読まない').toBe(1);
    await expect(rows).toHaveCount(1);

    // 次に戻ったとき（15秒たっている）に読む
    await comeBack(page);
    await expect.poll(() => reads(api)).toBe(2);
    await expect(rows).toHaveCount(2);
    expect(await idsOf(rows)).toEqual([b, a]);
  });

  test('ログインしていない人：戻っても読まない', async ({ page }) => {
    const api = record(page);
    await stopClock(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    await settled(page, api);
    await leave(page);
    await at(page, 15_000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await settled(page, api);
    expect(reads(api)).toBe(0);
    // 15秒以内の戻りの後、15秒の所でも読まない（タイマーを置かない）
    await leave(page);
    await at(page, 20_000);
    await comeBack(page);
    await focusWindow(page);
    await at(page, 40_000);
    await settled(page, api);
    expect(reads(api)).toBe(0);
  });
});

test.describe('スマホのシート：画面に戻ったときに読み直す（FIX-nav-refresh）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('開いているシートにも、戻ると増えた行が一番上に入る。フォーカスは同じ作品の行に残る', async ({ page }) => {
    const owner = await person('navsheetback');
    const a = await put(owner.secret, 'Sheet A');
    await stopClock(page);
    await openWithWorks(page, owner.visitor);
    await page.locator('nav.fixed').getByRole('button', { name: '作品' }).click();
    const sheet = page.getByRole('dialog', { name: '自分の作品' });
    await stepUntil(page, () => sheet.isVisible(), true);
    const rows = sheet.locator('[data-own-nav-work]');
    await shown(page, rows, 1);
    const link = sheet.locator(`[data-own-nav-work="${a}"]`).getByRole('link');
    await link.focus();
    await expect(link).toBeFocused();

    await leave(page);
    const b = await put(owner.secret, 'Sheet B');
    await expect(rows).toHaveCount(1);
    await at(page, 15_000);
    await comeBack(page);
    await expect(rows).toHaveCount(2);
    expect(await idsOf(rows)).toEqual([b, a]);
    await expect(link).toBeFocused();
  });
});
