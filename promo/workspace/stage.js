// V006 の映像の本体。白い空間に、ターミナルの窓とサイトの窓を「板」として横に並べ、1台のカメラがその間を流れる（Three.js）。
// すべて時刻 t だけで決まる。単位は画素（ターミナルの板が 1240×780、y は上向き）。
// - 動きのぶれ：1コマを複数の時刻で描いて重ねる
// - 奥行き：深さからぼけの量を決める（ピントはカメラの見ている点）
// ターミナルの文字は、本物の記録から作った行（terminal.mjs）だけ。「許可する」の画面は、手元のサーバーの本物の画面を撮ったもの。
// まだ撮っていない場面の板は、空のまま置く。

import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') || 1920);
const H = Number(params.get('h') || 1080);
const SAMPLES = Number(params.get('samples') || 6);
const K = W / 1920;

const TL = await (await fetch('/timeline.json')).json();
const DATA = await (await fetch('/data/page.json')).json();
await Promise.all([document.fonts.load('600 40px LDNoto'), document.fonts.load('500 40px LDMono'), document.fonts.load('800 40px LDInter')]);

// ---- 計算の道具
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const mix = (a, b, t) => a + (b - a) * t;
const q5 = (x) => {
  x = clamp(x);
  return x * x * x * (x * (x * 6 - 15) + 10); // ゆっくり動き出し、ゆっくり止まる
};
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 4);
const rad = (d) => (d * Math.PI) / 180;
// キーを5次の補間でつなぐ。速さと加速度が途切れない。傾きは行き過ぎない取り方（調和平均）にするので、止まる所では止まる
function makeTrack(keys) {
  const n = keys.length;
  const T = keys.map((k) => k.t);
  const V = keys.map((k) => k.v);
  const M = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = T[i] - T[i - 1];
    const h1 = T[i + 1] - T[i];
    const d0 = (V[i] - V[i - 1]) / h0;
    const d1 = (V[i + 1] - V[i]) / h1;
    M[i] = d0 * d1 <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
  }
  return (t) => {
    if (t <= T[0]) return V[0];
    if (t >= T[n - 1]) return V[n - 1];
    let i = 0;
    while (i < n - 2 && t > T[i + 1]) i++;
    const h = T[i + 1] - T[i];
    const s = (t - T[i]) / h;
    const s3 = s * s * s;
    const s4 = s3 * s;
    const s5 = s4 * s;
    return (1 - 10 * s3 + 15 * s4 - 6 * s5) * V[i] + (s - 6 * s3 + 8 * s4 - 3 * s5) * h * M[i] + (-4 * s3 + 7 * s4 - 3 * s5) * h * M[i + 1] + (10 * s3 - 15 * s4 + 6 * s5) * V[i + 1];
  };
}
const BG = TL.background;
const END = TL.end;
const css = (c, a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;

// ---- 描画の土台（色は sRGB の値のまま扱う）
THREE.ColorManagement.enabled = false;
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(16, 16, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.sortObjects = true;
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const GPU_NAME = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const rt = (type, opts = {}) => new THREE.WebGLRenderTarget(W, H, { type, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...opts });
const depthTex = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
const sceneRT = rt(THREE.HalfFloatType, { depthBuffer: true, depthTexture: depthTex });
const dofRT = rt(THREE.HalfFloatType);
const accumRT = rt(THREE.HalfFloatType);
const outRT = rt(THREE.UnsignedByteType);

const fsScene = new THREE.Scene();
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
fsQuad.frustumCulled = false;
fsScene.add(fsQuad);
function fullscreen(material, target) {
  fsQuad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(fsScene, fsCam);
}
const FS_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

// ---- 材質
const PREMUL = { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
const SD = /* glsl */ `float sdBox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }`;
const BOARD_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const planeGeo = new THREE.PlaneGeometry(1, 1);

/** 絵を貼った板。角を丸め、ふちは距離でなめらかにする。ふちに、ごく薄い線を引く（白い空間の上の白い板が見分けられるように）。 */
function boardMaterial(map) {
  return new THREE.ShaderMaterial({
    ...PREMUL,
    depthWrite: true,
    depthTest: true,
    uniforms: { map: { value: map }, uSize: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 0 }, uAlpha: { value: 1 }, uBias: { value: -0.2 }, uEdge: { value: 0.07 }, uVeil: { value: 0 } },
    vertexShader: BOARD_VERT,
    fragmentShader: /* glsl */ `
      ${SD}
      varying vec2 vUv; uniform sampler2D map; uniform vec2 uSize; uniform float uRadius,uAlpha,uBias,uEdge,uVeil;
      void main(){
        vec2 p=(vUv-.5)*uSize;
        float d=sdBox(p,uSize*.5,uRadius);
        float aa=max(fwidth(d),1e-4)*.8;
        float a=1.-smoothstep(-aa,aa,d);
        vec3 c=texture2D(map,vec2(vUv.x,1.-vUv.y),uBias).rgb;
        c=mix(c,vec3(1.),uVeil); // 白く薄める（手前に開いた画面の左右から、奥の字のかけらが読めないように）
        float line=1.-smoothstep(0.,max(aa*2.,1.6),abs(d+max(aa,.8)));
        c=mix(c,vec3(0.),line*uEdge);
        a*=uAlpha;
        if(a<0.004) discard;
        gl_FragColor=vec4(c*a,a);
      }`,
  });
}
/** 浮かぶ板の柔らかい影（広い影と、近い影を重ねる）。 */
function shadowMaterial() {
  return new THREE.ShaderMaterial({
    ...PREMUL,
    depthWrite: false,
    depthTest: true,
    uniforms: { uSize: { value: new THREE.Vector2(1, 1) }, uInner: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 0 }, uBlur: { value: 10 }, uAlpha: { value: 0 } },
    vertexShader: BOARD_VERT,
    fragmentShader: /* glsl */ `
      ${SD}
      varying vec2 vUv; uniform vec2 uSize,uInner; uniform float uRadius,uBlur,uAlpha;
      void main(){
        vec2 p=(vUv-.5)*uSize;
        float d=sdBox(p,uInner*.5,uRadius);
        float a1=1.-smoothstep(-uBlur,uBlur,d);
        float a2=1.-smoothstep(-uBlur*.2,uBlur*.2,d);
        float a=(a1*a1*.13+a2*a2*.09)*uAlpha;
        gl_FragColor=vec4(0.,0.,0.,a);
      }`,
  });
}
function canvasTexture(canvas, premultiplied = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = MAX_ANISO;
  t.premultiplyAlpha = premultiplied;
  return t;
}
function drawCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  draw(c.getContext('2d'), c);
  return c;
}

// ---- 世界
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(TL.camera.fov, W / H, 10, 100000);
const FWK = 2 * Math.tan(rad(TL.camera.fov / 2)) * (W / H); // 画面の幅 ＝ 距離 × FWK

function makeBoard(map, material = null) {
  const group = new THREE.Group();
  const mat = material ?? boardMaterial(map);
  const mesh = new THREE.Mesh(planeGeo, mat);
  group.add(mesh);
  const sh = new THREE.Mesh(planeGeo, shadowMaterial());
  sh.position.z = -2;
  group.add(sh);
  scene.add(group);
  const b = { group, mesh, mat, sh };
  b.set = (x, y, z, w, h, { radius = 0, alpha = 1, yaw = 0, veil = 0 } = {}) => {
    group.visible = alpha > 0.003;
    if (!group.visible) return;
    group.position.set(x, y, z);
    group.rotation.y = rad(yaw);
    // 描く順は奥から手前へ（板はどれも、ほぼカメラのほうを向いている）
    mesh.renderOrder = z;
    sh.renderOrder = z - 2;
    mesh.scale.set(w, h, 1);
    mat.uniforms.uSize.value.set(w, h);
    mat.uniforms.uRadius.value = radius;
    mat.uniforms.uAlpha.value = alpha;
    if (mat.uniforms.uVeil) mat.uniforms.uVeil.value = veil;
    const s = w / 1240;
    const blur = 86 * s;
    const m = blur * 1.7;
    sh.scale.set(w + m * 2, h + m * 2, 1);
    sh.position.y = -40 * s;
    const u = sh.material.uniforms;
    u.uSize.value.set(w + m * 2, h + m * 2);
    u.uInner.value.set(w, h);
    u.uRadius.value = radius;
    u.uBlur.value = blur;
    // 板が消えるとき、影は先に消える（透けた板の下で、影が灰色に見えないように）
    u.uAlpha.value = alpha * alpha * alpha;
  };
  return b;
}

