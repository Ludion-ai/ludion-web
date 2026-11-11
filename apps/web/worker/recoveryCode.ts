// 回復のコード（docs/tasks/T020.md「7」、SEC001 B2-4）。Worker の束縛に頼らない。e2e がそのまま読むため。
// 130ビットの乱数を、読み間違えにくい文字（Crockford の Base32）で5文字ごとに区切って見せる。サーバーにはハッシュだけを置く。
// 乱数の幅が十分に大きいので、ハッシュは SHA-256 でよい（遅いハッシュは、推測できる値のためのもの）。

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 26;
const BITS_PER_CHAR = 5;
const GROUP = 5;

/** 新しい回復のコード。例：7K2QF-… の形。 */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil((CODE_LENGTH * BITS_PER_CHAR) / 8)));
  let bits = 0;
  let buffer = 0;
  let code = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= BITS_PER_CHAR && code.length < CODE_LENGTH) {
      code += ALPHABET[(buffer >> (bits - BITS_PER_CHAR)) & 31];
      bits -= BITS_PER_CHAR;
    }
    buffer &= (1 << bits) - 1;
  }
  return code.match(new RegExp(`.{1,${GROUP}}`, 'g'))!.join('-');
}

/** 打たれたコードを揃える。小文字、区切り、空白を許し、見間違えやすい文字（O、I、L）を直す。 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeRecoveryCode(code)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
