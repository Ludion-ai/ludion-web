// 描画しなくても確かめられる規則：「形」と「トークンの純度」（docs/tasks/T002.md「3」）。
// Node の API を使わない。ld と Worker（T004）の両方から、同じ関数を使い回すため。

import postcss, { type Declaration, type Rule } from 'postcss';
import { ALL_TOKEN_NAMES, OPTIONAL_TOKEN_NAMES, TOKEN_NAMES, exportsMount } from '@ludion/render';

export interface Problem {
  /** 何が違うか */
  message: string;
  /** どう直すか */
  fix: string;
}

export const CATEGORIES = ['Web', 'Mobile', 'Dashboard', 'Ecommerce', 'Components'] as const;
export const TAGS = ['dashboard', 'ecommerce', 'minimal', 'experimental', 'motion'] as const;
export const MADE_WITH = ['human', 'ai-assisted'] as const;
export const META_KEYS = [
  'id',
  'title',
  'type',
  'platform',
  'category',
  'subtype',
  'tags',
  'creator',
  'license',
  'made_with',
  'version',
  'published_at',
  'pin_order',
] as const;
/** なくてもよい項目。capture：サムネイルと OG 画像を撮り、崩れとアクセシビリティを測るまで、読み込みから待つ時間。 */
export const OPTIONAL_META_KEYS = ['capture'] as const;
export const CAPTURE_DELAY_MAX_MS = 8000;

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 作者の handle。X のハンドルと同じ形（英数字と _、15文字まで）。大文字と小文字はそのまま保存して表示する。 */
export const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

/** 同じ作者か。大文字と小文字を区別しない（`lattice_node` と `Lattice_Node` は同じ作者）。 */
export function sameHandle(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ---------------------------------------------------------------- meta.json

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/**
 * meta.json の項目と値を確かめる。
 * @param folderId 作品のフォルダ名
 * @param creatorExists 作者のフォルダ（creator.json と avatar.webp）があるか
 */
export function checkMeta(raw: unknown, folderId: string, creatorExists: (handle: string) => boolean): Problem[] {
  const p: Problem[] = [];
  const add = (message: string, fix: string) => p.push({ message, fix });
  if (!isObject(raw)) {
    add('meta.json が JSON のオブジェクトではない', 'ld new で作り直すか、{ … } の形に直す');
    return p;
  }

  for (const key of META_KEYS) {
    if (!(key in raw)) add(`meta.json に "${key}" がない`, `"${key}" を足す（docs/tasks/T002.md「1」の形）`);
  }
  for (const key of Object.keys(raw)) {
    if (![...META_KEYS, ...OPTIONAL_META_KEYS].includes(key as never)) add(`meta.json に知らない項目 "${key}" がある`, `"${key}" を消す（綴りの誤りかもしれない）`);
  }

  const { id, title, type, platform, category, subtype, tags, creator, license, made_with, version, published_at, pin_order, capture } = raw;

  if ('id' in raw) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) add(`id "${String(id)}" が英小文字・数字・ハイフンの形ではない`, '例："toggle-aurora"');
    else if (id !== folderId) add(`id "${id}" がフォルダ名 "${folderId}" と違う`, `id を "${folderId}" にするか、フォルダ名を合わせる`);
  }
  if ('title' in raw && (typeof title !== 'string' || title.trim() === '')) add('title が空', '題名を書く（カードの1行目に出る）');
  if ('type' in raw && type !== 'screen' && type !== 'component') add(`type "${String(type)}" は使えない`, '"screen" か "component" にする');
  if ('platform' in raw) {
    if (platform !== null && platform !== 'web' && platform !== 'mobile') add(`platform "${String(platform)}" は使えない`, '"web"、"mobile"、null のどれかにする');
    else if (platform === null && type === 'screen') add('画面（screen）なのに platform が null', '"web" か "mobile" にする（null にできるのは部品だけ）');
  }
  if ('category' in raw && !(CATEGORIES as readonly unknown[]).includes(category)) {
    add(`category "${String(category)}" は使えない`, `${CATEGORIES.join('、')} のどれかにする`);
  }
  if ('subtype' in raw && (typeof subtype !== 'string' || subtype.trim() === '')) add('subtype が空', 'カードの2行目の右に出る種類を書く（例："Toggle"、"Landing Page"）');
  if ('tags' in raw) {
    if (!Array.isArray(tags)) add('tags が配列ではない', '例：["minimal"]、なければ []');
    else {
      for (const tag of tags) {
        if (!(TAGS as readonly unknown[]).includes(tag)) add(`tags の "${String(tag)}" は使えない`, `${TAGS.join('、')} から選ぶ`);
      }
      if (new Set(tags).size !== tags.length) add('tags に同じものが2回ある', '重なりを消す');
    }
  }
  if ('creator' in raw) {
    if (typeof creator !== 'string' || !HANDLE_PATTERN.test(creator)) add(`creator "${String(creator)}" が作者の handle の形ではない`, '英数字と _ だけ、15文字まで。例："Lattice_Node"（@ は付けない）');
    else if (!creatorExists(creator)) add(`作者 @${creator} がいない（creators/${creator}/ に creator.json と avatar.webp がない）`, `ld creator add ${creator} --name <名前> --avatar <画像> で作る`);
  }
  if ('license' in raw && license !== 'MIT') add(`license "${String(license)}" は使えない`, '"MIT" にする（クレジット行に MIT と入る）');
  if ('made_with' in raw && !(MADE_WITH as readonly unknown[]).includes(made_with)) {
    add(`made_with "${String(made_with)}" は使えない`, '"human"（手で作った）か "ai-assisted"（AIを使い、人が方向を決めて選んだ）にする');
  }
  if ('version' in raw && (typeof version !== 'string' || !/^\d+(?:\.\d+)*$/.test(version))) add(`version "${String(version)}" が数字の文字列ではない`, '例："1"。中身を変えたら上げる');
  if ('published_at' in raw && (typeof published_at !== 'string' || !isValidDate(published_at))) add(`published_at "${String(published_at)}" が日付ではない`, '例："2026-11-09"');
  if ('pin_order' in raw && pin_order !== null && !(Number.isInteger(pin_order) && (pin_order as number) > 0)) {
    add(`pin_order "${String(pin_order)}" は使えない`, 'null か、1以上の整数にする');
  }
  if ('capture' in raw) {
    const fix = `{ "delay_ms": <0〜${CAPTURE_DELAY_MAX_MS}の整数> } にするか、項目を消す`;
    if (!isObject(capture)) add('capture がオブジェクトではない', fix);
    else {
      for (const key of Object.keys(capture)) {
        if (key !== 'delay_ms') add(`capture に知らない項目 "${key}" がある`, fix);
      }
      const { delay_ms } = capture;
      if (!Number.isInteger(delay_ms) || (delay_ms as number) < 0 || (delay_ms as number) > CAPTURE_DELAY_MAX_MS) {
        add(`capture.delay_ms "${String(delay_ms)}" は使えない`, fix);
      }
    }
  }
  return p;
}

