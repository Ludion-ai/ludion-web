import type { Work } from '../data/works';

/** Popular の順（SPEC.md 4）。いいね数だけでは並べない。D1 の並び（worker/catalog.ts）と同じ。最後の id は同点を毎回同じ順にするため。 */
export function comparePopular(a: Work, b: Work): number {
  const pinA = a.pin_order ?? Number.POSITIVE_INFINITY;
  const pinB = b.pin_order ?? Number.POSITIVE_INFINITY;
  if (pinA !== pinB) return pinA - pinB;
  if (a.copies_30d !== b.copies_30d) return b.copies_30d - a.copies_30d;
  if (a.likes !== b.likes) return b.likes - a.likes;
  if (a.published_at !== b.published_at) return b.published_at - a.published_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
