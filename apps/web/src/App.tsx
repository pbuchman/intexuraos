import React, { Suspense } from 'react';
import {
  createHashRouter,
  Navigate,
  Route,
  RouterProvider,
  Routes,
  useParams,
} from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { AuthProvider, SyncQueueProvider, ThemeProvider, useAuth } from '@/context';
import { usePageLifecycle, useTimezoneAutoDetect } from '@/hooks';
import { PWAProvider } from '@/context/pwa-context';
import { AndroidInstallBanner, IOSInstallBanner, UpdateBanner } from '@/components/pwa-banners';
import { XiaomiBatteryGuide } from '@/components/XiaomiBatteryGuide';
import { DevBar } from '@/components/DevBar';
import { ProtectedLayout } from '@/components/routing/ProtectedLayout';
import { FullPageSpinner } from '@/components/routing/FullPageSpinner';
import {
  clearAuthReturnPath,
  readAuthReturnPath,
} from '@/components/routing/authReturnPath';
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
const DispatchQueuePage = React.lazy(() =>
  import('@/pages/DispatchQueuePage').then((m) => ({ default: m.DispatchQueuePage })),
);
const FishingChatPage = React.lazy(() =>
  import('@/pages/fishing/FishingChatPage').then((m) => ({ default: m.FishingChatPage })),
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
const IntexAgentSessionsPage = React.lazy(() =>
  import('@/pages/IntexAgentSessionsPage').then((m) => ({ default: m.IntexAgentSessionsPage })),
);
const IntexAgentConfigPage = React.lazy(() =>
  import('@/pages/IntexAgentConfigPage').then((m) => ({ default: m.IntexAgentConfigPage })),
);
const IntexAgentPreferencesPage = React.lazy(() =>
  import('@/pages/IntexAgentPreferencesPage').then((m) => ({ default: m.IntexAgentPreferencesPage })),
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
const MessageDigestLegacyRedirectPage = React.lazy(() =>
  import('@/pages/MessageDigestLegacyRedirectPage').then((m) => ({
    default: m.MessageDigestLegacyRedirectPage,
  })),
);
const NotesListPage = React.lazy(() =>
  import('@/pages/NotesListPage').then((m) => ({ default: m.NotesListPage })),
);
const NotionConnectionPage = React.lazy(() =>
  import('@/pages/NotionConnectionPage').then((m) => ({ default: m.NotionConnectionPage })),
);
const PrivateWhatsAppLogPage = React.lazy(() =>
  import('@/pages/PrivateWhatsAppLogPage').then((m) => ({ default: m.PrivateWhatsAppLogPage })),
);
const WhatsAppConversationAssistantListPage = React.lazy(() =>
  import('@/pages/WhatsAppConversationAssistantListPage').then((m) => ({
    default: m.WhatsAppConversationAssistantListPage,
  })),
);
const WhatsAppConversationAssistantNewPage = React.lazy(() =>
  import('@/pages/WhatsAppConversationAssistantNewPage').then((m) => ({
    default: m.WhatsAppConversationAssistantNewPage,
  })),
);
const WhatsAppConversationAssistantSessionPage = React.lazy(() =>
  import('@/pages/WhatsAppConversationAssistantSessionPage').then((m) => ({
    default: m.WhatsAppConversationAssistantSessionPage,
  })),
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
const WhatsAppConnectionPage = React.lazy(() =>
  import('@/pages/WhatsAppConnectionPage').then((m) => ({ default: m.WhatsAppConnectionPage })),
);
const WhatsAppMessageDigestDetailPage = React.lazy(() =>
  import('@/pages/WhatsAppMessageDigestDetailPage').then((m) => ({
    default: m.WhatsAppMessageDigestDetailPage,
  })),
);
const WhatsAppMessageDigestEditPage = React.lazy(() =>
  import('@/pages/WhatsAppMessageDigestEditPage').then((m) => ({
    default: m.WhatsAppMessageDigestEditPage,
  })),
);
const WhatsAppMessageDigestHistoryPage = React.lazy(() =>
  import('@/pages/WhatsAppMessageDigestHistoryPage').then((m) => ({
    default: m.WhatsAppMessageDigestHistoryPage,
  })),
);
const WhatsAppMessageDigestNewPage = React.lazy(() =>
  import('@/pages/WhatsAppMessageDigestNewPage').then((m) => ({
    default: m.WhatsAppMessageDigestNewPage,
  })),
);
const WhatsAppMessageDigestRunPage = React.lazy(() =>
  import('@/pages/WhatsAppMessageDigestRunPage').then((m) => ({
    default: m.WhatsAppMessageDigestRunPage,
  })),
);
const WhatsAppMessageDigestsPage = React.lazy(() =>
  import('@/pages/WhatsAppMessageDigestsPage').then((m) => ({
    default: m.WhatsAppMessageDigestsPage,
  })),
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
  const returnTo = useStoredAuthReturnPath(isAuthenticated);

  if (isLoading) {
    return <FullPageSpinner />;
  }

  if (isAuthenticated) {
    return <Navigate to={returnTo ?? '/intex-agent/sessions'} replace />;
  }

  return <>{children}</>;
}

function HomeRoute(): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const returnTo = useStoredAuthReturnPath(isAuthenticated);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={returnTo ?? '/intex-agent/sessions'} replace />;
  }

  return <HomePage />;
}

function useStoredAuthReturnPath(isAuthenticated: boolean): string | null {
  const [returnTo] = React.useState(readAuthReturnPath);
  React.useEffect(() => {
    if (isAuthenticated && returnTo !== null) clearAuthReturnPath();
  }, [isAuthenticated, returnTo]);
  return returnTo;
}

function NoteDetailRedirect(): React.JSX.Element {
  const { id } = useParams();
  return <Navigate to={`/my-notes?id=${id ?? ''}`} replace />;
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

export function AppRoutes(): React.JSX.Element {
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
          {/* Research Agent routes */}
          <Route path="/research/new" element={<ResearchAgentPage />} />
          <Route path="/research/:id" element={<ResearchDetailPage />} />
          <Route path="/research" element={<ResearchListPage />} />
          {/* Feature routes */}
          <Route path="/share-target" element={<ShareTargetPage />} />
          <Route path="/whatsapp/assistant" element={<WhatsAppNotesPage />} />
          <Route path="/whatsapp/private" element={<PrivateWhatsAppLogPage />} />
          <Route path="/whatsapp/conversation-assistant" element={<WhatsAppConversationAssistantListPage />} />
          <Route path="/whatsapp/conversation-assistant/new" element={<WhatsAppConversationAssistantNewPage />} />
          <Route path="/whatsapp/conversation-assistant/:sessionId" element={<WhatsAppConversationAssistantSessionPage />} />
          <Route path="/whatsapp/message-digests/new" element={<WhatsAppMessageDigestNewPage />} />
          <Route
            path="/whatsapp/message-digests/:definitionId/edit"
            element={<WhatsAppMessageDigestEditPage />}
          />
          <Route
            path="/whatsapp/message-digests/:definitionId/history/:runId"
            element={<WhatsAppMessageDigestRunPage />}
          />
          <Route
            path="/whatsapp/message-digests/:definitionId/history"
            element={<WhatsAppMessageDigestHistoryPage />}
          />
          <Route
            path="/whatsapp/message-digests/:definitionId"
            element={<WhatsAppMessageDigestDetailPage />}
          />
          <Route path="/whatsapp/message-digests" element={<WhatsAppMessageDigestsPage />} />
          <Route path="/my-notes" element={<NotesListPage />} />
          <Route path="/notes/:id" element={<NoteDetailRedirect />} />
          <Route path="/my-bookmarks" element={<BookmarksListPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/linear/prune-candidates" element={<LinearPruneCandidatesPage />} />
          <Route path="/linear" element={<LinearIssuesPage />} />
          <Route path="/bookmarks/:id" element={<BookmarkDetailRedirect />} />
          <Route path="/notifications" element={<MobileNotificationsListPage />} />
          {/* Legacy notification digest redirects (most specific first) */}
          <Route
            path="/notifications/digests/backfill/:runId"
            element={<Navigate to="/whatsapp/message-digests" replace />}
          />
          <Route
            path="/notifications/digests/:groupKey/:date"
            element={<MessageDigestLegacyRedirectPage />}
          />
          <Route
            path="/notifications/digests/backfill"
            element={<Navigate to="/whatsapp/message-digests" replace />}
          />
          <Route
            path="/notifications/digests"
            element={<Navigate to="/whatsapp/message-digests" replace />}
          />
          {/* Intex Agent routes */}
          <Route path="/intex-agent/sessions" element={<IntexAgentSessionsPage />} />
          <Route path="/intex-agent/config" element={<IntexAgentConfigPage />} />
          <Route path="/intex-agent/settings" element={<IntexAgentPreferencesPage />} />
          <Route
            path="/intex-agent/preferences"
            element={<Navigate to="/intex-agent/settings" replace />}
          />
          {/* Legacy Fishing digest redirects */}
          <Route
            path="/fishing-assistant/digests/:groupKey/:date"
            element={<MessageDigestLegacyRedirectPage />}
          />
          <Route
            path="/fishing/digests/:groupKey/:date"
            element={<MessageDigestLegacyRedirectPage />}
          />
          <Route
            path="/fishing-assistant/digests"
            element={<Navigate to="/whatsapp/message-digests" replace />}
          />
          <Route
            path="/fishing/digests"
            element={<Navigate to="/whatsapp/message-digests" replace />}
          />
          {/* Fishing Assistant routes */}
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
        <Route path="/whatsapp" element={<Navigate to="/whatsapp/assistant" replace />} />
        <Route path="/whatsapp/sessions" element={<Navigate to="/intex-agent/sessions" replace />} />
        <Route path="/notes" element={<Navigate to="/whatsapp/assistant" replace />} />
        <Route path="/whatsapp-notes" element={<Navigate to="/whatsapp/assistant" replace />} />
        <Route path="/mobile-notifications" element={<Navigate to="/settings/mobile" replace />} />
        <Route
          path="/mobile-notifications/list"
          element={<Navigate to="/notifications" replace />}
        />
        <Route path="/settings/workers" element={<Navigate to="/settings/code" replace />} />
        {/* 404 fallback */}
        <Route path="*" element={<Navigate to="/intex-agent/sessions" replace />} />
      </Routes>
    </Suspense>
  );
}

function RoutedApplication(): React.JSX.Element {
  return (
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
      </SyncQueueProvider>
    </AuthProvider>
  );
}

const applicationRouter = createHashRouter([{ path: '*', element: <RoutedApplication /> }]);

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
            <RouterProvider router={applicationRouter} />
          </Auth0Provider>
        </PWAProvider>
    </ThemeProvider>
  );
}