/**
 * D1 の `tokens_locked`（固定したトークンの名前の配列）を確かめる。任意の --ld-danger も固定できる。
 * 書き込む道（招待ページ）ができたときに使う。
 */
export function checkTokensLocked(raw: unknown): Problem[] {
  if (!Array.isArray(raw)) return [{ message: 'tokens_locked が配列ではない', fix: '例：["accent"]、なければ []' }];
  return raw
    .filter((name) => !(ALL_TOKEN_NAMES as readonly unknown[]).includes(name))
    .map((name) => ({ message: `tokens_locked の "${String(name)}" は使えない`, fix: `${ALL_TOKEN_NAMES.join('、')} から選ぶ` }));
}

// ---------------------------------------------------------------- creator.json

/** 作者の種類。label は運営のレーベル（CLAUDE.md 原則10）。 */
export const CREATOR_KINDS = ['person', 'label'] as const;
export const CREATOR_KEYS = ['handle', 'name', 'kind', 'x_url', 'site_url'] as const;

/**
 * 作者（creators/<handle>/creator.json）の項目と値を確かめる。
 * @param handle 作品の meta.json の creator（大文字と小文字を区別せずに比べる）。渡さなければ比べない
 */
export function checkCreator(raw: unknown, handle?: string): Problem[] {
  const p: Problem[] = [];
  const add = (message: string, fix: string) => p.push({ message, fix });
  if (!isObject(raw)) {
    add('creator.json が JSON のオブジェクトではない', 'ld creator add で作り直す');
    return p;
  }
  for (const key of CREATOR_KEYS) {
    if (!(key in raw)) {
      const fix =
        key === 'kind'
          ? '"kind": "person"（実在の人）か "label"（運営のレーベル）を足す。ld creator add で作り直してもよい（レーベルは --label）'
          : `"${key}" を足す（ld creator add で作り直してもよい）`;
      add(`creator.json に "${key}" がない`, fix);
    }
  }
  for (const key of Object.keys(raw)) {
    if (!(CREATOR_KEYS as readonly string[]).includes(key)) add(`creator.json に知らない項目 "${key}" がある`, `"${key}" を消す`);
  }
  const { handle: h, name, kind, x_url, site_url } = raw;
  if ('handle' in raw) {
    if (typeof h !== 'string' || !HANDLE_PATTERN.test(h)) add(`creator.json の handle "${String(h)}" が handle の形ではない`, '英数字と _ だけ、15文字まで（@ は付けない）');
    else if (handle !== undefined && !sameHandle(h, handle)) add(`creator.json の handle @${h} が、作品の creator @${handle} と違う`, '作品の meta.json の creator を作者の handle に合わせる');
  }
  if ('name' in raw && (typeof name !== 'string' || name.trim() === '')) add('creator.json の name が空', '表示する名前を書く');
  if ('kind' in raw && !(CREATOR_KINDS as readonly unknown[]).includes(kind)) {
    add(`creator.json の kind "${String(kind)}" は使えない`, '"person"（実在の人）か "label"（運営のレーベル）にする');
  }
  for (const [key, url] of [['x_url', x_url], ['site_url', site_url]] as const) {
    if (key in raw && url !== null && !(typeof url === 'string' && /^https:\/\/\S+$/.test(url))) {
      add(`creator.json の ${key} "${String(url)}" が https:// の URL ではない`, 'https:// で始まる URL か、null にする');
    }
  }
  return p;
}

