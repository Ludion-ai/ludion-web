// T033 の本番の確かめ（docs/tasks/T033.md「本番の確かめ」）。本番の D1、R2、サイトに当たる。
//
// node scripts/verify-t033.mjs remix     読むだけ：今ある9つのリミックスの remix_of と、コピーされるコード（/p/<id>/code）の2行目
// node scripts/verify-t033.mjs browser   使い捨ての人（運営でない）で、本物のブラウザで /new と /new?from=toggle-daylight のそれぞれから
//                                        審査に出すまで通す。公開はしない（承認しない）。終わったら必ず消し、消し残しがないことを示す
//
// 数は増やさない（CLAUDE.md 原則10：作品のページを開かない。/p/<id>/code は開いても数えない）。GA4 には繋がない。
// 画面を docs/screens/t033-prod-*.png に撮る。

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '../..');
const wrangler = join(repoDir, 'node_modules/wrangler/bin/wrangler.js');
const PROD = 'https://ludion.ai';
const USER_AGENT = 'ludion-verify-t033';
const NO_ANALYTICS = '--host-resolver-rules=MAP *.googletagmanager.com 127.0.0.1:9, MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9';
const SCREENS = join(repoDir, 'docs/screens');
const THUMB_FILE = join(repoDir, 'fixtures/works/fx-button/og.png');
const REMIXES = ['toggle-deep-sea', 'toggle-lighthouse', 'toggle-oasis', 'toggle-rainy-cafe', 'toggle-sakura-shrine', 'toggle-snow-cabin', 'toggle-station', 'toggle-tokyo-alley', 'toggle-volcano-island'];

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

async function remix() {
  const rows = d1(`SELECT id, remix_of, is_remix, status FROM works WHERE remix_of IS NOT NULL ORDER BY id`);
  check('remix_of がある作品は9つ', rows.length === 9, rows.map((row) => row.id).join('、'));
  for (const id of REMIXES) {
    const row = rows.find((one) => one.id === id);
    check(`${id} の remix_of は toggle-daylight、is_remix は 1`, row?.remix_of === 'toggle-daylight' && row?.is_remix === 1, JSON.stringify(row));
    const code = (await (await get(`/p/${id}/code`)).text()).split('\n');
    check(`${id} のコピーされるコードの2行目は元のクレジット行`, code[1] === '<!-- Remix of UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT) -->', code[1]);
    check(`${id} の1行目は自分のクレジット行`, code[0] === `<!-- UI by @Lattice_Node — ludion.ai/p/${id} (MIT) -->`, code[0]);
  }
  const revisions = d1(`SELECT COUNT(*) AS n FROM revisions WHERE remix_of = 'toggle-daylight'`)[0].n;
  check('9作品の版の行にも remix_of', revisions >= 9, `${revisions}行`);
  const original = (await (await get('/p/toggle-daylight/code')).text()).split('\n');
  check('元の作品（toggle-daylight）は1行のクレジットのまま', original[0] === '<!-- UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT) -->' && !original[1].includes('Remix of'), original[1]);
  const from = await get('/new?from=toggle-daylight');
  check('ログインせずに /new?from= を開くと、from を残してログインへ', from.status === 302 && from.headers.get('location') === '/login?next=%2Fnew%3Ffrom%3Dtoggle-daylight', `${from.status} ${from.headers.get('location')}`);
}

