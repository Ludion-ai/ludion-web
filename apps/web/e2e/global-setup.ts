import type { FullConfig } from '@playwright/test';

const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 200;

/**
 * テストを始める前に、サーバーが本当にホームを返せるようになるまで待つ。
 * Playwright の webServer.url は 404 未満なら準備完了と見なすので、ここで 200 と中身まで確かめる。
 */
async function waitFor(url: string, ready: (body: string) => boolean) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = 'まだ一度も応答がない';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.status === 200 && ready(body)) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  throw new Error(`${url} が ${TIMEOUT_MS}ms 以内に 200 を返さなかった（最後：${last}）`);
}

export default async function globalSetup(config: FullConfig) {
  await Promise.all(
    config.projects.map((project) =>
      // seed の入ったサーバーはカードまで、空のサーバーはホームが返ることまで確かめる
      waitFor(project.use.baseURL!, (body) => project.name !== 'home' || body.includes('data-masonry')),
    ),
  );
}
