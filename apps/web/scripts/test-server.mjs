// テスト用のサーバー（playwright.config.ts の webServer）。ビルドの後に動く。
// 3つのサーバーを、それぞれ使い捨ての D1 と R2 で動かす。開発用の .wrangler/state には触らない。
// - LD_TEST_PORT：seed の50作品だけが入ったもの（ホームのテスト）
// - LD_TEST_UPLOAD_PORT：空のもの（ld upload のテスト。作品が増減するので、ホームのテストと分ける）
// - LD_TEST_PAGES_PORT：開発のデータ全部（作品のページのテスト。開くと閲覧数が増えるので、ホームのテストと分ける）
// - LD_TEST_ACCOUNTS_PORT：開発のデータ全部（ログイン、いいね、しおりのテスト。いいねの数が動くので分ける）
// - LD_TEST_MIGRATION_PORT：今の本番と同じ形の行を 0001 の形で入れ、本番と同じ migrations apply で移したもの（docs/tasks/T020.md「4」）
// - LD_TEST_PASSKEY_PORT：seed の50作品（パスキーのテスト。localhost で開く）
// どのサーバーの Worker も、ログインは手元の偽の GitHub（LD_TEST_GITHUB_PORT）と偽の Google（LD_TEST_GOOGLE_PORT）へ行く。
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARK_0001_APPLIED, oldShapeSql } from './migration-fixture.mjs';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  LD_PERSIST_DIR: seededDir,
  LD_TEST_UPLOAD_PERSIST_DIR: uploadDir,
  LD_TEST_PAGES_PERSIST_DIR: pagesDir,
  LD_TEST_ACCOUNTS_PERSIST_DIR: accountsDir,
  LD_TEST_MIGRATION_PERSIST_DIR: migrationDir,
  LD_TEST_PASSKEY_PERSIST_DIR: passkeyDir,
  LD_TEST_PORT: port,
  LD_TEST_UPLOAD_PORT: uploadPort,
  LD_TEST_PAGES_PORT: pagesPort,
  LD_TEST_ACCOUNTS_PORT: accountsPort,
  LD_TEST_MIGRATION_PORT: migrationPort,
  LD_TEST_PASSKEY_PORT: passkeyPort,
  LD_TEST_GITHUB_PORT: githubPort,
  LD_TEST_GOOGLE_PORT: googlePort,
} = process.env;
if (!seededDir || !uploadDir || !pagesDir || !accountsDir || !migrationDir || !passkeyDir || !passkeyPort || !port || !uploadPort || !pagesPort || !accountsPort || !migrationPort || !githubPort || !googlePort) {
  throw new Error(
    'LD_PERSIST_DIR、LD_TEST_UPLOAD_PERSIST_DIR、LD_TEST_PAGES_PERSIST_DIR、LD_TEST_ACCOUNTS_PERSIST_DIR、LD_TEST_MIGRATION_PERSIST_DIR、LD_TEST_PASSKEY_PERSIST_DIR、LD_TEST_PASSKEY_PORT、LD_TEST_PORT、LD_TEST_UPLOAD_PORT、LD_TEST_PAGES_PORT、LD_TEST_ACCOUNTS_PORT、LD_TEST_MIGRATION_PORT、LD_TEST_GITHUB_PORT、LD_TEST_GOOGLE_PORT が要る（playwright.config.ts が渡す）',
  );
}

/**
 * vite preview は、ビルドが dist に写した .dev.vars を読む。その写しだけを偽の GitHub と偽の Google に向け、回数の制限の鍵の秘密の値をテストの値にする。
 * 本物の client id と secret が apps/web/.dev.vars にあっても、テストでは使わない（偽のサーバーにも送らない）。
 * 本番の設定（dist の wrangler.json の vars）は変えない。
 */
