// T035「11/11 9:10 の CTO の答え」の1：ヘッダーのスイッチを押した瞬間に、サイトの色を変える。
// 名前の .pages.spec.ts で、作品のページのテストのサーバーで動く。Chromium（pages）と WebKit（theme-press-webkit）。
//
// テストのデータには toggle-* がないので、スイッチの作品は fx-toggle に固定する（window.__ldThemeSwitch）。
// fx-toggle は押すとすぐに aria-checked が変わる。toggle-* は、つまみが渡りきってから（約1秒後に）変わる。
// その遅さを、枠の中に「遅い作品」の代わりを入れて作る（slowWork）：
// - click では fx-toggle の動きを止め（stopImmediatePropagation）、TRAVEL_MS 後に aria-checked を逆にする。
//   渡っている途中にもう一度押すと、戻る（aria-checked は変わらない）。toggle-* と同じ。
// - ドラッグ（pointerdown → 4px より動く → pointerup）の後の click は捨てる。離した側は、テストが決める。
// Ludion の枠のスクリプト（packages/render の SWITCH_SCRIPT）は、作品より先に click を受けるので、この代わりの前に動く。
import { expect, test, type Frame, type Page } from '@playwright/test';

const SWITCH_FRAME = 'iframe[data-ld-switch-frame]';
const WORK = 'fx-toggle';
const TRAVEL_MS = 1000;
/** 押してから、サイトの色が変わるまでの上限（docs/tasks/T035.md「11/11 9:10 の CTO の答え」の1） */
const LIMIT_MS = 100;

type Log = { changes: { theme: string | null; at: number; paintAt: number | null }[] };

