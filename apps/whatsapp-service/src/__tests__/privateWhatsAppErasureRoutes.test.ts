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
import { emptyPrivateWhatsAppErasureCounts } from '../domain/whatsapp/models/PrivateWhatsAppErasure.js';
import type { PrivateWhatsAppErasureRepository } from '../domain/whatsapp/ports/privateWhatsAppErasure.js';

const request = {
  erasureRequestId: 'erase-1',
  userId: 'user-1',
  sourceAccountId: 'source-1',
  accountGeneration: 'generation-1',
  status: 'queued' as const,
  stage: 'assistant_sessions' as const,
  counts: emptyPrivateWhatsAppErasureCounts(),
  attempt: 0,
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
};

const ERASURE_CALLER_HEADERS = {
  'x-internal-auth': 'test-internal-token',
  'x-internal-caller-role': 'whatsapp_private_sync',
} as const;

describe('private WhatsApp physical erasure routes', () => {
  const ctx = setupTestContext();
  const repository: PrivateWhatsAppErasureRepository = {
    start: vi.fn(),
    get: vi.fn(),
    advanceOneBatch: vi.fn(),
    commitPrivateMediaBatch: vi.fn(),
  };
  const publishPrivateWhatsAppErasure = vi.fn();

  beforeEach(() => {
    commonHttpState.logIncomingRequest.mockClear();
    vi.mocked(repository.start).mockReset().mockResolvedValue(
      ok({ status: 'created', request })
    );
    vi.mocked(repository.get).mockReset().mockResolvedValue(ok(request));
    vi.mocked(repository.advanceOneBatch).mockReset();
    vi.mocked(repository.commitPrivateMediaBatch).mockReset();
    publishPrivateWhatsAppErasure.mockReset().mockResolvedValue(ok(undefined));
    Object.assign(ctx.eventPublisher, { publishPrivateWhatsAppErasure });
    setServices({
      ...getServices(),
      privateWhatsAppErasureRepository: repository,
      privateWhatsAppErasurePublisher: { publishPrivateWhatsAppErasure },
    } as ServiceContainer & { privateWhatsAppErasureRepository: PrivateWhatsAppErasureRepository });
  });

  it('starts durable erasure and returns only a content-free status projection', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      headers: ERASURE_CALLER_HEADERS,
      payload: { userId: 'user-1', erasureRequestId: 'erase-1' },
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body).data).toEqual({
      status: 'queued',
      stage: 'assistant_sessions',
      counts: emptyPrivateWhatsAppErasureCounts(),
      attempt: 0,
      createdAt: '2026-07-21T10:00:00.000Z',
      updatedAt: '2026-07-21T10:00:00.000Z',
    });
    expect(response.body).not.toContain('source-1');
    expect(response.body).not.toContain('user-1');
    expect(response.body).not.toContain('erase-1');
    expect(response.body).not.toContain('generation-1');
    expect(repository.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccountId: 'source-1',
        userId: 'user-1',
        erasureRequestId: 'erase-1',
      })
    );
    expect(publishPrivateWhatsAppErasure).toHaveBeenCalledOnce();
  });

  it.each([
    { start: ok({ status: 'not_found' as const }), statusCode: 404, code: 'NOT_FOUND' },
    { start: ok({ status: 'conflict' as const }), statusCode: 409, code: 'CONFLICT' },
    {
      start: err({ code: 'PERSISTENCE_ERROR' as const, message: 'private detail' }),
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    },
  ])('maps start outcome to stable HTTP $statusCode', async ({ start, statusCode, code }) => {
    vi.mocked(repository.start).mockResolvedValueOnce(start);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      headers: ERASURE_CALLER_HEADERS,
      payload: { userId: 'user-1', erasureRequestId: 'erase-1' },
    });

    expect(response.statusCode).toBe(statusCode);
    expect(JSON.parse(response.body).error.code).toBe(code);
    expect(response.body).not.toContain('private detail');
  });

  it('gets status by source and request id without requiring userId', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/accounts/source-1/erasure/erase-1',
      headers: ERASURE_CALLER_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(repository.get).toHaveBeenCalledWith({
      sourceAccountId: 'source-1',
      erasureRequestId: 'erase-1',
    });
    expect(JSON.parse(response.body).data).not.toHaveProperty('userId');
    expect(JSON.parse(response.body).data).not.toHaveProperty('erasureRequestId');
    expect(JSON.parse(response.body).data).not.toHaveProperty('accountGeneration');
  });

  it.each([
    {
      completedAt: '2026-07-21T10:02:00.000Z',
      expected: { completedAt: '2026-07-21T10:02:00.000Z' },
    },
    {
      failureCode: 'ACCOUNT_GENERATION_CHANGED' as const,
      expected: { failureCode: 'ACCOUNT_GENERATION_CHANGED' },
    },
  ])('projects terminal status metadata without internal identifiers', async (terminal) => {
    vi.mocked(repository.get).mockResolvedValueOnce(
      ok({ ...request, ...terminal, status: terminal.completedAt === undefined ? 'failed' : 'completed' })
    );

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/accounts/source-1/erasure/erase-1',
      headers: ERASURE_CALLER_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toMatchObject(terminal.expected);
  });

  it('returns a stable configuration error when an erasure dependency is absent', async () => {
    const configured = getServices();
    const {
      conversationAssistantOperationalTelemetry: _conversationAssistantOperationalTelemetry,
      ...withoutTelemetry
    } = configured;
    setServices(withoutTelemetry);
    const withoutMetrics = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      headers: ERASURE_CALLER_HEADERS,
      payload: { userId: 'user-1', erasureRequestId: 'erase-1' },
    });
    expect(withoutMetrics.statusCode).toBe(202);

    const {
      privateWhatsAppErasurePublisher: _privateWhatsAppErasurePublisher,
      ...withoutPublisher
    } = configured;
    setServices(withoutPublisher);
    const start = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      headers: ERASURE_CALLER_HEADERS,
      payload: { userId: 'user-1', erasureRequestId: 'erase-1' },
    });
    expect(start.statusCode).toBe(500);

    const {
      privateWhatsAppErasureRepository: _privateWhatsAppErasureRepository,
      ...withoutRepository
    } = configured;
    setServices(withoutRepository);
    const status = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/accounts/source-1/erasure/erase-1',
      headers: ERASURE_CALLER_HEADERS,
    });
    expect(status.statusCode).toBe(500);
  });

  it('uses ownership-hidden not-found and stable persistence errors for status', async () => {
    vi.mocked(repository.get).mockResolvedValueOnce(ok(null));
    const hidden = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/accounts/foreign-source/erasure/erase-1',
      headers: ERASURE_CALLER_HEADERS,
    });
    expect(hidden.statusCode).toBe(404);
    expect(JSON.parse(hidden.body).error.code).toBe('NOT_FOUND');

    vi.mocked(repository.get).mockResolvedValueOnce(
      err({ code: 'PERSISTENCE_ERROR', message: 'private status detail' })
    );
    const failed = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/accounts/source-1/erasure/erase-1',
      headers: ERASURE_CALLER_HEADERS,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain('private status detail');
  });

  it('requires internal auth and validates non-empty ids without invoking the repository', async () => {
    const unauthenticated = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      payload: { userId: 'user-1', erasureRequestId: 'erase-1' },
    });
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      headers: ERASURE_CALLER_HEADERS,
      payload: { userId: '', erasureRequestId: '' },
    });
    const unauthenticatedStatus = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/accounts/source-1/erasure/erase-1',
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticatedStatus.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
    expect(repository.start).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'POST without caller role',
      method: 'POST' as const,
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { userId: 'user-1', erasureRequestId: 'erase-1' },
    },
    {
      name: 'POST with unrelated caller role',
      method: 'POST' as const,
      url: '/internal/whatsapp/private/accounts/source-1/erasure',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-internal-caller-role': 'scheduler',
      },
      payload: { userId: 'user-1', erasureRequestId: 'erase-1' },
    },
    {
      name: 'GET without caller role',
      method: 'GET' as const,
      url: '/internal/whatsapp/private/accounts/source-1/erasure/erase-1',
      headers: { 'x-internal-auth': 'test-internal-token' },
    },
    {
      name: 'GET with unrelated caller role',
      method: 'GET' as const,
      url: '/internal/whatsapp/private/accounts/source-1/erasure/erase-1',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-internal-caller-role': 'whatsapp_service',
      },
    },
  ])('denies $name even with the shared internal token', async ({ method, url, headers, payload }) => {
    const response = await ctx.app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('FORBIDDEN');
    expect(repository.start).not.toHaveBeenCalled();
    expect(repository.get).not.toHaveBeenCalled();
  });

  it('logs only a stable route label and never the body or dynamic ids', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/accounts/source-secret/erasure',
      headers: ERASURE_CALLER_HEADERS,
      payload: { userId: 'user-secret', erasureRequestId: 'request-secret' },
    });

    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: { route: 'internal_whatsapp_private_account_erasure' },
      })
    );
    const logOptions = commonHttpState.logIncomingRequest.mock.calls[0]?.[1];
    expect(JSON.stringify(logOptions)).not.toContain('source-secret');
    expect(JSON.stringify(logOptions)).not.toContain('user-secret');
    expect(JSON.stringify(logOptions)).not.toContain('request-secret');
  });
});
