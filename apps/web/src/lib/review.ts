// 審査の画面のブラウザ側（docs/tasks/T021.md 段階 C）。

import type { FlagHit, ProblemText, RejectCode } from '@ludion/rules';
import type { FrameUrls } from './post';

export interface QueueItem {
  id: string;
  work_id: string;
  version: string;
  title: string;
  category: string;
  subtype: string;
  submitted_at: number;
  handle: string;
  kind: string;
  /** 公開中の版がある（直した版の審査） */
  public: number;
}

export interface ReviewDetail {
  revision: {
    id: string;
    work_id: string;
    version: string;
    status: string;
    content_hash: string;
    title: string;
    category: string;
    subtype: string;
    tags: string[];
    made_with: string;
    tokens_ok: boolean;
    frames: FrameUrls;
    thumb: string;
    thumb_w: number;
    thumb_h: number;
  };
  creator: { handle: string; name: string | null; kind: string } | null;
  /** リミックスの元（docs/tasks/T033.md B5）。取り下げられていても返る（public が false） */
  remix_of: { id: string; title: string; handle: string; public: boolean } | null;
  code: { html: string; css: string; js: string | null };
  previous: { version: string; html: string; css: string; js: string | null } | null;
  check: { required: ProblemText[]; optional: ProblemText[] };
  flags: FlagHit[];
}

const postJson = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchQueue(): Promise<QueueItem[]> {
  const response = await fetch('/api/review/queue');
  if (!response.ok) throw new Error(`GET /api/review/queue: ${response.status}`);
  return ((await response.json()) as { revisions: QueueItem[] }).revisions;
}

export async function fetchReviewDetail(id: string): Promise<ReviewDetail> {
  const response = await fetch(`/api/review/revisions/${id}`);
  if (!response.ok) throw new Error(`GET /api/review/revisions/:id: ${response.status}`);
  return (await response.json()) as ReviewDetail;
}

/** 承認する。見た中身のハッシュを送る。'changed' は、見た後に変わったか、もう審査が終わった。 */
export async function postApprove(id: string, contentHash: string): Promise<'ok' | 'changed' | 'failed'> {
  const response = await postJson(`/api/review/revisions/${id}/approve`, { content_hash: contentHash });
  if (response.ok) return 'ok';
  return response.status === 409 ? 'changed' : 'failed';
}

export async function postReject(id: string, reason: RejectCode, note: string): Promise<'ok' | 'changed' | 'failed'> {
  const response = await postJson(`/api/review/revisions/${id}/reject`, { reason, note });
  if (response.ok) return 'ok';
  return response.status === 409 ? 'changed' : 'failed';
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/** 比べる行の上限（共通の頭と尻を除いた行の数の積）。超えたら、全部消して全部足した形で見せる。 */
const MAX_DIFF_CELLS = 4_000_000;

/** 行ごとの差分。共通の頭と尻を除いて、最長共通部分列で比べる。 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    return [...head, ...midA.map((text) => ({ kind: 'removed' as const, text })), ...midB.map((text) => ({ kind: 'added' as const, text })), ...tail];
  }
  const width = midB.length + 1;
  const table = new Uint32Array((midA.length + 1) * width);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = midA[i] === midB[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      middle.push({ kind: 'same', text: midA[i] });
      i += 1;
      j += 1;
    } else if (j < midB.length && (i === midA.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
      middle.push({ kind: 'added', text: midB[j] });
      j += 1;
    } else {
      middle.push({ kind: 'removed', text: midA[i] });
      i += 1;
    }
  }
  return [...head, ...middle, ...tail];
}
