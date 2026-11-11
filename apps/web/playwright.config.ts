import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { Agent, setGlobalDispatcher } from 'undici';

/**
 * テストの Node の fetch は、接続を使い回さない（この設定は runner と各 worker の両方で読まれる）。
 * テストは wrangler d1 execute を execFileSync で呼び、その間 Node が止まる。GitHub Actions の機械では数回で5秒を超え、
 * その間にサーバー（vite preview）が使い回しの接続を閉じても気づけず、次の fetch が閉じた接続に書いて
 * 「fetch failed（other side closed、EPIPE）」で落ちる（docs/reports/CI001.md）。pipelining 0 は keep-alive を切る。
 */
setGlobalDispatcher(new Agent({ pipelining: 0 }));

/**
 * テスト専用のポート。開発用の preview（4173）や npm run lcp（4174）とぶつからない。
 * reuseExistingServer を切っているので、古いビルドや終わりかけのサーバーで走ることはない。
 * ポートが使われていれば、黙って走らずにその場で失敗する。
 * ほかの worktree のテストと同時に走らせるときは、LD_TEST_PORT_BASE で全部をずらす。
 */
const PORT = Number(process.env.LD_TEST_PORT_BASE ?? 4175);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
/** ld upload のテストのサーバー。作品が増減するので、seed の50作品を見るテストと分ける。 */
const UPLOAD_PORT = PORT + 1;
const UPLOAD_URL = `http://127.0.0.1:${UPLOAD_PORT}/`;
/** 作品のページのテストのサーバー。開発のデータ全部が入る。開くと閲覧数が増えるので、ホームのテストと分ける。 */
const PAGES_PORT = PORT + 3;
const PAGES_URL = `http://127.0.0.1:${PAGES_PORT}/`;
/** ログイン、いいね、しおりのテストのサーバー。いいねの数と D1 の行が動くので、ほかのテストと分ける。 */
const ACCOUNTS_PORT = PORT + 5;
const ACCOUNTS_URL = `http://127.0.0.1:${ACCOUNTS_PORT}/`;
/** 手元の偽の GitHub（scripts/fake-github.mjs）。 */
const GITHUB_PORT = PORT + 4;
/** 手元の偽の Google（scripts/fake-google.mjs）。 */
const GOOGLE_PORT = PORT + 7;
/** パスキーのテストのサーバー。パスキーは IP アドレスでは動かないので、localhost で開く（RP ID は localhost）。 */
const PASSKEY_PORT = PORT + 8;
const PASSKEY_URL = `http://localhost:${PASSKEY_PORT}/`;
/** 今の本番と同じ形から移したサーバー（scripts/migration-fixture.mjs、docs/tasks/T020.md「4」）。 */
const MIGRATION_PORT = PORT + 6;
const MIGRATION_URL = `http://127.0.0.1:${MIGRATION_PORT}/`;

/** テストの D1 と R2 は、毎回作り直す使い捨ての場所に置く（開発用の .wrangler/state には触らない）。 */
const PERSIST_DIR = join(import.meta.dirname, '.wrangler/test-state');
const UPLOAD_PERSIST_DIR = join(import.meta.dirname, '.wrangler/test-upload-state');
const PAGES_PERSIST_DIR = join(import.meta.dirname, '.wrangler/test-pages-state');
const ACCOUNTS_PERSIST_DIR = join(import.meta.dirname, '.wrangler/test-accounts-state');
const MIGRATION_PERSIST_DIR = join(import.meta.dirname, '.wrangler/test-migration-state');
const PASSKEY_PERSIST_DIR = join(import.meta.dirname, '.wrangler/test-passkey-state');

/**
 * 管理トークン。Worker は apps/web/.dev.vars があればそれだけを読み、なければ環境変数 ADMIN_TOKEN を読む
 * （wrangler.jsonc の secrets.required）。テストもその値を使う。
 * .dev.vars がないときは、走らせるたびにランダムに作る（テストの worker にも環境変数で引き継ぐ）。
 */
