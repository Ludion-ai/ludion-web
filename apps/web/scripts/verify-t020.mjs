// T020 の本番の確かめ（docs/tasks/T020.md「1」「5」）。本番の D1 と本番のサイトに当たるので、許可を得てから流す。
//
// node scripts/verify-t020.mjs preflight <置き場所.json>   0002 を流す前。読むだけ。今の行を手元に写し、handle と作者の結びつきの見込みを数だけ出す
// node scripts/verify-t020.mjs after <置き場所.json>       0002 を流した後。読むだけ。前の写しと、行数と中身を比べる
// node scripts/verify-t020.mjs site                        デプロイの後。ログインせずに見える道を確かめる
//
// 実在の人の名前と id は画面に出さない（CLAUDE.md 原則6）。写しのファイルはリポジトリの外に置き、比べたら消す。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(webDir, '../..');
const wrangler = join(webDir, '../../node_modules/wrangler/bin/wrangler.js');
const PROD = 'https://ludion.ai';
/** 作者 Lattice_Node に結ぶ GitHub の数字の id（migrations/0002_accounts.sql と同じ）。 */
const CEO_GITHUB_ID = 292738933;
const RESERVED = new Set(['admin', 'api', 'auth', 'account', 'apply', 'ludion', 'saved', 'search', 'about', 'privacy', 'settings', 'frame', 'login', 'logout', 'signup', 'files', 'assets']);

