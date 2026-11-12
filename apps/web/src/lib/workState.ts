import type { OwnWork } from './post';

/** 状態の札（docs/tasks/T036.md「3」）。直している版があればその状態、なければ作品の状態。 */
export type WorkState = 'private' | 'submitted' | 'public' | 'rejected' | 'draft' | 'revoked';

export function stateOf(work: Pick<OwnWork, 'status' | 'public' | 'private'>): WorkState {
  if (work.status === 'submitted' || work.status === 'rejected' || work.status === 'draft') return work.status;
  if (work.public) return 'public';
  if (work.private) return 'private';
  return 'revoked';
}

/** 自分の作品の絞り込み（自分の作品のページと、左のナビのシート）。 */
export type WorkFilter = 'all' | 'private' | 'public';
export const WORK_FILTERS: WorkFilter[] = ['all', 'private', 'public'];
export const matchesFilter = (work: Pick<OwnWork, 'public' | 'private'>, filter: WorkFilter) =>
  filter === 'all' || (filter === 'private' ? work.private : work.public);
