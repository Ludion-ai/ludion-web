// part.js — ESモジュール。rootの中だけを触る
// 雨の窓ぎわ：雨の夜、木の壁の店の、窓ぎわの席から、外の通りを見ている。
//
// 絵：外の街も、手前の店内（壁、窓の枠、テーブル、本、カップ、ランタン）も、同じマス目のドット絵。色は番号で持ち、にじませずに拡大する。
// 街：傘の人が歩き、店の客が動き、街灯とネオンが、ぬれた路面に長く映る。雨が路面を打つと、小さな輪が広がる。
//     ときどき、車がゆっくり横切る。煙突から煙が上り、遠くの塔の明かりが点滅する。向かいの2階の窓に、猫がいる（ガラスを叩くと、隠れる）。
// 店内：鉢の葉、壁のつる、花びんの花が、ゆっくり揺れる。置き時計は、端末の時刻を指す。ランタンのまわりを、蛾が飛ぶ。
//     触ると動く：ランタンは揺れ、葉はざわめき、カップは湯気が立ち、本はページがめくれ、花は花びらが散り、時計はベルが鳴る。
// ガラス：窓の中だけ。ここだけ、なめらかに描く。雨粒が付き、重くなると伝い落ちる。下と縁はくもっていて、カーソルでなぞると拭ける。ランタンが、うっすら映る。
// ひび：叩いた点から放射のひびが走り、輪のひびがそれをつなぐ。ひびは「点と辺のグラフ」で持ち、辺に囲まれた領域が破片になる。
// 破片：近くを何度か叩くと外れて落ち、手前のテーブルで砕けて、かけらが残る。穴の向こうは、くもりも雨粒もない、くっきりした街。
// 穴が開くと、風が入る：葉とランタンが揺れ、湯気が流れ、ときどき本のページがめくれる。
// 音：録音は使わず、その場で合成する。雨、遠くの車、店内、ガラス。外の音は、穴が開くほどはっきりする。
// 色は JS に書かない。--_bg、--_surface、--_fg、--_muted、--_accent の色みに、下の表の明るさを掛けて作る。

// ============================================================================
// 決まりの数値。作り替えるときは、まずここを変える。
//   景色を変える：city と time と、下の createScene（街と店内の絵）。ガラスを別の材質に：glass と fog と rain と crack と shard と sound。
// 長さの単位：「px」は、短い辺が 800px の画面での大きさ（画面に合わせて伸び縮みする）。
// ============================================================================
const TUNE = {
  // ---- ガラス
  glass: {
    sink: 0.1, // ガラス越しに、色が沈む量（0 で沈まない）
    dim: 0.94, // ガラスを通る光の割合
    hue: 0.4, // ガラスの色み（--_surface の色みを乗せる量）
    warp: 1.1, // 屈折のゆがみ（px）
    soft: 0.1, // ガラス越しの街の、わずかなぼけ（0 でくっきり）
    reflect: 0.55, // ランタンの映り込みの濃さ
    ghost: [0.89, 0.83], // ランタンが映る場所（ガラスの中の 0〜1。左下が原点）
  },

  // ---- くもり（ガラスの内側）
  fog: {
    amount: 1.0, // くもりの濃さ（0 でくもらない）
    blur: 2.8, // くもったところで、外の絵がにじむ強さ
    wipe: 30, // カーソルで拭ける幅（px）
    back: 28, // 拭いた跡が、またくもるまでの秒数
  },

  // ---- 雨粒（ガラスの外側）
  rain: {
    rate: 14, // 1秒に付く粒の数
    size: [1.8, 7], // 付く粒の大きさ（px）
    heavy: 8.5, // この大きさを超えると、重さで伝い落ちる（px）
    fall: [50, 250], // 伝い落ちる速さ（px / 秒）
    trail: 9, // 伝い落ちた跡に、小さな粒を残す間隔（px）
    film: 8, // ぬれた筋が消えるまでの秒数
    max: 520, // 粒の数の上限
    lens: 130, // 粒が、向こうの景色を逆さに小さく映す広さ（px）
    shine: 1.2, // 粒の縁の光
    settle: 34, // 最初から、この秒数ぶんの雨が付いた状態で始める
  },

  // ---- ひび
  crack: {
    radials: [8, 11], // 放射のひびの本数
    shorts: [6, 11], // 中心だけの短いひびの本数
    reach: [0.18, 0.26], // 網の半径（画面の短い辺を 1 として）
    length: [0.75, 1.3], // ふつうのひびの長さ（網の半径の何倍か）
    runners: [1, 3], // 遠くまで走るひびの本数
    runnerLength: [1.7, 3.0], // その長さ（網の半径の何倍か）
    kink: 0.05, // 進むたびに折れる角度（ラジアン）
    rings: [0.07, 0.21, 0.46, 0.82], // 輪のひびの半径（網の半径を 1 として）
    ringChance: [1, 0.96, 0.82, 0.5], // 輪のひびが、隣り合う放射のひびをつなぐ確率
    ringJitter: 0.13, // 輪の半径のばらつき
    twig: 0.28, // 小枝のひびが出る確率
    width: 0.9, // 中心での太さ（px）
    tip: 0.13, // 先での太さ（px）
    ringWidth: 0.65, // 輪のひびの太さ（放射のひびの何倍か）
    chip: [9, 13], // 叩いた点の、貝殻のような欠けの大きさ（px）
    edge: 1.3, // 穴の縁の線の太さ（px）。場所によって、この 0.5〜3 倍になる。光る線と、その内側の暗い線が並ぶ
    glow: 3.0, // ひびのまわりで、向こうの絵がずれる幅（太さの何倍か）
    run: 0.085, // 網の半径まで走る秒数
    ease: 1.5, // 走り出しは速く、先で遅くなる度合い
    creep: [3, 7], // あとから「ミシミシ」と伸びるひびの本数
    creepWithin: [0.2, 1.3], // その時刻（秒）
    flash: 0.2, // 走った直後の光が消える秒数
    light: 1.0, // 光を拾う強さ
    refract: 28, // ひびの縁で、向こうの絵がずれる量
    tilt: 4, // 囲まれた破片が、それぞれわずかに傾いて、向こうの絵がずれる量（px）
    grip: 1.15, // 叩いた力が届く範囲（網の半径の何倍か）
    hold: 1.3, // 破片が外れる力。1回叩いた中心が 1.0。1 より大きいので、近くを2回以上叩かないと外れない
    hang: 0.6, // 周りがこの割合まで穴になった破片は、支えを失って落ちる
    bigAt: 3, // 近くを叩いたのがこの回数になると、大きな破片が1枚、必ず外れる
    bigArea: [0.004, 0.05], // その大きな破片の広さ（画面の高さを 1 とした面積）
    maxEdges: 3600, // ひびの辺の上限（メモリーを増やし続けない）
  },

  // ---- 落ちる破片
  shard: {
    gravity: 3.4, // 重さ（画面の高さ / 秒²）
    wait: [0.06, 0.7], // 叩いてから外れるまでの秒数（遠い破片ほど遅い）
    push: [0.03, 0.16], // 叩いた点から外へ押される速さ
    lean: [0.12, 0.4], // 手前へ倒れてくる速さ
    spin: [1.2, 4.6], // 回る速さ（ラジアン / 秒。大きい破片ほど遅い）
    thick: 0.0045, // 厚み（画面の高さを 1 として）
    bevel: 0.006, // 縁の光る幅（画面の高さを 1 として）
    bend: 0.03, // 破片越しに、向こうの絵がずれる量
    eye: 2.4, // 目からガラスまでの距離（画面の高さを 1 として）
    dust: 0.00002, // これより小さい破片は、粉として消える（面積）
    max: 48, // 同時に落ちる破片の上限
  },

  // ---- 張り替え
  heal: {
    after: 90, // 触らないまま、この秒数がたつと、新しいガラスが張られる
    time: 6, // 張られる速さ（--_motion の何倍か）
    angle: 8, // 新しいガラスが入ってくる向き（度。0 で左から右）
    edge: 5, // 新しいガラスの先頭の、光る幅（px）
  },

  // ---- 窓の外の街（ドット絵）
  city: {
    rows: 380, // 画面の高さを、この数のマスに分ける（1マスは、幅1280の画面で 2px）
    hz: 12, // 絵が動くコマ数（1秒あたり）
    rain: 1.0, // 外の雨の量
    people: [3, 8], // 人が通る間隔（秒）
    friend: 6, // 何人に1人、白いシャツの人が通るか
  },

  // ---- テーブルに残るもの
  room: {
    debris: 240, // ガラスのかけらの上限
    spots: 110, // 水の跡の上限
    rainIn: 9, // 穴から吹き込む雨の量（穴の広さがガラスの 2% のとき、1秒あたり）
  },

  // ---- 時刻（端末の時計）。基本は夕方から夜の絵で、空の暗さだけが変わる
  time: {
    dawn: [4.5, 7], // 夜明け：この間に、空が夕方の明るさまで上がる（時）
    dusk: [16.5, 20], // 日暮れ：この間に、空が夜の暗さまで落ちる（時）
  },

  // ---- 音（大きさは dB。0 がいちばん大きい）
  sound: {
    level: -4, // 全体
    rain: -33.5, // 雨（ガラス越し）
    rainOpen: -29.5, // 雨（穴が開ききったとき）
    patter: -33, // ガラスを打つ雨粒
    cars: -30, // 遠くの車
    room: -43, // 店内の空気
    clink: -38, // 店内の、食器のかすかな音
    touch: -18, // 店内の物（ランタン、カップ、本、葉）に触れたときの音
    crack: -11, // ひびの「ピシッ」
    creak: -24, // 広がる「ミシミシ」
    shard: -25, // 破片が外れる音
    smash: -13.5, // 破片がテーブルで砕ける音
    muffled: 520, // ガラス越しの外の音の、こもり具合（Hz。これより高い音が消える）
    open: 9000, // 穴が開ききったときの、同じ値
    openAt: 0.03, // 穴の広さ（面全体を 1 として）がこの値で、6割ほど、はっきり聞こえる
    clinkEvery: [18, 50], // 食器の音の間隔（秒）
  },

  // ---- 軽さ
  perf: {
    idleFps: 24, // 触っていない間の、1秒のコマ数の上限
    maxDpr: 2, // 画素の密度の上限
    maxPixels: 3400000, // 描く画素の数の上限
    mapScale: 0.34, // くもりの地図の細かさ（画面に対して）
    minScale: 0.6, // 重い機械で、ここまで細かさを下げる
    resizeWait: 140, // 大きさが変わってから、描き直すまでのミリ秒
    soft: { scale: 0.5, idleFps: 3, cityHz: 1, drops: 110, rate: 4 }, // GPU を使えない機械（CPU だけで描く）：細かさ、コマ数、絵が動くコマ数、雨粒の数。人は歩かせない
  },
};

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gain = (db) => Math.pow(10, db / 20);

// 種から、0〜1 の数の列を作る（同じ種なら、同じ列）
function dice(seed) {
  let s = Math.imul((seed | 0) ^ 0x3c6ef372, 0x2c9277b5) || 0x1d872b41;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  next();
  next();
  return next;
}

