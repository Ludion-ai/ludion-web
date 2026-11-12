// 回数の上限の数（worker/quota.ts）。Worker の型に頼らない。e2e/post.spec.ts がそのまま読むため。
// CEO の確認待ちの数は docs/reports/T021.md に書いた。

/** 投稿の上限。版は新しく作る版、保存は下書きの上書きを含む全部の保存（画像を作り直すので、版より重い）。 */
export const POST_LIMITS = {
  revisionsPerUserDay: 10,
  revisionsAllDay: 200,
  savesPerUserDay: 50,
  savesAllDay: 1000,
} as const;

/**
 * 自分だけの作品の上限（MCP001 の CEO の答え）。自分だけになる版（AI の口で置く版、自分だけの作品の新しい版）は1人1日100。
 * 公開に回すもの（審査に出す、自分だけから公開する）は POST_LIMITS の版の数のまま（1日10）。全体の数は、人ごとの数を多くの人が使っても止まらない大きさ。
 */
export const PRIVATE_LIMITS = {
  revisionsPerUserDay: 100,
  revisionsAllDay: 5000,
  savesPerUserDay: 100,
  savesAllDay: 5000,
} as const;

/** AI の口（/api/v1。docs/tasks/T037.md「2」）の、1人1時間の上限。置くのは POST、読むのはほかの全部。投稿の上限（POST_LIMITS）もそのまま効く。 */
export const API_LIMITS = {
  putsPerUserHour: 30,
  readsPerUserHour: 300,
} as const;

/** 新しい人を作る上限（docs/tasks/T021.md、T020 報告の [CTO]）。 */
export const SIGNUP_LIMITS = {
  perKeyDay: 5,
  allHour: 200,
} as const;

/**
 * 埋め込み（/e/<id>。EMBED001「7」）の、全体の1日（UTC）の上限。数えるのは埋め込みの枠（embed.html）を返した回数。
 * 1回の表示は /e/<id> と枠で、Worker の要求が2回になる。Workers の無料の枠（1日10万要求）の半分（5万）を超えないよう、
 * 2万回（要求は約4万）で止め、止めた絵と作品のページへのリンクにする。止めた後の表示も、1回に要求が2回（/e/ とサムネイル）かかる。
 */
export const EMBED_LIMITS = {
  viewsAllDay: 20_000,
} as const;
