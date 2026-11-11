import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copy } from '../src/copy';
import { openHome } from './helpers';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const spec = read('../../../SPEC.md');
const css = read('../src/index.css');

/** SPEC.md の「2. サイトの色と形」の表から、`名前` と `値` の組を集める。 */
function specValues(): Map<string, string> {
  const start = spec.indexOf('## 2. サイトの色と形');
  const end = spec.indexOf('## 3. 画面の骨組み');
  expect(start, 'SPEC.md に 2 がある').toBeGreaterThan(-1);
  const values = new Map<string, string>();
  for (const [, name, value] of spec.slice(start, end).matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) {
    values.set(name, value.toLowerCase());
  }
  return values;
}

/** index.css の @theme から、同じ形の組を作る。 */
function cssValues(): Map<string, string> {
  const theme = /@theme \{([\s\S]*?)\n\}/.exec(css)![1];
  const raw = new Map<string, string>();
  for (const [, name, value] of theme.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)) {
    if (value.trim() !== 'initial') raw.set(name, value.trim());
  }

  const values = new Map<string, string>();
  for (const [name, value] of raw) {
    if (name.endsWith('--line-height') || name === 'font-sans') continue;
    const key = name.replace(/^color-/, '');
    const lineHeight = raw.get(`${name}--line-height`);
    values.set(key, (lineHeight ? `${value} / ${lineHeight}` : value).toLowerCase());
  }
  return values;
}

