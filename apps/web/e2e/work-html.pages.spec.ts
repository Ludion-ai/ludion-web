// PERF002：作品のページの HTML を軽くし、作品の枠を早く読み始める。見た目と作品の最初のコマは変えない。
// 1. 枠の src は、枠の入れ物の直後の台本が入れる（HTML の最後の beforeApp を待たない）。
import { expect, test, type Page } from '@playwright/test';
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
