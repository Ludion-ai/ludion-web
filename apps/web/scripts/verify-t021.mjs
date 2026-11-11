// T021 の本番の確かめ（docs/tasks/T021.md）。本番の D1、R2、サイトに当たるので、許可を得てから流す。
//
// node scripts/verify-t021.mjs site    ログインせずに見える道。読むだけ
// node scripts/verify-t021.mjs flow    （投稿を開いた後。POSTING_OPEN が "1" のとき）使い捨ての人を入れて、下書き → 枠 → 審査に出す → 差し戻し → 取り下げまで通し、終わったら必ず消す。
//                                      公開はしない（新着に一瞬でも出さないため。承認は e2e で確かめ、本番の最初の承認は CEO が見る）。
//
// node scripts/verify-t021.mjs browser  本物のブラウザで /new から審査に出すまで通し、自分の作品で見て、取り下げる。必ず消す。--shots で本番の画面を撮る
// node scripts/verify-t021.mjs review   使い捨ての運営で /admin/review を開く。審査待ちの作品を作り、差し戻す（公開しない）。必ず消す
//
// 数は増やさない（CLAUDE.md 原則10）。実在の人の名前と id は画面に出さない（原則6）。GA4 を読まない（fetch だけで確かめる）。

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '../..');
const wrangler = join(repoDir, 'node_modules/wrangler/bin/wrangler.js');
const PROD = 'https://ludion.ai';
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const USER_AGENT = 'ludion-verify-t021';
const NO_ANALYTICS = '--host-resolver-rules=MAP *.googletagmanager.com 127.0.0.1:9, MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9';
const SHOTS = process.argv.includes('--shots');
const SCREENS = join(repoDir, 'docs/screens');

