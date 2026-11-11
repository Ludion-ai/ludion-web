/* UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT) */
/* Remixed by Claude — 海辺の灯台 */
// part.js — ESモジュール。rootの中だけを触る
// 灯台守のいるスイッチ：スイッチのレールの中に、ピクセルの小さな岬があり、灯台守が1人暮らしている。
//
// 世界：低い解像度で、約28色の番号だけで描く。時刻の変化はディザの置き換えで行い、中間色を作らない。
// 外側：なめらかな殻、窓の奥行き、液体のレンズを WebGL で描く。ピクセルは常に整数倍のまま写す。
// 灯り：世界の光る画素をぼかした「光の場」を作り、ガラスと外の面を照らす。灯台の光がこちらを向くたび、外の面もほのかに明るむ。
// 時間：左端は昼、右端は夜。右へ動かすと 昼→夕方→夜。左へ戻すと 夜→深夜→夜明け→朝→昼 と、時間は前へ進む。
// 色は JS に書かない。--_bg、--_surface、--_fg、--_muted、--_accent、--_sea、--_signal の色相を、決めた明るさで並べて作る。

const CORE_W = 192; // 景色の中心の幅。窓が広いぶんは、両わきへ広がる
const CORE_H = 112;
const HORIZON = 82; // 岬の地面の、奥の端
const SEA_Y = 64; // 水平線
const MARGIN = 14; // レンズが窓の外を覗いてもよいよう、世界を少し広く描く
const WORLD_HZ = 30;
const WORLD_SLACK = 0.004; // 画面の更新の時刻は揺れる。この秒数まで足りなくても、次のコマを出す
const PILL_RATIO = 1.85; // 縦 : 横
const CLOCK_DAY = 12;
const CLOCK_NIGHT = 21.5;
const CLOCK_SLEEP = 23.4;
const NIGHT_CREEP = 26; // 右端に着いてから、灯りを消して眠るまでの秒数の目安

// ---- 岬の間取り
const TX = 56; // 灯台の中心
const LAMP_Y = 24; // 灯室の中心
const WX = 10; // 小屋の窓の中の、左上
const WY = 64;
const DOOR_X = 37; // 小屋の戸口
const LINE_X0 = 64; // 物干しの綱
const LINE_X1 = 86;
const LINE_Y = 75;
const PIER_X0 = 110; // 桟橋
const PIER_X1 = 152;
const PIER_Y = 91;
const PIER_LAMP_X = 134;
const FISH_X = 148; // 釣りをする場所
const BEAM_LEN = 160; // 灯台の光の長さ
const BEAM_TILT = 0.24; // 少し上から見下ろしているぶん、回る光は楕円を描く
const BEAM_RATE = (Math.PI * 2) / 10; // 10秒でひと回り。光は5秒ごとにこちらを向く

// ---- パレット：7つのトークン × 4つの明るさ = 28色
const RAMPS = [
  ['bg', [0.76, 0.85, 0.93, 0.985]],
  ['surface', [0.4, 0.52, 0.64, 0.76]],
  ['fg', [0.17, 0.25, 0.33, 0.44]],
  ['muted', [0.5, 0.62, 0.74, 0.86]],
  ['accent', [0.5, 0.66, 0.8, 0.92]],
  ['sea', [0.4, 0.52, 0.63, 0.76]],
  ['signal', [0.42, 0.52, 0.61, 0.72]],
];
const NCOL = RAMPS.length * 4;
const C0 = 0, C1 = 1, C2 = 2, C3 = 3;
const G0 = 4, G1 = 5, G2 = 6, G3 = 7;
const I0 = 8, I1 = 9, I2 = 10, I3 = 11;
const U0 = 12, U1 = 13, U2 = 14, U3 = 15;
const A0 = 16, A1 = 17, A2 = 18, A3 = 19;
const S0 = 20, S1 = 21, S2 = 22, S3 = 23;
const R0 = 24, R1 = 25, R2 = 26, R3 = 27;

// ---- 材質：[昼, 夕, 宵, 夜] のパレット番号
const MATS = [
  ['SKY', C3, C3, C3, C3],
  ['ISLE', U2, U1, I3, I1],
  ['ISLE_DK', U1, U0, I2, I1],
  ['SEA', S1, S0, I2, I1],
  ['SEA_DK', S0, I3, I1, I0],
  ['SEA_LT', S2, S1, I3, I2],
  ['SEA_HI', S3, A2, U0, I3],
  ['SEA_FAR', S2, U1, I3, I1],
  ['FOAM', C3, A3, U2, U0],
  ['GLINT', C3, A3, U2, U2],
  ['GLOWSEA', S3, S3, S3, S3],
  ['GRASS', G2, G1, I3, I1],
  ['GRASS_DK', G1, G0, I2, I0],
  ['GRASS_LT', G3, G2, U0, I2],
  ['SAND', C2, C1, U1, I2],
  ['SAND_DK', C1, C0, U0, I1],
  ['SAND_WET', C0, A0, I3, I1],
  ['PATH', C1, C0, U0, I2],
  ['PATH_DK', C0, A0, I3, I1],
  ['WALL', C3, A3, U1, I2],
  ['WALL_SH', C2, A2, U0, I1],
  ['PLANK', C1, A1, I3, I1],
  ['RED', R2, R1, R0, I1],
  ['RED_LT', R3, R2, R1, I2],
  ['RED_DK', R1, R0, I2, I0],
  ['STONE', U1, U0, I2, I1],
  ['STONE_LT', U2, U1, I3, I2],
  ['STONE_DK', U0, I3, I1, I0],
  ['ROOF', I3, I2, I1, I0],
  ['ROOF_LT', U0, I3, I2, I1],
  ['ROOF_HI', U1, U0, I3, I1],
  ['WOOD', A0, A0, I2, I0],
  ['WOOD_LT', A1, A1, I3, I1],
  ['WOOD_DK', I3, I2, I1, I0],
  ['BRICK', U0, I3, I2, I0],
  ['BRICK_LT', U1, U0, I3, I1],
  ['LEAF0', G0, G0, I1, I0],
  ['LEAF1', G1, G0, I2, I0],
  ['LEAF2', G2, A0, I2, I1],
  ['LEAF3', G3, A1, I3, I1],
  ['FLOWER_A', A2, A1, A0, I2],
  ['FLOWER_C', C3, A3, U1, I3],
  ['STEM', G0, G0, I2, I0],
  ['GLASS', I2, A0, I1, I0],
  ['GLASS_HI', U1, A1, I2, I1],
  ['ROOM', C1, C0, I3, I1],
  ['SKIN', A3, A3, U2, I3],
  ['HAIR', I0, I0, I0, I0],
  ['SHIRT', A1, A0, I3, I1],
  ['SHIRT_DK', A0, A0, I2, I0],
  ['PANTS', I2, I2, I1, I0],
  ['BOOT', I0, I0, I0, I0],
  ['SAIL', C3, A3, U2, I3],
  ['CLOUD', C3, A3, U1, I2],
  ['CLOUD_SH', U3, A2, U0, I1],
  ['SMOKE', C1, C1, U2, I3],
  ['SMOKE_DK', U2, U1, U0, I2],
  ['SUN', C3, C3, A3, A3],
  ['SUN_RIM', A3, A2, A2, A2],
  ['MOON', C3, C3, C3, C3],
  ['MOON_DK', C1, C1, C1, C1],
  ['STAR', C3, C3, C3, C3],
  ['STAR_DIM', U2, U2, U2, U2],
  ['LIT', A2, A2, A2, A2],
  ['LIT_HI', A3, A3, A3, A3],
  ['LIT_DK', A1, A1, A1, A1],
  ['SIL', I0, I0, I0, I0],
  // 灯台の光。空より明るいときだけ見える。この3つは続けて並べる
  ['BEAM_HI', C3, C3, A3, A3],
  ['BEAM_MID', C3, U3, U2, U2],
  ['BEAM_LOW', C2, U2, U1, U0],
  ['BIRD', I2, I2, I1, I0],
  ['MARK', I0, I0, C3, C3],
  ['ZZZ', U3, U3, U3, U3],
];
const M = Object.fromEntries(MATS.map((row, i) => [row[0], i]));

