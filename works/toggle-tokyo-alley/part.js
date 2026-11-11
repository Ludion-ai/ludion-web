/* UI by @Lattice_Node — ludion.ai/p/toggle-daylight (MIT) */
// part.js — ESモジュール。rootの中だけを触る
// 住人のいるスイッチ：スイッチのレールの中に、東京の路地があり、小さな居酒屋の主人が1人暮らしている。
//
// 世界：低い解像度で、約20色の番号だけで描く。時刻の変化はディザの置き換えで行い、中間色を作らない。
// 外側：なめらかな殻、窓の奥行き、液体のレンズを WebGL で描く。ピクセルは常に整数倍のまま写す。
// 灯り：世界の光る画素をぼかした「光の場」を作り、ガラスと外の面を照らす。人影が窓を横切れば、外の光も変わる。
// 時間：左端は昼、右端は夜。右へ動かすと 昼→夕方→夜。左へ戻すと 夜→深夜→夜明け→朝→昼 と、時間は前へ進む。
// 路地：夕方に のれんを出して提灯をともし、夜が更けるとシャッターを下ろす。最後まで光っているのは自販機だけ。
// 色は JS に書かない。--_bg、--_surface、--_fg、--_muted、--_accent の色相を、決めた明るさで並べて作る。

const CORE_W = 192; // 景色の中心の幅。窓が広いぶんは、両わきへ広がる
const CORE_H = 112;
const HORIZON = 82; // 太陽と月の弧の基準
const SKY_LINE = 58; // 空の色が地平線の色に届く高さ。屋根の上で夕焼けが見えるように
const GROUND = 85; // 建物の足もと。ここから手前が道
const POLE_X = 94;
const POLE_SPAN = 112;
const VEND_X = 142;
const VEND_Y = 58;
const MARGIN = 14; // レンズが窓の外を覗いてもよいよう、世界を少し広く描く
const WORLD_HZ = 30;
const PILL_RATIO = 1.85; // 縦 : 横
const CLOCK_DAY = 12;
const CLOCK_NIGHT = 21.5;
const CLOCK_SLEEP = 23.4;
const NIGHT_CREEP = 26; // 右端に着いてから、灯りを消して眠るまでの秒数の目安

// ---- パレット：5つのトークン × 4つの明るさ = 20色
const RAMPS = [
  ['bg', [0.76, 0.85, 0.93, 0.985]],
  ['surface', [0.4, 0.52, 0.64, 0.76]],
  ['fg', [0.17, 0.25, 0.33, 0.44]],
  ['muted', [0.5, 0.62, 0.74, 0.86]],
  ['accent', [0.5, 0.66, 0.8, 0.92]],
];
const C0 = 0, C1 = 1, C2 = 2, C3 = 3;
const G0 = 4, G1 = 5, G2 = 6, G3 = 7;
const I0 = 8, I1 = 9, I2 = 10, I3 = 11;
const U0 = 12, U1 = 13, U2 = 14, U3 = 15;
const A0 = 16, A1 = 17, A2 = 18, A3 = 19;

// ---- 材質：[昼, 夕, 宵, 夜] のパレット番号。0番は空のための予約席
const MATS = [
  ['SKY', C3, C3, C3, C3],
  // 遠くのビル
  ['CITY_FAR', U2, U1, I3, I1],
  ['CITY_NEAR', U1, U0, I2, I1],
  ['CITY_EDGE', U3, U2, U0, I2],
  // 道
  ['ASPHALT', U0, I3, I2, I1],
  ['ASPHALT_DK', I3, I2, I1, I0],
  ['ASPHALT_LT', U1, U0, I3, I2],
  ['ROADLINE', C1, A3, U0, I3],
  ['PUDDLE', U2, A1, I3, I1],
  ['GUTTER', U2, U1, I3, I1],
  ['GUTTER_DK', I3, I2, I1, I0],
  // 壁
  ['WALL', C2, A3, U0, I2],
  ['WALL_SH', C0, A2, I3, I1],
  ['TIN', G1, G0, I2, I1],
  ['TIN_LT', G2, G1, I3, I2],
  ['TIN_DK', G0, I3, I1, I0],
  ['RUST', A0, A0, I2, I0],
  ['TIMBER', I3, I2, I1, I0],
  ['TIMBER_LT', U0, I3, I2, I1],
  ['BLOCK', U2, U1, I3, I1],
  ['BLOCK_LT', U3, U2, U0, I2],
  ['BLOCK_DK', U1, U0, I2, I0],
  // 屋根と木
  ['ROOF', I3, I2, I1, I0],
  ['ROOF_LT', U0, I3, I2, I1],
  ['ROOF_HI', U1, U0, I3, I1],
  ['WOOD', A0, A0, I2, I0],
  ['WOOD_LT', A1, A1, I3, I1],
  ['WOOD_DK', I2, I2, I1, I0],
  // 金物
  ['STEEL', U0, I3, I2, I0],
  ['STEEL_LT', U1, U0, I3, I1],
  ['POLE', U1, U0, I2, I0],
  ['POLE_LT', U2, U1, I3, I1],
  ['POLE_DK', I3, I2, I1, I0],
  ['WIRE', I1, I1, I1, I2],
  ['PLATE', U0, U0, I3, I1],
  // 植物
  ['BARK', I3, I2, I1, I0],
  ['BARK_LT', A0, A0, I1, I0],
  ['LEAF0', G0, G0, I1, I0],
  ['LEAF1', G1, G0, I2, I0],
  ['LEAF2', G2, A0, I2, I1],
  ['LEAF3', G3, A1, I3, I1],
  ['FLOWER_A', A2, A1, A0, I2],
  ['FLOWER_C', C3, A3, U1, I3],
  ['STEM', G0, G0, I2, I0],
  ['POT', A0, A0, I2, I0],
  ['POT_LT', A1, A1, I3, I1],
  ['CRATE', A0, A0, I3, I1],
  ['CRATE_DK', I3, I2, I1, I0],
  // ガラス
  ['GLASS', I2, A0, I1, I0],
  ['GLASS_HI', U1, A1, I2, I1],
  ['FROST', U3, U2, I3, I1],
  ['ROOM', C1, C0, I3, I1],
  // 住人
  ['SKIN', A3, A3, U2, I3],
  ['HAIR', I0, I0, I0, I0],
  ['SHIRT', A1, A0, I3, I1],
  ['SHIRT_DK', A0, A0, I2, I0],
  ['PANTS', I2, I2, I1, I0],
  ['BOOT', I0, I0, I0, I0],
  ['BOOK', C3, C3, U2, I3],
  ['BOOK_DK', C1, C1, U0, I2],
  // 空
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
  // 灯り
  ['LIT', A2, A2, A2, A2],
  ['LIT_HI', A3, A3, A3, A3],
  ['LIT_DK', A1, A1, A1, A1],
  ['SIL', I0, I0, I0, I0],
  ['MOTH', A3, A3, A3, A3],
  ['BIRD', I1, I1, I0, I0],
  ['MARK', I0, I0, C3, C3],
  ['ZZZ', U3, U3, U3, U3],
  ['WATER', U3, U2, U0, I3],
  // 自販機
  ['VEND', C2, C1, U1, I2],
  ['VEND_DK', U0, I3, I2, I0],
  ['VEND_LIT', C3, C3, C3, C3],
  ['VEND_LIT2', U3, U3, U3, U3],
  ['CAN_R', A1, A1, A1, A1],
  ['CAN_B', U1, U1, U1, U1],
  ['CAN_G', G2, G2, G2, G2],
  ['CAN_Y', A3, A3, A3, A3],
  // 看板、提灯、のれん
  ['SIGN', C3, A3, U0, I2],
  ['SIGN_TXT', I1, I1, I0, I0],
  ['NEON_G', G3, G3, G3, G3],
  ['LANTERN', A1, A0, A0, I2],
  ['LANTERN_DK', A0, I3, I2, I1],
  ['NOREN', I2, I1, I1, I0],
  ['NOREN_DK', I1, I0, I0, I0],
  ['NOREN_TX', C3, A3, U2, I3],
  // 猫と洗濯物と室外機
  ['CAT', I0, I0, I0, I0],
  ['CAT_EYE', A3, A3, A3, A3],
  ['CLOTH_A', C3, A3, U1, I2],
  ['CLOTH_B', U2, U1, I3, I1],
  ['CLOTH_C', A2, A1, I3, I1],
  ['AC', C1, A2, I3, I1],
  ['AC_DK', U1, U0, I2, I0],
];
const M = Object.fromEntries(MATS.map((row, i) => [row[0], i]));

// 自分で光るもの。灯りのにじみで色を変えない
const GLOWS = new Uint8Array(MATS.length);
for (const name of ['LIT', 'LIT_HI', 'LIT_DK', 'SIL', 'MOTH', 'VEND_LIT', 'VEND_LIT2', 'CAN_R', 'CAN_B', 'CAN_G', 'CAN_Y', 'NEON_G', 'CAT_EYE']) GLOWS[M[name]] = 1;

// ---- 時刻のかなめ：[時, 材質の列, 空の色（上から地平線へ）]
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