let failed = 0;
function check(label, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '通った' : '落ちた'}：${label}${detail ? `（${detail}）` : ''}`);
}

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ludion-app', '--remote', '--json', '--command', sql], { cwd: webDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out)[0].results;
}

function r2Delete(key) {
  execFileSync(process.execPath, [wrangler, 'r2', 'object', 'delete', `ludion-parts/${key}`, '--remote'], { cwd: webDir, stdio: ['ignore', 'ignore', 'inherit'] });
}

const get = (path, init = {}) => fetch(`${PROD}${path}`, { redirect: 'manual', ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) } });

/** wrangler.jsonc の POSTING_OPEN。 */
const postingOpen = () => /"POSTING_OPEN":\s*"1"/.test(readFileSync(join(webDir, 'wrangler.jsonc'), 'utf8'));

async function site() {
  const newPage = await get('/new');
  if (postingOpen()) check('/new はログインへ送る', newPage.status === 302 && newPage.headers.get('location') === '/login?next=%2Fnew', String(newPage.status));
  else check('投稿を開くまで、/new は 404 で、画面も出さない', newPage.status === 404 && (await newPage.text()).includes('このページはありません'), String(newPage.status));
  const adminPage = await get('/admin/review');
  check('/admin/review は運営でなければ 404 で、画面も出さない', adminPage.status === 404 && (await adminPage.text()).includes('このページはありません'), String(adminPage.status));
  for (const path of ['/api/post/works', '/api/post/id-check?id=abc']) check(`${path} はログインが要る`, (await get(path)).status === 401);
  for (const path of ['/api/review/queue', '/api/review/revisions/0123456789abcdef0123456789abcdef']) check(`${path} は運営でなければ 404`, (await get(path)).status === 404);
  const foreign = await get('/api/post/works', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: 'x' });
  check('外の Origin の投稿は 403', foreign.status === 403, String(foreign.status));
  const noOrigin = await get('/api/post/works', { method: 'POST', body: 'x' });
  check('Origin のない投稿は 403', noOrigin.status === 403, String(noOrigin.status));
  const draftFrame = await get('/draft-frame/0123456789abcdef0123456789abcdef/desktop.html', { headers: FROM_IFRAME });
  check('下書きの枠は見られない', draftFrame.status === 404, String(draftFrame.status));
  const draftDirect = await get('/draft-frame/0123456789abcdef0123456789abcdef/desktop.html');
  check('下書きの枠を直に開くと戻す', draftDirect.status === 302 && draftDirect.headers.get('location') === '/account/works', String(draftDirect.status));
  check('下書きのサムネイルは見られない', (await get('/draft-thumb/0123456789abcdef0123456789abcdef.webp')).status === 404);

  const { works } = await (await get('/api/works')).json();
  check('作品が今までどおり出る', works.length > 0, `${works.length}件`);
  const leak = JSON.stringify(works);
  check('公開の API に made_with が出ない', !leak.includes('made_with'));
  for (const work of works) {
    const frame = await get(`/frame/${work.id}/${work.version}/desktop.html`, { headers: FROM_IFRAME });
    const thumb = await get(`/w/${work.id}/${work.version}/thumb.webp`);
    const og = await get(`/w/${work.id}/${work.version}/og.png`);
    const page = await get(`/p/${work.id}`);
    check(
      `${work.id} 版 ${work.version} が版の表から読める`,
      frame.status === 200 && thumb.status === 200 && og.status === 200 && page.status === 200,
      `枠 ${frame.status}、サムネイル ${thumb.status}、OG ${og.status}、ページ ${page.status}`,
    );
    const control = thumb.headers.get('cache-control');
    check(`${work.id} のサムネイルをブラウザに1時間だけ残す`, control === 'public, max-age=3600, s-maxage=31536000', control);
    const csp = frame.headers.get('content-security-policy') ?? '';
    check(`${work.id} の枠の守りが今までどおり`, csp.includes('sandbox allow-scripts allow-forms') && !csp.includes('allow-same-origin') && frame.headers.get('cache-control') === 'private, no-store');
  }
  console.log(['revisions', 'works', 'quotas'].map((table) => `${table} ${d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n}`).join('、'));
  const [{ n: mismatch }] = d1(`SELECT COUNT(*) AS n FROM works w WHERE w.status = 'approved' AND NOT EXISTS (SELECT 1 FROM revisions r WHERE r.work_id = w.id AND r.version = w.version AND r.status = 'approved')`);
  check('公開の作品は全部、承認済みの版の行がある', mismatch === 0, `${mismatch}件ない`);
  const [{ n: operators }] = d1('SELECT COUNT(*) AS n FROM users WHERE is_operator = 1');
  check('運営の印の人は1人', operators === 1, `${operators}人`);
}

async function flow() {
  const stamp = Date.now();
  const suffix = randomBytes(4).toString('hex');
  const userId = `verify-t021-${suffix}`;
  const handle = `verify_${suffix}`;
  const workId = `verify-t021-${suffix}`;
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const cookie = { Cookie: `ld_session=${token}`, Origin: PROD };
  const before = Object.fromEntries(['users', 'sessions', 'creators', 'works', 'revisions'].map((table) => [table, d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n]));

  const css = `[data-ld-part="${workId}"] { color: #123456; }`;
  const html = `<div data-ld-part="${workId}"><button type="button">確かめ</button></div>`;
  const form = (over = {}) => {
    const body = new FormData();
    body.append('meta', JSON.stringify({ id: workId, title: `本番の確かめ ${suffix}`, category: 'Components', subtype: 'Button', tags: [], motion: false, made_with: 'human', ...over.meta }));
    body.append('part.html', new Blob([over.html ?? html]));
    body.append('part.css', new Blob([css]));
    if (over.thumb !== null) body.append('thumb', new Blob([over.thumb ?? readFileSync(join(repoDir, 'fixtures/works/fx-button/og.png'))]));
    return body;
  };

  let prefixes = [];
  try {
    d1(
      `INSERT INTO users (id, handle, display_name, avatar_url, created_at) VALUES ('${userId}', '${handle}', NULL, NULL, ${stamp});` +
        `INSERT INTO sessions (token_hash, user_id, expires_at, auth_at) VALUES ('${hash}', '${userId}', ${stamp + 10 * 60 * 1000}, ${stamp});`,
    );

    // 運営でない、ログインした人が投稿できる（T032 で開いた後）
    check('使い捨ての人は運営でない', d1(`SELECT is_operator FROM users WHERE id = '${userId}'`)[0].is_operator === 0);
    const me = await (await get('/api/me', { headers: cookie })).json();
    check('/api/me の can_post が true', me.can_post === true, String(me.can_post));
    const newPage = await get('/new', { headers: cookie });
    check('/new が開く', newPage.status === 200, String(newPage.status));

    const bad = await get('/api/post/works', { method: 'POST', headers: cookie, body: form({ html: `<div data-ld-part="${workId}"><input onfocus="x()"></div>` }) });
    check('イベント属性は 422', bad.status === 422, String(bad.status));
    const broken = await get('/api/post/works', { method: 'POST', headers: cookie, body: form({ thumb: readFileSync(join(repoDir, 'fixtures/works/fx-button/thumb.webp')).subarray(0, 400) }) });
    check('壊れた画像は 422（本番の wasm で読み直す）', broken.status === 422 && (await broken.json()).error === 'thumb_broken', String(broken.status));
    const forged = await get('/api/post/works', { method: 'POST', headers: cookie, body: form({ meta: { publish: true } }) });
    check('publish の偽りは 400', forged.status === 400, String(forged.status));

    const started = Date.now();
    const saved = await get('/api/post/works', { method: 'POST', headers: cookie, body: form() });
    const body = await saved.json();
    check('下書きを保存できる（本番の wasm で画像を作り直す）', saved.status === 201, `${saved.status}、${Date.now() - started}ms`);
    const revision = body.revision;

    const [row] = d1(`SELECT status, r2_prefix, thumb_w, thumb_h FROM revisions WHERE id = '${revision.id}'`);
    prefixes.push(row.r2_prefix);
    check('版の行と R2 のキーはサーバーが作る', row.status === 'draft' && row.r2_prefix.startsWith(`revisions/${revision.id}/`) && row.thumb_w === 800);
    check('作者は person で、人に結ばれる', d1(`SELECT kind FROM creators WHERE handle = '${handle}' AND user_id = '${userId}'`)[0]?.kind === 'person');

    const thumb = await get(revision.thumb, { headers: cookie });
    const bytes = new Uint8Array(await thumb.arrayBuffer());
    check('サムネイルが WebP で返る。キャッシュしない', thumb.status === 200 && thumb.headers.get('cache-control') === 'private, no-store' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP', `${bytes.length} バイト`);
    const frame = await get(revision.frames.desktop, { headers: { ...cookie, ...FROM_IFRAME } });
    const frameCsp = frame.headers.get('content-security-policy') ?? '';
    check('持ち主は下書きの枠を見られる。守りは同じ', frame.status === 200 && frameCsp.includes('sandbox allow-scripts allow-forms') && !frameCsp.includes('allow-same-origin') && (await frame.text()).includes('確かめ'));
    check('ほかの人は下書きの枠を見られない', (await get(revision.frames.desktop, { headers: FROM_IFRAME })).status === 404);
    const listed = await (await get('/api/works')).json();
    check('下書きは公開に出ない', !listed.works.some((work) => work.id === workId) && (await get(`/p/${workId}`)).status === 404);

    const noConfirm = await get(`/api/post/revisions/${revision.id}/submit`, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: '{}' });
    check('確かめがなければ審査に出せない', noConfirm.status === 400, String(noConfirm.status));
    const sent = await get(`/api/post/revisions/${revision.id}/submit`, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ own: true, mit: true, terms: true }) });
    check('審査に出せる', sent.status === 200, String(sent.status));
    check('審査中は公開に出ない', (await get(`/w/${workId}/1/thumb.webp`)).status === 404);
    const edit = await get(`/api/post/works/${workId}/revisions`, { method: 'POST', headers: cookie, body: form({ thumb: null, meta: { id: undefined } }) });
    check('審査中は直せない', edit.status === 409, String(edit.status));
    check('本人は審査の API を使えない', (await get(`/api/review/revisions/${revision.id}/approve`, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ content_hash: revision.content_hash }) })).status === 404);

    const revoked = await get(`/api/post/works/${workId}/revoke`, { method: 'POST', headers: cookie });
    check('取り下げられる', revoked.status === 200, String(revoked.status));
    check('取り下げた版は revoked', d1(`SELECT status FROM revisions WHERE id = '${revision.id}'`)[0].status === 'revoked');
    const queue = d1(`SELECT COUNT(*) AS n FROM revisions WHERE work_id = '${workId}' AND status = 'submitted'`)[0].n;
    check('審査待ちに残らない', queue === 0);
  } finally {
    // R2 のファイルを消す。行を消す前に、置き場を全部読む
    const rows = d1(`SELECT r2_prefix FROM revisions WHERE work_id = '${workId}'`);
    prefixes = [...new Set([...prefixes, ...rows.map((row) => row.r2_prefix)])];
    for (const prefix of prefixes) for (const name of ['meta.json', 'part.html', 'part.css', 'part.js', 'thumb.webp', 'og.png']) r2Delete(`${prefix}/${name}`);
    d1(
      `DELETE FROM revisions WHERE work_id = '${workId}'; DELETE FROM works WHERE id = '${workId}'; DELETE FROM creators WHERE user_id = '${userId}'; DELETE FROM quotas WHERE key IN ('save:${userId}', 'revision:${userId}');` +
        `DELETE FROM sessions WHERE user_id = '${userId}'; DELETE FROM users WHERE id = '${userId}';`,
    );
    const after = Object.fromEntries(Object.keys(before).map((table) => [table, d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n]));
    // 本番に今も人が来ているので、減っていないこと、自分の分が残っていないことを見る
    check('使い捨ての人と作品が残っていない', d1(`SELECT (SELECT COUNT(*) FROM users WHERE id = '${userId}') + (SELECT COUNT(*) FROM works WHERE id = '${workId}') + (SELECT COUNT(*) FROM revisions WHERE work_id = '${workId}') + (SELECT COUNT(*) FROM creators WHERE handle = '${handle}') AS n`)[0].n === 0);
    for (const table of Object.keys(before)) check(`${table} の行が減っていない`, after[table] >= before[table], `${before[table]} → ${after[table]}`);
  }
}

