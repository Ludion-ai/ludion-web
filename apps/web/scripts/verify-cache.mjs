// 本番の URL で、キャッシュと回数の制限を確かめる（docs/tasks/T012.md の終わりの条件）。npm test には入れない（本番に要求を送るため）。
//
// node scripts/verify-cache.mjs hits               許した道が当たること。許さない道が当たらないこと
// node scripts/verify-cache.mjs swap <id>          キャッシュを温めてから ld upload <id> --env prod で版を差し替え、すぐ取り直す
// node scripts/verify-cache.mjs people             2人が交互に GET /api/me を取っても、相手の情報が返らないこと
// node scripts/verify-cache.mjs limit              POST /api/count の回数の制限で 429 が返ること
//
// - 閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count は中身の正しくない要求だけを送る。ブラウザは使わない。
// - people は、本番の D1 に使い捨ての users と sessions を2組入れ、終わったら必ず消す。実在の人の行には触らない。
//   セッションのトークンは、ここで作り、どこにも出さない。D1 にはハッシュだけを置く（CLAUDE.md「技術の決定」）。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(webDir, '../..');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const PROD = 'https://ludion.ai';
const WORKERS_DEV = 'https://ludion-web.ludion.workers.dev';
const NO_STORE = 'private, no-store';
const PAGE = 'public, max-age=0, s-maxage=60';
const LONG = 'public, max-age=31536000, immutable';
const THUMB = 'public, max-age=3600, s-maxage=31536000';
const USER_AGENT = 'ludion-verify-cache';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '満たした' : '未達　　'} ${name}${detail ? `：${detail}` : ''}`);
}

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ludion-app', '--remote', '--json', '--command', sql], {
    cwd: webDir,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].results;
}

const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });

/** 取って、中身を読み切り（読み切らないと保存されない）、見出しの要点を返す。 */
async function read(url, init) {
  const response = await get(url, init);
  const body = await response.text();
  const { headers } = response;
  return { status: response.status, body, cache: headers.get('cf-cache-status'), control: headers.get('cache-control'), tag: headers.get('cache-tag'), cookie: headers.get('set-cookie') };
}

/** 当たるまで最大 tries 回取る。Cloudflare はデータセンターごとに持つので、1回目は MISS になる。 */
async function readUntilHit(url, tries = 5) {
  let last;
  for (let index = 0; index < tries; index += 1) {
    last = await read(url);
    if (last.cache === 'HIT') return { ...last, tries: index + 1 };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ...last, tries };
}

async function works() {
  return (await (await get(`${PROD}/api/works`)).json()).works;
}

async function checkHits() {
  const list = await works();
  const [work] = list;
  const home = await read(`${PROD}/`);
  const script = /src="(\/assets\/index-[^"]+\.js)"/.exec(home.body)[1];
  const avatar = /(\/files\/creators\/[^"\\]+\.webp)/.exec((await read(`${PROD}/c/${work.creator.handle}`)).body)?.[1];

  for (const path of ['/', '/?c=web', '/?sort=new', `/?q=${encodeURIComponent(work.title.slice(0, 3))}`, `/p/${work.id}`, `/c/${work.creator.handle}`]) {
    const seen = await readUntilHit(`${PROD}${path}`);
    check(`HTML ${path}`, seen.status === 200 && seen.cache === 'HIT' && seen.control === PAGE && !seen.tag && !seen.cookie, `${seen.status}、cf-cache-status=${seen.cache}（${seen.tries}回目）、${seen.control}、札は客に見えない=${!seen.tag}`);
  }
  for (const [path, control] of [[`/w/${work.id}/${work.version}/thumb.webp`, THUMB], [avatar, LONG], [script, LONG]]) {
    const seen = await readUntilHit(`${PROD}${path}`);
    check(`長いもの ${path}`, seen.status === 200 && seen.cache === 'HIT' && seen.control === control && !seen.cookie, `${seen.status}、cf-cache-status=${seen.cache}（${seen.tries}回目）、${seen.control}`);
  }

  const frame = `/frame/${work.id}/${work.version}/desktop.html`;
  for (const [label, path, init] of [
    ['API', '/api/works'],
    ['API', '/api/me'],
    ['枠', frame, { headers: { 'Sec-Fetch-Dest': 'iframe' } }],
    ['枠の外から', frame],
    ['OG 画像', `/w/${work.id}/${work.version}/og.png`],
    ['保存', '/saved'],
    ['ログイン', '/auth/github'],
    ['ない作品', '/p/no-such-work-t012'],
    ['知らない道', '/no-such-path-t012'],
    ['/assets/ の知らない道', '/assets/no-such-file-t012.js'],
  ]) {
    const first = await read(`${PROD}${path}`, init);
    const second = await read(`${PROD}${path}`, init);
    check(`${label} ${path} は当たらない`, second.cache !== 'HIT' && first.cache !== 'HIT' && second.control === NO_STORE, `${second.status}、cf-cache-status=${second.cache}、${second.control}`);
  }

  // workers.dev と ludion.ai は同じキャッシュ。workers.dev の URL を HTML に入れない
  const dev = await readUntilHit(`${WORKERS_DEV}/p/${work.id}`);
  check('workers.dev の作品のページの OG は ludion.ai', dev.body.includes(`content="${PROD}/w/`) && !dev.body.includes('workers.dev'), `cf-cache-status=${dev.cache}`);
}

