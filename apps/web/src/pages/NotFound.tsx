import { Link } from 'react-router';
import { useCopy } from '../hooks/useCopy';

/** ない作品、下書きや取り下げの作品、ない作者のページ（Worker は 404 で返す）。 */
export function NotFound() {
  const copy = useCopy();
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-body text-site-fg-2">{copy.notFound.message}</h1>
      <Link
        to="/"
        className="inline-flex h-11 items-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover"
      >
        {copy.notFound.back}
      </Link>
    </div>
  );
}