/** 使い捨ての人を入れて run を動かし、作品、版、R2 のファイルごと必ず消す。 */
async function withTempPerson({ operator = false }, run) {
  const stamp = Date.now();
  const suffix = randomBytes(4).toString('hex');
  const person = { id: `verify-t021-${suffix}`, handle: `verify_${suffix}`, suffix, token: randomBytes(32).toString('hex') };
  const hash = createHash('sha256').update(person.token).digest('hex');
  d1(
    `INSERT INTO users (id, handle, display_name, avatar_url, created_at, is_operator) VALUES ('${person.id}', '${person.handle}', NULL, NULL, ${stamp}, ${operator ? 1 : 0});` +
      `INSERT INTO sessions (token_hash, user_id, expires_at, auth_at) VALUES ('${hash}', '${person.id}', ${stamp + 15 * 60 * 1000}, ${stamp});`,
  );
  try {
    await run(person);
  } finally {
    const rows = d1(`SELECT r.r2_prefix, r.work_id FROM revisions r JOIN works w ON w.id = r.work_id JOIN creators c ON c.id = w.creator_id WHERE c.user_id = '${person.id}'`);
    const prefixes = [...new Set(rows.map((row) => row.r2_prefix))];
    for (const prefix of prefixes) for (const name of ['meta.json', 'part.html', 'part.css', 'part.js', 'thumb.webp', 'og.png']) r2Delete(`${prefix}/${name}`);
    const works = [...new Set(rows.map((row) => `'${row.work_id}'`))].join(', ');
    d1(
      (works ? `DELETE FROM revisions WHERE work_id IN (${works}); DELETE FROM works WHERE id IN (${works});` : '') +
        `DELETE FROM creators WHERE user_id = '${person.id}'; DELETE FROM quotas WHERE key IN ('save:${person.id}', 'revision:${person.id}'); DELETE FROM sessions WHERE user_id = '${person.id}'; DELETE FROM users WHERE id = '${person.id}';`,
    );
    check('使い捨ての人が残っていない', d1(`SELECT COUNT(*) AS n FROM users WHERE id LIKE 'verify-t021-%'`)[0].n === 0);
    check('使い捨ての作品が残っていない', d1(`SELECT COUNT(*) AS n FROM works WHERE id LIKE 'verify-%'`)[0].n === 0);
  }
}

