// 作品のページのファイルの木と本文（WS003 の2つ目）：木から本文へ、行の住所で開く、印から行へ飛ぶ、コピーの文字、スマホの全画面、大きいファイル。
// playwright.config.ts の pages（Chromium）と work-files-*（WebKit、Firefox）で流す。サーバーは pages（見本の作品が入っている）。
// 分け目のある作品と大きい作品は、人と作品を HTTP だけで作る（偽の GitHub でログイン、AI の鍵、/api/v1。thumb-capture.spec.ts と同じ）。
import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PRIVATE_OWNER, privateFixtureId } from '../scripts/private-fixture.mjs';
import { Visitor, ownOrigin } from './visitor';

const MOTION = 'fx-motion';
const fixtureText = (name: string) => readFileSync(new URL(`../../../fixtures/works/${MOTION}/${name}`, import.meta.url), 'utf8');
const fixtureLines = (name: string) => fixtureText(name).split('\n');
const CONFIRM = { own: true, mit: true, terms: true };
const unique = (label: string) => `${label}${randomBytes(4).toString('hex')}`;

const hydrated = (page: Page) => page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));

async function openWork(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await hydrated(page);
}

const tree = (page: Page) => page.locator('[data-file-tree]');
const node = (page: Page, key: string) => page.locator(`[data-tree-key="${key}"]`);
const body = (page: Page) => page.locator('[data-code-body]');
const line = (page: Page, n: number) => body(page).locator(`[data-line="${n}"]`);
/** 行の文字（行の番号を除く） */
const lineText = async (page: Page, n: number) => (await line(page, n).locator('span').first().textContent()) ?? '';

/** navigator.clipboard.writeText を差し替えて、書かれた文字を受ける（3つのブラウザで、権限に頼らない） */
async function catchClipboard(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied: string[] }).__copied.push(text);
        },
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
}

async function person(label: string) {
  const visitor = new Visitor();
  expect((await visitor.login(unique(label))).status).toBe(302);
  expect(visitor.cookies.get('ld_session')).toBeTruthy();
  return visitor;
}

/** AI の口で文書を置く。自分だけの作品になる */
async function putDocument(visitor: Visitor, html: string): Promise<string> {
  const keyResponse = await visitor.post('/api/account/ai-keys', { name: 'Claude Code', ...CONFIRM });
  expect(keyResponse.status, await keyResponse.clone().text()).toBe(201);
  const { secret } = (await keyResponse.json()) as { secret: string };
  const put = await fetch(new URL('/api/v1/works', ownOrigin()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  });
  expect(put.status, await put.clone().text()).toBe(201);
  return ((await put.json()) as { id: string }).id;
}

async function openAs(page: Page, visitor: Visitor, path: string) {
  await page.context().addCookies([{ name: 'ld_session', value: visitor.cookies.get('ld_session')!, url: ownOrigin() }]);
  await page.goto(path);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await hydrated(page);
}

