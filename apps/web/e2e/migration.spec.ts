// 0002 の移行（docs/tasks/T020.md「1」「4」）。
// 今の本番と同じ形の D1 を test-server.mjs が作り、本番と同じ migrations apply で移してから、サーバーを立てている。

import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BOOKMARK, CEO_GITHUB_ID, fakeGitHubId, LIKE, MARK_0001_APPLIED, oldShapeSql, OTHER_WORK_ID, PEOPLE, WORK_ID } from '../scripts/migration-fixture.mjs';
import { Visitor } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_MIGRATION_PERSIST_DIR!;
const MIGRATIONS = join(WEB, 'migrations');
const INIT_SQL = readFileSync(join(MIGRATIONS, '0001_init.sql'), 'utf8');
const ACCOUNTS_SQL = readFileSync(join(MIGRATIONS, '0002_accounts.sql'), 'utf8');

function d1<T = Record<string, unknown>>(sql: string, persist = PERSIST): T[] {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', persist, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const person = (login: string) => PEOPLE.find((one) => one.login === login)!;

test.describe('移した後の中身（本番と同じ道で移したもの）', () => {
  test('人は3人のまま。id、作った時刻、アバターが変わらない。handle は login を小文字にしたもの', () => {
    const rows = d1<{ id: string; handle: string; display_name: string | null; avatar_url: string | null; x_url: string | null; created_at: number }>('SELECT id, handle, display_name, avatar_url, x_url, created_at FROM users ORDER BY created_at');
    expect(rows).toEqual([
      // CEO は作者に結ばれるので、公開している作者の名前とリンクになる（GitHub の名前を作り手のページへ出さない）
      { id: 'old-user-ceo', handle: 'lattice_node', display_name: 'Lattice', avatar_url: 'https://avatars.example/ceo.png', x_url: 'https://x.com/Lattice_Node', created_at: person('Ludion-ai').created_at },
      { id: 'old-user-two', handle: 'some_visitor', display_name: null, avatar_url: 'https://avatars.example/two.png', x_url: null, created_at: person('Some-Visitor').created_at },
      { id: 'old-user-three', handle: 'plainperson', display_name: 'Plain Person', avatar_url: null, x_url: null, created_at: person('PlainPerson').created_at },
    ]);
  });

  test('GitHub の id と login は identities に移る。users からは消える', () => {
    const columns = d1<{ name: string }>('PRAGMA table_info(users)').map(({ name }) => name).sort();
    expect(columns).toEqual(['avatar_url', 'created_at', 'display_name', 'handle', 'id', 'is_operator', 'site_url', 'x_url']);
    const rows = d1<{ user_id: string; provider: string; subject: string; label: string; created_at: number }>('SELECT user_id, provider, subject, label, created_at FROM identities ORDER BY created_at');
    expect(rows).toEqual(
      PEOPLE.map((one) => ({ user_id: one.id, provider: 'github', subject: String(one.github_id), label: one.login, created_at: one.created_at })),
    );
  });

  test('作者 Lattice_Node が CEO に結ばれる。作者の行のほかの値は変わらない', () => {
    expect(d1('SELECT id, handle, name, x_url, user_id FROM creators')).toEqual([
      { id: 'creator-ceo', handle: 'Lattice_Node', name: 'Lattice', x_url: 'https://x.com/Lattice_Node', user_id: 'old-user-ceo' },
    ]);
  });

  test('いいねとしおりの行が同じ', () => {
    // いいねとしおりのテストより前に走るとは限らないので、見本の行だけを見る
    expect(d1(`SELECT user_id, work_id, created_at FROM likes WHERE user_id = '${LIKE.user_id}' AND work_id = '${LIKE.work_id}'`)).toEqual([LIKE]);
    expect(d1(`SELECT user_id, work_id, created_at FROM bookmarks WHERE user_id = '${BOOKMARK.user_id}' AND work_id = '${BOOKMARK.work_id}'`)).toEqual([BOOKMARK]);
  });

  test('0005：今の作品の今の版が版の表に移る。置き場は今のまま。枠と画像の道が読める。運営は作者に結ばれた人だけ', async () => {
    const rows = d1<{ id: string; work_id: string; version: string; status: string; r2_prefix: string; content_hash: string; title: string; created_by: string | null }>(
      `SELECT id, work_id, version, status, r2_prefix, content_hash, title, created_by FROM revisions WHERE work_id IN ('${WORK_ID}', '${OTHER_WORK_ID}') ORDER BY work_id`,
    );
    expect(rows.map(({ work_id, version, status, r2_prefix, content_hash, title, created_by }) => ({ work_id, version, status, r2_prefix, content_hash, title, created_by })).sort((a, b) => a.work_id.localeCompare(b.work_id))).toEqual(
      [WORK_ID, OTHER_WORK_ID]
        .map((id) => ({ work_id: id, version: '1.0.0', status: 'approved', r2_prefix: `works/${id}/1.0.0`, content_hash: '', title: 'Migration Work', created_by: null }))
        .sort((a, b) => a.work_id.localeCompare(b.work_id)),
    );
    for (const { id } of rows) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(d1<{ handle: string; is_operator: number }>('SELECT handle, is_operator FROM users ORDER BY handle')).toEqual([
      { handle: 'lattice_node', is_operator: 1 },
      { handle: 'plainperson', is_operator: 0 },
      { handle: 'some_visitor', is_operator: 0 },
    ]);
    expect(d1('SELECT COUNT(*) AS n FROM quotas')).toEqual([{ n: 0 }]);
  });

  test('セッションの作った日が入る。日の単位で、ログインの時刻は 0（もう一度のログインを求める）', () => {
    const [row] = d1<{ created_at: number; last_used_at: number; auth_at: number; expires_at: number }>(`SELECT created_at, last_used_at, auth_at, expires_at FROM sessions WHERE user_id = 'old-user-ceo'`);
    const day = 24 * 60 * 60 * 1000;
    expect(row.created_at % day).toBe(0);
    expect(row.created_at).toBe(Math.floor((row.expires_at - 30 * day) / day) * day);
    expect(row.auth_at).toBe(0);
  });
});

test.describe('移した後の動き', () => {
  test.describe.configure({ mode: 'serial' });

  test('前のセッションのまま入れる。いいねとしおりが本人に見える', async () => {
    const two = await new Visitor(person('Some-Visitor').token).me();
    expect(two.user).toEqual({ handle: 'some_visitor', display_name: null, avatar_url: 'https://avatars.example/two.png' });
    expect(two.liked).toContain(WORK_ID);
    const three = await new Visitor(person('PlainPerson').token).me();
    expect(three.bookmarked).toContain(WORK_ID);
  });

  test('GitHub でログインすると、前と同じ人になる。行は増えない', async () => {
    const usersBefore = d1<{ n: number }>('SELECT COUNT(*) AS n FROM users')[0].n;
    const visitor = new Visitor();
    expect((await visitor.login('Some-Visitor')).status).toBe(302);
    const me = await visitor.me();
    expect(me.user.handle).toBe('some_visitor');
    expect(me.liked).toContain(WORK_ID);
    expect(d1<{ n: number }>('SELECT COUNT(*) AS n FROM users')[0].n).toBe(usersBefore);
    // 手段の情報だけが新しくなる。表示の名前は GitHub の名前で上書きしない
    const [row] = d1<{ id: string; display_name: string | null; avatar_url: string }>(`SELECT u.id, u.display_name, u.avatar_url FROM users u WHERE u.handle = 'some_visitor'`);
    expect(row.id).toBe('old-user-two');
    expect(row.display_name).toBeNull();
    expect(row.avatar_url).toContain('/avatars/Some-Visitor.svg');
  });

  test('移した後も、いいねとしおりを押せて、取り消せる', async () => {
    const visitor = new Visitor();
    await visitor.login('PlainPerson');
    expect((await visitor.me()).bookmarked).toContain(WORK_ID);

    expect(await (await visitor.post(`/api/works/${OTHER_WORK_ID}/like`)).json()).toEqual({ liked: true });
    expect(await (await visitor.post(`/api/works/${OTHER_WORK_ID}/bookmark`)).json()).toEqual({ bookmarked: true });
    const me = await visitor.me();
    expect(me.liked).toContain(OTHER_WORK_ID);
    expect(me.bookmarked).toEqual(expect.arrayContaining([WORK_ID, OTHER_WORK_ID]));
    expect(await (await visitor.post(`/api/works/${OTHER_WORK_ID}/like`)).json()).toEqual({ liked: false });
    expect(await (await visitor.post(`/api/works/${OTHER_WORK_ID}/bookmark`)).json()).toEqual({ bookmarked: false });
  });

  test('CEO：GitHub でログインすると、自分の作品が一覧に出る。もとのセッションは直近のログインではない', async () => {
    const old = new Visitor(person('Ludion-ai').token);
    expect((await (await old.fetch('/api/account')).json()).recent_auth).toBe(false);

    const visitor = new Visitor();
    await visitor.login('Ludion-ai');
    const account = await (await visitor.fetch('/api/account')).json();
    expect(account.profile.handle).toBe('lattice_node');
    expect(account.profile.display_name).toBe('Lattice');
    expect(account.works_count).toBe(2);
    expect(account.recent_auth).toBe(true);
    const { works } = await (await visitor.fetch('/api/account/works')).json();
    expect(works.map((work: { id: string }) => work.id).sort()).toEqual([OTHER_WORK_ID, WORK_ID].sort());
    expect(works[0].creator.handle).toBe('Lattice_Node');
  });
});

test.describe('0002 の SQL（色々な login）', () => {
  /** 0001 に行を入れて 0002 を流す。D1 と同じ SQLite なので、形の確かめはメモリーの DB で足りる。 */
  function migrated(logins: string[], { creators = ['Lattice_Node'] }: { creators?: string[] } = {}) {
    const db = new DatabaseSync(':memory:');
    db.exec(INIT_SQL);
    logins.forEach((login, index) => {
      db.prepare('INSERT INTO users (id, github_id, login, name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)').run(`u${index}`, fakeGitHubId(login), login, 1000 + index);
    });
    creators.forEach((handle, index) => {
      db.prepare(`INSERT INTO creators (id, handle, kind, created_at) VALUES (?, ?, 'person', 1)`).run(`c${index}`, handle);
    });
    db.exec(ACCOUNTS_SQL);
    return db;
  }

  const handles = (db: DatabaseSync) => (db.prepare('SELECT handle FROM users ORDER BY created_at').all() as { handle: string }[]).map(({ handle }) => handle);

  test('大文字は小文字に、- は _ に、21文字からは切る', () => {
    const db = migrated(['Foo-Bar', 'UPPER', 'a-very-long-github-login-name-here']);
    expect(handles(db)).toEqual(['foo_bar', 'upper', 'a_very_long_github_l']);
  });

  test('短いもの、取れない言葉、ludion を含むものには _user を付ける', () => {
    expect(handles(migrated(['ab', 'admin', 'Ludion-Fan', 'account']))).toEqual(['ab_user', 'admin_user', 'ludion_fan_user', 'account_user']);
  });

  test('重なったら番号を付ける。切った結果の重なりも同じ', () => {
    expect(handles(migrated(['foo-bar', 'Foo-Bar', 'FOO-BAR']))).toEqual(['foo_bar', 'foo_bar_2', 'foo_bar_3']);
    const long = 'x'.repeat(20);
    expect(handles(migrated([`${long}a`, `${long}b`]))).toEqual([long, `${'x'.repeat(17)}_2`]);
  });

  test('ほかの人は、作者の handle を取れない。CEO だけが、login によらず取る', () => {
    expect(handles(migrated(['seed-a'], { creators: ['Seed_A'] }))).toEqual(['seed_a_user']);
    const db = migrated(['Ludion-ai']);
    expect(handles(db)).toEqual(['lattice_node']);
    expect(db.prepare('SELECT user_id FROM creators').get()).toEqual({ user_id: 'u0' });
    expect(db.prepare('SELECT subject, label FROM identities').get()).toEqual({ subject: String(CEO_GITHUB_ID), label: 'Ludion-ai' });
  });

  test('GitHub の Lattice-Node は別の人。作者の handle を取れず、作者にも結ばれない', () => {
    const db = migrated(['Lattice-Node']);
    expect(handles(db)).toEqual(['lattice_node_user']);
    expect(db.prepare('SELECT user_id FROM creators').get()).toEqual({ user_id: null });

    const both = migrated(['Lattice-Node', 'Ludion-ai']);
    expect(handles(both)).toEqual(['lattice_node_user', 'lattice_node']);
    expect(both.prepare('SELECT user_id FROM creators').get()).toEqual({ user_id: 'u1' });
  });

  test('CEO がいなければ、作者は結ばれないまま（止めて報告する）', () => {
    const db = migrated(['someone']);
    expect(db.prepare('SELECT user_id FROM creators').get()).toEqual({ user_id: null });
  });

  test('形に合わない handle になる login があると、CHECK で止まる', () => {
    expect(() => migrated(['bad.login'])).toThrow(/CHECK constraint failed/);
  });
});

test.describe('D1 の migrations apply', () => {
  test('途中で止まると、丸ごと入らない（前の形のまま）', () => {
    const persist = mkdtempSync(join(tmpdir(), 'ld-migration-'));
    try {
      const run = (sql: string) => d1(sql, persist);
      execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', persist, '--file', join(MIGRATIONS, '0001_init.sql')], { cwd: WEB, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
      run(MARK_0001_APPLIED);
      run(oldShapeSql());
      // 形に合わない login の人を足すと、CHECK で 0002 が止まる
      run(`INSERT INTO users (id, github_id, login, name, avatar_url, created_at) VALUES ('bad', 99, 'bad.login', NULL, NULL, 1)`);
      expect(() => execFileSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'ludion-app', '--local', '--persist-to', persist], { cwd: WEB, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } })).toThrow();

      expect(run('PRAGMA table_info(users)').map(({ name }) => name)).toContain('github_id');
      expect(run(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('identities', 'users_new', 'handle_history')`)).toEqual([]);
      expect(run('SELECT name FROM d1_migrations')).toEqual([{ name: '0001_init.sql' }]);
    } finally {
      rmSync(persist, { recursive: true, force: true });
    }
  });
});
