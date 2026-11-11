// 音をコードで作る（V002）。録音の素材、既存の曲、既存のフレーズは使わない。和音と旋律の材料は timeline.json の audio にある。
// 静かで、広がりのある、温かい電子音。ゆっくりした和音のパッド、柔らかい低音、遠くで鳴るきらめき。
// カードが吸い込まれるたびに、短い空気の音とかすかな音程。カメラが画面に入る瞬間に、音がふっと広がる。
// ロゴの前で一度静かになり、最後に1つの和音で終わる。

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
const dbToGain = (db) => Math.pow(10, db / 20);
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

// 響き：8本の遅延線で作る広い残響（残りの長さは decay で決まる）
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
    this.preL = new Float32Array(Math.round(0.026 * SR));
    this.preR = new Float32Array(Math.round(0.031 * SR));
    this.preAt = 0;
  }
  process(inL, inR) {
    const lines = this.lines;
    const preLen = this.preL.length;
    const dl = this.preL[this.preAt % preLen];
    const dr = this.preR[this.preAt % this.preR.length];
    this.preL[this.preAt % preLen] = inL;
    this.preR[this.preAt % this.preR.length] = inR;
    this.preAt = (this.preAt + 1) % (preLen * this.preR.length);
    const out = new Array(8);
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      const l = lines[i];
      const v = l.buf[l.at];
      l.lp += (v - l.lp) * this.a;
      out[i] = l.lp;
      sum += l.lp;
    }
    const mixK = (2 / 8) * sum;
    let wetL = 0;
    let wetR = 0;
    for (let i = 0; i < 8; i++) {
      const l = lines[i];
      const fb = (out[i] - mixK) * this.decay;
      const inject = (i & 1 ? dr : dl) * 0.42;
      l.buf[l.at] = fb + inject;
      l.at = (l.at + 1) % l.len;
      if (i & 1) wetR += out[i];
      else wetL += out[i];
    }
    return [wetL * 0.32, wetR * 0.32];
  }
}