// ---- ターミナルの板（本物の記録を流す）。1枚目の板は面が2枚（つなぐ、作る）、2枚目の板は面が1枚（読む）。面の board が、どの板に出るか
const TM = TL.terminal;
const PAGES = DATA.terminal.pages;
const BOARDS = TL.world.boards;
const T1 = BOARDS.find((b) => b.id === 'term1');
const TDW = TM.designW;
const TITLE_H = 58;
const TPAD = 44;
const BOX_X = 40; // 打つ欄の中で、字が始まる所
const termK = Math.max(1.5, 1.5 * K);
const monoFont = (size, weight = 400) => `${weight} ${size}px LDMono, LDNoto`;
const noteFont = (size, weight = 500) => `${weight} ${size}px LDNoto`;
const STYLE = {
  cmd: { font: monoFont(TM.fontPx, 600), color: [34, 34, 40], lineH: TM.lineH + 6 },
  user: { font: noteFont(TM.fontPx + 2, 500), color: [34, 34, 40], lineH: TM.lineH + 6 },
  say: { font: noteFont(TM.fontPx + 2, 500), color: [28, 28, 32], lineH: TM.lineH + 8 },
  tool: { font: monoFont(TM.fontPx, 650), color: [28, 28, 32], lineH: TM.lineH + 6 },
  code: { font: monoFont(TM.fontPx - 4), color: [104, 104, 116], lineH: TM.lineH - 6 },
  gap: { font: monoFont(TM.fontPx - 2), color: [170, 170, 178], lineH: TM.lineH - 4 },
  hook: { font: monoFont(TM.fontPx, 700), color: [14, 14, 18], lineH: TM.lineH + 10 },
};
const isBox = (kind) => kind === 'cmd' || kind === 'user';
function terminalChrome(c, title) {
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, TDW, TITLE_H);
  c.fillStyle = 'rgb(232 232 236)';
  c.fillRect(0, TITLE_H - 1, TDW, 1);
  // 窓の3つの丸（色は付けない。実在の製品の見た目を真似ない）
  for (let i = 0; i < 3; i++) {
    c.fillStyle = 'rgb(226 226 231)';
    c.beginPath();
    c.arc(30 + i * 24, TITLE_H / 2, 7, 0, Math.PI * 2);
    c.fill();
  }
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  c.font = noteFont(22, 600);
  c.fillStyle = 'rgb(70 70 78)';
  c.fillText(title, TDW / 2, TITLE_H / 2 + 1);
  c.textAlign = 'left';
}
/** 字の幅を測るだけの描き場 */
const termCtx = drawCanvas(16, 16, () => {}).getContext('2d');
const TERMS = BOARDS.filter((b) => b.kind === 'terminal').map((spec) => {
  const dh = Math.round((TDW * spec.size[1]) / spec.size[0]);
  const canvas = drawCanvas(TDW * termK, dh * termK, () => {});
  const tex = canvasTexture(canvas);
  return { spec, dh, canvas, ctx: canvas.getContext('2d'), tex, board: makeBoard(tex), stamp: '', pages: [] };
});
const termOf = (id) => {
  const term = TERMS.find((x) => x.spec.id === id);
  if (!term) throw new Error(`ターミナルの板がない: ${id}`);
  return term;
};

// 長い文は、言葉の切れ目で折り返す（寄ったときの画面の幅に収める）。空白のない日本語は、字の切れ目で折り返す（行の頭に 、。）」 を置かない）
const NO_HEAD = /^[、。）」』，．！？：]/;
function wrapText(text, maxW) {
  if (termCtx.measureText(text).width <= maxW) return [text];
  const out = [];
  let cur = '';
  // 空白で切れるなら、空白で切る（前と同じ折り返し）。空白の間が1行より長いときだけ、字の切れ目でも切る
  const words = text.split(/(?<= )/);
  const tokens = words.some((w) => termCtx.measureText(w).width > maxW) ? text.split(/(?<= )|(?<=[^ -~])(?=[^ -~])|(?<=[^ -~])(?=[ -~])|(?<=[ -~])(?=[^ -~])/u).filter(Boolean) : words;
  for (const token of tokens) {
    if (cur && termCtx.measureText(cur + token).width > maxW && !NO_HEAD.test(token)) {
      out.push(cur.trimEnd());
      cur = token.trimStart();
    } else cur += token;
  }
  if (cur) out.push(cur.trimEnd());
  return out;
}
// 行の位置を決める（1回だけ）。面ごとに、上から並べる
const LAID = PAGES.map((page) => {
  const lines = [];
  let y = 0;
  let prev = null;
  termCtx.setTransform(1, 0, 0, 1, 0, 0);
  for (const item of page.items) {
    const st = STYLE[item.kind];
    const tight = (prev === 'tool' && item.kind === 'code') || (prev === 'code' && item.kind === 'gap') || (prev === 'gap' && item.kind === 'code') || (prev === 'say' && item.kind === 'say');
    if (prev && prev !== item.kind && !tight) y += item.kind === 'hook' ? 20 : 16;
    if (isBox(prev)) y += 22;
    termCtx.font = st.font;
    const texts = item.kind === 'say' ? wrapText(item.text, TM.wrapW) : [item.text];
    texts.forEach((text, i) => {
      lines.push({ ...item, id: i === 0 ? item.id : null, text, y, st, chars: [...text], first: lines.length === 0, board: page.board });
      y += st.lineH;
    });
    prev = item.kind;
  }
  return { ...page, lines, height: y };
});
const LINE = Object.fromEntries(LAID.flatMap((page) => page.lines.filter((l) => l.id).map((l) => [l.id, l])));
const pageAlpha = (page, t) => (page.in ? q5(seg(t, page.in[0], page.in[1])) : 1) * (page.out ? 1 - q5(seg(t, page.out[0], page.out[1])) : 1);
/** 打つ行の字が、いくつ打たれたか。 */
const typedCount = (l, t) => clamp(Math.floor(((t - l.at) / (l.typeTo - l.at)) * l.chars.length + 1e-6) + 1, 0, l.chars.length);
for (const term of TERMS) {
  term.pages = LAID.filter((page) => page.board === term.spec.id);
  term.lastChange = Math.max(0, ...term.pages.flatMap((page) => [...(page.out ?? []), ...(page.in ?? []), ...page.badge, ...page.lines.flatMap((l) => [l.at, l.typeTo ?? 0, l.enter ?? 0])])) + 1.2;
}
/** 記録の経過（秒）。面の時刻の対応から。 */
function recAt(page, t) {
  const keys = page.clock;
  if (t <= keys[0].at) return keys[0].rec;
  for (let i = 1; i < keys.length; i++) if (t <= keys[i].at) return mix(keys[i - 1].rec, keys[i].rec, seg(t, keys[i - 1].at, keys[i].at));
  return keys[keys.length - 1].rec;
}
const clockText = (rec) => `${String(Math.floor(rec / 60)).padStart(2, '0')}:${String(Math.floor(rec % 60)).padStart(2, '0')}`;

