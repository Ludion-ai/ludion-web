// 「動きを見る」の書き換え（docs/tasks/FIX-motion.md「1」「3」）。
// 文字列の比べだけでなく、端末を「減らす」にしたブラウザで、実際の答えを見る。
import { expect, test, type Page } from '@playwright/test';
import { ALLOW_MOTION_SCRIPT, allowMotionCss, allowMotionQuery, buildFrameHtml, motionLeftovers } from '../src/index.ts';
import type { Work } from '../src/index.ts';

const ID = 'motion-sample';
const ROOT = `[data-ld-part="${ID}"]`;

const sample = (css: string, js: string | null = null): Work => ({
  meta: {
    id: ID,
    title: 'Motion Sample',
    type: 'component',
    platform: null,
    category: 'Components',
    subtype: 'Toggle',
    tags: ['motion'],
    creator: 'creator',
    license: 'MIT',
    made_with: 'human',
    version: '1',
    published_at: '2026-11-09',
    pin_order: null,
  },
  html: `<div data-ld-part="${ID}"></div>`,
  css,
  js,
});

async function open(page: Page, html: string) {
  await page.route('http://render.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://render.test/');
}

const rootColor = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.getElementById('ld-host')!.shadowRoot!.querySelector('[data-ld-part]')!).color);

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

/** 書き方ごとに、端末が「減らす」で動きを許した枠で、中が当たるか（「減らさない」端末の答えと同じか）。 */
const QUERIES: { query: string; matches: boolean }[] = [
  { query: '(prefers-reduced-motion: reduce)', matches: false },
  { query: '(prefers-reduced-motion:reduce)', matches: false },
  { query: '( PREFERS-REDUCED-MOTION : REDUCE )', matches: false },
  { query: '(prefers-reduced-motion)', matches: false },
  { query: '(prefers-reduced-motion: no-preference)', matches: true },
  { query: 'not (prefers-reduced-motion: reduce)', matches: true },
  { query: 'not (prefers-reduced-motion: no-preference)', matches: false },
  { query: 'not (prefers-reduced-motion)', matches: true },
  { query: 'screen and (prefers-reduced-motion: reduce)', matches: false },
  { query: 'screen and (prefers-reduced-motion: no-preference)', matches: true },
  { query: 'not screen and (prefers-reduced-motion: reduce)', matches: true },
  { query: '(prefers-reduced-motion: reduce), print', matches: false },
  { query: '(prefers-reduced-motion: reduce), screen', matches: true },
  { query: '(prefers-reduced-motion: reduce) or (min-width: 1px)', matches: true },
  { query: '(prefers-reduced-motion: reduce) or (max-width: 1px)', matches: false },
  { query: '(prefers-reduced-motion: no-preference) and (min-width: 1px)', matches: true },
  { query: '(prefers-reduced-motion: reduce) and (min-width: 1px)', matches: false },
];

test.describe('端末が「減らす」のとき、許した枠の答え', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  for (const { query, matches } of QUERIES) {
    test(`CSS @media ${query} → ${matches ? '当たる' : '当たらない'}`, async ({ page }) => {
      const css = `${ROOT} { color: ${BLUE}; }\n@media ${query} { ${ROOT} { color: ${RED}; } }`;
      await open(page, buildFrameHtml(sample(css), { palette: 'author', motion: true }));
      expect(await rootColor(page)).toBe(matches ? RED : BLUE);
    });

    test(`JS matchMedia ${query} → ${matches}`, async ({ page }) => {
      await open(page, buildFrameHtml(sample(`${ROOT} {}`), { palette: 'author', motion: true }));
      const answer = await page.evaluate((q) => {
        const list = window.matchMedia(q);
        return { matches: list.matches, media: list.media };
      }, query);
      expect(answer).toEqual({ matches, media: query });
    });
  }

  test('許していない枠は、端末の設定のまま（CSS も JS も書き換えない）', async ({ page }) => {
    const css = `${ROOT} { color: ${BLUE}; }\n@media (prefers-reduced-motion: reduce) { ${ROOT} { color: ${RED}; } }`;
    const html = buildFrameHtml(sample(css), { palette: 'author' });
    expect(html).toContain(css);
    expect(html).not.toContain(ALLOW_MOTION_SCRIPT);
    await open(page, html);
    expect(await rootColor(page)).toBe(RED);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  });

  test('作品の JS の mount の中から聞いても「減らさない」', async ({ page }) => {
    const js = `export function mount(root) {
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      root.dataset.reduce = String(query.matches);
      return () => {};
    }`;
    await open(page, buildFrameHtml(sample(`${ROOT} {}`, js), { palette: 'author', motion: true }));
    await expect(page.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
    await expect(page.locator(`${ROOT}`)).toHaveAttribute('data-reduce', 'false');
  });

  test('聞き方を壊さない：addEventListener、removeEventListener、addListener、removeListener、onchange、別の式', async ({ page }) => {
    await open(page, buildFrameHtml(sample(`${ROOT} {}`), { palette: 'author', motion: true }));
    const result = await page.evaluate(() => {
      const list = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handler = () => {};
      list.addEventListener('change', handler);
      list.removeEventListener('change', handler);
      list.addListener(handler);
      list.removeListener(handler);
      list.onchange = handler;
      return {
        isList: list instanceof MediaQueryList,
        noMotionWord: list.media,
        scheme: window.matchMedia('(prefers-color-scheme: dark)').media,
        wide: window.matchMedia('(min-width: 1px)').matches,
        name: window.matchMedia.name,
        noArgument: (() => {
          try {
            (window.matchMedia as unknown as () => void)();
            return 'no-error';
          } catch (error) {
            return (error as Error).name;
          }
        })(),
      };
    });
    expect(result).toEqual({
      isList: true,
      noMotionWord: '(prefers-reduced-motion: reduce)',
      scheme: '(prefers-color-scheme: dark)',
      wide: true,
      name: 'matchMedia',
      noArgument: 'TypeError',
    });
  });

  test('幅と組み合わせた式は、幅が変われば change が届く', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await open(page, buildFrameHtml(sample(`${ROOT} {}`), { palette: 'author', motion: true }));
    await page.evaluate(() => {
      const list = window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 500px)');
      const state = window as unknown as { changes: boolean[]; first: boolean };
      state.first = list.matches;
      state.changes = [];
      list.addEventListener('change', (event) => state.changes.push(event.matches));
    });
    expect(await page.evaluate(() => (window as unknown as { first: boolean }).first)).toBe(false);
    await page.setViewportSize({ width: 400, height: 600 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { changes: boolean[] }).changes)).toEqual([true]);
  });

  test('外への通信や CSP を増やさない：枠の CSP の meta はそのまま', async () => {
    const off = buildFrameHtml(sample(`${ROOT} {}`), { palette: 'author' });
    const on = buildFrameHtml(sample(`${ROOT} {}`), { palette: 'author', motion: true });
    const csp = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)![1];
    expect(csp(on)).toBe(csp(off));
    // 違いは、差し替えの script の1行だけ（書き換えるものがない CSS のとき）
    expect(on.replace(`<script>${ALLOW_MOTION_SCRIPT}</script>\n`, '')).toBe(off);
  });
});

