// 作品を見せる公開の条件のうち、verify-prod.mjs と verify-cache.mjs にないものを本番で確かめる（docs/tasks/T013.md「1」、docs/PHASE0.md）。
// npm test には入れない（本番に要求を送るため）。
//
// node scripts/verify-launch.mjs numbers           本番の行の数と、閲覧数とコピー数の合計を出す（読むだけ）
// node scripts/verify-launch.mjs accounts          いいね、しおり、/saved。使い捨ての人を入れ、終わったら必ず消す
// node scripts/verify-launch.mjs count             閲覧数とコピー数が1ずつ増えること。本番の数が本当に増える（T013 の最後に空にする）
// node scripts/verify-launch.mjs pages             横のはみ出し、axe、キーボード、ログインせずにしおりを押したとき。POST /api/count と GA4 は止める
//
// - 使い捨ての人は login が t013-check- で始まる。実在の人の行には触らない。トークンはここで作り、どこにも出さない。
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(webDir, '../..');
const shots = join(root, 'docs/screens');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const PROD = 'https://ludion.ai';
const USER_AGENT = 'ludion-verify-launch';
const WORK = 'button-ticket';
const CREATOR = 'Lattice_Node';

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

const countRows = (table, where = '1 = 1') => d1(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)[0].n;
const call = (path, init = {}) => fetch(`${PROD}${path}`, { redirect: 'manual', ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });

function numbers() {
  const totals = d1('SELECT COUNT(*) AS days, COALESCE(SUM(views), 0) AS views, COALESCE(SUM(copies), 0) AS copies FROM counters')[0];
  console.log(`counters：${totals.days} 行、閲覧数の合計 ${totals.views}、コピー数の合計 ${totals.copies}`);
  for (const row of d1('SELECT day, SUM(views) AS views, SUM(copies) AS copies FROM counters GROUP BY day ORDER BY day')) {
    console.log(`  ${row.day}：閲覧数 ${row.views}、コピー数 ${row.copies}`);
  }
  for (const row of d1('SELECT work_id, day, views, copies FROM counters ORDER BY day, work_id')) {
    console.log(`    ${row.day} ${row.work_id}：閲覧数 ${row.views}、コピー数 ${row.copies}`);
  }
  console.log(['works', 'creators', 'users', 'sessions', 'likes', 'bookmarks'].map((table) => `${table} ${countRows(table)}`).join('、'));
}

