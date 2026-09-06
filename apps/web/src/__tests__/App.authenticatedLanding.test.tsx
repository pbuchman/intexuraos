/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AUTH_RETURN_PATH_KEY } from '@/components/routing/authReturnPath';

interface MockAuthValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { sub: string };
  login: () => void;
  logout: () => void;
  getAccessToken: () => Promise<string>;
}

const mockAuth: MockAuthValue = {
  isAuthenticated: true,
  isLoading: false,
  user: { sub: 'auth0|test-user' },
  login: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
};

function PassthroughProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>;
}

function NullComponent(): null {
  return null;
}

function SessionsPageMock(): React.JSX.Element {
  return <div>Intex Agent Sessions Page</div>;
}

function LegacyRedirectPageMock(): React.JSX.Element {
  return <div>Legacy Message Digest redirect</div>;
}

function MessageDigestRunPageMock(): React.JSX.Element {
  return <div>Message Digest run</div>;
}

vi.mock('@auth0/auth0-react', (): { Auth0Provider: typeof PassthroughProvider } => ({
  Auth0Provider: PassthroughProvider,
}));

vi.mock(
  '@/context',
  (): {
    AuthProvider: typeof PassthroughProvider;
    SyncQueueProvider: typeof PassthroughProvider;
    ThemeProvider: typeof PassthroughProvider;
    useAuth: () => MockAuthValue;
  } => ({
    AuthProvider: PassthroughProvider,
    SyncQueueProvider: PassthroughProvider,
    ThemeProvider: PassthroughProvider,
    useAuth: (): MockAuthValue => mockAuth,
  }),
);

vi.mock(
  '@/pages/MessageDigestLegacyRedirectPage',
  (): { MessageDigestLegacyRedirectPage: typeof LegacyRedirectPageMock } => ({
    MessageDigestLegacyRedirectPage: LegacyRedirectPageMock,
  })
);

vi.mock(
  '@/pages/WhatsAppMessageDigestRunPage',
  (): { WhatsAppMessageDigestRunPage: typeof MessageDigestRunPageMock } => ({
    WhatsAppMessageDigestRunPage: MessageDigestRunPageMock,
  })
);

vi.mock('@/context/pwa-context', (): { PWAProvider: typeof PassthroughProvider } => ({
  PWAProvider: PassthroughProvider,
}));

vi.mock('@/hooks', (): { usePageLifecycle: () => void; useTimezoneAutoDetect: () => void } => ({
  usePageLifecycle: vi.fn(),
  useTimezoneAutoDetect: vi.fn(),
}));

vi.mock('@/components/pwa-banners', (): {
  AndroidInstallBanner: typeof NullComponent;
  IOSInstallBanner: typeof NullComponent;
  UpdateBanner: typeof NullComponent;
} => ({
  AndroidInstallBanner: NullComponent,
  IOSInstallBanner: NullComponent,
  UpdateBanner: NullComponent,
}));

vi.mock('@/components/XiaomiBatteryGuide', (): { XiaomiBatteryGuide: typeof NullComponent } => ({
  XiaomiBatteryGuide: NullComponent,
}));

vi.mock('@/components/DevBar', (): { DevBar: typeof NullComponent } => ({
  DevBar: NullComponent,
}));

vi.mock(
  '@/pages/IntexAgentSessionsPage',
  (): { IntexAgentSessionsPage: typeof SessionsPageMock } => ({
    IntexAgentSessionsPage: SessionsPageMock,
  }),
);

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('App authenticated landing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it.each(['/', '/login'])('redirects authenticated %s visits to sessions', async (path) => {
    const { AppRoutes } = await import('../App.js');

    render(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="location"]')?.textContent).toBe(
        '/intex-agent/sessions',
      );
    });
  });

  it('returns an authenticated callback to the exact legacy digest URL once', async () => {
    sessionStorage.setItem(
      AUTH_RETURN_PATH_KEY,
      '/notifications/digests/grupa-wedkarska-skool/2026-07-27'
    );
    const { AppRoutes } = await import('../App.js');

    render(
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
        <AppRoutes />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="location"]')?.textContent).toBe(
        '/notifications/digests/grupa-wedkarska-skool/2026-07-27'
      );
    });
    expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBeNull();
  });

  it('returns an authenticated WhatsApp CTA to the exact canonical run route once', async () => {
    sessionStorage.setItem(
      AUTH_RETURN_PATH_KEY,
      '/whatsapp/message-digests/digest-cta/history/run-cta'
    );
    const { AppRoutes } = await import('../App.js');

    render(
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
        <AppRoutes />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="location"]')?.textContent).toBe(
        '/whatsapp/message-digests/digest-cta/history/run-cta'
      );
    });
    expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBeNull();
  });
});