// ---------------------------------------------------------------- 画像

/** webp と png の縦横。読めなければ null（Node の Buffer を使わない）。 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && ascii(1, 4) === 'PNG') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const chunk = ascii(12, 16);
    const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    if (chunk === 'VP8X') return { width: u24(24) + 1, height: u24(27) + 1 };
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

// ---------------------------------------------------------------- part.html

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const DATA_LD_PART = /(?:^|\s)data-ld-part\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/;
const LINK_ELEMENTS = new Set(['a', 'area']);
const HREF = /(?:^|\s)(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const NAMED_LINK_ENTITIES: Record<string, string> = { colon: ':', sol: '/', bsol: '\\', tab: '', newline: '', amp: '&' };
/** リンクのままでも、ページを移らないもの。 */
const STAYING_SCHEMES = new Set(['mailto', 'tel']);

/** 文字参照の数を文字にする。文字にならない数でも投げない（SEC001 A05）。 */
const codePointText = (code: number) => (Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�');

/**
 * 枠の外へ移るリンクか（docs/tasks/T012.md「3」）。http:、https:、// と、そのほかの scheme（javascript: など）。
 * ブラウザは href を読むときに文字参照を戻し、前後の空白とタブと改行を捨て、\ を / として読むので、同じように直してから見る。
 */
export function leavesFrame(href: string): boolean {
  const url = href
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => codePointText(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, digits: string) => codePointText(Number(digits)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => NAMED_LINK_ENTITIES[name.toLowerCase()] ?? entity)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000- ]+/g, '')
    .replace(/\\/g, '/');
  if (url.startsWith('//')) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase();
  return scheme !== undefined && !STAYING_SCHEMES.has(scheme);
}

/** 根の要素が1つで、`data-ld-part="<id>"` を持ち、すべての中身がその中にあるか。 */
export function checkHtml(html: string, id: string): Problem[] {
  const p: Problem[] = [];
  const add = (message: string, fix: string) => p.push({ message, fix });
  const src = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const stack: string[] = [];
  let topLevel = 0;
  let pos = 0;
  let strayText = false;
  TAG.lastIndex = 0;

  for (let m = TAG.exec(src); m; m = TAG.exec(src)) {
    if (stack.length === 0 && src.slice(pos, m.index).trim() !== '') strayText = true;
    pos = TAG.lastIndex;
    const [, closing, rawName, attrs, selfClosing] = m;
    const name = rawName.toLowerCase();

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at === -1) add(`part.html に開いていない </${name}> がある`, `</${name}> を消すか、対になる <${name}> を足す`);
      else stack.length = at;
      continue;
    }
    if (stack.length === 0) {
      topLevel += 1;
      if (topLevel === 1) {
        const found = DATA_LD_PART.exec(attrs);
        const value = found ? (found[1] ?? found[2] ?? found[3]) : null;
        if (value === null) add(`根の要素 <${name}> に data-ld-part がない`, `根の要素に data-ld-part="${id}" を付ける`);
        else if (value !== id) add(`根の data-ld-part が "${value}" で、id "${id}" と違う`, `data-ld-part="${id}" にする`);
      }
    }
    if (LINK_ELEMENTS.has(name)) {
      for (const link of attrs.matchAll(HREF)) {
        const href = link[1] ?? link[2] ?? link[3];
        if (leavesFrame(href)) add(`part.html の <${name} href="${href}"> が外へ移る`, '作品からページを移らない。外への導線を見せたいときは href="#" にする');
      }
    }
    if (name === 'script') add('part.html に <script> がある', 'JS は part.js に書き、export function mount(root) の中で動かす');
    if (name === 'style') add('part.html に <style> がある', 'CSS は part.css に書く');
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const end = src.toLowerCase().indexOf(`</${name}`, pos);
      if (end === -1) {
        add(`part.html の <${name}> が閉じていない`, `</${name}> を足す`);
        pos = src.length;
        break;
      }
      // 閉じタグまで読み飛ばす（中身はタグとして読まない）
      const after = src.indexOf('>', end);
      pos = after === -1 ? src.length : after + 1;
      TAG.lastIndex = pos;
      continue;
    }
    if (VOID_ELEMENTS.has(name) || selfClosing) continue;
    stack.push(name);
  }
  if (src.slice(pos).trim() !== '') strayText = true;

  if (topLevel === 0) add('part.html に要素がない', `<div data-ld-part="${id}">…</div> の形にする`);
  if (topLevel > 1) add(`part.html の一番外に要素が ${topLevel} 個ある`, `すべてを <div data-ld-part="${id}"> の中に入れる`);
  if (strayText) add('part.html の根の外に文字がある', `すべてを data-ld-part="${id}" の要素の中に入れる`);
  if (stack.length > 0) add(`part.html の <${stack[0]}> が閉じていない`, `</${stack[0]}> を足す`);
  return p;
}

