// 埋め込みの印（/e/<id> の右下の「Ludion · Remix」）の3案を、外のサイトの形のページで撮る。
// 実行：npm run build のあと、node scripts/shots-embed-badge.mjs --out <絵を置く場所>
//
// - 手元の使い捨ての D1 と R2（.wrangler/embed-badge）に、開発のデータと works/ の2作品を直に入れ、vite preview で動かす。本番には何も送らない。
// - 外のサイトは、ここで立てる別のサーバー（http://localhost:<別のポート>。Ludion は 127.0.0.1 なので別のサイト）。
//   中身は作品のページの「埋め込む」の1行と同じ書き方の <iframe>（src/lib/embed.ts）。
// - 案の形は scripts/embed-badge-variants.css。/e/<id> の文書に後から足すだけで、worker/embed.ts と作品のファイルは変えない。
// - 撮るのは Chromium だけ（実の GPU）。PC は 1440 幅、スマホは 390 幅。どちらも2倍。
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from '@ludion/rules';
import { getPlatformProxy } from 'wrangler';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '../..');
const outArg = process.argv.indexOf('--out');
if (outArg < 0 || !process.argv[outArg + 1]) throw new Error('--out <絵を置く場所> が要る');
const outDir = resolve(process.argv[outArg + 1]);
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(webDir, 'dist'))) throw new Error('先に npm run build');

const WORKS = ['wallpaper-rain-window', 'toggle-daylight'];
const PORT = 4293;
const LUDION = `http://127.0.0.1:${PORT}`;
const persistDir = join(webDir, '.wrangler/embed-badge');
const variantsCss = readFileSync(join(webDir, 'scripts/embed-badge-variants.css'), 'utf8');

// ---- 手元の D1 と R2 ----
rmSync(persistDir, { recursive: true, force: true });
const serverEnv = { ...process.env, LD_PERSIST_DIR: persistDir, LD_NO_INSPECTOR: '1' };
for (const script of ['migrate.mjs', 'seed-dev.mjs']) {
  execFileSync(process.execPath, [join(webDir, 'scripts', script)], { cwd: webDir, env: serverEnv, stdio: ['ignore', 'ignore', 'inherit'] });
}

const CONTENT_TYPES = {
  'part.html': 'text/html; charset=utf-8',
  'part.css': 'text/css; charset=utf-8',
  'part.js': 'text/javascript; charset=utf-8',
  'meta.json': 'application/json; charset=utf-8',
  'thumb.webp': 'image/webp',
  'og.png': 'image/png',
};

const metas = {};
{
  const { env, dispose } = await getPlatformProxy({ configPath: join(webDir, 'wrangler.jsonc'), persist: { path: join(persistDir, 'v3') }, remoteBindings: false });
  try {
    const { DB: db, PARTS: parts } = env;
    // 作者は開発のデータの見本の作者を借りる（/e/<id> は作者を出さない）
    const creatorId = await db.prepare("SELECT id FROM creators WHERE id LIKE 'seed-creator-%' ORDER BY id LIMIT 1").first('id');
    const now = Date.now();
    for (const id of WORKS) {
      const dir = join(repoDir, 'works', id);
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
      metas[id] = meta;
      const thumb = readFileSync(join(dir, 'thumb.webp'));
      const size = imageSize(thumb);
      for (const name of Object.keys(CONTENT_TYPES)) {
        if (existsSync(join(dir, name))) {
          await parts.put(`works/${id}/${meta.version}/${name}`, readFileSync(join(dir, name)), { httpMetadata: { contentType: CONTENT_TYPES[name] } });
        }
      }
      await db.batch([
        db.prepare('DELETE FROM revisions WHERE work_id = ?').bind(id),
        db.prepare('DELETE FROM works WHERE id = ?').bind(id),
        db
          .prepare(
            `INSERT INTO works (id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status,
               pin_order, thumb_key, thumb_w, thumb_h, created_at, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', NULL, ?, ?, ?, ?, ?)`,
          )
          .bind(id, creatorId, meta.title, meta.type, meta.platform, meta.category, meta.subtype, JSON.stringify(meta.tags), meta.made_with, meta.version, meta.license,
            `works/${id}/${meta.version}/thumb.webp`, size.width, size.height, now, Date.parse(`${meta.published_at}T00:00:00Z`)),
        db
          .prepare(
            `INSERT INTO revisions (id, work_id, version, status, r2_prefix, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, created_at, updated_at)
             SELECT lower(hex(randomblob(16))), w.id, w.version, w.status, 'works/' || w.id || '/' || w.version, w.title, w.type, w.platform, w.category, w.subtype, w.tags, w.made_with, w.thumb_w, w.thumb_h, w.created_at, w.created_at
             FROM works w WHERE w.id = ?`,
          )
          .bind(id),
      ]);
    }
  } finally {
    await dispose();
  }
}

