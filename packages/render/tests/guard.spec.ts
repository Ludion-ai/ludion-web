// 枠の守り（FRAME002、src/guard.ts）：WebRTC の名前を使えなくし、入れ子の枠を作れなくする。
// サイトと同じ枠（sandbox の iframe、応答の頭の FRAME_RESPONSE_CSP）で、Chromium、WebKit、Firefox を見る。
// 部品の枠（buildFrameHtml）と文書の枠（buildDocumentFrameHtml）の両方。ふつうの DOM の操作は今と同じに動くことも見る。
import { expect, test, type Frame, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { FRAME_RESPONSE_CSP, FRAME_SANDBOX, NESTED_FRAME_TAGS, WEBRTC_NAME, buildDocumentFrameHtml, buildFrameHtml } from '../src/index.ts';
import type { Work } from '../src/index.ts';

const ID = 'guard-sample';

const part = (js: string): Work => ({
  meta: {
    id: ID,
    title: 'Guard Sample',
    type: 'component',
    platform: null,
    category: 'Components',
    subtype: 'Button',
    tags: [],
    creator: 'creator',
    license: 'MIT',
    made_with: 'human',
    version: '1',
    published_at: '2026-11-13',
    pin_order: null,
  },
  html: `<div data-ld-part="${ID}"><button type="button">0</button></div>`,
  css: `[data-ld-part="${ID}"]{--_bg:var(--ld-bg,#ffffff)}`,
  js,
});

const PLAIN_PART = part('export function mount(root) { return () => {}; }');

const PLAIN_DOC = '<!doctype html><html><head><meta charset="utf-8"><title>Doc</title></head><body><p id="p">doc</p></body></html>';

/** サイトと同じ形の枠に、その HTML を入れて開き、枠の Frame を返す */
async function openFrame(page: Page, body: string, errors: string[]): Promise<Frame> {
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('http://render.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/frame.html') {
      return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': FRAME_RESPONSE_CSP }, body });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe sandbox="${FRAME_SANDBOX}" src="/frame.html"></iframe>` });
  });
  await page.goto('http://render.test/');
  const frame = page.frames().find((f) => f.url().endsWith('/frame.html'))!;
  await frame.waitForLoadState('load');
  return frame;
}

type BrowserName = 'chromium' | 'webkit' | 'firefox';

/** 1つの試しを、そのブラウザの新しいページで動かす（このパッケージの設定は Chromium だけなので、ここで起こす） */
async function inBrowser(playwright: PlaywrightWorkerArgs['playwright'], name: BrowserName, run: (page: Page) => Promise<void>) {
  const browser = await playwright[name].launch();
  try {
    await run(await browser.newPage());
  } finally {
    await browser.close();
  }
}

/** 枠の中で、RTC で始まる名前と、その typeof */
function rtcNames(frame: Frame) {
  return frame.evaluate((source) => {
    const re = new RegExp(source);
    const w = window as unknown as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(window).filter((n) => re.test(n));
    const named = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate'];
    return {
      left: names.filter((n) => typeof w[n] !== 'undefined'),
      named: named.map((n) => typeof w[n]),
      frames: window.length,
    };
  }, WEBRTC_NAME.source);
}