/** 分け目のある文書：設定の塊、線の見出し、シェーダーの文字列3本、関数 */
const partsDoc = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body { margin: 0; background: #101216; color: #f2f3f5; }
canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="view"></canvas>
<script>
// ---- settings
const TUNE = {
  glass: { tint: 0.4, blur: 2 },
  rain: { count: 120, speed: 3 },
  city: { rows: 6, glow: 0.8 },
  sound: { gain: 0.2, low: 80 },
  light: { warm: 0.6, cool: 0.3 },
  quality: { scale: 1, max: 2 },
  extra: 1,
  more: 2,
};

// ---- shaders
const FILL_VERT = \`#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}\`;
const WINDOW_FRAG = \`#version 300 es
precision highp float;
uniform vec2 uRes; // size
out vec4 o;
void main() {
  o = vec4(0.25, 0.5, 1.0, 1.0);
}\`;
const MIST_FRAG = \`#version 300 es
precision highp float;
out vec4 o;
void main() {
  o = vec4(1.0);
}\`;

// ---- run
function start() {
  const canvas = document.getElementById('view');
  return canvas.getContext('webgl2');
}
function frame(time) {
  requestAnimationFrame(frame);
  return time * TUNE.rain.speed;
}
start();
</script>
</body>
</html>
`;

/** 大きい文書：6,000 行をこえる script。行ごとに番号を書いておく（どの行が見えているかを確かめる） */
const bigDoc = (title: string, rows: number) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<p>big</p>
<script>
const rows = [];
${Array.from({ length: rows }, (_, index) => `rows.push({ id: ${index + 1}, label: 'row number ${index + 1} wraps on a narrow screen', value: ${index % 97} });`).join('\n')}
document.querySelector('p').textContent = String(rows.length);
</script>
</body>
</html>
`;

test.describe('木から本文へ', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('木に本当のファイルが並び、押すと本文が出る。住所は /p/<id>/code/<file>。枠は読み直さず、閲覧も数え直さない。戻るは1回で閉じる', async ({ page }) => {
    let frameLoads = 0;
    let views = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith(`/frame/${MOTION}/`)) frameLoads += 1;
      if (url.pathname === '/api/count' && request.postData()?.includes('"view"')) views += 1;
    });
    await openWork(page, `/p/${MOTION}`);
    // 本当のファイル：名前と大きさ。リンクは行の住所（JS がなくても、同じ住所でそのファイルが開く）
    await expect(tree(page).locator('[data-tree-kind="file"]')).toHaveText([/part\.html/, /part\.css/, /part\.js/]);
    await expect(node(page, 'part.js')).toHaveAttribute('href', `/p/${MOTION}/code/part.js`);
    await expect(page.locator('[data-code-panel]')).toContainText('ファイルか分け目を選ぶと、ここに本文が出ます。');
    await page.locator('iframe[data-ld-frame]').evaluate((frame) => frame.setAttribute('data-same', ''));

    await node(page, 'part.js').click();
    await expect(page).toHaveURL(`/p/${MOTION}/code/part.js`);
    const js = fixtureLines('part.js');
    await expect(body(page)).toHaveAttribute('data-lines', String(js.at(-1) === '' ? js.length - 1 : js.length));
    expect(await lineText(page, 1)).toBe(js[0]);
    expect(await lineText(page, 12)).toBe(js[11]);
    await expect(node(page, 'part.js')).toHaveAttribute('aria-current', 'true');
    // 色が付く（決まった語、コメント）。文字は変わらない
    await expect(body(page).locator('span.text-site-code-keyword').first()).toBeVisible();
    expect(await lineText(page, 12)).toBe(js[11]);

    // 別のファイルへ：履歴を増やさない
    const before = await page.evaluate(() => history.length);
    await node(page, 'part.css').click();
    await expect(page).toHaveURL(`/p/${MOTION}/code/part.css`);
    // 前のファイルの本文が消えて、次のファイルが出るまで待つ
    await expect.poll(() => lineText(page, 1)).toBe(fixtureLines('part.css')[0]);
    expect(await page.evaluate(() => history.length)).toBe(before);

    // 戻るは1回で、開く前の画面
    await page.goBack();
    await expect(page).toHaveURL(`/p/${MOTION}`);
    await expect(body(page)).toHaveCount(0);
    // ページは載せ直していない：同じ iframe のままで、枠を読むのは1回、閲覧を送るのも1回
    await expect(page.locator('iframe[data-ld-frame][data-same]')).toBeVisible();
    expect(frameLoads).toBe(1);
    expect(views).toBe(1);
  });

  test('木と本文は、コードのタブの続き：2列の下に幅いっぱい。HTML の順は、タブの中身の後。ほかのタブでは隠す', async ({ page }) => {
    await openWork(page, `/p/${MOTION}`);
    const measured = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const side = document.querySelector('[data-work-side]')!;
      const files = document.querySelector('[data-work-files]')!;
      return {
        after: Boolean(side.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING),
        filesTop: rect('[data-work-files]').top,
        stageBottom: rect('[data-work-stage]').bottom,
        sideBottom: rect('[data-work-side]').bottom,
        filesLeft: rect('[data-work-files]').left,
        stageLeft: rect('[data-work-stage]').left,
        filesRight: rect('[data-work-files]').right,
        sideRight: rect('[data-work-side]').right,
      };
    });
    expect(measured.after).toBe(true);
    expect(measured.filesTop).toBeGreaterThanOrEqual(Math.max(measured.stageBottom, measured.sideBottom));
    expect(Math.abs(measured.filesLeft - measured.stageLeft)).toBeLessThan(2);
    expect(Math.abs(measured.filesRight - measured.sideRight)).toBeLessThan(2);
    await page.getByRole('tab', { name: /^版/ }).click();
    await expect(page.locator('[data-work-files]')).toBeHidden();
    await page.getByRole('tab', { name: 'コード' }).click();
    await expect(page.locator('[data-work-files]')).toBeVisible();
  });

  test('行の番号を押すと、その行を選ぶ。Shift を押しながらで範囲。住所が替わり、本文は送られない', async ({ page }) => {
    await openWork(page, `/p/${MOTION}/code/part.js`);
    await line(page, 10).waitFor();
    // 開いた時に、本文の頭が画面の上に来る（その後は、行を選んでも送らない）
    await expect.poll(async () => Math.round((await page.locator('[data-code-panel]').boundingBox())!.y)).toBe(16);
    const scrolled = await page.evaluate(() => window.scrollY);
    await line(page, 10).locator('a').click();
    await expect(page).toHaveURL(`/p/${MOTION}/code/part.js#L10`);
    await expect(body(page).locator('[data-selected]')).toHaveCount(1);
    await line(page, 14).locator('a').click({ modifiers: ['Shift'] });
    await expect(page).toHaveURL(`/p/${MOTION}/code/part.js#L10-L14`);
    await expect(body(page).locator('[data-selected]')).toHaveCount(5);
    await expect(page.locator('[data-code-address]')).toContainText(`ludion.ai/p/${MOTION}/code/part.js#L10-L14`);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  });

  test('目次：関数の名前と行。押すと、その関数の行へ', async ({ page }) => {
    await openWork(page, `/p/${MOTION}/code/part.js`);
    const toc = page.locator('[data-code-toc]');
    await expect(toc).toBeVisible();
    const first = toc.getByRole('link').first();
    const name = (await first.locator('span').first().textContent())!;
    const start = Number(await first.locator('span').nth(1).textContent());
    expect(fixtureLines('part.js')[start - 1]).toContain(name);
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/p/${MOTION}/code/part\\.js#L${start}(-L\\d+)?$`));
    await expect(line(page, start)).toHaveAttribute('data-selected', '');
  });

  test('折り返す：1440 では初めは折り返さない。押すと折り返す', async ({ page }) => {
    await openWork(page, `/p/${MOTION}/code/part.js`);
    const toggle = page.getByRole('button', { name: '折り返す', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(line(page, 1).locator('span').first()).toHaveCSS('white-space', 'pre');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(line(page, 1).locator('span').first()).toHaveCSS('white-space', 'pre-wrap');
  });
});

