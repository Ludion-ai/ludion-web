// 作品の枠の中で、作品の今の絵を作る仕掛け（DOC002「2」、THUMB001）。持ち主だけが見る下書きの枠で、?capture=1 のときだけ差し込む
// （apps/web/worker/frames.ts）。公開の枠と、capture のない枠には入れない。
//
// - 文書を写して SVG の foreignObject に入れ、data: の画像として canvas に描き、PNG の data URL を親に返す（お金がかからず、外へ読みに行かない。
//   blob: だと canvas が汚れて読めない）。
// - 動いている要素は、今の計算された値を写して動きを切る（SVG の画像の中では CSS の動きが 0 秒から始まり直すため）。
// - canvas は中身が写らないので、その時の絵の <img> に置き換え、作品の CSS が canvas のタグで当てた形を、計算された形で写す。
//   WebGL の canvas は、描いた絵が画面に出た後に消える。この枠では、作品の JS より先に preserveDrawingBuffer を付けて、絵を読めるようにする。
// - 入力の今の値（JS が変えた value、checked）は属性に写す。CSSOM で足した規則は <style> に写す。
// - 契約の形の作品（frame.ts）は、枠が作品を Shadow DOM に入れている。その中身は、ホストの子として写す
//   （作品の CSS はどのセレクタも根の下にあるので、Shadow DOM の外でも同じに効く。CLAUDE.md「CSS」）。作品が自分で作った Shadow DOM は写らない。
// - WebKit では canvas の絵が写らない（DOC002 で確かめた。原因は分かっていない）。人が撮るときは撮った絵を見せるので、作り手が見てファイルを選べる。
// - 撮れないとき（読めない、白紙、Shadow DOM の中がある）は ok: false と理由を返す。親はファイルを選ぶ道を出す。
// - 自動で撮るとき（THUMB001。人が絵を見ない）は、親が strict と fit を付けて頼む。
//   strict：canvas の絵が撮った絵の同じ場所に写っていない、または大きい canvas が1色のときは、撮れなかったとする（reason: 'canvas'）。
//   写っているかは、canvas の中で地の色（いちばん多い色）と違う点を拾い、撮った絵の同じ場所が、地の色よりその点の色に近いかで見る。
//   fit：部品（data-ld-type="component"）は、部品のまわりを 4:3 で切り出して 800×600 で返す（部品が絵の幅の6割、高さの7割まで。ld のサムネイルと同じ考え方）。
//
// 作品の JS と同じ枠（オリジンのない sandbox）で動くので、作品の JS は同じ形の知らせを作れる。親は送り元と形と大きさを確かめ、
// 絵はサーバーがもう一度全部を読み直す（apps/web/worker/thumb.ts）。絵は作り手が出す画像と同じ扱いで、公開の前に運営が見る。

/** 親 → 枠：今の絵を作る（{ type, strict?, fit? }）。 */
export const CAPTURE_REQUEST = 'ld-thumb-capture';
/** 枠 → 親：作った絵（{ type, ok, url } か { type, ok: false, reason }）。 */
export const CAPTURE_RESULT = 'ld-thumb-captured';
/** 枠 → 親：撮る仕掛けがある（load の後に1回）。来なければ、親はファイルを選ぶ道だけを出す。 */
export const CAPTURE_READY = 'ld-thumb-ready';

/** 撮れなかった理由。 */
export type CaptureFailure = 'shadow' | 'blank' | 'tainted' | 'decode' | 'canvas' | 'error';

/** fit で切り出した絵の大きさ（4:3）。 */
export const CAPTURE_FIT_SIZE = { width: 800, height: 600 } as const;

