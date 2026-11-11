// Lighthouse の mobile で3回測り、LCP と CLS の中央値を出す（SPEC.md 12）。
// 実行：npm run build → npm run lcp（seed の50作品を入れた、使い捨ての D1 と R2 で動かす）
// ホーム以外を測るとき：LD_LCP_PATH=/p/fx-landing npm run lcp（開発のデータ全部を入れて動かす）
// 基準を超えたら終了コード 1 を返す。
//
// 本番では Cloudflare が配信のときに HTML、JS、CSS を圧縮する。手元の vite preview は、Worker の応答を圧縮しない
// （Vite の圧縮は plugin の後ろにあり、Worker が先に返す）。そこで、preview の前に gzip だけをする道を置いて、本番と同じ大きさで測る。
// 圧縮なしの値も見るときは LD_LCP_NO_GZIP=1。
// ヘッダーのスイッチの作品を入れて測るとき：LD_LCP_WORKS=toggle-daylight,toggle-oasis npm run lcp（docs/tasks/T035.md）。
// works/ の作品を ld upload で、この使い捨ての D1 と R2 に入れてから測る。本番には送らない。
import { chromium } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LCP_LIMIT_MS = 2500;
const CLS_LIMIT = 0.05;
const RUNS = 3;
const PORT = 4174;
const PREVIEW_PORT = 4177;
const LIGHTHOUSE = 'lighthouse@12.8.2';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = process.env.LD_LCP_PATH ?? '/';
const url = `http://localhost:${PORT}${path}`;
const tempDir = mkdtempSync(join(tmpdir(), 'ludion-lcp-'));

