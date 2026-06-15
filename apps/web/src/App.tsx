import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { AuthProvider, SyncQueueProvider, ThemeProvider, useAuth } from '@/context';
import { usePageLifecycle, useTimezoneAutoDetect } from '@/hooks';
import { PWAProvider } from '@/context/pwa-context';
import { AndroidInstallBanner, IOSInstallBanner, UpdateBanner } from '@/components/pwa-banners';
import { XiaomiBatteryGuide } from '@/components/XiaomiBatteryGuide';
import { DevBar } from '@/components/DevBar';
import { Chat } from '@/components/Chat';
import { ProtectedLayout } from '@/components/routing/ProtectedLayout';
import { FullPageSpinner } from '@/components/routing/FullPageSpinner';
import { config } from '@/config';


(function handleShareTargetRedirect(): void {
  if (window.location.hash !== '') return;
  const params = new URLSearchParams(window.location.search);
  if (params.has('title') || params.has('text') || params.has('url')) {
    window.location.replace(`${window.location.origin}/#/share-target${window.location.search}`);
  }
})();

const ApiKeysSettingsPage = React.lazy(() =>
  import('@/pages/ApiKeysSettingsPage').then((m) => ({ default: m.ApiKeysSettingsPage })),
);
const AskAgentPage = React.lazy(() =>
  import('@/pages/AskAgentPage').then((m) => ({ default: m.AskAgentPage })),
);
const BookmarksListPage = React.lazy(() =>
  import('@/pages/BookmarksListPage').then((m) => ({ default: m.BookmarksListPage })),
);
const CalendarPage = React.lazy(() =>
  import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })),
);
const CodeTaskViewPage = React.lazy(() =>
  import('@/pages/CodeTaskViewPage').then((m) => ({ default: m.CodeTaskViewPage })),
);
const CodeTaskNewPage = React.lazy(() =>
  import('@/pages/CodeTaskNewPage').then((m) => ({ default: m.CodeTaskNewPage })),
);
const CodeTasksPage = React.lazy(() =>
  import('@/pages/CodeTasksPage').then((m) => ({ default: m.CodeTasksPage })),
);
const CronExecutionsPage = React.lazy(() =>
  import('@/pages/cron-agent/CronExecutionsPage').then((m) => ({ default: m.CronExecutionsPage })),
);
const CronScheduleNewPage = React.lazy(() =>
  import('@/pages/cron-agent/CronScheduleNewPage').then((m) => ({
    default: m.CronScheduleNewPage,
  })),
);
const CronSchedulesPage = React.lazy(() =>
  import('@/pages/cron-agent/CronSchedulesPage').then((m) => ({ default: m.CronSchedulesPage })),
);
const CronScheduleViewPage = React.lazy(() =>
  import('@/pages/cron-agent/CronScheduleViewPage').then((m) => ({
    default: m.CronScheduleViewPage,
  })),
);
const DispatchQueuePage = React.lazy(() =>
  import('@/pages/DispatchQueuePage').then((m) => ({ default: m.DispatchQueuePage })),
);
const FishingChatPage = React.lazy(() =>
  import('@/pages/fishing/FishingChatPage').then((m) => ({ default: m.FishingChatPage })),
);
const FishingDigestsPage = React.lazy(() =>
  import('@/pages/fishing/FishingDigestsPage').then((m) => ({ default: m.FishingDigestsPage })),
);
const FishingDigestViewPage = React.lazy(() =>
  import('@/pages/fishing/FishingDigestViewPage').then((m) => ({
    default: m.FishingDigestViewPage,
  })),
);
const FishingKnowledgeBasePage = React.lazy(() =>
  import('@/pages/fishing/FishingKnowledgeBasePage').then((m) => ({
    default: m.FishingKnowledgeBasePage,
  })),
);
const FishingKnowledgePageEditor = React.lazy(() =>
  import('@/pages/fishing/FishingKnowledgePageEditor').then((m) => ({
    default: m.FishingKnowledgePageEditor,
  })),
);
const MergeQueuePage = React.lazy(() =>
  import('@/pages/MergeQueuePage').then((m) => ({ default: m.MergeQueuePage })),
);
const HellscriptBuffersPage = React.lazy(() =>
  import('@/pages/HellscriptBuffersPage').then((m) => ({ default: m.HellscriptBuffersPage })),
);
const HellscriptConversationPage = React.lazy(() =>
  import('@/pages/HellscriptConversationPage').then((m) => ({
    default: m.HellscriptConversationPage,
  })),
);
const HellscriptStylePage = React.lazy(() =>
  import('@/pages/HellscriptStylePage').then((m) => ({ default: m.HellscriptStylePage })),
);
const HellscriptSamplesPage = React.lazy(() =>
  import('@/pages/HellscriptSamplesPage').then((m) => ({ default: m.HellscriptSamplesPage })),
);
const GitHubConnectionPage = React.lazy(() =>
  import('@/pages/GitHubConnectionPage').then((m) => ({ default: m.GitHubConnectionPage })),
);
const GoogleCalendarConnectionPage = React.lazy(() =>
  import('@/pages/GoogleCalendarConnectionPage').then((m) => ({
    default: m.GoogleCalendarConnectionPage,
  })),
);
const HomePage = React.lazy(() =>
  import('@/pages/HomePage').then((m) => ({ default: m.HomePage })),
);
const InboxPage = React.lazy(() =>
  import('@/pages/InboxPage').then((m) => ({ default: m.InboxPage })),
);
const LlmUsagePage = React.lazy(() =>
  import('@/pages/LlmUsagePage').then((m) => ({ default: m.LlmUsagePage })),
);
const LlmUsagePricingPage = React.lazy(() =>
  import('@/pages/LlmUsagePricingPage').then((m) => ({ default: m.LlmUsagePricingPage })),
);
const LlmUsageViewPage = React.lazy(() =>
  import('@/pages/LlmUsageViewPage').then((m) => ({ default: m.LlmUsageViewPage })),
);
const LinearConnectionPage = React.lazy(() =>
  import('@/pages/LinearConnectionPage').then((m) => ({ default: m.LinearConnectionPage })),
);
const LinearIssuesPage = React.lazy(() =>
  import('@/pages/LinearIssuesPage').then((m) => ({ default: m.LinearIssuesPage })),
);
const LinearPruneCandidatesPage = React.lazy(() =>
  import('@/pages/LinearPruneCandidatesPage').then((m) => ({
    default: m.LinearPruneCandidatesPage,
  })),
);
const ResearchAgentPage = React.lazy(() =>
  import('@/pages/ResearchAgentPage').then((m) => ({ default: m.ResearchAgentPage })),
);
const LoginPage = React.lazy(() =>
  import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const MobileNotificationsConnectionPage = React.lazy(() =>
  import('@/pages/MobileNotificationsConnectionPage').then((m) => ({
    default: m.MobileNotificationsConnectionPage,
  })),
);
const MobileNotificationsListPage = React.lazy(() =>
  import('@/pages/MobileNotificationsListPage').then((m) => ({
    default: m.MobileNotificationsListPage,
  })),
);
const NotificationDigestBackfillPage = React.lazy(() =>
  import('@/pages/NotificationDigestBackfillPage').then((m) => ({
    default: m.NotificationDigestBackfillPage,
  })),
);
const NotificationDigestsPage = React.lazy(() =>
  import('@/pages/NotificationDigestsPage').then((m) => ({ default: m.NotificationDigestsPage })),
);
const NotificationDigestViewPage = React.lazy(() =>
  import('@/pages/NotificationDigestViewPage').then((m) => ({
    default: m.NotificationDigestViewPage,
  })),
);
const NotesListPage = React.lazy(() =>
  import('@/pages/NotesListPage').then((m) => ({ default: m.NotesListPage })),
);
const NotionConnectionPage = React.lazy(() =>
  import('@/pages/NotionConnectionPage').then((m) => ({ default: m.NotionConnectionPage })),
);
const GitHubEventLogPage = React.lazy(() =>
  import('@/pages/GitHubEventLogPage').then((m) => ({ default: m.GitHubEventLogPage })),
);
const ResearchDetailPage = React.lazy(() =>
  import('@/pages/ResearchDetailPage').then((m) => ({ default: m.ResearchDetailPage })),
);
const ResearchListPage = React.lazy(() =>
  import('@/pages/ResearchListPage').then((m) => ({ default: m.ResearchListPage })),
);
const ShareHistoryPage = React.lazy(() =>
  import('@/pages/ShareHistoryPage').then((m) => ({ default: m.ShareHistoryPage })),
);
const ShareTargetPage = React.lazy(() =>
  import('@/pages/ShareTargetPage').then((m) => ({ default: m.ShareTargetPage })),
);
const TodosListPage = React.lazy(() =>
  import('@/pages/TodosListPage').then((m) => ({ default: m.TodosListPage })),
);
const WhatsAppConnectionPage = React.lazy(() =>
  import('@/pages/WhatsAppConnectionPage').then((m) => ({ default: m.WhatsAppConnectionPage })),
);
const WhatsAppNotesPage = React.lazy(() =>
  import('@/pages/WhatsAppNotesPage').then((m) => ({ default: m.WhatsAppNotesPage })),
);
const WorkerSettingsPage = React.lazy(() =>
  import('@/pages/WorkerSettingsPage').then((m) => ({ default: m.WorkerSettingsPage })),
);

function TimezoneAutoDetect(): null {
  useTimezoneAutoDetect();
  return null;
}

function PageLifecycleManager(): null {
  usePageLifecycle();
  return null;
}

function PublicRoute({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <FullPageSpinner />;
  }

  if (isAuthenticated) {
    return <Navigate to="/inbox" replace />;
  }

  return <>{children}</>;
}

function HomeRoute(): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/inbox" replace />;
  }

  return <HomePage />;
}

