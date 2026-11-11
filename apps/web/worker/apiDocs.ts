// GET /api/v1 の説明（docs/tasks/T037.md「4」）。AI が読んで使えるように、Markdown で返す。中身は docs/tasks/T037.md「2」の表と同じ。

import { MAX_PART_BYTES } from '@ludion/rules';
import type { Locale } from '../src/i18n';
import { MAX_KEYS_PER_USER } from './aiKeys';
import { API_LIMITS, POST_LIMITS, PRIVATE_LIMITS } from './quotaLimits';
import { PRIVATE_WORKS_LIMIT } from './revisions';

const KB = MAX_PART_BYTES / 1024;

const en = (origin: string) => `# Ludion API v1

Ludion is a place to keep UI works (screens and components). This API lets an AI (Claude Code and others) put works on Ludion for a person, with that person's AI key.

## Key

- The person makes an AI key on their account page: ${origin}/account ("AI keys"). Up to ${MAX_KEYS_PER_USER} keys per person. The key is shown only once.
- Send it as \`Authorization: Bearer ld_…\`. A missing, wrong, or deleted key gets 401. Cookies are not used.
- When the person made the key, they agreed for every work put with it: it is their own UI (or they have the rights), it is published under MIT, and they accept the terms (${origin}/terms).
- Do not write the key into files or logs.
- An AI that supports MCP can connect without a key: add \`${origin}/mcp\` as a connector (OAuth). Its access token (\`ldo_…\`) also works here as \`Authorization: Bearer\`.

## Requests

Bodies and responses are JSON. Send \`Content-Type: application/json\`. \`Accept-Language\` picks Japanese (\`ja\`) or English for messages.

| Endpoint | Body | Response |
| --- | --- | --- |
| \`POST /api/v1/works\` | \`{ "html": "…", "title"?: "…", "from"?: "<source work ID>" }\` | 201 \`{ "id", "version", "url", "code_url", "visibility" }\` |
| \`POST /api/v1/works/:id/versions\` | \`{ "html": "…", "title"?: "…" }\` | 201 \`{ "id", "version", "url", "code_url", "visibility" }\` |
| \`GET /api/v1/works\` | — | 200 \`{ "works": [{ "id", "title", "visibility", "status", "version", "updated_at", "url" }] }\` (your works only) |
| \`GET /api/v1/works/:id\` | — | 200 \`{ "id", "title", "visibility", "status", "version", "from", "url", "code" }\` (your works only; other people's works are 404) |

## The html

- One HTML file, the same as pasting into ${origin}/new: one root element with \`data-ld-part\`, then one \`<style>\`, then (if it moves) one \`<script type="module">\` with \`function mount(root) { …; return () => { /* clean up */ }; }\` and a last line \`mount(document.querySelector('[data-ld-part="…"]'));\`. A full document (\`<!doctype html>\`, \`<html>\`, \`<head>\`, \`<body>\`) is accepted and unwrapped.
- All CSS selectors go under \`[data-ld-part="…"]\`. JS touches only \`root\`. No external requests (only Google Fonts may be loaded). No page navigation (\`location\`, \`window.open\`, \`top\`, \`parent\`). Links use \`href="#"\`.
- HTML, CSS and JS can each be up to ${KB}KB.
- If something must be fixed, the response is 422 \`{ "error": "invalid_work", "message", "problems": [{ "message", "fix" }] }\`. Fix each problem as \`fix\` says and send again.
- No title: the HTML \`<title>\` is used; without one, "Untitled". No thumbnail is needed.
- The credit line (\`<!-- UI by @… -->\`) is added by Ludion. Keep it when you edit code you got from Ludion; it is removed and made again when you put.
- \`from\`: the ID of a public work this one remixes. A missing work, a work that is not public, or the work itself is 422 \`bad_from\`. The source's code is at \`${origin}/p/<id>/code\`.

## Who can see it

- What you put is **Only me**: visible only to the person, with no review. \`visibility\` is \`"private"\` (only the person), \`"public"\`, or \`"draft"\` (only the person; works put before Only me existed).
- Publishing (sending for review) is done by the person on the site, at \`url\`. The API cannot publish.
- A new version of an Only me work becomes its current version right away (the version number goes up).
- A new version of a public work becomes that work's draft version. The public version does not change until it passes review.
- While a work is in review, a new version is 409 \`in_review\`.
- A person can have up to ${PRIVATE_WORKS_LIMIT} Only me works; a new one past that is 409 \`private_limit\` (new versions still work).
- \`url\` is the work page. Before the work is public, only the person (logged in on the site) can open it. \`code_url\` (\`/p/<id>/code\`) works for everyone once the work is public; before that, use \`GET /api/v1/works/:id\` for the code.

## Limits

- Putting (POST): ${API_LIMITS.putsPerUserHour} times an hour per person. Reading (GET): ${API_LIMITS.readsPerUserHour} times an hour per person. Per day: up to ${PRIVATE_LIMITS.revisionsPerUserDay} new Only me versions, and up to ${POST_LIMITS.revisionsPerUserDay} versions that go to review (new versions of public works, and publishing on the site).
- Over the limit: 429 \`{ "error": "rate_limited", "message", "retry_at" }\` and a \`Retry-After\` header. Wait until \`retry_at\`.

## Errors

Every error is \`{ "error": "<fixed word>", "message": "…" }\`:
\`unauthorized\` (401), \`bad_request\`, \`unknown_field\`, \`bad_html\`, \`bad_title\` (400), \`not_found\` (404), \`in_review\`, \`private_limit\`, \`conflict\` (409), \`too_large\` (413), \`invalid_work\`, \`bad_from\` (422), \`rate_limited\` (429), \`posting_closed\` (403).
`;

