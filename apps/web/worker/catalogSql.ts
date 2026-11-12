// 展示の一覧の SQL（worker/catalog.ts）。Worker の型に頼らない。e2e/catalog-plan.spec.ts がそのまま読み、問い合わせの計画を見るため。

// ?1 はコピー数を数え始める日
const SELECT_COLUMNS = `
  SELECT w.id, w.title, w.type, w.platform, w.category, w.subtype, w.tags, w.version, w.license, w.pin_order,
    w.thumb_key, w.thumb_w, w.thumb_h, w.published_at, w.is_remix,
    COALESCE(n.views, 0) AS views, COALESCE(n.copies, 0) AS copies, COALESCE(n.copies_30d, 0) AS copies_30d, COALESCE(l.likes, 0) AS likes,
    w.creator_id, c.handle, c.name, c.kind, c.avatar_url AS avatar_key, c.x_url, c.site_url
  FROM works w
  JOIN creators c ON c.id = w.creator_id`;

/**
 * 作品ごとの数の集計。onlyWork を渡すと、集計の中でその作品の行だけを数える（作品1つを読むときに、counters の表を全部読まない）。
 * counters は (work_id, day) が主キーなので、絞ると索引で読む。likes は work_id の索引がないので、絞っても索引の全部をなめる（LIMIT001 の報告）。
 */
const totalsJoin = (onlyWork?: string) => {
  const where = onlyWork ? ` WHERE work_id = ${onlyWork}` : '';
  return `
  LEFT JOIN (
    SELECT work_id, SUM(views) AS views, SUM(copies) AS copies, SUM(CASE WHEN day >= ?1 THEN copies ELSE 0 END) AS copies_30d
    FROM counters${where} GROUP BY work_id
  ) n ON n.work_id = w.id
  LEFT JOIN (SELECT work_id, COUNT(*) AS likes FROM likes${where} GROUP BY work_id) l ON l.work_id = w.id`;
};

export const SELECT_WORKS = `${SELECT_COLUMNS}${totalsJoin()}`;

// 承認済みの作品を1つ。?2 は作品。数は、その作品の行だけを数える
export const APPROVED_SQL = `${SELECT_COLUMNS}${totalsJoin('?2')}
  WHERE w.id = ?2 AND w.status = 'approved'`;

// 自分だけの作品を1つ。持ち主だけ（docs/tasks/T036.md「2」）。?2 は作品、?3 は本人
export const PRIVATE_SQL = `${SELECT_COLUMNS}${totalsJoin('?2')}
  WHERE w.id = ?2 AND w.status = 'private' AND c.user_id = ?3`;
