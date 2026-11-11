// ログインの手段（docs/tasks/T020.md「1」）。人の鍵は users.id で、手段はそこに結ばれる。

export type Provider = 'github' | 'google';

export interface IdentityRow {
  provider: Provider;
  label: string | null;
  avatar_url: string | null;
  created_at: number;
  last_used_at: number;
}

/** この手段に結ばれた人の users.id。 */
export async function findIdentityUser(db: D1Database, provider: Provider, subject: string): Promise<string | null> {
  const row = await db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/**
 * ログインのたびに、手段の名前とアバターを新しくする。
 * 人のアバターは、この手段から来たものだったとき（前の値と同じか、ないとき）だけ替える。別の手段のアバターで上書きしない。
 */
export async function refreshIdentity(db: D1Database, userId: string, provider: Provider, subject: string, label: string | null, avatarUrl: string | null): Promise<void> {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE users SET avatar_url = ?1 WHERE id = ?2
         AND (avatar_url IS NULL OR avatar_url = (SELECT avatar_url FROM identities WHERE provider = ?3 AND subject = ?4))`,
      )
      .bind(avatarUrl, userId, provider, subject),
    db.prepare('UPDATE identities SET label = ?, avatar_url = ?, last_used_at = ? WHERE provider = ? AND subject = ?').bind(label, avatarUrl, now, provider, subject),
  ]);
}

/** 今の本人に手段を足す。人にアバターがなければ、この手段のものを使う。(provider, subject) が重なると例外。 */
export async function addIdentity(db: D1Database, userId: string, provider: Provider, subject: string, label: string | null, avatarUrl: string | null): Promise<void> {
  const now = Date.now();
  await db.batch([
    db
      .prepare('INSERT INTO identities (user_id, provider, subject, label, avatar_url, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userId, provider, subject, label, avatarUrl, now, now),
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ? AND avatar_url IS NULL').bind(avatarUrl, userId),
  ]);
}

export async function listIdentities(db: D1Database, userId: string): Promise<IdentityRow[]> {
  const { results } = await db
    .prepare('SELECT provider, label, avatar_url, created_at, last_used_at FROM identities WHERE user_id = ? ORDER BY created_at, provider')
    .bind(userId)
    .all<IdentityRow>();
  return results;
}
