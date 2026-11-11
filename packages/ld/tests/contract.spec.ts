// T006 の終わりの条件：フォームの送信、危険の色のコントラスト、動く作品の reduced motion、part.js の色。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FRAME_CSP, FRAME_SANDBOX, NEUTRAL_PALETTES, buildFrameHtml, type Work } from '@ludion/render';
import { launch, openFramePage, runAxe } from '../src/browser.ts';
import { checkWork } from '../src/check.ts';
import { findWork, readWork, toRenderable } from '../src/workspace.ts';
import { makeTempRoot } from './helpers.ts';

const OUTSIDE = 'https://outside.example/collect';

function fixture(id: string): Work {
  const work = toRenderable(readWork(findWork(id)!));
  expect(work, id).not.toBeNull();
  return work!;
}

/** fx-form の form に、外の送信先を書く。 */
function withOutsideAction(work: Work): Work {
  const html = work.html.replace('<form class="form"', `<form class="form" action="${OUTSIDE}" method="post"`);
  expect(html).toContain(OUTSIDE);
  return { ...work, html };
}

const hexToRgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

test.describe('フォームの送信（枠の中）', () => {
  /** サイトと同じ形：親のページに sandbox の iframe を置く。外へ出たリクエストを全部数える。 */
  async function openInFrame(page: Page, html: string, sandbox = FRAME_SANDBOX) {
    const outgoing: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === 'http://site.test/') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>site</title><iframe sandbox="${sandbox}" src="/frame" width="800" height="600"></iframe>`,
        });
      }
      if (url === 'http://site.test/frame') return route.fulfill({ contentType: 'text/html', body: html });
      outgoing.push(url);
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>outside</title>' });
    });
    await page.goto('http://site.test/');
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    await frame.locator('.submit').waitFor();
    return { frame, outgoing };
  }

  test('fx-form：submit が届き、作品の JS が preventDefault してエラーを --_danger で出す。外の action でも通信しない', async ({ page }) => {
    const html = buildFrameHtml(withOutsideAction(fixture('fx-form')), { palette: 'light' });
    const { frame, outgoing } = await openInFrame(page, html);

    const error = frame.locator('.error');
    await expect(error).toBeHidden();
    await frame.locator('.submit').click();
    await expect(error).toBeVisible();
    await expect(error).toHaveCSS('color', hexToRgb(NEUTRAL_PALETTES.light.danger));

    // Enter でも届く。正しい値なら完了の表示に変わる
    await frame.locator('.input').fill('a@example.com');
    await frame.locator('.input').press('Enter');
    await expect(frame.locator('.done')).toBeVisible();
    await expect(error).toBeHidden();

    await page.waitForTimeout(300);
    expect(outgoing).toEqual([]);
    expect(frame.url()).toBe('http://site.test/frame');
  });

  test('作品が preventDefault しなくても、外の送信先へは送られない（CSP の form-action）', async ({ page }) => {
    const work = { ...withOutsideAction(fixture('fx-form')), js: null };
    const { frame, outgoing } = await openInFrame(page, buildFrameHtml(work, { palette: 'light' }));
    await frame.evaluate(() => {
      const w = window as unknown as { submits: number; blocked: string[] };
      w.submits = 0;
      w.blocked = [];
      const form = document.getElementById('ld-host')!.shadowRoot!.querySelector('form')!;
      form.addEventListener('submit', () => (w.submits += 1));
      document.addEventListener('securitypolicyviolation', (e) => w.blocked.push(e.effectiveDirective));
    });
    await frame.locator('.submit').click();
    await expect.poll(() => frame.evaluate(() => (window as unknown as { submits: number }).submits)).toBe(1);
    await expect.poll(() => frame.evaluate(() => (window as unknown as { blocked: string[] }).blocked)).toEqual(['form-action']);
    await page.waitForTimeout(300);
    expect(outgoing).toEqual([]);
    expect(frame.url()).toBe('http://site.test/frame');
  });

  test('対照：CSP がなければ送信先へ届く（このテストが通信を見られている）', async ({ page }) => {
    const work = { ...withOutsideAction(fixture('fx-form')), js: null };
    const html = buildFrameHtml(work, { palette: 'light' }).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    expect(html).not.toContain(FRAME_CSP);
    const { frame, outgoing } = await openInFrame(page, html);
    await frame.locator('.submit').click();
    await expect.poll(() => outgoing).toEqual([OUTSIDE]);
  });

  test('対照：allow-forms がなければ submit が届かない（T005 までの形）', async ({ page }) => {
    const { frame } = await openInFrame(page, buildFrameHtml(fixture('fx-form'), { palette: 'light' }), 'allow-scripts');
    await frame.locator('.submit').click();
    await page.waitForTimeout(300);
    await expect(frame.locator('.error')).toBeHidden();
  });

  test('ld check の枠も同じ制限で開く：オリジンなし、submit は届き、送信を止めたことを「外への通信」で数える', async () => {
    const browser = await launch();
    const frame = await openFramePage(browser);
    try {
      await frame.show(fixture('fx-form'), 'author', 1280, 800);
      expect(await frame.page.evaluate(() => self.origin)).toBe('null');
      await frame.page.locator('.submit').click();
      await expect(frame.page.locator('.error')).toBeVisible();
      expect(frame.outgoing).toEqual([]);

      await frame.show({ ...withOutsideAction(fixture('fx-form')), js: null }, 'author', 1280, 800);
      // click は、CSP で止まった遷移の完了を待ち続けるので、requestSubmit で送る
      await frame.page.locator('.form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await expect.poll(() => frame.outgoing.map((o) => o.how)).toEqual(['csp']);
      expect(frame.outgoing[0].url).toContain('outside.example');
    } finally {
      await frame.close();
      await browser.close();
    }
  });
});

test.describe('--ld-danger のコントラスト', () => {
  for (const palette of ['light', 'dark'] as const) {
    test(`${palette}：fx-form のエラーを出した状態で color-contrast が 0`, async () => {
      const browser = await launch();
      const frame = await openFramePage(browser);
      try {
        await frame.show(fixture('fx-form'), palette, 1280, 800);
        await frame.page.locator('.submit').click();
        const error = frame.page.locator('.error');
        await expect(error).toBeVisible();
        await expect(error).toHaveCSS('color', hexToRgb(NEUTRAL_PALETTES[palette].danger));
        const { violations } = await runAxe(frame.page);
        expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
      } finally {
        await frame.close();
        await browser.close();
      }
    });
  }
});

test.describe('動く作品', () => {
  test('fx-motion：reduced motion で、2秒あけて撮った2枚の画像が同じ。対照：ふつうは変わる', async () => {
    const browser = await launch();
    const frame = await openFramePage(browser);
    try {
      const work = fixture('fx-motion');
      await frame.page.emulateMedia({ reducedMotion: 'reduce' });
      await frame.show(work, 'author', 1280, 800);
      const first = await frame.page.screenshot();
      await frame.page.waitForTimeout(2000);
      const second = await frame.page.screenshot();
      expect(first.equals(second)).toBe(true);
      // 真っ黒や地の色だけではなく、線が描かれている
      expect(await frame.page.locator('.stage').evaluate((canvas: HTMLCanvasElement) => {
        const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        const colors = new Set<number>();
        for (let i = 0; i < data.length; i += 4) colors.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
        return colors.size;
      })).toBeGreaterThan(3);

      await frame.page.emulateMedia({ reducedMotion: 'no-preference' });
      await frame.show(work, 'author', 1280, 800);
      const moving = await frame.page.screenshot();
      await frame.page.waitForTimeout(500);
      expect(moving.equals(await frame.page.screenshot())).toBe(false);
    } finally {
      await frame.close();
      await browser.close();
    }
  });

  test('fx-motion：色は根の --_* から読むので、配色を変えると canvas の色も変わる', async () => {
    const browser = await launch();
    const frame = await openFramePage(browser);
    try {
      await frame.page.emulateMedia({ reducedMotion: 'reduce' });
      const corner = () =>
        frame.page.locator('.stage').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data].slice(0, 3).join(','));
      await frame.show(fixture('fx-motion'), 'light', 1280, 800);
      expect(await corner()).toBe('255,255,255');
      await frame.show(fixture('fx-motion'), 'dark', 1280, 800);
      expect(await corner()).toBe('10,10,10');
    } finally {
      await frame.close();
      await browser.close();
    }
  });

  test('part.js の色のリテラル：部品は「トークンの純度」で落ち、画面は警告だけ', async () => {
    const { root, cleanup } = makeTempRoot(['fx-toggle', 'fx-landing']);
    try {
      const toggle = join(root, 'works/fx-toggle/part.js');
      writeFileSync(toggle, `${readFileSync(toggle, 'utf8')}\nconst ACCENT = '#ff0000';\n`);
      writeFileSync(join(root, 'works/fx-landing/part.js'), `const ACCENT = '#ff0000';\nexport function mount(root) { root.dataset.accent = ACCENT; return () => {}; }\n`);

      const location = (id: string) => ({ id, dir: join(root, 'works', id), library: { name: 'works' as const, base: root } });
      const component = await checkWork(location('fx-toggle'));
      const purity = component.items.find((i) => i.key === 'purity')!;
      expect(purity.ok).toBe(false);
      expect(purity.problems[0].message).toBe('part.js 14行目 の色 #ff0000');
      expect(component.items.filter((i) => !i.ok).map((i) => i.key)).toEqual(['purity']);

      const screen = await checkWork(location('fx-landing'));
      const warned = screen.items.find((i) => i.key === 'purity')!;
      expect(warned.ok).toBe(true);
      expect(warned.warnings.map((w) => w.message)).toEqual(['part.js 1行目 の色 #ff0000']);
      expect(screen.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});
