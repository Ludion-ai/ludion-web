import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LD_BIN, makeTempRoot } from './helpers.ts';

/** ld preview を起動し、出力された URL を返す。 */
function startPreview(root: string, id: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [LD_BIN, 'preview', id, '--port', '0', '--no-open'], {
    env: { ...process.env, LD_ROOT: root },
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`ld preview が起動しない：${out}`)), 20_000);
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      const match = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[1] });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`ld preview が終わった（${code}）：${out}`)));
  });
}

/** 作者の配色の枠（3つ）の、根の背景色。 */
async function authorBackgrounds(page: Page): Promise<string[]> {
  const frames = page.frames().filter((f) => f.url().includes('palette=author'));
  return Promise.all(
    frames.map((f) =>
      f
        .evaluate(() => {
          const root = document.getElementById('ld-host')?.shadowRoot?.querySelector('[data-ld-part]');
          return root ? getComputedStyle(root).backgroundColor : '';
        })
        .catch(() => ''),
    ),
  );
}

test('ld preview：3つの配色 × 3つの幅の9枠を sandbox の iframe で出し、part.css の保存から1秒以内に変わる', async ({ page }) => {
  const { root, cleanup } = makeTempRoot(['fx-toggle']);
  const { child, url } = await startPreview(root, 'fx-toggle');
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);

    // 9枠。どれも sandbox="allow-scripts allow-forms" だけ（allow-same-origin を付けない。T006）
    const iframes = page.locator('iframe');
    await expect(iframes).toHaveCount(9);
    const attrs = await iframes.evaluateAll((list) =>
      list.map((f) => ({ sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src'), width: f.getAttribute('width') })),
    );
    expect(attrs.every((a) => a.sandbox === 'allow-scripts allow-forms')).toBe(true);
    // 中立の配色の枠には、任意の --ld-danger も流す
    expect(await (await page.request.get(`${url}frame?palette=light&width=390`)).text()).toContain('--ld-danger:#c81e1e');
    expect(await (await page.request.get(`${url}frame?palette=dark&width=390`)).text()).toContain('--ld-danger:#f87171');
    expect(await (await page.request.get(`${url}frame?palette=author&width=390`)).text()).not.toContain('--ld-danger:');
    const combos = attrs.map((a) => {
      const params = new URL(a.src!, url).searchParams;
      return `${params.get('palette')}-${params.get('width')}`;
    });
    expect(combos.sort()).toEqual(
      ['author', 'light', 'dark'].flatMap((p) => ['390', '768', '1280'].map((w) => `${p}-${w}`)).sort(),
    );

    // 各枠で作品が描画され、mount が動いている
    await expect
      .poll(async () => {
        const states = await Promise.all(
          page
            .frames()
            .filter((f) => f.url().includes('/frame?'))
            .map((f) => f.evaluate(() => document.getElementById('ld-host')?.getAttribute('data-ld-mount')).catch(() => null)),
        );
        return states.filter((s) => s === 'ok').length;
      })
      .toBe(9);
    // 枠は親と別のオリジン（opaque）なので、親から中に届かない
    const reachable = await page.evaluate(() => {
      try {
        return Boolean(document.querySelector('iframe')!.contentDocument);
      } catch {
        return false;
      }
    });
    expect(reachable).toBe(false);

    expect(await authorBackgrounds(page)).toEqual(['rgb(24, 26, 32)', 'rgb(24, 26, 32)', 'rgb(24, 26, 32)']);

    // part.css を書き換えて保存する
    const cssPath = join(root, 'works/fx-toggle/part.css');
    const css = readFileSync(cssPath, 'utf8');
    const started = Date.now();
    writeFileSync(cssPath, css.replace('--_surface: var(--ld-surface, #181a20);', '--_surface: var(--ld-surface, #3a1d5c);'));
    await expect
      .poll(() => authorBackgrounds(page), { intervals: [25], timeout: 5_000 })
      .toEqual(['rgb(58, 29, 92)', 'rgb(58, 29, 92)', 'rgb(58, 29, 92)']);
    const elapsed = Date.now() - started;
    console.log(`part.css の保存から3つの枠が変わるまで ${elapsed}ms`);
    expect(elapsed).toBeLessThan(1_000);
  } finally {
    child.kill();
    cleanup();
  }
});
