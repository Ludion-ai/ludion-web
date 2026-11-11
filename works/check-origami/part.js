// part.js — ESモジュール。rootの中だけを触る
// 折り鶴のチェック：正方形の紙が、本物の手順で折れていき、鶴になる。
//
// 折り：紙を「折り目で区切った三角形の集まり」として持ち、手順ごとに、折り線で頂点を鏡映する。
//       三角折り → 小さな三角折り → つぶし折り（表、裏）→ 花弁折り（表、裏）→ 細く折る → 首と尾の中割り → 頭の中割り → 翼を下ろす。
// 途中：頂点を弧で動かしたあと、辺の長さを紙の長さへ戻す。紙は伸びない。起動時に全コマを焼いておき、動かすときは読むだけ。
// 絵：  WebGL2。左上からの光の影（影の地図）、面ごとの明るさ、繊維の凹凸、折り目の跡は、すべて紙の座標に貼りつく。
// 色：  JS に色を書かない。机は --_bg、紙の表は --_surface、紙の裏は --_accent から読む。

const S2 = Math.SQRT2;
const R2 = Math.SQRT1_2;
const HY = 1 - S2; // 花弁折りの蝶番の高さ
const PD = 2 - S2; // 中心から蝶番までの、本の折り目の上の距離
const TIP = -S2; // 下の角が集まる場所
const N11 = Math.tan(Math.PI / 16); // 22.5° の半分の傾き
const NECK_H = 0.27; // 蝶番から、首と尾の折り返しまで
const STAGES = 10;
const SUBFRAMES = 10;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rad = (deg) => (deg * Math.PI) / 180;

// 小さな折りの場所。下の4角が集まった形（正方基本形）
const prelim = (u, v) => {
  if (u >= 0 && v <= 0) return [R2 * (u + v), R2 * (v - u)];
  if (u <= 0 && v >= 0) return [R2 * (u + v), R2 * (u - v)];
  if (u <= 0 && v <= 0) return [-R2 * Math.abs(u - v), R2 * (u + v)];
  return [R2 * Math.abs(u - v), -R2 * (u + v)];
};