function NoteDetailRedirect(): React.JSX.Element {
  const { id } = useParams();
  return <Navigate to={`/my-notes?id=${id ?? ''}`} replace />;
}

function TodoDetailRedirect(): React.JSX.Element {
  const { id } = useParams();
  return <Navigate to={`/my-todos?id=${id ?? ''}`} replace />;
}

function BookmarkDetailRedirect(): React.JSX.Element {
  const { id } = useParams();
  return <Navigate to={`/my-bookmarks?id=${id ?? ''}`} replace />;
}

function CodeTaskViewPageKeyed(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <CodeTaskViewPage key={id} />;
}

function CodeTaskViewRedirect(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/code-tasks/${id ?? ''}`} replace />;
}

function LlmUsageViewPageKeyed(): React.JSX.Element {
  const { eventId } = useParams<{ eventId: string }>();
  return <LlmUsageViewPage key={eventId} />;
}

function AppRoutes(): React.JSX.Element {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route element={<ProtectedLayout />}>
          {/* Settings routes */}
          <Route path="/settings/notion" element={<NotionConnectionPage />} />
          <Route path="/settings/whatsapp" element={<WhatsAppConnectionPage />} />
          <Route path="/settings/mobile" element={<MobileNotificationsConnectionPage />} />
          <Route path="/settings/calendar" element={<GoogleCalendarConnectionPage />} />
          <Route path="/settings/github" element={<GitHubConnectionPage />} />
          <Route path="/settings/linear" element={<LinearConnectionPage />} />
          <Route path="/settings/api-keys" element={<ApiKeysSettingsPage />} />
          <Route path="/settings/code" element={<WorkerSettingsPage />} />
          <Route path="/settings/share-history" element={<ShareHistoryPage />} />
          {/* Hellscript routes */}
          <Route path="/hellscript" element={<HellscriptBuffersPage />} />
          <Route path="/hellscript/new" element={<HellscriptConversationPage />} />
          <Route path="/hellscript/voice" element={<HellscriptStylePage />} />
          <Route path="/hellscript/scriptures" element={<HellscriptSamplesPage />} />
          <Route path="/hellscript/:id" element={<HellscriptConversationPage />} />
          {/* Code Tasks routes */}
          <Route path="/code-tasks" element={<CodeTasksPage />} />
          <Route path="/code-tasks/new" element={<CodeTaskNewPage />} />
          <Route path="/code-tasks/ask-agent" element={<AskAgentPage />} />
          <Route path="/code-tasks/dispatch-queue" element={<DispatchQueuePage />} />
          <Route path="/code-tasks/:id/view" element={<CodeTaskViewRedirect />} />
          <Route path="/code-tasks/:id" element={<CodeTaskViewPageKeyed />} />
          <Route path="/code-tasks/pr-events" element={<GitHubEventLogPage />} />
          <Route path="/code-tasks/merge-queue" element={<MergeQueuePage />} />
          {/* LLM Usage routes */}
          <Route path="/llm-usage" element={<LlmUsagePage />} />
          <Route path="/llm-usage/pricing" element={<LlmUsagePricingPage />} />
          <Route path="/llm-usage/:eventId" element={<LlmUsageViewPageKeyed />} />
          {/* Cron Agent routes */}
          <Route path="/cron-agent" element={<CronSchedulesPage />} />
          <Route path="/cron-agent/new" element={<CronScheduleNewPage />} />
          <Route path="/cron-agent/executions" element={<CronExecutionsPage />} />
          <Route path="/cron-agent/:id" element={<CronScheduleViewPage />} />
          {/* Research Agent routes */}
          <Route path="/research/new" element={<ResearchAgentPage />} />
          <Route path="/research/:id" element={<ResearchDetailPage />} />
          <Route path="/research" element={<ResearchListPage />} />
          {/* Feature routes */}
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/share-target" element={<ShareTargetPage />} />
          <Route path="/notes" element={<WhatsAppNotesPage />} />
          <Route path="/my-notes" element={<NotesListPage />} />
          <Route path="/notes/:id" element={<NoteDetailRedirect />} />
          <Route path="/my-todos" element={<TodosListPage />} />
          <Route path="/todos/:id" element={<TodoDetailRedirect />} />
          <Route path="/my-bookmarks" element={<BookmarksListPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/linear/prune-candidates" element={<LinearPruneCandidatesPage />} />
          <Route path="/linear" element={<LinearIssuesPage />} />
          <Route path="/bookmarks/:id" element={<BookmarkDetailRedirect />} />
          <Route path="/notifications" element={<MobileNotificationsListPage />} />
          {/* Notification digest routes (most specific first) */}
          <Route
            path="/notifications/digests/backfill/:runId"
            element={<NotificationDigestBackfillPage />}
          />
          <Route
            path="/notifications/digests/:groupKey/:date"
            element={<NotificationDigestViewPage />}
          />
          <Route path="/notifications/digests" element={<NotificationDigestsPage />} />
          {/* Fishing Assistant routes */}
          <Route
            path="/fishing-assistant/digests/:groupKey/:date"
            element={<FishingDigestViewPage />}
          />
          <Route path="/fishing-assistant/digests" element={<FishingDigestsPage />} />
          <Route
            path="/fishing-assistant/knowledge/pages/:pageId"
            element={<FishingKnowledgePageEditor />}
          />
          <Route
            path="/fishing-assistant/knowledge"
            element={<FishingKnowledgeBasePage />}
          />
          <Route path="/fishing-assistant/chat/:chatId" element={<FishingChatPage />} />
          <Route path="/fishing-assistant/chat" element={<FishingChatPage />} />
        </Route>
        {/* Redirects for old URLs (backward compatibility) */}
        <Route path="/notion" element={<Navigate to="/settings/notion" replace />} />
        <Route path="/whatsapp" element={<Navigate to="/settings/whatsapp" replace />} />
        <Route path="/whatsapp-notes" element={<Navigate to="/notes" replace />} />
        <Route path="/mobile-notifications" element={<Navigate to="/settings/mobile" replace />} />
        <Route
          path="/mobile-notifications/list"
          element={<Navigate to="/notifications" replace />}
        />
        <Route path="/settings/workers" element={<Navigate to="/settings/code" replace />} />
        {/* 404 fallback */}
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
        <PWAProvider>
          <Auth0Provider
            domain={config.auth0Domain}
            clientId={config.auth0ClientId}
            authorizationParams={{
              redirect_uri: window.location.origin,
              audience: config.authAudience,
              scope: 'openid profile email',
            }}
            cacheLocation="localstorage"
          >
            <HashRouter>
              <AuthProvider>
                <TimezoneAutoDetect />
                <PageLifecycleManager />
                <SyncQueueProvider>
                  <AppRoutes />
                  <UpdateBanner />
                  <IOSInstallBanner />
                  <AndroidInstallBanner />
                  <XiaomiBatteryGuide />
                  <DevBar />
                  <Chat />
                </SyncQueueProvider>
              </AuthProvider>
            </HashRouter>
          </Auth0Provider>
        </PWAProvider>
    </ThemeProvider>
  );
}