const THUMB_FILE = join(repoDir, 'fixtures/works/fx-button/og.png');
const htmlOf = (id) => `<div data-ld-part="${id}"><button type="button">押す</button></div>`;
const cssOf = (id) => `[data-ld-part="${id}"] { color: #123456; }`;
const jsOf = `export function mount(root) {
  const button = root.querySelector('button');
  const onClick = () => { button.textContent = '押された'; };
  button.addEventListener('click', onClick);
  return () => button.removeEventListener('click', onClick);
}`;

async function browserFlow() {
  for (const [label, launch] of [['chromium', () => chromium.launch({ args: [NO_ANALYTICS] })], ['webkit', () => webkit.launch()]]) {
    // 全員に開くまでは、運営でなければ投稿できない
    await withTempPerson({ operator: !postingOpen() }, async (person) => {
      const browser = await launch();
      try {
        for (const { width, height, shot } of label === 'chromium' ? [{ width: 390, height: 844, shot: true }, { width: 1440, height: 900, shot: true }] : [{ width: 390, height: 844, shot: false }]) {
          const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height } });
          await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
          await context.addCookies([{ name: 'ld_session', value: person.token, domain: 'ludion.ai', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const id = `verify-${person.suffix}-${width}`;
          await page.goto(`${PROD}/new`);
          await page.getByLabel('題名').fill(`本番の確かめ ${person.suffix}`);
          await page.getByLabel('作品の ID').fill(id);
          await page.getByText('使えます').waitFor();
          await page.getByLabel('自分の手で作った').check();
          await page.getByRole('textbox', { name: 'HTML（part.html）' }).fill(`<div data-ld-part="${id}" onclick="x()"><button type="button">押す</button></div>`);
          await page.getByRole('textbox', { name: 'CSS（part.css）' }).fill(cssOf(id));
          await page.getByRole('textbox', { name: 'JS（part.js）' }).fill(jsOf);
          await page.locator('[data-post-check]').getByText('イベント属性 onclick').waitFor();
          check(`${label} 幅${width}：打つと検査の結果が出る`, true);
          if (shot && SHOTS) await page.screenshot({ path: join(SCREENS, `t021-prod-new-${width}.png`), fullPage: true });
          await page.getByRole('textbox', { name: 'HTML（part.html）' }).fill(htmlOf(id));
          await page.locator('[data-post-check]').getByText('必須の確かめは全部通りました').waitFor();
          await page.locator('input[type="file"][accept^="image/"]').setInputFiles(THUMB_FILE);
          await page.getByRole('button', { name: '下書きを保存' }).click();
          await page.getByText('下書きを保存しました').waitFor({ timeout: 30_000 });
          check(`${label} 幅${width}：下書きを保存できる`, true);
          const button = page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' });
          await button.waitFor();
          await button.click();
          await page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押された' }).waitFor();
          check(`${label} 幅${width}：下書きの枠で動く`, (await page.locator('iframe[data-ld-frame]').getAttribute('sandbox')) === 'allow-scripts allow-forms');
          await page.getByRole('button', { name: 'モバイル', exact: true }).click();
          await page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' }).waitFor();
          check(`${label} 幅${width}：スマホの幅の枠でも動く`, (await page.locator('iframe[data-ld-frame]').getAttribute('src')).includes('/mobile.html'));
          await page.getByLabel(/自分で作った、または権利がある/).check();
          await page.getByLabel(/MIT で公開してよい/).check();
          await page.getByLabel(/に同意します/).check();
          await page.getByRole('button', { name: '審査に出す' }).click();
          await page.getByText('審査に出しました').waitFor();
          check(`${label} 幅${width}：審査に出せる`, true);
          await page.goto(`${PROD}/account/works`);
          const row = page.locator(`[data-own-work="${id}"]`);
          await row.locator('[data-own-work-status]').getByText('審査中').waitFor();
          check(`${label} 幅${width}：自分の作品に審査中と出る`, (await row.locator('img').evaluate((image) => image.decode().then(() => image.naturalWidth))) === 800);
          if (shot && SHOTS) await page.screenshot({ path: join(SCREENS, `t021-prod-works-${width}.png`) });
          await row.getByRole('button', { name: /を取り下げる$/ }).click();
          await row.getByRole('button', { name: '取り下げる', exact: true }).click();
          await row.locator('[data-own-work-status]').getByText('取り下げ').waitFor();
          check(`${label} 幅${width}：取り下げられる`, (await get(`/p/${id}`)).status === 404);
          check(`${label} 幅${width}：ページのエラーがない`, errors.length === 0, errors.join(' / '));
          await context.close();
        }
      } finally {
        await browser.close();
      }
    });
  }
}