// ---- 色：線形の RGB で扱う
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toByte = (c) => Math.round(255 * clamp(c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// 色みを保ったまま、明るさ（輝度）を決める。vivid は鮮やかさ。色が収まらないぶんは、同じ明るさの灰色へ寄せる
function lit(base, y, vivid = 1) {
  const own = lumaOf(base) || 1e-4;
  let out = base.map((v) => mix(own, v, vivid) * (y / own));
  const top = Math.max(out[0], out[1], out[2]);
  if (top > 1) out = out.map((v) => y + ((v - y) * (1 - y)) / Math.max(top - y, 1e-6));
  return out.map((v) => clamp(v));
}

// ---- シェーダー
// 画面いっぱいの三角を1つ
const FILL = `#version 300 es
const vec2 corner[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corner[gl_VertexID], 0.0, 1.0);
}`;

// 格子の点ごとに決まる乱数と、それをなめらかにつないだ雑音
const NOISE = `
float rnd(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 32768) * uvec2(2654435761u, 2246822519u);
  uint n = (q.x ^ (q.y >> 3) ^ (q.y << 7)) * 3266489917u;
  n ^= n >> 15;
  n *= 668265263u;
  n ^= n >> 13;
  return float(n >> 8) / 16777216.0;
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rnd(i), rnd(i + vec2(1.0, 0.0)), f.x), mix(rnd(i + vec2(0.0, 1.0)), rnd(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cloud(vec2 p) {
  float sum = 0.0;
  float part = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += part * noise(p);
    p = p * 2.13 + vec2(11.7, 5.3);
    part *= 0.5;
  }
  return sum / 0.9375;
}`;

// 画面へ出す色：明るすぎるところをなだらかに抑え、sRGB にして、帯が見えないように粒を足す
const SCREEN = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toScreen(vec3 c, vec2 frag) {
  c = max(c, 0.0);
  c = mix(c, 0.8 + 0.2 * tanh((c - 0.8) / 0.2), step(0.8, c));
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  return c + (rnd(frag) - 0.5) / 255.0;
}`;

// 街のドット絵を読む。くっきり（マス目のまま）と、にじませて（色のかたまり）
const CITY = `
uniform sampler2D uCity;
uniform float uCellPx, uFine; // uFine：マス目が細かいぶん、にじませる段を足す
vec3 cityCrisp(vec2 frag) {
  ivec2 size = textureSize(uCity, 0);
  return texelFetch(uCity, clamp(ivec2(floor(frag / uCellPx)), ivec2(0), size - 1), 0).rgb;
}
vec3 citySoft(vec2 frag, float lod) {
  return textureLod(uCity, frag / (uCellPx * vec2(textureSize(uCity, 0))), lod + uFine).rgb;
}`;

// 店内のドット絵を読む。a は、0：窓のガラスの所、0.5：手前の物（鉢、本、カップ、椅子）、1：壁、枠、テーブル
const ROOM = `
uniform sampler2D uRoom;
vec4 roomAt(vec2 frag) {
  ivec2 size = textureSize(uRoom, 0);
  return texelFetch(uRoom, clamp(ivec2(floor(frag / uCellPx)), ivec2(0), size - 1), 0);
}`;

// くもりの元の形を1枚に焼く。r：くもりの濃さ（下と縁で濃い）、g：細かい粒、ba：ガラスのゆがみ
const MIST_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uSeed, uAspect, uFloor;
out vec4 o;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec2 s = p + uSeed;
  float up = max(uv.y - uFloor, 0.0);
  float side = min(min(uv.x, 1.0 - uv.x) * uAspect, 1.0 - uv.y);
  float base = 0.07 + 1.0 * exp(-up / 0.14) + 0.65 * exp(-side / 0.055);
  base *= 0.62 + 0.76 * cloud(s * 2.4);
  float grain = 0.6 * noise(p * 380.0) + 0.4 * noise(p * 170.0 + 7.0);
  o = vec4(clamp(base, 0.0, 1.0), grain, cloud(s * 1.4 + 31.0), cloud(s * 1.4 + 57.0));
}`;

// ガラスの地図を1コマ進める。r：拭いた跡、g：ぬれた筋。どちらも、時間とともに消えていく
// 8ビットの絵では、少しずつ引くと値が動かなくなるので、画素ごとに確率で1段ずつ引く
const FADE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPrev;
uniform vec2 uStep; // 1コマで引く量（255 段のうち）
uniform float uTick;
out vec4 o;
${NOISE}
void main() {
  vec4 v = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0);
  vec2 r = vec2(rnd(gl_FragCoord.xy + uTick * 17.0), rnd(gl_FragCoord.yx * 1.7 + uTick * 29.0 + 91.0));
  vec2 cut = floor(uStep) + step(r, fract(uStep));
  o = vec4(max(v.rg - cut / 255.0, 0.0), 0.0, 1.0);
}`;

// ガラスの地図に書き込む：カーソルで拭いた跡（r）と、粒が伝い落ちた筋（g）
const STAMP_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg; // 両端（面の中の 0〜1）
layout(location = 2) in vec4 aBody; // x: 半径（px）, y: 強さ, z: 書き込む先（0 は拭いた跡、1 はぬれた筋）
uniform vec2 uRes;
flat out vec4 vSeg;
flat out vec4 vBody;
void main() {
  vec2 a = aSeg.xy * uRes;
  vec2 b = aSeg.zw * uRes;
  vec2 dir = b - a;
  float len = length(dir);
  dir = len > 1.0e-4 ? dir / len : vec2(1.0, 0.0);
  float reach = aBody.x + 2.0;
  vec2 p = mix(a, b, aCorner.x) + dir * (aCorner.x * 2.0 - 1.0) * reach + vec2(-dir.y, dir.x) * aCorner.y * reach;
  vSeg = vec4(a, b);
  vBody = aBody;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const STAMP_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes, uMapRes;
flat in vec4 vSeg;
flat in vec4 vBody;
out vec4 o;
${NOISE}
void main() {
  vec2 frag = gl_FragCoord.xy * uRes / uMapRes;
  vec2 pa = frag - vSeg.xy;
  vec2 ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-6), 0.0, 1.0);
  float d = length(pa - ba * h) / vBody.x;
  // 手で拭いた跡は、縁がむらになる
  float rough = vBody.z < 0.5 ? 0.22 * (noise(frag / (vBody.x * 0.16)) - 0.5) : 0.0;
  float v = (1.0 - smoothstep(0.62, 1.0, d + rough)) * vBody.y;
  o = vBody.z < 0.5 ? vec4(v, 0.0, 0.0, 1.0) : vec4(0.0, v, 0.0, 1.0);
}`;

// 雨粒の絵。rg：粒の面の傾き、b：厚み、a：粒のあるところ
const DROP_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aDrop; // xy: 中心（面の中の 0〜1）, z: 半径（px）, w: 尾の長さ
uniform vec2 uRes;
out vec2 vAt;
flat out vec2 vLook;
void main() {
  float tail = 1.0 + aDrop.w;
  vec2 q = vec2(aCorner.x, aCorner.y > 0.0 ? aCorner.y * tail : aCorner.y) * 1.08;
  vAt = q;
  vLook = aDrop.zw;
  gl_Position = vec4((aDrop.xy * uRes + q * aDrop.z) / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const DROP_FRAG = `#version 300 es
precision highp float;
in vec2 vAt;
flat in vec2 vLook;
out vec4 o;
void main() {
  // 伝い落ちる粒は、上へ細く尾を引く
  vec2 q = vAt;
  if (q.y > 0.0) {
    q.y /= 1.0 + vLook.y;
    q.x *= 1.0 + 0.9 * vLook.y * q.y;
  }
  // 粒は、まん丸ではない。輪郭が少しいびつで、下が少し重い（形は、粒ごとに違う）
  float turn = fract(vLook.x * 7.31) * 6.2832;
  float ang = atan(q.y, q.x);
  float d = length(q * vec2(1.0, q.y < 0.0 ? 0.94 : 1.1)) / (0.9 + 0.07 * sin(ang * 3.0 + turn) + 0.04 * sin(ang * 5.0 + turn * 2.3));
  float cover = 1.0 - smoothstep(1.0 - 1.4 / vLook.x, 1.0, d);
  if (cover <= 0.0) discard;
  o = vec4(0.5 + 0.5 * q * (0.3 + 0.7 * min(d, 1.0)), sqrt(max(1.0 - d * d, 0.0)), cover);
}`;

// ひびの線と、叩いた点の欠け。r：芯、g：まわりのにじみ、b：走った直後の光、a：ひびの向き
const CRACK_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg; // 両端（面の中の 0〜1）
layout(location = 2) in vec4 aBody; // 両端の太さ（px）と、生まれた時刻
layout(location = 3) in vec2 aSeed; // x が 2 以上なら、線ではなく、叩いた点の欠け
uniform vec2 uRes;
uniform float uPx, uGlow;
flat out vec4 vSeg;
flat out vec4 vBody;
flat out vec3 vSeed;
void main() {
  vec2 a = aSeg.xy * uRes;
  vec2 b = aSeg.zw * uRes;
  vec2 dir = b - a;
  float len = length(dir);
  dir = len > 1.0e-4 ? dir / len : vec2(1.0, 0.0);
  float reach = aSeed.x >= 2.0 ? aBody.x * uPx * 1.1 : max(aBody.x, aBody.y) * uPx * uGlow * 2.6 + 3.0;
  vec2 p = mix(a, b, aCorner.x) + dir * (aCorner.x * 2.0 - 1.0) * reach + vec2(-dir.y, dir.x) * aCorner.y * reach;
  vSeg = vec4(a, b);
  vBody = aBody;
  // 向きは 180 度で一回り。ひびの面は、まっすぐではないので、少しずつ向きがずれる
  vSeed = vec3(aSeed, fract(atan(dir.y, dir.x) / 3.14159265 + 1.0 + (aSeed.y - 0.5) * 0.14));
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const CRACK_FRAG = `#version 300 es
precision highp float;
uniform float uPx, uGlow, uNow, uFlash;
flat in vec4 vSeg;
flat in vec4 vBody;
flat in vec3 vSeed;
out vec4 o;
${NOISE}
void main() {
  vec2 pa = gl_FragCoord.xy - vSeg.xy;
  if (vSeed.x >= 2.0) {
    // 叩いた点：白く粉になった小さな芯と、そこから片側へ扇に開く、貝殻のような欠け
    float age = uNow - vBody.z;
    if (age < 0.0) discard;
    vec2 p = pa / (vBody.x * uPx);
    float r = length(p);
    float powder = smoothstep(0.34, 0.14, r + 0.14 * (rnd(gl_FragCoord.xy * 0.8) - 0.5));
    float turn = fract(vSeed.x) * 6.2832;
    vec2 q = vec2(p.x * cos(turn) + p.y * sin(turn), p.y * cos(turn) - p.x * sin(turn));
    float ang = atan(q.y, q.x);
    float fan = 0.5 + 0.5 * cos(ang);
    float rim = r / (0.22 + 0.78 * fan * fan); // 1 が欠けの縁
    float inside = 1.0 - smoothstep(0.9, 1.0, rim);
    // 同心の細い筋。割れ目が、波のように広がった跡
    float ribs = pow(0.5 + 0.5 * sin(rim * 16.0 + 1.5 * sin(ang * 3.0 + vSeed.y * 9.0)), 6.0) * smoothstep(0.2, 0.55, rim);
    float lip = smoothstep(0.78, 0.94, rim);
    float core = max(powder, inside * (0.42 * ribs + 0.7 * lip));
    float way = powder > 0.35 ? 1.0 : 0.97 * fract(ang / 3.14159265 + 0.5 + turn / 3.14159265) * step(0.2, core);
    o = vec4(core, inside * (0.12 + 0.3 * rim), core * exp(-age / uFlash), way);
    return;
  }
  vec2 ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-6), 0.0, 1.0);
  float age = uNow - mix(vBody.z, vBody.w, h);
  if (age < 0.0) discard;
  float d = length(pa - ba * h);
  float w = mix(vBody.x, vBody.y, h) * uPx;
  float core = clamp(w + 0.5 - d, 0.0, 1.0) * clamp(w * 1.6 + 0.15, 0.0, 1.0);
  float sigma = w * uGlow + 1.2;
  float halo = exp(-d * d / (2.0 * sigma * sigma)) * clamp(w * 1.1 + 0.2, 0.0, 1.0);
  o = vec4(core, halo, core * exp(-age / uFlash), 0.97 * vSeed.z * step(0.2, core));
}`;

// 破片の地図。rg：破片ごとの傾き、b：穴、a：映り込みのばらつき
const CELL_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aData;
out vec4 vData;
void main() {
  vData = aData;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const CELL_FRAG = `#version 300 es
precision highp float;
in vec4 vData;
out vec4 o;
void main() {
  o = vData;
}`;

// 窓：店内はドット絵のまま。窓の中だけ、ドット絵の街を、ガラス越しに見る。くもり、雨粒、ランタンの映り込み、ひび、穴
const WINDOW_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uMap, uDrop, uMist, uCell, uCrack;
uniform vec2 uRes, uGhost;
uniform float uPx, uBroken, uFlick;
uniform vec4 uPane; // ガラスの左下の角と、大きさ（画素）
uniform vec4 uLamp; // xy: ランタンの中心（画素）, z: ランタンの高さ（画素）, w: 映り込みの濃さ
uniform vec4 uHeal; // x: 張り替えの進み（0 は張り替えていない）, y: 先頭の光る幅, zw: 向き
uniform vec3 uTint, uEdge, uEdgeLit, uWarm;
uniform vec4 uGlassA; // x: 色の沈み, y: くもりの濃さ, z: くもりのにじみ, w: ゆがみ
uniform vec4 uGlassB; // x: わずかなぼけ, y: （空き）, z: 粒が映す広さ, w: 粒の光
uniform vec4 uCrackA; // x: 光, y: 縁のずれ, z: 破片の傾き, w: 穴の縁の線の太さ
out vec4 o;
${NOISE}
${SCREEN}
${CITY}
${ROOM}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec4 room = roomAt(frag);
  vec2 pf = frag - uPane.xy;
  vec3 col;
  if (room.a > 0.25 || pf.x < 0.0 || pf.y < 0.0 || pf.x >= uPane.z || pf.y >= uPane.w) {
    // 店内：ドット絵のまま。ランタンに近いほど、明かりの揺らぎを受ける（マス目ごとに同じ明るさ）
    vec2 cell = (floor(frag / uCellPx) + 0.5) * uCellPx;
    float near = exp(-length((cell - uLamp.xy) * vec2(1.0, 1.15)) / (uLamp.z * 2.4));
    col = room.rgb * (1.0 + uFlick * (0.3 + 1.4 * near));
  } else {
    vec2 uv = pf / uPane.zw;
    vec2 px = 1.0 / uPane.zw;
    float ratio = uPane.z / uPane.w;
    // 張り替え：新しいガラスが、先頭の線の後ろに張られている
    float fresh = 0.0;
    float lead = 0.0;
    if (uHeal.x > 0.0) {
      float span = dot(abs(uHeal.zw), uPane.zw);
      float behind = (uHeal.x * 1.1 - 0.05 - (dot(pf - 0.5 * uPane.zw, uHeal.zw) / span + 0.5)) * span;
      fresh = smoothstep(-1.0, 1.0, behind);
      lead = exp(-pow(behind / uHeal.y, 2.0)) * (0.35 + 0.65 * step(0.0, behind)) * smoothstep(0.0, 0.04, uHeal.x) * smoothstep(1.0, 0.96, uHeal.x);
    }
    float keep = 1.0 - fresh;
    vec4 mapv = texture(uMap, uv) * keep;
    vec4 mist = texture(uMist, uv);
    float fog = clamp(mist.r * uGlassA.y, 0.0, 1.0) * (1.0 - mapv.r);
    vec2 off = (mist.ba - 0.5) * 4.0 * uGlassA.w * uPx;
    float streak = (texture(uMap, uv + vec2(3.0 * px.x, 0.0)).g - texture(uMap, uv - vec2(3.0 * px.x, 0.0)).g) * keep;
    off.x += streak * 16.0 * uPx;
    // 光は、右上の手前にあるランタンから来る
    vec2 toLight = normalize(((uLamp.xy - uPane.xy) / uPane.zw - uv) * vec2(ratio, 1.0) + 1.0e-4);

    // ひびと破片
    float hole = 0.0;
    float core = 0.0;
    float halo = 0.0;
    float flash = 0.0;
    float turn = 0.0;
    float shade = 0.5;
    float lipLine = 0.0;
    float innerLine = 0.0;
    vec2 tilt = vec2(0.0);
    vec2 grad = vec2(0.0);
    vec2 holeDir = vec2(0.0);
    if (uBroken > 0.5) {
      vec4 cell = texture(uCell, uv);
      vec4 crack = texture(uCrack, uv);
      hole = cell.b * keep;
      tilt = (cell.rg - 0.5) * 2.0 * keep * (1.0 - hole);
      shade = cell.a;
      core = crack.r * keep;
      halo = crack.g * keep;
      flash = crack.b * keep;
      turn = crack.a * 3.14159265;
      vec2 e = vec2(1.5, 0.0);
      grad = vec2(texture(uCrack, uv + e.xy * px).g - texture(uCrack, uv - e.xy * px).g, texture(uCrack, uv + e.yx * px).g - texture(uCrack, uv - e.yx * px).g) * keep;
      off += (tilt * uCrackA.z + grad * uCrackA.y) * uPx;
      // 穴の縁を探す：すぐ隣が穴なら「光る線」、もう1つ隣が穴なら「暗い線」。線の太さは、場所で変わる。所々に、小さな欠け
      float nick = smoothstep(0.72, 0.9, noise(pf / (7.0 * uPx) + 19.0));
      vec2 w = vec2(uCrackA.w * uPx * mix(0.45, 2.3, pow(noise(pf / (15.0 * uPx)), 1.6)) * (1.0 + 1.2 * nick), 0.0);
      float hr = texture(uCell, uv + w.xy * px).b;
      float hl = texture(uCell, uv - w.xy * px).b;
      float hu = texture(uCell, uv + w.yx * px).b;
      float hd = texture(uCell, uv - w.yx * px).b;
      float nearby = max(max(hr, hl), max(hu, hd)) * keep;
      float beyond = max(max(texture(uCell, uv + 2.0 * w.xy * px).b, texture(uCell, uv - 2.0 * w.xy * px).b), max(texture(uCell, uv + 2.0 * w.yx * px).b, texture(uCell, uv - 2.0 * w.yx * px).b)) * keep;
      lipLine = clamp(nearby - hole, 0.0, 1.0);
      innerLine = clamp(beyond - max(nearby, hole), 0.0, 1.0);
      holeDir = vec2(hr - hl, hu - hd);
    }

    // ガラス越しの街：くもるほど、にじんで色のかたまりになる
    vec2 view = frag + off;
    vec3 crisp = mix(cityCrisp(view), citySoft(view, 0.9), uGlassB.x);
    float lod = 1.0 + fog * uGlassA.z;
    vec3 soft = citySoft(view, lod);
    if (fog > 0.12) {
      vec2 j = vec2(2.3, 1.1) * uCellPx * (0.6 + 2.0 * fog);
      soft = (soft + citySoft(view + j, lod) + citySoft(view - j.yx, lod)) / 3.0;
    }
    vec3 glow = citySoft(frag, 5.5); // 街の明かりの、ぼんやりした色
    vec3 thru = mix(crisp, soft, smoothstep(0.2, 0.7, fog));
    thru = mix(vec3(dot(thru, LUMA)), thru, 1.0 - uGlassA.x) * uTint;
    // くもりは乳白色。街の明かりを広げ、店内の明かりも拾う
    thru = mix(thru, thru * 0.72 + (glow * 0.6 + uWarm * 0.02) * (0.8 + 0.4 * mist.g), fog * 0.8);

    // 雨粒：小さなレンズ。向こうの景色を、逆さに小さく映す
    vec4 drop = texture(uDrop, uv);
    float wet = drop.a * keep * (1.0 - hole);
    if (wet > 0.004) {
      vec2 n = (drop.rg - 0.5) * 2.0;
      vec3 lens = citySoft(view - n * uGlassB.z * uPx, 1.9) * (1.1 + 0.7 * drop.b) + glow * 0.3;
      // 上の縁は暗く、下の縁に、外の明かりが集まって光る
      float spark = pow(max(dot(normalize(vec3(n, 0.55)), normalize(vec3(-0.3, 0.62, 0.72))), 0.0), 26.0);
      lens += (uWarm * 0.5 + glow * 1.4) * (spark + 0.5 * smoothstep(0.35, 0.95, -n.y)) * uGlassB.w;
      lens *= 1.0 - 0.55 * smoothstep(0.2, 0.95, n.y);
      thru = mix(thru, lens * uTint, wet * (1.0 - 0.45 * fog));
    }
    // 粒が伝い落ちた跡：ぬれた筋が、街の明かりを拾う
    thru += glow * (mapv.g * 0.1 + abs(streak) * 0.5) * (1.0 - 0.5 * fog);

    // ランタンの映り込み：店内のランタンが、ぼんやり暖かく映る。破片は、それぞれ違う向きに映す
    float lean = length(tilt);
    vec2 g = (uv - uGhost + tilt * 0.06) * vec2(ratio, 1.0) * uPane.w / uLamp.z;
    g.x += uFlick * 0.25;
    vec3 ghost = textureLod(uRoom, (uLamp.xy + vec2(-g.x, g.y) * uLamp.z) / (uCellPx * vec2(textureSize(uRoom, 0))), 1.7 + uFine).rgb;
    thru *= 1.0 - 0.07 * lean * (1.0 - shade);
    col = thru + ghost * exp(-dot(g, g) * 2.6) * uLamp.w * (1.0 + 3.0 * uFlick) * (1.0 + (shade - 0.5) * 2.0 * lean);
    col += uWarm * (0.004 + max(shade - 0.55, 0.0) * 0.28 * lean);

    if (uBroken > 0.5) {
      vec3 shine = uWarm * 1.1 + glow * 0.7 + 0.04;
      float toward = dot(grad, toLight) * 5.0;
      // 割れ残って手前に傾いた破片は、縁に小さな影を落とす
      col *= 1.0 - halo * clamp(0.12 - toward + 0.5 * lean, 0.0, 0.6);
      col += shine * halo * clamp(toward, 0.0, 1.0) * 0.05;
      // ひびの面は、細い鏡。面が光のほうを向いたものだけが光り、ほかは、髪の毛ほどの暗い線になって消える
      float glint = pow(1.0 - abs(dot(vec2(cos(turn), sin(turn)), toLight)), 5.0);
      glint = mix(glint, 0.5, step(0.985, turn / 3.14159265)); // 粉になった芯
      col *= 1.0 - core * 0.3 * (1.0 - glint);
      col += shine * uCrackA.x * core * (0.05 + 1.7 * glint) + (uWarm + glow) * flash * 1.4;
      // 穴：向こうは、くもりも雨粒も映り込みもない、くっきりした街
      col = mix(col, cityCrisp(frag), hole);
      // 穴の縁：ランタンの側は暖かく光り、反対側は沈む。所々が、白く粉になっている
      float facing = smoothstep(-0.25, 0.75, dot(normalize(holeDir + 1.0e-4), toLight));
      float powder = smoothstep(0.7, 0.86, noise(pf / (5.0 * uPx) + 71.0));
      vec3 lip = mix(uEdge * 1.6 + glow * 0.25, uEdgeLit * (uWarm * 1.5 + 0.1), facing);
      lip = mix(lip, vec3(0.9) * (uWarm * 0.7 + 0.35), powder);
      col = mix(col, uEdge * 0.6, innerLine * 0.85);
      col = mix(col, lip, lipLine);
    }
    col += uEdgeLit * (uWarm + glow) * lead * 0.3;
    // 枠がガラスに落とす影
    float rim = min(min(pf.x, uPane.z - pf.x), min(pf.y, uPane.w - pf.y));
    col *= 1.0 - 0.45 * exp(-rim / (3.5 * uPx));
  }
  o = vec4(toScreen(col, frag), 1.0);
}`;

// 落ちる破片。厚みのある板として、向きを変えながら描く
const SHARD_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aEdge; // x: 面では、縁で 1、内で 0。側面では、表の角で 1、裏の角で 0。y: 側面なら 1
uniform mat3 uRot;
uniform vec3 uAt;
uniform vec2 uCam; // x: ガラスの縦横比, y: 目までの距離
uniform vec4 uPaneNdc; // 画面の中での、ガラスの中心と大きさ
out vec3 vNor;
out vec3 vWorld;
out vec2 vEdge;
void main() {
  vec3 w = uRot * aPos + uAt;
  vNor = uRot * aNor;
  vWorld = w;
  vEdge = aEdge;
  float s = uCam.y / (uCam.y - w.z);
  gl_Position = vec4(uPaneNdc.xy + vec2(w.x * s / (0.5 * uCam.x), w.y * s / 0.5) * uPaneNdc.zw, -0.5 * w.z, 1.0);
}`;

const SHARD_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform vec2 uRes, uCam;
uniform vec3 uTint, uEdge, uEdgeLit, uWarm;
uniform float uSink, uBend;
in vec3 vNor;
in vec3 vWorld;
in vec2 vEdge;
out vec4 o;
${NOISE}
${SCREEN}
${CITY}
${ROOM}
void main() {
  vec2 frag = gl_FragCoord.xy;
  // 手前の物（鉢、本、カップ）の向こうを落ちる
  float kind = roomAt(frag).a;
  if (kind > 0.25 && kind < 0.75) discard;
  vec3 N = normalize(vNor);
  vec3 V = normalize(vec3(0.0, 0.0, uCam.y) - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = dot(N, V);
  vec3 R = reflect(-V, N);
  vec3 key = normalize(vec3(0.55, 0.62, 0.56)); // ランタンは、右上の手前
  float sharp = pow(max(dot(R, key), 0.0), 60.0);
  float broad = pow(max(dot(R, key), 0.0), 7.0);
  vec3 glow = citySoft(frag, 5.0);
  vec3 c;
  if (vEdge.y > 0.5) {
    // 側面：細く光る
    c = uEdge * 0.6 + uEdgeLit * (uWarm * (0.2 + 2.0 * sharp + 0.9 * broad) + glow * 0.9);
  } else {
    // 面：透きとおっている。向こうの絵（窓の中は街、窓の外は店内）が、傾きのぶん、ずれて見える。
    // 回って、面がランタンのほうを向いたときだけ、きらっと光る
    vec2 past = frag - N.xy * uBend * uRes.y;
    vec4 room = roomAt(past);
    vec3 thru = room.a > 0.25 ? room.rgb : mix(cityCrisp(past), citySoft(past, 0.8), 0.35);
    thru = mix(vec3(dot(thru, LUMA)), thru, 1.0 - uSink) * uTint;
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
    vec3 env = uWarm * mix(0.03, 0.7, smoothstep(-0.3, 0.8, R.y)) + glow * 0.5;
    c = thru * (1.0 - 0.75 * F) + glow * 0.06 + env * (F * 1.1 + 0.35 * broad) + uWarm * sharp * 3.0;
    // 縁：ごく細い暗い緑の内側に、細い光。光のほうを向いた縁だけが、強く光る
    float e = vEdge.x;
    c = mix(c, uEdge, smoothstep(0.5, 0.7, e) * (1.0 - smoothstep(0.7, 0.86, e)) * 0.55);
    c = mix(c, uEdgeLit * (uWarm * (0.15 + 1.8 * broad) + glow * 1.2), smoothstep(0.8, 0.95, e));
  }
  o = vec4(toScreen(c, frag), 1.0);
}`;

// テーブルの上の、小さなもの：ガラスのかけら（0）、水の跡（1）、穴から吹き込む雨（2）
const BIT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aAt; // xy: 場所（面の中の 0〜1）, z: 大きさ（px）, w: 向き
layout(location = 2) in vec4 aLook; // x: 種類, y: 種, z: 濃さ, w: つぶれ（テーブルに寝ているものは、縦につぶれて見える）
uniform vec2 uRes;
uniform float uPx;
out vec2 vAt;
flat out vec4 vLook;
void main() {
  float c = cos(aAt.w);
  float s = sin(aAt.w);
  vec2 r = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c) * aAt.z * uPx;
  r.y *= aLook.w;
  vAt = aCorner;
  vLook = aLook;
  gl_Position = vec4((aAt.xy * uRes + r) / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const BIT_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uEdgeLit, uWarm, uGlow;
uniform float uCellPx, uFlick;
in vec2 vAt;
flat in vec4 vLook;
out vec4 o;
${ROOM}
void main() {
  // 手前の物（鉢、本、カップ）の向こうにある
  float kind = roomAt(gl_FragCoord.xy).a;
  if (kind > 0.25 && kind < 0.75) discard;
  vec3 light = uWarm * 0.7 + uGlow;
  if (vLook.x < 0.5) {
    // かけら：三角。縁が光り、ランタンの炎が揺らぐと、ところどころがきらめく
    float a = vLook.y * 6.2832;
    float d = max(max(dot(vAt, vec2(cos(a), sin(a))), dot(vAt, vec2(cos(a + 2.2), sin(a + 2.2)))), dot(vAt, vec2(cos(a + 4.3), sin(a + 4.3)))) - 0.42;
    float inside = 1.0 - smoothstep(-0.05, 0.05, d);
    float rim = smoothstep(-0.2, -0.04, d) * inside;
    float glint = pow(0.5 + 0.5 * sin(vLook.y * 43.0 + uFlick * 38.0), 9.0);
    float alpha = inside * (0.16 + 0.6 * rim + 0.8 * glint) * vLook.z;
    o = vec4(uEdgeLit * light * (0.5 + 1.6 * glint) * alpha, alpha * 0.6);
  } else if (vLook.x < 1.5) {
    // 水の跡：天板が少し暗くなり、上の縁に小さな光
    float d = length(vAt);
    float inside = 1.0 - smoothstep(0.8, 1.0, d);
    float spark = exp(-dot(vAt - vec2(-0.25, 0.4), vAt - vec2(-0.25, 0.4)) / 0.05);
    o = vec4(light * spark * 0.5 * inside * vLook.z, inside * 0.3 * vLook.z);
  } else {
    // 吹き込む雨：細い筋。先（下）が明るく、後ろへ、うすく尾を引く
    float alpha = (1.0 - smoothstep(0.015, 0.06, abs(vAt.x))) * (1.0 - smoothstep(-0.7, 1.0, vAt.y)) * smoothstep(-1.0, -0.85, vAt.y) * vLook.z;
    o = vec4((uEdgeLit * 0.45 + light * 0.35) * alpha, alpha * 0.25);
  }
}`;

// ---- 形の計算
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// 点から多角形までの距離（中なら 0）。横を aspect 倍して、画面の上での長さで測る
function distToPoly(px, py, poly, aspect) {
  if (pointInPoly(px, py, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = (poly[j][0] - px) * aspect;
    const ay = poly[j][1] - py;
    const ex = (poly[i][0] - poly[j][0]) * aspect;
    const ey = poly[i][1] - poly[j][1];
    const t = clamp(-(ax * ex + ay * ey) / Math.max(ex * ex + ey * ey, 1e-12));
    best = Math.min(best, Math.hypot(ax + ex * t, ay + ey * t));
  }
  return best;
}

// 左回りの多角形を三角に分ける（耳を1つずつ切り落とす）。頂点の番号を3つずつ返す
function triangulate(pts) {
  const out = [];
  if (pts.length < 3) return out;
  const idx = pts.map((_, i) => i);
  const cross = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const same = (a, b) => pts[a][0] === pts[b][0] && pts[a][1] === pts[b][1];
  let guard = pts.length * pts.length + 16;
  while (idx.length > 3 && guard-- > 0) {
    const n = idx.length;
    let cut = -1;
    let flat = 0;
    let least = Infinity;
    for (let i = 0; i < n && cut < 0; i++) {
      const a = idx[(i + n - 1) % n];
      const b = idx[i];
      const c = idx[(i + 1) % n];
      const turn = cross(a, b, c);
      if (Math.abs(turn) < least) {
        least = Math.abs(turn);
        flat = i;
      }
      if (turn <= 1e-14) continue; // へこんだ角は、耳ではない
      let clear = true;
      for (const p of idx) {
        if (p === a || p === b || p === c || same(p, a) || same(p, b) || same(p, c)) continue;
        if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) {
          clear = false;
          break;
        }
      }
      if (clear) cut = i;
    }
    if (cut < 0) cut = flat; // 形が崩れていて耳がない：いちばん平らな角を落として進む
    const a = idx[(cut + n - 1) % n];
    const c = idx[(cut + 1) % n];
    if (cross(a, idx[cut], c) > 0) out.push(a, idx[cut], c);
    idx.splice(cut, 1);
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

// ---- ガラスの面：ひびを「点と辺のグラフ」で持つ。座標は面の中の 0〜1（左下が原点）
const RADIAL = 0;
const RING = 1;
const FRAME = 2;
const SNAP = 0.004; // これより近い点は、同じ点として扱う

function createGlass() {
  const C = TUNE.crack;
  // x, y：点。edges：辺。hits：叩いた点。frost：叩いた点の欠け。faces：辺に囲まれた領域（破片と穴）
  const g = { x: [], y: [], edges: [], hits: [], frost: [], faces: [], holeArea: 0 };

  const addNode = (x, y) => {
    g.x.push(x);
    g.y.push(y);
    return g.x.length - 1;
  };
  // 辺：a から b。w は太さ、t は生まれた時刻、s は光り方の種。vl と vr は、左と右がもう穴かどうか
  const addEdge = (a, b, kind, wa, wb, ta, tb, sa, sb) => {
    g.edges.push({ a, b, kind, wa, wb, ta, tb, sa, sb, vl: false, vr: false, live: true });
  };

  const reset = () => {
    g.x.length = 0;
    g.y.length = 0;
    g.edges.length = 0;
    g.hits.length = 0;
    g.frost.length = 0;
    g.faces = [];
    g.holeArea = 0;
    // 枠の四隅と四辺（左回り。左側が面の内）
    addNode(0, 0);
    addNode(1, 0);
    addNode(1, 1);
    addNode(0, 1);
    for (let i = 0; i < 4; i++) addEdge(i, (i + 1) % 4, FRAME, 0, 0, 0, 0, 0, 0);
  };

  const linked = (a, b) => g.edges.some((e) => e.live && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));

  // p から q へ進んで、最初にぶつかる辺。出発の点（と、着く先の点）につながる辺は数えない
  const firstHit = (px, py, qx, qy, skip, skipEnd) => {
    const dx = qx - px;
    const dy = qy - py;
    let best = null;
    let bt = 1 + 1e-9;
    for (let i = 0; i < g.edges.length; i++) {
      const e = g.edges[i];
      if (!e.live || e.a === skip || e.b === skip || e.a === skipEnd || e.b === skipEnd) continue;
      const ax = g.x[e.a];
      const ay = g.y[e.a];
      const ex = g.x[e.b] - ax;
      const ey = g.y[e.b] - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14) continue;
      const t = ((ax - px) * ey - (ay - py) * ex) / den;
      if (t <= 1e-6 || t >= bt) continue;
      const u = ((ax - px) * dy - (ay - py) * dx) / den;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      bt = t;
      best = { t, i, u: clamp(u) };
    }
    return best;
  };

  // 辺を、途中の点で2つに分ける。端のすぐ近くなら、端の点をそのまま返す
  const splitAt = (i, u) => {
    const e = g.edges[i];
    const len = Math.hypot(g.x[e.b] - g.x[e.a], g.y[e.b] - g.y[e.a]);
    if (u * len < SNAP) return e.a;
    if ((1 - u) * len < SNAP) return e.b;
    const n = addNode(mix(g.x[e.a], g.x[e.b], u), mix(g.y[e.a], g.y[e.b], u));
    const w = mix(e.wa, e.wb, u);
    const t = mix(e.ta, e.tb, u);
    const s = mix(e.sa, e.sb, u);
    g.edges.push({ ...e, a: n, wa: w, ta: t, sa: s });
    e.b = n;
    e.wb = w;
    e.tb = t;
    e.sb = s;
    return n;
  };

  // 点 from から (qx, qy) へ、ひびを1本引く。すでにあるひびにぶつかったら、そこで止まる（ひびは、ひびを越えない）
  const draw = (from, qx, qy, kind, wa, wb, ta, tb, sa, sb, end = -1) => {
    const hit = firstHit(g.x[from], g.y[from], qx, qy, from, end);
    const f = hit ? hit.t : 1;
    const to = hit ? splitAt(hit.i, hit.u) : end >= 0 ? end : addNode(qx, qy);
    if (to !== from && !linked(from, to)) addEdge(from, to, kind, wa, mix(wa, wb, f), ta, mix(ta, tb, f), sa, sb);
    return { node: to, stopped: hit !== null };
  };

  // 面を数え直す。辺の両側をたどって、左回りに閉じた輪を、1つの面にする
  const computeFaces = () => {
    const E = g.edges;
    const out = new Array(g.x.length);
    for (let i = 0; i < E.length; i++) {
      if (!E[i].live) continue;
      (out[E[i].a] ||= []).push(i * 2);
      (out[E[i].b] ||= []).push(i * 2 + 1);
    }
    const from = (h) => (h & 1 ? E[h >> 1].b : E[h >> 1].a);
    const to = (h) => (h & 1 ? E[h >> 1].a : E[h >> 1].b);
    const slot = new Int32Array(E.length * 2);
    for (const list of out) {
      if (!list) continue;
      const keyed = list.map((h) => [Math.atan2(g.y[to(h)] - g.y[from(h)], g.x[to(h)] - g.x[from(h)]), h]).sort((p, q) => p[0] - q[0]);
      for (let k = 0; k < keyed.length; k++) {
        list[k] = keyed[k][1];
        slot[list[k]] = k;
      }
    }
    const seen = new Uint8Array(E.length * 2);
    const faces = [];
    let holeArea = 0;
    for (let start = 0; start < E.length * 2; start++) {
      if (seen[start] || !E[start >> 1].live) continue;
      const hs = [];
      let h = start;
      let guard = E.length * 2 + 4;
      do {
        seen[h] = 1;
        hs.push(h);
        const list = out[to(h)];
        h = list[(slot[h ^ 1] + list.length - 1) % list.length];
      } while (h !== start && guard-- > 0);
      let area = 0;
      for (const k of hs) area += g.x[from(k)] * g.y[to(k)] - g.x[to(k)] * g.y[from(k)];
      area *= 0.5;
      if (area <= 1e-9) continue; // 外まわり、または面積のない輪

      // とげ（行って戻るだけのひび）を落として、輪郭だけにする
      const loop = [];
      for (const k of hs) {
        const id = from(k);
        if (loop.length >= 2 && loop[loop.length - 2] === id) loop.pop();
        else loop.push(id);
      }
      let lo = 0;
      let hi = loop.length - 1;
      while (hi - lo >= 2) {
        if (loop[hi] === loop[lo + 1]) {
          lo += 1;
          hi -= 1;
        } else if (loop[hi - 1] === loop[lo]) {
          hi -= 2;
        } else break;
      }
      const poly = [];
      for (let k = lo; k <= hi; k++) poly.push([g.x[loop[k]], g.y[loop[k]]]);
      if (poly.length < 3) continue;

      let held = false;
      let hole = false;
      let around = 0;
      let gone = 0;
      let born = -Infinity;
      for (const k of hs) {
        const e = E[k >> 1];
        if (e.kind === FRAME) held = true;
        if (k & 1 ? e.vr : e.vl) hole = true;
        const len = Math.hypot(g.x[e.b] - g.x[e.a], g.y[e.b] - g.y[e.a]);
        around += len;
        if (k & 1 ? e.vl : e.vr) gone += len;
        born = Math.max(born, e.ta, e.tb);
      }
      let cx = 0;
      let cy = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const c = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
        cx += (poly[j][0] + poly[i][0]) * c;
        cy += (poly[j][1] + poly[i][1]) * c;
      }
      if (hole) holeArea += area;
      faces.push({ hs, poly, area, cx: cx / (6 * area), cy: cy / (6 * area), held, hole, hang: around > 0 ? gone / around : 0, born, tris: null });
    }
    faces.sort((p, q) => q.area - p.area);
    g.faces = faces;
    g.holeArea = holeArea;
  };

  const trisOf = (face) => (face.tris ||= triangulate(face.poly));

  // 面の中に確かにある点（いちばん大きい三角の重心）
  const innerPoint = (face) => {
    const tris = trisOf(face);
    const p = face.poly;
    let best = [face.cx, face.cy];
    let most = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const a = p[tris[i]];
      const b = p[tris[i + 1]];
      const c = p[tris[i + 2]];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (area > most) {
        most = area;
        best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      }
    }
    return best;
  };

  // その点を含む、いちばん小さい面
  const faceAt = (x, y) => {
    for (let i = g.faces.length - 1; i >= 0; i--) if (pointInPoly(x, y, g.faces[i].poly)) return g.faces[i];
    return null;
  };

  // 叩く。放射のひび、輪のひび、中心の短いひび、小枝を足す。穴の中なら何も起きない（null）
  const strike = (u, v, aspect, now, rand) => {
    if (g.faces.some((f) => f.hole && pointInPoly(u, v, f.poly))) return null;
    const R = mix(C.reach[0], C.reach[1], rand()) * Math.min(aspect, 1);
    g.hits.push({ x: u, y: v, reach: R * C.grip });
    if (g.hits.length > 160) g.hits.shift();
    g.frost.push({ x: u, y: v, w: mix(C.chip[0], C.chip[1], rand()), t: now, turn: rand(), seed: rand() });
    const ticks = [];
    let last = now;
    let count = 0;
    for (const e of g.edges) if (e.live) count += 1;
    if (count > C.maxEdges) return { ticks, last };

    // 叩いた点。すでにある点や辺のすぐ近くなら、そこに重ねる
    let center = -1;
    let near = SNAP;
    for (let i = 0; i < g.x.length; i++) {
      const d = Math.hypot((g.x[i] - u) * aspect, g.y[i] - v);
      if (d < near) {
        near = d;
        center = i;
      }
    }
    if (center < 0) {
      let on = -1;
      let at = 0;
      near = SNAP;
      for (let i = 0; i < g.edges.length; i++) {
        const e = g.edges[i];
        if (!e.live) continue;
        const ex = (g.x[e.b] - g.x[e.a]) * aspect;
        const ey = g.y[e.b] - g.y[e.a];
        const px = (u - g.x[e.a]) * aspect;
        const py = v - g.y[e.a];
        const t = clamp((px * ex + py * ey) / Math.max(ex * ex + ey * ey, 1e-12));
        const d = Math.hypot(px - ex * t, py - ey * t);
        if (d < near) {
          near = d;
          on = i;
          at = t;
        }
      }
      center = on >= 0 ? splitAt(on, at) : addNode(u, v);
    }
    const cx = g.x[center];
    const cy = g.y[center];
    const step = (angle, length) => [(Math.cos(angle) * length) / aspect, Math.sin(angle) * length];
    const timeAt = (rho) => now + C.run * Math.pow(rho / R, C.ease);
    const bornAt = new Map([[center, now]]);

    // 放射のひび
    const n = Math.round(mix(C.radials[0], C.radials[1], rand()));
    const base = rand() * TAU;
    const pick = (range) => {
      const set = new Set();
      const want = Math.min(n, Math.round(mix(range[0], range[1], rand())));
      while (set.size < want) set.add(Math.floor(rand() * n));
      return set;
    };
    const runners = pick(C.runners);
    const creepers = pick(C.creep);
    const arms = [];
    for (let i = 0; i < n; i++) {
      const angle = base + ((i + (rand() - 0.5) * 0.84) / n) * TAU;
      const runner = runners.has(i);
      const length = R * (runner ? mix(C.runnerLength[0], C.runnerLength[1], rand()) : mix(C.length[0], C.length[1], rand()));
      // 節：輪のひびがつながる半径と、その先
      const stops = [];
      for (let k = 0; k < C.rings.length; k++) {
        const rho = C.rings[k] * R * (1 + (rand() - 0.5) * 2 * C.ringJitter);
        if (rho < length * 0.97) stops.push({ rho, ring: k });
      }
      let rho = stops.length ? stops[stops.length - 1].rho : 0;
      while (rho < length - 0.02 * R) {
        rho = Math.min(length, rho + R * mix(0.16, 0.3, rand()));
        stops.push({ rho, ring: -1 });
      }
      const creeps = creepers.has(i);
      const creepFrom = creeps ? length * mix(0.55, 0.8, rand()) : Infinity;
      let creepTime = creeps ? mix(C.creepWithin[0], C.creepWithin[1], Math.pow(rand(), 1.4)) : 0;
      const arm = { angle, ring: new Array(C.rings.length).fill(-1) };
      let head = angle;
      let node = center;
      let px = cx;
      let py = cy;
      let before = 0;
      let w0 = C.width;
      let t0 = now;
      let s0 = rand();
      for (const stop of stops) {
        head += (rand() - 0.5) * 2 * C.kink * (stop.rho > R ? 1.7 : 1);
        const d = step(head, stop.rho - before);
        const qx = px + d[0];
        const qy = py + d[1];
        const w1 = mix(C.width, C.tip, Math.pow(stop.rho / length, 0.75));
        let t1 = timeAt(stop.rho);
        if (stop.rho > creepFrom) {
          // あとから伸びる：少し止まってから、小さく跳ぶ
          creepTime = Math.max(creepTime, t0 - now + 0.04);
          t1 = now + creepTime;
          ticks.push(creepTime);
          creepTime += mix(0.05, 0.22, rand());
        }
        const s1 = rand();
        const made = draw(node, qx, qy, RADIAL, w0, w1, t0, t1, s0, s1);
        last = Math.max(last, t1);
        if (made.stopped) break;
        node = made.node;
        bornAt.set(node, t1);
        if (stop.ring >= 0) arm.ring[stop.ring] = node;
        // 小枝：浅い角度で分かれる、短いひび
        if (stop.rho > 0.2 * R && rand() < C.twig) {
          const turn = (rand() < 0.5 ? -1 : 1) * mix(0.35, 0.8, rand());
          const twig = step(head + turn, R * mix(0.04, 0.13, rand()) * (runner && stop.rho > R ? 2.2 : 1));
          draw(node, qx + twig[0], qy + twig[1], RADIAL, w1 * 0.6, C.tip * 0.8, t1 + 0.01, t1 + 0.05, s1, rand());
        }
        px = qx;
        py = qy;
        before = stop.rho;
        w0 = w1;
        t0 = t1;
        s0 = s1;
      }
      arms.push(arm);
    }

    // 輪のひび：隣り合う放射のひびを、同じ段の節どうしでつなぐ
    for (let k = 0; k < C.rings.length; k++) {
      for (let i = 0; i < n; i++) {
        const a = arms[i].ring[k];
        const b = arms[(i + 1) % n].ring[k];
        if (a < 0 || b < 0 || a === b) continue;
        const roll = rand();
        const w = C.width * C.ringWidth * mix(1, 0.55, k / C.rings.length);
        const t = Math.max(bornAt.get(a), bornAt.get(b)) + 0.008 * (k + 1);
        if (roll < C.ringChance[k]) {
          const made = draw(a, g.x[b], g.y[b], RING, w, w * 0.8, t, t + 0.02, rand(), rand(), b);
          if (made.stopped) draw(b, g.x[a], g.y[a], RING, w, w * 0.8, t, t + 0.02, rand(), rand(), a);
        } else if (roll < C.ringChance[k] + 0.25) {
          // つながりきらない、途中までのひび
          const f = mix(0.3, 0.6, rand());
          draw(a, mix(g.x[a], g.x[b], f), mix(g.y[a], g.y[b], f), RING, w, C.tip, t, t + 0.02, rand(), rand());
        }
        last = Math.max(last, t + 0.02);
      }
    }

    // 中心だけの短いひび：放射のひびの間に入り、輪のひびで止まる
    const shorts = Math.round(mix(C.shorts[0], C.shorts[1], rand()));
    for (let i = 0; i < shorts; i++) {
      const at = Math.floor(rand() * n);
      const gap = (arms[(at + 1) % n].angle - arms[at].angle + TAU) % TAU;
      const length = R * mix(0.04, 0.24, rand() * rand());
      const d = step(arms[at].angle + gap * mix(0.2, 0.8, rand()), length);
      draw(center, cx + d[0], cy + d[1], RADIAL, C.width * 0.8, C.tip, now, timeAt(length), rand(), rand());
    }

    computeFaces();
    return { ticks, last };
  };

  // 叩かれた力の合計。叩いた点から離れるほど弱い
  const loadOf = (face, aspect) => {
    let sum = 0;
    for (const h of g.hits) sum += Math.max(0, 1 - distToPoly(h.x, h.y, face.poly, aspect) / h.reach);
    return sum;
  };

  // 外れる破片：ひびに囲まれていて（枠に触れていない）、近くを何度か叩かれたか、周りが穴になって支えを失ったもの
  const loose = (aspect) => g.faces.filter((f) => !f.hole && !f.held && (f.hang >= C.hang || loadOf(f, aspect) >= C.hold));

  // 破片を外す。面の輪郭に「こちら側は穴」と印を付け、両側が穴になった辺と、破片の中にあった辺を消す
  const release = (face) => {
    const E = g.edges;
    const own = new Set();
    for (const h of face.hs) {
      const e = E[h >> 1];
      own.add(h >> 1);
      if (h & 1) e.vr = true;
      else e.vl = true;
    }
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e.live || e.kind === FRAME) continue;
      if (e.vl && e.vr) e.live = false;
      else if (!own.has(i) && pointInPoly((g.x[e.a] + g.x[e.b]) / 2, (g.y[e.a] + g.y[e.b]) / 2, face.poly)) e.live = false;
    }
    g.frost = g.frost.filter((f) => !pointInPoly(f.x, f.y, face.poly));
    computeFaces();
  };

  // 描くためのデータ。ひびの線：辺ごとに [両端 4, 太さ 2, 時刻 2, 種 2]
  const crackData = () => {
    const out = [];
    for (const e of g.edges) {
      if (!e.live || e.kind === FRAME) continue;
      out.push(g.x[e.a], g.y[e.a], g.x[e.b], g.y[e.b], e.wa, e.wb, e.ta, e.tb, e.sa, e.sb);
    }
    // 叩いた点の欠け（種の x を 2 以上にして、線と区別する。小数は、欠けの向き）
    for (const f of g.frost) out.push(f.x, f.y, f.x, f.y, f.w, f.w, f.t, f.t, 2 + f.turn * 0.999, f.seed);
    return new Float32Array(out);
  };

  // 破片の地図：三角ごとに [位置 2, 傾き 2, 穴 1, 映り込みのばらつき 1]。小さい破片ほど、大きく傾く
  const cellData = (aspect) => {
    const out = [];
    for (const face of g.faces) {
      const amount = face.hole ? 0 : Math.max(1 - smoothstep(0.003, 0.045, face.area * aspect), face.held ? 0 : Math.min(1, face.hang * 4));
      if (!face.hole && amount <= 0) continue;
      const r = dice(Math.floor(face.cx * 4096) * 7919 + Math.floor(face.cy * 4096) * 104729 + 13);
      const turn = r() * TAU;
      const lean = Math.sqrt(r()) * amount;
      const data = face.hole ? [0.5, 0.5, 1, 0.5] : [0.5 + 0.5 * Math.cos(turn) * lean, 0.5 + 0.5 * Math.sin(turn) * lean, 0, r()];
      for (const i of trisOf(face)) out.push(face.poly[i][0], face.poly[i][1], data[0], data[1], data[2], data[3]);
    }
    return new Float32Array(out);
  };

  reset();
  return { g, reset, strike, loose, release, faceAt, innerPoint, crackData, cellData };
}

// 落ちる破片の形：厚みのある板。表と裏の面、縁の光る帯、側面（割れた断面）
function shardMesh(poly, aspect, thick, bevel) {
  const n = poly.length;
  const pts = poly.map(([x, y]) => [(x - 0.5) * aspect, y - 0.5]);
  let area = 0;
  let cx = 0;
  let cy = 0;
  let around = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const c = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    area += c;
    cx += (pts[j][0] + pts[i][0]) * c;
    cy += (pts[j][1] + pts[i][1]) * c;
    around += Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
  }
  area *= 0.5;
  cx /= 6 * area;
  cy /= 6 * area;
  const rim = pts.map(([x, y]) => [x - cx, y - cy]);
  // 縁の帯の内側の輪。左回りの輪郭では、進む向きの左が内
  const inset = Math.min(bevel, (0.45 * 2 * area) / around);
  const unit = (x, y) => {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const inner = rim.map((p, i) => {
    const a = rim[(i + n - 1) % n];
    const b = rim[(i + 1) % n];
    const e1 = unit(p[0] - a[0], p[1] - a[1]);
    const e2 = unit(b[0] - p[0], b[1] - p[1]);
    const den = Math.max(1 + e1[0] * e2[0] + e1[1] * e2[1], 0.3);
    return [p[0] + ((-e1[1] - e2[1]) / den) * inset, p[1] + ((e1[0] + e2[0]) / den) * inset];
  });
  const tris = triangulate(inner);
  const out = [];
  const z = thick / 2;
  let reach = 0;
  for (const p of rim) reach = Math.max(reach, Math.hypot(p[0], p[1]));
  for (const side of [1, -1]) {
    const face = (p, edge) => out.push(p[0], p[1], z * side, 0, 0, side, edge, 0);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face(rim[i], 1);
      face(rim[j], 1);
      face(inner[j], 0);
      face(rim[i], 1);
      face(inner[j], 0);
      face(inner[i], 0);
    }
    for (const i of tris) face(inner[i], 0);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const e = unit(rim[j][0] - rim[i][0], rim[j][1] - rim[i][1]);
    const wall = (p, depth) => out.push(p[0], p[1], depth, e[1], -e[0], 0, depth > 0 ? 1 : 0, 1);
    wall(rim[i], z);
    wall(rim[j], z);
    wall(rim[j], -z);
    wall(rim[i], z);
    wall(rim[j], -z);
    wall(rim[i], -z);
  }
  return { data: new Float32Array(out), count: out.length / 8, cx, cy, area, reach };
}