/** 使い捨ての人（運営でない）を入れて run を動かし、作品、版、R2 のファイルごと必ず消す。 */
async function withTempPerson(run) {
  const stamp = Date.now();
  const suffix = randomBytes(4).toString('hex');
  const person = { id: `verify-t033-${suffix}`, handle: `verify_${suffix}`, suffix, token: randomBytes(32).toString('hex') };
  const hash = createHash('sha256').update(person.token).digest('hex');
  const before = Object.fromEntries(['users', 'sessions', 'creators', 'works', 'revisions'].map((table) => [table, d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n]));
  d1(
    `INSERT INTO users (id, handle, display_name, avatar_url, created_at, is_operator) VALUES ('${person.id}', '${person.handle}', NULL, NULL, ${stamp}, 0);` +
      `INSERT INTO sessions (token_hash, user_id, expires_at, auth_at) VALUES ('${hash}', '${person.id}', ${stamp + 20 * 60 * 1000}, ${stamp});`,
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
    console.log(`消したもの：作品 ${works ? works.split(', ').length : 0}、版の置き場 ${prefixes.length}`);
    check('使い捨ての人が残っていない', d1(`SELECT COUNT(*) AS n FROM users WHERE id LIKE 'verify-t033-%' OR handle = '${person.handle}'`)[0].n === 0);
    check('使い捨ての作品と版が残っていない', d1(`SELECT (SELECT COUNT(*) FROM works WHERE id LIKE '%${person.suffix}%') + (SELECT COUNT(*) FROM revisions WHERE work_id LIKE '%${person.suffix}%' OR created_by = '${person.id}') + (SELECT COUNT(*) FROM creators WHERE user_id = '${person.id}') AS n`)[0].n === 0);
    for (const prefix of prefixes) {
      let left = 0;
      try {
        left = execFileSync(process.execPath, [wrangler, 'r2', 'object', 'get', `ludion-parts/${prefix}/part.html`, '--remote', '--pipe'], { cwd: webDir, stdio: ['ignore', 'pipe', 'ignore'] }).length;
      } catch {
        // ないので読めない
      }
      check(`R2 の版の置き場 ${prefix.split('/')[1].slice(0, 8)}… が残っていない`, left === 0, `${left} バイト`);
    }
    const after = Object.fromEntries(Object.keys(before).map((table) => [table, d1(`SELECT COUNT(*) AS n FROM ${table}`)[0].n]));
    for (const table of Object.keys(before)) check(`${table} の行が減っていない（今も人が来ているので、増えるのはよい）`, after[table] >= before[table], `${before[table]} → ${after[table]}`);
  }
}

