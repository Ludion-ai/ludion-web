/** 「コピーしました」を見せる時間（docs/tasks/T007.md「1」）。 */
export const COPIED_MS = 1500;

/** 閲覧数とコピー数（POST /api/count）。失敗しても画面には何も出さない。 */
export function postCount(workId: string, type: 'view' | 'copy'): void {
  void fetch('/api/count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_id: workId, type }),
    keepalive: true,
  }).catch(() => {});
}
