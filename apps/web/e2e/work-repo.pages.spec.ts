// 作品のページをリポジトリの形に（WS003）：頭、タブ、「この作品について」、言語の帯。
// playwright.config.ts の pages（Chromium）と work-repo-*（WebKit、Firefox）で流す。サーバーは pages（見本の作品と、自分だけの作品の見本が入っている）。
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PRIVATE_OWNER, privateFixtureId } from '../scripts/private-fixture.mjs';

const TOGGLE = 'fx-toggle';
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/works/${TOGGLE}/${name}`, import.meta.url), 'utf8').split('\n');

async function openWork(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

const about = (page: Page) => page.locator('[data-work-about]');
const panel = (page: Page, id: string) => page.locator(`[data-work-panel="${id}"]`);

test.describe('頭', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@作者 / 題、状態の札、版、種類。右の列に今のボタンと、数の行', async ({ page }) => {
    await openWork(page, TOGGLE);
    const head = page.locator('[data-work-head]');
    await expect(head.getByRole('link', { name: '@fixture', exact: true })).toHaveAttribute('href', '/c/fixture');
    await expect(head.getByRole('heading', { level: 1 })).toHaveText('Quiet Switches');
    await expect(head.locator('[data-work-state]:visible')).toHaveText('公開');
    await expect(head.locator('[data-work-state]:visible')).toHaveAttribute('data-work-state', 'public');
    await expect(head.getByText('版 1', { exact: true }).locator('visible=true')).toHaveCount(1);
    await expect(head.getByText('部品 · トグル', { exact: true })).toBeVisible();
    // 右の列のボタン：リミックス、いいね、保存、共有（今あるボタン。1組だけ）。持ち主でない人に「新しい版を置く」と「設定」はない
    const actions = page.locator('[data-work-side] [data-work-actions]');
    await expect(actions.getByRole('button')).toHaveText(['リミックス', /^\d+$/, '保存', '共有']);
    await expect(page.locator('[data-work-actions]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: '新しい版を置く' })).toHaveCount(0);
    // 数の行：見られた数、コピーされた数、いいね
    const counts = page.locator('[data-work-counts]');
    await expect(counts).toContainText(/見られた数 \d+/);
    await expect(counts).toContainText(/コピーされた数 \d+/);
    await expect(counts).toContainText(/いいね \d+/);
  });
});

test.describe('タブ', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('コード｜版｜系譜。初めはコード。替えても、動く作品の枠は作り直さない。コードの箱は HTML に残る', async ({ page }) => {
    let frameLoads = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith(`/frame/${TOGGLE}/`)) frameLoads += 1;
    });
    await openWork(page, TOGGLE);
    const tabs = page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab');
    await expect(tabs).toHaveText([/^コード$/, /^版\s*1$/, /^系譜$/]);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'code')).toBeVisible();
    await expect(panel(page, 'versions')).toBeHidden();

    await page.locator('iframe[data-ld-frame]').evaluate((frame) => frame.setAttribute('data-same', ''));
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'code')).toBeHidden();
    await expect(panel(page, 'versions')).toBeVisible();
    await expect(panel(page, 'versions')).toContainText('版 1');
    await expect(panel(page, 'versions')).toContainText('今の版');
    // 動く作品は、どのタブでも出たまま。同じ iframe のままで、読み直していない
    await expect(page.locator('iframe[data-ld-frame][data-same]')).toBeVisible();
    // コードの箱（コピーされる文字の元）は、隠れていても HTML にある
    await expect(page.locator('[data-ld-code]')).toHaveCount(1);

    await tabs.nth(2).click();
    await expect(panel(page, 'lineage')).toBeVisible();
    await expect(panel(page, 'lineage')).toContainText('まだリミックスはありません');
    expect(frameLoads).toBe(1);
  });

  test('キー：矢印で隣のタブ、Home と End で端。選んだタブだけが Tab の順に入る', async ({ page }) => {
    await openWork(page, TOGGLE);
    const tabs = page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab');
    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(2)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'code')).toBeVisible();
  });

  test('Worker の HTML：初めのタブはコードで、コードの箱とコピーのボタンが入っている。持ち主だけの物は入っていない', async ({ request }) => {
    const html = await (await request.get(`/p/${TOGGLE}`)).text();
    expect(html).toContain('data-ld-code');
    expect(html).toContain('data-work-about');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?コード/);
    expect(html).not.toContain('新しい版を置く');
    expect(html).not.toContain('data-work-panel="settings"');
  });
});

test.describe('この作品について', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('地図から：描き方、操作、外から読む物、大きさ。キー操作と読み上げ（役目、状態、名前、フォーカスの枠）。言語の帯', async ({ page }) => {
    await openWork(page, TOGGLE);
    const box = about(page);
    await expect(box.getByRole('heading', { name: 'この作品について' })).toBeVisible();
    await expect(box.locator('[data-about-item="dom-css"]')).toHaveText('DOM + CSS');
    await expect(box.locator('[data-about-item="pointer"]')).toHaveText('ポインター');
    await expect(box).toContainText('外から読む物');
    await expect(box).toContainText('3 ファイル');
    await expect(box.getByRole('heading', { name: /キー操作と読み上げ/ })).toBeVisible();
    await expect(box.locator('[data-about-item="aria-role:switch"]')).toHaveText('switch');
    await expect(box.locator('[data-about-item="aria-state:aria-checked"]')).toHaveText('aria-checked');
    await expect(box.locator('[data-about-item="aria-name:aria-label"]')).toHaveText('aria-label');
    await expect(box.locator('[data-about-item="focus-visible::focus-visible"]')).toHaveText(':focus-visible');
    // 出すのは、コードから読んだ事実だけ。検査（ld check）の結果は出さない
    await expect(box).not.toContainText('ld check');
    // 動き：CSS のトランジション（part.css）
    await expect(box.locator('[data-about-item="css-transition"]')).toHaveText('CSS のトランジション');
    // 言語の帯：割合の合計は 100%（丸めの分だけずれる）
    const percents = (await box.locator('[data-about-languages] li').allTextContents()).map((text) => Number(/([\d.]+)%/.exec(text)![1]));
    expect(percents.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(percents.reduce((sum, value) => sum + value, 0) - 100)).toBeLessThan(0.5);
    await expect(box.locator('[data-about-languages]')).toContainText('CSS');
  });

  test('印を押すと、その行が出る。行の番号と文字は、本当のファイルのその行。もう一度押すか「閉じる」で閉じる', async ({ page }) => {
    await openWork(page, TOGGLE);
    const box = about(page);
    const peek = box.locator('[data-about-peek]');
    await expect(peek).toBeHidden();

    // 役目：part.html の role="switch" の最初の行
    const html = fixture('part.html');
    const roleLine = html.findIndex((line) => line.includes('role="switch"')) + 1;
    const role = box.locator('[data-about-item="aria-role:switch"]');
    await role.click();
    await expect(role).toHaveAttribute('aria-expanded', 'true');
    await expect(peek).toBeVisible();
    await expect(peek).toContainText(`part.html の ${roleLine} 行目`);
    await expect(peek).toContainText('全部で 3 か所');
    const current = peek.locator('[aria-current="true"]');
    await expect(current).toHaveAttribute('data-line', String(roleLine));
    expect((await current.textContent())!.replace(/^\d+/, '').trimEnd()).toBe(html[roleLine - 1].trimEnd());

    // フォーカスの枠：part.css の :focus-visible の行へ替わる
    const css = fixture('part.css');
    const focusLine = css.findIndex((line) => line.includes(':focus-visible')) + 1;
    await box.locator('[data-about-item="focus-visible::focus-visible"]').click();
    await expect(role).toHaveAttribute('aria-expanded', 'false');
    await expect(peek).toContainText(`part.css の ${focusLine} 行目`);
    await expect(peek.locator('[aria-current="true"]')).toContainText(css[focusLine - 1].trim());
    // 前後の行も、ファイルの行の番号で出る
    await expect(peek.locator(`[data-line="${focusLine - 1}"]`)).toHaveCount(1);
    await expect(peek.locator(`[data-line="${focusLine + 1}"]`)).toHaveCount(1);

    await peek.getByRole('button', { name: '閉じる' }).click();
    await expect(peek).toBeHidden();
  });

  test('動きと保存の行：requestAnimationFrame と localStorage。保存には「枠の中では読み直すと消える」を添える。押すとその行', async ({ page }) => {
    await openWork(page, 'fx-motion');
    const motion = about(page).locator('[data-about-item="raf"]');
    await expect(motion).toHaveText('requestAnimationFrame');
    await motion.click();
    await expect(about(page).locator('[data-about-peek] [aria-current="true"]')).toContainText('requestAnimationFrame');

    await openWork(page, 'fx-counter');
    const box = about(page);
    const storage = box.locator('[data-about-item="localstorage"]');
    await expect(storage).toHaveText('localStorage');
    await expect(box).toContainText('Ludion の枠の中では読み直すと消える');
    await storage.click();
    await expect(box.locator('[data-about-peek]')).toContainText(/part\.js の \d+ 行目/);
    await expect(box.locator('[data-about-peek] [aria-current="true"]')).toContainText('localStorage');
    // 保存を使わない作品には、行も、添える文も出さない
    await openWork(page, TOGGLE);
    await expect(about(page)).not.toContainText('読み直すと消える');
  });

  test('文書の作品：index.html の行を指す', async ({ page }) => {
    await openWork(page, 'mal-doc');
    const box = about(page);
    await expect(box).toContainText('1 ファイル');
    const first = box.locator('[data-about-item]').first();
    await first.click();
    await expect(box.locator('[data-about-peek]')).toContainText(/index\.html の \d+ 行目/);
  });
});

test.describe('持ち主', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('自分だけの作品：状態の札は「自分だけ」。「新しい版を置く」と「設定」のタブがあり、画像を付けるは設定の中', async ({ page, context, baseURL }) => {
    const id = privateFixtureId('mal-doc');
    await context.addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: baseURL! }]);
    await openWork(page, id);
    const head = page.locator('[data-work-head]');
    await expect(head.locator('[data-work-state]:visible')).toHaveText('自分だけ');
    await expect(head.getByRole('link', { name: '新しい版を置く' })).toHaveAttribute('href', `/new?work=${id}`);
    await expect(page.locator('[data-private-notice]')).toContainText('自分だけの作品です');
    // いいね、保存、共有、リミックスは出さない（docs/tasks/T036.md）
    await expect(page.locator('[data-work-actions]')).toHaveCount(0);

    const tabs = page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab');
    await expect(tabs).toHaveText([/^コード$/, /^版\s*1$/, /^系譜$/, /^設定$/]);
    await expect(panel(page, 'settings')).toBeHidden();
    await tabs.nth(3).click();
    await expect(panel(page, 'settings')).toBeVisible();
    await expect(panel(page, 'settings').getByRole('link', { name: '自分の作品へ' })).toHaveAttribute('href', '/account/works');
    await expect(panel(page, 'settings').getByRole('button', { name: /に画像を付ける$/ })).toBeVisible();
  });

  test('ほかの人には、自分だけの作品は 404 のまま', async ({ request }) => {
    expect((await request.get(`/p/${privateFixtureId('mal-doc')}`, { maxRedirects: 0 })).status()).toBe(404);
  });
});

// HTML の順と見た目の順は、どの幅でも同じ：頭 → 動く作品 → ボタン → 数の行 → タブ → タブの中身。
// キーの Tab と読み上げ（HTML の順）が、見た目の順で進む。CSS の order で見た目だけを動かさない。
const ORDER = ['[data-work-head]', '[data-work-stage]', '[data-work-actions]', '[data-work-counts]', '[role="tablist"]', '[data-work-panel="code"]'];

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * b が a より「後」に見えるか。2列のとき（boundary：左の列の右の端）は、左の列が先。
 * 同じ列の中では、下にあるか、同じ行で右にある。
 */
function after(a: Rect, b: Rect, boundary: number | null): boolean {
  const column = (rect: Rect) => (boundary !== null && rect.left >= boundary ? 1 : 0);
  if (column(a) !== column(b)) return column(b) > column(a);
  if (b.top >= a.bottom - 1) return true;
  const sameRow = b.top < a.bottom && a.top < b.bottom;
  return sameRow && b.left >= a.right - 1;
}

for (const { label, viewport, columns } of [
  { label: '幅1440（2列）', viewport: { width: 1440, height: 900 }, columns: 2 },
  { label: '幅1024（2列）', viewport: { width: 1024, height: 900 }, columns: 2 },
  { label: '幅1023（1列）', viewport: { width: 1023, height: 900 }, columns: 1 },
  { label: '幅390（1列）', viewport: { width: 390, height: 844 }, columns: 1 },
]) {
  test.describe(`順：${label}`, () => {
    test.use({ viewport });

    test('HTML の順と見た目の順が同じ。CSS の order を使っていない。フォーカスできる物も、HTML の順が見た目の順', async ({ page }) => {
      await openWork(page, 'fx-landing');
      const measured = await page.evaluate((selectors) => {
        const rect = (el: Element) => {
          const { left, top, right, bottom } = el.getBoundingClientRect();
          return { left, top: top + window.scrollY, right, bottom: bottom + window.scrollY };
        };
        const parts = selectors.map((selector) => document.querySelector(selector)!);
        const scope = [document.querySelector('[data-work-head]')!, document.querySelector('[data-work-stage]')!, document.querySelector('[data-work-side]')!];
        const visible = (el: Element) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const focusable = scope.flatMap((root) => [...root.querySelectorAll<HTMLElement>('a[href], button, iframe, [tabindex]')]).filter((el) => visible(el) && el.tabIndex >= 0);
        const ordered = scope.flatMap((root) => [root, ...root.querySelectorAll('*')]).filter((el) => getComputedStyle(el).order !== '0');
        return {
          // HTML の順：前の物が、次の物より前にある
          domOrder: parts.slice(1).map((el, index) => Boolean(parts[index].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)),
          rects: parts.map(rect),
          stage: rect(document.querySelector('[data-work-stage]')!),
          focusable: focusable.map((el) => ({ name: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 20) || el.tagName, rect: rect(el) })),
          ordered: ordered.length,
        };
      }, ORDER);

      expect(measured.domOrder).toEqual([true, true, true, true, true]);
      expect(measured.ordered).toBe(0);
      const boundary = columns === 2 ? measured.stage.right : null;
      // 頭 → 動く作品 → ボタン → 数の行 → タブ → タブの中身
      for (let index = 1; index < measured.rects.length; index++) {
        expect(after(measured.rects[index - 1], measured.rects[index], boundary), `${ORDER[index - 1]} → ${ORDER[index]}`).toBe(true);
      }
      // 2列：動く作品は左、ボタンから下は右の列。1列：全部が同じ左の端
      if (columns === 2) for (const rect of measured.rects.slice(2)) expect(rect.left).toBeGreaterThan(measured.stage.right);
      else for (const rect of measured.rects.slice(2)) expect(Math.abs(rect.left - measured.stage.left)).toBeLessThan(2);
      // フォーカスできる物（リンク、ボタン、枠、タブ、コードの箱）：HTML の順に並べると、見た目も前から後ろへ進む
      expect(measured.focusable.length).toBeGreaterThan(10);
      for (let index = 1; index < measured.focusable.length; index++) {
        const [a, b] = [measured.focusable[index - 1], measured.focusable[index]];
        expect(after(a.rect, b.rect, boundary), `${a.name} → ${b.name}`).toBe(true);
      }
    });

    test('Tab のキーで進むと、見た目の順（ボタン → 数の行 → タブ → この作品について）で進む', async ({ page, browserName }) => {
      await openWork(page, TOGGLE);
      // 「リミックス」から始める（その前は作品の枠の中で、枠の中の Tab の数は作品による）
      const first = page.getByRole('button', { name: 'リミックス', exact: true });
      await first.focus();
      const seen: { name: string; rect: Rect }[] = [];
      for (let press = 0; press < 12; press++) {
        const now = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const { left, top, right, bottom } = el.getBoundingClientRect();
          // Firefox は、横に送れる入れ物（スマホの印の行）にも Tab で止まる。中の印の順を見るので、入れ物は数えない
          const container = el.tagName === 'DL';
          return { container, name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24) || el.tagName, rect: { left, top: top + window.scrollY, right, bottom: bottom + window.scrollY } };
        });
        if (!now) break;
        if (!now.container) seen.push(now);
        // 「この作品について」の最初の印まで来たら終わり
        if (seen.length > 1 && (await page.evaluate(() => document.activeElement?.hasAttribute('data-about-item') ?? false))) break;
        await page.keyboard.press('Tab');
      }
      const names = seen.map((item) => item.name);
      // リミックス → いいね → 保存 → 共有 → 作者の名前 → 選んだタブ（コード）→ コードをコピー → 最初の印
      expect(names.slice(0, 4)).toEqual(['リミックス', expect.stringMatching(/^いいね/), '保存', '共有']);
      // WebKit は、端末によって Tab でリンクを飛ばす（Safari の初めの設定と同じ。Windows の WebKit は飛ばし、Linux の WebKit は止まる）。
      // 止まるなら、共有とタブの間。ボタン、タブ、印の順は、どのブラウザでも同じ
      if (browserName !== 'webkit') expect(names).toContain('Fixture');
      if (names.includes('Fixture')) expect(names.indexOf('Fixture')).toBe(4);
      expect(names.filter((name) => name !== 'Fixture')).toEqual(['リミックス', expect.stringMatching(/^いいね/), '保存', '共有', 'コード', 'コードをコピー', 'DOM + CSS']);
      expect(names.at(-1)).toBe('DOM + CSS');
      expect(names.indexOf('DOM + CSS')).toBe(names.indexOf('コード') + 2);
      const stage = (await page.locator('[data-work-stage]').boundingBox())!;
      const boundary = columns === 2 ? stage.x + stage.width : null;
      for (let index = 1; index < seen.length; index++) {
        expect(after(seen[index - 1].rect, seen[index].rect, boundary), `${seen[index - 1].name} → ${seen[index].name}`).toBe(true);
      }
    });
  });
}

test.describe('コードをコピーの場所', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
  ]) {
    test(`幅${viewport.width}×高さ${viewport.height}：タブのすぐ下（「この作品について」の上）で、最初の画面に入る。ライセンスの行はそのすぐ下`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openWork(page, 'fx-landing');
      const button = (await page.getByRole('button', { name: 'コードをコピー', exact: true }).boundingBox())!;
      const tabs = (await page.getByRole('tablist', { name: '作品の中身' }).boundingBox())!;
      const license = (await page.getByText('MIT · コードの1行目に作者の名前が残ります', { exact: true }).boundingBox())!;
      const box = (await about(page).boundingBox())!;
      const code = (await page.locator('pre:has([data-ld-code])').boundingBox())!;
      expect(button.y).toBeCloseTo(tabs.y + tabs.height + 16, 0);
      expect(button.y + button.height).toBeLessThanOrEqual(viewport.height);
      expect(license.y).toBeCloseTo(button.y + button.height + 8, 0);
      expect(box.y).toBeGreaterThan(license.y + license.height);
      // コードの箱は、今までどおり「この作品について」の下
      expect(code.y).toBeGreaterThan(box.y + box.height);
    });
  }
});

test.describe('狭い列', () => {
  /** ページの横のはみ出しと、文字が切れているタブの数 */
  const fit = (page: Page) =>
    page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: [...document.querySelectorAll('[role="tab"]')].filter((tab) => tab.scrollWidth > tab.clientWidth).length,
    }));

  for (const width of [320, 1024, 1280]) {
    test(`幅${width}：長い印（requestAnimationFrame）と英語のタブでも、ページは横にはみ出さず、タブの文字は切れない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/en/p/fx-motion', '/p/fx-motion']) {
        await page.goto(path);
        await page.getByRole('heading', { level: 1 }).waitFor();
        await expect(page.locator('[data-about-item="raf"]')).toBeVisible();
        expect(await fit(page), path).toEqual({ overflow: 0, clipped: 0 });
      }
    });
  }

  test('幅1024、持ち主（左のナビが開き、タブが4つ）、英語：同じ', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await context.addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: baseURL! }]);
    await page.goto(`/en/p/${privateFixtureId('mal-doc')}`);
    await expect(page.getByRole('tab')).toHaveCount(4);
    // 左のナビは、本人の答えの後に開く
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'open');
    // ナビが開く動きの間は、幅が落ち着くまで待つ（WebKit は、開いた直後に一度だけ横に広がって見える）
    await expect.poll(() => fit(page)).toEqual({ overflow: 0, clipped: 0 });
  });
});