test.describe('行の住所', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('/p/<id>/code/<file>#L30-L34 で開くと、その行が選ばれて画面に入る。道しるべと住所が出る', async ({ page }) => {
    await openWork(page, `/p/${MOTION}/code/part.js#L30-L34`);
    await expect(body(page).locator('[data-selected]')).toHaveCount(5);
    await expect(line(page, 30)).toBeInViewport();
    expect(await lineText(page, 30)).toBe(fixtureLines('part.js')[29]);
    await expect(page.locator('[data-code-trail]')).toHaveText('part.js');
    await expect(page.locator('[data-code-address]')).toContainText(`ludion.ai/p/${MOTION}/code/part.js#L30-L34`);
    // 初めのタブはコード。木では、そのファイルに印が付く
    await expect(page.getByRole('tab', { name: 'コード' })).toHaveAttribute('aria-selected', 'true');
    await expect(node(page, 'part.js')).toHaveAttribute('aria-current', 'true');
  });

  test('Worker の HTML：200、canonical は作品のページ、木が入っている。英語の道もある。その版にないファイルと、知らない名前は 404', async ({ request }) => {
    const response = await request.get(`/p/${MOTION}/code/part.js`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<link rel="canonical" href="https://ludion.ai/p/${MOTION}">`);
    expect(html).toContain('data-file-tree');
    expect(html).toContain(`href="/p/${MOTION}/code/part.css"`);
    expect(response.headers()['cache-control']).toBe('public, max-age=0, s-maxage=60');
    const english = await request.get(`/en/p/${MOTION}/code/part.js`);
    expect(english.status()).toBe(200);
    expect(await english.text()).toContain(`href="/en/p/${MOTION}/code/part.css"`);
    // fx-button には part.js がない。部品の作品に index.html はない
    for (const path of ['/p/fx-button/code/part.js', `/p/${MOTION}/code/index.html`, `/p/${MOTION}/code/evil.js`, `/p/${MOTION}/code/part.js/more`, '/p/no-such-work/code/part.js']) {
      const missing = await request.get(path);
      expect(missing.status(), path).toBe(404);
      await missing.text();
    }
    // robots.txt：行の住所と読み口は、検索に出さない
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /p/*/code');
    expect(robots).toContain('Disallow: /p/*/file/');
  });
});

test.describe('本文の読み口（/p/<id>/file/<版>/<ファイル>）', () => {
  test('見本のファイルとバイトで同じ（クレジット行を足さない）。text/plain と nosniff。作品のページと同じキャッシュ', async ({ request }) => {
    for (const name of ['part.html', 'part.css', 'part.js']) {
      const response = await request.get(`/p/${MOTION}/file/1/${name}`);
      expect(response.status(), name).toBe(200);
      expect(Buffer.compare(await response.body(), readFileSync(new URL(`../../../fixtures/works/${MOTION}/${name}`, import.meta.url))), name).toBe(0);
      expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
      expect(response.headers()['cache-control']).toBe('public, max-age=0, s-maxage=60');
      expect(response.headers()['set-cookie']).toBeUndefined();
    }
    // 生の文字（/raw/）は、頭にクレジット行が入る。読み口は入らない
    const raw = await (await request.get(`/p/${MOTION}/raw/part.js`)).text();
    expect(raw).toBe(`/* UI by @fixture — ludion.ai/p/${MOTION} (MIT) */\n${fixtureText('part.js')}`);
  });

  test('知らない版、知らない名前、形の違う id、その版にないファイルは 404', async ({ request }) => {
    for (const path of [
      `/p/${MOTION}/file/999/part.js`,
      `/p/${MOTION}/file/1/evil.js`,
      `/p/${MOTION}/file/1/index.html`,
      `/p/${MOTION}/file/1/meta.json`,
      `/p/${MOTION}/file/1/..%2Fmeta.json`,
      `/p/${MOTION.toUpperCase()}/file/1/part.js`,
      '/p/fx-button/file/1/part.js',
      '/p/no-such-work/file/1/part.js',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()['cache-control'], path).toBe('private, no-store');
      await response.text();
    }
  });

  test('自分だけの作品：持ち主にだけ返し、残さない。持ち主が取った後でも、ほかの人には 404', async ({ request }) => {
    const path = `/p/${privateFixtureId('mal-doc')}/file/1/index.html`;
    const stranger = await request.get(path);
    expect(stranger.status()).toBe(404);
    await stranger.text();
    const owner = await request.get(path, { headers: { Cookie: `ld_session=${PRIVATE_OWNER.session}` } });
    expect(owner.status()).toBe(200);
    expect(owner.headers()['cache-control']).toBe('private, no-store');
    expect(owner.headers()['x-robots-tag']).toBe('noindex');
    expect(Buffer.compare(await owner.body(), readFileSync(new URL('../../../fixtures/malicious/mal-doc/index.html', import.meta.url)))).toBe(0);
    const again = await request.get(path);
    expect(again.status()).toBe(404);
    await again.text();
    // 版が違えば、持ち主にも返さない
    const other = await request.get(`/p/${privateFixtureId('mal-doc')}/file/2/index.html`, { headers: { Cookie: `ld_session=${PRIVATE_OWNER.session}` } });
    expect(other.status()).toBe(404);
    await other.text();
  });
});

test.describe('コピー', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('ファイルをコピー：/p/<id>/raw/<file> と同じ文字（頭にクレジット行）。住所をコピー：本番の住所。全部をコピー：/p/<id>/code と同じ文字', async ({ page, request }) => {
    const copied = await catchClipboard(page);
    await openWork(page, `/p/${MOTION}/code/part.js#L10-L14`);
    await line(page, 10).waitFor();
    const count = page.getByTestId('copy-count');
    const before = Number(await count.textContent());

    await page.getByRole('button', { name: 'part.jsをコピー' }).click();
    await expect(page.getByRole('button', { name: 'part.jsをコピー' })).toHaveText('コピーしました');
    expect((await copied()).at(-1)).toBe(await (await request.get(`/p/${MOTION}/raw/part.js`)).text());
    // ファイルをコピーしても、コピーの数に入る
    await expect(count).toHaveText(String(before + 1));

    await page.getByRole('button', { name: '住所をコピー' }).click();
    expect((await copied()).at(-1)).toBe(`https://ludion.ai/p/${MOTION}/code/part.js#L10-L14`);
    // 住所をコピーは、コピーの数に入れない
    await expect(count).toHaveText(String(before + 1));

    await page.getByRole('button', { name: '全部をコピー', exact: true }).click();
    const all = await (await request.get(`/p/${MOTION}/code`)).text();
    expect((await copied()).at(-1)).toBe(all);
    expect(all.split('\n')[0]).toBe(`<!-- UI by @fixture — ludion.ai/p/${MOTION} (MIT) -->`);
    await expect(count).toHaveText(String(before + 2));
  });

  test('CSS と HTML のファイルも、/raw/ と同じ文字。文書の作品の index.html は「全部をコピー」と同じ文字', async ({ page, request }) => {
    const copied = await catchClipboard(page);
    await openWork(page, `/p/${MOTION}/code/part.css`);
    await line(page, 1).waitFor();
    await page.getByRole('button', { name: 'part.cssをコピー' }).click();
    expect((await copied()).at(-1)).toBe(await (await request.get(`/p/${MOTION}/raw/part.css`)).text());
    await node(page, 'part.html').click();
    await expect(page).toHaveURL(`/p/${MOTION}/code/part.html`);
    await expect(page.getByRole('button', { name: 'part.htmlをコピー' })).toBeEnabled();
    await page.getByRole('button', { name: 'part.htmlをコピー' }).click();
    expect((await copied()).at(-1)).toBe(await (await request.get(`/p/${MOTION}/raw/part.html`)).text());

    await openWork(page, '/p/mal-doc/code/index.html');
    await line(page, 1).waitFor();
    await page.getByRole('button', { name: 'index.htmlをコピー' }).click();
    const all = await (await request.get('/p/mal-doc/code')).text();
    expect((await copied()).at(-1)).toBe(all);
    expect((await copied()).at(-1)).toBe(await (await request.get('/p/mal-doc/raw/index.html')).text());
  });
});

