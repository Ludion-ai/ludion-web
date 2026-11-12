// 見つけた物をためる所。分け目、技術、GLSL のバイト数。

import type { Language, Section, Tech, TechGroup } from './types.ts';
import type { LineIndex } from './text.ts';

/** 1つの技術で持つ「見つけた所」の数の上限（数は count に全部数える） */
export const MAX_HITS = 20;
/** 1つの版で持つ関数の分け目の上限（作り手の入れた文字で、地図が大きくなりすぎないように） */
export const MAX_FUNCTIONS = 3000;
/** 1つの版で持つ分け目の上限 */
export const MAX_SECTIONS = 6000;

const TECH: [id: string, group: TechGroup, label: string][] = [
  ['webgl2', 'draw', 'WebGL2'],
  ['webgl', 'draw', 'WebGL'],
  ['webgpu', 'draw', 'WebGPU'],
  ['canvas2d', 'draw', 'Canvas 2D'],
  ['svg', 'draw', 'SVG'],
  ['dom-css', 'draw', 'DOM + CSS'],
  ['webaudio', 'sound', 'Web Audio'],
  ['webaudio-synth', 'sound', 'Web Audio synthesis'],
  ['webaudio-decode', 'sound', 'Web Audio decoded audio'],
  ['audio-element', 'sound', '<audio>'],
  ['pointer', 'input', 'Pointer'],
  ['keyboard', 'input', 'Keyboard'],
  ['wheel', 'input', 'Wheel'],
  ['tilt', 'input', 'Device tilt'],
  ['raf', 'motion', 'requestAnimationFrame'],
  ['css-animation', 'motion', 'CSS animation'],
  ['css-transition', 'motion', 'CSS transition'],
  ['web-animations', 'motion', 'Web Animations'],
  ['reduced-motion', 'care', 'prefers-reduced-motion'],
  ['pause-hidden', 'care', 'visibilitychange / IntersectionObserver'],
  ['localstorage', 'storage', 'localStorage'],
  ['sessionstorage', 'storage', 'sessionStorage'],
  ['indexeddb', 'storage', 'IndexedDB'],
  ['google-fonts', 'external', 'Google Fonts'],
  ['cdn', 'external', 'CDN'],
  ['external', 'external', 'External URL'],
];
const TECH_ORDER = new Map(TECH.map(([id], order) => [id, order]));
const TECH_DEF = new Map(TECH.map(([id, group, label]) => [id, { group, label }]));

export type TechId = (typeof TECH)[number][0];

export class Collector {
  readonly sections: Section[] = [];
  private readonly tech = new Map<string, Tech>();
  /** ファイルごとの GLSL のバイト数（JS の中のシェーダーの文字列と、x-shader の script） */
  readonly glsl = new Map<string, number>();
  /** ファイルごとの CSS のバイト数（文書の作品の style） */
  readonly css = new Map<string, number>();
  /** ファイルごとの JS のバイト数（文書の作品の script。GLSL を含む） */
  readonly js = new Map<string, number>();
  functions = 0;

  section(section: Section): void {
    if (this.sections.length >= MAX_SECTIONS) return;
    if (section.kind === 'function') {
      if (this.functions >= MAX_FUNCTIONS) return;
      this.functions++;
    }
    this.sections.push(section);
  }

  hit(id: TechId, file: string, index: LineIndex, offset: number, match: string, host?: string): void {
    const def = TECH_DEF.get(id);
    if (!def) return;
    let tech = this.tech.get(id);
    if (!tech) {
      tech = { id, group: def.group, label: def.label, count: 0, hits: [] };
      this.tech.set(id, tech);
    }
    tech.count++;
    // 行の確かめに使う文字は、その行に収まるところまで
    const firstLine = match.split('\n')[0].replace(/\r$/, '').slice(0, 120);
    if (tech.hits.length < MAX_HITS) tech.hits.push({ file, line: index.line(offset), match: firstLine });
    if (host) {
      tech.hosts ??= [];
      if (!tech.hosts.includes(host) && tech.hosts.length < MAX_HITS) tech.hosts.push(host);
    }
  }

  has(id: TechId): boolean {
    return this.tech.has(id);
  }

  add(map: Map<string, number>, file: string, bytes: number): void {
    map.set(file, (map.get(file) ?? 0) + bytes);
  }

  techList(): Tech[] {
    return [...this.tech.values()].sort((a, b) => TECH_ORDER.get(a.id)! - TECH_ORDER.get(b.id)!);
  }
}

export interface Unit {
  text: string;
  index: LineIndex;
  file: string;
  /** 読む範囲 [start, end) */
  start: number;
  end: number;
  language: Language;
  col: Collector;
}
