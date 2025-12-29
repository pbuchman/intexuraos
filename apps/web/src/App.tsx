import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { AuthProvider, useAuth } from '@/context';
import { PWAProvider } from '@/context/pwa-context';
import { IOSInstallBanner, AndroidInstallBanner, UpdateBanner } from '@/components/pwa-banners';
import { config } from '@/config';
import {
  HomePage,
  LoginPage,
  DashboardPage,
  NotionConnectionPage,
  WhatsAppConnectionPage,
  WhatsAppNotesPage,
  MobileNotificationsConnectionPage,
  MobileNotificationsListPage,
  ApiKeysSettingsPage,
  LlmOrchestratorPage,
  ResearchListPage,
  ResearchDetailPage,
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
    return <Navigate to="/dashboard" replace />;
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
    return <Navigate to="/dashboard" replace />;
  }

  return <HomePage />;
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
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
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
        path="/settings/api-keys"
        element={
          <ProtectedRoute>
            <ApiKeysSettingsPage />
          </ProtectedRoute>
        }
      />
      {/* LLM Orchestrator routes */}
      <Route
        path="/research/new"
        element={
          <ProtectedRoute>
            <LlmOrchestratorPage />
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
      {/* Feature routes */}
      <Route
        path="/notes"
        element={
          <ProtectedRoute>
            <WhatsAppNotesPage />
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
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
            <AppRoutes />
            <UpdateBanner />
            <IOSInstallBanner />
            <AndroidInstallBanner />
          </AuthProvider>
        </HashRouter>
      </Auth0Provider>
    </PWAProvider>
  );
}
