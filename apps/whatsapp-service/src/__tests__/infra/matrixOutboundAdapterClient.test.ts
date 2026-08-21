import { describe, expect, it, vi } from 'vitest';
import { createMatrixOutboundAdapterClient } from '../../infra/http/matrixOutboundAdapterClient.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('createMatrixOutboundAdapterClient', () => {
  it('reports setup_required when adapter config is missing', async () => {
    const client = createMatrixOutboundAdapterClient({
      baseUrl: '',
      authToken: '',
    });

    await expect(
      client.getDeliveryReadiness({
        sourceAccountId: 'source-123',
        target: 'intex_agent',
      })
    ).resolves.toEqual({
      status: 'setup_required',
      reason: 'Matrix outbound adapter is not configured',
    });
    await expect(
      client.sendMessage({
        sourceAccountId: 'source-123',
        target: 'intex_agent',
        text: 'hello',
      })
    ).resolves.toEqual({
      status: 'setup_required',
      reason: 'Matrix outbound adapter is not configured',
    });
  });

  it('checks delivery readiness with bearer auth and maps ready/setup/error responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: 'ready' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'setup_required', reason: 'missing target' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'unexpected' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, { status: 503 }))
      .mockResolvedValueOnce(new Response('not-json'))
      .mockRejectedValueOnce(new Error('readiness timeout'));
    const client = createMatrixOutboundAdapterClient({
      baseUrl: 'https://matrix.example.test/',
      authToken: 'secret',
      cloudflareAccessClientId: 'cf-client-id',
      cloudflareAccessClientSecret: 'cf-client-secret',
      fetchImpl,
    });

    await expect(
      client.getDeliveryReadiness({ sourceAccountId: 'source/123', target: 'intex_agent' })
    ).resolves.toEqual({ status: 'ready' });
    await expect(
      client.getDeliveryReadiness({ sourceAccountId: 'source-123', target: 'intex_agent' })
    ).resolves.toEqual({ status: 'setup_required', reason: 'missing target' });
    await expect(
      client.getDeliveryReadiness({ sourceAccountId: 'source-123', target: 'intex_agent' })
    ).resolves.toEqual({
      status: 'error',
      message: 'Matrix adapter readiness response was invalid',
    });
    await expect(
      client.getDeliveryReadiness({ sourceAccountId: 'source-123', target: 'intex_agent' })
    ).resolves.toEqual({
      status: 'error',
      message: 'Matrix adapter readiness request failed with HTTP 503',
    });
    await expect(
      client.getDeliveryReadiness({ sourceAccountId: 'source-123', target: 'intex_agent' })
    ).resolves.toEqual({
      status: 'error',
      message: 'Matrix adapter readiness response was invalid',
    });
    await expect(
      client.getDeliveryReadiness({ sourceAccountId: 'source-123', target: 'intex_agent' })
    ).resolves.toEqual({
      status: 'error',
      message: 'readiness timeout',
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://matrix.example.test/internal/matrix/outbound/readiness/source%2F123/intex_agent'
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        authorization: 'Bearer secret',
        'CF-Access-Client-Id': 'cf-client-id',
        'CF-Access-Client-Secret': 'cf-client-secret',
      },
    });
  });

  it('fails closed for HTTPS endpoints without a complete Cloudflare service token', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const missingToken = createMatrixOutboundAdapterClient({
      baseUrl: 'https://matrix.example.test',
      authToken: 'matrix-token',
      fetchImpl,
    });
    const incompleteToken = createMatrixOutboundAdapterClient({
      baseUrl: 'https://matrix.example.test',
      authToken: 'matrix-token',
      cloudflareAccessClientId: 'cf-client-id',
      fetchImpl,
    });

    await expect(
      missingToken.getDeliveryReadiness({ sourceAccountId: 'source-123', target: 'intex_agent' })
    ).resolves.toEqual({
      status: 'setup_required',
      reason: 'Matrix outbound adapter is not configured',
    });
    await expect(
      incompleteToken.sendMessage({
        sourceAccountId: 'source-123',
        target: 'intex_agent',
        text: 'hello',
      })
    ).resolves.toEqual({
      status: 'setup_required',
      reason: 'Matrix outbound adapter is not configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps loopback DEV requests independent from Cloudflare Access', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ status: 'ready' }));
    const client = createMatrixOutboundAdapterClient({
      baseUrl: 'http://127.0.0.1:8099',
      authToken: 'matrix-token',
      fetchImpl,
    });

    await expect(
      client.getDeliveryReadiness({ sourceAccountId: 'source-123', target: 'intex_agent' })
    ).resolves.toEqual({ status: 'ready' });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: 'Bearer matrix-token' },
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty('CF-Access-Client-Id');
  });

  it('sends messages with optional idempotency keys and maps send responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: 'sent', matrixEventId: '$event-123' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'setup_required', reason: 'missing target' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'sent' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, { status: 502 }))
      .mockRejectedValueOnce(new Error('socket hang up'));
    const client = createMatrixOutboundAdapterClient({
      baseUrl: 'https://matrix.example.test',
      authToken: 'secret',
      cloudflareAccessClientId: 'cf-client-id',
      cloudflareAccessClientSecret: 'cf-client-secret',
      fetchImpl,
    });

    await expect(
      client.sendMessage({
        sourceAccountId: 'source-123',
        target: 'intex_agent',
        text: 'hello',
        idempotencyKey: 'calendar:user-123:2026-07-04',
      })
    ).resolves.toEqual({ status: 'sent', matrixEventId: '$event-123' });
    await expect(
      client.sendMessage({ sourceAccountId: 'source-123', target: 'intex_agent', text: 'hello' })
    ).resolves.toEqual({ status: 'setup_required', reason: 'missing target' });
    await expect(
      client.sendMessage({ sourceAccountId: 'source-123', target: 'intex_agent', text: 'hello' })
    ).resolves.toEqual({
      status: 'error',
      message: 'Matrix adapter send response was invalid',
    });
    await expect(
      client.sendMessage({ sourceAccountId: 'source-123', target: 'intex_agent', text: 'hello' })
    ).resolves.toEqual({
      status: 'error',
      message: 'Matrix adapter send request failed with HTTP 502',
    });
    await expect(
      client.sendMessage({ sourceAccountId: 'source-123', target: 'intex_agent', text: 'hello' })
    ).resolves.toEqual({
      status: 'error',
      message: 'socket hang up',
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      sourceAccountId: 'source-123',
      target: 'intex_agent',
      text: 'hello',
      idempotencyKey: 'calendar:user-123:2026-07-04',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      sourceAccountId: 'source-123',
      target: 'intex_agent',
      text: 'hello',
    });
  });
});