/** 箱に貼る（入力欄の外で貼る。ページのどこで貼っても箱に入る）。 */
async function pasteOnPage(page, text) {
  await page.locator('[data-box-status]').waitFor({ state: 'attached' });
  await page.locator('h1').evaluate((heading, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    heading.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

async function finish(page, title) {
  await page.getByLabel('題名', { exact: true }).fill(title);
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles(THUMB_FILE);
  for (const label of [/自分で作った、または権利がある/, /MIT で公開してよい/, /に同意します/]) await page.getByLabel(label).check();
  await page.getByRole('button', { name: '審査に出す', exact: true }).click();
  await page.getByText('審査に出しました').waitFor({ timeout: 30_000 });
}

async function browserFlow() {
  await withTempPerson(async (person) => {
    const browser = await chromium.launch({ args: [NO_ANALYTICS] });
    try {
      for (const { width, height } of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height } });
        await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
        await context.addCookies([{ name: 'ld_session', value: person.token, domain: 'ludion.ai', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));

        // 1. /new：HTML を1回貼る → 自動で下書き → 枠で動く → 題、サムネイル、同意 → 審査に出す
        const id = `verify-${person.suffix}-${width}`;
        await page.goto(`${PROD}/new`);
        if (width === 1440) await page.screenshot({ path: join(SCREENS, `t033-prod-new-empty-${width}.png`) });
        await pasteOnPage(
          page,
          `<div data-ld-part="${id}"><button type="button">押す</button></div>\n<style>\n[data-ld-part="${id}"] { color: #123456; }\n</style>\n<script type="module">\nfunction mount(root) {\n  const button = root.querySelector('button');\n  const onClick = () => { button.textContent = '押された'; };\n  button.addEventListener('click', onClick);\n  return () => button.removeEventListener('click', onClick);\n}\nmount(document.querySelector('[data-ld-part="${id}"]'));\n</script>`,
        );
        await page.locator('[data-box-status]').getByText('下書きを保存しました').waitFor({ timeout: 30_000 });
        const [draft] = d1(`SELECT r.thumb_w, r.title, r.status FROM revisions r WHERE r.work_id = '${id}'`);
        check(`幅${width}：/new で貼ると、自動でサムネイルのない下書きになる`, draft?.status === 'draft' && draft.thumb_w === 0 && draft.title === '', JSON.stringify(draft));
        const button = page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' });
        await button.click();
        await page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押された' }).waitFor();
        check(`幅${width}：下書きの枠で動く。守りは同じ`, (await page.locator('iframe[data-ld-frame]').getAttribute('sandbox')) === 'allow-scripts allow-forms');
        if (width === 1440 || width === 390) await page.screenshot({ path: join(SCREENS, `t033-prod-new-saved-${width}.png`), fullPage: true });
        await finish(page, `本番の確かめ ${person.suffix}`);
        const [sent] = d1(`SELECT status, thumb_w, remix_of FROM revisions WHERE work_id = '${id}'`);
        check(`幅${width}：/new から審査に出せる（サムネイルあり、remix_of なし）`, sent?.status === 'submitted' && sent.thumb_w === 800 && sent.remix_of === null, JSON.stringify(sent));

        // 2. /new?from=toggle-daylight：別の AI が作った本物のリミックスを、手を入れずに貼る
        await page.goto(`${PROD}/new?from=toggle-daylight`);
        await page.locator('[data-remix-of="toggle-daylight"]').getByText('「住人のいるスイッチ」（@Lattice_Node）のリミックスを載せる').waitFor();
        check(`幅${width}：/new?from= に元の作品の帯が出る`, true);
        await pasteOnPage(page, readFileSync(join(repoDir, 'fixtures/t033-real/remix-1.html'), 'utf8'));
        await page.locator('[data-box-status]').getByText('下書きを保存しました').waitFor({ timeout: 30_000 });
        const fixed = await page.locator('[data-box-fixed]').textContent();
        check(`幅${width}：リミックスの data-ld-part を新しい ID に合わせる`, Boolean(fixed?.includes('data-ld-part を "toggle-daylight" から')), fixed ?? '');
        if (width === 1440 || width === 390) await page.screenshot({ path: join(SCREENS, `t033-prod-from-saved-${width}.png`), fullPage: true });
        await finish(page, `本番の確かめ（リミックス） ${person.suffix}`);
        const [remixRow] = d1(`SELECT w.id, w.remix_of, w.is_remix, w.status, r.status AS revision_status, r.remix_of AS revision_remix_of, w.category, w.subtype, w.made_with FROM works w JOIN revisions r ON r.work_id = w.id JOIN creators c ON c.id = w.creator_id WHERE c.user_id = '${person.id}' AND w.remix_of IS NOT NULL AND w.id LIKE 'toggle-daylight-%' ORDER BY w.created_at DESC LIMIT 1`);
        check(
          `幅${width}：/new?from= から審査に出せる。remix_of が入る。公開していない`,
          remixRow?.remix_of === 'toggle-daylight' && remixRow.revision_remix_of === 'toggle-daylight' && remixRow.is_remix === 1 && remixRow.revision_status === 'submitted' && remixRow.status === 'draft',
          JSON.stringify(remixRow),
        );
        check(`幅${width}：元の作品から種類と作り方を先に入れる`, remixRow?.category === 'Components' && remixRow.subtype === 'Toggle' && remixRow.made_with === 'ai-assisted');
        check(`幅${width}：公開に出ない`, (await get(`/p/${remixRow?.id}/code`)).status === 404 && (await get(`/p/${id}/code`)).status === 404);
        check(`幅${width}：ページのエラーがない`, errors.length === 0, errors.join(' / '));
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}

const mode = process.argv[2];
if (mode === 'remix') await remix();
else if (mode === 'browser') await browserFlow();
else {
  console.log('使い方：node scripts/verify-t033.mjs remix | browser');
  process.exit(2);
}
console.log(failed === 0 ? '全部通った' : `落ちたもの ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
