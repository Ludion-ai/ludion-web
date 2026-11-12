// V006 の音をコードで作る。録音の素材、既存の曲、既存のフレーズは使わない。和音の材料と出来事の時刻は timeline.json にある。
// 音楽も一緒に育てる：最初は音が少なく、場面が進むにつれて重なり、最後に1つの和音で止まる。
// 絵と同じ時刻の表から作る：打鍵は指示の文字が出る時刻、短い和音はプラグインの行が出る時刻、風はカメラが板の間を動く区間。

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const SR = 48000;
const TAU = Math.PI * 2;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const q5 = (x) => {
  x = clamp(x);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const onePole = (fc) => 1 - Math.exp((-TAU * fc) / SR);
const blep = (p, dt) => {
  if (p < dt) {
    const x = p / dt;
    return x + x - x * x - 1;
  }
  if (p > 1 - dt) {
    const x = (p - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

class Reverb {
  constructor(seed, decay = 0.86, damp = 4200) {
    const r = mulberry(seed);
    const base = [1433, 1601, 1867, 2053, 2251, 2399, 2617, 2797];
    this.lines = base.map((n) => {
      const len = Math.round((n * (1 + r() * 0.04) * SR) / 44100);
      return { buf: new Float32Array(len), at: 0, lp: 0, len };
    });
    this.decay = decay;
    this.a = onePole(damp);
  }
  process(inL, inR) {
    const lines = this.lines;
    let sum = 0;
    const out = new Array(8);
    for (let i = 0; i < 8; i++) {
      const l = lines[i];
      l.lp += (l.buf[l.at] - l.lp) * this.a;
      out[i] = l.lp;
      sum += l.lp;
    }
    const mixK = (2 / 8) * sum;
    let wetL = 0;
    let wetR = 0;
    for (let i = 0; i < 8; i++) {
      const l = lines[i];
      l.buf[l.at] = (out[i] - mixK) * this.decay + (i & 1 ? inR : inL) * 0.42;
      l.at = (l.at + 1) % l.len;
      if (i & 1) wetR += out[i];
      else wetL += out[i];
    }
    return [wetL * 0.32, wetR * 0.32];
  }
}

/** 場面1の、指示を打つ音の時刻（絵の文字が出る時刻と同じ式）。 */
export function typeTimes(tl, chars) {
  const T = tl.terminal;
  const step = (T.type[1] - T.type[0]) / chars;
  const out = [];
  for (let i = 0; i < chars; i += T.typeTickEvery ?? 1) out.push(T.type[0] + i * step);
  return out;
}

export function synthesize(tl, facts) {
  const A = tl.audio;
  const lv = A.levels;
  const T = tl.terminal;
  const N = Math.round(tl.duration * SR);
  const beat = 60 / tl.bpm;
  const chordLen = beat * 8;
  const seedR = mulberry(tl.seed + 3);
  const dryL = new Float32Array(N);
  const dryR = new Float32Array(N);
  const sendL = new Float32Array(N);
  const sendR = new Float32Array(N);
  const events = [];

  const musicEnv = (t) => q5(seg(t, A.padIn[0], A.padIn[1])) * (1 - q5(seg(t, A.musicOut[0], A.musicOut[1])));
  // 場面が進むほど、明るく開く
  const sceneFrom = (id) => tl.scenes.find((s) => s.id === id).from;
  const openness = (t) => 0.22 + 0.2 * q5(seg(t, sceneFrom(2) - 0.5, sceneFrom(2) + 1.5)) + 0.25 * q5(seg(t, sceneFrom(3) - 0.5, sceneFrom(3) + 2)) + 0.33 * q5(seg(t, sceneFrom(4) - 0.5, sceneFrom(4) + 3));

  const put = (i, l, r, sl, sr) => {
    if (i < 0 || i >= N) return;
    dryL[i] += l;
    dryR[i] += r;
    sendL[i] += sl;
    sendR[i] += sr;
  };

  // ---- パッドと低音。和音の音は、場面が進むごとに1つずつ重なる
  const chordCount = Math.ceil(tl.duration / chordLen) + 1;
  for (let c = 0; c < chordCount; c++) {
    const startT = c * chordLen;
    if (startT > A.musicOut[1] + 1) break;
    const chord = A.chords[c % A.chords.length];
    const length = chordLen + 2.2;
    chord.notes.forEach((midi, noteIndex) => {
      const enter = A.voiceIn[Math.min(noteIndex, A.voiceIn.length - 1)];
      if (startT + length < enter) return;
      const f = mtof(midi);
      [-0.0035, 0.0028, 0.0061].forEach((d, vi) => {
        let phase = seedR();
        let lp1 = 0;
        let lp2 = 0;
        const dt = (f * (1 + d)) / SR;
        const pan = 0.5 + (noteIndex % 2 ? 0.26 : -0.26) * (vi === 1 ? -0.5 : 1);
        const g = lv.pad * (midi < 50 ? 0.55 : 1) * 0.15;
        const start = Math.round(startT * SR);
        const n = Math.round(length * SR);
        for (let i = 0; i < n && start + i < N; i++) {
          const t = i / SR;
          const abs = startT + t;
          const env = q5(t / 1.2) * (1 - q5((t - (length - 2)) / 2));
          const master = musicEnv(abs) * q5(seg(abs, enter, enter + 2.5));
          if (env <= 0 || master <= 0) continue;
          phase += dt;
          if (phase >= 1) phase -= 1;
          const saw = 2 * phase - 1 - blep(phase, dt);
          const open = openness(abs);
          const a = onePole(320 + 2400 * open * open);
          lp1 += (saw - lp1) * a;
          lp2 += (lp1 - lp2) * a;
          const s = lp2 * env * master * g;
          put(start + i, s * (1 - pan) * 1.4, s * pan * 1.4, s * (1 - pan) * 1.1, s * pan * 1.1);
        }
      });
    });
    // 低い音は、場面4から重なる
    const f = mtof(chord.notes[0]);
    const start = Math.round(startT * SR);
    const n = Math.round((chordLen + 0.4) * SR);
    let phase = 0;
    for (let i = 0; i < n && start + i < N; i++) {
      const t = i / SR;
      const abs = startT + t;
      const master = musicEnv(abs) * q5(seg(abs, A.bassIn, A.bassIn + 3));
      if (master <= 0) continue;
      const env = q5(t / 0.8) * (1 - q5((t - chordLen + 0.4) / 0.8));
      phase += f / SR;
      const s = (Math.sin(TAU * phase) + 0.28 * Math.sin(TAU * 2 * phase)) * env * master * lv.bass;
      put(start + i, s, s, 0, 0);
    }
  }

  // ---- 部品の音
  const addBell = (t0, midi, vel, panX, length = 2.2) => {
    const f = mtof(midi);
    const start = Math.round(t0 * SR);
    const n = Math.round(length * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const mod = Math.sin(TAU * f * 2.01 * t) * 1.1 * Math.exp(-t / 0.22);
      const s = Math.sin(TAU * f * t + mod) * Math.min(1, t / 0.004) * Math.exp(-t / 0.62) * vel;
      put(start + i, s * (1 - panX) * 0.4, s * panX * 0.4, s * (1 - panX), s * panX);
    }
  };
  // 柔らかい、短い音（増えていくときの分散和音）
  const addPluck = (t0, midi, vel, panX) => {
    const f = mtof(midi);
    const start = Math.round(t0 * SR);
    const n = Math.round(0.9 * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const s = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.08)) * Math.min(1, t / 0.006) * Math.exp(-t / 0.2) * vel;
      put(start + i, s * (1 - panX) * 0.9, s * panX * 0.9, s * (1 - panX) * 0.7, s * panX * 0.7);
    }
  };
  const addTick = (t0, gain, f1, f2, seed, panX = 0.5) => {
    const noise = mulberry(seed);
    const start = Math.round(t0 * SR);
    const n = Math.round(0.14 * SR);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      lp += (noise() * 2 - 1 - lp) * 0.3;
      const s = (Math.sin(TAU * f1 * t) * Math.exp(-t / 0.014) + Math.sin(TAU * f2 * t) * Math.exp(-t / 0.03) * 0.8 + lp * Math.exp(-t / 0.003) * 0.5) * gain;
      put(start + i, s * (1 - panX) * 1.2, s * panX * 1.2, s * 0.3, s * 0.3);
    }
  };
  const addAir = (tEnd, length, gain, fLo, fHi, seed, panFrom = 0.5, panTo = 0.5) => {
    const noise = mulberry(seed);
    const start = Math.round((tEnd - length) * SR);
    const n = Math.round((length + 0.12) * SR);
    let low = 0;
    let band = 0;
    for (let i = 0; i < n; i++) {
      const u = i / (length * SR);
      const env = u < 1 ? Math.pow(q5(u), 1.6) : Math.max(0, 1 - (u - 1) * (length / 0.12));
      const fc = fLo * Math.pow(fHi / fLo, Math.min(1, u));
      const q = 2 * Math.sin((Math.PI * Math.min(fc, 12000)) / SR);
      low += q * band;
      const high = noise() * 2 - 1 - low - 0.55 * band;
      band += q * high;
      const s = band * env * gain;
      const p = panFrom + (panTo - panFrom) * Math.min(1, u);
      put(start + i, s * (1 - p) * 1.3, s * p * 1.3, s * (1 - p) * 0.8, s * p * 0.8);
    }
  };

  // ---- 場面1：打つ、送る、書かれる、置かれる
  const chars = [...facts.prompt].length;
  typeTimes(tl, chars).forEach((t, i) => {
    addTick(t, lv.type * (0.8 + (i % 3) * 0.12), 2250 + (i % 4) * 130, 880, tl.seed + 420 + i, 0.44 + (i % 5) * 0.02);
    events.push({ kind: 'type', t });
  });
  addTick(T.enter, lv.enter, 1180, 460, tl.seed + 401, 0.48);
  events.push({ kind: 'enter', t: T.enter });
  addAir(T.flow[1], T.flow[1] - T.flow[0], lv.flow * 2.4, 700, 3000, tl.seed + 510);
  // 置いた瞬間の短い和音（プラグインの行が出る時刻）
  A.saveChord.forEach((midi, i) => addBell(T.hook + i * 0.022, midi, lv.save * (i === 0 ? 1 : 0.72), 0.36 + i * 0.09, 1.9));
  events.push({ kind: 'save', t: T.hook });
  addPluck(T.say, A.saveChord[1] - 12, lv.say, 0.5);
  events.push({ kind: 'say', t: T.say });

  // ---- カメラが板の間を動くときの風。動く区間は、カメラのキーから取る
  const keys = tl.camera.keys;
  for (let i = 1; i < keys.length; i++) {
    const dx = keys[i].p[0] - keys[i - 1].p[0];
    if (Math.abs(dx) < 1000 || keys[i].t > tl.duration) continue;
    const right = dx > 0;
    addAir(keys[i].t - 0.15, keys[i].t - keys[i - 1].t - 0.15, lv.air, 420, 2800, tl.seed + 500 + i, right ? 0.3 : 0.7, right ? 0.7 : 0.3);
    events.push({ kind: 'move', t: keys[i - 1].t, to: keys[i].t });
  }

  // ---- 場面2〜4の出来事（絵を撮ってから timeline.json の audio.events に入れる）
  for (const e of A.events) {
    if (e.kind === 'bell') addBell(e.t, e.midi, (e.vel ?? 1) * lv.save * 0.6, e.pan ?? 0.5, e.length ?? 1.8);
    else if (e.kind === 'pluck') addPluck(e.t, e.midi, (e.vel ?? 1) * lv.say * 1.4, e.pan ?? 0.5);
    else if (e.kind === 'tick') addTick(e.t, (e.vel ?? 1) * lv.enter, 1320, 560, tl.seed + 600 + Math.round(e.t * 100), e.pan ?? 0.5);
    else throw new Error(`audio.events の kind が分からない: ${e.kind}`);
    events.push({ kind: `event:${e.kind}`, t: e.t });
  }

  // ---- ずっと遠くで鳴るきらめき（場面2から）
  const sparkleR = mulberry(tl.seed + 5);
  for (let step = 0; step * (beat / 2) < A.musicOut[0]; step++) {
    const t = step * (beat / 2);
    const roll = sparkleR();
    const note = A.sparkleScale[Math.floor(sparkleR() * A.sparkleScale.length)];
    const pan = 0.18 + sparkleR() * 0.64;
    const vel = 0.5 + sparkleR() * 0.5;
    if (t > sceneFrom(2) + 0.6 && roll < 0.1) addBell(t, note, lv.sparkle * vel * musicEnv(t), pan);
  }

  // ---- 響き
  const rev = new Reverb(tl.seed + 9, 0.88, 3800);
  const L = new Float32Array(N);
  const R2 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const [wl, wr] = rev.process(sendL[i], sendR[i]);
    L[i] = dryL[i] + wl * 0.75;
    R2[i] = dryR[i] + wr * 0.75;
  }

  // ---- ロゴの前の静けさと、最後の1つの和音
  const finalAt = A.finalChord.at;
  const quietFrom = A.musicOut[1] - 0.1;
  for (let i = Math.round(quietFrom * SR); i < Math.round(finalAt * SR) && i < N; i++) {
    const g = 1 - q5(seg(i / SR, quietFrom, finalAt - 0.05));
    L[i] *= g;
    R2[i] *= g;
  }
  {
    const rev2 = new Reverb(tl.seed + 13, 0.9, 5200);
    const start = Math.round(finalAt * SR);
    const n = N - start;
    const fL = new Float32Array(n);
    const fR = new Float32Array(n);
    A.finalChord.notes.forEach((midi, ni) => {
      const f = mtof(midi);
      const pan = 0.5 + (ni % 2 ? 1 : -1) * Math.min(0.34, ni * 0.055);
      const delay = ni * 0.022;
      const low = midi < 48;
      for (let v = 0; v < 2; v++) {
        const d = v ? 1.0022 : 0.9984;
        let phase = 0;
        for (let i = Math.round(delay * SR); i < n; i++) {
          const t = i / SR - delay;
          phase += (f * d) / SR;
          const body = Math.sin(TAU * phase) + 0.34 * Math.sin(TAU * 2 * phase) * Math.exp(-t / 0.9) + 0.12 * Math.sin(TAU * 3 * phase) * Math.exp(-t / 0.5);
          const env = Math.min(1, t / (low ? 0.05 : 0.02)) * Math.exp(-t / (low ? 1.9 : 1.45));
          const s = body * env * lv.final * (low ? 0.6 : 0.32) * 0.5;
          fL[i] += s * (1 - pan);
          fR[i] += s * pan;
        }
      }
    });
    for (let i = 0; i < n; i++) {
      const [wl, wr] = rev2.process(fL[i] * 0.8, fR[i] * 0.8);
      const end = 1 - q5((i / SR - (n / SR - 1.1)) / 1.1);
      L[start + i] += (fL[i] + wl * 0.8) * end;
      R2[start + i] += (fR[i] + wr * 0.8) * end;
    }
    events.push({ kind: 'final', t: finalAt });
  }

  // ---- 重ねすぎたピークだけを、先読みで下げる
  const CEILING = A.ceiling ?? 1.15;
  const need = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const m = Math.max(Math.abs(L[i]), Math.abs(R2[i]));
    need[i] = m > CEILING ? CEILING / m : 1;
  }
  const attack = 1 / (0.004 * SR);
  const release = 1 / (0.18 * SR);
  for (let i = N - 2; i >= 0; i--) need[i] = Math.min(need[i], need[i + 1] + attack);
  let limited = 0;
  for (let i = 1; i < N; i++) {
    need[i] = Math.min(need[i], need[i - 1] + release);
    if (need[i] < 0.999) limited += 1;
  }
  for (let i = 0; i < N; i++) {
    L[i] *= need[i];
    R2[i] *= need[i];
  }
  const tail = Math.round(0.08 * SR);
  for (let i = 0; i < tail; i++) {
    const g = i / tail;
    L[N - 1 - i] *= g;
    R2[N - 1 - i] *= g;
  }
  return { L, R: R2, N, limited: Number(((limited / N) * 100).toFixed(2)), events };
}

export function writeWav(path, L, R) {
  const frames = L.length;
  const dataBytes = frames * 8;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    buf.writeFloatLE(L[i], 44 + i * 8);
    buf.writeFloatLE(R[i], 48 + i * 8);
  }
  writeFileSync(path, buf);
  return createHash('sha256').update(buf).digest('hex');
}
