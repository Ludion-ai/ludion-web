// D1（ludion-app）に migrations/ を当てる。
// - 引数なし：手元の D1。npm run dev と npm run preview の前に動く。
//   LD_PERSIST_DIR があれば、そこに置く（vite.config.ts と同じ場所。既定は .wrangler/state）。
// - --remote：本番の D1。npm run deploy の中で動く。
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(webDir, '../../node_modules/wrangler/bin/wrangler.js');
const persistDir = process.env.LD_PERSIST_DIR;
const remote = process.argv.includes('--remote');

execFileSync(
  process.execPath,
  [
    wrangler,
    'd1',
    'migrations',
    'apply',
    'ludion-app',
    ...(remote ? ['--remote'] : ['--local', ...(persistDir ? ['--persist-to', persistDir] : [])]),
  ],
  // CI=1：当てる前の確認を聞かずに進める
  { cwd: webDir, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CI: '1' } },
);