test.describe('allowMotionCss は @media の条件だけを変える', () => {
  test('コメントと文字列の中、ほかの宣言は1文字も変えない', () => {
    const untouched = [
      `/* @media (prefers-reduced-motion: reduce) { a { color: red; } } */`,
      `${ROOT}::after { content: "@media (prefers-reduced-motion: reduce) {"; }`,
      `${ROOT} { background: url(data:image/svg+xml,it's/*fine); }`,
      `${ROOT} { --note: '(prefers-reduced-motion: reduce)'; }`,
      `@media (min-width: 600px) { ${ROOT} { color: red; } }`,
      `@mediax (prefers-reduced-motion: reduce) { }`,
    ];
    for (const css of untouched) expect(allowMotionCss(css)).toBe(css);
  });

  test('url() の中の引用符やコメントの印の後ろにある @media も書き換える', () => {
    const before = `${ROOT} { background: url(data:image/svg+xml,it's/*fine); }\n`;
    expect(allowMotionCss(`${before}@media (prefers-reduced-motion: reduce) { a { b: c; } }`)).toBe(`${before}@media (min-width:99999999px) { a { b: c; } }`);
  });

  test('空白なし、大文字、条件の中のコメント、入れ子の @media', () => {
    expect(allowMotionCss('@media(prefers-reduced-motion:reduce){a{b:c}}')).toBe('@media(min-width:99999999px){a{b:c}}');
    expect(allowMotionCss('@MEDIA (prefers-reduced-motion: reduce) {}')).toBe('@MEDIA (min-width:99999999px) {}');
    expect(allowMotionCss('@media (prefers-reduced-motion /* x */ : reduce) {}')).toBe('@media (min-width:99999999px) {}');
    expect(allowMotionCss('.a { @media (prefers-reduced-motion: reduce) { color: red; } }')).toBe('.a { @media (min-width:99999999px) { color: red; } }');
    expect(allowMotionCss('@media (prefers-reduced-motion: reduce) { @media (prefers-reduced-motion: no-preference) { } }')).toBe('@media (min-width:99999999px) { @media (min-width:0) { } }');
  });

  test('allowMotionQuery は、知らない値を変えない', () => {
    expect(allowMotionQuery('(prefers-reduced-motion: maybe)')).toBe('(prefers-reduced-motion: maybe)');
  });

  test('</style> を含む CSS でも、書き換えた後に枠が壊れない', () => {
    const html = buildFrameHtml(sample(`${ROOT} {}\n/* </style><script>alert(1)</script> */\n@media (prefers-reduced-motion: reduce) {}`), { palette: 'author', motion: true });
    expect(html).not.toContain('</style><script>alert(1)');
  });
});

test.describe('扱えない書き方は motionLeftovers で分かる', () => {
  const html = `<div data-ld-part="${ID}"></div>`;

  for (const [label, css] of [
    ['@import の条件', `@import url("https://fonts.googleapis.com/css2?family=Inter") (prefers-reduced-motion: reduce);`],
    ['@custom-media', `@custom-media --still (prefers-reduced-motion: reduce);`],
    ['知らない値', `@media (prefers-reduced-motion: maybe) { a { b: c; } }`],
    ['エスケープした名前', `@media (prefers\\-reduced-motion: reduce) { a { b: c; } }`],
  ]) {
    test(`CSS：${label}`, () => {
      expect(motionLeftovers({ css, html })).toHaveLength(1);
    });
  }

  test('HTML：media 属性', () => {
    expect(motionLeftovers({ css: '', html: `<picture><source media="(prefers-reduced-motion: reduce)" srcset=""></picture>` })).toHaveLength(1);
  });

  test('コメントと文字列の中は数えない', () => {
    expect(motionLeftovers({ css: `/* (prefers-reduced-motion: reduce) */ a::after { content: "(prefers-reduced-motion: reduce)"; }`, html })).toEqual([]);
  });
  // 今ある作品と見本の全部を見るテストは packages/ld/tests/motion.spec.ts（ファイルを読むので Node の型が要る）
});
