// PC の守り（V006）：ほかの試験（Playwright など）や動画の書き出しが動いている間は、重い作業（描く、ブラウザを起こす）を始めない。0 になるまで待つ。

import { spawnSync } from 'node:child_process';

const PATTERN = 'playwright.*test|@playwright.test.cli|vitest|\\s--test(\\s|$)|promo[\\\\/][\\w-]+\\.mjs';

/** ほかに動いている試験と書き出しの数（自分は数えない）。 */
export function busyCount() {
  if (process.platform === 'win32') {
    const script = `$n = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -match '${PATTERN}' } | Measure-Object).Count; $f = (Get-Process ffmpeg -ErrorAction SilentlyContinue | Measure-Object).Count; "$($n + $f)"`;
    const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    const n = Number(String(r.stdout).trim());
    if (r.status !== 0 || !Number.isFinite(n)) throw new Error(`動いているものを数えられなかった: ${r.stderr}`);
    return n;
  }
  const r = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  const re = new RegExp(`${PATTERN}|^\\s*\\d+\\s+\\S*ffmpeg`);
  return String(r.stdout).split('\n').filter((line) => re.test(line) && Number(line.trim().split(/\s+/)[0]) !== process.pid).length;
}

/** 0 になるまで待つ。maxMinutes 待っても空かなければ、止まる（始めない）。 */
export async function waitForQuiet(maxMinutes = 8) {
  const maxMs = maxMinutes * 60 * 1000;
  const started = Date.now();
  for (let said = false; ; ) {
    const n = busyCount();
    if (n === 0) return;
    if (!said) console.log(`ほかの試験か書き出しが ${n} 個動いている。0 になるまで待つ`);
    said = true;
    if (Date.now() - started > maxMs) throw new Error(`${Math.round(maxMs / 60000)}分待っても空かなかった（動いているもの ${n} 個）。始めていない`);
    await new Promise((done) => setTimeout(done, 10000));
  }
}