// 持ち主の形（頭の右の「新しい版を置く」、設定のタブ、自分だけの知らせが足される）でも、同じ
for (const { label, viewport, columns } of [
  { label: '幅1440（2列）', viewport: { width: 1440, height: 900 }, columns: 2 },
  { label: '幅390（1列）', viewport: { width: 390, height: 844 }, columns: 1 },
]) {
  test.describe(`順（持ち主）：${label}`, () => {
    test.use({ viewport });

    test('自分だけの作品を持ち主が開いた形でも、フォーカスできる物は HTML の順が見た目の順。CSS の order を使っていない', async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: baseURL! }]);
      await openWork(page, privateFixtureId('mal-doc'));
      await expect(page.getByRole('tab', { name: '設定' })).toBeVisible();
      const measured = await page.evaluate(() => {
        const rect = (el: Element) => {
          const { left, top, right, bottom } = el.getBoundingClientRect();
          return { left, top: top + window.scrollY, right, bottom: bottom + window.scrollY };
        };
        const scope = [document.querySelector('[data-work-head]')!, document.querySelector('[data-work-stage]')!, document.querySelector('[data-work-side]')!];
        const visible = (el: Element) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const focusable = scope.flatMap((root) => [...root.querySelectorAll<HTMLElement>('a[href], button, iframe, [tabindex]')]).filter((el) => visible(el) && el.tabIndex >= 0);
        return {
          stage: rect(document.querySelector('[data-work-stage]')!),
          head: rect(document.querySelector('[data-work-head]')!),
          focusable: focusable.map((el) => ({ name: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 20) || el.tagName, rect: rect(el) })),
          ordered: scope.flatMap((root) => [root, ...root.querySelectorAll('*')]).filter((el) => getComputedStyle(el).order !== '0').length,
        };
      });
      expect(measured.ordered).toBe(0);
      const names = measured.focusable.map((item) => item.name);
      expect(names).toContain('新しい版を置く');
      expect(names).toContain('自分の作品へ');
      // 頭（@作者、新しい版を置く）は、動く作品と右の列より上。その下は、2列なら左の列が先
      const inHead = measured.focusable.filter((item) => item.rect.bottom <= measured.head.bottom + 1);
      const below = measured.focusable.filter((item) => item.rect.bottom > measured.head.bottom + 1);
      expect(measured.focusable.slice(0, inHead.length)).toEqual(inHead);
      const boundary = columns === 2 ? measured.stage.right : null;
      for (const list of [inHead, below]) {
        for (let index = 1; index < list.length; index++) {
          expect(after(list[index - 1].rect, list[index].rect, list === inHead ? null : boundary), `${list[index - 1].name} → ${list[index].name}`).toBe(true);
        }
      }
    });
  });
}

test.describe('スマホ（幅390）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('順は、頭 → 動く作品 → ボタン → 数 → タブ → この作品について。印は横に流し、ページは横にはみ出さない', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox は isMobile を持たない');
    await openWork(page, TOGGLE);
    const top = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
    const order = [
      await top('[data-work-head]'),
      await top('iframe[data-ld-frame]'),
      await top('[data-work-actions]'),
      await top('[data-work-counts]'),
      await top('[role="tablist"]'),
      await top('[data-work-about]'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // 種類の札は、頭ではなく数の行に出す（頭を2行に収める）
    await expect(page.locator('[data-work-head]').getByText('部品 · トグル', { exact: true })).toBeHidden();
    await expect(page.locator('[data-work-counts]').getByText('部品 · トグル', { exact: true })).toBeVisible();
    const head = (await page.locator('[data-work-head]').boundingBox())!;
    expect(head.height).toBeLessThan(80);
    // 印は1行に流す（折り返さない）。はみ出した分は、その行の中で横に送る
    const list = about(page).locator('dl').first();
    const tops = await list.locator('[data-about-item]').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
