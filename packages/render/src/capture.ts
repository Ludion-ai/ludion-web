// 文書の作品の枠の中で、作品の今の絵を作る仕掛け（DOC002「2」）。持ち主だけが見る下書きの枠で、?capture=1 のときだけ差し込む
// （apps/web/worker/frames.ts）。公開の枠と、今ある作品の枠には入れない。
//
// - 文書を写して SVG の foreignObject に入れ、data: の画像として canvas に描き、PNG の data URL を親に返す（お金がかからず、外へ読みに行かない。
//   blob: だと canvas が汚れて読めない）。
// - 動いている要素は、今の計算された値を写して動きを切る（SVG の画像の中では CSS の動きが 0 秒から始まり直すため）。
// - canvas は中身が写らないので、その時の絵の <img> に置き換え、作品の CSS が canvas のタグで当てた形を、計算された形で写す。
// - 入力の今の値（JS が変えた value、checked）は属性に写す。CSSOM で足した規則は <style> に写す。
// - SVG の画像の中の data: の画像を描かないブラウザ（WebKit）では、見えている canvas を、描いた絵の上の同じ場所に重ねる。
// - 撮れないとき（読めない、白紙、Shadow DOM の中がある）は ok: false と理由を返す。親はファイルを選ぶ道を出す。
//
// 作品の JS と同じ枠（オリジンのない sandbox）で動くので、作品の JS は同じ形の知らせを作れる。親は送り元と形と大きさを確かめ、
// 絵はサーバーがもう一度全部を読み直す（apps/web/worker/thumb.ts）。絵は作り手が出す画像と同じ扱いで、公開の前に運営が見る。

/** 親 → 枠：今の絵を作る。 */
export const CAPTURE_REQUEST = 'ld-thumb-capture';
/** 枠 → 親：作った絵（{ type, ok, url } か { type, ok: false, reason }）。 */
export const CAPTURE_RESULT = 'ld-thumb-captured';
/** 枠 → 親：撮る仕掛けがある（load の後に1回）。来なければ、親はファイルを選ぶ道だけを出す。 */
export const CAPTURE_READY = 'ld-thumb-ready';

/** 撮れなかった理由。 */
export type CaptureFailure = 'shadow' | 'blank' | 'tainted' | 'decode' | 'error';