const ja = (origin: string) => `# Ludion API v1

Ludion は UI の作品（画面と部品）を置く場所です。この API で、AI（Claude Code など）が、本人の AI の鍵を使って、本人の代わりに作品を置けます。

## 鍵

- 本人が、アカウントのページ（${origin}/account の「AI の鍵」）で作ります。1人${MAX_KEYS_PER_USER}本まで。鍵は1回だけ見せます。
- \`Authorization: Bearer ld_…\` で送ります。鍵がない、違う、消された：401。cookie では動きません。
- 鍵を作るとき、本人は、その鍵で置くもの全部について同意しています：自分で作った、または権利がある UI であること、MIT で公開してよいこと、利用規約（${origin}/terms）に同意すること。
- 鍵をファイルやログに書かないでください。
- MCP を使える AI は、鍵なしでつなげます：\`${origin}/mcp\` をコネクタとして足します（OAuth）。そのアクセスのトークン（\`ldo_…\`）は、この口でも \`Authorization: Bearer\` で使えます。

## 口

本文と応答は JSON です。\`Content-Type: application/json\` を付けます。文は \`Accept-Language\` で日本語（\`ja\`）か英語を選びます。

| 口 | 受けるもの | 返すもの |
| --- | --- | --- |
| \`POST /api/v1/works\` | \`{ "html": "…", "title"?: "…", "from"?: "<元の作品の ID>" }\` | 201 \`{ "id", "version", "url", "code_url", "visibility" }\` |
| \`POST /api/v1/works/:id/versions\` | \`{ "html": "…", "title"?: "…" }\` | 201 \`{ "id", "version", "url", "code_url", "visibility" }\` |
| \`GET /api/v1/works\` | — | 200 \`{ "works": [{ "id", "title", "visibility", "status", "version", "updated_at", "url" }] }\`（自分の作品だけ） |
| \`GET /api/v1/works/:id\` | — | 200 \`{ "id", "title", "visibility", "status", "version", "from", "url", "code" }\`（自分の作品だけ。ほかの人のは 404） |

## html

- 1つの HTML。${origin}/new に貼るのと同じです：\`data-ld-part\` を付けた一番外の要素1つ、\`<style>\` 1つ、動きがあれば \`<script type="module">\` 1つ（\`function mount(root) { …; return () => { /* 片付け */ }; }\` と、最後の行の \`mount(document.querySelector('[data-ld-part="…"]'));\`）。\`<!doctype html>\`、\`<html>\`、\`<head>\`、\`<body>\` で包んだ文書も受け、包みを外します。
- CSS のセレクタは、すべて \`[data-ld-part="…"]\` の下に置きます。JS は \`root\` の中だけを触ります。外へ通信しません（Google Fonts だけは読めます）。ページを移りません（\`location\`、\`window.open\`、\`top\`、\`parent\`）。リンクは \`href="#"\`。
- HTML、CSS、JS は、それぞれ ${KB}KB までです。
- 直すところがあれば 422 \`{ "error": "invalid_work", "message", "problems": [{ "message", "fix" }] }\`。\`fix\` のとおりに直して、もう一度送ります。
- 題がなければ、HTML の \`<title>\`、なければ「無題」。サムネイルは要りません。
- クレジット行（\`<!-- UI by @… -->\`）は Ludion が入れます。Ludion から取ったコードを直すときは消さずに残してください。置くときに外して、作り直します。
- \`from\`：リミックスの元の、公開されている作品の ID。ない作品、公開されていない作品、自分自身は 422 \`bad_from\`。元のコードは \`${origin}/p/<id>/code\` にあります。

## 誰に見えるか

- 置いたものは「自分だけ」です。本人にしか見えず、審査はしません。\`visibility\` は \`"private"\`（本人だけ）、\`"public"\`、\`"draft"\`（本人だけ。自分だけができる前に置いたもの）。
- 公開（審査に出す）は、本人がサイトの画面（\`url\`）からします。API からは公開できません。
- 自分だけの作品に新しい版を置くと、すぐ今の版になります（版の番号が上がります）。
- 公開している作品に新しい版を置くと、その作品の下書きの版になります。審査を通るまで、公開の版は変わりません。
- 審査中の作品に新しい版を置くと 409 \`in_review\`。
- 自分だけの作品は1人${PRIVATE_WORKS_LIMIT}作品まで。超える新しい作品は 409 \`private_limit\`（新しい版は置けます）。
- \`url\` は作品のページです。公開の前は、本人（サイトにログインしている人）だけが開けます。\`code_url\`（\`/p/<id>/code\`）は、公開の後はだれでも使えます。それまでのコードは \`GET /api/v1/works/:id\` で取ります。

## 上限

- 置く（POST）：1人1時間${API_LIMITS.putsPerUserHour}回。読む（GET）：1人1時間${API_LIMITS.readsPerUserHour}回。1日には、自分だけの新しい版が${PRIVATE_LIMITS.revisionsPerUserDay}まで、審査に回る版（公開の作品の新しい版と、サイトで公開すること）が${POST_LIMITS.revisionsPerUserDay}まで。
- 超えたら 429 \`{ "error": "rate_limited", "message", "retry_at" }\` と \`Retry-After\` の頭。\`retry_at\` まで待ちます。

## エラー

どれも \`{ "error": "<決まった語>", "message": "…" }\`：
\`unauthorized\`（401）、\`bad_request\`、\`unknown_field\`、\`bad_html\`、\`bad_title\`（400）、\`not_found\`（404）、\`in_review\`、\`private_limit\`、\`conflict\`（409）、\`too_large\`（413）、\`invalid_work\`、\`bad_from\`（422）、\`rate_limited\`（429）、\`posting_closed\`（403）。
`;

export const apiDocs = (locale: Locale, origin: string) => (locale === 'ja' ? ja(origin) : en(origin));