// ---------------------------------------------------------------- 折りの手順を、頂点の場所の列にする
function buildCrane() {
  const V = [];
  let F = [];
  const arcs = [new Map()];
  let cur = 0;
  const EPS = 1e-6;

  const addV = (u, v) => {
    V.push({ u, v, p: [[R2 * (u - v), R2 * (u + v), 0]] });
    return V.length - 1;
  };
  const O = addV(0, 0);
  const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(([u, v]) => addV(u, v));
  const [E, B, FF, C, G, D, H, A] = ring;
  ring.forEach((a, i) => F.push({ v: [O, a, ring[(i + 1) % 8]], z: [0], tag: null }));

  const stage = () => {
    for (const q of V) q.p.push(q.p[cur].slice());
    for (const f of F) f.z.push(f.z[cur]);
    cur += 1;
    arcs[cur] = new Map();
  };
  const centroid = (f, get) => (get(V[f.v[0]]) + get(V[f.v[1]]) + get(V[f.v[2]])) / 3;
  const cu = (f) => centroid(f, (q) => q.u);
  const cv = (f) => centroid(f, (q) => q.v);
  const px = (f) => centroid(f, (q) => q.p[cur][0]);
  const py = (f) => centroid(f, (q) => q.p[cur][1]);
  const near = (u, v) => V.findIndex((q) => Math.abs(q.u - u) < 1e-5 && Math.abs(q.v - v) < 1e-5);
  const has = (i) => (f) => f.v.includes(i);
  const keyOf = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);

  let cutBeforeMove = false; // 切ってから頂点を動かす手順では、その手順の間、切り口は動かない
  // 折り線で三角形を切る。折り線の上に新しい頂点ができる。隣の三角形にも同じ頂点を入れて、すき間を作らない
  const split = (select, ox, oy, dx, dy) => {
    const cache = new Map();
    const side = (i) => {
      const q = V[i].p[cur];
      const s = (q[0] - ox) * dy - (q[1] - oy) * dx;
      return Math.abs(s) < EPS ? 0 : s;
    };
    const cut = (a, b, t) => {
      const k = keyOf(a, b);
      if (cache.has(k)) return cache.get(k);
      const qa = V[a];
      const qb = V[b];
      V.push({
        pa: a,
        pb: b,
        pt: t,
        born: cur - (cutBeforeMove ? 1 : 0),
        u: mix(qa.u, qb.u, t),
        v: mix(qa.v, qb.v, t),
        p: qa.p.map((q, i) => [mix(q[0], qb.p[i][0], t), mix(q[1], qb.p[i][1], t), mix(q[2], qb.p[i][2], t)]),
      });
      cache.set(k, V.length - 1);
      return V.length - 1;
    };
    const out = [];
    const fan = (poly, f) => {
      for (let i = 1; i < poly.length - 1; i++) out.push({ v: [poly[0], poly[i], poly[i + 1]], z: f.z.slice(), tag: f.tag });
    };
    for (const f of F) {
      if (!select(f)) {
        out.push(f);
        continue;
      }
      const s = f.v.map(side);
      const pos = [];
      const neg = [];
      let crossed = false;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        if (s[i] >= 0) pos.push(f.v[i]);
        if (s[i] <= 0) neg.push(f.v[i]);
        if (s[i] * s[j] < 0) {
          const m = cut(f.v[i], f.v[j], s[i] / (s[i] - s[j]));
          pos.push(m);
          neg.push(m);
          crossed = true;
        }
      }
      if (!crossed) {
        out.push(f);
        continue;
      }
      fan(pos, f);
      fan(neg, f);
    }
    // 切られなかった隣の三角形にも、辺の上の頂点を入れる
    F = out;
    for (let changed = true; changed; ) {
      changed = false;
      const next = [];
      for (const f of F) {
        let done = false;
        for (let i = 0; i < 3 && !done; i++) {
          const a = f.v[i];
          const b = f.v[(i + 1) % 3];
          const c = f.v[(i + 2) % 3];
          const m = cache.get(keyOf(a, b));
          if (m !== undefined && m !== c) {
            next.push({ v: [a, m, c], z: f.z.slice(), tag: f.tag }, { v: [m, b, c], z: f.z.slice(), tag: f.tag });
            done = true;
            changed = true;
          }
        }
        if (!done) next.push(f);
      }
      F = next;
    }
  };

  const setXY = (i, x, y, how) => {
    const q = V[i].p[cur];
    if (Math.hypot(q[0] - x, q[1] - y) > 1e-6) arcs[cur].set(i, how);
    q[0] = x;
    q[1] = y;
  };
  const reflect = (i, ox, oy, dx, dy, how) => {
    const q = V[i].p[cur];
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const t = (q[0] - ox) * ux + (q[1] - oy) * uy;
    setXY(i, 2 * (ox + ux * t) - q[0], 2 * (oy + uy * t) - q[1], how);
  };

  // 1. 三角に折る
  stage();
  for (const f of F) if (py(f) > 0) f.z[cur] = 1;
  V.forEach((q, i) => {
    if (q.p[cur][1] > EPS) setXY(i, q.p[cur][0], -q.p[cur][1], { s: 1 });
  });

  // 2. もう一度、三角に折る
  stage();
  for (const f of F) if (px(f) < 0) f.z[cur] = 3 - f.z[cur];
  V.forEach((q, i) => {
    if (q.p[cur][0] < -EPS) setXY(i, -q.p[cur][0], q.p[cur][1], { s: 1 });
  });

  // 3. 表をつぶして、四角にする
  stage();
  for (const f of F) if (cu(f) < 0 && cv(f) > 0) f.z[cur] = 4;
  V.forEach((q, i) => {
    if ((q.u <= EPS && q.v >= -EPS) || (q.u < 0 && q.v < 0 && q.v >= q.u - EPS)) {
      const [x, y] = prelim(q.u, q.v);
      setXY(i, x, y, { s: 1 });
    }
  });

  // 4. 裏をつぶす
  stage();
  for (const f of F) if (cu(f) > 0 && cv(f) < 0) f.z[cur] = -1;
  V.forEach((q, i) => {
    const [x, y] = prelim(q.u, q.v);
    setXY(i, x, y, { s: -1 });
  });

  // 花弁折りの折り線を入れて、面に名前をつける
  // 斜めを先に切ると、三角形のまま割れて、余分な頂点ができない
  split((f) => px(f) < 0, 0, TIP, HY, 1);
  split((f) => px(f) > 0, 0, TIP, -HY, 1);
  split(() => true, 0, HY, 1, 0);
  for (const f of F) {
    const u = cu(f);
    const v = cv(f);
    const a = Math.abs(u);
    const b = Math.abs(v);
    const q = u < 0 ? (v < 0 ? 'A' : 'D') : v < 0 ? 'B' : 'C';
    const region = a + b < PD ? 'top' : (a > PD && b < (a - PD) / (1 - PD)) || (b > PD && a < (b - PD) / (1 - PD)) ? 'out' : 'mid';
    const front = q === 'D' || ((q === 'A' || q === 'C') && v > u);
    f.tag = { q, region, g: front ? 1 : -1 };
  }
  const PH = near(-PD, 0);
  const PE = near(0, -PD);
  const QF = near(PD, 0);
  const QG = near(0, PD);

  // 5. 表の花弁折り
  stage();
  for (const f of F) {
    if (f.tag.q === 'D' && f.tag.region !== 'top') f.z[cur] = f.tag.region === 'mid' ? 5 : 6; // 外側の三角は花弁の手前。奥へ回すと、紙が紙を貫く
    if (f.tag.q === 'A' && f.tag.g > 0 && f.tag.region === 'out') f.z[cur] = 4;
    if (f.tag.q === 'C' && f.tag.g > 0 && f.tag.region === 'out') f.z[cur] = 3;
  }
  setXY(D, 0, PD, { s: 1 });
  setXY(H, 0, HY, { s: 1 });
  setXY(G, 0, HY, { s: 1 });

  // 6. 裏の花弁折り
  stage();
  for (const f of F) {
    if (f.tag.q === 'B' && f.tag.region !== 'top') f.z[cur] = f.tag.region === 'mid' ? -2 : -3;
    if (f.tag.q === 'A' && f.tag.g < 0 && f.tag.region === 'out') f.z[cur] = -1;
    if (f.tag.q === 'C' && f.tag.g < 0 && f.tag.region === 'out') f.z[cur] = 0;
  }
  setXY(B, 0, PD, { s: -1 });
  setXY(E, 0, HY, { s: -1 });
  setXY(FF, 0, HY, { s: -1 });

  // 7. 下の角を細く折る
  stage();
  cutBeforeMove = true;
  const narrow = (vertex, tip, dx, pz, tuck, s) => {
    split(has(vertex), 0, TIP, dx, 1);
    for (const f of F) {
      if (!f.v.includes(vertex)) continue;
      f.z[cur] = f.v.includes(tip) ? 2 * pz - f.z[cur] : tuck;
    }
    reflect(vertex, 0, TIP, dx, 1, { s });
  };
  narrow(PH, A, -N11, 4.5, 4.5, 1);
  narrow(PE, A, -N11, -1.5, -1.5, -1);
  narrow(QG, C, N11, 3.5, 4.5, 1);
  narrow(QF, C, N11, -0.5, -1.5, -1);

  // 8. 首と尾を、中割りで起こす
  stage();
  const Yp = HY - NECK_H;
  const neckFrom = V.length;
  const reverse = (tip, ox, oy, deg, hi, lo) => {
    const dx = Math.cos(rad(deg));
    const dy = Math.sin(rad(deg));
    split(has(tip), ox, oy, dx, dy);
    for (const f of F) {
      if (!f.v.includes(tip)) continue;
      const z = f.z[cur];
      f.z[cur] = f.tag.g > 0 ? 1.55 + 0.1 * (hi - z) : 1.45 - 0.1 * (z - lo);
    }
    reflect(tip, ox, oy, dx, dy, { pivot: [ox, oy] });
  };
  reverse(A, 0, Yp, 19, 6, -3);
  reverse(C, 0, Yp, -16, 5, -2);

  // 9. 頭を折る
  stage();
  {
    const q = V[A].p[cur];
    const len = Math.hypot(q[0], q[1] - Yp);
    const ux = q[0] / len;
    const uy = (q[1] - Yp) / len;
    const ox = q[0] - ux * 0.2;
    const oy = q[1] - uy * 0.2;
    const neckDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
    const deg = (198 + neckDeg) / 2;
    const dx = Math.cos(rad(deg));
    const dy = Math.sin(rad(deg));
    split(has(A), ox, oy, dx, dy);
    for (const f of F) {
      if (f.v.includes(A)) f.z[cur] = f.z[cur] > 1.5 ? 3.4 - f.z[cur] : 2.6 - f.z[cur];
    }
    reflect(A, ox, oy, dx, dy, { pivot: [ox, oy] });
  }

  // 紙の長さの表
  const edgeMap = new Map();
  F.forEach((f, fi) => {
    for (let i = 0; i < 3; i++) {
      const a = f.v[i];
      const b = f.v[(i + 1) % 3];
      const k = keyOf(a, b);
      if (!edgeMap.has(k)) edgeMap.set(k, { a, b, faces: [] });
      edgeMap.get(k).faces.push(fi);
    }
  });
  const edges = [...edgeMap.values()];
  const eA = new Int32Array(edges.map((e) => e.a));
  const eB = new Int32Array(edges.map((e) => e.b));
  const eL = new Float32Array(edges.map((e) => Math.hypot(V[e.a].u - V[e.b].u, V[e.a].v - V[e.b].v)));
  const relax = (pos, rounds) => {
    for (let r = 0; r < rounds; r++) {
      for (let e = 0; e < eA.length; e++) {
        const a = eA[e] * 3;
        const b = eB[e] * 3;
        const dx = pos[b] - pos[a];
        const dy = pos[b + 1] - pos[a + 1];
        const dz = pos[b + 2] - pos[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const k = (0.5 * (d - eL[e])) / d;
        pos[a] += dx * k;
        pos[a + 1] += dy * k;
        pos[a + 2] += dz * k;
        pos[b] -= dx * k;
        pos[b + 1] -= dy * k;
        pos[b + 2] -= dz * k;
      }
    }
  };

  // 10. 翼を下ろし、体をふくらませて、立体にする
  stage();
  const groupOf = (q) => {
    const e = 1e-5;
    const { u, v } = q;
    if (Math.abs(u) < e && Math.abs(v) < e) return 0;
    if (u > -e && v < e) return -1;
    if (u < e && v > -e) return 1;
    if (Math.abs(u - v) < e) return 0;
    return v > u ? 1 : -1;
  };
  const wingOf = new Int8Array(V.length);
  for (const f of F) {
    if ((f.tag.q === 'D' || f.tag.q === 'B') && f.tag.region !== 'top') {
      for (const i of f.v) wingOf[i] = f.tag.q === 'D' ? 1 : -1;
    }
  }
  const WING = rad(62);
  const rootZ = (x) => 0.03 + 0.14 * Math.max(0, 1 - Math.abs(x) / 0.22);
  const flapW = new Float32Array(V.length);
  V.forEach((q, i) => {
    const p = q.p[cur];
    const x = p[0];
    const y = p[1] - HY;
    const g = groupOf(q);
    // 細く折ったときに折り込んだ角は、胴に沿わせる。翼と一緒に回すと、胴から面がはがれる
    const tucked = i === PH || i === PE || i === QG || i === QF;
    if (wingOf[i] !== 0 && y > 1e-3 && !tucked) {
      p[1] = HY + y * Math.cos(WING);
      p[2] = wingOf[i] * (rootZ(x) + y * Math.sin(WING));
      flapW[i] = wingOf[i] * (0.65 + 0.35 * clamp(y));
    } else if (i === A || i === C) {
      p[2] = 0;
    } else if (i >= neckFrom) {
      p[2] = g * 0.016;
    } else if (y >= 0) {
      p[2] = g * rootZ(x) * (1 - clamp(y / 0.4142));
    } else {
      p[2] = g * (rootZ(x) * (1 - clamp(-y / NECK_H)) + 0.006);
    }
  });
  {
    const pos = new Float32Array(V.length * 3);
    V.forEach((q, i) => pos.set(q.p[cur], i * 3));
    relax(pos, 400);
    V.forEach((q, i) => {
      q.p[cur][0] = pos[i * 3];
      q.p[cur][1] = pos[i * 3 + 1];
      q.p[cur][2] = pos[i * 3 + 2];
    });
    // 翼の付け根：下の層（外側の三角）を、上の層（花弁）の真下へそろえる。突き抜けると白い裏が見える
    const roles = new Map();
    for (const f of F) {
      if ((f.tag.q !== 'D' && f.tag.q !== 'B') || f.tag.region === 'top') continue;
      for (const i of f.v) {
        const r = roles.get(i) ?? { q: f.tag.q, mid: false, out: false };
        if (f.tag.region === 'mid') r.mid = true;
        else r.out = true;
        roles.set(i, r);
      }
    }
    const before = cur - 1;
    for (const [i, r] of roles) {
      if (!r.out || r.mid || Math.abs(V[i].p[before][1] - HY) > 1e-4) continue;
      for (const [j, o] of roles) {
        if (!o.mid || o.q !== r.q) continue;
        const a = V[i].p[before];
        const b = V[j].p[before];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-4) continue;
        const t = V[j].p[cur];
        V[i].p[cur] = [t[0], t[1] - 0.012, t[2]];
        break;
      }
    }
    // 折り込んだ角は、翼の付け根の下、胴の中へ入れる。翼の上に出ない
    for (const i of [PH, PE, QG, QF]) {
      const g = groupOf(V[i]);
      V[i].p[cur] = [V[i].p[cur][0] * 0.4, HY - 0.085, g * 0.055];
    }
    for (const f of F) {
      const tuck = [PH, PE, QG, QF].find((i) => f.v.includes(i));
      if (tuck !== undefined && !f.v.includes(A) && !f.v.includes(C)) f.zFinal = groupOf(V[tuck]) > 0 ? 5.5 : -2.5;
    }
  }

  // ---- 全コマを焼く
  const nv = V.length;
  const frames = new Float32Array((STAGES * SUBFRAMES + 1) * nv * 3);
  const pos = new Float32Array(nv * 3);
  for (let k = 1; k <= STAGES; k++) {
    for (let n = k === 1 ? 0 : 1; n <= SUBFRAMES; n++) {
      const t = n / SUBFRAMES;
      for (let i = 0; i < nv; i++) {
        // 後の手順で足した頂点は、生まれる前は親の2頂点の間にある。面が剛体のまま動く
        if (V[i].born !== undefined && k <= V[i].born) {
          const pa = V[i].pa * 3;
          const pb = V[i].pb * 3;
          const pt = V[i].pt;
          pos[i * 3] = mix(pos[pa], pos[pb], pt);
          pos[i * 3 + 1] = mix(pos[pa + 1], pos[pb + 1], pt);
          pos[i * 3 + 2] = mix(pos[pa + 2], pos[pb + 2], pt);
          continue;
        }
        const a = V[i].p[k - 1];
        const b = V[i].p[k];
        const how = arcs[k]?.get(i);
        let x = mix(a[0], b[0], t);
        let y = mix(a[1], b[1], t);
        let z = mix(a[2], b[2], t);
        if (how && how.s) {
          // 折り線のまわりの弧：鏡映は、半回転と同じ
          const cx = (a[0] + b[0]) / 2;
          const cy = (a[1] + b[1]) / 2;
          const c = Math.cos(Math.PI * t);
          x = cx + (a[0] - cx) * c;
          y = cy + (a[1] - cy) * c;
          z = how.s * (Math.hypot(a[0] - b[0], a[1] - b[1]) / 2) * Math.sin(Math.PI * t);
        } else if (how && how.pivot) {
          const [ox, oy] = how.pivot;
          const from = Math.atan2(a[1] - oy, a[0] - ox);
          let delta = Math.atan2(b[1] - oy, b[0] - ox) - from;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          const r = Math.hypot(a[0] - ox, a[1] - oy);
          x = ox + r * Math.cos(from + delta * t);
          y = oy + r * Math.sin(from + delta * t);
          z = 0;
        }
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;
      }
      if (n > 0 && n < SUBFRAMES) relax(pos, 22);
      frames.set(pos, ((k - 1) * SUBFRAMES + n) * nv * 3);
    }
  }

  // ---- 面の情報
  const nf = F.length;
  const tri = new Int32Array(nf * 3);
  F.forEach((f, i) => tri.set(f.v, i * 3));
  const uv = new Float32Array(nv * 2);
  V.forEach((q, i) => {
    uv[i * 2] = q.u;
    uv[i * 2 + 1] = q.v;
  });
  const orient = (f, k) => {
    const [a, b, c] = f.v.map((i) => V[i].p[k]);
    return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) || 1;
  };
  // 層の厚み：面の法線の向きに、どれだけずらすか
  const layer = new Float32Array(nf * (STAGES + 1));
  for (let k = 0; k <= STAGES; k++) {
    const src = Math.min(k, STAGES - 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of F) {
      lo = Math.min(lo, f.z[src]);
      hi = Math.max(hi, f.z[src]);
    }
    const mid = (lo + hi) / 2;
    F.forEach((f, i) => {
      const z = k === STAGES && f.zFinal !== undefined ? f.zFinal : f.z[src];
      layer[i * (STAGES + 1) + k] = (z - mid) * orient(f, src);
    });
  }

  // 同じ層でつながる面は、ずらし量を共有する。面の間に割れができない
  const groups = new Map();
  const corner = new Int32Array(nf * 3);
  F.forEach((f, i) => {
    const sig = f.z.join(',');
    f.v.forEach((vertex, c) => {
      const key = vertex + '|' + sig;
      if (!groups.has(key)) groups.set(key, groups.size);
      corner[i * 3 + c] = groups.get(key);
    });
  });
  const groupCount = new Float32Array(groups.size);
  corner.forEach((g) => {
    groupCount[g] += 1;
  });
  // 折り終わると、白い面はすべて内側に入る。すき間から白がのぞいてうるさくならないよう、薄い染めの色に寄せる
  const hide = new Float32Array(nf).fill(0.86);

  // 折り目：向きが変わる辺だけ。三角形に割っただけの辺は、紙の上に跡を残さない
  const creases = [];
  for (const e of edges) {
    if (e.faces.length < 2) continue;
    const [f, g] = [F[e.faces[0]], F[e.faces[1]]];
    let folded = false;
    for (let k = 1; k < STAGES && !folded; k++) folded = orient(f, k) !== orient(g, k);
    if (folded) creases.push([V[e.a].u, V[e.a].v, V[e.b].u, V[e.b].v, (e.a * 7 + e.b * 13) % 2 ? 1 : -1]);
  }

  // ほどいた紙に残るわずかな凹凸
  const crumple = new Float32Array(nv);
  const curl = new Float32Array(nv);
  V.forEach((q, i) => {
    const h = Math.sin(q.u * 127.1 + q.v * 311.7) * 43758.5453;
    crumple[i] = (h - Math.floor(h) - 0.5) * 0.02;
    curl[i] = Math.pow(Math.max(Math.abs(q.u), Math.abs(q.v)), 7) * 0.035;
  });

  return { nv, nf, tri, uv, frames, layer, creases, crumple, curl, flapW, corner, groupCount, hide };
}

