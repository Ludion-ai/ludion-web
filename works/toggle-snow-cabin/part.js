/* UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT) */
/* Remixed by Claude — 雪の夜の山小屋 */
// part.js — ESモジュール。rootの中だけを触る
// 山小屋の灯りのスイッチ：スイッチのレールの中に、雪の夜のピクセルの世界があり、丸太の小屋に住人が1人暮らしている。
//
// 世界：低い解像度で、24色の番号だけで描く。天気の変化はディザの置き換えで行い、中間色を作らない。
// 外側：なめらかな殻、窓の奥行き、液体のレンズを WebGL で描く。ピクセルは常に整数倍のまま写す。
// 灯り：世界の光る画素をぼかした「光の場」を作り、ガラスと外の面を照らす。人影が窓を横切れば、外の光も変わる。
// 物語：左端は、灯りを消した吹雪の夜。右へ動かすと、住人が起き、ろうそく、暖炉、軒の灯りの順にともり、吹雪がおさまる。
//       右端にとどまると、雪は小降りになり、雲が切れて月がのぼる。住人は外へ出て、空を見上げる。
// 色は JS に書かない。--_bg、--_surface、--_fg、--_muted、--_accent、--_wood の色相を、決めた明るさで並べて作る。

const CORE_W = 192; // 景色の中心の幅。窓が広いぶんは、両わきへ広がる
const CORE_H = 112;
const HORIZON = 82;
const MARGIN = 14; // レンズが窓の外を覗いてもよいよう、世界を少し広く描く
const WORLD_HZ = 30;
const WORLD_SLACK = 0.004; // 画面の更新の時刻は揺れる。この秒数まで足りなくても、次のコマを出す
const PILL_RATIO = 1.85; // 縦 : 横
const T_DARK = 0; // 左端：灯りを消した、吹雪の夜
const T_LIT = 1; // 右端：灯りがともった夜
const T_CLEAR = 2; // 右端にとどまった先：雪がやみ、月の出た夜
const CLEAR_CREEP = 26; // 右端に着いてから、月がのぼりきるまでの秒数の目安
const HOME_X = 73; // 戸口
const GAZE_X = 123; // 住人が空を見上げる場所

// ---- パレット：6つのトークン × 4つの明るさ = 24色
const RAMPS = [
  ['bg', [0.74, 0.83, 0.91, 0.975]],
  ['surface', [0.16, 0.23, 0.31, 0.42]],
  ['fg', [0.14, 0.19, 0.25, 0.32]],
  ['muted', [0.38, 0.48, 0.58, 0.69]],
  ['accent', [0.52, 0.67, 0.8, 0.91]],
  ['wood', [0.2, 0.27, 0.35, 0.45]],
];
const C0 = 0, C1 = 1, C2 = 2, C3 = 3;
const G0 = 4, G1 = 5, G2 = 6, G3 = 7;
const I0 = 8, I1 = 9, I2 = 10, I3 = 11;
const U0 = 12, U1 = 13, U2 = 14, U3 = 15;
const A0 = 16, A1 = 17, A2 = 18, A3 = 19;
const W0 = 20, W1 = 21, W2 = 22, W3 = 23;

// ---- 材質：[吹雪, 雪の夜, 月夜, 灯りに照らされたとき] のパレット番号
const MATS = [
  ['SKY', I0, I0, I0, I0],
  ['MTN', I2, I3, U0, U0],
  ['MTN_SNOW', I3, U1, U3, U3],
  ['MTN_SNOW_SH', I2, U0, U1, U1],
  ['FOREST', I1, I0, I0, I0],
  ['FOREST_LT', I1, I1, G1, G1],
  ['FOREST_SNOW', I2, I3, U0, U0],
  ['SNOW', U1, U2, U3, A1],
  ['SNOW_SH', U0, U1, U2, A0],
  ['SNOW_HI', U2, U3, C1, A2],
  ['PATH', U0, U1, U2, A0],
  ['PATH_DK', I3, U0, U1, W3],
  ['ROOF_SNOW', U2, U3, C0, A2],
  ['ROOF_SNOW_SH', U1, U2, U3, A1],
  ['ROOF_SNOW_HI', U3, C0, C2, A3],
  ['ICE', U2, U3, C1, A3],
  ['WOOD', W0, W1, W2, A0],
  ['WOOD_LT', W1, W2, W3, A1],
  ['WOOD_DK', I1, W0, W0, W3],
  ['LOG_END', W1, W3, W3, A1],
  ['STONE', I2, I3, U0, A0],
  ['STONE_LT', I3, U0, U1, A1],
  ['BARK', I1, W0, W1, W3],
  ['BARK_LT', W0, W1, W2, A0],
  ['LEAF0', I0, G0, G1, G2],
  ['LEAF1', I1, G1, G2, G3],
  ['LEAF2', G1, G2, G3, A0],
  ['GLASS', I0, I0, I1, I1],
  ['GLASS_HI', I2, I2, I3, I3],
  ['ROOM', W2, W2, W2, W2],
  ['SKIN', U3, A2, A3, A3],
  ['HAIR', I0, I0, I0, I0],
  ['HAT', A0, A1, A1, A2],
  ['COAT', G2, G3, G3, G3],
  ['COAT_DK', G1, G2, G2, G2],
  ['SCARF', A0, A1, A2, A3],
  ['PANTS', I1, I2, I3, W3],
  ['BOOT', I0, I0, I1, W1],
  ['CLOUD', I2, I2, U0, U0],
  ['CLOUD_SH', I1, I1, I3, I3],
  ['SMOKE', I3, U1, U2, A1],
  ['SMOKE_DK', I2, U0, U1, A0],
  ['MOON', C3, C3, C3, C3],
  ['MOON_DK', C1, C1, C1, C1],
  ['STAR', U3, C3, C3, C3],
  ['STAR_DIM', U1, U2, U3, U3],
  ['LIT', A2, A2, A2, A2],
  ['LIT_HI', A3, A3, A3, A3],
  ['LIT_DK', A1, A1, A1, A1],
  ['EMBER', A0, A0, A0, A0],
  ['FLAME', C3, C3, C3, C3],
  ['SIL', I0, I0, I0, I0],
  ['FLAKE', U3, C1, C3, A3],
  ['FLAKE_DIM', U1, U2, U3, A2],
  ['MARK', C3, C3, C3, C3],
  ['ZZZ', U3, U3, U3, U3],
  ['SKI', A0, A0, A1, A2],
  ['FOX', A0, A0, A1, A2],
  ['FOX_DK', W1, W2, W2, W3],
];
const M = Object.fromEntries(MATS.map((row, i) => [row[0], i]));

// ---- 天気のかなめ：[物語の時刻, 材質の列, 空の色（上から地平線へ）]
const KEYS = [
  [0, 0, [I1, I1, I2, I2, I2]],
  [0.34, 0, [I1, I1, I2, I2, I2]],
  [0.78, 1, [I0, I1, I1, I2, I2]],
  [1.12, 1, [I0, I0, I1, I1, I2]],
  [1.72, 2, [I0, I0, I1, I2, I3]],
  [2.01, 2, [I0, I0, I1, I2, I3]],
];

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayerAt = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];

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

