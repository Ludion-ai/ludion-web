// 自分だけの作品の見本（docs/tasks/T036.md「終わりの条件」）。seed-dev.mjs が入れ、e2e/frame-escape.spec.ts が読む。
// 悪意のある見本（fixtures/malicious/）を、見本の持ち主の自分だけの作品として入れる。枠は下書きの枠（/draft-frame/<版の id>/…）。
// セッションの値は、手元とテストの使い捨ての D1 のためだけのもの。本番には入れない（seed-dev.mjs は --remote の道を持たない）。
import { createHash } from 'node:crypto';

export const PRIVATE_OWNER = {
  userId: 'seed-private-owner',
  handle: 'seed_private_owner',
  creatorId: 'seed-creator-private-owner',
  /** cookie の ld_session の値。D1 にはハッシュだけを置く */
  session: 'seed-private-owner-session-token',
};

/** 自分だけの作品の ID。mal- で始まるので、seed を流し直すと消えて入れ直る */
export const privateFixtureId = (id) => `${id}-own`;

/** 版の id（16進の32文字）。毎回同じ値にして、テストが枠の URL を確かめられるようにする */
export const privateRevisionId = (id) => createHash('sha256').update(privateFixtureId(id)).digest('hex').slice(0, 32);

export const sessionHash = (token) => createHash('sha256').update(token).digest('hex');
