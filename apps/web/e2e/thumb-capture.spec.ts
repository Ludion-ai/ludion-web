// DOC002：文書の作品に、枠から撮った画像を付けて、公開に回せるようにする。
// playwright.config.ts の thumb-capture-* で、Chromium、WebKit、Firefox の全部で流す。サーバーは pages と同じ（悪意のある見本 mal-doc が入っている）。
// 人と作品は HTTP だけで作る（偽の GitHub でログイン、AI の鍵、/api/v1）。手元の D1 のファイルを直に開かないので、ほかの pages のテストと並んで走ってよい。
import { buildDocumentFrameHtml, CAPTURE_FIT_SIZE, CAPTURE_READY, CAPTURE_REQUEST, CAPTURE_RESULT, CAPTURE_SCRIPT, FRAME_RESPONSE_CSP } from '@ludion/render';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { PRIVATE_OWNER, privateRevisionId } from '../scripts/private-fixture.mjs';
import { AUTO_FIT_SIZE, AUTO_THUMB_SKIP_KEY, canAutoCapture } from '../src/lib/autoThumb';
import * as site from '../src/lib/post';
import { Visitor, ownOrigin } from './visitor';

const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const CONFIRM = { own: true, mit: true, terms: true };
const REPO = join(import.meta.dirname, '../../..');
const unique = (label: string) => `${label}${randomBytes(4).toString('hex')}`;

/** 手元で作る PNG（ファイルを選ぶ道で使う）。 */
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
    for (let x = 0; x < width; x += 1) for (const value of [x % 256, y % 256, 90, 255]) raw[at++] = value;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** AI がふつうに書く1つの HTML 文書（DOM だけ。canvas なし）。 */
const plainDoc = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1020; color: #f4f4f5; font: 600 40px system-ui, sans-serif; }
.card { padding: 40px 64px; border-radius: 24px; background: #ff6a3d; animation: in 0.4s ease both; }
@keyframes in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
<div class="card"><span id="n">0</span> <button id="b" type="button">Count</button></div>
<script>
let n = 0;
document.getElementById('b').addEventListener('click', () => { n += 1; document.getElementById('n').textContent = String(n); });
</script>
</body>
</html>
`;

/** 中身を開いた Shadow DOM に入れる文書（枠からは撮れない）。 */
const shadowDoc = (title: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title><style>body { margin: 0; background: #f4f4f5; }</style></head>
<body>
<h1>Picker</h1>
<div id="host"></div>
<script>
document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<p style="font-size:40px">inside the shadow</p>';
</script>
</body>
</html>
`;

async function person(label: string) {
  const visitor = new Visitor();
  const login = unique(label);
  expect((await visitor.login(login)).status).toBe(302);
  expect(visitor.cookies.get('ld_session')).toBeTruthy();
  return { visitor, login };
}

/** AI の口で文書を置く。自分だけの作品になる（サムネイルなし）。 */
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
  const body = (await put.json()) as { id: string; visibility: string };
  expect(body.visibility).toBe('private');
  return body.id;
}

type Editable = { private: boolean; public_version: string; revision: { id: string; version: string; status: string; thumb: string | null; thumb_w: number; thumb_h: number } };
const editable = async (visitor: Visitor, id: string) => (await (await visitor.fetch(`/api/post/works/${id}`)).json()) as Editable;

/**
 * ブラウザで、その人として開く。HTTP でログインしたセッションの cookie を渡す
 * （WebKit は http の手元で Secure の cookie を持たないので、ブラウザでログインの流れを通さない。frame-document.spec.ts と同じ）。
 */
async function openAs(page: Page, visitor: Visitor, path: string) {
  await page.context().addCookies([{ name: 'ld_session', value: visitor.cookies.get('ld_session')!, url: ownOrigin() }]);
  await page.goto(path);
  await expect(page).toHaveURL(path);
}

/** 自動で撮る方（THUMB001）を、この版では止める（「前に撮れなかった版」としてブラウザに覚えさせる。サイトと同じ鍵）。 */
const skipAuto = (page: Page, revisionId: string) =>
  page.addInitScript(([key, rid]) => localStorage.setItem(key, JSON.stringify([rid])), [AUTO_THUMB_SKIP_KEY, revisionId] as const);

