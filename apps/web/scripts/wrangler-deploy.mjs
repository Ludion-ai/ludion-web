// npm run deploy の最後の一歩（DEPLOY003）。wrangler deploy を流し、Cloudflare の一時的な誤りで落ちたときだけ、
// 1分あけて2回まで流し直す（全部で3回まで）。ビルドと D1 の migration は流し直さない（この前の一歩で済んでいる）。
//
// 流し直すのは、その回の出力の最後の [ERROR] の塊が、Cloudflare の API の失敗で、「try again later」（後でもう一度）を
// 含むときだけ。例：「A request to the Cloudflare API (/accounts/…/workers/scripts/ludion-web/versions) failed.
// binding DB of type d1 failed to generate. Please try again later or contact support. [code: 10021]」。
// code 10021 だけでは決めない。10021 は中身の誤り（Worker のコードの誤りなど）にも付き、流し直しても直らないため。
// [ERROR] の塊がない、シグナルで止まった、ほかの誤り：流し直さず、wrangler の終わりの番号をそのまま返す。
//
// 出力は、そのまま端末（と deploy の workflow の tee）へ流す。workflow はそこから「Current Version ID」を読む。
// 環境変数（秘密の値を含む）は、そのまま wrangler に渡し、ここでは読まない・出さない。
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** 流し直す回数（最初の1回を除く）。 */
export const RETRIES = 2;
/** 流し直す前に待つ時間。 */
export const WAIT_MS = 60_000;

/** 色の制御の文字を除き、空白をまとめる。 */
function plain(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\s+/g, ' ');
}

/** その回の出力が、流し直してよい一時的な誤りで終わったか。 */
export function isTransient(output) {
  const text = plain(output);
  const at = text.lastIndexOf('[ERROR]');
  if (at < 0) return false;
  const block = text.slice(at);
  return /A request to the Cloudflare API \([^)]*\) failed\./.test(block) && /try again later/i.test(block);
}

/** wrangler deploy を1回流す。出力はそのまま流しつつ、その回の分を集める。 */
function runOnce() {
  return new Promise((resolve) => {
    // Windows では wrangler は wrangler.cmd なので、シェルを通す（引数は1つの文字列で渡す）
    const child = spawn('wrangler deploy', { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      process.stderr.write(`wrangler deploy を始められなかった：${error.message}\n`);
      resolve({ code: 1, output });
    });
    child.on('close', (code, signal) => resolve({ code: signal ? 1 : (code ?? 1), output }));
  });
}

/** 一時的な誤りのときだけ、待って流し直す。最後の回の終わりの番号を返す。 */
export async function deployWithRetry({ run = runOnce, wait = (ms) => new Promise((r) => setTimeout(r, ms)), retries = RETRIES, waitMs = WAIT_MS, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  for (let attempt = 0; ; attempt++) {
    const { code, output } = await run();
    if (code === 0) return 0;
    if (attempt >= retries || !isTransient(output)) {
      if (attempt > 0) log(`wrangler deploy が ${attempt + 1} 回目も落ちた。流し直さずに止める`);
      return code;
    }
    const message = `wrangler deploy が Cloudflare の一時的な誤りで落ちた。${Math.round(waitMs / 1000)} 秒後に流し直す（${attempt + 1}/${retries}）`;
    if (process.env.GITHUB_ACTIONS === 'true') log(`::warning::${message}`);
    else log(message);
    await wait(waitMs);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // テストだけが待つ時間を縮める（短くすることだけができる）。package.json と deploy の workflow では置かない
  const testWait = process.env.LD_TEST_DEPLOY_RETRY_WAIT_MS;
  const waitMs = testWait && /^\d+$/.test(testWait) ? Math.min(Number(testWait), WAIT_MS) : WAIT_MS;
  process.exitCode = await deployWithRetry({ waitMs });
}