// ---- 時刻のかなめ：[時, 材質の列, 空の色（上から水平線へ）]
const KEYS = [
  [0, 3, [I0, I0, I1, I1, I2]],
  [4.8, 3, [I0, I0, I1, I1, I2]],
  [5.4, 3, [I0, I1, I2, I3, U0]],
  [6.0, 2, [I1, I2, I3, U0, U1, A1]],
  [6.7, 1, [I3, U0, U1, U2, A2, A3]],
  [7.8, 0, [U1, U2, U3, C2, C3]],
  [10, 0, [U2, U3, C2, C3, C3]],
  [15, 0, [U1, U2, U3, C2, C3]],
  [17, 1, [U0, U1, U3, C1, A3, A2]],
  [18, 1, [I3, U0, U1, A1, A2, A3]],
  [19, 2, [I1, I2, I3, U0, A0, A1]],
  [20.3, 3, [I0, I0, I1, I1, I2]],
  [24, 3, [I0, I0, I1, I1, I2]],
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


// ---- 灯台守の絵。赤い帽子に、黄色い合羽
const CHARS = { C: 'RED', H: 'HAIR', S: 'SKIN', E: 'HAIR', T: 'SHIRT', D: 'SHIRT_DK', P: 'PANTS', B: 'BOOT' };
const makeSprite = (rows) => {
  const list = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') list.push([x, y, M[CHARS[ch]], ch === 'E']);
    });
  });
  return { list, w: rows[0].length, h: rows.length };
};
const HEAD = ['..CCC..', '.CCCCCC', '.HHSSS.', '.HSSES.', '..SSSS.'];
const HEAD_BLINK = ['..CCC..', '.CCCCCC', '.HHSSS.', '.HSSSS.', '..SSSS.'];
const HEAD_UP = ['..CCC..', '.CCCCCC', '.HHSES.', '.HSSSS.', '..SSSS.'];
const BODY_STAND = ['..TTT..', '.TTTTT.', '.STTTS.', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
const BODY_WALK1 = ['..TTT..', '.TTTTT.', '..TTTS.', '.SDDD..', '..PPP..', '.PP.P..', '.B..BB.'];
const BODY_WALK2 = ['..TTT..', '.TTTTT.', '.STTTS.', '..DDD..', '..PPP..', '..PP...', '..BB...'];
const BODY_WALK3 = ['..TTT..', '.TTTTT.', '.STTT..', '..DDDS.', '..PPP..', '..P.PP.', '.BB..B.'];
const BODY_ARMS = ['S.TTT.S', 'STTTTTS', '..TTT..', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
// 桟橋の端に腰かけて、足を海へ下ろす
const BODY_FISH = ['..TTT....', '.TTTTS...', '.TTTT....', '..DDD....', '..PPPPPP.', '......PP.', '......PP.', '......BB.'];
const BODY_FISH_UP = ['S.TTT.S..', 'STTTTTS..', '..TTT....', '..DDD....', '..PPPPPP.', '......PP.', '......PP.', '......BB.'];
const person = (head, body) => makeSprite([...head, ...body]);
const wide = (rows) => rows.map((row) => `${row}..`);
const SPR = {
  stand: person(HEAD, BODY_STAND),
  blink: person(HEAD_BLINK, BODY_STAND),
  walk: [person(HEAD, BODY_WALK1), person(HEAD, BODY_WALK2), person(HEAD, BODY_WALK3), person(HEAD, BODY_WALK2)],
  up: person(HEAD_UP, BODY_ARMS),
  fish: person(wide(HEAD), BODY_FISH),
  fishBlink: person(wide(HEAD_BLINK), BODY_FISH),
  fishUp: person(wide(HEAD_UP), BODY_FISH_UP),
  bust: makeSprite(['...CCC...', '..CCCCCC.', '..HSSES..', '...SSS...', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.', '.TTTTTTT.']),
  bustBlink: makeSprite(['...CCC...', '..CCCCCC.', '..HSSSS..', '...SSS...', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.', '.TTTTTTT.']),
  bustUp: makeSprite(['S..CCC..S', 'S.CCCCCCS', 'S.HSSES.S', 'SS.SSS.SS', '.STTTTTS.', '..TTTTT..', '..TTTTT..', '..TTTTT..']),
  bustHalf: makeSprite(['...CCC...', '..CCCCCC.', 'S.HSSES.S', 'SS.SSS.SS', '.STTTTTS.', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.']),
  sil: makeSprite(['...HHH..', '..HHHHH.', '..HHHHH.', '...HHH..', '..HHHHH.', '.HHHHHHH', 'HHHHHHHH', 'HHHHHHHH']),
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

        // 灯りと月や太陽も、レンズの面に映る。映るのは縁の近くだけ
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
  const palette = new Array(NCOL);
  const palette32 = new Uint32Array(NCOL);
  const readPalette = () => {
    const style = getComputedStyle(root);
    RAMPS.forEach(([name, tones], ramp) => {
      const declared = style.getPropertyValue(`--_${name}`).trim();
      const channels = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(declared);
      probe.style.color = channels ? `rgb(${channels[1]} ${channels[2]} ${channels[3]})` : declared;
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = getComputedStyle(probe).color;
      paint.fillRect(0, 0, 1, 1);
      const d = paint.getImageData(0, 0, 1, 1).data;
      const lab = rgbToOklab([d[0], d[1], d[2]]);
      tones.forEach((L, step) => {
        const rgb = labTone(lab, L);
        const id = ramp * 4 + step;
        palette[id] = rgb;
        palette32[id] = (255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
      });
    });
  };
  const unit = (id) => palette[id].map((v) => v / 255);

  // ---- 材質の表：時刻のかなめごと、状態（ふつう、影、灯り）ごと
  const STEP_L = RAMPS.flatMap(([, tones]) => tones);
  const shadeOf = (id) => {
    const step = id % 4;
    if (step > 0) return id - 1;
    if (id === C0) return U0;
    if (id === G0 || id === U0 || id === A0 || id === S0 || id === R0) return I3;
    return id;
  };
  const litOf = (dayId) => (STEP_L[dayId] < 0.9 ? A0 : A1);
  const NM = MATS.length;
  const table = KEYS.map(([, col]) => {
    const t = new Uint8Array(NM * 3);
    MATS.forEach((row, m) => {
      const id = row[col + 1];
      t[m] = id;
      t[NM + m] = shadeOf(id);
      t[NM * 2 + m] = litOf(row[1]);
    });
    return t;
  });

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
  let foamSrc = new Uint8Array(1); // 波が砕ける相手（岸、岩、桟橋の杭）
  let seaDist = new Uint8Array(1); // そこからの距離（1ピクセル = 3）
  let coastCol = new Float32Array(1);
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
  // 沖のもの：海と空の上にだけ描く。岬の建物の向こうを通る
  const putFar = (x, y, m) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return;
    const i = py * bw + px;
    const b = baseBuf[i];
    if (b === 0 || b === M.SEA || b === M.ISLE || b === M.ISLE_DK) matBuf[i] = m;
  };
  const rect = (x, y, w, h, m) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, m);
  };
  const line = (x0, y0, x1, y1, m) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) put(Math.round(mix(x0, x1, i / n)), Math.round(mix(y0, y1, i / n)), m);
  };
  const get = (x, y) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return -1;
    return matBuf[py * bw + px];
  };
  const baseAt = (x, y) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return -1;
    return baseBuf[py * bw + px];
  };
  const solid = (x, y) => {
    const px = x + ox;
    const py = y + oy;
    if (px < 0 || py < 0 || px >= bw || py >= bh) return;
    foamSrc[py * bw + px] = 1;
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
  const isGrass = (m) => m === M.GRASS || m === M.GRASS_DK || m === M.GRASS_LT;

  // ---- 動かない背景
  // 岬のふち：左は奥の端がまっすぐ続き、右へ行くほど手前へ回りこんで浜になる
  const coastY = (x) => HORIZON + (x > 100 ? Math.pow(x - 100, 1.2) * 0.45 : 0) + (noiseB(x * 0.23 + 5, 3.5) - 0.5) * 2.2;
  const isleH = (x) => 6.5 * Math.exp(-(((x - 158) / 13) ** 2)) + 3.4 * Math.exp(-(((x - 177) / 6) ** 2));

  const pathDist = (x, y) => {
    // 小屋の戸口から、灯台の前を通って、桟橋へ
    const main = x > 34 && x < 114 ? Math.abs(y - (89 + Math.sin(x * 0.08) + clamp((x - 100) / 12) * 1.2)) : 99;
    const toDoor = y > 85 && y < 90 ? Math.abs(x - DOOR_X) * 0.7 : 99;
    const toTower = y > 85 && y < 90 ? Math.abs(x - TX) * 0.9 : 99;
    return Math.min(main, toDoor, toTower);
  };

  const paintGround = () => {
    for (let px = 0; px < bw; px++) coastCol[px] = coastY(px - ox);
    for (let py = 0; py < bh; py++) {
      const y = py - oy;
      for (let px = 0; px < bw; px++) {
        const x = px - ox;
        const i = py * bw + px;
        if (y < SEA_Y) {
          // 沖の島は、上の端を空へディザで溶かす
          const high = isleH(x);
          if (high > 0.6) {
            const top = SEA_Y - high + 0.5 + noiseB(x * 0.35, 8.5) * 0.9;
            if (y >= top) matBuf[i] = y - top < 1 && bayerAt(x, y) > 9 ? 0 : y >= SEA_Y - 2 ? M.ISLE_DK : M.ISLE;
          }
          continue;
        }
        const edge = coastCol[px];
        if (y < edge) {
          matBuf[i] = M.SEA;
          continue;
        }
        if (x > 98) foamSrc[i] = 1;
        const slope = x > 100 ? 0.54 * Math.pow(x - 100, 0.2) : 0;
        const inland = (y - edge) / Math.sqrt(1 + slope * slope);
        const sand = clamp((x - 98) / 12) * (7 + (y - HORIZON) * 0.35 + noiseA(x * 0.15 + 2, y * 0.15) * 4);
        const depth = (y - HORIZON) / 30;
        let m;
        if (inland < sand) {
          if (inland < 1.5) m = M.SAND_WET;
          else if (inland > sand - 2 && bayerAt(x, y) > 8) m = M.GRASS;
          else m = noiseB(x * 0.7 + 3, y * 0.9) > 0.7 ? M.SAND_DK : M.SAND;
        } else {
          const n = noiseA(x * 0.075 + 9, y * 0.2 + 3) + noiseB(x * 0.3, y * 0.5) * 0.28;
          const v = n + (bayerAt(x, y) / 16 - 0.5) * 0.14 - depth * 0.14;
          m = M.GRASS;
          if (v > 0.84) m = M.GRASS_LT;
          else if (v < 0.5) m = M.GRASS_DK;
        }
        const pd = pathDist(x, y);
        if (pd < 2 + depth * 1.5) {
          const pebble = noiseB(x * 0.7 + 3, y * 0.9) > 0.68;
          m = pebble ? M.PATH_DK : M.PATH;
        } else if (pd < 3 + depth * 1.5 && bayerAt(x, y) > 7) {
          m = M.PATH_DK;
        }
        matBuf[i] = m;
      }
    }
    // 奥の端の濃い線と、海へかかる草の穂
    const r = seeded(5);
    for (let px = 0; px < bw; px++) {
      const x = px - ox;
      const a = r();
      const b = r();
      if (x > 103) continue;
      const y = Math.ceil(coastCol[px]);
      if (a < 0.6) put(x, y, M.GRASS_DK);
      if (b < 0.2) put(x, y - 1, b < 0.08 ? M.GRASS_LT : M.GRASS_DK);
    }
    for (let i = 0; i < (bw * bh) / 60; i++) {
      const x = Math.floor(r() * bw) - ox;
      const y = HORIZON + 2 + Math.floor(r() * (bh - oy - HORIZON));
      const lit = r() < 0.5;
      const tall = r() < 0.5;
      if (!isGrass(get(x, y)) || pathDist(x, y) < 5) continue;
      put(x, y, lit ? M.GRASS_LT : M.GRASS_DK);
      if (tall && isGrass(get(x, y - 1))) put(x, y - 1, M.GRASS_LT);
    }
    // 浜のはまむぎ
    for (let i = 0; i < 26; i++) {
      const x = 100 + Math.floor(r() * 46);
      const y = HORIZON + 6 + Math.floor(r() * 36);
      if (get(x, y) !== M.SAND || get(x - 1, y - 1) !== M.SAND || get(x + 1, y - 1) !== M.SAND) continue;
      put(x, y, M.GRASS_DK);
      put(x - 1, y - 1, M.GRASS_DK);
      put(x + 1, y - 1, M.GRASS_LT);
    }
  };

  const paintRock = (cx, cy, rx, ry, seed) => {
    const r = seeded(seed);
    const blobs = Array.from({ length: 4 }, () => [cx + (r() - 0.5) * rx * 1.2, cy + (r() - 0.5) * ry * 0.6, 0.55 + r() * 0.45]);
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry * 0.5; y++) {
      for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        let best = 0;
        for (const [bx, by, bs] of blobs) {
          const d = Math.hypot((x - bx) / (rx * bs), (y - by) / (ry * bs));
          if (d < 1) best = Math.max(best, 1 - d);
        }
        if (best <= 0) continue;
        const v = ((cx - x) / rx) * 0.3 + ((cy - y) / ry) * 0.6 + best * 0.4 + (bayerAt(x, y) / 16 - 0.5) * 0.3;
        put(x, y, v > 0.45 ? M.STONE_LT : v > -0.1 ? M.STONE : M.STONE_DK);
        solid(x, y);
      }
    }
  };

  const paintBush = (cx, cy, rx, ry, seed) => {
    const r = seeded(seed);
    const blobs = Array.from({ length: 6 }, () => [cx + (r() - 0.5) * rx * 1.5, cy + (r() - 0.5) * ry, 3 + r() * (ry * 0.75)]);
    for (let y = cy - ry - 3; y <= cy + ry + 1; y++) {
      for (let x = cx - rx - 3; x <= cx + rx + 3; x++) {
        let inside = false;
        let shade = 0;
        for (const [bx, by, br] of blobs) {
          const d = Math.hypot(x - bx, (y - by) * 1.15);
          if (d < br) {
            inside = true;
            shade = Math.max(shade, 1 - d / br);
          }
        }
        if (!inside) continue;
        const v = shade * 0.6 + (cy - y) / (ry * 2.4) + (bayerAt(x, y) / 16 - 0.5) * 0.3 + noiseB(x * 0.4, y * 0.5) * 0.25;
        put(x, y, v > 0.82 ? M.LEAF3 : v > 0.52 ? M.LEAF2 : v > 0.24 ? M.LEAF1 : M.LEAF0);
      }
    }
  };

  const paintFlowers = (x0, x1, y0, y1, count, seed) => {
    const r = seeded(seed);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(mix(x0, x1, r()));
      const y = Math.floor(mix(y0, y1, r()));
      const kind = r() < 0.55 ? M.FLOWER_A : M.FLOWER_C;
      const full = r() < 0.5;
      if (pathDist(x, y) < 4.5 || !isGrass(get(x, y)) || !isGrass(get(x, y - 2))) continue;
      put(x, y, M.STEM);
      put(x, y - 1, M.STEM);
      put(x, y - 2, kind);
      if (full) {
        put(x - 1, y - 2, kind);
        put(x + 1, y - 2, kind);
        put(x, y - 3, kind);
      }
    }
  };

  const paintCottage = () => {
    const X0 = 4;
    const X1 = 44;
    const TOP = 58;
    const BASE = 85;
    // 煙突（屋根の奥）
    rect(12, 38, 8, 18, M.BRICK);
    for (let y = 38; y < 56; y += 2) {
      for (let x = 12; x < 20; x++) if ((x + (((y - 38) / 2) & 1) * 2) % 4 < 2) put(x, y, M.BRICK_LT);
    }
    rect(11, 36, 10, 2, M.STONE_LT);
    rect(11, 38, 10, 1, M.STONE);

    // 壁
    rect(X0, TOP, X1 - X0, BASE - TOP, M.WALL);
    for (let y = TOP + 3; y < BASE; y += 4) {
      for (let x = X0; x < X1; x++) if ((x * 7 + y * 3) % 23 !== 0) put(x, y, M.PLANK);
    }
    // 軒下の影。ディザで下へ薄くなる
    for (let y = TOP; y < TOP + 6; y++) {
      for (let x = X0; x < X1; x++) {
        if (y < TOP + 3 || bayerAt(x, y) < (TOP + 6 - y) * 4) put(x, y, M.WALL_SH);
      }
    }
    // 右の端は日陰
    for (let x = X1 - 3; x < X1; x++) {
      for (let y = TOP; y < BASE; y++) if (bayerAt(x, y) < (x - (X1 - 3) + 1) * 5) put(x, y, M.WALL_SH);
    }
    // 土台の石
    rect(X0 - 1, BASE - 3, X1 - X0 + 2, 3, M.STONE);
    for (let x = X0 - 1; x < X1 + 1; x += 5) {
      rect(x, BASE - 3, 4, 1, M.STONE_LT);
      put(x + 2, BASE - 2, M.STONE_LT);
    }

    // 屋根：台形。瓦の段
    const RT = 46;
    for (let y = RT; y < TOP; y++) {
      const t = (y - RT) / (TOP - RT);
      const l = Math.round(mix(X0 + 7, X0 - 5, t));
      const r = Math.round(mix(X1 - 8, X1 + 4, t));
      for (let x = l; x <= r; x++) {
        const row = Math.floor((y - RT) / 3);
        const tile = (x + 60 + (row & 1) * 3) % 6;
        let m = M.ROOF;
        if ((y - RT) % 3 === 1 && tile !== 0) m = M.ROOF_LT;
        // 光の当たる左上
        if (x - l < 5 + t * 8 && (y - RT) % 3 === 1 && tile !== 0) m = M.ROOF_HI;
        put(x, y, m);
      }
    }
    rect(X0 + 6, RT - 1, X1 - X0 - 13, 1, M.ROOF_HI);
    // 軒先
    for (let x = X0 - 5; x <= X1 + 4; x++) {
      put(x, TOP, M.WOOD_DK);
      if ((x + 60) % 3 === 0) put(x, TOP + 1, M.WOOD_DK);
    }

    // 戸口：赤い戸
    rect(31, 66, 12, 19, M.WOOD_DK);
    rect(32, 67, 10, 18, M.RED);
    for (let x = 34; x < 42; x += 3) rect(x, 67, 1, 18, M.RED_DK);
    rect(32, 72, 10, 1, M.RED_DK);
    rect(33, 68, 8, 3, M.GLASS);
    put(34, 69, M.GLASS_HI);
    put(35, 69, M.GLASS_HI);
    put(40, 77, M.FLOWER_A);
    rect(30, 85, 14, 2, M.STONE_LT);
    rect(29, 87, 16, 1, M.STONE);

    // 窓枠と花の箱（窓の中は毎フレーム描く）
    rect(WX - 2, WY - 2, 18, 16, M.WOOD_DK);
    rect(WX - 3, WY + 14, 20, 3, M.WOOD);
    rect(WX - 3, WY + 14, 20, 1, M.WOOD_LT);
    const r = seeded(77);
    for (let x = WX - 2; x < WX + 16; x++) {
      if (r() < 0.75) put(x, WY + 13, r() < 0.5 ? M.FLOWER_A : M.FLOWER_C);
      if (r() < 0.5) put(x, WY + 12, M.STEM);
    }

    // 灯りの腕木
    put(28, 66, M.WOOD_DK);
    put(29, 66, M.WOOD_DK);
  };

  const towerHalf = (y) => 4.6 + ((y - 31) / 51) * 3.4;
  const paintTower = () => {
    // 土台の石と、戸口への段
    rect(TX - 10, 83, 21, 4, M.STONE);
    for (let x = TX - 10; x <= TX + 10; x += 5) {
      rect(x, 83, 4, 1, M.STONE_LT);
      put(x + 2, 85, M.STONE_LT);
    }
    rect(TX + 8, 84, 3, 3, M.STONE_DK);
    rect(TX - 2, 83, 5, 4, M.STONE_LT);

    // 胴：白と赤の帯。左から光が当たり、右へ回りこんで陰る
    for (let y = 31; y < 83; y++) {
      const w = towerHalf(y);
      const l = Math.round(TX - w);
      const r = Math.round(TX + w);
      const band = (y >= 41 && y < 52) || (y >= 63 && y < 74);
      for (let x = l; x <= r; x++) {
        const t = (x - l) / (r - l);
        const b = bayerAt(x, y) / 16;
        const tone = t > 0.58 + b * 0.24 ? 0 : t < 0.14 + b * 0.12 ? 2 : 1;
        let m;
        if (band) m = tone === 0 ? M.RED_DK : tone === 2 ? M.RED_LT : M.RED;
        else m = x === r ? M.PLANK : tone === 0 ? M.WALL_SH : M.WALL;
        // 回廊の下の影
        if (!band && y < 35 && bayerAt(x, y) < (35 - y) * 4) m = M.WALL_SH;
        put(x, y, m);
      }
    }
    // 明かり取りの窓と、戸口
    rect(TX - 1, 35, 2, 3, M.GLASS);
    rect(TX - 1, 56, 2, 3, M.GLASS);
    rect(TX - 2, 75, 5, 8, M.WOOD_DK);
    rect(TX - 1, 76, 3, 7, M.WOOD);
    put(TX + 1, 79, M.FLOWER_A);

    // 回廊と手すり
    rect(TX - 6, 30, 13, 1, M.WALL_SH);
    rect(TX - 7, 28, 15, 2, M.ROOF);
    rect(TX - 7, 28, 15, 1, M.ROOF_LT);
    for (const x of [TX - 7, TX - 5, TX + 5, TX + 7]) rect(x, 25, 1, 3, M.ROOF);
    rect(TX - 7, 25, 3, 1, M.ROOF);
    rect(TX + 5, 25, 3, 1, M.ROOF);

    // 灯室：昼は硝子と、中のレンズ（灯ると、毎フレーム描き直す）
    rect(TX - 4, 21, 9, 7, M.ROOF);
    rect(TX - 3, 21, 7, 6, M.GLASS);
    rect(TX - 1, 22, 3, 4, M.GLASS_HI);
    put(TX - 1, 22, M.FLOWER_C);
    rect(TX - 4, 27, 9, 1, M.ROOF_LT);

    // 赤い屋根と、風見
    rect(TX - 5, 20, 11, 1, M.RED_DK);
    rect(TX - 4, 19, 9, 1, M.RED);
    rect(TX - 3, 18, 7, 1, M.RED);
    rect(TX - 1, 17, 3, 1, M.RED);
    for (const [x, y] of [[TX - 4, 19], [TX - 3, 19], [TX - 3, 18], [TX - 2, 18], [TX - 1, 17]]) put(x, y, M.RED_LT);
    for (const [x, y] of [[TX + 4, 19], [TX + 3, 19], [TX + 3, 18]]) put(x, y, M.RED_DK);
    rect(TX, 14, 1, 3, M.ROOF);
    put(TX + 1, 14, M.ROOF);
  };

  // 物干しの綱：灯台の壁から、杭まで。まんなかが少したるむ
  const lineY = (x) => LINE_Y + Math.round(Math.sin(((x - LINE_X0) / (LINE_X1 - LINE_X0)) * Math.PI) * 1.4);
  const paintLine = () => {
    rect(LINE_X1, LINE_Y - 1, 1, 15, M.WOOD);
    put(LINE_X1, LINE_Y - 1, M.WOOD_LT);
    for (let x = LINE_X0; x < LINE_X1; x++) put(x, lineY(x), M.BOOT);
    // 洗濯かご
    rect(81, 87, 3, 2, M.WOOD_LT);
    rect(81, 88, 3, 1, M.WOOD);
  };

  const paintPier = () => {
    for (let x = PIER_X0; x <= PIER_X1; x++) {
      put(x, PIER_Y, (x - PIER_X0) % 5 === 4 ? M.WOOD : M.WOOD_LT);
      put(x, PIER_Y + 1, M.WOOD);
      if (get(x, PIER_Y + 2) === M.SEA) put(x, PIER_Y + 2, M.SEA_DK);
    }
    // 杭
    for (let x = PIER_X0 + 6; x <= PIER_X1; x += 9) {
      for (let y = PIER_Y + 2; y < PIER_Y + 7; y++) {
        const g = get(x, y);
        if (g !== M.SEA && g !== M.SEA_DK) continue;
        put(x, y, M.WOOD_DK);
        solid(x, y);
      }
    }
    // 灯りの柱
    rect(PIER_LAMP_X, PIER_Y - 8, 1, 8, M.WOOD_DK);
    rect(PIER_LAMP_X - 1, PIER_Y - 11, 3, 3, M.GLASS);
    rect(PIER_LAMP_X - 1, PIER_Y - 12, 3, 1, M.WOOD_DK);
    // 魚を入れる桶
    rect(143, PIER_Y - 2, 3, 2, M.STONE_LT);
    rect(143, PIER_Y - 2, 3, 1, M.STONE);
  };

  const paintGull = () => {
    // 沖の岩で休むかもめ
    // 岩のてっぺんを探して、その上に立たせる
    const gx = 185;
    let gy = 76;
    while (gy < 90 && get(gx, gy + 1) === M.SEA) gy++;
    put(gx - 2, gy - 1, M.ROOF_LT);
    put(gx - 1, gy - 1, M.SAIL);
    put(gx, gy - 1, M.SAIL);
    put(gx + 1, gy - 2, M.SAIL);
    put(gx + 2, gy - 2, M.FLOWER_A);
    put(gx, gy, M.FLOWER_A);
  };

  // 波が砕ける相手からの距離を、海のすべての画素に持たせる
  const buildSeaDist = () => {
    const n = bw * bh;
    for (let i = 0; i < n; i++) seaDist[i] = foamSrc[i] ? 0 : 255;
    const relax = (i, j, w) => {
      const v = seaDist[j] + w;
      if (v < seaDist[i]) seaDist[i] = v;
    };
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        if (x > 0) relax(i, i - 1, 3);
        if (y > 0) {
          relax(i, i - bw, 3);
          if (x > 0) relax(i, i - bw - 1, 4);
          if (x < bw - 1) relax(i, i - bw + 1, 4);
        }
      }
    }
    for (let y = bh - 1; y >= 0; y--) {
      for (let x = bw - 1; x >= 0; x--) {
        const i = y * bw + x;
        if (x < bw - 1) relax(i, i + 1, 3);
        if (y < bh - 1) {
          relax(i, i + bw, 3);
          if (x < bw - 1) relax(i, i + bw + 1, 4);
          if (x > 0) relax(i, i + bw - 1, 4);
        }
      }
    }
  };

  const buildBase = () => {
    matBuf.fill(0);
    foamSrc.fill(0);
    paintGround();
    paintRock(108, 86, 4, 2.5, 21);
    paintRock(124, 81, 4, 2.4, 22);
    paintRock(186, 84, 6, 3.4, 23);
    paintRock(196, 92, 3, 1.8, 24);
    paintRock(172, 107, 7, 3.4, 25);
    paintGull();
    paintBush(94, 82, 5, 3, 62);
    paintBush(-10, 82, 8, 5, 63);
    paintCottage();
    paintTower();
    paintLine();
    paintPier();
    paintFlowers(46, 98, 92, 104, 22, 91);
    paintFlowers(4, 30, 91, 104, 16, 92);
    paintFlowers(66, 98, 84, 87, 8, 93);
    paintFlowers(-16, 2, 86, 104, 12, 95);
    baseBuf.set(matBuf);
    buildSeaDist();

    const r = seeded(808);
    stars = [];
    for (let i = 0; i < 95; i++) {
      stars.push({ x: Math.floor(r() * (CORE_W + 40)) - 20, y: Math.floor(r() * 62), seed: r(), big: r() < 0.14 });
    }
    // 空を時刻のかなめごとに描いておく
    skyKeys = KEYS.map(([, , stops]) => {
      const sky = new Uint8Array(bw * bh);
      const n = stops.length - 1;
      for (let py = 0; py < bh; py++) {
        const pos = clamp((py - oy) / SEA_Y) * n;
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

  // ---- 灯台守と世界の動き
  const res = { x: DOOR_X, inside: false, face: 1, step: 0, doorOpen: 0, startle: 0, hop: 0, blink: 0, nextBlink: 2, page: 0, nextPage: 4, pageT: 0, hurry: 0 };
  const clouds = [
    { x: 8, y: 13, w: 30, h: 9, seed: 1, speed: 0.55 },
    { x: 88, y: 26, w: 22, h: 7, seed: 2, speed: 0.8 },
    { x: 150, y: 9, w: 34, h: 10, seed: 3, speed: 0.42 },
    { x: 214, y: 32, w: 18, h: 5, seed: 4, speed: 1.05 },
  ].map((cloud) => {
    const r = seeded(cloud.seed * 977);
    const blobs = Array.from({ length: 6 }, (_, i) => [cloud.w * ((i + 0.5) / 6) + (r() - 0.5) * 3, cloud.h * (0.45 + (r() - 0.5) * 0.35), cloud.h * (0.3 + r() * 0.32)]);
    const list = [];
    for (let y = 0; y < cloud.h + 3; y++) {
      for (let x = -2; x < cloud.w + 3; x++) {
        let inside = false;
        for (const [bx, by, br] of blobs) if (Math.hypot(x - bx, (y - by) * 1.25) < br) inside = true;
        if (!inside) continue;
        list.push(x, y, y > cloud.h * 0.62 ? 1 : 0);
      }
    }
    return { ...cloud, list };
  });
  const smoke = [];
  const zees = [];
  const birds = { t: -1, next: 6, y: 20, dir: 1 };
  const shoot = { t: -1, next: 14 };
  // 夜の波間に光る、夜光虫
  const glows = Array.from({ length: 10 }, (_, i) => ({ seed: i * 7.3 + 1, x: 138 + ((i * 37) % 58), y: 96 + ((i * 11) % 15) }));
  const orb = { sunOn: false, sunX: 0, sunY: 0, sunUp: 0, moonOn: false, moonX: 0, moonY: 0 };
  const CLOTHS = [[67, 3, 5, M.SAIL], [71, 4, 4, M.RED], [77, 3, 5, M.ROOF_HI], [81, 2, 3, M.SAIL]];
  let anim = 0;
  let smokeAcc = 0;
  let zeeAcc = 0;
  let lampFlick = 1;
  let windowL = 0;
  let lanternL = 0;
  let shutter = 0;
  let lampL = 0; // 灯台の灯り
  let beamAngle = 5.6;
  let lampWas = false;
  let aloft = false; // 灯台守が回廊に上がっている

  const hourOf = (clock) => ((clock % 24) + 24) % 24;
  const groundAt = (x) => 89 + Math.round(clamp((x - 106) / 5) * 2); // 桟橋は、浜より少し低い

  // 時刻から、灯台守の予定を決める
  const planFor = (h) => {
    if (h >= 9.6 && h < 11) return { outside: true, x: 76, act: 'tend' };
    if (h >= 11 && h < 16.2) return { outside: true, x: FISH_X, act: 'fish' };
    if (h >= 16.2 && h < 17.2) return { outside: true, x: 100, act: 'stroll' };
    return { outside: false, x: DOOR_X, act: 'in' };
  };

  const stepResident = (dt, h, speedHint) => {
    const plan = planFor(h);
    const want = plan.outside ? plan.x : DOOR_X;
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
      res.x = DOOR_X;
      res.doorOpen = 0.5;
    }
    if (!res.inside) {
      const delta = want - res.x;
      if (Math.abs(delta) > 0.5) {
        const speed = 22 + clamp(speedHint, 0, 1) * 72 + (Math.abs(delta) > 34 ? 8 : 0);
        const move = Math.min(Math.abs(delta), speed * dt);
        res.x += Math.sign(delta) * move;
        res.face = Math.sign(delta);
        res.step += move * 0.28;
        res.hurry = speedHint;
      } else {
        res.x = want;
        res.step = 0;
        if (!plan.outside) {
          res.inside = true;
          res.doorOpen = 0.45;
        }
      }
    }
    // まばたき、魚の当たり
    res.nextBlink -= dt;
    if (res.nextBlink <= 0) {
      res.blink = 0.13;
      res.nextBlink = 1.8 + Math.random() * 3.4;
    }
    res.blink = Math.max(0, res.blink - dt);
    res.nextPage -= dt;
    if (res.nextPage <= 0) {
      res.pageT = 0.42;
      res.nextPage = 3.6 + Math.random() * 3.2;
    }
    res.pageT = Math.max(0, res.pageT - dt);
    return plan;
  };

  // 太陽と月は、水平線から昇って、水平線へ沈む
  const placeOrbs = (h) => {
    orb.sunOn = h > 5.2 && h < 19;
    if (orb.sunOn) {
      const a = ((h - 6) / 12) * Math.PI;
      orb.sunUp = Math.sin(a);
      orb.sunX = Math.round(96 - Math.cos(a) * 102);
      orb.sunY = Math.round(SEA_Y + 2 - orb.sunUp * 54);
    }
    const mh = h >= 17.6 ? h : h + 24;
    orb.moonOn = mh > 17.6 && mh < 30.4;
    if (orb.moonOn) {
      const a = ((mh - 18) / 12) * Math.PI;
      orb.moonX = Math.round(96 - Math.cos(a) * 102);
      orb.moonY = Math.round(SEA_Y + 2 - Math.sin(a) * 50);
    }
  };

  const drawSky = (h) => {
    const dark = smoothstep(18.2, 20.2, h) + (1 - smoothstep(4.6, 6.2, h));
    const night = clamp(dark);

    // 星：夜だけ。またたく
    if (night > 0.02) {
      for (const s of stars) {
        if (s.seed > night * 1.05) continue;
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
      if (!calm && night > 0.9) {
        if (shoot.t >= 0) {
          const f = shoot.t / 0.55;
          for (let i = 0; i < 7; i++) {
            const u = f * 42 - i * 2;
            if (u > 0 && u < 42) putSky(Math.round(shoot.x + u), Math.round(shoot.y + u * 0.45), i < 2 ? M.STAR : M.STAR_DIM);
          }
        }
      }
    }

    // 太陽：空を弧を描いて動く
    if (orb.sunOn) {
      const sx = orb.sunX;
      const sy = orb.sunY;
      const low = 1 - clamp(orb.sunUp * 1.6);
      const R = 5 + Math.round(low * 2);
      for (let dy = -R - 5; dy <= R + 5; dy++) {
        for (let dx = -R - 5; dx <= R + 5; dx++) {
          const d = Math.hypot(dx, dy);
          const x = sx + dx;
          const y = sy + dy;
          if (d <= R - 1) {
            putSky(x, y, M.SUN);
            if (y < SEA_Y) emit(x, y, 26 + low * 90, 1);
          } else if (d <= R) {
            putSky(x, y, M.SUN_RIM);
          } else if (d <= R + 4 && bayerAt(x, y) < (R + 4.6 - d) * 2.2) {
            putSky(x, y, M.SUN_RIM);
          }
        }
      }
    }

    // 月
    if (orb.moonOn) {
      const mx = orb.moonX;
      const my = orb.moonY;
      const R = 6;
      for (let dy = -R - 3; dy <= R + 3; dy++) {
        for (let dx = -R - 3; dx <= R + 3; dx++) {
          const d = Math.hypot(dx, dy);
          const x = mx + dx;
          const y = my + dy;
          if (d <= R) {
            const crater = (dx === -2 && dy === -2) || (dx === 2 && dy === 1) || (dx === -3 && dy === 2) || (dx === 1 && dy === -3) || (dx === 3 && dy === -1) || (dx === -1 && dy === 3);
            const shaded = dx * 0.7 + dy * 0.7 > R * 0.45;
            putSky(x, y, crater || shaded ? M.MOON_DK : M.MOON);
            if (y < SEA_Y) emit(x, y, 12, 1);
          } else if (d <= R + 3 && bayerAt(x, y) < (R + 3.4 - d) * 1.6) {
            putSky(x, y, M.STAR_DIM);
          }
        }
      }
    }

    // 雲
    for (const cloud of clouds) {
      const span = CORE_W + 96;
      const cx = ((cloud.x + (calm ? 0 : anim * cloud.speed) + 48) % span) - 48;
      const x0 = Math.round(cx);
      for (let i = 0; i < cloud.list.length; i += 3) {
        const x = x0 + cloud.list[i];
        const y = cloud.y + cloud.list[i + 1];
        const under = cloud.list[i + 2];
        if (under && bayerAt(x, y) > 11) continue;
        putSky(x, y, under ? M.CLOUD_SH : M.CLOUD);
      }
    }

    // かもめ：昼に、ときどき渡る
    if (!calm && h > 7 && h < 18.5 && birds.t >= 0) {
      const flap = Math.floor(anim * 5) % 2;
      for (let i = 0; i < 3; i++) {
        const x = Math.round((birds.dir > 0 ? -12 + birds.t * 24 : CORE_W + 12 - birds.t * 24) - birds.dir * i * 9);
        const y = birds.y + (i % 2) * 4 + i + Math.round(Math.sin(birds.t * 1.3 + i) * 1.5);
        putSky(x, y, M.BIRD);
        putSky(x - 1, y - flap, M.BIRD);
        putSky(x + 1, y - flap, M.BIRD);
        putSky(x - 2, y - flap, M.BIRD);
        putSky(x + 2, y - flap, M.BIRD);
      }
    }
  };

  // ---- 海：寄せる波、太陽と月の光の道、岸で砕ける白い波
  const drawSea = () => {
    const t = anim;
    const sunOn = orb.sunOn && orb.sunY < SEA_Y + 3;
    const moonOn = orb.moonOn && orb.moonY < SEA_Y + 3;
    const sunThr = 0.4 + clamp(orb.sunUp) * 0.16;
    const sunGlow = 26 + (1 - clamp(orb.sunUp * 1.6)) * 70;
    for (let py = Math.max(0, SEA_Y + oy); py < bh; py++) {
      const y = py - oy;
      const d = y - SEA_Y;
      // 手前ほど、波は大きく、速い
      const fx = 0.36 / (1 + d * 0.05);
      const drift = t * (1.1 + d * 0.06);
      const ny = y * 0.83 + t * 0.21;
      const pathW = 2.5 + d * 0.24;
      const row = py * bw;
      for (let px = 0; px < bw; px++) {
        const i = row + px;
        if (baseBuf[i] !== M.SEA) continue;
        const x = px - ox;
        const n = noiseA((x + drift) * fx, ny);
        // 水平線のそばは、もやで明るい
        let m = d < 2 || (d < 6 && bayerAt(x, y) < (6 - d) * 4) ? M.SEA_FAR : M.SEA;
        if (n > 0.87 && d > 5) m = M.SEA_HI;
        else if (n > 0.7) m = M.SEA_LT;
        else if (n < (d < 6 ? 0.2 : 0.3)) m = M.SEA_DK;
        if (sunOn) {
          const ax = Math.abs(x - orb.sunX);
          if (ax < pathW && noiseB(x * 0.83 + t * 2.6, y * 1.21 - t * 1.9) > sunThr + (ax / pathW) * 0.42) {
            m = M.GLINT;
            emit(x, y, sunGlow);
          }
        }
        if (moonOn) {
          const ax = Math.abs(x - orb.moonX);
          if (ax < pathW && noiseB(x * 0.83 - t * 2.2, y * 1.21 + t * 1.6) > 0.5 + (ax / pathW) * 0.4) {
            m = M.GLINT;
            emit(x, y, 30);
          }
        }
        const sd = seaDist[i];
        if (sd < 14) {
          const wash = 3 + 6 * (0.5 + 0.5 * Math.sin(t * 0.85 + x * 0.12 + y * 0.05)) + 1.5 * Math.sin(t * 2.1 + x * 0.41);
          if (sd <= wash) m = sd > wash - 3.4 || bayerAt(x, y) < 5 ? M.FOAM : M.SEA_LT;
        }
        matBuf[i] = m;
      }
    }
  };

  // 沖をゆく帆かけ舟。夜は、遠い船の灯り
  const drawBoat = (h) => {
    if (h > 6.4 && h < 18.9) {
      const ph = 0.75 + (calm ? 0 : anim * 0.034);
      const bx = Math.round(150 + Math.sin(ph) * 42);
      const dir = Math.cos(ph) >= 0 ? 1 : -1;
      const by = 70 + (!calm && Math.sin(anim * 1.3) > 0.4 ? 1 : 0);
      for (let i = -4; i <= 4; i++) putFar(bx + i, by, M.RED);
      putFar(bx + dir * 5, by, M.RED);
      for (let i = -3; i <= 3; i++) putFar(bx + i, by + 1, M.WOOD_DK);
      for (let j = 1; j <= 9; j++) putFar(bx, by - j, M.WOOD_DK);
      for (let j = 0; j < 7; j++) {
        const w = 1 + Math.floor(j * 0.72);
        for (let i = 1; i <= w; i++) putFar(bx - dir * i, by - 8 + j, M.SAIL);
      }
      for (let j = 0; j < 5; j++) {
        const w = 1 + Math.floor(j * 0.5);
        for (let i = 1; i <= w; i++) putFar(bx + dir * i, by - 6 + j, M.CLOUD_SH);
      }
      // 航跡
      if (!calm) {
        for (let i = 0; i < 3; i++) if ((Math.floor(anim * 3) + i) % 2) putFar(bx - dir * (6 + i * 2), by + 1, M.FOAM);
      }
    } else if (h >= 19.4 || h < 5.2) {
      const sx = Math.round(118 + (calm ? 0 : Math.sin(anim * 0.021) * 9));
      for (let i = -2; i <= 2; i++) putFar(sx + i, SEA_Y - 1, M.SIL);
      putFar(sx - 1, SEA_Y - 2, M.SIL);
      putFar(sx, SEA_Y - 2, M.SIL);
      putFar(sx + 1, SEA_Y - 3, M.LIT_HI);
      emit(sx + 1, SEA_Y - 3, 150);
    }
  };

  const drawShadows = (h) => {
    if (h < 6.2 || h > 18.6) return;
    const a = ((h - 6) / 12) * Math.PI;
    const dir = Math.cos(a); // 太陽が左なら、影は右へ
    const fade = smoothstep(6.2, 7.6, h) * (1 - smoothstep(17.4, 18.6, h));
    const reach = 3 + Math.abs(dir) * 22;
    const mark = (x, y, strength) => {
      const px = x + ox;
      const py = y + oy;
      if (px < 0 || py < 0 || px >= bw || py >= bh) return;
      const i = py * bw + px;
      if (matBuf[i] !== 0 && strength * fade * 16 > bayerAt(x, y)) varBuf[i] = 1;
    };
    // 灯台の影：細く、長く伸びる
    for (let y = 87; y < 90; y++) for (let x = TX - 9; x <= TX + 9; x++) mark(x, y, 0.9);
    const length = reach * 2.2;
    const n = Math.ceil(length);
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const cx = Math.round(TX + dir * length * t);
      const half = 3.2 - t * 1.8;
      const cy = 88 + t * 2;
      for (let y = Math.max(87, Math.round(cy - half)); y <= cy + half; y++) mark(cx, y, 1 - t * 0.55);
    }
    // 小屋の影
    for (let y = 86; y < 93; y++) {
      const t = (y - 86) / 7;
      const shift = dir * reach * 0.8 * t;
      for (let x = Math.round(2 + Math.min(shift, 0)); x <= 46 + Math.max(shift, 0); x++) mark(x, y, 1 - t * 0.5);
    }
  };

  const drawWindow = (h) => {
    // 窓の中：14×12
    const WW = 14;
    const WH = 12;
    const lamp = h >= 19.6 && h < 22.9;
    const cook = h >= 17.2 && h < 19.6;
    const morning = h >= 7 && h < 9.6;
    const asleep = h >= 22.9 || h < 6.5;

    if (lamp || cook) {
      const flick = lamp ? lampFlick : 0.6 + 0.08 * Math.sin(anim * 9);
      const swing = lamp && !calm ? Math.round(Math.sin(anim * 0.9) * 0.7) : 0;
      for (let y = 0; y < WH; y++) {
        for (let x = 0; x < WW; x++) {
          let m;
          if (lamp) {
            // 灯りの下に、広がる光の円すい
            const cone = Math.abs(x - (4.5 + swing)) - (y - 2) * 0.62;
            m = cone < 0 && y >= 3 ? M.LIT_HI : cone < 2.2 ? M.LIT : M.LIT_DK;
          } else {
            m = Math.hypot(x - 6.5, y - 8) < 5 && bayerAt(x, y) < 8 ? M.LIT : M.LIT_DK;
          }
          if (y >= WH - 1) m = M.LIT_DK;
          put(WX + x, WY + y, m);
          if (y < WH) emit(WX + x, WY + y, (m === M.LIT_HI ? 255 : m === M.LIT ? 210 : 130) * flick, 0);
        }
      }
      if (lamp) {
        // 天井から下がる灯り：コードと、かさと、電球
        const lx = WX + 4 + swing;
        put(lx, WY, M.SIL);
        put(lx, WY + 1, M.SIL);
        rect(lx - 2, WY + 2, 5, 1, M.SIL);
        rect(lx - 1, WY + 3, 3, 1, M.LIT_HI);
        // 机と、開いた航海日誌
        rect(WX + 1, WY + 10, 9, 1, M.SIL);
        rect(WX + 2, WY + 11, 1, 1, M.SIL);
        rect(WX + 8, WY + 11, 1, 1, M.SIL);
        const pageUp = res.pageT > 0 && !calm;
        rect(WX + 4, WY + 9, 3, 1, M.SIL);
        if (pageUp) put(WX + 5, WY + 8, M.SIL);
        // 机に向かう人影。ときどき顔を上げる。まだ外にいるあいだは、誰もいない
        if (!res.inside) return { lamp, cook, asleep };
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
        // 机へのばした腕
        rect(WX + 6, WY + 8, 3, 1, M.SIL);
      } else {
        // 夕方：台所を行き来する人影と、湯気。灯をともしに上がっているあいだは、誰もいない
        const walk = calm ? 0 : Math.sin(anim * 0.8) * 3;
        if (res.inside && !aloft) blit(SPR.sil, Math.round(WX + 3 + walk), WY + 5, false, M.SIL);
        if (!calm) {
          for (let i = 0; i < 3; i++) {
            const s = (anim * 0.9 + i * 0.33) % 1;
            put(WX + 11 + Math.round(Math.sin(s * 8 + i)), WY + 7 - Math.round(s * 6), M.LIT_HI);
          }
        }
        rect(WX + 10, WY + 8, 4, 1, M.SIL);
      }
    } else if (morning) {
      // 朝：窓を開けて、伸びをする
      rect(WX, WY, WW, WH, M.ROOM);
      for (let y = 0; y < 2; y++) for (let x = 0; x < WW; x++) put(WX + x, WY + y, M.GLASS_HI);
      let bust = SPR.bust;
      if (!calm) {
        const c = (anim % 5.4) / 5.4;
        if (c > 0.16 && c < 0.24) bust = SPR.bustHalf;
        else if (c >= 0.24 && c < 0.5) bust = SPR.bustUp;
        else if (c >= 0.5 && c < 0.58) bust = SPR.bustHalf;
        else if (res.blink > 0) bust = SPR.bustBlink;
      }
      const dy = res.startle > 0 ? -1 : 0;
      if (res.inside) blit(bust, WX + 3, WY + 4 + dy);
    } else {
      // 昼間と夜中：暗いガラス。斜めの映り込み
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

    // 鎧戸：眠る時間は閉じ、朝に開く
    const closed = asleep ? 1 : 0;
    shutter += calm ? closed - shutter : clamp(closed - shutter, -0.09, 0.09);
    const leaf = Math.round(shutter * 7);
    const drawLeaf = (x0, w) => {
      for (let i = 0; i < w; i++) {
        for (let y = 0; y < 14; y++) put(x0 + i, WY - 1 + y, y % 2 === 0 ? M.WOOD : M.WOOD_LT);
      }
    };
    // 開いている鎧戸は窓の両わきに、閉じると窓の上に
    const open = 4 - Math.min(4, leaf);
    if (open > 0) {
      drawLeaf(WX - 2 - open, open);
      drawLeaf(WX + 16, open);
    }
    if (leaf > 0) {
      drawLeaf(WX, leaf);
      drawLeaf(WX + 14 - leaf, leaf);
    }

    return { lamp, cook, asleep };
  };

  const drawDoor = () => {
    if (res.doorOpen > 0) {
      rect(32, 67, 10, 18, M.SIL);
      rect(32, 67, 2, 18, M.RED_LT);
    }
  };

  // 干した洗濯もの。浜風にはためく
  const drawLaundry = (h) => {
    if (h < 10 || h >= 17) return;
    CLOTHS.forEach(([x0, w, tall, m], n) => {
      if (h < 10 + n * 0.25) return;
      for (let j = 0; j < tall; j++) {
        const sway = calm ? 0 : Math.round(Math.sin(anim * 2.2 + n * 1.7 + j * 0.45) * (j / tall) * 1.3);
        for (let i = 0; i < w; i++) put(x0 + i + sway, lineY(x0 + i) + 1 + j, m);
      }
    });
  };

  const drawResident = (plan) => {
    if (res.inside) return;
    const dy = -Math.round(res.hop);
    const startled = res.startle > 0;
    const moving = Math.abs((plan.outside ? plan.x : DOOR_X) - res.x) > 0.5;
    if (!moving && plan.act === 'fish') {
      // 桟橋の端に腰かけて、釣り糸を垂れる
      const x = FISH_X - 1;
      const y = PIER_Y - 10 + dy;
      const bite = res.pageT > 0 && !calm;
      blit(startled ? SPR.fishUp : res.blink > 0 ? SPR.fishBlink : SPR.fish, x, y);
      // 竿
      const tipX = x + 15;
      const tipY = y - 2 - (bite ? 2 : 0) - (startled ? 3 : 0);
      if (startled) line(x + 7, y + 4, tipX, tipY, M.WOOD_DK);
      else line(x + 6, y + 5, tipX, tipY, M.WOOD_DK);
      // 糸と浮き。当たりが来ると、浮きが沈んで、波紋が立つ
      const water = PIER_Y + 7;
      const bob = calm ? 0 : Math.round(Math.sin(anim * 1.6) * 0.6);
      for (let ly = tipY + 1; ly < water + bob - 1; ly++) if ((ly & 1) === 0) put(tipX, ly, M.MARK);
      if (bite) {
        put(tipX, water + 1, M.RED);
        put(tipX - 2, water + 1, M.FOAM);
        put(tipX + 2, water + 1, M.FOAM);
        put(tipX - 1, water + 2, M.FOAM);
        put(tipX + 1, water + 2, M.FOAM);
      } else {
        put(tipX, water + bob - 1, M.SAIL);
        put(tipX, water + bob, M.RED);
      }
      // 下ろした足が、小さく揺れる
      if (!calm && !startled && Math.sin(anim * 1.1) > 0.8) put(x + 8, y + 12, M.BOOT);
      if (startled) {
        rect(x + 3, y - 6, 1, 4, M.MARK);
        put(x + 3, y - 1, M.MARK);
      }
      return;
    }
    const base = groundAt(res.x);
    if (!moving && plan.act === 'tend' && !startled) {
      // 洗濯ものを干す：綱へ手をのばしては、かごへ戻る
      const reach = !calm && Math.sin(anim * 1.6) > 0.1;
      blit(reach ? SPR.up : res.blink > 0 ? SPR.blink : SPR.stand, Math.round(res.x) - 3, base - 12);
      return;
    }
    let spr = SPR.stand;
    if (startled) spr = SPR.up;
    else if (moving) spr = SPR.walk[Math.floor(res.step) % 4];
    else if (res.blink > 0) spr = SPR.blink;
    // 夕方は、沈む日のほうを向いて立つ
    const flip = !moving && plan.act === 'stroll' ? false : res.face < 0;
    blit(spr, Math.round(res.x) - 3, base - 12 + dy, flip);
    if (startled) {
      rect(Math.round(res.x), base - 19 + dy, 1, 4, M.MARK);
      put(Math.round(res.x), base - 14 + dy, M.MARK);
    }
  };

  const drawParticles = (h, dt) => {
    // 煙
    const smoking = (h >= 17.2 && h < 19.8) || (h >= 7 && h < 8.2);
    if (!calm && smoking) {
      smokeAcc += dt * (h >= 17 ? 3.2 : 1.4);
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        smoke.push({ x: 15 + Math.random() * 2, y: 35, t: 0, seed: Math.random() * 10 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.t += dt;
      s.y -= dt * (7 - s.t * 0.8);
      s.x += dt * (2.2 + Math.sin(s.t * 1.7 + s.seed) * 2.6);
      if (s.t > 4.2 || s.y < -4) {
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
    if (calm && smoking) {
      for (let i = 0; i < 5; i++) {
        const y = 34 - i * 4;
        const x = 15 + i * 2;
        rect(x, y, 1 + (i >> 1), 2, M.SMOKE);
      }
    }

    // 眠りの Z
    if (!calm && (h >= 23.4 || h < 6)) {
      zeeAcc += dt * 0.62;
      while (zeeAcc >= 1) {
        zeeAcc -= 1;
        zees.push({ x: WX + 14, y: WY - 3, t: 0 });
      }
    }
    for (let i = zees.length - 1; i >= 0; i--) {
      const z = zees[i];
      z.t += dt;
      z.y -= dt * 4;
      z.x += dt * (1.2 + Math.sin(z.t * 2) * 2);
      if (z.t > 3 || (h >= 6 && h < 23)) {
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

    // 夜光虫：夜の波間で、青く明滅する
    const night = clamp(smoothstep(19.4, 20.8, h) + (1 - smoothstep(3.6, 5, h)));
    if (night > 0.3 && !calm) {
      for (const f of glows) {
        const wx = Math.round(f.x + Math.sin(anim * 0.21 + f.seed) * 7 + Math.sin(anim * 0.8 + f.seed * 2) * 1.5);
        const wy = Math.round(f.y + Math.sin(anim * 0.37 + f.seed * 1.4) * 3);
        const pulse = Math.sin(anim * 1.2 + f.seed * 3);
        if (pulse < 0.1 || baseAt(wx, wy) !== M.SEA) continue;
        put(wx, wy, M.GLOWSEA);
        if (pulse > 0.7) put(wx + 1, wy, M.GLOWSEA);
        emit(wx, wy, 190 * pulse);
      }
    }

    // 浜のかに：横へ歩いては、はさみを振る
    if (h > 8 && h < 17.4) {
      const cx = Math.round(115 + (calm ? 0 : Math.sin(anim * 0.33) * 5 + Math.sin(anim * 1.3)));
      const cy = 102;
      const snap = !calm && Math.floor(anim * 3) % 2 === 0;
      rect(cx - 1, cy, 3, 1, M.RED);
      put(cx - 2, cy - (snap ? 1 : 0), M.RED);
      put(cx + 2, cy - (snap ? 0 : 1), M.RED);
      put(cx - 1, cy + 1, M.RED_DK);
      put(cx + 1, cy + 1, M.RED_DK);
    }
  };

  // 灯りが、まわりの地面や壁を照らす
  const pool = (cx, cy, rx, ry, L) => {
    if (L <= 0.01) return;
    for (let y = Math.max(cy - ry, -oy); y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
        const i = py * bw + px;
        const m = matBuf[i];
        if (m === 0 || m === M.SIL || m === M.LIT || m === M.LIT_HI || m === M.LIT_DK) continue;
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        const v = (1 - d) * L * 1.5;
        if (v * 16 > bayerAt(x, y)) varBuf[i] = 2;
      }
    }
  };
  // 灯台の光が、海の面をなでる
  const seaShine = (cx, cy, rx, ry, L) => {
    if (L <= 0.01) return;
    for (let y = Math.max(Math.floor(cy - ry), SEA_Y); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
        const i = py * bw + px;
        if (baseBuf[i] !== M.SEA) continue;
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if ((1 - d) * L * 24 > bayerAt(x, y)) varBuf[i] = 2;
      }
    }
  };

  // 明るさ（0〜1）を、空の上の3段の光に置き換える
  const beamMat = (v, x, y) => {
    const q = v * 3 - (bayerAt(x, y) + 0.5) / 16;
    return q > 2 ? M.BEAM_HI : q > 1 ? M.BEAM_MID : q > 0 ? M.BEAM_LOW : 0;
  };

  // ---- 灯台：日が沈むと灯り、2本の光がゆっくり回る
  // 日の暮れに、灯台守が回廊へ上がって、灯を確かめる
  const drawAloft = () => {
    if (!aloft) return;
    put(TX + 6, 23, M.RED);
    put(TX + 6, 24, M.SKIN);
    rect(TX + 5, 25, 2, 2, M.SHIRT);
    put(TX + 6, 27, M.PANTS);
  };
  const isMoon = (m) => m === M.MOON || m === M.MOON_DK;

  const drawLamp = (h, dt) => {
    const lit = h >= 18.4 || h < 6.1;
    lampL += ((lit ? 1 : 0) - lampL) * (calm ? 1 : 0.16);
    if (lampL < 0.02) {
      lampWas = false;
      drawAloft();
      return;
    }
    if (!lampWas) {
      // 灯った光は、まず沖から右の海へ回ってくる
      lampWas = true;
      beamAngle = 5.2;
    }
    if (!calm) beamAngle = (beamAngle + dt * BEAM_RATE) % (Math.PI * 2);
    const a = calm ? 0.35 : beamAngle;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);
    // 光がこちらを向くと、灯室がまぶしく光る
    const flash = calm ? 0.3 : Math.pow(Math.abs(sinA), 8);

    for (let y = 21; y < 27; y++) {
      for (let x = TX - 3; x <= TX + 3; x++) {
        put(x, y, M.LIT_HI);
        emit(x, y, (120 + 100 * flash) * lampL, 0);
      }
    }

    for (let b = 0; b < 2; b++) {
      const s = b ? -1 : 1;
      const cx = cosA * s;
      const cz = sinA * s; // 正ならこちら向き、負なら沖向き
      // こちらを向いた光は筋に見えず、灯室のまぶしさに変わる
      const side = smoothstep(0.06, 0.42, Math.abs(cx));
      const gain = lampL * side * (0.74 + 0.28 * cz);
      if (gain > 0.03) {
        const dx = cx;
        const dy = cz * BEAM_TILT;
        const rho = Math.hypot(dx, dy);
        const ux = dx / rho;
        const uy = dy / rho;
        const len = BEAM_LEN * rho;
        const grow = BEAM_LEN * 0.06 * (1 + cz * 0.3);
        const tipX = TX + ux * len;
        const tipY = LAMP_Y + uy * len;
        const pad = grow + 3;
        const xa = Math.max(-ox, Math.floor(Math.min(TX, tipX) - pad));
        const xb = Math.min(bw - ox - 1, Math.ceil(Math.max(TX, tipX) + pad));
        const ya = Math.max(-oy, Math.floor(Math.min(LAMP_Y, tipY) - pad));
        const yb = Math.min(SEA_Y - 1, Math.ceil(Math.max(LAMP_Y, tipY) + pad));
        for (let y = ya; y <= yb; y++) {
          const ry = y - LAMP_Y;
          const row = (y + oy) * bw + ox;
          for (let x = xa; x <= xb; x++) {
            const rx = x - TX;
            const along = rx * ux + ry * uy;
            if (along <= 2 || along >= len) continue;
            const base = baseBuf[row + x];
            if (base !== 0 && !(cz > 0 && (base === M.ISLE || base === M.ISLE_DK))) continue;
            const f = along / len;
            const half = 1.4 + f * grow;
            const across = Math.abs(ry * ux - rx * uy);
            if (across >= half) continue;
            const core = 1 - across / half;
            const v = gain * Math.pow(1 - f, 0.75) * core * (2 - core);
            const m = beamMat(v, x, y);
            // 月は、光の筋ごしにも欠けずに見える
            if (!m || isMoon(matBuf[row + x])) continue;
            matBuf[row + x] = m;
            if (v > 0.12) emit(x, y, 36 * v);
          }
        }
      }
      if (cz > 0.08) seaShine(TX + cx * 118, SEA_Y + 4 + cz * 8, 44, 3 + cz * 7, lampL * side * cz * 0.6);
    }

    // 灯室のまわりの暈
    const R = 3 + flash * 9;
    const span = Math.ceil(R);
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const d = Math.hypot(dx, dy);
        if (d >= R) continue;
        const x = TX + dx;
        const y = LAMP_Y + dy;
        if (baseAt(x, y) !== 0) continue;
        const v = (1 - d / R) * lampL * (0.55 + 0.75 * flash);
        const m = beamMat(v, x, y);
        const now = get(x, y);
        if (m && !isMoon(now) && !(now >= M.BEAM_HI && now <= m)) put(x, y, m);
        if (flash > 0.05) emit(x, y, 60 * v * flash, 0);
      }
    }

    // 灯台の小窓と、桟橋の灯り
    if (lampL > 0.5) {
      rect(TX - 1, 35, 2, 3, M.LIT);
      rect(TX - 1, 56, 2, 3, M.LIT);
      emit(TX, 36, 150);
      emit(TX, 57, 150);
      const flick = calm ? 1 : 0.93 + 0.07 * Math.sin(anim * 9) * Math.sin(anim * 4.1);
      for (let y = PIER_Y - 11; y < PIER_Y - 8; y++) {
        for (let x = PIER_LAMP_X - 1; x <= PIER_LAMP_X + 1; x++) {
          put(x, y, M.LIT_HI);
          emit(x, y, 230 * lampL * flick);
        }
      }
    }

    drawAloft();
  };

  const drawLights = (state, h) => {
    // 灯りの強さ
    const targetWin = state.lamp ? 1 : state.cook ? 0.46 : 0;
    const targetLan = h >= 18.4 && h < 22.9 ? 1 : 0;
    windowL += (targetWin - windowL) * (calm ? 1 : 0.28);
    lanternL += (targetLan - lanternL) * (calm ? 1 : 0.28);

    // 軒下の灯り
    if (lanternL > 0.02) {
      const flick = calm ? 1 : 0.94 + 0.06 * Math.sin(anim * 11) * Math.sin(anim * 3.7);
      rect(28, 67, 3, 1, M.WOOD_DK);
      rect(28, 68, 3, 3, M.LIT_HI);
      rect(28, 71, 3, 1, M.WOOD_DK);
      for (let y = 68; y < 71; y++) for (let x = 28; x < 31; x++) emit(x, y, 255 * lanternL * flick, 0);
    } else {
      rect(28, 67, 3, 1, M.WOOD_DK);
      rect(28, 68, 3, 3, M.GLASS);
      rect(28, 71, 3, 1, M.WOOD_DK);
    }

    // 窓から地面へ落ちる光と、壁を照らす光
    pool(WX + 7, 92, 26, 12, windowL * 0.95);
    pool(WX + 7, 70, 17, 10, windowL * 0.36);
    pool(29, 72, 11, 13, lanternL * 0.5);
    pool(29, 90, 19, 7, lanternL * 0.6);
    // 桟橋の灯りが、板と波を照らす
    pool(PIER_LAMP_X, PIER_Y + 2, 13, 6, (lampL > 0.5 ? lampL : 0) * 0.55);
  };

  // ---- 世界を1枚描く
  let keyA = 0;
  let keyB = 1;
  let keyP = 0;
  const pickKeys = (h) => {
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (h >= KEYS[i][0] && h < KEYS[i + 1][0]) {
        keyA = i;
        keyB = i + 1;
        keyP = clamp(((h - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]) - 0.32) / 0.36);
        return;
      }
    }
    keyA = 0;
    keyB = 1;
    keyP = 0;
  };

  const renderWorld = (clock, dt, hurry) => {
    const h = hourOf(clock);
    if (!calm) anim += dt;
    matBuf.set(baseBuf);
    varBuf.fill(0);
    emitList.length = 0;
    for (const c of sources) {
      c.w = 0;
      c.x = 0;
      c.y = 0;
    }
    lampFlick = calm ? 1 : 0.95 + 0.05 * Math.sin(anim * 13) * Math.sin(anim * 5.3);

    if (!calm) {
      birds.next -= dt;
      if (birds.t >= 0) {
        birds.t += dt;
        if (birds.t > 10) birds.t = -1;
      } else if (birds.next <= 0) {
        birds.t = 0;
        birds.next = 12 + Math.random() * 14;
        birds.y = 10 + Math.random() * 22;
        birds.dir = Math.random() < 0.5 ? 1 : -1;
      }
      shoot.next -= dt;
      if (shoot.t >= 0) {
        shoot.t += dt;
        if (shoot.t > 0.6) shoot.t = -1;
      } else if (shoot.next <= 0) {
        shoot.t = 0;
        shoot.next = 9 + Math.random() * 16;
        shoot.x = 10 + Math.random() * 130;
        shoot.y = 2 + Math.random() * 20;
      }
    }

    const plan = stepResident(dt, h, hurry);
    aloft = res.inside && h >= 18 && h < 18.9;
    placeOrbs(h);
    drawSky(h);
    drawLamp(h, dt);
    drawSea();
    drawBoat(h);
    drawShadows(h);
    const state = drawWindow(h);
    drawDoor();
    drawLights(state, h);
    drawLaundry(h);
    drawResident(plan);
    drawParticles(h, dt);

    // ---- 材質 → パレット。時刻のかなめのあいだは、ディザで置き換える
    pickKeys(h);
    const ta = table[keyA];
    const tb = table[keyB];
    const sa = skyKeys[keyA];
    const sb = skyKeys[keyB];
    const p = keyP * 16;
    const n = bw * bh;
    const beam0 = M.BEAM_HI;
    const beam1 = M.BEAM_LOW;
    for (let i = 0; i < n; i++) {
      const m = matBuf[i];
      const useB = thrA[i] < p;
      let idx;
      if (m === 0) {
        idx = useB ? sb[i] : sa[i];
      } else {
        idx = (useB ? tb : ta)[varBuf[i] * NM + m];
        if (m >= beam0 && m <= beam1) {
          // 灯台の光は、空を暗くしない
          const sky = useB ? sb[i] : sa[i];
          if (STEP_L[sky] >= STEP_L[idx]) idx = sky;
        }
      }
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
      console.warn('toggle-lighthouse:シェーダーを作れないので、2D で描く', error);
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
    foamSrc = new Uint8Array(bw * bh);
    seaDist = new Uint8Array(bw * bh);
    coastCol = new Float32Array(bw);
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
  let x = 0; // 0 = 昼、1 = 夜
  let velocity = 0;
  let target = 0;
  let moving = false;
  let checked = false;
  let stretch = 0;
  let stretchV = 0;
  let lift = 0;
  let liftTarget = 0;
  let hurry = 0;

  // 時間の流れ：右へは昼から夜へ。右端から戻るときは、夜明けを通って次の昼へ
  let branch = 'pm';
  let amStart = CLOCK_NIGHT;
  let nightClock = CLOCK_NIGHT;
  const clockOf = () => {
    if (branch === 'am') return mix(36, amStart, x);
    if (x >= 1) return nightClock;
    return CLOCK_DAY + (CLOCK_NIGHT - CLOCK_DAY) * x;
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
  const phaseName = (h) => (h < 5 || h >= 20 ? '夜' : h < 7 ? '夜明け' : h < 10 ? '朝' : h < 16.5 ? '昼' : '夕方');

  const commit = (value) => {
    const night = value >= 1;
    x = night ? 1 : 0;
    velocity = 0;
    moving = false;
    if (night) {
      nightClock = branch === 'am' ? amStart : CLOCK_NIGHT;
      branch = 'pm';
    } else {
      branch = 'pm';
    }
    if (checked !== night) {
      checked = night;
      button.setAttribute('aria-checked', String(night));
      root.dispatchEvent(new CustomEvent('lighthouse:change', { bubbles: true, composed: true, detail: { night } }));
    }
    setStatus(night ? '夜' : '昼');
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

    gl.uniform3fv(loc.uShellDay, unit(C3));
    gl.uniform3fv(loc.uShellNight, unit(I1));
    gl.uniform3fv(loc.uInk, unit(I0));
    gl.uniform3fv(loc.uLight, unit(C3));
    gl.uniform3fv(loc.uHiNight, unit(I3));
    gl.uniform3fv(loc.uLoNight, unit(I0));
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
    const skyU = unit(A3);
    const skyI = (skyW / 255 / 110) * 0.55;
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

  const nightAmount = (h) => clamp(smoothstep(17.4, 20.2, h) + (1 - smoothstep(4.8, 7.2, h)));

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

    // ---- 右端では、時間が静かに進み、やがて灯りを消して眠る
    if (!calm && x >= 1 && !moving && !drag && nightClock < CLOCK_SLEEP) {
      nightClock = Math.min(CLOCK_SLEEP, nightClock + (dt * (CLOCK_SLEEP - CLOCK_NIGHT)) / NIGHT_CREEP);
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
      const night = nightAmount(hourOf(clock));
      // 世界の暗さ（0 = 昼、1 = 夜）。使い手はこの値で、ページの地を合わせられる。変わったときだけ書く
      const nightText = night.toFixed(3);
      if (nightText !== lastNightText) {
        lastNightText = nightText;
        root.style.setProperty('--night', nightText);
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

  // ---- 速く動かすと、灯台守が驚いて空を見上げる
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
    setStatus(phaseName(hourOf(branch === 'am' ? mix(36, amStart, target) : CLOCK_DAY + (CLOCK_NIGHT - CLOCK_DAY) * target)));
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
  res.x = FISH_X;
  res.inside = false;
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