function paintTerminal(t) {
  for (const term of TERMS) paintTerm(term, t);
}
function paintTerm(term, t) {
  // 文字は 1/60 秒より細かくは変わらないので、同じ絵なら描き直さない
  const stamp = t > term.lastChange ? 'done' : String(Math.round(t * 600));
  if (stamp === term.stamp) return;
  term.stamp = stamp;
  const c = term.ctx;
  const TDH = term.dh;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, term.canvas.width, term.canvas.height);
  c.setTransform(termK, 0, 0, termK, 0, 0);
  const maxW = TDW - TPAD * 2;
  let shownPage = null;
  for (const page of term.pages) {
    const pa = pageAlpha(page, t);
    if (pa <= 0.003) continue;
    shownPage = page;
    c.save();
    c.beginPath();
    c.rect(0, TITLE_H, TDW, TDH - TITLE_H);
    c.clip();
    c.translate(TPAD, TITLE_H + TPAD * 0.8);
    c.textBaseline = 'middle';
    for (const l of page.lines) {
      const mid = l.y + l.st.lineH / 2;
      if (isBox(l.kind)) {
        // 打つ欄。前の行を送ってから出る。打ち終えて送ると、欄の色が少し落ち着く
        const show = l.first ? 1 : q5(seg(t, l.at - 0.12, l.at - 0.05)); // 打ち始めの2コマ前には、出きっている（打ち始めの絵を測るとき、欄の出方と混ざらないように）
        if (show <= 0.003) continue;
        const sent = q5(seg(t, l.enter, l.enter + 0.18));
        c.globalAlpha = pa * show;
        c.fillStyle = css([mix(240, 244, sent), mix(242, 244, sent), mix(248, 246, sent)]);
        c.beginPath();
        c.roundRect(-14, l.y - 8, maxW + 28, l.st.lineH + 16, 14);
        c.fill();
        c.strokeStyle = css([120, 140, 220], 0.5 * (1 - sent));
        c.lineWidth = 2;
        c.stroke();
        c.font = monoFont(TM.fontPx, 600);
        c.fillStyle = css([150, 150, 160]);
        c.fillText('>', 8, mid + 1);
        c.font = l.st.font;
        const shown = l.chars.slice(0, typedCount(l, t)).join('');
        c.fillStyle = css(l.st.color);
        c.fillText(shown, BOX_X, mid + 1);
        if (t < l.enter - 1e-6) { // 送った時刻のコマで、印が消える
          // 打つ位置の印
          const x = BOX_X + c.measureText(shown).width + 3;
          c.fillStyle = css([40, 40, 48], 0.85);
          c.fillRect(x, mid - TM.fontPx * 0.62, 2.5, TM.fontPx * 1.24);
        }
        continue;
      }
      if (l.at > t + 1e-6) continue; // 162/60 は 2.7 よりわずかに小さい。出る時刻のコマで出す
      const age = Math.max(0, t - l.at);
      // 出る時刻のコマで、もう見えている（音とのずれを1コマ以内にする）
      c.globalAlpha = pa * q5((age + 1 / 60) / 0.035);
      c.font = l.st.font;
      if (l.kind === 'hook') {
        // プラグインが返した行。印が左から伸びる
        const g = q5(seg(t, l.at - 0.02, l.at + TL.terminal.make.hookGlow));
        const w = c.measureText(l.text).width + 28;
        c.fillStyle = 'rgb(255 208 112 / 0.55)';
        c.beginPath();
        c.roundRect(-14, l.y + 3, w * g, l.st.lineH - 6, 8);
        c.fill();
      }
      c.fillStyle = css(l.st.color);
      if (l.kind === 'code') {
        // 長い行は右で切る（折り返さない）
        c.save();
        c.beginPath();
        c.rect(0, l.y, maxW, l.st.lineH);
        c.clip();
        c.fillText(l.text, 0, mid);
        c.restore();
      } else c.fillText(l.text, 0, mid);
    }
    c.restore();
  }
  c.globalAlpha = 1;
  terminalChrome(c, TM.title);
  // 題の帯にも、速さと経過（最後の引きで、窓の全体が見えるときのため）
  if (shownPage) {
    const show = q5(seg(t, shownPage.badge[0], shownPage.badge[0] + 0.25)) * pageAlpha(shownPage, t);
    if (show > 0.001) {
      c.globalAlpha = show;
      c.textBaseline = 'middle';
      c.font = monoFont(22, 700);
      const lw = c.measureText(shownPage.speedLabel).width + 26;
      c.textAlign = 'right';
      c.font = monoFont(22, 600);
      c.fillStyle = 'rgb(110 110 120)';
      c.fillText(clockText(recAt(shownPage, t)), TDW - 22 - lw - 14, TITLE_H / 2 + 1);
      c.textAlign = 'left';
      c.fillStyle = 'rgb(22 22 26)';
      c.beginPath();
      c.roundRect(TDW - 22 - lw, TITLE_H / 2 - 17, lw, 34, 17);
      c.fill();
      c.font = monoFont(22, 700);
      c.fillStyle = '#ffffff';
      c.fillText(shownPage.speedLabel, TDW - 22 - lw + 13, TITLE_H / 2 + 1);
      c.globalAlpha = 1;
    }
  }
  term.tex.needsUpdate = true;
}

// ---- まだ撮っていない場面の板（空のまま置く。偽の画面は描かない）
const emptyBoards = BOARDS.filter((b) => b.kind === 'empty' || b.kind === 'terminal-empty').map((b) => {
  const dw = b.kind === 'terminal-empty' ? TDW : 1440;
  const dh = Math.round((dw * b.size[1]) / b.size[0]);
  const k = Math.max(1, K);
  const canvas = drawCanvas(dw * k, dh * k, (c) => {
    c.scale(k, k);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, dw, dh);
    if (b.kind === 'terminal-empty') {
      const s = TDW / dw;
      c.save();
      c.scale(1 / s, 1 / s);
      terminalChrome(c, TM.title);
      c.restore();
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = noteFont(34, 600);
    c.fillStyle = 'rgb(178 178 188)';
    c.fillText(b.label, dw / 2, dh / 2 - 22);
    c.font = noteFont(24, 500);
    c.fillStyle = 'rgb(198 198 206)';
    c.fillText(b.note, dw / 2, dh / 2 + 28);
  });
  return { spec: b, board: makeBoard(canvasTexture(canvas)) };
});

