// 作品のページの「版」のタブ（WS004）：版の一覧の数、2つの版の違い、2つの版の動く作品、「この版に戻す」、見せてよい版の決まり。
// playwright.config.ts の pages（Chromium）と work-versions-*（WebKit、Firefox）で流す。
// 人と作品は HTTP だけで作る（偽の GitHub でログイン、/api/post、公開の版は管理の口）。手元の D1 のファイルを直に開かないので、ほかの pages のテストと並んで走ってよい。
// HTTP だけで確かめる試験（見せてよい版の決まり、戻すの口）は、ブラウザに依らないので Chromium でだけ流す。
import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Visitor, ownOrigin } from './visitor';

const REPO = join(import.meta.dirname, '../../..');
const FIXTURE = join(REPO, 'fixtures/works/fx-toggle');
const AVATAR = readFileSync(join(REPO, 'fixtures/creators/fixture/avatar.webp'));
const THUMB = readFileSync(join(FIXTURE, 'thumb.webp'));
const OG = readFileSync(join(FIXTURE, 'og.png'));
const CONFIRM = { own: true, mit: true, terms: true };
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const unique = (label: string) => `${label}${randomBytes(4).toString('hex')}`;
const fixture = (name: string, id: string) => readFileSync(join(FIXTURE, name), 'utf8').replaceAll('fx-toggle', id);

/** 版 1：見本の部品そのまま */
const v1 = (id: string) => ({ html: fixture('part.html', id), css: fixture('part.css', id), js: fixture('part.js', id) });
/**
 * 版 2：CSS の2行を書き換えて1行足し（+3 −2）、JS の1行を書き換える（+1 −1）。合わせて +4 −3、変わったファイルは part.css と part.js、
 * 変わったまとまりは関数 mount（中の onClick は変わらない）。marker を入れると、その版にしかない文字になる
 */
function v2(id: string, marker = '') {
  const base = v1(id);
  return {
    html: base.html,
    css: base.css
      .replace('--_accent: var(--ld-accent, #7c9cff);', '--_accent: var(--ld-accent, #ff6a3d);')
      .replace('--_radius: var(--ld-radius, 16px);', '--_radius: var(--ld-radius, 12px);')
      .replace('  color: var(--_fg);\n}', `  color: var(--_fg);\n  letter-spacing: 0.01em;${marker ? ` /* ${marker} */` : ''}\n}`),
    js: base.js.replace("const switches = [...root.querySelectorAll('.switch')];", "const switches = Array.from(root.querySelectorAll('.switch'));"),
  };
}
type Parts = ReturnType<typeof v1>;

/** 応答の体を必ず読む（読まない大きい体で Node の fetch が落ちるため） */
const statusOf = async (pending: Promise<Response>) => {
  const response = await pending;
  await response.arrayBuffer();
  return response.status;
};

async function person(label: string) {
  const visitor = new Visitor();
  const login = unique(label);
  expect((await visitor.login(login)).status).toBe(302);
  const { handle } = (await visitor.me()).user as { handle: string };
  return { visitor, handle };
}

function postForm(id: string, parts: Parts, title = 'Version Switches') {
  const form = new FormData();
  form.append('meta', JSON.stringify({ id, title, category: 'Components', subtype: 'Toggle', tags: ['minimal'], motion: false, made_with: 'human' }));
  form.append('part.html', parts.html);
  form.append('part.css', parts.css);
  form.append('part.js', parts.js);
  return form;
}

/** 下書きを作る（新しい作品か、新しい版） */
async function draft(visitor: Visitor, id: string, parts: Parts, first: boolean) {
  const response = await visitor.fetch(first ? '/api/post/works' : `/api/post/works/${id}/revisions`, { method: 'POST', body: postForm(id, parts), headers: { Origin: ownOrigin() } });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { revision: { id: string; version: string } }).revision;
}

/** 自分だけの作品を、版 1（見本）と版 2（v2）で作る。版 2 が今の版 */
async function privateWork(visitor: Visitor) {
  const id = unique('wsv-');
  const revisions: { id: string; version: string }[] = [];
  for (const [index, parts] of [v1(id), v2(id)].entries()) {
    const revision = await draft(visitor, id, parts, index === 0);
    const placed = await visitor.post(`/api/post/revisions/${revision.id}/place`, CONFIRM);
    expect(placed.status, await placed.clone().text()).toBe(200);
    await placed.arrayBuffer();
    revisions.push(revision);
  }
  return { id, revisions };
}

