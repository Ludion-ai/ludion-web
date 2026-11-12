// FRAME001：枠の中の localStorage と sessionStorage は、メモリだけの代わり（packages/render の storage.ts）。
// 枠は allow-same-origin のない sandbox なので、本物の storage は読んだだけで SecurityError を投げる。
// AI が書く HTML によくある「読み込みで localStorage を読み、押すたびに書く」作品（fixtures/works/fx-counter）が、枠の中で動くこと。
// playwright.config.ts の frame-storage-chromium、-webkit、-firefox で流す。サーバーは pages と同じ（見本が入っている）。
import { expect, test, type Frame, type Page } from '@playwright/test';
import { FRAME_GUARD_SCRIPT, STORAGE_SCRIPT } from '@ludion/render';
import { PRIVATE_OWNER, privateFixtureId, privateRevisionId } from '../scripts/private-fixture.mjs';
import { framePath } from './helpers';

const ID = 'fx-counter';
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const FRAME = 'iframe[data-ld-frame]';

const ownOrigin = () => new URL(test.info().project.use.baseURL!).origin;

/**
 * ページの中で起きた、捕まえられていない例外（枠の中も、ブラウザが知らせる分は含む）と、storage と cookie についての console の誤り。
 * 枠の中の例外を pageerror に出さないブラウザもあるので、作品が動いたかは #ld-host の data-ld-mount でも見る。
 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && /storage|cookie|SecurityError|insecure/i.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** 親のページのほかの、作品の枠 */
async function workFrame(page: Page, path: string): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame !== page.mainFrame() && framePath(frame) === path)).toBe(true);
  return page.frames().find((frame) => frame !== page.mainFrame() && framePath(frame) === path)!;
}

test('fx-counter：枠の中で読み込みに localStorage を読んでも投げず、押すと数が増える。読み直すと 0 に戻る', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/p/${ID}`);
  const frameLocator = page.frameLocator(FRAME);
  const host = frameLocator.locator('#ld-host');
  // mount が投げると 'error' になる（packages/render の frame.ts）
  await expect(host).toHaveAttribute('data-ld-mount', 'ok');
  const count = frameLocator.locator('.count');
  const add = frameLocator.getByRole('button', { name: 'Add one' });
  await expect(count).toHaveText('0');
  for (const want of ['1', '2', '3']) {
    await add.click();
    await expect(count).toHaveText(want);
  }

  const frame = await workFrame(page, `/frame/${ID}/1/desktop.html`);
  // 書いた値は、同じ枠の中では読める。本物ではなく、メモリだけの代わり（本物は投げる）
  expect(
    await frame.evaluate(() => {
      // 置き換えた取り出しは、ブラウザのものではない
      const replaced = (name: 'localStorage' | 'sessionStorage') => !String(Object.getOwnPropertyDescriptor(window, name)!.get).includes('[native code]');
      return {
        stored: localStorage.getItem('fx-counter:count'),
        replaced: [replaced('localStorage'), replaced('sessionStorage')],
        session: (() => {
          sessionStorage.setItem('k', 'v');
          return sessionStorage.getItem('k');
        })(),
        origin: self.origin,
      };
    }),
  ).toEqual({ stored: '3', replaced: [true, true], session: 'v', origin: 'null' });

  // 保存はしない。読み直すと消える（親のページにも、ludion.ai のオリジンにも預けない）
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('fx-counter')))).toEqual([]);
  await page.reload();
  await expect(page.frameLocator(FRAME).locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
  await expect(page.frameLocator(FRAME).locator('.count')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('対照：メモリだけの代わりを外した枠では、同じ作品が最初の読み込みで投げ、押しても増えない', async ({ page, request }) => {
  const html = await (await request.get(`/frame/${ID}/1/desktop.html`, { headers: FROM_IFRAME })).text();
  // storage の代わりのスクリプトだけを外す（その前の枠の守りは残す。FRAME002）
  const storage = `<script>${STORAGE_SCRIPT}</script>`;
  expect(html).toContain(storage);
  const bare = html.replace(storage, '');
  const errors = watchErrors(page);
  await page.route('**/__storage_control__', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><title>control</title><iframe sandbox="allow-scripts allow-forms" srcdoc="${bare.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`,
    }),
  );
  await page.goto('/__storage_control__');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'error');
  await frame.getByRole('button', { name: 'Add one' }).click();
  await expect(frame.locator('.count')).toHaveText('0');
  // ブラウザが枠の中の例外を親のページの知らせに出すときは、storage を読めないという例外（出さないブラウザもあるので、data-ld-mount で見る）
  for (const error of errors.filter((text) => text.startsWith('pageerror'))) expect(error).toMatch(/localStorage|SecurityError|insecure/i);
});

test('作品を動かす枠は全部、作品のスクリプトより先にメモリだけの代わりを持つ（作品のページ、スマホの幅、ヘッダーのスイッチ、全画面、下書き）', async ({ request, context }) => {
  // 最初は枠の守り（FRAME002）、次がメモリだけの代わり
  const firstScripts = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].slice(0, 2).map((m) => m[1]);
  const workScript = (html: string) => html.indexOf('<script type="module">');
  const all: string[] = [];
  for (const file of ['desktop', 'mobile', 'inline', 'wall']) {
    const response = await request.get(`/frame/${ID}/1/${file}.html`, { headers: FROM_IFRAME });
    expect(response.status()).toBe(200);
    all.push(await response.text());
  }
  // 自分だけの作品の枠（下書きの枠）。見本の持ち主として読む
  await context.addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: ownOrigin() }]);
  const draft = await context.request.get(`/draft-frame/${privateRevisionId('mal-cookie')}/desktop.html`, { headers: FROM_IFRAME });
  expect(draft.status(), privateFixtureId('mal-cookie')).toBe(200);
  all.push(await draft.text());

  for (const html of all) {
    expect(firstScripts(html)).toEqual([FRAME_GUARD_SCRIPT, STORAGE_SCRIPT]);
    expect(html.indexOf(STORAGE_SCRIPT)).toBeLessThan(workScript(html));
  }
});
