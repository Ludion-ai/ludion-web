// コードがリミックスかどうか。オーナーの指定は「Remix by」で、実際の作品は「Remixed by」。
// どちらも、語の境目で、大文字小文字を問わず見つける。タグには入れない（絞り込みの語と混ぜない）。

const REMIX_BY = /\bremix(?:ed)?\s+by\b/i;

/** part.html、part.css、part.js のどれかにクレジットがあるか。 */
export function isRemixSource(...parts: string[]): boolean {
  return parts.some((part) => REMIX_BY.test(part));
}