// ---- 「許可する」の画面（手元のサーバーの本物の画面を撮ったもの）。ターミナルの手前に開き、押したら閉じる
// 板の大きさは、撮った窓の大きさ（CSS の画素）
const SHOTS = DATA.shots;
const BR = { ...TL.browser, size: [SHOTS.viewport.width, SHOTS.viewport.height] };
async function shotTexture(file, base = SHOTS.base) {
  const blob = await (await fetch(`${base}${file}`)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = MAX_ANISO;
  t.needsUpdate = true;
  return t;
}
const consentTex = await shotTexture('consent.png');
const brBoard = makeBoard(consentTex);
brBoard.mat.uniforms.uBias.value = -0.4;
// 開く時刻のコマで、もう見えている（音とのずれを1コマ以内にする）
const brIn = (t) => (t < BR.in[0] - 1e-6 ? 0 : easeOut(seg(t + 1 / TL.fps, BR.in[0], BR.in[1])));
// 開いたら、BR.opaque 秒以内に不透明になる（透けた画面の字と、後ろのターミナルの字が重なって読めないコマを作らない）。大きさが変わって開く動きは brIn
const brOpaque = (t) => (t < BR.in[0] - 1e-6 ? 0 : easeOut(seg(t + 1 / TL.fps, BR.in[0], BR.in[0] + BR.opaque)));
const brAlpha = (t) => brOpaque(t) * (1 - q5(seg(t, BR.out[0], BR.out[1])));
// 開くときは少し小さい所から、閉じるときは少し小さくなりながら
const brPop = (t) => mix(0.94, 1, brIn(t)) * mix(1, 0.96, q5(seg(t, BR.out[0], BR.out[1])));
/** 画面の中の位置（CSS の画素）→ 世界 */
const pagePt = (px, py, dz = 0) => [BR.at[0] - BR.size[0] / 2 + px, BR.at[1] + BR.size[1] / 2 - py, BR.at[2] + dz];

// カーソル（OS のカーソルは写らないので、同じ位置に矢印の絵を置く）
const cursorTex = canvasTexture(
  drawCanvas(216, 216, (ctx, cv) => {
    ctx.scale(cv.width / 54, cv.width / 54);
    ctx.translate(14, 8);
    ctx.shadowColor = 'rgba(0,0,0,0.32)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 5;
    const arrow = new Path2D('M1 1 L1 28 L7.6 22 L12 33 L16.6 31 L12.2 20.4 L21 20.4 Z');
    ctx.fillStyle = '#ffffff';
    ctx.fill(arrow);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(20,20,28,0.78)';
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.stroke(arrow);
  }),
  true,
);
function makeCursor() {
  const mat = new THREE.ShaderMaterial({
    ...PREMUL,
    depthTest: false,
    depthWrite: false,
    uniforms: { map: { value: cursorTex }, uAlpha: { value: 0 } },
    vertexShader: BOARD_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D map; uniform float uAlpha; void main(){ gl_FragColor=texture2D(map,vec2(vUv.x,1.-vUv.y))*uAlpha; }`,
  });
  const mesh = new THREE.Mesh(planeGeo, mat);
  mesh.renderOrder = 100000;
  scene.add(mesh);
  return { mesh, mat };
}
const { mesh: cursorMesh, mat: cursorMat } = makeCursor();
const CURSOR_HOT = [15 / 54, 9 / 54];
const glide = (x) => 1 - Math.pow(1 - Math.pow(clamp(x), 1.6), 3); // 人の手のように、ゆっくり動き出して、なめらかに止まる
/** カーソルの、世界の位置（矢印の先）と大きさ。押した時刻のコマで、もう縮み始めている。 */
function cursorState(t) {
  const C = BR.cursor;
  const b = SHOTS.allowButton;
  const to = [b.x + b.width * C.at[0], b.y + b.height * C.at[1]]; // 字の上には置かない（ボタンの中の、字の右下）
  const u = glide(seg(t, C.move[0], C.move[1]));
  const since = t - BR.press + 1e-6;
  const a = since + 1 / TL.fps;
  const squeeze = since < 0 ? 0 : a < 0.06 ? a / 0.06 : a < 0.24 ? 1 - (a - 0.06) / 0.18 : 0;
  const size = C.size * (1 - 0.16 * squeeze);
  const from = [to[0] + C.fromOffset[0], to[1] + C.fromOffset[1]]; // 押す所から見た、動き始めの位置
  const tip = pagePt(mix(from[0], to[0], u), mix(from[1], to[1], u), 6);
  return { tip, size, center: [tip[0] + size * (0.5 - CURSOR_HOT[0]), tip[1] - size * (0.5 - CURSOR_HOT[1]), tip[2]], shown: q5(seg(t, C.move[0] - 0.15, C.move[0] + 0.1)) };
}
function updateCursor(t, alpha) {
  const c = cursorState(t);
  const a = alpha * c.shown;
  cursorMesh.visible = a > 0.003;
  if (!cursorMesh.visible) return;
  cursorMesh.scale.set(c.size, c.size, 1);
  cursorMesh.position.set(c.center[0], c.center[1], c.center[2]);
  cursorMat.uniforms.uAlpha.value = a;
}

// ---- サイトの窓（場面2と3）。手元のサーバーの本物の画面を、状態ごとに撮ったもの（site.mjs）。絵は手で描かない。
// 状態の替わり目は、本物の画面の動きのとおり：ナビに作品が増える（ナビの所だけが替わる。作品の枠の中の雨は撮った時刻で少し違うので、ほかは前の絵のまま）、
// 印や木を押す（本文へ飛ぶ。全部が替わる）。板の大きさは、撮った窓の大きさ（CSS の画素）
const SITE = DATA.site ?? null;
const SB = BOARDS.find((b) => b.kind === 'site') ?? null;
const ST = TL.site ?? null;
function siteMaterial() {
  return new THREE.ShaderMaterial({
    ...PREMUL,
    depthWrite: true,
    depthTest: true,
    uniforms: { mapA: { value: null }, mapB: { value: null }, uMix: { value: 0 }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uSize: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 0 }, uAlpha: { value: 1 }, uBias: { value: -0.4 }, uEdge: { value: 0.07 }, uVeil: { value: 0 } },
    vertexShader: BOARD_VERT,
    fragmentShader: /* glsl */ `
      ${SD}
      varying vec2 vUv; uniform sampler2D mapA,mapB; uniform vec4 uRect; uniform vec2 uSize; uniform float uMix,uRadius,uAlpha,uBias,uEdge,uVeil;
      void main(){
        vec2 p=(vUv-.5)*uSize;
        float d=sdBox(p,uSize*.5,uRadius);
        float aa=max(fwidth(d),1e-4)*.8;
        float a=1.-smoothstep(-aa,aa,d);
        vec2 q=vec2(vUv.x,1.-vUv.y);
        vec3 ca=texture2D(mapA,q,uBias).rgb;
        vec3 cb=texture2D(mapB,q,uBias).rgb;
        float inside=step(uRect.x,q.x)*step(q.x,uRect.z)*step(uRect.y,q.y)*step(q.y,uRect.w);
        vec3 c=mix(ca,cb,uMix*inside);
        c=mix(c,vec3(1.),uVeil);
        float line=1.-smoothstep(0.,max(aa*2.,1.6),abs(d+max(aa,.8)));
        c=mix(c,vec3(0.),line*uEdge);
        a*=uAlpha;
        if(a<0.004) discard;
        gl_FragColor=vec4(c*a,a);
      }`,
  });
}
const site = await (async () => {
  if (!SITE || !SB || !ST) return null;
  const V = SITE.viewport;
  const k = SB.size[0] / V.width;
  const states = Object.fromEntries(SITE.states.map((st) => [st.id, st]));
  const tex = {};
  for (const st of SITE.states) tex[st.id] = await shotTexture(st.file, SITE.base);
  const board = makeBoard(null, siteMaterial());
  const u = board.mat.uniforms;
  /** 画面の中の位置（CSS の画素）→ 世界 */
  const pt = (px, py, dz = 0) => [SB.at[0] - SB.size[0] / 2 + px * k, SB.at[1] + SB.size[1] / 2 - py * k, SB.at[2] + dz];
  const union = (a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  };
  const FULL = { x: 0, y: 0, width: V.width, height: V.height };
  /** 替わり目の所（CSS の画素）。nav ならナビの四角（前と後の和に、少し足す）、なければ全部 */
  const regionOf = (from, to, region) => {
    if (region !== 'nav') return FULL;
    const r = union(states[from].boxes.nav, states[to].boxes.nav);
    const pad = 14;
    const y0 = Math.max(0, r.y - pad);
    return { x: Math.max(0, r.x - pad), y: y0, width: r.width + pad * 2, height: Math.min(V.height, r.y + r.height + pad) - y0 };
  };
  const switches = ST.switches.map((sw, i) => ({ ...sw, from: i === 0 ? ST.first : ST.switches[i - 1].to }));
  for (const sw of switches) sw.rect = regionOf(sw.from, sw.to, sw.region);
  /** 時刻 t の状態：前の絵 a と、次の絵 b と、混ぜ方 m（替わる所 rect の中だけ） */
  const stateAt = (t) => {
    let cur = ST.first;
    for (const sw of switches) {
      if (t < sw.at - 1e-6) break;
      // 替わる時刻のコマで、もう替わり始めている（音とのずれを1コマ以内にする）
      const m = easeOut(seg(t + 1 / TL.fps, sw.at, sw.at + sw.dur));
      if (m < 1) return { a: cur, b: sw.to, m, rect: sw.rect };
      cur = sw.to;
    }
    return { a: cur, b: cur, m: 0, rect: FULL };
  };
  // カーソル：押す所は、撮ったときに押した物の四角（その物を押した後の状態の clicked）
  const C = ST.cursor;
  const cursor = makeCursor();
  const targets = C.clicks.map((click) => {
    const b = states[click.state].clicked?.box;
    if (!b) throw new Error(`サイトの状態 ${click.state} に、押した物の四角がない`);
    return { ...click, box: b, to: [b.x + b.width * C.at[0], b.y + b.height * C.at[1]] };
  });
  const start = [targets[0].to[0] + C.fromOffset[0], targets[0].to[1] + C.fromOffset[1]];
  /** カーソルの矢印の先（CSS の画素）と大きさ。押した時刻のコマで、もう縮み始めている */
  const cursorAt = (t) => {
    let pos = start;
    let squeeze = 0;
    let from = start;
    for (const target of targets) {
      if (t < target.move[0]) break;
      const w = glide(seg(t, target.move[0], target.move[1]));
      pos = [mix(from[0], target.to[0], w), mix(from[1], target.to[1], w)];
      const since = t - target.press + 1e-6;
      const a = since + 1 / TL.fps;
      if (since >= 0) squeeze = a < 0.06 ? a / 0.06 : a < 0.24 ? 1 - (a - 0.06) / 0.18 : 0;
      from = target.to;
    }
    return { pos, size: C.size * (1 - 0.16 * squeeze), shown: q5(seg(t, C.show[0], C.show[1])) * (1 - q5(seg(t, C.hide[0], C.hide[1]))) };
  };
  const cursorWorld = (t) => {
    const c = cursorAt(t);
    const size = c.size * k;
    const tip = pt(c.pos[0], c.pos[1], 6);
    return { ...c, size, tip, center: [tip[0] + size * (0.5 - CURSOR_HOT[0]), tip[1] - size * (0.5 - CURSOR_HOT[1]), tip[2]] };
  };
  return {
    V,
    k,
    pt,
    states,
    switches,
    stateAt,
    targets,
    cursorWorld,
    update(t, alpha) {
      const s = stateAt(t);
      u.mapA.value = tex[s.a];
      u.mapB.value = tex[s.b];
      u.uMix.value = s.m;
      u.uRect.value.set(s.rect.x / V.width, s.rect.y / V.height, (s.rect.x + s.rect.width) / V.width, (s.rect.y + s.rect.height) / V.height);
      board.set(SB.at[0], SB.at[1], SB.at[2], SB.size[0], SB.size[1], { radius: SB.radius, alpha, yaw: SB.yaw });
      const c = cursorWorld(t);
      const ca = alpha * c.shown;
      cursor.mesh.visible = ca > 0.003;
      if (cursor.mesh.visible) {
        cursor.mesh.scale.set(c.size, c.size, 1);
        cursor.mesh.position.set(c.center[0], c.center[1], c.center[2]);
        cursor.mat.uniforms.uAlpha.value = ca;
      }
    },
  };
})();

// 「許可する」の画面が手前にある間、奥のターミナルを白く薄める（窓の左右から、奥の字のかけらが読めないように）
const veilAt = (t) => (TL.browser.veil ?? 0) * brAlpha(t);

const boardsAlpha = (t) => 1 - q5(seg(t, END.boardsOut[0], END.boardsOut[1]));
function updateBoards(t) {
  const a = boardsAlpha(t);
  for (const term of TERMS) term.board.set(term.spec.at[0], term.spec.at[1], term.spec.at[2], term.spec.size[0], term.spec.size[1], { radius: term.spec.radius, alpha: a, yaw: term.spec.yaw, veil: term.spec.id === 'term1' ? veilAt(t) : 0 });
  site?.update(t, a);
  for (const e of emptyBoards) e.board.set(e.spec.at[0], e.spec.at[1], e.spec.at[2], e.spec.size[0], e.spec.size[1], { radius: e.spec.radius, alpha: a, yaw: e.spec.yaw });
  const ba = brAlpha(t);
  const pop = brPop(t);
  brBoard.set(BR.at[0], BR.at[1], BR.at[2], BR.size[0] * pop, BR.size[1] * pop, { radius: BR.radius, alpha: ba });
  updateCursor(t, ba);
}

// ---- カメラ
// キーに focus（ターミナルの行の id）とあれば、その行をカメラで追う。寄り方は1つ：プラグインの行の字の高さ（字の上端から下端まで）が
// 画面の高さの textInkRatio になる距離。行は画面の上から lineAt、字の左端は画面の左から textLeftAt の位置に置く。wide は、そこから引く倍率。
// キーに page（「許可する」の画面の中の位置）とあれば、そこを見る
const FOCUS = (() => {
  termCtx.setTransform(1, 0, 0, 1, 0, 0);
  const measure = (line) => {
    const spec = termOf(line.board).spec;
    const k = spec.size[0] / TDW; // 設計の画素 → 世界
    termCtx.font = line.st.font;
    const m = termCtx.measureText(line.text);
    // 字の高さは、その書体で上に出る字と下に出る字（L と p）を並べた高さで測る（「Bash」のように下に出る字のない行でも、同じ物差しにする）。日本語の入る行は、その行の字で測る
    const r = /[^ -~]/.test(line.text) ? m : termCtx.measureText('Lp');
    return { ink: (r.actualBoundingBoxAscent + r.actualBoundingBoxDescent) * k, width: (m.width + (isBox(line.kind) ? BOX_X : 0)) * k, cy: spec.at[1] + spec.size[1] / 2 - (TITLE_H + TPAD * 0.8 + line.y + line.st.lineH / 2) * k, left: spec.at[0] - spec.size[0] / 2 + TPAD * k, z: spec.at[2] };
  };
  const lines = Object.fromEntries(Object.entries(LINE).map(([id, line]) => [id, measure(line)]));
  return { lines, fw: (lines.hook.ink * 1920) / (TL.camera.textInkRatio * 1080) };
})();
const camKeys = TL.camera.keys.map((key) => {
  if (key.page) return { ...key, p: pagePt(key.page[0], key.page[1]) };
  if (key.site) {
    if (!site) throw new Error('カメラのキーに site があるが、サイトの窓がない');
    return { ...key, p: site.pt(key.site[0], key.site[1]) };
  }
  if (!key.focus) return key;
  const line = FOCUS.lines[key.focus];
  if (!line) throw new Error(`カメラのキーの focus に、ない行がある: ${key.focus}`);
  const fw = FOCUS.fw * (key.wide ?? 1);
  const frameH = (fw * 9) / 16;
  return { ...key, p: [line.left + (0.5 - TL.camera.textLeftAt) * fw + (key.dx ?? 0), line.cy - (0.5 - key.lineAt) * frameH + (key.dy ?? 0), line.z], fw };
});
const FOCUSED = [...new Set(TL.camera.keys.filter((k) => k.focus).map((k) => k.focus))];

const camTrack = {
  x: makeTrack(camKeys.map((k) => ({ t: k.t, v: k.p[0] }))),
  y: makeTrack(camKeys.map((k) => ({ t: k.t, v: k.p[1] }))),
  z: makeTrack(camKeys.map((k) => ({ t: k.t, v: k.p[2] }))),
  fw: makeTrack(camKeys.map((k) => ({ t: k.t, v: Math.log(k.fw) }))),
  yaw: makeTrack(camKeys.map((k) => ({ t: k.t, v: k.yaw }))),
  pitch: makeTrack(camKeys.map((k) => ({ t: k.t, v: k.pitch }))),
};
const camAt = (t) => ({ x: camTrack.x(t), y: camTrack.y(t), z: camTrack.z(t), fw: Math.exp(camTrack.fw(t)), yaw: camTrack.yaw(t), pitch: camTrack.pitch(t) });
function setCamera(t, jx, jy) {
  const k = camAt(t);
  const D = k.fw / FWK;
  const cp = Math.cos(rad(k.pitch));
  camera.position.set(k.x + D * Math.sin(rad(k.yaw)) * cp, k.y + D * Math.sin(rad(k.pitch)), k.z + D * Math.cos(rad(k.yaw)) * cp);
  camera.up.set(0, 1, 0);
  camera.lookAt(k.x, k.y, k.z);
  camera.near = Math.max(20, D * 0.12);
  camera.far = D * 4 + 9000;
  camera.setViewOffset(W, H, jx, jy, W, H);
  camera.updateProjectionMatrix();
  return D;
}
const bgColor = new THREE.Color(BG[0] / 255, BG[1] / 255, BG[2] / 255);
scene.background = bgColor;

// ---- ぼけ（深さから決める。手前のはっきりした物の上に、奥のぼけを にじませない）
const DOF = TL.camera.dof;
const dofMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: { tColor: { value: sceneRT.texture }, tDepth: { value: depthTex }, uNear: { value: 1 }, uFar: { value: 2 }, uFocus: { value: 1 }, uAperture: { value: 1 }, uBand: { value: DOF.band }, uMaxR: { value: DOF.maxR * (H / 1080) }, uPx: { value: new THREE.Vector2(1 / W, 1 / H) }, uRot: { value: 0 } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tDepth;
    uniform float uNear,uFar,uFocus,uAperture,uMaxR,uBand,uRot; uniform vec2 uPx;
    float viewZ(vec2 uv){ float d=texture2D(tDepth,uv).r; float z=d*2.-1.; return 2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear)); }
    float coc(float z){ return clamp(max(abs(z-uFocus)-uBand*uFocus,0.)/max(z,1e-3)*uAperture,0.,1.)*uMaxR; }
    void main(){
      vec3 c0=texture2D(tColor,vUv).rgb;
      float z0=min(viewZ(vUv),uFocus*3.);
      float own=coc(z0);
      vec3 sum=c0; float wsum=1.;
      const int N=44;
      for(int i=1;i<=N;i++){
        float fi=float(i);
        float r=sqrt(fi/float(N))*uMaxR;
        float a=fi*2.39996+uRot;
        vec2 uv=vUv+vec2(cos(a),sin(a))*r*uPx;
        float zs=min(viewZ(uv),uFocus*3.);
        float cs=coc(zs);
        if(zs>z0+uFocus*0.01) cs=min(cs,own);
        float w=smoothstep(r-1.,r+1.,cs);
        sum+=texture2D(tColor,uv).rgb*w; wsum+=w;
      }
      gl_FragColor=vec4(sum/wsum,1.);
    }`,
});
const copyAdd = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  transparent: true,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  uniforms: { t: { value: dofRT.texture }, k: { value: 1 / SAMPLES } },
  vertexShader: FS_VERT,
  fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform float k; void main(){ gl_FragColor=vec4(texture2D(t,vUv).rgb*k,1.); }`,
});
// 仕上げ：ディザーで白の階調の段を消す（ちらつかないよう、コマごとに変えない）
const finishMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: { t: { value: accumRT.texture } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; uniform sampler2D t;
    float hash(vec2 p){ vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
    void main(){
      vec3 c=clamp(texture2D(t,vUv).rgb,0.,1.);
      vec2 fc=gl_FragCoord.xy;
      vec3 n=vec3(hash(fc)+hash(fc+17.3)-1.,hash(fc+41.7)+hash(fc+7.9)-1.,hash(fc+71.1)+hash(fc+3.3)-1.);
      gl_FragColor=vec4(c+n/255.,1.);
    }`,
});

