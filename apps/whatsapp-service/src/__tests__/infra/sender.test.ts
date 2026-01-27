/**
 * Tests for WhatsAppCloudApiSender.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppCloudApiSender } from '../../infra/whatsapp/sender.js';

describe('WhatsAppCloudApiSender', () => {
  let sender: WhatsAppCloudApiSender;
  const accessToken = 'test-access-token';
  const phoneNumberId = 'phone-number-123';

  beforeEach(() => {
    sender = new WhatsAppCloudApiSender(accessToken, phoneNumberId);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('sendTextMessage', () => {
    it('sends message successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendTextMessage('+1234567890', 'Hello!');

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })
      );

      // Verify body structure
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['messaging_product']).toBe('whatsapp');
      expect(body['to']).toBe('1234567890'); // + prefix removed
      expect(body['type']).toBe('text');
    });

    it('removes + prefix from phone number', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sender.sendTextMessage('+447123456789', 'Test');

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['to']).toBe('447123456789');
    });

    it('handles phone number without + prefix', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sender.sendTextMessage('447123456789', 'Test');

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['to']).toBe('447123456789');
    });

    it('returns error on API failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: (): Promise<string> => Promise.resolve('Bad Request: Invalid phone number'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendTextMessage('+1234567890', 'Hello!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('400');
        expect(result.error.message).toContain('Bad Request');
      }
    });

    it('returns error on network failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendTextMessage('+1234567890', 'Hello!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Network error');
      }
    });

    it('returns error on timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      const mockFetch = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendTextMessage('+1234567890', 'Hello!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('timed out');
      }
    });

    it('aborts request when timeout fires', async () => {
      // Create a fetch that hangs until aborted via signal
      const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = options.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const resultPromise = sender.sendTextMessage('+1234567890', 'Hello!');

      // Advance timer past the 30s timeout to trigger controller.abort()
      await vi.advanceTimersByTimeAsync(30001);

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('timed out');
        expect(result.error.message).toContain('30000ms');
      }
    });
  });

  describe('sendInteractiveMessage', () => {
    it('sends interactive message with buttons successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.interactive-123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const buttons = [
        { type: 'reply' as const, reply: { id: 'approve:action-1:abc1', title: 'Approve' } },
        { type: 'reply' as const, reply: { id: 'cancel:action-1', title: 'Cancel' } },
      ];

      const result = await sender.sendInteractiveMessage('+1234567890', 'Do you approve?', buttons);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.wamid).toBe('wamid.interactive-123');
      }

      expect(mockFetch).toHaveBeenCalledWith(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })
      );

      // Verify body structure
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['messaging_product']).toBe('whatsapp');
      expect(body['to']).toBe('1234567890');
      expect(body['type']).toBe('interactive');
      expect(body['interactive']).toEqual({
        type: 'button',
        body: { text: 'Do you approve?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'approve:action-1:abc1', title: 'Approve' } },
            { type: 'reply', reply: { id: 'cancel:action-1', title: 'Cancel' } },
          ],
        },
      });
    });

    it('truncates button titles longer than 20 characters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const buttons = [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'This is a very long button title that exceeds limit' } },
      ];

      await sender.sendInteractiveMessage('+1234567890', 'Test', buttons);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as { interactive: { action: { buttons: { reply: { title: string } }[] } } };
      expect(body.interactive.action.buttons[0]?.reply.title).toBe('This is a very long ');
      expect(body.interactive.action.buttons[0]?.reply.title.length).toBe(20);
    });

    it('removes + prefix from phone number for interactive messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<Record<string, unknown>> => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sender.sendInteractiveMessage('+447123456789', 'Test', [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['to']).toBe('447123456789');
    });

    it('returns error on API failure for interactive message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: (): Promise<string> => Promise.resolve('Bad Request: Invalid interactive message'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendInteractiveMessage('+1234567890', 'Test', [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('400');
      }
    });

    it('returns error on network failure for interactive message', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendInteractiveMessage('+1234567890', 'Test', [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Network error');
      }
    });

    it('returns error on timeout for interactive message', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      const mockFetch = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendInteractiveMessage('+1234567890', 'Test', [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('timed out');
      }
    });

    it('generates fallback wamid when response has no message id', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendInteractiveMessage('+1234567890', 'Test', [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.wamid).toMatch(/^unknown-\d+$/);
      }
    });
  });
});