async function accounts() {
  const stamp = Date.now();
  const id = `t013-check-${stamp}`;
  // handle は [a-z0-9_] で20文字まで
  const handle = `t013_${stamp.toString(36)}`.slice(0, 20);
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const before = Object.fromEntries(['users', 'sessions', 'likes', 'bookmarks'].map((table) => [table, countRows(table)]));
  const session = { Cookie: `ld_session=${token}`, Origin: PROD };
  const toggle = async (kind) => {
    const response = await call(`/api/works/${WORK}/${kind}`, { method: 'POST', headers: session });
    return { status: response.status, body: await response.json() };
  };

  // ログインしていない人と、外の Origin
  const anonymous = await call(`/api/works/${WORK}/like`, { method: 'POST', headers: { Origin: PROD } });
  check('ログインしていない人のいいねは 401', anonymous.status === 401, String(anonymous.status));
  const saved = await call('/account/saved');
  check('ログインしていない人の /account/saved はログインへ', saved.status === 302 && saved.headers.get('location') === '/login?next=%2Faccount%2Fsaved', `${saved.status}、${saved.headers.get('location')}`);

  try {
    d1(
      `INSERT INTO users (id, handle, display_name, avatar_url, created_at) VALUES ('${id}', '${handle}', NULL, NULL, ${stamp});` +
        `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('${hash}', '${id}', ${stamp + 10 * 60 * 1000});`,
    );
    const me = async () => (await call('/api/me', { headers: session })).json();
    check('使い捨ての人として /api/me が返る', (await me()).user?.handle === handle);
    const overview = await (await call('/api/account', { headers: session })).json();
    check('/api/account に本人のプロフィールとこの端末が出る', overview.profile?.handle === handle && overview.sessions?.length === 1 && overview.sessions[0].current === true);
    check('/api/account：Google とパスキーが使える', overview.available?.google === true && overview.available?.passkey === true, JSON.stringify(overview.available));
    const accountPage = await call('/account', { headers: session });
    check('ログインしている人の /account は 200', accountPage.status === 200, String(accountPage.status));

    const foreign = await call(`/api/works/${WORK}/like`, { method: 'POST', headers: { ...session, Origin: 'https://evil.example' } });
    check('外の Origin のいいねは 403', foreign.status === 403, String(foreign.status));

    for (const [kind, field, list, table] of [['like', 'liked', 'liked', 'likes'], ['bookmark', 'bookmarked', 'bookmarked', 'bookmarks']]) {
      const on = await toggle(kind);
      const whileOn = await me();
      const rowsOn = countRows(table, `user_id = '${id}'`);
      check(`${kind} を押すと入る`, on.status === 200 && on.body[field] === true && whileOn[list].includes(WORK) && rowsOn === 1, `${on.status}、/api/me に ${whileOn[list].includes(WORK)}、D1 の行 ${rowsOn}`);
      if (kind === 'bookmark') {
        const listed = await (await call('/api/me/bookmarks', { headers: session })).json();
        check('しおりが /api/me/bookmarks に出る', listed.works.some((work) => work.id === WORK), `${listed.works.length} 件`);
        const page = await call('/account/saved', { headers: session });
        check('ログインしている人の /account/saved は 200', page.status === 200, String(page.status));
      }
      const off = await toggle(kind);
      const whileOff = await me();
      const rowsOff = countRows(table, `user_id = '${id}'`);
      check(`${kind} をもう一度押すと取り消す（行が重ならない）`, off.status === 200 && off.body[field] === false && !whileOff[list].includes(WORK) && rowsOff === 0, `${off.status}、D1 の行 ${rowsOff}`);
    }
  } finally {
    d1(`DELETE FROM likes WHERE user_id = '${id}'; DELETE FROM bookmarks WHERE user_id = '${id}'; DELETE FROM sessions WHERE user_id = '${id}'; DELETE FROM users WHERE id = '${id}';`);
    const after = Object.fromEntries(Object.keys(before).map((table) => [table, countRows(table)]));
    check('使い捨ての行を消した（前後で同じ）', Object.keys(before).every((table) => before[table] === after[table]), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  }
}

async function count() {
  const totals = () => d1(`SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(copies), 0) AS copies FROM counters WHERE work_id = '${WORK}'`)[0];
  const before = totals();
  for (const type of ['view', 'copy']) {
    const response = await call('/api/count', { method: 'POST', headers: { Origin: PROD, 'Content-Type': 'application/json' }, body: JSON.stringify({ work_id: WORK, type }) });
    check(`POST /api/count（${type}）`, response.status === 204, String(response.status));
  }
  const after = totals();
  // 外からの閲覧が同時に入ることがあるので、減っていないことと、1以上増えたことを見る
  check('閲覧数とコピー数が本番の D1 で増える', after.views >= before.views + 1 && after.copies >= before.copies + 1, `閲覧数 ${before.views} → ${after.views}、コピー数 ${before.copies} → ${after.copies}`);
  const bad = await call('/api/count', { method: 'POST', headers: { Origin: PROD, 'Content-Type': 'application/json' }, body: JSON.stringify({ work_id: 'no-such-work-t013', type: 'view' }) });
  check('ない作品は数えない', bad.status === 400, String(bad.status));
}

const FIXED_TAB_ORDER = ['Ludion', '作品をさがす', 'ログイン', 'ホーム', '探す', '保存', 'すべて', 'Web', 'モバイル', 'ダッシュボード', 'EC', 'ミニマル', '実験', 'モーション', '人気', '新着'];

async function newPage(browser, viewport) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport });
  // 閲覧数と運営の計測を増やさない（CLAUDE.md 原則10）
  await context.route('**/api/count', (route) => route.abort());
  await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
  return { context, page: await context.newPage() };
}

