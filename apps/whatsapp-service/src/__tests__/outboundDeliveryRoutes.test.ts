import { vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';

const commonHttpState = vi.hoisted(() => ({
  logIncomingRequest: vi.fn(),
}));

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/common-http')>();
  return { ...actual, logIncomingRequest: commonHttpState.logIncomingRequest };
});

import { beforeEach, describe, expect, it, setupTestContext } from './testUtils.js';
import { getServices, setServices, type ServiceContainer } from '../services.js';
import type { WhatsAppDeliveryReadinessPort } from '../domain/whatsapp/ports/whatsappDeliveryReadiness.js';
import { outboundDeliveryBodyUsesAllowlist } from '../routes/outboundDeliveryRoutes.js';

const INTERNAL_HEADERS = { 'x-internal-auth': 'test-internal-token' } as const;

describe('WhatsApp delivery readiness and receipt routes', () => {
  const ctx = setupTestContext();
  const getReadiness = vi.fn<WhatsAppDeliveryReadinessPort['getReadiness']>();
  const getIdempotentDeliveryState = vi.fn();
  const authorizeIdempotentDeliveryRetry = vi.fn();

  beforeEach(() => {
    commonHttpState.logIncomingRequest.mockClear();
    getReadiness.mockReset().mockResolvedValue(
      ok({
        status: 'ready',
        maskedPrimaryNumber: '••••1234',
        observationVersion: 'observation-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      })
    );
    getIdempotentDeliveryState.mockReset().mockResolvedValue(ok({ status: 'pending' }));
    authorizeIdempotentDeliveryRetry
      .mockReset()
      .mockResolvedValue({ ok: true, disposition: 'applied' });
    Object.assign(ctx.outboundMessageRepository, {
      getIdempotentDeliveryState,
      authorizeIdempotentDeliveryRetry,
    });
    setServices({
      ...getServices(),
      whatsAppDeliveryReadiness: { getReadiness },
    } as ServiceContainer & { whatsAppDeliveryReadiness: WhatsAppDeliveryReadinessPort });
  });

  it.each([
    '/internal/whatsapp/delivery-readiness/get',
    '/internal/whatsapp/outbound-deliveries/get',
    '/internal/whatsapp/outbound-deliveries/retry',
  ])('requires internal auth for %s', async (url) => {
    const payload =
      url.endsWith('delivery-readiness/get')
        ? { userId: 'user-1' }
        : {
            userId: 'user-1',
            idempotencyKey: 'digest-run-1',
            ...(url.endsWith('/retry') ? { payloadDigest: 'a'.repeat(64) } : {}),
          };
    const response = await ctx.app.inject({ method: 'POST', url, payload });
    expect(response.statusCode).toBe(401);
    expect(getReadiness).not.toHaveBeenCalled();
    expect(getIdempotentDeliveryState).not.toHaveBeenCalled();
    expect(authorizeIdempotentDeliveryRetry).not.toHaveBeenCalled();
  });

  it.each(['applied', 'already_applied'] as const)(
    'authorizes a byte-identical outbound delivery retry for %s',
    async (disposition) => {
      authorizeIdempotentDeliveryRetry.mockResolvedValueOnce({ ok: true, disposition });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/whatsapp/outbound-deliveries/retry',
        headers: INTERNAL_HEADERS,
        payload: {
          userId: 'user-1',
          idempotencyKey: 'digest-run-1',
          payloadDigest: 'a'.repeat(64),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual({ authorized: true });
      expect(authorizeIdempotentDeliveryRetry).toHaveBeenCalledWith({
        userId: 'user-1',
        idempotencyKey: 'digest-run-1',
        payloadDigest: 'a'.repeat(64),
        now: expect.stringMatching(/^2026-|^2027-/u),
      });
      expect(response.body).not.toContain('digest-run-1');
      expect(response.body).not.toContain('user-1');
      expect(response.body).not.toContain('a'.repeat(64));
    }
  );

  it.each([
    { result: { ok: false, code: 'INVALID_INPUT' }, status: 400 },
    { result: { ok: false, code: 'NOT_FOUND' }, status: 404 },
    { result: { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' }, status: 409 },
    { result: { ok: false, code: 'INVALID_STATE' }, status: 409 },
    { result: { ok: false, code: 'CORRUPT_RECEIPT' }, status: 500 },
    { result: { ok: false, code: 'PERSISTENCE_ERROR' }, status: 500 },
  ])('maps retry repository code $result.code to $status', async ({ result, status }) => {
    authorizeIdempotentDeliveryRetry.mockResolvedValueOnce(result);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/outbound-deliveries/retry',
      headers: INTERNAL_HEADERS,
      payload: {
        userId: 'user-1',
        idempotencyKey: 'digest-run-1',
        payloadDigest: 'a'.repeat(64),
      },
    });

    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain('digest-run-1');
    expect(response.body).not.toContain('user-1');
    expect(response.body).not.toContain('a'.repeat(64));
  });

  it.each([
    {
      value: {
        status: 'ready' as const,
        maskedPrimaryNumber: '••••1234',
        observationVersion: 'ready-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    },
    {
      value: {
        status: 'mapping_missing' as const,
        observationVersion: 'missing-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    },
    {
      value: {
        status: 'disconnected' as const,
        observationVersion: 'disconnected-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    },
    {
      value: {
        status: 'delivery_disabled' as const,
        observationVersion: 'disabled-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    },
  ])('returns the closed readiness status $value.status', async ({ value }) => {
    getReadiness.mockResolvedValueOnce(ok(value));
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/delivery-readiness/get',
      headers: INTERNAL_HEADERS,
      payload: { userId: 'user-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual(value);
    expect(response.body).not.toContain('+481112221234');
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bodyPreviewLength: 0 })
    );
  });

  it.each([
    { value: { status: 'pending' as const } },
    {
      value: { status: 'sent' as const, acceptedAt: '2026-07-27T12:00:01.000Z' },
    },
    {
      value: { status: 'ambiguous' as const, acceptedAt: '2026-07-27T12:00:00.000Z' },
    },
    {
      value: {
        status: 'failed' as const,
        failedAt: '2026-07-27T12:00:01.000Z',
        failureCode: 'MAPPING_MISSING',
      },
    },
    { value: { status: 'missing' as const } },
  ])('returns the truthful outbound receipt status $value.status', async ({ value }) => {
    getIdempotentDeliveryState.mockResolvedValueOnce(ok(value));
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/outbound-deliveries/get',
      headers: INTERNAL_HEADERS,
      payload: { userId: 'user-1', idempotencyKey: 'digest-run-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual(value);
    expect(getIdempotentDeliveryState).toHaveBeenCalledWith({
      userId: 'user-1',
      idempotencyKey: 'digest-run-1',
    });
    expect(response.body).not.toContain('digest-run-1');
    expect(response.body).not.toContain('user-1');
  });

  it('maps safe dependency failures without reflecting private details', async () => {
    getReadiness.mockResolvedValueOnce(
      err({ code: 'PERSISTENCE_ERROR', message: 'private readiness detail' })
    );
    const readiness = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/delivery-readiness/get',
      headers: INTERNAL_HEADERS,
      payload: { userId: 'user-1' },
    });
    expect(readiness.statusCode).toBe(500);
    expect(readiness.body).not.toContain('private readiness detail');

    getIdempotentDeliveryState.mockResolvedValueOnce(
      err({ code: 'PERSISTENCE_ERROR', message: 'private receipt detail' })
    );
    const receipt = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/outbound-deliveries/get',
      headers: INTERNAL_HEADERS,
      payload: { userId: 'user-1', idempotencyKey: 'digest-run-1' },
    });
    expect(receipt.statusCode).toBe(500);
    expect(receipt.body).not.toContain('private receipt detail');
  });

  it.each([
    {
      url: '/internal/whatsapp/delivery-readiness/get',
      payload: { userId: 'user-1', extra: true },
    },
    {
      url: '/internal/whatsapp/outbound-deliveries/get',
      payload: { userId: 'user-1', idempotencyKey: 'digest-run-1', extra: true },
    },
    {
      url: '/internal/whatsapp/outbound-deliveries/retry',
      payload: {
        userId: 'user-1',
        idempotencyKey: 'digest-run-1',
        payloadDigest: 'a'.repeat(64),
        extra: true,
      },
    },
  ])('rejects additional fields for $url', async ({ url, payload }) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url,
      headers: INTERNAL_HEADERS,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('INVALID_REQUEST');
  });

  it('fails closed when delivery readiness is not configured', async () => {
    const services = { ...getServices() } as Partial<ServiceContainer>;
    delete services.whatsAppDeliveryReadiness;
    setServices(services as ServiceContainer);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/delivery-readiness/get',
      headers: INTERNAL_HEADERS,
      payload: { userId: 'user-1' },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error.code).toBe('INTERNAL_ERROR');
  });

  it('validates raw request bodies against the route allowlist without throwing', () => {
    const allowed = new Set(['userId']);

    expect(outboundDeliveryBodyUsesAllowlist(undefined, allowed)).toBe(false);
    expect(outboundDeliveryBodyUsesAllowlist('{', allowed)).toBe(false);
    expect(outboundDeliveryBodyUsesAllowlist('null', allowed)).toBe(false);
    expect(outboundDeliveryBodyUsesAllowlist('[]', allowed)).toBe(false);
    expect(outboundDeliveryBodyUsesAllowlist('{"userId":"user-1","extra":true}', allowed)).toBe(
      false
    );
    expect(outboundDeliveryBodyUsesAllowlist('{"userId":"user-1"}', allowed)).toBe(true);
  });
});
