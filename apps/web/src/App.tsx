import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { VibeKanbanWebCompanion } from 'vibe-kanban-web-companion';
import { AuthProvider, SyncQueueProvider, useAuth } from '@/context';
import { PWAProvider } from '@/context/pwa-context';
import { AndroidInstallBanner, IOSInstallBanner, UpdateBanner } from '@/components/pwa-banners';
import { config } from '@/config';


(function handleShareTargetRedirect(): void {
  if (window.location.hash !== '') return;
  const params = new URLSearchParams(window.location.search);
  if (params.has('title') || params.has('text') || params.has('url')) {
    window.location.replace(`${window.location.origin}/#/share-target${window.location.search}`);
  }
})();

import {
  ApiKeysSettingsPage,
  BookmarksListPage,
  CalendarPage,
  CompositeFeedFormPage,
  CompositeFeedsListPage,
  DataInsightsPage,
  DataSourceFormPage,
  DataSourcesListPage,
  GoogleCalendarConnectionPage,
  HomePage,
  InboxPage,
  LlmCostsPage,
  ResearchAgentPage,
  LlmPricingPage,
  LoginPage,
  MobileNotificationsConnectionPage,
  MobileNotificationsListPage,
  NotesListPage,
  NotionConnectionPage,
  ResearchDetailPage,
  ResearchListPage,
  ShareHistoryPage,
  ShareTargetPage,
  SystemHealthPage,
  TodosListPage,
  WhatsAppConnectionPage,
  WhatsAppNotesPage,
} from '@/pages';

function ProtectedRoute({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
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

function AppRoutes(): React.JSX.Element {
  return (
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
      <Route
        path="/system-health"
        element={
          <ProtectedRoute>
            <SystemHealthPage />
          </ProtectedRoute>
        }
      />
      {/* Settings routes */}
      <Route
        path="/settings/notion"
        element={
          <ProtectedRoute>
            <NotionConnectionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/whatsapp"
        element={
          <ProtectedRoute>
            <WhatsAppConnectionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/mobile"
        element={
          <ProtectedRoute>
            <MobileNotificationsConnectionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/calendar"
        element={
          <ProtectedRoute>
            <GoogleCalendarConnectionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/api-keys"
        element={
          <ProtectedRoute>
            <ApiKeysSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/llm-pricing"
        element={
          <ProtectedRoute>
            <LlmPricingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/usage-costs"
        element={
          <ProtectedRoute>
            <LlmCostsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/share-history"
        element={
          <ProtectedRoute>
            <ShareHistoryPage />
          </ProtectedRoute>
        }
      />
      {/* Research Agent routes */}
      <Route
        path="/research/new"
        element={
          <ProtectedRoute>
            <ResearchAgentPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/research/:id"
        element={
          <ProtectedRoute>
            <ResearchDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/research"
        element={
          <ProtectedRoute>
            <ResearchListPage />
          </ProtectedRoute>
        }
      />
      {/* Data Insights routes */}
      <Route
        path="/data-insights"
        element={
          <ProtectedRoute>
            <CompositeFeedsListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-insights/new"
        element={
          <ProtectedRoute>
            <CompositeFeedFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-insights/:id"
        element={
          <ProtectedRoute>
            <CompositeFeedFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-insights/composite-feeds/:feedId/visualizations"
        element={
          <ProtectedRoute>
            <DataInsightsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-insights/static-sources"
        element={
          <ProtectedRoute>
            <DataSourcesListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-insights/static-sources/new"
        element={
          <ProtectedRoute>
            <DataSourceFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-insights/static-sources/:id"
        element={
          <ProtectedRoute>
            <DataSourceFormPage />
          </ProtectedRoute>
        }
      />
      {/* Feature routes */}
      <Route
        path="/inbox"
        element={
          <ProtectedRoute>
            <InboxPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/share-target"
        element={
          <ProtectedRoute>
            <ShareTargetPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notes"
        element={
          <ProtectedRoute>
            <WhatsAppNotesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-notes"
        element={
          <ProtectedRoute>
            <NotesListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notes/:id"
        element={
          <ProtectedRoute>
            <NoteDetailRedirect />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-todos"
        element={
          <ProtectedRoute>
            <TodosListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/todos/:id"
        element={
          <ProtectedRoute>
            <TodoDetailRedirect />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-bookmarks"
        element={
          <ProtectedRoute>
            <BookmarksListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/calendar"
        element={
          <ProtectedRoute>
            <CalendarPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bookmarks/:id"
        element={
          <ProtectedRoute>
            <BookmarkDetailRedirect />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <MobileNotificationsListPage />
          </ProtectedRoute>
        }
      />
      {/* Redirects for old URLs (backward compatibility) */}
      <Route path="/notion" element={<Navigate to="/settings/notion" replace />} />
      <Route path="/whatsapp" element={<Navigate to="/settings/whatsapp" replace />} />
      <Route path="/whatsapp-notes" element={<Navigate to="/notes" replace />} />
      <Route path="/mobile-notifications" element={<Navigate to="/settings/mobile" replace />} />
      <Route path="/mobile-notifications/list" element={<Navigate to="/notifications" replace />} />
      {/* 404 fallback */}
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}

export function App(): React.JSX.Element {
  return (
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
            <SyncQueueProvider>
              <AppRoutes />
              <UpdateBanner />
              <IOSInstallBanner />
              <AndroidInstallBanner />
            </SyncQueueProvider>
          </AuthProvider>
        </HashRouter>
      </Auth0Provider>
      <VibeKanbanWebCompanion />
    </PWAProvider>
  );
}
