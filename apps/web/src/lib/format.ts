/** 数の書き方（SPEC.md 3）：952、1,240、1.2万、12万、1.2億。 */
export function formatCount(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  const man = Math.round(n / 1000) / 10;
  if (man < 10_000) return `${man}万`;
  return `${Math.round(n / 10_000_000) / 10}億`;
}

/** 英語の数の書き方：952、1.2k、12.4k、1.2M。 */
export function formatCountEn(n: number): string {
  if (n < 1000) return String(n);
  const thousands = Math.round(n / 100) / 10;
  if (thousands < 1000) return `${thousands}k`;
  return `${Math.round(n / 100_000) / 10}M`;
}

/** ファイルの大きさの書き方（作品のページ「この作品について」）：859 B、7.6 KB、234 KB、1.2 MB（1 KB は 1000 B）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const kb = bytes / 1000;
  if (kb < 100) return `${Math.round(kb * 10) / 10} KB`;
  if (kb < 1000) return `${Math.round(kb)} KB`;
  return `${Math.round(kb / 100) / 10} MB`;
}
