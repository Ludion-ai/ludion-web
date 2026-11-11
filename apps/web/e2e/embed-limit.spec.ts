// EMBED001「7」：埋め込みの1日の上限。超えたら、作品を動かさず、止めた絵と作品のページへのリンクを返す。
// 数は D1 の quotas の1行（鍵 embed-view:*、UTC の日）なので、accounts のサーバー（D1 を順に使う）で、その行を書いて確かめる。
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { EMBED_LIMITS } from '../worker/quotaLimits';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FRAME = '/frame/fx-toggle/1/embed.html';
const FROM_EMBED = { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' };

function d1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const today = () => new Date().toISOString().slice(0, 10);
const setCount = (n: number) =>
  d1(`INSERT INTO quotas (key, bucket, n, expires_at) VALUES ('embed-view:*', '${today()}', ${n}, ${Date.now() + 2 * 86_400_000})
      ON CONFLICT (key, bucket) DO UPDATE SET n = ${n}`);
const count = () => d1<{ n: number }>(`SELECT n FROM quotas WHERE key = 'embed-view:*' AND bucket = '${today()}'`)[0]?.n ?? 0;

test.afterEach(() => {
  d1(`DELETE FROM quotas WHERE key = 'embed-view:*'`);
});

test('上限は1日2万回。枠を返すたびに1つ数え、上限に達したら数えずに止めた文書を返す', async ({ request }) => {
  expect(EMBED_LIMITS.viewsAllDay).toBe(20_000);
  setCount(EMBED_LIMITS.viewsAllDay - 1);
  const last = await request.get(FRAME, { headers: FROM_EMBED });
  expect(last.status()).toBe(200);
  expect(await last.text()).toContain('id="ld-host"');
  expect(count()).toBe(EMBED_LIMITS.viewsAllDay);

  const over = await request.get(FRAME, { headers: FROM_EMBED });
  expect(over.status()).toBe(429);
  const body = await over.text();
  expect(body).not.toContain('ld-host');
  expect(body).toContain('ld-embed-paused');
  expect(over.headers()['content-security-policy']).toContain('sandbox allow-scripts allow-forms');
  expect(over.headers()['cache-control']).toBe('private, no-store');
  expect(count()).toBe(EMBED_LIMITS.viewsAllDay);

  // 作品のページの枠は止めない（数えるのは埋め込みだけ）
  expect((await request.get('/frame/fx-toggle/1/desktop.html', { headers: { 'Sec-Fetch-Dest': 'iframe' } })).status()).toBe(200);
});

test('上限に達した後の /e/：枠を置かず、止めた絵（サムネイル）が作品のページへのリンク（新しいタブ）。印も残る', async ({ page }) => {
  setCount(EMBED_LIMITS.viewsAllDay);
  await page.goto('/e/fx-toggle');
  await expect(page.locator('iframe')).toHaveCount(0);
  const paused = page.locator('a[data-ld-paused]');
  await expect(paused).toHaveAttribute('href', '/p/fx-toggle');
  await expect(paused).toHaveAttribute('target', '_blank');
  await expect(paused.locator('img')).toHaveAttribute('src', '/w/fx-toggle/1/thumb.webp');
  await expect(page.locator('[data-ld-badge]')).toBeVisible();
});

test('/e/ がキャッシュに残っていても、枠が「止めた」と知らせたら、止めた絵に替わる', async ({ page, request }) => {
  // 上限の前に描いた /e/（キャッシュに60秒残る形）
  const cached = await (await request.get('/e/fx-toggle')).text();
  expect(cached).toContain('<iframe');
  setCount(EMBED_LIMITS.viewsAllDay);
  await page.route('**/e/fx-toggle', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: cached }));
  await page.goto('/e/fx-toggle');
  await expect(page.locator('a[data-ld-paused]')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});