async function open(page: Page, scheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript((pick) => {
    if (window !== window.top) return;
    (window as unknown as { __ldThemeSwitch: string }).__ldThemeSwitch = pick;
    const log: Log = { changes: [] };
    Object.defineProperty(window, '__ldPressLog', { value: log });
    new MutationObserver((records) => {
      if (!records.some((r) => r.target === document.documentElement)) return;
      const entry = { theme: document.documentElement.getAttribute('data-theme'), at: performance.timeOrigin + performance.now(), paintAt: null as number | null };
      log.changes.push(entry);
      requestAnimationFrame(() => (entry.paintAt = performance.timeOrigin + performance.now()));
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  }, WORK);
  await page.goto('/about');
  await page.waitForFunction((selector) => {
    const frame = document.querySelector<HTMLIFrameElement>(selector);
    return !!frame && !frame.inert;
  }, SWITCH_FRAME);
  const frame = page.frames().find((f) => f.url().endsWith('/inline.html'))!;
  // 最初の合わせ（fx-toggle の Wi-Fi は true から始まる）が終わるのを待つ
  await expect(page.frameLocator(SWITCH_FRAME).locator('[role="switch"]').first()).toHaveAttribute('aria-checked', String(scheme === 'dark'));
  return frame;
}

/** 枠の中に、遅い作品の代わりを入れる。ドラッグの後にどちらへ止まるかは dragEnd で決める（'across' は逆の側へ、'back' は元の側へ）。 */
async function slowWork(frame: Frame) {
  await frame.evaluate((travel) => {
    const s = document.getElementById('ld-host')!.shadowRoot!.querySelector<HTMLElement>('[role="switch"]')!;
    const state = { presses: [] as number[], timer: 0 as unknown as ReturnType<typeof setTimeout>, travelling: false, dragEnd: 'back' as 'across' | 'back', x0: null as number | null, moved: false, skipUntil: 0 };
    Object.defineProperty(window, '__ldSlow', { value: state });
    const flip = () => s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true'));
    s.addEventListener('pointerdown', (e) => {
      state.x0 = e.clientX;
      state.moved = false;
    });
    s.addEventListener('pointermove', (e) => {
      if (state.x0 !== null && Math.abs(e.clientX - state.x0) > 3) state.moved = true;
    });
    s.addEventListener('pointerup', () => {
      if (state.moved) {
        state.skipUntil = performance.now() + 300;
        // 渡っている途中でつかんだら、その渡りは止まる
        clearTimeout(state.timer);
        state.travelling = false;
        // 'across'：今 aria-checked が言っている側の逆へ、離してから少しで止まる。'back'：元の側へ戻る（aria-checked は変わらない）
        if (state.dragEnd === 'across') state.timer = setTimeout(flip, travel / 2);
      }
      state.x0 = null;
      state.moved = false;
    });
    s.addEventListener(
      'click',
      (e) => {
        // fx-toggle の「すぐに変わる」を止める（Ludion の枠のスクリプトは、これより先に click を受けている）
        e.stopImmediatePropagation();
        if (performance.now() < state.skipUntil) return;
        state.presses.push(performance.timeOrigin + e.timeStamp);
        if (state.travelling) {
          // 渡っている途中に押すと、戻る。aria-checked は変わらない
          clearTimeout(state.timer);
          state.travelling = false;
          return;
        }
        state.travelling = true;
        state.timer = setTimeout(() => {
          state.travelling = false;
          flip();
        }, travel);
      },
      true,
    );
  }, TRAVEL_MS);
}

const sw = (page: Page) => page.frameLocator(SWITCH_FRAME).locator('[role="switch"]').first();
const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const changes = (page: Page) => page.evaluate(() => (window as unknown as { __ldPressLog: Log }).__ldPressLog.changes);
const presses = (frame: Frame) => frame.evaluate(() => (window as unknown as { __ldSlow: { presses: number[] } }).__ldSlow.presses);
const setDragEnd = (frame: Frame, end: 'across' | 'back') => frame.evaluate((e) => ((window as unknown as { __ldSlow: { dragEnd: string } }).__ldSlow.dragEnd = e), end);

/** ドラッグ。ヘッダーの枠は小さく、作品の根を縮めて切っているので、マウスではなく枠の中で知らせを起こす */
async function drag(page: Page) {
  const box = sw(page);
  await box.dispatchEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  await box.dispatchEvent('pointermove', { pointerId: 1, clientX: 18, clientY: 10 });
  await box.dispatchEvent('pointermove', { pointerId: 1, clientX: 30, clientY: 10 });
  await box.dispatchEvent('pointerup', { pointerId: 1, button: 0, clientX: 30, clientY: 10 });
  await box.dispatchEvent('click');
}

test.describe('押した瞬間に、サイトの色が変わる（作品の aria-checked を待たない）', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme} から：押してから ${LIMIT_MS}ms 以内に変わる。aria-checked は約1秒後に追いつき、行ったり来たりしない`, async ({ page }) => {
      const frame = await open(page, scheme);
      await slowWork(frame);
      const other = scheme === 'light' ? 'dark' : 'light';
      const startChanges = (await changes(page)).length;

      await sw(page).dispatchEvent('click');
      await expect.poll(() => theme(page)).toBe(other);
      // 色が変わった時、作品の aria-checked はまだ元のまま
      expect(await sw(page).getAttribute('aria-checked')).toBe(String(scheme === 'dark'));
      await expect.poll(async () => (await changes(page))[startChanges]?.paintAt ?? null).not.toBeNull();
      const [pressedAt] = await presses(frame);
      const changed = (await changes(page))[startChanges];
      const attrMs = changed.at - pressedAt;
      const paintMs = changed.paintAt! - pressedAt;
      console.log(`${test.info().project.name} ${scheme}→${other}: data-theme ${attrMs.toFixed(1)}ms、次の描画 ${paintMs.toFixed(1)}ms`);
      expect(attrMs).toBeGreaterThanOrEqual(0);
      expect(paintMs).toBeLessThanOrEqual(LIMIT_MS);

      // 約1秒後に作品が追いつく。サイトはそのまま
      await expect(sw(page)).toHaveAttribute('aria-checked', String(other === 'dark'), { timeout: 3000 });
      await page.waitForTimeout(1500);
      expect(await theme(page)).toBe(other);
      expect((await changes(page)).slice(startChanges).map((c) => c.theme)).toEqual([other]);
      expect(await page.evaluate(() => localStorage.getItem('ld-theme'))).toBe(other);
    });
  }

  test('キーボード（Enter と Space）でも、すぐに変わる', async ({ page }) => {
    const frame = await open(page);
    await slowWork(frame);
    // 枠の中のスイッチにフォーカスを置いて、キーで押す（Tab の動きはブラウザで違うので、ここでは focus で置く）
    await sw(page).focus();
    await page.keyboard.press('Space');
    await expect.poll(() => theme(page), { timeout: 500 }).toBe('dark');
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true', { timeout: 3000 });
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter');
    await expect.poll(() => theme(page), { timeout: 500 }).toBe('light');
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false', { timeout: 3000 });
  });

  test('渡っている途中にもう一度押す：サイトもすぐに戻り、作品は元の側のまま。最後に合う', async ({ page }) => {
    const frame = await open(page);
    await slowWork(frame);
    await sw(page).dispatchEvent('click');
    await expect.poll(() => theme(page)).toBe('dark');
    await page.waitForTimeout(300);
    await sw(page).dispatchEvent('click');
    await expect.poll(() => theme(page)).toBe('light');
    await page.waitForTimeout(TRAVEL_MS + 1000);
    expect(await theme(page)).toBe('light');
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false');
    expect((await changes(page)).map((c) => c.theme)).toEqual(['light', 'dark', 'light']);
  });
});

test.describe('ドラッグ：最後は、作品の状態とサイトの色が合う', () => {
  test('ドラッグで逆の側へ渡す：押した知らせは出さず、aria-checked が変わったときに合わせる', async ({ page }) => {
    const frame = await open(page);
    await slowWork(frame);
    await setDragEnd(frame, 'across');
    await drag(page);
    await page.waitForTimeout(200);
    // ドラッグの後の click では変えない
    expect(await theme(page)).toBe('light');
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true', { timeout: 3000 });
    await expect.poll(() => theme(page)).toBe('dark');
    await page.waitForTimeout(2000);
    expect(await theme(page)).toBe('dark');
    expect((await changes(page)).map((c) => c.theme)).toEqual(['light', 'dark']);
  });

  test('ドラッグで、元の側へ戻す：何も変わらない', async ({ page }) => {
    const frame = await open(page);
    await slowWork(frame);
    await setDragEnd(frame, 'back');
    await drag(page);
    await page.waitForTimeout(2500);
    expect(await theme(page)).toBe('light');
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false');
    expect((await changes(page)).map((c) => c.theme)).toEqual(['light']);
  });

  test('押した後、渡りきる前につかんで元の側へ戻す：サイトはすぐにダークになり、離して止まった後でライトに戻る', async ({ page }) => {
    const frame = await open(page);
    await slowWork(frame);
    await setDragEnd(frame, 'back');
    await sw(page).dispatchEvent('click');
    await expect.poll(() => theme(page)).toBe('dark');
    await page.waitForTimeout(300);
    await drag(page);
    // aria-checked は一度も変わらない。離して止まった後の知らせで、サイトが作品に合う
    await expect.poll(() => theme(page), { timeout: 4000 }).toBe('light');
    await page.waitForTimeout(TRAVEL_MS + 500);
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false');
    expect(await theme(page)).toBe('light');
    expect((await changes(page)).map((c) => c.theme)).toEqual(['light', 'dark', 'light']);
  });

  test('押した後、渡っている途中でつかんで逆の側（夜）へ渡しきる：ダークのまま', async ({ page }) => {
    const frame = await open(page);
    await slowWork(frame);
    await setDragEnd(frame, 'across');
    await sw(page).dispatchEvent('click');
    await expect.poll(() => theme(page)).toBe('dark');
    await page.waitForTimeout(300);
    await drag(page);
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true', { timeout: 3000 });
    await page.waitForTimeout(2500);
    expect(await theme(page)).toBe('dark');
    expect((await changes(page)).map((c) => c.theme)).toEqual(['light', 'dark']);
  });
});

test.describe('押した知らせの守り', () => {
  test('親の窓、別の窓、形の違う押した知らせでは変わらない。対照：自分の枠からなら変わる。1秒に10回なら3回目から無視し、最後に作品を親に合わせる', async ({ page }) => {
    const frame = await open(page);
    // 親の窓から
    await page.evaluate(() => window.postMessage({ type: 'ld-switch-press' }, '*'));
    // 自分の枠からでも、形が違うもの
    await frame.evaluate(() => {
      const wrong: unknown[] = [
        { type: 'ld-switch-press', checked: true },
        { type: 'ld-switch-press', extra: 1 },
        { type: 'LD-SWITCH-PRESS' },
        { type: ['ld-switch-press'] },
        'ld-switch-press',
        ['ld-switch-press'],
        { type: 'ld-switch-set', checked: true },
      ];
      for (const data of wrong) parent.postMessage(data, '*');
    });
    await page.waitForTimeout(1500);
    expect(await theme(page)).toBe('light');

    // 対照
    await frame.evaluate(() => parent.postMessage({ type: 'ld-switch-press' }, '*'));
    await expect.poll(() => theme(page)).toBe('dark');
    await page.waitForTimeout(1200);
    // 親がダークになったので、枠のスイッチは夜の側へ合わせられる
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true');

    // 1秒に10回
    const before = (await changes(page)).length;
    await frame.evaluate(() => {
      for (let i = 0; i < 10; i += 1) parent.postMessage({ type: 'ld-switch-press' }, '*');
    });
    await page.waitForTimeout(1500);
    const flips = (await changes(page)).slice(before);
    expect(flips.length).toBe(2);
    expect(await theme(page)).toBe('dark');
    await page.waitForTimeout(1500);
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('無視した押した知らせの後：静かになってから、作品をサイトの色に合わせる', async ({ page }) => {
    const frame = await open(page);
    // 3回押す（1秒の中）：2回はサイトが変わり（ダーク → ライト）、3回目は無視される。fx-toggle は3回とも動いて、夜の側
    await frame.evaluate(() => {
      const s = document.getElementById('ld-host')!.shadowRoot!.querySelector<HTMLElement>('[role="switch"]')!;
      s.click();
      s.click();
      s.click();
    });
    await page.waitForTimeout(300);
    expect(await theme(page)).toBe('light');
    // 静かになった後、親が今のモード（ライト）を言い直し、作品が昼の側へ戻る
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false', { timeout: 4000 });
    await page.waitForTimeout(1500);
    expect(await theme(page)).toBe('light');
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false');
  });
});
