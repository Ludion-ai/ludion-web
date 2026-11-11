// GET /api/v1 の説明（docs/tasks/T037.md「4」）。AI が読んで使えるように、Markdown で返す。中身は docs/tasks/T037.md「2」の表と同じ。

import { MAX_PART_BYTES } from '@ludion/rules';
import type { Locale } from '../src/i18n';
import { MAX_KEYS_PER_USER } from './aiKeys';
import { API_LIMITS } from './quotaLimits';

const KB = MAX_PART_BYTES / 1024;

const en = (origin: string) => `# Ludion API v1

Ludion is a place to keep UI works (screens and components). This API lets an AI (Claude Code and others) put works on Ludion for a person, with that person's AI key.

## Key

- The person makes an AI key on their account page: ${origin}/account ("AI keys"). Up to ${MAX_KEYS_PER_USER} keys per person. The key is shown only once.
- Send it as \`Authorization: Bearer ld_…\`. A missing, wrong, or deleted key gets 401. Cookies are not used.
- When the person made the key, they agreed for every work put with it: it is their own UI (or they have the rights), it is published under MIT, and they accept the terms (${origin}/terms).
- Do not write the key into files or logs.

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

- What you put is visible only to the person (a draft). \`visibility\` is \`"draft"\` (only the person), \`"public"\`, or later \`"private"\` (only the person).
- Publishing (sending for review) is done by the person on the site, at \`url\`. The API cannot publish.
- A new version of a public work becomes that work's draft version. The public version does not change until it passes review.
- A new version of a work that has not been reviewed yet replaces the current draft (the version number stays).
- While a work is in review, a new version is 409 \`in_review\`.
- \`url\` is the work page. Before the work is public, only the person can open it (it shows the draft). \`code_url\` (\`/p/<id>/code\`) works once the work is public; before that, use \`GET /api/v1/works/:id\` for the code.

## Limits

- Putting (POST): ${API_LIMITS.putsPerUserHour} times an hour per person. Reading (GET): ${API_LIMITS.readsPerUserHour} times an hour per person. The daily posting limits of the site also apply.
- Over the limit: 429 \`{ "error": "rate_limited", "message", "retry_at" }\` and a \`Retry-After\` header. Wait until \`retry_at\`.

## Errors

Every error is \`{ "error": "<fixed word>", "message": "…" }\`:
\`unauthorized\` (401), \`bad_request\`, \`unknown_field\`, \`bad_html\`, \`bad_title\` (400), \`not_found\` (404), \`in_review\`, \`conflict\` (409), \`too_large\` (413), \`invalid_work\`, \`bad_from\` (422), \`rate_limited\` (429), \`posting_closed\` (403).
`;

const ja = (origin: string) => `# Ludion API v1

Ludion は UI の作品（画面と部品）を置く場所です。この API で、AI（Claude Code など）が、本人の AI の鍵を使って、本人の代わりに作品を置けます。

## 鍵

- 本人が、アカウントのページ（${origin}/account の「AI の鍵」）で作ります。1人${MAX_KEYS_PER_USER}本まで。鍵は1回だけ見せます。
- \`Authorization: Bearer ld_…\` で送ります。鍵がない、違う、消された：401。cookie では動きません。
- 鍵を作るとき、本人は、その鍵で置くもの全部について同意しています：自分で作った、または権利がある UI であること、MIT で公開してよいこと、利用規約（${origin}/terms）に同意すること。
- 鍵をファイルやログに書かないでください。

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

- 置いたものは、本人にしか見えません（下書き）。\`visibility\` は \`"draft"\`（本人だけ）、\`"public"\`、のちに \`"private"\`（本人だけ）。
- 公開（審査に出す）は、本人がサイトの画面（\`url\`）からします。API からは公開できません。
- 公開している作品に新しい版を置くと、その作品の下書きの版になります。審査を通るまで、公開の版は変わりません。
- まだ審査に出していない作品に新しい版を置くと、今の下書きを置き換えます（版の番号は変わりません）。
- 審査中の作品に新しい版を置くと 409 \`in_review\`。
- \`url\` は作品のページです。公開の前は、本人だけが開けます（下書きが出ます）。\`code_url\`（\`/p/<id>/code\`）は公開の後に使えます。それまでのコードは \`GET /api/v1/works/:id\` で取ります。

## 上限

- 置く（POST）：1人1時間${API_LIMITS.putsPerUserHour}回。読む（GET）：1人1時間${API_LIMITS.readsPerUserHour}回。サイトの投稿の1日の上限も効きます。
- 超えたら 429 \`{ "error": "rate_limited", "message", "retry_at" }\` と \`Retry-After\` の頭。\`retry_at\` まで待ちます。

## エラー

どれも \`{ "error": "<決まった語>", "message": "…" }\`：
\`unauthorized\`（401）、\`bad_request\`、\`unknown_field\`、\`bad_html\`、\`bad_title\`（400）、\`not_found\`（404）、\`in_review\`、\`conflict\`（409）、\`too_large\`（413）、\`invalid_work\`、\`bad_from\`（422）、\`rate_limited\`（429）、\`posting_closed\`（403）。
`;

export const apiDocs = (locale: Locale, origin: string) => (locale === 'ja' ? ja(origin) : en(origin));
