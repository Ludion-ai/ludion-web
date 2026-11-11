/* UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT) */
// part.js — ESモジュール。rootの中だけを触る
// 雨の日の喫茶店のスイッチ：スイッチのレールの中に、雨の通りと小さな喫茶店があり、店主が1人で店を開けている。
//
// 世界：低い解像度で、24色の番号だけで描く。時刻の変化はディザの置き換えで行い、中間色を作らない。
// 外側：なめらかな殻、窓の奥行き、液体のレンズを WebGL で描く。ピクセルは常に整数倍のまま写す。
// 灯り：世界の光る画素をぼかした「光の場」を作り、ガラスと外の面を照らす。傘の人が窓を横切れば、外の光も変わる。
// ガラス：窓には水滴がつき、曇っている。つまみが通ると曇りと水滴をぬぐい、しばらくすると、また曇る。
// 路面：濡れた路面は、上の景色を揺らしながら映す。店の灯りは、水たまりの中で長くのびる。
// 時間：左端は昼、右端は夜。右へ動かすと 昼→夕方→夜。左へ戻すと 夜→深夜→夜明け→朝→昼 と、時間は前へ進む。
// 色は JS に書かない。--_bg、--_surface、--_fg、--_muted、--_accent、--_leaf の色相を、決めた明るさで並べて作る。

const CORE_W = 192; // 景色の中心の幅。窓が広いぶんは、両わきへ広がる
const CORE_H = 112;
const GROUND = 84; // 建物の足もと。ここから歩道
const CURB = 90; // 縁石
const ROAD = 92; // 車道
const HORIZON = GROUND;
const MARGIN = 14; // レンズが窓の外を覗いてもよいよう、世界を少し広く描く
const WORLD_HZ = 30;
const WORLD_SLACK = 0.004; // 画面の更新の時刻は揺れる。この秒数まで足りなくても、次のコマを出す
const PILL_RATIO = 1.85; // 縦 : 横
const CLOCK_DAY = 12;
const CLOCK_NIGHT = 21.5;
const CLOCK_SLEEP = 23.4;
const NIGHT_CREEP = 48; // 右端に着いてから、店を閉めて眠るまでの秒数の目安
const FOG_RETURN = 16; // ぬぐった窓が、また曇るまでの秒数

// 店の窓（中は毎フレーム描く）と、戸口、席の位置
const WX = 24;
const WY = 55;
const WW = 46;
const WH = 23;
const DOOR_X = 85;
const SEAT_X = 128;

// ---- パレット：6つのトークン × 4つの明るさ = 24色
const RAMPS = [
  ['bg', [0.76, 0.85, 0.93, 0.985]],
  ['surface', [0.3, 0.42, 0.55, 0.7]],
  ['fg', [0.17, 0.25, 0.33, 0.44]],
  ['muted', [0.5, 0.62, 0.74, 0.86]],
  ['accent', [0.5, 0.66, 0.8, 0.92]],
  ['leaf', [0.32, 0.44, 0.56, 0.7]],
];
const C0 = 0, C1 = 1, C2 = 2, C3 = 3;
const W0 = 4, W1 = 5, W2 = 6, W3 = 7;
const I0 = 8, I1 = 9, I2 = 10, I3 = 11;
const U0 = 12, U1 = 13, U2 = 14, U3 = 15;
const A0 = 16, A1 = 17, A2 = 18, A3 = 19;
const G0 = 20, G1 = 21, G2 = 22, G3 = 23;

// ---- 材質：[昼, 夕, 宵, 夜] のパレット番号
const MATS = [
  ['SKY', C3, C3, C3, C3],
  ['BG_FAR', U1, U0, I2, I1],
  ['BG_MID', U0, I3, I1, I0],
  ['BG_WIN', I3, I2, I0, I0],
  ['ROAD', I3, I2, I1, I0],
  ['ROAD_LT', U0, I3, I2, I1],
  ['ROAD_SKY', U1, U0, I3, I1],
  ['ROAD_MARK', U2, U1, I3, I2],
  ['PAVE', U1, U0, I2, I1],
  ['PAVE_DK', U0, I3, I2, I0],
  ['PAVE_LT', U2, U1, I3, I2],
  ['CURB', U2, U1, I3, I2],
  ['CURB_DK', I3, I2, I1, I0],
  ['BRICK', W2, W1, W0, I1],
  ['BRICK_LT', W3, W2, W1, I2],
  ['BRICK_DK', W1, W0, I2, I1],
  ['WALL_SH', W0, I3, I1, I0],
  ['STONE', U1, U0, I2, I1],
  ['STONE_LT', U2, U1, I3, I2],
  ['ROOF', I2, I2, I1, I0],
  ['ROOF_LT', I3, I3, I2, I1],
  ['ROOF_HI', U0, U0, I3, I1],
  ['WOOD', W1, W1, I2, I1],
  ['WOOD_LT', W2, W2, I3, I2],
  ['WOOD_DK', W0, W0, I1, I0],
  ['FRAME', W0, W0, I2, I0],
  ['FRAME_LT', W1, W1, I3, I1],
  ['DOOR', W1, W1, I2, I1],
  ['BRASS', A1, A1, A0, A0],
  ['FASCIA', W0, W0, I2, I0],
  ['SIGN', C3, A3, U1, I3],
  ['SIGN_ON', A3, A3, A3, A3],
  ['AWN_G', G1, G0, I2, I1],
  ['AWN_C', C2, A3, U1, I3],
  ['AWN_G_SH', G0, I3, I1, I0],
  ['AWN_C_SH', C0, A2, U0, I2],
  ['BOARD', I1, I1, I0, I0],
  ['CHALK', C1, C1, U1, I3],
  ['POST', I1, I1, I0, I0],
  ['POST_LT', I3, I2, I1, I1],
  ['LAMP_OFF', C1, U2, I3, I1],
  ['BARK', W0, W0, I1, I0],
  ['BARK_LT', W1, W0, I2, I1],
  ['LEAF0', G0, G0, I1, I0],
  ['LEAF1', G1, G0, I2, I0],
  ['LEAF2', G2, G1, I2, I1],
  ['LEAF3', G3, G2, I3, I1],
  ['STEM', G0, G0, I2, I0],
  ['HYD0', U0, U0, I2, I1],
  ['HYD1', U1, U0, I3, I1],
  ['HYD2', U2, U1, U0, I2],
  ['HYD3', U3, U2, U1, I3],
  ['HYD_C', C2, U3, U1, I3],
  ['GLASS', U0, I3, I1, I0],
  ['GLASS_HI', U2, U0, I2, I1],
  ['ROOM', I3, I2, I1, I0],
  ['BLIND', C2, A3, U0, I2],
  ['BLIND_DK', C0, A2, I3, I1],
  ['PLATE_OFF', I1, I1, I0, I0],
  ['LIT', A2, A2, A2, A2],
  ['LIT_HI', A3, A3, A3, A3],
  ['LIT_DK', A1, A1, A1, A1],
  ['LIT_DEEP', A0, A0, A0, A0],
  ['SIL', I0, I0, I0, I0],
  ['SIL_SOFT', W0, W0, W0, W0],
  ['COUNTER', W0, W0, W0, W0],
  ['COUNTER_LT', W1, W1, W1, W1],
  ['SKIN', A3, A3, U2, I3],
  ['HAIR', I0, I0, I0, I0],
  ['SHIRT', C2, A3, U1, I3],
  ['SHIRT_DK', I2, I2, I1, I0],
  ['PANTS', I2, I2, I1, I0],
  ['BOOT', I0, I0, I0, I0],
  ['BOOK', C3, C3, U2, I3],
  ['BOOK_DK', C1, C1, U0, I2],
  ['SKIN_IN', A3, A3, A3, A3],
  ['SHIRT_IN', C2, C2, C2, C2],
  ['CUP', C3, A3, U2, I3],
  ['COFFEE', W0, W0, I1, I0],
  ['STEAM', C1, C1, U2, I3],
  ['CAT', I1, I1, I0, I0],
  ['CAT_LT', I3, I3, I1, I1],
  ['SHELL', W2, W1, I3, I1],
  ['SNAIL', C0, A2, U0, I2],
  ['COAT_A', W1, W0, I2, I1],
  ['COAT_A2', W0, I3, I1, I0],
  ['COAT_B', U0, I3, I2, I1],
  ['COAT_B2', I3, I2, I1, I0],
  ['UMB_A', I2, I2, I1, I1],
  ['UMB_A2', I3, I3, I2, I2],
  ['UMB_B', A1, A1, A0, W0],
  ['UMB_B2', A2, A1, A0, W1],
  ['UMB_C', C1, A3, U1, I3],
  ['UMB_C2', C3, A3, U2, U0],
  ['UMB_D', G1, G0, I2, I1],
  ['UMB_D2', G2, G1, I3, I2],
  ['CAR', G1, G0, I2, I1],
  ['CAR_LT', G2, G1, I3, I2],
  ['CAR_GLASS', I1, I1, I0, I0],
  ['WHEEL', I0, I0, I0, I0],
  ['TAIL', A0, A0, A0, A0],
  ['CLOUD', U3, U1, I3, I2],
  ['CLOUD_SH', U2, U0, I2, I1],
  ['SMOKE', C1, C1, U2, I3],
  ['SMOKE_DK', U2, U1, U0, I2],
  ['RAIN', C2, U3, U1, U0],
  ['RAIN_FAR', U3, U1, I3, I2],
  ['RAIN_LIT', A3, A3, A3, A3],
  ['RIPPLE', C1, U3, U1, U0],
  ['RIPPLE_LIT', A3, A3, A3, A3],
  ['MARK', I0, I0, C3, C3],
  ['ZZZ', U3, U3, U3, U3],
];
const M = Object.fromEntries(MATS.map((row, i) => [row[0], i]));