// ---- ドット絵：窓の外の街と、手前の店内。色は番号で持ち、中間の色を作らない
// 色の番号：8つの色み × 6つの明るさ（0 がいちばん暗い）。その後に、空の4色
const WARM = 0; // --_bg：ランタン、窓の明かり、紙
const TEAL = 1; // --_surface：ネオン、ガラスの器
const DARK = 2; // --_fg：影、鉄
const COOL = 3; // --_muted：夜の空、瓦、ぬれた路面
const NEON = 4; // --_accent：ネオン、日よけ
const WOOD = 5; // --_bg と --_accent の間：木
const LEAF = 6; // --_surface と --_bg の間：葉
const PLUM = 7; // --_accent と --_muted の間：石の壁、紫のネオン
const SKY = 48;
const SPARK = 52; // つやの点（白に近い、暖かい色）
const BLACK = 53; // いちばん暗い縁と、落ちる影（紫に寄せた黒）
const CREAM = 54; // 白い物（焼き物、紙）の、ふつうの面
const TAN = 55; // 白い物の、影の面
const INKS = 56;
const SHADES = [0.006, 0.02, 0.055, 0.14, 0.36, 0.8]; // 6つの明るさ（輝度）
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 2色を混ぜるための、4×4 の並び
const ink = (family, level) => family * 6 + level;

