// 「壁紙にする」（WALL001「2」）。全画面の住所、Plash の住所、端末に合わせた並び。

/** 共有する住所はいつも本番のもの（作品のページの共有と同じ）。壁紙のアプリは PC で開くので、手元の住所を渡しても使えない。 */
const SHARE_ORIGIN = 'https://ludion.ai';

/** 公式の配布のページ（11/11 に確かめた。Plash は sindresorhus.com/plash、Lively は GitHub の README の Microsoft Store のリンク） */
export const PLASH_STORE_URL = 'https://apps.apple.com/app/id1494023538';
export const LIVELY_STORE_URL = 'https://apps.microsoft.com/store/detail/9NTM2QC6QWS7';

/** 全画面の住所（worker/wall.ts）。 */
export const wallUrl = (id: string) => `${SHARE_ORIGIN}/p/${encodeURIComponent(id)}/wall`;

/** Plash に直接足す住所。Plash の説明のとおり、値はすべて URL の形に符号化する（plash:add?url=…&title=…）。 */
export const plashUrl = (id: string, title: string) => `plash:add?url=${encodeURIComponent(wallUrl(id))}&title=${encodeURIComponent(title)}`;

/**
 * Ludion の Windows アプリに壁紙を渡す住所（APP001「3」。apps/windows の Links.ParseProtocol が受ける形）。
 * アプリが入っていれば、ブラウザが「開きますか」と聞いた後、アプリが壁紙を切り替える。
 */
export const appUrl = (id: string) => `ludion://wall/${encodeURIComponent(id)}`;

/**
 * Windows アプリのダウンロード（worker/download.ts が、今の配り先へ送る）。
 * 段階 A は署名のない .exe。Store の Web インストーラーに替えるときも、この住所のまま。
 */
export const WINDOWS_DOWNLOAD_PATH = '/download/windows';

/** アプリが開いたことがある印（この人のブラウザの中だけ。送らない）。開いたことがあれば、入れ方の案内を自分からは出さない */
const APP_SEEN_KEY = 'ld-windows-app';

function appSeen(): boolean {
  try {
    return localStorage.getItem(APP_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberApp(): void {
  try {
    localStorage.setItem(APP_SEEN_KEY, '1');
  } catch {
    // 保存できないブラウザでは、毎回同じに動くだけ
  }
}

/** アプリが開いたかを待つ時間。ブラウザの「開きますか」が出ると、ページから注意が外れる（blur）。 */
export const APP_WAIT_MS = 1500;

/**
 * 「Windows アプリで設定」を押した後に呼ぶ（住所への移動はリンクそのものが行う）。
 * ブラウザの「開きますか」かアプリが前に出れば、ページの注意が外れる。外れなければ、アプリが入っていないとみなして onMissing。
 * 一度でも外れたことのあるブラウザでは、onMissing を呼ばない（「常に許可」にすると、聞かれずに開くため）。
 * 返す関数で待つのをやめる。
 */
export function watchAppLaunch(onMissing: () => void, wait = APP_WAIT_MS): () => void {
  let done = false;
  const opened = () => {
    if (done) return;
    done = true;
    rememberApp();
    stop();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') opened();
  };
  const timer = window.setTimeout(() => {
    if (done) return;
    done = true;
    stop();
    if (!appSeen()) onMissing();
  }, wait);
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener('blur', opened);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  window.addEventListener('blur', opened);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    done = true;
    stop();
  };
}

/** 「HTML を保存」のファイルの名前。 */
export const wallpaperFileName = (id: string) => `${id}.html`;

export type WallpaperDevice = 'mac' | 'windows' | 'other' | 'mobile';

interface DeviceHints {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/**
 * 開いている端末の種類。シートの並びを変えるだけに使い、送らず、保存しない（CLAUDE.md 原則6）。
 * iPad は Mac と同じ UA を名乗るので、触れる点の数で分ける。
 */
export function wallpaperDevice({ userAgent, platform, maxTouchPoints }: DeviceHints): WallpaperDevice {
  const text = `${platform} ${userAgent}`;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(text)) return 'mobile';
  if (/Mac/i.test(text)) return maxTouchPoints > 1 ? 'mobile' : 'mac';
  if (/Win/i.test(text)) return 'windows';
  return 'other';
}

export function currentWallpaperDevice(): WallpaperDevice {
  return wallpaperDevice({ userAgent: navigator.userAgent, platform: navigator.platform ?? '', maxTouchPoints: navigator.maxTouchPoints ?? 0 });
}

/** Windows の端末では Windows の方を先に。ほかは Mac が先。 */
export const wallpaperOrder = (device: WallpaperDevice): ('mac' | 'windows')[] => (device === 'windows' ? ['windows', 'mac'] : ['mac', 'windows']);

/**
 * 「HTML を保存」：コピーされるコードと同じ中身を、そのままファイルにする（クレジット行も残る）。
 * リンクは開いているシート（container）の中に置く。モーダルの外は inert なので。
 */
export function downloadWallpaperHtml(id: string, snippet: string, container: HTMLElement): void {
  const url = URL.createObjectURL(new Blob([snippet], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = wallpaperFileName(id);
  link.hidden = true;
  container.append(link);
  link.click();
  link.remove();
  // すぐ消すと、ブラウザによっては保存が始まる前に消える
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
