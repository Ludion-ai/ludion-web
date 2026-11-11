import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Outlet, Route, Routes, useLocation } from 'react-router';
import { BottomTabs } from './components/BottomTabs';
import { NoscriptSiteInfo } from './components/NoscriptSiteInfo';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { AccountProvider } from './hooks/useAccount';
import { usePageData } from './hooks/usePageData';
import { trackLocationChange } from './lib/analytics';
import { CreatorPage } from './pages/CreatorPage';
import { Home } from './pages/Home';
import { AccountDeletePage, AccountPage } from './pages/AccountPage';
import { AboutPage, PrivacyPage, TermsPage } from './pages/InfoPages';
import { LoginPage, SignupPage } from './pages/LoginPage';
import { NotFound } from './pages/NotFound';
import { LikedPage, SavedPage } from './pages/SavedPage';
import { WorkPage } from './pages/WorkPage';

// 作り手の画面は、ホームの JS に足さない
const PostPage = lazy(() => import('./pages/PostPage').then((module) => ({ default: module.PostPage })));
const MyWorksPage = lazy(() => import('./pages/MyWorksPage').then((module) => ({ default: module.MyWorksPage })));
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((module) => ({ default: module.ReviewPage })));

const Later = ({ children }: { children: ReactNode }) => <Suspense fallback={null}>{children}</Suspense>;

/** Worker が 404 と決めたページ（全員に開く前の /new、運営でない人の審査）。画面も出さず、道があることを見せない。 */
function UnlessNotFound({ children }: { children: ReactNode }) {
  return usePageData()?.kind === 'not-found' ? <NotFound /> : <Later>{children}</Later>;
}

function Shell() {
  const location = useLocation();
  useEffect(() => trackLocationChange(), [location]);

  return (
    <AccountProvider>
      <Header />
      <div className="flex lg:min-h-[calc(100dvh-var(--spacing-header))]">
        <Sidebar />
        <main className="min-w-0 flex-1 px-6 pt-2 pb-24 md:pt-[13px] lg:pb-10">
          <Outlet />
        </main>
      </div>
      <NoscriptSiteInfo />
      <BottomTabs />
    </AccountProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="p/:id" element={<WorkPage />} />
        <Route path="c/:handle" element={<CreatorPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/saved" element={<SavedPage />} />
        <Route path="account/likes" element={<LikedPage />} />
        <Route path="account/works" element={<Later><MyWorksPage /></Later>} />
        <Route path="new" element={<UnlessNotFound><PostPage /></UnlessNotFound>} />
        <Route path="admin/review" element={<UnlessNotFound><ReviewPage /></UnlessNotFound>} />
        <Route path="account/delete" element={<AccountDeletePage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
