// 投稿を開いた後に見る数（docs/tasks/T032.md）。読むだけ：D1 に SELECT だけを流す。
//
// node scripts/posting-stats.mjs            本番の D1（ludion-app）。wrangler d1 execute --remote
// node scripts/posting-stats.mjs --local    手元の D1（npm run dev の .wrangler）
//
// 数えないもの：運営（users.is_operator = 1）の版と、作り手のいない版（created_by が空。ld upload の版）。
// 退会した人（users の行がない）の版は、運営でないので数える。
// 出すのは数だけ。人の id、handle、作品の名前と ID は出さない（CLAUDE.md 原則6）。
//
// 日ごとの数は JST の日で、その人が初めてそこまで進んだ日に数える（日ごとの数を足すと全体になる）。
// 承認の版と差し戻しは、審査した日（reviewed_at）に数える。
// 承認：reviewed_at があり reject_code がない版（承認の後に取り下げた版も含む）。差し戻し：reject_code がある版。
// リミックス（docs/tasks/T033.md B5）：remix_of がある版だけの、始めた人、審査に出した人、承認まで進んだ人。数だけ。

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(webDir, '../../node_modules/wrangler/bin/wrangler.js');
const local = process.argv.includes('--local');

/** 運営と ld upload の版を除いた版。 */
const COUNTED = `WITH r AS (
  SELECT r.created_by, r.status, r.created_at, r.submitted_at, r.reviewed_at, r.reject_code, r.remix_of
  FROM revisions r LEFT JOIN users u ON u.id = r.created_by
  WHERE r.created_by IS NOT NULL AND r.created_by <> '' AND COALESCE(u.is_operator, 0) = 0
)`;
/** ミリ秒の時刻を JST の日に。 */
const day = (column) => `date(${column} / 1000 + 32400, 'unixepoch')`;
const APPROVED = 'reviewed_at IS NOT NULL AND reject_code IS NULL';
const REJECTED = 'reviewed_at IS NOT NULL AND reject_code IS NOT NULL';

const QUERIES = {
  total: `${COUNTED} SELECT
    (SELECT COUNT(DISTINCT created_by) FROM r) AS started,
    (SELECT COUNT(DISTINCT created_by) FROM r WHERE submitted_at IS NOT NULL) AS submitted,
    (SELECT COUNT(DISTINCT created_by) FROM r WHERE ${APPROVED}) AS approved_people,
    (SELECT COUNT(*) FROM r WHERE ${APPROVED}) AS approved,
    (SELECT COUNT(*) FROM r WHERE ${REJECTED}) AS rejected,
    (SELECT COUNT(*) FROM r WHERE status = 'submitted') AS queue,
    (SELECT MIN(submitted_at) FROM r WHERE status = 'submitted') AS oldest`,
  remix: `${COUNTED} SELECT
    (SELECT COUNT(DISTINCT created_by) FROM r WHERE remix_of IS NOT NULL) AS started,
    (SELECT COUNT(DISTINCT created_by) FROM r WHERE remix_of IS NOT NULL AND submitted_at IS NOT NULL) AS submitted,
    (SELECT COUNT(DISTINCT created_by) FROM r WHERE remix_of IS NOT NULL AND ${APPROVED}) AS approved_people`,
  rejectCodes: `${COUNTED} SELECT reject_code AS code, COUNT(*) AS n FROM r WHERE ${REJECTED} GROUP BY reject_code ORDER BY n DESC, code`,
  started: `${COUNTED} SELECT ${day('t')} AS day, COUNT(*) AS n FROM (SELECT MIN(created_at) AS t FROM r GROUP BY created_by) GROUP BY day`,
  submitted: `${COUNTED} SELECT ${day('t')} AS day, COUNT(*) AS n FROM (SELECT MIN(submitted_at) AS t FROM r WHERE submitted_at IS NOT NULL GROUP BY created_by) GROUP BY day`,
  approvedPeople: `${COUNTED} SELECT ${day('t')} AS day, COUNT(*) AS n FROM (SELECT MIN(reviewed_at) AS t FROM r WHERE ${APPROVED} GROUP BY created_by) GROUP BY day`,
  approved: `${COUNTED} SELECT ${day('reviewed_at')} AS day, COUNT(*) AS n FROM r WHERE ${APPROVED} GROUP BY day`,
  rejected: `${COUNTED} SELECT ${day('reviewed_at')} AS day, reject_code AS code, COUNT(*) AS n FROM r WHERE ${REJECTED} GROUP BY day, code`,
};

/** SELECT だけを流す。書く文が混じっていたら流さない。 */
function select(sql) {
  if (!/^\s*(WITH|SELECT)\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i.test(sql)) throw new Error('読むだけの文ではない');
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ludion-app', local ? '--local' : '--remote', '--json', '--command', sql], {
    cwd: webDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(out)[0].results;
}

const rows = Object.fromEntries(Object.entries(QUERIES).map(([name, sql]) => [name, select(sql)]));
const [total] = rows.total;
const [remix] = rows.remix;

/** 待ち時間を「◯時間◯分」に。 */
function wait(ms) {
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}時間${minutes % 60}分` : `${minutes}分`;
}
const codes = (list) => (list.length ? list.map((row) => `${row.code} ${row.n}`).join('、') : '');

const now = Date.now();
const jst = new Date(now + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);
console.log(`# 投稿の数（${local ? '手元' : '本番'}の D1。${jst} JST。運営と ld upload の版を除く）`);
console.log('');
console.log('| 数 | 全体 |');
console.log('| --- | --- |');
console.log(`| 投稿を始めた人（版を1つでも作った） | ${total.started} |`);
console.log(`| 審査に出した人 | ${total.submitted} |`);
console.log(`| 承認まで進んだ人 | ${total.approved_people} |`);
console.log(`| 承認された版 | ${total.approved} |`);
console.log(`| 差し戻し | ${total.rejected}${rows.rejectCodes.length ? `（${codes(rows.rejectCodes)}）` : ''} |`);
console.log(`| 今の審査待ち | ${total.queue} |`);
console.log(`| 審査待ちのいちばん古いものの待ち時間 | ${total.oldest == null ? 'なし' : `${wait(now - total.oldest)}${now - total.oldest > 24 * 3600_000 ? '（24時間を超えた）' : ''}`} |`);
console.log('');
console.log('| リミックス（remix_of がある版）の数 | 全体 |');
console.log('| --- | --- |');
console.log(`| 始めた人 | ${remix.started} |`);
console.log(`| 審査に出した人 | ${remix.submitted} |`);
console.log(`| 承認まで進んだ人 | ${remix.approved_people} |`);
console.log('');

const days = [...new Set(['started', 'submitted', 'approvedPeople', 'approved', 'rejected'].flatMap((name) => rows[name].map((row) => row.day)))].sort();
const on = (name, date) => rows[name].find((row) => row.day === date)?.n ?? 0;
console.log('| 日（JST） | 始めた人 | 審査に出した人 | 承認まで進んだ人 | 承認された版 | 差し戻し |');
console.log('| --- | --- | --- | --- | --- | --- |');
if (days.length === 0) console.log('| （まだない） | 0 | 0 | 0 | 0 | 0 |');
for (const date of days) {
  const rejected = rows.rejected.filter((row) => row.day === date);
  const n = rejected.reduce((sum, row) => sum + row.n, 0);
  console.log(`| ${date} | ${on('started', date)} | ${on('submitted', date)} | ${on('approvedPeople', date)} | ${on('approved', date)} | ${n}${n ? `（${codes(rejected)}）` : ''} |`);
}