function createScene() {
  const C = TUNE.city;
  const lut = new Uint8Array(INKS * 4);
  const lut32 = new Uint32Array(lut.buffer);
  let city32 = null;
  let room32 = null;
  const at = {}; // 配置（マス目の数で）
  let cw = 0;
  let ch = 0;
  let k = 1; // 店内の物の大きさ
  let kc = 1; // 街の物の大きさ
  let rand = dice(1);
  let cityBase = null;
  let cityNow = null;
  let cityOut = null;
  let roomBase = null;
  let roomNow = null;
  let roomKind = null; // 0：窓のガラスの所、1：壁・枠・テーブル、2：手前の物
  let kindNow = null;
  let roomOut = null;
  let time = 0;
  let tickNo = 0;
  let curb = 0;
  let base = 0;
  let shops = [];
  let lamps = [];
  let signs = [];
  let glints = []; // ぬれた路面と、テーブルに映る明かり（街灯とネオンの、場所と色）
  let walkers = [];
  let nextWalker = 0.5;
  let sinceFriend = 2;
  let pageAt = -1; // 本のページがめくれ始めた時刻
  let puffAt = -100; // カップに触った時刻（湯気が増える）
  let ripples = []; // 路面の、雨の輪
  let lampLayer = null; // ランタンと鎖だけの絵（揺らして重ねる。255 は、何もない所）
  let lampPos = 0; // ランタンの振れ（マス）と、その速さ
  let lampVel = 0;
  let leafJolt = { at: -100, amp: 0 }; // 葉が揺れ始めた時刻と、強さ
  let wind = 0; // 穴から入る風（0〜1）と、その行き先
  let windGoal = 0;
  let vaseAt = -100; // 花びんに触った時刻
  let bellAt = -100; // 置き時計に触った時刻
  let auto = null; // 通りを走っている車
  let petals = []; // 散った花びら
  let catAway = -100; // 窓辺の猫が隠れた時刻
  let stacks = []; // 煙突の口
  let beacon = null; // 遠くの塔の、赤い明かり
  const book = { W: 0 }; // 開いた本の場所と大きさ

  // 描く先。kinds があれば、物の種類も一緒に書く
  let buf = null;
  let kinds = null;
  let kind = 1;
  const put = (x, y, c) => {
    if (x < 0 || x >= cw || y < 0 || y >= ch) return;
    buf[y * cw + x] = c;
    if (kinds) kinds[y * cw + x] = kind;
  };
  const box = (x, y, w, h, c) => {
    for (let j = Math.max(0, y); j < Math.min(ch, y + h); j++) for (let i = Math.max(0, x); i < Math.min(cw, x + w); i++) put(i, j, c);
  };
  const oval = (cx, cy, rx, ry, c) => {
    for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) if ((i * i) / (rx * rx + 0.4) + (j * j) / (ry * ry + 0.4) <= 1) put(cx + i, cy + j, c);
  };
  const line = (x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) put(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  };
  // 2色を混ぜる。t が大きいほど b が多い
  const mixed = (x, y, a, b, t) => (t * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5 ? b : a);
  const S = (n) => Math.max(1, Math.round(n * k));
  const Z = (n) => Math.max(1, Math.round(n * kc));
  const between = (a, b) => a + rand() * (b - a);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const level = (c) => (c >= SKY ? 0 : c % 6);

  // ---------------------------------------------------------------- 配置
  // 横長：見本のとおり。左に窓、右に壁とランタン。縦長・小さい枠：窓を中心に切り取り、上にランタン、下にカップ
  const layout = (aspect) => {
    const wide = aspect >= 1.3;
    at.wide = wide;
    k = wide ? clamp(ch / 200, 0.5, 3.2) : clamp(cw / 190, 0.42, 2.4);
    at.counter = Math.round(ch * (wide ? 0.165 : 0.15));
    const side = Math.max(3, wide ? Math.round(cw * 0.039) : S(11));
    const sill = Math.max(3, Math.round(ch * (wide ? 0.052 : 0.03)));
    const head = Math.max(3, Math.round(ch * (wide ? 0.05 : 0.028)));
    at.fx0 = wide ? Math.round(cw * 0.024) : 1;
    at.fx1 = wide ? Math.round(cw * 0.8) : cw - 1;
    at.fy0 = at.counter;
    at.fy1 = ch - Math.round(ch * (wide ? 0.02 : 0.2));
    at.gx0 = at.fx0 + side;
    at.gx1 = at.fx1 - side;
    at.gy0 = at.fy0 + sill;
    at.gy1 = at.fy1 - head;
    at.lampW = S(28);
    at.lampH = S(46);
    at.lampX = wide ? Math.round(cw * 0.865) : cw - Math.round(at.lampW * 0.5) - S(7);
    at.lampY = wide ? Math.round(ch * 0.8) : ch - S(9) - Math.round(at.lampH / 2);
    at.cupX = Math.round(cw * (wide ? 0.685 : 0.72));
    at.bookX = Math.round(cw * (wide ? 0.455 : 0.42));
    at.potX = Math.round(cw * 0.08);
    kc = clamp((at.gy1 - at.gy0) / 142, 0.45, 3.6);
    curb = at.gy0 + Math.round((at.gy1 - at.gy0) * 0.235);
    base = curb + Z(5);
  };

  // ---------------------------------------------------------------- 窓の外の街
  // 瓦屋根の店。1階は明かりのついた大きな窓と日よけ、2階は小さな窓
  const shop = (x, w, tall, style) => {
    const ground = Z(23);
    const wall = pick([ink(PLUM, 1), ink(COOL, 1), ink(PLUM, 1)]);
    box(x, base, w, tall, wall);
    // 石の目：段ごとに半分ずらして積んだ石。ところどころ、明るい石
    const course = Math.max(3, Z(3));
    for (let j = 0; j < tall; j++) {
      const rowNo = Math.floor(j / course);
      for (let i = 0; i < w; i++) {
        const along = i + (rowNo & 1 ? course : 0);
        if (j % course === 0 || along % (course * 2) === 0) put(x + i, base + j, wall - 1);
        else if ((Math.floor(along / (course * 2)) * 7 + rowNo * 13) % 9 === 0) put(x + i, base + j, wall + 1);
      }
    }
    box(x + w - Z(2), base, Z(2), tall, wall - 1);
    // 雨どい：屋根から足元へ、細い管。ところどころに、留め金
    const pipe = x + w - Z(2) - 1;
    box(pipe, base, 1, tall, ink(COOL, 2));
    for (let j = Z(7); j < tall; j += Z(14)) box(pipe - 1, base + j, 3, 1, ink(COOL, 3));
    // つた：角から、壁をはい上がる。角から遠いほど、上ほど、まばら（まん中の店には、ない）
    if (style !== 1) {
      for (let n = Z(style ? 80 : 170); n > 0; n--) {
        const up = rand();
        const out = Math.round(rand() * rand() * (1 - up * 0.55) * w * 0.36);
        put(style ? x + w - Z(3) - out : x + out, base + ground + Z(1) + Math.round(up * (tall - ground - Z(2))), ink(LEAF, 1 + Math.floor(rand() * 3)));
      }
    }
    // 1階の窓：つり下げた明かりのまわりが、いちばん明るい。足元は、少し暗い
    const wx = x + Z(3);
    const ww = w - Z(12);
    const wy = base + Z(3);
    const wh = ground - Z(8);
    const bulbY = wy + wh - Z(6);
    const bulbs = [];
    for (let at2 = wx + Z(7); at2 < wx + ww - Z(4); at2 += Z(12)) bulbs.push(at2);
    for (let j = 0; j < wh; j++) {
      for (let i = 0; i < ww; i++) {
        let near = 9;
        for (const b of bulbs) near = Math.min(near, Math.hypot(wx + i - b, (wy + j - bulbY) * 1.15) / Z(6));
        put(wx + i, wy + j, near < 0.5 ? ink(WARM, 5) : near < 1 ? mixed(wx + i, wy + j, ink(WARM, 5), ink(WARM, 4), (near - 0.5) * 2) : j < Z(2) ? ink(WOOD, 4) : ink(WARM, 4));
      }
    }
    for (const b of bulbs) {
      box(b, bulbY + 1, 1, wy + wh - bulbY - 1, ink(WOOD, 2));
      box(b - 1, bulbY - 1, 3, 2, SPARK);
    }
    for (let i = 0; i <= ww; i += Math.max(4, Z(9))) box(wx + i, wy, 1, wh, ink(DARK, 1));
    box(wx, wy + wh - Z(4), ww, 1, ink(DARK, 1));
    box(wx - 1, wy - 1, ww + 2, 1, ink(DARK, 1));
    // 窓ぎわの棚に、品物が並ぶ（びん、箱、小さな鉢）
    for (let i = 2; i < ww - 2; i += Z(2) + 1) {
      const high = 1 + Math.floor(rand() * Z(2.4));
      if (rand() < 0.7) box(wx + i, wy, Math.max(1, Z(1.2)), high, pick([ink(WOOD, 2), ink(WOOD, 3), ink(NEON, 3), ink(TEAL, 3), ink(DARK, 2)]));
    }
    // 戸：ガラスに桟、真ちゅうの取っ手、足元に踏み段
    const dx = x + w - Z(8);
    box(dx, base, Z(5), ground - Z(5), ink(DARK, 1));
    box(dx + 1, base + Z(4), Z(5) - 2, ground - Z(11), ink(WARM, 4));
    box(dx + 1, base + Z(4) + ((ground - Z(11)) >> 1), Z(5) - 2, 1, ink(DARK, 1));
    put(dx + 1, base + Z(2), ink(WARM, 5));
    box(dx - 1, base, Z(5) + 2, 1, ink(COOL, 3));
    // 中の人の影は、後から動かして描く
    const guests = [];
    const seats = Math.max(2, Math.round(ww / Z(9)));
    for (let n = 0; n < seats; n++) if (rand() < 0.8) guests.push({ x: wx + Math.round(((n + 0.5) * ww) / seats + between(-1.5, 1.5) * kc), tall: Z(between(5.5, 8)), next: between(1, 9), lean: 0 });
    // 日よけ
    const ay = base + ground - Z(4);
    shops.push({ wx, wy, ww, wh, guests, ax: x - Z(2), aw: w + Z(3), ay });
    const stripe = style === 0 ? [ink(NEON, 3), ink(WARM, 5)] : style === 1 ? [ink(COOL, 2), ink(COOL, 3)] : [ink(PLUM, 3), ink(PLUM, 4)];
    for (let j = 0; j < Z(5); j++) for (let i = -Z(2) - j; i < w + Z(1) + j; i++) put(x + i, ay + Z(5) - 1 - j + (j === 0 && (i & 3) === 0 ? -1 : 0), stripe[(Math.floor((i + 64) / Math.max(2, Z(3))) & 1) === 0 ? 0 : 1]);
    box(x - Z(2), ay + Z(5), w + Z(3), 1, stripe[0] - 1);
    // 2階：よろい戸のある窓。中にカーテン。窓の下に、花の箱。窓の間に、店の絵の札
    const uy = base + ground + Z(4);
    const count = Math.max(1, Math.round(w / Z(22)));
    const uw = Z(10);
    const uh = Math.min(Z(11), tall - ground - Z(8));
    const flap = Z(3);
    const spare = w / count - uw - 2 * flap - 4; // 窓とよろい戸の、外に残る幅
    const cloth = [NEON, TEAL, PLUM][style];
    for (let n = 0; n < count && uh >= 3; n++) {
      const ux = x + Math.round(((n + 0.5) * w) / count) - (uw >> 1);
      const lit = count < 2 || style < 2 || n < count - 1; // 3軒目の右の窓は、留守で暗い
      box(ux - 2, uy + uh + 1, uw + 4, 1, wall + 1); // 窓の上の石
      box(ux - 1, uy - 1, uw + 2, uh + 2, ink(DARK, 1));
      box(ux, uy, uw, uh, lit ? ink(WARM, 4) : ink(COOL, 1));
      if (lit) {
        box(ux + 1, uy + 1, uw - 2, uh >> 1, ink(WARM, 5));
        // カーテン：上は広く、下へ行くほど、両わきへ寄せてある
        for (let j = 0; j < uh; j++) {
          const reach = Math.round(uw * (0.1 + 0.34 * Math.pow(j / uh, 1.6)));
          for (let i = 0; i < reach; i++) {
            const c = ink(cloth, (i + (j >> 2)) % 3 ? 3 : 2);
            put(ux + i, uy + j, c);
            put(ux + uw - 1 - i, uy + j, c);
          }
        }
      } else for (let j = 2; j < uh - 1; j++) put(ux + 1 + ((j * 3) >> 2), uy + j, ink(COOL, 2)); // 暗い窓に、うっすら空が映る
      box(ux + (uw >> 1), uy, 1, uh, ink(DARK, 1));
      box(ux, uy + (uh >> 1), uw, 1, ink(DARK, 1));
      if (spare >= 0) {
        for (const sx of [ux - 1 - flap, ux + uw + 1]) {
          box(sx, uy - 1, flap, uh + 2, ink(cloth, 2));
          for (let j = 1; j < uh + 2; j += 2) box(sx, uy - 1 + j, flap, 1, ink(cloth, 3));
          box(sx < ux ? sx : sx + flap - 1, uy - 1, 1, uh + 2, ink(cloth, 1));
        }
      }
      // 窓の下の花の箱：緑の間に、小さな花。葉が、少し垂れる
      const by = uy - 1 - Z(2);
      box(ux - 1, by, uw + 2, Z(2), ink(WOOD, 2));
      box(ux - 1, by + Z(2) - 1, uw + 2, 1, ink(WOOD, 3));
      for (let i = -2; i <= uw + 1; i++) {
        const high = 1 + Math.floor(rand() * Z(1.6));
        for (let j = 0; j < high; j++) put(ux + i, by + Z(2) + j, ink(LEAF, rand() < 0.5 ? 3 : 2));
        if (rand() < 0.4) put(ux + i, by + Z(2) + high, pick([ink(NEON, 4), SPARK, ink(WARM, 5), ink(NEON, 5)]));
        if (rand() < 0.25) put(ux + i, by + Z(2) - 1 - Math.floor(rand() * Z(1.5)), ink(LEAF, 2));
      }
      if (style === 1 && n === 0) at.cat = [ux + Math.round(uw * 0.7), uy]; // この窓に、猫がいる
    }
    // 窓の間の札：店ごとに、絵が違う（カップ、花、魚）。絵は、5×5 の点
    if (count === 2 && spare >= 0 && uh >= 3) {
      const u = Math.max(1, Math.floor(spare / 7));
      const sx = x + (w >> 1) - ((5 * u) >> 1);
      const sy = uy + (uh >> 1) - ((5 * u) >> 1);
      box(sx - u - 1, sy - u - 1, 7 * u + 2, 7 * u + 2, ink(WOOD, 3));
      box(sx - u, sy - u, 7 * u, 7 * u, ink(DARK, 1));
      [[10, 0, 30, 31, 12], [10, 31, 14, 4, 4], [13, 31, 31, 13, 0]][style].forEach((bits, row) => {
        for (let col = 0; col < 5; col++) if (bits & (16 >> col)) box(sx + col * u, sy + (4 - row) * u, u, u, ink(WARM, 5));
      });
    }
    // 瓦屋根：軒が張り出し、瓦の列が並ぶ
    const ry = base + tall;
    const rows = Z(9);
    for (let j = 0; j < rows; j++) {
      const out = Z(4) - Math.round((j * Z(4)) / rows);
      for (let i = -out; i < w + out; i++) put(x + i, ry + j, (i + j * 2 + 64) % 4 === 0 ? ink(COOL, 1) : j & 1 ? ink(COOL, 2) : ink(COOL, 3));
    }
    box(x + Z(1), ry + rows, w - Z(2), 1, ink(COOL, 4));
    box(x - Z(4), ry - 1, w + Z(8), 1, ink(DARK, 1));
    // 煙突：ふたのある、短い筒。煙は、後から動かして描く
    if (style !== 1 || rand() < 0.5) {
      const sx = x + Math.round(w * between(0.2, 0.8));
      box(sx, ry + rows, Z(3), Z(4), wall);
      box(sx + Z(3) - 1, ry + rows, 1, Z(4), wall - 1);
      box(sx - 1, ry + rows + Z(4), Z(3) + 2, 1, wall + 1);
      stacks.push([sx + (Z(3) >> 1), ry + rows + Z(4) + 1]);
    }
    // 足元の鉢
    for (const fx of [x - Z(1), x + w - Z(11)]) {
      box(fx, base, Z(4), Z(3), ink(WOOD, 2));
      for (let n = Z(14); n > 0; n--) put(fx - 1 + Math.floor(rand() * (Z(4) + 2)), base + Z(3) + Math.floor(rand() * Z(4)), rand() < 0.2 ? ink(WARM, 4) : ink(LEAF, rand() < 0.5 ? 3 : 2));
    }
  };

  // ネオンの看板。文字ではなく、模様（ひし形、山形、しま）
  const neon = (x, y, w, h, family, pattern) => {
    box(x - 1, y - 1, w + 2, h + 2, ink(DARK, 0));
    const cells = [];
    const dot = (px, py) => {
      if (px >= 0 && px < cw && py >= 0 && py < ch) cells.push(py * cw + px);
    };
    for (let i = 0; i < w; i++) {
      dot(x + i, y);
      dot(x + i, y + h - 1);
    }
    for (let j = 0; j < h; j++) {
      dot(x, y + j);
      dot(x + w - 1, y + j);
    }
    const mid = x + (w >> 1);
    for (let j = 2; j < h - 2; j++) {
      const t = (j - 2) % 5;
      if (pattern === 0) {
        const r = t < 3 ? t : 4 - t;
        dot(mid - r, y + j);
        dot(mid + r, y + j);
      } else if (pattern === 1) {
        const r = t < 3 ? 2 - t : -1;
        if (r >= 0) {
          dot(mid - r, y + j);
          dot(mid + r, y + j);
        }
      } else if (t < 2) for (let i = 2; i < w - 2; i++) dot(x + i, y + j);
    }
    for (const i of cells) cityBase[i] = ink(family, 5);
    // 光のにじみ
    for (let j = -2; j < h + 2; j++) for (let i = -2; i < w + 2; i++) if ((i < -1 || i > w || j < -1 || j > h) && (i + j) & 1) put(x + i, y + j, ink(family, 2));
    const sign = { cells, on: ink(family, 5), dim: ink(family, 2), flick: rand() < 0.6 ? between(4, 11) : 0, phase: rand() * 10, off: false };
    signs.push(sign);
    glints.push({ x: x + (w >> 1), thin: Math.max(1, w >> 3), tone: ink(family, 2), family, sign });
  };

  const paintCity = () => {
    buf = cityBase;
    kinds = null;
    shops = [];
    lamps = [];
    signs = [];
    glints = [];
    stacks = [];
    beacon = null;
    const x0 = at.gx0 - 5;
    const x1 = at.gx1 + 5;
    const pw = at.gx1 - at.gx0;
    const fx = (f) => at.gx0 + Math.round(pw * f);
    const lampsAt = pw > 150 ? [0.33, 0.715] : [0.5]; // 街灯の場所
    buf.fill(ink(DARK, 0));
    // 空：4つの帯と、雲
    for (let y = base; y < ch; y++) {
      const f = (y - base) / Math.max(1, at.gy1 - base);
      for (let x = Math.max(0, x0); x < Math.min(cw, x1); x++) {
        const puff = Math.sin(x * 0.11 + y * 0.07) + Math.sin(x * 0.047 - y * 0.13 + 2) + Math.sin(x * 0.023 + 5);
        buf[y * cw + x] = SKY + Math.round(clamp(3 - f * 3.2 + puff * 0.35 + (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) / 22, 0, 3));
      }
    }
    // 遠くのビル
    for (let x = x0; x < x1; ) {
      const w = Z(between(9, 20));
      const top = base + Z(between(34, 66));
      box(x, base, w - 1, top - base, ink(COOL, 1));
      box(x + w - 3, base, 2, top - base, ink(COOL, 0));
      for (let n = Math.round(w * between(0.1, 0.5)); n > 0; n--) box(x + 1 + Math.floor(rand() * Math.max(1, w - 4)), base + Z(20) + Math.floor(rand() * Math.max(1, top - base - Z(22))), 2, 1, rand() < 0.7 ? ink(WARM, 3) : ink(NEON, 3));
      x += w;
    }
    // 遠くの鉄塔：先の赤い明かりは、後から点滅させて描く
    if (pw > 150) {
      const tx = fx(0.345);
      const tall = Z(88);
      const brace = Z(7);
      for (let j = 0; j < tall; j++) {
        const half = Math.round(Z(3.5) * (1 - j / tall));
        if (j % brace === 0) box(tx - half, base + j, 2 * half + 1, 1, ink(COOL, 1));
        else if (half > 1) put(tx - half + Math.floor(((j % brace) * 2 * half) / brace), base + j, ink(COOL, 0));
        put(tx - half, base + j, ink(COOL, 1));
        put(tx + half, base + j, ink(COOL, 1));
      }
      box(tx, base + tall, 1, Z(5), ink(COOL, 1));
      beacon = [tx, base + tall + Z(5)];
    }
    // 電柱と電線
    const poles = pw > 150 ? [0.4, 0.69] : [0.62];
    for (const f of poles) {
      const px = fx(f);
      box(px, base, Z(2), Z(60), ink(DARK, 1));
      box(px - Z(5), base + Z(54), Z(12), 1, ink(DARK, 1));
      box(px - Z(3), base + Z(49), Z(8), 1, ink(DARK, 1));
    }
    for (let n = 0; n < 3; n++) {
      const y = base + Z(54) - n * Z(2);
      let from = x0;
      for (const to of [...poles.map(fx), x1]) {
        for (let x = from; x <= to; x++) {
          const t = (x - from) / Math.max(1, to - from);
          put(x, Math.round(y - Z(5) * 4 * t * (1 - t)), ink(DARK, 1));
        }
        from = to;
      }
    }
    // 店
    const plan = pw > 170 ? [[0.02, 0.24, 66, 0], [0.39, 0.22, 52, 1], [0.745, 0.15, 46, 2]] : pw > 96 ? [[0.03, 0.42, 62, 0], [0.56, 0.38, 50, 1]] : [[0.12, 0.76, 60, 0]];
    for (const [f, wide, tall, style] of plan) {
      const sx = fx(f);
      const sw = Math.round(pw * wide);
      // 店の間の木：幹と枝、こんもりした葉のかたまり。かたまりごとに、街灯の側と上が明るい
      const tx = sx + sw + Z(9);
      const toward = lampsAt.some((l) => fx(l) > tx && fx(l) - tx < Z(40)) ? 1 : -1;
      const trunk = Math.max(2, Z(1.4));
      box(tx, base, trunk, Z(20), ink(WOOD, 1));
      box(toward > 0 ? tx + trunk - 1 : tx, base, 1, Z(20), ink(WOOD, 2));
      line(tx, base + Z(13), tx - Z(5), base + Z(21), ink(WOOD, 1));
      line(tx + 1, base + Z(11), tx + Z(6), base + Z(20), ink(WOOD, 1));
      for (const [ox, oy, rx, ry] of [[0, 0, 12, 10], [-8, -4, 7, 6], [8, -3, 7, 6], [-5, 7, 7, 6], [5, 8, 7, 5], [0, 12, 5, 4]]) {
        const bx = tx + Z(ox);
        const by = base + Z(27 + oy);
        for (let j = -Z(ry); j <= Z(ry); j++) {
          for (let i = -Z(rx); i <= Z(rx); i++) {
            const u = i / Z(rx);
            const v = j / Z(ry);
            const d = u * u + v * v;
            if (d > 1 || (d > 0.7 && BAYER[((by + j) & 3) * 4 + ((bx + i) & 3)] < (d - 0.7) * 50)) continue;
            const light = u * toward * 0.6 + v * 0.7 + (((bx + i) * 7 + (by + j) * 13) % 5) * 0.12 - 0.24;
            put(bx + i, by + j, ink(LEAF, light > 0.55 ? 3 : light > 0 ? 2 : 1));
          }
        }
      }
      shop(sx, sw, Z(tall), style);
    }
    // ネオンの看板
    const marks = pw > 170 ? [[0.262, 30, 9, 26, NEON, 0], [0.612, 22, 8, 18, TEAL, 1], [0.618, 10, 10, 8, NEON, 2], [0.905, 16, 7, 15, PLUM, 2]] : pw > 96 ? [[0.46, 28, 8, 22, NEON, 0], [0.95, 20, 7, 16, TEAL, 1]] : [[0.02, 30, 7, 20, NEON, 0], [0.9, 24, 7, 16, TEAL, 1]];
    for (const [f, up, w, h, family, pattern] of marks) neon(fx(f), base + Z(up), Math.max(5, Z(w)), Math.max(7, Z(h)), family, pattern);
    // 向こうの歩道：ぬれた敷石。店の窓の前は、明かりがこぼれて暖かい。縁石の角が、細く光る
    const walk = Math.max(1, base - curb);
    const slabs = Math.max(4, Z(8));
    for (let y = curb; y < base; y++) {
      const t = (y - curb) / Math.max(1, walk - 1); // 0：手前の縁、1：店の足元
      const row = Math.floor((y - curb) / Math.max(2, Z(2.5)));
      for (let x = Math.max(0, x0); x < Math.min(cw, x1); x++) {
        let spill = 0;
        for (const s of shops) spill = Math.max(spill, 1 - Math.max(0, s.wx - x, x - s.wx - s.ww) / Z(4 + 7 * (1 - t)));
        const joint = (x + row * (slabs >> 1)) % slabs === 0 || (y - curb) % Math.max(2, Z(2.5)) === 0;
        let c = joint ? ink(COOL, 1) : ink(COOL, 2);
        if (spill > 0) c = mixed(x, y, c, joint ? ink(WOOD, 2) : ink(WOOD, 3), spill * (0.12 + 0.45 * t));
        if (y === curb) c = spill > 0.5 ? ink(WOOD, 4) : ink(COOL, 3);
        else if (y === base - 1) c = ink(DARK, 1);
        buf[y * cw + x] = c;
      }
    }
    for (let y = 0; y < curb; y++) for (let x = Math.max(0, x0); x < Math.min(cw, x1); x++) buf[y * cw + x] = y === curb - 1 ? BLACK : (x * 7 + y * 13) % 11 === 0 ? ink(COOL, 1) : ink(DARK, 0);
    // 歩道に置いてある物（壁ぎわ。歩く人は、この手前を通る）：長いす、立て看板、自転車
    const feet = base - Z(2);
    if (pw > 96) {
      // 長いす：1軒目の窓の前。座と、背の板が2枚
      const bx = shops[0].wx + Z(5);
      const bw = Z(15);
      const slat = Math.max(1, Z(1));
      for (const lx of [bx + 1, bx + bw - 2]) box(lx, feet, slat, Z(3), ink(DARK, 1));
      box(bx, feet + Z(3), bw, slat, ink(WOOD, 3));
      for (const up of [5, 7]) box(bx, feet + Z(up), bw, slat, ink(WOOD, 2));
      for (const lx of [bx, bx + bw - 1]) box(lx, feet + Z(3), 1, Z(5), ink(DARK, 1));
      // 立て看板：2軒目の窓の前。黒い板に、白と桃色の線
      const ax = shops[1].wx + Z(4);
      box(ax - Z(3), feet, 2 * Z(3) + 1, Z(9), ink(WOOD, 2));
      box(ax - Z(3) + 1, feet + 1, 2 * Z(3) - 1, Z(9) - 2, ink(DARK, 1));
      for (const [up, tone] of [[7, CREAM], [5.2, ink(NEON, 4)], [3.4, CREAM], [1.8, TAN]]) for (let i = -Z(2); i <= Z(2); i++) if (((i + 64) * 5 + up * 10) % 7 > 1) put(ax + i, feet + Z(up), tone);
      box(ax - Z(3), feet - 1, 1, 1, ink(DARK, 1));
      box(ax + Z(3), feet - 1, 1, 1, ink(DARK, 1));
    }
    if (pw > 150) {
      // 自転車：街灯の柱に、立てかけてある
      const gx = fx(lampsAt[1]) - Z(15);
      const r = Z(3.2);
      const hub = feet + r;
      const body = ink(TEAL, 3);
      for (const wx of [gx, gx + Z(10)]) {
        for (let a = 0; a < 28; a++) put(wx + Math.round(Math.cos((a * TAU) / 28) * r), hub + Math.round(Math.sin((a * TAU) / 28) * r), ink(COOL, 3));
        put(wx, hub, ink(COOL, 4));
      }
      line(gx, hub, gx + Z(3.5), hub + Z(4.5), body);
      line(gx + Z(3.5), hub + Z(4.5), gx + Z(4.5), hub, body);
      line(gx, hub, gx + Z(4.5), hub, body);
      line(gx + Z(4.5), hub, gx + Z(8.5), hub + Z(4.5), body);
      line(gx + Z(3.5), hub + Z(4.5), gx + Z(8.5), hub + Z(4.5), body);
      line(gx + Z(8.5), hub + Z(5.5), gx + Z(10), hub, body);
      box(gx + Z(2.5), hub + Z(4.5) + 1, Z(2), 1, ink(DARK, 3));
      box(gx + Z(7.5), hub + Z(5.5) + 1, Z(2), 1, ink(DARK, 3));
    }
    // 街灯：鉄の柱の上に、ガラスの明かり。まわりの雨と壁が、暖かくにじむ（点を散らして描く）
    for (const f of lampsAt) {
      const lx = fx(f);
      const head = curb + Z(41); // 明かりの中心
      const halo = Z(17);
      for (let dy = -halo; dy <= halo; dy++) {
        for (let dx = -halo; dx <= halo; dx++) {
          const far = Math.hypot(dx, dy) / halo;
          const gx = lx + dx;
          const gy = head + dy;
          if (far >= 1 || gx < 0 || gx >= cw || gy < 0 || gy >= ch || level(buf[gy * cw + gx]) >= 4) continue;
          if ((1 - far) * (1 - far) * 21 > BAYER[(gy & 3) * 4 + (gx & 3)] + 1) buf[gy * cw + gx] = far < 0.26 ? ink(WOOD, 4) : far < 0.52 ? ink(WARM, 3) : ink(WARM, 2);
        }
      }
      const thick = Math.max(2, Z(1.2));
      const px0 = lx - (thick >> 1);
      const wide = (a, y, h, c) => box(px0 - a, y, thick + 2 * a, h, c);
      // 柱：上の半分は、明かりを受けて、片側が細く光る。足元に台座、途中に輪
      const shaft = head - Z(5) - curb - 1;
      wide(0, curb + 1, shaft, ink(DARK, 1));
      box(px0, curb + 1 + (shaft >> 1), 1, shaft - (shaft >> 1), ink(WOOD, 2));
      wide(Z(1.6), curb + 1, Z(2), ink(DARK, 1));
      wide(Z(0.9), curb + 1 + Z(2), Z(2), ink(DARK, 1));
      wide(Z(1.6), curb + Z(2), 1, ink(DARK, 2));
      wide(Z(0.9), curb + Z(17), Math.max(1, Z(0.8)), ink(DARK, 1));
      // 明かり：上が広いガラス。真ん中が、いちばん白い。鉄の枠と、とがった笠
      const tall = Z(7);
      const g0 = head - (tall >> 1);
      wide(Z(0.9), g0 - 1 - Z(1.2), Z(1.2), ink(DARK, 1));
      wide(Z(2.3), g0 - 1, 1, ink(DARK, 1));
      for (let j = 0; j < tall; j++) {
        const a = Math.round(mix(Z(1.4), Z(2.7), j / Math.max(1, tall - 1)));
        wide(a, g0 + j, 1, Math.abs(j - tall * 0.45) < tall * 0.3 ? ink(WARM, 5) : ink(WARM, 4));
        if (Math.abs(j - tall * 0.45) < tall * 0.2) wide(Math.max(0, a - Z(1.5)), g0 + j, 1, SPARK);
        put(px0 - a - 1, g0 + j, ink(DARK, 1));
        put(px0 + thick + a, g0 + j, ink(DARK, 1));
      }
      const cap = Math.max(2, Z(2.6));
      for (let j = 0; j < cap; j++) {
        const a = Math.round(mix(Z(3.6), Z(0.5), j / Math.max(1, cap - 1)));
        wide(a, g0 + tall + j, 1, ink(DARK, 1));
        put(px0 - a, g0 + tall + j, ink(DARK, 3));
      }
      wide(Z(3.6), g0 + tall, 1, ink(WOOD, 3));
      wide(0, g0 + tall + cap, Math.max(1, Z(1)), ink(DARK, 1));
      lamps.push({ x: lx, y: head });
      glints.push({ x: lx, thin: Math.max(1, Z(0.9)), tone: ink(WOOD, 4), family: WARM, lamp: true });
    }
  };

  // ぬれた路面に映るものは、色を2段暗くする
  const dimmed = (c) => (c === SPARK || c === CREAM ? ink(WARM, 3) : c === TAN ? ink(WARM, 2) : c >= SKY ? ink(COOL, 1) : c - Math.min(c % 6, 2));
  // 足の運び（4コマ）：[前へ出す量, 持ち上げる量]。踏み出す、立つ、後ろへ蹴る、浮かせて前へ
  const STEPS = [[2.2, 0], [0, 0], [-1.9, 0], [0.6, 0.9]];
  // かさの骨の場所（かさの幅を -1〜1 として）と、縁がへこむ場所
  const RIBS = [-0.97, -0.72, -0.27, 0.27, 0.72, 0.97];
  const DIPS = [-0.86, -0.5, 0, 0.5, 0.86];

  // 傘をさして歩く人。足は4コマで動く。mirror のときは、ぬれた路面に映った姿（逆さで、暗く、とぎれる）。
  // friend は、白いシャツと青いズボンの人
  const walker = (p, mirror) => {
    const s = kc * p.tall;
    const R = (n) => Math.round(n * s);
    const N = (n) => Math.max(1, Math.round(n * s));
    const ground = curb + 1;
    const d = p.dir;
    const x = Math.round(p.x);
    const dot = mirror
      ? (px, py, c) => {
          const ry = curb - 2 - Math.round((py - ground) * 0.5);
          if (ry < at.gy0 - 3 || (ry * 3 + Math.floor(time * 3)) % 7 === 0) return;
          put(px + Math.round(Math.sin(ry * 1.9 + time * 2.2) * 1.2), ry, dimmed(c));
        }
      : put;
    const row = (px, py, w, c) => {
      for (let i = 0; i < w; i++) dot(px + i, py, c);
    };
    const seg = (xa, ya, xb, yb, w, c) => {
      const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya), 1);
      for (let i = 0; i <= n; i++) row(Math.round(xa + ((xb - xa) * i) / n) - (w >> 1), Math.round(ya + ((yb - ya) * i) / n), w, c);
    };
    const phase = Math.floor(p.step) & 3;
    const bob = phase & 1 && s >= 1.2 ? 1 : 0; // 片足で立つコマでは、体が少し上がる
    const legH = N(p.friend ? 6.4 : 5.6);
    const coatH = N(p.friend ? 5.8 : 6.6);
    const hem = ground + legH - N(0.5) + bob;
    const top = hem + coatH;
    const skin = ink(WARM, 4);

    // 足：奥の足、手前の足の順。浮いた足は、ひざが前へ曲がる
    const lw = N(1.1);
    const hipY = ground + legH + bob;
    const leg = (turn, c, shoe) => {
      const [reach, lift] = STEPS[(phase + turn) & 3];
      const fx2 = x + d * R(reach);
      const fy = ground + R(lift);
      const kx = Math.round((x + fx2) / 2) + d * R(lift ? 0.9 : 0.15);
      const ky = (hipY + fy) >> 1;
      seg(x, hipY, kx, ky, lw, c);
      seg(kx, ky, fx2, fy + 1, lw, c);
      row(fx2 - (lw >> 1) + (d > 0 ? 0 : -1), fy, lw + 1, shoe);
    };
    leg(2, p.legs - 1, p.friend ? TAN : ink(DARK, 1));
    leg(0, p.legs, p.friend ? CREAM : ink(DARK, 1));

    // 上着：すそが広い。後ろ側は影、前の縁は、店の明かりを受ける
    for (let j = 0; j < coatH; j++) {
      const t = j / Math.max(1, coatH - 1);
      const half = p.friend ? (t < 0.85 ? 1.7 : 1.3) : t < 0.5 ? mix(2.1, 1.55, t / 0.5) : t < 0.86 ? mix(1.55, 1.85, (t - 0.5) / 0.36) : mix(1.85, 1.3, (t - 0.86) / 0.14);
      const hw = Math.max(1, Math.round(half * s));
      const trail = !p.friend && t < 0.3 && !(phase & 1) ? -d : 0; // 歩くと、すそが後ろへなびく
      for (let i = -hw; i <= hw; i++) {
        const front = i * d;
        dot(x + i + trail, hem + j, front >= hw ? p.coat[2] : front <= -hw + R(0.6) ? p.coat[0] : p.coat[1]);
      }
    }
    if (!p.friend && s >= 1.2) {
      row(x - R(1.55), hem + Math.round(coatH * 0.5), 2 * R(1.55) + 1, p.coat[0]); // ベルト
      for (let j = 1; j < coatH * 0.5; j++) dot(x + d * R(0.8), hem + j, p.coat[0]); // 前の合わせ
    }
    // かばん：腰の後ろ。ひもが、肩へ斜めに掛かる
    if (p.bag && s >= 1.2) {
      const bw = N(1.7);
      const bh = N(1.9);
      const bx = x - d * R(2.1) - (d > 0 ? bw - 1 : 0);
      const by = hem + Math.round(coatH * 0.2);
      seg(bx + (d > 0 ? bw - 1 : 0), by + bh, x + d * R(1.1), top - 1, 1, ink(WOOD, 1));
      for (let j = 0; j < bh; j++) row(bx, by + j, bw, j === bh - 1 ? ink(WOOD, 4) : ink(WOOD, 2));
    }
    // 傘を持つ腕：ひじを曲げて、柄をにぎる
    const handX = x + d * R(1.9);
    const handY = hem + Math.round(coatH * 0.62);
    const elbowX = x + d * R(0.4);
    const elbowY = hem + Math.round(coatH * 0.46);
    const aw = N(0.9);
    seg(x - d * R(0.2), top - N(1.2), elbowX, elbowY, aw, p.coat[0]);
    seg(elbowX, elbowY, handX - d, handY, aw, p.coat[0]);
    // えり元
    row(x - R(1.2), top - 1, 2 * R(1.2) + 1, p.scarf);
    if (!p.friend) for (let j = 1; j <= N(1.4); j++) dot(x - d * R(1.4), top - 1 - j, p.scarf - 1);

    // 頭：前が顔、上と後ろが髪
    const hr = N(1.55);
    const hx = x + d * R(0.35);
    const hy = top + hr;
    for (let j = -hr; j <= hr; j++) {
      for (let i = -hr; i <= hr; i++) {
        if ((i * i) / (hr * hr + 0.5) + (j * j) / (hr * hr + 0.9) > 1) continue;
        const front = i * d;
        dot(hx + i, hy + j, j > hr * 0.3 || front < -hr * 0.25 ? p.hair : skin);
      }
    }
    if (hr >= 2) dot(hx + d * Math.round(hr * 0.55), hy, ink(DARK, 0));
    if (p.long) for (let j = 0; j <= hr + N(1); j++) row(hx - d * hr - (d > 0 ? 1 : 0), hy - j, 2, p.hair);

    // 傘：柄、丸いかさ、骨。縁は、骨の間で少しへこむ。上の面が明るい
    const ux = handX;
    const rim = hy + hr + N(0.6);
    const UR = N(7.2);
    const dh = N(4.3);
    for (let y = handY - N(0.8); y < rim + dh; y++) dot(ux, y, ink(DARK, 3));
    dot(ux - d, handY - N(0.8), ink(DARK, 3));
    dot(ux, handY, skin);
    if (s >= 1.5) dot(ux, handY + 1, skin);
    for (let j = 0; j <= dh; j++) {
      const span = Math.sqrt(Math.max(0, 1 - (j / (dh + 0.6)) * (j / (dh + 0.6))));
      const half = Math.round(UR * span);
      for (let i = -half; i <= half; i++) {
        const u = i / (UR * span + 0.001);
        if (j === 0 && DIPS.some((at2) => Math.abs(u - at2) < 0.1)) continue;
        let c = j >= dh * 0.5 ? p.um[2] : u * d < -0.5 ? p.um[0] : p.um[1];
        if (j === 0 || RIBS.some((at2) => Math.round(at2 * UR * span) === i)) c = j >= dh * 0.5 ? p.um[1] : p.um[0];
        dot(ux + i, rim + j, c);
      }
    }
    for (let j = 1; j <= N(0.9); j++) dot(ux, rim + dh + j, ink(DARK, 3));
    // 傘の端から、しずくが落ちる
    if (!mirror) {
      for (const e of [-1, 1]) {
        const fall = (tickNo * 2 + (e > 0 ? 6 : 0) + p.seed) % 15;
        if (fall < 9) dot(ux + e * UR, rim - 1 - fall, ink(COOL, 4));
      }
    }
  };

  // 通りを走る車：横から見た、小さな乗用車。前の明かりが、雨を照らす。車輪が、水をはね上げる。
  // mirror のときは、ぬれた路面に映った姿
  const motor = (c, mirror) => {
    const L = Z(34);
    const H = Z(12);
    const r = Z(2.4);
    const ground = curb - Z(4);
    const x0 = Math.round(c.x);
    const dot = mirror
      ? (px, py, tone) => {
          const ry = ground - 1 - Math.round((py - ground) * 0.55);
          if (ry < at.gy0 - 3 || (ry * 3 + Math.floor(time * 3)) % 7 === 0) return;
          put(px + Math.round(Math.sin(ry * 1.9 + time * 2.2) * 1.2), ry, dimmed(tone));
        }
      : put;
    const [lo, mid, hi] = c.tones;
    for (let j = 0; j <= H; j++) {
      const v = j / H;
      const up = (v - 0.56) / 0.44;
      for (let i = 0; i <= L; i++) {
        const u = i / L;
        const wheel = Math.min(Math.hypot(i - L * 0.2, j - r), Math.hypot(i - L * 0.8, j - r));
        let tone = -1;
        if (wheel <= r) tone = wheel < r * 0.45 ? ink(COOL, (tickNo + i) & 1 ? 3 : 2) : BLACK;
        else if (v >= 0.16 && v <= 0.56) {
          // 胴：両端は丸い。上の面が明るく、下は影。前に白い明かり、後ろに赤い明かり、下にバンパー
          const round = 0.035 * (1 - Math.sin((Math.PI * (v - 0.16)) / 0.4));
          if (u >= round && u <= 1 - round) {
            tone = wheel < r * 1.35 ? BLACK : v > 0.5 ? hi : v > 0.3 ? mid : lo;
            if (Math.abs(u - 0.47) < 0.012 && v > 0.22) tone = lo;
            if (v > 0.34 && v < 0.5 && (u > 0.955 || u < 0.04)) tone = u > 0.5 ? SPARK : ink(NEON, 5);
            if (v < 0.24 && (u < 0.07 || u > 0.93)) tone = ink(COOL, 3);
          }
        } else if (v > 0.56 && u >= 0.2 + 0.09 * up && u <= 0.74 - 0.17 * up) {
          // 屋根と窓：前の窓は、斜め。窓に、空が斜めに映る。中に、運転する人の頭
          tone = v > 0.9 ? hi : mid;
          if (v > 0.6 && v <= 0.88 && u > 0.23 + 0.09 * up && u < 0.71 - 0.17 * up && Math.abs(u - 0.47) > 0.018) tone = Math.hypot((u - 0.56) * L, (v - 0.68) * H) < Z(1.3) ? BLACK : (i + j) % 6 === 0 ? ink(COOL, 3) : ink(COOL, 1);
        }
        if (tone >= 0) dot(x0 + (c.dir > 0 ? i : L - i), ground + j, tone);
      }
    }
    if (mirror) return;
    const front = x0 + (c.dir > 0 ? L + 1 : -1);
    for (let i = 0; i < Z(26); i++) {
      const f = i / Z(26);
      const x = front + c.dir * i;
      for (let j = -Z(2.5); j <= Z(1); j++) {
        const y = ground + Math.round(H * 0.42) + j - Math.round(f * Z(2));
        if (x >= 0 && x < cw && (1 - f) * 14 > BAYER[(y & 3) * 4 + (x & 3)] + Math.abs(j + Z(0.7)) * (3 - 2 * f) && level(buf[y * cw + x]) < 4) put(x, y, ink(WARM, f < 0.25 ? 4 : 3));
      }
    }
    for (const w of [0.2, 0.8]) for (let n = 0; n < 4; n++) put(x0 + Math.round((c.dir > 0 ? w : 1 - w) * L) - c.dir * (r + Math.floor(rand() * Z(4))), ground + Math.floor(rand() * Z(2.5)), ink(COOL, 4));
  };

  // ---------------------------------------------------------------- 手前の店内
  // 光源は、ランタン1つ（右上）。すべての物は、ランタンの側の面を明るく、反対側を暗く塗る。
  // 影の色は、色の表の側で、紫や藍に寄せてある。明るい色は、黄や橙に寄せてある（setInks）。

  // ランタンからの明るさ（0〜1）。距離で、なめらかに弱くなる。下へは、少し遠くまで届く
  const lightAt = (x, y) => {
    const dy = y - at.lampY;
    const d = Math.hypot(x - at.lampX, dy * (dy < 0 ? 0.6 : 1.1)) / S(23);
    return 1 / (1 + d * d);
  };
  // 明るさから、帯の色を選ぶ。steps は、暗い順の色。帯と帯の間は、2色の点を混ぜて、なだらかにつなぐ
  const band = (x, y, t, steps) => {
    const f = Math.pow(clamp(t), 0.42) * (steps.length - 1);
    const i = Math.min(steps.length - 2, Math.floor(f));
    return mixed(x, y, steps[i], steps[i + 1], clamp((f - i - 0.3) / 0.4));
  };

  // 物を、立体に塗る。inside(i, j) は、形の外なら null、中なら面の向き [nx, ny]（-1〜1）を返す。
  // ramp は5色：[いちばん暗い縁, 影の面, ふつうの面, 明るい面, つやの点]。
  // 面がランタンのほうを向くほど明るい。ランタンの側の縁は細く光り、反対側の縁は、いちばん暗い
  const solid = (x0, y0, w, h, inside, ramp, lift = 0) => {
    const dx = at.lampX - (x0 + w / 2);
    const dy = at.lampY - (y0 + h / 2);
    const far = Math.hypot(dx, dy) || 1;
    const lx = dx / far;
    const ly = dy / far;
    const dim = (1 - Math.sqrt(lightAt(x0 + w / 2, y0 + h / 2))) * 0.42 - lift; // ランタンから遠い物は、全体に暗い
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const n = inside(i, j);
        if (!n) continue;
        let ex = 0;
        let ey = 0;
        if (!inside(i - 1, j)) ex -= 1;
        if (!inside(i + 1, j)) ex += 1;
        if (!inside(i, j - 1)) ey -= 1;
        if (!inside(i, j + 1)) ey += 1;
        // 面の色の境は、2色の点を混ぜて、なだらかにつなぐ
        const v = (n[0] * lx + n[1] * ly) * 0.8 + 0.3 * Math.sqrt(Math.max(0, 1 - n[0] * n[0] - n[1] * n[1])) - dim + (n[0] || n[1] ? (BAYER[((y0 + j) & 3) * 4 + ((x0 + i) & 3)] - 7.5) / 110 : 0);
        let c = v > 0.78 ? ramp[4] : v > 0.36 ? ramp[3] : v > -0.05 ? ramp[2] : ramp[1];
        if (ex || ey) c = (ex * lx + ey * ly) / Math.hypot(ex, ey) > 0.25 ? ramp[3] : ramp[0];
        put(x0 + i, y0 + j, c);
      }
    }
  };
  // 形：上と下で幅の違う筒（カップ、鉢、本の背）
  const tube = (w, h, top, bottom) => (i, j) => {
    if (j < 0 || j >= h) return null;
    const half = (w / 2) * mix(bottom, top, j / Math.max(1, h - 1));
    const x = i + 0.5 - w / 2;
    return Math.abs(x) <= half ? [(x / (half + 0.01)) * 0.95, 0.12] : null;
  };
  // 形：玉と、平らな板
  const ball = (w, h) => (i, j) => {
    const x = (i + 0.5 - w / 2) / (w / 2);
    const y = (j + 0.5 - h / 2) / (h / 2);
    return x * x + y * y <= 1 ? [x * 0.9, y * 0.9] : null;
  };
  const slab = (w, h, nx = 0, ny = 0) => (i, j) => (i >= 0 && i < w && j >= 0 && j < h ? [nx, ny] : null);
  // 落ちる影：物の下に濃く、ランタンと反対の向きへ、短く伸びる
  const shadow = (cx, cy, rx, ry) => {
    const ox = cx + Math.round((cx < at.lampX ? -1 : 1) * rx * 0.35);
    const wide = Math.round(rx * 1.3);
    for (let j = -ry; j <= ry; j++) {
      for (let i = -wide; i <= wide; i++) {
        const d = (i * i) / (wide * wide + 0.3) + (j * j) / (ry * ry + 0.3);
        if (d <= 0.55 || (d <= 1 && BAYER[((cy + j) & 3) * 4 + ((ox + i) & 3)] < 9)) put(ox + i, cy + j, BLACK);
      }
    }
  };
  // 葉：先のとがった、ハートに近い形。turn は向き。ramp は [縁, 影の面, ふつうの面, 明るい面, 葉脈]。
  // ランタンの側が明るい。真ん中に葉脈が1本、そこから先のほうへ、斜めに2組。
  // 葉は毎コマ揺れるので、形は、向きごとに1度だけ計算して覚えておく
  const leafCache = new Map();
  const leafCells = (size, turn, light) => {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const lx = Math.cos(light);
    const ly = Math.sin(light);
    const shape = (i, j) => {
      const a = i / size;
      const b = j / size;
      const u = a * cos + b * sin;
      const v = b * cos - a * sin; // v：付け根（1）から、先（-1）へ
      if (v > 1 || v < -1) return null;
      const wide = 0.92 * Math.sqrt(1 - v * v) * (v < 0 ? 1 + 0.55 * v : 1);
      return Math.abs(u) > wide || (v > 0.62 && Math.abs(u) < (v - 0.62) * 0.9) ? null : [u, v, wide];
    };
    const cells = [];
    for (let j = -size; j <= size; j++) {
      for (let i = -size; i <= size; i++) {
        const p = shape(i, j);
        if (!p) continue;
        const side = (i * lx + j * ly) / size;
        let tone = side > 0.15 ? 3 : side > -0.4 ? 2 : 1;
        const rib = size > 4 && Math.abs(p[0]) < p[2] * 0.8 && [0.42, -0.08].some((from) => Math.abs(p[1] - from + Math.abs(p[0]) * 0.85) * size < 0.55);
        if (Math.abs(p[0]) * size < 0.6 || rib) tone = side > -0.4 ? 4 : 2;
        if (!shape(i - 1, j) || !shape(i + 1, j) || !shape(i, j - 1) || !shape(i, j + 1)) tone = side > 0.3 ? 3 : 0;
        cells.push(i, j, tone);
      }
    }
    return Int8Array.from(cells);
  };
  const leaf = (cx, cy, size, turn, ramp) => {
    const tq = Math.round(turn / 0.12);
    const lq = Math.round(Math.atan2(at.lampY - cy, at.lampX - cx) / 0.5);
    const key = size * 1000000 + (tq + 500) * 100 + lq + 50;
    let cells = leafCache.get(key);
    if (!cells) {
      if (leafCache.size > 1500) leafCache.clear();
      cells = leafCells(size, tq * 0.12, lq * 0.5);
      leafCache.set(key, cells);
    }
    for (let n = 0; n < cells.length; n += 3) put(cx + cells[n], cy + cells[n + 1], ramp[cells[n + 2]]);
  };

  // 本：のど（0）から外（1）への、紙の面の高さ（1 がいちばん高い）。のどで沈み、すぐ横でふくらんで、外へ下がる
  const BOOK_TAPER = 0.13; // 奥の縁は、手前より、これだけ狭く見える
  const bookRise = (t) => (t < 0.2 ? mix(0.4, 1, Math.sin((t / 0.2) * Math.PI * 0.5)) : mix(1, 0.6, Math.pow((t - 0.2) / 0.8, 1.2)));
  // 紙の色。dir：右（1）か左（-1）、t：のどからの距離、line：奥行きの行、deep：奥行きの行数、col：横のマス
  const pageInk = (dir, t, line, deep, col) => {
    if (t < 0.018) return ink(WOOD, 2);
    if (line === 0) return dir > 0 ? SPARK : CREAM; // 手前の縁
    if (line >= deep) return TAN; // 奥の縁
    if (t > 0.975) return dir > 0 ? TAN : ink(DARK, 3);
    // 文字の行：2行おき。行の終わりは、そろえない。ところどころに、言葉の切れ目
    const text = line % 3 === 1 && line > 1 && line < deep - 1 && t > 0.2 && t < 0.86 - ((line * 7) % 5) * 0.03 && (col * 3 + line * 5) % 11 > 1;
    // ふくらみの明るさ：のどのすぐ横がいちばん明るく、外へ行くほど、ふつうの紙の色へ（点を混ぜて、なだらかに）
    const lift = t < 0.2 ? smoothstep(0.05, 0.17, t) : 1 - smoothstep(0.22, 0.52, t);
    const bright = lift * 20 > BAYER[(line & 3) * 4 + (col & 3)] + 2;
    if (dir > 0) return text ? TAN : t < 0.06 ? TAN : bright ? ink(WARM, 5) : CREAM;
    return text ? ink(DARK, 3) : t < 0.06 ? ink(DARK, 3) : bright ? CREAM : TAN;
  };

  const paintRoom = () => {
    buf = roomBase;
    kinds = roomKind;
    kind = 1;
    const wallInks = [BLACK, ink(WOOD, 0), ink(WOOD, 1), ink(WOOD, 2), ink(WOOD, 3), ink(WOOD, 4)];
    const beamInks = [ink(WOOD, 0), ink(WOOD, 1), ink(WOOD, 2), ink(WOOD, 3), ink(WOOD, 4), ink(WARM, 4)];
    const ceramic = [ink(PLUM, 1), TAN, CREAM, ink(WARM, 5), SPARK];
    const timber = [BLACK, ink(WOOD, 1), ink(WOOD, 3), ink(WOOD, 4), ink(WARM, 5)];

    // 木の壁：縦の板。ランタンから遠いほど暗い。板ごとに、わずかに明るさが違う。
    // 木目：板ごとに、とぎれる細い筋が2本。3枚に1枚は、節がある
    const plank = S(11);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const p = Math.floor(x / plank);
        const o = x % plank;
        const far = Math.hypot((o - (plank >> 1)) * 1.7, (y - ((p * 97) % ch)) * 0.55) / S(2.4);
        const knot = p % 3 !== 1 || far > 1.3 ? 1 : far < 0.5 ? 0.45 : far > 0.9 ? 0.7 : 1;
        const grain = (o === 2 + ((p * 5) % Math.max(1, plank - 4)) && (y + p * 17) % 31 < 22) || (o === 1 + ((p * 11) % Math.max(1, plank - 3)) && (y + p * 7) % 23 < 9) ? 0.8 : 1;
        buf[y * cw + x] = band(x, y, lightAt(x, y) * (p & 1 ? 0.8 : 1) * (o === 0 ? 0.4 : knot * grain), wallInks);
        kinds[y * cw + x] = 1;
      }
    }

    // 窓の枠：太い木。外の縁に暗い線。ガラスの側の面（奥行き）は、ランタンを向く左は明るく、右と上は影
    const depth = Math.max(2, S(2));
    for (let y = at.fy0; y < at.fy1; y++) {
      for (let x = at.fx0; x < at.fx1; x++) {
        if (x >= at.gx0 && x < at.gx1 && y >= at.gy0 && y < at.gy1) continue;
        const outer = Math.min(x - at.fx0, at.fx1 - 1 - x, y - at.fy0, at.fy1 - 1 - y);
        const post = x < at.gx0 || x >= at.gx1;
        const grain = (post ? (x * 5 + Math.floor(y / 5) * 3) % 7 === 0 : (y * 5 + Math.floor(x / 5) * 3) % 7 === 0) ? 0.72 : 1;
        let c = band(x, y, lightAt(x, y) * 1.1 * grain, beamInks);
        const rows = y >= at.gy0 - depth && y < at.gy1 + depth;
        const cols = x >= at.gx0 - depth && x < at.gx1 + depth;
        if (rows && x >= at.gx0 - depth && x < at.gx0) c = band(x, y, lightAt(x, y) * 2.4, beamInks);
        else if (rows && x >= at.gx1 && x < at.gx1 + depth) c = BLACK;
        else if (cols && y >= at.gy1 && y < at.gy1 + depth) c = BLACK;
        else if (cols && y >= at.gy0 - depth && y < at.gy0) c = band(x, y, lightAt(x, y) * 4.5, beamInks);
        // ガラスから少し離れた所に、溝（暗い線）と、段（明るい線）
        const off = Math.max(at.gx0 - x, x - at.gx1 + 1, at.gy0 - y, y - at.gy1 + 1);
        if (off === depth + S(3)) c = BLACK;
        else if (off === depth + S(3) + 1) c = band(x, y, lightAt(x, y) * 2.6, beamInks);
        if (outer < 1) c = BLACK;
        buf[y * cw + x] = c;
      }
    }
    // 枠の四すみ：木を斜めに合わせた、継ぎ目
    for (const [ax, ay, bx, by] of [[at.fx0, at.fy0, at.gx0 - depth - 1, at.gy0 - depth - 1], [at.fx1 - 1, at.fy0, at.gx1 + depth, at.gy0 - depth - 1], [at.fx0, at.fy1 - 1, at.gx0 - depth - 1, at.gy1 + depth], [at.fx1 - 1, at.fy1 - 1, at.gx1 + depth, at.gy1 + depth]]) line(ax, ay, bx, by, ink(WOOD, 0));
    // 下の枠のまん中に、真ちゅうの小さな取っ手
    {
      const hx = (at.gx0 + at.gx1) >> 1;
      const hy = at.fy0 + ((at.gy0 - depth - at.fy0) >> 1);
      box(hx - S(4), hy - 1, 2 * S(4) + 1, Math.max(2, S(1.5)) + 1, BLACK);
      box(hx - S(4), hy, 2 * S(4) + 1, Math.max(2, S(1.5)), ink(WOOD, 2));
      box(hx - S(4) + 1, hy + Math.max(2, S(1.5)) - 1, 2 * S(4) - 1, 1, ink(WOOD, 3));
      for (const e of [-1, 1]) put(hx + e * (S(4) - 1), hy, ink(WOOD, 4));
    }
    // 窓の下の枠の上の面に、小さな強い光
    for (let x = at.gx0; x < at.gx1; x += S(9)) if (lightAt(x, at.gy0) > 0.12 && (x * 7) % 5 < 2) put(x, at.gy0 - 1, SPARK);
    // ガラスの所は、空けておく
    for (let y = at.gy0; y < at.gy1; y++) for (let x = at.gx0; x < at.gx1; x++) kinds[y * cw + x] = 0;

    // テーブル：つやのある木。ランタンの下あたりが暖かく明るく、手前と左は、かなり暗い。木目は、横に長い。
    // 天板は、横長の板を3枚、はり合わせてある：境に、細い溝
    for (let y = 0; y < at.counter; y++) {
      const deep = (at.counter - y) / at.counter; // 0：奥の縁、1：手前
      const seam = y === Math.round(at.counter * 0.36) || y === Math.round(at.counter * 0.7);
      const streak = seam ? 0.4 : (y * 7) % 5 === 0 ? 0.8 : (y * 3) % 7 === 0 ? 1.12 : 1;
      for (let x = 0; x < cw; x++) {
        const grain = seam || (x + y * 37) % 61 < 44 ? streak : 1;
        const reach = (x - at.lampX) / S(64);
        const inPane = x > at.gx0 && x < at.gx1 ? 1 : 0.4;
        // ランタンの明かりと、窓からの街の明かり（奥の縁だけ、うっすら）
        let c = band(x, y, (0.8 / (1 + reach * reach)) * (1 - 0.78 * deep) * grain + 0.12 * inPane * (1 - deep) * (1 - deep), wallInks);
        // ランタンが、縦に映る：横に短い光の筋が、手前へ行くほど細く、まばらになる
        const under = Math.abs(x - at.lampX) / S(6);
        if (under < 1 - deep && y % 3 === 1 && (1 - under) * (1 - deep) * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 3) c = ink(WARM, 4);
        // ネオンと街灯は、奥の縁の近くにだけ、短く映る。手前へ、点になって消える
        for (const g of glints) {
          if ((x === g.x || x === g.x + 1) && deep < 0.3 && (0.3 - deep) * 60 > BAYER[(y & 3) * 4 + (x & 3)] + 1) c = g.tone;
        }
        buf[y * cw + x] = c;
      }
    }
    // 奥の縁：窓の枠との境の影と、その手前の、細い光
    box(0, at.counter - 1, cw, 1, BLACK);
    for (let x = 0; x < cw; x++) {
      const near = lightAt(x, at.counter);
      if (near > 0.05 || (x > at.gx0 && x < at.gx1 && (x * 5) % 7 < 4)) put(x, at.counter - 2, near > 0.2 ? ink(WARM, 4) : ink(WOOD, 3));
    }
    box(0, 0, cw, Math.max(1, S(3)), BLACK);

    // 額（横長のときだけ）：枠は、ランタンの側が光り、溝と段がある。壁に、短い影を落とす
    if (at.wide) {
      const picture = (x, y, w, h, night) => {
        const away = x + w / 2 < at.lampX ? -1 : 1;
        box(x + away * S(2), y - S(2), w, h, BLACK);
        solid(x, y, w, h, slab(w, h), timber, 0.25);
        // 段：ランタンの側と上は明るい線、反対側と下は暗い線
        const step = (m, lit, dark) => {
          box(x + m, y + m, w - 2 * m, 1, dark);
          box(x + m, y + h - 1 - m, w - 2 * m, 1, lit);
          box(away < 0 ? x + w - 1 - m : x + m, y + m, 1, h - 2 * m, lit);
          box(away < 0 ? x + m : x + w - 1 - m, y + m, 1, h - 2 * m, dark);
        };
        const m = Math.max(4, S(4));
        step(Math.max(1, S(1)), ink(WARM, 4), ink(WOOD, 1));
        step(m - 2, ink(WOOD, 1), ink(WARM, 4));
        step(m - 1, TAN, CREAM);
        // 絵：空は2段、山は3段、水に明かりが映る
        for (let j = 0; j < h - 2 * m; j++) {
          for (let i = 0; i < w - 2 * m; i++) {
            const f = j / (h - 2 * m);
            const ridge = 0.32 + 0.2 * Math.sin((i * 0.33) / k + x) + 0.09 * Math.sin((i * 0.9) / k + 2);
            const hill = 0.5 + 0.14 * Math.sin((i * 0.21) / k + 1);
            let c = f > 0.72 ? ink(COOL, night ? 1 : 2) : mixed(x + i, y + j, ink(PLUM, night ? 1 : 3), ink(COOL, night ? 1 : 2), (f - 0.5) * 4);
            if (f < hill) c = ink(PLUM, night ? 0 : 2);
            if (f < ridge) c = ink(PLUM, 1);
            if (f < 0.16) c = (i + j) % 3 === 0 ? ink(COOL, 3) : ink(COOL, 1);
            if (!night && f > 0.16 && f < 0.26 && (i * 3) % 7 < 2) c = ink(WARM, 4);
            if (!night && f < 0.14 && (i * 3) % 7 < 2 && j % 2 === 0) c = ink(WOOD, 4);
            put(x + m + i, y + m + j, c);
          }
        }
        const iw = w - 2 * m;
        const ih = h - 2 * m;
        const dotAt = (a, b, c) => put(x + m + Math.round(iw * a), y + m + Math.round(ih * b), c);
        if (night) {
          oval(x + w - m - S(5), y + h - m - S(5), Math.max(1, S(2)), Math.max(1, S(2)), SPARK);
          oval(x + w - m - S(4), y + h - m - S(4), Math.max(1, S(2)), Math.max(1, S(2)), ink(COOL, 1));
          for (const [a, b] of [[0.2, 0.86], [0.38, 0.7], [0.14, 0.62], [0.6, 0.6]]) dotAt(a, b, a < 0.3 ? SPARK : ink(COOL, 4));
        } else {
          // 月と、水に映る光の道。星。手前の岸に、木が3本
          const mx = x + m + Math.round(iw * 0.7);
          oval(mx, y + m + Math.round(ih * 0.86), Math.max(1, S(1.6)), Math.max(1, S(1.6)), CREAM);
          put(mx - 1, y + m + Math.round(ih * 0.86) + 1, SPARK);
          for (let j = 1; j < ih * 0.15; j += 2) box(mx - (j & 2 ? 1 : 0), y + m + j, 2, 1, CREAM);
          for (const [a, b] of [[0.1, 0.92], [0.3, 0.8], [0.46, 0.93], [0.92, 0.76]]) dotAt(a, b, SPARK);
          for (const [a, tall] of [[0.15, 8], [0.27, 5], [0.87, 6]]) {
            for (let j = 0; j < S(tall); j++) {
              const half = Math.round((S(tall) - j) * 0.3 * (j % 3 === 0 ? 0.5 : 1));
              box(x + m + Math.round(iw * a) - half, y + m + j, 2 * half + 1, 1, j % 3 === 2 ? ink(LEAF, 1) : ink(LEAF, 0));
            }
          }
        }
        // 壁の釘と、つり下げるひも
        const nail = y + h + S(5);
        line(x + S(3), y + h, x + (w >> 1), nail, BLACK);
        line(x + w - 1 - S(3), y + h, x + (w >> 1), nail, BLACK);
        put(x + (w >> 1), nail, SPARK);
      };
      picture(Math.round(cw * 0.882), Math.round(ch * 0.49), Math.round(cw * 0.11), Math.round(ch * 0.17), false);
      picture(Math.round(cw * 0.822), Math.round(ch * 0.41), Math.round(cw * 0.052), Math.round(ch * 0.13), true);
    }

    // ランタン：鎖、笠、6面のガラス（正面と、斜めの面が2つ見える）、金具の枠、中の炎。
    // 金具は、中の炎に照らされる：ガラスに接する縁と、笠の下の縁だけが光り、ほかは暗い。
    // 揺らして重ねるので、壁とは別の絵に描く
    {
      buf = lampLayer;
      kinds = null;
      const lx = at.lampX;
      const W = at.lampW;
      const H = at.lampH;
      const top = at.lampY + (H >> 1);
      const bottom = at.lampY - (H >> 1);
      const roofH = S(10);
      const footH = S(8);
      const bar = Math.max(1, S(1));
      // 鎖：輪が、縦と横に交互につながる。下の輪ほど、明かりを受ける
      for (let y = top + S(3), n = 0; y < ch; y += S(3), n++) {
        const lit = y < top + S(20) ? ink(WOOD, 4) : ink(WOOD, 2);
        if (n & 1) box(lx - (bar >> 1), y, bar, S(3), ink(DARK, 1));
        else {
          box(lx - bar - 1, y, bar, S(3), BLACK);
          box(lx + 1, y, bar, S(3), lit);
          box(lx - 1, y, 2, 1, ink(DARK, 1));
          box(lx - 1, y + S(3) - 1, 2, 1, lit);
        }
      }
      // 吊り輪
      box(lx - S(1), top, 2 * S(1) + 1, S(3), BLACK);
      put(lx, top + S(1), ink(WOOD, 4));
      // 笠：上のつまみと、ひさしの張った屋根。上は暗く、下の縁は、中の明かりで光る
      box(lx - S(2), top - S(2), 2 * S(2) + 1, S(2), ink(DARK, 1));
      box(lx - S(2), top - S(2), 1, S(2), ink(PLUM, 2));
      for (let j = 0; j < roofH - S(2); j++) {
        const t = j / (roofH - S(2) - 1);
        const half = Math.round(mix(W * 0.62, W * 0.2, Math.pow(t, 0.8)));
        for (let i = -half; i <= half; i++) {
          let c = i < -half * 0.45 ? ink(PLUM, 2) : i > half * 0.35 ? BLACK : ink(DARK, 1);
          if (j === 0) c = Math.abs(i) < half * 0.85 ? ink(WARM, 4) : ink(WOOD, 3);
          else if (j === 1) c = ink(WOOD, 2);
          if (Math.abs(i) === half) c = BLACK;
          put(lx + i, top - roofH + j, c);
        }
      }
      put(lx - Math.round(W * 0.3), top - roofH, SPARK);
      put(lx + Math.round(W * 0.2), top - roofH, SPARK);
      // ガラス：上が広く、下へすぼまる。正面がいちばん明るく、斜めの面は1段暗い。炎に近いほど白い
      const g0 = bottom + footH;
      const gh = top - roofH - g0;
      const halfAt = (j) => Math.round((W / 2) * mix(0.66, 1, Math.pow(j / gh, 0.8)));
      for (let j = 0; j < gh; j++) {
        const half = halfAt(j);
        const front = Math.round(half * 0.5);
        for (let i = -half; i <= half; i++) {
          const far = Math.hypot(i / (W * 0.5), (j - gh * 0.4) / (gh * 0.8));
          const face = Math.abs(i) <= front;
          put(lx + i, g0 + j, far < 0.13 ? SPARK : far < 0.3 ? ink(WARM, 5) : far < (face ? 0.62 : 0.42) ? ink(WARM, 4) : face || far < 0.7 ? ink(WOOD, 4) : ink(WOOD, 3));
        }
        // 金具の縦の桟：外の2本と、面の境の2本。炎の側の縁だけ、細く光る
        for (const side of [-1, 1]) {
          box(lx + side * half - (side > 0 ? bar - 1 : 0), g0 + j, bar, 1, BLACK);
          box(lx + side * front - (side > 0 ? bar - 1 : 0), g0 + j, bar, 1, BLACK);
          put(lx + side * (front - bar), g0 + j, ink(WARM, 5));
          put(lx + side * (half - bar), g0 + j, ink(WOOD, 4));
        }
      }
      // 斜めの飾りの桟：正面に ×、斜めの面に ＼ と ／
      // （小さく描くときは、線が込み合うので、飾りの桟は省く）
      const fTop = Math.round(halfAt(gh - 1) * 0.5);
      const fBottom = Math.round(halfAt(0) * 0.5);
      if (k >= 1.5) {
        line(lx - fBottom, g0, lx + fTop, g0 + gh - 1, BLACK);
        line(lx + fBottom, g0, lx - fTop, g0 + gh - 1, BLACK);
        line(lx - halfAt(0), g0, lx - fTop, g0 + gh - 1, BLACK);
        line(lx + halfAt(0), g0, lx + fTop, g0 + gh - 1, BLACK);
      }
      // 上と下の枠
      const rail = Math.max(2, S(2));
      box(lx - halfAt(gh - 1) - S(1), g0 + gh - 1, 2 * (halfAt(gh - 1) + S(1)) + 1, rail, BLACK);
      box(lx - halfAt(gh - 1), g0 + gh - 1, 2 * halfAt(gh - 1) + 1, 1, ink(WOOD, 4));
      // 台：広い皿（上の面が光る）、その下に、すぼまる脚と、先の玉
      const plate = Math.round(W * 0.56);
      box(lx - plate, g0 - rail, 2 * plate + 1, rail, BLACK);
      box(lx - plate + 1, g0 - 1, 2 * plate - 1, 1, ink(WARM, 4));
      box(lx - plate + 1, g0 - rail, Math.round(plate * 0.5), 1, ink(PLUM, 2));
      put(lx - Math.round(plate * 0.5), g0 - 1, SPARK);
      put(lx + Math.round(plate * 0.3), g0 - 1, SPARK);
      for (let j = 0; j < footH - rail - S(2); j++) {
        const half = Math.max(1, Math.round(plate * 0.7 * (1 - (j + 1) / (footH - rail - S(2) + 1))));
        box(lx - half, g0 - rail - 1 - j, 2 * half + 1, 1, BLACK);
        box(lx - half + 1, g0 - rail - 1 - j, Math.max(1, half >> 1), 1, ink(PLUM, 2));
      }
      oval(lx, bottom + S(1), Math.max(1, S(1)), Math.max(1, S(1)), BLACK);
      put(lx - 1, bottom + S(1) + 1, ink(WOOD, 4));
      at.flameY = g0 + Math.round(gh * 0.34);
      const reach = Math.round(W * 0.62) + 2;
      at.lamp = [Math.max(0, lx - reach), Math.max(0, bottom), Math.min(cw - 1, lx + reach), ch - 1];
      at.touch.lamp = [lx - reach, bottom, lx + reach, top + S(3)];
      buf = roomBase;
      kinds = roomKind;
    }

    // ---- テーブルの上の物。先に影を落とし、その上に物を描く
    const top0 = at.counter;
    // カップ：受け皿、本体、青い模様、取っ手。縁と取っ手に、つや
    {
      const cx = at.cupX;
      const cy = Math.round(top0 * 0.42);
      const bw = S(19);
      const bh = S(13);
      kind = 1;
      shadow(cx, cy - S(1), S(15), Math.max(2, S(3)));
      kind = 2;
      solid(cx - S(14), cy - S(3), S(28), S(6), ball(S(28), S(6)), ceramic);
      // 受け皿：手前の縁に青い線。真ん中のくぼみに、カップの影
      for (let i = -S(12); i <= S(12); i++) if ((i + 64) % 3) put(cx + i, cy - Math.round(Math.sqrt(Math.max(0, 1 - (i * i) / (S(12) * S(12)))) * S(2)), ink(COOL, i < 0 ? 2 : 3));
      oval(cx, cy + S(1), S(9), Math.max(1, S(1)), ink(WOOD, 3));
      // スプーン：受け皿の左に掛けてある。柄は、皿の外へ出て、テーブルに影を落とす
      for (let n = 0; n <= S(10); n++) {
        const sx = cx - S(12) - n;
        const sy = cy - Math.round(n * 0.4);
        put(sx, sy - 1, n > S(2) ? BLACK : TAN);
        put(sx, sy, n % Math.max(2, S(3)) === 1 ? SPARK : CREAM);
      }
      oval(cx - S(10), cy, Math.max(1, S(2.4)), Math.max(1, S(1.1)), CREAM);
      oval(cx - S(10), cy, Math.max(1, S(1.3)), Math.max(0, S(1.1) - 1), TAN);
      put(cx - S(11), cy + Math.max(1, S(1.1)) - 1, SPARK);
      // 角砂糖：受け皿の右の手前に、1つ
      box(cx + S(7), cy - S(2), S(3), S(2), CREAM);
      box(cx + S(7), cy, S(3), Math.max(1, S(0.8)), SPARK);
      box(cx + S(10) - 1, cy - S(2), 1, S(2), TAN);
      // 取っ手：輪。ランタンの側（右上）が光る
      const hx = cx + (bw >> 1) + S(2);
      const hy = cy + S(1) + Math.round(bh * 0.55);
      const r2 = S(5);
      const r1 = S(3);
      for (let j = -r2; j <= r2; j++) {
        for (let i = 0; i <= r2; i++) {
          const d = Math.hypot(i * 1.15, j);
          if (d <= r2 && d >= r1) put(hx + i, hy + j, d > r2 - 1.2 ? (j > -r2 * 0.2 ? ink(WARM, 5) : ink(PLUM, 1)) : d < r1 + 1.2 ? TAN : CREAM);
        }
      }
      put(hx + r2 - 1, hy + S(2), SPARK);
      solid(cx - (bw >> 1), cy + S(1), bw, bh, tube(bw, bh, 1, 0.62), ceramic);
      // 模様：青い山形の帯が2本
      for (const up of [0.3, 0.58]) {
        const y = cy + S(1) + Math.round(bh * up);
        const half = Math.round((bw / 2) * mix(0.62, 1, up)) - 2;
        for (let i = -half; i <= half; i++) put(cx + i, y + (Math.abs((i + 64) % 4 - 2) === 2 ? 1 : 0), i < -half * 0.25 ? ink(COOL, 2) : ink(COOL, 3));
      }
      // 2本の帯の間に、点が並ぶ
      for (let i = -Math.round(bw * 0.38); i <= bw * 0.38; i += 3) put(cx + i, cy + S(1) + Math.round(bh * 0.44), ink(COOL, 3));
      // 口：縁のつや、内側の白い壁、コーヒーの面（奥の縁に、明かりが細く映る）
      const my = cy + S(1) + bh;
      const ry = Math.max(1, S(2));
      const rx = (bw >> 1) - Math.max(1, S(1));
      oval(cx, my, bw >> 1, ry, ink(WARM, 5));
      oval(cx, my, rx, ry - 1, TAN);
      oval(cx, my - (ry > 2 ? 1 : 0), rx - (ry > 2 ? 1 : 0), Math.max(0, ry - 2), ink(WOOD, 1));
      if (ry > 2) {
        box(cx - S(4), my + ry - 4, S(5), 1, ink(WOOD, 3));
        put(cx - S(3), my + ry - 4, SPARK);
      }
      box(cx + (bw >> 1) - S(4), cy + bh + S(2) + 1, S(3), 1, SPARK);
      put(cx + S(13), cy + 1, SPARK);
      at.steamX = cx;
      at.steamY = cy + S(3) + bh;
      at.touch.cup = [cx - S(15), cy - S(4), cx + S(17), cy + bh + S(4)];
    }

    // 開いた本：手前の上から見る。紫の表紙の上に、ページの束。紙は、のど（真ん中）で沈み、左右へふくらんで、外へ下がる。
    // ランタンの側（右）のページが明るい。文字の行は、紙のふくらみに沿う。のどから、しおりのひもが手前へ垂れる
    if (cw > 70) {
      const cx = at.bookX;
      const W = S(29);
      const D = S(10);
      const T = S(3);
      const lip = Math.max(1, S(1)); // 表紙の厚み
      const y0 = Math.max(S(7), Math.round(top0 * 0.2));
      Object.assign(book, { cx, y0, W, D, T });
      kind = 1;
      shadow(cx - S(2), y0, W + S(3), Math.max(2, S(2)));
      kind = 2;
      // 表紙：ページより、ひと回り大きい。奥へ行くほど、少しすぼまる
      for (let j = 0; j <= D + lip + 1; j++) {
        const half = Math.round((W + S(2)) * (1 - BOOK_TAPER * clamp((j - lip) / D)));
        for (let i = -half; i <= half; i++) put(cx + i, y0 + j, j === 0 ? BLACK : j < lip ? ink(PLUM, i > 0 ? 3 : 2) : Math.abs(i) > half - 2 ? ink(PLUM, i > 0 ? 3 : 1) : ink(PLUM, 2));
      }
      const py0 = y0 + lip;
      for (const dir of [-1, 1]) {
        // ページの束の、手前の面（小口）：細い線が重なる
        for (let i = 0; i <= W; i++) {
          const top = Math.round(T * bookRise(i / W));
          for (let j = 0; j < top; j++) put(cx + dir * i, py0 + j, dir > 0 ? (j & 1 ? CREAM : TAN) : j & 1 ? TAN : ink(DARK, 3));
        }
        // 紙の面
        for (let line = 0; line <= D; line++) {
          const shrink = 1 - BOOK_TAPER * (line / D);
          for (let ii = 0; ii <= W; ii += 0.5) put(Math.round(cx + dir * ii * shrink), Math.round(py0 + T * bookRise(ii / W)) + line, pageInk(dir, ii / W, line, D, Math.round(ii * shrink)));
        }
      }
      // しおりのひも：のどから手前へ垂れて、テーブルの上で、少し右へ流れる。先は、切れ込み
      const wide = Math.max(2, S(1));
      const from = Math.round(py0 + T * bookRise(0));
      const long = from - y0 + S(3);
      for (let j = 0; j < long; j++) {
        const y = from - 1 - j;
        const lean = y < y0 ? Math.round((y0 - y) * 0.6) : 0;
        for (let i = 0; i < wide; i++) {
          if (j === long - 1 && wide > 2 && i === wide >> 1) continue;
          put(cx + 1 + lean + i, y, i === wide - 1 ? ink(NEON, 4) : y < y0 ? ink(NEON, 2) : ink(NEON, 3));
        }
      }
      at.touch.book = [cx - W - S(2), y0 - S(3), cx + W + S(2), py0 + T + D + 1];
      // 鉛筆：本の左に、斜めに置いてある。先は削ってあり、後ろに、金具と消しゴム。下に、細い影
      const penL = S(16);
      const penX = cx - W - S(9) - penL;
      if (at.wide && penX > at.potX + S(24)) {
        for (let n = 0; n <= penL; n++) {
          const py = y0 + S(5) - Math.round(n * 0.3);
          const back = penL - n; // 後ろの端からの距離
          const c = back < S(1.5) ? ink(NEON, 3) : back < S(2.5) ? CREAM : n < 2 ? BLACK : n < S(2.5) ? TAN : ink(WOOD, 3);
          put(penX + n, py - 1, BLACK);
          put(penX + n, py, c);
          if (n > 1) put(penX + n, py + 1, c === ink(WOOD, 3) ? ink(WOOD, 4) : c === CREAM ? SPARK : c);
        }
      }
    }

    // 置き時計：真ちゅうの丸い時計。上にベルが2つと、つち。針は、毎コマ描く（端末の時刻を指す）。
    // 本とカップの間に、置ける幅があるときだけ
    const clockR = S(6);
    const clockX = (at.bookX + S(31) + at.cupX - S(22)) >> 1;
    if (at.wide && at.cupX - at.bookX - S(53) > 2 * clockR + S(4)) {
      const cy = Math.round(top0 * 0.5);
      const my = cy + S(2) + clockR; // 文字盤のまん中
      const bell = 2 * S(2.5) + 1;
      const brass = [BLACK, ink(WOOD, 2), ink(WOOD, 4), ink(WARM, 4), SPARK];
      kind = 1;
      shadow(clockX, cy, S(7), Math.max(2, S(2)));
      kind = 2;
      for (const e of [-1, 1]) {
        line(clockX + e * S(4), cy, clockX + e * S(2.5), cy + S(3), ink(WOOD, 3));
        line(clockX + e * S(4) + 1, cy, clockX + e * S(2.5) + 1, cy + S(3), BLACK);
        solid(clockX + e * S(3.6) - (bell >> 1), my + clockR - S(2), bell, bell, ball(bell, bell), brass);
      }
      box(clockX, my + clockR, 1, S(3), BLACK);
      box(clockX - 1, my + clockR + S(3), 3, Math.max(1, S(1)), ink(WARM, 4));
      solid(clockX - clockR, my - clockR, 2 * clockR + 1, 2 * clockR + 1, ball(2 * clockR + 1, 2 * clockR + 1), brass);
      // 文字盤：白い面に、12 の目盛り（3、6、9、12 は濃い）
      const rf = clockR - Math.max(2, S(1.2));
      oval(clockX, my, rf, rf, CREAM);
      for (let n = 0; n < 12; n++) put(clockX + Math.round(Math.sin((n * TAU) / 12) * (rf - 1)), my + Math.round(Math.cos((n * TAU) / 12) * (rf - 1)), n % 3 ? TAN : BLACK);
      at.clock = [clockX, my, rf];
      at.touch.clock = [clockX - clockR - S(2), cy - S(1), clockX + clockR + S(2), my + clockR + S(5)];
    }

    // 鉢植え：受け皿と、青い模様のある鉢。葉は、毎コマ描く（風で揺れるので）
    if (cw > 110) {
      const px = at.potX;
      const py = Math.round(top0 * 0.45);
      const pw = S(24);
      const ph = S(18);
      kind = 1;
      shadow(px, py - S(1), S(16), Math.max(2, S(3)));
      kind = 2;
      solid(px - S(13), py - S(2), S(26), S(5), ball(S(26), S(5)), ceramic, 0.2);
      solid(px - (pw >> 1), py + S(1), pw, ph, tube(pw, ph, 1, 0.68), ceramic, 0.2);
      // 模様：2本の線の間に、ひし形が並ぶ
      const j0 = Math.round(ph * 0.26);
      const j1 = Math.round(ph * 0.66);
      const pitch = Math.max(4, S(5));
      for (let j = j0; j <= j1; j++) {
        const half = (pw / 2) * mix(0.68, 1, j / ph) - 2;
        for (let i = Math.ceil(-half); i < half; i++) {
          const across = Math.abs(((i + pitch * 16) % pitch) - pitch / 2);
          const along = Math.abs(j - (j0 + j1) / 2);
          if (j === j0 || j === j1 || Math.abs(across + along - (j1 - j0) * 0.32) < 0.8 || across + along < 1) put(px + i, py + S(1) + j, i < -half * 0.2 ? ink(COOL, 2) : ink(COOL, 3));
        }
      }
      solid(px - (pw >> 1) - S(1), py + S(1) + ph - S(3), pw + 2 * S(1), S(3), tube(pw + 2 * S(1), S(3), 1, 1), ceramic, 0.25);
      at.potTop = py + S(1) + ph;
      // 鉢の口：縁の内側に、土が見える
      oval(px, at.potTop, (pw >> 1) + S(1), Math.max(1, S(2)), CREAM);
      oval(px, at.potTop, (pw >> 1) + S(1) - Math.max(1, S(1)), Math.max(0, S(2) - 1), ink(WOOD, 1));
      for (let i = -(pw >> 1) + 2; i < pw >> 1; i += 3) put(px + i, at.potTop + ((i * 7) & 1), (i * 5) % 3 ? BLACK : ink(WOOD, 2));
      at.touch.plant = [px - S(34), py - S(2), px + S(34), at.potTop + S(50)];
    }

    if (at.wide) {
      // 花びん：ガラスの瓶。ランタンの側（左）に縦の強い光、右は暗い縁。水が半分。向こうが透けて見える。
      // 花は、毎コマ描く（風で揺れるので）。ここでは、瓶と、瓶の中の茎までを描く
      const vx = Math.round(cw * 0.872);
      const vy = top0 + 1;
      const vw = S(7);
      const vh = S(19);
      const water = Math.round(vh * 0.55);
      kind = 1;
      shadow(vx, top0 - S(2), S(9), Math.max(2, S(2)));
      // 瓶を通った明かりが、テーブルに小さく落ちる
      for (let i = -S(4); i <= S(1); i++) if ((i + 64) % 3) put(vx + i, top0 - S(2) - (i & 1), ink(WARM, 4));
      kind = 2;
      // 瓶の中の茎：口から底へ、交わりながら下りる。水の中は、少しずれて、暗く見える
      FLOWERS.forEach(([dx], n) => {
        const fromX = vx + Math.round(dx * 0.1 * k);
        const toX = vx - Math.round(dx * 0.3 * k) + (n % 3) - 1;
        for (let j = Math.max(1, S(1)); j < vh; j++) put(Math.round(mix(toX, fromX, j / vh)) + (j < water ? 1 : 0), vy + j, ink(LEAF, j < water ? 1 : n % 2 ? 3 : 2));
      });
      // 胴は丸く、肩ですぼまって、口が少し開く。輪郭と光だけを描き、中は向こうが透ける。水には、うっすら色がつく
      const jar = (j) => {
        const t = j / (vh - 1);
        return Math.round(vw * (t < 0.05 ? 0.86 : t < 0.6 ? 1 : t < 0.8 ? mix(1, 0.62, smoothstep(0.6, 0.8, t)) : t < 0.93 ? 0.62 : 0.74));
      };
      const gap = Math.max(2, S(1));
      for (let j = 0; j < vh; j++) {
        const half = jar(j);
        for (let i = -half; i <= half; i++) {
          let c = -1;
          const stem = Math.floor(buf[(vy + j) * cw + vx + i] / 6) === LEAF;
          if (Math.abs(i) === half || j === 0 || j === vh - 1 || Math.abs(i) > jar(j + 1) || Math.abs(i) > jar(j - 1)) c = i < 0 ? ink(TEAL, 4) : ink(TEAL, 2);
          else if (j === water) c = Math.abs(i) > half - 3 ? ink(TEAL, 4) : ink(TEAL, 3); // 水の面。縁で、少し盛り上がる
          else if (j === 1 || (j === 2 && i < 0)) c = ink(TEAL, j === 1 ? 2 : 3); // 底の、厚いガラス
          else if (i === -half + gap && j > vh * 0.12 && j < vh * 0.56) c = SPARK;
          else if (i === -half + gap + 1 && j > vh * 0.3 && j < vh * 0.5) c = ink(TEAL, 4);
          else if (i === half - gap && j > vh * 0.2 && j < vh * 0.4) c = ink(TEAL, 4);
          else if (!stem && (j < water ? (i + 2 * j) % 4 === 0 : (i * 3 + j * 5) % 11 === 0)) c = ink(TEAL, j < water ? 2 : 1);
          if (c >= 0) put(vx + i, vy + j, c);
        }
      }
      put(vx - jar(vh - 1), vy + vh - 1, SPARK);
      // 口に、ひもが結んである：輪が2つと、垂れた端が2本
      const tie = Math.round(vh * 0.86);
      box(vx - jar(tie), vy + tie, 2 * jar(tie) + 1, Math.max(1, S(0.8)), TAN);
      for (const e of [-1, 1]) {
        line(vx - S(1), vy + tie, vx - S(1) + e * S(1.2), vy + tie - S(3), CREAM);
        oval(vx - S(1) + e * S(1.5), vy + tie, Math.max(1, S(1)), Math.max(1, S(0.8)), CREAM);
      }
      put(vx - S(1), vy + tie, SPARK);
      at.vase = [vx, vy + vh];
      at.touch.flower = [vx - S(17), vy, vx + S(17), vy + vh + S(31)];
      // 本の列：背は丸みがあり、ランタンの側（左）が明るく、右は影。金の帯と、ひし形の飾り、題の札
      let bx = Math.round(cw * 0.905);
      for (const [family, tall, wide] of [[WOOD, 44, 8], [NEON, 48, 7], [COOL, 42, 8], [LEAF, 46, 7], [WOOD, 39, 9], [COOL, 45, 7]]) {
        const w = S(wide);
        const h = S(tall);
        const tone = (i) => (i === 0 ? ink(family, 4) : i < w * 0.3 ? ink(family, 3) : i < w * 0.72 ? ink(family, 2) : i === w - 1 ? BLACK : ink(family, 1));
        const gold = (i) => (i < w * 0.35 ? ink(WARM, 5) : i < w * 0.75 ? ink(WOOD, 4) : ink(WOOD, 2));
        for (let i = 0; i < w; i++) box(bx + i, top0, 1, h, tone(i));
        box(bx, top0 + h - 1, w - 1, 1, ink(family, 4));
        box(bx + 1, top0 + h, w - 2, 1, TAN); // 上に、ページの端が少し見える
        for (const up of [S(3), S(6), h - S(9), h - S(6)]) for (let i = 1; i < w - 1; i++) put(bx + i, top0 + up, gold(i));
        // 題の札と、ひし形
        // 札の中に、題の字のような、短い線が2行
        for (let j = 0; j < S(5); j++) for (let i = 2; i < w - 2; i++) put(bx + i, top0 + h - S(16) + j, j === 0 || j === S(5) - 1 ? gold(i) : (j === Math.round(S(5) * 0.35) || j === Math.round(S(5) * 0.65)) && i > 2 && i < w - 3 && (i + j + bx) % 4 ? TAN : ink(family, 0));
        const my = top0 + Math.round(h * 0.4);
        for (let j = -S(4); j <= S(4); j++) {
          const reach = Math.round((S(4) - Math.abs(j)) * 0.7);
          const mid = bx + (w >> 1);
          if (mid - reach > bx) put(mid - reach, my + j, gold(mid - reach - bx));
          if (mid + reach < bx + w - 1) put(mid + reach, my + j, gold(mid + reach - bx));
        }
        put(bx + (w >> 1), my, gold(1));
        put(bx + 1, top0 + S(3), SPARK);
        bx += w;
      }
      kind = 1;
      box(Math.round(cw * 0.905) - S(3), top0 - 1, cw, 1, BLACK);
      kind = 2;
      // 椅子の背：ほぼ黒い影。縁にだけ、細くランタンの光
      const ax0 = Math.round(cw * 0.765);
      const ax1 = Math.round(cw * 0.975);
      const ay = Math.round(ch * 0.115);
      for (let x = ax0; x <= ax1; x++) {
        const t = (x - ax0) / (ax1 - ax0);
        const arch = Math.round(ay - S(7) * (2 * t - 1) * (2 * t - 1));
        box(x, arch - S(6), 1, S(6), BLACK);
        put(x, arch, t > 0.35 ? ink(WOOD, 4) : ink(WOOD, 2));
        if (t > 0.6) put(x, arch - 1, ink(WOOD, 2));
        const slat = t > 0.05 && t < 0.95 && Math.floor(t * 9) % 2 === 1;
        if (slat || t < 0.05 || t > 0.95) box(x, 0, 1, arch - S(6), BLACK);
        if (slat && Math.floor((x + 1 - ax0) / (ax1 - ax0) * 9) % 2 === 0) box(x, 0, 1, arch - S(6), ink(WOOD, 1));
      }
    }
  };

  // つるの葉（壁の上から垂れる）。細い茎から、柄が出て、葉が付く。sway で、先のほうが左右に揺れる。ランタンに近い葉ほど、明るい。
  // 横長のときは、短いつるが、もう1本
  const vine = (sway) => {
    const dark = [BLACK, ink(LEAF, 0), ink(LEAF, 1), ink(LEAF, 2), ink(LEAF, 3)];
    const bright = [ink(LEAF, 0), ink(LEAF, 2), ink(LEAF, 3), ink(LEAF, 4), ink(LEAF, 5)];
    for (const [vx, count, reach, lead] of at.wide ? [[cw - S(8), 16, 7, 0], [cw - S(13), 6, 2.5, 2]] : [[S(7), 16, 7, 0]]) {
      const leaves = [];
      let fromX = vx;
      let fromY = ch - 1;
      for (let n = 0; n < count; n++) {
        const y = ch - S(4 + n * 3.4);
        const lean = (sway * Math.max(0, n - 5 + lead * 2)) / 10;
        const sx = vx + Math.round(Math.sin(n * 0.6 + lead) * S(1.5) + lean);
        const x = vx + Math.round(Math.sin(n * 1.9 + lead) * S(reach) + lean);
        line(fromX, fromY, sx, y + S(2), ink(LEAF, 1));
        line(sx, y + S(2), x, y, ink(LEAF, 1));
        fromX = sx;
        fromY = y + S(2);
        leaves.push([x, y, S(3 + ((n + lead) % 3)), Math.sin(n * 2.3 + lead) * 0.9 + (sway * n) / 300, (n + lead) % 3 === 0 ? dark : bright]);
      }
      for (const l of leaves) leaf(l[0], l[1], l[2], l[3], l[4]);
    }
  };

  // 花びんの花。[横, 高さ（瓶の口から。店内の物の大きさを 1 として）, 種類, 大きさ]。奥の花から、手前の花へ重ねる。
  // 種類：0 白い花、1 桃色の花、2 小花の枝、3 穂の花、4 つぼみ
  const FLOWERS = [[-12, 17, 2, 0], [11, 20, 2, 0], [2, 27, 2, 0], [-6, 25, 3, 0], [14, 13, 3, 0], [7, 28, 4, 0], [-15, 12, 4, 0], [-10, 9, 0, 3.3], [5, 18, 0, 3.5], [9, 8, 1, 3], [0, 7, 1, 2.6], [-4, 15, 0, 4]];
  // 小花の枝の、花の場所
  const SPRAY = [[0, 0], [-4, -2], [4, -1], [-2, 4], [3, 4], [-5, 3], [6, 2], [0, 7], [-3, -5], [2, -4]];
  // 花：花びらが、まわりに並ぶ。上（ランタンの側）の花びらが明るく、花びらの間は、影。
  // ramp は [花びらの影, 花びら, 明るい花びら, 芯の影, 芯, 芯の光]。形は、大きさごとに1度だけ計算して覚えておく
  const bloomCache = new Map();
  const bloom = (cx, cy, r, ramp) => {
    let cells = bloomCache.get(r);
    if (!cells) {
      const list = [];
      const count = r >= 5 ? 8 : r >= 3 ? 6 : 5;
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          const x = i / (r + 0.3);
          const y = j / (r + 0.3);
          const rho = Math.hypot(x, y);
          const lobe = Math.abs(Math.cos((Math.atan2(y, x) * count) / 2 + 0.4));
          if (rho > 0.6 + 0.4 * Math.pow(lobe, 0.6)) continue;
          list.push(i, j, rho < 0.3 ? (y > 0.05 && x < 0.1 ? 5 : y < -0.12 ? 3 : 4) : lobe < 0.3 && rho > 0.42 ? 0 : y > -0.15 ? 2 : 1);
        }
      }
      bloomCache.set(r, (cells = Int8Array.from(list)));
    }
    for (let n = 0; n < cells.length; n += 3) put(cx + cells[n], cy + cells[n + 1], ramp[cells[n + 2]]);
  };
  // gust：穴から入る風、shake：ガラスが割れたときの揺れ、age：その揺れが始まってからの秒数。花びんに触ると、もっと揺れる
  const bouquet = (gust, shake, age) => {
    if (!at.vase) return;
    const [vx, my] = at.vase;
    const since = time - vaseAt;
    const own = 2 * Math.exp(-since * 2.4);
    const white = [TAN, CREAM, SPARK, ink(WOOD, 3), ink(WARM, 4), ink(WARM, 5)];
    const pink = [ink(NEON, 2), ink(NEON, 3), ink(NEON, 4), ink(WOOD, 3), ink(WARM, 4), ink(WARM, 5)];
    kind = 2;
    FLOWERS.forEach(([dx, dy, type, size], n) => {
      const sway = ((Math.sin(time * 0.6 + n * 1.3) * (0.2 + 1.6 * gust) + shake * 0.5 * Math.sin(age * 11 + n * 2.1) + own * Math.sin(since * 11 + n * 2.1)) * dy) / 27;
      const hx = vx + Math.round((dx + sway * 1.6) * k);
      const hy = my + Math.round((dy - Math.abs(sway) * 0.3) * k);
      const sx = vx + Math.round(dx * 0.1 * k);
      // 茎：口から立ち上がって、外へしなる
      const mx = sx + (hx - sx) * 0.25;
      const mY = my + (hy - my) * 0.65;
      const green = ink(LEAF, type > 1 ? 1 : 2);
      let px = sx;
      let py = my;
      let nodeX = sx;
      let nodeY = my;
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const qx = Math.round((1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * hx);
        const qy = Math.round((1 - t) * (1 - t) * my + 2 * (1 - t) * t * mY + t * t * hy);
        line(px, py, qx, qy, green);
        if (type === 3 && i > 5) {
          // 穂の花：茎の先のほうに、小さな花が、左右に互い違いに付く。先ほど、明るい
          for (let y = py; y <= qy; y++) {
            const x = Math.round(mix(px, qx, (y - py) / Math.max(1, qy - py)));
            put(x, y, ink(PLUM, 3));
            put(x + (y & 1 ? 1 : -1), y, ink(PLUM, i > 8 ? 5 : 4));
            if (i < 9 && y % 3 === 0) put(x + (y & 1 ? -2 : 2), y, ink(PLUM, 3));
          }
        }
        if (type < 2 && i === 4) {
          // 茎の途中に、細長い葉が1枚
          const side = n % 2 ? 1 : -1;
          const long = S(5);
          for (let q = 1; q <= long; q++) {
            const wide = Math.round(Math.sin((Math.PI * q) / (long + 1)) * S(1.1));
            for (let o = -wide; o <= wide; o++) put(qx + side * q, qy + Math.round(q * 0.5) + o, ink(LEAF, o === wide ? 4 : o === -wide && wide > 0 ? 1 : 3));
          }
        }
        if (i === 7) {
          nodeX = qx;
          nodeY = qy;
        }
        px = qx;
        py = qy;
      }
      if (type < 2) bloom(hx, hy, Math.max(2, S(size)), type ? pink : white);
      else if (type === 2) {
        // 小花の枝：細い枝の先に、十字の小さな花
        for (const [ox, oy] of SPRAY) line(nodeX, nodeY, hx + Math.round(ox * k * 0.9), hy + Math.round(oy * k * 0.9), ink(LEAF, 1));
        for (const [ox, oy] of SPRAY) {
          const bx = hx + Math.round(ox * k * 0.9);
          const by = hy + Math.round(oy * k * 0.9);
          const tone = oy >= 2 ? SPARK : CREAM;
          if (k >= 1.2) {
            box(bx - 1, by, 3, 1, tone);
            box(bx, by - 1, 1, 3, tone);
          }
          put(bx, by, k >= 1.2 ? ink(WARM, 4) : tone);
        }
      } else if (type === 3) put(hx, hy + 1, ink(PLUM, 5));
      else {
        oval(hx, hy, Math.max(1, S(0.8)), Math.max(1, S(1.3)), ink(LEAF, 3));
        put(hx + 1, hy - 1, ink(LEAF, 1));
        put(hx, hy + Math.max(1, S(1.3)), CREAM);
      }
    });
  };
  // 花びらが、何枚か散る。大きな花（白と桃色）から
  const shed = (count) => {
    if (!at.vase) return;
    for (; count > 0; count--) {
      const f = FLOWERS[7 + Math.floor(rand() * 5)];
      if (petals.length >= 9) petals.shift();
      petals.push({ x: at.vase[0] + (f[0] + between(-2, 2)) * k, y: at.vase[1] + f[1] * k, land: at.counter - S(between(1.5, 6)), seed: rand() * 9, tone: f[2] ? ink(NEON, 4) : SPARK, shade: f[2] ? ink(NEON, 3) : CREAM });
    }
  };

  // 鉢植えの葉。奥の暗い葉から、手前の明るい葉へ重ねる。外の葉ほど、よく揺れる。
  // gust：穴から入る風、shake：触ったときや、ガラスが割れたときの揺れ、age：その揺れが始まってからの秒数
  const plant = (gust, shake, age) => {
    if (!at.potTop) return;
    const px = at.potX;
    const rootY = at.potTop;
    const back = [BLACK, ink(LEAF, 0), ink(LEAF, 1), ink(LEAF, 2), ink(LEAF, 3)];
    const front = [ink(LEAF, 0), ink(LEAF, 2), ink(LEAF, 3), ink(LEAF, 4), ink(LEAF, 5)];
    const leaves = [];
    kind = 2;
    for (let n = 0; n < 19; n++) {
      const a = -0.35 + ((n * 2.4) % 3.9);
      const far = S(7 + ((n * 7) % 17));
      const sway = ((Math.sin(time * 0.8 + n * 1.7) * (0.35 + 1.7 * gust) + shake * Math.sin(age * 12 + n * 2.1)) * far) / S(24);
      const lx = px + Math.round(Math.cos(a) * far * 1.25 + sway * 1.6 * k);
      const ly = rootY + S(7) + Math.round(Math.sin(a) * far * 0.85 - Math.abs(sway) * 0.3 * k);
      leaves.push([lx, ly, S(n < 7 ? 5 : 6 + (n % 2)), a - Math.PI / 2 + Math.sin(n * 1.3) * 0.5 + sway * 0.09, n < 7 ? back : front]);
      // 茎：鉢から、外へふくらんで、葉の付け根へ
      const sx = px + Math.round((lx - px) * 0.12);
      const mx = (sx + lx) / 2 + (lx - px) * 0.1;
      const my = (rootY + ly) / 2 + S(3);
      let fromX = sx;
      let fromY = rootY;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const toX = Math.round((1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * lx);
        const toY = Math.round((1 - t) * (1 - t) * rootY + 2 * (1 - t) * t * my + t * t * ly);
        line(fromX, fromY, toX, toY, n < 7 ? ink(LEAF, 1) : ink(LEAF, 2));
        fromX = toX;
        fromY = toY;
      }
    }
    for (const l of leaves) leaf(l[0], l[1], l[2], l[3], l[4]);
  };

  // 街を建て、店内を描く。同じ種なら、同じ絵になる
  const build = (w, h, seed, aspect) => {
    cw = w;
    ch = h;
    rand = dice(seed);
    cityBase = new Uint8Array(cw * ch);
    cityNow = new Uint8Array(cw * ch);
    cityOut = new Uint8Array(cw * ch * 4);
    city32 = new Uint32Array(cityOut.buffer);
    roomBase = new Uint8Array(cw * ch);
    roomNow = new Uint8Array(cw * ch);
    roomKind = new Uint8Array(cw * ch);
    kindNow = new Uint8Array(cw * ch);
    roomOut = new Uint8Array(cw * ch * 4);
    room32 = new Uint32Array(roomOut.buffer);
    lampLayer = new Uint8Array(cw * ch).fill(255);
    leafCache.clear();
    walkers = [];
    ripples = [];
    time = 0;
    nextWalker = 0.2;
    pageAt = -1;
    lampPos = lampVel = 0;
    petals = [];
    auto = null;
    vaseAt = catAway = bellAt = -100;
    at.touch = {};
    at.vase = at.cat = at.clock = null;
    at.potTop = 0;
    book.W = 0;
    layout(aspect);
    paintCity();
    paintRoom();
  };

  // 1コマ進めて、絵を作る。calm なら、人は歩かない（GPU のない機械）
  const tick = (dt, calm) => {
    time += dt;
    tickNo += 1;
    buf = cityNow;
    kinds = null;
    cityNow.set(cityBase);
    // ネオンのちらつき
    for (const s of signs) {
      s.off = s.flick > 0 && (time + s.phase) % s.flick < 0.45 && ((tickNo >> 1) & 1) === 1;
      if (s.off) for (const i of s.cells) cityNow[i] = s.dim;
    }
    // 店の中の客：座っている人の影（頭と肩）。ときどき、体を動かす。窓の桟の向こうにいる
    const seat = (x, y, w, c) => {
      for (let i = 0; i < w; i++) if (level(cityBase[y * cw + x + i]) >= 4) cityNow[y * cw + x + i] = c;
    };
    for (const s of shops) {
      for (const g of s.guests) {
        if (time >= g.next) {
          g.next = time + between(1.5, 8);
          g.lean = Math.floor(rand() * 3) - 1;
        }
        const gx = clamp(g.x + g.lean, s.wx + Z(3), s.wx + s.ww - Z(3));
        const sh = Z(2.4);
        const hr = Math.max(1, Z(1.25));
        const round = Math.max(1, Z(1.6));
        const neck = s.wy + g.tall;
        for (let y = s.wy; y < neck; y++) {
          const up = y - (neck - round);
          const half = up > 0 ? Math.round(sh * Math.sqrt(1 - (up / round) * (up / round))) : sh;
          seat(gx - half, y, 2 * half + 1, ink(WOOD, 1));
          seat(gx - half, y, 1, ink(WOOD, 2));
        }
        for (let j = -hr; j <= hr; j++) {
          const half = Math.round(hr * Math.sqrt(1 - (j * j) / (hr * hr + 0.5)));
          seat(gx - half, neck + hr + j, 2 * half + 1, ink(WOOD, 1));
        }
      }
    }
    // 窓辺の猫：外を見ている。しっぽの先を、ときどき振る。ガラスが割れると隠れて、しばらくすると、そっと顔を出す
    const back = time - catAway;
    if (at.cat && back > 3.5) {
      const q = Math.max(1, Math.round(kc * 0.55));
      const [cx, sill] = at.cat;
      const cy = sill - (back < 5.5 ? 4 * q : 0);
      const fur = (x, y, w) => {
        if (y >= sill) seat(x, y, w, ink(DARK, 1));
      };
      const hr = Math.round(q * 1.5);
      const hy = cy + 6 * q;
      // 座った体、丸い頭、とがった耳。しっぽは、体のわきで、上へ曲がる
      for (let j = 0; j < 5 * q; j++) {
        const half = Math.round(2 * q * Math.sqrt(Math.max(0, 1 - ((j - 2 * q) / (3 * q)) * ((j - 2 * q) / (3 * q)))));
        fur(cx - half, cy + j, 2 * half + 1);
      }
      for (let j = -hr; j <= hr; j++) {
        const half = Math.round(hr * Math.sqrt(1 - (j * j) / (hr * hr + 0.5)));
        fur(cx - half, hy + j, 2 * half + 1);
      }
      for (let j = 0; j <= q; j++) {
        fur(cx - hr, hy + hr + j, q);
        fur(cx + hr - q + 1, hy + hr + j, q);
      }
      for (let j = 0; j < q; j++) fur(cx + 2 * q, cy + j, 2 * q);
      for (let j = q; j < (time % 4.2 < 0.6 && tickNo & 2 ? 4 : 3) * q; j++) fur(cx + 3 * q, cy + j, q);
      // 目：明かりを受けて、小さく光る。ときどき、まばたきをする
      if (hy >= sill && time % 5.3 > 0.25) for (const e of [-1, 1]) cityNow[hy * cw + cx + e * Math.max(1, q - 1)] = ink(TEAL, 5);
    }
    // 遠くの塔の明かり：ゆっくり点滅する
    if (beacon) {
      const on = time % 2.6 < 1.3;
      put(beacon[0], beacon[1], ink(NEON, on ? 5 : 2));
      if (on) for (const [i, j] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) put(beacon[0] + i, beacon[1] + j, ink(NEON, 3));
    }
    // 煙突の煙：ゆらぎながら上って、風下へ流れ、うすくなる
    for (const [sx, sy] of stacks) {
      for (let n = 0; n < 9; n++) {
        const f = (time * 0.16 + n / 9) % 1;
        const px = sx + Math.round(f * f * Z(12) + Math.sin(f * 6 + n * 2.4) * Z(1.5));
        const py = sy + Math.round(f * Z(22));
        const r = Z(1.2) + Math.round(f * Z(2.6));
        // 煙のかたまり：まん中が濃く、縁はまばら。上へ行くほど、広がって、うすい
        for (let j = -r; j <= r; j++) {
          for (let i = -r; i <= r; i++) {
            const d = (i * i + j * j) / (r * r + 0.5);
            if (d <= 1 && (1 - f * 0.8) * (1.15 - d) * 16 > BAYER[((py + j) & 3) * 4 + ((px + i) & 3)] + 2) put(px + i, py + j, f < 0.3 ? ink(COOL, 2) : SKY + 3);
          }
        }
      }
    }
    // 日よけの縁から、しずくが落ちる
    for (const s of shops) {
      for (let n = 0; n < 4; n++) {
        const fall = (tickNo + n * 4 + s.wx) % 13;
        if (fall < 8) put(s.ax + ((n * 37 + 11) % s.aw), s.ay - 1 - fall * 2, ink(COOL, 4));
      }
    }
    // ぬれた路面：上の景色が、縦に長く映る。明るいものほど、はっきり映る。さざ波で、横にずれて、とぎれる
    const roadH = Math.max(1, curb - at.gy0);
    const wave = Math.floor(time * 3);
    const roadY0 = Math.max(0, at.gy0 - 4);
    const roadX0 = Math.max(0, at.gx0 - 5);
    const roadX1 = Math.min(cw, at.gx1 + 5);
    for (let y = roadY0; y < curb - 1; y++) {
      const deep = curb - y;
      const f = deep / roadH;
      const from = base + Math.round(deep * 0.62) + 1;
      if (from >= ch || (y * 3 + wave) % 7 === 0) continue;
      const shift = Math.round(Math.sin(y * 1.9 + time * 2.2) * (0.6 + f));
      for (let x = roadX0; x < roadX1; x++) {
        const src = cityNow[from * cw + clamp(x + shift, 0, cw - 1)];
        const l = level(src);
        if (l < 3) continue;
        const b = BAYER[(y & 3) * 4 + (x & 3)];
        if (l >= 4) {
          if ((1.15 - f) * 16 > b) cityNow[y * cw + x] = src - (f > 0.5 || b > 11 ? 2 : 1);
        } else if (b < 5 && f < 0.6) cityNow[y * cw + x] = src - 2;
      }
    }
    // 街灯とネオンは、細く、長く映る。手前へ行くほど、広がって、うすくなる
    for (const g of glints) {
      if (g.sign && g.sign.off) continue;
      const top = ink(g.family, 5);
      for (let y = curb - 2; y >= roadY0; y--) {
        const f = (curb - y) / roadH;
        if ((y * 3 + wave + g.x) % 5 === 0) continue;
        const shift = Math.round(Math.sin(y * 1.7 + time * 2.4 + g.x) * (0.5 + 1.5 * f));
        const half = g.thin + (f > 0.4 ? 1 : 0);
        for (let i = -half; i <= half; i++) {
          const x = g.x + i + shift;
          if (x < roadX0 || x >= roadX1) continue;
          if ((1.3 - f) * 16 <= BAYER[(y & 3) * 4 + (x & 3)]) continue;
          const edge = half > 0 && Math.abs(i) === half;
          cityNow[y * cw + x] = top - (g.lamp && f < 0.14 && !edge ? 0 : (edge ? 2 : 1) + (f > 0.55 ? 1 : 0));
        }
      }
    }
    // 雨が路面を打つ：小さな輪が広がって、消える
    if (dt > 0) {
      for (let n = Math.max(1, Math.round((at.gx1 - at.gx0) / 150)); n > 0; n--) {
        if (ripples.length < 28) ripples.push({ x: at.gx0 + Math.floor(rand() * (at.gx1 - at.gx0)), y: roadY0 + 2 + Math.floor(rand() * Math.max(1, curb - roadY0 - 5)), age: 0 });
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      if (r.age === 0) put(r.x, r.y, ink(COOL, 5));
      else {
        const tone = ink(COOL, r.age < 2 ? 4 : 3);
        const rx = r.age + 1;
        put(r.x - rx, r.y, tone);
        put(r.x + rx, r.y, tone);
        for (let k2 = -rx + 1; k2 < rx; k2++) {
          if (r.age < 3 || k2 & 1) put(r.x + k2, r.y - 1, tone);
          if (r.age < 2) put(r.x + k2, r.y + 1, tone);
        }
      }
      if (dt > 0 && (r.age += 1) > 3) ripples.splice(i, 1);
    }
    // 人
    if (!calm) {
      nextWalker -= dt;
      if (nextWalker <= 0 && walkers.length < 6) {
        nextWalker = between(C.people[0], C.people[1]);
        const dir = rand() < 0.5 ? 1 : -1;
        sinceFriend += 1;
        const friend = sinceFriend >= C.friend && rand() < 0.5;
        if (friend) sinceFriend = 0;
        const cloth = pick([PLUM, NEON, COOL, WOOD, TEAL]);
        const shade = pick([NEON, COOL, TEAL, PLUM, WARM]);
        walkers.push({
          x: dir > 0 ? at.gx0 - Z(16) : at.gx1 + Z(16),
          dir,
          friend,
          speed: kc * (friend ? 5 : between(5.5, 8.5)),
          step: rand() * 8,
          tall: friend ? 1 : between(0.92, 1.06),
          coat: friend ? [TAN, CREAM, SPARK] : [ink(cloth, 2), ink(cloth, 3), ink(cloth, 4)],
          um: friend ? [ink(NEON, 3), ink(NEON, 4), ink(NEON, 5)] : shade === WARM ? [TAN, CREAM, SPARK] : [ink(shade, 3), ink(shade, 4), ink(shade, 5)],
          scarf: friend ? SPARK : pick([ink(NEON, 4), ink(WARM, 5), ink(TEAL, 4), ink(COOL, 4)]),
          hair: friend ? ink(COOL, 2) : pick([ink(DARK, 2), ink(WOOD, 2), ink(PLUM, 2), ink(WOOD, 3)]),
          legs: friend ? ink(COOL, 3) : pick([ink(DARK, 3), ink(COOL, 3), ink(PLUM, 3), ink(WOOD, 3)]),
          bag: !friend && rand() < 0.55,
          long: !friend && rand() < 0.4,
          seed: Math.floor(rand() * 15),
        });
      }
      for (let i = walkers.length - 1; i >= 0; i--) {
        const p = walkers[i];
        p.x += p.dir * p.speed * dt;
        p.step += (p.speed * dt) / (2.05 * kc * p.tall);
        if (p.x < at.gx0 - Z(20) || p.x > at.gx1 + Z(20)) walkers.splice(i, 1);
      }
    }
    for (const p of walkers) walker(p, true);
    for (const p of walkers) walker(p, false);
    // 車：歩道の手前を、ゆっくり横切る。音がいちばん大きいときに、窓のまん中を通る
    if (auto) {
      auto.t += dt;
      const span = at.gx1 - at.gx0 + Z(74);
      auto.x = auto.dir > 0 ? at.gx0 - Z(54) + (auto.t / auto.seconds) * span : at.gx1 + Z(20) - (auto.t / auto.seconds) * span;
      if (auto.t >= auto.seconds) auto = null;
      else {
        motor(auto, true);
        motor(auto, false);
      }
    }
    // 雨：細い筋。明るい窓の前では見えない。街灯の下では、明かりを受けて光る
    const drip = (x, y, tone) => {
      if (x < 0 || x >= cw || y < 0 || y >= ch) return;
      if (level(cityNow[y * cw + x]) < 4) cityNow[y * cw + x] = tone;
    };
    for (let n = Math.round((C.rain * (at.gx1 - at.gx0) * (at.gy1 - at.gy0)) / 380); n > 0; n--) {
      const x = at.gx0 - 4 + Math.floor(rand() * (at.gx1 - at.gx0 + 8));
      const y = at.gy0 + Math.floor(rand() * (at.gy1 - at.gy0));
      let tone = rand() < 0.22 ? ink(COOL, 3) : ink(COOL, 2);
      for (const l of lamps) if (Math.abs(x - l.x) < Z(10) && y < l.y && y > curb && Math.abs(x - l.x) < (l.y - y) * 0.5 + Z(3)) tone = ink(WARM, 4);
      const long = 3 + Math.floor(rand() * 4);
      for (let j = 0; j < long; j++) drip(x - (j >> 2), y - j, tone);
    }
    for (let n = Math.round((C.rain * (at.gx1 - at.gx0)) / 9); n > 0; n--) put(at.gx0 + Math.floor(rand() * (at.gx1 - at.gx0)), Math.floor(rand() * base), ink(COOL, 4));
    for (let i = 0; i < cityNow.length; i++) city32[i] = lut32[cityNow[i]];

    // 店内：ランタン、炎、つるの葉、鉢の葉、花びんの花、時計の針、蛾、湯気、本のページ
    buf = roomNow;
    kinds = kindNow;
    roomNow.set(roomBase);
    kindNow.set(roomKind);
    // 穴から入る風。強さは、ゆっくり波打つ
    wind += (windGoal - wind) * Math.min(1, dt * 1.5);
    const gust = wind * (0.55 + 0.45 * Math.sin(time * 0.9) * Math.sin(time * 0.37 + 1));
    // ランタン：鎖ごと、振り子のように揺れて、しだいに止まる
    for (let left = Math.min(dt, 1.2); left > 1e-6; left -= 0.03) {
      const h = Math.min(left, 0.03);
      lampVel += (-8.4 * lampPos - 0.7 * lampVel + gust * 5 * Math.sin(time * 1.3)) * h;
      lampPos += lampVel * h;
    }
    // 本体は形を変えずに横へ動き、鎖だけが斜めになる
    kind = 1;
    const swing = Math.round(lampPos * k);
    const [bx0, by0, bx1, by1] = at.lamp;
    const ring = at.touch.lamp[3];
    for (let y = by0; y <= by1; y++) {
      const off = y <= ring ? swing : Math.round((lampPos * k * (ch - y)) / Math.max(1, ch - ring));
      for (let x = bx0; x <= bx1; x++) {
        const c = lampLayer[y * cw + x];
        if (c !== 255) put(x + off, y, c);
      }
    }
    // 炎：芯は白く、先がゆらぐ
    const fx = at.lampX + swing;
    const flare = (tickNo * 7 + Math.floor(time * 3)) % 5;
    oval(fx, at.flameY, Math.max(1, S(2)), Math.max(2, S(3)), SPARK);
    box(fx - (flare === 1 ? 1 : 0), at.flameY + S(3), 1, S(2) + (flare === 0 ? 1 : 0), SPARK);
    const leafAge = time - leafJolt.at;
    const shake = leafJolt.amp * Math.exp(-leafAge * 2.4);
    vine((Math.sin(time * 0.7) * (0.6 + 2.2 * gust) + shake * 0.6 * Math.sin(leafAge * 10)) * k);
    plant(gust, shake, leafAge);
    bouquet(gust, shake, leafAge);
    // 散った花びら：ひらひら落ちて、テーブルに残る。風が強いと、ひとりでに散る
    if (gust > 0.45 && rand() < dt * 0.1) shed(1);
    for (const p of petals) {
      const falling = p.y > p.land;
      if (falling) {
        p.y = Math.max(p.land, p.y - S(16) * dt);
        p.x += (Math.sin(time * 6 + p.seed) * S(7) - gust * S(10)) * dt;
      }
      const turn = falling && tickNo & 1;
      put(Math.round(p.x), Math.round(p.y), p.tone);
      put(Math.round(p.x) + (turn ? 0 : 1), Math.round(p.y) + (turn ? 1 : 0), p.shade);
    }
    // 置き時計の針：端末の時刻を指す。秒針は、1秒ごとに進む（止まった絵では、描かない）。触ると、ベルが鳴って、震える
    if (at.clock) {
      const [cx, cy, rf] = at.clock;
      const now = new Date();
      const sec = now.getSeconds();
      const min = now.getMinutes() + sec / 60;
      const hand = (turn, long, c, thick) => {
        const sx = Math.sin(turn * TAU);
        const sy = Math.cos(turn * TAU);
        line(cx, cy, cx + Math.round(sx * long), cy + Math.round(sy * long), c);
        if (thick) line(cx + (Math.abs(sx) > 0.7 ? 0 : 1), cy + (Math.abs(sx) > 0.7 ? 1 : 0), cx + Math.round(sx * long) + (Math.abs(sx) > 0.7 ? 0 : 1), cy + Math.round(sy * long) + (Math.abs(sx) > 0.7 ? 1 : 0), c);
      };
      hand(((now.getHours() % 12) + min / 60) / 12, rf * 0.52, BLACK, k >= 1.5);
      hand(min / 60, rf * 0.84, BLACK, false);
      if (dt > 0) hand(sec / 60, rf * 0.88, ink(NEON, 4), false);
      put(cx, cy, ink(WARM, 4));
      if (time - bellAt < 0.7) for (const e of [-1, 1]) for (let n = 0; n < 3; n++) put(cx + e * (rf + S(5)) + (tickNo & 1 ? e : 0), cy + rf + S(1) + n * 2 + (tickNo & 1), SPARK);
    }
    // 蛾：ランタンの明かりのまわりを、小さく飛び回る
    if (!calm) {
      const mx = fx + Math.round(Math.sin(time * 1.7) * S(13) + Math.sin(time * 4.9) * S(4));
      const my = at.flameY + Math.round(Math.sin(time * 2.2 + 1) * S(9) + Math.cos(time * 6.3) * S(3));
      put(mx, my, tickNo & 1 ? SPARK : CREAM);
      put(mx + (tickNo & 1 ? 1 : -1), my + 1, TAN);
    }
    // 湯気：ゆらぎながら上って、うすくなる。風があると、流される。カップに触ると、ふわっと増える
    kind = 2;
    const puff = clamp(1 - (time - puffAt) / 1.4);
    const tall = S(22 + 9 * puff);
    for (let strand = 0; strand < (puff > 0 ? 3 : 2); strand++) {
      for (let rise = 1; rise < tall; rise++) {
        const r = rise / k; // 高さ（店内の物の大きさを 1 として）
        const f = rise / tall;
        if ((r + time * 7 + strand * 2.5) % 7 > 4.4 || (1 - f) * 20 < BAYER[(rise & 3) * 4 + ((strand * 2 + tickNo) & 3)]) continue; // 筋は、とぎれながら上る。上ほど、うすい
        const sx = at.steamX + Math.round((Math.sin(r * 0.4 + time * 1.5 + strand * 2.4) * (0.5 + r * 0.13) + (strand - 0.5) * 1.6 - gust * r * 0.35) * k);
        put(sx, at.steamY + rise, f < 0.3 ? SPARK : f < 0.65 ? CREAM : TAN);
      }
    }
    // 本のページ：風で（または、触ると）1枚めくれる。のどを軸に、右から左へ。紙は、しなる
    if (pageAt >= 0 && book.W) {
      const t = (time - pageAt) / 1.15;
      if (t >= 1) pageAt = -1;
      else {
        const e = t * t * (3 - 2 * t);
        const theta = Math.PI * e;
        const lag = 0.8 * Math.sin(Math.PI * e);
        const { cx, y0, W, D, T } = book;
        const py0 = y0 + Math.max(1, S(1));
        const face = e < 0.28 ? CREAM : e < 0.5 ? TAN : e < 0.8 ? ink(WARM, 5) : e < 0.93 ? CREAM : TAN;
        const dark = face === TAN ? ink(DARK, 3) : TAN;
        const steps = 2 * W;
        let ax = 0; // 紙の上の点：のどからの横の距離と、高さ（紙の幅を 1 として）
        let ay = 0;
        for (let n = 0; n <= steps; n++) {
          const along = n / steps;
          const phi = clamp(theta + lag * (0.5 - along), 0, Math.PI);
          if (n > 0) {
            ax += Math.cos(phi) / steps;
            ay += Math.sin(phi) / steps;
          }
          const high = Math.round(py0 + Math.max(T * bookRise(0) + ay * W * 0.6, T * bookRise(Math.min(1, Math.abs(ax))) + 1));
          for (let line = 0; line <= D; line++) {
            const words = line % 3 === 1 && line > 1 && line < D - 1 && along > 0.2 && along < 0.82 && (n * 3 + line * 5) % 22 > 3;
            put(Math.round(cx + ax * W * (1 - BOOK_TAPER * (line / D))), high + line, n === steps || line === 0 || line >= D || words ? dark : face);
          }
        }
      }
    }
    // a は、0：窓のガラスの所、0.5：手前の物、1：壁・枠・テーブル
    for (let i = 0; i < roomNow.length; i++) room32[i] = ((lut32[roomNow[i]] & 0x00ffffff) | (kindNow[i] === 0 ? 0 : kindNow[i] === 2 ? 0x80000000 : 0xff000000)) >>> 0;
    return { city: cityOut, room: roomOut };
  };

  return {
    at,
    build,
    tick,
    // 本のページをめくる
    flip() {
      if (pageAt < 0) pageAt = time;
    },
    // ガラスが割れた、破片が落ちた：ランタンと葉が揺れる。strength は 0〜1
    jolt(strength) {
      if (strength >= 0.4) catAway = time; // 向かいの窓の猫が、驚いて隠れる
      lampVel = clamp(lampVel + strength * 3 * (lampVel < 0 ? -1 : 1), -3.2, 3.2);
      if (leafJolt.amp * Math.exp(-(time - leafJolt.at) * 2.4) < strength * 1.4) leafJolt = { at: time, amp: strength * 1.4 };
    },
    // 穴から入る風の強さ（0〜1）
    setWind(value) {
      windGoal = clamp(value);
    },
    // 車が1台、通りを横切る。dir：1 は左から右。seconds：横切るのにかかる秒数
    car(dir, seconds) {
      const paint = pick([NEON, TEAL, COOL, PLUM, WARM]);
      if (!auto) auto = { dir, seconds, t: 0, x: 0, tones: paint === WARM ? [TAN, CREAM, SPARK] : [ink(paint, 2), ink(paint, 3), ink(paint, 4)] };
    },
    // 店内の物に触る（x, y はマス目）。触った物の名前を返す：'lamp'、'cup'、'book'、'flower'、'plant'。何もなければ null。
    // onGlass：窓のガラスの所を触ったとき。そこでは、ガラスの手前に物（葉など）が描かれているマスだけを、物として扱う
    touch(x, y, onGlass) {
      if (x < 0 || x >= cw || y < 0 || y >= ch || (onGlass && kindNow[y * cw + x] !== 2)) return null;
      for (const name of ['lamp', 'cup', 'book', 'clock', 'flower', 'plant']) {
        const b = at.touch[name];
        if (!b || x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        if (name === 'plant' && kindNow[y * cw + x] !== 2) continue; // 葉と鉢の絵がある所だけ
        if (name === 'lamp') lampVel = clamp(lampVel + (x < at.lampX ? 6 : -6), -7, 7);
        else if (name === 'flower') {
          vaseAt = time;
          shed(2);
        } else if (name === 'clock') bellAt = time;
        else if (name === 'plant') leafJolt = { at: time, amp: 2.2 };
        else if (name === 'cup') puffAt = time;
        else if (pageAt < 0) pageAt = time;
        return name;
      }
      return null;
    },
    // 色の表を入れ替える（線形の RGB の並び）
    setInks(table) {
      table.forEach((c, i) => lut.set([toByte(c[0]), toByte(c[1]), toByte(c[2]), 255], i * 4));
    },
  };
}

// ---- 音：録音は使わず、雑音と正弦波から、その場で作る
function createSound() {
  const S = TUNE.sound;
  let ctx = null;
  let master = null;
  let outside = null; // 外の音（雨、車）。ガラス越しに、こもって聞こえる
  let muffle = null;
  let outLevel = null;
  let hush = null; // 雑音の素
  let muted = false;
  let paused = false;
  let open = 0;
  let sleepTimer = 0;
  let crowd = 0; // 砕ける音が重なりすぎないように数える
  let crowdAt = 0;
  let bornAt = 0; // 音の用意をした時刻

  const applyOpen = (tc) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    muffle.frequency.setTargetAtTime(S.muffled * Math.pow(S.open / S.muffled, open), t, tc);
    outLevel.gain.setTargetAtTime(mix(1, gain(S.rainOpen - S.rain), open), t, tc);
  };
  const shape = (type, hz, q) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  };
  const level = (value) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };
  const chain = (...nodes) => {
    for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
    return nodes[nodes.length - 1];
  };
  const loop = (buffer) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  };

  const begin = () => {
    if (ctx || muted) return;
    const Make = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Make) return;
    try {
      ctx = new Make({ latencyHint: 'interactive' });
    } catch {
      ctx = null;
      return;
    }
    const rate = ctx.sampleRate;
    // 全体：大きすぎる山だけを抑える
    const guard = ctx.createDynamicsCompressor();
    guard.threshold.value = -8;
    guard.knee.value = 6;
    guard.ratio.value = 12;
    guard.attack.value = 0.003;
    guard.release.value = 0.12;
    master = level(gain(S.level));
    chain(master, guard, ctx.destination);
    muffle = shape('lowpass', S.muffled, 0.5);
    outLevel = level(1);
    outside = level(1);
    chain(outside, muffle, outLevel, master);

    // 雑音の素（4秒）
    hush = ctx.createBuffer(1, rate * 4, rate);
    const white = hush.getChannelData(0);
    for (let i = 0; i < white.length; i++) white[i] = Math.random() * 2 - 1;

    // 雨：雑音を2つの帯で切って重ねる。高い「サー」と、低い「ザー」。強さは、ゆっくり波打つ
    const rainSource = loop(hush);
    const rain = level(gain(S.rain) * 4.5);
    chain(rainSource, shape('bandpass', 2600, 0.4), level(1), rain);
    chain(rainSource, shape('lowpass', 420, 0.6), level(1.6), rain);
    rain.connect(outside);
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.07;
    chain(gust, level(gain(S.rain) * 0.9), rain.gain);
    gust.start();
    // 店内の空気：低い、かすかな響き
    chain(rainSource, shape('lowpass', 150, 0.7), level(gain(S.room) * 9), master);
    rainSource.start();

    // ガラスを打つ雨粒：ごく短い音をばらまいた5秒を、くり返す
    const patter = ctx.createBuffer(1, rate * 5, rate);
    const taps = patter.getChannelData(0);
    for (let n = 0; n < 130; n++) {
      const at = Math.floor(Math.random() * (taps.length - rate * 0.03));
      const loud = Math.pow(Math.random(), 2.2);
      const fade = rate * (0.002 + Math.random() * 0.006);
      for (let i = 0; i < fade * 6; i++) taps[at + i] += (Math.random() * 2 - 1) * loud * Math.exp(-i / fade);
    }
    const patterSource = loop(patter);
    chain(patterSource, shape('bandpass', 1500, 0.7), level(gain(S.patter) * 7), master);
    patterSource.start();
    applyOpen(0.01);
    bornAt = performance.now();
  };

  const live = () => ctx !== null && !muted && !paused && ctx.state !== 'closed';
  const play = (fn) => {
    if (!live()) return;
    const go = () => live() && fn();
    if (ctx.state !== 'running') ctx.resume().then(() => setTimeout(go, 20), () => {});
    else if (performance.now() - bornAt < 250) setTimeout(go, 30);
    else fn();
  };
  const send = (node, pan, into) => {
    if (!ctx.createStereoPanner) return node.connect(into);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    chain(node, panner, into);
  };
  // すぐ立ち上がって、すっと消える音量
  const fall = (when, peak, seconds) => {
    const g = level(0);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.0008);
    g.gain.exponentialRampToValueAtTime(peak * 0.001, when + 0.0008 + seconds);
    return g;
  };
  // 雑音を帯で切った、短い音
  const burst = (when, seconds, type, hz, q, peak, pan) => {
    const source = ctx.createBufferSource();
    source.buffer = hush;
    send(chain(source, shape(type, hz, q), fall(when, peak, seconds)), pan, master);
    source.start(when, Math.random() * 3.5);
    source.stop(when + seconds + 0.05);
  };
  // 澄んだ音。slide を渡すと、高さがそこへ滑る
  const ring = (when, hz, seconds, peak, pan, slide = 0) => {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(hz, when);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, when + seconds);
    send(chain(osc, fall(when, peak, seconds)), pan, master);
    osc.start(when);
    osc.stop(when + seconds + 0.05);
  };

  return {
    // 最初のクリックで呼ぶ。音は、ここから先でだけ鳴る
    unlock() {
      begin();
      if (ctx && !muted && !paused && ctx.state === 'suspended') ctx.resume();
    },
    // ひびの「ピシッ」と、広がる「ミシミシ」。ticks は、ひびが伸びる時刻（秒）
    crack(pan, ticks) {
      play(() => this.crackNow(pan, ticks));
    },
    crackNow(pan, ticks) {
      const t = ctx.currentTime + 0.01;
      const k = gain(S.crack);
      burst(t, 0.004, 'highpass', 1800, 0.7, k * 1.4, pan); // 最初の一撃
      burst(t + 0.001, 0.028, 'highpass', 4200, 0.7, k * 0.9, pan); // ピシッ
      burst(t, 0.05, 'bandpass', 950, 2, k * 0.8, pan); // 板の響き
      ring(t, 190, 0.05, k * 0.7, pan, 90); // 叩いた重さ
      // ガラスの鳴り：高さの合わない音を重ねる。高いものほど、早く消える
      const base = 1900 + Math.random() * 900;
      [1, 1.47, 2.09, 2.83, 3.61].forEach((m, i) => ring(t + 0.001 * i, base * m, 0.11 - i * 0.018, (k * 0.2) / (1 + i * 0.4), pan));
      const c = gain(S.creak);
      for (const at of ticks) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const w = t + at + i * (0.008 + Math.random() * 0.022);
          burst(w, 0.005 + Math.random() * 0.01, 'bandpass', 2800 + Math.random() * 4600, 3 + Math.random() * 5, c * (1.6 + Math.random() * 2), pan);
          if (Math.random() < 0.35) ring(w, 3000 + Math.random() * 5000, 0.015 + Math.random() * 0.03, c * 0.5, pan);
        }
      }
    },
    // 破片が外れる音。size は 0〜1（大きい破片ほど低い）
    detach(pan, size) {
      if (!live()) return;
      const t = ctx.currentTime + 0.008;
      const k = gain(S.shard);
      ring(t, mix(3900, 1500, size) * (0.9 + Math.random() * 0.2), 0.05 + size * 0.07, k, pan);
      burst(t, 0.01, 'highpass', 3200, 0.7, k * 1.6, pan);
    },
    // 破片がテーブルに当たって砕ける音。木の天板が鳴り、かけらが散る
    smash(pan, size) {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      if (t - crowdAt > 0.5) crowd = 0;
      crowdAt = t;
      crowd += 1;
      const k = gain(S.smash) * mix(0.45, 1, size) * (crowd > 5 ? 0.55 : 1);
      ring(t, mix(230, 140, size), 0.07, k * 0.9, pan, 85);
      burst(t, 0.03, 'lowpass', 700, 0.6, k * 1.2, pan);
      burst(t, 0.06 + 0.1 * size, 'highpass', 2600, 0.6, k * 1.3, pan);
      if (crowd <= 12) burst(t + 0.01, 0.2 + 0.2 * size, 'bandpass', 6000, 0.9, k * 0.5, pan);
      const n = crowd > 12 ? 0 : crowd > 5 ? 1 : 2 + Math.floor(size * 6 + Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const later = Math.pow(Math.random(), 1.5) * (0.12 + 0.4 * size);
        ring(t + later, 2400 + Math.random() * 7000, 0.03 + Math.random() * 0.1, k * 0.3 * (1 - later * 1.5), pan + (Math.random() - 0.5) * 0.5);
      }
    },
    // 遠くの車：ぬれた路面を走る音が、片方から近づいて、反対へ去る
    car(dir, seconds) {
      if (!live()) return;
      const t = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = hush;
      source.loop = true;
      const band = shape('bandpass', 260, 0.7);
      band.frequency.setValueAtTime(260, t);
      band.frequency.linearRampToValueAtTime(640, t + seconds * 0.5);
      band.frequency.linearRampToValueAtTime(230, t + seconds);
      const g = level(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain(S.cars) * 9, t + seconds * 0.5);
      g.gain.linearRampToValueAtTime(0, t + seconds);
      chain(source, band, g);
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(-0.9 * dir, t);
        panner.pan.linearRampToValueAtTime(0.9 * dir, t + seconds);
        chain(g, panner, outside);
      } else g.connect(outside);
      source.start(t, Math.random() * 3);
      source.stop(t + seconds + 0.1);
    },
    // 店内の、食器のかすかな音
    clink() {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      const k = gain(S.clink);
      const pan = (Math.random() - 0.5) * 1.4;
      const hz = 2100 + Math.random() * 1300;
      ring(t, hz, 0.16, k, pan);
      ring(t + 0.07 + Math.random() * 0.08, hz * 1.19, 0.2, k * 0.7, pan);
      if (Math.random() < 0.4) ring(t + 0.5, 300, 0.05, k * 1.5, pan, 170);
    },
    // 店内の物に触れたときの、小さな音。what は 'lamp'（鎖と金具）、'cup'（焼き物）、'book'（紙）、'plant'（葉）、'flower'（花）
    touch(what, pan) {
      play(() => {
        const t = ctx.currentTime + 0.01;
        const k = gain(S.touch);
        if (what === 'cup') {
          const hz = 2300 + Math.random() * 500;
          ring(t, hz, 0.14, k, pan);
          ring(t + 0.004, hz * 1.52, 0.09, k * 0.5, pan);
        } else if (what === 'lamp') {
          for (let i = 0; i < 4; i++) burst(t + i * 0.05 + Math.random() * 0.02, 0.012, 'bandpass', 3400 + Math.random() * 1800, 5, k * 2, pan);
          ring(t, 640, 0.3, k * 0.5, pan, 600);
        } else if (what === 'book') {
          burst(t, 0.16, 'bandpass', 2600, 0.8, k * 2.4, pan);
          burst(t + 0.5, 0.05, 'bandpass', 1500, 0.9, k * 2, pan);
        } else if (what === 'clock') {
          // 置き時計のベル：2つの高い音が、こまかく交互に鳴る
          for (let i = 0; i < 9; i++) ring(t + i * 0.04, i & 1 ? 3350 : 2980, 0.06, k * 0.7, pan);
        } else {
          // 葉と花：かさかさと、こすれる音。花は、短い
          for (let i = 0; i < (what === 'flower' ? 3 : 5); i++) burst(t + i * 0.045 + Math.random() * 0.03, 0.05 + Math.random() * 0.05, 'bandpass', 4200 + Math.random() * 2200, 1.2, k * (2.2 - i * 0.3), pan);
        }
      });
    },
    // 穴の広さ（0〜1）。開くほど、外の音がはっきりする
    setOpen(value, tc = 0.35) {
      open = clamp(value);
      applyOpen(tc);
    },
    setMuted(value) {
      muted = value;
      clearTimeout(sleepTimer);
      if (!ctx) {
        if (!muted) begin();
        return;
      }
      master.gain.setTargetAtTime(muted ? 0 : gain(S.level), ctx.currentTime, 0.03);
      if (muted) sleepTimer = setTimeout(() => ctx && muted && ctx.suspend(), 250);
      else if (!paused) ctx.resume();
    },
    // 見えていない間は、音も止める
    setPaused(value) {
      paused = value;
      if (!ctx || muted) return;
      if (paused) ctx.suspend();
      else ctx.resume();
    },
    close() {
      clearTimeout(sleepTimer);
      if (ctx) ctx.close();
      ctx = null;
    },
  };
}