// ---------------------------------------------------------------- シェーダー
const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler2DShadow;
`;

const VS_SCREEN = `${HEAD}
out vec2 vUV;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.);
  vUV = p * .5 + .5;
  gl_Position = vec4(p, 0., 1.);
}`;

// 和紙の素：R 細かな凹凸、G 粒、B 大きなむら、A 繊維（あとから線で描き足す）
const FS_PULP = `${HEAD}
in vec2 vUV;
out vec4 o;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p, int n) {
  float a = .5, s = 0.;
  for (int i = 0; i < n; i++) {
    s += a * noise(p);
    p = mat2(1.62, 1.18, -1.18, 1.62) * p + 11.3;
    a *= .5;
  }
  return s;
}
void main() {
  vec2 p = vUV * 2048.;
  float pulp = fbm(p / 26., 5);
  float pores = fbm(p / 5.5, 3);
  float grain = hash(p);
  float cloud = fbm(vUV * 9., 5);
  o = vec4(pulp * .34 + pores * .22, grain * .5 + pores * .5, cloud, 0.);
}`;

const VS_FIBER = `${HEAD}
layout(location = 0) in vec2 aP;
void main() { gl_Position = vec4(aP * 2. - 1., 0., 1.); }`;

const FS_FIBER = `${HEAD}
uniform float uK;
out vec4 o;
void main() { o = vec4(uK * .5, 0., 0., uK); }`;

const VS_CREASE = `${HEAD}
layout(location = 0) in vec3 aP;
out float vS;
void main() { vS = aP.z; gl_Position = vec4(aP.xy, 0., 1.); }`;

const FS_CREASE = `${HEAD}
in float vS;
uniform vec2 uSign;
out vec4 o;
void main() {
  float s = 1. - abs(vS);
  o = vec4(uSign * s * s * (3. - 2. * s), 0., 1.);
}`;

const VS_DEPTH = `${HEAD}
layout(location = 0) in vec3 aP;
uniform mat4 uLight;
void main() { gl_Position = uLight * vec4(aP, 1.); }`;

const FS_DEPTH = `${HEAD}
void main() {}`;

// 影：遮るものの高さでぼけ幅を変える。地面に触れるところは鋭く、離れるほどやわらかい
const SHADOW = `
uniform sampler2D uShadow;
uniform sampler2DShadow uShadowCmp;
uniform mat4 uLight;
uniform float uPenK;
uniform float uTexel;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
const vec2 POI[16] = vec2[](
  vec2(-.942, -.399), vec2(.946, -.769), vec2(-.094, -.929), vec2(.345, .294),
  vec2(-.916, .458), vec2(-.815, -.879), vec2(-.383, .277), vec2(.975, .756),
  vec2(.443, -.975), vec2(.537, -.474), vec2(-.265, -.419), vec2(.792, .191),
  vec2(-.241, .997), vec2(-.814, .914), vec2(.199, .786), vec2(.144, -.141));
