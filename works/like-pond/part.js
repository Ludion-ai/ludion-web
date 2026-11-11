// part.js — ESモジュール。rootの中だけを触る
// 水面のいいね：丸い小さな池の水面が、そのままボタンになっている。
//
// 水面：波動方程式を GPU で解く。波紋は縁で跳ね返り、連打すれば本当に干渉する。
// 光：水面の傾きで光線を屈折させ、底に落ちる光の密度を網で測る（コースティクス）。
// ハート：底に落ちる光を、距離場で折り畳んで輪郭へ集める。ほどければ、元の揺らぎへ戻る。
// カーソル：水面をわずかに持ち上げる。盛り上がりはレンズになり、底に淡い光を集める。
// 開いた直後：一瞬だけハートが灯っていて、すぐにほどける。何が起きるボタンかを、押す前に見せる。
// 色は JS に書かない。--_bg、--_surface、--_fg、--_muted、--_accent の色相から、明るさを決めて作る。

const SIM_N = 384; // 水面の格子
const DOMAIN = 1.02; // 格子の半幅（水面の半径が 1）
const FLOOR_EXT = 1.16; // 底の光の板の半幅
const BAKE_EXT = 1.25; // 石の模様の板の半幅
const R_OUT = 1.17; // 石の輪の外の半径
const HALF = R_OUT / 0.86; // canvas の半幅（影の余白を含む）
const CAM = 3.4; // 目の高さ
const STEP = 1 / 360; // 波の計算の1歩（秒）
const MAX_STEPS = 9;
const WAVE_SPEED = 1.02; // 波の速さ（半径 / 秒）
const FALL = 0.27; // 滴が落ちるまでの秒数
const DROP_Z = 2.3; // 滴の出発の高さ
const GRAVITY = (2 * DROP_Z) / (FALL * FALL);
const BURST_MS = 420; // これより短い間隔の押しは、連打として数える
const MAX_DROPS = 12;
const MAX_SOURCES = 8;
const WAVES = 16;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smootherstep = (x) => {
  const t = clamp(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 色の計算（OKLab）
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function rgbToOklab(r8, g8, b8) {
  const r = toLinear(r8 / 255);
  const g = toLinear(g8 / 255);
  const b = toLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToLinear(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
// 明るさを決め、色域に入るまで鮮やかさを落として、線形の RGB を返す
function tone(L, a, b) {
  let k = 1;
  for (let i = 0; i < 24; i++) {
    const rgb = oklabToLinear(L, a * k, b * k);
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgb.map((v) => clamp(v));
    k *= 0.9;
  }
  return oklabToLinear(L, 0, 0).map((v) => clamp(v));
}

// ---- シェーダー
const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const INIT_FRAG = `#version 300 es
precision highp float;
uniform float uDx;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy * uDx - ${DOMAIN.toFixed(3)};
  o = vec4(0.0, 0.0, 0.0, clamp((1.0 - length(p)) / uDx + 0.5, 0.0, 1.0));
}`;

// 波の1歩。r が高さ、g が速さ、a が水のある割合
const simFrag = (sources) => `#version 300 es
precision highp float;
precision highp sampler2D;
${sources ? '#define SOURCES' : ''}
uniform sampler2D uState;
uniform float uC2, uNu, uDamp, uDx;
#ifdef SOURCES
uniform int uSrcN;
uniform vec4 uSrc[${MAX_SOURCES}];
uniform vec4 uBumpNow, uBumpOld;
#endif
out vec4 o;
#define AT(i, j) texelFetch(uState, q + ivec2(i, j), 0)
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 s = AT(0, 0);
  if (s.a <= 0.0) { o = vec4(0.0); return; }
  vec2 p = (vec2(q) + 0.5) * uDx - ${DOMAIN.toFixed(3)};
  float r = length(p);
  vec4 e = AT(1, 0), w = AT(-1, 0), n = AT(0, 1), d = AT(0, -1);
  vec4 ne = AT(1, 1), nw = AT(-1, 1), se = AT(1, -1), sw = AT(-1, -1);
  float h0 = s.r;
  float v0 = s.g;
  // 外の隣は、自分と同じ高さとして読む。波はそこで跳ね返る
  float lap = (4.0 * (mix(h0, e.r, e.a) + mix(h0, w.r, w.a) + mix(h0, n.r, n.a) + mix(h0, d.r, d.a))
    + mix(h0, ne.r, ne.a) + mix(h0, nw.r, nw.a) + mix(h0, se.r, se.a) + mix(h0, sw.r, sw.a) - 20.0 * h0) / 6.0;
  float vlap = mix(v0, e.g, e.a) + mix(v0, w.g, w.a) + mix(v0, n.g, n.a) + mix(v0, d.g, d.a) - 4.0 * v0;
  // 岸に近づくと浅くなり、波は遅くなって、少しだけ吸われる
  float shoal = 1.0 - 0.42 * smoothstep(0.7, 1.0, r);
  float sponge = 1.0 - 0.05 * smoothstep(0.84, 1.0, r);
  float v = (v0 + uC2 * shoal * lap + uNu * vlap - 0.00003 * h0) * uDamp * sponge;
#ifdef SOURCES
  for (int i = 0; i < uSrcN; i++) {
    vec2 dd = p - uSrc[i].xy;
    float e2 = dot(dd, dd) / (uSrc[i].w * uSrc[i].w);
    if (e2 < 14.0) v += uSrc[i].z * (1.0 - e2) * exp(-e2); // 全体で水の量が変わらない形
  }
  // カーソルが動くと、持ち上げられた水の分だけ、まわりがわずかに揺れる
  {
    vec2 a = p - uBumpNow.xy;
    vec2 b = p - uBumpOld.xy;
    float s2 = uBumpNow.w * uBumpNow.w;
    v -= 0.16 * (uBumpNow.z * exp(-dot(a, a) / s2) - uBumpOld.z * exp(-dot(b, b) / s2));
  }
#endif
  v /= 1.0 + abs(v) * 18.0;
  o = vec4(h0 + v, v, 0.0, s.a);
}`;

// 見せる水面：波＋風のさざ波＋カーソルの盛り上がり。r が高さ、gb が傾き
const COMPOSE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uState;
uniform float uDx, uTime, uBreeze;
uniform vec4 uBump;
uniform vec4 uWave[${WAVES}];
out vec4 o;
#define AT(i, j) texelFetch(uState, q + ivec2(i, j), 0)
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 s = AT(0, 0);
  vec2 p = (vec2(q) + 0.5) * uDx - ${DOMAIN.toFixed(3)};
  float h0 = s.r;
  vec4 e = AT(1, 0), w = AT(-1, 0), n = AT(0, 1), d = AT(0, -1);
  vec4 ne = AT(1, 1), nw = AT(-1, 1), se = AT(1, -1), sw = AT(-1, -1);
  float he = mix(h0, e.r, e.a), hw = mix(h0, w.r, w.a), hn = mix(h0, n.r, n.a), hd = mix(h0, d.r, d.a);
  float hne = mix(h0, ne.r, ne.a), hnw = mix(h0, nw.r, nw.a), hse = mix(h0, se.r, se.a), hsw = mix(h0, sw.r, sw.a);
  vec2 g = vec2(3.0 * (hne - hnw + hse - hsw) + 10.0 * (he - hw), 3.0 * (hne + hnw - hse - hsw) + 10.0 * (hn - hd)) / (32.0 * uDx);
  float h = h0;
  if (s.a <= 0.0) {
    h = 0.0;
    g = vec2(0.0);
  }
  // 風のさざ波。線が格子に揃わないよう、座標をゆるく曲げてから重ねる
  float t = uTime;
  vec2 w1 = vec2(3.1 * p.y + t * 0.21 + 1.0, 2.7 * p.x - t * 0.17 + 4.0);
  vec2 w2 = vec2(6.7 * p.y + 1.9 * p.x - t * 0.13 + 2.0, 5.3 * p.x - 2.3 * p.y + t * 0.11 + 5.0);
  vec2 P = p + 0.06 * sin(w1) + 0.024 * sin(w2);
  float j01 = 0.06 * 3.1 * cos(w1.x) + 0.024 * 6.7 * cos(w2.x);
  float j10 = 0.06 * 2.7 * cos(w1.y) + 0.024 * 5.3 * cos(w2.y);
  vec3 br = vec3(0.0);
  for (int i = 0; i < ${WAVES}; i++) {
    vec4 k = uWave[i];
    float a = 0.46 / dot(k.xy, k.xy);
    a *= 0.62 + 0.38 * sin(dot(k.yx, P) * 0.11 + k.w * 3.0 + t * 0.09);
    float ph = dot(k.xy, P) + k.z * t + k.w;
    br += a * vec3(sin(ph), k.xy * cos(ph));
  }
  br.yz = vec2(br.y + br.z * j10, br.z + br.y * j01);
  float shelter = smoothstep(1.02, 0.8, length(p));
  h += br.x * uBreeze * shelter;
  g += br.yz * uBreeze * shelter;
  // カーソルの盛り上がり
  vec2 c = p - uBump.xy;
  float s2 = uBump.w * uBump.w;
  float bump = uBump.z * exp(-dot(c, c) / s2);
  h += bump;
  g += -2.0 * c / s2 * bump;
  o = vec4(h, g, 1.0);
}`;

// 底に落ちる光の網。頂点ごとに、光線の束がどれだけ縮むかを測る（三角形ごとに測ると、面が見えてしまう）
const CAUSTIC_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uH;
uniform int uGrid;
uniform float uOptic;
out vec2 vSrc;
out float vFlux;
vec2 slope(vec2 p) {
  vec2 s = textureLod(uH, clamp(p / ${(2 * DOMAIN).toFixed(3)} + 0.5, 0.0, 1.0), 0.0).yz;
  // 水のないところでは、光は曲がらない
  return s * smoothstep(1.0, 0.9, length(p));
}
void main() {
  int col = gl_VertexID % (uGrid + 1);
  int row = gl_VertexID / (uGrid + 1);
  float cell = 2.16 / float(uGrid);
  vec2 p = (vec2(float(col), float(row)) / float(uGrid) * 2.0 - 1.0) * 1.08;
  vec2 g = slope(p);
  // 水に入った光は、傾きのぶんだけ曲がる。盛り上がりは光を集める
  float depth = uOptic * 0.248 * (0.72 + 0.28 * max(1.0 - dot(p, p), 0.0));
  vec2 land = p + g * depth + vec2(0.022, -0.03);
  vec2 gx = (slope(p + vec2(cell, 0.0)) - slope(p - vec2(cell, 0.0))) / (2.0 * cell);
  vec2 gy = (slope(p + vec2(0.0, cell)) - slope(p - vec2(0.0, cell))) / (2.0 * cell);
  float det = (1.0 + depth * gx.x) * (1.0 + depth * gy.y) - depth * gx.y * depth * gy.x;
  vFlux = 1.0 / max(abs(det), 0.03);
  vSrc = p;
  gl_Position = vec4(land / ${FLOOR_EXT.toFixed(3)}, 0.0, 1.0);
}`;

const CAUSTIC_FRAG = `#version 300 es
precision highp float;
in vec2 vSrc;
in float vFlux;
out vec4 o;
void main() {
  // 石の輪が、太陽の側に影を落とす
  float inside = smoothstep(1.06, 0.98, length(vSrc));
  float shade = mix(0.42, 1.0, smoothstep(1.05, 0.72, length(vSrc + vec2(-0.05, 0.075))));
  o = vec4(vec3(vFlux * inside * shade), 1.0);
}`;

// 細い線がとぎれないよう、ごくわずかにならす。隣との中間を読むので、9回で 5×5 ぶんになる
const SOFTEN_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uRaw;
uniform float uStep;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uStep;
  float d = uStep * 1.15;
  float v = 4.0 * texture(uRaw, uv).r;
  v += 2.0 * (texture(uRaw, uv + vec2(d, 0.0)).r + texture(uRaw, uv - vec2(d, 0.0)).r + texture(uRaw, uv + vec2(0.0, d)).r + texture(uRaw, uv - vec2(0.0, d)).r);
  v += texture(uRaw, uv + vec2(d, d)).r + texture(uRaw, uv + vec2(-d, d)).r + texture(uRaw, uv + vec2(d, -d)).r + texture(uRaw, uv - vec2(d, d)).r;
  o = vec4(vec3(v / 16.0), 1.0);
}`;

// 底の砂と、輪の石の模様を1枚に焼く。r：底の明るさ、g：底の陰影、b：石の筋、a：石の粒
const BAKE_FRAG = `#version 300 es
precision highp float;
uniform float uSize;
out vec4 o;
float h21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 h22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p, int n) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < n; i++) {
    s += a * vn(p);
    p = mat2(1.62, 1.18, -1.18, 1.62) * p + 17.3;
    a *= 0.5;
  }
  return s;
}
// 砂の中の小さな石：格子ごとに1つ、向きと大きさの違う楕円。x：陰影、y：明るさ、z：覆う割合、w：石のそばの陰
vec4 stones(vec2 x, float seed, float keep) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float best = -1.0;
  vec4 out0 = vec4(0.0, 0.5, 0.0, 9.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 id = n + g + seed;
      if (h21(id + 5.1) > keep) continue;
      vec2 h = h22(id);
      vec2 c = g + 0.5 + (h - 0.5) * 0.74 - f;
      float a = h21(id + 2.3) * 6.2831;
      float ca = cos(a);
      float sa = sin(a);
      vec2 e = vec2(ca * c.x + sa * c.y, -sa * c.x + ca * c.y);
      float size = mix(0.26, 0.56, h21(id + 1.7));
      e /= size * vec2(1.0, mix(0.62, 0.92, h21(id + 8.4)));
      float d = length(e);
      out0.w = min(out0.w, d);
      if (d >= 1.0) continue;
      float dome = sqrt(1.0 - d * d);
      float z = dome * size + h.x * 0.2;
      if (z <= best) continue;
      best = z;
      vec2 nr = vec2(ca * e.x - sa * e.y, sa * e.x + ca * e.y);
      float lit = 0.62 + 0.46 * dot(nr, vec2(-0.55, 0.83));
      out0.x = lit * mix(0.5, 1.0, smoothstep(0.0, 0.42, dome));
      out0.y = h21(id + 3.3);
      out0.z = smoothstep(0.0, 0.18, dome);
    }
  }
  return out0;
}
void main() {
  vec2 p = (gl_FragCoord.xy / uSize * 2.0 - 1.0) * ${BAKE_EXT.toFixed(3)};
  // 底：細かい砂。泥の濃淡、かすかな風紋、砂粒、ときどき小さな石
  vec2 warp = vec2(fbm(p * 2.6, 3), fbm(p * 2.6 + 9.1, 3)) * 0.16;
  float silt = fbm(p * 4.6 + 3.0, 5);
  float grain = fbm(p * 62.0, 3);
  float speck = vn(p * 300.0) * 0.5 + vn(p * 130.0 + 9.0) * 0.5;
  float marks = sin((p.x * 0.55 + p.y * 0.83 + fbm(p * 1.5, 3) * 1.3) * 42.0) * 0.5 + 0.5;
  vec4 tiny = stones((p + warp) * 38.0, 13.0, 0.5 * smoothstep(0.3, 0.62, fbm(p * 3.4 + 2.0, 3)));
  float shade = 0.58 + (silt - 0.5) * 0.5 + (grain - 0.5) * 0.15 + (marks - 0.5) * 0.08 + (speck - 0.5) * 0.07;
  float toneV = silt * 0.8 + (grain - 0.5) * 0.16 + (speck - 0.5) * 0.1;
  shade *= mix(0.9, 1.0, smoothstep(1.0, 1.3, tiny.w));
  shade = mix(shade, tiny.x * 0.8, tiny.z * 0.3);
  toneV = mix(toneV, tiny.y, tiny.z * 0.18);
  // 石の輪：雲のような濃淡と、髪の毛ほどの細い筋。筋の太さは、傾きで割って揃える
  vec2 flow = p * 2.1 + vec2(fbm(p * 1.4, 4), fbm(p * 1.4 + 5.2, 4)) * 2.6;
  float f1 = fbm(flow, 5) - 0.5;
  float f2 = fbm(flow * 2.1 + 4.0, 5) - 0.5;
  float px = uSize / 2048.0;
  float line1 = smoothstep(2.6, 0.5, abs(f1) / max(fwidth(f1) * px, 1.0e-5));
  float line2 = smoothstep(1.8, 0.4, abs(f2) / max(fwidth(f2) * px, 1.0e-5));
  float where1 = smoothstep(0.42, 0.62, fbm(p * 1.6 + 31.0, 3));
  float where2 = smoothstep(0.46, 0.64, fbm(p * 2.3 + 47.0, 3));
  float cloud = fbm(p * 2.2 + 21.0, 5) * 0.72 + fbm(p * 9.0 + 3.0, 4) * 0.28;
  float strata = clamp(cloud * 0.9 + line1 * where1 * 0.3 + line2 * where2 * 0.17, 0.0, 1.0);
  float fine = fbm(p * 150.0, 2);
  float fleck = smoothstep(0.66, 0.74, vn(p * 210.0) * 0.6 + vn(p * 96.0 + 3.0) * 0.4);
  o = vec4(clamp(toneV, 0.0, 1.0), clamp(shade, 0.0, 1.0), strata, clamp(fine * 0.55 + fleck * 0.45, 0.0, 1.0));
}`;

const VIEW_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uH, uCaustic, uBake;
uniform vec2 uRes, uHSize;
uniform float uUnit, uTime, uHeart, uFlare, uLoose;
uniform vec3 uDeep, uShallow, uTint, uFloorA, uFloorB, uStone, uVein, uFleck, uLight, uEnvLow, uPage, uGlow, uHot, uCausticC, uShadowC;
uniform float uShadowA;
uniform int uDropN;
uniform vec4 uDrop[${MAX_DROPS}];
out vec4 fragOut;

const float CAM = ${CAM.toFixed(2)};
const float ROUT = ${R_OUT.toFixed(3)};
const float HALF = ${HALF.toFixed(4)};
const float DOMAIN = ${DOMAIN.toFixed(3)};
const float FE = ${FLOOR_EXT.toFixed(3)};
const float BE = ${BAKE_EXT.toFixed(3)};
const vec2 KEY = vec2(-0.55, 0.835);
const vec3 SUN = vec3(-0.215, 0.326, 0.92);

// B スプラインで読む。4K に広げても、傾きが角ばらない
vec4 cubic(sampler2D t, vec2 uv, vec2 size) {
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0 + 0.5) / size;
  vec2 h1 = (i + 1.5 + w3 / g1 + 0.5) / size;
  return g0.y * (g0.x * texture(t, vec2(h0.x, h0.y)) + g1.x * texture(t, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture(t, vec2(h0.x, h1.y)) + g1.x * texture(t, vec2(h1.x, h1.y)));
}

// 空：なだらかな明るさと、やわらかい大きな光。tight が大きいほど、光の縁がくっきりする
vec3 env(vec3 R, float width, float tight, float power) {
  float g = smoothstep(-0.7, 1.0, R.z * 0.3 + dot(R.xy, KEY) * 0.84);
  vec3 c = mix(uEnvLow * 0.55, uLight * 0.3, g * g);
  vec3 toKey = R - normalize(vec3(KEY * 0.8, 0.6));
  float k2 = dot(toKey, toKey) / (width * width);
  c += uLight * power * exp(-pow(k2, tight));
  // 反対側の、弱い照り返し
  vec3 toFill = R - normalize(vec3(0.64, -0.7, 0.32));
  c += uLight * power * 0.1 * exp(-pow(dot(toFill, toFill) / (width * width * 0.42), tight));
  return c;
}

// ハートの距離場。下は先 (0, 0) から接点 (0.5, 0.5) への辺、上は2つの円。切れ込みは (0, 1)
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  float along = p.x + p.y;
  if (along > 1.0) return length(p - vec2(0.25, 0.75)) - 0.35355;
  float toSide = length(p - vec2(0.5) * max(along, 0.0));
  float toNotch = length(p - vec2(0.0, 1.0));
  return min(toSide, toNotch) * sign(p.x - p.y);
}

// 底の光を集める形。m=0 で池いっぱいの円、m=1 でハート
// x：折り畳まれた輪郭の光、y：内を満たす光、z：外へにじむ光
vec4 heartField(vec2 q, float m) {
  vec2 c = q - vec2(0.0, -0.035);
  vec2 hp = c / 0.9 + vec2(0.0, 0.56);
  // 辺を、わずかにふくらませる。直線のままだと、記号に見えてしまう
  hp.x /= 1.0 + 0.085 * sin(3.14159 * clamp(hp.y, 0.0, 1.0));
  float dH = sdHeart(hp) * 0.9;
  float dC = length(c) - 1.3;
  float th = atan(c.y, c.x);
  float t = uTime;
  float wave = sin(th * 3.0 + t * 0.7) * 0.5 + sin(th * 5.0 - t * 0.43 + 1.3) * 0.3 + sin(th * 9.0 + t * 0.31 + 4.0) * 0.2;
  float d = mix(dC, dH, m);
  float loose = 2.0 * m * (1.0 - m) * 0.1 + uLoose * m * 0.075;
  d += wave * loose;
  float inside = -d;
  float aa = max(1.3 / uUnit, 0.0028);
  float edge = smoothstep(-aa, aa, inside);
  float dIn = max(inside, 0.0);
  // 外の縁は鋭く、内へなだらかに落ちる。本物の光の折り目の形
  float fold = edge * exp(-dIn / 0.085) / sqrt(dIn / 0.0075 + 0.34);
  // 輪郭に沿って編まれる、細い光の筋
  float strands = 0.0;
  for (int i = 1; i <= 3; i++) {
    float fi = float(i);
    float off = 0.017 * fi + 0.0105 * fi * sin(th * (4.0 + fi * 3.0) + t * (0.5 - 0.17 * fi) + fi * 2.1) + 0.006 * sin(th * (17.0 + fi * 5.0) - t * 0.9 + fi);
    strands += exp(-abs(dIn - off) / (0.0034 + 0.0017 * fi)) * (0.62 / fi) * (0.62 + 0.38 * sin(th * 7.0 + fi * 4.0 + t * 0.36));
  }
  fold += strands * edge;
  // ほどけるとき：輪郭がところどころ切れて、細い筋に分かれる
  if (uLoose > 0.001) {
    float brk = sin(th * 6.0 + t * 0.8 + sin(th * 2.0) * 2.0) * 0.5 + sin(th * 13.0 - t * 0.6 + 1.0) * 0.3 + sin(th * 23.0 + t * 0.4) * 0.2;
    fold *= mix(1.0, smoothstep(-0.25, 0.55, brk - (1.0 - m) * 0.5), uLoose);
  }
  float fill = edge * (0.006 + 0.06 * exp(-dIn / 0.07) + 0.022 * exp(-dIn / 0.24));
  float gap = min(inside, 0.0);
  float outer = (1.0 - edge) * (exp(gap / 0.01) * 0.62 + exp(gap / 0.055) * 0.16 + exp(gap / 0.2) * 0.03);
  return vec4(fold, fill, outer, edge);
}

float depthAt(float r) {
  return 0.14 + 0.42 * (1.0 - smoothstep(0.42, 1.04, r));
}

vec3 waterShade(vec2 p, float r, vec4 H) {
  vec2 grad = H.yz;
  vec2 rh = p / max(r, 1.0e-4);
  float e = max(1.0 - r, 0.0);
  grad += rh * 0.6 * exp(-e / 0.014); // 岸で、水がわずかに這い上がる
  vec3 N = normalize(vec3(-grad, 1.0));
  vec3 V = normalize(vec3(-p, CAM));
  vec3 R = reflect(-V, N);
  vec3 T = refract(-V, N, 0.7519);
  float D = depthAt(r);
  vec2 q = p + T.xy / -T.z * D;
  D = depthAt(length(q));
  q = p + T.xy / -T.z * D;
  float path = D / -T.z;
  float qr = length(q);

  // 底
  vec4 b = texture(uBake, q / (2.0 * BE) + 0.5);
  vec3 albedo = mix(uFloorA, uFloorB, smoothstep(0.22, 0.82, b.r)) * mix(0.3, 1.12, b.g);
  float wall = smoothstep(0.97, 1.05, qr);
  albedo = mix(albedo, uStone * 0.7 + uFloorA * 0.2, wall);

  // 底に落ちた光。傾きに応じて色がわずかに分かれる
  vec2 cuv = q / (2.0 * FE) + 0.5;
  vec2 sp = grad * 0.0075;
  float lit = textureLod(uCaustic, cuv, 0.25).r;
  vec3 cau = vec3(textureLod(uCaustic, cuv + sp, 0.25).r, lit, textureLod(uCaustic, cuv - sp, 0.25).r);
  // 明るいところは、線のまま細く。暗いところは、ほんのり残す
  cau = 0.06 * cau + 0.94 * cau * cau * 0.6;

  float m = uHeart;
  float w = smoothstep(0.0, 0.3, m) * mix(1.0, smoothstep(0.16, 0.86, m), uLoose);
  vec4 hf = heartField(q, m);
  // 輪郭の光は、本物の揺らぎの濃淡をそのまま運ぶ
  vec2 pull = q * 0.82 + vec2(0.0, 0.03);
  float shim = textureLod(uCaustic, pull / (2.0 * FE) + 0.5, 1.2).r;
  float strand = clamp(0.42 + 0.72 * shim, 0.3, 2.0);
  float flare = 1.0 + uFlare * 0.85;
  float core = hf.x * mix(1.0, strand, 0.5) * flare * w;
  float inner = hf.y * strand * flare * w;
  float halo = hf.z * flare * w;
  float within = hf.w * w;

  // 光が集まるぶん、まわりは静かに暗くなる
  // 輪郭の外から暗くなり、内は形ができてから色が変わる
  float keep = 1.0 - 0.84 * w * ((1.0 - hf.w) + hf.w * smoothstep(0.45, 0.95, m));
  vec3 floorLit = albedo * (uLight * 0.055 + uCausticC * cau * keep);
  float grainy = mix(0.55, 1.1, b.g);
  // ハートの中では、残った揺らぎも同じ色に染まる
  floorLit += uGlow * cau * within * smoothstep(0.35, 0.9, m) * 0.34 * grainy * flare;
  floorLit += uGlow * (core * 2.1 + inner * 1.5) * grainy;
  floorLit += uHot * core * core * core * 0.62 * grainy;
  floorLit += uGlow * halo * 0.9;

  // 滴の影
  for (int i = 0; i < uDropN; i++) {
    vec4 dp = uDrop[i];
    vec2 ds = q - (dp.xy + KEY * dp.z * 0.32);
    float sg = dp.w * (1.6 + dp.z * 1.5);
    float sa = 0.58 / (1.0 + dp.z * dp.z * 2.4);
    floorLit *= 1.0 - sa * exp(-dot(ds, ds) / (sg * sg));
  }

  // 水の色：通った長さのぶん吸われ、そのぶん水の色が足される
  vec3 trans = pow(uTint, vec3(path * 3.0));
  vec3 body = mix(uDeep, uShallow, smoothstep(0.36, 0.14, D));
  vec3 c = floorLit * trans + body * (1.0 - trans) * (0.38 + 0.26 * textureLod(uCaustic, cuv, 4.4).r * keep);
  // 水の中に漂う光
  c += uGlow * (inner * 0.3 + halo * 0.26);

  // 水面の反射。岸のそばでは石が映る
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.021 + 0.979 * pow(1.0 - ndv, 5.0);
  vec3 refl = env(R, 0.42, 1.2, 0.56);
  float toRim = length(p + R.xy * (0.12 / max(R.z, 0.1)));
  refl = mix(refl, uStone * 0.5 + uEnvLow * 0.25, smoothstep(0.985, 1.03, toRim));
  c = c * (1.0 - F) + refl * F;
  // 波の斜面：光のほうを向いた面は明るく、背を向けた面は暗い
  float relief = dot(-H.yz, KEY);
  c += uLight * max(relief, 0.0) * 0.065;
  c *= 1.0 - clamp(-relief * 0.75, 0.0, 0.5);
  // 太陽のきらめき：波の斜面で、一瞬だけ
  float sunDot = clamp(dot(R, SUN), 0.0, 1.0);
  c += uLight * pow(sunDot, 520.0) * 0.16;
  // 岸の際の細い陰
  c *= 1.0 - 0.45 * exp(-e / 0.006);
  return c;
}

vec3 stoneShade(vec2 p, float r) {
  vec4 b = texture(uBake, p / (2.0 * BE) + 0.5);
  float th = atan(p.y, p.x);
  vec2 rh = p / r;
  vec2 tang = vec2(-rh.y, rh.x);
  float t = clamp((r - 1.0) / (ROUT - 1.0), 0.0, 1.0);
  const float tc = 0.42;
  float u = t < tc ? (t - tc) / tc : (t - tc) / (1.0 - tc);
  float au = abs(u);
  float a = sign(u) * pow(au, 1.5) * 0.992;
  // 手で磨いた、ゆるいうねり。映り込みが生きて見える
  float roll = sin(th * 2.0 + 0.7) * 0.5 + sin(th * 5.0 + 2.1) * 0.32 + sin(th * 11.0 + 4.0) * 0.14;
  float sway = cos(th * 3.0 + 1.0) * 0.6 + cos(th * 7.0 + 3.0) * 0.3;
  vec2 tilt = rh * (a + roll * 0.03 * (1.0 - au)) + tang * sway * 0.034 * (1.0 - au);
  vec3 N = normalize(vec3(tilt, sqrt(max(1.0 - dot(tilt, tilt), 0.0004))));
  vec3 V = normalize(vec3(-p, CAM));
  vec3 R = reflect(-V, N);

  float wet = smoothstep(0.16, 0.0, t);
  vec3 albedo = uStone * mix(0.72, 1.28, smoothstep(0.3, 0.68, b.b));
  albedo = mix(albedo, uVein, smoothstep(0.74, 1.0, b.b) * 0.5);
  albedo = mix(albedo, uFleck, smoothstep(0.5, 0.66, b.a) * 0.34);
  albedo = mix(albedo, uVein, smoothstep(0.6, 0.72, b.a) * 0.13);
  albedo *= mix(1.0, 0.58, wet);

  float ao = 0.56 + 0.44 * smoothstep(0.0, 0.26, t);
  ao *= mix(1.0, 0.8, smoothstep(0.9, 1.0, t));
  vec3 Ld = vec3(KEY * 0.58, 0.81);
  float ndl = max(dot(N, Ld), 0.0);
  vec3 c = albedo * (uLight * 0.2 + uLight * 0.6 * ndl) * ao;

  // 磨いた面の映り込み
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float f0 = mix(0.05, 0.1, wet);
  float F = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
  // 上塗り：鏡のような映り込み。下塗り：少しだけ荒れた、広い光
  vec3 glossy = env(R, 0.17, 2.4, 17.0) + env(R, 0.5, 1.0, 1.5) * 0.75;
  // 外の斜面の低い向きには、まわりの地が映る
  glossy = mix(glossy, uPage * 0.34, smoothstep(0.34, -0.1, R.z) * smoothstep(0.0, 0.3, dot(R.xy, rh)));
  c = c * (1.0 - F) + glossy * F * ao;
  // 雲母の粒が、光の向きでだけ光る
  vec3 Hv = normalize(Ld + V);
  float mica = smoothstep(0.84, 0.97, b.a) * pow(max(dot(N, Hv), 0.0), 90.0);
  c += uLight * mica * 0.5;

  // 水の揺らぎが、内側の斜面へ映って踊る
  float toWater = smoothstep(tc + 0.14, 0.0, t);
  float dance = textureLod(uCaustic, (p * (1.0 - 0.14 * (1.0 + t))) / (2.0 * FE) + 0.5, 3.4).r;
  c += uCausticC * max(dance - 0.4, 0.0) * toWater * toWater * 0.06 * ao;
  // 灯ったハートの光が、斜面にほのかに届く
  float rise = max(dot(N, normalize(vec3(-p, 0.7))), 0.0);
  float reach = (uHeart * uHeart) * (1.0 + uFlare * 0.8);
  c += uGlow * albedo * rise * exp(-t / 0.3) * reach * 0.34;
  return c;
}

// 滴。色と覆う割合を返す
vec4 bead(vec2 p, vec4 d, float aa) {
  float k = CAM / (CAM - d.z);
  vec2 ctr = d.xy * k;
  float R = d.w * k;
  float l = length(p - ctr);
  // 目の近くでは、ぼけて見える
  float blur = clamp(d.z * 0.1, 0.0, 0.5) * R + aa;
  if (l > R + blur) return vec4(0.0);
  float cov = 1.0 - smoothstep(R - blur, R + blur, l);
  cov *= smoothstep(${DROP_Z.toFixed(2)}, ${(DROP_Z - 0.65).toFixed(2)}, d.z);
  vec2 q = (p - ctr) / R;
  float l2 = min(dot(q, q), 1.0);
  vec3 n = vec3(q, sqrt(1.0 - l2));
  vec3 V = normalize(vec3(-p, CAM - d.z));
  vec3 Rf = reflect(-V, n);
  // レンズ：下の景色が逆さに、小さく映る
  vec2 under = ctr - q * R * 1.8;
  float ur = length(under);
  float clit = textureLod(uCaustic, clamp(under / (2.0 * FE) + 0.5, 0.0, 1.0), 1.6).r;
  vec3 scene = uDeep * 0.8 + uFloorB * clit * clit * 0.16 + uGlow * uHeart * 0.05;
  scene = mix(scene, uStone * 0.7, smoothstep(0.96, 1.04, ur));
  // 球を通った光が、太陽と反対の内側に集まる
  float across = dot(q, -KEY);
  float pool = smoothstep(0.05, 0.95, across) * smoothstep(1.0, 0.72, sqrt(l2));
  scene += uLight * pool * pool * 0.36;
  // 縁は、まわりの暗さを曲げて映すので暗い
  scene *= mix(1.0, 0.42, smoothstep(0.62, 1.0, sqrt(l2)));
  float F = 0.02 + 0.98 * pow(1.0 - n.z, 5.0);
  vec3 c = scene * (1.0 - F) + env(Rf, 0.3, 1.4, 6.0) * F;
  float spec = pow(max(dot(n, normalize(vec3(KEY * 0.62, 0.78))), 0.0), 340.0);
  c += uLight * spec * 5.0;
  return vec4(c, cov);
}

vec3 knee(vec3 x) {
  const float a = 0.72;
  return mix(x, a + (1.0 - a) * (1.0 - exp(-(x - a) / (1.0 - a))), step(a, x));
}
vec3 srgbOf(vec3 x) {
  x = clamp(x, 0.0, 1.0);
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}
float ign(vec2 v) {
  return fract(52.9829189 * fract(dot(v, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * uRes) / uUnit;
  float r = length(p);
  float aa = 1.0 / uUnit;

  // 石の輪の外：地に落ちる影
  float sa = 0.0;
  if (r > ROUT - 0.02) {
    float wide = length(p - KEY * vec2(-0.075, -0.075)) - ROUT;
    float mid = length(p - KEY * vec2(-0.03, -0.03)) - ROUT;
    float contact = r - ROUT;
    float sh = 0.46 * exp(-max(wide, 0.0) / 0.085) + 0.5 * exp(-max(mid, 0.0) / 0.028) + 0.65 * exp(-max(contact, 0.0) / 0.009);
    vec2 toEdge = vec2(HALF) - abs(p);
    float fade = smoothstep(0.0, 0.14, min(toEdge.x, toEdge.y));
    sa = clamp(sh, 0.0, 1.0) * fade * uShadowA;
  }

  vec3 col = vec3(0.0);
  float cover = 0.0;
  if (r < ROUT + 2.0 * aa) {
    cover = 1.0 - smoothstep(ROUT - aa, ROUT + aa, r);
    if (r > 1.0 - 2.0 * aa) col = stoneShade(p, max(r, 1.0));
    if (r < 1.0 + 2.0 * aa) {
      vec4 H = cubic(uH, p / (2.0 * DOMAIN) + 0.5, uHSize);
      vec3 w = waterShade(p, min(r, 1.0), H);
      col = r < 1.0 - 2.0 * aa ? w : mix(w, col, smoothstep(1.0 - aa, 1.0 + aa, r));
    }
  }

  for (int i = 0; i < uDropN; i++) {
    vec4 bd = bead(p, uDrop[i], aa);
    if (bd.a > 0.0) {
      col = mix(col, bd.rgb, bd.a);
      cover = max(cover, bd.a);
    }
  }

  vec3 enc = srgbOf(knee(col));
  vec3 pm = mix(srgbOf(uShadowC) * sa, enc, cover);
  float alpha = mix(sa, 1.0, cover);
  float n = ign(frag) + ign(frag + 37.0) - 1.0;
  pm += n * 0.75 / 255.0 * clamp(alpha * 4.0, 0.0, 1.0);
  fragOut = vec4(clamp(pm, 0.0, alpha), alpha);
}`;

