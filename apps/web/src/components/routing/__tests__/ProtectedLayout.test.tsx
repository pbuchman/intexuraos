/**
 * Tests for ProtectedLayout nested route layout.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedLayout } from '../ProtectedLayout.js';
import { AUTH_RETURN_PATH_KEY } from '../authReturnPath.js';

interface MockAuthValue {
  isAuthenticated: boolean;
  isLoading: boolean;
}

const mockAuth: MockAuthValue = {
  isAuthenticated: false,
  isLoading: false,
};

vi.mock('@/context', () => ({
  useAuth: (): MockAuthValue => mockAuth,
}));

function renderAtProtectedRoute(initialPath = '/x'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedLayout />}>
          <Route path="/x" element={<div>protected-child</div>} />
          <Route
            path="/notifications/digests/:groupKey/:date"
            element={<div>legacy-child</div>}
          />
        </Route>
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ProtectedLayout', () => {
  beforeEach(() => {
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    sessionStorage.clear();
  });

  it('renders FullPageSpinner while auth is loading', () => {
    mockAuth.isLoading = true;
    mockAuth.isAuthenticated = false;
    renderAtProtectedRoute();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
    expect(screen.queryByText('protected-child')).not.toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    mockAuth.isLoading = false;
    mockAuth.isAuthenticated = false;
    renderAtProtectedRoute();
    expect(screen.getByText('login-page')).toBeInTheDocument();
    expect(screen.queryByText('protected-child')).not.toBeInTheDocument();
  });

  it('remembers the exact legacy URL before redirecting through login', () => {
    renderAtProtectedRoute(
      '/notifications/digests/grupa-wedkarska-skool/2026-07-27?source=legacy'
    );

    expect(screen.getByText('login-page')).toBeInTheDocument();
    expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBe(
      '/notifications/digests/grupa-wedkarska-skool/2026-07-27?source=legacy'
    );
  });

  it('renders the child outlet when authenticated', () => {
    mockAuth.isLoading = false;
    mockAuth.isAuthenticated = true;
    renderAtProtectedRoute();
    expect(screen.getByText('protected-child')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