/** 公開の作品の、承認済みの版を置く（ld upload と同じ管理の口。作者はその人に結ばれた作者） */
async function publishVersion(handle: string, id: string, version: string, parts: Parts) {
  const form = new FormData();
  const meta = { id, title: 'Public Versions', type: 'component', platform: null, category: 'Components', subtype: 'Toggle', tags: ['minimal'], creator: handle, license: 'MIT', made_with: 'human', version, published_at: '2026-11-12', pin_order: null };
  const files: [string, string | Buffer][] = [
    ['meta.json', JSON.stringify(meta)],
    ['part.html', parts.html],
    ['part.css', parts.css],
    ['part.js', parts.js],
    ['thumb.webp', THUMB],
    ['og.png', OG],
    ['creator.json', JSON.stringify({ handle, name: handle, kind: 'person', x_url: null, site_url: null })],
    ['avatar.webp', AVATAR],
  ];
  for (const [name, body] of files) form.append(name, new Blob([typeof body === 'string' ? body : new Uint8Array(body)]), name);
  form.append('publish', 'true');
  const response = await fetch(new URL('/api/admin/works', ownOrigin()), { method: 'POST', headers: { Authorization: `Bearer ${process.env.LD_TEST_ADMIN_TOKEN}` }, body: form });
  expect([200, 201], await response.clone().text()).toContain(response.status);
  await response.arrayBuffer();
}

/** 公開の作品（版 1、版 2 が承認済み）。持ち主の作者は、先に下書きを1つ置いて作っておく */
async function publicWork(owner: { visitor: Visitor; handle: string }) {
  const seed = unique('wsv-seed-');
  await draft(owner.visitor, seed, v1(seed), true);
  const id = unique('wsv-pub-');
  await publishVersion(owner.handle, id, '1', v1(id));
  await publishVersion(owner.handle, id, '2', v2(id));
  return id;
}

/** ブラウザで、その人として開く（HTTP でログインしたセッションの cookie を渡す。thumb-capture.spec.ts と同じ） */
async function openVersions(page: Page, path: string, visitor?: Visitor) {
  if (visitor) await page.context().addCookies([{ name: 'ld_session', value: visitor.cookies.get('ld_session')!, url: ownOrigin() }]);
  await page.goto(path);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
  await page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab').nth(1).click();
  await expect(page.locator('[data-work-panel="versions"]')).toBeVisible();
  // 一覧の行は、見えたものから数える。全部を見せて、数え終えるまで待つ（数え終えた行は、変わったまとまりの分だけ高くなり、下の違いが動くため）
  for (const row of await page.locator('[data-version-row]').all()) await row.scrollIntoViewIfNeeded();
  await expect(page.locator('[data-version-stats="loading"], [data-version-stats="idle"]')).toHaveCount(0);
}

/**
 * 持ち主の「この版に戻す」を押す。公開の作品では持ち主かどうかが読み込みの後に決まり、そのとき左のナビが開く（動きがある）ので、
 * 頭の「新しい版を置く」が出て、動きが止まってから押す（動いている間に押すと、ずれた所を押す）
 */
async function pressRevert(page: Page, version: string) {
  await expect(page.locator('[data-work-new-version]')).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
  await page.locator(`[data-version-revert="${version}"]`).click();
}

const pageData = async (visitor: Visitor | null, id: string) => {
  const response = await (visitor ?? new Visitor()).fetch(`/p/${id}`);
  return { status: response.status, html: await response.text() };
};

/** ページのデータの版の一覧（worker/workAbout.ts の loadHistory）の版の番号。ページには、ほかの作品の版の番号も入るので、一覧だけを読む */
const listed = (html: string): string[] => {
  const list = /"versions":\[(.*?)\]/.exec(html);
  expect(list, 'ページのデータに版の一覧がない').not.toBeNull();
  return [...list![1].matchAll(/"version":"([^"]+)"/g)].map((match) => match[1]);
};

