// 記録を取るときだけ使う（V006）。Ludion の道具（ludion.mjs login）が「ブラウザを開く」所を、この PC の本物のブラウザを開く代わりに、
// 開くはずだった住所をファイルに書くことに差し替える。記録を取るスクリプトが、その住所を自分のブラウザ（見本の人でログイン済み）で開く。
// NODE_OPTIONS=--require で読ませる。LD_PROMO_URL_DROP（書き先）がなければ、何もしない。
const drop = process.env.LD_PROMO_URL_DROP;
if (drop) {
  const cp = require('node:child_process');
  const fs = require('node:fs');
  const { syncBuiltinESMExports } = require('node:module');
  const spawn = cp.spawn;
  cp.spawn = function (cmd, args, ...rest) {
    const opener = cmd === 'rundll32' || cmd === 'open' || cmd === 'xdg-open';
    const url = opener && Array.isArray(args) ? args.find((a) => /^https?:\/\//.test(String(a))) : null;
    if (!url) return spawn.call(this, cmd, args, ...rest);
    fs.writeFileSync(drop, String(url));
    return { on() {}, unref() {} };
  };
  syncBuiltinESMExports();
}