export function synthesize(tl) {
  const A = tl.audio;
  const dur = tl.duration;
  const N = Math.round(dur * SR);
  const beat = 60 / tl.bpm;
  const bar = beat * 4;
  const seedR = mulberry(tl.seed + 3);
  const lv = A.levels;

  // 乾いた音（L,R）と、響きへ送る音（L,R）
  const dryL = new Float32Array(N);
  const dryR = new Float32Array(N);
  const sendL = new Float32Array(N);
  const sendR = new Float32Array(N);

  const finalAt = A.finalChord.at;
  const musicEnv = (t) => {
    const fadeIn = q5(seg(t, A.padIn[0], A.padIn[1]));
    const fadeOut = 1 - q5(seg(t, A.musicOut[0], A.musicOut[1]));
    return fadeIn * fadeOut;
  };
  // 画面の中へ入ると開く：明るさと広がり
  const openAt = A.enterAt;
  const openness = (t) => 0.32 + 0.68 * q5(seg(t, openAt - 0.5, openAt + 1.2));

  // ---- パッド：和音ごとに、すこしずらしたのこぎり波を重ねて、ゆっくり開く低域通過に通す
  const chordCount = Math.ceil(dur / bar) + 1;
  const padEnd = A.musicOut[1] + 1.2;
  for (let c = 0; c < chordCount; c++) {
    const startT = c * bar;
    if (startT > padEnd) break;
    const chord = A.chords[c % A.chords.length];
    const length = bar + 2.4; // 次の和音に重なって、つなぎ目が聞こえない
    chord.notes.forEach((midi, noteIndex) => {
      const f = mtof(midi);
      const detunes = [-0.0035, 0.0028, 0.0061];
      detunes.forEach((d, vi) => {
        let phase = seedR();
        let lp1 = 0;
        let lp2 = 0;
        const dt = (f * (1 + d)) / SR;
        const pan = 0.5 + (noteIndex % 2 ? 0.26 : -0.26) * (vi === 1 ? -0.5 : 1);
        const g = lv.pad * (midi < 50 ? 0.55 : 1) * 0.15;
        const start = Math.round(startT * SR);
        const n = Math.round(length * SR);
        const lfoP = seedR() * TAU;
        for (let i = 0; i < n && start + i < N; i++) {
          const t = i / SR;
          const abs = startT + t;
          const env = q5(t / 1.25) * (1 - q5((t - (length - 2.1)) / 2.1));
          if (env <= 0) continue;
          const master = musicEnv(abs);
          if (master <= 0) continue;
          phase += dt;
          if (phase >= 1) phase -= 1;
          const saw = 2 * phase - 1 - blep(phase, dt);
          const open = openness(abs);
          const fc = (340 + 2300 * open * open) * (1 + 0.1 * Math.sin(TAU * 0.09 * abs + lfoP));
          const a = onePole(fc);
          lp1 += (saw - lp1) * a;
          lp2 += (lp1 - lp2) * a;
          const s = lp2 * env * master * g;
          const width = 0.45 + 0.55 * open;
          const pl = 0.5 + (pan - 0.5) * width;
          dryL[start + i] += s * (1 - pl) * 1.4;
          dryR[start + i] += s * pl * 1.4;
          sendL[start + i] += s * (1 - pl) * 1.1;
          sendR[start + i] += s * pl * 1.1;
        }
      });
    });
    // ---- 低音：基音の正弦波。始まりは丸く
    const rootMidi = chord.notes[0];
    const f = mtof(rootMidi);
    const lead = c === 0 ? 0 : 0.4;
    const start = Math.round((startT - lead) * SR);
    const n = Math.round((bar + lead + 0.4) * SR);
    let phase = 0;
    for (let i = 0; i < n && start + i < N; i++) {
      const t = i / SR;
      const abs = startT - lead + t;
      const bassOn = q5(seg(abs, A.bassIn[0], A.bassIn[1]));
      const master = musicEnv(abs) * bassOn;
      if (master <= 0) continue;
      const env = q5(t / 0.8) * (1 - q5((t - bar + 0.4 - lead) / 0.8));
      phase += f / SR;
      const s = (Math.sin(TAU * phase) + 0.28 * Math.sin(TAU * 2 * phase)) * env * master * lv.bass;
      dryL[start + i] += s;
      dryR[start + i] += s;
    }
  }

  // ---- きらめき：遠くで鳴る鐘の音（2つの正弦波の変調）。乱数は種を固定
  const addBell = (t0, midi, vel, panX, length = 2.2) => {
    const f = mtof(midi);
    const start = Math.round(t0 * SR);
    const n = Math.round(length * SR);
    for (let i = 0; i < n && start + i < N; i++) {
      const t = i / SR;
      const mod = Math.sin(TAU * f * 2.01 * t) * 1.1 * Math.exp(-t / 0.22);
      const s = Math.sin(TAU * f * t + mod) * Math.min(1, t / 0.004) * Math.exp(-t / 0.62) * vel;
      const l = s * (1 - panX);
      const r = s * panX;
      dryL[start + i] += l * 0.4;
      dryR[start + i] += r * 0.4;
      sendL[start + i] += l;
      sendR[start + i] += r;
    }
  };
  const sparkleR = mulberry(tl.seed + 5);
  for (let step = 0; step * (beat / 2) < A.musicOut[0]; step++) {
    const t = step * (beat / 2);
    if (t < A.sparkleFrom) continue;
    const prob = 0.13 + 0.17 * q5(seg(t, openAt - 3, openAt + 3));
    const roll = sparkleR();
    const note = A.sparkleScale[Math.floor(sparkleR() * A.sparkleScale.length)];
    const pan = 0.18 + sparkleR() * 0.64;
    const vel = 0.5 + sparkleR() * 0.5;
    if (roll < prob) addBell(t, note, lv.sparkle * vel * musicEnv(t), pan);
  }

  // ---- 空気の音：ノイズを絞って作る。吸い込まれる時刻に向かって高くなり、そこで閉じる
  const addAir = (tEnd, length, gain, panFrom, panTo, fLo, fHi, seed) => {
    const noise = mulberry(seed);
    const start = Math.round((tEnd - length) * SR);
    const n = Math.round((length + 0.09) * SR);
    let low = 0;
    let band = 0;
    for (let i = 0; i < n; i++) {
      const at = start + i;
      if (at < 0 || at >= N) continue;
      const u = i / (length * SR);
      const env = u < 1 ? Math.pow(q5(u), 1.6) : Math.max(0, 1 - (u - 1) * (length / 0.09));
      const fc = fLo * Math.pow(fHi / fLo, Math.min(1, u));
      const q = 2 * Math.sin((Math.PI * Math.min(fc, 12000)) / SR);
      const w = noise() * 2 - 1;
      low += q * band;
      const high = w - low - 0.55 * band;
      band += q * high;
      const s = band * env * gain;
      const p = panFrom + (panTo - panFrom) * Math.min(1, u);
      dryL[at] += s * (1 - p) * 1.3;
      dryR[at] += s * p * 1.3;
      sendL[at] += s * (1 - p) * 0.8;
      sendR[at] += s * p * 0.8;
    }
  };
  const addTone = (t0, midi, gain, panX, length = 0.9) => {
    const f = mtof(midi);
    const start = Math.round(t0 * SR);
    const n = Math.round(length * SR);
    for (let i = 0; i < n && start + i < N; i++) {
      const t = i / SR;
      const s = (Math.sin(TAU * f * t) + 0.22 * Math.sin(TAU * f * 2 * t)) * Math.min(1, t / 0.006) * Math.exp(-t / 0.2) * gain;
      dryL[start + i] += s * (1 - panX) * 0.5;
      dryR[start + i] += s * panX * 0.5;
      sendL[start + i] += s * (1 - panX);
      sendR[start + i] += s * panX;
    }
  };
  tl.cards.flights.forEach((f, i) => {
    const side = f.side;
    const from = side < 0 ? 0.12 : side > 0 ? 0.88 : 0.5;
    addAir(f.absorb, f.side === 0 ? 1.1 : 0.72, lv.air * (f.side === 0 ? 1.15 : 0.82), from, 0.5, 480, 3600, tl.seed + 100 + i);
    addTone(f.absorb, A.cardPitches[i % A.cardPitches.length], lv.cardTone, 0.5 + (0.5 - from) * 0.2);
  });

  // ---- 画面に入る瞬間：音がふっと広がる
  {
    const t0 = A.enterAt;
    addAir(t0, 1.6, lv.enter * 0.8, 0.5, 0.5, 300, 5200, tl.seed + 300);
    const notes = A.chords[(Math.floor(t0 / bar)) % A.chords.length].notes.filter((m) => m >= 60);
    notes.forEach((m, i) => addBell(t0 + i * 0.045, m + 12, lv.enter * 0.42, 0.25 + (i / notes.length) * 0.5, 3.0));
  }

  // ---- 作品を触る音、コピーの音（小さく、上品に）
  const addTick = (t0, gain, f1, f2, seed, panX = 0.5) => {
    const noise = mulberry(seed);
    const start = Math.round(t0 * SR);
    const n = Math.round(0.14 * SR);
    let lp = 0;
    for (let i = 0; i < n && start + i < N; i++) {
      const t = i / SR;
      lp += (noise() * 2 - 1 - lp) * 0.3;
      const s = (Math.sin(TAU * f1 * t) * Math.exp(-t / 0.014) + Math.sin(TAU * f2 * t) * Math.exp(-t / 0.03) * 0.8 + lp * Math.exp(-t / 0.003) * 0.5) * gain;
      dryL[start + i] += s * (1 - panX) * 1.2;
      dryR[start + i] += s * panX * 1.2;
      sendL[start + i] += s * 0.3;
      sendR[start + i] += s * 0.3;
    }
  };
  const seq = tl.workSequence;
  const pf = tl.pageFlow;
  addTick(seq.grab, lv.touch, 1420, 520, tl.seed + 401, 0.46);
  addTick(seq.release, lv.touch * 0.7, 1180, 440, tl.seed + 402, 0.56);
  // 昼から夜へ：つまみを動かす間だけ、ごく細い息のような音
  addAir(seq.drag[1], seq.drag[1] - seq.drag[0], lv.touch * 0.5, 0.44, 0.58, 900, 420, tl.seed + 403);
  addTick(pf.press, lv.copy, 1760, 760, tl.seed + 404, 0.6);
  addBell(pf.press + 0.07, 84, lv.copy * 0.42, 0.56, 1.4);
  addBell(pf.creditGlow[0] + 0.15, 88, lv.copy * 0.5, 0.42, 2.4);
  addBell(pf.creditGlow[0] + 0.26, 93, lv.copy * 0.36, 0.58, 2.4);

  // ---- 並べ替え：カードが動くたびに、弱い空気の音
  const R0 = tl.cards.reorder;
  tl.cards.orderAfter.forEach((id, k) => {
    const start = R0.start + k * R0.stagger;
    addAir(start + R0.dur * 0.62, R0.dur * 0.5, lv.air * 0.26, 0.2 + (k / 10) * 0.6, 0.5, 700, 2200, tl.seed + 500 + k);
  });

  // ---- 響きを通す
  const rev = new Reverb(tl.seed + 9, 0.88, 3800);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const [wl, wr] = rev.process(sendL[i], sendR[i]);
    const wet = 0.55 + 0.45 * q5(seg(t, openAt - 0.4, openAt + 0.9));
    L[i] = dryL[i] + wl * wet;
    R[i] = dryR[i] + wr * wet;
  }

  // ---- ロゴの前の静けさ：響きも閉じて、ほとんど音がなくなる
  const quietFrom = A.musicOut[1] - 0.2;
  for (let i = Math.round(quietFrom * SR); i < Math.round(finalAt * SR) && i < N; i++) {
    const t = i / SR;
    const g = 1 - q5(seg(t, quietFrom, finalAt - 0.12));
    L[i] *= g;
    R[i] *= g;
  }

  // ---- 最後の1つの和音（響きも別に作る。前の音は混ぜない）
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
      const end = 1 - q5((i / SR - (n / SR - 1.1)) / 1.1); // 映像の終わりまでに静かに止まる
      L[start + i] += (fL[i] + wl * 0.8) * end;
      R[start + i] += (fR[i] + wr * 0.8) * end;
    }
  }

  // ---- 重ねすぎたピークだけを、先読みで下げる。天井を越えないように
  const CEILING = 1.15;
  const need = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
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
    R[i] *= need[i];
  }
  const tail = Math.round(0.08 * SR);
  for (let i = 0; i < tail; i++) {
    const g = i / tail;
    L[N - 1 - i] *= g;
    R[N - 1 - i] *= g;
  }
  return { L, R, N, limited: Number(((limited / N) * 100).toFixed(2)) };
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

export { dbToGain };
