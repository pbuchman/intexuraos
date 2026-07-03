/**
 * Tests for WhatsAppConnectionPage.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { WhatsAppConnectionPage } from '../pages/WhatsAppConnectionPage.js';

const mockGetAccessToken = vi.fn();

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services', () => ({
  ApiError: class ApiError extends Error {},
  confirmVerificationCode: vi.fn(),
  connectWhatsApp: vi.fn(),
  disablePrivateWhatsAppAccount: vi.fn(),
  getPrivateWhatsAppAccount: vi.fn().mockResolvedValue(null),
  disconnectWhatsApp: vi.fn(),
  getVerificationStatus: vi.fn(),
  getWhatsAppStatus: vi.fn().mockResolvedValue(null),
  sendVerificationCode: vi.fn(),
  upsertPrivateWhatsAppAccount: vi.fn(),
}));

vi.mock('@/services/whatsappPreferencesApi', () => ({
  getWhatsAppPreferences: vi.fn().mockResolvedValue({ notificationLevel: 'all' }),
  updateWhatsAppPreferences: vi.fn(),
}));

vi.mock('@/components', async () => {
  const actual = await vi.importActual<typeof import('@/components')>('@/components');
  return {
    ...actual,
    Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <div>{children}</div>
    ),
  };
});

describe('WhatsAppConnectionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Notification Preferences card heading', async () => {
    render(<WhatsAppConnectionPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Notification Preferences')
      ).toBeInTheDocument();
    });
  });

  it('shows private mirror adapter settings for a connected WhatsApp phone', async () => {
    const services = await import('@/services');
    vi.mocked(services.getWhatsAppStatus).mockResolvedValue({
      connected: true,
      phoneNumbers: ['48123456789'],
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    });
    vi.mocked(services.getVerificationStatus).mockResolvedValue({
      phoneNumber: '+48123456789',
      verified: true,
      verifiedAt: '2026-06-22T00:00:00.000Z',
    });
    vi.mocked(services.getPrivateWhatsAppAccount).mockResolvedValue({
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      status: 'active',
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
      schemaVersion: 1,
    });

    render(<WhatsAppConnectionPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /disable private mirror/i })).toBeInTheDocument();
    });
    expect(screen.queryByText('pbuchman-private-whatsapp')).not.toBeInTheDocument();
    expect(screen.getByText('https://intexuraos.cloud/internal/whatsapp/private/events')).toBeInTheDocument();
  });

  it('asks the user to verify an assistant phone before enabling private mirror sync', async () => {
    const services = await import('@/services');
    vi.mocked(services.getWhatsAppStatus).mockResolvedValue(null);
    vi.mocked(services.getPrivateWhatsAppAccount).mockResolvedValue(null);

    render(<WhatsAppConnectionPage />);

    await waitFor(() => {
      expect(screen.getByText('Verify an assistant WhatsApp phone first.')).toBeInTheDocument();
    });
    expect(screen.getByText('Private WhatsApp Mirror')).toBeInTheDocument();
  });

  it('shows active private mirror controls when assistant phones are disconnected', async () => {
    const services = await import('@/services');
    vi.mocked(services.getWhatsAppStatus).mockResolvedValue(null);
    vi.mocked(services.getPrivateWhatsAppAccount).mockResolvedValue({
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      status: 'active',
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
      schemaVersion: 1,
    });

    render(<WhatsAppConnectionPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /disable private mirror/i })).toBeInTheDocument();
    });
    expect(screen.queryByText('private-wa-existing-source')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disable private mirror/i })).toBeInTheDocument();
    expect(screen.queryByText('Verify an assistant WhatsApp phone first.')).not.toBeInTheDocument();
  });
});
