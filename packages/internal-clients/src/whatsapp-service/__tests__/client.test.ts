import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWhatsAppServiceClient } from '../client.js';
import type { WhatsAppServiceClientConfig } from '../types.js';

const BASE_URL = 'http://whatsapp-service.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as WhatsAppServiceClientConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createWhatsAppServiceClient', () => {
  it('calls the matrix delivery-status endpoint with internal auth', async () => {
    const scope = nock(BASE_URL)
      .get('/internal/whatsapp/private/matrix-delivery-status/user-123')
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'ready',
          deliverable: true,
        },
      });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPrivateMatrixDeliveryStatus('user-123');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'ready',
        deliverable: true,
      },
    });
  });

  it('maps setup_required delivery-status responses', async () => {
    nock(BASE_URL)
      .get('/internal/whatsapp/private/matrix-delivery-status/user-123')
      .reply(200, {
        success: true,
        data: {
          status: 'setup_required',
          deliverable: false,
          reason: 'Private WhatsApp account is not configured',
        },
      });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPrivateMatrixDeliveryStatus('user-123');

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'setup_required',
        deliverable: false,
        reason: 'Private WhatsApp account is not configured',
      },
    });
  });

  it('posts outbound matrix messages with the expected body', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/whatsapp/private/outbound-matrix-messages', {
        userId: 'user-123',
        text: 'hello',
        startNewSession: true,
        idempotencyKey: 'calendar:user-123:2026-07-04',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'sent',
          matrixEventId: '$event-123',
        },
      });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.sendPrivateOutboundMatrixMessage({
      userId: 'user-123',
      text: 'hello',
      startNewSession: true,
      idempotencyKey: 'calendar:user-123:2026-07-04',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'sent',
        matrixEventId: '$event-123',
      },
    });
  });

  it('returns invalid response errors for malformed outbound message envelopes', async () => {
    nock(BASE_URL).post('/internal/whatsapp/private/outbound-matrix-messages').reply(200, {
      success: true,
    });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.sendPrivateOutboundMatrixMessage({
      userId: 'user-123',
      text: 'hello',
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Invalid response from whatsapp-service'),
    });
  });

  it('maps API errors from whatsapp-service', async () => {
    nock(BASE_URL)
      .get('/internal/whatsapp/private/matrix-delivery-status/user-123')
      .reply(503, {
        success: false,
        error: { code: 'UNAVAILABLE', message: 'service unavailable' },
      });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPrivateMatrixDeliveryStatus('user-123');

    expect(result).toEqual({
      ok: false,
      error: new Error('HTTP 503: Service Unavailable'),
    });
  });

  it('supports client default timeouts while posting outbound matrix messages', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/whatsapp/private/outbound-matrix-messages', {
        userId: 'user-123',
        text: 'hello',
      })
      .reply(200, {
        success: true,
        data: {
          status: 'setup_required',
          reason: 'Private WhatsApp account is not configured',
        },
      });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1_000,
    });
    const result = await client.sendPrivateOutboundMatrixMessage({
      userId: 'user-123',
      text: 'hello',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'setup_required',
        reason: 'Private WhatsApp account is not configured',
      },
    });
  });

  it('maps transport failures from whatsapp-service', async () => {
    nock(BASE_URL)
      .get('/internal/whatsapp/private/matrix-delivery-status/user-123')
      .replyWithError('socket hang up');

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPrivateMatrixDeliveryStatus('user-123');

    expect(result.ok).toBe(false);
  });
});
