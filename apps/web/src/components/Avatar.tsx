/** 人のアバター。手段から来た画像がなければ、handle の頭文字の円を出す（パスキーだけの人など）。 */
export function Avatar({ url, handle, size }: { url: string | null; handle: string; size: 36 | 64 }) {
  const shape = size === 36 ? 'size-9' : 'size-16';
  if (url) {
    return <img src={url} alt="" width={size} height={size} decoding="async" referrerPolicy="no-referrer" className={`${shape} shrink-0 rounded-chip bg-site-field`} />;
  }
  return (
    <span aria-hidden="true" className={`${shape} flex shrink-0 items-center justify-center rounded-chip bg-site-primary font-semibold text-site-bg ${size === 36 ? 'text-body' : 'text-title'}`}>
      {handle.slice(0, 1).toUpperCase()}
    </span>
  );
}
