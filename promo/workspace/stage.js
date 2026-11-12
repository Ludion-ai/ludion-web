// V006 の映像の本体。白い空間に、ターミナルの窓とサイトの窓を「板」として横に並べ、1台のカメラがその間を流れる（Three.js）。
// すべて時刻 t だけで決まる。単位は画素（ターミナルの板が 1240×780、y は上向き）。
// - 動きのぶれ：1コマを複数の時刻で描いて重ねる
// - 奥行き：深さからぼけの量を決める（ピントはカメラの見ている点）
// ターミナルの文字は、本物の記録から作った行（terminal.mjs）だけ。まだ撮っていない場面の板は、空のまま置く。

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
    uniforms: { map: { value: map }, uSize: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 0 }, uAlpha: { value: 1 }, uBias: { value: -0.2 }, uEdge: { value: 0.07 } },
    vertexShader: BOARD_VERT,
    fragmentShader: /* glsl */ `
      ${SD}
      varying vec2 vUv; uniform sampler2D map; uniform vec2 uSize; uniform float uRadius,uAlpha,uBias,uEdge;
      void main(){
        vec2 p=(vUv-.5)*uSize;
        float d=sdBox(p,uSize*.5,uRadius);
        float aa=max(fwidth(d),1e-4)*.8;
        float a=1.-smoothstep(-aa,aa,d);
        vec3 c=texture2D(map,vec2(vUv.x,1.-vUv.y),uBias).rgb;
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

function makeBoard(map) {
  const group = new THREE.Group();
  const mat = boardMaterial(map);
  const mesh = new THREE.Mesh(planeGeo, mat);
  group.add(mesh);
  const sh = new THREE.Mesh(planeGeo, shadowMaterial());
  sh.position.z = -2;
  group.add(sh);
  scene.add(group);
  const b = { group, mesh, mat, sh };
  b.set = (x, y, z, w, h, { radius = 0, alpha = 1, yaw = 0 } = {}) => {
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

// ---- ターミナルの板（場面1：本物の記録を流す）
const TM = TL.terminal;
const RUN = DATA.terminal;
const BOARDS = TL.world.boards;
const T1 = BOARDS.find((b) => b.id === 'term1');
const TDW = TM.designW;
const TDH = Math.round((TDW * T1.size[1]) / T1.size[0]);
const TITLE_H = 58;
const TPAD = 44;
const termK = Math.max(1.5, 1.5 * K);
const monoFont = (size, weight = 400) => `${weight} ${size}px LDMono, LDNoto`;
const noteFont = (size, weight = 500) => `${weight} ${size}px LDNoto`;
const STYLE = {
  user: { font: noteFont(TM.fontPx + 2, 500), color: [34, 34, 40], lineH: TM.lineH + 6 },
  say: { font: noteFont(TM.fontPx + 2, 500), color: [28, 28, 32], lineH: TM.lineH + 8 },
  tool: { font: monoFont(TM.fontPx, 650), color: [28, 28, 32], lineH: TM.lineH + 6 },
  code: { font: monoFont(TM.fontPx - 4), color: [104, 104, 116], lineH: TM.lineH - 6 },
  gap: { font: monoFont(TM.fontPx - 2), color: [170, 170, 178], lineH: TM.lineH - 4 },
  hook: { font: monoFont(TM.fontPx, 700), color: [14, 14, 18], lineH: TM.lineH + 10 },
};
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
const termCanvas = drawCanvas(TDW * termK, TDH * termK, () => {});
const termCtx = termCanvas.getContext('2d');
const termTex = canvasTexture(termCanvas);
const termBoard = makeBoard(termTex);

// 行の位置を決める（1回だけ）
const LAYOUT = (() => {
  const lines = [];
  let y = 0;
  let prev = null;
  for (const item of RUN.items) {
    const st = STYLE[item.kind];
    const tight = (prev === 'tool' && item.kind === 'code') || (prev === 'code' && item.kind === 'gap') || (prev === 'gap' && item.kind === 'code');
    if (prev && prev !== item.kind && !tight) y += item.kind === 'hook' ? 20 : 16;
    if (prev === 'user') y += 18;
    lines.push({ ...item, y, st, chars: [...item.text] });
    y += st.lineH;
    prev = item.kind;
  }
  return { lines, height: y };
})();
const USER = LAYOUT.lines.find((l) => l.kind === 'user');
const HOOK = LAYOUT.lines.find((l) => l.kind === 'hook');
const typeStep = (USER.typeTo - USER.at) / USER.chars.length;
/** 指示の文字が、いくつ打たれたか。 */
const typedCount = (t) => clamp(Math.floor((t - USER.at) / typeStep + 1e-6) + 1, 0, USER.chars.length);

let termStamp = '';
function paintTerminal(t) {
  // 文字は 1/60 秒より細かくは変わらないので、同じ絵なら描き直さない
  const stamp = t > TM.say + 1 ? 'done' : String(Math.round(t * 600));
  if (stamp === termStamp) return;
  termStamp = stamp;
  const c = termCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, termCanvas.width, termCanvas.height);
  c.setTransform(termK, 0, 0, termK, 0, 0);
  const viewH = TDH - TITLE_H - TPAD * 1.2;
  const bottomAt = (tt) => {
    let b = 0;
    for (const l of LAYOUT.lines) if (l.at <= tt + 1e-6) b = Math.max(b, l.y + l.st.lineH);
    return b;
  };
  let smooth = 0;
  for (let i = 0; i < 8; i++) smooth += bottomAt(t - (i * 0.24) / 8);
  smooth /= 8;
  const scroll = Math.max(0, smooth - viewH);
  c.save();
  c.beginPath();
  c.rect(0, TITLE_H, TDW, TDH - TITLE_H);
  c.clip();
  c.translate(TPAD, TITLE_H + TPAD * 0.8 - scroll);
  c.textBaseline = 'middle';
  const maxW = TDW - TPAD * 2;
  for (const l of LAYOUT.lines) {
    const mid = l.y + l.st.lineH / 2;
    if (l.kind === 'user') {
      // 指示を打つ欄。打ち終えて送ると、欄の色が少し落ち着く
      const sent = q5(seg(t, l.enter, l.enter + 0.18));
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
      const shown = l.chars.slice(0, typedCount(t)).join('');
      c.fillStyle = css(l.st.color);
      c.fillText(shown, 40, mid + 1);
      if (t < l.enter + 0.05) {
        // 打つ位置の印
        const x = 40 + c.measureText(shown).width + 3;
        c.fillStyle = css([40, 40, 48], 0.85);
        c.fillRect(x, mid - TM.fontPx * 0.62, 2.5, TM.fontPx * 1.24);
      }
      continue;
    }
    if (l.at > t + 1e-6) continue; // 162/60 は 2.7 よりわずかに小さい。出る時刻のコマで出す
    const age = Math.max(0, t - l.at);
    // 出る時刻のコマで、もう見えている（音とのずれを1コマ以内にする）
    const a = q5((age + 1 / 60) / 0.035);
    c.font = l.st.font;
    if (l.kind === 'hook') {
      // プラグインが返した行。印が左から伸びる
      const g = q5(seg(t, l.at - 0.02, l.at + TM.hookGlow));
      const w = c.measureText(l.text).width + 28;
      c.fillStyle = 'rgb(255 208 112 / 0.55)';
      c.beginPath();
      c.roundRect(-14, l.y + 3, w * g, l.st.lineH - 6, 8);
      c.fill();
    }
    c.fillStyle = css(l.st.color, a);
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
  terminalChrome(c, TM.title);
  // 速さと経過（記録の時刻から計算したもの）
  const show = q5(seg(t, TM.enter, TM.enter + 0.25));
  if (show > 0.001) {
    const keys = RUN.clock;
    let rec = keys[keys.length - 1].rec;
    if (t <= keys[0].at) rec = keys[0].rec;
    else {
      for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i].at) {
          rec = mix(keys[i - 1].rec, keys[i].rec, seg(t, keys[i - 1].at, keys[i].at));
          break;
        }
      }
    }
    const clock = `${String(Math.floor(rec / 60)).padStart(2, '0')}:${String(Math.floor(rec % 60)).padStart(2, '0')}`;
    c.globalAlpha = show;
    c.textBaseline = 'middle';
    c.font = monoFont(22, 700);
    const lw = c.measureText(RUN.speedLabel).width + 26;
    c.textAlign = 'right';
    c.font = monoFont(22, 600);
    c.fillStyle = 'rgb(110 110 120)';
    c.fillText(clock, TDW - 22 - lw - 14, TITLE_H / 2 + 1);
    c.textAlign = 'left';
    c.fillStyle = 'rgb(22 22 26)';
    c.beginPath();
    c.roundRect(TDW - 22 - lw, TITLE_H / 2 - 17, lw, 34, 17);
    c.fill();
    c.font = monoFont(22, 700);
    c.fillStyle = '#ffffff';
    c.fillText(RUN.speedLabel, TDW - 22 - lw + 13, TITLE_H / 2 + 1);
    c.globalAlpha = 1;
  }
  termTex.needsUpdate = true;
}

// ---- まだ撮っていない場面の板（空のまま置く。偽の画面は描かない）
const emptyBoards = BOARDS.filter((b) => b.kind !== 'terminal').map((b) => {
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

const boardsAlpha = (t) => 1 - q5(seg(t, END.boardsOut[0], END.boardsOut[1]));
function updateBoards(t) {
  const a = boardsAlpha(t);
  termBoard.set(T1.at[0], T1.at[1], T1.at[2], T1.size[0], T1.size[1], { radius: T1.radius, alpha: a, yaw: T1.yaw });
  for (const e of emptyBoards) e.board.set(e.spec.at[0], e.spec.at[1], e.spec.at[2], e.spec.size[0], e.spec.size[1], { radius: e.spec.radius, alpha: a, yaw: e.spec.yaw });
}

// ---- カメラ
const camKeys = TL.camera.keys;
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
    ctx.fillStyle = '#111114';
    ctx.fillText(c.ja, W / 2, baseJa);
    m.inkJa = mJa.actualBoundingBoxAscent + mJa.actualBoundingBoxDescent;
    ctx.font = `500 ${es}px LDNoto`;
    ctx.letterSpacing = `${0.002 * es}px`;
    const mEn = ctx.measureText(c.en);
    ctx.fillStyle = '#6e6e78';
    ctx.fillText(c.en, W / 2, baseJa + Math.round(fs * 0.74));
    m.inkEn = mEn.actualBoundingBoxAscent + mEn.actualBoundingBoxDescent;
  });
  return { ...c, ...m, sprite: overlaySprite(canvas), baseJa, canvasH };
}
const captions = TL.captions.map(makeCaption);
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
const endJa = lineSprite(END.line.ja, `680 ${Math.round(H * 0.056)}px LDNoto`, '#111114');
const endEn = lineSprite(END.line.en, `500 ${Math.round(H * 0.056 * 0.45)}px LDNoto`, '#6e6e78');
function updateOverlay(t) {
  for (const c of captions) {
    const a = captionAlpha(c, t);
    const rise = (1 - q5(seg(t, c.in, c.in + 0.95))) * 12;
    c.sprite.set(0, 1080 * CAPTION.jaY - (c.baseJa / H) * 1080 + rise, 1920, (c.canvasH / H) * 1080, a);
  }
  {
    // ロゴは、少し大きい所から、ゆっくり落ち着く（最後まで、わずかに動いている）
    const a = q5(seg(t, END.logoIn[0], END.logoIn[1]));
    const s = mix(1.05, 1, easeOut(seg(t, END.logoIn[0], END.settleBy)));
    const w = lockup.w * s;
    const h = lockup.h * s;
    lockup.sprite.set(960 - w / 2, 1080 * END.logoY - h / 2, w, h, a);
  }
  [endJa, endEn].forEach((line, i) => {
    if (!line) return;
    const u = q5(seg(t, END.lineIn + i * 0.12, END.lineIn + i * 0.12 + 0.8));
    line.sprite.set(960 - line.w / 2, 1080 * (END.lineY + i * 0.052) - line.h / 2 + (1 - u) * 12, line.w, line.h, u);
  });
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

window.__stage = {
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
      end: { markRatio: END.markPx / 1080, wordmarkInkRatio: Number((lockup.capPx / H).toFixed(4)), lineJaInkRatio: endJa ? Number((endJa.inkPx / H).toFixed(4)) : null },
      terminal: {
        typed: USER.chars.length,
        typeStep: Number(typeStep.toFixed(4)),
        hookAt: HOOK.at,
        layoutHeight: LAYOUT.height,
        viewHeight: TDH - TITLE_H - TPAD * 1.2,
        // 1920 の画面で、板がいちばん大きく落ち着いたときの文字の高さ（画素）
        textPxAt1080: Number((((TM.fontPx + 2) * T1.size[0]) / TDW / (camKeys[1].fw / 1920)).toFixed(1)),
      },
      camera: camKeys.map((k) => ({ t: k.t, fw: k.fw })),
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
