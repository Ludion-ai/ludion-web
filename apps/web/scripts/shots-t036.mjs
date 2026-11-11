// T036 のスクリーンショット（docs/tasks/T036.md の終わりの条件）。docs/screens/t036-*.png に撮る。
// npm run build の後に node scripts/shots-t036.mjs。使い捨ての D1 と R2（.wrangler/shots-t036-state）と、偽の GitHub で動かす。
// 開発用の .wrangler/state と、本物の .dev.vars の値には触らない（dist の写しだけを偽の GitHub に向ける。scripts/test-server.mjs と同じ）。
// 撮るもの：/new の選ぶところ、自分の置き場（5つの状態）、確かめの一言、リミックスの帯（元が見られない）、自分だけの作品のページ。
// 幅は 1440 と 390、ライトとダーク。
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(webDir, '../..');
const outDir = join(repo, 'docs/screens');
const persistDir = join(webDir, '.wrangler/shots-t036-state');
const githubPort = Number(process.env.LD_SHOTS_GITHUB_PORT ?? 4291);
const port = Number(process.env.LD_SHOTS_PORT ?? 4290);
const base = `http://127.0.0.1:${port}`;
const fakeGitHub = `http://localhost:${githubPort}`;
const wrangler = join(repo, 'node_modules/wrangler/bin/wrangler.js');

if (!existsSync(join(webDir, 'dist/ludion_web'))) throw new Error('先に npm run build');

// dist の写しの .dev.vars だけを偽の GitHub に向ける
const devVars = join(webDir, 'dist/ludion_web/.dev.vars');
const kept = existsSync(devVars) ? readFileSync(devVars, 'utf8').split('\n').filter((line) => line && !/^(GITHUB_|GOOGLE_|PASSKEY_|RATE_KEY_SECRET|POSTING_OPEN)/.test(line)) : [];
writeFileSync(
  devVars,
  `${[...kept, `GITHUB_CLIENT_ID='fake'`, `GITHUB_CLIENT_SECRET='fake'`, `GITHUB_WEB_URL='${fakeGitHub}'`, `GITHUB_API_URL='${fakeGitHub}'`, `RATE_KEY_SECRET='shots'`, `POSTING_OPEN='1'`].join('\n')}\n`,
);

rmSync(persistDir, { recursive: true, force: true });
const script = (name) => execFileSync(process.execPath, [join(webDir, 'scripts', name)], { cwd: webDir, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, LD_PERSIST_DIR: persistDir } });
script('migrate.mjs');
script('seed-dev.mjs');
const d1 = (sql) =>
  JSON.parse(execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', persistDir, '--json', '--command', sql], { cwd: webDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;

const servers = [
  spawn(process.execPath, [join(webDir, 'scripts/fake-github.mjs')], { cwd: webDir, stdio: 'ignore', env: { ...process.env, LD_TEST_GITHUB_PORT: String(githubPort) } }),
  spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: webDir,
    stdio: 'ignore',
    env: { ...process.env, LD_PERSIST_DIR: persistDir, LD_NO_INSPECTOR: '1' },
  }),
];
const stop = () => servers.forEach((server) => server.kill());
process.on('exit', stop);

for (let i = 0; ; i += 1) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  if (i > 120) throw new Error('サーバーが立たない');
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** 手元の PNG（サムネイルの見本）。 */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const name = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
    return Buffer.concat([length, name, data, crc]);
  };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at++] = 0;
    for (let x = 0; x < width; x += 1) for (const value of [40 + ((x * 120) / width), 90 + ((y * 100) / height), 170, 255]) raw[at++] = value;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const THUMB = png(900, 600);

