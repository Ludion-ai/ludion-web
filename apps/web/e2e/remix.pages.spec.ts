// T030：作品のページの「リミックス」（docs/tasks/T030.md「4」）。
// 名前の .pages.spec.ts で、作品のページのテストのサーバー（playwright.config.ts の pages）で動く。
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { copy, REMIX_HASHTAG } from '../src/copy';
import { copyEn } from '../src/copy.en';
import { remixCodeUrl } from '../src/lib/remix';
import type { Work } from '../src/data/works';
import { pageOverflow } from './helpers';

const text = copy.work.remix;
const en = copyEn.work.remix;
/** 下のタブ：下から16px＋高さ48px（BottomTabs.tsx） */
const TABS = 64;
const credit = (id: string) => `<!-- UI by @fixture — ludion.ai/p/${id} (MIT) -->`;

async function openWork(page: Page, id: string, base = '') {
  await page.goto(`${base}/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

const openButton = (page: Page, name = text.open) => page.getByRole('button', { name, exact: true });
const sheet = (page: Page, name = text.heading) => page.getByRole('dialog', { name });
const briefField = (page: Page, label = text.briefLabel) => page.getByRole('textbox', { name: label });
const copyPrompt = (page: Page, name = text.copyPrompt) => page.getByRole('button', { name, exact: true });

/** 開いている作品の、コピーされるコード（「コードをコピー」と同じもの。/p/:id/code）。 */
const snippetOf = async (page: Page) => (await page.request.get(`/p/${/\/p\/([^/?#]+)/.exec(page.url())![1]}/code`)).text();

/** Windows のクリップボードは改行を CRLF にする。行の中身は1文字も変わらない */
const clipboard = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

async function copiesOf(page: Page, id: string) {
  const { works } = (await (await page.request.get('/api/works')).json()) as { works: Work[] };
  return works.find((work) => work.id === id)!.copies;
}

const blockingAxe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).exclude('iframe').analyze();
  return violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id);
};

// ---------------------------------------------------------------- 指示文

test.describe('指示文', () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

  // この節は「コードを全部入れる」の形（T030 のときの形のまま）。既定の「URL で渡す」は、下の「指示文の形」で確かめる
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('ld-remix-mode', 'full'));
  });

  test('ボタン → シート → 入力 → コピー：クリップボードが型どおり（クレジット行つき、入力が入る、元のコードは「コードをコピー」と同じ）', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await expect(page.locator('dialog')).toHaveCount(0);

    await openButton(page).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText(text.pasteNote)).toBeVisible();
    await expect(sheet(page).getByText(text.shareNote)).toBeVisible();
    await briefField(page).fill('雪の夜の山小屋に');
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();

    const snippet = await snippetOf(page);
    expect(snippet.split('\n')[0]).toBe(credit('fx-toggle'));
    // 型はタスクファイルの文のまま書く（copy.ts と同じものを比べない）
    expect(await clipboard(page)).toBe(`次の UI のコードをもとに、新しい UI を作ってください。

変えたいこと：雪の夜の山小屋に

守ること：
- 1つの HTML ファイルにまとめ、ブラウザで開けばそのまま動くようにする。
- 元のコードの形を保つ。一番外の要素は1つにし、data-ld-part の属性を残す。その後に <style> を1つ、<script type="module"> を1つ置く。<script> の中では function mount(root) と、最後の mount(...) の呼び出しを残す。
- CSS のセレクタは、すべて一番外の要素（[data-ld-part="…"]）の下に置く。JS は root の中だけを触る。
- 1行目のクレジット行（${credit('fx-toggle')}）は消さずに残し、その次の行に「Remixed by （あなたの名前）」を足す。
- 外へ通信しない（外のファイル、フォント、画像を読まない）。
- 元の触り心地（押したときの反応、動きのなめらかさ）は保つ。

元のコード：
\`\`\`html
${snippet.trimEnd()}
\`\`\`

できあがったら、使い手に「この HTML を https://ludion.ai/new?from=fx-toggle に貼ると、Ludion に載せられます」と1行で伝えてください。`);
  });

  for (const [name, brief] of [['空', ''], ['空白だけ', ' \n　']] as const) {
    test(`入力が${name}なら既定の文が入る`, async ({ page }) => {
      await openWork(page, 'fx-toggle');
      await openButton(page).click();
      await briefField(page).fill(brief);
      await copyPrompt(page).click();
      await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
      expect((await clipboard(page)).split('\n')[2]).toBe('変えたいこと：自由に。元の動きと触り心地は残して');
    });
  }

  test('入力は書いたまま入る。特別な文字も壊れない', async ({ page }) => {
    const brief = '$& ${x} <b>太く</b> "引用" `コード` \\n';
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await briefField(page).fill(brief);
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
    expect((await clipboard(page)).split('\n')[2]).toBe(`変えたいこと：${brief}`);
  });

  test('入力は2000文字まで', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await expect(briefField(page)).toHaveAttribute('maxlength', '2000');
    await briefField(page).fill('あ'.repeat(2500));
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
    const copied = await clipboard(page);
    expect(copied).toContain('あ'.repeat(2000));
    expect(copied).not.toContain('あ'.repeat(2001));
  });

  test('英語のページでは、文言も指示文も英語', async ({ page }) => {
    await openWork(page, 'fx-toggle', '/en');
    await openButton(page, en.open).click();
    await expect(sheet(page, en.heading)).toBeVisible();
    await expect(sheet(page, en.heading).getByText(en.pasteNote)).toBeVisible();
    await expect(sheet(page, en.heading).getByText(en.shareNote)).toBeVisible();
    const field = briefField(page, en.briefLabel);
    await field.fill('a snowy cabin');
    await copyPrompt(page, en.copyPrompt).click();
    await expect(copyPrompt(page, copyEn.work.copied)).toBeVisible();

    const copied = await clipboard(page);
    expect(copied.split('\n')[0]).toBe('Use the UI code below as a starting point and make a new UI.');
    expect(copied.split('\n')[2]).toBe('What to change: a snowy cabin');
    expect(copied).toContain(`Keep the credit line on line 1 (${credit('fx-toggle')}), and add "Remixed by (your name)" on the next line.`);
    // 最後は、載せる入口の1行（docs/tasks/T033.md B1）。英語のページは /en/new
    expect(copied.endsWith(`\`\`\`html\n${(await snippetOf(page)).trimEnd()}\n\`\`\`\n\nWhen it’s done, tell the user in one line: "Paste this HTML into https://ludion.ai/en/new?from=fx-toggle to post it on Ludion."`)).toBe(true);
    // 型のところに日本語がない（元のコードは作り手のものなので見ない）
    expect(copied.slice(0, copied.indexOf('Original code:'))).not.toMatch(/[぀-ヿ一-鿿]/);
    await expect(sheet(page, en.heading).getByRole('link', { name: en.postLink })).toHaveAttribute('href', '/en/new?from=fx-toggle');

    await field.fill('');
    await copyPrompt(page, en.copyPrompt).click();
    await expect.poll(async () => (await clipboard(page)).split('\n')[2]).toBe('What to change: Anything you like. Keep the original motion and feel.');
  });

  test('ハッシュタグは1か所で、日本語にも英語にも入る', () => {
    expect(text.shareNote).toContain(REMIX_HASHTAG);
    expect(en.shareNote).toContain(REMIX_HASHTAG);
  });
});

