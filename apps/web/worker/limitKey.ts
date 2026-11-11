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

/**
 * 束縛に渡す鍵。秘密の値と日付（UTC の日）で作った HMAC-SHA-256 の16進。
 * 束縛が鍵をどう扱うかは文書に書かれていないので、生の IP を渡さない（CLAUDE.md 原則6、docs/reports/T022.md）。
 * 日付を入れるので、同じ人の鍵を日をまたいで結びつけられない。
 */
export async function limitKey(ip: string, secret: string, now: Date = new Date()): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const day = now.toISOString().slice(0, 10);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}|${limitSubject(ip)}`));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