// ---------------------------------------------------------------- part.css

export function rootSelectors(id: string): string[] {
  return [`[data-ld-part="${id}"]`, `[data-ld-part='${id}']`, `[data-ld-part=${id}]`];
}

export function at(node: { source?: { start?: { line: number } } }): string {
  const line = node.source?.start?.line;
  return line ? `part.css ${line}行目` : 'part.css';
}

interface Ancestor {
  type: string;
  name?: string;
  parent?: Ancestor;
}

function ancestors(node: Rule): Ancestor[] {
  const list: Ancestor[] = [];
  for (let parent = node.parent as Ancestor | undefined; parent; parent = parent.parent) list.push(parent);
  return list;
}

export function insideKeyframes(node: Rule): boolean {
  return ancestors(node).some((a) => a.type === 'atrule' && /keyframes$/i.test(a.name ?? ''));
}

export function isNested(node: Rule): boolean {
  return ancestors(node).some((a) => a.type === 'rule');
}

/** 根そのものを指すルール（`[data-ld-part="id"] { … }`）か。 */
function isRootRule(rule: Rule, id: string): boolean {
  return !isNested(rule) && rule.selectors.length === 1 && rootSelectors(id).includes(rule.selectors[0].trim());
}

const ALLOWED_AT_RULES = /^(media|supports|container|layer|font-face|import|(-webkit-)?keyframes)$/i;

export interface CssShape {
  problems: Problem[];
  /** 画面（screen）で、守れていなくても落とさないもの */
  warnings: Problem[];
}

/**
 * すべてのセレクタが根の下にあるか。根で10個の --_* を宣言しているか。
 * 10個の宣言は、部品では落とし、画面では警告にする（CLAUDE.md 原則2）。
 */
export function checkCssShape(css: string, id: string, type: string): CssShape {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  let root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    const e = error as { line?: number; reason?: string; message: string };
    problems.push({ message: `part.css を読めない（${e.line ? `${e.line}行目：` : ''}${e.reason ?? e.message}）`, fix: '括弧や ; の閉じ忘れを直す' });
    return { problems, warnings };
  }
  const [prefix] = rootSelectors(id);

  root.walkAtRules((rule) => {
    if (!ALLOWED_AT_RULES.test(rule.name)) {
      problems.push({ message: `${at(rule)} の @${rule.name} は使えない`, fix: '@media、@supports、@container、@layer、@keyframes、@font-face だけにする' });
    }
  });
  root.walkRules((rule) => {
    if (insideKeyframes(rule) || isNested(rule)) return;
    for (const selector of rule.selectors) {
      const s = selector.trim();
      if (!rootSelectors(id).some((r) => s.startsWith(r))) {
        problems.push({ message: `${at(rule)} のセレクタ "${s}" が根の下にない`, fix: `${prefix} ${s} の形にする` });
      }
    }
  });

  // 根で10個の --_* を宣言する
  const declared = new Map<string, string>();
  root.walkRules((rule) => {
    if (!isRootRule(rule, id)) return;
    rule.each((node) => {
      if (node.type === 'decl' && node.prop.startsWith('--_')) declared.set(node.prop.slice(3), node.value);
    });
  });
  const target = type === 'component' ? problems : warnings;
  const missing = TOKEN_NAMES.filter((name) => !declared.has(name));
  if (missing.length > 0) {
    target.push({
      message: `根 ${prefix} で ${missing.map((n) => `--_${n}`).join('、')} を宣言していない`,
      fix: `根に --_${missing[0]}: var(--ld-${missing[0]}, <作者の値>); の形で足す（ld new の雛形を見る）`,
    });
  }
  for (const [name, value] of declared) {
    const wrong = /var\(\s*--ld-([\w-]+)/.exec(value);
    if (wrong && wrong[1] !== name) {
      target.push({ message: `根の --_${name} が --ld-${wrong[1]} を読んでいる`, fix: `--_${name}: var(--ld-${name}, <作者の値>) にする` });
    }
  }

  // 任意のトークン：宣言は要らないが、宣言せずに使うと色が消えるので、部品でも画面でも落とす
  for (const name of OPTIONAL_TOKEN_NAMES) {
    if (declared.has(name)) continue;
    root.walkDecls((decl) => {
      if (!usesVar(decl.value, name)) return;
      problems.push({
        message: `${at(decl)} ${decl.prop} が var(--_${name}) を使っているのに、根で --_${name} を宣言していない`,
        fix: `根に --_${name}: var(--ld-${name}, <作者の値>); を足す`,
      });
    });
  }

  const use = tokenUse(root, type);
  problems.push(...use.problems);
  warnings.push(...use.warnings);
  return { problems, warnings };
}

