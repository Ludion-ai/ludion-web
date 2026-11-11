// part.js — ESモジュール。rootの中だけを触る
// 1枚の canvas の WebGL で、海中の白い都市と液体のガラスを描く。
// 1. 都市・殻・光を、縮小したテクスチャに描く（重い部分。遅い機械では自動で解像度を下げる）
// 2. それを画面に写しながら、ガラスの板の形（SDF）で屈折させる
// 色は JS に書かない。--_bg、--_surface、--_fg、--_muted、--_accent を getComputedStyle で読む。

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PULSES = 8;
const DROPS = 14;
const BLADES = 11;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SCENE = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uT, uIris, uRot, uRay, uFlood, uHorizon;
uniform vec2 uPar;
uniform vec3 uPulse[${PULSES}];
uniform vec3 uBg, uSurface, uFg, uMuted, uAccent, uLight, uInk, uGlow;
out vec4 outColor;
const float TAU = 6.2831853;
const float N = ${BLADES}.0;

float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
vec2 h2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float n1(float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(h1(i), h1(i + 1.0), f);
}

// 水底の光の揺らぎ：格子を強くゆがめて、曲がった網にする。線に近いところだけが光る
float caustic(vec2 p, float t) {
  vec2 q = p;
  float v = 0.0, a = 1.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    q += 0.95 * vec2(sin(q.y * 1.1 + t * 0.6 + fi), cos(q.x * 1.05 - t * 0.5));
    q += 0.45 * vec2(sin(q.y * 2.1 - t * 0.4), cos(q.x * 2.3 + t * 0.35 + fi));
    float f = abs(sin(q.x) * cos(q.y));
    v += a * 0.016 / (0.03 + f);
    a *= 0.6;
    q = q * 1.6 + 3.1;
  }
  return v;
}

// 上から差す光の筋
float rays(vec2 p, float t) {
  vec2 d = p - vec2(0.42, 2.8);
  float a = atan(d.x, -d.y);
  float v = n1(a * 15.0 + t * 0.07) * 0.62 + n1(a * 39.0 - t * 0.11 + 3.0) * 0.38;
  v = pow(v, 2.4) * 2.1;
  return v * smoothstep(-1.5, 0.8, p.y);
}

// 値は [F1, F2 - F1]
vec2 voronoi(vec2 p) {
  vec2 c = floor(p), f = p - c;
  float a = 9.0, b = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 r = g + h2(c + g) * 0.86 + 0.07 - f;
    float d = dot(r, r);
    if (d < a) { b = a; a = d; } else if (d < b) { b = d; }
  }
  a = sqrt(a); b = sqrt(b);
  return vec2(a, b - a);
}

float pulseSum(float r, float b) {
  float s = 0.0;
  float lr = log(max(r, 0.01));
  for (int i = 0; i < ${PULSES}; i++) {
    vec3 u = uPulse[i];
    if (u.z <= 0.0 || abs(b - u.x) > 0.5) continue;
    float head = -0.95 + u.y * 1.7;
    float d = lr - head;
    float tail = d < 0.0 ? 0.11 : 0.035;
    s += exp(-d * d / tail) * u.z;
  }
  return s;
}

