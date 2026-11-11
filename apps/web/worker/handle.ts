// handle を D1 と突き合わせて確かめる（docs/tasks/T020.md「1」）。形の決まりは handleRules.ts。

import { handleBase, HANDLE_MAX, HANDLE_MIN, HANDLE_PATTERN, isReservedHandle } from './handleRules';

export { HANDLE_HOLD_MS } from './handleRules';

/** 'ok' のほかは、なぜ取れないか。画面の文は copy.ts。 */
export type HandleStatus = 'ok' | 'same' | 'format' | 'reserved' | 'taken' | 'held';

/**
 * その人（userId）が handle を取れるか。新しい人は userId を null にする。
 * 自分に結ばれた作者の handle は取れる。結ばれていない作者の handle は、取れない言葉と同じ扱いにする。
 */
export async function checkHandle(db: D1Database, handle: string, userId: string | null, now = Date.now()): Promise<HandleStatus> {
  if (!HANDLE_PATTERN.test(handle)) return 'format';

  const owner = userId ?? '';
  const row = await db
    .prepare(
      `SELECT
         (SELECT id FROM users WHERE handle = ?1) AS holder,
         (SELECT user_id FROM handle_history WHERE handle = ?1 AND released_at > ?2) AS previous,
         EXISTS (SELECT 1 FROM creators WHERE handle = ?1 COLLATE NOCASE AND user_id = ?3) AS own_creator,
         EXISTS (SELECT 1 FROM creators WHERE handle = ?1 COLLATE NOCASE AND (user_id IS NULL OR user_id <> ?3)) AS other_creator`,
    )
    .bind(handle, now, owner)
    .first<{ holder: string | null; previous: string | null; own_creator: number; other_creator: number }>();
  if (!row) throw new Error('handle を確かめられなかった');

  if (row.holder !== null) return row.holder === owner ? 'same' : 'taken';
  if (row.own_creator) return 'ok';
  if (row.other_creator || isReservedHandle(handle)) return 'reserved';
  if (row.previous !== null && row.previous !== owner) return 'held';
  return 'ok';
}

const randomSuffix = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** handle を選ぶ画面に出す候補。取れるものだけ。手段の名前が英字でなければ（日本語の名前など）、乱数のものを出す。 */
export async function suggestHandles(db: D1Database, name: string): Promise<string[]> {
  const base = handleBase(name);
  if (!base) return [`user_${randomSuffix()}`];
  const padded = base.length >= HANDLE_MIN ? base : `${base}_user`;
  const candidates = [padded, `${padded.slice(0, HANDLE_MAX - 2)}_2`, `${padded.slice(0, HANDLE_MAX - 2)}_3`];
  const statuses = await Promise.all(candidates.map((candidate) => checkHandle(db, candidate, null)));
  const free = candidates.filter((_, index) => statuses[index] === 'ok');
  return free.length > 0 ? free : [`${padded.slice(0, HANDLE_MAX - 7)}_${randomSuffix()}`];
}

/** 新しい人の handle を選ぶ。取れなければ番号を付け、それでも取れなければ乱数を付ける。 */
export async function pickHandle(db: D1Database, name: string): Promise<string> {
  const base = handleBase(name) ?? 'user';
  const padded = base.length >= HANDLE_MIN ? base : `${base}_user`;
  const candidates = [padded];
  for (let n = 2; n <= 5; n += 1) candidates.push(`${padded.slice(0, HANDLE_MAX - String(n).length - 1)}_${n}`);
  for (const candidate of candidates) {
    if ((await checkHandle(db, candidate, null)) === 'ok') return candidate;
  }
  return `${padded.slice(0, HANDLE_MAX - 7)}_${randomSuffix()}`;
}
