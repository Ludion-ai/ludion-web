import { expect, test, type Page } from '@playwright/test';
import { ALL_TOKEN_NAMES, DPR_HASH_KEY, DPR_SCRIPT, FRAME_CSP, FRAME_RESPONSE_CSP, FRAME_SANDBOX, NEUTRAL_PALETTES, OPTIONAL_TOKEN_NAMES, STORAGE_SCRIPT, TOKEN_NAMES, authorBackground, buildCopySnippet, buildFrameHtml, stripExports } from '../src/index.ts';
import type { Creator, Work } from '../src/index.ts';

const ID = 'toggle-aurora';
const CSS = `[data-ld-part="${ID}"] {
  --_bg: var(--ld-bg, #0b0b0c);
  --_surface: var(--ld-surface, #161618);
  --_fg: var(--ld-fg, #f4f4f5);
  --_muted: var(--ld-muted, #a1a1aa);
  --_accent: #ff6a3d;
  --_radius: var(--ld-radius, 10px);
  --_font: var(--ld-font, system-ui, sans-serif);
  --_space: var(--ld-space, 8px);
  --_shadow: var(--ld-shadow, none);
  --_motion: var(--ld-motion, 200ms);
  background: var(--_bg);
  color: var(--_fg);
}
[data-ld-part="${ID}"] .knob {
  background: var(--_accent);
  border-radius: var(--_radius);
}`;
const HTML = `<div data-ld-part="${ID}"><button class="knob" type="button">Toggle</button></div>`;
const JS = `export function mount(root) {
  const knob = root.querySelector('.knob');
  const onClick = () => root.toggleAttribute('data-on');
  knob.addEventListener('click', onClick);
  return () => knob.removeEventListener('click', onClick);
}`;

const work: Work = {
  meta: {
    id: ID,
    title: 'Aurora Toggle',
    type: 'component',
    platform: null,
    category: 'Components',
    subtype: 'Toggle',
    tags: ['minimal'],
    creator: 'creator',
    license: 'MIT',
    made_with: 'ai-assisted',
    version: '1',
    published_at: '2026-11-09',
    pin_order: null,
  },
  html: HTML,
  css: CSS,
  js: JS,
};
const creator: Creator = { handle: 'creator', name: 'Creator', kind: 'person', x_url: null, site_url: null };

/** 作品の枠と同じく、ふつうのオリジンの1枚のページとして開く。 */
async function open(page: Page, html: string) {
  await page.route('http://render.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://render.test/');
}

/** 根（Shadow DOM の中の [data-ld-part]）の計算された値。 */
function rootStyle(page: Page, prop: string) {
  return page.evaluate((p) => {
    const root = document.getElementById('ld-host')!.shadowRoot!.querySelector('[data-ld-part]')!;
    return getComputedStyle(root).getPropertyValue(p).trim();
  }, prop);
}