// ---- サーバー（Ludion と外のサイト） ----
const preview = spawn(`npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`, { cwd: webDir, shell: true, stdio: 'ignore', env: serverEnv });

// 途中で落ちても preview を残さない
process.on('exit', () => {
  if (process.platform === 'win32' && preview.pid) {
    try {
      execFileSync('taskkill', ['/pid', String(preview.pid), '/t', '/f'], { stdio: 'ignore' });
    } catch {}
  } else preview.kill();
});

/** 作品のページの「埋め込む」の1行と同じ大きさ（src/lib/embed.ts の embedSize） */
const embedSize = (meta) => (meta.type === 'component' ? { width: 640, height: 480 } : meta.platform === 'mobile' ? { width: 390, height: 844 } : { width: 640, height: 400 });
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const outside = createServer((request, response) => {
  const id = new URL(request.url ?? '/', 'http://localhost').searchParams.get('id') ?? '';
  const meta = metas[id];
  if (!meta) {
    response.writeHead(404);
    response.end();
    return;
  }
  const { width, height } = embedSize(meta);
  const iframe =
    `<iframe id="embed" src="${LUDION}/e/${encodeURIComponent(id)}" width="${width}" height="${height}" ` +
    `style="border:0;max-width:100%;height:auto;aspect-ratio:${width}/${height}" title="${escape(`${meta.title} · UI by @${meta.creator} · Ludion`)}" loading="lazy"></iframe>`;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A personal blog</title>
<style>body{margin:0;background:#fafaf9;color:#1c1917;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:640px;margin:0 auto;padding:24px 16px}h1{font-size:22px;font-weight:600;margin:8px 0 12px}p{margin:12px 0;color:#57534e}iframe{display:block}</style></head>
<body><main><h1>A personal blog</h1><p>Here is a switch I liked:</p>${iframe}<p>Text after the embed.</p></main></body></html>`);
});
await new Promise((done) => outside.listen(0, '::', done));
const OUTSIDE = `http://localhost:${outside.address().port}`;

for (let i = 0; ; i += 1) {
  try {
    if ((await fetch(`${LUDION}/e/${WORKS[0]}`)).ok) break;
  } catch {}
  if (i > 120) throw new Error('vite preview が立たない');
  await new Promise((done) => setTimeout(done, 500));
}

// ---- 撮る ----
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const VIEWPORTS = {
  pc: { label: 'PC 1440', options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  phone: { label: 'スマホ 390', options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
};

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const pathOf = (frame) => (frame.url().startsWith('http') ? new URL(frame.url()).pathname : '');
const record = { checks: [], sizes: {} };

async function openScene(context, id) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${OUTSIDE}/post?id=${id}`);
  let embed;
  let work;
  for (let i = 0; i < 100 && !(embed && work); i += 1) {
    embed = page.frames().find((frame) => pathOf(frame) === `/e/${id}`);
    work = page.frames().find((frame) => pathOf(frame).startsWith(`/frame/${id}/`) && pathOf(frame).endsWith('/embed.html'));
    await wait(100);
  }
  if (!embed || !work) throw new Error(`${id}：枠が出ない`);
  await work.waitForLoadState('load');
  await wait(3500); // 作品の最初のコマ（WebGL）が描けるまで
  await embed.evaluate((css) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  }, variantsCss);
  return { page, embed, errors };
}

const setVariant = (embed, variant) =>
  embed.evaluate((value) => {
    if (value === 'a') delete document.documentElement.dataset.badge;
    else document.documentElement.dataset.badge = value;
  }, variant);

/** C のはじめの帯の動きを、決まった時刻で止める（null なら終わらせる） */
const holdIntro = (embed, ms) =>
  embed.evaluate((at) => {
    const badge = document.querySelector('.ld-badge');
    for (const animation of badge.getAnimations({ subtree: true })) {
      if (at === null) animation.finish();
      else {
        animation.pause();
        animation.currentTime = at;
      }
    }
  }, ms);

async function badgeBox(page, embed) {
  const frameBox = await page.locator('#embed').boundingBox();
  const box = await embed.locator('.ld-badge').boundingBox();
  return { frameBox, box: { width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 } };
}

async function shoot(page, embed, name, key) {
  await wait(400); // 広がる・縮むの動き（180ms）が終わるまで
  const { frameBox, box } = await badgeBox(page, embed);
  record.sizes[key] = box;
  // ページの中身の高さまで（ブログの文の下に 24px）
  const bottom = await page.evaluate(() => Math.ceil(document.querySelector('main').getBoundingClientRect().bottom + 24));
  const full = await page.screenshot({ clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(bottom, page.viewportSize().height) } });
  writeFileSync(join(outDir, `${name}.png`), full);
  // 印の角の拡大（枠の右下）
  const cropW = Math.min(240, frameBox.width);
  const crop = await page.screenshot({ clip: { x: frameBox.x + frameBox.width - cropW, y: frameBox.y + frameBox.height - 64, width: cropW, height: 64 } });
  return { full, crop };
}

const away = (page) => page.mouse.move(2, 2);
const scenes = [];

for (const [vpKey, vp] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext(vp.options);
  for (const id of WORKS) {
    const { page, embed, errors } = await openScene(context, id);
    const base = `${id}-${vpKey}`;
    const shots = {};
    const badge = page.frameLocator('#embed').locator('.ld-badge');

    await setVariant(embed, 'a');
    shots.a = await shoot(page, embed, `${base}-a`, `${base}-a`);

    await setVariant(embed, 'b');
    await away(page);
    shots.b = await shoot(page, embed, `${base}-b`, `${base}-b`);
    await badge.hover();
    shots.bOpen = await shoot(page, embed, `${base}-b-open`, `${base}-b-open`);
    await away(page);

    // C：data-badge を c にした時に、はじめの帯の動きが始まる（本物では読み込んだ時）
    await setVariant(embed, 'c');
    await holdIntro(embed, 1000);
    shots.cOpen = await shoot(page, embed, `${base}-c-open`, `${base}-c-open`);
    await holdIntro(embed, null);
    shots.c = await shoot(page, embed, `${base}-c`, `${base}-c`);
    // 縮んだ後に乗せると、B と同じに広がるか
    await badge.hover();
    await wait(400);
    record.sizes[`${base}-c-hover-after`] = (await badgeBox(page, embed)).box;
    await away(page);

    // 押すと /p/<id> が新しいタブで開く（どの案も）
    for (const variant of ['a', 'b', 'c']) {
      await setVariant(embed, variant);
      if (variant === 'c') await holdIntro(embed, null);
      await away(page);
      await wait(300);
      const popupPromise = context.waitForEvent('page');
      if (vpKey === 'phone') await badge.tap();
      else await badge.click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      record.checks.push({ scene: base, variant, opened: new URL(popup.url()).pathname, outsideUrlKept: page.url().startsWith(`${OUTSIDE}/post`) });
      await popup.close();
    }
    record.checks.push({ scene: base, pageerrors: errors.length });
    scenes.push({ id, vpKey, title: metas[id].title, label: vp.label, shots });
    await page.close();
  }
  await context.close();
}

// ---- 並べた絵 ----
const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
const composer = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
for (const scene of scenes) {
  const panelW = scene.vpKey === 'pc' ? 880 : 390;
  const { shots } = scene;
  const crop = (shot) => `<img class="crop" src="${dataUrl(shot.crop)}">`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#e7e5e4;font:15px/1.5 system-ui,"Segoe UI","Yu Gothic UI",sans-serif;color:#1c1917;width:max-content}
h1{font-size:20px;margin:0 0 16px}.row{display:grid;grid-template-columns:repeat(3,${Math.max(panelW, 480)}px);gap:24px;margin-bottom:20px}
h2{font-size:16px;margin:0 0 8px}h3{font-size:13px;font-weight:600;margin:0 0 6px;color:#57534e}
.full{display:block;width:${panelW}px;border:1px solid #c7c3c0;background:#fff}.crop{display:block;width:auto;border:1px solid #c7c3c0}
.note{font-size:12px;color:#57534e;margin:4px 0 0}</style></head><body>
<h1>${escape(scene.title)} · ${escape(scene.label)} · 埋め込みの印の3案</h1>
<div class="row">
<div><h2>A：今のまま（帯）</h2><img class="full" src="${dataUrl(shots.a.full)}"></div>
<div><h2>B：マークだけ（ふだん）</h2><img class="full" src="${dataUrl(shots.b.full)}"></div>
<div><h2>C：はじめの3秒は帯 → マークだけ（3秒後）</h2><img class="full" src="${dataUrl(shots.c.full)}"></div>
</div>
<div class="row">
<div><h3>A の印（2倍）</h3>${crop(shots.a)}</div>
<div><h3>B の印（2倍）</h3>${crop(shots.b)}</div>
<div><h3>C の印・3秒後（2倍）</h3>${crop(shots.c)}</div>
</div>
<div class="row">
<div><h3>A は広がらない（いつも帯）</h3></div>
<div><h3>B：乗せた・触れた・キーボードで選んだ時（2倍）</h3>${crop(shots.bOpen)}<p class="note">1枚：${scene.id}-${scene.vpKey}-b-open.png</p></div>
<div><h3>C：読み込んで3秒の間（2倍）。3秒後に乗せた時も同じ</h3>${crop(shots.cOpen)}<p class="note">1枚：${scene.id}-${scene.vpKey}-c-open.png</p></div>
</div></body></html>`;
  const page = await composer.newPage();
  await page.setContent(html);
  await page.screenshot({ path: join(outDir, `${scene.id}-${scene.vpKey}-compare.png`), fullPage: true });
  await page.close();
}

writeFileSync(join(outDir, 'checks.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));

await browser.close();
outside.close();
process.exit(0);
