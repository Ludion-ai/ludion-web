// 回数の制限の鍵（rateLimit.ts）。Worker の型に頼らない。e2e/cache.spec.ts がそのまま読むため。

const IPV6_PREFIX_GROUPS = 4;

/** 数える相手。IPv6 は /64 までを1人と見なす。1人に /64 が丸ごと割り当たるので、下の桁を変えるだけで別の相手にならないように。 */
export function limitSubject(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const before = head.split(':').filter(Boolean);
  const after = tail.split(':').filter(Boolean);
  const full = [...before, ...Array<string>(Math.max(0, 8 - before.length - after.length)).fill('0'), ...after];
  return `${full.slice(0, IPV6_PREFIX_GROUPS).join(':')}::/64`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const utcDayOf = (now: Date) => now.toISOString().slice(0, 10);

/**
 * 束縛に渡す鍵。秘密の値と日付（UTC の日）で作った HMAC-SHA-256 の16進。
 * 束縛が鍵をどう扱うかは文書に書かれていないので、生の IP を渡さない（CLAUDE.md 原則6、docs/reports/T022.md）。
 * 日付を入れるので、同じ人の鍵を日をまたいで結びつけられない。
 */
export async function limitKey(ip: string, secret: string, now: Date = new Date()): Promise<string> {
  return hmacHex(secret, `${utcDayOf(now)}|${limitSubject(ip)}`);
}

/**
 * 閲覧数とコピー数を、相手ごと・作品ごと・種類ごと・日ごとに1回だけ数えるための鍵（worker/count.ts。LIMIT001）。
 * 作品と種類も HMAC の中に入れるので、残る印からは、同じ相手がほかに何を見たかを結びつけられない。生の IP も作品の id も残らない。
 */
export async function countKey(ip: string, secret: string, workId: string, type: string, now: Date = new Date()): Promise<string> {
  return hmacHex(secret, `${utcDayOf(now)}|${limitSubject(ip)}|count|${type}|${workId}`);
}