function makeNoise(seed) {
  const r = seeded(seed);
  const table = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) table[i] = r();
  const at = (x, y) => table[((x & 255) << 8) | (y & 255)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return mix(mix(at(xi, yi), at(xi + 1, yi), u), mix(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
  };
}

// ---- 色の計算（OKLab）。色の値は書かず、トークンの色相に明るさだけを与える
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function rgbToOklab([r8, g8, b8]) {
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
function labTone(lab, L) {
  // 明るさを決め、色域に入るまで鮮やかさを落とす
  let chroma = 1;
  for (let i = 0; i < 24; i++) {
    const rgb = oklabToLinear(L, lab[1] * chroma, lab[2] * chroma);
    if (rgb.every((v) => v >= -0.001 && v <= 1.001)) return rgb.map((v) => Math.round(toGamma(clamp(v)) * 255));
    chroma *= 0.9;
  }
  return oklabToLinear(L, 0, 0).map((v) => Math.round(toGamma(clamp(v)) * 255));
}

// ---- 住人の絵：毛糸の帽子、えりまき、上着
const CHARS = { N: 'HAT', H: 'HAIR', S: 'SKIN', E: 'HAIR', C: 'SCARF', T: 'COAT', D: 'COAT_DK', G: 'HAT', P: 'PANTS', B: 'BOOT', F: 'FOX', O: 'FOX_DK', W: 'ROOF_SNOW_HI', K: 'BOOT' };
const makeSprite = (rows) => {
  const list = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') list.push([x, y, M[CHARS[ch]], ch === 'E']);
    });
  });
  return { list, w: rows[0].length, h: rows.length };
};
const HEAD = ['..NNN..', '.NNNNN.', '.HHSSS.', '.HSSES.', '..SSSS.'];
const HEAD_BLINK = ['..NNN..', '.NNNNN.', '.HHSSS.', '.HSSSS.', '..SSSS.'];
const HEAD_UP = ['..NNN..', '.NNNNN.', '.HHSES.', '.HSSSS.', '..SSSS.'];
const BODY_STAND = ['..CCC..', '.TTTTT.', '.GTTTG.', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
const BODY_WALK1 = ['..CCC..', '.TTTTT.', '..TTTG.', '.GDDD..', '..PPP..', '.PP.P..', '.B..BB.'];
const BODY_WALK2 = ['..CCC..', '.TTTTT.', '.GTTTG.', '..DDD..', '..PPP..', '..PP...', '..BB...'];
const BODY_WALK3 = ['..CCC..', '.TTTTT.', '.GTTT..', '..DDDG.', '..PPP..', '..P.PP.', '.BB..B.'];
const BODY_ARMS = ['G.CCC.G', 'GTTTTTG', '..TTT..', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
const person = (head, body) => makeSprite([...head, ...body]);
const SPR = {
  stand: person(HEAD, BODY_STAND),
  blink: person(HEAD_BLINK, BODY_STAND),
  walk: [person(HEAD, BODY_WALK1), person(HEAD, BODY_WALK2), person(HEAD, BODY_WALK3), person(HEAD, BODY_WALK2)],
  up: person(HEAD_UP, BODY_ARMS),
  gaze: person(HEAD_UP, BODY_STAND),
  sil: makeSprite(['...HHH..', '..HHHHH.', '..HHHHH.', '...HHH..', '..HHHHH.', '.HHHHHHH', 'HHHHHHHH', 'HHHHHHHH']),
  // キツネ：右向き。左へ行くときは裏返す
  fox: [
    makeSprite(['........F.F', '........FFF', '.....FFFFFK', 'WFFFFFFFW..', '.WOFFFFF...', '...K...K...']),
    makeSprite(['........F.F', '........FFF', '.....FFFFFK', 'WFFFFFFFW..', '.WOFFFFF...', '....K.K....']),
  ],
};

// ---- シェーダー
const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
// 指定しないと標本の精度は lowp になる。PC では無視されるが、スマホの GPU では光の場が段になることがある
precision highp sampler2D;
uniform sampler2D uWorld, uGlowNear;
uniform vec2 uRes, uPill, uOrigin, uWorldSize, uGlowSize;
uniform vec4 uLens;
uniform float uBezel, uK, uNight, uLift, uSeam, uCalm;
uniform vec3 uShellDay, uShellNight, uInk, uLight, uHiNight, uLoNight, uSkyDay, uHomeCol, uSkyCol;
uniform vec2 uHomePos, uSkyPos;
out vec4 outColor;

float rb(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// なめらかに読む（B スプライン。光の場の格子が見えないように）
vec3 smoothTex(sampler2D t, vec2 uv, vec2 size) {
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
  return g0.y * (g0.x * texture(t, vec2(h0.x, h0.y)).rgb + g1.x * texture(t, vec2(h1.x, h0.y)).rgb)
       + g1.y * (g0.x * texture(t, vec2(h0.x, h1.y)).rgb + g1.x * texture(t, vec2(h1.x, h1.y)).rgb);
}
vec3 glowNear(vec2 frag) {
  vec2 uv = vec2(frag.x / uRes.x, 1.0 - frag.y / uRes.y);
  // 光の届かないところでは、なめらかに読む4回を省く。窓の大半はここを通る
  vec3 rough = textureLod(uGlowNear, uv, 0.0).rgb;
  if (rough.r + rough.g + rough.b < 1.0e-4) return vec3(0.0);
  return smoothTex(uGlowNear, uv, uGlowSize);
}

// 光る画素の集まりが、まわりをどれだけ照らすか。遠くまでなだらかに届く
vec3 reach(vec2 p, vec2 pos, vec3 col, float radius) {
  vec2 L = pos - p;
  float r2 = radius * radius;
  return col * r2 / (r2 + dot(L, L));
}

// ピクセルのあいだの、ごく細い継ぎ目。大きく写すときの密度になる
float seamAt(vec2 w, float scale) {
  if (scale < 7.0) return 1.0;
  vec2 f = fract(w) * scale;
  vec2 g = min(f, scale - f);
  float edge = min(g.x, g.y);
  return 1.0 - 0.075 * (1.0 - smoothstep(0.0, uSeam, edge));
}

// 整数倍のまま、そのまま読む
vec3 worldExact(vec2 frag) {
  vec2 w = vec2(frag.x - uOrigin.x, uOrigin.y - frag.y) / uK;
  ivec2 t = ivec2(floor(w));
  t = clamp(t, ivec2(0), ivec2(uWorldSize) - 1);
  return texelFetch(uWorld, t, 0).rgb * seamAt(w, uK);
}

// レンズの中：拡大では、ピクセルの縁は立ったまま。圧縮されるところはミップで読み、模様を出さない
vec3 worldBent(vec2 frag, float scale, float foot) {
  vec2 w = vec2(frag.x - uOrigin.x, uOrigin.y - frag.y) / uK;
  if (foot > 1.0) return textureLod(uWorld, w / uWorldSize, log2(foot)).rgb;
  vec2 r = floor(w + 0.5);
  vec2 sharp = r - 0.5 + clamp((w - r) / max(foot, 1.0e-3) + 0.5, 0.0, 1.0);
  return textureLod(uWorld, sharp / uWorldSize, 0.0).rgb * seamAt(w, scale);
}

vec3 envLow, envHigh;
float softBox(vec2 p, vec2 c, vec2 h, float s) {
  vec2 q = abs(p - c) - h;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 1.0 - smoothstep(-s, s, d);
}
// 磨かれた面に映る部屋：上の大きなやわらかい光と、下からの弱い照り返し
vec3 studio(vec3 R) {
  vec3 c = mix(envLow, envHigh, smoothstep(-0.55, 0.85, R.y));
  vec2 s = R.xy / (1.0 + max(R.z, 0.0));
  float key = softBox(s, vec2(-0.1, 0.56), vec2(0.5, 0.11), 0.17);
  float fill = softBox(s, vec2(0.34, -0.6), vec2(0.3, 0.05), 0.2);
  c += envHigh * key * 1.15;
  c += envHigh * fill * 0.14;
  return c;
}

vec3 shellColor(vec2 p, vec2 frag, float d) {
  // 外の面：丸い厚み。外側は外へ、内側は窓へ向かって傾く
  vec2 q = p;
  float inner = uPill.x - uPill.y;
  q.x = sign(p.x) * max(abs(p.x) - inner, 0.0);
  vec2 g = q / max(length(q), 1.0e-3);
  float t = clamp(-d / uBezel, 0.0, 1.0);
  float a = (1.0 - 2.0 * t);
  a = sign(a) * pow(abs(a), 1.35) * 0.96;
  vec3 N = normalize(vec3(g * a, sqrt(max(1.0 - a * a, 0.02))));
  vec3 R = vec3(2.0 * N.z * N.xy, 2.0 * N.z * N.z - 1.0);
  vec3 albedo = mix(uShellDay, uShellNight, uNight);
  float diffuse = 0.62 + 0.38 * clamp(dot(N, normalize(vec3(-0.25, 0.75, 0.6))), 0.0, 1.0);
  float fresnel = 0.05 + 0.95 * pow(1.0 - N.z, 3.5);
  vec3 c = albedo * diffuse;
  c = mix(c, studio(R), clamp(fresnel * 0.9 + 0.1, 0.0, 1.0));
  // 窓のそばは、奥へ落ちる影
  float toWindow = smoothstep(0.62, 1.0, t);
  c = mix(c, c * 0.8, toWindow * 0.55);

  // 灯りが、磨かれた面を照らす。光に近いところだけが、やわらかく染まる
  float radius = uPill.y * 0.62;
  for (int i = 0; i < 2; i++) {
    vec2 pos = i == 0 ? uHomePos : uSkyPos;
    vec3 col = i == 0 ? uHomeCol : uSkyCol;
    vec3 e = reach(p, pos, col, radius);
    vec2 toL = normalize(pos - p + 1.0e-3);
    float wrap = 0.5 + 0.5 * dot(N.xy, toL);
    c += e * wrap * mix(albedo * 0.9, vec3(dot(albedo, vec3(0.34))) + 0.34, 0.55) * 3.1;
    // 映り込み：線にならないよう、広く弱く
    vec3 Ld = normalize(vec3(pos - p, uPill.y * 0.7));
    float spec = pow(max(dot(R, Ld), 0.0), 5.0);
    c += reach(p, pos, col, uPill.y * 0.4) * spec * 1.4;
  }
  return c;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = frag - 0.5 * uRes;
  envLow = mix(uShellDay * 0.74, uLoNight, uNight);
  envHigh = mix(uLight, uHiNight, uNight);

  float d = rb(p, uPill, uPill.y);
  float dw = d + uBezel;

  // ---- 外：やわらかい影と、漏れた光
  vec3 premul = vec3(0.0);
  float alpha = 0.0;
  if (d > -2.0) {
    float h = uPill.y;
    float wide = rb(p + vec2(0.0, h * 0.13), uPill - vec2(h * 0.02, h * 0.02), uPill.y);
    float contact = rb(p + vec2(0.0, h * 0.028), uPill, uPill.y);
    float shadow = 0.24 * (1.0 - smoothstep(-h * 0.2, h * 0.28, wide)) + 0.22 * (1.0 - smoothstep(-h * 0.03, h * 0.07, contact));
    alpha = shadow;
    premul = uInk * shadow;
    // 漏れた光は、まわりの地を染める。灯りがなければ染まらない
    if (uHomeCol.r + uHomeCol.g + uHomeCol.b > 0.0) {
      vec3 outside = reach(p, uHomePos, uHomeCol, uPill.y * 0.62) * exp(-max(d, 0.0) / (h * 0.2));
      float amount = clamp(dot(outside, vec3(0.34)) * 2.3, 0.0, 0.85);
      vec3 tint = outside / max(dot(outside, vec3(0.34)), 1.0e-3) * 0.34;
      premul = mix(premul, tint * 1.25, amount);
      alpha = mix(alpha, 1.0, amount);
    }
    // canvas の端までに、なめらかに消す
    vec2 toEdge = 0.5 * uRes - abs(p);
    float room = min(toEdge.x, toEdge.y) / (h * 0.32);
    float fade = smoothstep(0.0, 1.0, clamp(room, 0.0, 1.0));
    premul *= fade;
    alpha *= fade;
  }

  vec3 color = premul;
  if (d < 1.0) {
    // 殻は細い帯。窓に隠れる画素では計算しない（下の mix で捨てるだけなので、絵は変わらない）
    vec3 body = dw > -0.8 ? shellColor(p, frag, d) : vec3(0.0);

    if (dw < 1.0) {
      // ---- 窓の奥の世界
      vec3 c = worldExact(frag);

      // 灯りのにじみ：ピクセルの上に、ガラスのなめらかな光が乗る
      vec3 near = glowNear(frag);
      c = 1.0 - (1.0 - c) * (1.0 - clamp(near * 0.82, 0.0, 1.0));

      // ガラスの映り込み：広く、なだらかに。縁はなぞらない
      float win = uPill.y - uBezel;
      float sheen = smoothstep(win * 0.1, win * 1.02, p.y + p.x * 0.09);
      c = mix(c, envHigh, sheen * sheen * mix(0.17, 0.05, uNight));
      float low = smoothstep(-win * 0.5, -win * 1.05, p.y - p.x * 0.05);
      c = mix(c, envHigh, low * mix(0.05, 0.015, uNight));

      // くぼみ：上のふちから落ちる影と、まわりの陰り
      float top = rb(p - vec2(0.0, win * 0.06), uPill - vec2(uBezel), win);
      float inset = 1.0 - smoothstep(-win * 0.2, win * 0.03, top + win * 0.0);
      float ring = exp(max(dw, -win) / (win * 0.075));
      float depth = clamp(ring * 0.46 + (1.0 - exp(min(top, 0.0) / (win * 0.14))) * 0.0 + exp(min(top, 0.0) / (win * 0.1)) * 0.4 * inset, 0.0, 0.82);
      c = mix(c, uInk, depth);

      // ---- レンズ
      vec2 lc = uLens.xy;
      vec2 he = uLens.zw;
      float lr = min(he.x, he.y);
      vec2 lq = p - lc;

      // レンズが窓に落とす影と、集めた光
      float lift = 0.055 + uLift * 0.04;
      float sd = rb(lq + vec2(0.0, lr * lift * 1.5), he, lr);
      float sh = 1.0 - smoothstep(-lr * 0.16, lr * (0.2 + uLift * 0.1), sd);
      c = mix(c, uInk, sh * mix(0.36, 0.55, uNight));

      float ld = rb(lq, he, lr);
      if (ld < 1.0) {
        // 中心線からの距離で丸みを決める
        vec2 axis = lq;
        vec2 inner2 = max(he - lr, vec2(0.0));
        axis.x = sign(lq.x) * max(abs(lq.x) - inner2.x, 0.0);
        axis.y = sign(lq.y) * max(abs(lq.y) - inner2.y, 0.0);
        float rad = length(axis);
        vec2 gr = axis / max(rad, 1.0e-3);
        float rho = clamp(rad / lr, 0.0, 1.0);

        // 拡大：中ほどは平らに、少しだけ大きく見える。縁に近づくと急に曲がり、外の絵を圧縮して見せる
        float mag = 1.24;
        float bt = clamp((rho - 0.7) / 0.3, 0.0, 1.0);
        float band = bt * bt * (3.0 - 2.0 * bt);
        float strength = 1.0 - 1.0 / mag + 0.2;
        float bend = pow(band, 2.2) * lr * strength;
        vec2 base = lc + lq / mag;
        vec2 shiftDir = gr * bend;
        vec2 center = 0.5 * uRes;
        // 1画素が世界の何ピクセルぶんか（曲がる帯では、圧縮されて大きくなる）
        float dBand = 6.0 * bt * (1.0 - bt) / 0.3;
        float foot = (1.0 / mag + 2.2 * pow(max(band, 1.0e-3), 1.2) * dBand * strength) / uK;
        vec3 seen;
        float scale = uK * mag;
        if (band > 0.02) {
          float ca = 0.05 * band;
          seen.r = worldBent(center + base + shiftDir * (1.0 - ca), scale, foot).r;
          seen.g = worldBent(center + base + shiftDir, scale, foot).g;
          seen.b = worldBent(center + base + shiftDir * (1.0 + ca), scale, foot).b;
        } else {
          seen = worldBent(center + base, scale, foot);
        }
        vec3 throughGlow = glowNear(center + base + shiftDir);
        seen = 1.0 - (1.0 - seen) * (1.0 - clamp(throughGlow * 0.8, 0.0, 1.0));

        // ガラスの形：中ほどはゆるい丸み、縁で急に落ちる
        vec2 tilt = gr * (0.22 * rho + 0.78 * pow(rho, 7.0));
        vec3 N = normalize(vec3(tilt, sqrt(max(1.0 - dot(tilt, tilt), 0.02))));
        vec3 R = vec3(2.0 * N.z * N.xy, 2.0 * N.z * N.z - 1.0);
        vec2 lp = lq / lr;

        vec3 lens = seen * 1.035;

        // 縁の厚み：明るい線ではなく、ガラスの奥の暗さで形を見せる
        float edge = pow(rho, 16.0);
        lens = mix(lens, uInk, edge * 0.42);

        // 下の内側に集まる光
        float pool = smoothstep(0.05, 0.95, -lp.y * 0.9 + lp.x * 0.2) * smoothstep(1.0, 0.8, rho) * smoothstep(0.42, 0.86, rho);
        lens += envHigh * pool * mix(0.3, 0.1, uNight);

        // 反射：上の大きなやわらかい光。丸みに沿って歪むが、縁をなぞらない
        vec2 sr = R.xy / (1.0 + max(R.z, 0.0));
        float broad = softBox(lp, vec2(-0.1, 0.62), vec2(0.5, 0.17), 0.3) * smoothstep(0.98, 0.72, rho);
        lens = mix(lens, envHigh, broad * mix(0.44, 0.1, uNight));
        float fresnel = pow(1.0 - N.z, 3.0);
        float dir = 0.2 + 0.8 * smoothstep(-0.6, 0.85, dot(gr, normalize(vec2(-0.42, 0.9))));
        float mirror = clamp(fresnel * dir * dir * 0.6, 0.0, 0.42);
        if (mirror > 1.0e-3) lens = mix(lens, studio(R), mirror);

        // 灯りと月も、レンズの面に映る。映るのは縁の近くだけ
        if (rho > 0.62) {
          for (int i = 0; i < 2; i++) {
            vec2 pos = i == 0 ? uHomePos : uSkyPos;
            vec3 col = i == 0 ? uHomeCol : uSkyCol;
            vec2 toL = normalize(pos - p + 1.0e-3);
            float side = max(dot(gr, toL), 0.0);
            lens += reach(p, pos, col, uPill.y * 0.9) * side * side * side * smoothstep(0.62, 0.97, rho) * 0.6;
          }
        }

        c = mix(c, lens, 1.0 - smoothstep(-0.8, 0.8, ld));
      }

      body = mix(body, c, 1.0 - smoothstep(-0.8, 0.8, dw));
    }

    float cover = 1.0 - smoothstep(-0.8, 0.8, d);
    color = mix(premul, body, cover);
    alpha = mix(alpha, 1.0, cover);
  }

  // 大きな階調が縞にならないよう、わずかに散らす
  float n = fract(sin(dot(frag, vec2(12.9898, 78.233))) * 43758.5453);
  n += fract(sin(dot(frag, vec2(93.989, 67.345))) * 24634.6345) - 1.0;
  color += (n * 0.75) / 255.0 * min(alpha * 4.0, 1.0);
  outColor = vec4(clamp(color, 0.0, 1.0), alpha);
}`;

export function mount(root) {
  const cleanups = [];
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  let canvas = root.querySelector('.scene');
  const button = root.querySelector('.hit');
  const statusEl = root.querySelector('[data-status]');
  const probe = root.querySelector('.probe');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  let calm = motionQuery.matches;

  // 画面に出さない canvas。OffscreenCanvas のない古い Safari（16.3 まで）でも動くようにする
  const offscreen = (w, h) => (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(root.ownerDocument.createElement('canvas'), { width: w, height: h }));

  // ---- パレットをトークンから作る
  const paint = offscreen(1, 1).getContext('2d', { willReadFrequently: true });
  const NCOL = RAMPS.length * 4;
  const palette = new Array(NCOL);
  const palette32 = new Uint32Array(NCOL);
  // 殻とガラスに使う色。世界の24色とは別に、同じトークンから明るさだけを決めて作る
  const tones = { shell: [0, 0, 0], shellMoon: [0, 0, 0], hi: [0, 0, 0], lo: [0, 0, 0], ink: [0, 0, 0] };
  const readPalette = () => {
    const style = getComputedStyle(root);
    const labs = {};
    RAMPS.forEach(([name, steps], ramp) => {
      const declared = style.getPropertyValue(`--_${name}`).trim();
      const channels = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(declared);
      probe.style.color = channels ? `rgb(${channels[1]} ${channels[2]} ${channels[3]})` : declared;
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = getComputedStyle(probe).color;
      paint.fillRect(0, 0, 1, 1);
      const d = paint.getImageData(0, 0, 1, 1).data;
      const lab = rgbToOklab([d[0], d[1], d[2]]);
      labs[name] = lab;
      steps.forEach((L, step) => {
        const rgb = labTone(lab, L);
        const id = ramp * 4 + step;
        palette[id] = rgb;
        palette32[id] = (255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
      });
    });
    const tone = (name, L) => labTone(labs[name], L).map((v) => v / 255);
    tones.shell = tone('fg', 0.25);
    tones.shellMoon = tone('muted', 0.52);
    tones.hi = tone('fg', 0.44);
    tones.lo = tone('fg', 0.17);
    tones.ink = tone('fg', 0.15);
  };
  const unit = (id) => palette[id].map((v) => v / 255);

  // ---- 材質の表：天気のかなめごと、状態（ふつう、影、灯り）ごと
  const shadeOf = (id) => {
    if (id % 4 > 0) return id - 1;
    if (id === C0) return U2;
    if (id === G0) return I1;
    if (id === U0) return I3;
    if (id === A0) return W3;
    if (id === W0) return I1;
    return id;
  };
  const NM = MATS.length;
  const table = KEYS.map(([, col]) => {
    const t = new Uint8Array(NM * 3);
    MATS.forEach((row, m) => {
      const id = row[col + 1];
      t[m] = id;
      t[NM + m] = shadeOf(id);
      t[NM * 2 + m] = row[4];
    });
    return t;
  });
  // 遠くの雪は、空と遠い山と森の前だけを降る。部屋の中には降らない
  const flagsOf = (names) => {
    const f = new Uint8Array(NM);
    for (const name of names) f[M[name]] = 1;
    return f;
  };
  const FAR_OK = flagsOf(['SKY', 'MTN', 'MTN_SNOW', 'MTN_SNOW_SH', 'FOREST', 'FOREST_LT', 'FOREST_SNOW', 'CLOUD', 'CLOUD_SH', 'STAR_DIM']);
  const NO_SNOW = flagsOf(['LIT', 'LIT_HI', 'LIT_DK', 'EMBER', 'FLAME', 'SIL', 'ROOM', 'GLASS', 'GLASS_HI', 'MOON', 'MOON_DK', 'MARK']);
  const IS_GROUND = flagsOf(['SNOW', 'SNOW_SH', 'SNOW_HI', 'PATH', 'PATH_DK']);
  const NO_POOL = flagsOf(['SKY', 'SIL', 'LIT', 'LIT_HI', 'LIT_DK', 'EMBER', 'FLAME', 'MTN', 'MTN_SNOW', 'MTN_SNOW_SH', 'FOREST', 'FOREST_LT', 'FOREST_SNOW', 'CLOUD', 'CLOUD_SH', 'MOON', 'MOON_DK', 'STAR', 'STAR_DIM']);

  // ---- 世界の大きさ（整数倍が決める）
  let bw = 1;
  let bh = 1;
  let ox = 0;
  let oy = 0;
  let k = 1;
  let matBuf = new Uint8Array(1);
  let baseBuf = new Uint8Array(1);
  let varBuf = new Uint8Array(1);
  let thrA = new Uint8Array(1);
  let thrB = new Uint8Array(1);
  let pixels = new Uint32Array(1);
  let pixelBytes = new Uint8Array(pixels.buffer);
  let skyKeys = [];
  let stars = [];
  const emitList = [];
  const sources = [{ w: 0, x: 0, y: 0, r: 0, g: 0, b: 0 }, { w: 0, x: 0, y: 0, r: 0, g: 0, b: 0 }];

  const noiseA = makeNoise(11);
  const noiseB = makeNoise(29);

  // ---- 描く道具
  const put = (x, y, m) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return;
    matBuf[py * bw + px] = m;
  };
  const putSky = (x, y, m) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return;
    const i = py * bw + px;
    if (matBuf[i] === 0) matBuf[i] = m;
  };
  const rect = (x, y, w, h, m) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, m);
  };
  const get = (x, y) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return -1;
    return matBuf[py * bw + px];
  };
  const blit = (s, x, y, flip = false, force = -1) => {
    for (const [dx, dy, m] of s.list) put(flip ? x + s.w - 1 - dx : x + dx, y + dy, force >= 0 ? force : m);
  };
  const emit = (x, y, weight, group = 2) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return;
    emitList.push(py * bw + px, weight);
    if (group < 2) {
      const c = sources[group];
      c.w += weight;
      c.x += px * weight;
      c.y += py * weight;
      c.id = group === 0 ? A2 : c.id;
    }
  };

  // ---- 動かない背景
  // 遠い山：とがった峰を並べる。[峰の x, 峰の y, 左の傾き, 右の傾き]
  const PEAKS = [
    [-34, 47, 0.9, 1.1],
    [14, 31, 1.0, 0.76],
    [60, 47, 0.9, 0.95],
    [118, 25, 0.74, 0.92],
    [174, 43, 0.95, 0.8],
    [224, 35, 0.8, 1.1],
  ];
  // 森：小さな針葉樹の列
  const forestTrees = [];
  {
    const r = seeded(4242);
    for (let fx = -70; fx < CORE_W + 80; fx += 3 + r() * 4) forestTrees.push({ c: fx, h: 5 + r() * 9, w: 2.4 + r() * 2.2, base: 75 + r() * 3 });
  }
  // 手前の針葉樹。枝は毎フレーム描いて、風に揺らす
  const PINES = [
    { cx: 158, top: 10, bottom: 83, w: 20, base: 90, tw: 2, seed: 3 },
    { cx: 13, top: 49, bottom: 82, w: 11, base: 86, tw: 1, seed: 5 },
    { cx: 195, top: 41, bottom: 84, w: 13, base: 89, tw: 1, seed: 7 },
    { cx: -13, top: 57, bottom: 85, w: 10, base: 88, tw: 1, seed: 11 },
  ];

  const pathDist = (x, y) => {
    // 戸口から手前へ下る道と、空を見上げる場所へ向かう枝道
    const main = Math.abs(x - (74 + Math.pow(Math.max(y - 86, 0), 1.45) * 0.62 + Math.sin(y * 0.3) * 1.5));
    const side = y < 98 ? Math.abs(y - (90.5 + Math.sin(x * 0.09) * 1.2)) * (x > 76 && x < 129 ? 1 : 99) : 99;
    return Math.min(main * 0.5, side);
  };

  const paintGround = () => {
    // 列ごとに、山の稜線、森の梢、雪原のふちを決めておく
    const mtnY = new Float32Array(bw);
    const mtnD = new Float32Array(bw);
    const mtnTop = new Float32Array(bw);
    const forY = new Float32Array(bw);
    const topY = new Float32Array(bw);
    for (let px = 0; px < bw; px++) {
      const x = px - ox;
      let best = 999;
      for (const [cx, top, sl, sr] of PEAKS) {
        const d = x - cx;
        const y = top + (d < 0 ? -d * sl : d * sr);
        if (y < best) {
          best = y;
          mtnD[px] = d;
          mtnTop[px] = top;
        }
      }
      mtnY[px] = best + (noiseB(x * 0.23 + 3, 4.5) - 0.5) * 3.4 + (noiseA(x * 0.06, 9.5) - 0.5) * 4;
      let fy = 76 + noiseA(x * 0.07 + 11, 6.5) * 3;
      for (const tr of forestTrees) {
        const d = Math.abs(x - tr.c);
        if (d < tr.w) fy = Math.min(fy, tr.base - tr.h * (1 - d / tr.w));
      }
      forY[px] = fy;
      topY[px] = HORIZON - Math.max(0, noiseA(x * 0.045 + 2, 0.5) * 6 - 2.6);
    }

    for (let py = 0; py < bh; py++) {
      const y = py - oy;
      for (let px = 0; px < bw; px++) {
        const x = px - ox;
        const i = py * bw + px;
        if (y < topY[px]) {
          if (y >= forY[px]) {
            // 森：梢に雪がのる
            const fromTop = y - forY[px];
            let m = M.FOREST;
            if (fromTop < 1.3 && noiseB(x * 0.8 + 1, 2.5) > 0.3) m = M.FOREST_SNOW;
            else if (fromTop < 5 && bayerAt(x, y) > 13) m = M.FOREST_SNOW;
            else if (noiseB(x * 0.45, y * 0.7) > 0.68) m = M.FOREST_LT;
            // 根もとは、雪けむりに溶ける
            if (y >= HORIZON - 3 && bayerAt(x, y) < (y - (HORIZON - 4)) * 4) m = M.FOREST_SNOW;
            matBuf[i] = m;
          } else if (y >= mtnY[px]) {
            // 山：左の斜面は明るい雪、右は陰。境目はぎざぎざに下る
            const fromTop = y - mtnY[px];
            const zig = (y - mtnTop[px]) * 0.3 + (((y >> 2) & 1) === 1 ? 2 : -1);
            const lit = mtnD[px] < zig;
            let m = lit ? M.MTN_SNOW : M.MTN_SNOW_SH;
            // 雪のあいだにのぞく岩肌
            if (fromTop > 2 && noiseB(x * 0.55 + 7, y * 0.17 + 2) > (lit ? 0.76 : 0.68)) m = M.MTN;
            matBuf[i] = m;
          }
          continue;
        }
        // 雪原：ゆるい吹きだまりの明暗
        const n = noiseA(x * 0.05 + 9, y * 0.16 + 3) + noiseB(x * 0.22, y * 0.4) * 0.25;
        const depth = (y - HORIZON) / 30;
        const v = n + (bayerAt(x, y) / 16 - 0.5) * 0.12;
        let m = M.SNOW;
        if (v > 0.9) m = M.SNOW_HI;
        else if (v < 0.5) m = M.SNOW_SH;
        if (y - topY[px] < 1) m = M.SNOW_HI;
        // 踏み固めた道と、わきに寄せた雪
        const pd = pathDist(x, y);
        if (pd < 2.2 + depth * 2.2) m = noiseB(x * 0.7 + 3, y * 0.9) > 0.66 ? M.PATH_DK : M.PATH;
        else if (pd < 3.3 + depth * 2.2) m = bayerAt(x, y) > 7 ? M.SNOW_HI : M.SNOW;
        matBuf[i] = m;
      }
    }

    // 雪のきらめき、小さなくぼみ、雪から出た枯れ草
    const r = seeded(5);
    const count = Math.floor((bw * bh) / 70);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(r() * bw) - ox;
      const y = HORIZON + 2 + Math.floor(r() * (bh - oy - HORIZON));
      const kind = r();
      if (pathDist(x, y) < 5) continue;
      if (kind < 0.45) {
        put(x, y, M.SNOW_HI);
      } else if (kind < 0.9) {
        put(x, y, M.SNOW_SH);
        put(x + 1, y, M.SNOW_SH);
        put(x, y - 1, M.SNOW_HI);
      } else {
        put(x, y, M.BARK_LT);
        put(x + 1, y - 1, M.BARK_LT);
        put(x - 1, y - 1, M.BARK);
      }
    }
  };

  const paintFence = () => {
    // 雪に半分うもれた柵
    for (let x = 99; x < 128; x++) {
      put(x, 78, M.WOOD_LT);
      put(x, 79, M.WOOD_DK);
      if (noiseB(x * 0.5, 1.5) > 0.3) put(x, 77, M.ROOF_SNOW);
    }
    for (let x = 100; x < 128; x += 6) {
      rect(x, 76, 2, 8, M.WOOD);
      rect(x, 76, 1, 8, M.WOOD_LT);
      rect(x, 75, 2, 1, M.ROOF_SNOW);
      put(x, 74, M.ROOF_SNOW_HI);
    }
  };

  const paintTrunks = () => {
    for (const p of PINES) {
      for (let y = p.bottom - 2; y <= p.base; y++) {
        const flare = y > p.base - 2 ? 1 : 0;
        for (let x = p.cx - p.tw - flare; x <= p.cx + p.tw + flare; x++) put(x, y, x <= p.cx - p.tw ? M.BARK_LT : M.BARK);
      }
      // 根もとに寄った雪
      for (let x = p.cx - p.tw - 4; x <= p.cx + p.tw + 4; x++) {
        put(x, p.base + 1, M.SNOW_HI);
        if (Math.abs(x - p.cx) < p.tw + 3) put(x, p.base, M.SNOW_HI);
      }
    }
  };

  const paintHouse = () => {
    const X0 = 38;
    const X1 = 84;
    const TOP = 53;
    const BASE = 85;
    const RT = 34;

    // 薪の山（左の壁ぎわ）。雪をかぶっている
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const x = 28 + i * 3 + (j === 1 ? 1 : 0);
        const y = 76 + j * 3;
        rect(x, y, 3, 3, M.WOOD);
        put(x + 1, y + 1, M.LOG_END);
        put(x + 2, y + 2, M.WOOD_DK);
        put(x, y + 2, M.WOOD_DK);
      }
    }
    rect(27, 74, 12, 2, M.ROOF_SNOW);
    rect(28, 73, 9, 1, M.ROOF_SNOW_HI);
    put(27, 75, M.ROOF_SNOW_SH);

    // 石の煙突（屋根の奥）。ふちに雪がのる
    rect(68, 24, 8, 22, M.STONE);
    for (let y = 24; y < 46; y += 3) {
      for (let x = 68; x < 76; x++) if ((x + (((y - 24) / 3) & 1) * 2) % 4 < 2) put(x, y, M.STONE_LT);
    }
    rect(67, 22, 10, 2, M.STONE_LT);
    rect(67, 23, 10, 1, M.STONE);
    rect(67, 21, 10, 1, M.ROOF_SNOW);
    rect(67, 20, 3, 1, M.ROOF_SNOW_HI);
    rect(74, 20, 3, 1, M.ROOF_SNOW);
    rect(70, 21, 4, 1, M.SIL);

    // 丸太の壁：1本ごとに、上が明るく、下のすきまが暗い
    for (let y = TOP; y < BASE; y++) {
      const row = (y - TOP) % 4;
      for (let x = X0; x < X1; x++) {
        let m = row === 0 ? M.WOOD_LT : row === 3 ? M.WOOD_DK : M.WOOD;
        if (row === 1 && noiseB(x * 0.6, y * 0.9) > 0.74) m = M.WOOD_LT;
        if (row === 2 && noiseB(x * 0.5 + 9, y * 0.9) > 0.8) m = M.WOOD_DK;
        put(x, y, m);
      }
    }
    // 軒下の影。ディザで下へ薄くなる
    for (let y = TOP; y < TOP + 6; y++) {
      for (let x = X0; x < X1; x++) {
        if (y < TOP + 2 || bayerAt(x, y) < (TOP + 6 - y) * 3) put(x, y, M.WOOD_DK);
      }
    }
    // 角：丸太の木口が、互い違いに出る
    for (let y = TOP, n = 0; y < BASE - 2; y += 4, n++) {
      const lx = (n & 1) === 1 ? X0 - 1 : X0 - 2;
      rect(lx, y, X0 - lx, 3, M.WOOD);
      put(lx, y + 1, M.LOG_END);
      const rx = (n & 1) === 1 ? X1 + 1 : X1;
      rect(X1, y, rx - X1 + 1, 3, M.WOOD_DK);
      put(rx, y + 1, M.WOOD);
    }

    // 屋根：厚く積もった雪。左上が明るく、右下へ陰る
    for (let y = RT - 3; y < TOP; y++) {
      const t = clamp((y - RT) / (TOP - RT));
      let l;
      let r;
      if (y < RT) {
        const rise = RT - y;
        l = 46 + rise * 2;
        r = 76 - rise * 2;
      } else {
        l = Math.round(mix(47, X0 - 6, t)) - 1;
        r = Math.round(mix(75, X1 + 6, t)) + 1;
      }
      for (let x = l; x <= r; x++) {
        const u = (x - l) / Math.max(r - l, 1);
        const v = u * 0.5 + t * 0.3 + noiseB(x * 0.16 + 4, y * 0.3 + 1) * 0.34 + (bayerAt(x, y) / 16 - 0.5) * 0.12;
        put(x, y, v < 0.3 ? M.ROOF_SNOW_HI : v < 0.74 ? M.ROOF_SNOW : M.ROOF_SNOW_SH);
      }
      put(l, y, M.ROOF_SNOW_HI);
      put(r, y, M.ROOF_SNOW_SH);
    }
    // 軒先：雪のかたまりが垂れ、つららが下がる
    for (let x = X0 - 7; x <= X1 + 7; x++) {
      const lump = noiseB(x * 0.33 + 2, 8.5);
      put(x, TOP, lump > 0.55 ? M.ROOF_SNOW_SH : M.WOOD_DK);
      const len = Math.floor(noiseB(x * 1.7 + 5, 3.5) * 5) - 1;
      if ((x & 1) === 0) for (let i = 1; i <= len; i++) put(x, TOP + i, M.ICE);
    }

    // 戸口
    rect(67, 66, 12, 19, M.WOOD_DK);
    rect(68, 67, 10, 18, M.WOOD_LT);
    for (let x = 70; x < 78; x += 3) rect(x, 67, 1, 18, M.WOOD);
    rect(68, 72, 10, 1, M.WOOD_DK);
    rect(69, 68, 8, 3, M.GLASS);
    put(70, 69, M.GLASS_HI);
    put(71, 69, M.GLASS_HI);
    put(76, 77, M.HAT);
    rect(66, 85, 14, 2, M.STONE_LT);
    rect(66, 85, 3, 1, M.SNOW_HI);
    rect(77, 85, 3, 1, M.SNOW_HI);
    put(66, 86, M.SNOW);
    put(79, 86, M.SNOW);
    rect(65, 87, 16, 1, M.PATH);

    // 窓枠と、雪ののった窓台（窓の中は毎フレーム描く）
    rect(44, 59, 18, 16, M.WOOD_DK);
    rect(43, 75, 20, 2, M.WOOD);
    rect(43, 75, 20, 1, M.WOOD_LT);
    for (let x = 43; x < 63; x++) {
      put(x, 74, M.ROOF_SNOW);
      if (noiseB(x * 0.5 + 1, 6.5) > 0.55) put(x, 73, M.ROOF_SNOW_HI);
    }

    // 灯りの腕木
    put(64, 63, M.WOOD_DK);
    put(65, 63, M.WOOD_DK);

    // 壁に立てかけたスキー
    for (let y = 67; y < 85; y++) {
      put(y < 76 ? 81 : 80, y, M.SKI);
      put(y < 76 ? 83 : 82, y, M.SKI);
    }
    put(80, 66, M.SKI);
    put(82, 66, M.SKI);

    // 壁ぎわの吹きだまり。戸口の前だけは、踏み固めてある
    for (let x = X0 - 4; x <= X1 + 4; x++) {
      if (x >= 65 && x <= 80) continue;
      const h = Math.round(1 + noiseA(x * 0.21 + 5, 2.5) * 3.2);
      for (let j = 0; j < h; j++) put(x, BASE - 1 - j, j === h - 1 ? M.SNOW_HI : M.SNOW);
    }

    // 郵便受け
    rect(92, 82, 1, 8, M.WOOD_DK);
    rect(90, 78, 6, 4, M.STONE_LT);
    rect(90, 81, 6, 1, M.STONE);
    rect(90, 77, 6, 1, M.ROOF_SNOW);
    rect(91, 76, 4, 1, M.ROOF_SNOW_HI);
    put(96, 79, M.HAT);
    put(96, 80, M.HAT);
  };

  const paintSnowman = (cx, by) => {
    const ball = (x0, y0, radius) => {
      for (let y = Math.floor(y0 - radius); y <= y0 + radius; y++) {
        for (let x = Math.floor(x0 - radius); x <= x0 + radius; x++) {
          if (Math.hypot(x - x0, y - y0) > radius) continue;
          const v = (x - x0 + (y - y0)) / radius;
          put(x, y, v < -0.5 ? M.ROOF_SNOW_HI : v > 0.75 ? M.ROOF_SNOW_SH : M.ROOF_SNOW);
        }
      }
    };
    // 枝の腕
    for (let i = 0; i < 3; i++) {
      put(cx - 5 - i, by - 6 - i, M.BARK_LT);
      put(cx + 5 + i, by - 6 - i, M.BARK_LT);
    }
    ball(cx, by - 4, 4.3);
    ball(cx, by - 10.5, 3.1);
    // 目、鼻、ボタン
    put(cx - 1, by - 11, M.SIL);
    put(cx + 1, by - 11, M.SIL);
    put(cx, by - 10, M.HAT);
    put(cx, by - 6, M.SIL);
    put(cx, by - 4, M.SIL);
    // えりまき
    rect(cx - 2, by - 8, 5, 1, M.SCARF);
    put(cx + 2, by - 7, M.SCARF);
    put(cx + 2, by - 6, M.SCARF);
    // バケツの帽子
    rect(cx - 1, by - 16, 3, 2, M.STONE_LT);
    rect(cx - 2, by - 14, 5, 1, M.STONE);
    // 足もとの雪
    rect(cx - 4, by + 1, 9, 1, M.SNOW_HI);
  };

  const paintRock = (cx, by) => {
    // 雪をかぶった岩
    rect(cx - 4, by - 3, 9, 4, M.STONE);
    rect(cx - 3, by - 4, 7, 1, M.STONE);
    rect(cx - 4, by - 3, 2, 3, M.STONE_LT);
    rect(cx - 3, by - 6, 7, 2, M.ROOF_SNOW);
    rect(cx - 4, by - 5, 9, 1, M.ROOF_SNOW);
    rect(cx - 2, by - 7, 4, 1, M.ROOF_SNOW_HI);
    put(cx + 4, by - 4, M.ROOF_SNOW_SH);
    rect(cx - 5, by + 1, 11, 1, M.SNOW_HI);
  };

  // 段を重ねた針葉樹。上の段から雪の肩が見え、枝先は暗く垂れる
  const makePine = ({ cx, top, bottom, w: halfW, seed }) => {
    const cells = new Map();
    const H = bottom - top;
    const n = Math.max(3, Math.round(H / 12));
    const tierH = (H / n) * 1.9;
    for (let i = n - 1; i >= 0; i--) {
      const yt = top + ((H * i) / n) * 0.9;
      const yb = Math.min(bottom, yt + tierH);
      const w = halfW * Math.pow((i + 1) / n, 0.8) + 0.5;
      const y1 = Math.floor(yb);
      for (let y = Math.floor(yt); y <= y1; y++) {
        const f = clamp((y - yt) / (yb - yt));
        const half = Math.max(0.5, w * Math.pow(f, 1.25));
        for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
          // 枝先は、ぎざぎざに垂れる
          const tooth = (((x + i * 2) % 3) + 3) % 3;
          if (y >= y1 - 1 && tooth === 0) continue;
          if (y === y1 && tooth === 1) continue;
          const e = Math.abs(x - cx) / w;
          const fromTop = y - (yt + (yb - yt) * Math.pow(e, 0.8));
          const left = x <= cx;
          const thick = (left ? 2.7 : 1.8) + noiseB(x * 0.45 + seed, y * 0.25 + i) * 2 - 0.5;
          let m;
          if (fromTop < thick) {
            if (left) m = fromTop < 1.4 ? M.ROOF_SNOW_HI : M.ROOF_SNOW;
            else m = fromTop < 1 ? M.ROOF_SNOW : M.ROOF_SNOW_SH;
          } else {
            const v = (f - 0.45) * 1.3 + (left ? 0 : 0.18) + noiseB(x * 0.6 + seed * 3, y * 0.6) * 0.35;
            m = v > 0.75 ? M.LEAF0 : v > 0.38 ? M.LEAF1 : M.LEAF2;
          }
          cells.set((y + 64) * 1024 + (x + 256), m);
        }
      }
    }
    const list = [];
    for (const [key, m] of cells) list.push((key % 1024) - 256, Math.floor(key / 1024) - 64, m);
    return list;
  };
  const pines = PINES.map((p) => ({ ...p, list: makePine(p) }));

  let flakes = [];
  let sparkles = [];

  const buildBase = () => {
    matBuf.fill(0);
    paintGround();
    paintFence();
    paintTrunks();
    paintHouse();
    paintSnowman(135, 92);
    paintRock(180, 95);
    baseBuf.set(matBuf);

    const r = seeded(808);
    stars = [];
    for (let i = 0; i < 95; i++) {
      stars.push({ x: Math.floor(r() * (CORE_W + 60)) - 30, y: Math.floor(r() * 70) - 4, seed: r(), big: r() < 0.14 });
    }
    // 雪片：奥、中、手前の3層。数は窓の広さに合わせる
    const fr = seeded(909);
    const flakeCount = Math.round((bw * bh) / 150);
    flakes = [];
    for (let i = 0; i < flakeCount; i++) {
      flakes.push({ x: fr() * bw - ox, y: fr() * bh - oy, layer: i % 3, rank: fr(), seed: fr() * 40, wf: 0.7 + fr() * 1.6, fall: 0.75 + fr() * 0.5 });
    }
    // 月明かりに光る雪の粒
    sparkles = [];
    for (let i = 0; i < 26; i++) {
      sparkles.push({ x: Math.floor(fr() * bw) - ox, y: HORIZON + 3 + Math.floor(fr() * 24), seed: fr() * 50, rate: 0.8 + fr() * 1.4 });
    }
    // 空を天気のかなめごとに描いておく
    skyKeys = KEYS.map(([, , stops]) => {
      const sky = new Uint8Array(bw * bh);
      const n = stops.length - 1;
      for (let py = 0; py < bh; py++) {
        const pos = clamp((py - oy) / HORIZON) * n;
        const a = Math.min(Math.floor(pos), n);
        const b = Math.min(a + 1, n);
        // 帯のあいだだけを、市松の点で埋める
        const f = smoothstep(0.3, 0.7, pos - a) * 4;
        for (let px = 0; px < bw; px++) {
          const cell = ((py & 1) << 1) | (px & 1);
          sky[py * bw + px] = f > [0, 2, 3, 1][cell] ? stops[b] : stops[a];
        }
      }
      return sky;
    });
  };

  // ---- 住人と世界の動き
  const res = { x: HOME_X, inside: true, face: 1, look: -1, step: 0, doorOpen: 0, startle: 0, hop: 0, blink: 0, nextBlink: 2, trail: 0, foot: 0 };
  const clouds = [
    { x: 2, y: 11, w: 34, h: 9, seed: 1, speed: 0.5 },
    { x: 66, y: 5, w: 26, h: 7, seed: 2, speed: 0.75 },
    { x: 118, y: 19, w: 38, h: 10, seed: 3, speed: 0.4 },
    { x: 186, y: 9, w: 24, h: 6, seed: 4, speed: 0.95 },
    { x: 238, y: 25, w: 30, h: 8, seed: 5, speed: 0.6 },
  ].map((cloud) => {
    const r = seeded(cloud.seed * 977);
    const blobs = Array.from({ length: 6 }, (_, i) => [cloud.w * ((i + 0.5) / 6) + (r() - 0.5) * 3, cloud.h * (0.45 + (r() - 0.5) * 0.35), cloud.h * (0.3 + r() * 0.32)]);
    return { ...cloud, blobs, pos: cloud.x };
  });
  const smoke = [];
  const sparks = [];
  const zees = [];
  const puffs = [];
  const clumps = [];
  const prints = [];
  const pools = [];
  const shoot = { t: -1, next: 9, x: 0, y: 0 };
  const fox = { on: false, next: 6, x: 0, dir: -1, stopAt: 0, pause: 0, paused: false, bolt: false, step: 0 };
  let anim = 0;
  let swayPhase = 0;
  let wind = 0.1;
  let snowAmt = 0.44;
  let smokeAcc = 0;
  let zeeAcc = 0;
  let breathAcc = 0;
  let lampFlick = 1;
  let windowL = 1;
  let lanternL = 1;
  let shutter = 0;

  // 物語の時刻から、住人の予定を決める。月が出るころ、外へ出て空を見上げる
  const planFor = (t) => (t >= 1.3 ? { outside: true, x: GAZE_X, act: 'gaze' } : { outside: false, x: HOME_X, act: 'in' });

  const stepResident = (dt, t, speedHint) => {
    const plan = planFor(t);
    const want = plan.outside ? plan.x : HOME_X;
    if (calm) {
      res.inside = !plan.outside;
      res.x = want;
      return plan;
    }
    res.startle = Math.max(0, res.startle - dt);
    res.hop = res.startle > 0.55 ? Math.sin(((0.9 - res.startle) / 0.35) * Math.PI) * 3 : 0;
    res.doorOpen = Math.max(0, res.doorOpen - dt);
    if (res.startle > 0) return plan;

    if (res.inside && plan.outside) {
      res.inside = false;
      res.x = HOME_X;
      res.doorOpen = 0.6;
    }
    if (!res.inside) {
      const delta = want - res.x;
      if (Math.abs(delta) > 0.5) {
        const speed = 15 + clamp(speedHint, 0, 1) * 74 + (plan.outside ? 0 : 7);
        const move = Math.min(Math.abs(delta), speed * dt);
        res.x += Math.sign(delta) * move;
        res.face = Math.sign(delta);
        res.step += move * 0.28;
        // 雪に足あとが残る
        res.trail += move;
        if (res.trail >= 3) {
          res.trail = 0;
          res.foot ^= 1;
          prints.push(Math.round(res.x), 89 + res.foot);
          if (prints.length > 160) prints.splice(0, 2);
        }
      } else {
        res.x = want;
        res.step = 0;
        if (!plan.outside) {
          res.inside = true;
          res.doorOpen = 0.45;
        }
      }
    }
    // まばたき
    res.nextBlink -= dt;
    if (res.nextBlink <= 0) {
      res.blink = 0.13;
      res.nextBlink = 1.8 + Math.random() * 3.4;
    }
    res.blink = Math.max(0, res.blink - dt);
    return plan;
  };

  const drawSky = (t, dt) => {
    // 空には、先に描いたものが残る。手前のものから描く

    // 雲：風に流れ、晴れるにつれて小さくなる
    const cover = 1 - 0.68 * smoothstep(1.1, 1.9, t);
    const span = CORE_W + 120;
    for (const cloud of clouds) {
      if (!calm) cloud.pos += dt * cloud.speed * (1 + wind * 6);
      const x0 = Math.round(((cloud.pos + 60) % span) - 60);
      for (let y = -1; y < cloud.h + 3; y++) {
        for (let x = -3; x < cloud.w + 4; x++) {
          let inside = false;
          for (const [bx, by, br] of cloud.blobs) {
            if (Math.hypot(x - bx, (y - by) * 1.25) < br * cover) {
              inside = true;
              break;
            }
          }
          if (!inside) continue;
          const under = y > cloud.h * 0.58;
          if (under && bayerAt(x0 + x, cloud.y + y) > 11) continue;
          putSky(x0 + x, cloud.y + y, under ? M.CLOUD_SH : M.CLOUD);
        }
      }
    }

    // 月：小屋の屋根のむこうから、ゆっくりのぼる
    const up = smoothstep(1.12, 1.95, t);
    if (up > 0.01) {
      const mx = Math.round(mix(34, 41, up));
      const my = Math.round(mix(58, 14, up));
      const R = 6;
      for (let dy = -R - 3; dy <= R + 3; dy++) {
        for (let dx = -R - 3; dx <= R + 3; dx++) {
          const d = Math.hypot(dx, dy);
          const x = mx + dx;
          const y = my + dy;
          if (d <= R) {
            const crater = (dx === -2 && dy === -2) || (dx === 2 && dy === 1) || (dx === -3 && dy === 2) || (dx === 1 && dy === -3) || (dx === 3 && dy === -1) || (dx === -1 && dy === 3);
            const shaded = dx * 0.7 + dy * 0.7 > R * 0.45;
            const m = crater || shaded ? M.MOON_DK : M.MOON;
            putSky(x, y, m);
            // 屋根や雲に隠れた部分は、光らない
            if (get(x, y) === m) emit(x, y, 34, 1);
          } else if (d <= R + 3 && bayerAt(x, y) < (R + 3.4 - d) * 1.6) {
            putSky(x, y, M.STAR_DIM);
          }
        }
      }
    }

    // 星：吹雪がおさまると少し、晴れるとたくさん。またたく
    const starAmt = 0.42 * smoothstep(0.6, 1, t) + 0.58 * smoothstep(1.2, 1.85, t);
    if (starAmt > 0.02) {
      for (const s of stars) {
        if (s.seed > starAmt * 1.05) continue;
        const twinkle = calm ? 1 : Math.sin(anim * (1.3 + s.seed * 4.4) + s.seed * 40);
        if (twinkle < -0.72) continue;
        const m = twinkle < 0.1 && !s.big ? M.STAR_DIM : M.STAR;
        putSky(s.x, s.y, m);
        if (s.big && twinkle > 0.55) {
          putSky(s.x - 1, s.y, M.STAR_DIM);
          putSky(s.x + 1, s.y, M.STAR_DIM);
          putSky(s.x, s.y - 1, M.STAR_DIM);
          putSky(s.x, s.y + 1, M.STAR_DIM);
        }
      }
      // 流れ星
      if (!calm && t > 1.7 && shoot.t >= 0) {
        const f = shoot.t / 0.55;
        for (let i = 0; i < 7; i++) {
          const u = f * 42 - i * 2;
          if (u > 0 && u < 42) putSky(Math.round(shoot.x + u), Math.round(shoot.y + u * 0.45), i < 2 ? M.STAR : M.STAR_DIM);
        }
      }
    }
  };

  // 月の影：雪の上に、右手前へ落ちる
  const drawShadows = (t) => {
    const fade = smoothstep(1.4, 1.9, t);
    if (fade <= 0.02) return;
    const mark = (x, y, strength) => {
      const px = x + ox;
      const py = y + oy;
      if (px < 0 || py < 0 || px >= bw || py >= bh) return;
      const i = py * bw + px;
      if (IS_GROUND[matBuf[i]] && strength * fade * 16 > bayerAt(x, y)) varBuf[i] = 1;
    };
    // 大きな木の影
    for (let y = 88; y < 100; y++) {
      const tt = (y - 88) / 12;
      const half = 19 * Math.sqrt(Math.max(0, 1 - Math.pow(tt * 2 - 1, 2)));
      const cx = 166 + tt * 9;
      for (let x = Math.round(cx - half); x <= cx + half; x++) mark(x, y, 0.9 - (Math.abs(x - cx) / (half + 1)) * 0.35);
    }
    // 小屋の影
    for (let y = 86; y < 93; y++) {
      const tt = (y - 86) / 7;
      for (let x = Math.round(40 + tt * 6); x <= 90 + tt * 12; x++) mark(x, y, 0.85 - tt * 0.45);
    }
    // 雪だるまの影
    for (let y = 91; y < 95; y++) {
      for (let x = 138; x < 146 + (y - 91); x++) mark(x, y, 0.7);
    }
  };

  const drawPrints = () => {
    for (let i = 0; i < prints.length; i += 2) {
      const px = prints[i] + ox;
      const py = prints[i + 1] + oy;
      if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
      const at = py * bw + px;
      if (IS_GROUND[matBuf[at]]) matBuf[at] = M.PATH_DK;
    }
  };

  const drawWindow = (t) => {
    // 窓の中：14×12
    const WX = 46;
    const WY = 61;
    const WW = 14;
    const WH = 12;
    const asleep = t < 0.12;
    const candle = t >= 0.12 && t < 0.3;
    const fire = t >= 0.3;

    if (fire) {
      // 暖炉の火：左下から広がる、ゆれる明かり
      const breathe = calm ? 0 : Math.sin(anim * 6.1) * 0.5 + Math.sin(anim * 14.3) * 0.3;
      for (let y = 0; y < WH; y++) {
        for (let x = 0; x < WW; x++) {
          const d = Math.hypot(x - 3, (y - 10.5) * 1.1) - breathe + (bayerAt(x, y) / 16 - 0.5) * 1.8;
          const m = d < 7.4 ? M.LIT : d < 12.2 ? M.LIT_DK : M.EMBER;
          put(WX + x, WY + y, m);
          emit(WX + x, WY + y, (m === M.LIT ? 225 : m === M.LIT_DK ? 150 : 90) * lampFlick, 0);
        }
      }
      // 薪と炎
      rect(WX + 1, WY + 11, 6, 1, M.SIL);
      for (let i = 0; i < 5; i++) {
        const tall = calm ? 3 - Math.abs(i - 2) : Math.max(1, Math.round(2.6 + Math.sin(anim * 9 + i * 2.1) * 1.3 + Math.sin(anim * 17 + i * 4.7) * 0.9 - Math.abs(i - 2) * 0.7));
        for (let j = 0; j < tall; j++) {
          put(WX + 1 + i, WY + 10 - j, j === 0 && tall > 1 ? M.FLAME : M.LIT_HI);
          emit(WX + 1 + i, WY + 10 - j, 255 * lampFlick, 0);
        }
      }
      if (res.inside) {
        // 火にあたる人影。ときどき顔を上げる
        const startled = res.startle > 0;
        const look = startled || (!calm && Math.sin(anim * 0.46) > 0.72);
        const nod = !calm && !look && Math.sin(anim * 1.7) > 0.86 ? 1 : 0;
        const hy = WY + 3 + nod - (startled ? 1 : 0);
        const hx = WX + 8;
        // 頭
        rect(hx, hy + (look ? 0 : 1), 4, 3, M.SIL);
        put(hx + 1, hy + (look ? -1 : 0), M.SIL);
        put(hx + 2, hy + (look ? -1 : 0), M.SIL);
        if (!look) put(hx - 1, hy + 2, M.SIL);
        // 肩と背
        rect(WX + 8, WY + 7, 5, 3, M.SIL);
        rect(WX + 9, WY + 10, 4, 2, M.SIL);
        // 火へのばした手
        rect(WX + 6, WY + 8, 3, 1, M.SIL);
      } else {
        // 外へ出ているあいだは、椅子だけが残る
        rect(WX + 12, WY + 5, 1, 7, M.SIL);
        rect(WX + 9, WY + 9, 4, 1, M.SIL);
        rect(WX + 9, WY + 10, 1, 2, M.SIL);
      }
    } else if (candle) {
      // 起きたばかり：暗い部屋に、ろうそくが1本
      rect(WX, WY, WW, WH, M.ROOM);
      const cx = 4;
      const cy = 6;
      const waver = calm ? 0 : Math.sin(anim * 7.3) * 0.35;
      for (let y = 0; y < WH; y++) {
        for (let x = 0; x < WW; x++) {
          const d = Math.hypot(x - cx, y - cy) + waver;
          if (d < 1.7) {
            put(WX + x, WY + y, M.LIT_DK);
            emit(WX + x, WY + y, 130, 0);
          } else if (d < 4 && bayerAt(x, y) < (4 - d) * 6) {
            put(WX + x, WY + y, M.EMBER);
            emit(WX + x, WY + y, 60, 0);
          }
        }
      }
      put(WX + cx, WY + cy, M.LIT_HI);
      emit(WX + cx, WY + cy, 255, 0);
      rect(WX + cx, WY + cy + 1, 1, 2, M.FLAME);
      if (res.inside) blit(SPR.sil, WX + 6, WY + 4, false, M.SIL);
    } else {
      // 眠っている：暗いガラス。斜めの映り込み
      rect(WX, WY, WW, WH, M.GLASS);
      for (let i = 0; i < 6; i++) {
        put(WX + 2 + i, WY + 7 - i, M.GLASS_HI);
        if (i < 4) put(WX + 6 + i, WY + 8 - i, M.GLASS_HI);
      }
    }

    // 桟
    rect(WX + 6, WY, 2, 2, M.WOOD_DK);
    rect(WX, WY + 4, 1, 1, M.WOOD_DK);
    rect(WX + 13, WY + 4, 1, 1, M.WOOD_DK);

    // 鎧戸：眠るあいだは閉じ、起きると開く
    const closed = asleep ? 1 : 0;
    shutter += calm ? closed - shutter : clamp(closed - shutter, -0.09, 0.09);
    const leaf = Math.round(shutter * 7);
    const drawLeaf = (x0, w) => {
      for (let i = 0; i < w; i++) {
        for (let y = 0; y < 14; y++) put(x0 + i, 60 + y, y % 2 === 0 ? M.WOOD : M.WOOD_LT);
      }
    };
    // 開いている鎧戸は窓の両わきに、閉じると窓の上に
    const open = 4 - Math.min(4, leaf);
    if (open > 0) {
      drawLeaf(44 - open, open);
      drawLeaf(62, open);
    }
    if (leaf > 0) {
      drawLeaf(46, leaf);
      drawLeaf(60 - leaf, leaf);
    }

    return { fire, candle, asleep };
  };

  const drawDoor = (state) => {
    // 戸の小窓にも、火の色が映る
    if (state.fire) {
      rect(69, 68, 8, 3, M.LIT_DK);
      for (let y = 68; y < 71; y++) for (let x = 69; x < 77; x++) emit(x, y, 90 * lampFlick, 0);
    }
    if (res.doorOpen > 0) {
      if (state.fire) {
        // 開いた戸口から、部屋の明かりがこぼれる
        rect(68, 67, 10, 18, M.LIT);
        for (let y = 67; y < 85; y += 2) for (let x = 68; x < 78; x += 2) emit(x, y, 230, 0);
      } else {
        rect(68, 67, 10, 18, M.SIL);
      }
      rect(68, 67, 2, 18, M.WOOD_LT);
    }
  };

  const poolAt = (x, y) => {
    let v = 0;
    for (const [cx, cy, rx, ry, L] of pools) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d < 1) v = Math.max(v, (1 - d) * L * 1.5);
    }
    return v;
  };

  const drawLights = (state, t) => {
    // 灯りの強さ
    const targetWin = state.fire ? 1 : state.candle ? 0.2 : 0;
    const targetLan = t >= 0.72 ? 1 : 0;
    windowL += (targetWin - windowL) * (calm ? 1 : 0.28);
    lanternL += (targetLan - lanternL) * (calm ? 1 : 0.28);

    // 軒下の灯り
    if (lanternL > 0.02) {
      const flick = calm ? 1 : 0.94 + 0.06 * Math.sin(anim * 11) * Math.sin(anim * 3.7);
      rect(64, 64, 3, 1, M.WOOD_DK);
      rect(64, 65, 3, 3, M.LIT_HI);
      rect(64, 68, 3, 1, M.WOOD_DK);
      for (let y = 65; y < 68; y++) for (let x = 64; x < 67; x++) emit(x, y, 255 * lanternL * flick, 0);
    } else {
      rect(64, 64, 3, 1, M.WOOD_DK);
      rect(64, 65, 3, 3, M.GLASS);
      rect(64, 68, 3, 1, M.WOOD_DK);
    }

    // 窓から雪へ落ちる光、壁を照らす光、軒の灯りの輪。火のゆらぎで、ふちが息をする
    pools.length = 0;
    const add = (cx, cy, rx, ry, L) => {
      if (L > 0.01) pools.push([cx, cy, rx, ry, L]);
    };
    add(53, 92, 26, 12, windowL * 0.95 * lampFlick);
    add(53, 67, 17, 10, windowL * 0.36 * lampFlick);
    add(65, 69, 11, 13, lanternL * 0.5);
    add(65, 90, 19, 7, lanternL * 0.6);
    if (res.doorOpen > 0 && state.fire) add(73, 91, 13, 9, 0.9);

    for (const [cx, cy, rx, ry, L] of pools) {
      for (let y = Math.max(cy - ry, -oy); y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const px = x + ox;
          const py = y + oy;
          if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
          const i = py * bw + px;
          if (NO_POOL[matBuf[i]]) continue;
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          const v = (1 - d) * L * 1.5;
          if (v * 16 > bayerAt(x, y)) varBuf[i] = 2;
        }
      }
    }
  };

  // キツネ：雪がおさまると、ときどき手前を横切る。途中で立ち止まり、小屋の灯りを見る
  const stepFox = (dt, t) => {
    if (calm) return;
    if (!fox.on) {
      if (t < 1.02) return;
      fox.next -= dt;
      if (fox.next > 0) return;
      fox.on = true;
      fox.bolt = false;
      fox.paused = false;
      fox.pause = 0;
      fox.dir = Math.random() < 0.5 ? 1 : -1;
      fox.x = fox.dir > 0 ? -ox - 14 : bw - ox + 3;
      fox.stopAt = 84 + Math.random() * 70;
    }
    // つまみを速く動かしたり、吹雪が戻ったりすると、逃げていく
    if (res.startle > 0 || t < 0.9) fox.bolt = true;
    if (!fox.paused && !fox.bolt && (fox.dir > 0 ? fox.x >= fox.stopAt : fox.x <= fox.stopAt)) {
      fox.paused = true;
      fox.pause = 2 + Math.random() * 2.4;
    }
    if (fox.pause > 0 && !fox.bolt) {
      fox.pause -= dt;
    } else {
      const speed = fox.bolt ? 96 : 20;
      fox.x += fox.dir * speed * dt;
      fox.step += speed * dt * 0.2;
    }
    if (fox.x < -ox - 16 || fox.x > bw - ox + 5) {
      fox.on = false;
      fox.next = 13 + Math.random() * 16;
    }
  };
  const drawFox = () => {
    if (!fox.on || calm) return;
    const still = fox.pause > 0 && !fox.bolt;
    blit(SPR.fox[still ? 0 : Math.floor(fox.step) % 2], Math.round(fox.x), 95, fox.dir < 0);
  };

  const drawResident = (plan) => {
    if (res.inside) return;
    const base = 89;
    const dy = -Math.round(res.hop);
    const startled = res.startle > 0;
    const moving = Math.abs((plan.outside ? plan.x : HOME_X) - res.x) > 0.5;
    let spr = SPR.stand;
    let flip = res.face < 0;
    if (startled) {
      spr = SPR.up;
    } else if (moving) {
      spr = SPR.walk[Math.floor(res.step) % 4];
    } else if (plan.act === 'gaze') {
      // 月のほうを向いて、空を見上げる。ときどき小屋をふり返る
      const glance = !calm && Math.sin(anim * 0.37) > 0.9;
      spr = glance ? SPR.stand : res.blink > 0 ? SPR.blink : SPR.gaze;
      flip = true;
    } else if (res.blink > 0) {
      spr = SPR.blink;
    }
    res.look = flip ? -1 : 1;
    blit(spr, Math.round(res.x) - 3, base - 12 + dy, flip);
    if (startled) {
      rect(Math.round(res.x), base - 19 + dy, 1, 4, M.MARK);
      put(Math.round(res.x), base - 14 + dy, M.MARK);
    }
  };

  const drawCanopy = () => {
    for (const p of pines) {
      const span = p.bottom - p.top;
      const list = p.list;
      for (let i = 0; i < list.length; i += 3) {
        const y = list[i + 1];
        // 風：梢ほど大きく、段ごとにずれて揺れる。吹雪では強くしなる
        const amp = (0.34 + wind * 1.5) * clamp((p.bottom - y) / span) * 1.5;
        const sway = calm ? 0 : Math.round(Math.sin(swayPhase + y * 0.11 + p.seed) * amp);
        put(list[i] + sway, y, list[i + 2]);
      }
    }
  };

  const hashRow = (n) => {
    let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  };

  // 雪片などを置き、灯りの輪の中なら火の色に染める
  const dot = (x, y, m) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return;
    const i = py * bw + px;
    if (NO_SNOW[matBuf[i]]) return;
    matBuf[i] = m;
    if (pools.length) {
      const v = poolAt(x, y);
      if (v * 16 > bayerAt(x, y)) varBuf[i] = 2;
    }
  };

  const drawParticles = (t, dt) => {
    const fireOn = t >= 0.3;

    // 煙突の煙：風があると、横へ流される
    if (!calm && fireOn) {
      smokeAcc += dt * mix(1.3, 3.2, smoothstep(0.3, 0.85, t));
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        smoke.push({ x: 71 + Math.random() * 2, y: 19, t: 0, seed: Math.random() * 10 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.t += dt;
      s.y -= dt * (7 - s.t * 0.8) * (1 - wind * 0.5);
      s.x += dt * (2.2 + wind * 30 + Math.sin(s.t * 1.7 + s.seed) * 2.6);
      if (s.t > 4.2 || s.y < -oy - 4 || calm) {
        smoke.splice(i, 1);
        continue;
      }
      const size = 1 + Math.floor(s.t * 0.75);
      const thin = s.t * 2.6;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const x = Math.round(s.x) + dx;
          const y = Math.round(s.y) + dy;
          if (bayerAt(x, y) < 16 - thin * 1.3) put(x, y, s.t > 2.3 ? M.SMOKE_DK : M.SMOKE);
        }
      }
    }
    if (calm && fireOn) {
      for (let i = 0; i < 5; i++) rect(72 + i * 2, 16 - i * 4, 1 + (i >> 1), 2, M.SMOKE);
    }

    // 火の粉
    if (!calm && fireOn && Math.random() < dt * 1.5) {
      sparks.push({ x: 71 + Math.random() * 3, y: 20, t: 0, seed: Math.random() * 6, life: 0.6 + Math.random() * 0.8 });
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += dt;
      s.y -= dt * 11;
      s.x += dt * (3 + wind * 28 + Math.sin(s.t * 9 + s.seed) * 5);
      if (s.t > s.life || calm) {
        sparks.splice(i, 1);
        continue;
      }
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      put(x, y, M.LIT_HI);
      emit(x, y, 150 * (1 - s.t / s.life));
    }

    // 眠りの Z
    if (!calm && t < 0.1) {
      zeeAcc += dt * 0.62;
      while (zeeAcc >= 1) {
        zeeAcc -= 1;
        zees.push({ x: 60, y: 58, t: 0 });
      }
    }
    for (let i = zees.length - 1; i >= 0; i--) {
      const z = zees[i];
      z.t += dt;
      z.y -= dt * 4;
      z.x += dt * (1.2 + Math.sin(z.t * 2) * 2);
      if (z.t > 3 || t >= 0.12 || calm) {
        zees.splice(i, 1);
        continue;
      }
      const x = Math.round(z.x);
      const y = Math.round(z.y);
      const big = z.t > 1.2;
      const n = big ? 3 : 2;
      rect(x, y, n, 1, M.ZZZ);
      put(x + n - 2, y + 1, M.ZZZ);
      if (big) put(x, y + 2, M.ZZZ);
      rect(x, y + (big ? 3 : 2), n, 1, M.ZZZ);
    }

    // 白い息
    if (!calm && !res.inside) {
      breathAcc += dt;
      if (breathAcc > 2.4) {
        breathAcc = 0;
        puffs.push({ x: res.x + res.look * 4, y: 80, t: 0, dir: res.look });
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.t += dt;
      p.y -= dt * 3.2;
      p.x += dt * (p.dir * 2.4 + wind * 10);
      if (p.t > 1.1 || calm) {
        puffs.splice(i, 1);
        continue;
      }
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      put(x, y, M.SMOKE);
      if (p.t > 0.35 && p.t < 0.9) put(x + p.dir, y - 1, M.SMOKE_DK);
    }

    // 枝から落ちる雪
    if (!calm && Math.random() < dt * (0.1 + wind * 0.5)) {
      const big = pines[0];
      const y = big.top + 18 + Math.random() * (big.bottom - big.top - 26);
      const half = (big.w * (y - big.top)) / (big.bottom - big.top);
      clumps.push({ x: big.cx + (Math.random() - 0.5) * 1.5 * half, y, vy: 0 });
    }
    for (let i = clumps.length - 1; i >= 0; i--) {
      const c = clumps[i];
      c.vy += dt * 70;
      c.y += c.vy * dt;
      c.x += wind * 18 * dt;
      if (c.y > 90 || calm) {
        clumps.splice(i, 1);
        continue;
      }
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      put(x, y, M.ROOF_SNOW_HI);
      put(x + 1, y, M.ROOF_SNOW);
      put(x, y - 1, M.FLAKE_DIM);
      put(x + 1, y - 2, M.FLAKE_DIM);
    }

    // 月明かりに、雪の粒が光る
    const glitter = smoothstep(1.35, 1.8, t);
    if (glitter > 0.05 && !calm) {
      for (const s of sparkles) {
        if (Math.sin(anim * s.rate + s.seed) < 1 - glitter * 0.16) continue;
        const px = s.x + ox;
        const py = s.y + oy;
        if (px < 1 || py < 0 || px >= bw - 1 || py >= bh) continue;
        const i = py * bw + px;
        if (!IS_GROUND[matBuf[i]]) continue;
        matBuf[i] = M.FLAKE;
        if (IS_GROUND[matBuf[i - 1]]) matBuf[i - 1] = M.SNOW_HI;
        if (IS_GROUND[matBuf[i + 1]]) matBuf[i + 1] = M.SNOW_HI;
      }
    }

    // 降る雪：奥は小さく遅く、手前は明るく速い。吹雪では横なぐりに尾を引く
    for (const f of flakes) {
      if (!calm) {
        const sp = f.layer === 0 ? 0.55 : f.layer === 1 ? 0.8 : 1.15;
        f.y += dt * (8 + wind * 30) * sp * f.fall;
        f.x += dt * ((1.5 + wind * 64) * sp + Math.sin(anim * f.wf + f.seed) * (3.5 - wind * 2));
        if (f.y >= bh - oy) {
          f.y -= bh;
          f.x = Math.random() * bw - ox;
        }
        if (f.x >= bw - ox) f.x -= bw;
        else if (f.x < -ox) f.x += bw;
      }
      if (f.rank > snowAmt) continue;
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      if (f.layer === 0) {
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
        const i = py * bw + px;
        if (FAR_OK[matBuf[i]]) matBuf[i] = M.FLAKE_DIM;
        continue;
      }
      dot(x, y, f.layer === 2 || f.rank < 0.2 ? M.FLAKE : M.FLAKE_DIM);
      if (f.layer === 2 && wind > 0.45 && !calm) {
        dot(x - 1, y, M.FLAKE_DIM);
        if (wind > 0.75) dot(x - 2, y - 1, M.FLAKE_DIM);
      }
    }

    // 吹雪の幕：風に乗った細かい雪が、行ごとに違う速さで流れていく
    const storm = clamp((wind - 0.28) / 0.72);
    if (!calm && storm > 0.03) {
      const fallRows = Math.floor(anim * 16);
      for (let py = 0; py < bh; py++) {
        const y = py - oy;
        const h = hashRow(y - fallRows);
        const period = 17 + (h % 13);
        const speed = 46 + ((h >>> 8) % 50);
        const offset = Math.floor(anim * speed + ((h >>> 16) % 97)) % period;
        for (let px = offset; px < bw; px += period) {
          const x = px - ox;
          if (noiseA((x - anim * 70) * 0.021, y * 0.06 + anim * 0.25) < 0.85 - storm * 0.42) continue;
          const i = py * bw + px;
          if (NO_SNOW[matBuf[i]]) continue;
          matBuf[i] = M.FLAKE_DIM;
          if (px > 0 && !NO_SNOW[matBuf[i - 1]]) matBuf[i - 1] = M.FLAKE_DIM;
        }
      }
    }
  };

  // ---- 世界を1枚描く
  let keyA = 0;
  let keyB = 1;
  let keyP = 0;
  const pickKeys = (t) => {
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i][0] && t < KEYS[i + 1][0]) {
        keyA = i;
        keyB = i + 1;
        keyP = clamp(((t - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]) - 0.32) / 0.36);
        return;
      }
    }
    keyA = 0;
    keyB = 1;
    keyP = 0;
  };

  const renderWorld = (clock, dt, hurry) => {
    const t = clamp(clock, T_DARK, T_CLEAR);
    if (!calm) {
      anim += dt;
      swayPhase += dt * (0.9 + wind * 2.4);
    }
    matBuf.set(baseBuf);
    varBuf.fill(0);
    emitList.length = 0;
    for (const c of sources) {
      c.w = 0;
      c.x = 0;
      c.y = 0;
    }
    lampFlick = calm ? 1 : 0.94 + 0.06 * Math.sin(anim * 13) * Math.sin(anim * 5.3) + 0.03 * Math.sin(anim * 23.7);
    // 風と雪の量：吹雪は灯りがともるころにおさまり、月が出るころには小降りになる
    wind = 0.1 + 0.9 * (1 - smoothstep(0.18, 0.9, t)) - 0.06 * smoothstep(1.1, 1.9, t);
    snowAmt = mix(mix(1, 0.44, smoothstep(0.2, 0.95, t)), 0.15, smoothstep(1.1, 1.9, t));

    if (!calm) {
      shoot.next -= dt;
      if (shoot.t >= 0) {
        shoot.t += dt;
        if (shoot.t > 0.6) shoot.t = -1;
      } else if (shoot.next <= 0) {
        shoot.t = 0;
        shoot.next = 9 + Math.random() * 16;
        shoot.x = 60 + Math.random() * 90;
        shoot.y = 2 + Math.random() * 16;
      }
      // 吹雪は、足あとを消していく
      if (wind > 0.5 && prints.length && Math.random() < dt * 7 * wind) prints.splice(0, 2);
    }

    const plan = stepResident(dt, t, hurry);
    stepFox(dt, t);
    drawSky(t, dt);
    drawShadows(t);
    drawPrints();
    const state = drawWindow(t);
    drawDoor(state);
    drawLights(state, t);
    drawFox();
    drawResident(plan);
    drawCanopy();
    drawParticles(t, dt);

    // ---- 材質 → パレット。天気のかなめのあいだは、ディザで置き換える
    pickKeys(t);
    const ta = table[keyA];
    const tb = table[keyB];
    const sa = skyKeys[keyA];
    const sb = skyKeys[keyB];
    const p = keyP * 16;
    const n = bw * bh;
    for (let i = 0; i < n; i++) {
      const m = matBuf[i];
      const useB = thrA[i] < p;
      const idx = m === 0 ? (useB ? sb[i] : sa[i]) : (useB ? tb : ta)[varBuf[i] * NM + m];
      pixels[i] = palette32[idx];
    }
  };

  // ---- 光の場：世界の光る画素を格子に集めて、ぼかす
  const GRID_W = 72;
  let GRID_H = 44;
  let glowRaw = new Float32Array(1);
  let glowNearBuf = new Float32Array(1);
  let glowFarBuf = new Float32Array(1);
  let glowTemp = new Float32Array(1);

  const boxBlur = (src, dst, w, h, r) => {
    const size = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let x = -r; x <= r; x++) sum += src[row + clamp(x, 0, w - 1) * 4 + c];
        for (let x = 0; x < w; x++) {
          dst[row + x * 4 + c] = sum / size;
          sum += src[row + clamp(x + r + 1, 0, w - 1) * 4 + c] - src[row + clamp(x - r, 0, w - 1) * 4 + c];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) sum += dst[clamp(y, 0, h - 1) * w * 4 + x * 4 + c];
        for (let y = 0; y < h; y++) {
          src[y * w * 4 + x * 4 + c] = sum / size;
          sum += dst[clamp(y + r + 1, 0, h - 1) * w * 4 + x * 4 + c] - dst[clamp(y - r, 0, h - 1) * w * 4 + x * 4 + c];
        }
      }
    }
  };

  // ---- WebGL
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch {
    gl = null;
  }
  let program = null;
  const loc = {};
  let vao = null;
  let quad = null;
  let texWorld = null;
  let texNear = null;

  const compile = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const setupGl = () => {
    if (!gl) return false;
    try {
      program = gl.createProgram();
      const v = compile(gl.VERTEX_SHADER, VERT);
      const f = compile(gl.FRAGMENT_SHADER, FRAG);
      gl.attachShader(program, v);
      gl.attachShader(program, f);
      gl.bindAttribLocation(program, 0, 'aPos');
      gl.linkProgram(program);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link');
    } catch (error) {
      console.warn('toggle-snow-cabin: シェーダーを作れないので、2D で描く', error);
      return false;
    }
    gl.useProgram(program);
    for (const name of ['uWorld', 'uGlowNear', 'uRes', 'uPill', 'uOrigin', 'uWorldSize', 'uGlowSize', 'uLens', 'uBezel', 'uK', 'uNight', 'uLift', 'uSeam', 'uCalm', 'uShellDay', 'uShellNight', 'uInk', 'uLight', 'uHiNight', 'uLoNight', 'uSkyDay', 'uHomeCol', 'uSkyCol', 'uHomePos', 'uSkyPos']) {
      loc[name] = gl.getUniformLocation(program, name);
    }
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const makeTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    texWorld = makeTex();
    texNear = makeTex();
    gl.uniform1i(loc.uWorld, 0);
    gl.uniform1i(loc.uGlowNear, 1);
    gl.disable(gl.BLEND);
    return true;
  };
  let ready = setupGl();
  // 文脈が失われているだけなら、2D へ落とさず戻るのを待つ（スマホでは、タブを離れて戻ると起きる）
  let lost = !ready && !!gl && gl.isContextLost();
  let ctx2d = null;
  let lowCanvas = null;
  const useCanvas2d = () => {
    // 1つの canvas に2種類の文脈は持てないので、作り直す
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh);
    canvas = fresh;
    ctx2d = canvas.getContext('2d');
  };
  if (!ready && !lost) useCanvas2d();

  // ---- 形と大きさ
  const shape = { W: 1, H: 1, cssW: 1, cssH: 1, dpr: 1, pillW: 1, pillH: 1, bezel: 1, winW: 1, winH: 1, r0: 1, travel: 1, travelCss: 1, ox: 0, oy: 0 };
  let renderScale = 1;
  let fullK = 1; // 解像度を落としていないときの整数倍
  let thumbSeam = 1;

  // 整数倍を高さで決める。切れるのが 12% までなら大きい方。横は景色が両わきへ広がる
  const pickK = (winH) => {
    const whole = Math.max(1, Math.floor(winH / CORE_H));
    return ((whole + 1) * CORE_H) / winH <= 1.12 ? whole + 1 : whole;
  };

  const measure = () => {
    const box = root.getBoundingClientRect();
    const fullDpr = Math.min(2, devicePixelRatio || 1);
    const nextFullK = pickK((Math.round(box.height * fullDpr) / 1.32) * (1 - 0.046 * 2));
    if (nextFullK !== fullK) {
      fullK = nextFullK;
      renderScale = 1;
    }
    const dpr = fullDpr * renderScale;
    const W = Math.max(2, Math.round(box.width * dpr));
    const H = Math.max(2, Math.round(box.height * dpr));
    const changed = W !== shape.W || H !== shape.H;
    shape.W = W;
    shape.H = H;
    shape.cssW = box.width;
    shape.cssH = box.height;
    shape.dpr = dpr;
    // 丸の大きさ：根の中に、1 : 1.85 で置く
    shape.pillH = H / 1.32;
    shape.pillW = shape.pillH * PILL_RATIO;
    shape.bezel = shape.pillH * 0.046;
    shape.winW = shape.pillW - shape.bezel * 2;
    shape.winH = shape.pillH - shape.bezel * 2;
    const gap = shape.pillH * 0.032;
    shape.r0 = shape.winH / 2 - gap;
    shape.travel = shape.winW - (shape.r0 + gap) * 2;
    shape.travelCss = shape.travel / dpr;

    // 画素の格子に合わせる（半端な位置だと、全体がにじむ）
    canvas.style.width = `${W / dpr}px`;
    canvas.style.height = `${H / dpr}px`;
    // DPR が上限の 2 を超える端末では、ブラウザが canvas を拡大する。合わせる格子は端末の画素
    const grid = Math.max(devicePixelRatio || 1, dpr);
    const fx = (box.left * grid) % 1;
    const fy = (box.top * grid) % 1;
    canvas.style.transform = `translate(${-fx / grid}px, ${-fy / grid}px)`;

    if (!changed) return false;
    canvas.width = W;
    canvas.height = H;

    // 解像度を落としても、景色の見え方は変えない（renderScale は整数倍が割り切れる値だけを取る）
    k = Math.max(1, Math.round(fullK * renderScale));
    const needW = Math.ceil(shape.winW / k) + MARGIN * 2;
    const needH = Math.ceil(shape.winH / k) + MARGIN * 2;
    bw = needW + (needW & 1);
    bh = needH + (needH & 1);
    ox = (bw - CORE_W) >> 1;
    oy = (bh - CORE_H) >> 1;
    matBuf = new Uint8Array(bw * bh);
    baseBuf = new Uint8Array(bw * bh);
    varBuf = new Uint8Array(bw * bh);
    pixels = new Uint32Array(bw * bh);
    pixelBytes = new Uint8Array(pixels.buffer);
    thrA = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        // 時刻の置き換えは、空の市松と重ならないよう、位置をずらす
        thrA[y * bw + x] = bayerAt(x + 1, y + 2);
      }
    }
    buildBase();

    // 世界の左上の、画面の画素での位置（必ず整数）
    shape.ox = Math.floor(W / 2 - (bw * k) / 2);
    shape.oy = Math.floor(H / 2 + (bh * k) / 2);
    thumbSeam = Math.max(1, Math.round(k * 0.055));

    GRID_H = Math.max(8, Math.round((GRID_W * H) / W));
    const size = GRID_W * GRID_H * 4;
    glowRaw = new Float32Array(size);
    glowNearBuf = new Float32Array(size);
    glowFarBuf = new Float32Array(size);
    glowTemp = new Float32Array(size);

    if (ready) {
      gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texWorld);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texNear);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, GRID_W, GRID_H, 0, gl.RGBA, gl.FLOAT, null);
    } else {
      lowCanvas = offscreen(bw, bh);
    }
    return true;
  };

  const uploadWorld = () => {
    // 光の場
    glowRaw.fill(0);
    for (let e = 0; e < emitList.length; e += 2) {
      const i = emitList[e];
      const w = emitList[e + 1] / 255;
      const px = i % bw;
      const py = (i - px) / bw;
      const fx = ((shape.ox + (px + 0.5) * k) / shape.W) * GRID_W;
      const fy = ((shape.H - shape.oy + (py + 0.5) * k) / shape.H) * GRID_H;
      const gx = clamp(Math.floor(fx), 0, GRID_W - 1);
      const gy = clamp(Math.floor(fy), 0, GRID_H - 1);
      const c = pixels[i];
      const at = (gy * GRID_W + gx) * 4;
      glowRaw[at] += (c & 255) * w * 0.0007;
      glowRaw[at + 1] += ((c >>> 8) & 255) * w * 0.0007;
      glowRaw[at + 2] += ((c >>> 16) & 255) * w * 0.0007;
    }
    glowNearBuf.set(glowRaw);
    boxBlur(glowNearBuf, glowTemp, GRID_W, GRID_H, 1);
    boxBlur(glowNearBuf, glowTemp, GRID_W, GRID_H, 1);
    // 芯のにじみに、広いにじみを足す
    glowFarBuf.set(glowRaw);
    boxBlur(glowFarBuf, glowTemp, GRID_W, GRID_H, 3);
    boxBlur(glowFarBuf, glowTemp, GRID_W, GRID_H, 3);
    for (let i = 0; i < glowNearBuf.length; i++) glowNearBuf[i] += glowFarBuf[i] * 0.55;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texWorld);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, pixelBytes);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texNear);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_W, GRID_H, gl.RGBA, gl.FLOAT, glowNearBuf);
  };

  // ---- つまみの状態
  let x = 1; // 0 = 灯りを消した夜、1 = 灯りのともった夜。はじめは、ともっている
  let velocity = 0;
  let target = 1;
  let moving = false;
  let checked = true;
  let stretch = 0;
  let stretchV = 0;
  let lift = 0;
  let liftTarget = 0;
  let hurry = 0;

  // 物語の流れ：右へは、吹雪の闇から灯りのともる夜へ。右端にとどまると、雪がやんで月がのぼる。
  // 右端から戻るときは、そこまでの夜を逆にたどる（月が沈み、吹雪が戻り、灯りが消える）
  let branch = 'pm';
  let amStart = T_LIT;
  let nightClock = T_LIT;
  const clockOf = () => {
    if (branch === 'am') return mix(T_DARK, amStart, x);
    if (x >= 1) return nightClock;
    return T_DARK + (T_LIT - T_DARK) * x;
  };
  const beginTravel = () => {
    if (x <= 0.0005) branch = 'pm';
    else if (x >= 0.9995) {
      branch = 'am';
      amStart = nightClock;
    }
  };

  const setStatus = (text) => {
    if (statusEl.textContent !== text) statusEl.textContent = text;
  };
  const phaseName = (t) => (t < 0.12 ? '吹雪の夜、灯りは消えている' : t < 0.3 ? 'ろうそくの灯り' : t < 0.72 ? '暖炉に火が入った' : t < 1.2 ? '灯りがともっている' : t < 1.7 ? '雪がやんできた' : '月夜');

  const commit = (value) => {
    const night = value >= 1;
    x = night ? 1 : 0;
    velocity = 0;
    moving = false;
    if (night) {
      nightClock = branch === 'am' ? amStart : T_LIT;
      branch = 'pm';
    } else {
      branch = 'pm';
    }
    if (checked !== night) {
      checked = night;
      button.setAttribute('aria-checked', String(night));
      root.dispatchEvent(new CustomEvent('cabin:change', { bubbles: true, composed: true, detail: { lit: night } }));
    }
    setStatus(night ? '灯りがともった' : '灯りが消えた');
  };

  // ---- 描く
  const drawGl = (night) => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(loc.uRes, shape.W, shape.H);
    gl.uniform2f(loc.uPill, shape.pillW / 2, shape.pillH / 2);
    gl.uniform2f(loc.uOrigin, shape.ox, shape.oy);
    gl.uniform2f(loc.uWorldSize, bw, bh);
    gl.uniform2f(loc.uGlowSize, GRID_W, GRID_H);
    gl.uniform1f(loc.uBezel, shape.bezel);
    gl.uniform1f(loc.uK, k);
    gl.uniform1f(loc.uNight, night);
    gl.uniform1f(loc.uLift, lift);
    gl.uniform1f(loc.uSeam, thumbSeam);
    gl.uniform1f(loc.uCalm, calm ? 1 : 0);

    // レンズの形：動くと伸び、離すと弾んで戻る
    const s = clamp(stretch, -0.5, 1.2);
    const r = shape.r0 * (1 + 0.012 * lift);
    const halfX = r * (1 + 0.2 * s);
    const halfY = r * (1 - 0.075 * s);
    const lim = shape.winW / 2 - (shape.winH / 2 - shape.r0) - halfX;
    const raw = (x - 0.5) * shape.travel;
    const cx = clamp(raw, -lim, lim);
    gl.uniform4f(loc.uLens, cx, 0, halfX, halfY);

    // 殻はいつも夜の色。月が出ると、わずかに明るく青くなる
    gl.uniform3fv(loc.uShellDay, tones.shellMoon);
    gl.uniform3fv(loc.uShellNight, tones.shell);
    gl.uniform3fv(loc.uInk, tones.ink);
    gl.uniform3fv(loc.uLight, unit(C3));
    gl.uniform3fv(loc.uHiNight, tones.hi);
    gl.uniform3fv(loc.uLoNight, tones.lo);
    gl.uniform3fv(loc.uSkyDay, unit(U2));
    // 光る画素の重心と強さ。人影が窓を隠せば弱くなる
    const homeW = sources[0].w;
    const home = unit(A2);
    const homeI = (homeW / 255 / 150) * 1.05;
    const hx = homeW > 0 ? shape.ox + (sources[0].x / homeW + 0.5) * k - shape.W / 2 : 0;
    const hy = homeW > 0 ? shape.oy - (sources[0].y / homeW + 0.5) * k - shape.H / 2 : 0;
    gl.uniform2f(loc.uHomePos, hx, hy);
    gl.uniform3f(loc.uHomeCol, home[0] * homeI, home[1] * homeI, home[2] * homeI);
    const skyW = sources[1].w;
    // 月の光は冷たい白。殻のふちに、うっすら映る
    const skyU = unit(C2);
    const skyI = (skyW / 255 / 110) * 2.4;
    const sx = skyW > 0 ? shape.ox + (sources[1].x / skyW + 0.5) * k - shape.W / 2 : 0;
    const sy = skyW > 0 ? shape.oy - (sources[1].y / skyW + 0.5) * k - shape.H / 2 : 0;
    gl.uniform2f(loc.uSkyPos, sx, sy);
    gl.uniform3f(loc.uSkyCol, skyU[0] * skyI, skyU[1] * skyI, skyU[2] * skyI);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const draw2d = (night) => {
    // WebGL が使えないとき：世界だけを整数倍で写し、丸く切って、つまみを置く
    const g = ctx2d;
    const low = lowCanvas.getContext('2d');
    low.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), bw, bh), 0, 0);
    g.clearRect(0, 0, shape.W, shape.H);
    const px = (shape.W - shape.pillW) / 2;
    const py = (shape.H - shape.pillH) / 2;
    g.save();
    g.beginPath();
    g.roundRect(px, py, shape.pillW, shape.pillH, shape.pillH / 2);
    g.clip();
    g.imageSmoothingEnabled = false;
    g.drawImage(lowCanvas, shape.ox, shape.H - shape.oy, bw * k, bh * k);
    g.restore();
    const cx = shape.W / 2 + (x - 0.5) * shape.travel;
    const light = unit(C3).map((v) => Math.round(v * 255));
    g.fillStyle = `rgb(${light[0]} ${light[1]} ${light[2]} / 0.5)`;
    g.beginPath();
    g.arc(cx, shape.H / 2, shape.r0, 0, Math.PI * 2);
    g.fill();
    return night;
  };

  // ---- 時間を進める
  let raf = 0;
  let last = 0;
  let visible = true;
  let pageVisible = root.ownerDocument.visibilityState !== 'hidden';
  let worldAcc = 1;
  let dirty = true;
  let slow = 0;
  let good = 0;
  let frames = 0;
  let lastWorldClock = -1;
  let lastNightText = '';
  let drag = null;

  // 殻とガラスの暗さ：月が出ると、映り込みが少し明るくなる
  const shellNight = (t) => 1 - 0.22 * smoothstep(1.3, 1.9, t);
  // 灯りのあたたかさ（0 = 消えている、1 = ともっている）
  const warmthOf = (t) => smoothstep(0.12, 0.8, t);

  // 描くのに本当に時間がかかっているときだけ、細かさを落とす。
  // コマが少ないだけでは決めない。省電力モードやブラウザの間引きで 30 コマになっている端末では、解像度を下げても速くならず、絵だけが悪くなる。
  const OVERLOAD_MS = 12;
  const COST_SAMPLES = 5;
  const onePixel = new Uint8Array(4);
  let costLeft = 0;
  let costs = [];
  let weighedOnce = false;

  const lowerResolution = () => {
    // 整数倍が割り切れる値にだけ下げる。景色の見え方は変わらない
    const next = (k - 1) / fullK;
    if (k < 2 || next < 0.5) {
      frames = -600; // もう下げられない。しばらく測らない
      return;
    }
    renderScale = next;
    measure();
    dirty = true;
    lastWorldClock = -1;
    frames = 0;
  };

  const adapt = (dt) => {
    ++frames;
    // 重い GPU でも、世界だけが動く 30 コマなら遅れが見えないことがある。つまみを動かす前に、一度は測っておく
    if (frames === 40 && !weighedOnce) {
      weighedOnce = true;
      costLeft = COST_SAMPLES;
      costs = [];
    }
    if (frames < 40) return;
    if (dt > 0.0225) slow++;
    else good++;
    if (slow + good < 50) return;
    const suspect = slow > 30;
    slow = 0;
    good = 0;
    if (suspect) {
      costLeft = COST_SAMPLES;
      costs = [];
    }
  };

  const weighCost = (startedAt) => {
    // readPixels は、ここまでの描画が終わるのを待つ。これで GPU の分も含めた1コマの重さがわかる
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, onePixel);
    costs.push(performance.now() - startedAt);
    if (--costLeft > 0) return;
    const median = costs.sort((a, b) => a - b)[costs.length >> 1];
    if (median > OVERLOAD_MS) lowerResolution();
    else frames = -600; // 重くないなら、しばらく測らない
  };

  const tick = (ms) => {
    raf = 0;
    if (lost) return;
    const t = ms / 1000;
    const dt = last ? Math.min(0.05, t - last) : 1 / 60;
    last = t;

    if (!calm && ready) adapt(dt);

    // ---- つまみ
    if (drag) {
      const before = x;
      x += (clamp(drag.want) - x) * (1 - Math.exp(-dt * 34));
      velocity = (x - before) / Math.max(dt, 1 / 240);
      dirty = true;
    } else if (moving) {
      // なめらかに減速して吸い付く
      const omega = calm ? 16 : 9.5;
      const accel = omega * omega * (target - x) - 2 * omega * velocity;
      velocity += accel * dt;
      x += velocity * dt;
      dirty = true;
      if (Math.abs(target - x) < 0.0015 && Math.abs(velocity) < 0.03) {
        x = target;
        if (x <= 0 || x >= 1) {
          if (!calm) stretchV -= 3.2;
          commit(x);
        } else {
          velocity = 0;
          moving = false;
        }
      }
      x = clamp(x);
    } else {
      velocity = 0;
    }

    // ---- レンズの弾み
    if (!calm) {
      const goal = clamp(Math.abs(velocity) * 0.42);
      stretchV += (170 * (goal - stretch) - 11 * stretchV) * dt;
      stretch += stretchV * dt;
      lift += (liftTarget - lift) * (1 - Math.exp(-dt * 14));
      if (Math.abs(stretch) > 0.002 || Math.abs(stretchV) > 0.01 || Math.abs(liftTarget - lift) > 0.002) dirty = true;
    } else {
      stretch = 0;
      stretchV = 0;
      lift = liftTarget;
    }

    // ---- 右端では、夜が静かに進み、やがて雪がやんで月がのぼる
    if (!calm && x >= 1 && !moving && !drag && nightClock < T_CLEAR) {
      nightClock = Math.min(T_CLEAR, nightClock + (dt * (T_CLEAR - T_LIT)) / CLEAR_CREEP);
    }

    const clock = clockOf();
    hurry = Math.max(hurry - dt * 1.4, clamp(Math.abs(velocity) * 0.6));

    // ---- 世界は 30 コマで動く
    worldAcc += dt;
    const worldStep = calm ? Math.abs(clock - lastWorldClock) > 1e-4 || dirty : worldAcc >= 1 / WORLD_HZ - WORLD_SLACK;
    if (worldStep) {
      renderWorld(clock, Math.min(worldAcc, 0.1), hurry);
      worldAcc = 0;
      lastWorldClock = clock;
      if (ready) uploadWorld();
      dirty = true;
    }

    if (dirty) {
      const night = shellNight(clock);
      // 灯りのあたたかさ（0 = 消えている、1 = ともっている）。使い手はこの値で、ページの地を合わせられる。変わったときだけ書く
      const nightText = warmthOf(clock).toFixed(3);
      if (nightText !== lastNightText) {
        lastNightText = nightText;
        root.style.setProperty('--warmth', nightText);
      }
      if (ready) {
        const startedAt = costLeft > 0 ? performance.now() : 0;
        drawGl(night);
        if (startedAt) weighCost(startedAt);
      } else {
        draw2d(night);
      }
      dirty = false;
    }

    // 動きを減らす設定で止まっているときは、次の操作まで描かない
    const idleCalm = calm && !moving && !drag;
    if (visible && pageVisible && !idleCalm) raf = requestAnimationFrame(tick);
  };

  function stopDrawing() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function wake() {
    if (!raf && visible && pageVisible && !lost) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  // ---- 速く動かすと、住人が驚いて空を見上げる
  let startleCool = 0;
  const startle = () => {
    if (calm || performance.now() < startleCool) return;
    startleCool = performance.now() + 1500;
    res.startle = 0.9;
  };

  // ---- 入力
  let suppressClick = 0;
  on(button, 'pointerdown', (event) => {
    if (event.button !== 0) return;
    beginTravel();
    moving = false;
    drag = { id: event.pointerId, start: event.clientX, from: x, want: x, moved: false, lastX: event.clientX, lastT: performance.now(), speed: 0 };
    liftTarget = 1;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      /* 取れなくても、動きは受けられる */
    }
    wake();
  });
  on(button, 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.start;
    if (Math.abs(dx) > 3) drag.moved = true;
    drag.want = drag.from + dx / Math.max(shape.travelCss, 1);
    const nowMs = performance.now();
    const dtMs = Math.max(nowMs - drag.lastT, 4);
    const speed = (event.clientX - drag.lastX) / Math.max(shape.travelCss, 1) / (dtMs / 1000);
    drag.speed = drag.speed * 0.6 + speed * 0.4;
    drag.lastX = event.clientX;
    drag.lastT = nowMs;
    if (Math.abs(drag.speed) > 3.4) startle();
    wake();
  });
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const wasMoved = drag.moved;
    const speed = drag.speed;
    drag = null;
    liftTarget = 0;
    if (wasMoved) {
      suppressClick = performance.now() + 300;
      // 近い方の端へ。勢いも少し数える
      target = x + speed * 0.09 >= 0.5 ? 1 : 0;
      velocity = clamp(speed, -3, 3);
      moving = true;
    }
    wake();
  };
  on(button, 'pointerup', release);
  on(button, 'pointercancel', release);
  on(button, 'lostpointercapture', release);

  const toggle = () => {
    beginTravel();
    target = (moving ? target >= 0.5 : x >= 0.5) ? 0 : 1;
    moving = true;
    wake();
  };
  on(button, 'click', () => {
    if (performance.now() < suppressClick) return;
    toggle();
  });

  const STEP = 0.04;
  on(button, 'keydown', (event) => {
    let dir = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') dir = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') dir = -1;
    if (!dir) return;
    event.preventDefault();
    beginTravel();
    const from = moving ? target : x;
    target = clamp(from + dir * STEP);
    moving = true;
    setStatus(phaseName(branch === 'am' ? mix(T_DARK, amStart, target) : T_DARK + (T_LIT - T_DARK) * target));
    wake();
  });

  // ---- 見えていないときは止める
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) {
      dirty = true;
      wake();
    } else {
      stopDrawing();
    }
  });
  io.observe(root);
  on(root.ownerDocument, 'visibilitychange', () => {
    pageVisible = root.ownerDocument.visibilityState !== 'hidden';
    if (pageVisible) {
      dirty = true;
      wake();
      if (lost) waitForRestore();
    } else {
      stopDrawing();
      clearTimeout(restoreTimer);
    }
  });

  const ro = new ResizeObserver(() => {
    measure();
    dirty = true;
    lastWorldClock = -1;
    wake();
  });
  ro.observe(root);

  const applyCalm = () => {
    calm = motionQuery.matches;
    dirty = true;
    lastWorldClock = -1;
    wake();
  };
  on(motionQuery, 'change', applyCalm);
  on(schemeQuery, 'change', () => {
    readPalette();
    dirty = true;
    lastWorldClock = -1;
    wake();
  });

  // ---- WebGL の文脈が失われたら、戻るのを待って描き直す。戻らなければ 2D で描く
  const RESTORE_WAIT_MS = 3000;
  let restoreTimer = 0;
  const redrawAll = () => {
    shape.W = 0; // 大きさが同じでも、画像を作り直す
    measure();
    dirty = true;
    lastWorldClock = -1;
    worldAcc = 1;
    wake();
  };
  function waitForRestore() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (!lost || !pageVisible) return;
      lost = false;
      useCanvas2d();
      redrawAll();
    }, RESTORE_WAIT_MS);
  }
  on(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
    lost = true;
    costLeft = 0;
    stopDrawing();
    if (pageVisible) waitForRestore();
  });
  on(canvas, 'webglcontextrestored', () => {
    if (ctx2d) return; // もう 2D で描いている
    clearTimeout(restoreTimer);
    lost = false;
    ready = setupGl();
    if (!ready) useCanvas2d();
    redrawAll();
  });

  // ---- 組み立て
  readPalette();
  measure();
  if (lost) waitForRestore();
  // はじめは灯りがともっている。煙突の煙も、もう上がっている
  for (let i = 0; i < 9; i++) smoke.push({ x: 72 + i * 2.6 + (i % 2), y: 19 - i * 3.1, t: i * 0.46, seed: i * 1.7 });
  // 最初の絵を、はじめのフレームまでに用意する
  renderWorld(clockOf(), 0, 0);
  if (ready) uploadWorld();
  wake();

  return () => {
    stopDrawing();
    clearTimeout(restoreTimer);
    visible = false;
    io.disconnect();
    ro.disconnect();
    for (const off of cleanups) off();
    if (gl && ready) {
      gl.deleteProgram(program);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(texWorld);
      gl.deleteTexture(texNear);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  };
}