// 遠い都市：奥から3層。白い有機的な塔が、水の霞の中に立つ
vec3 city(vec2 p, float caust) {
  float horizon = uHorizon;
  float up = smoothstep(horizon - 0.1, 1.15, p.y);
  vec3 deep = mix(uBg, uAccent, 0.16);
  vec3 col = mix(deep, uSurface, pow(up, 0.8));

  // 水底：光の網が揺れる
  if (p.y < horizon + 0.12) {
    float z = 1.0 / (horizon + 0.16 - p.y);
    float c = caustic(vec2(p.x * z * 1.1, z * 1.6), uT * 0.8);
    float fade = smoothstep(0.0, 0.28, horizon + 0.1 - p.y);
    vec3 floorCol = mix(uBg, uAccent, 0.2);
    floorCol = mix(floorCol, uLight, clamp(c * 1.5, 0.0, 0.92));
    col = mix(col, floorCol, fade);
  }

  for (int j = 0; j < 3; j++) {
    float fj = float(j);
    float s = 9.5 - fj * 2.8;
    float par = 0.01 + fj * 0.024;
    vec2 q = (p + uPar * par) * s;
    q.x += fj * 7.3;
    float baseY = (horizon + 0.05 - 0.05 * fj) * s;
    float id = floor(q.x);
    for (int c = -1; c <= 1; c++) {
      float cell = id + float(c);
      float seed = cell + fj * 17.0;
      float a = h1(seed), b = h1(seed + 3.1), e = h1(seed + 7.7);
      float tall = mix(0.7, 4.6, pow(a, 2.2)) * (1.0 - fj * 0.14);
      float w = mix(0.2, 0.44, b) * mix(1.0, 0.72, smoothstep(1.5, 4.0, tall));
      float cx = cell + 0.5 + (e - 0.5) * 0.46;
      float u = q.x - cx;
      float y = q.y - baseY;
      if (y < -0.5 || y > tall) continue;
      // 卵のように丸い頭と、ゆるいくびれ
      float k = clamp(y / tall, 0.0, 1.0);
      float hw = w * sqrt(max(1.0 - pow(k, 2.6), 0.0)) * (1.0 + 0.16 * sin(y * 2.2 + a * 6.0));
      if (hw < 0.001) continue;
      float nx = u / hw;
      float aa = fwidth(q.x) * 1.4 / hw;
      float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, abs(nx));
      if (mask <= 0.0) continue;
      mask *= smoothstep(-0.5, 0.35, y);

      // 丸い胴の陰影。光は上から
      float nz = sqrt(max(0.0, 1.0 - nx * nx));
      float lit = 0.52 + 0.42 * nz - 0.1 * nx + 0.1 * k;
      vec3 tower = mix(mix(uMuted, uBg, 0.66), uSurface, clamp(lit, 0.0, 1.0));

      // 肋骨のような細い輪
      float ring = abs(fract(y * 2.2 + nx * nx * 0.5 + a) - 0.5);
      tower = mix(tower, uSurface, (1.0 - smoothstep(0.01, 0.04, ring)) * 0.6 * nz);

      // 穴あき模様。データの光がここを通る
      if (j > 0) {
        vec2 v = voronoi(vec2(nx * 2.6 + a * 9.0, y * 5.2));
        float hole = smoothstep(0.08, 0.13, v.y) * smoothstep(1.0, 0.7, abs(nx));
        hole *= smoothstep(0.02, 0.2, y / tall) * smoothstep(0.98, 0.72, k);
        float wave = 0.0;
        for (int i = 0; i < ${PULSES}; i++) {
          vec3 w2 = uPulse[i];
          if (w2.z <= 0.0) continue;
          float at = w2.y - 0.45;
          if (at < 0.0) continue;
          float dist = length(p) - at * 1.2;
          wave += exp(-dist * dist * 22.0) * exp(-at * 1.15) * w2.z;
        }
        vec3 inner = mix(mix(uMuted, uSurface, 0.62), uGlow, clamp(0.12 + wave * 1.3, 0.0, 1.0));
        tower = mix(tower, inner, hole * 0.72);
      }

      tower = mix(tower, uLight, clamp(caust * 1.1, 0.0, 0.6));
      float haze = (j == 0 ? 0.62 : j == 1 ? 0.34 : 0.12) + 0.3 * (1.0 - smoothstep(0.0, 0.9, y));
      tower = mix(tower, mix(uBg, deep, 0.5), clamp(haze, 0.0, 0.9));
      col = mix(col, tower, mask);
    }
  }
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float S = 0.5 * min(uRes.y, uRes.x * 1.6);
  vec2 p = (frag - 0.5 * uRes) / S;

  float caust = caustic(p * 2.3 + vec2(0.0, uT * 0.05), uT * 0.7);
  vec3 col = city(p, caust);

  // ---- 殻：絞りの羽根が渦を巻いて重なる
  vec2 rel = p - uPar * 0.012;
  float r = length(rel);
  float th = atan(rel.y, rel.x);
  float s = th / TAU * N + 1.3 * log(r + 0.35) + uRot * N / TAU;
  float b = floor(s);
  float f = s - b;
  float blade = mod(b, N);
  float aa = max(1.3 / S, 0.0006);
  // 羽根の継ぎ目の幅（atan の切れ目で fwidth が跳ねないよう、式で出す）
  float seamW = (N / TAU / max(r, 0.02) + 1.3 / (r + 0.35)) * 1.6 / S;
  float scallop = uIris * (1.0 + 0.05 * mix(0.5, f - 0.5, smoothstep(0.0, seamW, f)));
  float mask = smoothstep(scallop - aa, scallop + aa, r);

  // 開口の内側に、板から縁へ渡る細いリブ
  if (mask < 1.0) {
    float d = abs(f - 0.5);
    float ribIn = (1.0 - smoothstep(0.006, 0.016, d)) * smoothstep(0.3, 0.5, r);
    float ribSh = (1.0 - smoothstep(0.012, 0.05, abs(f - 0.53))) * smoothstep(0.3, 0.5, r);
    col = mix(col, mix(uMuted, col, 0.5), ribSh * 0.28);
    col = mix(col, uLight, ribIn * 0.85);
    // 開口のふちが都市に落とす影
    float shadow = smoothstep(scallop * 0.8, scallop, r);
    col = mix(col, mix(uMuted, uBg, 0.3), shadow * shadow * 0.34);
  }

  if (mask > 0.0) {
    float e = r - scallop;
    // 羽根の重なり：一枚の中で明るさが流れ、継ぎ目に影が落ちる
    float head = mix(0.8, 1.0, smoothstep(0.0, 1.0, f));
    head *= 1.0 - (1.0 - smoothstep(0.0, 0.16, f)) * 0.26;
    float shade = mix(1.0, head, smoothstep(0.0, seamW, f));
    // 下から見上げた丸み：下の方が光を受ける
    shade *= mix(1.03, 0.9, 0.5 + 0.5 * rel.y / max(r, 0.001));
    // 外へ行くほど陰る
    shade *= mix(1.0, 0.82, smoothstep(0.1, 1.5, e));

    vec3 shell = mix(mix(uMuted, uBg, 0.5), uSurface, clamp(shade * 1.04 - 0.1, 0.0, 1.0));

    // 肋骨：太い一本と、細い二本。一方に細い影
    float rib = 1.0 - smoothstep(0.012, 0.026, abs(f - 0.5));
    float ribShadow = (1.0 - smoothstep(0.0, 0.05, f - 0.525)) * step(0.5, f);
    float fine = 1.0 - smoothstep(0.004, 0.014, abs(abs(f - 0.5) - 0.25));

    // 穴あき模様：開口に近い帯だけ。外はなめらかな殻に戻る
    float zone = smoothstep(0.08, 0.2, e) * (1.0 - smoothstep(0.42, 0.95, e));
    zone *= smoothstep(0.03, 0.12, f) * (1.0 - smoothstep(0.88, 0.97, f));
    zone *= smoothstep(0.035, 0.08, abs(f - 0.5));
    if (zone > 0.001) {
      vec2 v = voronoi(vec2(log(r + 0.02) * 15.0, f * 4.6 + blade * 13.7));
      float wall = mix(0.2, 0.11, smoothstep(0.1, 0.8, e)) + (1.0 - zone) * 0.5;
      float hole = smoothstep(wall, wall + 0.04, v.y);
      float rim = smoothstep(wall - 0.07, wall, v.y);
      shell = mix(shell, mix(uMuted, uSurface, 0.6), rim * 0.42);
      vec3 through = mix(uLight, uGlow, 0.2 + clamp(caust, 0.0, 0.3));
      shell = mix(shell, through, hole);
    }

    shell = mix(shell, mix(uMuted, uSurface, 0.45), ribShadow * 0.2);
    shell = mix(shell, uLight, rib * 0.9);
    shell = mix(shell, uLight, fine * 0.4);

    // 水の光が殻に当たる
    shell = mix(shell, uLight, clamp(caust * 1.25, 0.0, 0.7));

    // 開口のふちの厚み
    float lip = exp(-max(e, 0.0) * 42.0);
    shell = mix(shell, uLight, lip * 0.95);
    float under = exp(-max(e - 0.025, 0.0) * 22.0) * (1.0 - exp(-max(e, 0.0) * 52.0));
    shell = mix(shell, mix(uMuted, uBg, 0.5), under * 0.2);

    col = mix(col, shell, mask);
  }

  // データの光の脈：リブを伝い、板から外へ流れる
  float ribDist = abs(f - 0.5) * TAU * max(r, 0.02) / N; // リブからの実際の距離
  if (ribDist < 0.05) {
    float pulse = clamp(pulseSum(r, blade), 0.0, 1.0);
    if (pulse > 0.001) {
      float halo = exp(-ribDist * ribDist * 3200.0);
      float core = 1.0 - smoothstep(0.0022, 0.0052, ribDist);
      col = mix(col, uGlow, pulse * halo * 0.42);
      col = mix(col, mix(uGlow, uLight, pulse * 0.55), pulse * core);
    }
  }

  // 光の筋
  float ray = rays(p, uT) * uRay;
  col = mix(col, uLight, clamp(ray * 0.5, 0.0, 0.82));
  col = mix(col, uGlow, clamp(ray * 0.05, 0.0, 0.2));

  // 光が満ちる：中心から広がる
  if (uFlood > 0.0) {
    float fl = smoothstep(0.0, 1.0, uFlood * 3.0 - r * 0.85);
    vec3 pale = mix(uSurface, uGlow, 0.05 + clamp(caust, 0.0, 0.4) * 0.2);
    col = mix(col, pale, fl * 0.9);
  }

  outColor = vec4(col, 1.0);
}`;

const GLASS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uT, uDpr, uRadius, uMelt, uTint, uSheenA, uDropK, uBevel;
uniform vec4 uBtn;
uniform float uBtnR, uBtnA, uBtnTint, uBand, uBandCore, uBandPhase, uBtnHot;
uniform vec3 uAccent;
uniform vec4 uPanel;
uniform vec2 uSheen;
uniform vec3 uDrops[${DROPS}];
uniform int uDropN;
uniform vec3 uSurface, uLight, uInk, uGlow;
out vec4 outColor;

float rb(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
// ガラスの形：角丸の板と、集まってくる水滴
float shape(vec2 p) {
  float d = 1.0e5;
  if (uPanel.z > 0.5 && uPanel.w > 0.5) d = rb(p - uPanel.xy, uPanel.zw, min(uRadius, min(uPanel.z, uPanel.w)));
  for (int i = 0; i < uDropN; i++) {
    float c = length(p - uDrops[i].xy) - uDrops[i].z;
    d = smin(d, c, uDropK);
  }
  if (uMelt > 0.0) d += uMelt * sin(p.x * 0.011 / uDpr + uT * 0.9) * sin(p.y * 0.014 / uDpr - uT * 0.7) * 16.0 * uDpr;
  return d;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / uRes;
  vec3 col = texture(uScene, uv).rgb;
  float d = shape(px);

  // 板が都市に落とす、やわらかい影
  float reach = 70.0 * uDpr;
  if (d < reach) {
    float ds = shape(px + vec2(0.0, 16.0 * uDpr));
    float sh = exp(-max(ds, 0.0) / (26.0 * uDpr));
    col = mix(col, uInk, 0.15 * sh * (1.0 - uMelt));
  }

  if (d < 1.5 * uDpr) {
    float e = max(-d, 0.0);
    float eps = 1.5 * uDpr;
    vec2 grad = vec2(shape(px + vec2(eps, 0.0)) - shape(px - vec2(eps, 0.0)), shape(px + vec2(0.0, eps)) - shape(px - vec2(0.0, eps)));
    grad = grad / max(length(grad), 0.0001);

    float h = clamp(1.0 - e / uBevel, 0.0, 1.0);
    float edge = h * h;
    float melt = 1.0 - uMelt;

    // 屈折：縁で大きく曲がり、中ほどは少しだけ拡大する
    vec2 off = -grad * edge * 42.0 * uDpr * melt;
    if (uPanel.z > 0.5) off += (uPanel.xy - px) * 0.05 * melt;
    vec2 ou = off / uRes;
    float lod = mix(2.1, 0.4, edge) * melt;
    vec3 ref;
    ref.r = textureLod(uScene, uv + ou * 0.94, lod).r;
    ref.g = textureLod(uScene, uv + ou, lod).g;
    ref.b = textureLod(uScene, uv + ou * 1.06, lod).b;

    // 文字が読めるよう、中ほどは面の色を強く重ねる。縁は透かす
    vec3 glass = mix(ref, uSurface, uTint * (1.0 - edge * 0.8) * melt);

    // カーソルを追う反射の光
    vec2 dm = px - uSheen;
    float R = 190.0 * uDpr;
    float near = exp(-dot(dm, dm) / (R * R));
    glass = mix(glass, uLight, near * uSheenA * melt);

    // 縁の光：周を走る光と、カーソルに近い側
    vec2 pc = px - uPanel.xy;
    float a = atan(pc.y, pc.x);
    float run = pow(0.5 + 0.5 * sin(a * 2.0 - uT * 0.85), 12.0);
    float rim = 1.0 - smoothstep(0.6 * uDpr, 2.2 * uDpr, abs(e - 1.4 * uDpr));
    glass = mix(glass, uLight, rim * (0.55 + 0.45 * run + 0.5 * near) * melt);
    glass = mix(glass, uGlow, rim * run * 0.35 * melt);

    // 厚み：下の内側に細い影
    float inner = (1.0 - smoothstep(1.0 * uDpr, 9.0 * uDpr, e)) * clamp(0.5 - grad.y * 0.6, 0.0, 1.0);
    glass = mix(glass, uInk, inner * 0.12 * melt);
    float top = (1.0 - smoothstep(1.0 * uDpr, 7.0 * uDpr, e)) * clamp(0.5 + grad.y * 0.6, 0.0, 1.0);
    glass = mix(glass, uLight, top * 0.35 * melt);

    float cover = 1.0 - smoothstep(-0.8 * uDpr, 0.8 * uDpr, d);
    col = mix(col, glass, cover * melt);
  }

  // ボタン：板と同じガラスの、小さく厚い一枚。中を光が通る
  float btnA = uBtnA * (1.0 - uMelt);
  if (btnA > 0.001) {
    vec2 bp = px - uBtn.xy;
    float bd = rb(bp, uBtn.zw, uBtnR);
    // 外へにじむ光
    if (bd > 0.0 && bd < 26.0 * uDpr) {
      col = mix(col, uGlow, exp(-bd / (8.0 * uDpr)) * (0.1 + 0.14 * uBtnHot) * btnA);
    }
    if (bd < 1.5 * uDpr) {
      float be = max(-bd, 0.0);
      float eb = 1.5 * uDpr;
      vec2 bg = vec2(rb(bp + vec2(eb, 0.0), uBtn.zw, uBtnR) - rb(bp - vec2(eb, 0.0), uBtn.zw, uBtnR), rb(bp + vec2(0.0, eb), uBtn.zw, uBtnR) - rb(bp - vec2(0.0, eb), uBtn.zw, uBtnR));
      bg = bg / max(length(bg), 0.0001);
      float bh = clamp(1.0 - be / (13.0 * uDpr), 0.0, 1.0);
      float bedge = bh * bh;

      // 屈折：縁で強く曲がり、中はレンズのように拡大する
      vec2 bo = (-bg * bedge * 26.0 * uDpr - bp * 0.16) / uRes;
      vec3 br;
      br.r = textureLod(uScene, uv + bo * 0.92, 1.2).r;
      br.g = textureLod(uScene, uv + bo, 1.2).g;
      br.b = textureLod(uScene, uv + bo * 1.08, 1.2).b;
      vec3 g = mix(br, uSurface, uBtnTint * (1.0 - bedge * 0.7));

      // 中を通る光：斜めの帯が左から右へ抜ける。水の揺らぎで少し乱れる
      float u = bp.x / uBtn.z;
      float v = bp.y / uBtn.w;
      float center = -1.5 + 3.0 * uBandPhase;
      float wob = sin(u * 5.0 + uT * 1.3 + sin(v * 2.4 - uT * 0.9) * 1.6) * 0.06;
      float bandD = (u - center + v * 0.22 + wob) / 0.42;
      float band = exp(-bandD * bandD);
      float floorLight = smoothstep(1.0, -1.0, v) * 0.34;
      float light = clamp(max(band, floorLight) + 0.18, 0.0, 1.0);
      g = mix(g, uGlow, light * uBand);
      // 帯の芯は白く明るい。ここが光に見える
      float coreD = (u - center + v * 0.22 + wob) / 0.17;
      g = mix(g, uLight, exp(-coreD * coreD) * uBandCore);

      // 厚み：上の内側は明るく、下の内側に細い影
      float bTop = (1.0 - smoothstep(0.5 * uDpr, 5.0 * uDpr, be)) * clamp(0.5 + bg.y * 0.7, 0.0, 1.0);
      g = mix(g, uLight, bTop * 0.5);
      float bLow = (1.0 - smoothstep(0.5 * uDpr, 6.0 * uDpr, be)) * clamp(0.5 - bg.y * 0.7, 0.0, 1.0);
      g = mix(g, uInk, bLow * 0.1);

      // 縁：強調色の光の線。帯が通るところで明るくなる
      float bRim = 1.0 - smoothstep(0.5 * uDpr, 1.9 * uDpr, abs(be - 1.1 * uDpr));
      g = mix(g, uAccent, bRim * (0.8 + 0.2 * uBtnHot));
      g = mix(g, uGlow, bRim * band * 0.8);

      float bCover = 1.0 - smoothstep(-0.8 * uDpr, 0.8 * uDpr, bd);
      col = mix(col, g, bCover * btnA);
    }
  }

  // 白の階調が縞にならないよう、わずかに散らす
  float n = fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  outColor = vec4(col + n / 255.0, 1.0);
}`;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const seg = (t, from, to) => clamp((t - from) / (to - from));
// すべて、なめらかに減速して止まる
const out = (t, power = 4) => 1 - Math.pow(1 - clamp(t), power);
const inOut = (t) => {
  const x = clamp(t);
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
};