test.describe('見えている細かさ（PREVIEW-DPR）：# の ldpr で devicePixelRatio を置き換える', () => {
  // iPhone と同じ DPR 3
  test.use({ deviceScaleFactor: 3 });
  // 作品の JS が mount の時に読む devicePixelRatio を、根の属性に書く
  const probe: Work = { ...work, js: `export function mount(root) { root.setAttribute('data-dpr', String(window.devicePixelRatio)); return () => {}; }` };

  test('最初のスクリプトが置き換える。作品の JS より先（前にあるのは storage の代わりだけ。FRAME001）', () => {
    const html = buildFrameHtml(probe, { palette: 'author' });
    expect(html.indexOf('<script')).toBe(html.indexOf(`<script>${STORAGE_SCRIPT}</script>`));
    expect(html.indexOf(`<script>${DPR_SCRIPT}`)).toBe(html.indexOf('</script>') + '</script>'.length + 1);
    expect(html.indexOf(DPR_SCRIPT)).toBeLessThan(html.indexOf('<script type="module">'));
    expect(DPR_SCRIPT).toContain(`${DPR_HASH_KEY}=`);
  });

  const cases: [hash: string, expected: string][] = [
    ['#ldpr=0.82', '0.82'],
    ['#ldpr=1', '1'],
    ['#x=1&ldpr=0.5', '0.5'],
    // 上限は実際の DPR。読めない値、0 以下、# がないときは、そのまま
    ['#ldpr=3', '3'],
    ['#ldpr=5', '3'],
    ['#ldpr=0', '3'],
    ['#ldpr=-1', '3'],
    ['#ldpr=abc', '3'],
    ['#ldpr=0.5x', '3'],
    ['#xldpr=0.5', '3'],
    ['', '3'],
  ];
  for (const [hash, expected] of cases) {
    test(`${hash || '# なし'} → ${expected}`, async ({ page }) => {
      await page.route('http://render.test/**', (route) => route.fulfill({ contentType: 'text/html', body: buildFrameHtml(probe, { palette: 'author' }) }));
      await page.goto(`http://render.test/${hash}`);
      await expect(page.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
      await expect(page.locator('[data-ld-part]')).toHaveAttribute('data-dpr', expected);
      // 作品の JS が書き換えようとしても変わらない
      expect(await page.evaluate(() => {
        try {
          (window as { devicePixelRatio: number }).devicePixelRatio = 9;
        } catch {}
        return window.devicePixelRatio;
      })).toBe(hash === '' || expected === '3' ? 9 : Number(expected));
    });
  }
});

test.describe('buildFrameHtml', () => {
  test('明るい中立と暗い中立のトークンが、ホストから Shadow DOM の中に効く', async ({ page }) => {
    for (const palette of ['light', 'dark'] as const) {
      await open(page, buildFrameHtml(work, { palette, width: 1280 }));
      const values = NEUTRAL_PALETTES[palette];
      // ホストに10個すべてが設定されている
      const host = await page.evaluate(
        (names) => names.map((n) => document.getElementById('ld-host')!.style.getPropertyValue(`--ld-${n}`)),
        [...TOKEN_NAMES],
      );
      expect(host).toEqual(TOKEN_NAMES.map((n) => values[n]));
      // 根の内部変数が配色の値を受ける
      expect(await rootStyle(page, '--_bg')).toBe(values.bg);
      expect(await rootStyle(page, '--_radius')).toBe(values.radius);
      // 本体の見た目にまで届く
      const bg = await page.evaluate(() => {
        const root = document.getElementById('ld-host')!.shadowRoot!.querySelector('[data-ld-part]')!;
        return getComputedStyle(root).backgroundColor;
      });
      expect(bg).toBe(palette === 'light' ? 'rgb(255, 255, 255)' : 'rgb(10, 10, 10)');
      // 固定したトークン（--_accent）は配色の値を受けない
      expect(await rootStyle(page, '--_accent')).toBe('#ff6a3d');
      // ページの地は作品の --_bg
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(bg);
    }
  });

  test('任意の --ld-danger も枠に流す。中立の値は、地の上で 4.5:1 を超える（T006）', async ({ page }) => {
    expect(OPTIONAL_TOKEN_NAMES).toEqual(['danger']);
    expect(TOKEN_NAMES).toHaveLength(10);
    expect(ALL_TOKEN_NAMES).toHaveLength(11);
    expect(NEUTRAL_PALETTES.light.danger).toBe('#c81e1e');
    expect(NEUTRAL_PALETTES.dark.danger).toBe('#f87171');

    const luminance = (hex: string) => {
      const channel = (at: number) => {
        const c = parseInt(hex.slice(at, at + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    for (const palette of ['light', 'dark'] as const) {
      const { danger, bg, surface } = NEUTRAL_PALETTES[palette];
      expect(contrast(danger, palette === 'light' ? '#ffffff' : '#0a0a0a')).toBe(palette === 'light' ? 5.74 : 7.16);
      expect(contrast(danger, surface)).toBe(palette === 'light' ? 5.22 : 6.48);
      expect(contrast(danger, bg)).toBeGreaterThan(4.5);

      await open(page, buildFrameHtml({ ...work, css: `${CSS}\n[data-ld-part="${ID}"] { --_danger: var(--ld-danger, #123456); }` }, { palette }));
      expect(await page.evaluate(() => document.getElementById('ld-host')!.style.getPropertyValue('--ld-danger'))).toBe(danger);
      expect(await rootStyle(page, '--_danger')).toBe(danger);
    }
    // 作者の配色では --ld-danger を流さず、作者の値が出る
    await open(page, buildFrameHtml({ ...work, css: `${CSS}\n[data-ld-part="${ID}"] { --_danger: var(--ld-danger, #123456); }` }, { palette: 'author' }));
    expect(await rootStyle(page, '--_danger')).toBe('#123456');
  });

  test('作者の配色では --ld-* を設定せず、作者の既定値が出る', async ({ page }) => {
    const html = buildFrameHtml(work, { palette: 'author' });
    expect(html).not.toContain('--ld-bg:');
    await open(page, html);
    expect(await rootStyle(page, '--_bg')).toBe('#0b0b0c');
    expect(await rootStyle(page, '--_radius')).toBe('10px');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(11, 11, 12)');
  });

  test('CSP の meta が head の先頭近くに入り、外への通信を止める', async ({ page }) => {
    const html = buildFrameHtml(work, { palette: 'author' });
    const meta = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;
    expect(FRAME_CSP).toBe(
      "form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:",
    );
    expect(FRAME_SANDBOX).toBe('allow-scripts allow-forms'); // allow-same-origin は付けない
    expect(html).toContain(meta);
    // スタイルとスクリプトより前にある
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<style'));
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<script'));

    // 作品から外へ出ようとしても、届かない
    const leaky: Work = {
      ...work,
      html: `<div data-ld-part="${ID}"><img alt="" src="https://example.com/x.png"><button class="knob">x</button></div>`,
      js: `export function mount(root) { fetch('https://example.com/beacon').catch(() => {}); return () => {}; }`,
    };
    const outside: string[] = [];
    await page.route('https://example.com/**', (route) => {
      outside.push(route.request().url());
      return route.abort();
    });
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy/.test(m.text())) violations.push(m.text());
    });
    await open(page, buildFrameHtml(leaky, { palette: 'author' }));
    await expect(page.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
    await expect.poll(() => violations.length).toBeGreaterThanOrEqual(2);
    expect(outside).toEqual([]);
  });

  test('part.js の mount が Shadow DOM の根を受け取り、片付けの関数を返す', async ({ page }) => {
    await open(page, buildFrameHtml(work, { palette: 'author' }));
    await expect(page.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'ok');
    await page.locator('.knob').click();
    expect(await page.evaluate(() => document.getElementById('ld-host')!.shadowRoot!.querySelector('[data-ld-part]')!.hasAttribute('data-on'))).toBe(true);
    // グローバルに mount ができていない
    expect(await page.evaluate(() => 'mount' in window)).toBe(false);
  });

  test('part.js がなければ data-ld-mount="none"', async ({ page }) => {
    await open(page, buildFrameHtml({ ...work, js: null }, { palette: 'author' }));
    await expect(page.locator('#ld-host')).toHaveAttribute('data-ld-mount', 'none');
  });

  test('part.css の中の </style> で枠が壊れない', () => {
    const html = buildFrameHtml({ ...work, css: `${CSS}\n/* </style><script>alert(1)</script> */` }, { palette: 'author' });
    expect(html).not.toContain('</style><script>alert(1)');
  });
});

test.describe('buildCopySnippet', () => {
  test('1行目がクレジット行と1文字も違わない', () => {
    const snippet = buildCopySnippet(work, creator);
    const lines = snippet.split('\n');
    expect(lines[0]).toBe('<!-- UI by @creator — ludion.ai/p/toggle-aurora (MIT) -->');
    // <style> と <script> の1行目にもクレジット行
    expect(lines[lines.indexOf('<style>') + 1]).toBe('/* UI by @creator — ludion.ai/p/toggle-aurora (MIT) */');
    expect(lines[lines.indexOf('<script type="module">') + 1]).toBe('/* UI by @creator — ludion.ai/p/toggle-aurora (MIT) */');
    expect(snippet).not.toMatch(/^\s*export\b/m);
    expect(snippet).toContain(`mount(document.querySelector('[data-ld-part="toggle-aurora"]'));`);
  });

  test('リミックスは2行目が元の作品のクレジット行。<style> と <script> の頭も同じ2行（T033 B4）', () => {
    const snippet = buildCopySnippet(work, creator, { handle: 'Lattice_Node', id: 'toggle-daylight' });
    const lines = snippet.split('\n');
    const credit = 'UI by @creator — ludion.ai/p/toggle-aurora (MIT)';
    const remix = 'Remix of UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT)';
    expect(lines.slice(0, 2)).toEqual([`<!-- ${credit} -->`, `<!-- ${remix} -->`]);
    const style = lines.indexOf('<style>');
    expect(lines.slice(style + 1, style + 3)).toEqual([`/* ${credit} */`, `/* ${remix} */`]);
    const script = lines.indexOf('<script type="module">');
    expect(lines.slice(script + 1, script + 3)).toEqual([`/* ${credit} */`, `/* ${remix} */`]);
    // 元がなければ今までと同じ
    expect(buildCopySnippet(work, creator, null)).toBe(buildCopySnippet(work, creator));
  });

  test('part.js がなければ <script> を入れない', () => {
    const snippet = buildCopySnippet({ ...work, js: null }, creator);
    expect(snippet.split('\n')[0]).toBe('<!-- UI by @creator — ludion.ai/p/toggle-aurora (MIT) -->');
    expect(snippet).not.toContain('<script');
  });

  test('作者が meta.json と違えば作らない', () => {
    expect(() => buildCopySnippet(work, { ...creator, handle: 'someone' })).toThrow();
  });

  test('handle は大文字と小文字を区別せずに比べ、クレジット行には作者に保存した綴りのまま入れる（T003）', () => {
    const lattice: Creator = { handle: 'Lattice_Node', name: 'Lattice', kind: 'person', x_url: 'https://x.com/Lattice_Node', site_url: null };
    const snippet = buildCopySnippet({ ...work, meta: { ...work.meta, creator: 'lattice_node' } }, lattice);
    expect(snippet.split('\n')[0]).toBe('<!-- UI by @Lattice_Node — ludion.ai/p/toggle-aurora (MIT) -->');
  });

  test('ふつうのページに貼ると、そのまま動く', async ({ page }) => {
    await open(page, `<!doctype html><html lang="en"><body>${buildCopySnippet(work, creator)}</body></html>`);
    await page.locator('.knob').click();
    await expect(page.locator(`[data-ld-part="${ID}"]`)).toHaveAttribute('data-on', '');
    await expect(page.locator('.knob')).toHaveCSS('background-color', 'rgb(255, 106, 61)');
  });
});

test('応答の頭の CSP は sandbox から始まり、枠の CSP をそのまま含む（T007）', () => {
  expect(FRAME_RESPONSE_CSP).toBe(
    "sandbox allow-scripts allow-forms; form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; frame-ancestors 'self'",
  );
});

test.describe('authorBackground（T007）', () => {
  const root = (bg: string) => `[data-ld-part="x"] { --_fg: var(--ld-fg, #111); --_bg: ${bg}; }\n[data-ld-part="x"] .a { background: var(--_bg); }`;

  for (const [declared, expected] of [
    ['var(--ld-bg, #0b0b0c)', '#0b0b0c'],
    ['#ffffff', '#ffffff'],
    ['var(--ld-bg, rgb(11 11 12 / 0.9))', 'rgb(11 11 12 / 0.9)'],
    ['var(--ld-bg, color-mix(in oklab, #fff 90%, black))', 'color-mix(in oklab, #fff 90%, black)'],
    ['var(--ld-bg,white)', 'white'],
  ]) {
    test(`${declared} → ${expected}`, () => {
      expect(authorBackground(root(declared))).toBe(expected);
    });
  }

  for (const declared of ['url(https://evil.example/x.png)', 'var(--ld-bg, url(https://evil.example))', 'var(--other)', '#fff"><script>', 'red;background:url(x)']) {
    test(`親のページに入れない：${declared}`, () => {
      const value = authorBackground(root(declared));
      if (declared.startsWith('red;')) expect(value).toBe('red'); // ; の後ろは別の宣言で、値には入らない
      else expect(value).toBeNull();
    });
  }

  test('コメントの中の宣言は読まない。宣言がなければ null', () => {
    expect(authorBackground('/* --_bg: #000; */ [data-ld-part="x"] { --_bg: #fff; }')).toBe('#fff');
    expect(authorBackground('[data-ld-part="x"] { color: var(--_bg); }')).toBeNull();
  });
});

test('stripExports は export を外すだけで、ほかは変えない', () => {
  expect(stripExports('export function mount(root) {}\nexport const x = 1;\nexport { y };\nconst exported = 2;')).toBe(
    'function mount(root) {}\nconst x = 1;\n\nconst exported = 2;',
  );
  expect(stripExports('export default function mount() {}')).toBe('function mount() {}');
  expect(stripExports('export async function mount() {}')).toBe('async function mount() {}');
});