// ---- 見出しと、終わりのロゴ（出力の上に重ねる。ぶれない）。設計の画素（1920×1080、y は下向き）
const overlay = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(0, 1920, 0, 1080, -1, 1);
function overlaySprite(canvas) {
  const tex = canvasTexture(canvas, true);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.ShaderMaterial({
    ...PREMUL,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { map: { value: tex }, uAlpha: { value: 0 } },
    vertexShader: BOARD_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D map; uniform float uAlpha; void main(){ gl_FragColor=texture2D(map,vUv)*uAlpha; }`,
  });
  const mesh = new THREE.Mesh(planeGeo, mat);
  mesh.frustumCulled = false;
  overlay.add(mesh);
  return {
    tex,
    set(x, y, w, h, alpha) {
      mesh.visible = alpha > 0.003;
      mesh.position.set(x + w / 2, y + h / 2, 0);
      mesh.scale.set(w, h, 1);
      mat.uniforms.uAlpha.value = alpha;
    },
  };
}
const CAPTION = { jaSize: 0.056, enRatio: 0.45, jaY: 0.868 };
const FADE = 0.62;
function makeCaption(c) {
  const fs = Math.round(H * CAPTION.jaSize);
  const es = Math.round(fs * CAPTION.enRatio);
  const canvasH = Math.ceil(H * 0.22);
  const baseJa = Math.round(fs * 1.55);
  const m = {};
  const canvas = drawCanvas(W, canvasH, (ctx) => {
    ctx.textAlign = 'center';
    ctx.font = `680 ${fs}px LDNoto`;
    ctx.letterSpacing = `${-0.012 * fs}px`;
    const mJa = ctx.measureText(c.ja);
    m.wJa = mJa.width;
    ctx.fillStyle = '#111114';
    ctx.fillText(c.ja, W / 2, baseJa);
    m.inkJa = mJa.actualBoundingBoxAscent + mJa.actualBoundingBoxDescent;
    m.ascJa = mJa.actualBoundingBoxAscent;
    ctx.font = `500 ${es}px LDNoto`;
    ctx.letterSpacing = `${0.002 * es}px`;
    const mEn = ctx.measureText(c.en);
    ctx.fillStyle = '#6e6e78';
    ctx.fillText(c.en, W / 2, baseJa + Math.round(fs * 0.74));
    m.inkEn = mEn.actualBoundingBoxAscent + mEn.actualBoundingBoxDescent;
    m.wEn = mEn.width;
    m.baseEn = baseJa + Math.round(fs * 0.74);
    m.descEn = mEn.actualBoundingBoxDescent;
  });
  return { ...c, ...m, sprite: overlaySprite(canvas), baseJa, canvasH };
}
const captions = TL.captions.map(makeCaption);

// 速さと経過の印（記録の時刻から計算したもの）。カメラが字に寄っている間も見えるよう、画面の右上に固定して出す
const BADGE = { w: 300, h: 72, right: 56, top: 48 };
const badgeCanvas = drawCanvas(BADGE.w * K, BADGE.h * K, () => {});
const badgeCtx = badgeCanvas.getContext('2d');
const badgeSprite = overlaySprite(badgeCanvas);
let badgeStamp = '';
function paintBadge(t) {
  let page = null;
  let a = 0;
  for (const p of LAID) {
    const pa = q5(seg(t, p.badge[0], p.badge[0] + 0.25)) * (1 - q5(seg(t, p.badge[1], p.badge[2])));
    if (pa > a) {
      a = pa;
      page = p;
    }
  }
  badgeSprite.set(1920 - BADGE.right - BADGE.w, BADGE.top, BADGE.w, BADGE.h, a);
  if (!page || a <= 0.003) return;
  const clock = clockText(recAt(page, t));
  const stamp = `${page.id} ${clock}`;
  if (stamp === badgeStamp) return;
  badgeStamp = stamp;
  const c = badgeCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, badgeCanvas.width, badgeCanvas.height);
  c.setTransform(K, 0, 0, K, 0, 0);
  c.textBaseline = 'middle';
  // 後ろを流れる字と重ならないよう、白い やわらかい板を敷く
  c.save();
  c.shadowColor = 'rgb(255 255 255 / 0.95)';
  c.shadowBlur = 10;
  c.fillStyle = 'rgb(255 255 255 / 0.94)';
  c.beginPath();
  c.roundRect(14, 8, BADGE.w - 22, BADGE.h - 16, 28);
  c.fill();
  c.restore();
  c.font = monoFont(30, 700);
  const lw = c.measureText(page.speedLabel).width + 34;
  c.fillStyle = 'rgb(22 22 26)';
  c.beginPath();
  c.roundRect(BADGE.w - lw - 16, BADGE.h / 2 - 22, lw, 44, 22);
  c.fill();
  c.fillStyle = '#ffffff';
  c.fillText(page.speedLabel, BADGE.w - lw + 1, BADGE.h / 2 + 2);
  c.font = monoFont(30, 600);
  c.textAlign = 'right';
  c.fillStyle = 'rgb(96 96 106)';
  c.fillText(clock, BADGE.w - lw - 30, BADGE.h / 2 + 2);
  c.textAlign = 'left';
  badgeSprite.tex.needsUpdate = true;
}
const captionAlpha = (c, t) => q5(seg(t, c.in, c.in + FADE)) * (1 - q5(seg(t, c.out - FADE, c.out)));

// 終わりのロゴ：マーク「」（サイトのヘッダーと同じ形と色）と、Inter 800 の字。字の大きさ＝マークの高さ、間は字の大きさの 0.4
const lockup = (() => {
  const px = END.markPx * K;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `800 ${px}px LDInter`;
  probe.letterSpacing = `${-0.02 * px}px`;
  const tm = probe.measureText(END.wordmark);
  const gap = 0.4 * px;
  const pad = Math.ceil(px * 0.3);
  const w = px + gap + tm.width + pad * 2;
  const h = px + pad * 2;
  const capPx = tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent;
  const canvas = drawCanvas(w, h, (ctx) => {
    ctx.save();
    ctx.translate(pad, pad);
    ctx.scale(px / 80, px / 80);
    ctx.translate(-8, -8);
    ctx.fillStyle = css(END.dark);
    ctx.fill(new Path2D('M8 8H56V24H24V72H8Z'));
    ctx.fillStyle = css(END.red);
    ctx.fill(new Path2D('M88 88H40V72H72V24H88Z'));
    ctx.restore();
    ctx.font = probe.font;
    ctx.letterSpacing = probe.letterSpacing;
    ctx.fillStyle = css(END.dark);
    ctx.textBaseline = 'alphabetic';
    // 字の大文字の高さの中央を、マークの中央に合わせる
    const capMid = (tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2;
    ctx.fillText(END.wordmark, pad + px + gap, pad + px / 2 + capMid);
  });
  return { sprite: overlaySprite(canvas), w: w / K, h: h / K, capPx };
})();
function lineSprite(text, font, color) {
  if (!text) return null;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const tm = probe.measureText(text);
  const fs = parseFloat(/(\d+(\.\d+)?)px/.exec(font)[1]);
  const canvas = drawCanvas(tm.width + fs * 0.4, fs * 1.6, (c) => {
    c.font = font;
    c.fillStyle = color;
    c.textBaseline = 'alphabetic';
    c.fillText(text, fs * 0.2, fs * 1.2);
  });
  return { sprite: overlaySprite(canvas), w: canvas.width / K, h: canvas.height / K, inkPx: tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent };
}
// ロゴの下に、小さく ludion.ai（サイトのロゴと同じ書体）
const endDomain = lineSprite(END.domain, `600 ${Math.round(H * END.domainSize)}px LDInter`, '#6e6e78');
function updateOverlay(t) {
  for (const c of captions) {
    const a = captionAlpha(c, t);
    const rise = (1 - q5(seg(t, c.in, c.in + 0.95))) * 12;
    const y = 1080 * CAPTION.jaY - (c.baseJa / H) * 1080 + rise;
    c.sprite.set(0, y, 1920, (c.canvasH / H) * 1080, a);
  }
  paintBadge(t);
  {
    // ロゴは、少し大きい所から、ゆっくり落ち着く（最後まで、わずかに動いている）
    // 出る時刻のコマで、もう見えている（最後の和音と合わせる）
    const a = t < END.logoIn[0] - 1e-6 ? 0 : 1 - Math.pow(1 - seg(t + 1 / TL.fps, END.logoIn[0], END.logoIn[1]), 3);
    const s = mix(1.05, 1, easeOut(seg(t, END.logoIn[0], END.settleBy)));
    const w = lockup.w * s;
    const h = lockup.h * s;
    lockup.sprite.set(960 - w / 2, 1080 * END.logoY - h / 2, w, h, a);
  }
  if (endDomain) {
    const u = q5(seg(t, END.domainIn, END.domainIn + 0.8));
    endDomain.sprite.set(960 - endDomain.w / 2, 1080 * END.domainY - endDomain.h / 2 + (1 - u) * 8, endDomain.w, endDomain.h, u);
  }
}

// ---- 1コマ
const halton = (i, b) => {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
};
const pixels = new Uint8Array(W * H * 4);
let timings = {};
function renderFrameAt(t0) {
  const start = performance.now();
  paintTerminal(t0);
  const afterPaint = performance.now();
  const shutter = 0.5 / TL.fps;
  renderer.setRenderTarget(accumRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  for (let s = 0; s < SAMPLES; s++) {
    const t = t0 + (shutter * (s + 0.5)) / SAMPLES;
    updateBoards(t);
    // ふちをなめらかにするため、描く位置を画素より細かくずらす
    const D = setCamera(t, halton(s + 1, 2) - 0.5, halton(s + 1, 3) - 0.5);
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    const u = dofMat.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = D;
    u.uAperture.value = DOF.k;
    u.uRot.value = s * 1.7;
    fullscreen(dofMat, dofRT);
    renderer.autoClear = false;
    fullscreen(copyAdd, accumRT);
    renderer.autoClear = true;
  }
  fullscreen(finishMat, outRT);
  updateOverlay(t0);
  renderer.autoClear = false;
  renderer.setRenderTarget(outRT);
  renderer.render(overlay, overlayCam);
  renderer.autoClear = true;
  const afterDraw = performance.now();
  renderer.readRenderTargetPixels(outRT, 0, 0, W, H, pixels);
  timings = { paint: afterPaint - start, draw: afterDraw - afterPaint, read: performance.now() - afterDraw };
  return pixels;
}

// ---- 画面の上の位置を知る（見出しが読める字に重ならないことを確かめる。出来事の絵を、動くカメラの中で追う）。四角は 1920×1080 の画素
const projV = new THREE.Vector3();
function aimCamera(t) {
  setCamera(t, 0, 0);
  camera.updateMatrixWorld(true);
}
/** 世界の四角（向かい合う2つの角）を、今のカメラで、画面の四角にする。 */
function screenRect(x0, y0, x1, y1, z) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    projV.set(x, y, z).project(camera);
    const sx = (projV.x + 1) * 960;
    const sy = (1 - projV.y) * 540;
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
const onScreen = (r) => r.x < 1920 && r.y < 1080 && r.x + r.w > 0 && r.y + r.h > 0;
const clip = (r) => {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const w = Math.min(1920, r.x + r.w) - x;
  const h = Math.min(1080, r.y + r.h) - y;
  return w > 1 && h > 1 ? { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } : null;
};
// ターミナルの行の四角（設計の画素）
const CONTENT_Y = TITLE_H + TPAD * 0.8;
for (const page of LAID) {
  for (const l of page.lines) {
    termCtx.font = l.st.font;
    l.w = termCtx.measureText(l.text).width;
    l.w1 = termCtx.measureText(l.chars[0] ?? '').width;
  }
}
function lineBox(l, part = 'text') {
  const mid = CONTENT_Y + l.y + l.st.lineH / 2;
  const half = TM.fontPx * 0.66;
  const x0 = TPAD + (isBox(l.kind) ? BOX_X : 0);
  if (part === 'first') return [x0 - 2, mid - half, l.w1 + 4, half * 2];
  if (part === 'caret') return [x0 + l.w - 3, mid - half, 14, half * 2];
  return [x0, mid - half, l.w, half * 2];
}
/** ターミナルの板の中の四角（設計の画素）を、画面の四角にする */
const termRect = (board, [dx, dy, dw, dh]) => {
  const S = termOf(board).spec;
  const k = S.size[0] / TDW;
  return screenRect(S.at[0] - S.size[0] / 2 + dx * k, S.at[1] + S.size[1] / 2 - dy * k, S.at[0] - S.size[0] / 2 + (dx + dw) * k, S.at[1] + S.size[1] / 2 - (dy + dh) * k, S.at[2]);
};
/** サイトの窓の中の四角（CSS の画素）を、画面の四角にする */
const siteRect = (r) => {
  const a = site.pt(r.x, r.y);
  const b = site.pt(r.x + r.width, r.y + r.height);
  return screenRect(a[0], a[1], b[0], b[1], a[2]);
};
const lineVisible = (page, l, t) => pageAlpha(page, t) > 0.003 && (isBox(l.kind) ? typedCount(l, t) > 0 : l.at <= t + 1e-6);
/** 「許可する」の画面の中の四角（CSS の画素）を、画面の四角にする。開くときの大きさの変わり方も入れる。 */
function pageRect(r, t) {
  const pop = brPop(t);
  const px = (x) => BR.size[0] / 2 + (x - BR.size[0] / 2) * pop;
  const py = (y) => BR.size[1] / 2 + (y - BR.size[1] / 2) * pop;
  const a = pagePt(px(r.x), py(r.y));
  const b = pagePt(px(r.x + r.width), py(r.y + r.height));
  return screenRect(a[0], a[1], b[0], b[1], BR.at[2]);
}
// 空の板の字（まだ撮っていない場面の題と注）
termCtx.font = noteFont(22, 600);
const TITLE_W = termCtx.measureText(TM.title).width;
for (const e of emptyBoards) {
  const dw = e.spec.kind === 'terminal-empty' ? TDW : 1440;
  const dh = Math.round((dw * e.spec.size[1]) / e.spec.size[0]);
  termCtx.font = noteFont(34, 600);
  const lw = termCtx.measureText(e.spec.label).width;
  termCtx.font = noteFont(24, 500);
  const nw = termCtx.measureText(e.spec.note).width;
  e.texts = [
    { text: e.spec.label, box: [dw / 2 - lw / 2, dh / 2 - 22 - 21, lw, 42] },
    { text: e.spec.note, box: [dw / 2 - nw / 2, dh / 2 + 28 - 15, nw, 30] },
    ...(e.spec.kind === 'terminal-empty' ? [{ text: TM.title, box: [dw / 2 - TITLE_W / 2, TITLE_H / 2 - 14, TITLE_W, 28] }] : []),
  ];
  e.k = e.spec.size[0] / dw;
}
/** 時刻 t に、画面で読める字の四角（今のカメラで）。「許可する」の画面の後ろに隠れたターミナルの行は入れない。 */
function readableTexts(t) {
  const out = [];
  const ba = brAlpha(t);
  const board = ba > 0.003 ? pageRect({ x: 0, y: 0, width: BR.size[0], height: BR.size[1] }, t) : null;
  const hidden = (r) => ba >= 0.97 && r.x >= board.x && r.y >= board.y && r.x + r.w <= board.x + board.w && r.y + r.h <= board.y + board.h;
  const push = (what, text, r, more = {}) => {
    if (onScreen(r)) out.push({ what, text: text.slice(0, 30), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), ...more });
  };
  if (boardsAlpha(t) > 0.003) {
    for (const term of TERMS) {
      // 白く薄めている間の奥のターミナルの字は、読めない
      if (term.spec.id === 'term1' && veilAt(t) > 0.5) continue;
      for (const page of term.pages) {
        for (const l of page.lines) {
          if (l.kind === 'gap' || !lineVisible(page, l, t)) continue;
          const r = termRect(page.board, lineBox(l));
          if (!hidden(r)) push(`terminal:${l.id ?? l.kind}`, l.text, r);
        }
      }
      const title = termRect(term.spec.id, [TDW / 2 - TITLE_W / 2, TITLE_H / 2 - 14, TITLE_W, 28]);
      if (!hidden(title)) push('terminal:title', TM.title, title);
    }
    // サイトの窓：その時刻に見えている状態（替わる途中は、前と後の両方）の字
    if (site) {
      const st = site.stateAt(t);
      for (const id of st.m > 0 ? [st.a, st.b] : [st.a]) for (const r of site.states[id].textRects) push(`site:${id}`, r.text, siteRect(r), { fontPx: r.fontPx, tag: r.tag });
    }
    for (const e of emptyBoards) {
      for (const x of e.texts) {
        const [dx, dy, dw, dh] = x.box;
        const s = e.spec;
        push(`board:${s.id}`, x.text, screenRect(s.at[0] - s.size[0] / 2 + dx * e.k, s.at[1] + s.size[1] / 2 - dy * e.k, s.at[0] - s.size[0] / 2 + (dx + dw) * e.k, s.at[1] + s.size[1] / 2 - (dy + dh) * e.k, s.at[2]));
      }
    }
  }
  if (ba > 0.003) for (const r of SHOTS.textRects) push('browser', r.text, pageRect(r, t), { fontPx: r.fontPx, tag: r.tag });
  return out;
}
/** 見出しの字の四角（日本語の上端から、英語の下端まで）。 */
function captionRect(c, t) {
  const rise = (1 - q5(seg(t, c.in, c.in + 0.95))) * 12;
  const top = 1080 * CAPTION.jaY - (c.baseJa / H) * 1080 + rise;
  const w = Math.max(c.wJa, c.wEn) / K;
  const y0 = top + (c.baseJa - c.ascJa) / K;
  const y1 = top + (c.baseEn + c.descEn) / K;
  return { x: 960 - w / 2, y: y0, w, h: y1 - y0 };
}
/** 四角と四角のすきま（画素）。負なら重なっている。 */
const gapOf = (a, b) => Math.max(Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)));
/** 全部のコマで、見出し（消えかけの間も）が、読める字からすきま margin 以上、離れていることを確かめる。 */
function checkOverlaps(margin) {
  const frames = Math.round(TL.duration * TL.fps);
  const bad = [];
  let checked = 0;
  let min = { gap: Infinity };
  for (let f = 0; f < frames; f++) {
    const t = f / TL.fps;
    const shown = captions.filter((c) => captionAlpha(c, t) > 0.003);
    if (!shown.length) continue;
    aimCamera(t);
    const texts = readableTexts(t);
    for (const c of shown) {
      checked += 1;
      const r = captionRect(c, t);
      for (const x of texts) {
        const gap = gapOf(r, x);
        if (gap < min.gap) min = { gap: Math.round(gap), t: Number(t.toFixed(3)), caption: c.ja, what: x.what, text: x.text };
        if (gap < margin) bad.push({ t: Number(t.toFixed(3)), frame: f, caption: c.ja, alpha: Number(captionAlpha(c, t).toFixed(2)), what: x.what, text: x.text, gap: Math.round(gap) });
      }
    }
  }
  // 重なったコマを、続きの区間にまとめる（どこを直せばよいかを見るため）
  const ranges = [];
  for (const b of bad) {
    const last = ranges.at(-1);
    if (last && b.frame - last.to <= 1) {
      last.to = b.frame;
      if (!last.texts.includes(b.text) && last.texts.length < 6) last.texts.push(b.text);
      last.minGap = Math.min(last.minGap, b.gap);
    } else ranges.push({ from: b.frame, to: b.frame, caption: b.caption, texts: [b.text], minGap: b.gap });
  }
  return { framesChecked: checked, margin, violations: bad.length, first: bad.slice(0, 10), last: bad.slice(-3), min, ranges: ranges.map((r) => ({ ...r, fromT: Number((r.from / TL.fps).toFixed(3)), toT: Number((r.to / TL.fps).toFixed(3)) })) };
}
/** 音の付く出来事と、その絵が出る四角（時刻ごと）。ずれを測る道具（check-sync.mjs）が、この四角でコマを切り出す。 */
function eventList() {
  const ev = [];
  for (const page of LAID) {
    for (const l of page.lines) {
      if (!l.id) continue;
      if (isBox(l.kind)) {
        ev.push({ id: `type:${l.id}`, t: l.at, rect: () => termRect(l.board, lineBox(l, 'first')) });
        ev.push({ id: `enter:${l.id}`, t: l.enter, rect: () => termRect(l.board, lineBox(l, 'caret')) });
      } else if (l.kind !== 'code') ev.push({ id: `line:${l.id}`, t: l.at, rect: () => termRect(l.board, lineBox(l)) });
    }
  }
  ev.push({ id: 'browser', t: BR.in[0], rect: (t) => pageRect({ x: 0, y: 0, width: BR.size[0], height: BR.size[1] }, Math.max(t, BR.in[0])) });
  ev.push({
    id: 'click',
    t: BR.press,
    rect: (t) => {
      const c = cursorState(Math.min(t, BR.press - 1 / TL.fps)); // 押す前の大きさの四角で切る（縮むのを、変わった所として見る）
      return screenRect(c.center[0] - c.size / 2, c.center[1] + c.size / 2, c.center[0] + c.size / 2, c.center[1] - c.size / 2, c.center[2]);
    },
  });
  if (site) {
    // サイトの窓：状態が替わる（ナビに増える、本文へ飛ぶ）。替わった所の四角で見る
    for (const sw of site.switches) {
      const to = site.states[sw.to].boxes;
      // ナビに増えるときは、増えた行。本文へ飛ぶときは、窓の全部（画面に入っている所で見る）
      const r = sw.region === 'nav' ? to.navRows[0].rect : { x: 0, y: 0, width: site.V.width, height: site.V.height };
      ev.push({ id: `site:${sw.to}`, t: sw.at, rect: () => siteRect(r) });
    }
    site.targets.forEach((target, i) => {
      ev.push({
        id: `site:click${i + 1}`,
        t: target.press,
        rect: (t) => {
          const c = site.cursorWorld(Math.min(t, target.press - 1 / TL.fps)); // 押す前の大きさの四角で切る
          return screenRect(c.center[0] - c.size / 2, c.center[1] + c.size / 2, c.center[0] + c.size / 2, c.center[1] - c.size / 2, c.center[2]);
        },
      });
    });
  }
  ev.push({ id: 'logo', t: END.logoIn[0], rect: () => ({ x: 960 - lockup.w / 2, y: 1080 * END.logoY - lockup.h / 2, w: lockup.w, h: lockup.h }) });
  return ev;
}

window.__stage = {
  /** 見出しが、読める字に重ならないか（全部のコマ）。 */
  overlaps(margin = 10) {
    return checkOverlaps(margin);
  },
  /** 出来事ごとの、前後のコマでの四角（コマのまん中の時刻のカメラで）。 */
  events() {
    return eventList().map((e) => {
      const frame = Math.round(e.t * TL.fps);
      const rects = {};
      for (let f = frame - 6; f <= frame + 7; f++) {
        if (f < 0) continue;
        const tt = (f + 0.25) / TL.fps;
        aimCamera(tt);
        rects[f] = clip(e.rect(tt));
      }
      return { id: e.id, t: e.t, frame, rects };
    });
  },
  /** 時刻 t に読める字の四角（描いた絵から、字の高さを測るのに使う）。 */
  texts(t) {
    aimCamera(t);
    return readableTexts(t);
  },
  async frame(frame, url) {
    const px = renderFrameAt(frame / TL.fps);
    const sent = performance.now();
    const res = await fetch(url, { method: 'POST', body: px });
    if (!res.ok) throw new Error(`絵を送れなかった: ${res.status}`);
    timings.post = performance.now() - sent;
    return timings;
  },
  async still(t, url) {
    const px = renderFrameAt(t);
    const res = await fetch(url, { method: 'POST', body: px });
    if (!res.ok) throw new Error(`絵を送れなかった: ${res.status}`);
    return timings;
  },
  info() {
    return { gpu: GPU_NAME, width: W, height: H, samples: SAMPLES, three: THREE.REVISION };
  },
  measure() {
    return {
      captions: captions.map((c) => ({ ja: c.ja, en: c.en, in: c.in, out: c.out, jaInkRatio: Number((c.inkJa / H).toFixed(4)), enOverJa: Number((c.inkEn / c.inkJa).toFixed(3)) })),
      end: { markRatio: END.markPx / 1080, wordmarkInkRatio: Number((lockup.capPx / H).toFixed(4)), domainInkRatio: endDomain ? Number((endDomain.inkPx / H).toFixed(4)) : null },
      terminal: {
        pages: LAID.map((page) => ({ id: page.id, lines: page.lines.length, height: page.height, speedLabel: page.speedLabel })),
        viewHeight: Object.fromEntries(TERMS.map((term) => [term.spec.id, term.dh - TITLE_H - TPAD * 1.2])),
        // カメラが寄って追う行の、字の高さ（画面の高さとの比）と、行の右端（画面の幅との比）
        textInkRatio: Object.fromEntries(FOCUSED.map((id) => [id, Number(((FOCUS.lines[id].ink * 1920) / FOCUS.fw / 1080).toFixed(4))])),
        rightAt: Object.fromEntries(Object.entries(FOCUS.lines).map(([id, l]) => [id, Number((TL.camera.textLeftAt + l.width / FOCUS.fw).toFixed(3))])),
      },
      browser: {
        fw: Math.min(...camKeys.filter((k) => k.page).map((k) => k.fw)),
        shots: SHOTS.base,
        allowButton: SHOTS.allowButton,
        // 押す時刻に、「許可する」のボタンの左右に残るすきま（画面の幅との比。小さいほう）
        buttonGap: (() => {
          aimCamera(BR.press);
          const r = pageRect(SHOTS.allowButton, BR.press);
          return Number((Math.min(r.x, 1920 - (r.x + r.w)) / 1920).toFixed(4));
        })(),
        // 開いてから、不透明（濃さ 0.99 以上）になるまでの秒数
        opaqueAfter: (() => {
          for (let f = 0; f < TL.fps; f++) if (brAlpha(BR.in[0] + f / TL.fps) >= 0.99) return Number((f / TL.fps).toFixed(3));
          return null;
        })(),
      },
      camera: camKeys.map((k) => ({ t: k.t, fw: Math.round(k.fw), p: k.p.map((v) => Math.round(v)) })),
    };
  },
};

// workspace.mjs からの呼び出しを受ける
for (;;) {
  const job = await (await fetch('/rpc/next', { cache: 'no-store' })).json();
  if (job.method === '__stop') break;
  let result = null;
  let error = null;
  try {
    result = await window.__stage[job.method](...job.args);
  } catch (e) {
    error = e && e.stack ? e.stack : String(e);
  }
  await fetch(`/rpc/result/${job.id}`, { method: 'POST', body: JSON.stringify({ result, error }) });
}