function messageFor(input) {
  const value = input.value;
  if (input.dataset.validate === 'email') {
    if (!value.trim()) return 'メールアドレスを入力してください。';
    if (!EMAIL.test(value.trim())) return 'メールアドレスの形を確かめてください（例：name@example.com）。';
    return '';
  }
  return value ? '' : 'パスワードを入力してください。';
}

export function mount(root) {
  const cleanups = [];
  const timers = new Set();
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const byId = (id) => root.querySelector(`[id="${id}"]`);

  const canvas = root.querySelector('.scene');
  const probe = root.querySelector('.probe');
  const card = root.querySelector('[data-card]');
  const welcome = root.querySelector('[data-welcome]');
  const form = root.querySelector('[data-form]');
  const submit = form.querySelector('.submit');
  const submitText = submit.querySelector('.submit-text');
  const inputs = [...form.querySelectorAll('[data-validate]')];
  const submitIdle = submitText.textContent;

  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  let reduced = motionQuery.matches;

  // ---- 色：どの書き方のトークンでも、1画素に塗って読む
  const paint = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const toRgb = (css) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = css;
    paint.fillRect(0, 0, 1, 1);
    const d = paint.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  };
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const colors = {};
  const glassMix = { tint: 0.6, sheen: 0.4 };
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const wcagLum = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const ratio = (a, b) => {
    const la = wcagLum(a);
    const lb = wcagLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const blend = (a, b, t) => a.map((c, i) => mix(c, b[i], t));
  // ガラスの後ろがいちばん読みにくい色でも、弱い文字（--_muted）が 4.5:1 を保つ濃さを探す。使い手の配色でも効く
  const solveGlass = () => {
    glassMix.sheen = colors.dark ? 0.04 : 0.45;
    const worst = colors.dark ? blend(colors.hi, colors.light, 0.5) : blend(colors.muted, colors.bg, 0.25);
    const goal = 4.7;
    let tint = 1;
    for (let t = 0.5; t <= 1; t += 0.01) {
      const seen = blend(blend(worst, colors.surface, t), colors.dark ? colors.light : colors.surface, colors.dark ? glassMix.sheen : 0);
      if (ratio(colors.muted, seen) >= goal) {
        tint = t;
        break;
      }
    }
    glassMix.tint = tint;
    // ボタン：文字（--_fg）が 4.5:1 を保てるところまで透かし、その中でいちばん強く光を通す
    const readable = (t, band) => {
      const over = (c) => blend(blend(c, colors.surface, t), colors.glow, band);
      return ratio(colors.fg, over(worst)) >= goal && ratio(colors.fg, over(colors.surface)) >= goal;
    };
    glassMix.btnTint = 1;
    for (let t = 0.34; t <= 1; t += 0.01) {
      if (readable(t, 0.3)) {
        glassMix.btnTint = t;
        break;
      }
    }
    glassMix.band = 0;
    for (let band = 0.62; band >= 0; band -= 0.02) {
      if (readable(glassMix.btnTint, band)) {
        glassMix.band = band;
        break;
      }
    }
    glassMix.core = 0;
    for (let core = 0.85; core >= 0; core -= 0.02) {
      const lit = (c) => blend(blend(blend(c, colors.surface, glassMix.btnTint), colors.glow, glassMix.band), colors.light, core);
      if (ratio(colors.fg, lit(worst)) >= goal && ratio(colors.fg, lit(colors.surface)) >= goal) {
        glassMix.core = core;
        break;
      }
    }
  };
  const readColors = () => {
    const style = getComputedStyle(root);
    for (const name of ['bg', 'surface', 'fg', 'muted', 'accent']) {
      probe.style.color = style.getPropertyValue(`--_${name}`).trim();
      colors[name] = toRgb(getComputedStyle(probe).color);
    }
    const all = [colors.bg, colors.surface, colors.fg].sort((a, b) => lum(a) - lum(b));
    colors.ink = all[0];
    colors.light = all[2];
    colors.dark = lum(colors.surface) < 0.4;
    // 光の色：強調色を、いちばん明るい色へ少し寄せる
    colors.glow = colors.accent.map((c, i) => mix(c, colors.light[i], colors.dark ? 0.1 : 0.22));
    // 都市の中の光：暗い配色では、いちばん明るい色をそのまま使うとうるさいので、弱い文字の色へ寄せる
    colors.hi = colors.dark ? colors.muted.map((c, i) => mix(c, colors.light[i], 0.28)) : colors.light;
    solveGlass();
  };

  // ---- WebGL
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch {
    gl = null;
  }

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    return shader;
  };
  const program = (fragment) => {
    const p = gl.createProgram();
    const v = compile(gl.VERTEX_SHADER, VERT);
    const f = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const cache = new Map();
    return {
      id: p,
      at(name) {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
        return cache.get(name);
      },
    };
  };

  let sceneProg = null;
  let glassProg = null;
  let quad = null;
  let vao = null;
  let tex = null;
  let fbo = null;
  let ready = false;

  const setupGl = () => {
    if (!gl) return false;
    try {
      sceneProg = program(SCENE);
      glassProg = program(GLASS);
    } catch (error) {
      console.warn('login-lumen: シェーダーを作れないので、止まった絵にする', error);
      return false;
    }
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    tex = gl.createTexture();
    fbo = gl.createFramebuffer();
    return true;
  };

  // ---- 大きさ
  let W = 1;
  let H = 1;
  let dpr = 1;
  let quality = Math.min(1, 1.25 / Math.min(2, devicePixelRatio || 1)); // 都市を描く解像度の割合。遅い機械では下げる
  let sceneW = 1;
  let sceneH = 1;

  const allocScene = () => {
    sceneW = Math.max(2, Math.round(canvas.width * quality));
    sceneH = Math.max(2, Math.round(canvas.height * quality));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sceneW, sceneH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  // ---- 板の形（DOM のカードと同じ場所）
  const panel = { x: 0, y: 0, hw: 0, hh: 0, radius: 0, bevel: 30, ty: 0, thh: 0, seeded: false };
  const btn = { x: 0, y: 0, ty: 0, hw: 0, hh: 0, radius: 0, phase: 0.2, hot: 0, hotT: 0 };
  const measureCard = () => {
    const base = canvas.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    panel.x = (rect.left - base.left + rect.width / 2) * dpr;
    panel.ty = canvas.height - (rect.top - base.top + rect.height / 2) * dpr;
    panel.hw = (rect.width / 2) * dpr;
    panel.thh = (rect.height / 2) * dpr;
    const cardStyle = getComputedStyle(card);
    panel.radius = (parseFloat(cardStyle.borderTopLeftRadius) || 0) * dpr;
    panel.bevel = Math.max(6, Math.min(30, (parseFloat(cardStyle.paddingLeft) || 30) - 4)) * dpr;
    // ボタンの場所。登場の途中で動いていても、止まった位置を測る
    const bRect = submit.getBoundingClientRect();
    const moved = new DOMMatrixReadOnly(getComputedStyle(submit).transform).m42;
    btn.x = (bRect.left - base.left + bRect.width / 2) * dpr;
    btn.ty = canvas.height - (bRect.top - moved - base.top + bRect.height / 2) * dpr;
    btn.hw = (bRect.width / 2) * dpr;
    btn.hh = (bRect.height / 2) * dpr;
    btn.radius = Math.min(parseFloat(getComputedStyle(submit).borderTopLeftRadius) || 0, bRect.height / 2) * dpr;
    if (!panel.seeded) {
      btn.y = btn.ty;
      panel.y = panel.ty;
      panel.hh = panel.thh;
      panel.seeded = true;
    }
  };

  const layout = () => {
    const rect = root.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (ready) allocScene();
    measureCard();
    sheen.x = sheen.tx = canvas.width * 0.62;
    sheen.y = sheen.ty = canvas.height * 0.68;
    seedDrops();
    needsDraw = true;
  };

  // ---- 水滴：散らばった場所から、板の中へ集まる
  const drops = [];
  const seedDrops = () => {
    drops.length = 0;
    const span = Math.min(canvas.width, canvas.height);
    for (let i = 0; i < DROPS; i++) {
      const a = (i / DROPS) * Math.PI * 2 + Math.sin(i * 12.9) * 0.5;
      const far = span * (0.26 + 0.2 * (0.5 + 0.5 * Math.sin(i * 78.2)));
      drops.push({
        sx: panel.x + Math.cos(a) * far * 1.25,
        sy: panel.ty + Math.sin(a) * far,
        ex: panel.x + Math.cos(a * 3.1) * panel.hw * 0.5,
        ey: panel.ty + Math.sin(a * 2.3) * panel.thh * 0.5,
        r: (9 + 15 * (0.5 + 0.5 * Math.sin(i * 37.1))) * dpr,
        delay: (i % 7) * 0.045,
      });
    }
  };
  const dropData = new Float32Array(DROPS * 3);

  // ---- 動きの状態
  const INTRO = { rays: [0, 0.9], iris: [0.1, 2.15], drops: [0.85, 2.2], panel: [1.25, 2.3], form: 1.9, end: 2.5 };
  let started = -1; // 登場の始まり（最初に見えた時）
  let now = 0;
  let intro = reduced ? 1 : 0;
  let introDone = reduced;
  let exit = 0; // Sign in の進み。0 → 1
  let exitFrom = 0;
  let exitTo = 0;
  let exitStart = -1;
  let exitDur = 2.2;
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  const sheen = { x: 0, y: 0, tx: 0, ty: 0 };
  let pointerInside = false;
  const pulses = new Float32Array(PULSES * 3);
  const pulseStart = new Float64Array(PULSES).fill(-100);
  const pulseRib = new Float32Array(PULSES);
  let pulseNext = 0;
  let needsDraw = true;

  const addPulse = (strength = 1) => {
    if (reduced || !ready) return;
    for (let i = 0; i < 2; i++) {
      pulseStart[pulseNext] = now;
      pulseRib[pulseNext] = Math.floor(Math.random() * BLADES);
      pulses[pulseNext * 3 + 2] = strength;
      pulseNext = (pulseNext + 1) % PULSES;
    }
    wake();
  };

  const irisRest = () => (W / H < 0.8 ? 1.02 : 0.92);
  // 地平線。横長の画面は中央の少し下、縦長の画面はカードの上の端（都市がカードの裏に隠れないように）
  const horizonUnit = () => {
    if (W / H >= 0.8) return -0.3;
    const S = 0.5 * Math.min(canvas.height, canvas.width * 1.6);
    return (panel.y + panel.thh - canvas.height / 2) / S - 0.02;
  };

  // ---- 描く
  const setColors = (prog, names) => {
    for (const [uniform, key] of names) gl.uniform3fv(prog.at(uniform), colors[key]);
  };

  const render = (t) => {
    const introT = reduced ? 99 : t - started;
    const openE = exit;
    const irisE = out(seg(introT, INTRO.iris[0], INTRO.iris[1]), 3);
    const rayE = out(seg(introT, INTRO.rays[0], INTRO.rays[1]), 3);
    const rest = irisRest();
    const iris = mix(0, rest, irisE) + inOut(seg(openE, 0.05, 0.85)) * 2.5;
    const rot = mix(-1.9, 0, irisE) + inOut(seg(openE, 0.05, 0.85)) * 1.25;
    const flood = inOut(seg(openE, 0.2, 0.8));
    const melt = out(seg(openE, 0.22, 0.72), 3);
    const panelE = out(seg(introT, INTRO.panel[0], INTRO.panel[1]), 4);
    const motionT = reduced ? 12 : t - started + 40;

    // 都市と殻
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, sceneW, sceneH);
    gl.useProgram(sceneProg.id);
    gl.uniform2f(sceneProg.at('uRes'), sceneW, sceneH);
    gl.uniform1f(sceneProg.at('uT'), motionT);
    gl.uniform1f(sceneProg.at('uIris'), iris);
    gl.uniform1f(sceneProg.at('uRot'), rot);
    gl.uniform1f(sceneProg.at('uRay'), rayE * (1 + flood * 0.6));
    gl.uniform1f(sceneProg.at('uFlood'), flood);
    gl.uniform2f(sceneProg.at('uPar'), par.x, par.y);
    gl.uniform1f(sceneProg.at('uHorizon'), horizonUnit());
    for (let i = 0; i < PULSES; i++) {
      const age = t - pulseStart[i];
      pulses[i * 3] = pulseRib[i];
      pulses[i * 3 + 1] = age;
      if (age > 3.2) pulses[i * 3 + 2] = 0;
    }
    gl.uniform3fv(sceneProg.at('uPulse'), pulses);
    setColors(sceneProg, [['uBg', 'bg'], ['uSurface', 'surface'], ['uFg', 'fg'], ['uMuted', 'muted'], ['uAccent', 'accent'], ['uLight', 'hi'], ['uInk', 'ink'], ['uGlow', 'glow']]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // ガラス
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(glassProg.id);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(glassProg.at('uScene'), 0);
    gl.uniform2f(glassProg.at('uRes'), canvas.width, canvas.height);
    gl.uniform1f(glassProg.at('uT'), motionT);
    gl.uniform1f(glassProg.at('uDpr'), dpr);
    gl.uniform1f(glassProg.at('uRadius'), panel.radius);
    gl.uniform1f(glassProg.at('uMelt'), melt);
    gl.uniform1f(glassProg.at('uTint'), glassMix.tint);
    gl.uniform1f(glassProg.at('uSheenA'), glassMix.sheen);
    gl.uniform1f(glassProg.at('uBevel'), panel.bevel);
    gl.uniform1f(glassProg.at('uDropK'), 34 * dpr);
    const grow = 1 + melt * 0.12;
    gl.uniform4f(glassProg.at('uPanel'), panel.x, panel.y, panel.hw * panelE * grow, panel.hh * panelE * grow);
    gl.uniform2f(glassProg.at('uSheen'), sheen.x, sheen.y);
    gl.uniform4f(glassProg.at('uBtn'), btn.x, btn.y, btn.hw, btn.hh);
    gl.uniform1f(glassProg.at('uBtnR'), btn.radius);
    gl.uniform1f(glassProg.at('uBtnA'), out(seg(introT, INTRO.form - 0.2, INTRO.end), 3));
    gl.uniform1f(glassProg.at('uBtnTint'), glassMix.btnTint);
    gl.uniform1f(glassProg.at('uBand'), glassMix.band);
    gl.uniform1f(glassProg.at('uBandCore'), glassMix.core);
    gl.uniform1f(glassProg.at('uBandPhase'), reduced ? 0.42 : btn.phase);
    gl.uniform1f(glassProg.at('uBtnHot'), btn.hot);
    let n = 0;
    if (introT < INTRO.panel[1] + 0.1) {
      for (let i = 0; i < DROPS; i++) {
        const d = drops[i];
        const e = out(seg(introT - d.delay, INTRO.drops[0], INTRO.drops[1]), 3);
        const appear = out(seg(introT - d.delay, INTRO.drops[0] - 0.25, INTRO.drops[0] + 0.15), 2);
        if (appear <= 0) continue;
        dropData[n * 3] = mix(d.sx, d.ex, e);
        dropData[n * 3 + 1] = mix(d.sy, d.ey, e);
        dropData[n * 3 + 2] = d.r * appear * (1 - panelE * 0.6);
        n++;
      }
      gl.uniform3fv(glassProg.at('uDrops'), dropData);
    }
    gl.uniform1i(glassProg.at('uDropN'), n);
    setColors(glassProg, [['uSurface', 'surface'], ['uLight', 'light'], ['uInk', 'ink'], ['uGlow', 'glow'], ['uAccent', 'accent']]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // ---- 時間を進める
  let raf = 0;
  let last = 0;
  let visible = true;
  let slow = 0;
  let good = 0;
  let adaptFrames = 0;

  const adapt = (dt) => {
    // 登場の始めのコンパイルなどを数えないよう、少し待ってから見る
    if (++adaptFrames < 30) return;
    if (dt > 0.0205) slow++;
    else good++;
    if (slow + good < 45) return;
    if (slow > 22 && quality > 0.3) {
      quality = Math.max(0.3, quality * 0.82);
      allocScene();
    }
    slow = 0;
    good = 0;
  };

  const tick = (ms) => {
    raf = 0;
    if (!ready) return;
    const t = ms / 1000;
    const dt = last ? t - last : 1 / 60;
    last = t;
    now = t;
    if (started < 0) {
      started = t;
      needsDraw = true;
    }
    if (reduced) {
      if (needsDraw) {
        render(t);
        needsDraw = false;
      }
      return;
    }

    adapt(dt);

    if (!introDone) {
      const introT = t - started;
      if (introT >= INTRO.form && root.classList.contains('is-veiled')) root.classList.remove('is-veiled');
      if (introT >= INTRO.end) introDone = true;
    }

    // Sign in の進み
    if (exitStart >= 0) {
      const p = clamp((t - exitStart) / exitDur);
      exit = mix(exitFrom, exitTo, p);
      if (p >= 1) exitStart = -1;
    }

    // カーソル：ない間は、光がゆっくり漂う
    if (!pointerInside) {
      sheen.tx = canvas.width * (0.5 + 0.2 * Math.sin(t * 0.31));
      sheen.ty = canvas.height * (0.5 + 0.26 * Math.sin(t * 0.23 + 1.3));
      par.tx = Math.sin(t * 0.13) * 0.35;
      par.ty = Math.sin(t * 0.17 + 0.8) * 0.25;
    }
    const fast = 1 - Math.exp(-dt * 9);
    const soft = 1 - Math.exp(-dt * 3.2);
    sheen.x += (sheen.tx - sheen.x) * fast;
    sheen.y += (sheen.ty - sheen.y) * fast;
    par.x += (par.tx - par.x) * soft;
    par.y += (par.ty - par.y) * soft;

    // エラーで背が伸びたカードに、板がなめらかに追いつく
    const follow = 1 - Math.exp(-dt * 12);
    panel.y += (panel.ty - panel.y) * follow;
    panel.hh += (panel.thh - panel.hh) * follow;
    btn.y += (btn.ty - btn.y) * follow;
    const busy = submit.disabled ? 1 : 0;
    btn.hot += (Math.max(btn.hotT, busy) - btn.hot) * (1 - Math.exp(-dt * 8));
    btn.phase = (btn.phase + dt * (0.24 + 0.3 * btn.hot + 0.45 * busy)) % 1;

    render(t);
    needsDraw = false;
    if (visible) raf = requestAnimationFrame(tick);
  };

  function wake() {
    if (!raf && visible && ready) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  // ---- フォーム
  const setError = (input, message) => {
    const error = byId(input.getAttribute('aria-describedby'));
    error.textContent = message;
    error.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  for (const input of inputs) {
    on(input, 'input', () => {
      input.dataset.dirty = 'true';
      if (input.hasAttribute('aria-invalid') && !messageFor(input)) setError(input, '');
      addPulse(1);
    });
    on(input, 'blur', () => {
      if (input.dataset.dirty === 'true') setError(input, messageFor(input));
    });
  }

  const showWelcome = () => {
    welcome.hidden = false;
    welcome.focus();
  };

  const send = () => {
    if (submit.disabled) return;
    let first = null;
    for (const input of inputs) {
      const message = messageFor(input);
      setError(input, message);
      if (message && !first) first = input;
    }
    if (first) {
      first.focus();
      return;
    }
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submitText.textContent = submit.dataset.busy;
    if (reduced) {
      exit = 1;
      root.classList.add('is-leaving');
      card.inert = true;
      card.hidden = true;
      needsDraw = true;
      wake();
      showWelcome();
      return;
    }
    for (let i = 0; i < 4; i++) addPulse(1);
    later(() => {
      root.classList.add('is-leaving');
      card.inert = true;
      exitFrom = exit;
      exitTo = 1;
      exitDur = 2.2;
      exitStart = now;
      wake();
      later(showWelcome, 1250);
    }, 450);
  };

  const back = () => {
    welcome.hidden = true;
    card.hidden = false;
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
    submitText.textContent = submitIdle;
    const password = form.querySelector('[name="password"]');
    password.value = '';
    delete password.dataset.dirty;
    if (reduced) {
      exit = 0;
      needsDraw = true;
      card.inert = false;
      root.classList.remove('is-leaving');
      wake();
      root.querySelector('.title').focus();
      return;
    }
    exitFrom = exit;
    exitTo = 0;
    exitDur = 1.7;
    exitStart = now;
    wake();
    later(() => {
      card.inert = false;
      root.classList.remove('is-leaving');
      root.querySelector('.title').focus();
    }, 1300);
  };

  // Ludion の iframe は sandbox="allow-scripts" だけで、submit イベントが来ない。送信ボタンの click で受ける。
  // Enter で送ったときも、ブラウザが送信ボタンを click する。ふつうのページに貼ったときのために submit も止める。
  on(submit, 'click', (event) => {
    event.preventDefault();
    send();
  });
  on(form, 'submit', (event) => {
    event.preventDefault();
    send();
  });
  // 押し下げた瞬間に入力欄から離れると、エラーの文でボタンがずれてクリックが外れる。押し下げではフォーカスを動かさない
  on(submit, 'mousedown', (event) => event.preventDefault());
  on(submit, 'pointerenter', () => {
    btn.hotT = 1;
    wake();
  });
  on(submit, 'pointerleave', () => {
    btn.hotT = 0;
  });
  on(root.querySelector('[data-return]'), 'click', back);

  // ---- カーソル
  const pointer = (event) => {
    if (reduced) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointerInside = true;
    sheen.tx = x * dpr;
    sheen.ty = canvas.height - y * dpr;
    par.tx = (x / W - 0.5) * 2;
    par.ty = -(y / H - 0.5) * 2;
    wake();
  };
  on(root, 'pointermove', pointer);
  on(root, 'pointerdown', pointer);
  on(root, 'pointerleave', () => {
    pointerInside = false;
    wake();
  });

  // ---- 組み立て
  readColors();
  ready = setupGl();
  let lost = false;
  const fallback = () => {
    ready = false;
    root.classList.remove('has-gl', 'is-veiled');
  };
  if (ready) {
    root.classList.add('has-gl');
    if (!reduced) root.classList.add('is-veiled');
    on(canvas, 'webglcontextlost', (event) => {
      event.preventDefault();
      lost = true;
      fallback();
    });
  } else {
    fallback();
  }

  const redraw = () => {
    needsDraw = true;
    wake();
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) redraw();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(root);

  const ro = new ResizeObserver((entries) => {
    let resized = false;
    for (const entry of entries) if (entry.target === root) resized = true;
    if (resized) layout();
    else measureCard();
    redraw();
  });
  ro.observe(root);
  ro.observe(card);

  on(motionQuery, 'change', () => {
    reduced = motionQuery.matches;
    if (reduced) root.classList.remove('is-veiled');
    if (reduced) introDone = true;
    redraw();
  });
  on(schemeQuery, 'change', () => {
    readColors();
    redraw();
  });

  layout();
  redraw();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    visible = false;
    ready = false;
    io.disconnect();
    ro.disconnect();
    for (const off of cleanups) off();
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (gl && !lost) {
      if (sceneProg) gl.deleteProgram(sceneProg.id);
      if (glassProg) gl.deleteProgram(glassProg.id);
      if (quad) gl.deleteBuffer(quad);
      if (vao) gl.deleteVertexArray(vao);
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  };
}