// ---- 住人の絵。頭には白い ねじり鉢巻き
const CHARS = { H: 'HAIR', S: 'SKIN', E: 'HAIR', T: 'SHIRT', D: 'SHIRT_DK', P: 'PANTS', B: 'BOOT', W: 'BOOK', K: 'BOOK_DK', C: 'CAT', Y: 'CAT_EYE' };
const makeSprite = (rows) => {
  const list = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') list.push([x, y, M[CHARS[ch]], ch === 'E']);
    });
  });
  return { list, w: rows[0].length, h: rows.length };
};
const HEAD = ['..HHH..', '.WWWWW.', '.HHSSS.', '.HSSES.', '..SSSS.'];
const HEAD_BLINK = ['..HHH..', '.WWWWW.', '.HHSSS.', '.HSSSS.', '..SSSS.'];
const HEAD_UP = ['..HHH..', '.WWWWW.', '.HHSES.', '.HSSSS.', '..SSSS.'];
const BODY_STAND = ['..TTT..', '.TTTTT.', '.STTTS.', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
const BODY_WALK1 = ['..TTT..', '.TTTTT.', '..TTTS.', '.SDDD..', '..PPP..', '.PP.P..', '.B..BB.'];
const BODY_WALK2 = ['..TTT..', '.TTTTT.', '.STTTS.', '..DDD..', '..PPP..', '..PP...', '..BB...'];
const BODY_WALK3 = ['..TTT..', '.TTTTT.', '.STTT..', '..DDDS.', '..PPP..', '..P.PP.', '.BB..B.'];
const BODY_ARMS = ['S.TTT.S', 'STTTTTS', '..TTT..', '..DDD..', '..PPP..', '..P.P..', '..B.B..'];
const person = (head, body) => makeSprite([...head, ...body]);
const SPR = {
  stand: person(HEAD, BODY_STAND),
  blink: person(HEAD_BLINK, BODY_STAND),
  walk: [person(HEAD, BODY_WALK1), person(HEAD, BODY_WALK2), person(HEAD, BODY_WALK3), person(HEAD, BODY_WALK2)],
  up: person(HEAD_UP, BODY_ARMS),
  crouch: person(HEAD, ['..TTT..', '.TTTTTS', '..DDD.S', '..PPP..', '.BB.B..']),
  seat: makeSprite([
    '....HHH..',
    '...WWWWW.',
    '...SSSHH.',
    '...ESSHH.',
    '...SSSS..',
    '...TTTT..',
    '...STTTT.',
    '...STTTT.',
    'PPPPPPDD.',
    'BB.PPPPP.',
  ]),
  seatBlink: makeSprite([
    '....HHH..',
    '...WWWWW.',
    '...SSSHH.',
    '...SSSHH.',
    '...SSSS..',
    '...TTTT..',
    '...STTTT.',
    '...STTTT.',
    'PPPPPPDD.',
    'BB.PPPPP.',
  ]),
  seatUp: makeSprite([
    '....HHH..',
    '...WWWWW.',
    '...ESSHH.',
    '...SSSHH.',
    '...SSSS..',
    '...TTTT..',
    '...STTTT.',
    '...STTTT.',
    'PPPPPPDD.',
    'BB.PPPPP.',
  ]),
  bust: makeSprite(['...HHH...', '..WWWWW..', '..HSSES..', '...SSS...', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.', '.TTTTTTT.']),
  bustBlink: makeSprite(['...HHH...', '..WWWWW..', '..HSSSS..', '...SSS...', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.', '.TTTTTTT.']),
  bustUp: makeSprite(['S..HHH..S', 'S.WWWWW.S', 'S.HSSES.S', 'SS.SSS.SS', '.STTTTTS.', '..TTTTT..', '..TTTTT..', '..TTTTT..']),
  bustHalf: makeSprite(['...HHH...', '..WWWWW..', 'S.HSSES.S', 'SS.SSS.SS', '.STTTTTS.', '..TTTTT..', '.TTTTTTT.', '.TTTTTTT.']),
  sil: makeSprite(['...HHH..', '..HHHHH.', '..HHHHH.', '...HHH..', '..HHHHH.', '.HHHHHHH', 'HHHHHHHH', 'HHHHHHHH']),
  silLook: makeSprite(['....HHH.', '...HHHHH', '...HHHHH', '...HHH..', '..HHHHH.', '.HHHHHHH', 'HHHHHHHH', 'HHHHHHHH']),
  // 塀の上の黒猫。左を向いている
  catSit: makeSprite(['C.C....', 'CCC....', 'YCC....', '.CCC..C', '.CCCC.C', '.CCCCC.', '.C.CC..']),
  catLoaf: makeSprite(['..C.C...', '.CCCCC.C', '.CCCCCCC', '.CCCCCC.']),
  catWalk: [
    makeSprite(['C.C.....C', 'CCC.....C', 'YCCCCCCC.', '.CCCCCCC.', '.C..C.C..']),
    makeSprite(['C.C......', 'CCC....CC', 'YCCCCCCC.', '.CCCCCCC.', '..C.C..C.']),
  ],
  catArch: makeSprite(['C.C...C.', 'CCC.CC.C', 'YC.CCCC.', '..CCCCC.', '.C.C..C.', '.C.C..C.']),
};

// ---- 路地の文字（小さなピクセルで読める字だけ）
const GLYPH_SAKE = ['#.#####', '...#.#.', '#.#####', '..#.#.#', '#.#.#.#', '..#####', '#.#...#'];
const GLYPH_SU = ['#####', '...#.', '..#..', '.#.#.', '#...#'];
const GLYPH_NA = ['..#..', '#####', '..#..', '.#...', '#....'];
const GLYPH_TSU = ['.....', '#.#.#', '....#', '...#.', '..#..'];
const GLYPH_KU = ['.#...', '.####', '#...#', '...#.', '.##..'];
const GLYPH_TOMA = ['...#...', '...#...', '.#.#...', '.#.####', '.#.#...', '.#.#...', '#######'];
const GLYPH_MA = ['...#...', '.#####.', '...#...', '.#####.', '...#...', '.####..', '#..#.##'];
const GLYPH_RE = ['.#.....', '.#..##.', '####.#.', '.##..#.', '.#...#.', '##...#.', '.#...##'];
const SNACK = [GLYPH_SU, GLYPH_NA, GLYPH_TSU, GLYPH_KU];
const SIGN_X = 127;
const SIGN_Y = 36;
// 赤提灯：l = 外側、h = 内側、x = 字、d = 上下の枠
const LANTERN_ROWS = ['..ddd..', '.lhhhl.', 'lhxxxhl', 'lhhxhhl', 'lhxxxhl', 'lhhxhhl', 'lhxxxhl', '.lhhhl.', '..ddd..'];
const PUDDLES = [
  { cx: 149, cy: 97, rx: 15, ry: 3, seed: 7 },
  { cx: 62, cy: 96, rx: 11, ry: 2, seed: 3 },
];
const LAUNDRY = [
  { x: 142, w: 6, h: 8, m: 'CLOTH_A', shirt: true },
  { x: 150, w: 4, h: 6, m: 'CLOTH_C', shirt: false },
  { x: 156, w: 5, h: 9, m: 'CLOTH_B', shirt: true },
];

// 電線のたるみ。電柱と電柱のあいだで、いちばん低くなる
const wireY = (x, line) => {
  const u = (((x - POLE_X) % POLE_SPAN) + POLE_SPAN) % POLE_SPAN / POLE_SPAN;
  return 10 + line * 3 + 36 * u * (1 - u);
};

// ---- シェーダー
const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
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
vec3 glowNear(vec2 frag) { return smoothTex(uGlowNear, vec2(frag.x / uRes.x, 1.0 - frag.y / uRes.y), uGlowSize); }

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
    // 漏れた光は、まわりの地を染める
    vec3 outside = reach(p, uHomePos, uHomeCol, uPill.y * 0.62) * exp(-max(d, 0.0) / (h * 0.2));
    float amount = clamp(dot(outside, vec3(0.34)) * 2.3, 0.0, 0.85);
    vec3 tint = outside / max(dot(outside, vec3(0.34)), 1.0e-3) * 0.34;
    premul = mix(premul, tint * 1.25, amount);
    alpha = mix(alpha, 1.0, amount);
    // canvas の端までに、なめらかに消す
    vec2 toEdge = 0.5 * uRes - abs(p);
    float room = min(toEdge.x, toEdge.y) / (h * 0.32);
    float fade = smoothstep(0.0, 1.0, clamp(room, 0.0, 1.0));
    premul *= fade;
    alpha *= fade;
  }

  vec3 color = premul;
  if (d < 1.0) {
    vec3 body = shellColor(p, frag, d);

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
        lens = mix(lens, studio(R), clamp(fresnel * dir * dir * 0.6, 0.0, 0.42));

        // 灯りと月や太陽も、レンズの面に映る
        for (int i = 0; i < 2; i++) {
          vec2 pos = i == 0 ? uHomePos : uSkyPos;
          vec3 col = i == 0 ? uHomeCol : uSkyCol;
          vec2 toL = normalize(pos - p + 1.0e-3);
          float side = max(dot(gr, toL), 0.0);
          lens += reach(p, pos, col, uPill.y * 0.9) * side * side * side * smoothstep(0.62, 0.97, rho) * 0.6;
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

  const canvas = root.querySelector('.scene');
  const button = root.querySelector('.hit');
  const statusEl = root.querySelector('[data-status]');
  const probe = root.querySelector('.probe');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  let calm = motionQuery.matches;

  // ---- パレットをトークンから作る
  const paint = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const palette = new Array(20);
  const palette32 = new Uint32Array(20);
  const readPalette = () => {
    const style = getComputedStyle(root);
    RAMPS.forEach(([name, tones], ramp) => {
      probe.style.color = style.getPropertyValue(`--_${name}`).trim();
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

  // ---- 材質の表：時刻のかなめごと、状態（ふつう、影、暖かい灯り、白い灯り）ごと
  const STEP_L = RAMPS.flatMap(([, tones]) => tones);
  const shadeOf = (id) => {
    const step = id % 4;
    if (step > 0) return id - 1;
    if (id === C0) return U0;
    if (id === G0) return I3;
    if (id === U0) return I3;
    if (id === A0) return I3;
    return id;
  };
  const litOf = (dayId) => {
    const L = STEP_L[dayId];
    return L < 0.72 ? A0 : L < 0.9 ? A0 : A1;
  };
  const coolOf = (dayId) => (STEP_L[dayId] < 0.72 ? U0 : U1);
  const NM = MATS.length;
  const table = KEYS.map(([, col]) => {
    const t = new Uint8Array(NM * 4);
    MATS.forEach((row, m) => {
      const id = row[col + 1];
      t[m] = id;
      t[NM + m] = shadeOf(id);
      t[NM * 2 + m] = litOf(row[1]);
      t[NM * 3 + m] = coolOf(row[1]);
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
  let thrB = new Uint8Array(1);
  let pixels = new Uint32Array(1);
  let skyKeys = [];
  let canopy = [];
  let stars = [];
  let cityLights = [];
  let litWins = [];
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
  const line = (x0, y0, x1, y1, m) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) put(Math.round(mix(x0, x1, i / n)), Math.round(mix(y0, y1, i / n)), m);
  };
  // 文字を押す。sx で横に伸ばし、wear で道路の塗装のようにかすれさせる
  const stamp = (rows, x0, y0, m, sx = 1, wear = false) => {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        if (row[i] === '.') continue;
        for (let s = 0; s < sx; s++) {
          const px = x0 + i * sx + s;
          if (wear && noiseB(px * 0.6, (y0 + j) * 0.7) > 0.72) continue;
          put(px, y0 + j, m);
        }
      }
    }
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
  const paintSkyline = () => {
    cityLights = [];
    const layer = (seed, minW, rangeW, minTop, rangeTop, m, edge, density) => {
      const r = seeded(seed);
      let x0 = -ox - 4;
      while (x0 < bw - ox) {
        const w = minW + Math.floor(r() * rangeW);
        const top = minTop + Math.floor(r() * rangeTop);
        rect(x0, top, w, GROUND - top, m);
        rect(x0, top, w, 1, edge);
        // 屋上の機械室
        if (r() < 0.4) rect(x0 + 2 + Math.floor(r() * Math.max(w - 6, 1)), top - 2, 3, 2, m);
        for (let wy = top + 2; wy < GROUND - 8; wy += 3) {
          for (let wx = x0 + 1; wx < x0 + w - 1; wx += 2) {
            if (r() < density) cityLights.push(wx, wy, r(), r() < 0.22 ? 1 : 0);
          }
        }
        x0 += w + (r() < 0.2 ? 2 : 0);
      }
    };
    layer(41, 7, 12, 28, 22, M.CITY_FAR, M.CITY_EDGE, 0.22);

    // 遠くの電波塔：細い鉄骨と、途中の展望台
    const TX = 118;
    for (let y = 10; y < 54; y++) {
      const half = Math.round(0.4 + Math.pow((y - 10) / 44, 1.6) * 5);
      put(TX - half, y, M.CITY_FAR);
      put(TX + half, y, M.CITY_FAR);
      if (half > 1 && y % 4 === 0) rect(TX - half, y, half * 2 + 1, 1, M.CITY_FAR);
      if (half > 1 && y % 4 === 2) put(TX, y, M.CITY_FAR);
    }
    rect(TX - 3, 28, 7, 2, M.CITY_EDGE);
    rect(TX - 4, 30, 9, 1, M.CITY_FAR);

    layer(42, 10, 16, 44, 18, M.CITY_NEAR, M.CITY_FAR, 0.18);

    // 銭湯の煙突
    for (let y = 12; y < 44; y++) {
      const half = y < 22 ? 1 : 2;
      rect(162 - half, y, half * 2 + 1, 1, y < 16 ? M.LANTERN_DK : y % 7 === 0 ? M.BLOCK_DK : M.BLOCK);
    }
  };

  const paintGround = () => {
    for (let py = 0; py < bh; py++) {
      const y = py - oy;
      if (y < GROUND) continue;
      for (let px = 0; px < bw; px++) {
        const x = px - ox;
        const i = py * bw + px;
        let m;
        if (y < GROUND + 3) {
          // 側溝のふた
          const seam = ((x % 9) + 9) % 9 === 0;
          m = seam || y === GROUND + 2 ? M.GUTTER_DK : M.GUTTER;
        } else {
          const n = noiseA(x * 0.09 + 9, y * 0.22 + 3) + noiseB(x * 0.34, y * 0.6) * 0.28;
          const v = n + (bayerAt(x, y) / 16 - 0.5) * 0.16;
          m = v > 0.9 ? M.ASPHALT_LT : v < 0.42 ? M.ASPHALT_DK : M.ASPHALT;
          // 路側の白線。ところどころ剥げている
          if (y === 92 && noiseB(x * 0.5, 2.5) < 0.72) m = M.ROADLINE;
        }
        matBuf[i] = m;
      }
    }

    const r = seeded(5);
    // ひび割れ
    for (let c = 0; c < Math.ceil(bw / 22); c++) {
      let cx = Math.floor(r() * bw) - ox;
      let cy = 94 + Math.floor(r() * 16);
      for (let s = 0; s < 14; s++) {
        put(cx, cy, M.ASPHALT_DK);
        cx += r() < 0.75 ? 1 : 0;
        cy += r() < 0.4 ? (r() < 0.5 ? 1 : -1) : 0;
      }
    }
    // 舗装の継ぎはぎ
    for (let y = 94; y < 104; y++) {
      for (let x = 82; x < 108; x++) {
        const edgeFade = Math.min(y - 94, 104 - y, x - 82, 108 - x);
        if (edgeFade > 0 || bayerAt(x, y) > 6) put(x, y, bayerAt(x, y) > 11 ? M.ASPHALT : M.ASPHALT_LT);
      }
    }

    // 水たまり（雨あがり）
    for (const p of PUDDLES) {
      for (let y = p.cy - p.ry - 1; y <= p.cy + p.ry + 1; y++) {
        for (let x = p.cx - p.rx - 1; x <= p.cx + p.rx + 1; x++) {
          const d = Math.hypot((x - p.cx) / p.rx, (y - p.cy) / p.ry) + (noiseB(x * 0.3 + p.seed, y * 0.8) - 0.5) * 0.4;
          if (d < 1) put(x, y, M.PUDDLE);
        }
      }
    }

    // マンホール
    const MX = 118;
    const MY = 102;
    for (let y = MY - 4; y <= MY + 4; y++) {
      for (let x = MX - 10; x <= MX + 10; x++) {
        const d = Math.hypot((x - MX) / 9, (y - MY) / 3.5);
        if (d > 1) continue;
        if (d > 0.78) put(x, y, M.ASPHALT_DK);
        else put(x, y, (x + y * 2) % 3 === 0 ? M.ASPHALT_DK : M.ASPHALT_LT);
      }
    }

    // 路面の「止まれ」。塗装はかすれている
    stamp(GLYPH_TOMA, 18, 98, M.ROADLINE, 2, true);
    stamp(GLYPH_MA, 34, 98, M.ROADLINE, 2, true);
    stamp(GLYPH_RE, 50, 98, M.ROADLINE, 2, true);
    for (let x = 18; x < 64; x++) {
      if (noiseB(x * 0.6, 9.5) < 0.72) rect(x, 107, 1, 2, M.ROADLINE);
    }
  };

  const paintBush = (cx, cy, rx, ry, seed) => {
    const r = seeded(seed);
    const blobs = Array.from({ length: 6 }, () => [cx + (r() - 0.5) * rx * 1.5, cy + (r() - 0.5) * ry, 2 + r() * (ry * 0.75)]);
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
      put(x, y, M.STEM);
      put(x, y - 1, M.STEM);
      const m = r() < 0.55 ? M.FLOWER_A : M.FLOWER_C;
      put(x, y - 2, m);
      if (r() < 0.5) {
        put(x - 1, y - 2, m);
        put(x + 1, y - 2, m);
        put(x, y - 3, m);
      }
    }
  };

  // 窓を1つ。夜の点灯は litWins が受け持つ
  const paintWin = (x, y, w, h, on, off, cool = false) => {
    rect(x - 1, y - 1, w + 2, h + 2, M.WOOD_DK);
    rect(x, y, w, h, M.FROST);
    if (w > 6) rect(x + (w >> 1), y, 1, h, M.WOOD_DK);
    litWins.push({ x, y, w, h, on, off, cool, L: 0 });
  };

  // 居酒屋：1階は格子窓と のれんの店、2階は主人の部屋。壁はトタン
  const paintHouse = () => {
    const X0 = 30;
    const X1 = 88;
    const RT = 28;
    const TOP = 38;
    const MID = 58;

    // 2階：波板のトタンと、錆の筋
    for (let y = TOP; y < MID; y++) {
      for (let x = X0; x < X1; x++) {
        let m = x & 1 ? M.TIN : M.TIN_LT;
        if (x % 8 === 0) m = M.TIN_DK;
        if (noiseA(x * 0.55 + 3, y * 0.1) + (y - TOP) * 0.005 > 0.76) m = M.RUST;
        if (x >= X1 - 3 && bayerAt(x, y) < (x - (X1 - 3) + 1) * 5) m = M.TIN_DK;
        if (y < TOP + 3 || (y < TOP + 6 && bayerAt(x, y) < (TOP + 6 - y) * 4)) m = M.TIN_DK;
        put(x, y, m);
      }
    }
    // 1階：黒い下見板
    for (let y = MID; y < GROUND; y++) {
      for (let x = X0; x < X1; x++) put(x, y, x % 3 === 0 ? M.TIMBER_LT : M.TIMBER);
    }

    // 屋根：台形。瓦の段
    for (let y = RT; y < TOP; y++) {
      const t = (y - RT) / (TOP - RT);
      const l = Math.round(mix(38, X0 - 5, t));
      const r = Math.round(mix(80, X1 + 4, t));
      for (let x = l; x <= r; x++) {
        const row = Math.floor((y - RT) / 3);
        const tile = (x + (row & 1) * 3) % 6;
        let m = M.ROOF;
        if ((y - RT) % 3 === 1 && tile !== 0) m = M.ROOF_LT;
        if (x - l < 5 + t * 8 && (y - RT) % 3 === 1 && tile !== 0) m = M.ROOF_HI;
        put(x, y, m);
      }
    }
    rect(37, RT - 1, 45, 1, M.ROOF_HI);
    for (let x = X0 - 5; x <= X1 + 4; x++) {
      put(x, TOP, M.WOOD_DK);
      if (x % 3 === 0) put(x, TOP + 1, M.WOOD_DK);
    }

    // 2階の窓枠と、窓辺の花の箱（窓の中は毎フレーム描く）
    rect(44, 40, 18, 16, M.WOOD_DK);
    rect(43, 56, 20, 2, M.WOOD);
    rect(43, 56, 20, 1, M.WOOD_LT);
    const r = seeded(77);
    for (let x = 44; x < 62; x++) {
      if (r() < 0.75) put(x, 55, r() < 0.5 ? M.FLOWER_A : M.FLOWER_C);
      if (r() < 0.5) put(x, 54, M.STEM);
    }

    // 壁の室外機と、下へ降りる配管
    rect(72, 45, 13, 9, M.AC);
    rect(72, 45, 13, 1, M.AC_DK);
    rect(72, 53, 13, 1, M.AC_DK);
    rect(75, 54, 1, 4, M.STEEL);
    rect(31, TOP + 1, 2, MID - TOP, M.STEEL);
    for (let y = TOP + 3; y < MID; y += 6) rect(30, y, 4, 1, M.STEEL_LT);

    // 庇（1階と2階のあいだ）
    for (let y = MID; y < MID + 4; y++) {
      const spread = y - MID;
      for (let x = X0 - 2 - spread; x < X1 + 2 + spread; x++) {
        put(x, y, y === MID + 3 ? M.WOOD_DK : (y & 1) && (x % 5 !== 0) ? M.ROOF_LT : M.ROOF);
      }
    }
    rect(X0, MID + 4, X1 - X0, 1, M.SIL);

    // 1階の格子窓
    rect(33, 66, 31, 17, M.WOOD_DK);
    rect(35, 68, 27, 14, M.FROST);
    for (let x = 35; x < 62; x += 3) rect(x, 68, 1, 14, M.WOOD);
    rect(35, 74, 27, 1, M.WOOD);
    rect(33, 83, 31, 2, M.WOOD);
    rect(33, 83, 31, 1, M.WOOD_LT);

    // 引き戸
    rect(66, 65, 14, 20, M.WOOD_DK);
    rect(67, 66, 12, 19, M.WOOD);
    for (let y = 67; y < 79; y++) {
      for (let x = 68; x < 78; x++) put(x, y, x % 3 === 1 ? M.WOOD_DK : M.FROST);
    }
    rect(73, 66, 1, 19, M.WOOD_DK);
    rect(68, 79, 10, 1, M.WOOD_LT);
    rect(66, 85, 14, 2, M.BLOCK_LT);
    rect(65, 87, 16, 1, M.BLOCK);

    // 空きびんのケース
    rect(81, 78, 7, 7, M.CRATE);
    rect(82, 79, 5, 1, M.CRATE_DK);
    rect(82, 83, 5, 1, M.CRATE_DK);
    rect(81, 81, 7, 1, M.CRATE_DK);
    for (let x = 82; x < 87; x += 2) rect(x, 75, 1, 3, M.CAN_G);
  };

  // 裏の平屋と、ブロック塀。塀の上は猫の道
  const paintBackyard = () => {
    // 建物のあいだの細い抜け道
    for (let y = 58; y < GROUND; y++) {
      for (let x = 88; x < 100; x++) put(x, y, y < 70 ? M.WOOD_DK : M.ROOF);
    }

    // 平屋の屋根と壁
    for (let y = 50; y < 60; y++) {
      const t = (y - 50) / 10;
      const l = Math.round(mix(107, 99, t));
      const r = Math.round(mix(127, 134, t));
      for (let x = l; x <= r; x++) put(x, y, (y - 50) % 3 === 1 && x % 5 !== 0 ? M.ROOF_LT : M.ROOF);
    }
    rect(106, 49, 22, 1, M.ROOF_HI);
    rect(100, 60, 34, 6, M.WALL_SH);

    // 庭木の幹（塀の奥）
    for (let y = 56; y < 66; y++) {
      for (let x = 114; x < 118; x++) put(x, y, x === 114 ? M.BARK_LT : M.BARK);
    }

    // ブロック塀
    for (let y = 66; y < GROUND; y++) {
      for (let x = 100; x < 134; x++) {
        const row = Math.floor((y - 66) / 4);
        const jx = (x + (row & 1) * 4) % 8;
        let m = (y - 66) % 4 === 3 || jx === 0 ? M.BLOCK_DK : noiseA(x * 0.3, y * 0.3) > 0.62 ? M.BLOCK_LT : M.BLOCK;
        // 足もとの苔
        if (y > 81 && noiseB(x * 0.4, y * 0.5) + (y - 81) * 0.06 > 0.72 && bayerAt(x, y) < 10) m = M.LEAF0;
        put(x, y, m);
      }
    }
    rect(99, 65, 35, 1, M.BLOCK_LT);

    // 路地園芸：鉢植えをならべる
    const pots = [[98, 5, 5], [103, 6, 4], [109, 5, 5], [114, 4, 3], [119, 6, 4], [125, 4, 3]];
    pots.forEach(([px, pw, ph], i) => {
      paintBush(px + (pw >> 1), GROUND - ph - 3, pw >> 1, 3, 61 + i);
      for (let j = 0; j < ph; j++) {
        const inset = j > ph - 2 ? 1 : 0;
        rect(px + inset, GROUND - ph + j, pw - inset * 2, 1, j === 0 ? M.POT_LT : M.POT);
      }
    });
    paintFlowers(98, 112, 78, 82, 7, 91);
    paintFlowers(118, 130, 79, 83, 5, 92);
  };

  // 木造モルタルのアパート。外廊下と、鉄の外階段
  const paintApartment = () => {
    const X0 = 134;
    const X1 = 196;
    for (let y = 44; y < GROUND; y++) {
      for (let x = X0; x < X1; x++) {
        const stain = noiseB(x * 0.18 + 5, y * 0.12) + (bayerAt(x, y) / 16 - 0.5) * 0.12;
        put(x, y, stain > 0.68 ? M.WALL_SH : M.WALL);
      }
    }
    // 屋上：へりと貯水槽
    rect(132, 40, 66, 4, M.BLOCK);
    rect(132, 40, 66, 1, M.BLOCK_LT);
    rect(172, 30, 10, 8, M.BLOCK_LT);
    rect(173, 29, 8, 1, M.BLOCK);
    rect(181, 30, 1, 8, M.BLOCK_DK);
    rect(173, 38, 1, 2, M.STEEL);
    rect(180, 38, 1, 2, M.STEEL);

    // 2階のドアと窓
    for (const dx of [140, 158, 176]) {
      rect(dx, 47, 9, 15, M.STEEL);
      rect(dx + 1, 48, 7, 14, M.STEEL_LT);
      put(dx + 6, 55, M.SIL);
    }
    paintWin(150, 48, 6, 7, 18.2, 23.1);
    paintWin(168, 48, 6, 7, 19, 1);
    paintWin(187, 48, 6, 7, 20, 5, true);

    // 外廊下と、手すり
    rect(X0, 62, X1 - X0, 2, M.BLOCK_DK);
    for (let x = X0; x < X1; x++) if (bayerAt(x, 64) < 9) put(x, 64, M.WALL_SH);
    rect(X0, 52, X1 - X0, 1, M.STEEL_LT);
    rect(X0, 61, X1 - X0, 1, M.STEEL);
    for (let x = X0; x < X1; x += 3) rect(x, 53, 1, 8, M.STEEL);

    // 洗濯ざお
    rect(140, 45, 22, 1, M.STEEL);

    // 1階
    rect(170, 68, 9, 17, M.STEEL);
    rect(171, 69, 7, 16, M.STEEL_LT);
    put(176, 77, M.SIL);
    paintWin(183, 68, 9, 8, 18.6, 22.6);
    // 郵便受け
    rect(158, 70, 8, 6, M.STEEL);
    for (let x = 159; x < 165; x += 2) {
      rect(x, 71, 1, 1, M.SIL);
      rect(x, 74, 1, 1, M.SIL);
    }

    // 外階段
    line(196, 62, 216, GROUND, M.STEEL);
    line(197, 62, 217, GROUND, M.STEEL);
    line(196, 53, 216, 76, M.STEEL_LT);
    for (let i = 0; i < 7; i++) {
      rect(196 + Math.round(i * 2.9), 62 + Math.round(i * 3.3), 3, 1, M.STEEL_LT);
      rect(198 + i * 3, 56 + Math.round(i * 3.4), 1, 8, M.STEEL);
    }
  };

  // 看板「スナック」。昼は白い板、夜はネオン
  const paintSign = () => {
    rect(SIGN_X, SIGN_Y, 7, 26, M.SIGN);
    rect(SIGN_X, SIGN_Y, 7, 1, M.WOOD_DK);
    rect(SIGN_X, SIGN_Y + 25, 7, 1, M.WOOD_DK);
    SNACK.forEach((glyph, i) => stamp(glyph, SIGN_X + 1, SIGN_Y + 1 + i * 6, M.SIGN_TXT));
  };

  const paintVending = () => {
    const X = VEND_X;
    const Y = VEND_Y;
    rect(X, Y, 14, 28, M.VEND);
    rect(X, Y, 14, 1, M.VEND_DK);
    rect(X, Y + 1, 14, 3, M.CAN_R);
    rect(X + 13, Y, 1, 28, M.VEND_DK);
    // 飲みものの棚
    rect(X + 1, Y + 4, 12, 13, M.VEND_LIT);
    const row = [M.CAN_R, M.CAN_B, M.CAN_Y, M.CAN_G, M.CAN_B, M.CAN_R, M.CAN_G, M.CAN_Y, M.CAN_Y, M.CAN_G, M.CAN_R, M.CAN_B];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 4; i++) rect(X + 2 + i * 3, Y + 5 + j * 4, 2, 2, row[j * 4 + i]);
      rect(X + 1, Y + 7 + j * 4, 12, 1, M.VEND_LIT2);
      for (let i = 0; i < 4; i++) put(X + 2 + i * 3, Y + 7 + j * 4, M.VEND_DK);
    }
    // 硬貨の口と、取り出し口
    rect(X + 10, Y + 18, 2, 3, M.VEND_DK);
    put(X + 10, Y + 19, M.VEND_LIT2);
    rect(X + 2, Y + 21, 8, 4, M.VEND_DK);
    rect(X + 3, Y + 22, 6, 1, M.SIL);
    rect(X, Y + 26, 14, 2, M.VEND_DK);
  };

  // 新聞を読む腰かけ
  const paintStool = () => {
    rect(134, 85, 7, 4, M.CRATE);
    rect(135, 86, 5, 1, M.CRATE_DK);
    rect(134, 88, 7, 1, M.CRATE_DK);
  };

  const paintBike = () => {
    const wheel = (cx, cy, r) => {
      for (let y = cy - r - 1; y <= cy + r + 1; y++) {
        for (let x = cx - r - 1; x <= cx + r + 1; x++) {
          if (Math.abs(Math.hypot(x - cx, y - cy) - r) < 0.6) put(x, y, M.SIL);
        }
      }
      put(cx, cy, M.STEEL_LT);
    };
    wheel(164, 85, 4);
    wheel(176, 85, 4);
    line(164, 85, 169, 79, M.CRATE);
    line(169, 79, 174, 79, M.CRATE);
    line(169, 79, 170, 85, M.CRATE);
    line(164, 85, 170, 85, M.CRATE);
    line(170, 85, 174, 79, M.CRATE);
    line(174, 79, 176, 85, M.CRATE);
    rect(174, 76, 1, 3, M.STEEL);
    rect(172, 75, 4, 1, M.STEEL_LT);
    rect(168, 77, 1, 2, M.STEEL);
    rect(166, 76, 4, 1, M.SIL);
    // かご
    rect(175, 76, 5, 3, M.STEEL_LT);
    for (let x = 176; x < 180; x += 2) rect(x, 77, 1, 1, M.STEEL);
  };

  const paintNeighbor = (x0, x1, top, seed) => {
    const r = seeded(seed);
    const tin = r() < 0.5;
    for (let y = top; y < GROUND; y++) {
      for (let x = x0; x < x1; x++) {
        const stain = noiseB(x * 0.3 + seed, y * 0.4) + (bayerAt(x, y) / 16 - 0.5) * 0.12;
        const m = tin ? (x & 1 ? M.TIN : M.TIN_LT) : stain > 0.7 ? M.WALL_SH : M.WALL;
        put(x, y, m);
      }
    }
    for (let y = top - 4; y < top; y++) {
      const spread = y - (top - 4);
      for (let x = x0 - spread + 1; x < x1 + spread - 1; x++) put(x, y, (y & 1) && x % 5 !== 0 ? M.ROOF_LT : M.ROOF);
    }
    rect(x0 - 3, top, x1 - x0 + 6, 1, M.WOOD_DK);
    for (let wx = x0 + 4; wx + 7 < x1; wx += 12) {
      const on = 17.5 + r() * 2.5;
      const off = 22 + r() * 1.9;
      if (r() < 0.75) paintWin(wx, top + 5, 6, 7, on, off, r() < 0.2);
      if (top + 24 < GROUND - 8 && r() < 0.6) paintWin(wx, top + 22, 6, 8, on + 0.4, off - 0.3);
    }
    rect(x1 - 1, top + 1, 1, GROUND - top - 1, M.WALL_SH);
  };

  const paintNeighbors = () => {
    const r = seeded(17);
    let left = 27;
    while (left > -ox) {
      const w = 24 + Math.floor(r() * 16);
      paintNeighbor(left - w, left - 2, 44 + Math.floor(r() * 10), 1000 + left);
      left -= w;
    }
    let right = 219;
    while (right < bw - ox) {
      const w = 24 + Math.floor(r() * 16);
      paintNeighbor(right, right + w - 2, 42 + Math.floor(r() * 12), 2000 + right);
      right += w;
    }
  };

  const paintPole = (px, main) => {
    const top = main ? 3 : 5;
    rect(px, top, 3, GROUND + 1 - top, M.POLE);
    rect(px, top, 1, GROUND + 1 - top, M.POLE_LT);
    rect(px + 2, top, 1, GROUND + 1 - top, M.POLE_DK);
    rect(px - 7, 9, 17, 1, M.POLE_DK);
    for (const ix of [px - 6, px + 1, px + 8]) put(ix, 8, M.POLE_LT);
    // 足場の釘
    for (let y = 24; y < 60; y += 5) put(y % 2 ? px - 1 : px + 3, y, M.POLE_DK);
    // 住所の札
    rect(px, 62, 3, 9, M.PLATE);
    for (let y = 63; y < 70; y += 2) put(px + 1, y, M.BOOK);
    if (!main) return;
    // 変圧器
    rect(px + 3, 18, 6, 10, M.POLE_LT);
    rect(px + 3, 18, 6, 1, M.POLE_DK);
    rect(px + 3, 27, 6, 1, M.POLE_DK);
    rect(px + 8, 19, 1, 8, M.POLE);
    put(px + 5, 17, M.POLE_DK);
    put(px + 7, 17, M.POLE_DK);
    // 街灯の腕
    rect(px + 3, 34, 7, 1, M.POLE_DK);
    rect(px + 9, 35, 5, 2, M.POLE_LT);
  };

  const paintWires = () => {
    for (let wire = 0; wire < 3; wire++) {
      for (let x = -ox; x < bw - ox; x++) put(x, Math.round(wireY(x, wire)), M.WIRE);
    }
    // 引き込み線：電柱から、家とアパートへ
    line(POLE_X - 6, 10, 84, 38, M.WIRE);
    line(POLE_X + 8, 10, 134, 44, M.WIRE);
    line(POLE_X + 2, 16, 62, 39, M.WIRE);
    let p = POLE_X;
    while (p > -ox) p -= POLE_SPAN;
    for (; p < bw - ox; p += POLE_SPAN) paintPole(p, p === POLE_X);
  };

  const buildCanopy = () => {
    // 庭木の葉：塀の向こうから、かたまりでのぞく
    canopy = [];
    const r = seeded(303);
    const CX = 115;
    const CY = 52;
    const blobs = [[CX, CY, 8]];
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2;
      const d = 5 + r() * 6;
      blobs.push([CX + Math.cos(a) * d * 1.2, CY + Math.sin(a) * d * 0.8, 3 + r() * 3]);
    }
    for (let y = CY - 15; y <= CY + 12; y++) {
      for (let x = CX - 12; x <= CX + 10; x++) {
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
        const lightDir = ((CX - x) * 0.4 + (CY - y) * 0.75) / 12;
        const grain = noiseB(x * 0.26 + 20, y * 0.3) * 0.7 + noiseA(x * 0.7, y * 0.7) * 0.3;
        const v = lightDir * 0.34 + best * 0.5 + grain + (bayerAt(x, y) / 16 - 0.5) * 0.16 - 0.3;
        canopy.push(x, y, v > 0.82 ? M.LEAF3 : v > 0.52 ? M.LEAF2 : v > 0.26 ? M.LEAF1 : M.LEAF0);
      }
    }
  };

  const buildBase = () => {
    matBuf.fill(0);
    litWins = [];
    paintSkyline();
    paintGround();
    paintBackyard();
    paintApartment();
    paintSign();
    paintHouse();
    paintNeighbors();
    paintVending();
    paintStool();
    paintBike();
    paintWires();
    baseBuf.set(matBuf);
    buildCanopy();

    // 東京の空に星は少ない
    const r = seeded(808);
    const skyRows = oy + 60;
    const starCount = Math.round((36 * bw * skyRows) / (220 * 66));
    stars = [];
    for (let i = 0; i < starCount; i++) {
      stars.push({ x: Math.floor(r() * bw) - ox, y: Math.floor(r() * skyRows) - oy, seed: r(), big: r() < 0.14 });
    }
    // 空を時刻のかなめごとに描いておく
    skyKeys = KEYS.map(([, , stops]) => {
      const sky = new Uint8Array(bw * bh);
      const n = stops.length - 1;
      for (let py = 0; py < bh; py++) {
        const pos = clamp((py - oy) / SKY_LINE) * n;
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
  const res = { x: 73, inside: false, face: 1, step: 0, doorOpen: 0, startle: 0, hop: 0, blink: 0, nextBlink: 2, page: 0, nextPage: 4, pageT: 0, hurry: 0 };
  const clouds = [
    { x: 8, y: 13, w: 30, h: 9, seed: 1, speed: 0.55 },
    { x: 88, y: 24, w: 22, h: 7, seed: 2, speed: 0.8 },
    { x: 150, y: 9, w: 34, h: 10, seed: 3, speed: 0.42 },
    { x: 214, y: 30, w: 18, h: 5, seed: 4, speed: 1.05 },
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
  const leaves = [];
  const birds = { t: -1, next: 8, y: 20, dir: 1, from: -12 };
  const perch = { away: 0 };
  const shoot = { t: -1, next: 14 };
  const moths = Array.from({ length: 6 }, (_, i) => ({ seed: i * 2.1 + 0.7 }));
  const cat = { x: 110, want: 110, face: -1, step: 0, wait: 0 };
  let anim = 0;
  let smokeAcc = 0;
  let zeeAcc = 0;
  let lampFlick = 1;
  let windowL = 0;
  let lanternL = 0;
  let shopL = 0;
  let streetL = 0;
  let vendL = 0;
  let shutter = 0;
  let roll = 0;

  const hourOf = (clock) => ((clock % 24) + 24) % 24;

  // 時刻から、住人の予定を決める
  const planFor = (h) => {
    if (h >= 9.6 && h < 11) return { outside: true, x: 104, act: 'tend' };
    if (h >= 11 && h < 16.2) return { outside: true, x: 131, act: 'read' };
    if (h >= 16.2 && h < 17.2) return { outside: true, x: 88, act: 'stroll' };
    return { outside: false, x: 73, act: 'in' };
  };

  const stepResident = (dt, h, speedHint) => {
    const plan = planFor(h);
    const want = plan.outside ? plan.x : 73;
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
      res.x = 73;
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

    // 太陽：空を弧を描いて動く。ビルに隠れれば、光も届かない
    if (h > 5.2 && h < 19) {
      const a = ((h - 6) / 12) * Math.PI;
      const sx = Math.round(96 - Math.cos(a) * 102);
      const sy = Math.round(HORIZON - 2 - Math.sin(a) * 70);
      const low = 1 - clamp(Math.sin(a) * 1.6);
      const R = 5 + Math.round(low * 2);
      for (let dy = -R - 5; dy <= R + 5; dy++) {
        for (let dx = -R - 5; dx <= R + 5; dx++) {
          const d = Math.hypot(dx, dy);
          const x = sx + dx;
          const y = sy + dy;
          if (d <= R - 1) {
            if (get(x, y) === 0) emit(x, y, 26 + low * 90, 1);
            putSky(x, y, M.SUN);
          } else if (d <= R) {
            putSky(x, y, M.SUN_RIM);
          } else if (d <= R + 4 && bayerAt(x, y) < (R + 4.6 - d) * 2.2) {
            putSky(x, y, M.SUN_RIM);
          }
        }
      }
    }

    // 月：屋根の上に見えるよう、高めの弧を通る
    const mh = h >= 17.6 ? h : h + 24;
    if (mh > 17.6 && mh < 30.4) {
      const a = ((mh - 18) / 12) * Math.PI;
      const mx = Math.round(96 - Math.cos(a) * 102);
      const my = Math.round(HORIZON - 2 - Math.sin(a) * 76);
      const R = 6;
      for (let dy = -R - 3; dy <= R + 3; dy++) {
        for (let dx = -R - 3; dx <= R + 3; dx++) {
          const d = Math.hypot(dx, dy);
          const x = mx + dx;
          const y = my + dy;
          if (d <= R) {
            const crater = (dx === -2 && dy === -2) || (dx === 2 && dy === 1) || (dx === -3 && dy === 2) || (dx === 1 && dy === -3) || (dx === 3 && dy === -1) || (dx === -1 && dy === 3);
            const shaded = dx * 0.7 + dy * 0.7 > R * 0.45;
            if (get(x, y) === 0) emit(x, y, 12, 1);
            putSky(x, y, crater || shaded ? M.MOON_DK : M.MOON);
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

    // 鳥：昼に、ときどき渡る
    if (!calm && h > 7 && h < 18.5 && birds.t >= 0) {
      const flap = Math.floor(anim * 7) % 2;
      for (let i = 0; i < 4; i++) {
        const x = Math.round(birds.from + birds.dir * (birds.t * 26 - i * 6));
        const y = birds.y + (i % 2) * 3 + i;
        putSky(x, y, M.BIRD);
        putSky(x - 1, y - flap, M.BIRD);
        putSky(x + 1, y - flap, M.BIRD);
      }
    }
  };

  // 遠くのビルの窓と、電波塔の航空灯
  const drawCity = (h) => {
    const night = clamp(smoothstep(17.6, 19.6, h) + (1 - smoothstep(4.8, 6.4, h)));
    if (night <= 0.05) return;
    const late = h >= 23 || h < 5;
    for (let i = 0; i < cityLights.length; i += 4) {
      const seed = cityLights[i + 2];
      if (seed > night * 0.95) continue;
      if (late && seed > 0.45) continue;
      const x = cityLights[i];
      const y = cityLights[i + 1];
      const under = get(x, y);
      if (under !== M.CITY_FAR && under !== M.CITY_NEAR) continue;
      put(x, y, cityLights[i + 3] ? M.STAR_DIM : M.LIT_DK);
      emit(x, y, 46);
    }
    if (night > 0.3 && (calm || Math.sin(anim * 1.6) > -0.2)) {
      for (const [x, y] of [[118, 9], [115, 28], [121, 28]]) {
        if (get(x, y) === 0 || get(x, y) === M.CITY_EDGE) {
          put(x, y, M.LIT_DK);
          emit(x, y, 190);
        }
      }
    }
  };

  const drawShadows = (h) => {
    if (h < 6.2 || h > 18.6) return;
    const a = ((h - 6) / 12) * Math.PI;
    const dir = -Math.cos(a); // 太陽が左なら、影は右へ
    const fade = smoothstep(6.2, 7.6, h) * (1 - smoothstep(17.4, 18.6, h));
    const reach = 3 + Math.abs(dir) * 22;
    const depth = 3 + (1 - Math.sin(a)) * 11;
    const mark = (x, y, strength) => {
      const px = x + ox;
      const py = y + oy;
      if (px < 0 || py < 0 || px >= bw || py >= bh) return;
      const i = py * bw + px;
      if (matBuf[i] !== 0 && strength * fade * 16 > bayerAt(x, y)) varBuf[i] = 1;
    };
    // 建物の列の影。道の手前へ、太陽が低いほど長く落ちる。抜け道のところだけ日が差す
    for (let y = GROUND; y < GROUND + depth; y++) {
      const t = (y - GROUND) / depth;
      const shift = dir * reach * t;
      for (let x = -ox; x < bw - ox; x++) {
        const sx = x - shift;
        if (sx > 89 && sx < 99) continue;
        mark(x, y, 1 - t * 0.55);
      }
    }
    // 自販機の影
    for (let y = GROUND; y < GROUND + 6; y++) {
      const t = (y - GROUND) / 6;
      for (let x = VEND_X - 1; x < VEND_X + 15; x++) mark(Math.round(x + dir * reach * 0.5 * t), y, 0.9 - t * 0.4);
    }
  };

  const drawWindow = (h) => {
    // 2階の窓の中：14×12
    const WX = 46;
    const WY = 42;
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
        // 机と、開いた帳面
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
        // 夕方：台所を行き来する人影と、湯気
        const walk = calm ? 0 : Math.sin(anim * 0.8) * 3;
        if (res.inside) blit(SPR.sil, Math.round(WX + 3 + walk), WY + 5, false, M.SIL);
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

    // 雨戸：眠る時間は閉じ、朝に開く
    const closed = asleep ? 1 : 0;
    shutter += calm ? closed - shutter : clamp(closed - shutter, -0.09, 0.09);
    const leaf = Math.round(shutter * 7);
    const drawLeaf = (x0, w) => {
      for (let i = 0; i < w; i++) {
        for (let y = 0; y < 14; y++) put(x0 + i, WY - 1 + y, y % 2 === 0 ? M.STEEL : M.STEEL_LT);
      }
    };
    // 開いている雨戸は窓の両わきに、閉じると窓の上に
    const open = 4 - Math.min(4, leaf);
    if (open > 0) {
      drawLeaf(44 - open, open);
      drawLeaf(62, open);
    }
    if (leaf > 0) {
      drawLeaf(46, leaf);
      drawLeaf(60 - leaf, leaf);
    }

    return { lamp, cook, asleep };
  };

  const drawDoor = () => {
    if (res.doorOpen > 0) {
      rect(68, 67, 10, 18, M.SIL);
      rect(68, 67, 2, 18, M.WOOD_LT);
    }
  };

  // 1階の店：のれん、格子窓の灯り、客の影、閉店のシャッター
  const drawShop = (h) => {
    const open = h >= 17 && h < 22.9;
    shopL += ((open ? 1 : 0) - shopL) * (calm ? 1 : 0.12);

    if (shopL > 0.02) {
      const flick = lampFlick;
      const crowd = h >= 18;
      for (let y = 68; y < 82; y++) {
        for (let x = 35; x < 62; x++) {
          if (get(x, y) !== M.FROST) continue;
          if (shopL * 16 <= bayerAt(x, y)) continue;
          let guest = false;
          if (crowd) {
            for (let g = 0; g < 3; g++) {
              const gx = g === 0 ? 40 : g === 1 ? 49 : 56;
              const gy = 71 + (calm ? 0 : Math.round(Math.sin(anim * 0.8 + g * 2.1) * 0.6));
              const dx = x - gx;
              const dy = y - gy;
              if (dx * dx + dy * dy <= 6 || (y >= gy + 3 && Math.abs(dx) <= 4)) guest = true;
            }
          }
          if (guest) {
            put(x, y, M.SIL);
            continue;
          }
          const spot = Math.hypot((x - 48) / 16, (y - 73) / 8);
          const m = spot < 0.55 ? M.LIT_HI : spot < 1 ? M.LIT : M.LIT_DK;
          put(x, y, m);
          emit(x, y, (m === M.LIT_HI ? 120 : m === M.LIT ? 95 : 60) * shopL * flick, 0);
        }
      }
      // 引き戸の明かり
      for (let y = 67; y < 79; y++) {
        for (let x = 68; x < 78; x++) {
          if (get(x, y) !== M.FROST) continue;
          if (shopL * 16 <= bayerAt(x, y)) continue;
          put(x, y, y < 73 ? M.LIT : M.LIT_DK);
          emit(x, y, 70 * shopL * flick, 0);
        }
      }
    }

    drawDoor();

    // のれん：3枚に分かれた裾が、風で揺れる
    if (open) {
      rect(65, 63, 16, 1, M.WOOD_DK);
      for (let y = 64; y < 74; y++) {
        const low = (y - 64) / 9;
        for (let x = 66; x < 80; x++) {
          if (y >= 71 && (x === 70 || x === 75)) continue;
          const sway = calm ? 0 : Math.round(Math.sin(anim * 1.15 + x * 0.35) * low * 1.1);
          const gx = x - 69;
          const gy = y - 64;
          const inked = gx >= 0 && gx < 7 && gy >= 0 && gy < 7 && GLYPH_SAKE[gy][gx] === '#';
          put(x + sway, y, inked ? M.NOREN_TX : x === 66 || x === 79 ? M.NOREN_DK : M.NOREN);
        }
      }
    }

    // シャッター：閉店で下り、朝に上がる
    const shut = h >= 22.9 || h < 7 ? 1 : 0;
    roll += calm ? shut - roll : clamp(shut - roll, -0.02, 0.02);
    const rows = Math.round(roll * 21);
    if (rows > 0) {
      for (let j = 0; j < rows; j++) rect(33, 64 + j, 47, 1, j % 2 ? M.STEEL : M.STEEL_LT);
      rect(33, 64 + rows - 1, 47, 1, M.SIL);
    }
  };

  // 路地の小さな灯りたち：自販機、街灯、ネオン、よその窓
  const drawStreet = (h) => {
    const vendOn = h >= 17.8 || h < 6.2;
    vendL += ((vendOn ? 1 : 0) - vendL) * (calm ? 1 : 0.1);
    if (vendL > 0.02) {
      for (let y = VEND_Y + 4; y < VEND_Y + 17; y++) {
        for (let x = VEND_X + 1; x < VEND_X + 13; x++) emit(x, y, 170 * vendL);
      }
    }

    // 街灯
    const streetOn = h >= 18.4 || h < 5.6;
    streetL += ((streetOn ? 1 : 0) - streetL) * (calm ? 1 : 0.1);
    if (streetL > 0.4) {
      rect(POLE_X + 9, 36, 5, 1, M.VEND_LIT);
      for (let x = POLE_X + 9; x < POLE_X + 14; x++) {
        emit(x, 36, 255 * streetL);
        emit(x, 37, 180 * streetL);
      }
    }

    // ネオン「スナック」：店じまいは主人より少し遅い。最後の字だけ、調子が悪い
    const neonOn = h >= 18 && h < 23.3;
    if (neonOn) {
      rect(SIGN_X, SIGN_Y, 7, 26, M.SIL);
      for (let i = 0; i < SNACK.length; i++) {
        const shaky = i === 3 && !calm && Math.sin(anim * 11) * Math.sin(anim * 3.7) < -0.55;
        if (shaky) continue;
        const glyph = SNACK[i];
        const gy = SIGN_Y + 1 + i * 6;
        for (let j = 0; j < glyph.length; j++) {
          for (let c = 0; c < glyph[j].length; c++) {
            if (glyph[j][c] === '.') continue;
            put(SIGN_X + 1 + c, gy + j, M.NEON_G);
            emit(SIGN_X + 1 + c, gy + j, 220);
          }
        }
      }
    }

    // よその窓
    for (const w of litWins) {
      const lit = w.on < w.off ? h >= w.on && h < w.off : h >= w.on || h < w.off;
      w.L += ((lit ? 1 : 0) - w.L) * (calm ? 1 : 0.08);
      if (w.L < 0.02) continue;
      for (let j = 0; j < w.h; j++) {
        for (let i = 0; i < w.w; i++) {
          const x = w.x + i;
          const y = w.y + j;
          if (get(x, y) !== M.FROST) continue;
          if (w.L * 16 <= bayerAt(x, y)) continue;
          put(x, y, w.cool ? M.STAR_DIM : j < 2 ? M.LIT : M.LIT_DK);
          emit(x, y, 70 * w.L);
        }
      }
    }

    // 室外機のファン
    const fan = calm ? 0 : Math.floor(anim * 10) % 2;
    rect(76, 47, 5, 5, M.AC_DK);
    if (fan) rect(78, 47, 1, 5, M.AC);
    else rect(76, 49, 5, 1, M.AC);
    put(78, 49, M.SIL);

    // 洗濯物：昼のあいだだけ、風に揺れる
    if (h >= 8 && h < 16.8) {
      LAUNDRY.forEach((c, n) => {
        const m = M[c.m];
        for (let j = 0; j < c.h; j++) {
          const sway = calm ? 0 : Math.round(Math.sin(anim * 1.3 + n * 1.7 + j * 0.3) * (j / c.h) * 1.4);
          const inset = c.shirt && j >= 2 ? 1 : 0;
          for (let i = inset; i < c.w - inset; i++) put(c.x + i + sway, 46 + j, c.shirt && j === c.h - 2 ? M.WALL_SH : m);
        }
      });
    }

    // 電線のすずめ
    if (h > 6.6 && h < 18 && perch.away <= 0) {
      for (let i = 0; i < 3; i++) {
        const x = 146 + i * 5 + (i === 2 ? 3 : 0);
        const y = Math.round(wireY(x, 0)) - 1;
        const peck = !calm && Math.sin(anim * 1.3 + i * 2.4) > 0.86 ? 1 : 0;
        put(x, y, M.BIRD);
        put(x + 1, y, M.BIRD);
        put(x + peck, y - 1 + peck, M.BIRD);
      }
    }
  };

  // 水たまりに、灯りが揺れて映る
  const drawPuddles = () => {
    const wob = calm ? 0 : Math.round(Math.sin(anim * 1.6) * 0.8);
    for (const p of PUDDLES) {
      const vend = p.cx > 100;
      const L = vend ? vendL : lanternL;
      if (L < 0.2) continue;
      const half = vend ? 6 : 3;
      for (let y = p.cy - p.ry - 1; y <= p.cy + p.ry + 1; y++) {
        for (let x = p.cx - p.rx - 1; x <= p.cx + p.rx + 1; x++) {
          if (get(x, y) !== M.PUDDLE) continue;
          if (Math.abs(x + wob - p.cx) > half || bayerAt(x, y) >= 11) continue;
          put(x, y, vend ? M.VEND_LIT2 : M.LIT_DK);
        }
      }
    }
  };

  const drawResident = (plan, h) => {
    if (res.inside) return;
    const base = 89;
    const dy = -Math.round(res.hop);
    const startled = res.startle > 0;
    const moving = Math.abs((plan.outside ? plan.x : 73) - res.x) > 0.5;
    if (!moving && plan.act === 'read' && Math.abs(res.x - 131) < 1) {
      // ビールケースに腰かけて、新聞を読む
      const up = startled;
      const spr = up ? SPR.seatUp : res.blink > 0 ? SPR.seatBlink : SPR.seat;
      const x = 131;
      const y = base - 11 + dy;
      blit(spr, x, y);
      // 新聞
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
      if (!calm && Math.sin(anim * 1.1) > 0.8) put(x + 1, y + 9, M.BOOT);
      if (startled) {
        rect(x + 5, y - 7, 1, 4, M.MARK);
        put(x + 5, y - 2, M.MARK);
      }
      return;
    }
    if (!moving && plan.act === 'tend') {
      // 鉢植えに水をやる
      const bob = !calm && Math.sin(anim * 2.2) > 0;
      blit(bob ? SPR.crouch : SPR.stand, Math.round(res.x) - 3, bob ? base - 10 : base - 12, false);
      const cx = Math.round(res.x) + 5;
      rect(cx, base - 7, 3, 2, M.STEEL_LT);
      put(cx + 3, base - 8, M.STEEL_LT);
      if (!calm) {
        for (let i = 0; i < 3; i++) {
          put(cx + 4 + (i & 1), base - 7 + Math.floor((anim * 10 + i * 3) % 6), M.WATER);
        }
      }
      return;
    }
    let spr = SPR.stand;
    if (startled) spr = SPR.up;
    else if (moving) spr = SPR.walk[Math.floor(res.step) % 4];
    else if (res.blink > 0) spr = SPR.blink;
    blit(spr, Math.round(res.x) - 3, base - 12 + dy, res.face < 0);
    if (startled) {
      rect(Math.round(res.x), base - 19 + dy, 1, 4, M.MARK);
      put(Math.round(res.x), base - 14 + dy, M.MARK);
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

  // 黒猫：昼は塀の上で丸くなり、夕方は座って路地を見張り、夜更けは塀を歩く
  const drawCat = (h, dt) => {
    const capY = 65;
    const resting = h >= 7 && h < 17 ? 110 : h >= 17 && h < 22.9 ? 122 : -1;
    if (calm) {
      cat.x = resting < 0 ? 118 : resting;
      cat.want = cat.x;
    } else if (res.startle <= 0) {
      if (resting >= 0) {
        cat.want = resting;
      } else {
        cat.wait -= dt;
        if (cat.wait <= 0 && Math.abs(cat.want - cat.x) < 1) {
          cat.want = 104 + Math.random() * 24;
          cat.wait = 2 + Math.random() * 4;
        }
      }
      const d = cat.want - cat.x;
      if (Math.abs(d) > 0.5) {
        const move = Math.min(Math.abs(d), dt * 9);
        cat.x += Math.sign(d) * move;
        cat.face = Math.sign(d);
        cat.step += move * 0.45;
      }
    }
    const walking = !calm && Math.abs(cat.want - cat.x) > 0.5;
    let s = SPR.catSit;
    if (!calm && res.startle > 0) s = SPR.catArch;
    else if (walking) s = SPR.catWalk[Math.floor(cat.step) % 2];
    else if (h >= 7 && h < 17) s = SPR.catLoaf;
    const sx = Math.round(cat.x) - (s.w >> 1);
    const sy = capY - s.h;
    const flip = cat.face > 0;
    blit(s, sx, sy, flip);
    // 夜は目が光る
    if (h >= 18.5 || h < 5.5) {
      for (const [dx, dy, m] of s.list) {
        if (m === M.CAT_EYE) emit(flip ? sx + s.w - 1 - dx : sx + dx, sy + dy, 240);
      }
    }
  };

  const drawParticles = (h, dt) => {
    // 銭湯の煙
    const smoking = (h >= 17.2 && h < 19.8) || (h >= 7 && h < 8.2);
    if (!calm && smoking) {
      smokeAcc += dt * (h >= 17 ? 3.2 : 1.4);
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        smoke.push({ x: 161 + Math.random() * 2, y: 10, t: 0, seed: Math.random() * 10 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.t += dt;
      s.y -= dt * (7 - s.t * 0.8);
      s.x += dt * (2.2 + Math.sin(s.t * 1.7 + s.seed) * 2.6);
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
          if (bayerAt(x, y) < 16 - thin * 1.3) putSky(x, y, s.t > 2.3 ? M.SMOKE_DK : M.SMOKE);
        }
      }
    }
    if (calm && smoking) {
      for (let i = 0; i < 4; i++) {
        const y = 9 - i * 3;
        const x = 161 + i * 2;
        rect(x, y, 1 + (i >> 1), 2, M.SMOKE);
      }
    }

    // 眠りの Z
    if (!calm && (h >= 23.4 || h < 6)) {
      zeeAcc += dt * 0.62;
      while (zeeAcc >= 1) {
        zeeAcc -= 1;
        zees.push({ x: 60, y: 38, t: 0 });
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

    // 街灯に集まる蛾
    if (streetL > 0.5 && !calm) {
      for (const f of moths) {
        const wx = POLE_X + 11 + Math.sin(anim * 1.7 + f.seed) * 8 + Math.sin(anim * 4.1 + f.seed * 2) * 1.5;
        const wy = 41 + Math.sin(anim * 2.3 + f.seed * 1.4) * 5;
        const px = Math.round(wx);
        const py = Math.round(wy);
        put(px, py, M.MOTH);
        emit(px, py, 90);
      }
    }

    // 舞う葉
    if (!calm && h > 7 && h < 19 && Math.random() < dt * 0.18) leaves.push({ x: 104 + Math.random() * 22, y: 54 + Math.random() * 8, t: 0, seed: Math.random() * 6 });
    for (let i = leaves.length - 1; i >= 0; i--) {
      const l = leaves[i];
      l.t += dt;
      l.y += dt * 9;
      l.x += Math.sin(l.t * 2.3 + l.seed) * dt * 11 - dt * 2;
      if (l.y > 96 || l.t > 8) {
        leaves.splice(i, 1);
        continue;
      }
      put(Math.round(l.x), Math.round(l.y), M.LEAF3);
    }
  };

  const drawLights = (state, h) => {
    // 灯りの強さ
    const targetWin = state.lamp ? 1 : state.cook ? 0.46 : 0;
    const targetLan = h >= 17.6 && h < 22.9 ? 1 : 0;
    windowL += (targetWin - windowL) * (calm ? 1 : 0.28);
    lanternL += (targetLan - lanternL) * (calm ? 1 : 0.28);

    // 赤提灯：庇の下で、すこし揺れる
    const lit = lanternL > 0.02;
    const flick = calm ? 1 : 0.94 + 0.06 * Math.sin(anim * 11) * Math.sin(anim * 3.7);
    const swing = calm ? 0 : Math.round(Math.sin(anim * 0.7) * 0.6);
    const LX = 59 + swing;
    const LY = 63;
    put(LX + 3, LY - 1, M.WOOD_DK);
    for (let j = 0; j < LANTERN_ROWS.length; j++) {
      const row = LANTERN_ROWS[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        let m;
        if (ch === 'd') m = M.WOOD_DK;
        else if (ch === 'x') m = M.SIL;
        else if (ch === 'l') m = lit ? M.LIT_DK : M.LANTERN_DK;
        else m = lit ? (Math.abs(j - 4) <= 2 ? M.LIT_HI : M.LIT) : M.LANTERN;
        put(LX + i, LY + j, m);
        if (lit && (ch === 'h' || ch === 'l')) emit(LX + i, LY + j, 255 * lanternL * flick, 0);
      }
    }

    const pool = (cx, cy, rx, ry, L, variant = 2) => {
      if (L <= 0.01) return;
      for (let y = Math.max(cy - ry, -oy); y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const px = x + ox;
          const py = y + oy;
          if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
          const i = py * bw + px;
          const m = matBuf[i];
          if (m === 0 || GLOWS[m]) continue;
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          const v = (1 - d) * L * 1.5;
          if (v * 16 > bayerAt(x, y)) varBuf[i] = variant;
        }
      }
    };
    // 白い灯り：自販機と街灯
    pool(POLE_X + 11, 92, 22, 8, streetL * 0.65, 3);
    pool(POLE_X + 11, 70, 12, 16, streetL * 0.25, 3);
    pool(VEND_X + 7, 92, 21, 7, vendL * 0.85, 3);
    pool(VEND_X + 7, 72, 18, 13, vendL * 0.3, 3);
    // 暖かい灯り：窓から道へ落ちる光と、壁を照らす光
    pool(50, 90, 30, 7, shopL * 0.85);
    pool(73, 90, 11, 6, shopL * 0.7);
    pool(53, 48, 17, 9, windowL * 0.34);
    pool(62, 75, 12, 11, lanternL * 0.5);
    pool(62, 91, 16, 6, lanternL * 0.6);
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
      perch.away = Math.max(0, perch.away - dt);
      birds.next -= dt;
      if (birds.t >= 0) {
        birds.t += dt;
        if (birds.t > 9) birds.t = -1;
      } else if (birds.next <= 0) {
        birds.t = 0;
        birds.next = 12 + Math.random() * 14;
        birds.y = 4 + Math.random() * 18;
        birds.dir = Math.random() < 0.5 ? 1 : -1;
        birds.from = birds.dir > 0 ? -12 : CORE_W + 12;
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
    drawSky(h);
    drawCity(h);
    drawShadows(h);
    const state = drawWindow(h);
    drawShop(h);
    drawStreet(h);
    drawPuddles();
    drawLights(state, h);
    drawResident(plan, h);
    drawCanopy();
    drawCat(h, dt);
    drawParticles(h, dt);

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
      console.warn('toggle-daylight: シェーダーを作れないので、2D で描く', error);
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
  let ctx2d = null;
  let lowCanvas = null;
  if (!ready) {
    ctx2d = canvas.getContext('2d');
  }

  // ---- 形と大きさ
  const shape = { W: 1, H: 1, cssW: 1, cssH: 1, dpr: 1, pillW: 1, pillH: 1, bezel: 1, winW: 1, winH: 1, r0: 1, travel: 1, travelCss: 1, ox: 0, oy: 0 };
  let renderScale = 1;
  let thumbSeam = 1;

  const measure = () => {
    const box = root.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1) * renderScale;
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
    const fx = (box.left * dpr) % 1;
    const fy = (box.top * dpr) % 1;
    canvas.style.transform = `translate(${-fx / dpr}px, ${-fy / dpr}px)`;

    if (!changed) return false;
    canvas.width = W;
    canvas.height = H;

    // 整数倍を高さで決める。切れるのが 12% までなら大きい方。横は景色が両わきへ広がる
    const ratio = shape.winH / CORE_H;
    let kk = Math.max(1, Math.floor(ratio));
    if (((kk + 1) * CORE_H) / shape.winH <= 1.12) kk += 1;
    k = kk;
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
      lowCanvas = new OffscreenCanvas(bw, bh);
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
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels.buffer));
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
      root.dispatchEvent(new CustomEvent('daylight:change', { bubbles: true, composed: true, detail: { night } }));
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
    // 光る画素の重心と強さ。人影が窓を隠せば弱くなる。路地は灯りの数が多いぶん、割る数も大きい
    const homeW = sources[0].w;
    const home = unit(A2);
    const homeI = (homeW / 255 / 300) * 1.05;
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
  let worldAcc = 1;
  let dirty = true;
  let slow = 0;
  let good = 0;
  let frames = 0;
  let lastWorldClock = -1;
  let drag = null;

  const nightAmount = (h) => clamp(smoothstep(17.4, 20.2, h) + (1 - smoothstep(4.8, 7.2, h)));

  const adapt = (dt) => {
    // どうしても遅い機械では、細かさを落とす。ピクセルは整数倍のまま
    if (++frames < 40) return;
    if (dt > 0.0225) slow++;
    else good++;
    if (slow + good < 50) return;
    if (slow > 30 && renderScale > 0.5) {
      renderScale = Math.max(0.5, renderScale - 0.25);
      measure();
      dirty = true;
      lastWorldClock = -1;
    }
    slow = 0;
    good = 0;
  };

  const tick = (ms) => {
    raf = 0;
    const t = ms / 1000;
    const dt = last ? Math.min(0.05, t - last) : 1 / 60;
    last = t;

    if (!calm) adapt(dt);

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
    const worldStep = calm ? Math.abs(clock - lastWorldClock) > 1e-4 || dirty : worldAcc >= 1 / WORLD_HZ;
    if (worldStep) {
      renderWorld(clock, Math.min(worldAcc, 0.1), hurry);
      worldAcc = 0;
      lastWorldClock = clock;
      if (ready) uploadWorld();
      dirty = true;
    }

    if (dirty) {
      const night = nightAmount(hourOf(clock));
      // 世界の暗さ（0 = 昼、1 = 夜）。使い手はこの値で、ページの地を合わせられる
      root.style.setProperty('--night', night.toFixed(3));
      if (ready) drawGl(night);
      else draw2d(night);
      dirty = false;
    }

    // 動きを減らす設定で止まっているときは、次の操作まで描かない
    const idleCalm = calm && !moving && !drag;
    if (visible && !idleCalm) raf = requestAnimationFrame(tick);
  };

  function wake() {
    if (!raf && visible) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  // ---- 速く動かすと、住人が驚いて空を見上げる。猫は背を丸め、すずめは飛び立つ
  let startleCool = 0;
  const startle = () => {
    if (calm || performance.now() < startleCool) return;
    startleCool = performance.now() + 1500;
    res.startle = 0.9;
    if (perch.away <= 0) {
      perch.away = 9;
      // 電線にいた場所から、そのまま飛び立つ
      birds.t = 0;
      birds.y = 12;
      birds.dir = 1;
      birds.from = 146;
      birds.next = 14;
    }
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
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(root);

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
  on(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
  });

  // ---- 組み立て
  readPalette();
  measure();
  res.x = 131;
  res.inside = false;
  // 最初の絵を、はじめのフレームまでに用意する
  renderWorld(clockOf(), 0, 0);
  if (ready) uploadWorld();
  wake();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
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
