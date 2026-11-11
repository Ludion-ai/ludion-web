/** `GET /api/works` の1件の形（SPEC.md 7〜8）。人によって変わる情報は入れない。 */
export type Work = {
  id: string;
  title: string;
  type: 'screen' | 'component';
  platform: 'web' | 'mobile' | null;
  category: string;
  subtype: string;
  tags: string[];
  version: string;
  license: string;
  pin_order: number | null;
  thumb_w: number;
  thumb_h: number;
  published_at: number;
  views: number;
  likes: number;
  /** コピー数の合計（作品のページに出す） */
  copies: number;
  /** 直近30日のコピー数（Popular の順に使う） */
  copies_30d: number;
  /** コードに Remix by / Remixed by がある。一覧の帯に使う */
  remix: boolean;
  creator: {
    handle: string;
    name: string;
    kind: 'person' | 'label';
    avatar_url: string | null;
  };
};

let loading: Promise<Work[]> | null = null;

/**
 * ホーム以外のページからホームへ移ったときと、ヘッダーのスイッチの作品を選ぶとき（docs/tasks/T035.md「3」）に使う。
 * ホームを開いたときは呼ばない（SPEC.md 10）。1つのページで何度呼んでも、取りに行くのは1回だけ。失敗したら次は取り直す。
 */
export function fetchWorks(): Promise<Work[]> {
  if (loading) return loading;
  // 読み込み直しや移動で途中の取得が切られると、Safari は「access control checks」のエラーを出す。
  // 移る前に自分で止めて、そのエラーを出さない。取り終えたら見張りを外す
  const controller = new AbortController();
  const abort = () => controller.abort();
  // このファイルは Worker でも読む（window の型がない）
  const page = (globalThis as { window?: EventTarget }).window;
  page?.addEventListener('beforeunload', abort);
  loading = fetch('/api/works', { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`GET /api/works: ${response.status}`);
      return ((await response.json()) as { works: Work[] }).works;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    })
    .finally(() => page?.removeEventListener('beforeunload', abort));
  return loading;
}

/** パスに版が入るので、変わったら別の URL になる（SPEC.md 7）。 */
export function thumbUrl(work: Work): string {
  return `/w/${work.id}/${work.version}/thumb.webp`;
}
