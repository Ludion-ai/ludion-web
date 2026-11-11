// R2 のファイルをブラウザに返す道（SPEC.md「7」、docs/tasks/T005.md「0」「1」）。
//
// - GET /w/<id>/<version>/thumb.webp：作品のサムネイル
// - GET /w/<id>/<version>/og.png：共有のときの画像（docs/tasks/T007.md「1」）
// - GET /w/<id>/<version>/wall-<幅>x<高さ>.png：壁紙の静止画（WALL002）。落とすファイルとして返す
// - GET /files/creators/<作者の id>/avatar-<ハッシュ>.webp：作者のアバター（D1 の avatar_url はこのキー）
//
// キャッシュの指示は cachePolicy.ts が付ける。R2 には作品のコードや下書きも置くので、任意のキーは返さない。返せるのはこの形だけ。

import { STILL_SIZES, stillDownloadName, stillFileName } from '@ludion/rules';
import { Hono, type Context } from 'hono';
import type { Env } from './env';
import { approvedPrefix, readableRevision, revisionFile } from './revisions';
import { getSessionUser } from './session';

const AVATAR_FILE = 'avatar-[0-9a-f]{12}\\.webp';

type FilesEnv = { Bindings: Env };

async function sendImage(c: Context<FilesEnv>, key: string, contentType: 'image/webp' | 'image/png'): Promise<Response> {
  const object = await c.env.PARTS.get(key);
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(object.size),
      ETag: object.httpEtag,
    },
  });
}

export const files = new Hono<FilesEnv>();

async function sendWorkImage(c: Context<FilesEnv>, name: 'thumb.webp' | 'og.png', contentType: 'image/webp' | 'image/png'): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const version = c.req.param('version') ?? '';
  // 下書きと取り下げた作品の画像は出さない（CLAUDE.md 原則5）。前の版の URL は、その版を取り下げるまで返す
  const prefix = await approvedPrefix(c.env.DB, id, version);
  if (!prefix) return c.json({ error: 'not_found' }, 404);
  return sendImage(c, revisionFile(prefix, name), contentType);
}

files.get('/w/:id/:version/thumb.webp', (c) => sendWorkImage(c, 'thumb.webp', 'image/webp'));
files.get('/w/:id/:version/og.png', (c) => sendWorkImage(c, 'og.png', 'image/png'));

/** 静止画の道の名前の形。STILL_SIZES の3つだけに当たる。 */
const STILL_FILE = STILL_SIZES.map((size) => stillFileName(size).replace('.', '\\.')).join('|');

// 壁紙の静止画。公開の版だけ。ブラウザが開かずに保存するよう、作品の id と大きさの名前を付ける。
// 1枚が数 MB なので、キャッシュはしない（og.png と同じ。cachePolicy.ts に書かない）
files.get(`/w/:id/:version/:file{${STILL_FILE}}`, async (c) => {
  const { id, version, file } = c.req.param();
  const size = STILL_SIZES.find((item) => stillFileName(item) === file);
  const prefix = size ? await approvedPrefix(c.env.DB, id, version) : null;
  const object = prefix ? await c.env.PARTS.get(revisionFile(prefix, file)) : null;
  if (!size || !object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${stillDownloadName(id, size)}"`,
      ETag: object.httpEtag,
    },
  });
});

// 公開前の版のサムネイル。持ち主と運営だけ。キャッシュしない（cachePolicy.ts に書かない）
files.get('/draft-thumb/:file{[0-9a-f]{32}\\.webp}', async (c) => {
  const revision = await readableRevision(c.env.DB, c.req.param('file').slice(0, 32), await getSessionUser(c));
  if (!revision) return c.json({ error: 'not_found' }, 404);
  return sendImage(c, revisionFile(revision.r2_prefix, 'thumb.webp'), 'image/webp');
});

files.get(`/files/creators/:creator/:file{${AVATAR_FILE}}`, (c) => {
  const { creator, file } = c.req.param();
  return sendImage(c, `creators/${creator}/${file}`, 'image/webp');
});
