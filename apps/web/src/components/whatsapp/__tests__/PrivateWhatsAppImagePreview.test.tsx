/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateWhatsAppImagePreview } from '../PrivateWhatsAppImagePreview.js';
import type { PrivateWhatsAppMessage } from '@/types';

const mockGetAccessToken = vi.fn<() => Promise<string>>();
const mockGetPrivateWhatsAppMessageThumbnailUrl = vi.fn();
const mockGetPrivateWhatsAppMessageMediaUrl = vi.fn();

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/whatsappApi', () => ({
  getPrivateWhatsAppMessageThumbnailUrl: (
    ...args: unknown[]
  ): ReturnType<typeof mockGetPrivateWhatsAppMessageThumbnailUrl> =>
    mockGetPrivateWhatsAppMessageThumbnailUrl(...args),
  getPrivateWhatsAppMessageMediaUrl: (
    ...args: unknown[]
  ): ReturnType<typeof mockGetPrivateWhatsAppMessageMediaUrl> =>
    mockGetPrivateWhatsAppMessageMediaUrl(...args),
}));

function createMessage(overrides: Partial<PrivateWhatsAppMessage> = {}): PrivateWhatsAppMessage {
  return {
    id: 'stored-image',
    chatId: 'chat-group',
    direction: 'incoming',
    messageType: 'image',
    text: 'stored image',
    media: {
      fileName: 'stored.jpg',
      mimeType: 'image/jpeg',
      storageStatus: 'stored',
      hasMedia: true,
      hasThumbnail: true,
    },
    eventTimestamp: '2026-06-22T09:00:00.000Z',
    eventDayKey: '2026-06-22',
    receivedAt: '2026-06-22T09:00:02.000Z',
    ingestedAt: '2026-06-22T09:00:03.000Z',
    deliveryMode: 'live',
    ...overrides,
  };
}

describe('PrivateWhatsAppImagePreview', () => {
  beforeEach(() => {
    mockGetAccessToken.mockResolvedValue('access-token');
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('loads the thumbnail and renders the fetched image with the file name', async () => {
    mockGetPrivateWhatsAppMessageThumbnailUrl.mockResolvedValue({
      url: 'https://storage.example.com/thumb',
      expiresAt: '2026-06-26T10:15:00.000Z',
    });

    render(<PrivateWhatsAppImagePreview message={createMessage()} />);

    const image = await screen.findByRole('img', { name: 'stored.jpg' });

    expect(image).toHaveAttribute('src', 'https://storage.example.com/thumb');
    expect(screen.getByText('stored.jpg')).toBeInTheDocument();
    expect(mockGetPrivateWhatsAppMessageThumbnailUrl).toHaveBeenCalledWith(
      'access-token',
      'stored-image'
    );
  });

  it('shows retry after a thumbnail failure and loads the image when retry succeeds', async () => {
    const user = userEvent.setup();
    mockGetPrivateWhatsAppMessageThumbnailUrl
      .mockRejectedValueOnce(new Error('thumbnail failed'))
      .mockResolvedValueOnce({
        url: 'https://storage.example.com/thumb-retry',
        expiresAt: '2026-06-26T10:15:00.000Z',
      });

    render(<PrivateWhatsAppImagePreview message={createMessage()} />);

    await user.click(await screen.findByRole('button', { name: /retry image/i }));

    const image = await screen.findByRole('img', { name: 'stored.jpg' });

    expect(image).toHaveAttribute('src', 'https://storage.example.com/thumb-retry');
    expect(mockGetPrivateWhatsAppMessageThumbnailUrl).toHaveBeenCalledTimes(2);
  });

  it('fetches and opens the original image when the preview is clicked', async () => {
    const user = userEvent.setup();
    mockGetPrivateWhatsAppMessageThumbnailUrl.mockResolvedValue({
      url: 'https://storage.example.com/thumb',
      expiresAt: '2026-06-26T10:15:00.000Z',
    });
    mockGetPrivateWhatsAppMessageMediaUrl.mockResolvedValue({
      url: 'https://storage.example.com/original',
      expiresAt: '2026-06-26T10:15:00.000Z',
    });

    render(<PrivateWhatsAppImagePreview message={createMessage()} />);

    await user.click(await screen.findByRole('button', { name: /open image/i }));

    await waitFor(() => {
      expect(mockGetPrivateWhatsAppMessageMediaUrl).toHaveBeenCalledWith(
        'access-token',
        'stored-image'
      );
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://storage.example.com/original',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
