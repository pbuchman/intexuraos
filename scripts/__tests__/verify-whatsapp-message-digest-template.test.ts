import { describe, expect, it, vi } from 'vitest';
import { verifyWhatsAppMessageDigestTemplate } from '../hetzner/verify-whatsapp-message-digest-template.mjs';

const ACCESS_TOKEN = 'private-provider-access-token';
const WABA_ID = '123456789012345';

describe('WhatsApp Message Digest provider-template verifier', () => {
  it('accepts the one exact approved Utility contract and returns content-free evidence', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImplementation = vi.fn(
      async (resource: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(resource), ...(init === undefined ? {} : { init }) });
        return templateResponse();
      }
    );

    const result = await verifyWhatsAppMessageDigestTemplate({
      environment: environment(),
      fetchImplementation,
    });

    expect(result).toEqual({
      ok: true,
      templateName: 'intexuraos_message_digest_v3',
      language: 'pl',
      status: 'APPROVED',
    });
    expect(calls).toHaveLength(1);
    const requestUrl = new URL(calls[0]?.url ?? '');
    expect(requestUrl.origin).toBe('https://graph.facebook.com');
    expect(requestUrl.pathname).toBe(`/v22.0/${WABA_ID}/message_templates`);
    expect(requestUrl.searchParams.get('name')).toBe('intexuraos_message_digest_v3');
    expect(requestUrl.searchParams.get('fields')).toBe('name,language,status,category,components');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(
      `Bearer ${ACCESS_TOKEN}`
    );
    expect(calls[0]?.init?.redirect).toBe('error');
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(WABA_ID);
    expect(JSON.stringify(result)).not.toContain('Szczegóły');
  });

  it.each([
    ['missing', { data: [] }],
    ['duplicate', { data: [validTemplate(), validTemplate()] }],
    ['pending', { data: [validTemplate({ status: 'PENDING' })] }],
    ['rejected', { data: [validTemplate({ status: 'REJECTED' })] }],
    ['wrong language', { data: [validTemplate({ language: 'en_US' })] }],
    ['wrong category', { data: [validTemplate({ category: 'MARKETING' })] }],
    [
      'wrong body variables',
      {
        data: [
          validTemplate({
            components: [{ type: 'BODY', text: 'Digest {{2}} then {{1}}' }, validButtons()],
          }),
        ],
      },
    ],
    [
      'wrong fixed body copy',
      {
        data: [
          validTemplate({
            components: [
              {
                type: 'BODY',
                text: 'Inny szablon {{1}} {{2}} {{3}} {{4}}.',
              },
              validButtons(),
            ],
          }),
        ],
      },
    ],
    [
      'wrong button label',
      {
        data: [
          validTemplate({
            components: [validBody(), validButtons({ text: 'Otwórz' })],
          }),
        ],
      },
    ],
    [
      'wrong dynamic URL',
      {
        data: [
          validTemplate({
            components: [validBody(), validButtons({ url: 'https://example.invalid/{{1}}' })],
          }),
        ],
      },
    ],
    [
      'extra component',
      {
        data: [
          validTemplate({
            components: [validBody(), { type: 'FOOTER', text: 'Private footer' }, validButtons()],
          }),
        ],
      },
    ],
  ] as const)('fails closed for a %s template contract', async (_label, body) => {
    await expect(
      verifyWhatsAppMessageDigestTemplate({
        environment: environment(),
        fetchImplementation: async () => jsonResponse(body),
      })
    ).rejects.toThrow('MESSAGE_DIGEST_PROVIDER_TEMPLATE_NOT_READY');
  });

  it.each(['config', 'network', 'provider', 'malformed', 'oversized'] as const)(
    'fails with one safe code for %s failures without exposing protected data',
    async (failure) => {
      const privateSentinel = `${ACCESS_TOKEN}:${WABA_ID}:private-provider-response`;
      const options = {
        environment: failure === 'config' ? {} : environment(),
        fetchImplementation: async (): Promise<Response> => {
          if (failure === 'network') throw new Error(privateSentinel);
          if (failure === 'provider') return new Response(privateSentinel, { status: 503 });
          if (failure === 'malformed') return jsonResponse({ data: privateSentinel });
          if (failure === 'oversized') {
            return new Response(`{"data":[],"padding":"${'x'.repeat(140_000)}"}`, {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return templateResponse();
        },
      };

      let observed = '';
      try {
        await verifyWhatsAppMessageDigestTemplate(options);
      } catch (error) {
        observed = String(error);
      }

      expect(observed).toBe('Error: MESSAGE_DIGEST_PROVIDER_TEMPLATE_NOT_READY');
      expect(observed).not.toContain(ACCESS_TOKEN);
      expect(observed).not.toContain(WABA_ID);
      expect(observed).not.toContain('private-provider-response');
    }
  );

  it('cancels a chunked response as soon as its decoded body exceeds the byte limit', async () => {
    let pulls = 0;
    let cancellations = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller): void {
          pulls += 1;
          controller.enqueue(new Uint8Array(70_000).fill(0x20));
          if (pulls === 3) controller.close();
        },
        cancel(): void {
          cancellations += 1;
        },
      },
      { highWaterMark: 0 }
    );

    await expect(
      verifyWhatsAppMessageDigestTemplate({
        environment: environment(),
        fetchImplementation: async () =>
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      })
    ).rejects.toThrow('MESSAGE_DIGEST_PROVIDER_TEMPLATE_NOT_READY');

    expect(pulls).toBe(2);
    expect(cancellations).toBe(1);
  });

  it('aborts stalled response-body consumption on the fixed timeout with one safe code', async () => {
    vi.useFakeTimers();
    const privateSentinel = `${ACCESS_TOKEN}:${WABA_ID}:private-stalled-body`;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let outcome = 'pending';
    try {
      const verification = verifyWhatsAppMessageDigestTemplate({
        environment: environment(),
        fetchImplementation: async (_resource, init) => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller): void {
              streamController = controller;
              init?.signal?.addEventListener(
                'abort',
                () => {
                  controller.error(new Error(privateSentinel));
                },
                { once: true }
              );
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      });
      const settled = verification.then(
        () => {
          outcome = 'resolved';
        },
        (error: unknown) => {
          outcome = String(error);
        }
      );

      await vi.advanceTimersByTimeAsync(10_001);
      await Promise.resolve();
      await Promise.resolve();
      const outcomeAtDeadline = outcome;
      if (outcome === 'pending') {
        streamController?.error(new Error('test-cleanup'));
      }
      await settled;

      expect(outcomeAtDeadline).toBe('Error: MESSAGE_DIGEST_PROVIDER_TEMPLATE_NOT_READY');
      expect(outcomeAtDeadline).not.toContain(ACCESS_TOKEN);
      expect(outcomeAtDeadline).not.toContain(WABA_ID);
      expect(outcomeAtDeadline).not.toContain('private-stalled-body');
    } finally {
      vi.useRealTimers();
    }
  });
});

function environment(): Record<string, string> {
  return {
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN,
    INTEXURAOS_WHATSAPP_WABA_ID: WABA_ID,
  };
}

function templateResponse(): Response {
  return jsonResponse({ data: [validTemplate()] });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function validTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'intexuraos_message_digest_v3',
    language: 'pl',
    status: 'APPROVED',
    category: 'UTILITY',
    components: [validBody(), validButtons()],
    ...overrides,
  };
}

function validBody(): Record<string, unknown> {
  return {
    type: 'BODY',
    text: '📌 {{1}}\nZaplanowane podsumowanie rozmów jest gotowe.\nOkres: {{2}}\n\n*{{3}}*\n\n{{4}}\n\nPełne szczegóły poniżej ↓',
  };
}

function validButtons(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'BUTTONS',
    buttons: [
      {
        type: 'URL',
        text: 'Otwórz podsumowanie',
        url: 'https://intexuraos.cloud/{{1}}',
        example: ['#/whatsapp/message-digests/md_definition_example/history/mdr_run_example'],
        ...overrides,
      },
    ],
  };
}