// ---------------------------------------------------------------- 角丸・余白・動き（docs/tasks/T003.md「3」）

const RADIUS_PROPERTY = /^(-webkit-)?border(-[a-z]+)*-radius$/i;
const SPACE_PROPERTY = /^(margin|padding)(-[a-z]+)*$|^((row|column)-)?gap$|^grid-((row|column)-)?gap$/i;
const MOTION_PROPERTY = /^(transition|animation)(-duration|-delay)?$/i;

/** 値を、括弧の外の空白と / で区切る。 */
function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && (/\s/.test(ch) || ch === '/' || ch === ',')) {
      if (current) parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

const usesVar = (value: string, name: string) => new RegExp(`var\\(\\s*--_${name}\\s*[,)]`).test(value);
const isZero = (part: string) => /^[+-]?0*\.?0+(px|%|r?em|ms|s)?$/i.test(part);

/** 角丸の値：var(--_radius) を含むか、すべてが 0・50%・9999px か、inherit。 */
function radiusOk(value: string): boolean {
  if (usesVar(value, 'radius')) return true;
  const v = value.trim().toLowerCase();
  if (v === 'inherit') return true;
  return topLevelParts(v).every((part) => isZero(part) || part === '50%' || part === '9999px');
}

/** 余白の値：var(--_space) を含むか、すべてが 0・1px・auto。 */
function spaceOk(value: string): boolean {
  if (usesVar(value, 'space')) return true;
  return topLevelParts(value.trim().toLowerCase()).every((part) => isZero(part) || part === '1px' || part === 'auto');
}

/** 動きの時間：var(--_motion) を含むか、0 でない時間を書いていない。 */
function motionOk(value: string): boolean {
  if (usesVar(value, 'motion')) return true;
  return topLevelParts(value.trim().toLowerCase())
    .filter((part) => /^[+-]?(\d+\.?\d*|\.\d+)(ms|s)$/.test(part) || /^calc\(/.test(part))
    .every(isZero);
}

function tokenUse(root: ReturnType<typeof postcss.parse>, type: string): CssShape {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) return; // 根の --_* の既定値は数えない
    const value = decl.value;
    if (RADIUS_PROPERTY.test(decl.prop) && !radiusOk(value)) {
      (type === 'component' ? problems : warnings).push({
        message: `${at(decl)} ${decl.prop} が ${value}`,
        fix: 'var(--_radius) か、calc(var(--_radius) - 4px) のようにそれを含む計算にする。丸や角なしなら 0、50%、9999px',
      });
    } else if (SPACE_PROPERTY.test(decl.prop) && !spaceOk(value)) {
      warnings.push({ message: `${at(decl)} ${decl.prop} が ${value}（var(--_space) を使っていない）`, fix: 'calc(var(--_space) * n) にする' });
    } else if (MOTION_PROPERTY.test(decl.prop) && !motionOk(value)) {
      warnings.push({ message: `${at(decl)} ${decl.prop} の時間が var(--_motion) を使っていない（${value}）`, fix: 'var(--_motion) か、calc(var(--_motion) * 2) にする' });
    }
  });
  return { problems, warnings };
}

/**
 * 角丸・余白・動きの時間が、根で宣言した --_radius・--_space・--_motion を使っているか。
 * 角丸は部品で落とし、画面では警告。余白と動きは、部品も画面も警告だけ。
 */
export function checkTokenUse(css: string, type: string): CssShape {
  try {
    return tokenUse(postcss.parse(css), type);
  } catch {
    return { problems: [], warnings: [] }; // 読めないことは checkCssShape が出す
  }
}

// ---------------------------------------------------------------- トークンの純度

// CSS の色の名前（transparent と currentcolor は色相を足さないので数えない）。
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen ' +
    'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
    'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver ' +
    'skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen'
  ).split(' '),
);

// 名前が名前として使われる（色ではない）プロパティ。ここでは色の名前を数えない。
const NAME_PROPERTIES =
  /^(font|font-family|animation|animation-name|transition|transition-property|will-change|content|quotes|counter-\w+|list-style(-type)?|grid(-[\w-]+)?|container(-name)?|[\w-]*-name|[\w-]*timeline[\w-]*|position-anchor)$/i;

const COLOR_FUNCTION = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;

/** 開き括弧の位置から、対になる閉じ括弧までを返す。 */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/**
 * 値の中の色のリテラル。
 * color-mix() の中の black と white は、--_* を明るく・暗くするためのものとして数えない
 * （CLAUDE.md の例 `color-mix(in oklab, var(--_accent) 85%, black)`）。
 */
