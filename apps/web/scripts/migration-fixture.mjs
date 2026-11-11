// 0002 を流す前の、今の本番と同じ形の行（docs/tasks/T020.md「4」）。3人、いいね1、しおり1、セッション。
// test-server.mjs（作る側）、e2e/migration.spec.ts（比べる側）、fake-github.mjs（id）が使う。実在の人の情報は入れない。

import { createHash } from 'node:crypto';

/** GitHub の Ludion-ai の数字の id（migrations/0002_accounts.sql と同じ）。 */
export const CEO_GITHUB_ID = 292738933;

/** 偽の GitHub が返す id。login から決まる。CEO の見本だけは本物の数字。 */
export const fakeGitHubId = (login) => (login === 'Ludion-ai' ? CEO_GITHUB_ID : createHash('sha256').update(login).digest().readUInt32BE(0));

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const CREATED_AT = 1_762_000_000_000;
const EXPIRES_AT = Date.now() + 20 * 24 * 60 * 60 * 1000;

export const PEOPLE = [
  { id: 'old-user-ceo', login: 'Ludion-ai', name: 'Real Name Of CEO', avatar_url: 'https://avatars.example/ceo.png', created_at: CREATED_AT, token: 'a'.repeat(64) },
  { id: 'old-user-two', login: 'Some-Visitor', name: null, avatar_url: 'https://avatars.example/two.png', created_at: CREATED_AT + 1000, token: 'b'.repeat(64) },
  { id: 'old-user-three', login: 'PlainPerson', name: 'Plain Person', avatar_url: null, created_at: CREATED_AT + 2000, token: 'c'.repeat(64) },
].map((person) => ({ ...person, github_id: fakeGitHubId(person.login) }));

export const WORK_ID = 'mig-work';
export const OTHER_WORK_ID = 'mig-other';
export const LIKE = { user_id: 'old-user-two', work_id: WORK_ID, created_at: CREATED_AT + 5000 };
export const BOOKMARK = { user_id: 'old-user-three', work_id: WORK_ID, created_at: CREATED_AT + 6000 };
export const SESSION_EXPIRES_AT = EXPIRES_AT;

const quote = (value) => (value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`);

/** 0001 の形の D1 に入れる SQL。 */
export function oldShapeSql() {
  return [
    ...PEOPLE.flatMap((person) => [
      `INSERT INTO users (id, github_id, login, name, avatar_url, created_at) VALUES (${[person.id, person.github_id, person.login, person.name, person.avatar_url, person.created_at].map(quote).join(', ')})`,
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${[hashToken(person.token), person.id, EXPIRES_AT].map(quote).join(', ')})`,
    ]),
    `INSERT INTO creators (id, handle, name, kind, avatar_url, x_url, site_url, user_id, created_at) VALUES ('creator-ceo', 'Lattice_Node', 'Lattice', 'person', NULL, 'https://x.com/Lattice_Node', NULL, NULL, ${CREATED_AT})`,
    ...[WORK_ID, OTHER_WORK_ID].map(
      (id) =>
        `INSERT INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at, published_at)
         VALUES ('${id}', 'creator-ceo', 'Migration Work', 'component', 'Components', 'Button', 'ai-assisted', '1.0.0', 'approved', 'works/${id}/1.0.0/thumb.webp', 800, 600, ${CREATED_AT}, ${CREATED_AT})`,
    ),
    `INSERT INTO likes (user_id, work_id, created_at) VALUES (${[LIKE.user_id, LIKE.work_id, LIKE.created_at].map(quote).join(', ')})`,
    `INSERT INTO bookmarks (user_id, work_id, created_at) VALUES (${[BOOKMARK.user_id, BOOKMARK.work_id, BOOKMARK.created_at].map(quote).join(', ')})`,
  ].join(';\n');
}

/** 0001 まで流した本番の d1_migrations と同じ形にする（次の migrations apply が 0002 から始まる）。 */
export const MARK_0001_APPLIED = `CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
INSERT INTO d1_migrations (name) VALUES ('0001_init.sql');`;
