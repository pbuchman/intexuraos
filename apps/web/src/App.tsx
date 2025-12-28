import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { AuthProvider, useAuth } from '@/context';
import { PWAProvider } from '@/context/pwa-context';
import { IOSInstallBanner, AndroidInstallBanner, UpdateBanner } from '@/components/pwa-banners';
import { config } from '@/config';
import {
  LoginPage,
  DashboardPage,
  NotionConnectionPage,
  WhatsAppConnectionPage,
  WhatsAppNotesPage,
  MobileNotificationsConnectionPage,
  MobileNotificationsListPage,
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
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notion"
        element={
          <ProtectedRoute>
            <NotionConnectionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/whatsapp"
        element={
          <ProtectedRoute>
            <WhatsAppConnectionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/whatsapp-notes"
        element={
          <ProtectedRoute>
            <WhatsAppNotesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mobile-notifications"
        element={
          <ProtectedRoute>
            <MobileNotificationsConnectionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mobile-notifications/list"
        element={
          <ProtectedRoute>
            <MobileNotificationsListPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
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
