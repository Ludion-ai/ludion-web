// T036 の本番の確かめ（docs/tasks/T036.md の終わりの条件「本番の確かめ」）。本番の D1、R2、サイトに当たる。
//
// node scripts/verify-t036.mjs
//   使い捨ての人（運営でない）を2人入れる。1人目が自分だけで置く → 2人目とログインしていない人には 404、本人には見え、残さない →
//   公開に回す（承認はしない）→ 審査待ちの間も 404 → 必ず消し、消し残しがないことを示す。
//
// 数は増やさない（CLAUDE.md 原則10）：ブラウザで作品のページを開かない（数えるのはブラウザの JS。ここは fetch だけ）。GA4 には繋がない。

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '../..');
const wrangler = join(repoDir, 'node_modules/wrangler/bin/wrangler.js');
const PROD = 'https://ludion.ai';
const USER_AGENT = 'ludion-verify-t036';
const THUMB_FILE = join(repoDir, 'fixtures/works/fx-button/og.png');
const NO_STORE = 'private, no-store';

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

const as = (token) => (path, init = {}) =>
  fetch(`${PROD}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...(token ? { Cookie: `ld_session=${token}` } : {}), ...(init.method === 'POST' ? { Origin: PROD } : {}), ...(init.headers ?? {}) },
  });
const postJson = (fetcher, path, body) => fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const stamp = Date.now();
const suffix = randomBytes(4).toString('hex');
const people = ['a', 'b'].map((tag) => ({ id: `verify-t036-${suffix}-${tag}`, handle: `verify_${suffix}${tag}`, token: randomBytes(32).toString('hex') }));
const tables = ['users', 'sessions', 'creators', 'works', 'revisions', 'counters'];
const before = Object.fromEntries(tables.map((table) => [table, d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n]));

check('migration 0008 が当たっている（works の状態に private がある）', d1(`SELECT sql FROM sqlite_master WHERE name = 'works'`)[0].sql.includes("'private'"));
check('migration 0008 が当たっている（版の状態に private がある）', d1(`SELECT sql FROM sqlite_master WHERE name = 'revisions'`)[0].sql.includes("'private'"));

d1(
  people
    .map(
      (one) =>
        `INSERT INTO users (id, handle, display_name, avatar_url, created_at, is_operator) VALUES ('${one.id}', '${one.handle}', NULL, NULL, ${stamp}, 0);` +
        `INSERT INTO sessions (token_hash, user_id, expires_at, auth_at) VALUES ('${createHash('sha256').update(one.token).digest('hex')}', '${one.id}', ${stamp + 20 * 60 * 1000}, ${stamp});`,
    )
    .join(''),
);

const [owner, other] = people;
const ownerFetch = as(owner.token);
const otherFetch = as(other.token);
const anonymous = as(null);
const id = `verify-${suffix}-own`;
try {
  // 1. 自分だけで置く（サムネイルあり。後で公開に回すため）
  const form = new FormData();
  form.append('meta', JSON.stringify({ id, title: `本番の確かめ ${suffix}`, category: 'Components', subtype: 'Button', tags: [], motion: false, made_with: 'human' }));
  form.append('part.html', new Blob([`<div data-ld-part="${id}"><button type="button">押す</button></div>`], { type: 'text/plain' }));
  form.append('part.css', new Blob([`[data-ld-part="${id}"] { color: #123456; }`], { type: 'text/plain' }));
  form.append('thumb', new Blob([readFileSync(THUMB_FILE)], { type: 'image/png' }), 'thumb.png');
  const saved = await ownerFetch('/api/post/works', { method: 'POST', body: form });
  const savedBody = await saved.json();
  check('下書きを保存できる', saved.status === 201, `${saved.status}`);
  const revision = savedBody.revision;
  const placed = await postJson(ownerFetch, `/api/post/revisions/${revision.id}/place`, { own: true, mit: true, terms: true });
  check('自分だけで置ける（審査なし）', placed.status === 200, `${placed.status} ${await placed.text()}`);
  const [row] = d1(`SELECT w.status AS work, r.status AS revision FROM works w JOIN revisions r ON r.work_id = w.id WHERE w.id = '${id}'`);
  check('作品も版も private', row?.work === 'private' && row?.revision === 'private', JSON.stringify(row));

  // 2. 本人には見え、残さない
  const page = await ownerFetch(`/p/${id}`);
  const html = await page.text();
  check('本人には作品のページが見える', page.status === 200 && html.includes(`/draft-frame/${revision.id}/desktop.html`), `${page.status}`);
  check('本人のページは残さない（no-store、札なし、no-referrer、noindex）', page.headers.get('cache-control') === NO_STORE && !page.headers.get('cache-tag') && page.headers.get('referrer-policy') === 'no-referrer' && page.headers.get('x-robots-tag') === 'noindex', `${page.headers.get('cache-control')} / ${page.headers.get('referrer-policy')}`);
  const frame = await ownerFetch(revision.frames.desktop, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  check('本人には枠が返る。守りは公開の枠と同じ', frame.status === 200 && frame.headers.get('cache-control') === NO_STORE && frame.headers.get('content-security-policy')?.includes('sandbox allow-scripts allow-forms') && !frame.headers.get('content-security-policy')?.includes('allow-same-origin'));
  const code = await ownerFetch(`/p/${id}/code`);
  check('本人には /p/<id>/code が返り、残さない', code.status === 200 && code.headers.get('cache-control') === NO_STORE, `${code.status} ${code.headers.get('cache-control')}`);

  // 3. ほかの人とログインしていない人には、ない作品と同じ 404
  const missing = `verify-${suffix}-missing`;
  for (const [label, fetcher] of [
    ['ほかの人', otherFetch],
    ['ログインしていない人', anonymous],
  ]) {
    for (const path of [(x) => `/p/${x}`, (x) => `/en/p/${x}`, (x) => `/p/${x}/code`, (x) => `/w/${x}/1/thumb.webp`, (x) => `/w/${x}/1/og.png`]) {
      const [got, none] = await Promise.all([fetcher(path(id)), fetcher(path(missing))]);
      const [a, b] = await Promise.all([got.text(), none.text()]);
      check(`${label}：${path('<id>')} は、ない作品と同じ 404`, got.status === 404 && none.status === 404 && a.replaceAll(id, 'X') === b.replaceAll(missing, 'X') && got.headers.get('cache-control') === NO_STORE, `${got.status} / ${none.status}`);
    }
    const frameOther = await fetcher(`/frame/${id}/1/desktop.html`, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
    const draftOther = await fetcher(revision.frames.desktop, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
    check(`${label}：公開の枠も下書きの枠も 404`, frameOther.status === 404 && draftOther.status === 404, `${frameOther.status} / ${draftOther.status}`);
  }
  const works = (await (await anonymous('/api/works')).json()).works;
  check('/api/works に出ない', !works.some((work) => work.id === id));
  check('sitemap.xml に出ない', !(await (await anonymous('/sitemap.xml')).text()).includes(id));
  check('作り手のページは 404（公開の作品がない）', (await anonymous(`/c/${owner.handle}`)).status === 404);

  // 4. 公開に回す（承認はしない）。審査待ちの間も 404
  const published = await postJson(ownerFetch, `/api/post/works/${id}/publish`, { own: true, mit: true, terms: true });
  check('公開に回せる（審査待ちになる）', published.status === 200, `${published.status} ${await published.text()}`);
  const [pending] = d1(`SELECT w.status AS work, r.status AS revision FROM works w JOIN revisions r ON r.work_id = w.id WHERE w.id = '${id}'`);
  check('審査待ちの間も作品は private、版は submitted', pending?.work === 'private' && pending?.revision === 'submitted', JSON.stringify(pending));
  check('審査待ちの間も、ほかの人には 404', (await otherFetch(`/p/${id}`)).status === 404 && (await anonymous(`/p/${id}`)).status === 404);
  check('数を増やしていない', d1(`SELECT COUNT(*) AS n FROM counters WHERE work_id = '${id}'`)[0].n === 0);
} finally {
  const ids = people.map((one) => `'${one.id}'`).join(', ');
  const rows = d1(`SELECT r.r2_prefix, r.work_id FROM revisions r JOIN works w ON w.id = r.work_id JOIN creators c ON c.id = w.creator_id WHERE c.user_id IN (${ids})`);
  const prefixes = [...new Set(rows.map((row) => row.r2_prefix))];
  for (const prefix of prefixes) for (const name of ['meta.json', 'part.html', 'part.css', 'part.js', 'thumb.webp', 'og.png']) r2Delete(`${prefix}/${name}`);
  const workIds = [...new Set(rows.map((row) => `'${row.work_id}'`))].join(', ');
  d1(
    (workIds ? `DELETE FROM revisions WHERE work_id IN (${workIds}); DELETE FROM works WHERE id IN (${workIds}); DELETE FROM counters WHERE work_id IN (${workIds});` : '') +
      `DELETE FROM creators WHERE user_id IN (${ids}); DELETE FROM quotas WHERE key IN (${people.flatMap((one) => [`'save:${one.id}'`, `'revision:${one.id}'`]).join(', ')}); DELETE FROM sessions WHERE user_id IN (${ids}); DELETE FROM users WHERE id IN (${ids});`,
  );
  console.log(`消したもの：作品 ${workIds ? workIds.split(', ').length : 0}、版の置き場 ${prefixes.length}`);
  check('使い捨ての人が残っていない', d1(`SELECT COUNT(*) AS n FROM users WHERE id LIKE 'verify-t036-%'`)[0].n === 0);
  check('使い捨ての作品、版、作者が残っていない', d1(`SELECT (SELECT COUNT(*) FROM works WHERE id LIKE '%${suffix}%') + (SELECT COUNT(*) FROM revisions WHERE work_id LIKE '%${suffix}%') + (SELECT COUNT(*) FROM creators WHERE user_id LIKE 'verify-t036-%') + (SELECT COUNT(*) FROM sessions WHERE user_id LIKE 'verify-t036-%') AS n`)[0].n === 0);
  check('審査待ちの一覧に残っていない', d1(`SELECT COUNT(*) AS n FROM revisions WHERE status = 'submitted' AND work_id LIKE '%${suffix}%'`)[0].n === 0);
  for (const prefix of prefixes) {
    let left = 0;
    try {
      left = execFileSync(process.execPath, [wrangler, 'r2', 'object', 'get', `ludion-parts/${prefix}/part.html`, '--remote', '--pipe'], { cwd: webDir, stdio: ['ignore', 'pipe', 'ignore'] }).length;
    } catch {
      // ないので読めない
    }
    check(`R2 の版の置き場 ${prefix.split('/')[1].slice(0, 8)}… が残っていない`, left === 0, `${left} バイト`);
  }
  const after = Object.fromEntries(tables.map((table) => [table, d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n]));
  for (const table of tables) check(`${table} の行が減っていない（今も人が来ているので、増えるのはよい）`, after[table] >= before[table], `${before[table]} → ${after[table]}`);
}
console.log(failed === 0 ? '全部通った' : `落ちたもの ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