// 文字列のまま <script> に入れる（packages/render の枠のスクリプトと同じ形）。`</script` と、テンプレートの差し込みを書かない。
// 'ld-host' は frame.ts の HOST_ID と同じ（frame.ts がこのファイルを読むので、ここでは読み込まない）。
export const CAPTURE_SCRIPT = `(()=>{
const P = parent;
// WebGL の絵を、画面に出た後も読めるようにする。作品の JS より先に動く
try {
  const proto = HTMLCanvasElement.prototype;
  const getContext = proto.getContext;
  proto.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return getContext.call(this, type, Object.assign({}, attrs, { preserveDrawingBuffer: true }));
    return getContext.apply(this, arguments);
  };
} catch (e) {}
const STYLE_PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'margin', 'z-index', 'transform', 'opacity', 'border-radius', 'border', 'box-shadow', 'background', 'filter', 'mix-blend-mode', 'vertical-align', 'box-sizing', 'max-width'];
const readable = (canvas) => { try { canvas.getContext('2d').getImageData(0, 0, 1, 1); return true; } catch (e) { return false; } };
const visible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight ? r : null;
};
// zoom：切り出すときの、foreignObject の transform。絵の大きさ（w×h）は変えない。絵の大きさを変えると、中の文書の画面の大きさ（100vh、メディアクエリ）が
// 変わって並びがずれるブラウザがある（Firefox で確かめた）ので、中身の方を広げて、絵の左上から切り出す
const svgImage = async (inner, w, h, zoom) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject x="0" y="0" width="100%" height="100%"' + (zoom ? ' transform="' + zoom + '"' : '') + '>' + inner + '</foreignObject></svg>';
  const img = new Image();
  img.width = w;
  img.height = h;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  return img;
};
// 枠が作品を入れた Shadow DOM のホスト（契約の形の作品）。文書の作品にはない
const ownHost = () => {
  const h = document.getElementById('ld-host');
  return h && h.hasAttribute('data-ld-id') && h.shadowRoot ? h : null;
};
const everything = (host) => {
  const list = [...document.querySelectorAll('*')];
  if (host) list.push(...host.shadowRoot.querySelectorAll('*'));
  return list;
};
// Shadow DOM の中は写らない。開いた Shadow DOM に中身がある、または中の見えない部品（閉じた Shadow DOM の疑い）が見えている。枠のホストは数えない
const hasShadow = (host) => {
  for (const el of everything(host)) {
    if (el === host) continue;
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

// 部品のまわりの切り出し（4:3）。部品でない、見えていない、大きくて枠に収まらないときは null（枠の全部を撮る）
const fitView = (host, W, H) => {
  if (!host || host.getAttribute('data-ld-type') !== 'component') return null;
  const root = host.shadowRoot.querySelector('[data-ld-part]');
  const r = root && visible(root);
  if (!r) return null;
  const w = Math.max(r.width / 0.6, (r.height / 0.7) * (4 / 3), ${CAPTURE_FIT_SIZE.width} / 3);
  const h = w * 0.75;
  if (w > W || h > H || W < ${CAPTURE_FIT_SIZE.width} || H < ${CAPTURE_FIT_SIZE.height}) return null;
  return { x: Math.min(Math.max(r.left + r.width / 2 - w / 2, 0), W - w), y: Math.min(Math.max(r.top + r.height / 2 - h / 2, 0), H - h), w, h };
};

// 絵が1色か（透けた分を掛けた色で比べる。少しの揺れは1色とする）
const flat = (data, step) => {
  const at = (i, c) => (data[i + c] * data[i + 3]) / 255;
  for (let i = 0; i < data.length; i += 4 * step) {
    if (Math.abs(at(i, 0) - at(0, 0)) > 8 || Math.abs(at(i, 1) - at(0, 1)) > 8 || Math.abs(at(i, 2) - at(0, 2)) > 8 || Math.abs(data[i + 3] - data[3]) > 8) return false;
  }
  return true;
};
// canvas の今の絵の控え（長い辺を 512 までに縮める）。読めないときは null。
// 動き続ける canvas は次のコマで絵が変わるので、<img> に置き換えるのと同じ時に控える
const snapshot = (canvas) => {
  try {
    const k = Math.min(1, 512 / Math.max(canvas.width, canvas.height, 1));
    const w = Math.max(1, Math.round(canvas.width * k));
    const h = Math.max(1, Math.round(canvas.height * k));
    const t = document.createElement('canvas');
    t.width = w;
    t.height = h;
    const tg = t.getContext('2d');
    tg.imageSmoothingEnabled = false;
    tg.drawImage(canvas, 0, 0, w, h);
    return { w, h, a: tg.getImageData(0, 0, w, h).data };
  } catch (e) {
    return null;
  }
};
// 控えた canvas の絵が、撮った絵（out。view を scale 倍したもの）の同じ場所（r）に写っているか。
// 'flat'：canvas が1色（読めないときも）。'shown'：写っている。'missing'：写っていない。
// 'sparse'：絵はあるが、地の色と違う点が少なくて確かめられない（小さな粒だけなど）。写っていなくても絵はほとんど変わらないので、通す
const canvasShown = (snap, r, out, view, scale) => {
  if (!snap) return 'flat';
  const { w, h, a } = snap;
  if (flat(a, 1)) return 'flat';
  // 地の色：いちばん多い色（透けた点は1つの色として数える）
  const bins = new Map();
  for (let i = 0; i < a.length; i += 4) {
    const key = a[i + 3] < 250 ? -1 : ((a[i] >> 4) << 8) | ((a[i + 1] >> 4) << 4) | (a[i + 2] >> 4);
    const bin = bins.get(key) || [0, 0, 0, 0];
    bin[0] += 1;
    bin[1] += a[i];
    bin[2] += a[i + 1];
    bin[3] += a[i + 2];
    bins.set(key, bin);
  }
  let ground = null;
  let groundKey = 0;
  for (const [key, bin] of bins) if (!ground || bin[0] > ground[0]) { ground = bin; groundKey = key; }
  const m = groundKey === -1 ? null : [ground[1] / ground[0], ground[2] / ground[0], ground[3] / ground[0]];
  const far = (p, q) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
  const b = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 20000)));
  let marks = 0;
  let hits = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (a[i + 3] < 250) continue;
      const c = [a[i], a[i + 1], a[i + 2]];
      if (m && far(c, m) <= 48) continue;
      const ox = Math.round((r.left + ((x + 0.5) / w) * r.width - view.x) * scale);
      const oy = Math.round((r.top + ((y + 0.5) / h) * r.height - view.y) * scale);
      if (ox < 1 || oy < 1 || ox >= out.width - 1 || oy >= out.height - 1) continue;
      marks += 1;
      // 縮めたり広げたりで少しずれるので、まわりの9点でいちばん近い色を見る
      let best = 999;
      let q = null;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const j = ((oy + dy) * out.width + ox + dx) * 4;
          const p = [b[j], b[j + 1], b[j + 2]];
          const d = far(p, c);
          if (d < best) { best = d; q = p; }
        }
      }
      if (best <= 64 && (!m || best < far(q, m))) hits += 1;
    }
  }
  if (marks < 24) return 'sparse';
  return hits >= marks * 0.5 ? 'shown' : 'missing';
};

async function capture(opts) {
  const host = ownHost();
  if (hasShadow(host)) return { ok: false, reason: 'shadow' };
  const W = innerWidth;
  const H = innerHeight;
  const view = (opts.fit && fitView(host, W, H)) || { x: 0, y: 0, w: W, h: H };
  const cut = view.w !== W;
  const outW = cut ? ${CAPTURE_FIT_SIZE.width} : W;
  const outH = cut ? ${CAPTURE_FIT_SIZE.height} : H;
  const scale = outW / view.w;
  const clone = document.documentElement.cloneNode(true);
  // 元の要素 → 写しの要素。枠のホストは、Shadow DOM の中身をホストの子として写す
  const twin = new Map();
  const pair = (o, k) => {
    twin.set(o, k);
    let children = o.children;
    if (o === host) {
      k.textContent = '';
      for (const node of host.shadowRoot.childNodes) k.appendChild(node.cloneNode(true));
      children = host.shadowRoot.children;
    }
    for (let i = 0; i < children.length && i < k.children.length; i += 1) pair(children[i], k.children[i]);
  };
  pair(document.documentElement, clone);
  // 動いている要素は、今の計算された値を style に写し、動きを切る
  const animations = new Set(document.getAnimations());
  if (host && host.shadowRoot.getAnimations) for (const anim of host.shadowRoot.getAnimations()) animations.add(anim);
  for (const anim of animations) {
    const el = anim.effect && anim.effect.target;
    if (!el || (anim.effect.pseudoElement ?? null) !== null) continue;
    const k = twin.get(el);
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
  const canvases = [];
  for (const [c, k] of twin) {
    if (c.localName !== 'canvas') continue;
    if (opts.strict) {
      const cs = getComputedStyle(c);
      const r = visible(c);
      if (r && cs.visibility === 'visible' && cs.opacity !== '0') canvases.push({ r, snap: snapshot(c) });
    }
    const img = document.createElement('img');
    for (const a of c.getAttributeNames()) if (a !== 'width' && a !== 'height') img.setAttribute(a, c.getAttribute(a));
    try {
      img.src = c.toDataURL();
    } catch (e) {}
    // 作品の CSS が canvas のタグで当てた形（position など）は <img> に当たらないので、計算された形を写す
    const cs = getComputedStyle(c);
    for (const p of STYLE_PROPS) img.style.setProperty(p, cs.getPropertyValue(p));
    k.replaceWith(img);
  }
  // 入力の今の値は属性にない。属性に写す
  for (const [el, k] of twin) {
    if (el.localName !== 'input' && el.localName !== 'textarea' && el.localName !== 'select') continue;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked ? k.setAttribute('checked', '') : k.removeAttribute('checked');
    else if (el.tagName === 'TEXTAREA') k.textContent = el.value;
    else if (el.tagName === 'SELECT') [...k.options].forEach((o, j) => (el.options[j] && el.options[j].selected ? o.setAttribute('selected', '') : o.removeAttribute('selected')));
    else k.setAttribute('value', el.value);
  }
  clone.querySelectorAll('script').forEach((s) => s.remove());
  // CSSOM で足した規則（insertRule）は文字にないので、<style> に写す
  let extra = '';
  for (const sheet of [...document.styleSheets, ...(host ? host.shadowRoot.styleSheets : [])]) {
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
    img = await svgImage(new XMLSerializer().serializeToString(clone), W, H, cut ? 'scale(' + scale + ') translate(' + -view.x + ' ' + -view.y + ')' : '');
  } catch (e) {
    return { ok: false, reason: 'decode' };
  }
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const g = out.getContext('2d');
  // ページの地の色。ふつうの描画では html か body の背景の色が画面いっぱいに広がるが、SVG の画像の中では中身の高さまでしか塗られない
  g.fillStyle = pageColor();
  g.fillRect(0, 0, outW, outH);
  try {
    // 切り出すときは、絵の左上の outW×outH が写る（中身は svgImage の zoom で広げてある）
    g.drawImage(img, 0, 0, W, H);
  } catch (e) {
    return { ok: false, reason: 'tainted' };
  }
  if (!readable(out)) return { ok: false, reason: 'tainted' };
  // 白紙（全部が同じ色）は撮れなかったとする
  const data = g.getImageData(0, 0, outW, outH).data;
  let blank = true;
  for (let i = 4; i < data.length; i += 4) {
    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
      blank = false;
      break;
    }
  }
  if (blank) return { ok: false, reason: 'blank' };
  if (opts.strict) {
    for (const { r, snap } of canvases) {
      // 撮った絵の中の、この canvas の場所
      const x0 = Math.max(0, Math.floor((r.left - view.x) * scale));
      const y0 = Math.max(0, Math.floor((r.top - view.y) * scale));
      const x1 = Math.min(outW, Math.ceil((r.right - view.x) * scale));
      const y1 = Math.min(outH, Math.ceil((r.bottom - view.y) * scale));
      if (x1 - x0 < 8 || y1 - y0 < 8) continue;
      const shown = canvasShown(snap, r, out, view, scale);
      // canvas の絵が写っていない。または、大きい canvas が1色（読めない、まだ描いていない）で、絵の主役が写っていない
      if (shown === 'missing' || (shown === 'flat' && (x1 - x0) * (y1 - y0) >= outW * outH * 0.2)) return { ok: false, reason: 'canvas' };
    }
  }
  return { ok: true, url: out.toDataURL('image/png') };
}

addEventListener('message', async (e) => {
  if (e.source !== P || !e.data || e.data.type !== '${CAPTURE_REQUEST}') return;
  let result;
  try {
    result = await capture({ strict: e.data.strict === true, fit: e.data.fit === true });
  } catch (err) {
    result = { ok: false, reason: 'error' };
  }
  P.postMessage(Object.assign({ type: '${CAPTURE_RESULT}' }, result), '*');
});
addEventListener('load', () => P.postMessage({ type: '${CAPTURE_READY}' }, '*'));
})();`;
