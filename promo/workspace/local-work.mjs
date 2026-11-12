// 動画に出す作品を、手元の開発のサーバーにだけ置く（V006。場面3と4の「雨の窓ぎわ」）。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/workspace/local-work.mjs --persist <置き場> wallpaper-rain-window
// リポジトリの works/<id> を、ld upload の手元の道（--env dev。送り先は LD_DEV_URL、既定 http://localhost:5473）で置き、手元でだけ公開にする。
// 本番（ludion.ai）には送らない：送り先が手元でなければ止まる。--env prod は付けない。ld login もしない。
// 置いた後、その作者（creators/）に、動画に出す人（person.mjs）をつなぐ。

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDev } from './dev-server.mjs';
import { ensurePerson } from './person.mjs';
import { waitForQuiet } from './quiet.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = (process.env.LD_DEV_URL || 'http://localhost:5473').replace(/\/+$/, '');
const persist = valueOf('--persist');
const ids = argv.filter((a, i) => !a.startsWith('--') && !['--persist', '--wait-max'].includes(argv[i - 1]));
if (!persist || ids.length === 0) throw new Error('使い方: node promo/workspace/local-work.mjs --persist <置き場> <作品の id>…');
{
  const host = new URL(BASE).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${BASE}`);
}

await waitForQuiet(Number(valueOf('--wait-max') || 8)); // ld upload は、置く前に作品をブラウザで確かめる
const dev = await startDev({ persist, base: BASE });
try {
  const env = { ...process.env, LD_DEV_URL: BASE };
  delete env.LD_DEV_TOKEN; // 管理トークンは、自分の worktree の apps/web/.dev.vars（手元だけの値）から ld が読む
  const r = spawnSync(process.execPath, [resolve(ROOT, 'packages', 'ld', 'bin', 'ld.mjs'), 'upload', ...ids, '--publish', '--env', 'dev'], { cwd: ROOT, env, encoding: 'utf8' });
  console.log(String(r.stdout).trim().split('\n').slice(-12).join('\n'));
  if (r.status !== 0) throw new Error(`ld upload が ${r.status} で終わった:\n${String(r.stderr).slice(-1500)}`);
  for (const id of ids) {
    const page = await fetch(`${BASE}/p/${encodeURIComponent(id)}`, { redirect: 'manual' });
    const code = await fetch(`${BASE}/p/${encodeURIComponent(id)}/code`, { redirect: 'manual' });
    console.log(JSON.stringify({ step: 'placed', id, page: page.status, code: code.status }));
    await page.arrayBuffer();
    await code.arrayBuffer();
    if (page.status !== 200) throw new Error(`${id} のページが手元で開けない: ${page.status}`);
  }
  console.log(JSON.stringify({ step: 'person', ...ensurePerson(resolve(persist)) }));
} finally {
  await dev.stop();
}
