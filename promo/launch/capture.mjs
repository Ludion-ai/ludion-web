// 作品の絵を撮る（V002）。works/ は変えない。撮った絵は promo/out/launch-cache/ に残し、同じ入力なら撮り直さない。
// - カード：サムネイルと同じ構図（packages/ld/src/images.ts）で、幅 1600px に撮る
// - スイッチ：作品のページで実際にマウスで動かし、昼から夜までをコマごとに撮る
// 時間は止めて進める（V001 と同じ）。作品の外への通信はすべて止めて、記録する。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFrameHtml } from '@ludion/render';
import { fitComponent } from '../../packages/ld/src/images.ts';
import { findWork, readWork, toRenderable } from '../../packages/ld/src/workspace.ts';

const FRAME_URL = 'http://ld-frame.localhost/';
const CARD_WIDTH = 1600;
const SEQ_SCALE = 2; // スイッチのコマは、幅 1280 の枠の2倍（2560px）。4K の静止画でも足りる

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t));

function installVirtualTime() {
  const v = { now: 0, raf: new Map(), rafId: 1, timers: new Map(), timerId: 1 };
  const realRaf = window.requestAnimationFrame.bind(window);
  const base = Date.UTC(2026, 10, 9);
  window.requestAnimationFrame = (cb) => {
    const id = v.rafId++;
    v.raf.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => v.raf.delete(id);
  performance.now = () => v.now;
  Date.now = () => base + v.now;
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = v.timerId++;
    v.timers.set(id, { at: v.now + ms, fn, args });
    return id;
  };
  window.clearTimeout = (id) => v.timers.delete(id);
  let seed = 20261109;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  window.__vt = {
    step(ms) {
      v.now += ms;
      for (const [id, timer] of [...v.timers].sort((x, y) => x[1].at - y[1].at)) {
        if (timer.at > v.now) continue;
        v.timers.delete(id);
        timer.fn(...timer.args);
      }
      const batch = [...v.raf.values()];
      v.raf.clear();
      for (const cb of batch) cb(v.now);
    },
    painted: () => new Promise((done) => realRaf(() => realRaf(done))),
  };
}

function hashWork(work, extra = '') {
  return createHash('sha256').update(JSON.stringify([work.html, work.css, work.js, work.meta?.version, extra])).digest('hex').slice(0, 16);
}

async function openStaged(browser, html, viewport, scale, netLog) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('作品のエラー:', error.message));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    netLog.push({ url, phase: 'work', allowed: url === FRAME_URL });
    if (url === FRAME_URL) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    return route.abort();
  });
  await page.addInitScript(installVirtualTime);
  await page.goto(FRAME_URL, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__vt.painted());
  return { context, page };
}

async function settle(page, ms) {
  const steps = Math.ceil(ms / (1000 / 60));
  const chunk = 8;
  for (let done = 0; done < steps; done += chunk) {
    await page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__vt.step(1000 / 60);
    }, chunk);
    await page.evaluate(() => window.__vt.painted());
  }
}

function layoutFor(work, fit) {
  if (work.meta.type === 'component') {
    return fit.wide
      ? { viewport: fit.viewport, placement: 'top', width: fit.viewport.width }
      : { viewport: fit.viewport, placement: 'center', width: fit.viewport.width };
  }
  return { viewport: { width: 1280, height: 960 }, placement: undefined, width: 1280 };
}

/** 10作品のカードの絵を撮る。 */
export async function captureCards(browser, ids, cacheDir, netLog) {
  const dir = resolve(cacheDir, 'cards');
  mkdirSync(dir, { recursive: true });
  const manifestPath = resolve(dir, 'manifest.json');
  const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const manifest = {};
  for (const id of ids) {
    const location = findWork(id);
    if (!location) throw new Error(`${id} が works/ にない`);
    const work = toRenderable(readWork(location));
    if (!work) throw new Error(`${id} を描画できない`);
    const key = hashWork(work, `card${CARD_WIDTH}`);
    const file = resolve(dir, `${id}.png`);
    if (old[id]?.key === key && existsSync(file)) {
      manifest[id] = old[id];
      continue;
    }
    const fit = work.meta.type === 'component' ? await fitComponent(browser, work) : null;
    const layout = layoutFor(work, fit);
    const html = buildFrameHtml(work, { palette: 'author', width: layout.width, placement: layout.placement });
    const scale = CARD_WIDTH / layout.viewport.width;
    const { context, page } = await openStaged(browser, html, layout.viewport, scale, netLog);
    await settle(page, Math.max(work.meta.capture?.delay_ms ?? 0, 0) + 1200);
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, ...layout.viewport } });
    await context.close();
    manifest[id] = {
      key,
      file: `cards/${id}.png`,
      width: CARD_WIDTH,
      height: Math.round((CARD_WIDTH * layout.viewport.height) / layout.viewport.width),
      title: work.meta.title,
      creator: work.meta.creator,
      type: work.meta.type,
    };
    console.log(`カードを撮った: ${id}（${manifest[id].width}×${manifest[id].height}）`);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

