// GET /api/v1 の説明（docs/tasks/T037.md「4」）。AI が読んで使えるように、Markdown で返す。中身は docs/tasks/T037.md「2」の表と同じ。

import { MAX_PART_READ_BYTES, TECH_LIST } from '@ludion/outline';
import { MAX_DOCUMENT_BYTES, MAX_PART_BYTES } from '@ludion/rules';
import type { Locale } from '../src/i18n';
import { MAX_KEYS_PER_USER } from './aiKeys';
import { API_LIMITS, POST_LIMITS, PRIVATE_LIMITS } from './quotaLimits';
import { PRIVATE_WORKS_LIMIT } from './revisions';

const KB = MAX_PART_BYTES / 1024;
const DOC_KB = MAX_DOCUMENT_BYTES / 1024;
const READ_KB = MAX_PART_READ_BYTES / 1024;
const TECH_NAMES = TECH_LIST.map((tech) => `\`${tech.id}\``).join(', ');

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
| \`GET /api/v1/works\` | — | 200 \`{ "works": [{ "id", "title", "visibility", "status", "version", "updated_at", "url" }] }\` (your works only). \`?tech=webgl2\` lists only the works that use that tech; \`?with=tech\` adds \`"tech"\` to each work |
| \`GET /api/v1/works/:id\` | — | 200 \`{ "id", "title", "visibility", "status", "version", "from", "url", "code" }\` (your works only; other people's works are 404). The whole code |
| \`GET /api/v1/works/:id/outline\` | — | 200 \`{ "id", "title", "creator", "own", "visibility", "status", "version", "from", "url", "bytes", "max_read_bytes", "outline" }\`. The map of the work, without the code |
| \`GET /api/v1/works/:id/code?section=…\` or \`?file=…&lines=…\` | — | 200 \`{ "id", "version", "file", "section", "start", "end", "total_lines", "bytes", "credit", "code" }\`. One part of the code |

## Reading: the map first, then the part you need

Do not read a large work whole when a part is enough. Two requests:

1. **The map**: \`GET /api/v1/works/:id/outline\`. \`outline\` has \`files\` (name, bytes, lines), \`languages\`, \`tech\` (what the work uses, and the lines where it was found) and \`sections\` (\`kind\`, \`name\`, \`file\`, \`start\`, \`end\`; kinds: \`shader\`, \`settings\`, \`heading\`, \`function\`, \`style\`, \`script\`, \`asset\`). Lines count from 1 and \`end\` is included.
2. **The part**: \`GET /api/v1/works/:id/code\` with either \`section=<kind>:<name>\` (for example \`section=shader:WINDOW_FRAG\`, \`section=function:render\`) or \`file=part.js&lines=200-760\`. \`file\` alone reads that whole file. \`code\` is the stored text of lines \`start\`…\`end\`, unchanged; line numbers are the same as in the map. \`credit\` is the credit line(s) to keep with the code.

- One read can be up to ${READ_KB}KB. A larger part is 413 \`part_too_large\` with \`inside\` (the sections in it); read those, or a smaller line range.
- When two sections share a kind and a name, add the first line: \`section=function:step@2950\`. An ambiguous name is 400 \`ambiguous_section\` with \`candidates\`; a missing one is 404 \`section_not_found\`.
- \`version=<version from the map>\` (optional) refuses the read with 409 \`version_changed\` if the work has changed since.
- These two endpoints read your own works (the latest version) and any public work (its public version). **For a public work they need no key.** Other people's works that are not public are 404.
- \`outline?code=1\` also returns the whole code as \`code\` (the same text as \`GET /api/v1/works/:id\`); \`code=auto\` only when the work is small.
- Tech names for \`?tech=\` (separate with commas for works that use all of them): ${TECH_NAMES}. Also \`webgl\` (WebGL or WebGL2), \`canvas\`, \`audio\`.
- On the site, without a key: \`${origin}/p/<id>.json\` (the same map) and \`${origin}/p/<id>/raw/<file>\` (one file as plain text). A raw file starts with the credit line(s), so its line numbers are shifted from the map's; read by line with \`/api/v1/works/:id/code\`.

## The html

**You can send one ordinary HTML document as it is.** If \`html\` starts with \`<!doctype html>\` or \`<html>\`, Ludion keeps the document exactly as written and runs it as it is, as a screen (full width).
- One self-contained file: put images, sounds and fonts inside it (inline \`<svg>\`, \`data:\` URLs, CSS drawing, Web Audio). Requests to outside are blocked in the frame (only Google Fonts load), so things loaded from a CDN will not work.
- Up to ${DOC_KB}KB. Ludion does not check its form: it needs no \`data-ld-part\` and no \`mount\`.
- It runs in a sandboxed frame: no page navigation, no new windows, no form submission to anywhere, no access to the page around it. \`localStorage\` and \`sessionStorage\` are in memory only (they work, but are cleared when the page reloads).
- The \`<title>\` becomes the title. No real company logos, trademarks or product names.

### Optional: the component form

Use this only when you want the work to be a component that can be pasted into other pages and take the person's design tokens.
- One HTML fragment, the same as pasting into ${origin}/new: one root element with \`data-ld-part\`, then one \`<style>\`, then (if it moves) one \`<script type="module">\` with \`function mount(root) { …; return () => { /* clean up */ }; }\` and a last line \`mount(document.querySelector('[data-ld-part="…"]'));\`. A document whose \`<body>\` holds exactly this (the root with \`data-ld-part\`, and \`mount\` if it moves) is also taken in this form and unwrapped.
- All CSS selectors go under \`[data-ld-part="…"]\`. JS touches only \`root\`. No external requests (only Google Fonts may be loaded). No page navigation (\`location\`, \`window.open\`, \`top\`, \`parent\`). Links use \`href="#"\`.
- Inside the frame, \`localStorage\` and \`sessionStorage\` are in memory only: they work, but are cleared when the page reloads.
- HTML, CSS and JS can each be up to ${KB}KB.

### Both forms

- If something must be fixed, the response is 422 \`{ "error": "invalid_work", "message", "problems": [{ "message", "fix" }] }\`. Fix each problem as \`fix\` says and send again.
- No title: the HTML \`<title>\` is used; without one, "Untitled". No thumbnail is needed.
- The credit line (\`<!-- UI by @… -->\`) is added by Ludion (in a document, right after \`<!doctype html>\`). Keep it when you edit code you got from Ludion; it is removed and made again when you put.
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
Reading: \`bad_part\`, \`file_required\`, \`ambiguous_section\`, \`out_of_range\`, \`bad_tech\` (400), \`file_not_found\`, \`section_not_found\` (404), \`version_changed\` (409), \`part_too_large\` (413).
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
| \`GET /api/v1/works\` | — | 200 \`{ "works": [{ "id", "title", "visibility", "status", "version", "updated_at", "url" }] }\`（自分の作品だけ）。\`?tech=webgl2\` で、その技術を使う作品だけ。\`?with=tech\` で、それぞれに \`"tech"\` を足す |
| \`GET /api/v1/works/:id\` | — | 200 \`{ "id", "title", "visibility", "status", "version", "from", "url", "code" }\`（自分の作品だけ。ほかの人のは 404）。コードの全部 |
| \`GET /api/v1/works/:id/outline\` | — | 200 \`{ "id", "title", "creator", "own", "visibility", "status", "version", "from", "url", "bytes", "max_read_bytes", "outline" }\`。作品の地図。コードは入らない |
| \`GET /api/v1/works/:id/code?section=…\` か \`?file=…&lines=…\` | — | 200 \`{ "id", "version", "file", "section", "start", "end", "total_lines", "bytes", "credit", "code" }\`。コードの一部 |

## 読み方：まず地図、次に要る部分

大きい作品を、要るのが一部のときに全部読まないでください。2回で済みます。

1. **地図**：\`GET /api/v1/works/:id/outline\`。\`outline\` に、\`files\`（名前、バイト数、行の数）、\`languages\`、\`tech\`（使っている技術と、見つけた行）、\`sections\`（\`kind\`、\`name\`、\`file\`、\`start\`、\`end\`。種類は \`shader\`、\`settings\`、\`heading\`、\`function\`、\`style\`、\`script\`、\`asset\`）。行は 1 から数え、\`end\` を含みます。
2. **要る部分**：\`GET /api/v1/works/:id/code\` に、\`section=<種類>:<名前>\`（例：\`section=shader:WINDOW_FRAG\`、\`section=function:render\`）か、\`file=part.js&lines=200-760\` のどちらか。\`file\` だけなら、そのファイルの全部。\`code\` は、置いてあるファイルの \`start\` 行から \`end\` 行の文字そのままで、行の番号は地図と同じです。\`credit\` は、コードと一緒に残すクレジット行です。

- 1回に読めるのは ${READ_KB}KB まで。超える部分は 413 \`part_too_large\` と \`inside\`（その中の分け目）。それを1つずつ読むか、行の範囲を狭めます。
- 種類も名前も同じ分け目が2つ以上あるときは、始まりの行を付けます：\`section=function:step@2950\`。決まらない名前は 400 \`ambiguous_section\` と \`candidates\`、ない名前は 404 \`section_not_found\`。
- \`version=<地図の version>\`（任意）を付けると、その後に作品が変わっていたら 409 \`version_changed\` で断ります。
- この2つの口で読めるのは、自分の作品（いちばん新しい版）と、公開されている作品（公開の版）です。**公開の作品は、鍵なしで読めます。** 公開されていないほかの人の作品は 404。
- \`outline?code=1\` で、コードの全部も \`code\` に入ります（\`GET /api/v1/works/:id\` と同じ文字）。\`code=auto\` は、小さい作品のときだけ入れます。
- \`?tech=\` の技術の名前（, で区切ると、全部を使う作品）：${TECH_NAMES}。ほかに \`webgl\`（WebGL か WebGL2）、\`canvas\`、\`audio\`。
- サイトの側（鍵なし）：\`${origin}/p/<id>.json\`（同じ地図）、\`${origin}/p/<id>/raw/<file>\`（1つのファイルの生の文字）。生の文字は頭にクレジット行が入るので、行の番号が地図とずれます。行で読むときは \`/api/v1/works/:id/code\` を使います。

## html

**ふつうの HTML 文書を1つ、そのまま送ってかまいません。** \`html\` が \`<!doctype html>\` か \`<html>\` で始まるなら、Ludion は文書を書いたとおりに置き、そのまま動かします。種類は画面（幅いっぱい）です。
- 1つのファイルで完結させます。画像、音、書体はファイルの中に入れます（\`<svg>\`、\`data:\` の URL、CSS で描く、Web Audio）。枠の中では外への通信が止まる（Google Fonts だけは読めます）ので、CDN から読むものは動きません。
- ${DOC_KB}KB まで。形の検査はしません。\`data-ld-part\` も \`mount\` も要りません。
- sandbox の枠の中で動きます。ページを移れません。新しい窓を開けません。フォームの送信は届きません。まわりのページには触れません。\`localStorage\` と \`sessionStorage\` はメモリだけです（使えますが、読み直すと消えます）。
- \`<title>\` が題になります。実在の会社のロゴ、商標、製品名は入れません。

### 任意：部品の形

ほかのページに貼れて、使う人のトークンを受ける部品にしたいときだけ使います。
- 1つの HTML の断片。${origin}/new に貼るのと同じです：\`data-ld-part\` を付けた一番外の要素1つ、\`<style>\` 1つ、動きがあれば \`<script type="module">\` 1つ（\`function mount(root) { …; return () => { /* 片付け */ }; }\` と、最後の行の \`mount(document.querySelector('[data-ld-part="…"]'));\`）。\`<body>\` の中がちょうどこの形（\`data-ld-part\` の根と、動きがあれば \`mount\`）の文書も、この形として受け、包みを外します。
- CSS のセレクタは、すべて \`[data-ld-part="…"]\` の下に置きます。JS は \`root\` の中だけを触ります。外へ通信しません（Google Fonts だけは読めます）。ページを移りません（\`location\`、\`window.open\`、\`top\`、\`parent\`）。リンクは \`href="#"\`。
- 枠の中の \`localStorage\` と \`sessionStorage\` はメモリだけです。使えますが、読み直すと消えます。
- HTML、CSS、JS は、それぞれ ${KB}KB までです。

### どちらの形でも

- 直すところがあれば 422 \`{ "error": "invalid_work", "message", "problems": [{ "message", "fix" }] }\`。\`fix\` のとおりに直して、もう一度送ります。
- 題がなければ、HTML の \`<title>\`、なければ「無題」。サムネイルは要りません。
- クレジット行（\`<!-- UI by @… -->\`）は Ludion が入れます（文書では \`<!doctype html>\` の直後）。Ludion から取ったコードを直すときは消さずに残してください。置くときに外して、作り直します。
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
読むとき：\`bad_part\`、\`file_required\`、\`ambiguous_section\`、\`out_of_range\`、\`bad_tech\`（400）、\`file_not_found\`、\`section_not_found\`（404）、\`version_changed\`（409）、\`part_too_large\`（413）。
`;

export const apiDocs = (locale: Locale, origin: string) => (locale === 'ja' ? ja(origin) : en(origin));
