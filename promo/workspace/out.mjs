// 作ったものと一時ファイルの置き場（V006）。コミットしない。
// 既定は promo/out/。環境変数 LD_PROMO_OUT があれば、そこに置く（PC によっては、作業の置き場の外に一時ファイルを作れないため、置き場を選べるようにする）。
// ブラウザが作る一時ファイルも、この中の tmp/ に作らせる（TEMP を差し替える）。

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT_ROOT = process.env.LD_PROMO_OUT ? resolve(process.env.LD_PROMO_OUT) : resolve(HERE, '..', 'out');

/** このプロセスと、ここから起こすブラウザの一時ファイルを、置き場の tmp/ に作らせる。 */
export function useLocalTemp() {
  const tmp = resolve(OUT_ROOT, 'tmp');
  mkdirSync(tmp, { recursive: true });
  process.env.TEMP = tmp;
  process.env.TMP = tmp;
  process.env.TMPDIR = tmp;
  return tmp;
}
