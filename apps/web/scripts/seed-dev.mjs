// 開発用のデータを、手元の D1 と R2 に入れる（SPEC.md 11、npm run seed:dev）。
// - seed/ の50作品。コードは持たないので、作品のページで動く単純な部品をここで作る
// - fixtures/works/ の良い見本と、fixtures/malicious/ の悪意のある見本（docs/tasks/T007.md「4」）。
//   LD_SEED_NO_FIXTURES=1 なら入れない（50作品の並びを確かめるテストと、ホームの計測）
// LD_PERSIST_DIR があればそこに（テストと npm run lcp の使い捨ての場所）、なければ .wrangler/state に。
// 本番には入れない：getPlatformProxy の手元の束縛だけを使い、--remote の道を持たない。
// 何度でも流せる：seed と悪意のある見本の行だけを消してから入れ直す。ld upload で送った作品には触らない。
// npm run dev を止めてから流す（手元の D1 のファイルを同時に開かないため）。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from '@ludion/rules';
import { getPlatformProxy } from 'wrangler';
import { PRIVATE_OWNER, privateFixtureId, privateRevisionId, sessionHash } from './private-fixture.mjs';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = join(webDir, '../../seed');
const fixturesDir = join(webDir, '../../fixtures');
const works = JSON.parse(readFileSync(join(seedDir, 'works.json'), 'utf8'));
const persistDir = process.env.LD_PERSIST_DIR;
const withFixtures = !process.env.LD_SEED_NO_FIXTURES;

/** 作者のリンクの見本（作品のページと作り手のページで見るため）。 */
const CREATOR_LINKS = {
  seed_a: { x_url: 'https://x.com/seed_a', site_url: 'https://seed-a.example' },
  seed_d: { x_url: 'https://x.com/seed_d', site_url: null },
};

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** seed の作品の中身。無地の面に題名を1行（サムネイルと同じ。SPEC.md 11）。 */
function seedParts(work) {
  const root = `[data-ld-part="${work.id}"]`;
  return {
    'part.html': `<div data-ld-part="${work.id}"><p class="title">${escapeHtml(work.title)}</p></div>\n`,
    'part.css': `${root} {
  --_bg: var(--ld-bg, ${work.seed_color});
  --_fg: var(--ld-fg, #111114);
  --_font: var(--ld-font, system-ui, sans-serif);
  --_space: var(--ld-space, 8px);
  display: grid;
  place-items: center;
  min-height: 320px;
  padding: calc(var(--_space) * 3);
  background: var(--_bg);
  color: var(--_fg);
  font-family: var(--_font);
}
${root} .title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  text-align: center;
}
`,
    'meta.json': JSON.stringify({
      id: work.id,
      title: work.title,
      type: work.type,
      platform: work.platform,
      category: work.category,
      subtype: work.subtype,
      tags: work.tags,
      creator: work.creator.handle,
      license: work.license,
      made_with: work.made_with,
      version: work.version,
      published_at: new Date(work.published_at).toISOString().slice(0, 10),
      pin_order: work.pin_order,
    }),
  };
}

const CONTENT_TYPES = {
  'part.html': 'text/html; charset=utf-8',
  'part.css': 'text/css; charset=utf-8',
  'part.js': 'text/javascript; charset=utf-8',
  'meta.json': 'application/json; charset=utf-8',
  'thumb.webp': 'image/webp',
  'og.png': 'image/png',
};

const { env, dispose } = await getPlatformProxy({
  configPath: join(webDir, 'wrangler.jsonc'),
  persist: persistDir ? { path: join(persistDir, 'v3') } : true,
  remoteBindings: false,
});