test.describe('値の正本は SPEC.md の1つだけ', () => {
  test('SPEC.md の 2 の値と index.css の @theme が一致する', () => {
    const fromSpec = specValues();
    const fromCss = cssValues();
    expect(fromSpec.size).toBeGreaterThan(20);
    expect(Object.fromEntries([...fromCss].sort())).toEqual(Object.fromEntries([...fromSpec].sort()));
  });

  test('SPEC.md の 2 のダークの列と index.css の :root[data-theme=dark] が一致する（T035「2」）', () => {
    const start = spec.indexOf('## 2. サイトの色と形');
    const end = spec.indexOf('### 角丸');
    const fromSpec = new Map<string, string>();
    for (const [, name, , dark] of spec.slice(start, end).matchAll(/^\|\s*`(site-[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) {
      fromSpec.set(name, dark.toLowerCase());
    }
    const block = /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/.exec(css)![1];
    const fromCss = new Map<string, string>();
    for (const [, name, value] of block.matchAll(/^\s*--color-([a-z0-9-]+):\s*([^;]+);/gm)) fromCss.set(name, value.trim().toLowerCase());
    // 新しい名前は作らない。ライトの色の名前の全部に、ダークの値がある
    const lightNames = [...specValues().keys()].filter((name) => name.startsWith('site-')).sort();
    expect([...fromSpec.keys()].sort()).toEqual(lightNames);
    expect(Object.fromEntries([...fromCss].sort())).toEqual(Object.fromEntries([...fromSpec].sort()));
  });

  test('index.html のアドレスバーの色（theme-color）が、SPEC.md の site-bg のライトとダークと一致する（T035「2」）', () => {
    const html = read('../index.html');
    const row = /^\|\s*`site-bg`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/m.exec(spec)!;
    const [light, dark] = [row[1].toLowerCase(), row[2].toLowerCase()];
    expect(html).toContain(`<meta name="theme-color" content="${light}" />`);
    expect(html).toContain(`theme === 'dark' ? '${dark}' : '${light}'`);
  });

  test('書体も一致する', () => {
    expect(spec).toContain('`Inter Variable, "Hiragino Sans", "Noto Sans JP", "BIZ UDPGothic", "Yu Gothic UI", system-ui, sans-serif`');
    expect(css).toContain("--font-sans: 'Inter Variable', 'Hiragino Sans', 'Noto Sans JP', 'BIZ UDPGothic', 'Yu Gothic UI', system-ui, sans-serif;");
  });

  test('冒頭に 11/8 の決定があり、正解の見た目を指している', () => {
    expect(spec.slice(0, spec.indexOf('## 0.'))).toContain('docs/reference/pinterest-mobile.png');
  });

  test('index.css に「SPEC と違う」という注記が残っていない', () => {
    expect(css).not.toMatch(/より小さい|SPEC の数字|画像と食い違/);
  });

  test('コンポーネントの中に色と 0.5px の値を直接書いていない', () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    })(srcDir);

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} に端数の px がある`).not.toMatch(/\d\.\d+px/);
      if (file.endsWith('.tsx')) {
        expect(text, `${file} に色のリテラルがある`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        expect(text, `${file} に文字の大きさを直接書いている（SPEC.md 2 の表に足して @theme に写す）`).not.toMatch(/\btext-\[\d/);
      }
    }
  });

  test('作品のページの文字（13px、18px、24px）も SPEC.md の表にある', () => {
    const fromSpec = specValues();
    expect(fromSpec.get('text-meta')).toBe('13px / 20px');
    expect(fromSpec.get('text-subhead')).toBe('18px / 26px');
    expect(fromSpec.get('text-title')).toBe('24px / 34px');
  });
});

/** 固有名詞など、英字のままでよい語（SPEC.md 9）。長いものから消す。 */
const LATIN_ALLOWED = [
  // 作品を置く画面（docs/tasks/T021.md 段階 B）。コードの名前とファイルの形式
  'export function mount(root)',
  // 1つの箱とリミックスの指示文（docs/tasks/T033.md）。HTML の要素の名前
  'script type="module"',
  'function mount(root)',
  'mount(...)',
  'script src',
  '@import',
  'doctype',
  'script',
  'style',
  'link',
  'root',
  'data-ld-part',
  'ludion.ai/p/',
  'part.html',
  'part.css',
  'part.js',
  'ChatGPT',
  'Claude Code',
  'Claude',
  'HTML',
  'JPEG',
  'WebP',
  'CSS',
  'PNG',
  'JS',
  'AI',
  'KB',
  'MB',
  'px',
  'Ludion Studio',
  'WebGL',
  '3D',
  'Google LLC',
  'https://x.com/',
  'https://',
  'ld_github_flow',
  'ld_google_flow',
  'Safari',
  'ld_signup',
  'ld_passkey_flow',
  'credential ID',
  'transports',
  'sub',
  'ld_lang',
  'View in English',
  'English',
  'LudionRemix',
  'Remixed by',
  'Remix',
  'ChatGPT',
  'HTML',
  'html',
  'ld_session',
  'LUDION_KEY',
  'Lattice_Node',
  'Lattice',
  'Cloudflare',
  'Ludion',
  'GitHub',
  'Google',
  'iPhone',
  'cookie',
  'GA4',
  'URL',
  'Web',
  '_ga',
  'EC',
  'UI',
  'MIT',
  'IP',
  'UA',
  'ID',
  'Ctrl',
  'K',
  'X',
];

function latinLeft(text: string): boolean {
  const rest = LATIN_ALLOWED.reduce((left, word) => left.replace(new RegExp(`(?<![A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'g'), ''), text);
  return /[A-Za-z]/.test(rest);
}

/** copy.ts の値を全部集める。引数のある文は、英字のない見本を入れて作る。 */
function allCopy(value: unknown, path = 'copy'): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (typeof value === 'function') {
    const fill = Array<unknown>(value.length).fill('見本');
    return allCopy(value(...fill), path);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => allCopy(child, `${path}.${key}`));
  }
  return [];
}

test.describe('サイトの文言は日本語（SPEC 9）', () => {
  test('調べる側の確かめ：英語の文は引っかかり、固有名詞は通る', () => {
    expect(latinLeft('Log in')).toBe(true);
    expect(latinLeft('見られた数 views')).toBe(true);
    expect(latinLeft('Web · Ludion Studio のレーベル')).toBe(false);
    expect(latinLeft('Website')).toBe(true);
  });

  test('copy.ts の値に英語が残っていない', () => {
    // count は数を書く関数で、文ではない。AI に渡す指示文はコードの決まりなので、コードの語をそのまま書く
    const entries = allCopy(copy).filter(({ path }) => path !== 'copy.count' && path !== 'copy.post.ai.prompt');
    expect(entries.length).toBeGreaterThan(50);
    expect(entries.filter(({ text }) => latinLeft(text))).toEqual([]);
  });

  test('作品の種類は、置いてある作品と見本のすべてに日本語がある', () => {
    const worksDir = new URL('../../../works/', import.meta.url);
    const subtypes = readdirSync(worksDir)
      // works/ にはファイル（LICENSE.md）もある。名前の後に / を付けて stat すると、Linux ではファイルで ENOTDIR になる
      .filter((id) => statSync(new URL(id, worksDir)).isDirectory())
      .map((id) => JSON.parse(readFileSync(new URL(`${id}/meta.json`, worksDir), 'utf8')).subtype as string);
    const seed = JSON.parse(read('../../../seed/works.json'));
    subtypes.push(...(Array.isArray(seed) ? seed : seed.works).map((work: { subtype: string }) => work.subtype));
    expect([...new Set(subtypes)].filter((subtype) => !copy.subtypes[subtype])).toEqual([]);
  });

  test('太さ 500 を使っていない（書体によって細くも太くも出る。SPEC 2）', () => {
    const files = (readdirSync(new URL('../src/', import.meta.url), { recursive: true }) as string[]).filter((name) => /\.tsx?$/.test(name));
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((name) => read(`../src/${name.replaceAll('\\', '/')}`).includes('font-medium'))).toEqual([]);
  });

  test('作り方の文がなく、レーベルと X の文は決めたとおり', () => {
    // 作品を置く画面だけは作り方を聞く（データとして持つだけで、公開には出さない。CLAUDE.md 原則9）
    // リミックスの指示文の形の説明は、貼る先の話で、作品の作り方の文ではない（docs/tasks/T031.md「2」の文のまま）
    // AI の鍵は、AI が置くための鍵の話で、作品の作り方の文ではない（docs/tasks/T037.md「1」。鍵の節と、退会で消えるものの1行）
    const asked = (path: string) => path.startsWith('copy.post.') || path.startsWith('copy.work.remix.modes.') || path.startsWith('copy.account.aiKeys.');
    const aboutKeys = (text: string) => text.replace(/AI の鍵/g, '');
    expect(allCopy(copy).filter(({ path, text }) => !asked(path) && /(?<![A-Za-z])AI(?![A-Za-z])|手で作った/.test(aboutKeys(text)))).toEqual([]);
    expect(copy.creator.x).toBe('X を新しいタブで開く');
    expect(copy.work.label).toContain('Ludion Studio のレーベル');
    expect(copy.creator.labelNote).toBe('Ludion Studio のレーベル（運営が制作）');
  });

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`幅${width}：サイトの枠の文字と読み上げの文字に英語が残っていない`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openHome(page);
      // カードの中は作品のデータなので除く
      const texts = await page.evaluate(() => {
        const found: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const element = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as Element);
          if (element.closest('article, script, style, noscript')) continue;
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent?.trim()) found.push(node.textContent.trim());
          } else {
            for (const name of ['aria-label', 'placeholder', 'title']) {
              const value = (node as Element).getAttribute(name);
              if (value) found.push(value);
            }
          }
        }
        return found;
      });
      expect(texts.length).toBeGreaterThan(10);
      expect(texts.filter(latinLeft)).toEqual([]);
    });
  }

  test('<html lang="ja">', async ({ request }) => {
    expect(await (await request.get('/')).text()).toMatch(/<html lang="ja">/);
  });
});

test.describe('文字は 12px 未満にしない', () => {
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`幅${width}：画面のすべての文字`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openHome(page);
      const sizes = await page.evaluate(() => {
        const found = new Map<number, string>();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (!parent || !walker.currentNode.textContent?.trim()) continue;
          if (['SCRIPT', 'STYLE'].includes(parent.tagName)) continue;
          found.set(parseFloat(getComputedStyle(parent).fontSize), walker.currentNode.textContent.trim());
        }
        return [...found.entries()];
      });
      expect(sizes.length).toBeGreaterThan(0);
      for (const [size, sample] of sizes) {
        expect(size, `「${sample}」`).toBeGreaterThanOrEqual(12);
        expect(Number.isInteger(size), `「${sample}」は ${size}px`).toBe(true);
      }
    });
  }
});