export function mount(root) {
  const cleanups = [];
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  const canvas = root.querySelector('.pond');
  const button = root.querySelector('.hit');
  const numEl = root.querySelector('[data-num]');
  const statusEl = root.querySelector('[data-status]');
  const probe = root.querySelector('.probe');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  let still = motionQuery.matches;

  // ---- 状態
  let pressed = button.getAttribute('aria-pressed') === 'true';
  let count = parseInt(numEl.textContent, 10) || 0;
  const heart = { raw: pressed ? 1 : 0, value: pressed ? 1 : 0, flare: 0, loose: 0, gatherAt: 0, want: pressed ? 1 : 0, wasFull: pressed };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, amp: 0, ampT: 0, oldX: 0, oldY: 0, oldAmp: 0, seen: false };
  let focusBump = 0;
  const flights = [];
  const sources = [];
  let calm = 0;
  let glassy = 0;
  let lastClick = -1e9;
  let burstAngle = 0;
  let burstLevel = 0;
  let clock = 0;
  let injectDt = 0;
  let accum = 0;
  // ページを開いた最初の一瞬だけ、ハートが灯っている。すぐにほどけて、ふつうの水面になる
  let introUntil = still || pressed ? 0 : 1.2;
  if (introUntil) {
    heart.raw = 1;
    heart.value = 1;
    heart.want = 1;
    heart.wasFull = true;
  }

  // ---- トークンを読む
  let motionMs = 240;
  const paint = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const pal = {};
  const readPixel = (css) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = css;
    paint.fillRect(0, 0, 1, 1);
    return paint.getImageData(0, 0, 1, 1).data;
  };
  const labOf = (style, name) => {
    probe.style.color = style.getPropertyValue(name).trim();
    const d = readPixel(getComputedStyle(probe).color);
    return rgbToOklab(d[0], d[1], d[2]);
  };
  const readPalette = () => {
    const style = getComputedStyle(root);
    const bg = labOf(style, '--_bg');
    const surface = labOf(style, '--_surface');
    const fg = labOf(style, '--_fg');
    const muted = labOf(style, '--_muted');
    const accent = labOf(style, '--_accent');
    const lighter = bg[0] >= fg[0] ? bg : fg;
    const darker = bg[0] >= fg[0] ? fg : bg;

    pal.light = tone(Math.max(lighter[0], 0.97), lighter[1] * 0.3, lighter[2] * 0.3);
    pal.page = oklabToLinear(bg[0], bg[1], bg[2]).map((v) => clamp(v));
    pal.envLow = tone(0.34, darker[1] * 0.4, darker[2] * 0.4);

    // 水：--_muted の色相。灰色に近ければ、少しだけ鮮やかさを足す
    const mc = Math.hypot(muted[1], muted[2]);
    const dir = mc > 0.004 ? [muted[1] / mc, muted[2] / mc] : [-0.5, -0.5];
    const chroma = Math.max(mc * 2.1, 0.07);
    const wa = dir[0] * chroma;
    const wb = dir[1] * chroma;
    pal.deep = tone(0.21, wa, wb);
    pal.shallow = tone(0.35, wa * 1.15, wb * 1.15);
    pal.tint = tone(0.86, wa * 0.42, wb * 0.42);

    // 底の砂：水の色相に、--_surface を少しだけ
    const fa = surface[1] * 0.2 + wa * 0.72;
    const fb = surface[2] * 0.2 + wb * 0.72;
    pal.floorA = tone(0.4, fa, fb);
    pal.floorB = tone(0.62, fa * 0.82, fb * 0.82);

    // 輪の石：--_surface そのもの
    const sc = oklabToLinear(surface[0], surface[1], surface[2]).map((v) => clamp(v));
    pal.stone = sc;
    pal.vein = tone(Math.min(surface[0] + 0.3, 0.96), surface[1] * 0.7, surface[2] * 0.7);
    pal.fleck = tone(Math.max(surface[0] - 0.16, 0.06), surface[1], surface[2]);

    // 光：--_accent の色相
    pal.glow = tone(clamp(accent[0], 0.6, 0.72), accent[1] * 1.12, accent[2] * 1.12);
    pal.hot = tone(0.96, accent[1] * 0.3, accent[2] * 0.3);
    const lightMix = 0.1;
    pal.caustic = pal.light.map((v, i) => mix(v, pal.glow[i], lightMix));

    // 影
    probe.style.boxShadow = style.getPropertyValue('--_shadow').trim();
    const shadow = getComputedStyle(probe).boxShadow;
    probe.style.boxShadow = '';
    if (shadow && shadow !== 'none') {
      const d = readPixel(`${shadow.split(')')[0]})`);
      pal.shadowC = [d[0], d[1], d[2]].map((v) => toLinear(v / 255));
      pal.shadowA = clamp((d[3] / 255) * 1.9, 0, 0.95);
    } else {
      pal.shadowC = pal.envLow;
      pal.shadowA = 0;
    }

    // 動きの速さ
    probe.style.transitionDuration = style.getPropertyValue('--_motion').trim();
    const motion = parseFloat(getComputedStyle(probe).transitionDuration);
    probe.style.transitionDuration = '';
    motionMs = Number.isFinite(motion) && motion > 0 ? motion * 1000 : 240;
  };

  // ---- WebGL
  let gl = null;
  let ready = false;
  let softwareGl = false;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch {
    gl = null;
  }
  let vao = null;
  let progInit = null;
  let progSimA = null;
  let progSimB = null;
  let progCompose = null;
  let progCaustic = null;
  let progBake = null;
  let progSoften = null;
  let progView = null;
  const state = [null, null];
  const stateFb = [null, null];
  let cur = 0;
  let texH = null;
  let fbH = null;
  let texC = null;
  let fbC = null;
  let texRaw = null;
  let fbRaw = null;
  let fbMs = null;
  let rbMs = null;
  let texBake = null;
  let meshIdx = null;
  let meshCount = 0;
  let meshGrid = 0;
  let causticSize = 0;
  let bakeSize = 0;
  let waveTable = null;

  const compile = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const link = (vs, fs) => {
    const p = gl.createProgram();
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  };
  const makeTarget = (internal, size, filter, mips = false) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, mips ? Math.floor(Math.log2(size)) + 1 : 1, internal, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    return { t, fb, ok };
  };
  const bindTex = (unit, t) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  };

  // 風のさざ波の表：波数 x, y、角速度、位相
  const buildWaves = () => {
    const r = seeded(4211);
    const data = new Float32Array(WAVES * 4);
    for (let i = 0; i < WAVES; i++) {
      const a = i * 2.39996 + (r() - 0.5) * 0.5;
      const k = i < 2 ? mix(8, 11, r()) : mix(21, 54, Math.pow(r(), 1.3));
      data[i * 4] = Math.cos(a) * k;
      data[i * 4 + 1] = Math.sin(a) * k;
      data[i * 4 + 2] = Math.sqrt(0.62 * k) * (r() < 0.5 ? 1 : -1) * mix(0.8, 1.2, r());
      data[i * 4 + 3] = r() * 6.2831;
    }
    return data;
  };

  const setupGl = () => {
    if (!gl) return false;
    try {
      const fast = gl.getExtension('EXT_color_buffer_float');
      const half = gl.getExtension('EXT_color_buffer_half_float');
      if (!fast && !half) return false;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      softwareGl = /swiftshader|llvmpipe|software/i.test(name);

      progInit = link(VERT, INIT_FRAG);
      progSimA = link(VERT, simFrag(false));
      progSimB = link(VERT, simFrag(true));
      progCompose = link(VERT, COMPOSE_FRAG);
      progCaustic = link(CAUSTIC_VERT, CAUSTIC_FRAG);
      progBake = link(VERT, BAKE_FRAG);
      progSoften = link(VERT, SOFTEN_FRAG);
      progView = link(VERT, VIEW_FRAG);

      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      // 波の計算は 32 ビットが望ましい。描けない機械では 16 ビットにする
      let internal = fast ? gl.RGBA32F : gl.RGBA16F;
      for (let i = 0; i < 2; i++) {
        let made = makeTarget(internal, SIM_N, gl.NEAREST);
        if (!made.ok && internal !== gl.RGBA16F) {
          gl.deleteTexture(made.t);
          gl.deleteFramebuffer(made.fb);
          internal = gl.RGBA16F;
          made = makeTarget(internal, SIM_N, gl.NEAREST);
        }
        if (!made.ok) return false;
        state[i] = made.t;
        stateFb[i] = made.fb;
      }
      const hTarget = makeTarget(gl.RGBA16F, SIM_N, gl.LINEAR);
      if (!hTarget.ok) return false;
      texH = hTarget.t;
      fbH = hTarget.fb;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // 水のある範囲を書き込む
      gl.useProgram(progInit.p);
      gl.uniform1f(progInit.u.uDx, (2 * DOMAIN) / SIM_N);
      gl.viewport(0, 0, SIM_N, SIM_N);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, stateFb[i]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      waveTable = waveTable || buildWaves();
      meshGrid = 0;
      causticSize = 0;
      bakeSize = 0;
      return true;
    } catch (error) {
      console.warn('like-pond: WebGL の用意ができないので、静かな絵にする', error);
      return false;
    }
  };

  // 網：大きく見せるほど細かくする
  const setupMesh = (grid) => {
    if (grid === meshGrid) return;
    if (meshIdx) gl.deleteBuffer(meshIdx);
    const row = grid + 1;
    const data = new Uint32Array(grid * grid * 6);
    let at = 0;
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const a = j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        // 向きを交互にして、斜めの向きの癖を消す
        if ((i + j) & 1) {
          data[at++] = a;
          data[at++] = b;
          data[at++] = d;
          data[at++] = a;
          data[at++] = d;
          data[at++] = c;
        } else {
          data[at++] = a;
          data[at++] = b;
          data[at++] = c;
          data[at++] = b;
          data[at++] = d;
          data[at++] = c;
        }
      }
    }
    meshIdx = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    meshCount = data.length;
    meshGrid = grid;
  };

  const setupCaustic = (size) => {
    if (size === causticSize) return;
    for (const t of [texC, texRaw]) if (t) gl.deleteTexture(t);
    for (const f of [fbC, fbRaw, fbMs]) if (f) gl.deleteFramebuffer(f);
    if (rbMs) gl.deleteRenderbuffer(rbMs);
    fbMs = null;
    rbMs = null;
    const raw = makeTarget(gl.RGBA16F, size, gl.LINEAR);
    texRaw = raw.t;
    fbRaw = raw.fb;
    const made = makeTarget(gl.RGBA16F, size, gl.LINEAR, true);
    texC = made.t;
    fbC = made.fb;
    // 細い光の線がとぎれないよう、できれば複数の点で測る
    const samples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    const most = samples && samples.length ? samples[0] : 0;
    const want = Math.min(most, 4);
    if (want > 1 && !softwareGl) {
      rbMs = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rbMs);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, want, gl.RGBA16F, size, size);
      fbMs = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbMs);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rbMs);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fbMs);
        gl.deleteRenderbuffer(rbMs);
        fbMs = null;
        rbMs = null;
      }
    }
    causticSize = size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const setupBake = (size) => {
    if (size <= bakeSize) return;
    if (texBake) gl.deleteTexture(texBake);
    const made = makeTarget(gl.RGBA8, size, gl.LINEAR, true);
    texBake = made.t;
    gl.useProgram(progBake.p);
    gl.uniform1f(progBake.u.uSize, size);
    gl.viewport(0, 0, size, size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, made.fb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(made.fb);
    gl.bindTexture(gl.TEXTURE_2D, texBake);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    bakeSize = size;
  };

  ready = setupGl();
  if (!ready) root.setAttribute('data-gl', 'off');

  // ---- 大きさ
  const shape = { size: 1, unit: 1, cssUnit: 1 };
  let renderScale = 1;
  const measure = () => {
    const box = canvas.getBoundingClientRect();
    const css = Math.max(box.width, 1);
    const dpr = Math.min(2, devicePixelRatio || 1) * renderScale;
    const size = Math.max(2, Math.min(3840, Math.round(css * dpr)));
    shape.cssUnit = css / 2 / HALF;
    shape.unit = size / 2 / HALF;
    if (size !== shape.size || canvas.width !== size) {
      shape.size = size;
      canvas.width = size;
      canvas.height = size;
    }
    if (ready) {
      const tier = size > 2000 ? 3 : size > 1200 ? 2 : size > 760 ? 1 : 0;
      setupMesh([200, 256, 384, 480][tier]);
      setupCaustic([768, 1024, 1536, 2048][tier]);
      setupBake([1024, 1536, 2048, 2048][tier]);
    }
  };

  // ---- 波を起こす
  const addSource = (x, y, amp, sigma, f0, f1, tau) => {
    if (sources.length >= MAX_SOURCES) sources.shift();
    sources.push({ x, y, amp, sigma, f0, f1, tau, t: 0, phase: 0 });
  };

  const launchDrop = (x, y) => {
    if (flights.length >= MAX_DROPS) {
      const small = flights.findIndex((d) => d.kind !== 0);
      flights.splice(small >= 0 ? small : 0, 1);
    }
    flights.push({ x, y, z: DROP_Z, vx: 0, vy: 0, vz: 0, r: 0.052, kind: 0 });
  };

  const impact = (d) => {
    if (d.kind === 0) {
      addSource(d.x, d.y, 0.00125, 0.052, 8.2, 4.8, 0.24);
      // はね返る水の柱と、小さな粒
      const r = seeded(Math.floor(d.x * 9973 + d.y * 7919 + clock * 131));
      const n = 3 + Math.floor(r() * 2);
      if (flights.length + n + 1 > MAX_DROPS) return;
      flights.push({ x: d.x, y: d.y, z: 0.001, vx: 0, vy: 0, vz: 6.3, r: 0.02, kind: 1, wait: 0.12 });
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const s = mix(0.8, 1.5, r());
        flights.push({ x: d.x, y: d.y, z: 0.001, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: mix(3.0, 4.4, r()), r: mix(0.006, 0.0105, r()), kind: 2, wait: 0.012 });
      }
    } else if (d.kind === 1) {
      addSource(d.x, d.y, 0.00062, 0.03, 11, 7, 0.13);
    } else {
      addSource(d.x, d.y, 0.00024, 0.016, 15, 11, 0.07);
    }
  };

  // ---- 数の表示。動きは毎フレームの計算で進める（止まっている間は進まない）
  const digitMoves = [];
  const makeDigit = (ch) => {
    const d = document.createElement('span');
    d.className = 'd';
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = ch;
    d.append(v);
    return d;
  };
  const moveDigit = (el, from, to, delay, drop) => {
    digitMoves.push({ el, from, to, t: -delay, dur: (motionMs * 2.4) / 1000, drop });
    el.style.transform = `translateY(${from}em)`;
    el.style.opacity = from === 0 ? '1' : '0';
  };
  const runDigits = (dt) => {
    for (let i = digitMoves.length - 1; i >= 0; i--) {
      const m = digitMoves[i];
      m.t += dt;
      const u = clamp(m.t / m.dur);
      const e = 1 - Math.pow(1 - u, 3);
      const y = mix(m.from, m.to, e);
      m.el.style.transform = `translateY(${y.toFixed(4)}em)`;
      m.el.style.opacity = (m.to === 0 ? e : 1 - e).toFixed(3);
      if (u >= 1) {
        digitMoves.splice(i, 1);
        if (m.drop) m.el.remove();
        else {
          m.el.style.transform = '';
          m.el.style.opacity = '';
        }
      }
    }
  };
  const setDigits = (value, delay) => {
    const next = String(value);
    const cells = [...numEl.querySelectorAll('.d')];
    if (cells.length !== next.length) {
      digitMoves.length = 0;
      numEl.replaceChildren(...[...next].map(makeDigit));
      return;
    }
    cells.forEach((cell, i) => {
      const v = cell.querySelector('.v');
      if (v.textContent === next[i]) return;
      const old = v.textContent;
      v.textContent = next[i];
      if (still || !ready) return;
      for (let j = digitMoves.length - 1; j >= 0; j--) {
        if (digitMoves[j].el.parentNode === cell) digitMoves.splice(j, 1);
      }
      cell.querySelector('.o')?.remove();
      const out = document.createElement('span');
      out.className = 'o';
      out.textContent = old;
      cell.append(out);
      const up = pressed ? -1 : 1;
      moveDigit(out, 0, up * 0.62, delay / 1000, true);
      moveDigit(v, -up * 0.62, 0, delay / 1000, false);
    });
  };
  numEl.replaceChildren(...[...String(count)].map(makeDigit));

  const reflectState = (delay) => {
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    const label = `いいね ${count}件`;
    button.setAttribute('aria-label', label);
    statusEl.textContent = label;
    setDigits(count, delay);
  };

  // ---- 押す
  const toPond = (clientX, clientY) => {
    const b = canvas.getBoundingClientRect();
    return [(clientX - (b.left + b.width / 2)) / shape.cssUnit, -(clientY - (b.top + b.height / 2)) / shape.cssUnit];
  };

  on(button, 'click', (event) => {
    const now = performance.now();
    const burst = now - lastClick < BURST_MS;
    lastClick = now;
    pressed = !pressed;
    count += pressed ? 1 : -1;
    if (still || !ready) {
      heart.raw = pressed ? 1 : 0;
      heart.value = heart.raw;
      heart.want = heart.raw;
      reflectState(0);
      wake();
      return;
    }
    reflectState(pressed ? FALL * 1000 : 0);

    if (pressed || burst) {
      // 落ちる場所：カーソルの下。連打では、少しずつ場所を散らす
      burstLevel = burst ? Math.min(burstLevel + 1, 6) : 0;
      let x = 0;
      let y = 0.02;
      if (event.detail > 0 && (event.clientX || event.clientY)) {
        const at = toPond(event.clientX, event.clientY);
        const len = Math.hypot(at[0], at[1]);
        const k = len > 0.82 ? 0.82 / len : 1;
        x = at[0] * k * 0.72;
        y = at[1] * k * 0.72;
      }
      burstAngle += 2.39996;
      const spread = burstLevel > 0 ? 0.2 + burstLevel * 0.075 : 0;
      x += Math.cos(burstAngle) * spread;
      y += Math.sin(burstAngle) * spread;
      const len = Math.hypot(x, y);
      if (len > 0.84) {
        x *= 0.84 / len;
        y *= 0.84 / len;
      }
      launchDrop(x, y);
      calm = 0;
    }
    if (pressed) {
      heart.gatherAt = now + FALL * 1000;
    } else {
      heart.want = 0;
      heart.wasFull = false;
      if (!burst) {
        calm = 1;
        glassy = 1;
      }
    }
    wake();
  });

  // カーソル：近づくと、水面がわずかに盛り上がる
  const BUMP_AMP = 0.026;
  const BUMP_SIG = 0.3;
  const trackPointer = (event) => {
    const at = toPond(event.clientX, event.clientY);
    const r = Math.hypot(at[0], at[1]);
    const k = r > 0.84 ? 0.84 / r : 1;
    pointer.tx = at[0] * k;
    pointer.ty = at[1] * k;
    if (!pointer.seen) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
      pointer.oldX = pointer.x;
      pointer.oldY = pointer.y;
      pointer.seen = true;
    }
    pointer.ampT = BUMP_AMP * smoothstep(1.66, 1.02, r);
    if (still) return;
    wake();
  };
  on(root, 'pointermove', trackPointer);
  on(root, 'pointerdown', trackPointer);
  on(root, 'pointerleave', () => {
    pointer.ampT = 0;
    pointer.seen = pointer.amp > 0.0004;
  });
  on(button, 'focus', () => {
    focusBump = button.matches(':focus-visible') ? 1 : 0;
    wake();
  });
  on(button, 'blur', () => {
    focusBump = 0;
    wake();
  });

  // ---- 1コマの計算
  const advance = (dt, now) => {
    clock += dt;
    runDigits(dt);

    // ハート
    if (introUntil && clock >= introUntil) {
      introUntil = 0;
      if (!pressed) {
        heart.want = 0;
        heart.wasFull = false;
      }
    }
    if (pressed && heart.gatherAt && now >= heart.gatherAt) {
      heart.want = 1;
      heart.gatherAt = 0;
    }
    const gather = clamp((motionMs * 5.6) / 1000, 0.7, 2.2);
    const undo = clamp((motionMs * 6.2) / 1000, 0.8, 2.4);
    if (heart.raw < heart.want) heart.raw = Math.min(heart.want, heart.raw + dt / gather);
    else if (heart.raw > heart.want) heart.raw = Math.max(heart.want, heart.raw - dt / undo);
    heart.value = heart.want > 0.5 ? smootherstep(heart.raw) : 1 - Math.pow(1 - heart.raw, 1.7) * (1 + 0.7 * heart.raw);
    heart.value = clamp(heart.value);
    if (heart.raw >= 1 && !heart.wasFull) {
      heart.wasFull = true;
      heart.flare = 1;
    }
    heart.flare *= Math.exp(-dt / 0.55);
    const looseWant = heart.want < 0.5 && heart.raw > 0 ? 1 : 0;
    heart.loose += (looseWant - heart.loose) * (1 - Math.exp(-dt * 5));

    // 静まる
    calm = Math.max(0, calm - dt / 1.5);
    glassy = Math.max(0, glassy - dt / 4);

    // カーソル
    pointer.oldX = pointer.x;
    pointer.oldY = pointer.y;
    pointer.oldAmp = pointer.amp;
    const followed = 1 - Math.exp(-dt * 8.5);
    const wantAmp = Math.max(pointer.ampT, focusBump ? BUMP_AMP * 0.6 : 0);
    const wantX = pointer.ampT > 0 ? pointer.tx : focusBump ? 0 : pointer.x;
    const wantY = pointer.ampT > 0 ? pointer.ty : focusBump ? 0 : pointer.y;
    pointer.x += (wantX - pointer.x) * followed;
    pointer.y += (wantY - pointer.y) * followed;
    pointer.amp += (wantAmp - pointer.amp) * (1 - Math.exp(-dt * 4.5));

    // 宙の滴
    for (let i = flights.length - 1; i >= 0; i--) {
      const d = flights[i];
      if (d.wait > 0) {
        d.wait -= dt;
        continue;
      }
      d.vz -= GRAVITY * dt;
      d.z += d.vz * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.z <= 0 && d.vz < 0) {
        flights.splice(i, 1);
        impact(d);
      }
    }
  };

  const dropData = new Float32Array(MAX_DROPS * 4);
  const srcData = new Float32Array(MAX_SOURCES * 4);
  const packSources = (dt) => {
    let n = 0;
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i];
      s.t += dt;
      if (s.t > s.tau * 5) {
        sources.splice(i, 1);
        continue;
      }
    }
    for (const s of sources) {
      const u = clamp(s.t / (s.tau * 2.5));
      const f = mix(s.f0, s.f1, u);
      s.phase += 2 * Math.PI * f * dt;
      const a = -Math.sin(s.phase + 0.5) * Math.exp(-s.t / s.tau) * s.amp * (dt * 60);
      srcData[n * 4] = s.x;
      srcData[n * 4 + 1] = s.y;
      srcData[n * 4 + 2] = a;
      srcData[n * 4 + 3] = s.sigma;
      n += 1;
    }
    return n;
  };

  const simulate = (dt) => {
    accum += dt;
    injectDt += dt;
    let n = Math.floor(accum / STEP);
    accum -= n * STEP;
    if (n > MAX_STEPS) {
      n = MAX_STEPS;
      accum = 0;
    }
    if (n === 0) return;
    const dx = (2 * DOMAIN) / SIM_N;
    const c = (WAVE_SPEED * STEP) / dx;
    const c2 = c * c;
    const damp = mix(0.9993, 0.986, calm * calm);
    gl.viewport(0, 0, SIM_N, SIM_N);
    gl.disable(gl.BLEND);
    for (let i = 0; i < n; i++) {
      const prog = i === 0 ? progSimB : progSimA;
      gl.useProgram(prog.p);
      gl.uniform1i(prog.u.uState, 0);
      gl.uniform1f(prog.u.uC2, c2);
      gl.uniform1f(prog.u.uNu, 0.014);
      gl.uniform1f(prog.u.uDamp, damp);
      gl.uniform1f(prog.u.uDx, dx);
      if (i === 0) {
        const count2 = packSources(injectDt);
        injectDt = 0;
        gl.uniform1i(prog.u.uSrcN, count2);
        if (count2 > 0) gl.uniform4fv(prog.u.uSrc, srcData);
        gl.uniform4f(prog.u.uBumpNow, pointer.x, pointer.y, pointer.amp, BUMP_SIG);
        gl.uniform4f(prog.u.uBumpOld, pointer.oldX, pointer.oldY, pointer.oldAmp, BUMP_SIG);
      }
      bindTex(0, state[cur]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFb[1 - cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = 1 - cur;
    }
  };

  const compose = () => {
    gl.useProgram(progCompose.p);
    gl.uniform1i(progCompose.u.uState, 0);
    gl.uniform1f(progCompose.u.uDx, (2 * DOMAIN) / SIM_N);
    gl.uniform1f(progCompose.u.uTime, clock);
    gl.uniform1f(progCompose.u.uBreeze, mix(1, 0.62, smoothstep(0, 0.6, glassy)));
    gl.uniform4f(progCompose.u.uBump, pointer.x, pointer.y, pointer.amp, BUMP_SIG);
    gl.uniform4fv(progCompose.u.uWave, waveTable);
    bindTex(0, state[cur]);
    gl.viewport(0, 0, SIM_N, SIM_N);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const causticPass = () => {
    gl.useProgram(progCaustic.p);
    gl.uniform1i(progCaustic.u.uH, 0);
    gl.uniform1i(progCaustic.u.uGrid, meshGrid);
    gl.uniform1f(progCaustic.u.uOptic, 2.2);
    bindTex(0, texH);
    gl.viewport(0, 0, causticSize, causticSize);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbMs || fbRaw);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, meshCount, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND);
    if (fbMs) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbMs);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbRaw);
      gl.blitFramebuffer(0, 0, causticSize, causticSize, 0, 0, causticSize, causticSize, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    gl.useProgram(progSoften.p);
    gl.uniform1i(progSoften.u.uRaw, 0);
    gl.uniform1f(progSoften.u.uStep, 1 / causticSize);
    bindTex(0, texRaw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbC);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bindTex(0, texC);
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  const setVec3 = (u, name, v) => gl.uniform3f(u[name], v[0], v[1], v[2]);
  const viewPass = () => {
    const { p, u } = progView;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, shape.size, shape.size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    bindTex(0, texH);
    bindTex(1, texC);
    bindTex(2, texBake);
    gl.uniform1i(u.uH, 0);
    gl.uniform1i(u.uCaustic, 1);
    gl.uniform1i(u.uBake, 2);
    gl.uniform2f(u.uRes, shape.size, shape.size);
    gl.uniform2f(u.uHSize, SIM_N, SIM_N);
    gl.uniform1f(u.uUnit, shape.unit);
    gl.uniform1f(u.uTime, clock);
    gl.uniform1f(u.uHeart, heart.value);
    gl.uniform1f(u.uFlare, heart.flare);
    gl.uniform1f(u.uLoose, heart.loose);
    setVec3(u, 'uDeep', pal.deep);
    setVec3(u, 'uShallow', pal.shallow);
    setVec3(u, 'uTint', pal.tint);
    setVec3(u, 'uFloorA', pal.floorA);
    setVec3(u, 'uFloorB', pal.floorB);
    setVec3(u, 'uStone', pal.stone);
    setVec3(u, 'uVein', pal.vein);
    setVec3(u, 'uFleck', pal.fleck);
    setVec3(u, 'uLight', pal.light);
    setVec3(u, 'uEnvLow', pal.envLow);
    setVec3(u, 'uPage', pal.page);
    setVec3(u, 'uGlow', pal.glow);
    setVec3(u, 'uHot', pal.hot);
    setVec3(u, 'uCausticC', pal.caustic);
    setVec3(u, 'uShadowC', pal.shadowC);
    gl.uniform1f(u.uShadowA, pal.shadowA);
    let n = 0;
    for (const d of flights) {
      if (d.wait > 0 || n >= MAX_DROPS) continue;
      dropData[n * 4] = d.x;
      dropData[n * 4 + 1] = d.y;
      dropData[n * 4 + 2] = Math.max(d.z, 0);
      dropData[n * 4 + 3] = d.r;
      n += 1;
    }
    gl.uniform1i(u.uDropN, n);
    if (n > 0) gl.uniform4fv(u.uDrop, dropData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // ---- 描く
  let raf = 0;
  let visible = true;
  let pageShown = !root.ownerDocument.hidden;
  let last = performance.now();
  let slow = 0;

  const paintAll = () => {
    gl.bindVertexArray(vao);
    compose();
    causticPass();
    viewPass();
  };

  const tick = () => {
    raf = 0;
    if (!visible || !pageShown || !ready) return;
    const now = performance.now();
    const wall = now - last;
    const dt = Math.min(0.05, wall / 1000);
    last = now;
    if (still) {
      paintAll();
      return;
    }
    advance(dt, now);
    gl.bindVertexArray(vao);
    simulate(dt);
    paintAll();
    // 重い機械では、絵の細かさを下げて 60fps を守る
    if (!softwareGl && wall < 200) {
      slow = wall > 21 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 36 && renderScale > 0.55) {
        renderScale = Math.max(0.55, renderScale - 0.15);
        slow = 0;
        measure();
      }
    }
    raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (raf || !visible || !pageShown || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  // ---- 見えていないときは止める
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(root);
  on(root.ownerDocument, 'visibilitychange', () => {
    pageShown = !root.ownerDocument.hidden;
    if (pageShown) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });

  const ro = new ResizeObserver(() => {
    measure();
    wake();
  });
  ro.observe(root);

  on(motionQuery, 'change', () => {
    still = motionQuery.matches;
    if (still) {
      flights.length = 0;
      sources.length = 0;
      introUntil = 0;
      heart.raw = pressed ? 1 : 0;
      heart.want = heart.raw;
      heart.value = heart.raw;
      heart.flare = 0;
      heart.loose = 0;
      pointer.amp = 0;
      pointer.ampT = 0;
      if (ready) {
        // 波を消して、凪の絵にする
        gl.useProgram(progInit.p);
        gl.uniform1f(progInit.u.uDx, (2 * DOMAIN) / SIM_N);
        gl.viewport(0, 0, SIM_N, SIM_N);
        gl.bindVertexArray(vao);
        for (let i = 0; i < 2; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, stateFb[i]);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
    }
    wake();
  });
  on(schemeQuery, 'change', () => {
    readPalette();
    wake();
  });

  const releaseGl = () => {
    if (!gl) return;
    for (const prog of [progInit, progSimA, progSimB, progCompose, progCaustic, progBake, progSoften, progView]) {
      if (prog) gl.deleteProgram(prog.p);
    }
    for (const t of [state[0], state[1], texH, texC, texRaw, texBake]) if (t) gl.deleteTexture(t);
    for (const f of [stateFb[0], stateFb[1], fbH, fbC, fbRaw, fbMs]) if (f) gl.deleteFramebuffer(f);
    if (rbMs) gl.deleteRenderbuffer(rbMs);
    if (meshIdx) gl.deleteBuffer(meshIdx);
    if (vao) gl.deleteVertexArray(vao);
    state[0] = state[1] = null;
    stateFb[0] = stateFb[1] = null;
    texH = fbH = texC = fbC = texRaw = fbRaw = fbMs = rbMs = texBake = meshIdx = vao = null;
  };

  on(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  on(canvas, 'webglcontextrestored', () => {
    ready = setupGl();
    if (ready) {
      measure();
      root.removeAttribute('data-gl');
      wake();
    } else {
      root.setAttribute('data-gl', 'off');
    }
  });

  // ---- 組み立て
  readPalette();
  measure();
  if (ready) {
    // 最初の絵を、はじめのフレームまでに用意する
    gl.bindVertexArray(vao);
    compose();
    causticPass();
    viewPass();
  }
  wake();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    visible = false;
    ready = false;
    io.disconnect();
    ro.disconnect();
    for (const off of cleanups) off();
    digitMoves.length = 0;
    if (gl) {
      releaseGl();
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  };
}
