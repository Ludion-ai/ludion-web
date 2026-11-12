// 手元の開発のサーバーを、決めた置き場（手元の D1 と R2）で起こす（V006）。使い終わったら止める。本番には何も送らない。
// 置き場には、先に見本のデータを入れておく：LD_PERSIST_DIR=<置き場> npm run seed:dev -w @ludion/web

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = resolve(ROOT, 'apps', 'web');

async function up(base) {
  try {
    return (await fetch(`${base}/`, { redirect: 'manual' })).status < 500;
  } catch {
    return false;
  }
}

/** 起こして、応えるまで待つ。もう応えていれば（自分で起こしてあるとき）、そのまま使い、止めない。 */
export async function startDev({ persist, base }) {
  const url = new URL(base);
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${base}`);
  if (await up(base)) return { started: false, stop: async () => {} };
  const child = spawn(process.execPath, [resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', url.port, '--strictPort'], { cwd: WEB, env: { ...process.env, LD_PERSIST_DIR: resolve(persist) }, stdio: 'ignore' });
  const stop = async () => {
    // 子（workerd）ごと止める
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
    await new Promise((done) => setTimeout(done, 500));
  };
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await up(base)) return { started: true, stop };
    if (child.exitCode !== null) throw new Error(`手元のサーバーが起きなかった（終了 ${child.exitCode}）。ポート ${url.port} が使われていないかを見る`);
    await new Promise((done) => setTimeout(done, 500));
  }
  await stop();
  throw new Error('手元のサーバーが 90秒で起きなかった');
}