export function colorLiterals(prop: string, value: string): string[] {
  let v = value.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => ' '.repeat(m.length)).replace(/url\([^)]*\)/gi, (m) => ' '.repeat(m.length));
  for (let i = v.toLowerCase().indexOf('color-mix('); i !== -1; i = v.toLowerCase().indexOf('color-mix(', i + 1)) {
    const open = i + 'color-mix'.length;
    const inner = balanced(v, open);
    v = v.slice(0, open) + inner.replace(/\b(black|white)\b/gi, (m) => ' '.repeat(m.length)) + v.slice(open + inner.length);
  }
  const found: string[] = [];
  for (const m of v.matchAll(/#[0-9a-fA-F]{3,8}(?![\w-])/g)) found.push(m[0]);
  for (const m of v.matchAll(COLOR_FUNCTION)) found.push(m[1] + balanced(v, m.index + m[0].length - 1));
  if (!NAME_PROPERTIES.test(prop)) {
    for (const m of v.matchAll(/[a-zA-Z_-][\w-]*/g)) if (NAMED_COLORS.has(m[0].toLowerCase())) found.push(m[0]);
  }
  return found;
}

export interface Purity {
  /** 根の既定値の外にある色のリテラルの数 */
  literals: number;
  /** 1件ずつの場所と直し方 */
  problems: Problem[];
}

/** 根の既定値（根の10個と任意の --_* の宣言）の外にある色のリテラルを数える。本体で --ld-* を直に読むのも数える。 */
export function checkPurity(css: string, id: string): Purity {
  const problems: Problem[] = [];
  let literals = 0;
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return { literals: 0, problems: [] }; // 読めないことは「形」で出す
  }
  root.walkDecls((decl: Declaration) => {
    const rule = decl.parent;
    const inRoot = rule?.type === 'rule' && isRootRule(rule as Rule, id);
    if (inRoot && decl.prop.startsWith('--_') && (ALL_TOKEN_NAMES as readonly string[]).includes(decl.prop.slice(3))) return;
    for (const literal of colorLiterals(decl.prop, decl.value)) {
      literals += 1;
      problems.push({
        message: `${at(decl)} ${decl.prop} の色 ${literal}`,
        fix: 'var(--_accent) などの --_* に置き換える。濃さを変えたいなら color-mix(in oklab, var(--_accent) 85%, black)',
      });
    }
    const direct = /var\(\s*(--ld-[\w-]+)/.exec(decl.value);
    if (direct) {
      problems.push({
        message: `${at(decl)} ${decl.prop} が ${direct[1]} を直に読んでいる`,
        fix: `根で宣言した --_${direct[1].slice(5)} を使う（固定したトークンが効かなくなるため）`,
      });
    }
  });
  return { literals, problems };
}

// ---------------------------------------------------------------- part.js

const DOCUMENT_QUERY = /\bdocument\s*\.\s*(querySelector(?:All)?|getElementById|getElementsBy\w+|body|head|documentElement)\b/;

/** JS の文字列1つ。テンプレート文字列の ${…} は EXPRESSION の1文字に置き換える。 */
interface JsString {
  text: string;
  /** 開きの引用符の位置 */
  start: number;
}

const EXPRESSION = '￼';

// この文字の後の / は、割り算ではなく正規表現の始まり
const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await))\s*$/;

/**
 * コメントと正規表現を飛ばして、文字列を集める。構文を確かめるものではない（読めない形は黙って読み進める）。
 * `code` は、コメント、正規表現、文字列を空白にした写し（位置と改行は元のまま。テンプレート文字列の ${…} の中は残る）。
 */
