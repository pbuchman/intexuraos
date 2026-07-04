/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
});