export function mount(root) {
  const G = TUNE.glass;
  const F = TUNE.fog;
  const D = TUNE.rain;
  const R = TUNE.room;
  const P = TUNE.perf;
  const undo = [];
  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    undo.push(() => target.removeEventListener(type, fn, options));
  };

  const doc = root.ownerDocument;
  const canvas = root.querySelector('.view');
  const paneButton = root.querySelector('.pane');
  const soundButton = root.querySelector('.sound');
  const statusEl = root.querySelector('[data-status]');
  const probe = root.querySelector('.probe');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  let still = motionQuery.matches;

  const glass = createGlass();
  const sound = createSound();
  const scene = createScene();
  const say = (text) => {
    statusEl.textContent = text;
  };

  // ---- 状態
  let clock = 0; // 動いている間だけ進む時計（秒）
  let epoch = 0; // 今のガラスが張られた時刻。ひびの時刻は、ここから数える
  let lastTouch = -1e9; // 最後に叩いた時刻
  let growUntil = 0; // ひびが走り終わって、光が落ち着く時刻
  let healT = 0; // 張り替えの進み（0 は、していない）
  let broken = false; // ひびか穴がある
  let holed = false;
  let cracksDirty = false;
  let cellsDirty = false;
  let crackMoving = false;
  let strikes = 0;
  const strikeSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const citySeed = 1 + Math.floor(Math.random() * 1e6);
  const shards = []; // 落ちている途中の破片
  const pending = []; // これから外れる破片
  const drops = []; // ガラスの外側の雨粒
  const debris = []; // テーブルに残った、ガラスのかけら
  const spots = []; // テーブルの水の跡
  const streaks = []; // 穴から吹き込む雨
  let rainDue = 0;
  let rainInDue = 0;
  let settleUntil = 0; // かけらが動き終わる時刻
  let cityDue = 0;
  let frameNo = 0;
  let nextClink = mix(TUNE.sound.clinkEvery[0], TUNE.sound.clinkEvery[1], Math.random());
  const pointer = { u: 0, v: 0, on: false };
  let mouseDown = false;

  // ---- トークンを読む
  const pixel = (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : Object.assign(doc.createElement('canvas'), { width: 1, height: 1 })).getContext('2d', { willReadFrequently: true });
  const tok = {}; // トークンの色（線形の RGB）
  const look = {}; // ガラスの色
  let motionMs = 220;
  let skyLevel = 0; // 空の明るさ（0 は夜、1 は夕方）
  const blend = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
  const readTokens = () => {
    const style = getComputedStyle(root);
    for (const name of ['bg', 'surface', 'fg', 'muted', 'accent']) {
      probe.style.color = style.getPropertyValue(`--_${name}`).trim();
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = getComputedStyle(probe).color;
      pixel.fillRect(0, 0, 1, 1);
      const d = pixel.getImageData(0, 0, 1, 1).data;
      tok[name] = [toLinear(d[0] / 255), toLinear(d[1] / 255), toLinear(d[2] / 255)];
    }
    probe.style.transitionDuration = style.getPropertyValue('--_motion').trim();
    const seconds = parseFloat(getComputedStyle(probe).transitionDuration);
    probe.style.transitionDuration = '';
    motionMs = seconds > 0 ? seconds * 1000 : 220;
    look.tint = lit(tok.surface, G.dim, G.hue);
    look.edge = lit(tok.surface, 0.03, 1.3); // ガラスの断面の、暗い緑
    look.edgeLit = lit(tok.surface, 0.9, 0.3);
    look.warm = lit(tok.bg, 0.55); // ランタンの明かり
    look.glow = blend(lit(tok.accent, 0.09), lit(tok.muted, 0.09), 0.5); // 街の明かりの、おおよその色
  };

  // 色の表を作る。木、葉、紫は、トークンの色を混ぜて作る。空の4色だけは、端末の時刻で変わる（夜は暗く、夕方は少し明るい）
  const setInks = () => {
    const T = TUNE.time;
    const date = new Date();
    const hour = date.getHours() + date.getMinutes() / 60;
    skyLevel = smoothstep(T.dawn[0], T.dawn[1], hour) * (1 - smoothstep(T.dusk[0], T.dusk[1], hour));
    const table = [];
    // 色みごとに：元の色、鮮やかさ、明るい段を暖かい色へ寄せる量
    const families = [[tok.bg, 1.5, 1], [tok.surface, 1.12, 0.3], [tok.fg, 1, 1], [tok.muted, 1.2, 0.2], [tok.accent, 1.12, 0.3], [blend(tok.bg, tok.accent, 0.24), 2.0, 1], [blend(tok.surface, tok.bg, 0.52), 2.1, 1], [blend(tok.accent, tok.muted, 0.5), 1.2, 0.5]];
    // 影の色は、元の色をただ暗くせず、紫や藍に寄せる。明るい面は、黄や橙に寄せる
    const shadowHue = blend(tok.accent, tok.muted, 0.62);
    const cool = [0.6, 0.42, 0.22, 0.06, 0, 0];
    const warm = [0, 0, 0, 0.05, 0.16, 0.3];
    for (const [base, vivid, sun] of families) SHADES.forEach((y, i) => table.push(lit(blend(blend(base, shadowHue, cool[i]), tok.bg, warm[i] * sun), y, vivid)));
    for (let n = 0; n < 4; n++) {
      // 水平線に近い帯ほど明るい。夕方は、そこにネオンの色みが少しにじむ
      const y = mix([0.012, 0.02, 0.032, 0.05][n], [0.03, 0.05, 0.08, 0.12][n], skyLevel);
      table.push(lit(tok.muted.map((v, i) => mix(mix(tok.fg[i], v, 0.75), tok.accent[i], 0.1 * n * skyLevel)), y, 1.05));
    }
    table.push(lit(tok.bg, 0.95, 0.5)); // つやの点
    table.push(lit(shadowHue, 0.003, 1)); // いちばん暗い縁と影
    table.push(lit(blend(tok.bg, shadowHue, 0.1), 0.58, 0.75)); // 白い物の、ふつうの面
    table.push(lit(blend(tok.bg, shadowHue, 0.32), 0.3, 0.85)); // 白い物の、影の面
    scene.setInks(table);
    const phase = skyLevel > 0.5 ? 'dusk' : 'night';
    if (root.getAttribute('data-phase') !== phase) root.setAttribute('data-phase', phase);
  };

  // ---- 大きさ。入れ物に合わせる
  // view：画面。cell は、ドット絵の1マスの画素数。pane：窓のガラス（x, y, w, h は画素。u0, v0, uw, vh は、画面の中の 0〜1）
  const view = { w: 0, h: 0, px: 1, aspect: 1.6, cell: 5, cw: 2, ch: 2 };
  const pane = { x: 0, y: 0, w: 2, h: 2, u0: 0, v0: 0, uw: 1, vh: 1, aspect: 1.6 };
  let renderScale = 1;
  // 画面の中の点を、ガラスの中の点（0〜1）に直す。ガラスの外（壁、枠、テーブル）なら null
  const onGlass = (u, v) => {
    const x = (u - pane.u0) / pane.uw;
    const y = (v - pane.v0) / pane.vh;
    return x > 0.004 && x < 0.996 && y > 0.004 && y < 0.996 ? [x, y] : null;
  };
  const inHole = (u, v) => holed && glass.g.faces.some((f) => f.hole && pointInPoly(u, v, f.poly));
  const tableV = () => scene.at.counter / view.ch; // テーブルの奥の縁の高さ（画面の中の 0〜1）

  // ---- WebGL
  let gl = null;
  let ready = false;
  let softwareGl = false;
  try {
    // 画素の粗い画面でだけ、破片の輪郭をなめらかにする
    gl = canvas.getContext('webgl2', { alpha: false, antialias: (devicePixelRatio || 1) < 1.5, depth: true, stencil: false, powerPreference: 'default' });
  } catch {
    gl = null;
  }
  const prog = {};
  let fillVao = null;
  let cellVao = null;
  let cellBuffer = null;
  let strip = null;
  let quad = null;
  let stampSet = null;
  let dropSet = null;
  let crackSet = null;
  let bitSet = null;
  let cityTex = null;
  let roomTex = null;
  let mist = null;
  let mapNow = null;
  let mapNext = null;
  let dropT = null;
  let crackT = null;
  let cellT = null;
  let crackCount = 0;
  let stampN = 0;
  const stampData = new Float32Array(64 * 8);
  const dropData = new Float32Array(D.max * 4);
  const bitData = new Float32Array((R.debris + R.spots + 80) * 8);

  const makeProgram = (vertex, fragment) => {
    const id = gl.createProgram();
    for (const [kind, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
      gl.attachShader(id, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(id);
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(id) || 'link');
    const at = {};
    for (let i = gl.getProgramParameter(id, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) {
      const name = gl.getActiveUniform(id, i).name;
      at[name.replace('[0]', '')] = gl.getUniformLocation(id, name);
    }
    return { id, at };
  };
  const smooth = (tex, min) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  // 描き込める絵を1枚
  const makeTarget = (w, h) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    smooth(tex, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer');
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h, many: null, store: null };
  };
  const freeTarget = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
    if (t.many) gl.deleteFramebuffer(t.many);
    if (t.store) gl.deleteRenderbuffer(t.store);
  };
  // 四角1つを、数だけ並べて描くための組
  const instanced = (corner, stride, layout) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [at, size, offset] of layout) {
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(at, 1);
    }
    gl.bindVertexArray(null);
    return { vao, buffer };
  };
  const useTex = (unit, tex) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };
  const set3 = (at, v) => gl.uniform3f(at, v[0], v[1], v[2]);

  const setup = () => {
    if (!gl) return false;
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      softwareGl = /swiftshader|llvmpipe|software/i.test(info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '');
      prog.mist = makeProgram(FILL, MIST_FRAG);
      prog.fade = makeProgram(FILL, FADE_FRAG);
      prog.stamp = makeProgram(STAMP_VERT, STAMP_FRAG);
      prog.drop = makeProgram(DROP_VERT, DROP_FRAG);
      prog.crack = makeProgram(CRACK_VERT, CRACK_FRAG);
      prog.cell = makeProgram(CELL_VERT, CELL_FRAG);
      prog.window = makeProgram(FILL, WINDOW_FRAG);
      prog.shard = makeProgram(SHARD_VERT, SHARD_FRAG);
      prog.bit = makeProgram(BIT_VERT, BIT_FRAG);
      fillVao = gl.createVertexArray();
      strip = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, strip);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      stampSet = instanced(strip, 32, [[1, 4, 0], [2, 4, 16]]);
      dropSet = instanced(quad, 16, [[1, 4, 0]]);
      crackSet = instanced(strip, 40, [[1, 4, 0], [2, 4, 16], [3, 2, 32]]);
      bitSet = instanced(quad, 32, [[1, 4, 0], [2, 4, 16]]);
      cellVao = gl.createVertexArray();
      gl.bindVertexArray(cellVao);
      cellBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cellBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      cityTex = roomTex = mist = mapNow = mapNext = dropT = crackT = cellT = null;
      return true;
    } catch (error) {
      console.warn('wallpaper-rain-window: WebGL の用意ができないので、止まった絵にする', error);
      return false;
    }
  };

  // 街と店内の絵を、テクスチャへ送る。にじませて読むための、小さい写しも作る
  const sendScene = (frame) => {
    gl.bindTexture(gl.TEXTURE_2D, cityTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, view.cw, view.ch, gl.RGBA, gl.UNSIGNED_BYTE, frame.city);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, roomTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, view.cw, view.ch, gl.RGBA, gl.UNSIGNED_BYTE, frame.room);
    gl.generateMipmap(gl.TEXTURE_2D);
  };
  const pixelArt = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(view.cw, view.ch))) + 1, gl.SRGB8_ALPHA8, view.cw, view.ch);
    smooth(tex, gl.LINEAR_MIPMAP_LINEAR);
    return tex;
  };

  // ひびと破片の絵は、割れている間だけ持つ。大きさは、窓のガラスの大きさ
  const freeBroken = () => {
    freeTarget(crackT);
    freeTarget(cellT);
    crackT = cellT = null;
  };
  const allocBroken = () => {
    if (crackT) return;
    crackT = makeTarget(pane.w, pane.h);
    cellT = makeTarget(pane.w, pane.h);
    // 穴の輪郭をなめらかにする
    const samples = softwareGl ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    if (samples > 1) {
      cellT.store = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, cellT.store);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, pane.w, pane.h);
      cellT.many = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, cellT.many);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, cellT.store);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(cellT.many);
        gl.deleteRenderbuffer(cellT.store);
        cellT.many = cellT.store = null;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    cracksDirty = true;
    cellsDirty = true;
  };

  const allocate = () => {
    for (const t of [mist, mapNow, mapNext, dropT]) freeTarget(t);
    if (cityTex) gl.deleteTexture(cityTex);
    if (roomTex) gl.deleteTexture(roomTex);
    freeBroken();
    // 絵：マス目の数は、画面の高さで決まる。配置は、縦横比で決まる
    cityTex = pixelArt();
    roomTex = pixelArt();
    scene.build(view.cw, view.ch, citySeed, view.aspect);
    setInks();
    // 窓のガラスの場所
    const A = scene.at;
    pane.x = A.gx0 * view.cell;
    pane.y = A.gy0 * view.cell;
    pane.w = Math.max(2, Math.min(view.w, A.gx1 * view.cell) - pane.x);
    pane.h = Math.max(2, Math.min(view.h, A.gy1 * view.cell) - pane.y);
    pane.u0 = pane.x / view.w;
    pane.v0 = pane.y / view.h;
    pane.uw = pane.w / view.w;
    pane.vh = pane.h / view.h;
    pane.aspect = pane.w / pane.h;
    // 人が、もう通りにいる状態から始める
    let frame = null;
    for (let i = 0; i < 90; i++) frame = scene.tick(1 / TUNE.city.hz, false);
    sendScene(frame);
    cityDue = 0;
    // くもりの元の形
    mist = makeTarget(Math.max(2, pane.w >> 1), Math.max(2, pane.h >> 1));
    gl.bindFramebuffer(gl.FRAMEBUFFER, mist.fbo);
    gl.viewport(0, 0, mist.w, mist.h);
    gl.useProgram(prog.mist.id);
    gl.uniform2f(prog.mist.at.uRes, mist.w, mist.h);
    gl.uniform1f(prog.mist.at.uSeed, (citySeed % 97) * 0.37);
    gl.uniform1f(prog.mist.at.uAspect, pane.aspect);
    gl.uniform1f(prog.mist.at.uFloor, 0);
    gl.bindVertexArray(fillVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const mw = Math.max(2, Math.round(pane.w * P.mapScale));
    const mh = Math.max(2, Math.round(pane.h * P.mapScale));
    mapNow = makeTarget(mw, mh);
    mapNext = makeTarget(mw, mh);
    dropT = makeTarget(pane.w, pane.h);
    if (broken) allocBroken();
  };

  const measure = () => {
    const box = root.getBoundingClientRect();
    const cssW = Math.max(box.width, 1);
    const cssH = Math.max(box.height, 1);
    let scale = Math.min(P.maxDpr, devicePixelRatio || 1) * renderScale;
    scale *= Math.min(1, Math.sqrt(P.maxPixels / (cssW * cssH * scale * scale)));
    const w = Math.max(2, Math.round(cssW * scale));
    const h = Math.max(2, Math.round(cssH * scale));
    if (w === view.w && h === view.h) return;
    view.w = w;
    view.h = h;
    view.aspect = cssW / cssH;
    view.px = (w / cssW) * clamp(Math.min(cssW, cssH) / 800, 0.75, 1.6);
    // マス目は、長い辺でも細かくなりすぎないようにする
    view.cell = Math.max(2, Math.round(Math.max(h, w * 0.5) / TUNE.city.rows));
    view.cw = Math.ceil(w / view.cell);
    view.ch = Math.ceil(h / view.cell);
    canvas.width = w;
    canvas.height = h;
    if (!ready) return;
    try {
      allocate();
    } catch (error) {
      console.warn('wallpaper-rain-window: 絵の置き場を作れないので、止まった絵にする', error);
      ready = false;
      root.setAttribute('data-gl', 'off');
    }
  };

  // ---- 雨粒：付く、たまる、重くなると伝い落ちて、跡を残す。場所は、ガラスの中の 0〜1
  const stamp = (ax, ay, bx, by, radius, strength, where) => {
    if (stampN >= 64) return;
    stampData.set([ax, ay, bx, by, radius, strength, where, 0], stampN * 8);
    stampN += 1;
  };
  const dropMax = () => (softwareGl ? P.soft.drops : D.max);
  // 粒を1つ足す。すでにある粒に重なったら、合わさって大きくなる
  const addDrop = (x, y, r) => {
    for (const d of drops) {
      if (Math.hypot((d.x - x) * pane.w, (d.y - y) * pane.h) / view.px < d.r + r) {
        d.r = Math.cbrt(d.r * d.r * d.r + r * r * r);
        return;
      }
    }
    if (drops.length >= dropMax()) drops.splice(Math.max(0, drops.findIndex((d) => d.v === 0)), 1);
    drops.push({ x, y, r, v: 0, goal: 0, until: 0, sway: 0, left: D.trail });
  };
  const rainStep = (dt, now) => {
    rainDue += (softwareGl ? P.soft.rate : D.rate) * dt;
    while (rainDue >= 1) {
      rainDue -= 1;
      const x = Math.random();
      const y = Math.random();
      if (!inHole(x, y)) addDrop(x, y, mix(D.size[0], D.size[1], Math.pow(Math.random(), 3.2)));
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (d.r <= D.heavy && d.v === 0) continue;
      // 重い粒は、止まったり進んだりしながら、伝い落ちる
      if (now >= d.until) {
        d.until = now + mix(0.15, 0.9, Math.random());
        d.goal = Math.random() < 0.22 ? 0 : mix(D.fall[0], D.fall[1], clamp((d.r - D.heavy) / 5 + Math.random() * 0.5));
        d.sway = (Math.random() - 0.5) * 0.3;
      }
      if (d.r < D.heavy * 0.8) d.goal = 0;
      d.v += (d.goal - d.v) * (1 - Math.exp(-dt * 6));
      if (d.v < 1 && d.goal === 0) {
        d.v = 0;
        continue;
      }
      const move = d.v * dt * view.px;
      const from = d.y;
      d.y -= move / pane.h;
      d.x += (d.sway * move) / pane.w;
      // 通った跡は、ぬれた筋になり、くもりも筋になって晴れる。どちらも、ゆっくり元に戻る
      stamp(d.x, from, d.x, d.y, d.r * view.px * 0.7, 1, 1);
      stamp(d.x, from, d.x, d.y, d.r * view.px * 0.85, 0.9, 0);
      // 跡に、小さな粒を残す。そのぶん、粒は少しずつ小さくなる
      d.left -= move / view.px;
      if (d.left <= 0 && drops.length < dropMax()) {
        d.left = D.trail * mix(0.6, 1.7, Math.random());
        const small = mix(0.7, 1.5, Math.random());
        drops.push({ x: d.x + ((Math.random() - 0.5) * d.r * view.px) / pane.w, y: from + ((d.r + small + 0.6) * view.px) / pane.h, r: small, v: 0, goal: 0, until: 0, sway: 0, left: D.trail });
        d.r = Math.cbrt(Math.max(d.r * d.r * d.r - small * small * small, 1));
      }
      // 通り道の粒を飲み込んで、大きくなる
      for (let j = drops.length - 1; j >= 0; j--) {
        const o = drops[j];
        if (o === d || o.y > d.y || Math.hypot((o.x - d.x) * pane.w, (o.y - d.y) * pane.h) / view.px > d.r + o.r * 0.6) continue;
        d.r = Math.min(Math.cbrt(d.r * d.r * d.r + o.r * o.r * o.r), 15);
        drops.splice(j, 1);
        if (j < i) i -= 1;
      }
      if (d.y < -0.01 || inHole(d.x, d.y)) drops.splice(i, 1);
    }
  };

  // ---- 描く
  // ガラスの地図を1コマ進める：拭いた跡とぬれた筋が少しずつ消え、新しい跡が書き込まれる
  const updateMap = (dt) => {
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mapNext.fbo);
    gl.viewport(0, 0, mapNext.w, mapNext.h);
    gl.useProgram(prog.fade.id);
    useTex(0, mapNow.tex);
    gl.uniform1i(prog.fade.at.uPrev, 0);
    gl.uniform2f(prog.fade.at.uStep, (255 * dt) / F.back, (255 * dt) / D.film);
    gl.uniform1f(prog.fade.at.uTick, frameNo % 1024);
    gl.bindVertexArray(fillVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (stampN > 0) {
      gl.useProgram(prog.stamp.id);
      gl.uniform2f(prog.stamp.at.uRes, pane.w, pane.h);
      gl.uniform2f(prog.stamp.at.uMapRes, mapNext.w, mapNext.h);
      gl.bindVertexArray(stampSet.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, stampSet.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, stampData.subarray(0, stampN * 8), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, stampN);
      gl.disable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      stampN = 0;
    }
    [mapNow, mapNext] = [mapNext, mapNow];
  };

  const drawDrops = () => {
    let n = 0;
    for (const d of drops) {
      dropData[n * 4] = d.x;
      dropData[n * 4 + 1] = d.y;
      dropData[n * 4 + 2] = d.r * view.px;
      dropData[n * 4 + 3] = clamp(d.v / 150, 0, 1.5);
      n += 1;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dropT.fbo);
    gl.viewport(0, 0, pane.w, pane.h);
    gl.clearColor(0.5, 0.5, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (n === 0) return;
    gl.useProgram(prog.drop.id);
    gl.uniform2f(prog.drop.at.uRes, pane.w, pane.h);
    gl.bindVertexArray(dropSet.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dropSet.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, dropData.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
  };

  const drawCells = () => {
    const data = glass.cellData(view.aspect);
    gl.bindVertexArray(cellVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cellBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cellT.many || cellT.fbo);
    gl.viewport(0, 0, pane.w, pane.h);
    gl.clearColor(0.5, 0.5, 0, 0.5);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog.cell.id);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    if (cellT.many) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cellT.many);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, cellT.fbo);
      gl.blitFramebuffer(0, 0, pane.w, pane.h, 0, 0, pane.w, pane.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    cellsDirty = false;
  };

  const drawCracks = () => {
    const C = TUNE.crack;
    const { id, at } = prog.crack;
    gl.bindVertexArray(crackSet.vao);
    if (cracksDirty) {
      const data = glass.crackData();
      crackCount = data.length / 10;
      gl.bindBuffer(gl.ARRAY_BUFFER, crackSet.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      cracksDirty = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, crackT.fbo);
    gl.viewport(0, 0, pane.w, pane.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(id);
    gl.uniform2f(at.uRes, pane.w, pane.h);
    gl.uniform1f(at.uPx, view.px);
    gl.uniform1f(at.uGlow, C.glow);
    gl.uniform1f(at.uNow, still ? 1e6 : clock - epoch);
    gl.uniform1f(at.uFlash, C.flash);
    // 重なったところは、強いほうを残す
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, crackCount);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
  };

  // 街と店内の絵は、どの描画にも共通
  const sceneUniforms = (at) => {
    useTex(0, cityTex);
    useTex(6, roomTex);
    gl.uniform1i(at.uCity, 0);
    gl.uniform1i(at.uRoom, 6);
    gl.uniform1f(at.uCellPx, view.cell);
    gl.uniform1f(at.uFine, Math.log2(Math.max(1, view.h / 190 / view.cell)));
    gl.uniform2f(at.uRes, view.w, view.h);
  };

  const drawWindow = () => {
    const C = TUNE.crack;
    const H = TUNE.heal;
    const A = scene.at;
    const { id, at } = prog.window;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.w, view.h);
    gl.useProgram(id);
    sceneUniforms(at);
    useTex(1, mapNow.tex);
    useTex(2, dropT.tex);
    useTex(3, mist.tex);
    useTex(4, broken ? cellT.tex : mist.tex);
    useTex(5, broken ? crackT.tex : mist.tex);
    gl.uniform1i(at.uMap, 1);
    gl.uniform1i(at.uDrop, 2);
    gl.uniform1i(at.uMist, 3);
    gl.uniform1i(at.uCell, 4);
    gl.uniform1i(at.uCrack, 5);
    gl.uniform1f(at.uPx, view.px);
    gl.uniform1f(at.uBroken, broken ? 1 : 0);
    gl.uniform1f(at.uFlick, flick);
    gl.uniform4f(at.uPane, pane.x, pane.y, pane.w, pane.h);
    gl.uniform4f(at.uLamp, (A.lampX + 0.5) * view.cell, A.lampY * view.cell, A.lampH * view.cell, G.reflect);
    gl.uniform2f(at.uGhost, G.ghost[0], G.ghost[1]);
    const turn = H.angle * RAD;
    gl.uniform4f(at.uHeal, healT > 0 ? Math.max(1e-4, healT * healT * (3 - 2 * healT)) : 0, H.edge * view.px, Math.cos(turn), Math.sin(turn));
    set3(at.uTint, look.tint);
    set3(at.uEdge, look.edge);
    set3(at.uEdgeLit, look.edgeLit);
    set3(at.uWarm, look.warm);
    gl.uniform4f(at.uGlassA, G.sink, F.amount, F.blur, G.warp);
    gl.uniform4f(at.uGlassB, G.soft, 0, D.lens, D.shine);
    gl.uniform4f(at.uCrackA, C.light, C.refract, C.tilt, C.edge);
    gl.bindVertexArray(fillVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // 破片の今の場所と向き。動き出しはゆっくりで、あとは重さのまま落ちる
  const place = (s) => {
    const t = clock - s.t0;
    const eased = t - s.tau * (1 - Math.exp(-t / s.tau));
    s.at[0] = s.cx + s.vx * eased;
    s.at[1] = s.cy + s.vy * eased - 0.5 * TUNE.shard.gravity * t * t;
    s.at[2] = s.vz * eased;
    const angle = s.spin * eased;
    const c = Math.cos(angle);
    const k = 1 - c;
    const sn = Math.sin(angle);
    const [x, y, z] = s.axis;
    s.rot.set([c + x * x * k, y * x * k + z * sn, z * x * k - y * sn, x * y * k - z * sn, c + y * y * k, z * y * k + x * sn, x * z * k + y * sn, y * z * k - x * sn, c + z * z * k]);
  };

  const drawShards = () => {
    const S = TUNE.shard;
    const { id, at } = prog.shard;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.w, view.h);
    gl.enable(gl.DEPTH_TEST);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(id);
    sceneUniforms(at);
    gl.uniform2f(at.uCam, pane.aspect, S.eye);
    gl.uniform4f(at.uPaneNdc, (pane.u0 + pane.uw / 2) * 2 - 1, (pane.v0 + pane.vh / 2) * 2 - 1, pane.uw, pane.vh);
    set3(at.uTint, look.tint);
    set3(at.uEdge, look.edge);
    set3(at.uEdgeLit, look.edgeLit);
    set3(at.uWarm, look.warm);
    gl.uniform1f(at.uSink, G.sink);
    gl.uniform1f(at.uBend, (S.bend * pane.h) / view.h);
    for (const s of shards) {
      gl.uniformMatrix3fv(at.uRot, false, s.rot);
      gl.uniform3f(at.uAt, s.at[0], s.at[1], s.at[2]);
      gl.bindVertexArray(s.vao);
      gl.drawArrays(gl.TRIANGLES, 0, s.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  };

  // テーブルの上の、水の跡とかけら。それから、穴から吹き込む雨
  const drawBits = () => {
    let n = 0;
    const add = (x, y, size, turn, kind, seed, alpha, squash) => {
      bitData.set([x, y, size, turn, kind, seed, alpha, squash], n * 8);
      n += 1;
    };
    for (const s of spots) add(s.x, s.y, s.size, 0, 1, s.seed, clamp((clock - s.t) * 3), 0.45);
    for (const b of debris) {
      // 砕けたかけらは、少し跳ねて、滑って、止まる
      const t = still ? 1 : clamp((clock - b.t) / b.dur);
      const e = 1 - (1 - t) * (1 - t);
      add(mix(b.x0, b.x1, e), mix(b.y0, b.y1, e) + 0.014 * Math.sin(Math.PI * t) * (1 - t), b.size, b.turn + (1 - e) * b.spin, 0, b.seed, 1, 0.42);
    }
    for (const s of streaks) add(s.x, s.y, 24, 0, 2, 0, 1, 1);
    if (n === 0) return;
    const { id, at } = prog.bit;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.w, view.h);
    gl.useProgram(id);
    gl.uniform2f(at.uRes, view.w, view.h);
    gl.uniform1f(at.uPx, view.px);
    gl.uniform1f(at.uFlick, flick);
    useTex(6, roomTex);
    gl.uniform1i(at.uRoom, 6);
    gl.uniform1f(at.uCellPx, view.cell);
    set3(at.uEdgeLit, look.edgeLit);
    set3(at.uWarm, look.warm);
    set3(at.uGlow, look.glow);
    gl.bindVertexArray(bitSet.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bitSet.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bitData.subarray(0, n * 8), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
  };

  // 1コマを描く。dt は、ガラスの地図を進める秒数
  const render = (dt) => {
    frameNo += 1;
    updateMap(dt);
    drawDrops();
    if (broken) {
      if (cellsDirty) drawCells();
      if (cracksDirty || crackMoving) {
        drawCracks();
        crackMoving = !still && clock - epoch < growUntil;
      }
    }
    drawWindow();
    if (shards.length) drawShards();
    drawBits();
  };

  // ---- 割る
  const openNow = () => 1 - Math.exp(-glass.g.holeArea / TUNE.sound.openAt);

  const freeShard = (s) => {
    gl.deleteVertexArray(s.vao);
    gl.deleteBuffer(s.vbo);
  };

  const spawn = (face, ox, oy, size, pan) => {
    const S = TUNE.shard;
    const mesh = shardMesh(face.poly, pane.aspect, S.thick, S.bevel);
    if (!(mesh.area > 0) || mesh.count === 0) return;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    for (const [at, count, offset] of [[0, 3, 0], [1, 3, 12], [2, 2, 24]]) {
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, count, gl.FLOAT, false, 32, offset);
    }
    gl.bindVertexArray(null);
    // 叩いた点から外へ、少しだけ押される
    const dx = mesh.cx - (ox - 0.5) * pane.aspect;
    const dy = mesh.cy - (oy - 0.5);
    const far = Math.hypot(dx, dy) || 1;
    const push = mix(S.push[0], S.push[1], Math.random());
    const turn = Math.random() * TAU;
    const tip = (Math.random() - 0.5) * 0.5;
    const flat = Math.sqrt(1 - tip * tip);
    const s = {
      vao,
      vbo,
      count: mesh.count,
      cx: mesh.cx,
      cy: mesh.cy,
      reach: mesh.reach,
      t0: clock,
      tau: 0.08 + 0.14 * size,
      vx: (dx / far) * push,
      vy: (dy / far) * push * 0.5,
      vz: mix(S.lean[0], S.lean[1], Math.random()),
      axis: [Math.cos(turn) * flat, Math.sin(turn) * flat, tip],
      spin: mix(S.spin[1], S.spin[0], size) * mix(0.7, 1.2, Math.random()) * (Math.random() < 0.5 ? -1 : 1),
      size,
      pan,
      at: [mesh.cx, mesh.cy, 0],
      rot: new Float32Array(9),
    };
    place(s);
    shards.push(s);
  };

  // 破片がテーブルに当たって砕ける。かけらが散って、そこに残る
  const land = (x, y, size, pan) => {
    sound.smash(pan, size);
    if (!still) scene.jolt(0.2 + 0.5 * size);
    const count = Math.round(4 + size * 13);
    for (let i = 0; i < count; i++) {
      if (debris.length >= R.debris) debris.shift();
      const wide = (0.015 + 0.07 * size) * (0.3 + Math.random());
      const way = Math.random() * TAU;
      debris.push({
        x0: x,
        y0: y,
        x1: clamp(x + (Math.cos(way) * wide) / pane.aspect, 0.01, 0.99),
        y1: clamp(y - 0.004 - Math.abs(Math.sin(way)) * wide * 0.7, 0.008, y),
        t: clock,
        dur: mix(0.16, 0.5, Math.random()),
        size: mix(2.4, 7.5, Math.pow(Math.random(), 2)) * (0.75 + 0.7 * size),
        turn: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 9,
        seed: Math.random(),
      });
    }
    settleUntil = clock + 0.55;
  };

  // 破片を1つ外す。穴が開き、破片は落ちていく
  const drop = (face, ox, oy) => {
    const S = TUNE.shard;
    const area = face.area * pane.aspect;
    const size = clamp(Math.sqrt(area) / 0.12);
    const pan = (face.cx - 0.5) * 1.4;
    if (area > S.dust) {
      if (!still && shards.length < S.max) spawn(face, ox, oy, size, pan);
      else land(pane.u0 + face.cx * pane.uw, tableV() - mix(0.02, 0.06, Math.random()), size, pan); // 動きを見せないときは、かけらだけを置く
    }
    glass.release(face);
    cracksDirty = true;
    cellsDirty = true;
    sound.detach(pan, size);
    sound.setOpen(openNow());
    scene.setWind(openNow()); // 穴から風が入る：葉とランタンが揺れ、湯気が流れる
    if (!holed) {
      holed = true;
      nextGust = clock + mix(5, 11, Math.random());
      say('ガラスが割れて、穴が開いた');
      scene.flip(); // 最初の風で、本のページが1枚めくれる
    }
  };

  // 外れる破片を見つけて、叩いた点から近い順に、少しずつ遅らせて外す
  const queue = (face, ox, oy, extra = 0) => {
    if (pending.some((q) => pointInPoly(q.x, q.y, face.poly))) return;
    const S = TUNE.shard;
    const [x, y] = glass.innerPoint(face);
    const far = Math.hypot((x - ox) * pane.aspect, y - oy);
    const wait = Math.max(face.born - (clock - epoch), 0) + mix(S.wait[0], S.wait[1], clamp(far / 0.3)) * (0.8 + 0.4 * Math.random()) + extra;
    pending.push({ x, y, at: clock + wait, ox, oy });
    pending.sort((a, b) => a.at - b.at);
  };
  const queueLoose = (ox, oy) => {
    for (const face of glass.loose(pane.aspect)) queue(face, ox, oy);
  };
  // 近くを叩いたのが bigAt 回めになったら、大きな破片を1枚、外す
  const queueBig = (hit) => {
    const C = TUNE.crack;
    let around = 0;
    for (const h of glass.g.hits) if (Math.hypot((h.x - hit.x) * pane.aspect, h.y - hit.y) < hit.reach * 1.2) around += 1;
    if (around < C.bigAt) return;
    const big = (f) => f.area * pane.aspect >= C.bigArea[0] && f.area * pane.aspect <= C.bigArea[1];
    if (glass.loose(pane.aspect).some(big)) return;
    let best = null;
    for (const f of glass.g.faces) {
      if (f.hole || f.held || !big(f) || distToPoly(hit.x, hit.y, f.poly, pane.aspect) > hit.reach * 0.9) continue;
      if (!best || f.area > best.area) best = f;
    }
    if (best) queue(best, hit.x, hit.y, 0.2);
  };

  // 動きを減らす設定のとき：外れる破片を、その場で全部外す（落ちる動きは見せない）
  const dropAllNow = () => {
    for (const q of pending.splice(0)) {
      const face = glass.faceAt(q.x, q.y);
      if (face && !face.hole && !face.held) drop(face, q.ox, q.oy);
    }
    for (let guard = 0; guard < 600; guard++) {
      const face = glass.loose(pane.aspect)[0];
      if (!face) break;
      drop(face, face.cx, face.cy);
    }
  };

  // ---- 張り替え：破片が戻るのではなく、新しいガラスが張られる。テーブルのかけらと水の跡も消える
  const clearMaps = () => {
    for (const t of [mapNow, mapNext]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const finishHeal = () => {
    glass.reset();
    pending.length = 0;
    for (const s of shards) freeShard(s);
    shards.length = 0;
    drops.length = 0;
    debris.length = 0;
    spots.length = 0;
    streaks.length = 0;
    stampN = 0;
    broken = false;
    holed = false;
    healT = 0;
    growUntil = 0;
    crackMoving = false;
    epoch = clock;
    clearMaps();
    freeBroken();
    sound.setOpen(0);
    scene.setWind(0);
    say('新しいガラスが入った');
  };

  let stillHeal = 0;
  // glassOnly：キーボードで叩いたとき。店内の物には触らず、ガラスだけを叩く
  const hit = (cu, cv, glassOnly = false) => {
    sound.unlock();
    const spot = ready ? onGlass(cu, cv) : null;
    // 店内の物は、触ると動く：ランタンは揺れ、葉はざわめき、カップは湯気が立ち、本はページがめくれる
    const what = ready && !still && !glassOnly ? scene.touch(Math.floor((cu * view.w) / view.cell), Math.floor((cv * view.h) / view.cell), spot !== null) : null;
    if (what) {
      sound.touch(what, cu * 2 - 1);
      wakeNow();
      return;
    }
    if (!spot) return; // 割れるのは、窓のガラスだけ。壁、枠、テーブルは割れない
    const [u, v] = spot;
    if (healT > 0) finishHeal();
    // 点ごとに種を変える。同じ形は二度と出ない
    strikes += 1;
    const rand = dice(strikeSeed + Math.imul(strikes, 0x9e3779b1) + Math.floor(u * 8191) * 131 + Math.floor(v * 8191) * 524287);
    const made = glass.strike(u, v, pane.aspect, still ? -1000 : clock - epoch, rand);
    lastTouch = clock;
    if (!made) return; // 穴の中を叩いた
    if (!broken) {
      broken = true;
      allocBroken();
    }
    cracksDirty = true;
    cellsDirty = true;
    crackMoving = true;
    growUntil = made.last + TUNE.crack.flash * 6;
    sound.crack((u - 0.5) * 1.4, still ? [] : [0.012, 0.03, 0.055, 0.09, ...made.ticks]);
    if (!still) scene.jolt(0.45); // 叩いた響きで、ランタンと葉が揺れる
    say(holed ? 'ガラスのひびが広がった' : 'ガラスにひびが入った');
    queueLoose(u, v);
    queueBig(glass.g.hits[glass.g.hits.length - 1]);
    if (still) {
      dropAllNow();
      render(0);
      clearTimeout(stillHeal);
      stillHeal = setTimeout(() => {
        if (!still || !ready || !broken) return;
        finishHeal();
        rainStill();
        render(0);
      }, TUNE.heal.after * 1000);
    } else wakeNow();
  };

  // ---- 1コマ進める
  let flick = 0; // ランタンの明かりの揺らぎ（0 を中心に、±0.1 ほど）
  let nextCar = 6;
  let nextGust = 0; // 次に、風が強く吹き込む時刻
  const advance = (dt) => {
    clock += dt;
    flick = 0.045 * Math.sin(clock * 1.9) + 0.03 * Math.sin(clock * 4.7 + 1.3) + 0.018 * Math.sin(clock * 11.3);
    rainStep(dt, clock);

    // 街と店内は、決まったコマ数で動く。GPU のない機械では、ゆっくり動かし、人は歩かせない
    cityDue += dt;
    const step = 1 / (softwareGl ? P.soft.cityHz : TUNE.city.hz);
    if (cityDue >= step) {
      cityDue = Math.min(cityDue - step, step);
      sendScene(scene.tick(step, softwareGl));
    }

    // 外れる破片
    let dropped = null;
    while (pending.length && pending[0].at <= clock) {
      const q = pending.shift();
      const face = glass.faceAt(q.x, q.y);
      if (!face || face.hole || face.held) continue;
      dropped = [face.cx, face.cy];
      drop(face, q.ox, q.oy);
    }
    // 周りが穴になって、支えを失った破片も続いて落ちる
    if (dropped) queueLoose(dropped[0], dropped[1]);

    // 落ちた破片は、砕ける。窓のそばで外れたものは窓の下の枠に、手前へ倒れたものはテーブルに当たる
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      place(s);
      const near = TUNE.shard.eye / (TUNE.shard.eye - s.at[2]);
      const floor = mix(pane.v0 - 0.012, tableV() - 0.04, clamp(s.at[2] / 0.1));
      if (pane.v0 + (0.5 + (s.at[1] - s.reach * 0.3) * near) * pane.vh > floor) continue;
      land(clamp(pane.u0 + (0.5 + (s.at[0] * near) / pane.aspect) * pane.uw, 0.01, 0.99), floor, s.size, s.pan);
      freeShard(s);
      shards.splice(i, 1);
    }

    // 穴の所だけ、手前を大きく明るい雨の筋が落ち、テーブルに小さな水の跡ができる
    if (holed) {
      rainInDue += R.rainIn * Math.min(glass.g.holeArea / 0.02, 3) * dt;
      const holes = glass.g.faces.filter((f) => f.hole);
      while (rainInDue >= 1 && holes.length) {
        rainInDue -= 1;
        const face = holes[Math.floor(Math.random() * holes.length)];
        const a = glass.innerPoint(face);
        const b = face.poly[Math.floor(Math.random() * face.poly.length)];
        const t = Math.random() * 0.85;
        if (streaks.length < 60) streaks.push({ x: pane.u0 + mix(a[0], b[0], t) * pane.uw, y: pane.v0 + mix(a[1], b[1], t) * pane.vh, vx: (Math.random() - 0.35) * 0.06, vy: -mix(0.9, 1.4, Math.random()), end: tableV() - 0.012 - Math.random() * 0.08 });
      }
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y > s.end) continue;
      streaks.splice(i, 1);
      if (spots.length < R.spots) spots.push({ x: clamp(s.x, 0.01, 0.99), y: s.end, size: mix(1.8, 4.6, Math.random()), seed: Math.random(), t: clock });
      else {
        const old = spots[Math.floor(Math.random() * spots.length)];
        old.size = Math.min(old.size * 1.06, 9);
      }
    }

    // 穴が開いている間は、ときどき風が強く吹き込んで、本のページがめくれる
    if (holed && healT === 0 && clock >= nextGust) {
      nextGust = clock + mix(6, 15, Math.random());
      scene.flip();
      sound.touch('book', scene.at.bookX / view.cw * 2 - 1);
    }

    // 店内の食器のかすかな音と、遠くを通る車の音
    if (clock >= nextClink) {
      nextClink = clock + mix(TUNE.sound.clinkEvery[0], TUNE.sound.clinkEvery[1], Math.random());
      sound.clink();
    }
    if (clock >= nextCar) {
      // 遠くを通る車の音。ときどき、目の前の通りを、車がゆっくり横切る（GPU のない機械では、音だけ）
      const dir = Math.random() < 0.5 ? 1 : -1;
      const near = !softwareGl && Math.random() < 0.45;
      const seconds = near ? mix(7.5, 9.5, Math.random()) : mix(3.5, 5.5, Math.random());
      nextCar = clock + (near ? seconds : 0) + mix(7, 22, Math.random());
      sound.car(dir, seconds);
      if (near) scene.car(dir, seconds);
    }

    // 触らないまま時間がたったら、新しいガラスを張る
    if (healT > 0) {
      healT += dt / Math.max(0.2, (motionMs * TUNE.heal.time) / 1000);
      sound.setOpen(openNow() * (1 - clamp(healT)), 0.1);
      if (healT >= 1) finishHeal();
    } else if (broken && !shards.length && !pending.length && clock - lastTouch > TUNE.heal.after) {
      healT = 1e-4;
    }
  };

  // 動きを減らす設定のとき：雨粒を、ある程度たまった状態にして止める
  const rainStill = () => {
    drops.length = 0;
    for (let t = 0; t < D.settle; t += 0.05) rainStep(0.05, t - D.settle);
    stampN = 0;
  };

  // ---- 描く間隔。触っていない間は、1秒に idleFps コマまで。割れている間だけ、画面の速さで描く
  let raf = 0;
  let timer = 0;
  let visible = true;
  let pageShown = !doc.hidden;
  let lastFrame = performance.now();
  let inksAt = 0;
  let slow = 0;
  const busy = () => crackMoving || shards.length > 0 || pending.length > 0 || healT > 0 || clock < settleUntil;
  const running = () => visible && pageShown && ready && !still;
  const idleGap = () => 1000 / (softwareGl ? P.soft.idleFps : P.idleFps);

  const frame = () => {
    raf = 0;
    if (!running()) return;
    const now = performance.now();
    const gap = now - lastFrame;
    const active = busy();
    if (!active && gap < idleGap() - 1) {
      schedule();
      return;
    }
    lastFrame = now;
    const dt = Math.min(0.1, gap / 1000);
    advance(dt);
    if (now - inksAt > 60000) {
      inksAt = now;
      setInks();
    }
    render(dt);
    // 重い機械では、絵の細かさを下げる
    if (active && !softwareGl && gap < 200) {
      slow = gap > 22 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 40 && renderScale > P.minScale) {
        renderScale = Math.max(P.minScale, renderScale - 0.15);
        slow = 0;
        measure();
      }
    }
    schedule();
  };
  const schedule = () => {
    if (raf || timer || !running()) return;
    // 画面の書き換えは、止まっていた後では、動き出すのに1コマぶん遅れることがある。そのぶん、早めに起きる
    const wait = busy() ? 0 : idleGap() - (performance.now() - lastFrame) - 20;
    if (wait <= 1) raf = requestAnimationFrame(frame);
    else {
      timer = setTimeout(() => {
        timer = 0;
        if (!raf && running()) raf = requestAnimationFrame(frame);
      }, wait);
    }
  };
  const halt = () => {
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = 0;
    timer = 0;
  };
  // 叩かれたら、待たずにすぐ描く
  const wakeNow = () => {
    clearTimeout(timer);
    timer = 0;
    schedule();
  };
  // 止まった絵を1枚描く
  let stillRaf = 0;
  const paintStill = () => {
    stillRaf = 0;
    if (!ready || !visible || !pageShown) return;
    setInks();
    sendScene(scene.tick(0, softwareGl));
    render(0);
  };
  const resume = () => {
    if (!ready) return;
    lastFrame = performance.now();
    if (still) paintStill();
    else schedule();
  };

  // ---- 叩く、拭く
  const toPane = (event) => {
    const b = canvas.getBoundingClientRect();
    return [(event.clientX - b.left) / Math.max(b.width, 1), 1 - (event.clientY - b.top) / Math.max(b.height, 1)];
  };

  // マウスは、押した瞬間に割れる。指は、動かさずに離したとき（スクロールの邪魔をしない）
  listen(paneButton, 'pointerdown', (event) => {
    mouseDown = event.pointerType === 'mouse';
    if (mouseDown && event.button === 0) hit(...toPane(event));
  });
  listen(paneButton, 'click', (event) => {
    if (event.detail === 0) hit(pane.u0 + pane.uw * mix(0.2, 0.8, Math.random()), pane.v0 + pane.vh * mix(0.3, 0.8, Math.random()), true);
    else if (!mouseDown) hit(...toPane(event));
  });

  // カーソル：くもりを拭く。絵は動かさない
  const trackPointer = (event) => {
    const [u, v] = toPane(event);
    const spot = ready ? onGlass(u, v) : null;
    if (spot) {
      // 前の場所から今の場所まで、ひと拭き。離れすぎていたら、つなげない
      const joined = pointer.on && Math.hypot((spot[0] - pointer.u) * pane.aspect, spot[1] - pointer.v) < 0.3;
      stamp(joined ? pointer.u : spot[0], joined ? pointer.v : spot[1], spot[0], spot[1], F.wipe * view.px, 1, 0);
      pointer.on = true;
      pointer.u = spot[0];
      pointer.v = spot[1];
    } else pointer.on = false;
    if (still) {
      if (ready && !stillRaf) stillRaf = requestAnimationFrame(() => {
        stillRaf = 0;
        render(0);
      });
    } else schedule();
  };
  listen(root, 'pointermove', trackPointer);
  listen(root, 'pointerdown', trackPointer);
  listen(root, 'pointerleave', () => {
    pointer.on = false;
  });

  listen(soundButton, 'click', () => {
    const muted = soundButton.getAttribute('aria-pressed') !== 'true';
    soundButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
    sound.setMuted(muted);
    if (!muted) sound.unlock();
  });

  // ---- 見えていないときは、絵も音も止める
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    sound.setPaused(!visible || !pageShown);
    if (visible) resume();
    else halt();
  });
  io.observe(root);
  listen(doc, 'visibilitychange', () => {
    pageShown = !doc.hidden;
    sound.setPaused(!visible || !pageShown);
    if (pageShown) resume();
    else halt();
  });

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      measure();
      resume();
    }, P.resizeWait);
  });
  ro.observe(root);

  listen(motionQuery, 'change', () => {
    still = motionQuery.matches;
    halt();
    if (still && ready) {
      // 動いていたものを片づけて、止まった絵にする
      for (const s of shards) freeShard(s);
      shards.length = 0;
      streaks.length = 0;
      crackMoving = broken;
      if (healT > 0) finishHeal();
      if (broken) dropAllNow();
    }
    resume();
  });
  listen(schemeQuery, 'change', () => {
    readTokens();
    setInks();
    resume();
  });
  // 止まった絵でも、時刻が進めば、空の色を変える
  const minute = setInterval(() => {
    if (still) paintStill();
    else if (!ready) setInks();
  }, 60000);

  const releaseGl = () => {
    if (!gl) return;
    for (const name of Object.keys(prog)) gl.deleteProgram(prog[name].id);
    for (const t of [mist, mapNow, mapNext, dropT, crackT, cellT]) freeTarget(t);
    if (cityTex) gl.deleteTexture(cityTex);
    if (roomTex) gl.deleteTexture(roomTex);
    for (const s of shards) freeShard(s);
    shards.length = 0;
    for (const set of [stampSet, dropSet, crackSet, bitSet]) {
      if (!set) continue;
      gl.deleteVertexArray(set.vao);
      gl.deleteBuffer(set.buffer);
    }
    for (const buffer of [strip, quad, cellBuffer]) if (buffer) gl.deleteBuffer(buffer);
    for (const vao of [fillVao, cellVao]) if (vao) gl.deleteVertexArray(vao);
    cityTex = roomTex = mist = mapNow = mapNext = dropT = crackT = cellT = null;
  };

  listen(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
    halt();
  });
  listen(canvas, 'webglcontextrestored', () => {
    shards.length = 0;
    ready = setup();
    if (ready) {
      view.w = 0;
      measure();
    }
    if (ready) {
      root.removeAttribute('data-gl');
      resume();
    } else root.setAttribute('data-gl', 'off');
  });

  // ---- 組み立て
  readTokens();
  setInks();
  ready = setup();
  if (ready && softwareGl) renderScale = P.soft.scale;
  if (ready) measure();
  if (ready) {
    // 雨が、もうしばらく降っていた状態から始める
    rainStill();
    render(0);
    resume();
  } else {
    root.setAttribute('data-gl', 'off');
  }

  return () => {
    halt();
    if (stillRaf) cancelAnimationFrame(stillRaf);
    clearTimeout(resizeTimer);
    clearTimeout(stillHeal);
    clearInterval(minute);
    visible = false;
    ready = false;
    io.disconnect();
    ro.disconnect();
    for (const off of undo) off();
    pending.length = 0;
    drops.length = 0;
    sound.close();
    if (gl) {
      releaseGl();
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  };
}
