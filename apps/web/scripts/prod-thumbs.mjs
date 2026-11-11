// 本番のサムネイルを1枚の画像に並べる（docs/tasks/T013.md「0」）。npm test には入れない（本番に要求を送るため）。
// node scripts/prod-thumbs.mjs [出力先]（既定は docs/screens/prod-thumbs.png）
//
// - 取るのは /api/works と thumb.webp だけ。作品のページを開かないので、閲覧数は増えない（CLAUDE.md 原則10）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROD = 'https://ludion.ai';
const out = resolve(process.argv[2] ?? join(root, 'docs/screens/prod-thumbs.png'));
const headers = { 'User-Agent': 'ludion-prod-thumbs' };

const { works } = await (await fetch(`${PROD}/api/works`, { headers })).json();
works.sort((a, b) => a.id.localeCompare(b.id));

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cells = [];
for (const work of works) {
  const url = `${PROD}/w/${work.id}/${work.version}/thumb.webp`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} が ${response.status}`);
  const src = `data:image/webp;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
  cells.push(`<figure><img alt="" src="${src}"><figcaption>${escape(work.id)} 版 ${escape(work.version)}（${escape(work.title)}）</figcaption></figure>`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1500, height: 900 } });
await page.setContent(
  `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#fff;color:#111114;font:14px/20px system-ui,sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start}
figure{margin:0}img{display:block;width:100%;height:auto;border:1px solid #ececf0;border-radius:8px}figcaption{margin-top:6px}
</style>${cells.join('')}`,
  { waitUntil: 'load' },
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await page.screenshot({ type: 'png', fullPage: true }));
await browser.close();
console.log(`${works.length} 枚を ${out} に並べた`);