// 光る材質：店の灯りとして、まわりを照らす強さ。濡れた路面にも強く映る
const GLOW = new Float32Array(MATS.length);
GLOW[M.LIT_HI] = 1;
GLOW[M.LIT] = 0.75;
GLOW[M.LIT_DK] = 0.45;
GLOW[M.LIT_DEEP] = 0.22;
GLOW[M.SIGN_ON] = 0.7;
// 濡れて、景色を映す材質
const WET = new Uint8Array(MATS.length);
for (const name of ['ROAD', 'ROAD_LT', 'ROAD_MARK', 'PAVE', 'PAVE_DK', 'PAVE_LT']) WET[M[name]] = 1;

// ---- 時刻のかなめ：[時, 材質の列, 空の色（上から地平線へ）]。雨雲の空は、一日じゅう低く暗い
const KEYS = [
  [0, 3, [I0, I0, I1, I1, I2]],
  [4.8, 3, [I0, I0, I1, I1, I2]],
  [5.4, 3, [I0, I1, I1, I2, I3]],
  [6.0, 2, [I1, I2, I2, I3, U0]],
  [6.7, 1, [I3, U0, U0, U1, U1, U2]],
  [7.8, 0, [U1, U1, U2, U2, U3]],
  [10, 0, [U1, U2, U2, U3, U3]],
  [15, 0, [U1, U1, U2, U2, U3]],
  [17, 1, [U0, U0, U1, U1, U2]],
  [18, 1, [I3, I3, U0, U0, U1, A0]],
  [19, 2, [I1, I2, I2, I3, U0]],
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

// ---- 店主と、客と、猫の絵
const CHARS = { H: 'HAIR', S: 'SKIN', E: 'HAIR', T: 'SHIRT', D: 'SHIRT_DK', P: 'PANTS', B: 'BOOT', W: 'BOOK', K: 'BOOK_DK' };
const CAT_CHARS = { K: 'CAT', L: 'CAT_LT', E: 'LIT_HI' };
const makeSprite = (rows, chars = CHARS) => {
  const list = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') list.push([x, y, M[chars[ch]]]);
    });
  });
  return { list, w: rows[0].length, h: rows.length };
};
const HEAD = ['..HHH..', '.HHHHH.', '.HHSSS.', '.HSSES.', '..SSSS.'];
const HEAD_BLINK = ['..HHH..', '.HHHHH.', '.HHSSS.', '.HSSSS.', '..SSSS.'];
const HEAD_UP = ['..HHH..', '.HHHHH.', '.HHSES.', '.HSSSS.', '..SSSS.'];
const BODY_STAND = ['..TTT..', '.TTTTT.', '.STTTS.', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
const BODY_WALK1 = ['..TTT..', '.TTTTT.', '..TTTS.', '.SDDD..', '..PPP..', '.PP.P..', '.B..BB.'];
const BODY_WALK2 = ['..TTT..', '.TTTTT.', '.STTTS.', '..DDD..', '..PPP..', '..PP...', '..BB...'];
const BODY_WALK3 = ['..TTT..', '.TTTTT.', '.STTT..', '..DDDS.', '..PPP..', '..P.PP.', '.BB..B.'];
const BODY_ARMS = ['S.TTT.S', 'STTTTTS', '..TTT..', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
const person = (head, body) => makeSprite([...head, ...body]);
const SEAT_BODY = ['...TTTT..', '...STTTT.', '...STTTT.', '...DDDDD.', '.PPPPPPP.', '.P.......', '.P.......', 'BB.......'];
const SPR = {
  stand: person(HEAD, BODY_STAND),
  blink: person(HEAD_BLINK, BODY_STAND),
  walk: [person(HEAD, BODY_WALK1), person(HEAD, BODY_WALK2), person(HEAD, BODY_WALK3), person(HEAD, BODY_WALK2)],
  up: person(HEAD_UP, BODY_ARMS),
  crouch: person(HEAD, ['..TTT..', '.TTTTTS', '..DDD.S', '..PPP..', '.BB.B..']),
  seat: makeSprite(['....HHH..', '...HHHHH.', '...SSSHH.', '...ESSHH.', '...SSSS..', ...SEAT_BODY]),
  seatBlink: makeSprite(['....HHH..', '...HHHHH.', '...SSSHH.', '...SSSHH.', '...SSSS..', ...SEAT_BODY]),
  seatUp: makeSprite(['....HHH..', '...HHHHH.', '...ESSHH.', '...SSSHH.', '...SSSS..', ...SEAT_BODY]),
  bust: makeSprite(['...HHH...', '..HHHHH..', '..HSSES..', '...SSS...', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.', '.TTTTTTT.']),
  bustBlink: makeSprite(['...HHH...', '..HHHHH..', '..HSSSS..', '...SSS...', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.', '.TTTTTTT.']),
  bustUp: makeSprite(['S..HHH..S', 'S.HHHHH.S', 'S.HSSES.S', 'SS.SSS.SS', '.STTTTTS.', '..TTTTT..', '..TTTTT..', '..TTTTT..']),
  bustHalf: makeSprite(['...HHH...', '..HHHHH..', 'S.HSSES.S', 'SS.SSS.SS', '.STTTTTS.', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.']),
  sil: makeSprite(['...HHH..', '..HHHHH.', '..HHHHH.', '...HHH..', '..HHHHH.', '.HHHHHHH', 'HHHHHHHH', 'HHHHHHHH']),
  silLook: makeSprite(['....HHH.', '...HHHHH', '...HHHHH', '...HHH..', '..HHHHH.', '.HHHHHHH', 'HHHHHHHH', 'HHHHHHHH']),
  cat: makeSprite(['K.K....', 'KKK....', 'EKK....', 'KKKLLK.', '.KKKKK.', '.KK.KK.'], CAT_CHARS),
  catSleep: makeSprite(['K.K.....', 'KKKKKK..', 'KKKLLKKK', 'KKKKKKKK'], CAT_CHARS),
};
const GLYPHS = {
  C: ['111', '100', '100', '100', '111'],
  A: ['010', '101', '111', '101', '101'],
  F: ['111', '100', '110', '100', '100'],
  E: ['111', '100', '110', '100', '111'],
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
uniform float uBezel, uK, uNight, uLift, uSeam, uCalm, uTime, uRain;
uniform vec3 uShellDay, uShellNight, uInk, uLight, uHiNight, uLoNight, uSkyDay, uHomeCol, uSkyCol;
uniform vec2 uHomePos, uSkyPos;
out vec4 outColor;

float rb(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// なめらかに読む（B スプライン。光の場の格子が見えないように）
vec4 smoothTex(sampler2D t, vec2 uv, vec2 size) {
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
// rgb は光の場、a は「つまみがぬぐった跡」
vec4 glowNear(vec2 frag) {
  vec2 uv = vec2(frag.x / uRes.x, 1.0 - frag.y / uRes.y);
  // 光も跡もないところでは、なめらかに読む4回を省く。窓の大半はここを通る
  vec4 rough = textureLod(uGlowNear, uv, 0.0);
  if (dot(abs(rough), vec4(1.0)) < 1.0e-4) return vec4(0.0);
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

// ---- 窓ガラスの水滴
// 小さな粒は、ふくらんでは消える。大きな粒は、止まっては滑り、曇りに筋を残す
vec2 gOff;
float gMask, gHi, gRim, gTrail;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void bead(vec2 q, float r) {
  if (r < 1.0e-3) return;
  float d = length(q);
  float m = 1.0 - smoothstep(r * 0.7, r, d);
  if (m <= 0.0) return;
  // 水滴は小さな凸レンズ。奥の景色を逆さに映す
  gOff -= q * 3.4 * m;
  gMask = max(gMask, m);
  gRim = max(gRim, m * smoothstep(r * 0.4, r * 0.85, d));
  gHi = max(gHi, m * (1.0 - smoothstep(0.0, r * 0.34, length(q - vec2(-r * 0.3, r * 0.34)))));
}

void beads(vec2 uv, float t, float cells, float rMin, float rMax, float seed, float rate) {
  vec2 g = uv * cells + seed;
  vec2 id = floor(g);
  vec2 f = g - id - 0.5;
  float n = hash21(id + seed);
  if (n < rate) return;
  vec2 c = (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.5;
  float r = mix(rMin, rMax, hash21(id + 11.3));
  float life = fract(t * (0.035 + n * 0.05) + n * 9.0);
  r *= smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.86, 1.0, life));
  bead((f - c) / cells, r / cells);
}

void runner(vec2 uv, float t, float seed) {
  float cols = 3.4;
  float cx = uv.x * cols + seed * 7.3;
  float id = floor(cx);
  float n = hash21(vec2(id, seed));
  // 雨が強いほど、滑る粒が増える
  float gate = smoothstep(0.75 - uRain * 0.35, 0.82 - uRain * 0.35, n);
  if (gate <= 0.0) return;
  float s = t * (0.10 + n * 0.14) + n * 31.0;
  float cyc = floor(s);
  float fr = s - cyc;
  // 止まっては、滑る
  float fall = fr + 0.045 * sin(fr * 18.85);
  float y0 = 1.3 - 2.7 * fall;
  float wob = sin(uv.y * 7.0 + n * 40.0 + cyc) * 0.05 + sin(uv.y * 19.0 + n * 11.0) * 0.016;
  float x0 = (hash21(vec2(id, cyc + seed)) - 0.5) * 0.3 + wob;
  vec2 q = vec2((cx - id - 0.5) / cols - x0, uv.y - y0);
  float r = (0.032 + 0.02 * n) * gate;
  bead(vec2(q.x, q.y > 0.0 ? q.y * 0.62 : q.y), r);
  // 通ったあとの筋と、筋に残る小さな粒
  float tr = smoothstep(0.0, 0.03, q.y) * (1.0 - smoothstep(0.05, 0.9, q.y));
  tr *= (1.0 - smoothstep(r * 0.35, r * 0.95, abs(q.x))) * (1.0 - smoothstep(0.85, 1.0, fr));
  gTrail = max(gTrail, tr);
  if (tr > 0.05) {
    float cell = fract(uv.y * 11.0 + n * 3.0) - 0.5;
    bead(vec2(q.x, cell / 11.0), r * 0.28 * tr);
  }
}

void glassRain(vec2 uv, float t) {
  gOff = vec2(0.0);
  gMask = 0.0;
  gHi = 0.0;
  gRim = 0.0;
  gTrail = 0.0;
  beads(uv, t, 8.0, 0.08, 0.22, 0.0, 0.5);
  beads(uv, t * 0.7, 3.5, 0.06, 0.2, 5.3, 0.68);
  runner(uv, t, 1.0);
  runner(uv, t * 0.83, 2.0);
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
      float win = uPill.y - uBezel;
      vec4 nearAll = glowNear(frag);
      vec3 near = nearAll.rgb;
      float wiped = clamp(nearAll.a, 0.0, 1.0);

      // 水滴：つまみがぬぐったところには、しばらくつかない
      glassRain(p / win, uTime);
      float keep = 1.0 - wiped * wiped * 0.94;
      vec3 c = worldExact(frag + gOff * win * keep);
      c *= 1.0 - gRim * keep * 0.3;

      // 曇り：ふちほど濃く、水滴の筋とつまみの跡だけが透ける。店の灯りで、曇りも染まる
      float blotch = 0.78 + 0.22 * sin(p.x / win * 2.1 + 0.7) * sin(p.y / win * 3.3 - 0.4);
      float edgeFog = exp(max(dw, -win) / (win * 0.62));
      float fog = (0.1 + 0.3 * edgeFog) * blotch * (1.0 - wiped);
      fog *= 1.0 - clamp(gTrail * 0.92 + gMask, 0.0, 1.0);
      vec3 fogCol = clamp(envHigh * 0.92 + near * 0.7, 0.0, 1.0);
      c = mix(c, fogCol, fog);

      // 水滴の小さなハイライト
      c += envHigh * gHi * keep * mix(0.7, 0.35, uNight);

      // 灯りのにじみ：ピクセルの上に、ガラスのなめらかな光が乗る
      c = 1.0 - (1.0 - clamp(c, 0.0, 1.0)) * (1.0 - clamp(near * 0.82, 0.0, 1.0));

      // ガラスの映り込み：広く、なだらかに。縁はなぞらない
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
        vec3 throughGlow = glowNear(center + base + shiftDir).rgb;
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

        // 店の灯りと街灯も、レンズの面に映る。映るのは縁の近くだけ
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
  const palette = new Array(24);
  const palette32 = new Uint32Array(24);
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
    if (id === W0) return I2;
    if (id === U0) return I3;
    if (id === A0) return W0;
    if (id === G0) return I2;
    return id;
  };
  const litOf = (dayId) => {
    const L = STEP_L[dayId];
    return L < 0.72 ? A0 : L < 0.9 ? A0 : A1;
  };
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
  // 服の色だけを変える表（客、店の中の店主）
  const tinted = (pairs) => {
    const t = Uint8Array.from({ length: NM }, (_, i) => i);
    for (const [from, to] of pairs) t[from] = to;
    return t;
  };
  const INDOOR = tinted([[M.SKIN, M.SKIN_IN], [M.SHIRT, M.SHIRT_IN]]);
  const COATS = [
    tinted([[M.SHIRT, M.COAT_A], [M.SHIRT_DK, M.COAT_A2]]),
    tinted([[M.SHIRT, M.COAT_B], [M.SHIRT_DK, M.COAT_B2]]),
    tinted([[M.SHIRT, M.UMB_C], [M.SHIRT_DK, M.COAT_B2]]),
    tinted([[M.SHIRT, M.COAT_A2], [M.SHIRT_DK, M.COAT_A]]),
  ];
  const UMBRELLAS = [[M.UMB_A, M.UMB_A2], [M.UMB_B, M.UMB_B2], [M.UMB_C, M.UMB_C2], [M.UMB_D, M.UMB_D2]];

  // ---- 世界の大きさ（整数倍が決める）
  let bw = 1;
  let bh = 1;
  let ox = 0;
  let oy = 0;
  let k = 1;
  let matBuf = new Uint8Array(1);
  let baseBuf = new Uint8Array(1);
  let varBuf = new Uint8Array(1);
  let wetBuf = new Uint8Array(1);
  let thrA = new Uint8Array(1);
  let pixels = new Uint32Array(1);
  let pixelBytes = new Uint8Array(pixels.buffer);
  let skyKeys = [];
  let canopy = [];
  let bgWins = [];
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
  const blit = (s, x, y, flip = false, force = -1, map = null) => {
    for (const [dx, dy, m] of s.list) put(flip ? x + s.w - 1 - dx : x + dx, y + dy, force >= 0 ? force : map ? map[m] : m);
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

  // ---- 動かない背景：雨にかすむ街並み、歩道、車道
  const skylineFar = (x) => 32 + Math.floor(noiseA(Math.floor((x + 400) / 15) * 0.83 + 3, 1.5) * 18);
  const skylineMid = (x) => 46 + Math.floor(noiseB(Math.floor((x + 400) / 21) * 0.71 + 9, 4.5) * 20);

  const paintGround = () => {
    for (let py = 0; py < bh; py++) {
      const y = py - oy;
      for (let px = 0; px < bw; px++) {
        const x = px - ox;
        const i = py * bw + px;
        wetBuf[i] = 0;
        if (y < GROUND) {
          const mid = skylineMid(x);
          const far = skylineFar(x);
          if (y >= mid) {
            matBuf[i] = M.BG_MID;
          } else if (y >= far) {
            // 遠い建物は、上の端を雨空へディザで溶かす
            matBuf[i] = y - far < 2 && bayerAt(x, y) > 9 ? 0 : M.BG_FAR;
          }
          continue;
        }
        if (y < CURB) {
          // 歩道の敷石。ところどころに水たまり
          const joint = (x + 400) % 8 === 0 || y === GROUND + 3;
          matBuf[i] = joint ? M.PAVE_DK : noiseB(x * 0.4, y * 0.6) > 0.7 ? M.PAVE_LT : M.PAVE;
          wetBuf[i] = noiseA(x * 0.09 + 5, y * 0.5) > 0.6 ? 1 : 0;
        } else if (y < ROAD) {
          matBuf[i] = y === CURB ? M.CURB : M.CURB_DK;
        } else {
          // 濡れたアスファルト。水たまりは、よく映す
          matBuf[i] = noiseB(x * 0.6, y * 0.9) > 0.72 ? M.ROAD_LT : M.ROAD;
          if ((y === 104 || y === 105) && (x + 400) % 24 < 12) matBuf[i] = M.ROAD_MARK;
          wetBuf[i] = noiseA(x * 0.05 + 20, y * 0.22 + 3) > 0.52 ? 1 : 0;
        }
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

  // 紫陽花：茂みの上に、青い手まりをのせる
  const paintHydrangea = (cx, cy, rx, ry, seed) => {
    paintBush(cx, cy, rx, ry, seed);
    const r = seeded(seed + 500);
    const count = Math.round(rx * 0.9);
    for (let i = 0; i < count; i++) {
      const hx = Math.round(cx + (r() - 0.5) * rx * 1.7);
      const hy = Math.round(cy + (r() - 0.62) * ry * 1.4);
      const size = 2 + Math.floor(r() * 2);
      for (let dy = -size; dy <= size; dy++) {
        for (let dx = -size; dx <= size; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > size + 0.2) continue;
          const v = (1 - d / (size + 1)) * 0.5 - dy * 0.1 + (bayerAt(hx + dx, hy + dy) / 16) * 0.5;
          const m = v > 0.72 ? M.HYD_C : v > 0.52 ? M.HYD3 : v > 0.34 ? M.HYD2 : v > 0.18 ? M.HYD1 : M.HYD0;
          put(hx + dx, hy + dy, m);
        }
      }
    }
  };

  const paintBrick = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const row = Math.floor(y / 3);
        const joint = y % 3 === 2 || (x + (row & 1) * 3) % 6 === 0;
        const n = noiseB(x * 0.35, y * 0.45);
        put(x, y, joint ? (n > 0.6 ? M.BRICK : M.BRICK_DK) : n > 0.64 ? M.BRICK_LT : M.BRICK);
      }
    }
  };

  const paintCafe = () => {
    const L = 16;
    const R = 112;
    // 煙突（屋根の奥）。珈琲を焙煎する日に煙が出る
    paintBrick(92, 8, 8, 13);
    rect(91, 6, 10, 2, M.STONE_LT);
    rect(91, 8, 10, 1, M.STONE);

    // 壁
    paintBrick(L, 25, R - L, GROUND - 25);
    // 右の端は陰
    for (let x = R - 3; x < R; x++) {
      for (let y = 25; y < GROUND; y++) if (bayerAt(x, y) < (x - (R - 3) + 1) * 5) put(x, y, M.WALL_SH);
    }
    // 土台の石
    rect(L - 1, GROUND - 3, R - L + 2, 3, M.STONE);
    for (let x = L - 1; x < R + 1; x += 5) {
      rect(x, GROUND - 3, 4, 1, M.STONE_LT);
      put(x + 2, GROUND - 2, M.STONE_LT);
    }

    // 屋根：台形。瓦の段
    const RT = 13;
    const RB = 25;
    for (let y = RT; y < RB; y++) {
      const t = (y - RT) / (RB - RT);
      const l = Math.round(mix(26, L - 3, t));
      const r = Math.round(mix(102, R + 3, t));
      for (let x = l; x <= r; x++) {
        const row = Math.floor((y - RT) / 3);
        const tile = (x + (row & 1) * 3 + 60) % 6;
        let m = M.ROOF;
        if ((y - RT) % 3 !== 0 && tile !== 0) m = (y - RT) % 3 === 1 ? M.ROOF_LT : M.ROOF;
        if (x - l < 5 + t * 8 && (y - RT) % 3 === 1 && tile !== 0) m = M.ROOF_HI;
        put(x, y, m);
      }
    }
    rect(25, RT - 1, 78, 1, M.ROOF_HI);
    rect(L - 3, RB, R - L + 7, 1, M.WOOD_DK);

    // 二階の窓と、花の箱（灯りは毎フレーム描く）
    const r = seeded(77);
    for (const wx of [30, 58, 86]) {
      rect(wx, 27, 12, 8, M.FRAME);
      rect(wx + 1, 28, 10, 6, M.GLASS);
      for (let i = 0; i < 4; i++) put(wx + 2 + i, 32 - i, M.GLASS_HI);
      rect(wx + 5, 28, 2, 6, M.FRAME);
      rect(wx, 35, 12, 2, M.WOOD);
      for (let x = wx; x < wx + 12; x++) {
        if (r() < 0.8) put(x, 34, r() < 0.45 ? M.HYD2 : M.LEAF2);
      }
    }

    // 看板の板
    rect(20, 37, 88, 7, M.FASCIA);
    rect(20, 37, 88, 1, M.FRAME_LT);

    // 日よけの下の影
    for (let y = 53; y < 57; y++) {
      for (let x = 20; x <= 100; x++) {
        if (y < 55 || bayerAt(x, y) < (57 - y) * 4) put(x, y, M.WALL_SH);
      }
    }

    // 大きな窓の枠と、腰板
    rect(WX - 1, WY - 1, WW + 2, WH + 2, M.FRAME);
    rect(WX - 2, WY + WH + 1, WW + 4, 1, M.FRAME_LT);
    rect(WX - 2, WY + WH + 2, WW + 4, 2, M.WOOD);
    for (let x = WX; x < WX + WW; x += 6) rect(x, WY + WH + 2, 1, 2, M.WOOD_DK);

    // 扉
    rect(77, 53, 16, 31, M.FRAME);
    rect(78, 54, 14, 30, M.DOOR);
    rect(79, 55, 12, 15, M.FRAME);
    rect(80, 72, 10, 10, M.WOOD_DK);
    rect(81, 73, 8, 8, M.DOOR);
    put(90, 72, M.BRASS);
    put(90, 73, M.BRASS);
    rect(76, GROUND, 18, 1, M.STONE_LT);

    // 窓と扉のあいだの鉢
    paintBush(74, 75, 3, 4, 66);
    rect(72, 79, 5, 5, M.WOOD_LT);
    rect(72, 79, 5, 1, M.WOOD);

    // 壁の灯りの腕木
    rect(95, 60, 3, 1, M.WOOD_DK);
    rect(95, 64, 3, 1, M.WOOD_DK);

    // 雨どい
    rect(110, 25, 2, 56, M.POST);
    rect(110, 25, 1, 56, M.POST_LT);
    rect(110, 81, 3, 2, M.POST);

    // 日よけ：縞の布と、波形の裾
    for (let y = 44; y < 53; y++) {
      const inset = y < 50 ? Math.round((50 - y) * 0.5) : 0;
      for (let x = 20 + inset; x <= 100 - inset; x++) {
        const stripe = Math.floor((x - 20) / 6) % 2 === 1;
        const fold = (x - 20) % 6;
        if (y === 52 && (fold === 0 || fold === 5)) continue;
        let m = stripe ? M.AWN_C : M.AWN_G;
        if (y >= 50) m = stripe ? M.AWN_C_SH : M.AWN_G_SH;
        put(x, y, m);
      }
    }

    // 歩道の黒板
    rect(97, 77, 7, 10, M.BOARD);
    rect(97, 77, 7, 1, M.WOOD);
    rect(97, 87, 1, 2, M.WOOD);
    rect(103, 87, 1, 2, M.WOOD);
    rect(99, 79, 3, 1, M.CHALK);
    rect(99, 81, 2, 1, M.CHALK);
    rect(99, 83, 3, 1, M.CHALK);
    put(100, 85, M.CHALK);
  };

  const paintTerrace = () => {
    // パラソルと、テーブルと、椅子
    for (let y = 55; y < 64; y++) {
      const t = (y - 55) / 8;
      const half = Math.round(2 + t * 16);
      for (let x = 121 - half; x <= 121 + half; x++) {
        const panel = Math.floor(((x - 121) / (half + 1)) * 3 + 3.5);
        const light = panel % 2 === 1;
        let m = light ? M.AWN_C : M.AWN_G;
        if (y === 63) m = light ? M.AWN_C_SH : M.AWN_G_SH;
        put(x, y, m);
      }
    }
    put(121, 54, M.POST);
    rect(121, 64, 1, 24, M.POST);
    rect(116, 82, 11, 1, M.WOOD_LT);
    rect(116, 83, 11, 1, M.WOOD);
    rect(118, 88, 7, 1, M.POST);
    // 椅子
    rect(SEAT_X + 3, 86, 6, 1, M.WOOD);
    rect(SEAT_X + 8, 80, 1, 9, M.WOOD_DK);
    rect(SEAT_X + 3, 87, 1, 2, M.WOOD_DK);
  };

  const paintLampPost = () => {
    rect(152, 31, 2, 58, M.POST);
    rect(152, 31, 1, 58, M.POST_LT);
    rect(151, 86, 4, 3, M.POST);
    rect(145, 31, 8, 1, M.POST);
    rect(143, 32, 6, 1, M.POST);
  };

  const buildCanopy = () => {
    // 街路樹の葉：かたまりの集まり。雨に濡れて濃い
    canopy = [];
    const r = seeded(303);
    const CX = 184;
    const CY = 40;
    const blobs = [[CX, CY, 17]];
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const d = 11 + r() * 10;
      blobs.push([CX + Math.cos(a) * d * 1.08, CY + Math.sin(a) * d * 0.82, 5 + r() * 5]);
    }
    for (let y = CY - 32; y <= CY + 28; y++) {
      for (let x = CX - 36; x <= CX + 36; x++) {
        let inside = false;
        let best = 0;
        for (const [bx, by, br] of blobs) {
          const d = Math.hypot(x - bx, y - by);
          if (d < br) {
            inside = true;
            best = Math.max(best, 1 - d / br);
          }
        }
        if (!inside) continue;
        const lightDir = ((CX - x) * 0.4 + (CY - y) * 0.75) / 26;
        const clump = best * 0.5;
        const grain = noiseB(x * 0.26 + 20, y * 0.3) * 0.7 + noiseA(x * 0.7, y * 0.7) * 0.3;
        const v = lightDir * 0.34 + clump + grain + (bayerAt(x, y) / 16 - 0.5) * 0.16 - 0.34;
        const m = v > 0.82 ? M.LEAF3 : v > 0.52 ? M.LEAF2 : v > 0.26 ? M.LEAF1 : M.LEAF0;
        canopy.push(x, y, m);
      }
    }
  };

  const paintTrunk = () => {
    const X = 181;
    for (let y = 52; y < 90; y++) {
      const flare = y > 83 ? (y - 83) * 0.8 : 0;
      const up = y < 62 ? (62 - y) * 0.1 : 0;
      const l = Math.round(X - flare - up);
      const r = Math.round(X + 6 + flare * 0.9 + up);
      for (let x = l; x <= r; x++) {
        const t = (x - l) / Math.max(r - l, 1);
        const grain = noiseB(x * 0.9, y * 0.14) > 0.55;
        put(x, y, t > 0.84 ? M.BARK : t < 0.2 ? M.BARK_LT : grain ? M.BARK_LT : M.BARK);
      }
    }
    // 根もとの枠
    rect(172, 88, 24, 2, M.STONE);
    rect(172, 88, 24, 1, M.STONE_LT);
  };

  const buildBase = () => {
    matBuf.fill(0);
    wetBuf.fill(0);
    paintGround();
    paintHydrangea(6, 80, 13, 7, 61);
    paintHydrangea(-12, 82, 10, 6, 63);
    paintCafe();
    paintTerrace();
    paintTrunk();
    paintLampPost();
    paintHydrangea(171, 85, 7, 4, 65);
    paintHydrangea(200, 83, 14, 7, 62);
    paintHydrangea(222, 83, 10, 6, 64);

    // 遠い建物の窓
    const r = seeded(808);
    bgWins = [];
    for (let y = 34; y < GROUND - 4; y += 6) {
      for (let x = -ox + 1; x < bw - ox - 2; x += 5) {
        let free = true;
        for (let dy = 0; dy < 3 && free; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const m = get(x + dx, y + dy);
            if (m !== M.BG_MID && m !== M.BG_FAR) free = false;
          }
        }
        if (!free) continue;
        if (r() < 0.72) {
          rect(x, y, 2, 3, M.BG_WIN);
          bgWins.push({ x, y, seed: r() });
        }
      }
    }

    baseBuf.set(matBuf);
    buildCanopy();

    // 空を時刻のかなめごとに描いておく
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

  // ---- 店主と世界の動き
  const res = { x: SEAT_X, inside: false, face: 1, step: 0, doorOpen: 0, startle: 0, hop: 0, blink: 0, nextBlink: 2, page: 0, nextPage: 4, pageT: 0, hurry: 0 };
  const clouds = [
    { x: 0, y: 4, w: 58, h: 12, seed: 1, speed: 0.5 },
    { x: 70, y: 14, w: 40, h: 9, seed: 2, speed: 0.75 },
    { x: 130, y: 2, w: 66, h: 13, seed: 3, speed: 0.38 },
    { x: 214, y: 20, w: 34, h: 8, seed: 4, speed: 0.9 },
    { x: 30, y: 24, w: 46, h: 8, seed: 5, speed: 0.62 },
  ].map((cloud) => {
    const r = seeded(cloud.seed * 977);
    const count = Math.max(6, Math.round(cloud.w / 5));
    const blobs = Array.from({ length: count }, (_, i) => [cloud.w * ((i + 0.5) / count) + (r() - 0.5) * 3, cloud.h * (0.45 + (r() - 0.5) * 0.35), cloud.h * (0.3 + r() * 0.32)]);
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
  const leaves = [];
  const drips = [];
  const ripples = [];
  const passers = [];
  const car = { t: -1, next: 11, dir: 1, speed: 62 };
  // 雨粒：奥、中、手前の3層。数は雨の強さで変わる
  const rainDrops = (() => {
    const r = seeded(1234);
    return Array.from({ length: 210 }, (_, i) => {
      const slot = i % 6;
      const layer = slot < 3 ? 0 : slot < 5 ? 1 : 2;
      const seed = r();
      return {
        x0: r(),
        y0: r(),
        layer,
        ground: layer === 0 ? GROUND : layer === 1 ? 86 + seed * 6 : ROAD + seed * 22,
      };
    });
  })();
  const RAIN_SPEED = [120, 175, 240];
  const RAIN_LEN = [2, 4, 6];
  const CALM_RINGS = (() => {
    const r = seeded(4242);
    return Array.from({ length: 14 }, () => [Math.floor(r() * CORE_W), GROUND + 2 + Math.floor(r() * 26)]);
  })();
  let anim = 0;
  let smokeAcc = 0;
  let zeeAcc = 0;
  let dripAcc = 0;
  let rippleAcc = 0;
  let passerNext = 2;
  let rainNow = 0.8;
  let windNow = 0.17;
  let windInt = 0;
  let lampFlick = 1;
  let windowL = 0;
  let lanternL = 0;
  let shutter = 0;

  const hourOf = (clock) => ((clock % 24) + 24) % 24;

  // 時刻から、店主の予定を決める
  const planFor = (h) => {
    if (h >= 9.6 && h < 11) return { outside: true, x: 106, act: 'tend' };
    if (h >= 11 && h < 16.2) return { outside: true, x: SEAT_X, act: 'read' };
    if (h >= 16.2 && h < 17.2) return { outside: true, x: 162, act: 'stroll' };
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
        const speed = 17 + clamp(speedHint, 0, 1) * 72 + (Math.abs(delta) > 34 ? 8 : 0);
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
    // まばたき、ページをめくる
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

  const drawSky = (h) => {
    // 雨雲：風下へ流れる
    for (const cloud of clouds) {
      const span = CORE_W + 96;
      const shifted = cloud.x - (calm ? 0 : anim * cloud.speed);
      const cx = (((shifted % span) + span) % span) - 48;
      const x0 = Math.round(cx);
      for (let i = 0; i < cloud.list.length; i += 3) {
        const x = x0 + cloud.list[i];
        const y = cloud.y + cloud.list[i + 1];
        const under = cloud.list[i + 2];
        if (under && bayerAt(x, y) > 11) continue;
        putSky(x, y, under ? M.CLOUD_SH : M.CLOUD);
      }
    }

    // 遠い建物の窓に、ぽつぽつと灯りがともる
    const amount = h < 6.5 ? 0.12 : smoothstep(16.8, 19.5, h) * 0.55 * (1 - smoothstep(22.5, 23.4, h) * 0.75);
    if (amount > 0.01) {
      for (const s of bgWins) {
        if (s.seed > amount) continue;
        rect(s.x, s.y, 2, 3, M.LIT_DK);
        emit(s.x, s.y + 1, 24);
      }
    }
  };

  // 店の中：奥の壁、ペンダントの灯り、棚、カウンター、店主、窓際の客
  const paintInterior = (open, h) => {
    const swing = calm ? 0 : Math.sin(anim * 0.7) * 0.6;
    const lamps = open ? [9, 31, 41] : [31];
    for (let y = 0; y < WH; y++) {
      for (let x = 0; x < WW; x++) {
        let m = y < 3 ? M.LIT_DEEP : M.LIT_DK;
        for (let j = 0; j < lamps.length; j++) {
          // 灯りの下に、広がる光の円すい
          const d = Math.abs(x - (lamps[j] + swing)) - (y - 8) * 0.62;
          if (y >= 8 && d < 0) {
            m = y < 15 ? M.LIT_HI : M.LIT;
            break;
          }
          if (y >= 7 && d < 2.2 && bayerAt(x, y) < 8) m = M.LIT;
        }
        put(WX + x, WY + y, m);
      }
    }

    // 奥の棚と、瓶
    rect(WX + 25, WY + 8, 19, 1, M.COUNTER);
    for (let i = 0; i < 6; i++) {
      const bx = WX + 26 + i * 3;
      rect(bx, WY + 6, 1, 2, i % 2 ? M.COUNTER_LT : M.LIT_DEEP);
    }

    // 店主：カウンターの向こうを行き来する
    if (open && res.inside) {
      const wander = calm ? 0 : Math.sin(anim * 0.21) * 3.6 + Math.sin(anim * 0.57) * 1.4;
      let bust = SPR.bust;
      if (res.startle > 0) bust = SPR.bustUp;
      else if (!calm) {
        const c = (anim % 7.2) / 7.2;
        if (c > 0.3 && c < 0.42) bust = SPR.bustHalf;
        else if (res.blink > 0) bust = SPR.bustBlink;
      }
      blit(bust, Math.round(WX + 24 + wander), WY + 8 - (res.startle > 0 ? 1 : 0), false, -1, INDOOR);
    }

    // カウンターと、珈琲の機械
    rect(WX + 24, WY + 16, 22, 7, M.COUNTER);
    rect(WX + 24, WY + 16, 22, 1, M.COUNTER_LT);
    rect(WX + 31, WY + 10, 7, 6, M.SIL_SOFT);
    rect(WX + 32, WY + 11, 5, 1, M.COUNTER_LT);
    put(WX + 33, WY + 13, M.LIT_HI);
    if (open && !calm) {
      for (let i = 0; i < 3; i++) {
        const s = (anim * 0.8 + i * 0.33) % 1;
        put(WX + 37 + Math.round(Math.sin(s * 8 + i)), WY + 9 - Math.round(s * 5), M.LIT_HI);
      }
    }
    // 丸椅子
    for (const sx of [WX + 26, WX + 40]) {
      rect(sx, WY + 19, 3, 1, M.SIL_SOFT);
      rect(sx + 1, WY + 20, 1, 3, M.SIL_SOFT);
    }

    // 窓際の席。雨を眺める客
    const nod = !calm && Math.sin(anim * 0.5) > 0.82 ? 1 : 0;
    if (open && h >= 10.5 && h < 21.9) blit(SPR.sil, WX, WY + 10 + nod, false, M.SIL_SOFT);
    if (open && h >= 13 && h < 20.7) blit(SPR.silLook, WX + 14, WY + 10, true, M.SIL_SOFT);
    rect(WX + 6, WY + 17, 9, 1, M.SIL_SOFT);
    rect(WX + 10, WY + 18, 1, 5, M.SIL_SOFT);
    if (open) {
      put(WX + 8, WY + 16, M.LIT_HI);
      put(WX + 12, WY + 16, M.LIT_HI);
    }

    // ペンダントのコードと、かさと、電球
    for (let j = 0; j < lamps.length; j++) {
      const lx = Math.round(WX + lamps[j] + swing);
      rect(lx, WY, 1, 6, M.SIL_SOFT);
      rect(lx - 1, WY + 5, 3, 1, M.SIL_SOFT);
      rect(lx - 2, WY + 6, 5, 1, M.SIL_SOFT);
      rect(lx - 1, WY + 7, 3, 1, M.LIT_HI);
    }
  };

  const drawCafe = (h) => {
    const open = h >= 8 && h < 22.7;
    const prep = h >= 6.8 && h < 8;
    const lit = open || prep;
    const upstairs = (h >= 22.7 && h < 23.3) || (h >= 6.1 && h < 6.8);
    const asleep = h >= 23.3 || h < 6.1;

    if (lit) {
      paintInterior(open, h);
    } else {
      // 閉店後：暗い店の中に、テーブルの影だけ
      rect(WX, WY, WW, WH, M.ROOM);
      rect(WX + 24, WY + 16, 22, 7, M.SIL);
      rect(WX + 6, WY + 17, 9, 1, M.SIL);
      rect(WX + 10, WY + 18, 1, 5, M.SIL);
    }

    // 窓の桟
    rect(WX + 22, WY, 2, WH, M.FRAME);
    rect(WX, WY + 5, WW, 1, M.FRAME);

    // ブラインド：閉店すると下り、朝に上がる
    const closed = lit ? 0 : 1;
    shutter += calm ? closed - shutter : clamp(closed - shutter, -0.03, 0.03);
    const rows = Math.round(shutter * WH);
    for (let y = 0; y < rows; y++) rect(WX, WY + y, WW, 1, y % 3 === 2 ? M.BLIND_DK : M.BLIND);

    // 扉のガラスと、札
    if (lit) {
      rect(80, 56, 10, 13, M.LIT_DK);
      rect(80, 58, 10, 5, M.LIT);
      rect(84, 56, 2, 13, M.FRAME);
    } else {
      rect(80, 56, 10, 13, M.GLASS);
      for (let i = 0; i < 6; i++) put(82 + i, 66 - i, M.GLASS_HI);
    }
    rect(84, 69, 2, 1, M.WOOD_DK);
    rect(82, 70, 6, 3, open ? M.SIGN_ON : M.PLATE_OFF);

    // 二階：店を閉めたあとの、店主の部屋。右の窓には、よその暮らし
    if (upstairs) {
      rect(59, 28, 10, 6, M.LIT);
      rect(63, 28, 2, 6, M.FRAME);
      for (let y = 28; y < 34; y++) for (let x = 59; x < 69; x++) if (x < 63 || x > 64) emit(x, y, 40, 0);
    }
    if (h >= 17.6 && h < 22) {
      rect(87, 28, 10, 6, M.LIT_DK);
      rect(91, 28, 2, 6, M.FRAME);
      emit(89, 31, 120);
      emit(95, 31, 120);
    }

    // 看板：夕方からは灯る
    const signOn = h >= 16.5 && h < 22.7;
    const signM = signOn ? M.SIGN_ON : M.SIGN;
    const word = 'CAFE';
    for (let i = 0; i < word.length; i++) {
      const rowsOf = GLYPHS[word[i]];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (rowsOf[gy][gx] !== '1') continue;
          const px = 57 + i * 4 + gx;
          put(px, 38 + gy, signM);
          if (signOn) emit(px, 38 + gy, 40);
        }
      }
    }
    for (const cupX of [44, 78]) {
      rect(cupX, 39, 5, 3, signM);
      put(cupX + 5, 40, signM);
      put(cupX + 1, 42, signM);
      put(cupX + 3, 42, signM);
    }

    return { open, prep, lit, upstairs, asleep };
  };

  const drawDoor = () => {
    if (res.doorOpen > 0) {
      rect(78, 54, 14, 30, windowL > 0.1 ? M.LIT_DK : M.SIL);
      rect(78, 54, 2, 30, M.WOOD_LT);
    }
  };

  // 傘：柄と、丸い布。左は暗く、右は少し明るい
  const drawUmbrella = (cx, topY, a, b) => {
    const widths = [3, 5, 6, 7];
    put(cx, topY - 1, M.POST);
    for (let j = 0; j < widths.length; j++) {
      const w = widths[j];
      for (let dx = -w; dx <= w; dx++) put(cx + dx, topY + j, dx < -1 ? a : b);
    }
    for (let dx = -7; dx <= 7; dx += 2) put(cx + dx, topY + 4, a);
    rect(cx, topY + 4, 1, 4, M.POST);
    if (!calm && Math.random() < 0.6) put(cx + Math.round((Math.random() - 0.5) * 12), topY - 1, M.RIPPLE);
  };

  const drawResident = (plan, h) => {
    if (res.inside) return;
    const base = 89;
    const dy = -Math.round(res.hop);
    const startled = res.startle > 0;
    const moving = Math.abs((plan.outside ? plan.x : DOOR_X) - res.x) > 0.5;
    if (!moving && plan.act === 'read' && Math.abs(res.x - SEAT_X) < 1) {
      // 軒先の席で、雨の音を聞きながら本を読む
      const up = startled;
      const spr = up ? SPR.seatUp : res.blink > 0 ? SPR.seatBlink : SPR.seat;
      const x = SEAT_X;
      const y = base - 13 + dy;
      // テーブルの珈琲と湯気
      rect(123, 80, 3, 2, M.CUP);
      put(124, 80, M.COFFEE);
      put(126, 80, M.CUP);
      if (calm) {
        put(124, 78, M.STEAM);
        put(125, 76, M.STEAM);
      } else {
        for (let i = 0; i < 3; i++) {
          const s = (anim * 0.5 + i * 0.33) % 1;
          put(124 + Math.round(Math.sin(s * 7 + i)), 79 - Math.round(s * 7), M.STEAM);
        }
      }
      blit(spr, x, y);
      // 本
      const bx = x - 1;
      const by = y + 5;
      if (!up) {
        if (res.pageT > 0.28) {
          rect(bx, by, 4, 3, M.BOOK);
          rect(bx + 1, by - 1, 2, 1, M.BOOK_DK);
        } else if (res.pageT > 0.14) {
          rect(bx + 1, by - 2, 2, 5, M.BOOK);
        } else {
          rect(bx, by, 4, 3, M.BOOK);
          rect(bx + 3, by, 1, 3, M.BOOK_DK);
          put(bx + 1, by + 1, M.BOOK_DK);
        }
      } else {
        rect(bx, by + 1, 4, 2, M.BOOK_DK);
      }
      // つま先が小さく動く
      if (!calm && Math.sin(anim * 1.1) > 0.8) put(x + 2, y + 12, M.BOOT);
      if (startled) {
        rect(x + 5, y - 7, 1, 4, M.MARK);
        put(x + 5, y - 2, M.MARK);
      }
      return;
    }
    if (!moving && plan.act === 'tend') {
      // 開店前に、黒板の前で支度をする
      const bob = !calm && Math.sin(anim * 2.2) > 0;
      blit(bob ? SPR.crouch : SPR.stand, Math.round(res.x) - 3, bob ? base - 10 : base - 12, true);
      return;
    }
    let spr = SPR.stand;
    if (startled) spr = SPR.up;
    else if (moving) spr = SPR.walk[Math.floor(res.step) % 4];
    else if (res.blink > 0) spr = SPR.blink;
    const rx = Math.round(res.x);
    blit(spr, rx - 3, base - 12 + dy, res.face < 0);
    // 軒の外では、傘をさす
    if (rx > 141) drawUmbrella(rx + 1, base - 18 + dy, M.UMB_C, M.UMB_C2);
    if (startled) {
      rect(rx, base - 21 + dy, 1, 4, M.MARK);
      put(rx, base - 16 + dy, M.MARK);
    }
  };

  // 窓辺の猫：雨を見ている。夜は丸くなって眠る
  const drawCat = (h) => {
    const x = 63;
    const y = 73;
    if (h >= 22.7 || h < 6.6) {
      blit(SPR.catSleep, x - 1, y + 2);
    } else {
      const hop = res.startle > 0.55 ? 1 : 0;
      blit(SPR.cat, x, y - hop);
      if (!calm && Math.sin(anim * 0.9) > 0.96) put(x, y + 2 - hop, M.CAT);
      const sway = calm ? 0 : Math.round(Math.sin(anim * 1.3));
      put(x + 6, y + 5, M.CAT);
      put(x + 6 + sway, y + 6, M.CAT);
      put(x + 6 + sway, y + 7, M.CAT);
    }
    // かたつむり：雨の日の、昼のお客
    if (h > 7 && h < 19) {
      const sx = 105 + (calm ? 2 : Math.floor((anim * 0.5) % 4));
      rect(sx, 82, 3, 2, M.SHELL);
      put(sx - 1, 83, M.SNAIL);
      put(sx + 3, 83, M.SNAIL);
      put(sx + 4, 83, M.SNAIL);
      put(sx + 4, 82, M.SNAIL);
    }
  };

  // 傘の人たちが、店の前を通り過ぎる
  const drawPassers = (h, dt) => {
    const base = 91;
    if (calm) {
      if (h >= 8 && h < 21.5) {
        blit(SPR.stand, 155, base - 12, false, -1, COATS[1]);
        drawUmbrella(159, base - 18, UMBRELLAS[1][0], UMBRELLAS[1][1]);
      }
      return;
    }
    passerNext -= dt;
    if (passerNext <= 0 && passers.length < 3 && h >= 6.6 && h < 23) {
      passerNext = 5 + Math.random() * 9;
      const dir = Math.random() < 0.5 ? 1 : -1;
      passers.push({
        x: dir > 0 ? -ox - 14 : bw - ox + 14,
        dir,
        speed: 15 + Math.random() * 9,
        step: 0,
        look: Math.floor(Math.random() * 4),
        coat: Math.floor(Math.random() * COATS.length),
      });
    }
    for (let i = passers.length - 1; i >= 0; i--) {
      const p = passers[i];
      p.x += p.dir * p.speed * dt;
      p.step += p.speed * dt * 0.28;
      if ((p.dir > 0 && p.x > bw - ox + 18) || (p.dir < 0 && p.x < -ox - 18)) {
        passers.splice(i, 1);
        continue;
      }
      const frame = Math.floor(p.step) % 4;
      const px = Math.round(p.x);
      blit(SPR.walk[frame], px - 3, base - 12, p.dir < 0, -1, COATS[p.coat]);
      const umb = UMBRELLAS[p.look];
      drawUmbrella(px + p.dir, base - 18 - (frame === 1 ? 1 : 0), umb[0], umb[1]);
    }
  };

  const drawCanopy = () => {
    for (let i = 0; i < canopy.length; i += 3) {
      const y = canopy[i + 1];
      // 風：上ほど大きく、段ごとにずれて揺れる
      const sway = calm ? 0 : Math.round(Math.sin(anim * 0.9 + y * 0.11) * (1.15 - (y - 10) * 0.012));
      put(canopy[i] + sway, y, canopy[i + 2]);
    }
  };

  const drawParticles = (h, dt) => {
    // 煙：朝と、夕方の焙煎。雨風で低く流れる
    const smoking = (h >= 17.2 && h < 21) || (h >= 7 && h < 8.2);
    if (!calm && smoking) {
      smokeAcc += dt * (h >= 17 ? 3.2 : 1.4);
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        smoke.push({ x: 94 + Math.random() * 2, y: 4, t: 0, seed: Math.random() * 10 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.t += dt;
      s.y -= dt * (5 - s.t * 0.8);
      s.x -= dt * (3.2 + Math.sin(s.t * 1.7 + s.seed) * 2.6);
      if (s.t > 4.2 || s.y < -oy - 4) {
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
      for (let i = 0; i < 4; i++) {
        rect(94 - i * 2, 3 - i * 3, 1 + (i >> 1), 2, M.SMOKE);
      }
    }

    // 眠りの Z：二階の窓から
    if (!calm && (h >= 23.3 || h < 6)) {
      zeeAcc += dt * 0.62;
      while (zeeAcc >= 1) {
        zeeAcc -= 1;
        zees.push({ x: 70, y: 26, t: 0 });
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
      if (big) put(x, y + 2 - 0, M.ZZZ);
      rect(x, y + (big ? 3 : 2), n, 1, M.ZZZ);
    }

    // 雨に打たれて落ちる葉
    if (!calm && h > 6 && h < 20 && Math.random() < dt * 0.22) leaves.push({ x: 160 + Math.random() * 44, y: 50 + Math.random() * 14, t: 0, seed: Math.random() * 6 });
    for (let i = leaves.length - 1; i >= 0; i--) {
      const l = leaves[i];
      l.t += dt;
      l.y += dt * 13;
      l.x += Math.sin(l.t * 2.3 + l.seed) * dt * 9 - dt * 3;
      if (l.y > 96 || l.t > 8) {
        leaves.splice(i, 1);
        continue;
      }
      put(Math.round(l.x), Math.round(l.y), M.LEAF3);
    }

    // しずく：日よけの裾、パラソルのふち、雨どい、木の葉から
    if (!calm) {
      dripAcc += dt * (5 + rainNow * 9);
      while (dripAcc >= 1) {
        dripAcc -= 1;
        if (drips.length >= 60) continue;
        const pick = Math.random();
        if (pick < 0.62) drips.push({ x: 20 + Math.floor(Math.random() * 81), y: 53, v: 18, ground: 87 + Math.floor(Math.random() * 3) });
        else if (pick < 0.82) drips.push({ x: Math.random() < 0.5 ? 103 + Math.floor(Math.random() * 3) : 137 + Math.floor(Math.random() * 3), y: 64, v: 18, ground: 88 });
        else if (pick < 0.92) drips.push({ x: 112, y: 83, v: 40, ground: 88 });
        else drips.push({ x: 162 + Math.floor(Math.random() * 40), y: 62 + Math.floor(Math.random() * 6), v: 18, ground: 94 + Math.floor(Math.random() * 12) });
      }
    }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      d.v += dt * 260;
      d.y += d.v * dt;
      if (d.y >= d.ground) {
        if (ripples.length < 80) ripples.push({ x: d.x, y: d.ground, t: 0 });
        drips.splice(i, 1);
        continue;
      }
      const y = Math.round(d.y);
      put(d.x, y, M.RAIN);
      put(d.x, y - 1, M.RAIN);
    }
  };

  const drawLights = (state, h) => {
    // 灯りの強さ。雨の日は、昼でも店の灯りが見える
    const dusk = clamp(smoothstep(16.4, 19.6, h) + (1 - smoothstep(5.6, 7.6, h)));
    const targetWin = state.open ? mix(0.34, 1, dusk) : state.prep ? 0.5 : 0;
    const targetLan = h >= 17 || h < 6.4 ? 1 : 0;
    windowL += (targetWin - windowL) * (calm ? 1 : 0.18);
    lanternL += (targetLan - lanternL) * (calm ? 1 : 0.18);
    const flick = calm ? 1 : 0.94 + 0.06 * Math.sin(anim * 11) * Math.sin(anim * 3.7);

    // 壁の灯り
    if (state.open && h >= 16) {
      rect(95, 61, 3, 3, M.LIT_HI);
      for (let y = 61; y < 64; y++) for (let x = 95; x < 98; x++) emit(x, y, 110 * flick, 0);
    } else {
      rect(95, 61, 3, 3, M.GLASS);
    }

    // 街灯：雨の筋を、光の中に浮かび上がらせる
    if (lanternL > 0.02) {
      rect(144, 33, 4, 2, M.LIT_HI);
      for (let y = 33; y < 35; y++) for (let x = 144; x < 148; x++) emit(x, y, 1100 * lanternL * flick, 1);
    } else {
      rect(144, 33, 4, 2, M.LAMP_OFF);
    }
    if (lanternL > 0.3) {
      for (let y = 36; y < GROUND; y++) {
        const half = (y - 35) * 0.3 + 1;
        for (let x = Math.round(145 - half); x <= 145 + half; x++) {
          const m = get(x, y);
          if (m !== 0 && m !== M.BG_FAR && m !== M.BG_MID && m !== M.BG_WIN) continue;
          const b = bayerAt(x, y);
          if (b === 0 || (y < 50 && b === 8)) put(x, y, M.LIT_DEEP);
        }
      }
    }

    const pool = (cx, cy, rx, ry, L) => {
      if (L <= 0.01) return;
      for (let y = Math.max(cy - ry, -oy); y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const px = x + ox;
          const py = y + oy;
          if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
          const i = py * bw + px;
          const m = matBuf[i];
          if (m === 0 || m === M.SIL || GLOW[m] > 0) continue;
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          const v = (1 - d) * L * 1.5;
          if (v * 16 > bayerAt(x, y)) varBuf[i] = 2;
        }
      }
    };
    // 窓から歩道と路面へ落ちる光、扉の灯り、街灯の輪
    pool(47, 87, 30, 6, windowL * 0.9);
    pool(47, 99, 34, 8, windowL * 0.5);
    pool(85, 87, 12, 4, windowL * 0.6);
    pool(145, 88, 22, 5, lanternL * 0.8);
    pool(145, 98, 26, 7, lanternL * 0.55);
  };

  // 窓の灯りを光の場へ。傘の人や猫が隠した画素は、光らない
  const emitGlow = () => {
    const scan = (x0, y0, w, h, weight) => {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const m = get(x0 + i, y0 + j);
          if (m > 0 && GLOW[m] > 0) emit(x0 + i, y0 + j, weight * GLOW[m], 0);
        }
      }
    };
    const weight = 40 * windowL * lampFlick;
    if (weight > 0.5) {
      scan(WX, WY, WW, WH, weight);
      scan(80, 56, 10, 13, weight * 0.8);
    }
  };

  // 濡れた路面：上の景色を揺らして映す。光る画素は、ほとんど欠けない
  const reflectRow = (y, srcY, level, puddleLevel, wobble) => {
    const py = y + oy;
    const spy = srcY + oy;
    if (py < 0 || py >= bh || spy < 0 || spy >= bh) return;
    for (let px = 0; px < bw; px++) {
      const i = py * bw + px;
      if (!WET[matBuf[i]]) continue;
      const s = spy * bw + clamp(px + wobble, 0, bw - 1);
      const sm = matBuf[s];
      const glow = GLOW[sm] > 0;
      const limit = glow ? 15 : wetBuf[i] ? puddleLevel : level;
      if (bayerAt(px, py) >= limit) continue;
      if (sm === 0) {
        matBuf[i] = M.ROAD_SKY;
        continue;
      }
      matBuf[i] = sm;
      varBuf[i] = glow ? 0 : varBuf[s] === 2 ? 2 : 1;
    }
  };
  const drawReflections = () => {
    const w = calm ? 0 : anim;
    for (let y = ROAD; y < bh - oy; y++) {
      const depth = y - ROAD;
      const amp = 0.5 + depth * 0.07;
      const wob = Math.round(Math.sin(y * 1.7 + w * 5.1) * amp + Math.sin(y * 0.63 - w * 2.3) * amp * 0.7);
      reflectRow(y, CURB - Math.round(depth * 1.8), 7, 12, wob);
    }
    for (let y = GROUND; y < CURB; y++) {
      reflectRow(y, GROUND - 1 - (y - GROUND) * 2, 2, 10, Math.round(Math.sin(y * 2.1 + w * 3.3)));
    }
  };

  const sheltered = (x, y) => (x >= 20 && x <= 100 && y >= 52 && y <= 87) || (x >= 103 && x <= 139 && y >= 62 && y <= 89);
  const inLight = (x, y) => (lanternL > 0.3 && y > 34 && Math.abs(x - 145) < (y - 34) * 0.32 + 1.5) || (windowL > 0.55 && y > 78 && x > 14 && x < 100);

  // 水面の輪
  const drawRing = (x, y, r, skip) => {
    const m = inLight(x, y) ? M.RIPPLE_LIT : M.RIPPLE;
    if (r < 1) {
      put(x, y, m);
      put(x, y - 1, m);
      return;
    }
    const n = 6 + Math.floor(r * 2);
    for (let a = 0; a < n; a++) {
      if (skip && a % 2) continue;
      const t = (a / n) * Math.PI * 2;
      put(Math.round(x + Math.cos(t) * r), Math.round(y + Math.sin(t) * r * 0.38), m);
    }
  };
  const drawRipples = (dt) => {
    if (calm) {
      for (const [x, y] of CALM_RINGS) drawRing(x, y, 2, false);
      return;
    }
    rippleAcc += dt * rainNow * 38;
    while (rippleAcc >= 1) {
      rippleAcc -= 1;
      if (ripples.length >= 80) continue;
      const y = Math.round(GROUND + 1 + Math.random() * (bh - oy - GROUND - 1));
      const x = Math.round(-ox + Math.random() * bw);
      if (sheltered(x, y) || y === CURB || y === CURB + 1) continue;
      ripples.push({ x, y, t: 0 });
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const p = ripples[i];
      p.t += dt;
      if (p.t > 0.45) {
        ripples.splice(i, 1);
        continue;
      }
      drawRing(p.x, p.y, p.t < 0.07 ? 0 : p.t * 15, p.t > 0.3);
    }
    // 日よけとパラソルの上で跳ねる雨
    const hits = Math.round(rainNow * 3);
    for (let i = 0; i < hits; i++) {
      put(24 + Math.floor(Math.random() * 74), 43, M.RIPPLE);
      if (i === 0) put(108 + Math.floor(Math.random() * 26), 57 + Math.floor(Math.random() * 2), M.RIPPLE);
    }
  };

  // 車が水をはねて通る。夕方からはライトをつける
  const drawCar = (h) => {
    if (calm || car.t < 0) return;
    const dir = car.dir;
    const X = Math.round(dir > 0 ? -ox - 40 + car.t * car.speed : bw - ox + 6 - car.t * car.speed);
    const Y = 95;
    const part = (lx, ly, pw, ph, m) => rect(dir > 0 ? X + lx : X + 34 - lx - pw, Y + ly, pw, ph, m);
    part(8, 0, 16, 6, M.CAR);
    part(8, 0, 16, 1, M.CAR_LT);
    part(10, 1, 6, 5, M.CAR_GLASS);
    part(17, 1, 6, 5, M.CAR_GLASS);
    part(0, 6, 34, 5, M.CAR);
    part(2, 6, 30, 1, M.CAR_LT);
    part(0, 10, 34, 1, M.POST);
    part(5, 10, 6, 3, M.WHEEL);
    part(24, 10, 6, 3, M.WHEEL);
    const lights = h >= 16.5 || h < 7.5;
    if (lights) {
      part(33, 7, 1, 2, M.LIT_HI);
      part(0, 7, 1, 2, M.TAIL);
      const hx = dir > 0 ? X + 33 : X;
      emit(hx, Y + 7, 420);
      emit(hx, Y + 8, 420);
      // ライトが、濡れた路面を走る
      for (let i = 1; i < 26; i++) {
        const bx = dir > 0 ? X + 34 + i : X - i;
        const spread = Math.floor(i * 0.22);
        for (let j = 0; j <= spread; j++) {
          const by = Y + 10 + j;
          if (bayerAt(bx, by) < 11 - i * 0.4) put(bx, by, M.RIPPLE_LIT);
        }
      }
    }
    // 後ろへ跳ねる水
    for (let i = 0; i < 7; i++) {
      const sx = (dir > 0 ? X - 1 - Math.random() * 9 : X + 35 + Math.random() * 9);
      put(Math.round(sx), Math.round(Y + 12 - Math.random() * 6), M.RAIN);
    }
  };

  const drawRain = () => {
    const W = bw + 30;
    const H = bh + 24;
    const n = Math.min(rainDrops.length, Math.floor(rainDrops.length * rainNow));
    for (let i = 0; i < n; i++) {
      const d = rainDrops[i];
      const speed = RAIN_SPEED[d.layer];
      const len = RAIN_LEN[d.layer];
      const py = ((d.y0 * H + speed * anim) % H) - 12;
      const px = ((((d.x0 * W - speed * windInt) % W) + W) % W) - 15;
      for (let l = 0; l < len; l++) {
        const wy = Math.round(py) - l - oy;
        const wx = Math.round(px + windNow * l) - ox;
        if (wy > d.ground) continue;
        if (d.layer === 0) {
          // 奥の雨は、建物の向こうに落ちる
          const m = get(wx, wy);
          if (m !== 0 && m !== M.BG_FAR && m !== M.BG_MID && m !== M.BG_WIN) continue;
          put(wx, wy, inLight(wx, wy) ? M.RAIN_LIT : M.RAIN_FAR);
          continue;
        }
        if (sheltered(wx, wy)) continue;
        put(wx, wy, inLight(wx, wy) ? M.RAIN_LIT : M.RAIN);
      }
    }
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

    // 雨の強さと風。朝のうちは小降りになり、また強くなる
    const swell = calm ? 0.85 : 0.84 + 0.16 * Math.sin(anim * 0.11);
    rainNow = clamp(swell * mix(1, 0.5, smoothstep(5.5, 7.2, h) * (1 - smoothstep(8.6, 10.6, h))));
    windNow = calm ? 0.17 : 0.17 + 0.06 * Math.sin(anim * 0.19);
    if (!calm) windInt += dt * windNow;

    if (!calm) {
      car.next -= dt;
      if (car.t >= 0) {
        car.t += dt;
        if (car.t * car.speed > bw + 50) car.t = -1;
      } else if (car.next <= 0 && h >= 6 && h < 23.2) {
        car.t = 0;
        car.next = 14 + Math.random() * 20;
        car.dir = Math.random() < 0.5 ? 1 : -1;
        car.speed = 54 + Math.random() * 22;
      }
    }

    const plan = stepResident(dt, h, hurry);
    drawSky(h);
    const state = drawCafe(h);
    drawDoor();
    drawLights(state, h);
    drawCat(h);
    drawResident(plan, h);
    drawPassers(h, dt);
    drawCanopy();
    drawParticles(h, dt);
    emitGlow();
    drawReflections();
    drawRipples(dt);
    drawCar(h);
    drawRain();

    // ---- 材質 → パレット。時刻のかなめのあいだは、ディザで置き換える
    pickKeys(h);
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

  // ---- 光の場：世界の光る画素を格子に集めて、ぼかす。同じ格子の a に「ぬぐった跡」を入れる
  const GRID_W = 72;
  let GRID_H = 44;
  let glowRaw = new Float32Array(1);
  let glowNearBuf = new Float32Array(1);
  let glowFarBuf = new Float32Array(1);
  let glowTemp = new Float32Array(1);
  let wipeBuf = new Float32Array(1);
  let wipeLast = -1;

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
      console.warn('toggle-daylight: シェーダーを作れないので、2D で描く', error);
      return false;
    }
    gl.useProgram(program);
    for (const name of ['uWorld', 'uGlowNear', 'uRes', 'uPill', 'uOrigin', 'uWorldSize', 'uGlowSize', 'uLens', 'uBezel', 'uK', 'uNight', 'uLift', 'uSeam', 'uCalm', 'uTime', 'uRain', 'uShellDay', 'uShellNight', 'uInk', 'uLight', 'uHiNight', 'uLoNight', 'uSkyDay', 'uHomeCol', 'uSkyCol', 'uHomePos', 'uSkyPos']) {
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
    wetBuf = new Uint8Array(bw * bh);
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
    wipeBuf = new Float32Array(GRID_W * GRID_H);
    wipeLast = -1;

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

  // つまみが通ったところの曇りと水滴を、ぬぐう。動きを減らす設定では、いまの位置だけ
  const stepWipe = (dt) => {
    const cx = shape.W / 2 + (x - 0.5) * shape.travel;
    const from = wipeLast < 0 ? cx : wipeLast;
    wipeLast = cx;
    const a = Math.min(from, cx);
    const b = Math.max(from, cx);
    const r = shape.r0;
    const cy = shape.H / 2;
    const fade = calm ? 1 : dt / FOG_RETURN;
    for (let gy = 0; gy < GRID_H; gy++) {
      const py = ((gy + 0.5) / GRID_H) * shape.H;
      for (let gx = 0; gx < GRID_W; gx++) {
        const px = ((gx + 0.5) / GRID_W) * shape.W;
        const dx = px < a ? a - px : px > b ? px - b : 0;
        const wipe = 1 - smoothstep(r * 0.86, r * 1.1, Math.hypot(dx, py - cy));
        const i = gy * GRID_W + gx;
        wipeBuf[i] = Math.max(wipeBuf[i] - fade, wipe);
      }
    }
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
    // a には、ぬぐった跡を入れる
    for (let i = 0; i < wipeBuf.length; i++) glowNearBuf[i * 4 + 3] = wipeBuf[i];

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
  const phaseName = (h) => (h < 5 || h >= 20 ? '雨の夜' : h < 7 ? '雨の夜明け' : h < 10 ? '雨の朝' : h < 16.5 ? '雨の昼' : '雨の夕方');

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
      root.dispatchEvent(new CustomEvent('daylight:change', { bubbles: true, composed: true, detail: { night } }));
    }
    setStatus(night ? '雨の夜' : '雨の昼');
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
    gl.uniform1f(loc.uTime, anim % 1800);
    gl.uniform1f(loc.uRain, rainNow);

    // レンズの形：動くと伸び、離すと弾んで戻る
    const s = clamp(stretch, -0.5, 1.2);
    const r = shape.r0 * (1 + 0.012 * lift);
    const halfX = r * (1 + 0.2 * s);
    const halfY = r * (1 - 0.075 * s);
    const lim = shape.winW / 2 - (shape.winH / 2 - shape.r0) - halfX;
    const raw = (x - 0.5) * shape.travel;
    const cx = clamp(raw, -lim, lim);
    gl.uniform4f(loc.uLens, cx, 0, halfX, halfY);

    // 殻：昼は陶器のカップ、夜は深煎りの珈琲の色
    gl.uniform3fv(loc.uShellDay, unit(C3));
    gl.uniform3fv(loc.uShellNight, unit(W0));
    gl.uniform3fv(loc.uInk, unit(I0));
    gl.uniform3fv(loc.uLight, unit(C3));
    gl.uniform3fv(loc.uHiNight, unit(I3));
    gl.uniform3fv(loc.uLoNight, unit(I0));
    gl.uniform3fv(loc.uSkyDay, unit(U2));
    // 光る画素の重心と強さ。傘の人が窓を隠せば弱くなる
    const homeW = sources[0].w;
    const home = unit(A2);
    const homeI = (homeW / 255 / 110) * 1.05;
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

    // ---- 右端では、時間が静かに進み、やがて店を閉めて眠る
    if (!calm && x >= 1 && !moving && !drag && nightClock < CLOCK_SLEEP) {
      nightClock = Math.min(CLOCK_SLEEP, nightClock + (dt * (CLOCK_SLEEP - CLOCK_NIGHT)) / NIGHT_CREEP);
    }

    const clock = clockOf();
    hurry = Math.max(hurry - dt * 1.4, clamp(Math.abs(velocity) * 0.6));

    // ---- 世界は 30 コマで動く
    worldAcc += dt;
    const worldStep = calm ? Math.abs(clock - lastWorldClock) > 1e-4 || dirty : worldAcc >= 1 / WORLD_HZ - WORLD_SLACK;
    if (worldStep) {
      const stepDt = Math.min(worldAcc, 0.1);
      renderWorld(clock, stepDt, hurry);
      stepWipe(stepDt);
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
      } else if (ctx2d) {
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

  // ---- 速く動かすと、店主と猫が驚いて顔を上げる
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
  res.x = SEAT_X;
  res.inside = false;
  // 最初の絵を、はじめのフレームまでに用意する
  renderWorld(clockOf(), 0, 0);
  stepWipe(0);
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
