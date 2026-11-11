// DEPLOY003：npm run deploy の最後の一歩（scripts/wrangler-deploy.mjs）。wrangler deploy が Cloudflare の一時的な誤りで
// 落ちたときだけ、1分あけて2回まで流し直す。ほかの誤りでは流し直さない。
// 偽の wrangler で試す。本物の wrangler と Cloudflare は呼ばない。
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { deployWithRetry, isTransient, RETRIES, WAIT_MS } from '../scripts/wrangler-deploy.mjs';

const webDir = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCRIPT = join(webDir, 'scripts/wrangler-deploy.mjs');
const ESC = '\x1b';

/** 11/11 の deploy で、wrangler deploy が実際に出した誤り（色の制御の文字もそのまま。アカウントの番号だけ偽にした）。 */
const TRANSIENT = [
  ` ${ESC}[31m✘ ${ESC}[41;31m[${ESC}[41;97mERROR${ESC}[41;31m]${ESC}[0m ${ESC}[1mA request to the Cloudflare API (/accounts/0123456789abcdef/workers/scripts/ludion-web/versions) failed.${ESC}[0m`,
  '',
  '  binding DB of type d1 failed to generate. Please try again later or contact support. [code: 10021]',
  `  To learn more about this error, visit: ${ESC}[4mhttps://developers.cloudflare.com/workers/observability/errors/#validation-errors-10021${ESC}[0m`,
  '',
  `  If you think this is a bug, please open an issue at: ${ESC}[4mhttps://github.com/cloudflare/workers-sdk/issues/new/choose${ESC}[0m`,
  '',
].join('\n');

/** 同じ code 10021 でも、Worker のコードの誤り。流し直しても直らない。 */
const BAD_SCRIPT = [
  ` ${ESC}[31m✘ ${ESC}[41;31m[${ESC}[41;97mERROR${ESC}[41;31m]${ESC}[0m ${ESC}[1mA request to the Cloudflare API (/accounts/0123456789abcdef/workers/scripts/ludion-web/versions) failed.${ESC}[0m`,
  '',
  '  Uncaught SyntaxError: Unexpected token \'}\' at worker.js:1:10 [code: 10021]',
  '',
].join('\n');

/** API ではない誤り（設定の誤り）。 */
const CONFIG_ERROR = ` ${ESC}[31m✘ ${ESC}[41;31m[${ESC}[41;97mERROR${ESC}[41;31m]${ESC}[0m ${ESC}[1mMissing entry-point to Worker script or to assets directory${ESC}[0m\n`;

const SUCCESS = 'Uploaded ludion-web (3.21 sec)\nDeployed ludion-web triggers (0.52 sec)\n  https://ludion.ai\nCurrent Version ID: 11111111-2222-3333-4444-555555555555\n';

