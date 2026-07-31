/**
 * Tests for WhatsAppCloudApiSender.
 */
import { WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH } from '@intexuraos/http-contracts';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHATSAPP_MESSAGE_SEND_TIMEOUT_MS } from '../../domain/whatsapp/ports/messageSender.js';
import { WhatsAppCloudApiSender } from '../../infra/whatsapp/sender.js';

const { warnSpy, errorSpy, infoSpy, mockLogger } = vi.hoisted(() => {
  const warnSpy = vi.fn();
  const errorSpy = vi.fn();
  const infoSpy = vi.fn();
  const debugSpy = vi.fn();
  const mockLogger = {
    warn: warnSpy,
    error: errorSpy,
    info: infoSpy,
    debug: debugSpy,
    child: vi.fn(),
  } as unknown as Logger;
  return { warnSpy, errorSpy, infoSpy, mockLogger };
});

vi.mock('@intexuraos/infra-sentry', () => ({
  createAppLogger: (): Logger => mockLogger,
  SKIP_SENTRY_KEY: '_skipSentry',
}));

describe('WhatsAppCloudApiSender', () => {
  let sender: WhatsAppCloudApiSender;
  const accessToken = 'test-access-token';
  const phoneNumberId = 'phone-number-123';

  beforeEach(() => {
    sender = new WhatsAppCloudApiSender(accessToken, phoneNumberId);
    vi.useFakeTimers();
    warnSpy.mockClear();
    errorSpy.mockClear();
    infoSpy.mockClear();
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

    it('truncates body text longer than 4096 characters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const longMessage = 'a'.repeat(5000);
      await sender.sendTextMessage('+1234567890', longMessage);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as { text: { body: string } };
      expect(body.text.body.length).toBe(4096);
    });

    it('does not truncate body text at exactly 4096 characters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const exactMessage = 'b'.repeat(4096);
      await sender.sendTextMessage('+1234567890', exactMessage);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as { text: { body: string } };
      expect(body.text.body.length).toBe(4096);
      expect(body.text.body).toBe(exactMessage);
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
        expect(result.error.message).not.toContain('Bad Request');
        expect(result.error.httpStatus).toBe(400);
      }
    });

    it('returns error on network failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendTextMessage('+1234567890', 'Hello!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toBe('Failed to send WhatsApp text message');
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

    it('handles phone number without + prefix for interactive messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<Record<string, unknown>> => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sender.sendInteractiveMessage('447123456789', 'Test', [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['to']).toBe('447123456789');
    });

    it('truncates body text longer than 1024 characters for interactive message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const longMessage = 'c'.repeat(2000);
      await sender.sendInteractiveMessage('+1234567890', longMessage, [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as { interactive: { body: { text: string } } };
      expect(body.interactive.body.text.length).toBe(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
    });

    it('does not truncate body text at exactly 1024 characters for interactive message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const exactMessage = 'd'.repeat(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
      await sender.sendInteractiveMessage('+1234567890', exactMessage, [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as { interactive: { body: { text: string } } };
      expect(body.interactive.body.text.length).toBe(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
      expect(body.interactive.body.text).toBe(exactMessage);
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
        expect(result.error.httpStatus).toBe(400);
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
        expect(result.error.message).toBe('Failed to send WhatsApp interactive message');
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

  describe('sendCtaUrlMessage', () => {
    const ctaUrl = { displayText: 'View Details', url: 'https://example.com/details' };

    it('sends CTA URL message successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.cta-123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendCtaUrlMessage('+1234567890', 'Check this out!', ctaUrl);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.wamid).toBe('wamid.cta-123');
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
        type: 'cta_url',
        body: { text: 'Check this out!' },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: 'View Details',
            url: 'https://example.com/details',
          },
        },
      });
    });

    it('removes + prefix from phone number for CTA URL messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<Record<string, unknown>> => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sender.sendCtaUrlMessage('+447123456789', 'Test', ctaUrl);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['to']).toBe('447123456789');
    });

    it('handles phone number without + prefix for CTA URL messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<Record<string, unknown>> => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sender.sendCtaUrlMessage('447123456789', 'Test', ctaUrl);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
      expect(body['to']).toBe('447123456789');
    });

    it('truncates body text longer than 1024 characters for CTA URL message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const longMessage = 'e'.repeat(2000);
      await sender.sendCtaUrlMessage('+1234567890', longMessage, ctaUrl);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as { interactive: { body: { text: string } } };
      expect(body.interactive.body.text.length).toBe(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
    });

    it('does not truncate body text at exactly 1024 characters for CTA URL message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const exactMessage = 'f'.repeat(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
      await sender.sendCtaUrlMessage('+1234567890', exactMessage, ctaUrl);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string) as { interactive: { body: { text: string } } };
      expect(body.interactive.body.text.length).toBe(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
      expect(body.interactive.body.text).toBe(exactMessage);
    });

    it('returns error on API failure for CTA URL message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: (): Promise<string> => Promise.resolve('Bad Request: Invalid CTA URL message'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendCtaUrlMessage('+1234567890', 'Test', ctaUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('400');
        expect(result.error.httpStatus).toBe(400);
      }
    });

    it('returns error on network failure for CTA URL message', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendCtaUrlMessage('+1234567890', 'Test', ctaUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toBe('Failed to send WhatsApp CTA URL message');
      }
    });

    it('returns error on timeout for CTA URL message', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      const mockFetch = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendCtaUrlMessage('+1234567890', 'Test', ctaUrl);

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

      const result = await sender.sendCtaUrlMessage('+1234567890', 'Test', ctaUrl);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.wamid).toMatch(/^unknown-\d+$/);
      }
    });
  });

  describe('sendMessageDigestTemplate', () => {
    const presentation = {
      digestName: 'Daily fishing digest',
      digestExcerpt: 'Meet at the lake at 07:00. Bring two nets.',
      runUrlSuffix: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
    };

    it('sends the exact approved Utility template and returns its WAMID', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.digest-123' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendMessageDigestTemplate('+48123456789', presentation);

      expect(result).toEqual({ ok: true, value: { wamid: 'wamid.digest-123' } });
      expect(mockFetch).toHaveBeenCalledOnce();
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(callArgs[0]).toBe(
        `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`
      );
      expect(JSON.parse(callArgs[1].body as string)).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '48123456789',
        type: 'template',
        template: {
          name: 'intexuraos_message_digest_v1',
          language: { code: 'en_US' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Daily fishing digest' },
                { type: 'text', text: 'Meet at the lake at 07:00. Bring two nets.' },
              ],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [
                {
                  type: 'text',
                  text: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
                },
              ],
            },
          ],
        },
      });
    });

    it('keeps an already-normalized phone number unchanged', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.digest-124' }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await sender.sendMessageDigestTemplate('48123456789', presentation);

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(callArgs[1].body as string)).toMatchObject({ to: '48123456789' });
    });

    it.each([
      [400, 'Bad Request: invalid template', 400],
      [500, 'Provider unavailable', 500],
    ])('preserves a provider %i failure', async (status, responseText, expectedStatus) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          text: (): Promise<string> => Promise.resolve(responseText),
        })
      );

      const result = await sender.sendMessageDigestTemplate('+48123456789', presentation);

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'PERSISTENCE_ERROR', httpStatus: expectedStatus },
      });
    });

    it('preserves timeout ambiguity without retrying as free-form text', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendMessageDigestTemplate('+48123456789', presentation);

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'PERSISTENCE_ERROR', message: expect.stringContaining('timed out') },
      });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('keeps the provider deadline armed until a resolved response body finishes', async () => {
      const mockFetch = vi.fn((_url: string, init: RequestInit) => {
        if (!(init.signal instanceof AbortSignal)) {
          throw new Error('Expected WhatsApp request AbortSignal');
        }
        const responseSignal = init.signal;
        return Promise.resolve({
          ok: true,
          json: (): Promise<never> =>
            new Promise((_resolve, reject) => {
              responseSignal.addEventListener(
                'abort',
                () => {
                  const abortError = new Error('Aborted while reading response body');
                  abortError.name = 'AbortError';
                  reject(abortError);
                },
                { once: true }
              );
            }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const resultPromise = sender.sendMessageDigestTemplate('+48123456789', presentation);
      await vi.advanceTimersByTimeAsync(0);
      const responseSignal = mockFetch.mock.calls[0]?.[1].signal;
      if (!(responseSignal instanceof AbortSignal)) {
        throw new Error('Expected captured WhatsApp request AbortSignal');
      }
      expect(responseSignal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(WHATSAPP_MESSAGE_SEND_TIMEOUT_MS - 1);
      expect(responseSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(responseSignal.aborted).toBe(true);
      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        error: { code: 'PERSISTENCE_ERROR', message: expect.stringContaining('timed out') },
      });
    });

    it('preserves thrown network ambiguity without retrying as free-form text', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network unavailable'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await sender.sendMessageDigestTemplate('+48123456789', presentation);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'PERSISTENCE_ERROR',
          message: 'Failed to send WhatsApp Message Digest template message',
        },
      });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('does not expose provider-controlled response text in logs or returned errors', async () => {
      const recipient = '+48123456789';
      const normalizedRecipient = recipient.slice(1);
      const templateSentinel = 'PRIVATE_DIGEST_TEMPLATE_SENTINEL';
      const providerText = JSON.stringify({
        error: {
          message: `Rejected ${recipient} ${normalizedRecipient}`,
          code: 132000,
          error_subcode: 2494010,
          error_data: { details: templateSentinel },
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: (): Promise<string> => Promise.resolve(providerText),
        })
      );

      const result = await sender.sendMessageDigestTemplate(recipient, {
        ...presentation,
        digestExcerpt: templateSentinel,
      });
      const serialized = JSON.stringify([errorSpy.mock.calls, warnSpy.mock.calls, result]);

      expect(serialized).not.toContain(recipient);
      expect(serialized).not.toContain(normalizedRecipient);
      expect(serialized).not.toContain('***89');
      expect(serialized).not.toContain(templateSentinel);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 400,
          responseBytes: Buffer.byteLength(providerText, 'utf8'),
          providerCode: 132000,
          providerSubcode: 2494010,
          errorClass: 'provider_response',
        }),
        expect.any(String)
      );
      expect(errorSpy.mock.calls[0]?.[0]).not.toHaveProperty('recipientHint');
    });

    it('does not log non-numeric or unsafe provider error codes', async () => {
      const unsafeProviderText = JSON.stringify({
        error: {
          code: '132000',
          error_subcode: Number.MAX_SAFE_INTEGER + 1,
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: (): Promise<string> => Promise.resolve(unsafeProviderText),
        })
      );

      await sender.sendMessageDigestTemplate('+48123456789', presentation);

      const metadata = errorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(metadata).not.toHaveProperty('providerCode');
      expect(metadata).not.toHaveProperty('providerSubcode');
    });

    it('classifies defensive provider and transport error shapes without exposing payloads', async () => {
      const recipient = '+';
      const scenarios = [
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: (): Promise<string> => Promise.resolve('null'),
        }),
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: (): Promise<string> => Promise.resolve('{"error":null}'),
        }),
        vi.fn().mockRejectedValue(new TypeError('synthetic type failure')),
        vi.fn().mockRejectedValue('synthetic non-error failure'),
        vi.fn().mockResolvedValue({
          ok: true,
          json: (): Promise<{ messages: { id: string }[] }> =>
            Promise.resolve({ messages: [{ id: 'wamid.redacted-recipient' }] }),
        }),
      ];

      for (const mockFetch of scenarios) {
        vi.stubGlobal('fetch', mockFetch);
        await sender.sendMessageDigestTemplate(recipient, presentation);
      }

      const failureMetadata = errorSpy.mock.calls.map((call) => call[0] as Record<string, unknown>);
      expect(failureMetadata.slice(0, 2)).toEqual([
        expect.objectContaining({ errorClass: 'provider_response' }),
        expect.objectContaining({ errorClass: 'provider_response' }),
      ]);
      expect(failureMetadata).toContainEqual(expect.objectContaining({ errorClass: 'type_error' }));
      expect(failureMetadata).toContainEqual(expect.objectContaining({ errorClass: 'non_error' }));
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ recipientHint: '[redacted]' }),
        expect.any(String)
      );
    });

    it('does not expose thrown provider text in logs or returned errors', async () => {
      const recipient = '+48123456789';
      const normalizedRecipient = recipient.slice(1);
      const templateSentinel = 'PRIVATE_DIGEST_THROW_SENTINEL';
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockRejectedValue(
            new Error(`Network failed ${recipient} ${normalizedRecipient} ${templateSentinel}`)
          )
      );

      const result = await sender.sendMessageDigestTemplate(recipient, {
        ...presentation,
        digestExcerpt: templateSentinel,
      });
      const serialized = JSON.stringify([errorSpy.mock.calls, warnSpy.mock.calls, result]);

      expect(serialized).not.toContain(recipient);
      expect(serialized).not.toContain(normalizedRecipient);
      expect(serialized).not.toContain(templateSentinel);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ recipientHint: '***89', errorClass: 'error' }),
        expect.any(String)
      );
    });

    it('never writes the full or normalized recipient to success and failure logs', async () => {
      const recipient = '+48123456789';
      const privateWamid = 'wamid.digest-private';
      const scenarios = [
        vi.fn().mockResolvedValue({
          ok: true,
          json: (): Promise<{ messages: { id: string }[] }> =>
            Promise.resolve({ messages: [{ id: privateWamid }] }),
        }),
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: (): Promise<string> => Promise.resolve('Synthetic provider rejection'),
        }),
        vi.fn().mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
        vi.fn().mockRejectedValue(new Error('Synthetic network failure')),
      ];

      for (const mockFetch of scenarios) {
        vi.stubGlobal('fetch', mockFetch);
        await sender.sendMessageDigestTemplate(recipient, presentation);
        expect(JSON.stringify([infoSpy.mock.calls, warnSpy.mock.calls, errorSpy.mock.calls])).not.toContain(
          recipient
        );
        expect(JSON.stringify([infoSpy.mock.calls, warnSpy.mock.calls, errorSpy.mock.calls])).not.toContain(
          recipient.slice(1)
        );
        expect(JSON.stringify([infoSpy.mock.calls, warnSpy.mock.calls, errorSpy.mock.calls])).not.toContain(
          privateWamid
        );
        infoSpy.mockClear();
        warnSpy.mockClear();
        errorSpy.mockClear();
      }
    });
  });

  describe('truncation logging', () => {
    const mockFetch = (): ReturnType<typeof vi.fn> =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<{ messages: { id: string }[] }> =>
          Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });

    it('marks text message truncation warn as Sentry-skipped', async () => {
      vi.stubGlobal('fetch', mockFetch());
      const longMessage = 'a'.repeat(5000);

      await sender.sendTextMessage('+1234567890', longMessage);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          _skipSentry: true,
          originalLength: 5000,
          maxLength: 4096,
        }),
        expect.stringContaining('Truncated text message body')
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('+1234567890');
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('1234567890');
    });

    it('marks interactive message truncation warn as Sentry-skipped', async () => {
      vi.stubGlobal('fetch', mockFetch());
      const longMessage = 'c'.repeat(2000);

      await sender.sendInteractiveMessage('+1234567890', longMessage, [
        { type: 'reply' as const, reply: { id: 'btn-1', title: 'OK' } },
      ]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          _skipSentry: true,
          originalLength: 2000,
          maxLength: 1024,
        }),
        expect.stringContaining('Truncated interactive message body')
      );
    });

    it('marks CTA URL message truncation warn as Sentry-skipped', async () => {
      vi.stubGlobal('fetch', mockFetch());
      const longMessage = 'e'.repeat(2000);
      const ctaUrl = { displayText: 'View Details', url: 'https://example.com/details' };

      await sender.sendCtaUrlMessage('+1234567890', longMessage, ctaUrl);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          _skipSentry: true,
          originalLength: 2000,
          maxLength: 1024,
        }),
        expect.stringContaining('Truncated CTA URL message body')
      );
    });

    it('does not log a warn when text message fits within the limit', async () => {
      vi.stubGlobal('fetch', mockFetch());

      await sender.sendTextMessage('+1234567890', 'short');

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
