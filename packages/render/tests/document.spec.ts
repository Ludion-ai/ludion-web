// 文書の作品（DOC001）：文書をそのまま動かす枠と、コピーされるコード。
import { expect, test } from '@playwright/test';
import { CAPTURE_SCRIPT, DPR_SCRIPT, FRAME_CSP, LOADED_SCRIPT, STORAGE_SCRIPT, ALLOW_MOTION_SCRIPT, buildCopySnippet, buildDocumentFrameHtml, buildDocumentSnippet, doctypeEnd, isHtmlDocument, stripDocumentCredits } from '../src/index.ts';
import type { Creator, Work } from '../src/index.ts';

const DOC = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Ripple</title>
<style>body { margin: 0; background: #123; }</style>
</head>
<body>
<button id="b">Press</button>
<script>
document.getElementById('b').addEventListener('click', () => document.body.dataset.pressed = '1');
</script>
</body>
</html>
`;

const INSERT = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><script>${STORAGE_SCRIPT}</script><script>${DPR_SCRIPT}${LOADED_SCRIPT}</script>`;

test.describe('文書の形か', () => {
  test('<!doctype と <html で始まるものだけ。頭の空白、BOM、コメントは飛ばす', () => {
    expect(isHtmlDocument(DOC)).toBe(true);
    expect(isHtmlDocument('<html><body>x</body></html>')).toBe(true);
    expect(isHtmlDocument('﻿  <!-- a -->\n<!DOCTYPE html><p>x')).toBe(true);
    expect(isHtmlDocument('<div data-ld-part="x"></div>')).toBe(false);
    expect(isHtmlDocument('<head></head>')).toBe(false);
    expect(isHtmlDocument('<htmlx>')).toBe(false);
    expect(isHtmlDocument('')).toBe(false);
  });

  test('doctype の終わり', () => {
    expect(doctypeEnd(DOC)).toBe('<!doctype html>'.length);
    expect(doctypeEnd('<!-- c --><!DOCTYPE html >\n<p>')).toBe('<!-- c --><!DOCTYPE html >'.length);
    expect(doctypeEnd('<html></html>')).toBeNull();
    expect(doctypeEnd('<!-- 閉じない <!doctype html>')).toBeNull();
  });
});

test.describe('枠', () => {
  test('文書は1文字も変えず、doctype の直後にサイトのスクリプトだけを差し込む', () => {
    const frame = buildDocumentFrameHtml(DOC);
    expect(frame).toBe(`<!doctype html>${INSERT}${DOC.slice('<!doctype html>'.length)}`);
    expect(frame.replace(INSERT, '')).toBe(DOC);
  });

  test('doctype がなければ頭に。「動きを見る」はスクリプトだけを足す（文書の CSS は書き換えない）', () => {
    const doc = '<html><head><style>@media (prefers-reduced-motion: reduce) { * { animation: none } }</style></head><body></body></html>';
    expect(buildDocumentFrameHtml(doc)).toBe(`${INSERT}${doc}`);
    expect(buildDocumentFrameHtml(doc, { motion: true })).toBe(`${INSERT}<script>${ALLOW_MOTION_SCRIPT}</script>${doc}`);
  });

  test('ブラウザで、差し込んだスクリプトが文書のどのスクリプトよりも先に動き、標準モードのまま', async ({ page }) => {
    const doc = `<!doctype html><html><head><script>window.__order = [typeof window.__ldFirst, document.compatMode]</script></head><body></body></html>`;
    // 差し込んだものの頭に印を足す（試しのためだけ）
    const frame = buildDocumentFrameHtml(doc).replace('<script>', '<script>window.__ldFirst=1;</script><script>');
    await page.setContent(frame);
    expect(await page.evaluate(() => (window as unknown as { __order: unknown[] }).__order)).toEqual(['number', 'CSS1Compat']);
  });
});

test.describe('撮る仕掛け（DOC002）', () => {
  test('既定では足さない（今の枠の HTML のまま）。capture のときだけ、差し込みの最後に足す', () => {
    expect(buildDocumentFrameHtml(DOC, { capture: false })).toBe(buildDocumentFrameHtml(DOC));
    expect(buildDocumentFrameHtml(DOC, { motion: true, capture: false })).toBe(buildDocumentFrameHtml(DOC, { motion: true }));
    expect(buildDocumentFrameHtml(DOC, { capture: true })).toBe(`<!doctype html>${INSERT}<script>${CAPTURE_SCRIPT}</script>${DOC.slice('<!doctype html>'.length)}`);
    expect(buildDocumentFrameHtml(DOC, { motion: true, capture: true })).toBe(
      `<!doctype html>${INSERT}<script>${ALLOW_MOTION_SCRIPT}</script><script>${CAPTURE_SCRIPT}</script>${DOC.slice('<!doctype html>'.length)}`,
    );
  });

  test('<script> の中に置ける（閉じタグを含まない）。JS として読める', () => {
    expect(CAPTURE_SCRIPT).not.toMatch(/<\/script/i);
    expect(() => new Function(CAPTURE_SCRIPT)).not.toThrow();
  });

  // 試しのページは枠ではないので、parent は自分自身。自分に頼み、自分に返ってくる
  const ask = (page: import('@playwright/test').Page) =>
    page.evaluate(
      () =>
        new Promise<{ ok: boolean; url?: string; reason?: string; width?: number; height?: number }>((resolve) => {
          addEventListener('message', async (event) => {
            const data = event.data as { type?: string; ok: boolean; url?: string; reason?: string };
            if (data?.type !== 'ld-thumb-captured') return;
            if (!data.ok || !data.url) return resolve(data);
            const img = new Image();
            img.src = data.url;
            await img.decode();
            resolve({ ...data, width: img.naturalWidth, height: img.naturalHeight });
          });
          postMessage({ type: 'ld-thumb-capture' }, '*');
        }),
    );

  test('ブラウザで：文書の今の絵（入力の値、canvas）を、枠の大きさの PNG にする', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    const doc = `<!doctype html><html><head><style>body{margin:0;background:#123456}canvas{position:absolute;left:10px;top:10px}</style></head>
<body><input id="i" value="a"><canvas id="c" width="50" height="50"></canvas>
<script>document.getElementById('i').value='typed';const g=document.getElementById('c').getContext('2d');g.fillStyle='#ff0000';g.fillRect(0,0,50,50);</script></body></html>`;
    await page.setContent(buildDocumentFrameHtml(doc, { capture: true }));
    const result = await ask(page);
    expect(result).toMatchObject({ ok: true, width: 640, height: 400 });
    expect(result.url!.startsWith('data:image/png;base64,')).toBe(true);
    // canvas の赤と、背景の色が写っている
    const pixels = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return [Array.from(g.getImageData(30, 30, 1, 1).data), Array.from(g.getImageData(600, 380, 1, 1).data)];
    }, result.url!);
    expect(pixels[0].slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixels[1].slice(0, 3)).toEqual([0x12, 0x34, 0x56]);
  });

  test('ブラウザで：白紙と、Shadow DOM の中があるものは、撮れなかったと返す', async ({ page }) => {
    await page.setContent(buildDocumentFrameHtml('<!doctype html><html><body></body></html>', { capture: true }));
    expect(await ask(page)).toMatchObject({ ok: false, reason: 'blank' });
    const shadow = `<!doctype html><html><body><div id="h"></div><script>document.getElementById('h').attachShadow({mode:'open'}).innerHTML='<p>inside</p>'</script></body></html>`;
    await page.setContent(buildDocumentFrameHtml(shadow, { capture: true }));
    expect(await ask(page)).toMatchObject({ ok: false, reason: 'shadow' });
  });
});

