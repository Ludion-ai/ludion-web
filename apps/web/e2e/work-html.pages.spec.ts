// PERF002：作品のページの HTML を軽くし、作品の枠を早く読み始める。見た目と作品の最初のコマは変えない。
// 1. 枠の src は、枠の入れ物の直後の台本が入れる（HTML の最後の beforeApp を待たない）。
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { survivesHtmlText } from '../src/lib/codeText';
import { PHONE_QUERY, previewScale, withFrameDpr, type FrameSize } from '../src/lib/frame';

/** 枠に src が入った時に、その時の HTML がどこまで届いていたかと、入れ物の幅を残す（ページの台本より先に動く） */
const recordFrameStart = () => {
  const seen: { src: string; width: number | null; preParsed: boolean; scriptsAfter: number }[] = [];
  (window as unknown as { __frameStart: typeof seen }).__frameStart = seen;
  new MutationObserver((records) => {
    for (const record of records) {
      const frame = record.target as HTMLIFrameElement;
      if (record.attributeName !== 'src' || !frame.hasAttribute('data-ld-frame') || seen.length) continue;
      seen.push({
        src: frame.getAttribute('src')!,
        width: frame.closest<HTMLElement>('[data-frame-size]')?.clientWidth ?? null,
        // コードの箱（ページの中ほど）と、HTML の最後の JSON が、まだ届いていない
        preParsed: document.querySelector('pre') !== null,
        scriptsAfter: document.querySelectorAll('#ld-page').length,
      });
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['src'] });
};

async function openAndRead(page: Page, id: string) {
  await page.addInitScript(recordFrameStart);
  await page.goto(`/p/${id}`);
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
  return page.evaluate((query) => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-ld-frame]')!;
    const box = frame.closest<HTMLElement>('[data-frame-size]');
    return {
      start: (window as unknown as { __frameStart: { src: string; width: number | null; preParsed: boolean; scriptsAfter: number }[] }).__frameStart,
      src: frame.getAttribute('src')!,
      dataSrc: frame.dataset.src!,
      size: (box?.dataset.frameSize ?? null) as FrameSize | null,
      width: box?.clientWidth ?? null,
      phone: matchMedia(query).matches,
      dpr: devicePixelRatio,
    };
  }, PHONE_QUERY);
}

test('HTML：枠を読み始める台本が、枠の入れ物の直後で、コードの箱より前にある', async ({ request }) => {
  const html = await (await request.get('/p/fx-landing')).text();
  const frame = html.indexOf('data-ld-frame');
  const call = html.indexOf('window.__ldStartPreview&&window.__ldStartPreview()');
  const pre = html.indexOf('<pre');
  expect(frame).toBeGreaterThan(0);
  expect(call).toBeGreaterThan(frame);
  expect(pre).toBeGreaterThan(call);
  // 関数は #root より前に置く
  expect(html.indexOf('__ldStartPreview=')).toBeLessThan(html.indexOf('<div id="root">'));
});

const shapes = [
  { name: '幅1440', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  { name: '幅768', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false },
  { name: '幅390（スマホ）', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  { name: '幅390（指でない）', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, isMobile: false },
];

for (const shape of shapes) {
  test.describe(shape.name, () => {
    test.use({ viewport: shape.viewport, deviceScaleFactor: shape.deviceScaleFactor, hasTouch: shape.hasTouch, isMobile: shape.isMobile });

    for (const id of ['fx-landing', 'fx-button']) {
      test(`${id}：枠はコードの箱より先に読み始め、src は HTML が全部並んだ後の計算と同じ`, async ({ page }) => {
        const result = await openAndRead(page, id);
        expect(result.start).toHaveLength(1);
        const [start] = result.start;
        expect(start.preParsed).toBe(false);
        expect(start.scriptsAfter).toBe(0);
        // 読み始めた時の入れ物の幅が、全部並んだ後と同じ（だから #ldpr も同じ）
        expect(start.width).toBe(result.width);
        expect(result.src).toBe(start.src);
        const scale = result.size ? previewScale(result.size, result.width!, result.phone) : 1;
        expect(result.src).toBe(withFrameDpr(result.dataSrc, scale, result.dpr));
        // スマホでは Web の画面を Mobile の枠で読む
        if (id === 'fx-landing') expect(result.size).toBe(shape.isMobile ? 'mobile' : 'desktop');
      });
    }
  });
}

// 2. 「コピーされるコード」はページの JSON に入れず、コードの箱（<pre>）の文字から戻す。コピーは1文字も変わらない。
test.describe('コードは HTML に1回だけ', () => {
  const ids = readdirSync(join(import.meta.dirname, '../../../fixtures/works')).filter((id) => !id.startsWith('fx-bad-'));

  test('JSON にコードを入れない。コードの箱の文字（JS なしで読んだもの）が /p/:id/code と1文字も違わない', async ({ browser, request }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    for (const id of ids) {
      const html = await (await request.get(`/p/${id}`)).text();
      const code = await (await request.get(`/p/${id}/code`)).text();
      const json = JSON.parse(/<script type="application\/json" id="ld-page">([\s\S]*?)<\/script>/.exec(html)![1]) as { kind: string; snippet?: string };
      expect(json.kind, id).toBe('work');
      expect(json.snippet, id).toBeUndefined();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      expect(await page.locator('pre code[data-ld-code]').textContent(), id).toBe(code);
    }
    await context.close();
  });

  test('「コードをコピー」で書かれる文字が /p/:id/code と1文字も違わない（全部の見本の作品）', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // コピー数と閲覧数を動かさない（ほかのテストが数を見る）
    await page.route('**/api/count**', (route) => route.fulfill({ status: 204 }));
    for (const id of ids) {
      await page.goto(`/p/${id}`);
      await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
      await page.getByRole('button', { name: 'コードをコピー' }).click();
      await expect(page.getByRole('button', { name: 'コピーしました' })).toBeVisible();
      // Windows のクリップボードは改行を CRLF にする。行の中身は1文字も変わらない
      const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
      expect(clipboard, id).toBe(await (await page.request.get(`/p/${id}/code`)).text());
    }
  });

  test('HTML の文字で戻らないコード（CR、NUL、対になっていないサロゲート）は見分けて、JSON に残す', async ({ page }) => {
    const samples = ['a\nb', 'a\r\nb', 'a\rb', 'a\0b', 'é 日本 😀', 'x\ud800y', 'x\udc00y', '\ud83d', '<b>&amp;</b>"\'', '\u000c\u0001\u2028'];
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let body = '';
    // Worker と同じく、UTF-8 のバイトにして送る（対になっていないサロゲートは、ここで U+FFFD になる）
    await page.route('**/code-sample', (route) => route.fulfill({ body: Buffer.from(body, 'utf8'), contentType: 'text/html; charset=utf-8' }));
    for (const sample of samples) {
      body = `<!doctype html><pre><code>${escape(sample)}</code></pre>`;
      await page.goto('/code-sample');
      const read = await page.locator('code').textContent();
      expect(survivesHtmlText(sample), JSON.stringify(sample)).toBe(read === sample);
    }
  });
});
