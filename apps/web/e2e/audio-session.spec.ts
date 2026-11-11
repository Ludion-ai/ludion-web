// iPhone の消音モードでも、作品の音が鳴るようにする（SPEC.md 13「プレビュー」の「作品の音」）。
// 親のページが navigator.audioSession.type を playback にする。この口は Safari にしかないので、ここでは偽の口を置いて確かめる。
// 本当に鳴るかどうかは、実機の iPhone でしか確かめられない。
import { expect, test } from '@playwright/test';
import { openHome } from './helpers';

type WithAudioSession = Navigator & { audioSession: { type: string } };

test('audioSession がある端末（iPhone の Safari）：ページを開くと、type が playback になる', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
  });
  await openHome(page);
  expect(await page.evaluate(() => (navigator as WithAudioSession).audioSession.type)).toBe('playback');
});

test('type を変えられない端末（代入すると例外）：ページはそのまま動く', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    const session = {
      get type() {
        return 'auto';
      },
      set type(_value: string) {
        throw new TypeError('not supported');
      },
    };
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
  });
  await openHome(page);
  expect(await page.evaluate(() => (navigator as WithAudioSession).audioSession.type)).toBe('auto');
  expect(errors).toEqual([]);
});

test('audioSession がない端末：何も起きず、ページはそのまま動く', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    // 将来この口を持つブラウザで流しても、「ない端末」を確かめられるようにする
    Object.defineProperty(navigator, 'audioSession', { value: undefined, configurable: true });
  });
  await openHome(page);
  expect(errors).toEqual([]);
});
