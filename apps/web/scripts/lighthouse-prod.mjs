// 本番の URL を Lighthouse の mobile で5回ずつ測る（docs/tasks/T012.md「4」）。npm test には入れない（本番に要求を送るため）。
// node scripts/lighthouse-prod.mjs <パス> [<パス>...]。例：node scripts/lighthouse-prod.mjs / /p/button-ticket
//
// - 閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count を止める。GA4 も止める（運営の計測を解析に混ぜない。gtag.js は load の後に読むので LCP を待たせない）。
// - 測る前に1回取って、キャッシュを温める（本番のふつうの状態で測る）。
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROD = 'https://ludion.ai';
const RUNS = 5;
const LCP_LIMIT_MS = 2500;
const CLS_LIMIT = 0.05;
const LIGHTHOUSE = 'lighthouse@12.8.2';
const BLOCKED = ['*/api/count', '*googletagmanager.com*', '*google-analytics.com*'];

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('node scripts/lighthouse-prod.mjs <パス> [<パス>...]');
  process.exit(2);
}
const tempDir = mkdtempSync(join(tmpdir(), 'ludion-lighthouse-'));
const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

async function run(url, index) {
  const output = join(tempDir, `run-${index}.json`);
  const command = [
    `npx -y ${LIGHTHOUSE} "${url}"`,
    '--quiet --form-factor=mobile --only-categories=performance',
    ...BLOCKED.map((pattern) => `--blocked-url-patterns="${pattern}"`),
    `--output=json --output-path="${output}"`,
    '--chrome-flags="--headless=new --no-sandbox --disable-frame-rate-limit"',
  ].join(' ');
  const status = await new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: 'ignore', env: { ...process.env, CHROME_PATH: chromium.executablePath() } });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (status !== 0) throw new Error(`Lighthouse が失敗した（終了コード ${status}）`);
  return JSON.parse(readFileSync(output, 'utf8'));
}

let failed = false;
try {
  for (const path of paths) {
    const url = `${PROD}${path}`;
    const warmed = await fetch(url, { headers: { 'User-Agent': 'ludion-lighthouse-prod' } });
    await warmed.arrayBuffer();
    console.log(`\n${url}（温めの cf-cache-status=${warmed.headers.get('cf-cache-status')}）`);
    const rows = [];
    for (let index = 1; index <= RUNS; index += 1) {
      const { audits } = await run(url, index);
      const element = audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
      const phases = audits['largest-contentful-paint-element']?.details?.items?.[1]?.items ?? [];
      const requests = audits['network-requests'].details.items;
      const document = requests.find((request) => request.url === url);
      const row = {
        lcp: audits['largest-contentful-paint'].numericValue,
        fcp: audits['first-contentful-paint'].numericValue,
        tbt: audits['total-blocking-time'].numericValue,
        cls: audits['cumulative-layout-shift'].numericValue,
        ttfb: audits['server-response-time']?.numericValue ?? 0,
        html: Math.round((document?.transferSize ?? 0) / 1024),
        element: /src="([^"]+)"/.exec(element?.snippet ?? '')?.[1] ?? element?.selector ?? '?',
        phases: phases.map((phase) => `${phase.phase} ${Math.round(phase.timing)}ms`).join('、'),
      };
      rows.push(row);
      console.log(
        `${index}回目  LCP ${Math.round(row.lcp)}ms  FCP ${Math.round(row.fcp)}ms  TBT ${Math.round(row.tbt)}ms  CLS ${row.cls.toFixed(4)}  サーバーの応答 ${Math.round(row.ttfb)}ms  HTML ${row.html}KB  LCP要素 ${row.element}  ${row.phases}`,
      );
    }
    const lcp = median(rows.map((row) => row.lcp));
    const cls = median(rows.map((row) => row.cls));
    const over = lcp > LCP_LIMIT_MS || cls > CLS_LIMIT;
    if (over) failed = true;
    console.log(`中央値  LCP ${Math.round(lcp)}ms（基準 ${LCP_LIMIT_MS}ms）  CLS ${cls.toFixed(4)}（基準 ${CLS_LIMIT}）  ${over ? '不合格' : '合格'}`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
