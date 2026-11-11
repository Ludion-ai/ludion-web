import { copy } from '../copy';
// 検索は、データの英語でも画面の日本語でも当たる。英語の画面の文字はデータと同じなので、日本語の表だけを見る
import type { Work } from '../data/works';

export const CATEGORIES = ['web', 'mobile', 'dashboard', 'ecommerce', 'minimal', 'experimental', 'motion', 'wallpaper'] as const;
export type Category = (typeof CATEGORIES)[number];

/** 壁紙の作品の subtype（作品の meta.json の値。WALL001） */
export const WALLPAPER_SUBTYPE = 'Wallpaper';
export const isWallpaper = (work: Pick<Work, 'subtype'>) => work.subtype === WALLPAPER_SUBTYPE;
export type Sort = 'popular' | 'new';

export type HomeQuery = {
  q: string;
  category: Category | null;
  sort: Sort;
  componentsOnly: boolean;
};

/** 検索語の上限（docs/tasks/T022.md「4」）。HTML は Worker でも描くので、長い検索語で重くしない。 */
export const MAX_SEARCH_LENGTH = 200;
const MAX_SEARCH_WORDS = 8;

/** 前後の空白を落とし、8語、200文字までにする。超えたら切る（エラーにしない）。 */
export function limitSearch(raw: string): string {
  let q = raw.trim();
  const words = q.split(/\s+/);
  if (words.length > MAX_SEARCH_WORDS) q = words.slice(0, MAX_SEARCH_WORDS).join(' ');
  // 絵文字（サロゲートペア）を半分にしない
  if (q.length > MAX_SEARCH_LENGTH) q = q.slice(0, MAX_SEARCH_LENGTH).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
  return q;
}

/** URL が絞り込みの正。知らない値は、指定なしとして扱う。 */
export function parseHomeQuery(params: URLSearchParams): HomeQuery {
  const c = params.get('c');
  return {
    q: limitSearch(params.get('q') ?? ''),
    category: CATEGORIES.includes(c as Category) ? (c as Category) : null,
    sort: params.get('sort') === 'new' ? 'new' : 'popular',
    componentsOnly: params.get('type') === 'component',
  };
}

function homeHref(current: URLSearchParams, change: (next: URLSearchParams) => void): string {
  const next = new URLSearchParams(current);
  // 長い検索語を、チップの数だけ HTML に写さない
  const q = limitSearch(next.get('q') ?? '');
  if (q) next.set('q', q);
  else next.delete('q');
  change(next);
  const search = next.toString();
  return search ? `/?${search}` : '/';
}

/** チップの行き先。検索語や並びは保つ。 */
export function categoryHref(current: URLSearchParams, category: Category | null): string {
  return homeHref(current, (next) => {
    if (category) next.set('c', category);
    else next.delete('c');
  });
}

/** 並びの項目の行き先。検索語やチップは保つ。 */
export function sortHref(current: URLSearchParams, sort: Sort): string {
  return homeHref(current, (next) => {
    if (sort === 'new') next.set('sort', 'new');
    else next.delete('sort');
  });
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function matchesCategory(work: Work, category: Category): boolean {
  if (category === 'web' || category === 'mobile') return work.platform === category;
  // 壁紙は種類で見る（WALL001「3」）
  if (category === 'wallpaper') return isWallpaper(work);
  return work.tags.includes(category);
}

function matchesSearch(work: Work, q: string): boolean {
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  // カテゴリと種類は、データの英語でも画面の日本語でも当たる
  const haystack = normalize(
    [work.title, work.category, copy.categories[work.category], work.subtype, copy.subtypes[work.subtype], work.creator.name, work.creator.handle].join(' '),
  );
  return terms.every((term) => haystack.includes(term));
}

/** 受け取る works は Popular の順。絞り込みと Newest はブラウザでやる（SPEC.md 8）。 */
export function selectWorks(works: Work[], query: HomeQuery): Work[] {
  const filtered = works.filter(
    (work) =>
      (!query.category || matchesCategory(work, query.category)) &&
      (!query.componentsOnly || work.type === 'component') &&
      matchesSearch(work, query.q),
  );
  return query.sort === 'new'
    ? filtered.toSorted((a, b) => b.published_at - a.published_at)
    : filtered;
}