let failed = 0;
function check(label, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '通った' : '落ちた'}：${label}${detail ? `（${detail}）` : ''}`);
}

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ludion-app', '--remote', '--json', '--command', sql], { cwd: webDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out)[0].results;
}

function snapshotPath() {
  const path = process.argv[3];
  if (!path) throw new Error('写しの置き場所（リポジトリの外の .json）を渡す');
  const full = resolve(path);
  if (full === repoDir || full.startsWith(repoDir + sep)) throw new Error('写しをリポジトリの中に置かない');
  return full;
}

const TABLES = ['users', 'sessions', 'likes', 'bookmarks', 'creators', 'works'];
const count = (table) => d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;

/** migrations/0002_accounts.sql と同じ決め方。 */
function plannedHandles(users, creators) {
  const planned = users.map((user) => {
    const base = user.github_id === CEO_GITHUB_ID ? 'lattice_node' : user.login.toLowerCase().replace(/-/g, '_').slice(0, 20);
    const creatorClash = user.github_id !== CEO_GITHUB_ID && creators.some((creator) => creator.handle.toLowerCase() === base);
    const clash = base.length < 3 || RESERVED.has(base) || base.includes('ludion') || creatorClash;
    return { base, handle: clash ? `${base.slice(0, 15)}_user` : base, clash };
  });
  const seen = new Map();
  for (const person of planned) {
    const n = (seen.get(person.handle) ?? 0) + 1;
    seen.set(person.handle, n);
    person.numbered = n > 1;
    person.valid = /^[a-z0-9_]{3,20}$/.test(person.handle);
  }
  return planned;
}

function preflight() {
  const path = snapshotPath();
  const applied = d1('SELECT name FROM d1_migrations ORDER BY id').map(({ name }) => name);
  check('本番の D1 は 0001 までで、0002 はまだ', applied.length === 1 && applied[0] === '0001_init.sql', applied.join('、'));

  const users = d1('SELECT id, github_id, login, name, avatar_url, created_at FROM users');
  const creators = d1('SELECT id, handle, name, kind, user_id FROM creators');
  const snapshot = {
    users,
    creators,
    sessions: d1('SELECT token_hash, user_id, expires_at FROM sessions'),
    likes: d1('SELECT user_id, work_id, created_at FROM likes'),
    bookmarks: d1('SELECT user_id, work_id, created_at FROM bookmarks'),
    works: d1('SELECT id, status FROM works'),
  };
  writeFileSync(path, JSON.stringify(snapshot), 'utf8');
  console.log(`行の数：${TABLES.map((table) => `${table} ${snapshot[table].length}`).join('、')}`);

  const planned = plannedHandles(users, creators);
  check('全員の handle が形に合う（合わなければ migration が丸ごと止まる）', planned.every((person) => person.valid), `${planned.filter((person) => person.valid).length}/${planned.length}`);
  console.log(`handle の内訳：そのまま ${planned.filter((person) => !person.clash && !person.numbered).length}、_user が付く ${planned.filter((person) => person.clash).length}、番号が付く ${planned.filter((person) => person.numbered).length}`);

  const ceo = users.filter((user) => user.github_id === CEO_GITHUB_ID);
  const creator = creators.find((row) => row.handle.toLowerCase() === 'lattice_node');
  check('作者 Lattice_Node がある', Boolean(creator));
  check('作者はまだだれにも結ばれていない', creator?.user_id === null);
  check(`GitHub の id ${CEO_GITHUB_ID} の人がいる（いなければ作者を結べないので、止めて CEO に聞く）`, ceo.length === 1, `${ceo.length} 人`);

  console.log('Time Travel（流す前の、戻せる時刻）：');
  console.log(execFileSync(process.execPath, [wrangler, 'd1', 'time-travel', 'info', 'ludion-app'], { cwd: webDir, encoding: 'utf8' }));
}

function after() {
  const path = snapshotPath();
  if (!existsSync(path)) throw new Error('流す前の写しがない');
  const before = JSON.parse(readFileSync(path, 'utf8'));
  const applied = d1('SELECT name FROM d1_migrations ORDER BY id').map(({ name }) => name);
  for (const name of ['0002_accounts.sql', '0003_auth_flows.sql', '0004_passkeys.sql']) check(`${name} が入っている`, applied.includes(name), applied.join('、'));

  const users = d1('SELECT id, handle, display_name, avatar_url, created_at FROM users');
  const identities = d1(`SELECT user_id, provider, subject, label, avatar_url, created_at FROM identities`);
  const planned = plannedHandles(before.users, before.creators);
  // 本番は動いているので、写しの後に増えた人や行はあってよい。前の行がなくなっていないことを確かめる
  check('前の人が全員いる', before.users.every((old) => users.some((user) => user.id === old.id)), `${before.users.length} → ${users.length}`);

  let wrongUsers = 0;
  let wrongIdentities = 0;
  before.users.forEach((old, index) => {
    const row = users.find((user) => user.id === old.id);
    const identity = identities.find((item) => item.user_id === old.id && item.provider === 'github');
    if (!row || row.avatar_url !== old.avatar_url || row.created_at !== old.created_at || row.handle !== (planned[index].numbered ? row.handle : planned[index].handle)) wrongUsers += 1;
    if (!identity || identity.subject !== String(old.github_id) || identity.label !== old.login || identity.created_at !== old.created_at) wrongIdentities += 1;
  });
  check('人の id、アバター、作った時刻、handle が見込みどおり', wrongUsers === 0, `違う人 ${wrongUsers}`);
  check('GitHub の id と login が identities に移った', wrongIdentities === 0, `違う人 ${wrongIdentities}、手段 ${identities.length}`);

  /** 前の行が全部残っているか。増えた行は数だけ出す。本人が消したいいねなどで落ちたら、数を見て判断する。 */
  const kept = (name, rows, beforeRows, key) => {
    const now = new Set(rows.map(key));
    const old = new Set(beforeRows.map(key));
    const missing = [...old].filter((row) => !now.has(row)).length;
    const added = [...now].filter((row) => !old.has(row)).length;
    check(`${name} の前の行が全部残っている`, missing === 0, `前 ${old.size}、なくなった ${missing}、増えた ${added}`);
  };
  kept('likes', d1('SELECT user_id, work_id, created_at FROM likes'), before.likes, ({ user_id, work_id, created_at }) => `${user_id}/${work_id}/${created_at}`);
  kept('bookmarks', d1('SELECT user_id, work_id, created_at FROM bookmarks'), before.bookmarks, ({ user_id, work_id, created_at }) => `${user_id}/${work_id}/${created_at}`);
  // 期限が切れたセッションは新しい Worker が消してよいので、比べない
  const live = before.sessions.filter(({ expires_at }) => expires_at > Date.now());
  kept('sessions', d1('SELECT token_hash, user_id, expires_at FROM sessions'), live, ({ token_hash, user_id, expires_at }) => `${token_hash}/${user_id}/${expires_at}`);
  kept('works', d1('SELECT id, status FROM works'), before.works, ({ id, status }) => `${id}/${status}`);

  const creator = d1(`SELECT user_id, name FROM creators WHERE handle = 'Lattice_Node' COLLATE NOCASE`)[0];
  const ceo = before.users.find((user) => user.github_id === CEO_GITHUB_ID);
  check('作者 Lattice_Node が CEO（Ludion-ai）に結ばれた', Boolean(ceo) && creator?.user_id === ceo.id);
  const bound = users.find((user) => user.id === ceo?.id);
  check('結ばれた人の handle は lattice_node', bound?.handle === 'lattice_node');
  check('結ばれた人の表示の名前は、作者の名前', bound?.display_name === creator?.name);
  console.log(`比べ終わったら写しを消す：${path}`);
}

async function site() {
  const manual = { redirect: 'manual' };
  const get = (path, init = {}) => fetch(`${PROD}${path}`, { ...manual, ...init });

  const account = await get('/account');
  check('/account はログインへ', account.status === 302 && account.headers.get('location') === '/login?next=%2Faccount', `${account.status}、${account.headers.get('location')}`);
  const saved = await get('/saved');
  check('/saved は /account/saved へ転送する', saved.status === 301 && saved.headers.get('location') === '/account/saved', `${saved.status}、${saved.headers.get('location')}`);
  const me = await (await get('/api/me')).json();
  check('ログインしていない人の /api/me は null', me.user === null);
  check('/api/account はログインが要る', (await get('/api/account')).status === 401);

  const login = await get('/login');
  const html = await login.text();
  check('/login は 200 で、キャッシュしない', login.status === 200 && login.headers.get('cache-control') === 'private, no-store', `${login.status}、${login.headers.get('cache-control')}`);
  check('/login に GitHub がある', html.includes('/auth/github?next='));
  check('/login にパスキーがある', html.includes('パスキーでログイン'));
  const passkey = await fetch(`${PROD}/auth/passkey/login/options`, { method: 'POST', headers: { Origin: PROD, 'Content-Type': 'application/json' }, body: '{}' });
  const options = await passkey.json();
  check('パスキーの RP ID は ludion.ai で、ユーザー確認が必須', passkey.status === 200 && options.rpId === 'ludion.ai' && options.userVerification === 'required', `${passkey.status}、${options.rpId}`);
  const evil = await fetch(`${PROD}/auth/passkey/login/options`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  check('外の Origin のパスキーは 403', evil.status === 403, String(evil.status));

  const github = await get('/auth/github?next=/');
  check('/auth/github は GitHub へ', github.status === 302 && new URL(github.headers.get('location')).origin === 'https://github.com');

  if (process.argv.includes('--google')) {
    check('/login に Google がある', html.includes('/auth/google?next='));
    const google = await get('/auth/google?next=/');
    const location = new URL(google.headers.get('location') ?? 'https://invalid.invalid');
    check('/auth/google は Google へ', google.status === 302 && location.origin === 'https://accounts.google.com', String(google.status));
    check('スコープは openid と profile だけ', location.searchParams.get('scope') === 'openid profile', location.searchParams.get('scope') ?? '');
    check('PKCE がある', location.searchParams.get('code_challenge_method') === 'S256' && Boolean(location.searchParams.get('code_challenge')));
    check('戻り先は ludion.ai', location.searchParams.get('redirect_uri') === `${PROD}/auth/google/callback`, location.searchParams.get('redirect_uri') ?? '');
  }
}

const command = process.argv[2];
if (command === 'preflight') preflight();
else if (command === 'after') after();
else if (command === 'site') await site();
else throw new Error('preflight、after、site のどれかを渡す');
if (failed > 0) {
  console.error(`落ちたもの ${failed}`);
  process.exit(1);
}