try {
  const { DB: db, PARTS: parts } = env;

  /** 作品のファイルを R2 に置く（works/<id>/<version>/。SPEC.md 7）。 */
  const putWorkFiles = (id, version, files) =>
    Promise.all(
      Object.entries(files).map(([name, body]) =>
        parts.put(`works/${id}/${version}/${name}`, body, { httpMetadata: { contentType: CONTENT_TYPES[name] } }),
      ),
    );

  /** 直に入れた作品の、今の版の行を作る（管理API と同じ形。0005 の移行と同じ。枠と画像は版の行から置き場を読む）。 */
  const insertMissingRevisions = () =>
    db
      .prepare(
        `INSERT INTO revisions (id, work_id, version, status, r2_prefix, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), w.id, w.version, w.status, 'works/' || w.id || '/' || w.version, w.title, w.type, w.platform, w.category, w.subtype, w.tags, w.made_with, w.thumb_w, w.thumb_h, w.created_at, w.created_at
         FROM works w WHERE NOT EXISTS (SELECT 1 FROM revisions r WHERE r.work_id = w.id AND r.version = w.version)`,
      )
      .run();

  // 作者（avatar_url は R2 のキー。管理API と同じ形）
  const creators = new Map();
  for (const { creator } of works) {
    if (creators.has(creator.handle)) continue;
    const avatar = readFileSync(join(seedDir, 'files/avatars', `${creator.handle}.webp`));
    const id = `seed-creator-${creator.handle}`;
    const hash = createHash('sha256').update(avatar).digest('hex').slice(0, 12);
    const key = `creators/${id}/avatar-${hash}.webp`;
    await parts.put(key, avatar, { httpMetadata: { contentType: 'image/webp' } });
    creators.set(creator.handle, { ...creator, ...CREATOR_LINKS[creator.handle], id, key });
  }

  await db.batch([
    db.prepare("DELETE FROM likes WHERE work_id LIKE 'seed-%'"),
    db.prepare("DELETE FROM counters WHERE work_id LIKE 'seed-%' OR work_id LIKE 'mal-%'"),
    db.prepare("DELETE FROM revisions WHERE work_id LIKE 'seed-%' OR work_id LIKE 'mal-%'"),
    db.prepare("DELETE FROM works WHERE id LIKE 'seed-%' OR id LIKE 'mal-%'"),
    db.prepare("DELETE FROM creators WHERE id LIKE 'seed-creator-%'"),
    ...[...creators.values()].map((creator) =>
      db
        .prepare('INSERT INTO creators (id, handle, name, kind, avatar_url, x_url, site_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(creator.id, creator.handle, creator.name, creator.kind, creator.key, creator.x_url ?? null, creator.site_url ?? null, now),
    ),
  ]);

  // サムネイルと作品
  for (const work of works) {
    const key = `works/${work.id}/${work.version}/thumb.webp`;
    await putWorkFiles(work.id, work.version, { ...seedParts(work), 'thumb.webp': readFileSync(join(seedDir, 'files', key)) });
  }

  const statements = works.flatMap((work) => [
    db
      .prepare(
        `INSERT INTO works (id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status,
           pin_order, thumb_key, thumb_w, thumb_h, created_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        work.id,
        creators.get(work.creator.handle).id,
        work.title,
        work.type,
        work.platform,
        work.category,
        work.subtype,
        JSON.stringify(work.tags),
        work.made_with,
        work.version,
        work.license,
        work.pin_order,
        `works/${work.id}/${work.version}/thumb.webp`,
        work.thumb_w,
        work.thumb_h,
        now,
        work.published_at,
      ),
    // 閲覧数とコピー数は日ごとの行。seed は全部を今日の1行にまとめる
    db.prepare('INSERT INTO counters (work_id, day, views, copies) VALUES (?, ?, ?, ?)').bind(work.id, today, work.views, work.copies_30d),
    // いいねは1人1行（SPEC.md 7）。見本の数だけ、架空の id の行を作る。開発用の D1 にしか入らない
    db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
         INSERT INTO likes (user_id, work_id, created_at) SELECT 'seed-user-' || i, ?2, ?3 FROM n`,
      )
      .bind(work.likes, work.id, now),
  ]);
  await db.batch(statements);

  await insertMissingRevisions();

  const count = await db.prepare("SELECT COUNT(*) AS n FROM works WHERE id LIKE 'seed-%' AND status = 'approved'").first('n');
  const likes = await db.prepare("SELECT COUNT(*) AS n FROM likes WHERE work_id LIKE 'seed-%'").first('n');
  console.log(`seed：作品 ${count}、作者 ${creators.size}、いいねの行 ${likes}（${persistDir ?? '.wrangler/state'}）`);

  if (withFixtures) {
    // 見本の作者。ld upload で先に入っていれば、その行を使う
    const creatorDir = join(fixturesDir, 'creators/fixture');
    const profile = JSON.parse(readFileSync(join(creatorDir, 'creator.json'), 'utf8'));
    const known = await db.prepare('SELECT id FROM creators WHERE handle = ? COLLATE NOCASE').bind(profile.handle).first();
    const creatorId = known?.id ?? `seed-creator-${profile.handle}`;
    const avatar = readFileSync(join(creatorDir, 'avatar.webp'));
    const avatarKey = `creators/${creatorId}/avatar-${createHash('sha256').update(avatar).digest('hex').slice(0, 12)}.webp`;
    await parts.put(avatarKey, avatar, { httpMetadata: { contentType: 'image/webp' } });
    if (!known) {
      await db
        .prepare('INSERT INTO creators (id, handle, name, kind, avatar_url, x_url, site_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(creatorId, profile.handle, profile.name, profile.kind, avatarKey, profile.x_url, profile.site_url, now)
        .run();
    }

    const insertFixture = async (dir, imagesDir) => {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
      // ld upload で送った版があれば、そのままにする
      if (await db.prepare('SELECT 1 AS found FROM works WHERE id = ?').bind(meta.id).first()) return false;
      const files = {};
      for (const name of ['part.html', 'part.css', 'part.js', 'meta.json']) {
        if (existsSync(join(dir, name))) files[name] = readFileSync(join(dir, name));
      }
      const thumb = readFileSync(join(imagesDir, 'thumb.webp'));
      await putWorkFiles(meta.id, meta.version, { ...files, 'thumb.webp': thumb, 'og.png': readFileSync(join(imagesDir, 'og.png')) });
      await db
        .prepare(
          `INSERT INTO works (id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status,
             pin_order, thumb_key, thumb_w, thumb_h, created_at, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, 800, ?, ?, ?)`,
        )
        .bind(
          meta.id,
          creatorId,
          meta.title,
          meta.type,
          meta.platform,
          meta.category,
          meta.subtype,
          JSON.stringify(meta.tags),
          meta.made_with,
          meta.version,
          meta.license,
          meta.pin_order,
          `works/${meta.id}/${meta.version}/thumb.webp`,
          imageSize(thumb).height,
          now,
          Date.parse(`${meta.published_at}T00:00:00Z`),
        )
        .run();
      return true;
    };

    const goodDir = join(fixturesDir, 'works');
    const good = readdirSync(goodDir).filter((id) => !id.startsWith('fx-bad-'));
    let added = 0;
    for (const id of good) {
      if (await insertFixture(join(goodDir, id), join(goodDir, id))) added += 1;
    }
    // 悪意のある見本は検査を通らないので、管理API を通さずに直に入れる。画像は良い見本のものを借りる
    const maliciousDir = join(fixturesDir, 'malicious');
    const malicious = readdirSync(maliciousDir).filter((name) => name.startsWith('mal-'));
    for (const id of malicious) await insertFixture(join(maliciousDir, id), join(goodDir, 'fx-button'));
    await insertMissingRevisions();

    // 自分だけの作品の見本（scripts/private-fixture.mjs）。悪意のある見本を、見本の持ち主の自分だけの作品として入れる
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(PRIVATE_OWNER.userId),
      db.prepare('DELETE FROM creators WHERE id = ?').bind(PRIVATE_OWNER.creatorId),
      db.prepare('DELETE FROM users WHERE id = ?').bind(PRIVATE_OWNER.userId),
      db.prepare('INSERT INTO users (id, handle, display_name, created_at) VALUES (?, ?, ?, ?)').bind(PRIVATE_OWNER.userId, PRIVATE_OWNER.handle, 'Private Owner', now),
      db
        .prepare(`INSERT INTO creators (id, handle, name, kind, user_id, created_at) VALUES (?, ?, ?, 'person', ?, ?)`)
        .bind(PRIVATE_OWNER.creatorId, PRIVATE_OWNER.handle, 'Private Owner', PRIVATE_OWNER.userId, now),
      db
        .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_used_at, auth_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(sessionHash(PRIVATE_OWNER.session), PRIVATE_OWNER.userId, now + 365 * 24 * 60 * 60 * 1000, now, now, now),
      ...malicious.flatMap((id) => [
        db
          .prepare(
            `INSERT INTO works (id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status, thumb_key, thumb_w, thumb_h, created_at)
             SELECT ?2, ?3, title, type, platform, category, subtype, tags, made_with, version, license, 'private', thumb_key, thumb_w, thumb_h, created_at FROM works WHERE id = ?1`,
          )
          .bind(id, privateFixtureId(id), PRIVATE_OWNER.creatorId),
        db
          .prepare(
            `INSERT INTO revisions (id, work_id, version, status, r2_prefix, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, created_at, updated_at)
             SELECT ?3, ?2, version, 'private', 'works/' || id || '/' || version, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, created_at, created_at FROM works WHERE id = ?1`,
          )
          .bind(id, privateFixtureId(id), privateRevisionId(id)),
      ]),
    ]);
    console.log(`見本：良いもの ${added}/${good.length}（ld upload 済みのものは飛ばす）、悪意のあるもの ${malicious.length}`);
  }
} finally {
  await dispose();
}