test.describe('分け目の木', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('設定の塊、見出し、シェーダー、文書の style と script が、本当のファイルと同じ木に出る。シェーダーを開くと、道しるべと GLSL の色付け', async ({ page }) => {
    const owner = await person('tree');
    const title = unique('Parts');
    const id = await putDocument(owner, partsDoc(title));
    await openAs(page, owner, `/p/${id}`);
    const doc = partsDoc(title).split('\n');
    const at = (text: string) => doc.findIndex((row) => row.includes(text)) + 1;

    // 本当のファイル（index.html）の下に、style と script。script の中に、見出し、設定の塊、シェーダー
    await expect(tree(page).locator('[data-tree-kind="file"]')).toHaveText([/index\.html/]);
    await expect(tree(page).locator('[data-tree-kind="style"]')).toHaveCount(1);
    await expect(tree(page).locator('[data-tree-kind="script"]')).toHaveCount(1);
    // たたんである所を、全部開く
    for (let turn = 0; turn < 6; turn++) {
      const closed = tree(page).locator('button[aria-expanded="false"]');
      const count = await closed.count();
      if (count === 0) break;
      for (let index = count - 1; index >= 0; index--) await closed.nth(index).click();
    }
    // 線の見出し3つ（TUNE の中の名前も、見出しとして TUNE の下に出る）
    expect(await tree(page).locator('[data-tree-kind="heading"]').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('settings'), expect.stringContaining('shaders'), expect.stringContaining('run')]));
    await expect(tree(page).locator('[data-tree-kind="settings"]')).toHaveText(/TUNE/);
    // 名前の前に、読み上げのための種類（「シェーダー：」）が入る
    await expect(tree(page).locator('[data-tree-kind="shader"]')).toHaveText([/FILL_VERT$/, /WINDOW_FRAG$/, /MIST_FRAG$/]);
    // 関数は木に出さない（目次に出す）
    await expect(tree(page)).not.toContainText('start');

    const shader = tree(page).locator('[data-tree-kind="shader"]', { hasText: 'WINDOW_FRAG' });
    const start = at('const WINDOW_FRAG');
    await expect(shader).toHaveAttribute('href', new RegExp(`/p/${id}/code/index\\.html#L${start}-L${start + 6}$`));
    await shader.click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}/code/index\\.html#L${start}-L${start + 6}$`));
    await expect(page.locator('[data-code-trail]')).toContainText('WINDOW_FRAG');
    await expect(page.locator('[data-code-trail]')).toContainText('GLSL');
    await expect(shader).toHaveAttribute('aria-current', 'true');
    await expect(body(page).locator('[data-selected]')).toHaveCount(7);
    expect(await lineText(page, start)).toBe(doc[start - 1]);
    // シェーダーの文字列の中は GLSL として色が付く：uniform は決まった語、vec2 は型、// はコメント
    const uniformLine = line(page, at('uniform vec2 uRes'));
    await expect(uniformLine.locator('span.text-site-code-keyword', { hasText: 'uniform' })).toHaveCount(1);
    await expect(uniformLine.locator('span.text-site-code-name', { hasText: 'vec2' })).toHaveCount(1);
    await expect(uniformLine.locator('span > span', { hasText: '// size' })).toHaveCount(1);
    // 目次は関数
    await expect(page.locator('[data-code-toc]').getByRole('link')).toHaveText([/start/, /frame/]);
  });
});