/**
 * 画像を送る（multipart の thumb だけ）。断られる試しの画像は小さくする（口は本文を読む前に断る。
 * 手元の vite preview は、読まれなかった大きい本文で 500 を返すことがあるため）。
 */
const sendThumb = (visitor: Visitor, id: string, origin: string | null = ownOrigin()) => {
  const form = new FormData();
  form.append('thumb', new Blob([new Uint8Array(png(8, 8))], { type: 'image/png' }), 'x.png');
  return visitor.fetch(`/api/post/works/${id}/thumb`, { method: 'POST', body: form, headers: origin === null ? {} : { Origin: origin } });
};

test.describe('画像を付ける（DOC002）', () => {
  test('持ち主が「画像を付ける」で枠から撮り、新しい版に画像が付き、公開に回せる。今の版は書き換わらない', async ({ page }) => {
    test.setTimeout(90_000);
    const owner = await person('thumbcap');
    const title = unique('Capture Card ');
    const doc = plainDoc(title);
    const id = await putDocument(owner.visitor, doc);
    const before = await editable(owner.visitor, id);
    expect(before.revision).toMatchObject({ status: 'private', thumb: null, thumb_w: 0 });
    const oldFrame = `/draft-frame/${before.revision.id}/desktop.html`;

    // 撮る仕掛けは、持ち主が ?capture=1 で開いた枠だけ。ふつうの枠は今のまま（文書の頭にサイトのスクリプトだけ）
    const plain = await owner.visitor.fetch(oldFrame, { headers: FROM_IFRAME });
    expect(plain.headers.get('content-security-policy')).toBe(FRAME_RESPONSE_CSP);
    const plainHtml = await plain.text();
    expect(plainHtml).toBe(buildDocumentFrameHtml(doc));
    const withCapture = await owner.visitor.fetch(`${oldFrame}?capture=1`, { headers: FROM_IFRAME });
    expect(withCapture.headers.get('content-security-policy')).toBe(FRAME_RESPONSE_CSP);
    expect(await withCapture.text()).toBe(buildDocumentFrameHtml(doc, { capture: true }));

    // 画像がないうちは公開に回せない
    expect((await owner.visitor.post(`/api/post/works/${id}/publish`, CONFIRM)).status).toBe(422);

    // ほかの人は、口も撮る枠も使えない（ない作品と同じ 404）。ログインしていない人は 401。ほかのサイトからは 403
    const other = await person('thumbother');
    expect((await sendThumb(other.visitor, id)).status).toBe(404);
    expect((await other.visitor.fetch(`${oldFrame}?capture=1`, { headers: FROM_IFRAME })).status).toBe(404);
    expect((await sendThumb(new Visitor(), id)).status).toBe(401);
    expect((await sendThumb(owner.visitor, id, 'https://evil.example')).status).toBe(403);

    // 「自分の作品」で「画像を付ける」→ 枠を 1280×800 で見せる →「この絵にする」→ 撮った絵を見せる →「この絵を送る」
    // この試験は人が撮る道を見るので、自動で撮る方（THUMB001）は「この版は前に撮れなかった」として止めておく
    await skipAuto(page, before.revision.id);
    await openAs(page, owner.visitor, '/account/works');
    const row = page.locator(`[data-own-work="${id}"]`);
    await expect(row.locator('[data-no-thumb]')).toBeVisible();
    await expect(row.locator('[data-auto-thumb]')).toHaveAttribute('data-auto-thumb', 'stopped');
    await row.getByRole('button', { name: `${title}に画像を付ける` }).click();
    const dialog = page.getByRole('dialog', { name: '画像を付ける' });
    await expect(dialog).toBeVisible();
    const frame = dialog.locator('iframe[data-ld-frame]');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    expect(await frame.evaluate((element: HTMLIFrameElement) => [element.offsetWidth, element.offsetHeight])).toEqual([1280, 800]);
    // 作品は枠の中で動く。押した後の絵を撮る
    await page.frameLocator('dialog iframe[data-ld-frame]').getByRole('button', { name: 'Count' }).click();
    await expect(page.frameLocator('dialog iframe[data-ld-frame]').locator('#n')).toHaveText('1');
    const take = dialog.getByRole('button', { name: 'この絵にする' });
    await expect(take).toBeEnabled();
    await take.click();
    const preview = dialog.locator('img[data-thumb-preview]');
    await expect(preview).toBeVisible();
    // 撮った絵は 1280×800 で、作品の色（地の紺と、カードの橙）が写っている。送る前に JPEG にするので、色は少しずれてよい
    const colors = await preview.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
      const near = (at: number, rgb: number[]) => rgb.every((value, index) => Math.abs(data[at + index] - value) <= 24);
      let navy = 0;
      let orange = 0;
      for (let at = 0; at < data.length; at += 4 * 7) {
        if (near(at, [0x0b, 0x10, 0x20])) navy += 1;
        else if (near(at, [0xff, 0x6a, 0x3d])) orange += 1;
      }
      const samples = data.length / (4 * 7);
      return { size: [canvas.width, canvas.height], navy: navy / samples, orange: orange / samples };
    });
    expect(colors.size).toEqual([1280, 800]);
    expect(colors.navy, JSON.stringify(colors)).toBeGreaterThan(0.5);
    expect(colors.orange, JSON.stringify(colors)).toBeGreaterThan(0.02);
    await dialog.getByRole('button', { name: 'この絵を送る' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByRole('status')).toHaveText('画像を付けました');
    await expect(row.locator('img')).toBeVisible();

    // 新しい版に画像が付き、今の版になった。前の版は書き換わらない（枠の HTML も同じ、画像もないまま）
    const after = await editable(owner.visitor, id);
    expect(after.private).toBe(true);
    expect(after.revision.id).not.toBe(before.revision.id);
    expect(after.revision).toMatchObject({ status: 'private', thumb_w: 800 });
    expect(Number(after.revision.version)).toBeGreaterThan(Number(before.revision.version));
    expect(after.public_version).toBe(after.revision.version);
    expect(await (await owner.visitor.fetch(oldFrame, { headers: FROM_IFRAME })).text()).toBe(plainHtml);
    expect((await owner.visitor.fetch(`/draft-thumb/${before.revision.id}.webp`)).status).toBe(404);
    const thumb = await owner.visitor.fetch(after.revision.thumb!);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    // 新しい版の中身は前の版と同じ文書
    expect(await (await owner.visitor.fetch(`/draft-frame/${after.revision.id}/desktop.html`, { headers: FROM_IFRAME })).text()).toBe(plainHtml);

    // 今の「公開する」（審査に出す）がそのまま通る
    const publish = await owner.visitor.post(`/api/post/works/${id}/publish`, CONFIRM);
    expect(publish.status, await publish.clone().text()).toBe(200);
    expect(await publish.json()).toMatchObject({ status: 'submitted', revision_id: after.revision.id });
    // 審査中は、画像を足せない
    expect((await sendThumb(owner.visitor, id)).status).toBe(409);
  });

  test('撮れないとき（Shadow DOM の中がある）は、ファイルを選ぶ道が出て、選んだ画像を付けられる。自分だけの作品のページからも開ける', async ({ page }) => {
    test.setTimeout(90_000);
    const owner = await person('thumbshadow');
    const title = unique('Shadow Picker ');
    const id = await putDocument(owner.visitor, shadowDoc(title));
    const before = await editable(owner.visitor, id);

    await openAs(page, owner.visitor, `/p/${id}`);
    await page.locator('[data-private-notice]').getByRole('button', { name: `${title}に画像を付ける` }).click();
    const dialog = page.getByRole('dialog', { name: '画像を付ける' });
    const take = dialog.getByRole('button', { name: 'この絵にする' });
    await expect(take).toBeEnabled();
    await take.click();
    const fallback = dialog.locator('[data-thumb-fallback="shadow"]');
    await expect(fallback).toBeVisible();
    await expect(dialog.locator('img[data-thumb-preview]')).toHaveCount(0);
    await fallback.getByLabel('画像のファイルを選ぶ').setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: png(900, 700) });
    await expect(dialog.locator('img[data-thumb-preview]')).toBeVisible();
    await dialog.getByRole('button', { name: 'この絵を送る' }).click();
    // 付けたら作品のページを読み込み直す（新しい版が今の版）
    await expect(page.locator('[data-private-notice]').getByRole('button', { name: `${title}に画像を付ける` })).toHaveText('画像を変える');
    const after = await editable(owner.visitor, id);
    expect(after.revision.id).not.toBe(before.revision.id);
    expect(after.revision.thumb_w).toBe(800);
  });

  test('公開の枠と、今ある自分だけの文書の作品の枠は、撮る仕掛けを足さない（HTML が今のまま）', async () => {
    test.skip(test.info().project.use.browserName !== 'chromium', 'HTTP だけの確かめなので、1つのブラウザで');
    const doc = readFileSync(join(REPO, 'fixtures/malicious/mal-doc/index.html'), 'utf8');
    const owner = new Visitor(PRIVATE_OWNER.session);
    const publicFrame = await new Visitor().fetch('/frame/mal-doc/1/desktop.html', { headers: FROM_IFRAME });
    expect(await publicFrame.text()).toBe(buildDocumentFrameHtml(doc));
    // ?capture=1 を付けても、公開の枠には足さない
    expect(await (await new Visitor().fetch('/frame/mal-doc/1/desktop.html?capture=1', { headers: FROM_IFRAME })).text()).toBe(buildDocumentFrameHtml(doc));
    const draft = `/draft-frame/${privateRevisionId('mal-doc')}/desktop.html`;
    expect(await (await owner.fetch(draft, { headers: FROM_IFRAME })).text()).toBe(buildDocumentFrameHtml(doc));
    const captured = await (await owner.fetch(`${draft}?capture=1`, { headers: FROM_IFRAME })).text();
    expect(captured).toBe(buildDocumentFrameHtml(doc, { capture: true }));
    expect(captured).toContain(CAPTURE_SCRIPT);
    // 画面（src/lib/post.ts）の知らせの形は、撮る仕掛けと同じ
    expect([site.CAPTURE_REQUEST, site.CAPTURE_RESULT, site.CAPTURE_READY]).toEqual([CAPTURE_REQUEST, CAPTURE_RESULT, CAPTURE_READY]);
    // 枠の外から開くと、今までどおり戻す
    expect((await owner.fetch(`${draft}?capture=1`)).status).toBe(302);
  });
});