export function scanJs(js: string): { strings: JsString[]; code: string } {
  const found: JsString[] = [];
  /** コードではない範囲 */
  const blanks: [number, number][] = [];
  /** ${ の中にいるテンプレート文字列：その { の深さ、開きの位置、ここまでの文字 */
  const templates: { depth: number; start: number; text: string }[] = [];
  let depth = 0;
  let i = 0;
  /** i からのコードではない範囲を覚えて、end へ進む */
  const skipTo = (end: number) => {
    blanks.push([i, end]);
    i = end;
  };

  const readTemplate = (from: number, start: number, soFar: string) => {
    let j = from;
    let text = soFar;
    while (j < js.length) {
      const ch = js[j];
      if (ch === '\\') {
        text += js.slice(j, j + 2);
        j += 2;
      } else if (ch === '`') {
        found.push({ text, start });
        return j + 1;
      } else if (ch === '$' && js[j + 1] === '{') {
        templates.push({ depth, start, text: text + EXPRESSION });
        depth += 1;
        return j + 2;
      } else {
        text += ch;
        j += 1;
      }
    }
    found.push({ text, start });
    return j;
  };

  while (i < js.length) {
    const ch = js[i];
    const next = js[i + 1];
    if (ch === '/' && next === '/') {
      const end = js.indexOf('\n', i);
      skipTo(end === -1 ? js.length : end);
    } else if (ch === '/' && next === '*') {
      const end = js.indexOf('*/', i + 2);
      skipTo(end === -1 ? js.length : end + 2);
    } else if (ch === '/' && BEFORE_REGEX.test(js.slice(Math.max(0, i - 40), i))) {
      let inClass = false;
      let j = i + 1;
      for (; j < js.length && js[j] !== '\n'; j += 1) {
        if (js[j] === '\\') j += 1;
        else if (js[j] === '[') inClass = true;
        else if (js[j] === ']') inClass = false;
        else if (js[j] === '/' && !inClass) break;
      }
      skipTo(j + 1);
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let text = '';
      while (j < js.length && js[j] !== ch && js[j] !== '\n') {
        if (js[j] === '\\') {
          text += js.slice(j, j + 2);
          j += 2;
        } else {
          text += js[j];
          j += 1;
        }
      }
      found.push({ text, start: i });
      skipTo(j + 1);
    } else if (ch === '`') {
      skipTo(readTemplate(i + 1, i, ''));
    } else if (ch === '{') {
      depth += 1;
      i += 1;
    } else if (ch === '}') {
      depth -= 1;
      i += 1;
      // ${…} が閉じたら、テンプレート文字列の続きを読む
      const open = templates.at(-1);
      if (open?.depth === depth) {
        templates.pop();
        skipTo(readTemplate(i, open.start, open.text));
      }
    } else {
      i += 1;
    }
  }

  let code = '';
  let from = 0;
  for (const [start, end] of blanks) {
    code += js.slice(from, start) + js.slice(start, end).replace(/[^\n]/g, ' ');
    from = end;
  }
  return { strings: found.sort((a, b) => a.start - b.start), code: code + js.slice(from) };
}

const jsStrings = (js: string): JsString[] => scanJs(js).strings;

// セレクタを受ける呼び出しの引数は、#add のような id なので色として数えない
const SELECTOR_CALL = /\b(?:querySelector(?:All)?|closest|matches)\s*\(\s*$/;
const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
// 「Order #1234」「注文 #1234」のように文の中の番号。前の語が大文字で始まるか、英数字の外の文字を含む
const AFTER_PROSE_WORD = /(?:[A-Z]|[^\x00-\x7f])\S*\s*$/;

/**
 * rgb(${r} ${g} ${b} / ${a}) のように、色の値（アルファの前まで）が全部式か。
 * トークンから計算した色を組み立てているだけで、色のリテラルではない。hsl(${h} 80% 50%) は数字を書いているのでリテラル。
 */
function isComputedColor(literal: string): boolean {
  const inner = literal.slice(literal.indexOf('(') + 1).replace(/\)$/, '');
  const channels = inner.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  return channels.length > 0 && channels.every((channel) => channel.includes(EXPRESSION));
}