async function pages() {
  const browser = await chromium.launch();
  try {
    const paths = ['/', `/p/${WORK}`, `/c/${CREATOR}`];
    for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
      for (const path of paths) {
        const { context, page } = await newPage(browser, { width, height });
        const response = await page.goto(`${PROD}${path}`, { waitUntil: 'load' });
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const { violations } = await new AxeBuilder({ page }).exclude('iframe').analyze();
        const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        check(`幅${width} ${path}`, response.status() === 200 && overflow <= 0 && blocking.length === 0, `${response.status()}、横のはみ出し ${overflow}px、axe の critical+serious ${blocking.length}${blocking.length ? `（${blocking.map((v) => v.id).join('、')}）` : ''}`);
        if (path === '/' && width === 768) await page.screenshot({ path: join(shots, 'prod-home-768.png') });
        await context.close();
      }
    }

    // キーボードだけで：検索→チップ→並び→カード→しおり。枠が見える
    {
      const { context, page } = await newPage(browser, { width: 1440, height: 900 });
      await page.goto(`${PROD}/`, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      const visited = [];
      let hidden = 0;
      for (let index = 0; index < FIXED_TAB_ORDER.length + 2; index += 1) {
        await page.keyboard.press('Tab');
        const { name, outline } = await page.evaluate(() => {
          const element = document.activeElement;
          const style = getComputedStyle(element);
          return { name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, outline: `${style.outlineWidth} ${style.outlineStyle}` };
        });
        visited.push(name);
        if (outline !== '2px solid') hidden += 1;
      }
      const order = FIXED_TAB_ORDER.every((name, index) => visited[index] === name) && visited.at(-1).endsWith('を保存');
      check('キーボード：検索→チップ→並び→カード→しおり。枠が見える', order && hidden === 0, `枠が見えない ${hidden}、順 ${visited.join(' → ')}`);
      await context.close();
    }

    // ログインせずにしおりを押すと、GitHub のログインへ
    {
      const { context, page } = await newPage(browser, { width: 1440, height: 900 });
      await page.goto(`${PROD}/?sort=new`, { waitUntil: 'load' });
      const card = page.locator('article').first();
      await card.hover();
      await card.locator('button').click();
      await page.waitForURL(/github\.com/, { timeout: 15_000 });
      const cookies = await context.cookies(`${PROD}/auth/github`); // cookie の Path は /auth/github。戻り先は D1 にある
      const flow = cookies.some((cookie) => cookie.name.startsWith('ld_github_flow_'));
      const url = new URL(page.url());
      check('ログインせずにしおりを押すと GitHub のログインへ行き、途中の状態を持つ', url.hostname === 'github.com' && flow, `${url.origin}${url.pathname}、途中の cookie ${flow}`);
      await context.close();
    }

    // コピーされるコードの1行目がクレジット行（CLAUDE.md 原則4）
    {
      const html = await (await call(`/p/${WORK}`)).text();
      const data = JSON.parse(/id="ld-page">(.*?)<\/script>/s.exec(html)[1]);
      const first = data.snippet.split('\n')[0];
      check('コピーされるコードの1行目がクレジット行', first.startsWith(`<!-- UI by @${CREATOR} — ludion.ai/p/${WORK} (MIT)`), first);
    }
  } finally {
    await browser.close();
  }
}

const [, , command] = process.argv;
if (command === 'numbers') numbers();
else if (command === 'accounts') await accounts();
else if (command === 'count') await count();
else if (command === 'pages') await pages();
else {
  console.error('node scripts/verify-launch.mjs numbers | accounts | count | pages');
  process.exit(2);
}
console.log(failed === 0 ? '全部満たした' : `未達 ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