float shadowAt(vec3 P, float search, out float reach) {
  vec3 s = (uLight * vec4(P, 1.)).xyz * .5 + .5;
  reach = 0.;
  if (s.x < 0. || s.x > 1. || s.y < 0. || s.y > 1.) return 1.;
  float a = ign(gl_FragCoord.xy) * 6.2832;
  float ca = cos(a), sa = sin(a);
  mat2 r = mat2(ca, sa, -sa, ca);
  float zb = 0., nb = 0.;
  for (int i = 0; i < 16; i += 2) {
    float d = texture(uShadow, s.xy + r * POI[i] * search).r;
    if (d < s.z) { zb += d; nb += 1.; }
  }
  if (nb < .5) return 1.;
  zb /= nb;
  reach = s.z - zb;
  float pen = clamp(reach * uPenK, uTexel * 1.4, search);
  float sum = 0.;
  for (int i = 0; i < 16; i++) {
    sum += texture(uShadowCmp, vec3(s.xy + r * POI[i] * pen, s.z));
  }
  return sum / 16.;
}
vec3 display(vec3 c, vec2 frag) {
  // 明るさだけを抑える。色相を保つので、朱が桃色に飛ばない
  float m = max(c.r, max(c.g, c.b));
  if (m > .78) c *= (.78 + (m - .78) / (1. + (m - .78) * 2.4)) / m;
  c = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
  return c + (ign(frag + 17.) - .5) / 255.;
}`;

const VS_DESK = `${HEAD}
layout(location = 0) in vec3 aP;
uniform mat4 uVP;
out vec3 vP;
void main() { vP = aP; gl_Position = uVP * vec4(aP, 1.); }`;

const FS_DESK = `${HEAD}
in vec3 vP;
uniform sampler2D uTex;
uniform vec3 uBg, uL, uEye;
uniform vec3 uSheets[3];
uniform vec4 uPool;
out vec4 o;
${SHADOW}
void main() {
  vec2 q = vP.xz * .17 + vec2(.37, .61);
  vec4 t = texture(uTex, q);
  t.b = texture(uTex, vP.xz * .06 + vec2(.5)).b;
  float e = 1. / 1024.;
  float hx = texture(uTex, q + vec2(e, 0.)).r - texture(uTex, q - vec2(e, 0.)).r;
  float hy = texture(uTex, q + vec2(0., e)).r - texture(uTex, q - vec2(0., e)).r;
  vec3 N = normalize(vec3(-hx * .9, 1., -hy * .9));

  float sh = 1., ao = 1.;
  for (int i = 0; i < 3; i++) {
    if (distance(vP.xz, uSheets[i].xy) < uSheets[i].z) {
      float reach;
      sh = shadowAt(vP, uTexel * 22., reach);
      float wide = 0.;
      vec3 s = (uLight * vec4(vP, 1.)).xyz * .5 + .5;
      float a = ign(gl_FragCoord.yx) * 6.2832;
      mat2 r = mat2(cos(a), sin(a), -sin(a), cos(a));
      for (int k = 1; k < 16; k += 2) wide += texture(uShadow, s.xy + r * POI[k] * uTexel * 62.).r < s.z ? 1. : 0.;
      ao = 1. - wide / 8. * .42;
      break;
    }
  }

  // 左上から差す光のたまり
  float d = distance(gl_FragCoord.xy / uPool.xy, vec2(.12, .96));
  float pool = mix(1.2, .66, smoothstep(.05, 1.25, d));
  float ndl = max(dot(N, uL), 0.);
  vec3 albedo = uBg * (.93 + .14 * t.b) * (1. + .1 * (t.g - .5)) * (1. + .22 * t.a);
  vec3 c = albedo * pool * (.48 * ao + .65 * ndl * sh);
  o = vec4(display(c, gl_FragCoord.xy), 1.);
}`;

const VS_PAPER = `${HEAD}
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec2 aUV;
layout(location = 3) in float aHide;
uniform mat4 uVP;
out vec3 vP;
out vec3 vN;
out vec2 vUV;
out float vHide;
void main() {
  vHide = aHide;
  vP = aP;
  vN = aN;
  vUV = aUV;
  gl_Position = uVP * vec4(aP, 1.);
}`;

const FS_PAPER = `${HEAD}
in vec3 vP;
in vec3 vN;
in vec2 vUV;
in float vHide;
uniform float uHideK;
uniform sampler2D uTex, uCrease;
uniform vec3 uFront, uBack, uL, uEye;
uniform vec3 uOff;
uniform float uMem;
uniform vec4 uPool;
out vec4 o;
${SHADOW}
float crease(vec2 p) {
  vec4 c = texture(uCrease, p);
  return c.r - c.g;
}
void main() {
  bool front = gl_FrontFacing;
  float side = front ? 1. : -1.;
  vec3 N = normalize(vN) * side;

  float ca = cos(uOff.z), sa = sin(uOff.z);
  vec2 tuv = mat2(ca, sa, -sa, ca) * vUV * .3 + uOff.xy;
  vec4 t = texture(uTex, tuv);
  float e = 1. / 1100.;
  float hx = texture(uTex, tuv + vec2(e, 0.)).r - texture(uTex, tuv - vec2(e, 0.)).r;
  float hy = texture(uTex, tuv + vec2(0., e)).r - texture(uTex, tuv - vec2(0., e)).r;
  vec2 fib = mat2(ca, -sa, sa, ca) * vec2(hx, hy);

  // 折り目の跡。紙の座標に残る
  vec2 cuv = vUV * .5 + .5;
  float ce = 1.6 / 2048.;
  vec4 c0 = texture(uCrease, cuv);
  float ridge = max(c0.r, c0.g);
  vec2 cg = vec2(crease(cuv + vec2(ce, 0.)) - crease(cuv - vec2(ce, 0.)), crease(cuv + vec2(0., ce)) - crease(cuv - vec2(0., ce)));

  vec3 dp1 = dFdx(vP), dp2 = dFdy(vP);
  vec2 d1 = dFdx(vUV), d2 = dFdy(vUV);
  vec3 T = dp1 * d2.y - dp2 * d1.y;
  vec3 B = dp2 * d1.x - dp1 * d2.x;
  float lt = length(T), lb = length(B);
  if (lt > 1e-9 && lb > 1e-9) {
    vec2 g = fib * 2.2 + cg * .62 * uMem;
    N = normalize(N - (T / lt * g.x + B / lb * g.y) * side);
  }

  // 面の色：表は生成りの紙、裏は染めた紙。染め残りの繊維が白く浮く
  vec3 dyed = mix(uBack, uFront, t.a * .24 + .012) * (.88 + .18 * t.b);
  vec3 albedo = front ? mix(uFront * (.965 + .07 * t.b) * (1. - .1 * t.a), dyed, vHide * uHideK) : dyed;
  albedo *= 1. + .07 * (t.g - .5);
  albedo *= 1. - .085 * uMem * ridge * (1. + .9 * uHideK); // ほどくと薄く、折ると本物の折り筋に

  // 紙の切り口は、芯の色
  float edge = smoothstep(.9955, .9995, max(abs(vUV.x), abs(vUV.y)));
  albedo = mix(albedo, uFront * 1.04, edge * .85 * (1. - .8 * uHideK));

  float reach;
  float sh = shadowAt(vP + uL * .012, uTexel * 12., reach);
  float ndl = dot(N, uL);
  float d = distance(gl_FragCoord.xy / uPool.xy, vec2(.12, .96));
  float pool = mix(1.12, .82, smoothstep(.05, 1.25, d));
  vec3 V = normalize(uEye - vP);
  vec3 H = normalize(uL + V);
  float sheen = pow(max(dot(N, H), 0.), 26.) * .03;
  float sky = .5 + .5 * N.y;
  // 薄い紙は、裏からの光を少し通す
  vec3 through = mix(albedo, front ? uBack : uFront, .35) * max(-ndl, 0.) * .3 * sh;
  vec3 c = pool * (albedo * (.48 * mix(.58, 1.08, sky) + .6 * max(ndl, 0.) * sh) + through + sheen * sh);
  o = vec4(display(c, gl_FragCoord.xy), 1.);
}`;

// ---------------------------------------------------------------- 行列
const mul4 = (a, b) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
};
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lookAt = (eye, at, up) => {
  const f = norm3([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
  const r = norm3(cross3(up, f));
  const u = cross3(f, r);
  return new Float32Array([r[0], u[0], f[0], 0, r[1], u[1], f[1], 0, r[2], u[2], f[2], 0, -dot3(r, eye), -dot3(u, eye), -dot3(f, eye), 1]);
};
const perspective = (fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
};
const ortho = (l, r, b, t, n, f) =>
  new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);

// ---------------------------------------------------------------- 時間
const FOLD_MS = [130, 110, 120, 120, 130, 130, 110, 140, 90, 120]; // 合わせて 1200ms
const FOLD_TOTAL = FOLD_MS.reduce((a, b) => a + b, 0) / 1000;
const UNFOLD_TOTAL = 1.05;
const FLAP_TOTAL = 0.62;
const stageAt = (t) => {
  let from = 0;
  for (let k = 0; k < STAGES; k++) {
    const w = FOLD_MS[k] / (FOLD_TOTAL * 1000);
    if (t <= from + w) {
      const x = (t - from) / w;
      return k + mix(x, x * x * (3 - 2 * x), 0.6);
    }
    from += w;
  }
  return STAGES;
};

const LIGHT = norm3([-0.5, 0.82, -0.28]);
const ELEV = rad(68); // 正方形が正方形に見える高さ
const FOV = rad(5.5); // 望遠。正方形が正方形に見えるように
const VIEW_H = (3 * 2) / 0.84; // 1行の高さの 84% に、紙の幅が入る
const FINAL_YAW = rad(142);
const FINAL_ROLL = rad(-20);
const FINAL_LEAN = rad(-38); // 画面の横軸まわりの傾き。カメラが高いぶん、鶴の横顔を見せる
const LAYER_EPS = 0.0034;
const STRIDE = 9;

// ---------------------------------------------------------------- 本体
export function mount(root) {
  const cleanups = [];
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  const canvas = root.querySelector('.scene');
  const probe = root.querySelector('.probe');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  let calm = motionQuery.matches;

  const crane = buildCrane();
  const { nv, nf, tri, uv, frames, layer, creases, crumple, curl, flapW, corner, groupCount, hide } = crane;
  const groupX = new Float32Array(groupCount.length);
  const groupY = new Float32Array(groupCount.length);
  const groupZ = new Float32Array(groupCount.length);
  const faceN = new Float32Array(nf * 3);
  const LAST = STAGES * SUBFRAMES;
  // できあがりの鶴が机に触れる高さ
  let footLift = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < nv; i++) {
    const o = (LAST * nv + i) * 3;
    minX = Math.min(minX, frames[o]);
    maxX = Math.max(maxX, frames[o]);
  }
  const centerX = (minX + maxX) / 2;

  // できあがりの鶴の絵の中心を、行の中心へ
  const finalCenter = (() => {
    const cy = Math.cos(FINAL_YAW);
    const sy = Math.sin(FINAL_YAW);
    const ct = Math.cos(FINAL_ROLL);
    const st = Math.sin(FINAL_ROLL);
    const cl = Math.cos(FINAL_LEAN);
    const sl = Math.sin(FINAL_LEAN);
    const toWorld = (x, y, z) => {
      const ry = ct * y - st * z;
      const rz = -sy * x + cy * st * y + cy * ct * z;
      return [cy * x + sy * st * y + sy * ct * z, cl * ry - sl * rz, sl * ry + cl * rz];
    };
    for (let i = 0; i < nv; i++) {
      const o = (LAST * nv + i) * 3;
      footLift = Math.max(footLift, -toWorld(frames[o] - centerX, frames[o + 1] - HY, frames[o + 2])[1]);
    }
    let lu = Infinity;
    let hu = -Infinity;
    let lv = Infinity;
    let hv = -Infinity;
    for (let i = 0; i < nv; i++) {
      const o = (LAST * nv + i) * 3;
      const [wx, wy, wz] = toWorld(frames[o] - centerX, frames[o + 1] - HY, frames[o + 2]);
      const v = (wy + footLift) * Math.cos(ELEV) - wz * Math.sin(ELEV);
      lu = Math.min(lu, wx);
      hu = Math.max(hu, wx);
      lv = Math.min(lv, v);
      hv = Math.max(hv, v);
    }
    return { dx: -(lu + hu) / 2, dz: (lv + hv) / 2 / Math.sin(ELEV) };
  })();

  const JITTER = [rad(-1.1), rad(0.8), rad(-0.5)];
  const OFFSETS = [[0.34, 0.36, 0.5], [0.62, 0.41, 2.3], [0.44, 0.67, 4.1]];
  const sheets = [...root.querySelectorAll('.row')].map((row, i) => {
    const box = row.querySelector('.box');
    return {
      row,
      box,
      spot: row.querySelector('.spot'),
      t: box.checked ? 1 : 0,
      mem: box.checked ? 1 : 0,
      flap: -1,
      hover: 0,
      hoverTo: 0,
      jit: JITTER[i % 3],
      off: OFFSETS[i % 3],
      x: 0,
      z: 0,
      data: new Float32Array(nf * 3 * STRIDE),
      world: new Float32Array(nv * 3),
      dirty: true,
      vao: null,
      vbo: null,
    };
  });

  // ---- 色をトークンから読む
  const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const tones = {};
  const readTones = () => {
    const style = getComputedStyle(root);
    for (const name of ['bg', 'surface', 'accent']) {
      probe.style.color = style.getPropertyValue(`--_${name}`).trim();
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = getComputedStyle(probe).color;
      paint.fillRect(0, 0, 1, 1);
      const d = paint.getImageData(0, 0, 1, 1).data;
      tones[name] = { srgb: [d[0], d[1], d[2]], linear: [d[0], d[1], d[2]].map((v) => Math.pow(v / 255, 2.2)) };
    }
    // 明るい机に明るい紙を置くと、紙が消える。紙を机より一段だけ沈める
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const desk = lum(tones.bg.linear);
    const sheet = lum(tones.surface.linear);
    if (desk > 0.5 && sheet > desk - 0.24) {
      const k = (desk - 0.24) / sheet;
      tones.surface.linear = tones.surface.linear.map((v) => v * k);
      tones.surface.srgb = tones.surface.srgb.map((v) => v * Math.pow(k, 1 / 2.2));
    }
  };

  // ---- カメラ
  let W = 1;
  let H = 1;
  let quality = 1;
  let vp = new Float32Array(16);
  let lightVP = new Float32Array(16);
  let penK = 0;
  let eye = [0, 0, 0];
  let deskCorners = new Float32Array(12);
  const camera = { tanX: 1, tanY: 1 };
  const onDesk = (nx, ny) => {
    const dir = [nx * camera.tanX, -Math.sin(ELEV) + ny * camera.tanY * Math.cos(ELEV), -Math.cos(ELEV) - ny * camera.tanY * Math.sin(ELEV)];
    const k = -eye[1] / dir[1];
    return [eye[0] + dir[0] * k, 0, eye[2] + dir[2] * k];
  };

  const measure = () => {
    const box = root.getBoundingClientRect();
    W = Math.max(1, box.width);
    H = Math.max(1, box.height);
    const aspect = W / H;
    const dist = VIEW_H / (2 * Math.tan(FOV / 2));
    eye = [0, dist * Math.sin(ELEV), dist * Math.cos(ELEV)];
    camera.tanY = Math.tan(FOV / 2);
    camera.tanX = camera.tanY * aspect;
    vp = mul4(perspective(FOV, aspect, dist * 0.6, dist * 1.5), lookAt(eye, [0, 0, 0], [0, 1, 0]));
    const corners = [onDesk(-1.15, -1.15), onDesk(1.15, -1.15), onDesk(1.15, 1.15), onDesk(-1.15, 1.15)];
    deskCorners = new Float32Array(corners.flat());
    for (const s of sheets) {
      const r = s.spot.getBoundingClientRect();
      const p = onDesk((((r.left + r.width / 2 - box.left) / W) * 2 - 1), 1 - ((r.top + r.height / 2 - box.top) / H) * 2);
      s.x = p[0];
      s.z = p[2];
      s.dirty = true;
    }

    // 光から見た箱：どの紙の影も入るように
    const cx = sheets.reduce((a, s) => a + s.x, 0) / sheets.length;
    const cz = sheets.reduce((a, s) => a + s.z, 0) / sheets.length;
    const lightView = lookAt([cx + LIGHT[0] * 30, LIGHT[1] * 30, cz + LIGHT[2] * 30], [cx, 0, cz], [0, 0, -1]);
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const s of sheets) {
      for (const dx of [-2.4, 2.4]) {
        for (const dz of [-2.4, 2.4]) {
          for (const y of [-1.2, 2.4]) {
            const wx = s.x + dx;
            const wz = s.z + dz;
            const v = [
              lightView[0] * wx + lightView[4] * y + lightView[8] * wz + lightView[12],
              lightView[1] * wx + lightView[5] * y + lightView[9] * wz + lightView[13],
              lightView[2] * wx + lightView[6] * y + lightView[10] * wz + lightView[14],
            ];
            lo = lo.map((a, k) => Math.min(a, v[k]));
            hi = hi.map((a, k) => Math.max(a, v[k]));
          }
        }
      }
    }
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
    const mx = (hi[0] + lo[0]) / 2;
    const my = (hi[1] + lo[1]) / 2;
    const near = -hi[2] - 1;
    const far = -lo[2] + 1;
    lightVP = mul4(ortho(mx - size / 2, mx + size / 2, my - size / 2, my + size / 2, near, far), lightView);
    penK = ((far - near) * 0.075) / size;
    resize();
  };

  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1) * quality;
    const w = Math.max(1, Math.round(W * dpr));
    const h = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  // ---- 1枚の紙の、今の形を作る
  const fill = (s) => {
    const sf = stageAt(s.t);
    const fr = Math.min(sf * SUBFRAMES, LAST - 1e-4);
    const f0 = Math.floor(fr);
    const fa = fr - f0;
    const A = f0 * nv * 3;
    const B = (f0 + 1) * nv * 3;
    const k = Math.min(Math.floor(sf), STAGES - 1);
    const ka = sf - k;
    const w0 = 1 - smooth(0, 0.16, sf);

    const yaw = mix(rad(45) + s.jit, FINAL_YAW + s.jit * 2, smooth(0, 0.78, s.t));
    const stand = smooth(0.62, 1, s.t);
    const tilt = mix(-Math.PI / 2, FINAL_ROLL, stand);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    // Ry(yaw) * Rx(tilt)
    const r = [cy, sy * st, sy * ct, 0, ct, -st, -sy, cy * st, cy * ct];
    const lean = FINAL_LEAN * smooth(0.62, 1, s.t);
    const cl = Math.cos(lean);
    const sl = Math.sin(lean);
    // Rx(lean) * r
    const m = [r[0], r[1], r[2], cl * r[3] - sl * r[6], cl * r[4] - sl * r[7], cl * r[5] - sl * r[8], sl * r[3] + cl * r[6], sl * r[4] + cl * r[7], sl * r[5] + cl * r[8]];
    const shift = smooth(0, 0.95, s.t);
    const ox = centerX * shift;
    const oy = HY * shift;
    let lift = mix(0.006, footLift + 0.004, stand) + 0.34 * Math.pow(Math.sin(Math.PI * s.t), 1.4) + s.hover * 0.032;

    let flapAngle = 0;
    if (s.flap >= 0) {
      const p = s.flap;
      flapAngle = rad(22) * Math.sin(2 * Math.PI * p) * Math.pow(1 - p, 1.1);
      lift += 0.035 * Math.sin(2 * Math.PI * p) * (1 - p);
    }

    const world = s.world;
    for (let i = 0; i < nv; i++) {
      const j = i * 3;
      let x = mix(frames[A + j], frames[B + j], fa);
      let y = mix(frames[A + j + 1], frames[B + j + 1], fa);
      let z = mix(frames[A + j + 2], frames[B + j + 2], fa);
      if (w0 > 0) z += w0 * (curl[i] + s.mem * crumple[i]);
      if (flapAngle !== 0 && flapW[i] !== 0) {
        const a = flapAngle * flapW[i];
        const rootZ = Math.sign(flapW[i]) * 0.1;
        const ry = y - HY;
        const rz = z - rootZ;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        y = HY + ry * c + rz * sn;
        z = rootZ + rz * c - ry * sn;
      }
      x -= ox;
      y -= oy;
      const wz = m[6] * x + m[7] * y + m[8] * z;
      world[j] = m[0] * x + m[1] * y + m[2] * z + s.x + finalCenter.dx * stand;
      world[j + 1] = m[3] * x + m[4] * y + m[5] * z + lift + s.hover * wz * 0.028;
      world[j + 2] = wz + s.z + finalCenter.dz * stand;
    }

    const up = [m[2], m[5], m[8]];
    const flat = w0 * (1 - 0.62 * s.mem);
    const S1 = STAGES + 1;
    const d = s.data;
    s.hideK = smooth(7.2, 9.4, sf);
    groupX.fill(0);
    groupY.fill(0);
    groupZ.fill(0);
    for (let f = 0; f < nf; f++) {
      const ia = tri[f * 3] * 3;
      const ib = tri[f * 3 + 1] * 3;
      const ic = tri[f * 3 + 2] * 3;
      const ax = world[ib] - world[ia];
      const ay = world[ib + 1] - world[ia + 1];
      const az = world[ib + 2] - world[ia + 2];
      const bx = world[ic] - world[ia];
      const by = world[ic + 1] - world[ia + 1];
      const bz = world[ic + 2] - world[ia + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const off = mix(layer[f * S1 + k], layer[f * S1 + Math.min(k + 1, STAGES)], ka) * LAYER_EPS;
      faceN[f * 3] = nx;
      faceN[f * 3 + 1] = ny;
      faceN[f * 3 + 2] = nz;
      for (let c = 0; c < 3; c++) {
        const g = corner[f * 3 + c];
        groupX[g] += nx * off;
        groupY[g] += ny * off;
        groupZ[g] += nz * off;
      }
    }
    let w = 0;
    for (let f = 0; f < nf; f++) {
      const nx = faceN[f * 3];
      const ny = faceN[f * 3 + 1];
      const nz = faceN[f * 3 + 2];
      let sx = mix(nx, up[0], flat);
      let sy2 = mix(ny, up[1], flat);
      let sz = mix(nz, up[2], flat);
      const sl = Math.sqrt(sx * sx + sy2 * sy2 + sz * sz) || 1;
      sx /= sl;
      sy2 /= sl;
      sz /= sl;
      for (let c = 0; c < 3; c++) {
        const iv = tri[f * 3 + c];
        const g = corner[f * 3 + c];
        const gc = groupCount[g];
        d[w++] = world[iv * 3] + groupX[g] / gc;
        d[w++] = world[iv * 3 + 1] + groupY[g] / gc;
        d[w++] = world[iv * 3 + 2] + groupZ[g] / gc;
        d[w++] = sx;
        d[w++] = sy2;
        d[w++] = sz;
        d[w++] = uv[iv * 2];
        d[w++] = uv[iv * 2 + 1];
        d[w++] = hide[f];
      }
    }
  };

  // ---- WebGL
  let gl = null;
  let ctx2d = null;
  let ready = false;
  const res = {};

  const shader = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    return sh;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    const a = shader(gl.VERTEX_SHADER, vs);
    const b = shader(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, a);
    gl.attachShader(p, b);
    gl.linkProgram(p);
    gl.deleteShader(a);
    gl.deleteShader(b);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const cache = new Map();
    return {
      p,
      u(name) {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
        return cache.get(name);
      },
    };
  };

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const makeTarget = (size) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(size)) + 1, gl.RGBA8, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, size, size);
    return { tex, fbo };
  };

  // 和紙を焼く：パルプのむらに、長い繊維を線で足す
  const bakePaper = () => {
    const size = 2048;
    const { tex, fbo } = makeTarget(size);
    const pulp = program(VS_SCREEN, FS_PULP);
    gl.disable(gl.BLEND);
    gl.useProgram(pulp.p);
    gl.bindVertexArray(res.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.deleteProgram(pulp.p);

    const fiber = program(VS_FIBER, FS_FIBER);
    const random = rng(90127);
    const groups = [[3400, 0.07], [1600, 0.14], [420, 0.3]];
    const vbo = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(fiber.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.colorMask(true, false, false, true);
    for (const [count, strength] of groups) {
      const SEG = 12;
      const lines = new Float32Array(count * SEG * 4);
      let w = 0;
      for (let n = 0; n < count; n++) {
        let x = random();
        let y = random();
        let a = random() * Math.PI * 2;
        const bend = (random() - 0.5) * 0.5;
        const step = (0.012 + random() * random() * 0.06) / SEG * 6;
        for (let i = 0; i < SEG; i++) {
          const nx = x + Math.cos(a) * step;
          const ny = y + Math.sin(a) * step;
          lines[w++] = x;
          lines[w++] = y;
          lines[w++] = nx;
          lines[w++] = ny;
          x = nx;
          y = ny;
          a += bend + (random() - 0.5) * 0.3;
        }
      }
      gl.bufferData(gl.ARRAY_BUFFER, lines, gl.STATIC_DRAW);
      gl.uniform1f(fiber.u('uK'), strength);
      gl.drawArrays(gl.LINES, 0, w / 2);
    }
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(fiber.p);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    res.paper = tex;
  };

  // 折り目の地図：紙の座標に、山折りを赤、谷折りを緑で
  const bakeCreases = () => {
    const size = 2048;
    const { tex, fbo } = makeTarget(size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const line = program(VS_CREASE, FS_CREASE);
    gl.useProgram(line.p);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    const vbo = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const width = 0.0085;
    for (const sign of [1, -1]) {
      const list = creases.filter((c) => c[4] === sign);
      const q = new Float32Array(list.length * 18);
      let w = 0;
      for (const [x1, y1, x2, y2] of list) {
        const l = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx = (-(y2 - y1) / l) * width;
        const ny = ((x2 - x1) / l) * width;
        const quad = [[x1 + nx, y1 + ny, 1], [x1 - nx, y1 - ny, -1], [x2 + nx, y2 + ny, 1], [x2 + nx, y2 + ny, 1], [x1 - nx, y1 - ny, -1], [x2 - nx, y2 - ny, -1]];
        for (const v of quad) {
          q[w++] = v[0];
          q[w++] = v[1];
          q[w++] = v[2];
        }
      }
      gl.bufferData(gl.ARRAY_BUFFER, q, gl.STATIC_DRAW);
      gl.uniform2f(line.u('uSign'), sign > 0 ? 1 : 0, sign > 0 ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, w / 3);
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(line.p);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    res.crease = tex;
  };

  const initGL = () => {
    res.empty = gl.createVertexArray();
    res.depth = program(VS_DEPTH, FS_DEPTH);
    res.desk = program(VS_DESK, FS_DESK);
    res.ink = program(VS_PAPER, FS_PAPER);
    bakePaper();
    bakeCreases();

    // 影の地図
    const big = Math.max(W, H) * Math.min(2, devicePixelRatio || 1) > 2200;
    res.shadowSize = Math.min(big ? 4096 : 2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    res.shadow = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, res.shadow);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, res.shadowSize, res.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    res.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, res.shadow, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // 同じ影の地図を、深さとしても、なめらかな比較としても読む
    res.compare = gl.createSampler();
    gl.samplerParameteri(res.compare, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(res.compare, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(res.compare, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(res.compare, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(res.compare, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.samplerParameteri(res.compare, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

    // 机の四角
    res.deskVbo = gl.createBuffer();
    res.deskVao = gl.createVertexArray();
    gl.bindVertexArray(res.deskVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.deskVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    for (const s of sheets) {
      s.vbo = gl.createBuffer();
      s.vao = gl.createVertexArray();
      gl.bindVertexArray(s.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, s.data.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE * 4, 32);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE * 4, 24);
      s.dirty = true;
    }
    gl.bindVertexArray(null);
    ready = true;
  };

  const shadowUniforms = (pr) => {
    gl.uniform1i(pr.u('uShadow'), 2);
    gl.uniform1i(pr.u('uShadowCmp'), 3);
    gl.uniformMatrix4fv(pr.u('uLight'), false, lightVP);
    gl.uniform1f(pr.u('uPenK'), penK);
    gl.uniform1f(pr.u('uTexel'), 1 / 2048);
    gl.uniform3fv(pr.u('uL'), LIGHT);
    gl.uniform3fv(pr.u('uEye'), eye);
    gl.uniform4f(pr.u('uPool'), canvas.width, canvas.height, 0, 0);
    gl.uniformMatrix4fv(pr.u('uVP'), false, vp);
  };

  const drawGL = () => {
    // 影
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.shadowFbo);
    gl.viewport(0, 0, res.shadowSize, res.shadowSize);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.2, 1.6);
    gl.useProgram(res.depth.p);
    gl.uniformMatrix4fv(res.depth.u('uLight'), false, lightVP);
    for (const s of sheets) {
      gl.bindVertexArray(s.vao);
      gl.drawArrays(gl.TRIANGLES, 0, nf * 3);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.paper);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, res.crease);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, res.shadow);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, res.shadow);
    gl.bindSampler(3, res.compare);
    gl.activeTexture(gl.TEXTURE0);

    // 机。深さを書かない。裏へ折る紙が、机に切られないように
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(res.desk.p);
    shadowUniforms(res.desk);
    gl.uniform1i(res.desk.u('uTex'), 0);
    gl.uniform3fv(res.desk.u('uBg'), tones.bg.linear);
    const near = [];
    for (const s of sheets) near.push(s.x, s.z, 2.7);
    gl.uniform3fv(res.desk.u('uSheets'), near);
    gl.bindVertexArray(res.deskVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.deskVbo);
    gl.bufferData(gl.ARRAY_BUFFER, deskCorners, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    // 紙
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(res.ink.p);
    shadowUniforms(res.ink);
    gl.uniform1i(res.ink.u('uTex'), 0);
    gl.uniform1i(res.ink.u('uCrease'), 1);
    gl.uniform3fv(res.ink.u('uFront'), tones.surface.linear);
    gl.uniform3fv(res.ink.u('uBack'), tones.accent.linear);
    for (const s of sheets) {
      gl.uniform3fv(res.ink.u('uOff'), s.off);
      gl.uniform1f(res.ink.u('uMem'), s.mem);
      gl.uniform1f(res.ink.u('uHideK'), s.hideK ?? 0);
      gl.bindVertexArray(s.vao);
      gl.drawArrays(gl.TRIANGLES, 0, nf * 3);
    }
    gl.bindVertexArray(null);
  };

  // ---- WebGL が使えないときの、ごく簡単な絵
  const project = (x, y, z) => {
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    return [
      (((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w) * 0.5 + 0.5) * canvas.width,
      (0.5 - ((vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) * 0.5) * canvas.height,
      w,
    ];
  };
  const toCss = (c, k, a = 1) => `rgb(${Math.round(c[0] * k)} ${Math.round(c[1] * k)} ${Math.round(c[2] * k)} / ${a})`;
  const draw2D = () => {
    if (!ctx2d) return;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    const faces = [];
    const plain = [];
    for (const s of sheets) {
      // まだ折っていない紙は、1枚の四角。折り目の線を出さない
      if (s.t === 0 && s.mem === 0) {
        plain.push([2, 4, 6, 8].map((i) => project(s.world[i * 3], s.world[i * 3 + 1], s.world[i * 3 + 2])));
        continue;
      }
      const d = s.data;
      const k = s.hideK ?? 0;
      for (let f = 0; f < nf; f++) {
        const o = f * 3 * STRIDE;
        faces.push({ d, o, k });
        // 影
        const ps = [0, 1, 2].map((c) => {
          const x = d[o + c * STRIDE];
          const y = d[o + c * STRIDE + 1];
          const z = d[o + c * STRIDE + 2];
          const k = y / LIGHT[1];
          return project(x - LIGHT[0] * k, 0, z - LIGHT[2] * k);
        });
        ctx2d.fillStyle = toCss(tones.bg.srgb, 0.55);
        ctx2d.beginPath();
        ctx2d.moveTo(ps[0][0], ps[0][1]);
        ctx2d.lineTo(ps[1][0], ps[1][1]);
        ctx2d.lineTo(ps[2][0], ps[2][1]);
        ctx2d.fill();
      }
    }
    ctx2d.fillStyle = toCss(tones.surface.srgb, 1);
    for (const q of plain) {
      ctx2d.beginPath();
      q.forEach((p, i) => (i ? ctx2d.lineTo(p[0], p[1]) : ctx2d.moveTo(p[0], p[1])));
      ctx2d.fill();
    }
    const drawn = faces.map(({ d, o, k }) => {
      const ps = [0, 1, 2].map((c) => project(d[o + c * STRIDE], d[o + c * STRIDE + 1], d[o + c * STRIDE + 2]));
      return { d, o, k, ps, w: (ps[0][2] + ps[1][2] + ps[2][2]) / 3 };
    });
    drawn.sort((a, b) => b.w - a.w);
    for (const { d, o, k, ps } of drawn) {
      const area = (ps[1][0] - ps[0][0]) * (ps[2][1] - ps[0][1]) - (ps[1][1] - ps[0][1]) * (ps[2][0] - ps[0][0]);
      const front = area < 0;
      const side = front ? 1 : -1;
      const ndl = Math.max(0, (d[o + 3] * LIGHT[0] + d[o + 4] * LIGHT[1] + d[o + 5] * LIGHT[2]) * side);
      const inner = tones.surface.srgb.map((v, i) => mix(v, tones.accent.srgb[i], 0.86 * k));
      ctx2d.fillStyle = toCss(front ? inner : tones.accent.srgb, 0.68 + 0.42 * ndl);
      ctx2d.strokeStyle = ctx2d.fillStyle;
      ctx2d.beginPath();
      ctx2d.moveTo(ps[0][0], ps[0][1]);
      ctx2d.lineTo(ps[1][0], ps[1][1]);
      ctx2d.lineTo(ps[2][0], ps[2][1]);
      ctx2d.closePath();
      ctx2d.fill();
      ctx2d.stroke();
    }
  };

  // ---- 動かす
  let raf = 0;
  let visible = true;
  let lastNow = 0;
  let slowFrames = 0;
  const wake = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const frame = (now) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016;
    lastNow = now;
    let busy = false;
    for (const s of sheets) {
      const goal = s.box.checked ? 1 : 0;
      if (calm) {
        if (s.t !== goal) {
          s.t = goal;
          s.dirty = true;
        }
        if (goal) s.mem = 1;
        if (s.flap >= 0) {
          s.flap = -1;
          s.dirty = true;
        }
        if (s.hover !== 0) {
          s.hover = 0;
          s.dirty = true;
        }
        continue;
      }
      if (s.t !== goal) {
        const step = dt / (goal > s.t ? FOLD_TOTAL : -UNFOLD_TOTAL);
        s.t = goal > s.t ? Math.min(goal, s.t + step) : Math.max(goal, s.t + step);
        if (s.t === 1) s.flap = 0;
        s.dirty = true;
        busy = true;
      }
      s.mem = Math.max(s.mem, smooth(0.06, 0.3, s.t));
      if (goal === 0 && s.flap >= 0) s.flap = -1;
      if (s.flap >= 0) {
        s.flap += dt / FLAP_TOTAL;
        if (s.flap >= 1) s.flap = -1;
        s.dirty = true;
        busy = true;
      }
      const dh = s.hoverTo - s.hover;
      if (Math.abs(dh) > 0.002) {
        s.hover += dh * (1 - Math.exp(-dt * 16));
        s.dirty = true;
        busy = true;
      } else if (dh !== 0) {
        s.hover = s.hoverTo;
        s.dirty = true;
      }
    }

    // 重いときだけ、解像度を落として 60fps を守る。止まったら、元の細かさで描き直す
    if (busy) {
      slowFrames = dt > 0.024 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 8 && quality > 0.5) {
        quality = Math.max(0.5, quality * 0.8);
        slowFrames = 0;
        resize();
        for (const s of sheets) s.dirty = true;
      }
    } else if (quality !== 1) {
      quality = 1;
      resize();
      for (const s of sheets) s.dirty = true;
    }

    let changed = false;
    for (const s of sheets) {
      if (!s.dirty) continue;
      fill(s);
      if (ready) {
        gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data);
      }
      s.dirty = false;
      changed = true;
    }
    if (changed || frame.force) {
      frame.force = false;
      if (ready) drawGL();
      else draw2D();
    }
    if (busy) wake();
    else lastNow = 0;
  };

  // ---- 組み立て
  readTones();
  gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  measure();
  if (gl) {
    try {
      initGL();
    } catch (error) {
      ready = false;
      console.warn(error);
    }
  } else {
    ctx2d = canvas.getContext('2d');
  }

  const redraw = () => {
    frame.force = true;
    for (const s of sheets) s.dirty = true;
    wake();
  };

  for (const s of sheets) {
    on(s.box, 'change', () => wake());
    const lift = () => {
      s.hoverTo = 1;
      wake();
    };
    const rest = () => {
      if (root.contains(s.box) && s.row.matches(':hover')) return;
      if (s.box.matches(':focus-visible')) return;
      s.hoverTo = 0;
      wake();
    };
    on(s.row, 'pointerenter', lift);
    on(s.row, 'pointerleave', () => {
      s.hoverTo = s.box.matches(':focus-visible') ? 1 : 0;
      wake();
    });
    on(s.box, 'focus', () => {
      if (s.box.matches(':focus-visible')) lift();
    });
    on(s.box, 'blur', rest);
  }

  on(motionQuery, 'change', () => {
    calm = motionQuery.matches;
    redraw();
  });
  on(schemeQuery, 'change', () => {
    readTones();
    redraw();
  });
  on(document, 'visibilitychange', () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastNow = 0;
    } else {
      redraw();
    }
  });
  on(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
  });
  on(canvas, 'webglcontextrestored', () => {
    initGL();
    redraw();
  });

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) redraw();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastNow = 0;
    }
  });
  io.observe(root);
  const ro = new ResizeObserver(() => {
    measure();
    redraw();
  });
  ro.observe(root);

  redraw();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    visible = false;
    io.disconnect();
    ro.disconnect();
    for (const off of cleanups) off();
    if (gl && ready) {
      for (const s of sheets) {
        gl.deleteBuffer(s.vbo);
        gl.deleteVertexArray(s.vao);
      }
      gl.deleteBuffer(res.deskVbo);
      gl.deleteVertexArray(res.deskVao);
      gl.deleteVertexArray(res.empty);
      gl.deleteProgram(res.depth.p);
      gl.deleteProgram(res.desk.p);
      gl.deleteProgram(res.ink.p);
      gl.deleteTexture(res.paper);
      gl.deleteTexture(res.crease);
      gl.deleteTexture(res.shadow);
      gl.deleteFramebuffer(res.shadowFbo);
      gl.deleteSampler(res.compare);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    ready = false;
  };
}