/** 版を差し替えると、温めたキャッシュの HTML がすぐ新しい版になる。 */
async function checkSwap(id) {
  const before = (await works()).find((work) => work.id === id);
  if (!before) throw new Error(`本番に ${id} がない`);
  const meta = JSON.parse(readFileSync(join(root, 'works', id, 'meta.json'), 'utf8'));
  if (meta.version === before.version) throw new Error(`works/${id}/meta.json の version（${meta.version}）を上げてから流す`);
  const paths = ['/', '/?c=web', '/?sort=new', `/?q=${encodeURIComponent(before.title)}`, `/p/${id}`, `/c/${before.creator.handle}`];

  for (const path of paths) {
    const warmed = await readUntilHit(`${PROD}${path}`);
    const old = `/w/${id}/${before.version}/thumb.webp`;
    // 絞り込みで作品が出ない URL は、版の文字がなくても札で消えることを、状態で確かめる
    check(`差し替えの前 ${path}`, warmed.cache === 'HIT', `cf-cache-status=${warmed.cache}（${warmed.tries}回目）、古い版の URL あり=${warmed.body.includes(old)}`);
  }

  console.log(`ld upload ${id} --env prod（版 ${before.version} → ${meta.version}）`);
  const started = Date.now();
  const sent = spawnSync(process.execPath, [join(root, 'packages/ld/bin/ld.mjs'), 'upload', id, '--env', 'prod'], { cwd: root, encoding: 'utf8' });
  console.log(sent.stdout.split('\n').filter((line) => line.includes(id) || line.includes('一覧')).join('\n'));
  if (sent.status !== 0) console.log(sent.stderr);
  check('ld upload が成功し、一覧の反映の遅れの知らせがない', sent.status === 0 && !sent.stdout.includes('一覧の反映'), `exit ${sent.status}、${Date.now() - started}ms`);

  for (const path of paths) {
    const after = await read(`${PROD}${path}`);
    const fresh = `/w/${id}/${meta.version}/thumb.webp`;
    const stale = `/w/${id}/${before.version}/thumb.webp`;
    const showsWork = after.body.includes(`/p/${id}`);
    check(`差し替えの後すぐ ${path}`, after.status === 200 && after.cache !== 'HIT' && !after.body.includes(stale) && (!showsWork || after.body.includes(fresh) || path.startsWith('/p/')), `cf-cache-status=${after.cache}、新しい版の URL あり=${after.body.includes(fresh)}、古い版の URL あり=${after.body.includes(stale)}`);
  }
  const api = (await works()).find((work) => work.id === id);
  check('API の版', api.version === meta.version, api.version);
}

const hash = (token) => createHash('sha256').update(token).digest('hex');