/** 文字列の中の色のリテラル。色の名前は、文字列全体が色の名前のときだけ数える（文の中の red は数えない）。 */
function jsColorLiterals(text: string): string[] {
  const found = colorLiterals('font', text).filter((literal) => !literal.startsWith('#') && !isComputedColor(literal)); // 'font' は色の名前を数えないプロパティ
  for (const m of text.matchAll(HEX_COLOR)) {
    if (/^#\d+$/.test(m[0]) && AFTER_PROSE_WORD.test(text.slice(0, m.index))) continue;
    found.push(m[0]);
  }
  if (NAMED_COLORS.has(text.trim())) found.push(text.trim());
  return found;
}

/** part.js の色のリテラルを数える（docs/tasks/T006.md「4」）。コメントの中は数えない。 */
export function checkJsPurity(js: string): Purity {
  const problems: Problem[] = [];
  let literals = 0;
  for (const string of jsStrings(js)) {
    if (SELECTOR_CALL.test(js.slice(Math.max(0, string.start - 40), string.start))) continue;
    const line = js.slice(0, string.start).split('\n').length;
    for (const literal of jsColorLiterals(string.text)) {
      literals += 1;
      problems.push({
        message: `part.js ${line}行目 の色 ${literal.replaceAll(EXPRESSION, '${…}')}`,
        fix: "JS に色を書かず、getComputedStyle(root).getPropertyValue('--_accent') のように根の --_* を読む",
      });
    }
  }
  return { literals, problems };
}

/**
 * tags に motion がある作品が、prefers-reduced-motion: reduce に対応しているか（docs/tasks/T006.md「4」）。
 * CSS の @media か、JS の matchMedia があればよい。動きを本当に止めているかは描画して見ないと分からない。
 */
export function checkReducedMotion(tags: unknown, css: string | null, js: string | null): Problem[] {
  if (!Array.isArray(tags) || !tags.includes('motion')) return [];
  const QUERY = /prefers-reduced-motion\s*:\s*reduce/i;
  let inCss = false;
  if (css !== null) {
    try {
      postcss.parse(css).walkAtRules(/^media$/i, (rule) => {
        if (QUERY.test(rule.params)) inCss = true;
      });
    } catch {
      // 読めないことは checkCssShape が出す
    }
  }
  const inJs = js !== null && /\bmatchMedia\b/.test(js) && jsStrings(js).some((s) => QUERY.test(s.text));
  if (inCss || inJs) return [];
  return [
    {
      message: 'tags に motion があるのに、prefers-reduced-motion: reduce に対応していない',
      fix: "CSS に @media (prefers-reduced-motion: reduce) { … } を足すか、JS で matchMedia('(prefers-reduced-motion: reduce)') を見て、動きを止めるか最小限にする",
    },
  ];
}

// ページを移る道（docs/tasks/T008.md「1」）。CSP では止められず、外の URL へ移ると、入力された文字を外へ送れる。
const NOT_MEMBER = String.raw`(?<![\w$])(?<!(?<!\.\.)\.\s*)`; // a.top は別物。...top は top そのもの
const NAME_END = String.raw`(?![\w$])`;
const DOT = String.raw`\s*\??\.\s*`;
const GLOBAL = String.raw`(?:window|self|globalThis)`;
const LOCATION = String.raw`${NOT_MEMBER}(?:${GLOBAL}${DOT})?location${NAME_END}`;
const ASSIGN = String.raw`\s*\+?=(?![=>])`;
const LEAVE_FIX = '作品からページを移らない。作品は枠の中で動かし、root の中だけを触る';
const FRAME_FIX = '枠の外に触らない。root の中だけを触る。自分の変数なら別の名前にする';

const NAVIGATION: { pattern: RegExp; message: (name: string) => string; fix: string }[] = [
  // let location = … は自分の変数なので数えない
  { pattern: new RegExp(`(?<!\\b(?:let|const|var)\\s+)${LOCATION}${ASSIGN}`, 'g'), message: (name) => `${name} に代入している`, fix: LEAVE_FIX },
  { pattern: new RegExp(`${LOCATION}${DOT}[\\w$]+${ASSIGN}`, 'g'), message: (name) => `${name} に代入している`, fix: LEAVE_FIX },
  { pattern: new RegExp(`${LOCATION}${DOT}(?:assign|replace)\\s*\\(`, 'g'), message: (name) => `${name}) を呼んでいる`, fix: LEAVE_FIX },
  { pattern: new RegExp(`${NOT_MEMBER}${GLOBAL}${DOT}open\\s*\\(`, 'g'), message: (name) => `${name}) を呼んでいる`, fix: LEAVE_FIX },
  { pattern: new RegExp(`${NOT_MEMBER}document${DOT}location${NAME_END}`, 'g'), message: (name) => `${name} を使っている`, fix: LEAVE_FIX },
  { pattern: new RegExp(`${NOT_MEMBER}(?:top|parent)(?=${DOT})`, 'g'), message: (name) => `${name}. を使っている`, fix: FRAME_FIX },
  { pattern: new RegExp(`${NOT_MEMBER}${GLOBAL}${DOT}(?:top|parent)${NAME_END}`, 'g'), message: (name) => `${name} を使っている`, fix: FRAME_FIX },
];

/**
 * ページを移る書き方と、枠の外への参照。コメントと文字列の中は数えない。
 * 文字列で探すだけなので、const l = location; l.href = … のような形はすり抜ける。
 * すり抜けた移動は作品のページの見張り（apps/web/src/frameGuard.ts）が止める。送られた1回は止められないので、公開前の審査で見る（T013）。
 */
function checkNavigation(js: string): Problem[] {
  const { code } = scanJs(js);
  const found: { index: number; problem: Problem }[] = [];
  for (const { pattern, message, fix } of NAVIGATION) {
    for (const m of code.matchAll(pattern)) {
      // 見せる名前は、代入の = を除いて、空白を詰めたもの
      const name = m[0].replace(/\s*\+?=$/, '').replace(/\s+/g, '');
      const line = code.slice(0, m.index).split('\n').length;
      found.push({ index: m.index, problem: { message: `part.js ${line}行目 が ${message(name)}`, fix } });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.problem);
}

/** part.js が mount を export し、document を直に探さず、ページを移らず、枠の外に触っていないか。 */
export function checkJs(js: string): Problem[] {
  const p: Problem[] = [];
  if (!exportsMount(js)) p.push({ message: 'part.js が mount を export していない', fix: 'export function mount(root) { …; return () => { /* 片付け */ }; } の形にする' });
  const query = DOCUMENT_QUERY.exec(js);
  if (query) p.push({ message: `part.js が document.${query[1]} を使っている`, fix: 'root.querySelector などで、root の中だけを触る' });
  p.push(...checkNavigation(js));
  return p;
}
