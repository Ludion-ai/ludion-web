// docs/screens/ の画像を撮り直す（開発用）。
//   node packages/ld/scripts/screens.ts
// - ld-thumbs.png：良い見本5つの thumb.webp を並べたもの（fx-nav は幅いっぱいの部品。T005 から 800×480）
// - ld-preview.png：ld preview fx-landing の画面

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { imageSize } from '../src/images.ts';
import { startPreview } from '../src/preview.ts';
import { REPO_ROOT, findWork } from '../src/workspace.ts';

const IDS = ['fx-toggle', 'fx-button', 'fx-nav', 'fx-landing', 'fx-habits'];
const out = join(REPO_ROOT, 'docs/screens');

const browser = await chromium.launch();

// サムネイルを、実寸の半分で横に並べる
const cells = IDS.map((id) => {
  const file = readFileSync(join(REPO_ROOT, 'fixtures/works', id, 'thumb.webp'));
  const size = imageSize(file)!;
  return `<figure><img src="data:image/webp;base64,${file.toString('base64')}" width="${size.width / 2}" height="${size.height / 2}" alt="">
<figcaption>${id} · ${size.width}×${size.height} · ${(file.length / 1024).toFixed(1)}KB</figcaption></figure>`;
}).join('');
const sheet = await browser.newPage({ viewport: { width: 1720, height: 600 }, deviceScaleFactor: 1 });
await sheet.setContent(`<!doctype html><style>
body{margin:0;padding:24px;background:#F4F4F6;font:13px/18px system-ui,sans-serif;color:#4A4A55;display:flex;gap:16px;align-items:flex-start;width:max-content}
figure{margin:0}img{display:block;border:1px solid #ECECF0;border-radius:14px}figcaption{margin-top:8px}
</style>${cells}`);
await sheet.screenshot({ path: join(out, 'ld-thumbs.png'), fullPage: true });

// ld preview の画面
const location = findWork('fx-landing')!;
const server = await startPreview(location, { port: 0, open: false });
const preview = await browser.newPage({ viewport: { width: 1600, height: 2140 }, deviceScaleFactor: 1 });
await preview.goto(server.url);
await preview.waitForFunction(() => document.querySelectorAll('iframe').length === 9);
await preview.waitForTimeout(800);
await preview.screenshot({ path: join(out, 'ld-preview.png') });
await server.close();

await browser.close();
console.log('docs/screens/ld-thumbs.png と docs/screens/ld-preview.png を撮った');