// THUMB001：画像のない自分だけの作品は、持ち主が「自分の作品」を開くと、枠から自動で撮って付ける。

/** 契約の形の部品。WebGL で1回だけ描く（描いた絵は、画面に出た後に消える。撮る枠では読めるようにしてある）。WebGL がなければ、canvas は空のまま。 */
const glPart = (part: string, title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
</head>
<body>
<div data-ld-part="${part}"><canvas class="stage" width="320" height="200"></canvas><p>GL</p></div>
<style>
[data-ld-part="${part}"] { --_bg: var(--ld-bg, #0b1020); --_fg: var(--ld-fg, #f4f4f5); --_radius: var(--ld-radius, 10px); --_space: var(--ld-space, 8px); width: 320px; padding: calc(var(--_space) * 2); background: var(--_bg); color: var(--_fg); }
[data-ld-part="${part}"] .stage { display: block; width: 320px; height: 200px; border-radius: var(--_radius); }
[data-ld-part="${part}"] p { margin: calc(var(--_space) * 1) 0 0; }
</style>
<script type="module">
function mount(root) {
  const gl = root.querySelector('.stage').getContext('webgl');
  if (gl) {
    gl.clearColor(1, 0.416, 0.239, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 160, 200);
    gl.clearColor(0.2, 0.4, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  return () => {};
}
mount(document.querySelector('[data-ld-part="${part}"]'));
</script>
</body>
</html>
`;

const ORANGE = [0xff, 0x6a, 0x3d];
const NAVY = [0x0b, 0x10, 0x20];
const BLUE = [0x33, 0x66, 0xff];

/** 画像の大きさと、それぞれの色に近い画素の割合。 */
const colorShares = (image: Locator, colors: number[][]) =>
  image.evaluate(async (img: HTMLImageElement, colors: number[][]) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = colors.map(() => 0);
    let samples = 0;
    for (let at = 0; at < data.length; at += 4 * 7) {
      samples += 1;
      const hit = colors.findIndex((rgb) => rgb.every((value, index) => Math.abs(data[at + index] - value) <= 24));
      if (hit !== -1) counts[hit] += 1;
    }
    return { size: [canvas.width, canvas.height], shares: counts.map((count) => count / samples) };
  }, colors);

type Listed = { id: string; updated_at: number; versions: number; thumb: string | null };
const listedWork = async (visitor: Visitor, id: string) => ((await (await visitor.fetch('/api/post/works')).json()) as { works: Listed[] }).works.find((work) => work.id === id)!;

/** そのページが読んだ、下書きの枠の URL（道と ?）。 */
function watchDraftFrames(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/draft-frame/')) seen.push(url.pathname + url.search);
  });
  return seen;
}

test.describe('サムネイルを自動で撮る（THUMB001）', () => {
  test('画像のない自分だけの作品は、「自分の作品」を開くと枠から撮られて、新しい版に画像が付く。前の版も、最後に変えた日も変わらない。開き直しても撮り直さない', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit では自動で撮らない（下の試験）');
    test.setTimeout(120_000);
    const owner = await person('autodoc');
    const title = unique('Auto Card ');
    const doc = plainDoc(title);
    const id = await putDocument(owner.visitor, doc);
    const before = await editable(owner.visitor, id);
    expect(before.revision).toMatchObject({ status: 'private', thumb: null, thumb_w: 0 });
    const listedBefore = await listedWork(owner.visitor, id);
    const oldFrame = `/draft-frame/${before.revision.id}/desktop.html`;

    const frames = watchDraftFrames(page);
    await openAs(page, owner.visitor, '/account/works');
    const row = page.locator(`[data-own-work="${id}"]`);
    // 何も押さない。頭文字 → 画像。撮る枠は 1280×800 で、画面の左上に透明で置く（見せない、触れない）。守りは今の枠と同じ
    const stage = page.locator('iframe[data-auto-thumb-frame]');
    await expect(stage).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    await expect(stage).toHaveAttribute('src', `${oldFrame}?capture=1`);
    expect(await stage.evaluate((element: HTMLIFrameElement) => [element.offsetWidth, element.offsetHeight, getComputedStyle(element).opacity, getComputedStyle(element).pointerEvents, element.tabIndex])).toEqual([1280, 800, '0', 'none', -1]);
    const thumb = row.locator('img:not([data-auto-thumb-shot])');
    await expect(thumb).toBeVisible({ timeout: 60_000 });
    expect(frames).toEqual([`${oldFrame}?capture=1`]);
    await expect(row.locator('[data-auto-thumb]')).toHaveCount(0);
    await expect(stage).toHaveCount(0);
    await expect(row.getByRole('button', { name: `${title}に画像を付ける` })).toHaveText('画像を変える');

    // 新しい版に画像が付き、今の版になった。枠の全部（1280×800）の絵なので、サムネイルは 800×500
    const after = await editable(owner.visitor, id);
    expect(after.private).toBe(true);
    expect(after.revision.id).not.toBe(before.revision.id);
    expect(after.revision).toMatchObject({ status: 'private', thumb_w: 800, thumb_h: 500 });
    expect(Number(after.revision.version)).toBe(Number(before.revision.version) + 1);
    expect(after.public_version).toBe(after.revision.version);
    // 作品の色（地の紺と、カードの橙）が写っている
    const colors = await colorShares(thumb, [NAVY, ORANGE]);
    expect(colors.size).toEqual([800, 500]);
    expect(colors.shares[0], JSON.stringify(colors)).toBeGreaterThan(0.5);
    expect(colors.shares[1], JSON.stringify(colors)).toBeGreaterThan(0.02);
    // 前の版は書き換わらない（枠の HTML も同じ、画像もないまま）。新しい版の中身は前の版と同じ文書
    expect(await (await owner.visitor.fetch(oldFrame, { headers: FROM_IFRAME })).text()).toBe(buildDocumentFrameHtml(doc));
    expect((await owner.visitor.fetch(`/draft-thumb/${before.revision.id}.webp`)).status).toBe(404);
    expect(await (await owner.visitor.fetch(`/draft-frame/${after.revision.id}/desktop.html`, { headers: FROM_IFRAME })).text()).toBe(buildDocumentFrameHtml(doc));
    // 中身は変えていないので、最後に変えた日はそのまま（一覧の並びが動かない）
    const listedAfter = await listedWork(owner.visitor, id);
    expect(listedAfter.updated_at).toBe(listedBefore.updated_at);
    expect(listedAfter.versions).toBe(listedBefore.versions + 1);

    // 開き直しても、もう撮らない（枠を読まない、版が増えない）
    frames.length = 0;
    await page.reload();
    await expect(thumb).toBeVisible();
    await page.waitForTimeout(1500);
    expect(frames).toEqual([]);
    expect((await editable(owner.visitor, id)).revision.id).toBe(after.revision.id);

    // 画像が付いたので、今の「公開する」（審査に出す）がそのまま通る
    const publish = await owner.visitor.post(`/api/post/works/${id}/publish`, CONFIRM);
    expect(publish.status, await publish.clone().text()).toBe(200);
  });

  test('画面の外の行も、スマホの幅でも、上から順に全部撮る（動かさなくてよい）。絵は 1280×800 の枠のまま', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit では自動で撮らない（下の試験）');
    test.setTimeout(120_000);
    const owner = await person('autolist');
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push(await putDocument(owner.visitor, plainDoc(unique(`Auto List ${i} `))));
    await page.setViewportSize({ width: 390, height: 600 });
    await openAs(page, owner.visitor, '/account/works');
    const rows = page.locator('[data-own-work]');
    await expect(rows).toHaveCount(3);
    const order = await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-own-work')));
    expect([...order].sort()).toEqual([...ids].sort());
    // 下の2行は画面の外。動かさずに待つ
    expect(await rows.last().evaluate((row) => row.getBoundingClientRect().top > window.innerHeight)).toBe(true);
    for (const id of order) await expect(page.locator(`[data-own-work="${id}"] img:not([data-auto-thumb-shot])`)).toBeAttached({ timeout: 60_000 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // 並びは動かない。どの作品も版が1つ増えただけ
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-own-work')))).toEqual(order);
    for (const id of ids) expect((await listedWork(owner.visitor, id)).versions).toBe(2);
    // いちばん下の作品の絵も、幅 1280 の枠の絵（800×500。地の紺と、カードの橙）
    const colors = await colorShares(rows.last().locator('img:not([data-auto-thumb-shot])'), [NAVY, ORANGE]);
    expect(colors.size).toEqual([800, 500]);
    expect(colors.shares[0], JSON.stringify(colors)).toBeGreaterThan(0.5);
    expect(colors.shares[1], JSON.stringify(colors)).toBeGreaterThan(0.02);
    // 撮る枠は、ページを横に広げない
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('契約の形の部品（WebGL の canvas）も撮れて、部品のまわりを切り出した絵になる。撮れないブラウザでは、付けずに頭文字のまま', async ({ page, browserName }) => {
    test.setTimeout(120_000);
    const owner = await person('autogl');
    const title = unique('Auto GL ');
    const id = await putDocument(owner.visitor, glPart(unique('auto-gl-'), title));
    const before = await editable(owner.visitor, id);
    expect(before.revision).toMatchObject({ status: 'private', thumb: null, thumb_w: 0 });

    await openAs(page, owner.visitor, '/account/works');
    const hasWebgl = await page.evaluate(() => document.createElement('canvas').getContext('webgl') !== null);
    const row = page.locator(`[data-own-work="${id}"]`);
    const thumb = row.locator('img:not([data-auto-thumb-shot])');
    const stopped = row.locator('[data-auto-thumb="stopped"]');
    await expect(thumb.or(stopped)).toBeVisible({ timeout: 60_000 });
    const after = await editable(owner.visitor, id);
    if (await stopped.isVisible()) {
      // 撮れなかった（WebKit では撮らない。WebGL のないブラウザでは canvas が空）：何も付けない。版も増えない。頭文字のまま、人が付ける道が残る
      expect(browserName === 'webkit' || !hasWebgl, 'Chromium と Firefox で WebGL があれば、撮れる').toBe(true);
      expect(after.revision.id).toBe(before.revision.id);
      await expect(row.locator('[data-no-thumb]')).toBeVisible();
      await expect(row.getByRole('button', { name: `${title}に画像を付ける` })).toHaveText('画像を付ける');
      return;
    }
    // 撮れた：部品のまわりを 4:3 で切り出した絵（800×600）。WebGL で描いた2色（橙と青）が写っている
    expect(after.revision.id).not.toBe(before.revision.id);
    expect(after.revision).toMatchObject({ status: 'private', thumb_w: 800, thumb_h: 600 });
    const colors = await colorShares(thumb, [ORANGE, BLUE]);
    expect(colors.size).toEqual([800, 600]);
    expect(colors.shares[0], JSON.stringify(colors)).toBeGreaterThan(0.08);
    expect(colors.shares[1], JSON.stringify(colors)).toBeGreaterThan(0.08);
    // 部品は絵の中央にある。部品の幅（352px）が絵の幅の6割なので、canvas（320×200）は 436×273 で、左右は 181〜618。左半分が青、右半分が橙
    // （絵の中の並びが、動いている枠と同じ。絵を広げて描くと中身を並べ直すブラウザがあるため、場所も見る）
    const box = await thumb.evaluate(async (img: HTMLImageElement, colors: number[][]) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
      return colors.map((rgb) => {
        const range = { left: canvas.width, right: -1, top: canvas.height, bottom: -1 };
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const at = (y * canvas.width + x) * 4;
            if (!rgb.every((value, index) => Math.abs(data[at + index] - value) <= 24)) continue;
            range.left = Math.min(range.left, x);
            range.right = Math.max(range.right, x);
            range.top = Math.min(range.top, y);
            range.bottom = Math.max(range.bottom, y);
          }
        }
        return range;
      });
    }, [BLUE, ORANGE]);
    const near = (value: number, expected: number, slack: number) => Math.abs(value - expected) <= slack;
    const [blue, orange] = box;
    expect(near(blue.left, 181, 10) && near(blue.right, 400, 10) && near(orange.left, 400, 10) && near(orange.right, 618, 10), JSON.stringify(box)).toBe(true);
    // 上下は、文字の行の高さがブラウザで少し違う分だけ許す
    for (const range of box) expect(near(range.bottom - range.top, 273, 10) && near((range.top + range.bottom) / 2, 300, 40), JSON.stringify(box)).toBe(true);
  });

  test('撮れない作品（Shadow DOM の中がある）は、頭文字のまま。版を作らず、その版はもう試さない', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit では自動で撮らない（下の試験）');
    test.setTimeout(90_000);
    const owner = await person('autoshadow');
    const title = unique('Auto Shadow ');
    const id = await putDocument(owner.visitor, shadowDoc(title));
    const before = await editable(owner.visitor, id);

    const frames = watchDraftFrames(page);
    await openAs(page, owner.visitor, '/account/works');
    const row = page.locator(`[data-own-work="${id}"]`);
    await expect(row.locator('[data-auto-thumb="stopped"]')).toBeVisible({ timeout: 60_000 });
    expect(frames).toEqual([`/draft-frame/${before.revision.id}/desktop.html?capture=1`]);
    await expect(row.locator('[data-no-thumb]')).toBeVisible();
    await expect(page.locator('iframe[data-auto-thumb-frame]')).toHaveCount(0);
    expect((await editable(owner.visitor, id)).revision.id).toBe(before.revision.id);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as string[], AUTO_THUMB_SKIP_KEY)).toContain(before.revision.id);

    // 開き直しても、枠を読まない
    frames.length = 0;
    await page.reload();
    await expect(row.locator('[data-auto-thumb="stopped"]')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(frames).toEqual([]);
    // 人が付ける道は残る
    await expect(row.getByRole('button', { name: `${title}に画像を付ける` })).toBeVisible();
  });

  test('WebKit では自動で撮らない（canvas が写らないことがあるため）。頭文字のまま、枠を読まず、版も増えない。人が付ける道は残る', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'WebKit だけの確かめ');
    const owner = await person('autowebkit');
    const title = unique('Auto Webkit ');
    const id = await putDocument(owner.visitor, plainDoc(title));
    const before = await editable(owner.visitor, id);
    const frames = watchDraftFrames(page);
    await openAs(page, owner.visitor, '/account/works');
    const row = page.locator(`[data-own-work="${id}"]`);
    await expect(row.locator('[data-auto-thumb="stopped"]')).toHaveAttribute('data-auto-thumb-why', 'browser');
    await expect(row.locator('[data-no-thumb]')).toBeVisible();
    await page.waitForTimeout(3000);
    expect(frames).toEqual([]);
    expect((await editable(owner.visitor, id)).revision.id).toBe(before.revision.id);
    // ほかのブラウザで開けば撮れるように、「撮れなかった版」としては覚えない
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTO_THUMB_SKIP_KEY)).toBeNull();
    await expect(row.getByRole('button', { name: `${title}に画像を付ける` })).toHaveText('画像を付ける');
  });

  test('自動の絵は、今の版に画像がないときだけ足される。撮る仕掛けは、契約の形の作品でも、持ち主が ?capture=1 で開いた下書きの枠だけ', async () => {
    test.skip(test.info().project.use.browserName !== 'chromium', 'HTTP だけの確かめなので、1つのブラウザで');
    const owner = await person('autohttp');
    const id = await putDocument(owner.visitor, glPart(unique('auto-http-'), unique('Auto Http ')));
    const before = await editable(owner.visitor, id);
    const frame = `/draft-frame/${before.revision.id}/desktop.html`;

    // capture のない枠は今のまま。?capture=1 は、頭の最後に撮る仕掛けを1つ足すだけ（作品の JS より先）
    const plain = await (await owner.visitor.fetch(frame, { headers: FROM_IFRAME })).text();
    expect(plain).not.toContain(CAPTURE_SCRIPT);
    const withCapture = await owner.visitor.fetch(`${frame}?capture=1`, { headers: FROM_IFRAME });
    expect(withCapture.headers.get('content-security-policy')).toBe(FRAME_RESPONSE_CSP);
    expect(plain.split('\n</head>')).toHaveLength(2);
    expect(await withCapture.text()).toBe(plain.replace('\n</head>', () => `\n<script>${CAPTURE_SCRIPT}</script>\n</head>`));
    // ほかの人には、ない作品と同じ 404。枠の外から開くと、今までどおり戻す
    const other = await person('autoother');
    expect((await other.visitor.fetch(`${frame}?capture=1`, { headers: FROM_IFRAME })).status).toBe(404);
    expect((await owner.visitor.fetch(`${frame}?capture=1`)).status).toBe(302);
    // 画面（src/lib/autoThumb.ts）の切り出しの大きさは、撮る仕掛けと同じ
    expect(AUTO_FIT_SIZE).toEqual(CAPTURE_FIT_SIZE);
    // 自動で撮るブラウザ：Chromium の系統と Firefox。WebKit（Safari、iPhone の全部のブラウザ）では撮らない
    const agents: [string, boolean][] = [
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', true],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', true],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', true],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0', true],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', false],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1', false],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/141.0.0.0 Mobile/15E148 Safari/605.1.15', false],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15', false],
      ['', false],
    ];
    for (const [agent, expected] of agents) expect(canAutoCapture(agent), agent).toBe(expected);

    // 断られる試しの画像は小さくする（上の sendThumb と同じ理由）
    const send = (query: string, image = png(400, 300)) => {
      const form = new FormData();
      form.append('thumb', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'x.png');
      return owner.visitor.fetch(`/api/post/works/${id}/thumb${query}`, { method: 'POST', body: form, headers: { Origin: ownOrigin() } });
    };
    // 画像がないうちは、自動の絵が付く
    const first = await send('?only_missing=1');
    expect(first.status, await first.clone().text()).toBe(200);
    const withThumb = await editable(owner.visitor, id);
    expect(withThumb.revision.id).not.toBe(before.revision.id);
    expect(withThumb.revision.thumb_w).toBe(800);
    // 画像があれば、自動の絵は足さない（409）。版も増えない。人が選んだ画像は、今までどおり足せる
    const second = await send('?only_missing=1', png(8, 8));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'has_thumb' });
    expect((await editable(owner.visitor, id)).revision.id).toBe(withThumb.revision.id);
    expect((await send('')).status).toBe(200);
    expect((await editable(owner.visitor, id)).revision.id).not.toBe(withThumb.revision.id);
  });
});
