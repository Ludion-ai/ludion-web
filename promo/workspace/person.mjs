// 動画に出す人を、手元の D1 に入れる（V006）。オーナーの裏方の道具（CLAUDE.md 原則1）。本番には入れない（--remote の道を持たない）。
//   node promo/workspace/person.mjs --persist <手元の D1 と R2 の置き場>
//       → 人（users、creators、sessions）を入れる。何度でも流せる。その人の作品、鍵、つながりは消さない
//   node promo/workspace/person.mjs --persist <置き場> --put scene1
//       → 記録の HTML（promo/workspace/records/<名前>/）を、プラグインのフックで手元のサーバーに置く。AI は使わない。
//         Claude Code がするのと同じ形（道具の呼び出しを JSON で stdin に）でフックを動かすので、置かれ方は記録のときと同じ
//
// 使う順（場面2〜4を撮る前）：
//   1. 置き場を決めて見本のデータを入れる：LD_PERSIST_DIR=<置き場> npm run seed:dev -w @ludion/web
//   2. 人を入れる：node promo/workspace/person.mjs --persist <置き場>
//   3. 手元のサーバーを起こす（LD_PERSIST_DIR=<置き場>、ポートは LD_DEV_URL に合わせる）
//   4. 撮る途中で作品を置く：--put scene1（置かれた作品の ID は毎回変わる。題に英数字がないと、サイトが乱数で付けるため）
//
// 人の名前は person.json。既定は、このリポジトリの creators/ にある作者（架空の人を作らない。CLAUDE.md 原則10）。
// セッションの値は、手元の使い捨ての D1 のためだけのもの（apps/web/scripts/private-fixture.mjs と同じ考え方）。

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_ROOT } from './out.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const WEB = resolve(ROOT, 'apps', 'web');
const WRANGLER = resolve(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const HOOK = resolve(ROOT, 'plugins', 'ludion', 'hooks', 'auto-save.mjs');
const OUT = resolve(OUT_ROOT, 'v006-person');
const WHO = JSON.parse(readFileSync(resolve(HERE, 'person.json'), 'utf8'));
const BASE = (process.env.LD_DEV_URL || 'http://localhost:5473').replace(/\/+$/, '');

function assertLocal(url) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${url}`);
}
assertLocal(BASE);

const profile = JSON.parse(readFileSync(resolve(ROOT, 'creators', WHO.creator, 'creator.json'), 'utf8'));
export const PERSON = {
  userId: 'promo-person',
  creatorId: 'promo-creator-person',
  handle: profile.handle,
  name: profile.name,
  kind: profile.kind,
  /** cookie の ld_session の値。本物と同じ形（16進64文字）。D1 にはハッシュだけを置く */
  session: createHash('sha256').update('ludion-promo-workspace-person-session').digest('hex'),
};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;

function d1(persist, sql) {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', persist, '--json', '--command', sql], { cwd: WEB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out).at(-1).results;
}

/** 人を入れ直す。同じ handle の作者が先にいれば（見本や、手元に置いた作品の作者）、その行に本人をつなぐ。 */
export function ensurePerson(persist) {
  const now = Date.now();
  const known = d1(persist, `SELECT id, user_id FROM creators WHERE handle = ${quote(PERSON.handle)} COLLATE NOCASE`)[0];
  if (known && known.user_id && known.user_id !== PERSON.userId) throw new Error(`@${PERSON.handle} は、手元の D1 でほかの人につながっている`);
  const creatorId = known?.id ?? PERSON.creatorId;
  d1(
    persist,
    [
      // 人の行は消さない（鍵やつながりが、この人を指しているため）。なければ足し、名前を合わせる
      `INSERT OR IGNORE INTO users (id, handle, display_name, created_at) VALUES (${quote(PERSON.userId)}, ${quote(PERSON.handle.toLowerCase())}, ${quote(PERSON.name)}, ${now})`, // users の handle は小文字だけ
      `UPDATE users SET handle = ${quote(PERSON.handle.toLowerCase())}, display_name = ${quote(PERSON.name)} WHERE id = ${quote(PERSON.userId)}`,
      `DELETE FROM sessions WHERE user_id = ${quote(PERSON.userId)}`,
      known
        ? `UPDATE creators SET user_id = ${quote(PERSON.userId)} WHERE id = ${quote(creatorId)}`
        : `INSERT INTO creators (id, handle, name, kind, user_id, created_at) VALUES (${quote(creatorId)}, ${quote(PERSON.handle)}, ${quote(PERSON.name)}, ${quote(PERSON.kind)}, ${quote(PERSON.userId)}, ${now})`,
      `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_used_at, auth_at) VALUES (${quote(sha256(PERSON.session))}, ${quote(PERSON.userId)}, ${now + 365 * 24 * 60 * 60 * 1000}, ${now}, ${now}, ${now})`,
    ].join('; '),
  );
  return { handle: PERSON.handle, name: PERSON.name, creatorId, linkedExistingCreator: Boolean(known) };
}

const cookie = { Cookie: `ld_session=${PERSON.session}`, Origin: BASE };
async function makeKey() {
  const response = await fetch(`${BASE}/api/account/ai-keys`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cookie }, body: JSON.stringify({ name: 'Claude Code', own: true, mit: true, terms: true }) });
  if (response.status !== 201) throw new Error(`鍵を作れなかった: ${response.status} ${await response.text()}`);
  const made = await response.json();
  return { id: made.key.id, secret: made.secret };
}
export async function ownWorks() {
  const response = await fetch(`${BASE}/api/post/works`, { headers: cookie });
  if (!response.ok) throw new Error(`GET /api/post/works: ${response.status}`);
  return (await response.json()).works;
}

/** 記録の HTML を、プラグインのフックで置く。返すのは、フックが画面に出した行。 */
export async function putRecord(name) {
  const html = JSON.parse(readFileSync(resolve(HERE, 'records', name, 'facts.json'), 'utf8')).files[0];
  const dir = resolve(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // どのファイルがどの作品かの覚えは、このフォルダに置く（上のフォルダの覚えに書かせない）
  writeFileSync(join(dir, '.ludion.json'), `${JSON.stringify({ works: {}, auto: true }, null, 2)}\n`);
  copyFileSync(resolve(HERE, 'records', name, html), join(dir, html));
  const key = await makeKey();
  try {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('LUDION_')) delete env[k];
    Object.assign(env, { LUDION_URL: BASE, LUDION_KEY: key.secret, LUDION_HOME: resolve(OUT, 'ludion-home'), LUDION_NO_BROWSER: '1', LUDION_NO_OPEN: '1' });
    assertLocal(env.LUDION_URL);
    const said = await new Promise((done, fail) => {
      const child = execFile(process.execPath, [HOOK], { cwd: dir, env }, (_error, stdout) => {
        try {
          done(JSON.parse(stdout));
        } catch {
          fail(new Error(`フックが答えなかった: ${stdout}`));
        }
      });
      child.stdin.end(JSON.stringify({ session_id: 'promo', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, html), content: '' }, tool_response: {} }));
    });
    if (!String(said.systemMessage ?? '').includes(`${BASE}/`)) throw new Error(`フックの答えに手元の住所がない: ${JSON.stringify(said)}`);
    return said.systemMessage;
  } finally {
    await fetch(`${BASE}/api/account/ai-keys/${encodeURIComponent(key.id)}/delete`, { method: 'POST', headers: cookie });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const persist = valueOf('--persist');
  if (!persist) throw new Error('使い方: node promo/workspace/person.mjs --persist <置き場> [--put <名前>]');
  const put = valueOf('--put');
  if (!put) console.log(JSON.stringify({ step: 'person', ...ensurePerson(resolve(persist)) }));
  else {
    const line = await putRecord(put);
    const works = await ownWorks();
    console.log(JSON.stringify({ step: 'put', line, works: works.map((w) => ({ id: w.id, title: w.title, status: w.status, version: w.version ?? w.revision?.version ?? null })) }));
  }
}
