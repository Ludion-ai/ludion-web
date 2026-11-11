// FIX-login の本番の確かめ（docs/tasks/FIX-login.md）。node scripts/verify-fix-login.mjs
// 本物の Google と GitHub の画面まで開くが、ログインはしない。戻るときは本物の state と作った code を使う。
// 相手が code を断るので、人もセッションもできない。login_failed になれば、cookie が届いて state が合ったということ。
// GA4 は止める。作品のページは開かない（閲覧数を増やさない）。cookie の値、state、code は出力しない。
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';

const PROD = 'https://ludion.ai';
const NEXT = '/about';
const SCREENS = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screens');
const X_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/11.0';
const RETRY_TEXT = 'ログインをやり直してください';
const IN_APP_TEXT = 'アプリの中のブラウザでは Google でログインできないことがあります。Safari（または いつものブラウザ）で開いてください';
const PROVIDERS = [
  { name: 'google', host: /^https:\/\/accounts\.google\.com\//, authorize: /^https:\/\/accounts\.google\.com\/o\/oauth2\//, cookie: 'ld_google_flow_' },
  { name: 'github', host: /^https:\/\/github\.com\//, authorize: /^https:\/\/github\.com\/login\/oauth\/authorize/, cookie: 'ld_github_flow_' },
];

mkdirSync(SCREENS, { recursive: true });
const missed = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '満たした' : '未達'} ${name}${detail ? `：${detail}` : ''}`);
  if (!ok) missed.push(name);
};

const blocked = { ga4: 0 };
async function newContext(browser, options = {}) {
  const context = await browser.newContext({ locale: 'ja-JP', ...options });
  await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => {
    blocked.ga4 += 1;
    return route.abort();
  });
  return context;
}

/** ログインの画面からボタンで相手の画面まで進む。相手へ行く要求の URL から state を読む。 */
async function startFlow(page, provider, press = (link) => link.click()) {
  const states = [];
  const listen = (request) => {
    if (provider.authorize.test(request.url())) states.push(new URL(request.url()).searchParams.get('state'));
  };
  page.on('request', listen);
  await page.goto(`${PROD}/login?next=${encodeURIComponent(NEXT)}`);
  await press(page.locator(`a[href^="/auth/${provider.name}"]`));
  await page.waitForURL(provider.host, { timeout: 30_000 });
  await page.waitForLoadState('domcontentloaded');
  page.off('request', listen);
  return states.at(-1);
}

const backUrl = (provider, state, code = 'made-up-code-for-fix-login') => {
  const url = new URL(`${PROD}/auth/${provider.name}/callback`);
  if (state) url.searchParams.set('state', state);
  if (code) url.searchParams.set('code', code);
  return url.href;
};

/** 相手の画面（別のサイト）から、ページの中の移動で戻る。本物と同じく、別のサイトからの一番上の GET になる。 */
async function comeBack(page, href) {
  await page.evaluate((target) => {
    window.location.href = target;
  }, href);
  await page.waitForURL(/^https:\/\/ludion\.ai\/(en\/)?login/, { timeout: 30_000 });
  await page.waitForLoadState('load');
  const url = new URL(page.url());
  return { path: url.pathname, next: url.searchParams.get('next'), error: url.searchParams.get('error'), body: await page.locator('body').innerText() };
}

/** 同じサイトのページから開く（ログインの画面にいるときは、上の待ち方では前の URL を読んでしまう）。 */
async function openDirect(page, href) {
  await page.goto(href);
  await page.waitForLoadState('load');
  const url = new URL(page.url());
  return { path: url.pathname, next: url.searchParams.get('next'), error: url.searchParams.get('error'), body: await page.locator('body').innerText() };
}

const flowNames = async (context, provider) => (await context.cookies()).filter((cookie) => cookie.name.startsWith(provider.cookie));
const noJson = (seen) => !seen.body.trimStart().startsWith('{') && !seen.body.includes('bad_state');

for (const [browserName, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch();
  for (const provider of PROVIDERS) {
    const label = `${browserName} ${provider.name}`;

    // ふつう
    {
      const context = await newContext(browser);
      const page = await context.newPage();
      const state = await startFlow(page, provider);
      const cookies = await flowNames(context, provider);
      check(`${label} 途中の cookie が1つ保存される`, cookies.length === 1 && cookies[0].secure && cookies[0].httpOnly && cookies[0].path === `/auth/${provider.name}`, `${cookies.length} 個`);
      check(`${label} state は256ビット`, /^[0-9a-f]{64}$/.test(state ?? ''));
      const seen = await comeBack(page, backUrl(provider, state));
      check(`${label} ふつう：cookie が届き state が合う（作った code なので login_failed）`, seen.error === 'login_failed' && seen.next === NEXT && noJson(seen), `error=${seen.error}、next=${seen.next}`);
      check(`${label} ふつう：使った cookie は消える。セッションはできない`, (await flowNames(context, provider)).length === 0 && !(await context.cookies()).some((cookie) => cookie.name === 'ld_session'));
      await context.close();
    }

    // 2回押しと2つのタブ：どちらの state も通る
    {
      const context = await newContext(browser);
      const [first, second] = [await context.newPage(), await context.newPage()];
      const stateA = await startFlow(first, provider);
      const stateB = await startFlow(second, provider);
      check(`${label} 2つのタブ：cookie が2つ。state は別`, (await flowNames(context, provider)).length === 2 && stateA !== stateB);
      const a = await comeBack(first, backUrl(provider, stateA));
      check(`${label} 2つのタブ：前のタブの state が通る`, a.error === 'login_failed' && noJson(a), `error=${a.error}`);
      const b = await comeBack(second, backUrl(provider, stateB));
      check(`${label} 2つのタブ：後のタブの state も通る`, b.error === 'login_failed' && noJson(b), `error=${b.error}`);
      await context.close();
    }
    {
      const context = await newContext(browser);
      const page = await context.newPage();
      const state = await startFlow(page, provider, (link) => link.dblclick());
      const seen = await comeBack(page, backUrl(provider, state));
      check(`${label} 2回押し：ダブルクリックしても、戻った state が通る`, seen.error === 'login_failed' && noJson(seen), `error=${seen.error}`);
      await context.close();
    }

    // CSRF の守り
    {
      const context = await newContext(browser);
      const page = await context.newPage();
      const state = await startFlow(page, provider);
      const wrong = await comeBack(page, backUrl(provider, 'f'.repeat(64)));
      check(`${label} 他人の state では通らない：文が出る`, wrong.error === 'login_retry' && wrong.body.includes(RETRY_TEXT) && noJson(wrong), `error=${wrong.error}`);
      const none = await openDirect(page, backUrl(provider, null));
      check(`${label} state なしでは通らない：文が出る`, none.error === 'login_retry' && noJson(none), `error=${none.error}`);
      check(`${label} どちらでも途中の状態は残り、セッションはできない`, (await flowNames(context, provider)).length === 1 && !(await context.cookies()).some((cookie) => cookie.name === 'ld_session'));

      // アプリの中で始めて、別のブラウザで戻る（CEO が見た形）
      const outside = await newContext(browser);
      const other = await outside.newPage();
      const response = await other.goto(backUrl(provider, state));
      await other.waitForLoadState('load');
      const final = new URL(other.url());
      const body = await other.locator('body').innerText();
      check(`${label} 別のブラウザで戻る：黒い画面にならず、開き直しの文が出る`, final.pathname === '/login' && final.searchParams.get('error') === 'login_open_browser' && body.includes(IN_APP_TEXT) && !body.includes('bad_state'), `${response.status()}、error=${final.searchParams.get('error')}、next=${final.searchParams.get('next')}`);
      check(`${label} 別のブラウザで戻る：cookie なしではログインにならない`, !(await outside.cookies()).some((cookie) => cookie.name === 'ld_session'));
      await outside.close();

      // 残した状態を片付ける（作った code なので、人はできない）
      const left = await openDirect(page, backUrl(provider, state));
      check(`${label} 始めたブラウザの状態は残っていて、そこから通る`, left.error === 'login_failed', `error=${left.error}`);
      await context.close();
    }
  }

  // アプリの中のブラウザ
  {
    const context = await newContext(browser, { userAgent: X_IPHONE, viewport: { width: 390, height: 664 } });
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    await page.goto(`${PROD}/login?next=${encodeURIComponent(NEXT)}`);
    const notice = page.locator('[data-in-app-notice]');
    await notice.waitFor();
    const text = await notice.innerText();
    const noticeBox = await notice.boundingBox();
    const googleBox = await page.getByRole('link', { name: 'Google でログイン' }).boundingBox();
    check(`${browserName} X の UA：知らせと「右上の …」の一言が、Google のボタンより上に出る`, text.includes(IN_APP_TEXT) && text.includes('右上の …') && noticeBox.y + noticeBox.height <= googleBox.y);
    if (browserName === 'chromium') {
      await notice.getByRole('button', { name: 'リンクをコピー' }).click();
      await notice.getByRole('button', { name: 'コピーしました' }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      check(`${browserName} X の UA：リンクをコピーできる。戻り先が残る`, copied === `${PROD}/login?next=${encodeURIComponent(NEXT)}`, copied);
      await page.screenshot({ path: join(SCREENS, 'fix-login-prod-in-app-390.png') });
    }
    await context.close();

    const plain = await newContext(browser, { viewport: { width: 1440, height: 900 } });
    const plainPage = await plain.newPage();
    await plainPage.goto(`${PROD}/login?next=${encodeURIComponent(NEXT)}`);
    await plainPage.getByRole('link', { name: 'Google でログイン' }).waitFor();
    check(`${browserName} ふつうの UA：知らせは出ない`, (await plainPage.locator('[data-in-app-notice]').count()) === 0);
    await plain.close();
  }

  if (browserName === 'chromium') {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const context = await newContext(browser, { viewport: { width, height } });
      const page = await context.newPage();
      await page.goto(`${PROD}/login?next=${encodeURIComponent(NEXT)}&error=login_retry`);
      await page.getByText(RETRY_TEXT).waitFor();
      await page.screenshot({ path: join(SCREENS, `fix-login-prod-retry-${width}.png`) });
      await context.close();
    }
  }
  await browser.close();
}

console.log(`\nGA4 を止めた回数 ${blocked.ga4}`);
console.log(missed.length ? `\n未達 ${missed.length} 件` : '\n全部満たした');
process.exitCode = missed.length ? 1 : 0;
