/**
 * Tests for private WhatsApp read-only API helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disablePrivateWhatsAppAccount,
  getPrivateWhatsAppAccount,
  listPrivateWhatsAppMessages,
  listPrivateWhatsAppSenderDays,
  listPrivateWhatsAppSenders,
  upsertPrivateWhatsAppAccount,
} from '../whatsappApi.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    whatsappServiceUrl: 'https://wa.test',
  },
}));

const TOKEN = 'tok';

describe('whatsappApi private read helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists private senders without sourceAccountId in the browser path', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ senders: [], nextCursor: 'next-senders' });

    const result = await listPrivateWhatsAppSenders(TOKEN, {
      limit: 25,
      cursor: 'cursor-1',
    });

    expect(result.nextCursor).toBe('next-senders');
    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[0]).toBe('https://wa.test');
    expect(call?.[1]).toBe('/private/senders?limit=25&cursor=cursor-1');
    expect(call?.[1]).not.toContain('sourceAccountId');
    expect(call?.[2]).toBe(TOKEN);
  });

  it('lists private messages by sender and optional day without sourceAccountId', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ messages: [] });

    await listPrivateWhatsAppMessages(TOKEN, {
      senderKey: 'phone:+48123456789',
      eventDayKey: '2026-06-22',
      limit: 50,
      cursor: 'messages-cursor',
    });

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe(
      '/private/messages?senderKey=phone%3A%2B48123456789&eventDayKey=2026-06-22&limit=50&cursor=messages-cursor'
    );
    expect(call?.[1]).not.toContain('sourceAccountId');
  });

  it('lists private sender-day aggregates without sourceAccountId', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ senderDays: [] });

    await listPrivateWhatsAppSenderDays(TOKEN, {
      senderKey: 'matrix:@sender:home-dev',
      fromDay: '2026-06-01',
      toDay: '2026-06-30',
      limit: 30,
    });

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe(
      '/private/sender-days?senderKey=matrix%3A%40sender%3Ahome-dev&fromDay=2026-06-01&toDay=2026-06-30&limit=30'
    );
    expect(call?.[1]).not.toContain('sourceAccountId');
  });

  it('loads the private mirror account without sourceAccountId in the browser path', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue(null);

    await getPrivateWhatsAppAccount(TOKEN);

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[0]).toBe('https://wa.test');
    expect(call?.[1]).toBe('/private/account');
    expect(call?.[1]).not.toContain('sourceAccountId');
    expect(call?.[2]).toBe(TOKEN);
  });

  it('enables the private mirror account with a selected phone number', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      sourceAccountId: 'private-wa-test-user',
      phoneNumberNormalized: '48123456789',
      status: 'active',
    });

    const result = await upsertPrivateWhatsAppAccount(TOKEN, {
      phoneNumber: '+48123456789',
    });

    expect(result.status).toBe('active');
    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe('/private/account');
    expect(call?.[3]).toEqual({
      method: 'PUT',
      body: { phoneNumber: '+48123456789' },
    });
  });

  it('disables the private mirror account', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ status: 'disabled' });

    await disablePrivateWhatsAppAccount(TOKEN);

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe('/private/account');
    expect(call?.[3]).toEqual({ method: 'DELETE' });
  });
});