// 文字列のまま <script> に入れる（packages/render の枠のスクリプトと同じ形）。`</script` と、テンプレートの差し込みを書かない。
export const CAPTURE_SCRIPT = `(()=>{
const P = parent;
const STYLE_PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'margin', 'z-index', 'transform', 'opacity', 'border-radius', 'border', 'box-shadow', 'background', 'filter', 'mix-blend-mode', 'vertical-align', 'box-sizing', 'max-width'];
const readable = (canvas) => { try { canvas.getContext('2d').getImageData(0, 0, 1, 1); return true; } catch (e) { return false; } };
const visible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight ? r : null;
};
const svgImage = async (inner, w, h) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject x="0" y="0" width="100%" height="100%">' + inner + '</foreignObject></svg>';
  const img = new Image();
  img.width = w;
  img.height = h;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  return img;
};
// SVG の画像の中の data: の画像を、このブラウザが描くか（WebKit は描かない）。赤い1点の画像を描かせて読む
let drawsInnerImages = null;
const checkInnerImages = async () => {
  if (drawsInnerImages !== null) return drawsInnerImages;
  try {
    const dot = document.createElement('canvas');
    dot.width = 4;
    dot.height = 4;
    const d = dot.getContext('2d');
    d.fillStyle = '#ff0000';
    d.fillRect(0, 0, 4, 4);
    const img = await svgImage('<img xmlns="http://www.w3.org/1999/xhtml" src="' + dot.toDataURL('image/png') + '" width="4" height="4" style="display:block"/>', 4, 4);
    const out = document.createElement('canvas');
    out.width = 4;
    out.height = 4;
    const g = out.getContext('2d');
    g.drawImage(img, 0, 0, 4, 4);
    const px = g.getImageData(1, 1, 1, 1).data;
    drawsInnerImages = px[0] > 200 && px[1] < 60 && px[2] < 60 && px[3] > 200;
  } catch (e) {
    drawsInnerImages = false;
  }
  return drawsInnerImages;
};
// Shadow DOM の中は写らない。開いた Shadow DOM に中身がある、または中の見えない部品（閉じた Shadow DOM の疑い）が見えている
const hasShadow = () => {
  for (const el of document.querySelectorAll('*')) {
    if (el.shadowRoot && el.shadowRoot.childNodes.length > 0) return true;
    if (el.localName.includes('-') && window.customElements && customElements.get(el.localName) && !el.shadowRoot && el.childNodes.length === 0 && visible(el)) return true;
  }
  return false;
};

const pageColor = () => {
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
  }
  return '#ffffff';
};

async function capture() {
  if (hasShadow()) return { ok: false, reason: 'shadow' };
  const W = innerWidth;
  const H = innerHeight;
  const clone = document.documentElement.cloneNode(true);
  // 動いている要素は、今の計算された値を style に写し、動きを切る
  const origAll = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
  const copyAll = [clone, ...clone.querySelectorAll('*')];
  for (const anim of document.getAnimations()) {
    const el = anim.effect && anim.effect.target;
    if (!el || (anim.effect.pseudoElement ?? null) !== null) continue;
    const k = copyAll[origAll.indexOf(el)];
    if (!k) continue;
    const cs = getComputedStyle(el);
    const props = new Set();
    for (const frame of anim.effect.getKeyframes()) for (const p of Object.keys(frame)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
    for (const p of props) k.style.setProperty(p, cs.getPropertyValue(p));
    k.style.setProperty('animation', 'none', 'important');
    k.style.setProperty('transition', 'none', 'important');
  }
  // 終わった動き（fill のないもの）も、画像の中では 0 秒から始まり直す。全部の動きを切る（動いているものの値は上で写した）
  const stop = document.createElement('style');
  stop.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
  (clone.querySelector('head') ?? clone).appendChild(stop);
  // canvas は中身が写らないので、その時の絵の <img> に置き換える
  const origCanvas = [...document.querySelectorAll('canvas')];
  const copyCanvas = clone.querySelectorAll('canvas');
  origCanvas.forEach((c, i) => {
    const img = document.createElement('img');
    for (const a of c.getAttributeNames()) if (a !== 'width' && a !== 'height') img.setAttribute(a, c.getAttribute(a));
    try {
      img.src = c.toDataURL();
    } catch (e) {}
    // 作品の CSS が canvas のタグで当てた形（position など）は <img> に当たらないので、計算された形を写す
    const cs = getComputedStyle(c);
    for (const p of STYLE_PROPS) img.style.setProperty(p, cs.getPropertyValue(p));
    copyCanvas[i].replaceWith(img);
  });
  // 入力の今の値は属性にない。属性に写す
  const origInput = document.querySelectorAll('input, textarea, select');
  const copyInput = clone.querySelectorAll('input, textarea, select');
  origInput.forEach((el, i) => {
    const k = copyInput[i];
    if (!k) return;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked ? k.setAttribute('checked', '') : k.removeAttribute('checked');
    else if (el.tagName === 'TEXTAREA') k.textContent = el.value;
    else if (el.tagName === 'SELECT') [...k.options].forEach((o, j) => (el.options[j] && el.options[j].selected ? o.setAttribute('selected', '') : o.removeAttribute('selected')));
    else k.setAttribute('value', el.value);
  });
  clone.querySelectorAll('script').forEach((s) => s.remove());
  // CSSOM で足した規則（insertRule）は文字にないので、<style> に写す
  let extra = '';
  for (const sheet of document.styleSheets) {
    const node = sheet.ownerNode;
    if (!node || node.tagName !== 'STYLE') continue;
    try {
      const rules = [...sheet.cssRules].map((r) => r.cssText).join('\\n');
      if (rules.length > (node.textContent || '').length * 1.2 + 200) extra += rules + '\\n';
    } catch (e) {}
  }
  if (extra) {
    const s = document.createElement('style');
    s.textContent = extra;
    const head = clone.querySelector('head');
    if (head) head.appendChild(s);
  }
  let img;
  try {
    img = await svgImage(new XMLSerializer().serializeToString(clone), W, H);
  } catch (e) {
    return { ok: false, reason: 'decode' };
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d');
  // ページの地の色。ふつうの描画では html か body の背景の色が画面いっぱいに広がるが、SVG の画像の中では中身の高さまでしか塗られない
  g.fillStyle = pageColor();
  g.fillRect(0, 0, W, H);
  try {
    g.drawImage(img, 0, 0, W, H);
  } catch (e) {
    return { ok: false, reason: 'tainted' };
  }
  // SVG の画像の中の canvas の絵を描かないブラウザでは、見えている canvas を同じ場所に重ねる
  if (origCanvas.length > 0 && !(await checkInnerImages())) {
    for (const c of origCanvas) {
      const r = visible(c);
      if (!r) continue;
      const cs = getComputedStyle(c);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      g.globalAlpha = Math.max(0, Math.min(1, Number(cs.opacity) || 0));
      try {
        g.drawImage(c, r.left, r.top, r.width, r.height);
      } catch (e) {}
    }
    g.globalAlpha = 1;
  }
  if (!readable(out)) return { ok: false, reason: 'tainted' };
  // 白紙（全部が同じ色）は撮れなかったとする
  const data = g.getImageData(0, 0, W, H).data;
  let blank = true;
  for (let i = 4; i < data.length; i += 4) {
    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
      blank = false;
      break;
    }
  }
  if (blank) return { ok: false, reason: 'blank' };
  return { ok: true, url: out.toDataURL('image/png') };
}

addEventListener('message', async (e) => {
  if (e.source !== P || !e.data || e.data.type !== '${CAPTURE_REQUEST}') return;
  let result;
  try {
    result = await capture();
  } catch (err) {
    result = { ok: false, reason: 'error' };
  }
  P.postMessage(Object.assign({ type: '${CAPTURE_RESULT}' }, result), '*');
});
addEventListener('load', () => P.postMessage({ type: '${CAPTURE_READY}' }, '*'));
})();`;