function adminToken(): string {
  const devVars = join(import.meta.dirname, '.dev.vars');
  if (existsSync(devVars)) {
    const m = /^\s*ADMIN_TOKEN\s*=\s*(.*?)\s*$/m.exec(readFileSync(devVars, 'utf8'));
    if (m) return m[1].replace(/^(['"`])(.*)\1$/, '$2');
  }
  process.env.LD_TEST_ADMIN_TOKEN ??= `test-${randomBytes(16).toString('hex')}`;
  return process.env.LD_TEST_ADMIN_TOKEN;
}
process.env.LD_TEST_ADMIN_TOKEN = adminToken();
process.env.LD_TEST_PERSIST_DIR = UPLOAD_PERSIST_DIR;
process.env.LD_TEST_ACCOUNTS_PERSIST_DIR = ACCOUNTS_PERSIST_DIR;
process.env.LD_TEST_MIGRATION_PERSIST_DIR = MIGRATION_PERSIST_DIR;
process.env.LD_TEST_PASSKEY_PERSIST_DIR = PASSKEY_PERSIST_DIR;
process.env.LD_TEST_GITHUB_PORT = String(GITHUB_PORT);
process.env.LD_TEST_GOOGLE_PORT = String(GOOGLE_PORT);

// 本番と同じビルドを試す。書体の先読みや CLS は、開発サーバーでは正しく測れない。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // GitHub Actions（.github/workflows/test.yml）では、落ちたテストの報告を成果物に残す。手元はこれまでどおり list だけ
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    // 落ちたテストだけ、スクリーンショットと trace を残す（Actions だけ。手元のメモリーを食わないため）
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    { name: 'home', testIgnore: /(upload|pages|accounts|account-page|google|login-flow|post|passkey|shots-t020|migration|frame-escape|motion|remix-scroll)\.spec\.ts/, use: { baseURL: BASE_URL } },
    { name: 'upload', testMatch: /upload\.spec\.ts/, use: { baseURL: UPLOAD_URL } },
    { name: 'pages', testMatch: /pages\.spec\.ts/, use: { baseURL: PAGES_URL } },
    // 枠の移動を止めるのはブラウザなので、全部のブラウザで確かめる（docs/tasks/T022.md「1」）
    { name: 'escape-chromium', testMatch: /frame-escape\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'chromium' } },
    { name: 'escape-webkit', testMatch: /frame-escape\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'webkit' } },
    { name: 'escape-firefox', testMatch: /frame-escape\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'firefox' } },
    // ヘッダーのスイッチを押した瞬間に色が変わる（docs/tasks/T035.md「11/11 9:10 の CTO の答え」の1）。Chromium は pages で流れる
    { name: 'theme-press-webkit', testMatch: /theme-press\.pages\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'webkit' } },
    // 「動きを減らす」の扱いと WebGL の知らせ（docs/tasks/FIX-motion.md「3」）
    { name: 'motion-chromium', testMatch: /motion\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'chromium' } },
    { name: 'motion-webkit', testMatch: /motion\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'webkit' } },
    // 「リミックス」が枠に重ならない（docs/tasks/FIX-remix-button.md）
    { name: 'remix-scroll-chromium', testMatch: /remix-scroll\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'chromium' } },
    { name: 'remix-scroll-webkit', testMatch: /remix-scroll\.spec\.ts/, use: { baseURL: PAGES_URL, browserName: 'webkit' } },
    // 順に走らせる。テストが wrangler d1 execute で同じ D1 のファイルを開くので、並行にサーバーへ要求を出すと、
    // 手元の D1 が「Failed to get session commit token」で 500 を返すことがある
    // workers: 1 は、ファイルをまたいでも同時に走らせないため（1つの D1 を3つのファイルで使う）
    { name: 'accounts', testMatch: /(accounts|account-page|google|login-flow|post)\.spec\.ts/, fullyParallel: false, workers: 1, use: { baseURL: ACCOUNTS_URL } },
    { name: 'migration', testMatch: /migration\.spec\.ts/, fullyParallel: false, workers: 1, use: { baseURL: MIGRATION_URL } },
    { name: 'passkey', testMatch: /(passkey|shots-t020)\.spec\.ts/, fullyParallel: false, workers: 1, use: { baseURL: PASSKEY_URL, browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build && node scripts/test-server.mjs',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      LD_PERSIST_DIR: PERSIST_DIR,
      LD_TEST_UPLOAD_PERSIST_DIR: UPLOAD_PERSIST_DIR,
      LD_TEST_PAGES_PERSIST_DIR: PAGES_PERSIST_DIR,
      LD_TEST_ACCOUNTS_PERSIST_DIR: ACCOUNTS_PERSIST_DIR,
      LD_TEST_MIGRATION_PERSIST_DIR: MIGRATION_PERSIST_DIR,
      LD_TEST_PASSKEY_PERSIST_DIR: PASSKEY_PERSIST_DIR,
      LD_TEST_PORT: String(PORT),
      LD_TEST_UPLOAD_PORT: String(UPLOAD_PORT),
      LD_TEST_PAGES_PORT: String(PAGES_PORT),
      LD_TEST_ACCOUNTS_PORT: String(ACCOUNTS_PORT),
      LD_TEST_MIGRATION_PORT: String(MIGRATION_PORT),
      LD_TEST_PASSKEY_PORT: String(PASSKEY_PORT),
      LD_TEST_GITHUB_PORT: String(GITHUB_PORT),
      LD_TEST_GOOGLE_PORT: String(GOOGLE_PORT),
      ADMIN_TOKEN: process.env.LD_TEST_ADMIN_TOKEN,
    },
  },
});
