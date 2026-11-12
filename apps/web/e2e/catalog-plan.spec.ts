// 作品1つを読む問い合わせの計画（LIMIT001）。migrations を手元の SQLite に入れて、EXPLAIN QUERY PLAN を見る。
// 作品1つを読むときに、counters の表を全部読まない（集計の中で work_id で絞る）。D1 の SQLite の版での計画は、本番では確かめていない。

import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { APPROVED_SQL, PRIVATE_SQL } from '../worker/catalogSql';

const MIGRATIONS = join(import.meta.dirname, '../migrations');

function planOf(sql: string, ...params: string[]): string[] {
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    return db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((row) => String(row.detail));
  } finally {
    db.close();
  }
}

test.describe('作品1つの問い合わせの計画', () => {
  for (const [name, sql, params] of [
    ['承認済みの作品（作品のページ、全画面）', APPROVED_SQL, ['2026-10-01', 'x']],
    ['自分だけの作品', PRIVATE_SQL, ['2026-10-01', 'x', 'u']],
  ] as const) {
    test(`${name}：counters を全部読まない。作品は主キーで読む`, () => {
      const plan = planOf(sql, ...params);
      expect(plan.some((line) => /SEARCH counters USING INDEX sqlite_autoindex_counters_1 \(work_id=\?\)/.test(line)), plan.join('\n')).toBe(true);
      expect(plan.filter((line) => /SCAN counters\b/.test(line)), plan.join('\n')).toEqual([]);
      expect(plan.filter((line) => /SCAN (w|works)\b/.test(line)), plan.join('\n')).toEqual([]);
    });
  }
});