test.describe('誤りの見分け', () => {
  test('11/11 の「binding DB of type d1 failed to generate. Please try again later」は一時的な誤り', () => {
    expect(isTransient(TRANSIENT)).toBe(true);
    // 色の制御の文字がなくても同じ
    expect(isTransient(TRANSIENT.replace(/\x1b\[[0-9;]*m/g, ''))).toBe(true);
  });

  test('code 10021 でも「try again later」がなければ、一時的な誤りではない（Worker のコードの誤り）', () => {
    expect(isTransient(BAD_SCRIPT)).toBe(false);
  });

  test('Cloudflare の API の失敗ではない誤りは、一時的な誤りではない', () => {
    expect(isTransient(CONFIG_ERROR)).toBe(false);
    expect(isTransient(`${CONFIG_ERROR}  Please try again later.\n`)).toBe(false);
  });

  test('[ERROR] がない、または前の [ERROR] だけが一時的な誤り → 一時的な誤りではない', () => {
    expect(isTransient('')).toBe(false);
    expect(isTransient('Please try again later\n')).toBe(false);
    // 最後の誤りで決める
    expect(isTransient(`${TRANSIENT}${BAD_SCRIPT}`)).toBe(false);
  });
});

test.describe('流し直し方', () => {
  test('1分あけて2回まで（全部で3回まで）', async () => {
    expect(RETRIES).toBe(2);
    expect(WAIT_MS).toBe(60_000);
    const waits: number[] = [];
    let runs = 0;
    const code = await deployWithRetry({
      run: async () => {
        runs++;
        return { code: 1, output: TRANSIENT };
      },
      wait: async (ms) => {
        waits.push(ms);
      },
      log: () => {},
    });
    expect(code).toBe(1);
    expect(runs).toBe(3);
    expect(waits).toEqual([60_000, 60_000]);
  });

  test('npm run deploy の最後の一歩がこれで、待つ時間を縮める値は package.json と deploy の workflow に置かない', () => {
    const scripts = (JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.deploy).toMatch(/node scripts\/migrate\.mjs --remote && node scripts\/wrangler-deploy\.mjs$/);
    expect(scripts.deploy).not.toMatch(/(^|&& )wrangler deploy/);
    const workflow = readFileSync(join(webDir, '../../.github/workflows/deploy.yml'), 'utf8');
    for (const text of [JSON.stringify(scripts), workflow]) expect(text).not.toContain('LD_TEST_DEPLOY_RETRY_WAIT_MS');
  });
});

/** 偽の wrangler を PATH の先頭に置いて、本物の CLI を流す。plan の順に、出力と終わりの番号を返す。 */
function runCli(plan: { stdout?: string; stderr?: string; code: number }[]) {
  const root = mkdtempSync(join(tmpdir(), 'ld-wrangler-deploy-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const calls = join(root, 'calls.json');
    const fake = join(root, 'fake-wrangler.mjs');
    writeFileSync(
      fake,
      `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const plan = ${JSON.stringify(plan)};
const calls = existsSync(${JSON.stringify(calls)}) ? JSON.parse(readFileSync(${JSON.stringify(calls)}, 'utf8')) : [];
calls.push({ args: process.argv.slice(2), token: process.env.CLOUDFLARE_API_TOKEN ?? null });
writeFileSync(${JSON.stringify(calls)}, JSON.stringify(calls));
const step = plan[Math.min(calls.length - 1, plan.length - 1)];
if (step.stdout) process.stdout.write(step.stdout);
if (step.stderr) process.stderr.write(step.stderr);
process.exitCode = step.code;
`,
    );
    writeFileSync(join(bin, 'wrangler.cmd'), `@node "${fake}" %*\r\n`);
    writeFileSync(join(bin, 'wrangler'), `#!/bin/sh\nexec node "${fake}" "$@"\n`, { mode: 0o755 });
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    const env: Record<string, string | undefined> = { ...process.env, LD_TEST_DEPLOY_RETRY_WAIT_MS: '0', CLOUDFLARE_API_TOKEN: 'test-token-not-real', GITHUB_ACTIONS: '' };
    env[pathKey] = `${bin}${delimiter}${process.env[pathKey] ?? ''}`;
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8', env });
    const recorded = existsSync(calls) ? (JSON.parse(readFileSync(calls, 'utf8')) as { args: string[]; token: string | null }[]) : [];
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls: recorded };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.describe('scripts/wrangler-deploy.mjs（偽の wrangler で）', () => {
  test('1回で通れば、流し直さない。出力と秘密の値はそのまま', () => {
    const result = runCli([{ stdout: SUCCESS, code: 0 }]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toEqual([{ args: ['deploy'], token: 'test-token-not-real' }]);
    // deploy の workflow は、この行から Worker の版を読む
    expect(result.stdout).toContain('Current Version ID: 11111111-2222-3333-4444-555555555555');
    expect(result.stdout).not.toContain('流し直す');
    // 秘密の値を、ここで出さない
    expect(`${result.stdout}${result.stderr}`).not.toContain('test-token-not-real');
  });

  test('一時的な誤りで1回落ちて、2回目で通る → 通る', () => {
    const result = runCli([{ stderr: TRANSIENT, code: 1 }, { stdout: SUCCESS, code: 0 }]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toHaveLength(2);
    expect(result.calls.every((call) => call.args.join(' ') === 'deploy' && call.token === 'test-token-not-real')).toBe(true);
    // テストでは待つ時間を 0 に縮めている（本番の値は上の「1分あけて2回まで」で確かめる）
    expect(result.stdout).toMatch(/一時的な誤りで落ちた。\d+ 秒後に流し直す（1\/2）/);
    expect(result.stdout).toContain('Current Version ID: 11111111-2222-3333-4444-555555555555');
    // wrangler の誤りの出力も、そのまま流す
    expect(result.stderr).toContain('Please try again later or contact support. [code: 10021]');
  });

  test('一時的な誤りが3回続く → 3回で止めて、落ちる', () => {
    const result = runCli([{ stderr: TRANSIENT, code: 1 }]);
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(3);
    expect(result.stdout).toContain('（1/2）');
    expect(result.stdout).toContain('（2/2）');
    expect(result.stdout).toContain('3 回目も落ちた');
  });

  test('code 10021 でも中身の誤り → 流し直さず、wrangler の終わりの番号のまま落ちる', () => {
    const result = runCli([{ stderr: BAD_SCRIPT, code: 3 }, { stdout: SUCCESS, code: 0 }]);
    expect(result.status).toBe(3);
    expect(result.calls).toHaveLength(1);
    expect(result.stdout).not.toContain('流し直す');
  });

  test('API ではない誤り → 流し直さない', () => {
    const result = runCli([{ stderr: CONFIG_ERROR, code: 1 }, { stdout: SUCCESS, code: 0 }]);
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(1);
  });

  test('一時的な誤りの次に、ほかの誤り → 2回で止める（回ごとの出力で決める）', () => {
    const result = runCli([{ stderr: TRANSIENT, code: 1 }, { stderr: BAD_SCRIPT, code: 1 }, { stdout: SUCCESS, code: 0 }]);
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(2);
  });
});
