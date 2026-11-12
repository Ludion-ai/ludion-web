// DOC002：文書の作品に、枠から撮った画像を付けて、公開に回せるようにする。
// playwright.config.ts の thumb-capture-* で、Chromium、WebKit、Firefox の全部で流す。サーバーは pages と同じ（悪意のある見本 mal-doc が入っている）。
// 人と作品は HTTP だけで作る（偽の GitHub でログイン、AI の鍵、/api/v1）。手元の D1 のファイルを直に開かないので、ほかの pages のテストと並んで走ってよい。
import { buildDocumentFrameHtml, CAPTURE_READY, CAPTURE_REQUEST, CAPTURE_RESULT, CAPTURE_SCRIPT, FRAME_RESPONSE_CSP } from '@ludion/render';
import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { PRIVATE_OWNER, privateRevisionId } from '../scripts/private-fixture.mjs';
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

type Editable = { private: boolean; public_version: string; revision: { id: string; version: string; status: string; thumb: string | null; thumb_w: number } };
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
    await openAs(page, owner.visitor, '/account/works');
    const row = page.locator(`[data-own-work="${id}"]`);
    await expect(row.locator('[data-no-thumb]')).toBeVisible();
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
