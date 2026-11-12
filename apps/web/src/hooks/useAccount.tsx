import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchMe, goToLogin, postToggle, type AccountUser, type MeResponse, type ToggleKind } from '../lib/account';
import { trackEvent } from '../lib/analytics';

type Ids = ReadonlySet<string>;

type Account = {
  /** ログインしている本人。読み込みの前と、ログインしていないときは null */
  user: AccountUser | null;
  /** 作品を置く入口を出すか（worker/revisions.ts の canPost）。読み込みの前とログインしていないときは false */
  canPost: boolean;
  /** GET /api/me の答えが来たか（ログインしていない、の答えも含む）。読み込みの前と、失敗したときは false */
  ready: boolean;
  /** 自分の作品の数（左のナビ、WS001）。読み込みの前とログインしていないときは 0 */
  worksCount: number;
  isLiked: (id: string) => boolean;
  isBookmarked: (id: string) => boolean;
  /** HTML に入っているいいねの数に足す分（開いた後に押した分だけ） */
  likeDelta: (id: string) => number;
  toggleLike: (id: string) => void;
  toggleBookmark: (id: string) => void;
};

const AccountContext = createContext<Account | null>(null);

const NOTHING: Ids = new Set();

const flipped = (ids: Ids, id: string): Ids => {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
};

/**
 * 本人の情報。HTML は人によって変えないので、Worker の描画と最初の描画はログインしていない形で、
 * 読み込みの後に GET /api/me で足す（SPEC.md 10）。ホームを開いたときの API はこの1本だけ。
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [canPost, setCanPost] = useState(false);
  const [ready, setReady] = useState(false);
  const [worksCount, setWorksCount] = useState(0);
  const [marks, setMarks] = useState<Record<ToggleKind, Ids>>({ like: NOTHING, bookmark: NOTHING });
  const [likedAtLoad, setLikedAtLoad] = useState<Ids>(NOTHING);
  const me = useRef<Promise<MeResponse> | null>(null);
  /** 作品ごとの、いちばん新しい押下の番号。古い応答で状態を上書きしないため */
  const latest = useRef(new Map<string, number>());

  const loadMe = useCallback(() => {
    me.current ??= fetchMe()
      .then((body) => ({ body, answered: true }))
      .catch(() => ({ body: { user: null } as MeResponse, answered: false }))
      .then(({ body, answered }) => {
        // 本人と「答えが来た」を同じ描画で入れる。分けると、ログインしていない形が一度だけ挟まり、左のナビが閉じかける
        if (answered) setReady(true);
        if (body.user) {
          setUser(body.user);
          setCanPost(body.can_post);
          setWorksCount(body.works_count ?? 0);
          setMarks({ like: new Set(body.liked), bookmark: new Set(body.bookmarked) });
          setLikedAtLoad(new Set(body.liked));
        }
        return body;
      });
    return me.current;
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const toggle = useCallback(
    async (kind: ToggleKind, id: string) => {
      // 読み込みの前に押されたら、結果を待ってから決める
      if (!(await loadMe()).user) {
        goToLogin();
        return;
      }
      const flip = () => setMarks((current) => ({ ...current, [kind]: flipped(current[kind], id) }));
      const key = `${kind}:${id}`;
      const press = (latest.current.get(key) ?? 0) + 1;
      latest.current.set(key, press);

      // 先に見た目を変え、失敗したら戻す（SPEC.md 4）
      flip();
      try {
        const result = await postToggle(kind, id);
        if (result === 'unauthorized') {
          goToLogin();
          return;
        }
        // ほかのタブで押していると、押す前の見た目と違うことがある。最後の押下の答えに合わせる
        if (latest.current.get(key) === press) {
          setMarks((current) => (current[kind].has(id) === result ? current : { ...current, [kind]: flipped(current[kind], id) }));
        }
      } catch {
        flip();
      }
    },
    [loadMe],
  );

  const value = useMemo<Account>(
    () => ({
      user,
      canPost,
      ready,
      worksCount,
      isLiked: (id) => marks.like.has(id),
      isBookmarked: (id) => marks.bookmark.has(id),
      likeDelta: (id) => Number(marks.like.has(id)) - Number(likedAtLoad.has(id)),
      toggleLike: (id) => void toggle('like', id),
      toggleBookmark: (id) => {
        trackEvent('save_click', { work_id: id });
        void toggle('bookmark', id);
      },
    }),
    [user, canPost, ready, worksCount, marks, likedAtLoad, toggle],
  );

  return <AccountContext value={value}>{children}</AccountContext>;
}

export function useAccount(): Account {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside AccountProvider');
  return value;
}
