// 作品の中身の地図（WS002）。Worker（置くとき、初めて読むとき）、ld（ld outline）、テストが同じものを使う。

export { buildOutline } from './outline.ts';
export { verifyOutline } from './verify.ts';
export { MAX_FUNCTIONS, MAX_HITS, MAX_SECTIONS, TECH_LIST } from './collect.ts';
export { MAX_CANDIDATES, MAX_MAP_SECTIONS, MAX_PART_READ_BYTES, findSection, formatMap, innerSections, numberLines, parseLineRange, readLines, selectorNames, techQuery, workFiles } from './read.ts';
export type { PartRead, SectionMatch } from './read.ts';
export { OUTLINE_VERSION } from './types.ts';
export type { Language, LanguageBytes, Outline, OutlineFile, OutlineInput, Section, SectionKind, Tech, TechGroup, TechHit } from './types.ts';

/** 版の置き場の地図のファイルの名前 */
export const OUTLINE_FILE = 'outline.json';
