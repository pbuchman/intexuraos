/**
 * @vitest-environment jsdom
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/apiClient.js';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  resolveLegacyMessageDigestRun: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken } => ({
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/messageDigestsApi', () => ({
  resolveLegacyMessageDigestRun: mocks.resolveLegacyMessageDigestRun,
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <main>{children}</main>
  ),
}));

import { MessageDigestLegacyRedirectPage } from '../MessageDigestLegacyRedirectPage.js';

describe('MessageDigestLegacyRedirectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => cleanup());

  it.each([
    '/notifications/digests/grupa-wedkarska-skool/2026-07-27',
    '/fishing-assistant/digests/grupa-wedkarska-skool/2026-07-27',
    '/fishing/digests/grupa-wedkarska-skool/2026-07-27',
  ])('resolves legacy detail route %s to the canonical run', async (initialEntry) => {
    const alias = deferred<{ definitionId: string; runId: string }>();
    mocks.resolveLegacyMessageDigestRun.mockReturnValue(alias.promise);
    renderLegacy(initialEntry);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Opening the matching WhatsApp Message Digest'
    );
    alias.resolve({ definitionId: 'md_canonical_001', runId: 'mdr_canonical_001' });

    expect(await screen.findByTestId('canonical-location')).toHaveTextContent(
      '/whatsapp/message-digests/md_canonical_001/history/mdr_canonical_001'
    );
    expect(mocks.resolveLegacyMessageDigestRun).toHaveBeenCalledWith(
      'test-token',
      'grupa-wedkarska-skool',
      '2026-07-27',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('replaces a missing alias with the new list and an owner-safe notice', async () => {
    mocks.resolveLegacyMessageDigestRun.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Private alias detail', 404)
    );
    renderLegacy();

    const location = await screen.findByTestId('list-location');
    expect(location).toHaveTextContent('/whatsapp/message-digests');
    expect(location).toHaveTextContent(
      'No matching WhatsApp Message Digest was found for this legacy link.'
    );
    expect(document.body).not.toHaveTextContent('Private alias detail');
  });

  it('retains a safe retry action for a temporary resolver failure', async () => {
    const user = userEvent.setup();
    mocks.resolveLegacyMessageDigestRun
      .mockRejectedValueOnce(new Error('Temporary resolver detail'))
      .mockResolvedValueOnce({ definitionId: 'md_canonical_001', runId: 'mdr_canonical_001' });
    renderLegacy();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t open this legacy Message Digest link.'
    );
    expect(document.body).not.toHaveTextContent('Temporary resolver detail');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('canonical-location')).toBeInTheDocument();
    expect(mocks.resolveLegacyMessageDigestRun).toHaveBeenCalledTimes(2);
  });
});

function renderLegacy(
  initialEntry = '/notifications/digests/grupa-wedkarska-skool/2026-07-27'
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/notifications/digests/:groupKey/:date"
          element={<MessageDigestLegacyRedirectPage />}
        />
        <Route
          path="/fishing-assistant/digests/:groupKey/:date"
          element={<MessageDigestLegacyRedirectPage />}
        />
        <Route
          path="/fishing/digests/:groupKey/:date"
          element={<MessageDigestLegacyRedirectPage />}
        />
        <Route
          path="/whatsapp/message-digests/:definitionId/history/:runId"
          element={<LocationProbe testId="canonical-location" />}
        />
        <Route
          path="/whatsapp/message-digests"
          element={<LocationProbe testId="list-location" />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function LocationProbe({ testId }: { testId: string }): React.JSX.Element {
  const location = useLocation();
  const state = location.state as { messageDigestNotice?: string } | null;
  return (
    <div data-testid={testId}>
      {location.pathname} {state?.messageDigestNotice ?? ''}
    </div>
  );
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      act(() => resolvePromise?.(value));
    },
  };
}
