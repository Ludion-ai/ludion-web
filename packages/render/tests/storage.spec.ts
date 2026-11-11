// 枠の中のメモリだけの localStorage、sessionStorage、document.cookie（FRAME001、src/storage.ts）。
// サイトと同じ枠（sandbox の iframe、応答の頭の FRAME_RESPONSE_CSP）で、Chromium、WebKit、Firefox を見る。
// 本物が使えるページ（sandbox のない、ふつうのページ）では、差し替えないことも見る。
import { expect, test, type Frame, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { FRAME_RESPONSE_CSP, FRAME_SANDBOX, MEMORY_STORAGE_LIMIT, STORAGE_SCRIPT, buildFrameHtml } from '../src/index.ts';
import type { Work } from '../src/index.ts';

const ID = 'storage-sample';

const sample: Work = {
  meta: {
    id: ID,
    title: 'Storage Sample',
    type: 'component',
    platform: null,
    category: 'Components',
    subtype: 'Button',
    tags: [],
    creator: 'creator',
    license: 'MIT',
    made_with: 'human',
    version: '1',
    published_at: '2026-11-11',
    pin_order: null,
  },
  html: `<div data-ld-part="${ID}"><button type="button">0</button></div>`,
  css: `[data-ld-part="${ID}"]{--_bg:var(--ld-bg,#ffffff)}`,
  js: 'export function mount(root) { return () => {}; }',
};

/** サイトと同じ形の枠を開き、枠の Frame を返す。親のページには ?n= を付けて、読み直しを数える */
async function openFrame(page: Page, errors: string[]): Promise<Frame> {
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('http://render.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/frame.html') {
      return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': FRAME_RESPONSE_CSP }, body: buildFrameHtml(sample, { palette: 'author' }) });
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

for (const browserName of ['chromium', 'webkit', 'firefox'] as const) {
  test.describe(browserName, () => {

    test('枠の中：本物は投げるので、メモリだけの代わりになる。Storage の形を全部持つ', ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
      const errors: string[] = [];
      const frame = await openFrame(page, errors);
      const result = await frame.evaluate(() => {
        const s = localStorage;
        const out: Record<string, unknown> = {};
        out.isStorage = s instanceof Storage;
        out.tag = Object.prototype.toString.call(s);
        out.empty = [s.length, s.getItem('n'), s.key(0)];
        s.setItem('n', 1 as unknown as string);
        out.number = [s.getItem('n'), typeof s.getItem('n'), s.length];
        (s as unknown as Record<string, unknown>).foo = { a: 1 };
        out.dot = [s.getItem('foo'), (s as unknown as Record<string, unknown>).foo, s['n' as keyof Storage]];
        out.inOp = ['foo' in s, 'nope' in s, 'getItem' in s];
        out.keys = Object.keys(s).sort();
        out.json = JSON.parse(JSON.stringify(s));
        out.keyAt = [s.key(0), s.key(1), s.key(2), s.key(-1)];
        // 鍵の名前が Storage の口と同じでも、口は口のまま（本物と同じ）
        s.setItem('getItem', 'x');
        out.method = [typeof s.getItem, s.getItem('getItem')];
        delete (s as unknown as Record<string, unknown>).foo;
        s.removeItem('getItem');
        out.afterDelete = [s.getItem('foo'), s.length];
        let typeError = '';
        try {
          (s.setItem as (k: string) => void)('only-one');
        } catch (e) {
          typeError = (e as Error).name;
        }
        out.typeError = typeError;
        s.clear();
        out.cleared = s.length;
        // localStorage と sessionStorage は別
        sessionStorage.setItem('n', 'session');
        out.separate = [localStorage.getItem('n'), sessionStorage.getItem('n')];
        // 本物ではないこと（本物なら、ここまで来る前に投げている）
        out.own = typeof Object.getOwnPropertyDescriptor(window, 'localStorage')?.get;
        return out;
      });
      expect(result).toEqual({
        isStorage: true,
        tag: '[object Storage]',
        empty: [0, null, null],
        number: ['1', 'string', 1],
        dot: ['[object Object]', '[object Object]', '1'],
        inOp: [true, false, true],
        keys: ['foo', 'n'],
        json: { n: '1', foo: '[object Object]' },
        keyAt: ['n', 'foo', null, null],
        method: ['function', 'x'],
        afterDelete: [null, 1],
        typeError: 'TypeError',
        cleared: 0,
        separate: [null, 'session'],
        own: 'function',
      });
      expect(errors).toEqual([]);
    }));

    test('枠の中：上限は 5MB（文字数）。超えると QuotaExceededError で、前の値は残る', ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
      const errors: string[] = [];
      const frame = await openFrame(page, errors);
      const result = await frame.evaluate((limit) => {
        const big = 'a'.repeat(limit - 1);
        localStorage.setItem('k', big); // 鍵 1 文字 + 値 = ちょうど上限
        const atLimit = localStorage.getItem('k')!.length;
        let name = '';
        let code = 0;
        try {
          localStorage.setItem('k2', 'b');
        } catch (e) {
          name = (e as DOMException).name;
          code = (e as DOMException).code;
        }
        // 同じ鍵を同じ長さで書き直すのは通る
        localStorage.setItem('k', 'c'.repeat(limit - 1));
        const sessionWorks = (() => {
          sessionStorage.setItem('s', 'x'); // sessionStorage の上限は別
          return sessionStorage.getItem('s');
        })();
        return { atLimit, name, code, kept: localStorage.getItem('k')![0], k2: localStorage.getItem('k2'), sessionWorks };
      }, MEMORY_STORAGE_LIMIT);
      expect(result).toEqual({ atLimit: MEMORY_STORAGE_LIMIT - 1, name: 'QuotaExceededError', code: 22, kept: 'c', k2: null, sessionWorks: 'x' });
      expect(errors).toEqual([]);
    }));

    test('枠の中：document.cookie もメモリだけ。読み直すと、storage も cookie も消える', ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
      const errors: string[] = [];
      let frame = await openFrame(page, errors);
      const cookie = await frame.evaluate(() => {
        const seen: string[] = [document.cookie];
        document.cookie = 'a=1; path=/';
        document.cookie = 'b=2; SameSite=Lax';
        seen.push(document.cookie);
        document.cookie = 'a=3';
        seen.push(document.cookie);
        document.cookie = 'a=; max-age=0';
        seen.push(document.cookie);
        document.cookie = 'b=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        seen.push(document.cookie);
        localStorage.setItem('kept', 'no');
        return seen;
      });
      expect(cookie).toEqual(['', 'a=1; b=2', 'a=3; b=2', 'b=2', '']);
      await page.reload();
      frame = page.frames().find((f) => f.url().endsWith('/frame.html'))!;
      await frame.waitForLoadState('load');
      expect(await frame.evaluate(() => [localStorage.length, localStorage.getItem('kept'), document.cookie])).toEqual([0, null, '']);
      expect(errors).toEqual([]);
    }));

    test('本物が使えるページでは差し替えない（本物の localStorage と cookie のまま、読み直しても残る）', ({ playwright }) => inBrowser(playwright, browserName, async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.route('http://render.test/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: `<!doctype html><script>${STORAGE_SCRIPT}</script><p>plain page</p>` }),
      );
      await page.goto('http://render.test/plain');
      const first = await page.evaluate(() => {
        localStorage.setItem('real', 'yes');
        sessionStorage.setItem('real', 'yes');
        document.cookie = 'real=yes; path=/';
        const getter = Object.getOwnPropertyDescriptor(window, 'localStorage')?.get;
        return {
          native: String(getter).includes('[native code]'),
          sessionNative: String(Object.getOwnPropertyDescriptor(window, 'sessionStorage')?.get).includes('[native code]'),
          cookieOwn: Object.getOwnPropertyDescriptor(document, 'cookie') === undefined,
        };
      });
      expect(first).toEqual({ native: true, sessionNative: true, cookieOwn: true });
      await page.reload();
      expect(await page.evaluate(() => [localStorage.getItem('real'), sessionStorage.getItem('real'), document.cookie.includes('real=yes')])).toEqual(['yes', 'yes', true]);
      expect(await page.context().cookies('http://render.test/')).toEqual([expect.objectContaining({ name: 'real', value: 'yes' })]);
      expect(errors).toEqual([]);
    }));
  });
}