test.describe('一覧と違い', () => {
  test.use({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo' });

  test('一覧の数（増えた行、減った行、変わったファイル、変わったまとまり）。初めは今の版と1つ前の違い。左右と上下、行の番号、たたむ', async ({ page }) => {
    const owner = await person('wsvlist');
    const id = await publicWork(owner);
    await openVersions(page, `/p/${id}`);

    const rows = page.locator('[data-version-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-version-row', '2');
    await expect(rows.nth(0).locator('[data-version-stats="ready"]')).toBeVisible();
    await expect(rows.nth(0).locator('[data-version-lines]')).toContainText('+4');
    await expect(rows.nth(0).locator('[data-version-lines]')).toContainText('−3');
    await expect(rows.nth(0).locator('[data-version-files]')).toContainText('part.css, part.js');
    await expect(rows.nth(0).locator('[data-version-section="function:mount"]')).toBeVisible();
    await expect(rows.nth(0)).toContainText('今の版');
    // いちばん下は最初の版：空と比べた行の数だけ
    const total = ['part.html', 'part.css', 'part.js'].reduce((sum, name) => sum + fixture(name, id).replace(/\n$/, '').split('\n').length, 0);
    await expect(rows.nth(1).locator('[data-version-stats="ready"]')).toContainText('最初の版');
    await expect(rows.nth(1).locator('[data-version-lines]')).toContainText(`+${total}`);
    // ほかの人には「この版に戻す」を出さない
    await expect(page.locator('[data-version-revert]')).toHaveCount(0);

    // 時刻は見る人の時刻（ここでは日本、UTC の 9 時間先）。Worker の HTML には日付だけ（時刻と UTC は入れない）
    const time = rows.nth(0).locator('time');
    await expect(time).toHaveAttribute('data-version-time', 'local');
    const at = new Date((await time.getAttribute('datetime'))!);
    const tokyo = new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString();
    await expect(time).toHaveText(`${tokyo.slice(0, 10).replaceAll('-', '/')} ${tokyo.slice(11, 16)}`);
    const served = (await pageData(null, id)).html;
    const times = [...served.matchAll(/<time[^>]*data-version-time="([^"]+)"[^>]*>([^<]*)<\/time>/g)].map((match) => [match[1], match[2]]);
    expect(times).toHaveLength(2);
    for (const [kind, text] of times) {
      expect(kind).toBe('date');
      expect(text).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    }

    // 初めは今の版（2）とその1つ前（1）が選ばれていて、違いが出る
    await expect(rows.nth(0).getByRole('checkbox')).toBeChecked();
    await expect(rows.nth(1).getByRole('checkbox')).toBeChecked();
    const compare = page.locator('[data-version-compare="1..2"]');
    await expect(compare.getByRole('heading', { name: '版 1 → 版 2 の違い' })).toBeVisible();
    await expect(compare.locator('[data-version-diff="ready"]')).toBeVisible();
    await expect(compare.locator('[data-version-file]')).toHaveCount(2);
    await expect(compare.getByText('変わっていないファイル：part.html')).toBeVisible();

    // 左右：消えた行と増えた行が横に並ぶ
    const css = compare.locator('[data-version-file="part.css"]');
    await expect(css.locator('[data-diff-layout="split"]')).toBeVisible();
    await expect(css.locator('[data-diff-cell="del"]')).toHaveCount(2);
    await expect(css.locator('[data-diff-cell="add"]')).toHaveCount(3);
    await expect(css.locator('[data-diff-cell="add"]').filter({ hasText: 'letter-spacing: 0.01em;' })).toHaveCount(1);
    // 上下：行の番号は前と後の2つ
    await compare.getByRole('button', { name: '上下' }).click();
    await expect(css.locator('[data-diff-layout="unified"]')).toBeVisible();
    await expect(css.locator('[data-diff-row="del"]')).toHaveCount(2);
    await expect(css.locator('[data-diff-row="add"]')).toHaveCount(3);
    const changed = css.locator('[data-diff-row="add"]').filter({ hasText: '#ff6a3d' });
    await expect(changed.locator('span').nth(0)).toHaveText('');
    await expect(changed.locator('span').nth(1)).toHaveText('6');
    // 変わっていない行はたたむ。押すと出る
    const fold = css.locator('[data-diff-row="fold"]').first();
    await expect(fold).toBeVisible();
    const before = await css.locator('[data-diff-row="same"]').count();
    await fold.getByRole('button').click();
    await expect.poll(() => css.locator('[data-diff-row="same"]').count()).toBeGreaterThan(before);
    // ファイルごとにたためる
    const toggle = css.getByRole('button', { name: /part\.css/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(css.locator('[data-diff-layout]')).toBeHidden();
    // 折り返し
    await compare.getByRole('button', { name: '折り返す' }).click();
    await expect(compare.getByRole('button', { name: '折り返す' })).toHaveAttribute('aria-pressed', 'true');

    // 選び直す：1つを外すと違いは消え、選び直すと出る
    await rows.nth(1).getByRole('checkbox').uncheck();
    await expect(page.locator('[data-version-compare]')).toHaveCount(0);
    await rows.nth(1).getByRole('checkbox').check();
    await expect(page.locator('[data-version-compare="1..2"]')).toBeVisible();
  });

  test('2つの版の動く作品：今の枠（/frame/）を版ごとに、sandbox のまま。ほかのタブでは作らない', async ({ page }) => {
    const owner = await person('wsvfrm');
    const id = await publicWork(owner);
    await openVersions(page, `/p/${id}`);
    const frames = page.locator('[data-version-frames] iframe[data-ld-frame]');
    await expect(frames).toHaveCount(2);
    for (const [index, version] of ['1', '2'].entries()) {
      const frame = frames.nth(index);
      await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
      await expect(frame).toHaveAttribute('src', new RegExp(`^/frame/${id}/${version}/(desktop|mobile)\\.html`));
      // 枠の文書から「読み込めた」が届く（frameGuard.ts の見張りの中）
      await expect(frame).toHaveAttribute('data-ld-loaded', '');
    }
    // 枠の応答は今の守り（CSP の sandbox と frame-ancestors）
    const response = await fetch(new URL(`/frame/${id}/1/desktop.html`, ownOrigin()), { headers: FROM_IFRAME });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts allow-forms');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    // コードのタブに戻ると、2つの版の枠はなくなる（作品の JS を動かさない）
    await page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab').nth(0).click();
    await expect(page.locator('[data-version-frames]')).toHaveCount(0);
  });
});

test.describe('英語の画面と、タブの幅', () => {
  /** 持ち主として開き、版のタブの行を数え終えるまで待つ（言葉に依らない形で） */
  async function openOwned(page: Page, path: string, visitor: Visitor) {
    await page.context().addCookies([{ name: 'ld_session', value: visitor.cookies.get('ld_session')!, url: ownOrigin() }]);
    await page.goto(path);
    await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
    // 持ち主とわかると設定のタブが出る（4つ）
    await expect(page.getByRole('tab')).toHaveCount(4);
  }
  /** タブの列が横に入りきっている */
  const tabsFit = (page: Page) => page.getByRole('tablist').evaluate((list) => list.scrollWidth <= list.clientWidth);

  test('1440 の英語：まとまりの名前は語の途中で割らない。「Restore」のボタン。タブの「Settings」が切れない。戻すの窓の文', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const owner = await person('wsven');
    const id = await publicWork(owner);
    await openOwned(page, `/en/p/${id}`, owner.visitor);
    expect(await tabsFit(page)).toBe(true);
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
    await page.getByRole('tab').nth(1).click();
    await expect(page.locator('[data-version-stats="loading"], [data-version-stats="idle"]')).toHaveCount(0);

    // まとまりの名前は1つの塊（折り返さない）。種類と名前の間は英語の区切り
    const section = page.locator('[data-version-row="2"] [data-version-section="function:mount"]');
    await expect(section).toHaveText('Function: mount');
    expect(await section.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    // 「この版に戻す」は、英語では「Restore」。読み上げの名前は「Restore version N」
    const restore = page.locator('[data-version-revert="1"]');
    await expect(restore).toHaveText('Restore');
    await expect(restore).toHaveAccessibleName('Restore version 1');
    await pressRevert(page, '1');
    const dialog = page.getByRole('dialog', { name: 'Restore version 1' });
    await expect(dialog.locator('[data-revert-agreement]')).toHaveText(
      "Same as when you posted this version: it's your own work (or you have the rights to it), it can be published under MIT, and you agree to the Terms.",
    );
    await expect(dialog.locator('[data-revert-agreement]').getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/en/terms');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
  });

  test('タブは、どの幅でも4つが入る。日本語の 1440 は今の形のまま（印つき）', async ({ page }) => {
    const owner = await person('wsvtab');
    const id = await publicWork(owner);
    for (const width of [1024, 1200, 1280, 1440, 1536]) {
      await page.setViewportSize({ width, height: 900 });
      for (const prefix of ['/en', '']) {
        await openOwned(page, `${prefix}/p/${id}`, owner.visitor);
        expect(await tabsFit(page), `${prefix || '/ja'} ${width}`).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOwned(page, `/p/${id}`, owner.visitor);
    await expect(page.getByRole('tablist')).toHaveAttribute('data-tabs-fit', '0');
    await expect(page.getByRole('tablist').locator('svg:visible')).toHaveCount(4);
  });
});

test.describe('スマホ 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('上下の1列だけ。動く作品は切り替えで、枠は1つだけ', async ({ page }) => {
    const owner = await person('wsvph');
    const id = await publicWork(owner);
    await openVersions(page, `/p/${id}`);
    const compare = page.locator('[data-version-compare="1..2"]');
    await expect(compare.locator('[data-version-diff="ready"]')).toBeVisible();
    await expect(compare.getByRole('button', { name: '左右' })).toHaveCount(0);
    await expect(compare.locator('[data-diff-layout="unified"]')).toHaveCount(2);
    await expect(compare.getByRole('button', { name: '折り返す' })).toHaveAttribute('aria-pressed', 'true');
    const row = compare.locator('[data-version-file="part.css"] [data-diff-row="add"]').first();
    await expect(row.locator('[data-diff-number]')).toHaveCount(1);
    const codeWidth = await row.locator('[data-diff-code]').evaluate((element) => element.getBoundingClientRect().width);
    expect(codeWidth).toBeGreaterThanOrEqual(390 * 0.75);
    // 折り返すので、長い行も枠の幅に収まる（横に送らない）
    for (const layout of await compare.locator('[data-diff-layout="unified"]').all()) {
      const [scroll, client] = await layout.evaluate((element) => [element.parentElement!.scrollWidth, element.parentElement!.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    }
    const frames = page.locator('[data-version-frames] iframe[data-ld-frame]');
    await expect(frames).toHaveCount(1);
    await expect(frames).toHaveAttribute('src', new RegExp(`^/frame/${id}/2/`));
    await compare.getByRole('button', { name: '版 1（前）' }).click();
    await expect(frames).toHaveCount(1);
    await expect(frames).toHaveAttribute('src', new RegExp(`^/frame/${id}/1/`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('この版に戻す', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('自分だけの作品：確かめの窓の後、古い版の中身で新しい版ができて今の版になる。古い版は残る', async ({ page }) => {
    const owner = await person('wsvrevert');
    const { id, revisions } = await privateWork(owner.visitor);
    expect(revisions.map((revision) => revision.version)).toEqual(['1', '2']);
    await openVersions(page, `/p/${id}`, owner.visitor);

    // 自分だけの作品の版の枠は、下書きの枠（持ち主だけに返る）
    const frames = page.locator('[data-version-frames] iframe[data-ld-frame]');
    await expect(frames).toHaveCount(2);
    await expect(frames.nth(0)).toHaveAttribute('src', new RegExp(`^/draft-frame/${revisions[0].id}/`));
    await expect(frames.nth(1)).toHaveAttribute('src', new RegExp(`^/draft-frame/${revisions[1].id}/`));

    // 今の版には「戻す」がない
    await expect(page.locator('[data-version-revert="2"]')).toHaveCount(0);
    await pressRevert(page, '1');
    const dialog = page.getByRole('dialog', { name: '版 1 に戻す' });
    await expect(dialog).toHaveAttribute('data-revert-dialog', 'ready');
    await expect(dialog.locator('[data-revert-lead]')).toHaveText('版 1 の中身で、新しい版（版 3）を作ります。今までの版は消えず、書き換えません。');
    await expect(dialog.locator('[data-revert-mode="private"]')).toBeVisible();
    // 同意は1行の文（チェックはない）。確かめが済めば、すぐ押せる
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog.locator('[data-revert-agreement]')).toHaveText('この版を置いた時と同じく、自分で作った（権利がある）物で、MIT で公開してよく、利用規約に同意したものとして扱います。');
    await expect(dialog.locator('[data-revert-agreement]').getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms');
    await expect(dialog.getByRole('button', { name: 'やめる' })).toBeVisible();
    const confirm = dialog.getByRole('button', { name: '戻す', exact: true });
    await expect(confirm).toBeEnabled();
    await Promise.all([page.waitForEvent('load'), confirm.click()]);

    await openVersions(page, `/p/${id}`);
    await expect(page.locator('[data-version-row]')).toHaveCount(3);
    await expect(page.locator('[data-version-row="3"]')).toContainText('今の版');
    // 版 3 の中身は版 1 と同じ。版 1 と版 2 は残る
    const read = async (version: string) => {
      const response = await owner.visitor.fetch(`/p/${id}/file/${version}/part.css`);
      return { status: response.status, text: await response.text() };
    };
    const [one, two, three] = await Promise.all(['1', '2', '3'].map(read));
    expect([one.status, two.status, three.status]).toEqual([200, 200, 200]);
    expect(three.text).toBe(one.text);
    expect(two.text).not.toBe(one.text);
    // 版 2 → 版 3 の違いは、版 2 → 版 1 の逆（+3 −4）
    await expect(page.locator('[data-version-row="3"] [data-version-lines]')).toContainText('+3');
    await expect(page.locator('[data-version-row="3"] [data-version-lines]')).toContainText('−4');
  });

  test('公開の作品：戻すと審査に回る。承認までは、ほかの人の一覧も今の版も変わらない', async ({ page }) => {
    const owner = await person('wsvrp');
    const id = await publicWork(owner);
    await openVersions(page, `/p/${id}`, owner.visitor);
    await pressRevert(page, '1');
    const dialog = page.getByRole('dialog', { name: '版 1 に戻す' });
    await expect(dialog.locator('[data-revert-lead]')).toContainText('新しい版（版 3）');
    await expect(dialog.locator('[data-revert-mode="review"]')).toContainText('審査に回ります');
    await dialog.getByRole('button', { name: '戻す', exact: true }).click();
    await expect(dialog.locator('[data-revert-message]')).toHaveText('版 3 を作り、審査に出しました。結果は「自分の作品」に出ます');
    await expect(dialog).toHaveAttribute('data-revert-dialog', 'done');

    const works = (await (await owner.visitor.fetch('/api/post/works')).json()) as { works: { id: string; version: string; status: string; public_version: string }[] };
    expect(works.works.find((work) => work.id === id)).toMatchObject({ version: '3', status: 'submitted', public_version: '2' });
    // ほかの人：一覧は版 2 と版 1 のまま。審査中の版 3 は、中身も枠も 404
    const anon = await pageData(null, id);
    expect(anon.status).toBe(200);
    expect(listed(anon.html)).toEqual(['2', '1']);
    for (const visitor of [new Visitor(), owner.visitor]) {
      expect(await statusOf(visitor.fetch(`/p/${id}/file/3/part.css`))).toBe(404);
      expect(await statusOf(visitor.fetch(`/frame/${id}/3/desktop.html`, { headers: FROM_IFRAME }))).toBe(404);
    }
  });
});

test.describe('戻すの口と、見せてよい版の決まり（HTTP）', () => {
  test.beforeEach(({ browserName }) => test.skip(browserName !== 'chromium', 'ブラウザに依らないので Chromium でだけ流す'));

  test('戻すの口：持ち主だけ。見えない版、今の版、同意なし、直している途中の版があるときは断る', async () => {
    const owner = await person('wsvapi');
    const other = await person('wsvother');
    const { id } = await privateWork(owner.visitor);
    const revert = (visitor: Visitor, body: unknown) => visitor.post(`/api/post/works/${id}/revert`, body);
    const answer = async (pending: Promise<Response>) => {
      const response = await pending;
      return { status: response.status, body: (await response.json().catch(() => null)) as { error?: string } | null };
    };
    // ログインなし、ほかの人
    expect((await answer(revert(new Visitor(), { version: '1', ...CONFIRM }))).status).toBe(401);
    expect(await answer(revert(other.visitor, { version: '1', ...CONFIRM }))).toEqual({ status: 404, body: { error: 'not_found' } });
    expect((await answer(other.visitor.fetch(`/api/post/works/${id}/revert?version=1`))).status).toBe(404);
    // 外の Origin
    expect((await answer(owner.visitor.post(`/api/post/works/${id}/revert`, { version: '1', ...CONFIRM }, 'https://evil.example'))).status).toBe(403);
    // 同意なし、今の版、ない版
    expect(await answer(revert(owner.visitor, { version: '1' }))).toEqual({ status: 400, body: { error: 'confirm_required' } });
    expect(await answer(revert(owner.visitor, { version: '2', ...CONFIRM }))).toEqual({ status: 409, body: { error: 'current' } });
    expect(await answer(revert(owner.visitor, { version: '9', ...CONFIRM }))).toEqual({ status: 404, body: { error: 'not_found' } });
    // 確かめの窓の中身
    expect(await answer(owner.visitor.fetch(`/api/post/works/${id}/revert?version=1`))).toEqual({ status: 200, body: { work_id: id, from: '1', version: '3', mode: 'private' } });
    // 下書き（版 3）があると、それを上書きせずに断る。下書きの版には戻せない（見えない版）
    const open = await draft(owner.visitor, id, v1(id), false);
    expect(open.version).toBe('3');
    expect(await answer(revert(owner.visitor, { version: '1', ...CONFIRM }))).toEqual({ status: 409, body: { error: 'has_draft' } });
    expect(await answer(revert(owner.visitor, { version: '3', ...CONFIRM }))).toEqual({ status: 404, body: { error: 'not_found' } });
    const kept = (await (await owner.visitor.fetch(`/api/post/works/${id}`)).json()) as { revision: { id: string; version: string; status: string } };
    expect(kept.revision).toMatchObject({ id: open.id, version: '3', status: 'draft' });
  });

  test('公開の作品：ほかの人、ログインなし、持ち主のどれにも、承認済みの版だけ。審査中の版は1文字も出ない', async () => {
    const owner = await person('wsvpub');
    const other = await person('wsvpubother');
    const id = await publicWork(owner);
    const marker = unique('SECRET-REVIEW-');
    // 持ち主が版 3 を審査に出す（中にだけ marker がある）
    const pending = await draft(owner.visitor, id, v2(id, marker), false);
    const submitted = await owner.visitor.post(`/api/post/revisions/${pending.id}/submit`, CONFIRM);
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    await submitted.arrayBuffer();

    for (const visitor of [null, other.visitor, owner.visitor]) {
      const shown = await pageData(visitor, id);
      expect(shown.status).toBe(200);
      expect(shown.html).not.toContain(marker);
      expect(listed(shown.html)).toEqual(['2', '1']);
      // 公開の作品のページには、版の id を入れない（人によって変えない）
      expect(shown.html).not.toContain('"rid"');
      const reader = visitor ?? new Visitor();
      expect(await statusOf(reader.fetch(`/p/${id}/file/1/part.css`))).toBe(200);
      expect(await statusOf(reader.fetch(`/p/${id}/file/2/part.js`))).toBe(200);
      const hidden = await reader.fetch(`/p/${id}/file/3/part.css`);
      expect(hidden.status).toBe(404);
      expect(await hidden.text()).not.toContain(marker);
      expect(await statusOf(reader.fetch(`/frame/${id}/3/desktop.html`, { headers: FROM_IFRAME }))).toBe(404);
    }
  });

  test('自分だけの作品：持ち主にだけ、承認済みと自分だけの版。下書きは持ち主にも出さない。ほかの人とログインなしには、ない作品と同じ', async () => {
    const owner = await person('wsvpriv');
    const other = await person('wsvprivother');
    const { id, revisions } = await privateWork(owner.visitor);
    const marker = unique('SECRET-DRAFT-');
    const open = await draft(owner.visitor, id, v2(id, marker), false);

    const mine = await pageData(owner.visitor, id);
    expect(mine.status).toBe(200);
    expect(mine.html).not.toContain(marker);
    expect(mine.html).toContain(`"versions":[{"version":"2","at":`);
    expect(mine.html).toContain(`"rid":"${revisions[0].id}"`);
    expect(mine.html).not.toContain(open.id);
    for (const version of ['1', '2']) {
      const response = await owner.visitor.fetch(`/p/${id}/file/${version}/part.css`);
      await response.arrayBuffer();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(await statusOf(owner.visitor.fetch(`/p/${id}/file/3/part.css`))).toBe(404);

    for (const visitor of [new Visitor(), other.visitor]) {
      expect((await pageData(visitor, id)).status).toBe(404);
      for (const version of ['1', '2', '3']) {
        const response = await visitor.fetch(`/p/${id}/file/${version}/part.css`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain(marker);
      }
      for (const revision of revisions) expect(await statusOf(visitor.fetch(`/draft-frame/${revision.id}/desktop.html`, { headers: FROM_IFRAME }))).toBe(404);
      expect(await statusOf(visitor.fetch(`/frame/${id}/1/desktop.html`, { headers: FROM_IFRAME }))).toBe(404);
    }
  });

  test('公開から自分だけにした作品：前の承認済みの版も、持ち主にだけ読める', async () => {
    const owner = await person('wsvmade');
    const id = await publicWork(owner);
    const made = await owner.visitor.post(`/api/post/works/${id}/make-private`);
    expect(made.status, await made.clone().text()).toBe(200);
    await made.arrayBuffer();
    const mine = await pageData(owner.visitor, id);
    expect(listed(mine.html)).toEqual(['2', '1']);
    expect(await statusOf(owner.visitor.fetch(`/p/${id}/file/1/part.css`))).toBe(200);
    for (const visitor of [new Visitor(), (await person('wsvmadeother')).visitor]) expect(await statusOf(visitor.fetch(`/p/${id}/file/1/part.css`))).toBe(404);
  });

  test('自分だけの版と取り下げた版が残ったまま公開になった作品：ほかの人、ログインなし、持ち主のどれにも、承認済みの版だけ', async () => {
    const owner = await person('wsvmix');
    const other = await person('wsvmixo');
    // 自分だけの版 1、2（中に marker）と、下書きの版 3（中に marker）。その後に、同じ作品へ承認済みの版 4 を置く（下書きは取り下げになる）
    const id = unique('wsv-mix-');
    const privateMarker = unique('SECRET-PRIVATE-');
    const draftMarker = unique('SECRET-REVOKED-');
    for (const [index, parts] of [v1(id), v2(id, privateMarker)].entries()) {
      const revision = await draft(owner.visitor, id, parts, index === 0);
      expect(await statusOf(owner.visitor.post(`/api/post/revisions/${revision.id}/place`, CONFIRM))).toBe(200);
    }
    const open = await draft(owner.visitor, id, v2(id, draftMarker), false);
    expect(open.version).toBe('3');
    await publishVersion(owner.handle, id, '4', v1(id));
    const states = (await (await owner.visitor.fetch('/api/post/works')).json()) as { works: { id: string; public: boolean; version: string }[] };
    expect(states.works.find((work) => work.id === id)).toMatchObject({ public: true, version: '4' });

    for (const visitor of [null, other.visitor, owner.visitor]) {
      const shown = await pageData(visitor, id);
      expect(shown.status).toBe(200);
      expect(listed(shown.html)).toEqual(['4']);
      expect(shown.html).not.toContain(privateMarker);
      expect(shown.html).not.toContain(draftMarker);
      expect(shown.html).not.toContain('"rid"');
      const reader = visitor ?? new Visitor();
      for (const version of ['1', '2', '3']) {
        const response = await reader.fetch(`/p/${id}/file/${version}/part.css`);
        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).not.toContain(privateMarker);
        expect(text).not.toContain(draftMarker);
        expect(await statusOf(reader.fetch(`/frame/${id}/${version}/desktop.html`, { headers: FROM_IFRAME }))).toBe(404);
      }
      expect(await statusOf(reader.fetch(`/p/${id}/file/4/part.css`))).toBe(200);
    }
    // 持ち主も、見えない版には戻せない
    for (const version of ['1', '2', '3']) expect(await statusOf(owner.visitor.post(`/api/post/works/${id}/revert`, { version, ...CONFIRM }))).toBe(404);
  });
});

test.describe('文書の作品（index.html）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** AI がふつうに書く1つの HTML 文書 */
  const doc = (title: string, word: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101418; color: #f4f4f5; font: 600 40px system-ui, sans-serif; }
</style>
</head>
<body>
<p id="word">${word}</p>
<script>
document.getElementById('word').addEventListener('click', (event) => { event.currentTarget.textContent += '!'; });
</script>
</body>
</html>
`;

  test('AI の口で置いた版どうしの違い（index.html）、下書きの枠、戻すと同じ文書の新しい版ができる', async ({ page }) => {
    const owner = await person('wsvdoc');
    const keyResponse = await owner.visitor.post('/api/account/ai-keys', { name: 'Claude Code', ...CONFIRM });
    expect(keyResponse.status, await keyResponse.clone().text()).toBe(201);
    const { secret } = (await keyResponse.json()) as { secret: string };
    const title = unique('Doc Versions ');
    const put = async (path: string, html: string) => {
      const response = await fetch(new URL(path, ownOrigin()), { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) });
      expect([200, 201], await response.clone().text()).toContain(response.status);
      return (await response.json()) as { id: string };
    };
    const first = doc(title, 'Hello');
    const { id } = await put('/api/v1/works', first);
    await put(`/api/v1/works/${id}/versions`, doc(title, 'Goodbye'));

    // 版の中身は index.html だけを読む（部品のファイルを試さない）
    const asked: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith(`/p/${id}/file/`)) asked.push(path.split('/').pop()!);
    });
    await openVersions(page, `/p/${id}`, owner.visitor);
    const compare = page.locator('[data-version-compare="1..2"]');
    await expect(compare.locator('[data-version-diff="ready"]')).toBeVisible();
    const file = compare.locator('[data-version-file="index.html"]');
    await expect(file.locator('[data-diff-cell="del"]')).toHaveText([/Hello/]);
    await expect(file.locator('[data-diff-cell="add"]')).toHaveText([/Goodbye/]);
    await expect(page.locator('[data-version-row="2"] [data-version-lines]')).toContainText('+1');
    await expect(page.locator('[data-version-row="2"] [data-version-lines]')).toContainText('−1');
    expect(new Set(asked)).toEqual(new Set(['index.html']));
    const frames = page.locator('[data-version-frames] iframe[data-ld-frame]');
    await expect(frames).toHaveCount(2);
    for (let index = 0; index < 2; index++) await expect(frames.nth(index)).toHaveAttribute('src', /^\/draft-frame\/[0-9a-f]{32}\//);

    await pressRevert(page, '1');
    const dialog = page.getByRole('dialog', { name: '版 1 に戻す' });
    await expect(dialog.locator('[data-revert-lead]')).toContainText('新しい版（版 3）');
    await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: '戻す', exact: true }).click()]);
    await openVersions(page, `/p/${id}`);
    await expect(page.locator('[data-version-row="3"]')).toContainText('今の版');
    // 版 3 は版 1 と同じ文書で、文書の作品のまま（part.html はない）
    const read = async (version: string, name: string) => {
      const response = await owner.visitor.fetch(`/p/${id}/file/${version}/${name}`);
      return { status: response.status, text: await response.text() };
    };
    expect(await read('3', 'index.html')).toEqual({ status: 200, text: first });
    expect((await read('3', 'part.html')).status).toBe(404);
    expect((await read('2', 'index.html')).status).toBe(200);
  });
});