test.describe('スマホの幅（390）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('木はたたんである。押すと本文が全画面で開き、初めから折り返す。上に道しるべ、左上に戻る。戻ると閉じ、押した所にフォーカスが戻る', async ({ page }) => {
    await openWork(page, `/p/${MOTION}`);
    await expect(tree(page).locator('[data-tree-kind="file"]')).toHaveCount(3);
    await expect(page.locator('[data-code-panel]')).toBeHidden();
    const length = await page.evaluate(() => history.length);

    await node(page, 'part.js').click();
    await expect(page).toHaveURL(`/p/${MOTION}/code/part.js`);
    const panel = page.locator('[data-code-panel]');
    await line(page, 1).waitFor();
    // 全画面：画面いっぱいで、下のタブより上に重なる
    const box = (await panel.boundingBox())!;
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 390, 844]);
    await expect(page.locator('[data-code-trail]')).toHaveText('part.js');
    await expect(page.getByRole('button', { name: '折り返す', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(line(page, 1).locator('span').first()).toHaveCSS('white-space', 'pre-wrap');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    // 開いたら、フォーカスは中（戻るのリンク）
    const back = page.getByRole('link', { name: '作品のページに戻る' });
    await expect(back).toBeFocused();
    // 履歴は1つだけ増える
    expect(await page.evaluate(() => history.length)).toBe(length + 1);

    await back.click();
    await expect(page).toHaveURL(`/p/${MOTION}`);
    await expect(panel).toBeHidden();
    await expect(node(page, 'part.js')).toBeFocused();
  });

  test('住所で直接開いた時：戻るは、作品のページへ替える（サイトの外へ出ない）。Esc でも閉じる', async ({ page }) => {
    await openWork(page, `/p/${MOTION}/code/part.js#L20`);
    await expect(line(page, 20)).toHaveAttribute('data-selected', '');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(`/p/${MOTION}`);
    await expect(page.locator('[data-code-panel]')).toBeHidden();
  });

  test('大きい文書（6,000 行をこえる）：終わりの方の行の住所で開くと、折り返しのまま、その行が画面に入る。DOM にある行は見えている近くだけ', async ({ page }) => {
    test.setTimeout(90_000);
    const owner = await person('big');
    const rows = 6000;
    const id = await putDocument(owner, bigDoc(unique('Big'), rows));
    await openAs(page, owner, `/p/${id}/code/index.html#L4200`);
    const target = line(page, 4200);
    await expect(target).toHaveAttribute('data-selected', '');
    await expect(target).toBeInViewport();
    // script の 1 行目が 8 行目なので、4200 行目は rows.push の 4193 番
    expect(await lineText(page, 4200)).toContain("label: 'row number 4193 ");
    // 上の帯の下に見えている
    const bar = (await page.locator('[data-code-bar]').boundingBox())!;
    const box = (await target.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(box.y).toBeLessThan(844 / 2);
    // 見えている所の近くだけを描く
    await expect(body(page)).toHaveAttribute('data-lines', String(rows + 11));
    expect(await body(page).locator('[data-line]').count()).toBeLessThanOrEqual(400);
    // 折り返している
    await expect(target.locator('span').first()).toHaveCSS('white-space', 'pre-wrap');
    expect((await target.boundingBox())!.height).toBeGreaterThan(20);
  });
});