test.describe('コピーされるコード', () => {
  const creator: Creator = { handle: 'Maker', name: 'Maker', kind: 'person', x_url: null, site_url: null };
  const work: Work = { meta: { id: 'ripple-ab12', creator: 'maker' } as Work['meta'], html: '', css: '', js: null, document: DOC };

  test('クレジット行は doctype の直後。リミックスは次の行に元の作品', () => {
    const credit = '<!-- UI by @Maker — ludion.ai/p/ripple-ab12 (MIT) -->';
    expect(buildCopySnippet(work, creator)).toBe(`<!doctype html>\n${credit}${DOC.slice('<!doctype html>'.length)}`);
    const remix = buildCopySnippet(work, creator, { handle: 'orig', id: 'first-one' });
    expect(remix.split('\n').slice(0, 3)).toEqual(['<!doctype html>', credit, '<!-- Remix of UI by @orig — ludion.ai/p/first-one (MIT) -->']);
  });

  test('doctype がなければ1行目', () => {
    expect(buildDocumentSnippet('<html></html>', 'a', 'b-c')).toBe('<!-- UI by @a — ludion.ai/p/b-c (MIT) -->\n<html></html>');
  });

  test('取ったコードを送り直しても、クレジット行は重ならない（外すと元に戻る）', () => {
    const once = buildCopySnippet(work, creator, { handle: 'orig', id: 'first-one' });
    expect(stripDocumentCredits(once)).toBe(DOC);
    expect(stripDocumentCredits(buildCopySnippet({ ...work, document: stripDocumentCredits(once) }, creator))).toBe(DOC);
    expect(stripDocumentCredits(buildDocumentSnippet('<html></html>', 'a', 'b-c'))).toBe('<html></html>');
    // クレジット行のない文書は変えない。途中のコメントも変えない
    const plain = '<!doctype html><!-- my note --><html></html>';
    expect(stripDocumentCredits(plain)).toBe(plain);
    expect(stripDocumentCredits(DOC)).toBe(DOC);
  });
});