function writeTestVars() {
  const devVars = join(webDir, 'dist/ludion_web/.dev.vars');
  const kept = existsSync(devVars) ? readFileSync(devVars, 'utf8').split('\n').filter((line) => line && !line.startsWith('GITHUB_') && !line.startsWith('GOOGLE_') && !line.startsWith('PASSKEY_') && !line.startsWith('RATE_KEY_SECRET') && !line.startsWith('POSTING_OPEN')) : [];
  // Chrome は 127.0.0.1 と localhost を別のサイトとして扱う。本物と同じく、GitHub から別のサイトとして戻ってくる
  const url = `http://localhost:${githubPort}`;
  const google = `http://localhost:${googlePort}`;
  const fake = [
    `GITHUB_CLIENT_ID='fake-client-id'`,
    `GITHUB_CLIENT_SECRET='fake-client-secret'`,
    `GITHUB_WEB_URL='${url}'`,
    `GITHUB_API_URL='${url}'`,
    `GOOGLE_CLIENT_ID='fake-google-client-id'`,
    `GOOGLE_CLIENT_SECRET='fake-google-client-secret'`,
    `GOOGLE_AUTH_URL='${google}/o/oauth2/v2/auth'`,
    `GOOGLE_TOKEN_URL='${google}/token'`,
    `GOOGLE_JWKS_URL='${google}/certs'`,
    `GOOGLE_ISSUER='${google}'`,
    `PASSKEY_RP_ID='localhost'`,
    `PASSKEY_ORIGIN='http://localhost:${passkeyPort}'`,
    `RATE_KEY_SECRET='test-rate-key-secret'`,
    // 投稿を開いた形で試す。閉じた形は e2e/post.spec.ts が Worker を直に呼んで確かめる
    `POSTING_OPEN='1'`,
  ];
  writeFileSync(devVars, `${[...kept, ...fake].join('\n')}\n`);
}
writeTestVars();

const bin = (path) => join(webDir, '../../node_modules', path);
const script = (name, persistDir, extraEnv = {}) =>
  execFileSync(process.execPath, [join(webDir, 'scripts', name)], {
    cwd: webDir,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, LD_PERSIST_DIR: persistDir, ...extraEnv },
  });

rmSync(seededDir, { recursive: true, force: true });
rmSync(uploadDir, { recursive: true, force: true });
rmSync(pagesDir, { recursive: true, force: true });
rmSync(accountsDir, { recursive: true, force: true });
rmSync(migrationDir, { recursive: true, force: true });
rmSync(passkeyDir, { recursive: true, force: true });
script('migrate.mjs', seededDir);
script('seed-dev.mjs', seededDir, { LD_SEED_NO_FIXTURES: '1' });
script('migrate.mjs', uploadDir);
script('migrate.mjs', pagesDir);
script('seed-dev.mjs', pagesDir);
script('migrate.mjs', accountsDir);
script('seed-dev.mjs', accountsDir);
script('migrate.mjs', passkeyDir);
script('seed-dev.mjs', passkeyDir, { LD_SEED_NO_FIXTURES: '1' });

/** 手元の D1 に SQL を流す。 */
const d1 = (persistDir, ...args) =>
  execFileSync(process.execPath, [bin('wrangler/bin/wrangler.js'), 'd1', 'execute', 'ludion-app', '--local', '--persist-to', persistDir, ...args], {
    cwd: webDir,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, CI: '1' },
  });
// 0001 までを流した本番と同じ形にしてから、本番と同じ道で移す
d1(migrationDir, '--file', join(webDir, 'migrations/0001_init.sql'));
d1(migrationDir, '--command', MARK_0001_APPLIED);
d1(migrationDir, '--command', oldShapeSql());
script('migrate.mjs', migrationDir);

const preview = (persistDir, listenPort) =>
  spawn(process.execPath, [bin('vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', listenPort, '--strictPort'], {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, LD_PERSIST_DIR: persistDir, LD_NO_INSPECTOR: '1' },
  });

const fakeGitHub = spawn(process.execPath, [join(webDir, 'scripts/fake-github.mjs')], { cwd: webDir, stdio: 'inherit' });
const fakeGoogle = spawn(process.execPath, [join(webDir, 'scripts/fake-google.mjs')], { cwd: webDir, stdio: 'inherit' });
const servers = [fakeGitHub, fakeGoogle, preview(seededDir, port), preview(uploadDir, uploadPort), preview(pagesDir, pagesPort), preview(accountsDir, accountsPort), preview(migrationDir, migrationPort), preview(passkeyDir, passkeyPort)];
const stop = () => servers.forEach((server) => server.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
servers.forEach((server) =>
  server.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  }),
);