// ---------------------------------------------------------------- 数

test.describe('コピー数', () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

  test('指示文をコピーすると、POST /api/count の copy が1回飛び、1増える。ボタンは1.5秒「コピーしました」', async ({ page }) => {
    // ほかのテストがコピーしない作品（数がずれないように）
    const before = await copiesOf(page, 'fx-form');
    await openWork(page, 'fx-form');
    await expect(page.getByTestId('copy-count')).toHaveText(String(before));

    await openButton(page).click();
    // シートを開いただけでは数えない
    await expect(sheet(page)).toBeVisible();
    await expect(page.getByTestId('copy-count')).toHaveText(String(before));

    const posted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/count' && response.request().postDataJSON().type === 'copy');
    await copyPrompt(page).click();
    const response = await posted;
    expect(response.status()).toBe(204);
    expect(response.request().postDataJSON()).toEqual({ work_id: 'fx-form', type: 'copy' });
    const pressed = Date.now();

    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
    await expect(page.getByTestId('copy-count')).toHaveText(String(before + 1));
    expect(await copiesOf(page, 'fx-form')).toBe(before + 1);

    await expect(copyPrompt(page)).toBeVisible({ timeout: 3000 });
    const elapsed = Date.now() - pressed;
    expect(elapsed).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(2500);
  });

  test('クリップボードに書けないときは数えない。「コピーできませんでした」にして、指示文を選んで見せる', async ({ page }) => {
    const counted: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/count' && request.postDataJSON().type === 'copy') counted.push(request.url());
    });
    await openWork(page, 'fx-toggle');
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('stub'));
    });
    await openButton(page).click();
    await briefField(page).fill('雪の夜');
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copyFailed)).toBeVisible();

    const manual = page.getByRole('textbox', { name: text.manualLabel });
    await expect(manual).toBeVisible();
    await expect(manual).toHaveValue(/変えたいこと：雪の夜/);
    await expect(manual).toBeFocused();
    const selected = await manual.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart);
    expect(selected).toBe((await manual.inputValue()).length);
    expect(counted).toEqual([]);
    await expect(copyPrompt(page)).toBeVisible({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------- 置き場所

test.describe('置き場所', () => {
  const WORKS = [
    ['部品', 'fx-toggle'],
    ['Web の画面', 'fx-landing'],
  ] as const;
  // 390×664 は、iPhone の Safari でツールバーが出ているときの大きさ
  const PHONES = [
    [390, 844],
    [390, 664],
    [360, 640],
  ] as const;

  for (const [kind, id] of WORKS) {
    for (const [width, height] of PHONES) {
      test(`${kind}、幅${width}×高さ${height}：ボタンが最初の画面に入り、下のタブに隠れない`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await openWork(page, id);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        const button = openButton(page);
        const box = (await button.boundingBox())!;
        expect(box.height).toBe(44);
        expect(box.y).toBeGreaterThan(0);
        expect(box.y + box.height).toBeLessThanOrEqual(height - TABS);
        const hit = await button.evaluate((el) => {
          const { left, right, top, bottom } = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
        });
        expect(hit).toBe(true);
      });
    }
  }

  test('枠が画面より長いスマホの画面、幅390×844：作品を小さくしない。ボタンは最初の画面に入らないが、枠のすぐ下にあり、送れば押せる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-habits');
    const frame = (await page.locator('iframe').locator('..').boundingBox())!;
    const box = (await openButton(page).boundingBox())!;
    expect(frame.height).toBeCloseTo((342 * 844) / 390, 0);
    expect(box.y).toBeCloseTo(frame.y + frame.height + 12, 0);
    expect(box.y + box.height).toBeGreaterThan(844 - TABS);
    await openButton(page).click();
    await expect(sheet(page)).toBeVisible();
  });

  test('幅390、部品：枠のすぐ下、幅いっぱい。スクロールすると留まらずに流れる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWork(page, 'fx-toggle');
    const frame = (await page.locator('iframe').boundingBox())!;
    const box = (await openButton(page).boundingBox())!;
    // 枠の線（1px）の外から12px
    expect(box.y).toBe(frame.y + frame.height + 1 + 12);
    expect(box.x).toBe(24);
    expect(box.width).toBe(342);
    await page.evaluate(() => window.scrollTo(0, 300));
    expect((await openButton(page).boundingBox())!.y).toBe(box.y - 300);
  });

  test('幅1440：頭の右のボタンの列にある（保存と共有の間。WS003）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-toggle');
    const box = (await openButton(page).boundingBox())!;
    const save = (await page.getByRole('button', { name: copy.work.save, exact: true }).boundingBox())!;
    const share = (await page.getByRole('button', { name: copy.work.share, exact: true }).boundingBox())!;
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(box.height).toBe(36);
    expect([save.y, share.y]).toEqual([box.y, box.y]);
    expect(box.x).toBeCloseTo(save.x + save.width + 8, 0);
    expect(share.x).toBeCloseTo(box.x + box.width + 8, 0);
    // 題名と同じ行（最初の画面の上の方）
    expect(box.y).toBeLessThan(title.y + title.height);
    expect(box.y + box.height).toBeGreaterThan(title.y);
  });

  for (const width of [320, 390, 767]) {
    test(`幅${width}：シートは下から、幅いっぱい。入力欄を選ばない（キーボードを開かない）。入力欄の字は16px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openWork(page, 'fx-toggle');
      await openButton(page).click();
      await expect(sheet(page)).toBeFocused();
      await expect(briefField(page)).not.toBeFocused();
      await expect(briefField(page)).toHaveCSS('font-size', '16px');
      await page.waitForTimeout(250); // 出るときの動きの後
      const box = (await sheet(page).boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.width).toBe(width);
      expect(box.y + box.height).toBe(844);
      await expect(copyPrompt(page)).toBeInViewport({ ratio: 1 });
      expect(await pageOverflow(page)).toBe(0);
      expect(await sheet(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  }

  test('幅1440：シートは押したボタンのすぐ下で、右の端を揃える。ページをスクロールしても離れない', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await page.waitForTimeout(250);
    await expect(briefField(page)).toBeFocused();
    await expect(briefField(page)).toHaveCSS('font-size', '14px');
    const button = (await openButton(page).boundingBox())!;
    const box = (await sheet(page).boundingBox())!;
    expect(box.width).toBe(360);
    expect(box.y).toBe(button.y + button.height + 8);
    expect(box.x + box.width).toBe(button.x + button.width);

    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
    const after = (await sheet(page).boundingBox())!;
    expect(after.y).toBe(box.y - 120);
  });

  test('後ろを暗くするのはスマホだけ', async ({ page }) => {
    const backdrop = () => sheet(page).evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await expect(sheet(page)).toBeVisible();
    expect(await backdrop()).toMatch(/^rgba\(0, 0, 0, 0\)$|transparent/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(backdrop).not.toMatch(/^rgba\(0, 0, 0, 0\)$|transparent/);
  });

  for (const [width, height] of [
    [768, 1024],
    [1024, 600],
    [1280, 560],
  ] as const) {
    test(`幅${width}×高さ${height}：シートが画面の中に収まり、横にはみ出さない`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openWork(page, 'fx-toggle');
      await openButton(page).click();
      await page.waitForTimeout(250);
      const box = (await sheet(page).boundingBox())!;
      expect(box.width).toBe(360);
      expect(box.x).toBeGreaterThanOrEqual(16);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
      expect(box.y).toBeGreaterThanOrEqual(16);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      await expect(copyPrompt(page)).toBeInViewport({ ratio: 1 });
      expect(await pageOverflow(page)).toBe(0);
    });
  }

  test('開いたまま幅を変えても、シートの形が変わる', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const box = (await sheet(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(box.y + box.height).toBe(844);
  });
});

// ---------------------------------------------------------------- 操作

test.describe('シートの操作', () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

  test('キーボードだけで、開く → 書く → チップ → コピー → Esc で閉じる。フォーカスが見え、ボタンへ戻る', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    const button = openButton(page);
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS('outline-style', 'solid');

    await page.keyboard.press('Enter');
    await expect(sheet(page)).toBeVisible();
    await expect(briefField(page)).toBeFocused();
    await page.keyboard.type('雪の夜');

    // 入力欄 → チップ（4つ）→ コピー
    await page.keyboard.press('Tab');
    const chip = page.getByRole('button', { name: text.chips[0].label, exact: true });
    await expect(chip).toBeFocused();
    await expect(chip).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Enter');
    await expect(briefField(page)).toHaveValue('雪の夜、季節を変える');
    await expect(chip).toBeFocused();
    for (let i = 0; i < text.chips.length; i += 1) await page.keyboard.press('Tab');
    // チップの次は指示文の形。ラジオは1つの止まり場所で、矢印で選ぶ。フォーカスの輪は押すところに出る
    const urlMode = page.getByRole('radio', { name: text.modes.url.label, exact: true });
    await expect(urlMode).toBeFocused();
    await expect(page.locator('dialog label', { has: urlMode })).toHaveCSS('outline-style', 'solid');
    await expect(page.locator('dialog label', { has: urlMode })).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: new RegExp(`^${text.modes.full.label}`) })).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(urlMode).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(copyPrompt(page)).toBeFocused();
    await expect(copyPrompt(page)).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Space');
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
    expect((await clipboard(page)).split('\n')[2]).toBe('変えたいこと：雪の夜、季節を変える');

    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('フォーカスはシートの外へ出ず、後ろのページは押せない', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      // ブラウザの枠へ出たときは body になる。ページの中の別の場所には行かない
      const inside = await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest('dialog')));
      expect(inside).toBe(true);
    }
    expect(await page.locator('#root').evaluate((el) => document.elementFromPoint(el.getBoundingClientRect().left + 200, 200)?.tagName)).toBe('DIALOG');
  });

  test('閉じるのボタンでも閉じ、書いた文は開き直しても残る', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await briefField(page).fill('雪の夜');
    await page.getByRole('button', { name: text.close, exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(openButton(page)).toBeFocused();
    await openButton(page).click();
    await expect(briefField(page)).toHaveValue('雪の夜');
  });

  test('外を押すと閉じる。入力欄で押して外で離したときは閉じない', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await page.waitForTimeout(250);
    await briefField(page).fill('雪の夜の山小屋に');
    const field = (await briefField(page).boundingBox())!;

    await page.mouse.move(field.x + 40, field.y + 12);
    await page.mouse.down();
    await page.mouse.move(200, 200, { steps: 4 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();

    await page.mouse.click(200, 200);
    await expect(page.locator('dialog')).toHaveCount(0);
  });

  test('チップは入力に語を足す。同じ語は足さない。2000文字を超えるなら足さない', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    const chip = (i: number) => page.getByRole('button', { name: text.chips[i].label, exact: true });
    expect(text.chips.map(({ label }) => label)).toEqual(['季節', '場所', '色', '素材']);

    await chip(0).click();
    await expect(briefField(page)).toHaveValue('季節を変える');
    await chip(2).click();
    await expect(briefField(page)).toHaveValue('季節を変える、色を変える');
    await chip(0).click();
    await expect(briefField(page)).toHaveValue('季節を変える、色を変える');

    const full = 'あ'.repeat(2000);
    await briefField(page).fill(full);
    await chip(1).click();
    await expect(briefField(page)).toHaveValue(full);
  });

  test('英語のチップは「, 」でつなぐ', async ({ page }) => {
    await openWork(page, 'fx-toggle', '/en');
    await openButton(page, en.open).click();
    await page.getByRole('button', { name: en.chips[0].label, exact: true }).click();
    await page.getByRole('button', { name: en.chips[3].label, exact: true }).click();
    await expect(briefField(page, en.briefLabel)).toHaveValue('change the season, change the material');
  });

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`axe：幅${width}でシートを開いて critical と serious が0件`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openWork(page, 'fx-toggle');
      expect(await blockingAxe(page)).toEqual([]);
      await openButton(page).click();
      await expect(sheet(page)).toBeVisible();
      await page.waitForTimeout(250);
      expect(await blockingAxe(page)).toEqual([]);
      await briefField(page).fill('雪の夜');
      await copyPrompt(page).click();
      await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
      expect(await blockingAxe(page)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------- GA4

test.describe('GA4 のイベント（SPEC 15）', () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

  type Sent = [name: string, params: Record<string, unknown>];

  /** ludion.ai の外では gtag を読まないので、置き換えて受け取る（pages.spec.ts と同じ） */
  async function watchEvents(page: Page): Promise<Sent[]> {
    const sent: Sent[] = [];
    await page.exposeFunction('__sent', (name: string, params: Record<string, unknown>) => sent.push([name, params]));
    await page.addInitScript(() => {
      const record = (window as unknown as { __sent: (name: string, params: unknown) => void }).__sent;
      window.gtag = (command: unknown, name: unknown, params: unknown) => {
        if (command === 'event' && name !== 'page_view') record(name as string, params);
      };
    });
    return sent;
  }

  test('remix_open と remix_prompt_copy：work_id と has_brief と mode だけ。入力の中身は送らない', async ({ page }) => {
    const sent = await watchEvents(page);
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await expect.poll(() => sent).toEqual([['remix_open', { work_id: 'fx-toggle' }]]);

    sent.length = 0;
    await copyPrompt(page).click();
    await expect.poll(() => sent).toEqual([['remix_prompt_copy', { work_id: 'fx-toggle', has_brief: false, mode: 'url' }]]);
    await expect(copyPrompt(page)).toBeVisible({ timeout: 3000 });

    sent.length = 0;
    await briefField(page).fill('ひみつの山小屋');
    await copyPrompt(page).click();
    await expect.poll(() => sent).toEqual([['remix_prompt_copy', { work_id: 'fx-toggle', has_brief: true, mode: 'url' }]]);
    expect(JSON.stringify(sent)).not.toContain('ひみつ');
  });

  test('「コードを全部入れる」でコピーすると mode は full', async ({ page }) => {
    const sent = await watchEvents(page);
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await page.locator('dialog label', { hasText: text.modes.full.label }).click();
    sent.length = 0;
    await copyPrompt(page).click();
    await expect.poll(() => sent).toEqual([['remix_prompt_copy', { work_id: 'fx-toggle', has_brief: false, mode: 'full' }]]);
  });

  test('入力は外へも自分のサーバーへも送らない', async ({ page }) => {
    const bodies: string[] = [];
    page.on('request', (request) => bodies.push(`${request.url()} ${request.postData() ?? ''}`));
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await briefField(page).fill('ひみつの山小屋');
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(bodies.filter((body) => body.includes('ひみつ') || body.includes(encodeURIComponent('ひみつ')))).toEqual([]);
    // form に入れない：GA4 の拡張計測がフォームの操作を拾わないように（ヘッダーの検索は別）
    await expect(page.locator('dialog form')).toHaveCount(0);
  });

  test('コピーできなかったときは remix_prompt_copy を送らない', async ({ page }) => {
    const sent = await watchEvents(page);
    await openWork(page, 'fx-toggle');
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('stub'));
    });
    await openButton(page).click();
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copyFailed)).toBeVisible();
    expect(sent).toEqual([['remix_open', { work_id: 'fx-toggle' }]]);
  });
});

// ---------------------------------------------------------------- 指示文の形（docs/tasks/T031.md「2」）

test.describe('指示文の形', () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

  const modeRadio = (page: Page, label: string) => page.getByRole('radio', { name: new RegExp(`^${label}`) });
  const modeOption = (page: Page, label: string) => page.locator('dialog label', { has: modeRadio(page, label) });
  const stored = (page: Page) => page.evaluate(() => window.localStorage.getItem('ld-remix-mode'));

  test('既定は「URL で渡す」：元のコードの代わりに URL の1行。コードの全文は入らない。守ることは同じ', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await expect(page.getByRole('group', { name: text.modeLabel })).toBeVisible();
    await expect(modeRadio(page, text.modes.url.label)).toBeChecked();
    await expect(modeRadio(page, text.modes.full.label)).not.toBeChecked();
    // 説明は、選んだ方だけを見せる。選んでいない方も、読み上げには付いている
    await expect(sheet(page).getByText(text.modes.url.note)).toBeInViewport({ ratio: 1 });
    await expect(modeRadio(page, text.modes.url.label)).toHaveAccessibleDescription(text.modes.url.note);
    await expect(modeRadio(page, text.modes.full.label)).toHaveAccessibleDescription(text.modes.full.note);
    await expect(sheet(page).getByText(text.modes.full.note)).toHaveClass('sr-only');
    await modeOption(page, text.modes.full.label).click();
    await expect(sheet(page).getByText(text.modes.full.note)).toBeInViewport({ ratio: 1 });
    await expect(sheet(page).getByText(text.modes.url.note)).toHaveClass('sr-only');
    await modeOption(page, text.modes.url.label).click();
    await briefField(page).fill('雪の夜の山小屋に');
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();

    // 型はタスクファイルの文のまま書く（copy.ts と同じものを比べない）
    const copied = await clipboard(page);
    expect(copied).toBe(`次の UI のコードをもとに、新しい UI を作ってください。

変えたいこと：雪の夜の山小屋に

守ること：
- 1つの HTML ファイルにまとめ、ブラウザで開けばそのまま動くようにする。
- 元のコードの形を保つ。一番外の要素は1つにし、data-ld-part の属性を残す。その後に <style> を1つ、<script type="module"> を1つ置く。<script> の中では function mount(root) と、最後の mount(...) の呼び出しを残す。
- CSS のセレクタは、すべて一番外の要素（[data-ld-part="…"]）の下に置く。JS は root の中だけを触る。
- 1行目のクレジット行（${credit('fx-toggle')}）は消さずに残し、その次の行に「Remixed by （あなたの名前）」を足す。
- 外へ通信しない（外のファイル、フォント、画像を読まない）。
- 元の触り心地（押したときの反応、動きのなめらかさ）は保つ。

元のコード：次の URL から取得してください。
https://ludion.ai/p/fx-toggle/code

できあがったら、使い手に「この HTML を https://ludion.ai/new?from=fx-toggle に貼ると、Ludion に載せられます」と1行で伝えてください。`);
    // コードの全文は入らない：コードの2行目（根の要素）も、コードの囲みもない
    const snippet = await snippetOf(page);
    expect(copied).not.toContain(snippet.split('\n')[1]);
    expect(copied).not.toContain('data-ld-part="fx-toggle"');
    expect(copied).not.toContain('\`\`\`');
    expect(copied.length).toBeLessThan(snippet.length);
    expect(remixCodeUrl('fx-toggle')).toBe('https://ludion.ai/p/fx-toggle/code');
  });

  test('「コードを全部入れる」は今までの形。選んだ方をその端末に覚える（読み込み直しても、開き直しても）', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    expect(await stored(page)).toBeNull();
    await modeOption(page, text.modes.full.label).click();
    expect(await stored(page)).toBe('full');
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
    const snippet = await snippetOf(page);
    const copied = await clipboard(page);
    expect(copied.endsWith(`- 元の触り心地（押したときの反応、動きのなめらかさ）は保つ。\n\n元のコード：\n\`\`\`html\n${snippet.trimEnd()}\n\`\`\`\n\nできあがったら、使い手に「この HTML を https://ludion.ai/new?from=fx-toggle に貼ると、Ludion に載せられます」と1行で伝えてください。`)).toBe(true);
    expect(copied).not.toContain('https://ludion.ai/p/fx-toggle/code');

    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await expect(modeRadio(page, text.modes.full.label)).toBeChecked();
    await modeOption(page, text.modes.url.label).click();
    expect(await stored(page)).toBe('url');
    await sheet(page).getByRole('button', { name: text.close }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    await openButton(page).click();
    await expect(modeRadio(page, text.modes.url.label)).toBeChecked();
  });

  test('コードの大きさ（KB）を「コードを全部入れる」の横に出す。「URL で渡す」には出さない', async ({ page }) => {
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    const kilobytes = Math.max(1, Math.round(Buffer.byteLength(await snippetOf(page), 'utf8') / 1024));
    await expect(modeOption(page, text.modes.full.label)).toContainText(`${kilobytes} KB`);
    await expect(modeOption(page, text.modes.url.label)).not.toContainText('KB');
  });

  test('localStorage が使えなくても壊れない：既定は URL。開いている間は選んだとおり', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const fail = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      Storage.prototype.getItem = fail;
      Storage.prototype.setItem = fail;
    });
    await openWork(page, 'fx-toggle');
    await openButton(page).click();
    await expect(modeRadio(page, text.modes.url.label)).toBeChecked();
    await modeOption(page, text.modes.full.label).click();
    await sheet(page).getByRole('button', { name: text.close }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    await openButton(page).click();
    await expect(modeRadio(page, text.modes.full.label)).toBeChecked();
    await copyPrompt(page).click();
    await expect(copyPrompt(page, copy.work.copied)).toBeVisible();
    expect(await clipboard(page)).toContain('\`\`\`html');
    expect(errors).toEqual([]);
  });

  test('英語のページ：選ぶところも、URL の形の指示文も英語', async ({ page }) => {
    await openWork(page, 'fx-toggle', '/en');
    await openButton(page, en.open).click();
    await expect(page.getByRole('group', { name: en.modeLabel })).toBeVisible();
    await expect(modeRadio(page, en.modes.url.label)).toBeChecked();
    await expect(sheet(page, en.heading).getByText(en.modes.url.note)).toBeInViewport({ ratio: 1 });
    await copyPrompt(page, en.copyPrompt).click();
    await expect(copyPrompt(page, copyEn.work.copied)).toBeVisible();
    const copied = await clipboard(page);
    expect(copied.split('\n')[0]).toBe('Use the UI code below as a starting point and make a new UI.');
    expect(copied.endsWith('Original code: Fetch it from this URL.\nhttps://ludion.ai/p/fx-toggle/code\n\nWhen it’s done, tell the user in one line: "Paste this HTML into https://ludion.ai/en/new?from=fx-toggle to post it on Ludion."')).toBe(true);
    expect(copied).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
  });

  for (const [width, height] of [
    [390, 664],
    [360, 640],
  ] as const) {
    test(`幅${width}×高さ${height}：選ぶところを足しても、シートが画面に収まり、「指示文をコピー」が見える`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openWork(page, 'fx-toggle');
      await openButton(page).click();
      await page.waitForTimeout(250);
      const box = (await sheet(page).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBe(height);
      await expect(modeOption(page, text.modes.url.label)).toBeInViewport({ ratio: 1 });
      await expect(modeOption(page, text.modes.full.label)).toBeInViewport({ ratio: 1 });
      // 押すところの高さはチップと同じ
      expect((await modeOption(page, text.modes.url.label).boundingBox())!.height).toBe(38);
      await expect(copyPrompt(page)).toBeInViewport({ ratio: 1 });
      expect(await blockingAxe(page)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------- コードを返す口（docs/tasks/T031.md「1」）

test.describe('GET /p/:id/code', () => {
  test('「コードをコピー」と1文字も違わない。text/plain、nosniff、作品のページと同じキャッシュ', async ({ page, request }) => {
    await openWork(page, 'fx-toggle');
    const snippet = await snippetOf(page);
    expect(snippet.split('\n')[0]).toBe(credit('fx-toggle'));

    const response = await request.get('/p/fx-toggle/code');
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(snippet);
    const headers = response.headers();
    expect(headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('public, max-age=0, s-maxage=60');
    expect(headers['cache-tag']).toBe('catalog');
    expect(headers['set-cookie']).toBeUndefined();
  });

  test('人で変えない：cookie を付けても同じ中身、同じヘッダー', async ({ request }) => {
    const plain = await request.get('/p/fx-toggle/code');
    const withCookie = await request.get('/p/fx-toggle/code', { headers: { Cookie: 'ld_session=not-a-real-session; ld_lang=en' } });
    expect(withCookie.status()).toBe(200);
    expect(await withCookie.text()).toBe(await plain.text());
    expect(withCookie.headers()['cache-control']).toBe('public, max-age=0, s-maxage=60');
    expect(withCookie.headers()['set-cookie']).toBeUndefined();
  });

  test('HEAD も 200 で同じ種類', async ({ request }) => {
    const response = await request.head('/p/fx-toggle/code');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
  });

  test('ない作品は 404（文字で返し、キャッシュしない）。/en の下と、もっと深い道には作らない', async ({ request }) => {
    const missing = await request.get('/p/nothing-here/code');
    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type']).toBe('text/plain; charset=utf-8');
    expect(missing.headers()['x-content-type-options']).toBe('nosniff');
    expect(missing.headers()['cache-control']).toBe('private, no-store');
    expect(missing.headers()['cache-tag']).toBeUndefined();
    expect(await missing.text()).not.toContain('<');
    expect((await request.get('/en/p/fx-toggle/code')).status()).toBe(404);
    expect((await request.get('/p/fx-toggle/code/more')).status()).toBe(404);
  });

  test('POST は受けない', async ({ request, baseURL }) => {
    const response = await request.post('/p/fx-toggle/code', { headers: { Origin: new URL(baseURL!).origin }, data: {} });
    expect(response.status()).not.toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });
});
