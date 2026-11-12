// 作品の中身の地図（WS002）。Worker（置くとき、初めて読むとき）、ld（ld outline）、テストが同じものを使う。

export { buildOutline } from './outline.ts';
export { verifyOutline } from './verify.ts';
export { MAX_FUNCTIONS, MAX_HITS, MAX_SECTIONS } from './collect.ts';
export { OUTLINE_VERSION } from './types.ts';
export type { Language, LanguageBytes, Outline, OutlineFile, OutlineInput, Section, SectionKind, Tech, TechGroup, TechHit } from './types.ts';

/** 版の置き場の地図のファイルの名前 */
export const OUTLINE_FILE = 'outline.json';