/** スイッチを実際にマウスで動かして、コマごとに撮る。 */
export async function captureSequence(browser, timeline, cacheDir, netLog) {
  const seq = timeline.workSequence;
  const id = timeline.page.workId;
  const location = findWork(id);
  if (!location) throw new Error(`${id} が works/ にない`);
  const work = toRenderable(readWork(location));
  if (!work) throw new Error(`${id} を描画できない`);
  const key = hashWork(work, JSON.stringify([seq, SEQ_SCALE, timeline.fps]));
  const dir = resolve(cacheDir, 'sequence');
  mkdirSync(dir, { recursive: true });
  const manifestPath = resolve(dir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const old = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (old.key === key) return old;
  }

  const fit = await fitComponent(browser, work);
  const layout = layoutFor(work, fit);
  const html = buildFrameHtml(work, { palette: 'author', width: layout.width, placement: layout.placement });
  const { context, page } = await openStaged(browser, html, layout.viewport, SEQ_SCALE, netLog);
  await settle(page, 1200);

  // スイッチの形（promo/toggle-daylight.mjs と同じ割合）
  const box = await page.locator('.hit').boundingBox();
  if (!box) throw new Error('スイッチの .hit が見つからない');
  const pillH = box.height;
  const bezel = pillH * 0.046;
  const winW = box.width - bezel * 2;
  const winH = pillH - bezel * 2;
  const gap = pillH * 0.032;
  const r0 = winH / 2 - gap;
  const travel = winW - (r0 + gap) * 2;
  const CX = box.x + box.width / 2;
  const CY = box.y + box.height / 2;
  const lensAt = (x) => CX + (x - 0.5) * travel;
  const hand = (x) => [lensAt(x) + 14, CY + 30];
  const rest = [CX + box.width * 0.34, Math.min(layout.viewport.height - 8, box.y + box.height + 56)];

  const fps = timeline.fps;
  const total = Math.round((seq.end - seq.start) * fps);
  const cursor = [];
  let pressed = false;
  let released = false;
  let lastMouse = null;
  const started = Date.now();

  for (let frame = 0; frame < total; frame++) {
    const t = seq.start + frame / fps;
    const x = t < seq.drag[0] ? 0 : seq.dragTo * sine(seg(t, seq.drag[0], seq.drag[1]));
    let pos;
    if (t < seq.grab - 0.02) {
      // 掴む前は、作品に触らない場所に置く（カーソルの絵は stage.js が描く）
      pos = rest;
    } else {
      pos = hand(x);
    }
    if (!lastMouse || pos[0] !== lastMouse[0] || pos[1] !== lastMouse[1]) {
      await page.mouse.move(pos[0], pos[1]);
      lastMouse = pos;
    }
    if (!pressed && t >= seq.grab) {
      await page.mouse.down();
      pressed = true;
    }
    if (!released && t >= seq.release) {
      await page.mouse.up();
      released = true;
    }
    await page.evaluate((ms) => window.__vt.step(ms), 1000 / fps);
    await page.evaluate(() => window.__vt.painted());
    await page.screenshot({
      path: resolve(dir, `${String(frame).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 96,
      clip: { x: 0, y: 0, ...layout.viewport },
    });
    cursor.push(hand(x));
    if (frame % 120 === 0) console.log(`スイッチのコマ: ${frame}/${total}（${Math.round((Date.now() - started) / 1000)}秒）`);
  }
  await context.close();

  const manifest = {
    key,
    frames: total,
    start: seq.start,
    fps,
    width: layout.viewport.width * SEQ_SCALE,
    height: layout.viewport.height * SEQ_SCALE,
    viewport: layout.viewport,
    hand: cursor,
    rest,
    box,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(`スイッチのコマを ${total} 枚撮った（${Math.round((Date.now() - started) / 1000)}秒）`);
  return manifest;
}