/** cookie を持つ訪問者（e2e/visitor.ts と同じ形）。 */
class Visitor {
  cookies = new Map();
  async fetch(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const response = await fetch(new URL(path, base), { redirect: 'manual', ...init, headers });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      const value = pair.slice(index + 1);
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(pair.slice(0, index));
      else this.cookies.set(pair.slice(0, index), value);
    }
    return response;
  }
  post(path, body) {
    return this.fetch(path, { method: 'POST', headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async login(login) {
    const start = await this.fetch('/auth/github?next=/');
    const authorize = new URL(start.headers.get('location'));
    authorize.searchParams.set('login_as', login);
    const back = await fetch(authorize, { redirect: 'manual' });
    await this.fetch(back.headers.get('location'));
    return (await (await this.fetch('/api/me')).json()).user.handle;
  }
}

const CONFIRM = { own: true, mit: true, terms: true };
const html = (id, label) => `<div data-ld-part="${id}"><button type="button" class="b">${label}</button></div>`;
const css = (id) =>
  `[data-ld-part="${id}"] { --_accent: var(--ld-accent, #2f6fdf); --_radius: var(--ld-radius, 10px); --_space: var(--ld-space, 8px); display: grid; place-items: center; min-height: 100%; }
[data-ld-part="${id}"] .b { background: var(--_accent); color: white; border: 0; border-radius: var(--_radius); padding: calc(var(--_space) * 1.5) calc(var(--_space) * 3); font: inherit; }`;

async function save(visitor, id, title, { thumb = true, remixOf } = {}) {
  const form = new FormData();
  form.append('meta', JSON.stringify({ id, title, category: 'Components', subtype: 'Button', tags: ['minimal'], motion: false, made_with: 'human', ...(remixOf ? { remix_of: remixOf } : {}) }));
  form.append('part.html', html(id, title));
  form.append('part.css', css(id));
  if (thumb) form.append('thumb', new Blob([THUMB], { type: 'image/png' }), 'x.png');
  const response = await visitor.fetch('/api/post/works', { method: 'POST', body: form, headers: { Origin: base } });
  if (!response.ok) throw new Error(`save ${id}: ${response.status} ${await response.text()}`);
  return (await response.json()).revision;
}

const owner = new Visitor();
const ownerLogin = 'shots-owner';
await owner.login(ownerLogin);
const reviewer = new Visitor();
const reviewerHandle = await reviewer.login('shots-reviewer');
d1(`UPDATE users SET is_operator = 1 WHERE handle = '${reviewerHandle}'`);
const remixer = new Visitor();
await remixer.login('shots-remixer');

const approve = async (revision) => {
  const response = await reviewer.post(`/api/review/revisions/${revision.id}/approve`, { content_hash: revision.content_hash });
  if (!response.ok) throw new Error(`approve: ${response.status}`);
};
// 5つの状態：公開、差し戻し、審査待ち、下書き、自分だけ（新しく変えた順に並ぶので、見せたい順の逆に作る）
const pub = await save(owner, 'aurora-button', 'オーロラのボタン');
await owner.post(`/api/post/revisions/${pub.id}/submit`, CONFIRM);
await approve(pub);
const child = await save(remixer, 'aurora-button-remix', 'オーロラのボタンのリミックス', { remixOf: 'aurora-button' });
await remixer.post(`/api/post/revisions/${child.id}/submit`, CONFIRM);
await approve(child);
const gone = await save(owner, 'old-source', '前に公開した部品');
await owner.post(`/api/post/revisions/${gone.id}/submit`, CONFIRM);
await approve(gone);
const goneChild = await save(remixer, 'old-source-remix', '元が見られないリミックス', { remixOf: 'old-source' });
await remixer.post(`/api/post/revisions/${goneChild.id}/submit`, CONFIRM);
await approve(goneChild);
await owner.post('/api/post/works/old-source/make-private');
const rejected = await save(owner, 'glass-card', 'ガラスのカード');
await owner.post(`/api/post/revisions/${rejected.id}/submit`, CONFIRM);
await reviewer.post(`/api/review/revisions/${rejected.id}/reject`, { reason: 'rights', note: 'ロゴの場所を空にしてください' });
const pending = await save(owner, 'soft-toggle', 'やわらかいスイッチ');
await owner.post(`/api/post/revisions/${pending.id}/submit`, CONFIRM);
await save(owner, 'draft-slider', '', { thumb: false });
const own = await save(owner, 'night-switch', '夜のスイッチ', { thumb: false });
await owner.post(`/api/post/revisions/${own.id}/place`, CONFIRM);

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const log = [];

for (const scheme of ['light', 'dark']) {
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme });
    await context.addCookies([{ name: 'fake_user', value: ownerLogin, url: fakeGitHub }]);
    const page = await context.newPage();
    const shot = async (name, target = page, options = {}) => {
      await page.evaluate(() => document.fonts.ready);
      const path = join(outDir, `t036-${name}-${width}-${scheme}.png`);
      await target.screenshot({ path, ...options });
      log.push(`t036-${name}-${width}-${scheme}.png  ${new URL(page.url()).pathname}  横のはみ出し ${await overflowOf(page)}px`);
    };
    await page.goto(`${base}/auth/github?next=${encodeURIComponent('/new')}`);
    await page.waitForURL(`${base}/new`);

    // /new の選ぶところ
    const id = `shot-${width}-${scheme}`;
    await page.getByLabel('HTML を貼る、またはファイルを落とす').fill(`${html(id, '押す')}\n<style>\n${css(id)}\n</style>`);
    await page.locator('[data-box-status]').filter({ hasText: '下書きを保存しました' }).waitFor();
    await page.getByLabel('題名', { exact: true }).fill('夜のボタン');
    const choice = page.locator('[data-visibility]');
    await choice.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await shot('new-choice');

    // 自分の置き場
    await page.goto(`${base}/account/works`);
    await page.locator('[data-own-work]').first().waitFor();
    await shot('works', page, { fullPage: true });

    // 確かめの一言
    const row = page.locator('[data-own-work="aurora-button"]');
    await row.getByRole('button', { name: /を自分だけにする$/ }).click();
    await row.locator('[data-own-work-confirm]').waitFor();
    await row.scrollIntoViewIfNeeded();
    await shot('confirm');

    // リミックスの帯（元が見られない）
    await page.goto(`${base}/p/old-source-remix`);
    await page.locator('[data-remix-source]').waitFor();
    await shot('band');

    // 自分だけの作品のページ
    await page.goto(`${base}/p/night-switch`);
    await page.locator('[data-private-notice]').waitFor();
    await page.frameLocator('iframe[data-ld-frame]').locator('#ld-host').waitFor({ state: 'attached' });
    await page.waitForTimeout(500);
    await shot('private-page');
    await context.close();
  }
}
await browser.close();
console.log(log.join('\n'));
stop();
process.exit(0);
