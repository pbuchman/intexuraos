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
  disconnectWhatsApp: vi.fn(),
  getVerificationStatus: vi.fn(),
  getWhatsAppStatus: vi.fn().mockResolvedValue(null),
  sendVerificationCode: vi.fn(),
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
});