/** 枠の中で、入れ子の枠を作る道を1つずつ試し、投げた誤りの名前（投げなければ 'none'）を返す */
function nestedAttempts(frame: Frame) {
  return frame.evaluate((tags) => {
    const out: Record<string, string> = {};
    const attempt = (name: string, run: () => unknown) => {
      try {
        run();
        out[name] = 'none';
      } catch (error) {
        out[name] = error instanceof DOMException ? error.name : String(error);
      }
    };
    for (const tag of tags) attempt(`createElement(${tag})`, () => document.createElement(tag));
    attempt('createElement(IFRAME)', () => document.createElement('IFRAME'));
    attempt('createElementNS', () => document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe'));
    const host = document.createElement('div');
    document.body.append(host);
    attempt('innerHTML', () => { host.innerHTML = '<iframe></iframe>'; });
    attempt('insertAdjacentHTML', () => host.insertAdjacentHTML('beforeend', '<iframe></iframe>'));
    attempt('createContextualFragment', () => document.createRange().createContextualFragment('<iframe></iframe>'));
    attempt('DOMParser', () => new DOMParser().parseFromString('<iframe></iframe>', 'text/html'));
    const closed = document.createElement('div').attachShadow({ mode: 'closed' });
    attempt('closed shadow innerHTML', () => { closed.innerHTML = '<iframe></iframe>'; });
    host.remove();
    return { out, frames: window.length, found: document.querySelectorAll(tags.join(',')).length };
  }, [...NESTED_FRAME_TAGS]);
}

/** ふつうの DOM の操作（appendChild、innerHTML、insertAdjacentHTML、append、attachShadow）。結果の文字を返す */
const NORMAL_DOM = `
  const box = document.createElement('div');
  const a = document.createElement('span'); a.textContent = 'a'; box.appendChild(a);
  const b = document.createElement('div'); b.innerHTML = '<b>b</b><i>i</i>'; box.appendChild(b);
  b.insertAdjacentHTML('beforeend', '<u>u</u>');
  box.append('t', document.createElement('em'));
  const shadow = box.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
  shadow.innerHTML = '<p>inside</p>';
  return [box.children.length, b.innerHTML, box.textContent, shadow.querySelector('p').textContent].join('|');
`;
const NORMAL_DOM_RESULT = '4|<b>b</b><i>i</i><u>u</u>|abiut|inside';

for (const browserName of ['chromium', 'webkit', 'firefox'] as const) {
  test.describe(browserName, () => {
    for (const [kind, body] of [['部品の枠', buildFrameHtml(PLAIN_PART, { palette: 'author' })], ['文書の枠', buildDocumentFrameHtml(PLAIN_DOC)]] as const) {
      test(`${kind}：RTC で始まる名前は undefined。window.length は 0`, ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
        const errors: string[] = [];
        const frame = await openFrame(page, body, errors);
        expect(await rtcNames(frame)).toEqual({ left: [], named: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined'], frames: 0 });
        expect(errors).toEqual([]);
      }));

      test(`${kind}：入れ子の枠を作ろうとすると NotSupportedError。window.length は 0`, ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
        const errors: string[] = [];
        const frame = await openFrame(page, body, errors);
        const result = await nestedAttempts(frame);
        for (const [name, error] of Object.entries(result.out)) expect(error, name).toBe('NotSupportedError');
        expect(Object.keys(result.out).length).toBe(NESTED_FRAME_TAGS.length + 7);
        expect([result.frames, result.found]).toEqual([0, 0]);
        expect(errors).toEqual([]);
      }));
    }

    test('文書に書かれた <iframe> は、次のスクリプトより前に外れている', ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
      const errors: string[] = [];
      const doc = '<!doctype html><html><head><meta charset="utf-8"></head><body><p>x</p><iframe></iframe><script>window.__seen=[window.length, document.querySelectorAll("iframe").length]</script></body></html>';
      const frame = await openFrame(page, buildDocumentFrameHtml(doc), errors);
      expect(await frame.evaluate(() => (window as unknown as { __seen: number[] }).__seen)).toEqual([0, 0]);
      expect(await frame.evaluate(() => [window.length, document.querySelectorAll('iframe').length])).toEqual([0, 0]);
      expect(errors).toEqual([]);
    }));

    test('部品の枠：ふつうの DOM の操作は今と同じに動き、mount は ok', ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
      const errors: string[] = [];
      const work = part(`function run() {${NORMAL_DOM}}\nexport function mount(root) { root.setAttribute('data-result', run()); return () => {}; }`);
      const frame = await openFrame(page, buildFrameHtml(work, { palette: 'author' }), errors);
      await expect(frame.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
      expect(await frame.evaluate(() => document.getElementById('ld-host')!.shadowRoot!.querySelector('[data-ld-part]')!.getAttribute('data-result'))).toBe(NORMAL_DOM_RESULT);
      expect(errors).toEqual([]);
    }));

    test('文書の枠：ふつうの DOM の操作は今と同じに動く（読み込みの途中と、読み終えた後）', ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
      const errors: string[] = [];
      const doc = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.__during=(()=>{${NORMAL_DOM}})()</script></body></html>`;
      const frame = await openFrame(page, buildDocumentFrameHtml(doc), errors);
      expect(await frame.evaluate(() => (window as unknown as { __during: string }).__during)).toBe(NORMAL_DOM_RESULT);
      expect(await frame.evaluate(`(() => {${NORMAL_DOM}})()`)).toBe(NORMAL_DOM_RESULT);
      expect(errors).toEqual([]);
    }));
  });
}