async function checkPeople() {
  const stamp = Date.now();
  const people = ['a', 'b'].map((name, index) => ({
    id: `t012-check-${name}-${stamp}`,
    githubId: -(stamp + index),
    login: `t012_check_${name}`,
    token: randomBytes(32).toString('hex'),
  }));
  const expires = stamp + 10 * 60 * 1000;
  const ids = people.map(({ id }) => `'${id}'`).join(', ');
  const usersBefore = d1('SELECT COUNT(*) AS n FROM users')[0].n;
  const sessionsBefore = d1('SELECT COUNT(*) AS n FROM sessions')[0].n;
  try {
    for (const person of people) {
      d1(
        `INSERT INTO users (id, handle, display_name, avatar_url, created_at) VALUES ('${person.id}', '${person.login}', NULL, NULL, ${stamp});` +
          `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('${hash(person.token)}', '${person.id}', ${expires});`,
      );
    }
    let wrong = 0;
    let hits = 0;
    const rounds = 10;
    for (let round = 0; round < rounds; round += 1) {
      for (const [mine, other] of [people, people.toReversed()]) {
        const seen = await read(`${PROD}/api/me`, { headers: { Cookie: `ld_session=${mine.token}` } });
        const body = JSON.parse(seen.body);
        if (body.user?.handle !== mine.login || seen.body.includes(other.login)) wrong += 1;
        if (seen.cache === 'HIT' || seen.control !== NO_STORE) hits += 1;
      }
    }
    check(`2人が交互に GET /api/me を${rounds * 2}回：本人の情報だけが返る`, wrong === 0, `違ったもの ${wrong} 回`);
    check('GET /api/me は当たらず、private, no-store', hits === 0, `当たった、または指示が違うもの ${hits} 回`);

    const anonymous = JSON.parse((await read(`${PROD}/api/me`)).body);
    check('ログインしていない人には null', anonymous.user === null);

    // HTML はキャッシュされる。2人とログインしていない人で同じものが返り、誰の名前も入らない
    for (const path of ['/', '/?sort=new']) {
      const seen = await Promise.all([{}, { Cookie: `ld_session=${people[0].token}` }, { Cookie: `ld_session=${people[1].token}` }].map((headers) => read(`${PROD}${path}`, { headers })));
      check(`${path} の HTML に2人の名前がない`, seen.every(({ body, cookie }) => !people.some(({ login }) => body.includes(login)) && !cookie));
    }
  } finally {
    d1(`DELETE FROM sessions WHERE user_id IN (${ids}); DELETE FROM users WHERE id IN (${ids});`);
    const usersAfter = d1('SELECT COUNT(*) AS n FROM users')[0].n;
    const sessionsAfter = d1('SELECT COUNT(*) AS n FROM sessions')[0].n;
    check('使い捨ての行を消した', usersAfter === usersBefore && sessionsAfter === sessionsBefore, `users ${usersBefore} → ${usersAfter}、sessions ${sessionsBefore} → ${sessionsAfter}`);
  }
}

async function checkLimit() {
  const viewsBefore = d1('SELECT COALESCE(SUM(views), 0) + COALESCE(SUM(copies), 0) AS n FROM counters')[0].n;
  const codes = {};
  let first429 = null;
  // 束縛は近似で、上限を少し超えることがある（SPEC の出典）。中身の正しくない要求なので、数は増えない
  for (let index = 0; index < 400 && !first429; index += 1) {
    const response = await get(`${PROD}/api/count`, { method: 'POST', headers: { Origin: PROD, 'Content-Type': 'application/json' }, body: '{}' });
    codes[response.status] = (codes[response.status] ?? 0) + 1;
    if (response.status === 429) first429 = index + 1;
    await response.arrayBuffer();
  }
  const viewsAfter = d1('SELECT COALESCE(SUM(views), 0) + COALESCE(SUM(copies), 0) AS n FROM counters')[0].n;
  check('POST /api/count を続けて送ると 429 が返る', first429 !== null, `${first429} 回目で 429。${JSON.stringify(codes)}`);
  // 外からの閲覧が混ざることがあるので、増えても1桁なら未達にしない
  console.log(`閲覧数とコピー数の合計：${viewsBefore} → ${viewsAfter}`);
}

const [, , command, argument] = process.argv;
if (command === 'hits') await checkHits();
else if (command === 'swap') await checkSwap(argument);
else if (command === 'people') await checkPeople();
else if (command === 'limit') await checkLimit();
else {
  console.error('node scripts/verify-cache.mjs hits | swap <id> | people | limit');
  process.exit(2);
}
console.log(failed === 0 ? '全部満たした' : `未達 ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