async function reviewFlow() {
  await withTempPerson({ operator: true }, async (person) => {
    const browser = await chromium.launch({ args: [NO_ANALYTICS] });
    try {
      const cookie = { Cookie: `ld_session=${person.token}`, Origin: PROD };
      const id = `verify-${person.suffix}`;
      const body = new FormData();
      body.append('meta', JSON.stringify({ id, title: `本番の確かめ ${person.suffix}`, category: 'Components', subtype: 'Button', tags: [], motion: false, made_with: 'human' }));
      body.append('part.html', new Blob([htmlOf(id)]));
      body.append('part.css', new Blob([cssOf(id)]));
      body.append('part.js', new Blob([jsOf]));
      body.append('thumb', new Blob([readFileSync(THUMB_FILE)]));
      const saved = await get('/api/post/works', { method: 'POST', headers: cookie, body });
      check('審査待ちの見本を作れる', saved.status === 201, String(saved.status));
      const { revision } = await saved.json();
      const sent = await get(`/api/post/revisions/${revision.id}/submit`, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ own: true, mit: true, terms: true }) });
      check('審査に出せる', sent.status === 200, String(sent.status));

      const me = await (await get('/api/me', { headers: cookie })).json();
      check('/api/me に審査待ちの数が出る', typeof me.user.review_pending === 'number' && me.user.review_pending >= 1, String(me.user.review_pending));
      const stale = await get(`/api/review/revisions/${revision.id}/approve`, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ content_hash: 'stale' }) });
      check('見たものと違う中身は承認できない', stale.status === 409, String(stale.status));

      for (const { width, height } of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height } });
        await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
        await context.addCookies([{ name: 'ld_session', value: person.token, domain: 'ludion.ai', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${PROD}/admin/review`);
        await page.locator('[data-review-queue]').getByRole('button', { name: new RegExp(person.suffix) }).click();
        const item = page.locator(`[data-review-item="${revision.id}"]`);
        await item.waitFor();
        await page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' }).waitFor();
        check(`幅${width}：審査の枠で動く`, (await page.locator('iframe[data-ld-frame]').getAttribute('sandbox')) === 'allow-scripts allow-forms');
        check(`幅${width}：承認と差し戻しのボタンが最初の画面に見える`, await page.getByRole('button', { name: '承認', exact: true }).isVisible());
        check(`幅${width}：ページのエラーがない`, errors.length === 0, errors.join(' / '));
        if (SHOTS) await page.screenshot({ path: join(SCREENS, `t021-prod-review-${width}.png`) });
        await context.close();
      }

      // 公開しない。差し戻して、作り手に理由が見えることまで
      const rejected = await get(`/api/review/revisions/${revision.id}/reject`, { method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'other', note: '本番の確かめ' }) });
      check('差し戻せる', rejected.status === 200, String(rejected.status));
      const { works } = await (await get('/api/post/works', { headers: cookie })).json();
      const mine = works.find((work) => work.id === id);
      check('差し戻しの理由が作り手に見える', mine?.status === 'rejected' && mine.reject_note === '本番の確かめ');
      check('差し戻した作品は公開に出ない', (await get(`/p/${id}`)).status === 404);
    } finally {
      await browser.close();
    }
  });
  check('運営でない人には /admin/review が 404', (await get('/admin/review')).status === 404);
  check('運営の印の人は1人に戻る', d1('SELECT COUNT(*) AS n FROM users WHERE is_operator = 1')[0].n === 1);
}

const command = process.argv[2];
if (command === 'site') await site();
else if (command === 'flow') await flow();
else if (command === 'browser') await browserFlow();
else if (command === 'review') await reviewFlow();
else {
  console.error('node scripts/verify-t021.mjs site | flow | browser [--shots] | review [--shots]');
  process.exit(2);
}
console.log(failed === 0 ? '全部通った' : `落ちたもの ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
