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

/**
 * 新しい人を作る上限（docs/tasks/T021.md、T020 報告の [CTO]）。IP の鍵ごとの数が先に効く。
 * 全体は、ひとりで使い切れない大きさ（LIMIT001。前は1時間 200）。人を作るには GitHub か Google かパスキーが要る。
 */
export const SIGNUP_LIMITS = {
  perKeyDay: 5,
  allHour: 1000,
} as const;

/**
 * AI のクライアントの登録（worker/oauth.ts。LIMIT001）。IP の鍵ごとの1日の数が先に効き、全体の1日の数は余裕を持たせる（前は全体で1日 2000 だけ）。
 * 登録は AI のサーバーから来て、多くの人が同じ IP を通るので、IP の鍵ごとの数も大きめにする。
 */
export const REGISTER_LIMITS = {
  perKeyDay: 200,
  allDay: 10000,
} as const;

/** 全体の数が、上限のこの割合に届いたら記録に残す（worker/quota.ts の takeQuota）。 */
export const NEAR_LIMIT_RATIO = 0.8;