const persistDir = join(webDir, '.wrangler/lcp-state');
const extraWorks = (process.env.LD_LCP_WORKS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
// Worker は dist の .dev.vars があればそれだけを読むので、そこの管理トークンを使う。なければ環境変数で渡す
const distVars = join(webDir, 'dist/ludion_web/.dev.vars');
const adminToken = (existsSync(distVars) && /^\s*ADMIN_TOKEN\s*=\s*['"]?([^'"\s]+)/m.exec(readFileSync(distVars, 'utf8'))?.[1]) || `lcp-${Date.now().toString(36)}`;
const serverEnv = { ...process.env, LD_PERSIST_DIR: persistDir, ...(extraWorks.length ? { ADMIN_TOKEN: adminToken } : {}) };
rmSync(persistDir, { recursive: true, force: true });
for (const script of ['migrate.mjs', 'seed-dev.mjs']) {
  execFileSync(process.execPath, [join(webDir, 'scripts', script)], {
    cwd: webDir,
    // ホームは50作品で測る（SPEC.md 12）
    env: path === '/' ? { ...serverEnv, LD_SEED_NO_FIXTURES: '1' } : serverEnv,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

const server = spawn(`npx vite preview --port ${PREVIEW_PORT} --strictPort`, { cwd: webDir, shell: true, stdio: 'ignore', env: serverEnv });

/** preview の前に置く道。文字のファイルだけを gzip にする（Cloudflare の配信と同じ）。 */
const gzipProxy = createServer(async (request, response) => {
  try {
    // POST（閲覧数）もそのまま渡す。preview から見て自分のサイトになるよう、Origin を書き換える
    const payload = request.method === 'POST' ? Buffer.concat(await Array.fromAsync(request)) : undefined;
    const upstream = await fetch(`http://localhost:${PREVIEW_PORT}${request.url}`, {
      method: request.method,
      body: payload,
      headers: {
        accept: request.headers.accept ?? '*/*',
        ...(request.headers.origin ? { origin: `http://localhost:${PREVIEW_PORT}` } : {}),
        ...(request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : {}),
      },
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const headers = Object.fromEntries(upstream.headers);
    delete headers['transfer-encoding'];
    delete headers['content-length'];
    delete headers.connection;
    delete headers['keep-alive'];
    const compress = !process.env.LD_LCP_NO_GZIP && /^(text\/|application\/json|image\/svg)/.test(headers['content-type'] ?? '');
    response.writeHead(upstream.status, compress ? { ...headers, 'content-encoding': 'gzip' } : headers);
    response.end(compress ? gzipSync(body) : body);
  } catch {
    response.writeHead(502);
    response.end();
  }
});
gzipProxy.listen(PORT);

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    // 作品を入れて測るときは、測るページがまだないので、トップで待つ
    const ok = await fetch(extraWorks.length ? `http://localhost:${PORT}/` : url).then((response) => response.ok, () => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} が立ち上がらない`);
}

function stopServer() {
  gzipProxy.close();
  gzipProxy.closeAllConnections();
  if (process.platform === 'win32') {
    spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true, stdio: 'ignore' });
  } else {
    server.kill();
  }
}

function median(values) {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
}

// spawnSync は使わない：このプロセスの圧縮の道が止まって、Lighthouse が待ち続ける
async function runLighthouse(index) {
  const output = join(tempDir, `run-${index}.json`);
  const command = [
    `npx -y ${LIGHTHOUSE} ${url}`,
    '--quiet --form-factor=mobile --only-categories=performance,accessibility',
    `--output=json --output-path="${output}"`,
    '--chrome-flags="--headless=new --no-sandbox"',
  ].join(' ');
  const status = await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: 'ignore',
      env: { ...process.env, CHROME_PATH: chromium.executablePath() },
    });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (status !== 0) throw new Error(`Lighthouse が失敗した（終了コード ${status}）`);
  return JSON.parse(readFileSync(output, 'utf8'));
}

let failed = false;
try {
  await waitForServer();
  if (extraWorks.length) {
    // 圧縮の道を通さず、preview へ直に送る
    execFileSync(process.execPath, [join(webDir, '../../packages/ld/bin/ld.mjs'), 'upload', ...extraWorks, '--publish', '--env', 'dev'], {
      cwd: join(webDir, '../..'),
      env: { ...process.env, LD_DEV_URL: `http://localhost:${PREVIEW_PORT}`, LD_DEV_TOKEN: adminToken },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    console.log(`作品を入れた：${extraWorks.join('、')}`);
  }
  const rows = [];
  for (let index = 1; index <= RUNS; index += 1) {
    const report = await runLighthouse(index);
    const { audits, categories } = report;
    const element = audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
    const requests = audits['network-requests'].details.items;
    rows.push({
      lcp: audits['largest-contentful-paint'].numericValue,
      fcp: audits['first-contentful-paint'].numericValue,
      tbt: audits['total-blocking-time'].numericValue,
      cls: audits['cumulative-layout-shift'].numericValue,
      a11y: categories.accessibility.score,
      element: element?.selector ?? '?',
      src: /src="([^"]+)"/.exec(element?.snippet ?? '')?.[1] ?? '',
      html: Math.round((requests.find((request) => request.url === url)?.transferSize ?? 0) / 1024),
    });
  }

  rows.forEach((row, index) => {
    console.log(
      `${index + 1}回目  LCP ${Math.round(row.lcp)}ms  FCP ${Math.round(row.fcp)}ms  TBT ${Math.round(row.tbt)}ms  ` +
        `CLS ${row.cls.toFixed(4)}  a11y ${row.a11y}  HTML ${row.html}KB  LCP要素 ${row.src || row.element}`,
    );
  });
  const lcp = median(rows.map((row) => row.lcp));
  const cls = median(rows.map((row) => row.cls));
  console.log(`中央値  LCP ${Math.round(lcp)}ms（基準 ${LCP_LIMIT_MS}ms）  CLS ${cls.toFixed(4)}（基準 ${CLS_LIMIT}）`);
  failed = lcp > LCP_LIMIT_MS || cls > CLS_LIMIT;
  console.log(failed ? '不合格' : '合格');
} finally {
  stopServer();
  rmSync(tempDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
