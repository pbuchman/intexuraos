import type { FastifyInstance } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '../domain/models/messageDigestDefinition.js';
import type { MessageDigestErasureRequest } from '../domain/models/messageDigestErasure.js';
import type { MessageDigestRun } from '../domain/models/messageDigestRun.js';
import type {
  MessageDigestAggregator,
  MessageDigestWhatsAppClient,
} from '../domain/ports/messageDigestClients.js';
import type { MessageDigestStore } from '../domain/ports/messageDigestStore.js';
import { buildServer } from '../server.js';
import { toPublicDefinition, toPublicRun } from '../routes/messageDigestRoutes.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ userId: 'synthetic-user-001', claims: {} }),
    logIncomingRequest: vi.fn(),
  };
});

describe('Message Digest public routes', () => {
  let app: FastifyInstance;
  let store: MessageDigestStore;
  let whatsappClient: MessageDigestWhatsAppClient;
  let aggregator: MessageDigestAggregator;

  beforeEach(async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'synthetic-user-001', claims: {} });
    vi.mocked(logIncomingRequest).mockClear();
    store = fakeStore();
    whatsappClient = fakeWhatsAppClient();
    aggregator = fakeAggregator();
    setServices({
      config: {} as never,
      logger: {} as never,
      firestore: {} as never,
      whatsappServiceClient: {} as never,
      messageDigestStore: store,
      messageDigestWhatsAppClient: whatsappClient,
      usageSink: {} as never,
      messageDigestAggregator: aggregator,
      pubsub: {} as never,
      messageDigestRunPublisher: {
        publish: vi.fn(async () => ({ ok: true as const, messageId: 'run-001' })),
      },
      whatsappSendPublisher: {
        publish: vi.fn(async () => ({ ok: true as const, messageId: 'send-001' })),
      },
      runPreparationTokens: fakePreparationTokens(),
    } satisfies ServiceContainer);
    app = await buildServer({ healthChecks: [] });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  it('requires authentication and documents every MVP CRUD endpoint', async () => {
    vi.mocked(requireAuth).mockImplementation(async (_request, reply) => {
      await reply.fail('UNAUTHORIZED', 'Authentication required');
      return null;
    });
    const unauthorized = await app.inject({ method: 'GET', url: '/' });
    expect(unauthorized.statusCode).toBe(401);

    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
    const paths = Object.keys(openApi.json().paths as Record<string, unknown>);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/',
        '/{definitionId}',
        '/erasures/{erasureRequestId}',
        '/erasures/{erasureRequestId}/resume',
        '/delivery-readiness',
        '/schedule-preview',
        '/preview',
        '/{definitionId}/run/prepare',
        '/{definitionId}/run',
        '/{definitionId}/runs',
        '/{definitionId}/runs/{runId}',
        '/{definitionId}/runs/{runId}/retry',
      ])
    );
  });

  it('creates a digest with an idempotency header and returns only the public projection', async () => {
    vi.spyOn(store, 'getOwnedDefinition').mockResolvedValueOnce(null);
    const createDefinition = vi.spyOn(store, 'createDefinition');
    const response = await app.inject({
      method: 'POST',
      url: '/',
      headers: { authorization: 'Bearer test-token', 'idempotency-key': 'client-request-0001' },
      payload: {
        status: 'active',
        name: 'Fishing daily',
        source: { chatId: 'synthetic-chat-001' },
        instructions: {
          templateId: 'fishing_group',
          text: 'Create the fishing-group summary with decisions, plans, catches, and follow-ups.',
        },
        schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        disposition: 'created',
        activationAdjusted: null,
        definition: {
          id: expect.stringMatching(/^md_/u),
          name: 'Fishing daily',
          source: {
            chatId: 'synthetic-chat-001',
            chatType: 'group',
            displayName: 'Fishing friends',
            messageCount: 123,
            participantCount: 8,
            lastActivityAt: '2026-07-27T11:00:00.000Z',
          },
          delivery: { type: 'whatsapp_primary' },
        },
      },
    });
    expect(response.body).not.toContain('synthetic-user-001');
    expect(response.body).not.toContain('synthetic-account-001');
    expect(response.body).not.toContain('createRequestIdDigest');
    expect(createDefinition).toHaveBeenCalledOnce();
  });

  it('enforces the 80-character name bound in requests and OpenAPI', async () => {
    vi.spyOn(store, 'getOwnedDefinition').mockResolvedValue(null);
    const payload = {
      status: 'paused',
      source: { chatId: 'synthetic-chat-001' },
      instructions: {
        templateId: 'custom',
        text: 'Summarize the important decisions and follow-ups from this chat.',
      },
      schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    };
    const accepted = await app.inject({
      method: 'POST',
      url: '/',
      headers: { 'idempotency-key': 'client-request-name-0080' },
      payload: { ...payload, name: 'n'.repeat(80) },
    });
    const rejected = await app.inject({
      method: 'POST',
      url: '/',
      headers: { 'idempotency-key': 'client-request-name-0081' },
      payload: { ...payload, name: 'n'.repeat(81) },
    });
    expect(accepted.statusCode).toBe(201);
    expect(rejected.statusCode).toBe(400);

    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json() as {
      paths: Record<
        string,
        { post?: { requestBody?: { content?: Record<string, { schema?: unknown }> } } }
      >;
    };
    expect(
      document.paths['/']?.post?.requestBody?.content?.['application/json']?.schema
    ).toMatchObject({ properties: { name: { maxLength: 80 } } });
  });

  it('logs only the stable public route template and never the request body or identifiers', async () => {
    vi.spyOn(store, 'getOwnedDefinition').mockResolvedValueOnce(null);
    const response = await app.inject({
      method: 'POST',
      url: '/',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'private-request-identifier',
      },
      payload: {
        status: 'paused',
        name: 'Private digest name',
        source: { chatId: 'private-chat-identifier' },
        instructions: {
          templateId: 'custom',
          text: 'Private prompt that must never be written to a request log.',
        },
        schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(logIncomingRequest).toHaveBeenCalledOnce();
    expect(vi.mocked(logIncomingRequest).mock.calls[0]?.[1]).toEqual({
      message: 'Message Digest public request',
      bodyPreviewLength: 0,
      includeHeaders: false,
      includeParams: false,
      additionalFields: {
        method: 'POST',
        route: '/',
      },
    });
    const loggedOptions = JSON.stringify(vi.mocked(logIncomingRequest).mock.calls[0]?.[1]);
    expect(loggedOptions).not.toContain('private-request-identifier');
    expect(loggedOptions).not.toContain('private-chat-identifier');
    expect(loggedOptions).not.toContain('Private prompt');
  });

  it('rejects missing idempotency and unknown body fields before writing', async () => {
    const createDefinition = vi.spyOn(store, 'createDefinition');
    const payload = {
      status: 'active',
      name: 'Fishing daily',
      source: { chatId: 'synthetic-chat-001' },
      instructions: {
        templateId: 'fishing_group',
        text: 'Create the fishing-group summary with decisions, plans, catches, and follow-ups.',
      },
      schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    };
    const missing = await app.inject({ method: 'POST', url: '/', payload });
    const extra = await app.inject({
      method: 'POST',
      url: '/',
      headers: { 'idempotency-key': 'client-request-0001' },
      payload: { ...payload, recipientPhoneNumber: '+48000000000' },
    });
    expect(missing.statusCode).toBe(400);
    expect(extra.statusCode).toBe(400);
    expect(createDefinition).not.toHaveBeenCalled();
  });

  it('lists with exact filters and never trusts a user ID from the request', async () => {
    const listOwnedDefinitions = vi.spyOn(store, 'listOwnedDefinitions');
    const response = await app.inject({
      method: 'GET',
      url: '/?query=Fishing&chatType=group&status=active&sort=name&direction=asc&limit=7',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [{ id: 'md_definition_001' }], nextCursor: null },
    });
    expect(listOwnedDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'synthetic-user-001',
        query: 'fishing',
        chatType: 'group',
        status: 'active',
        sort: 'name',
        direction: 'asc',
        limit: 7,
      })
    );
  });

  it('maps invalid list cursors and unavailable delivery readiness to safe errors', async () => {
    vi.spyOn(store, 'listOwnedDefinitions').mockRejectedValueOnce(new Error('INVALID_CURSOR'));
    const invalidCursor = await app.inject({
      method: 'GET',
      url: '/?cursor=opaque-invalid-cursor',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json()).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        details: { reason: 'INVALID_CURSOR', restartPagination: true },
      },
    });

    vi.spyOn(whatsappClient, 'getDeliveryReadiness').mockResolvedValueOnce({
      ok: false,
      code: 'unavailable',
    });
    const unavailableReadiness = await app.inject({
      method: 'GET',
      url: '/delivery-readiness',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(unavailableReadiness.statusCode).toBe(502);
    expect(unavailableReadiness.json()).toMatchObject({
      success: false,
      error: { code: 'DOWNSTREAM_ERROR' },
    });

    vi.spyOn(whatsappClient, 'validateSource').mockResolvedValueOnce({
      ok: false,
      code: 'not_found',
    });
    vi.spyOn(store, 'getOwnedDefinition').mockResolvedValueOnce(null);
    const missingSource = await app.inject({
      method: 'POST',
      url: '/',
      headers: { 'idempotency-key': 'client-request-missing-source-001' },
      payload: {
        status: 'paused',
        name: 'Missing source',
        ...previewPayload(),
      },
    });
    expect(missingSource.statusCode).toBe(404);
    expect(missingSource.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('returns the same 404 for foreign and missing definitions', async () => {
    vi.spyOn(store, 'getOwnedDefinition').mockResolvedValue(null);
    const response = await app.inject({
      method: 'GET',
      url: '/md_foreign_or_missing',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Message Digest not found' },
    });
  });

  it('returns and updates an owned definition through the public projection', async () => {
    const current = await app.inject({
      method: 'GET',
      url: '/md_definition_001',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      success: true,
      data: { definition: { id: 'md_definition_001', name: 'Fishing daily' } },
    });

    const updated = await app.inject({
      method: 'PATCH',
      url: '/md_definition_001',
      headers: { authorization: 'Bearer test-token' },
      payload: { expectedRevision: 1, patch: { name: 'Fishing every morning' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      success: true,
      data: {
        definition: {
          id: 'md_definition_001',
          name: 'Fishing every morning',
          revision: 2,
        },
      },
    });
  });

  it('maps stale PATCH revisions to a refreshable conflict', async () => {
    vi.spyOn(store, 'updateDefinition').mockResolvedValue({ ok: false, code: 'REVISION_CONFLICT' });
    const response = await app.inject({
      method: 'PATCH',
      url: '/md_definition_001',
      headers: { authorization: 'Bearer test-token' },
      payload: { expectedRevision: 1, patch: { name: 'Renamed digest' } },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'CONFLICT',
        details: { reason: 'REVISION_CONFLICT', refreshRequired: true },
      },
    });
  });

  it('maps an in-progress pause to an actionable refreshable conflict', async () => {
    vi.spyOn(store, 'updateDefinition').mockResolvedValue({
      ok: false,
      code: 'RUN_IN_PROGRESS',
    });
    const response = await app.inject({
      method: 'PATCH',
      url: '/md_definition_001',
      headers: { authorization: 'Bearer test-token' },
      payload: { expectedRevision: 1, patch: { status: 'paused' } },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'CONFLICT',
        details: { reason: 'RUN_IN_PROGRESS', refreshRequired: true },
      },
    });
  });

  it('advances bounded deletion through DELETE and keeps GET read-only', async () => {
    const erase = vi.spyOn(store, 'startOrResumeDefinitionErasure');
    const read = vi.spyOn(store, 'getOwnedErasureRequest');
    const deletion = await app.inject({
      method: 'DELETE',
      url: '/md_definition_001',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'client-delete-request-001',
      },
    });
    expect(deletion.statusCode).toBe(202);
    expect(deletion.json()).toMatchObject({
      success: true,
      data: { erasure: { status: 'in_progress', nextAction: 'resume_delete' } },
    });
    expect(erase).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));

    const erasureId = deletion.json().data.erasure.erasureRequestId as string;
    const recovery = await app.inject({
      method: 'GET',
      url: `/erasures/${erasureId}`,
      headers: { authorization: 'Bearer test-token' },
    });
    expect(recovery.statusCode).toBe(200);
    expect(read).toHaveBeenCalledOnce();
    expect(erase).toHaveBeenCalledOnce();

    const resumed = await app.inject({
      method: 'POST',
      url: `/erasures/${erasureId}/resume`,
      headers: { authorization: 'Bearer test-token' },
    });
    expect(resumed.statusCode).toBe(202);
    expect(resumed.json()).toMatchObject({
      success: true,
      data: {
        erasure: {
          erasureRequestId: 'mde_request_001',
          definitionId: 'md_definition_001',
          status: 'in_progress',
        },
      },
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(erase).toHaveBeenCalledTimes(2);
  });

  it('returns the same not found response when erasure resume is missing or foreign', async () => {
    vi.spyOn(store, 'getOwnedErasureRequest').mockResolvedValueOnce(null);
    const mutation = vi.spyOn(store, 'startOrResumeDefinitionErasure');
    const response = await app.inject({
      method: 'POST',
      url: '/erasures/mde_private_or_missing/resume',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
    expect(mutation).not.toHaveBeenCalled();
  });

  it('maps bounded failures and completed replay status across public lifecycle routes', async () => {
    const erasureMutation = vi.spyOn(store, 'startOrResumeDefinitionErasure');
    erasureMutation.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const failedDelete = await app.inject({
      method: 'DELETE',
      url: '/md_definition_001',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'client-delete-failure-001',
      },
    });
    expect(failedDelete.statusCode).toBe(404);

    const erasureRead = vi.spyOn(store, 'getOwnedErasureRequest');
    erasureRead.mockResolvedValueOnce(null);
    const missingErasure = await app.inject({
      method: 'GET',
      url: '/erasures/mde_missing_request',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(missingErasure.statusCode).toBe(404);

    erasureMutation.mockResolvedValueOnce({
      ok: true,
      status: 'completed',
      deletedThisCall: 0,
      request: erasureRequest({ stage: 'completed', completedAt: '2026-07-27T12:05:00.000Z' }),
    });
    const completedResume = await app.inject({
      method: 'POST',
      url: '/erasures/mde_request_001/resume',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(completedResume.statusCode).toBe(200);

    const systemClockPreview = await app.inject({
      method: 'POST',
      url: '/schedule-preview',
      headers: { authorization: 'Bearer test-token' },
      payload: { schedule: { kind: 'daily', localTime: '09:00', timeZone: 'UTC' } },
    });
    expect(systemClockPreview.statusCode).toBe(200);
    const invalidSchedule = await app.inject({
      method: 'POST',
      url: '/schedule-preview',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Invalid/TimeZone' },
      },
    });
    expect(invalidSchedule.statusCode).toBe(400);

    const getRunContext = vi.spyOn(store, 'getOwnedRunContext');
    getRunContext.mockResolvedValueOnce(null);
    const failedPreparation = await app.inject({
      method: 'POST',
      url: '/md_definition_001/run/prepare',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(failedPreparation.statusCode).toBe(404);

    getRunContext.mockResolvedValueOnce(null);
    const failedReservation = await app.inject({
      method: 'POST',
      url: '/md_definition_001/run',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'manual-failure-request-001',
      },
      payload: { preparationToken: 'synthetic-preparation-token' },
    });
    expect(failedReservation.statusCode).toBe(404);

    vi.spyOn(store, 'listOwnedRuns').mockRejectedValueOnce(new Error('INVALID_CURSOR'));
    const invalidHistoryCursor = await app.inject({
      method: 'GET',
      url: '/md_definition_001/runs?cursor=invalid-signed-cursor',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(invalidHistoryCursor.statusCode).toBe(400);

    const missingRun = await app.inject({
      method: 'GET',
      url: '/md_definition_001/runs/mdr_missing_run',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(missingRun.statusCode).toBe(404);
    const failedRetry = await app.inject({
      method: 'POST',
      url: '/md_definition_001/runs/mdr_missing_run/retry',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'retry-missing-request-001',
      },
    });
    expect(failedRetry.statusCode).toBe(404);
  });

  it('returns current delivery readiness and backend schedule preview', async () => {
    const readiness = await app.inject({
      method: 'GET',
      url: '/delivery-readiness',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({
      success: true,
      data: { readiness: { status: 'ready', maskedPrimaryNumber: '+48•••123' } },
    });

    const preview = await app.inject({
      method: 'POST',
      url: '/schedule-preview',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
        evaluatedAt: '2026-07-27T12:00:00.000Z',
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      success: true,
      data: {
        preview: {
          precedingBoundary: '2026-07-27T07:00:00.000Z',
          nextBoundary: '2026-07-28T07:00:00.000Z',
        },
      },
    });
  });

  it.each([
    [
      { kind: 'weekdays', localTime: '09:00', timeZone: 'Europe/Warsaw' },
      '2026-07-31T07:00:00.000Z',
      '2026-08-03T07:00:00.000Z',
    ],
    [
      {
        kind: 'weekly',
        weekday: 'wednesday',
        localTime: '09:00',
        timeZone: 'Europe/Warsaw',
      },
      '2026-07-29T07:00:00.000Z',
      '2026-08-05T07:00:00.000Z',
    ],
  ] as const)('previews the complete calendar schedule %#', async (schedule, preceding, next) => {
    const preview = await app.inject({
      method: 'POST',
      url: '/schedule-preview',
      headers: { authorization: 'Bearer test-token' },
      payload: { schedule, evaluatedAt: '2026-07-31T12:00:00.000Z' },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      success: true,
      data: { preview: { precedingBoundary: preceding, nextBoundary: next } },
    });
  });

  it.each([
    { kind: 'weekly', localTime: '09:00', timeZone: 'UTC' },
    { kind: 'weekly', weekday: 'funday', localTime: '09:00', timeZone: 'UTC' },
    { kind: 'daily', weekday: 'monday', localTime: '09:00', timeZone: 'UTC' },
    { kind: 'weekdays', weekday: 'monday', localTime: '09:00', timeZone: 'UTC' },
  ])('rejects schedule fields that do not match their cadence %#', async (schedule) => {
    const response = await app.inject({
      method: 'POST',
      url: '/schedule-preview',
      headers: { authorization: 'Bearer test-token' },
      payload: { schedule, evaluatedAt: '2026-07-31T12:00:00.000Z' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('publishes all calendar schedule variants and weekdays in OpenAPI', async () => {
    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
    const document = JSON.stringify(openApi.json());

    expect(document).toContain('weekdays');
    expect(document).toContain('weekly');
    for (const weekday of [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]) {
      expect(document).toContain(`"${weekday}"`);
    }
  });

  it('previews the unsaved form without persistence, delivery, or internal metadata exposure', async () => {
    vi.spyOn(whatsappClient, 'queryMessages').mockResolvedValue({
      ok: true,
      value: {
        messages: [
          {
            messageRef: 'a'.repeat(64),
            eventTimestamp: '2026-07-27T08:00:00.000Z',
            direction: 'inbound',
            authorLabel: 'Synthetic participant',
            text: 'We agreed on tomorrow morning.',
            contentKind: 'text',
          },
        ],
        sourceRevision: 'opaque-source-revision',
        highWatermark: 'opaque-high-watermark',
        nextCursor: null,
      },
    });
    const aggregate = vi.spyOn(aggregator, 'aggregate').mockResolvedValue({
      ok: true,
      kind: 'aggregate',
      aggregate: {
        headline: 'Tomorrow morning agreed',
        summaryMarkdown: '- The participants agreed on tomorrow morning.',
        evidenceMessageRefs: ['a'.repeat(64)],
        continuityMemoryMarkdown: 'Private continuity memory.',
      },
      metadata: {
        effectiveMessageCount: 1,
        promptVersion: '1.0.0',
        model: 'or:synthetic/model',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
    });
    const writes = [
      vi.spyOn(store, 'createDefinition'),
      vi.spyOn(store, 'updateDefinition'),
      vi.spyOn(store, 'reserveRun'),
      vi.spyOn(store, 'completeRun'),
      vi.spyOn(store, 'failRun'),
      vi.spyOn(store, 'claimDispatch'),
      vi.spyOn(store, 'recordDispatchResult'),
      vi.spyOn(store, 'startOrResumeDefinitionErasure'),
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/preview',
      headers: { authorization: 'Bearer test-token' },
      payload: previewPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        preview: {
          status: 'generated',
          window: {
            start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
            end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
            timeZone: 'Europe/Warsaw',
          },
          source: { chatType: 'group', displayName: 'Fishing friends' },
          deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '+48•••123' },
          messageCount: 1,
          content: {
            headline: 'Tomorrow morning agreed',
            summaryMarkdown: '- The participants agreed on tomorrow morning.',
          },
        },
      },
    });
    expect(response.body).not.toContain('opaque-source-revision');
    expect(response.body).not.toContain('opaque-high-watermark');
    expect(response.body).not.toContain('continuityMemoryMarkdown');
    expect(response.body).not.toContain('costUsd');
    expect(response.body).not.toContain('aaaaaaaaaaaaaaaa');
    expect(aggregate).toHaveBeenCalledOnce();
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it('rejects recipient configuration before previewing and maps a changed snapshot safely', async () => {
    const validateSource = vi.spyOn(whatsappClient, 'validateSource');
    const aggregate = vi.spyOn(aggregator, 'aggregate');
    const invalid = await app.inject({
      method: 'POST',
      url: '/preview',
      headers: { authorization: 'Bearer test-token' },
      payload: { ...previewPayload(), recipientPhoneNumber: '+48000000000' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(validateSource).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();

    vi.spyOn(whatsappClient, 'queryMessages').mockResolvedValue({
      ok: false,
      code: 'source_changed',
    });
    const changed = await app.inject({
      method: 'POST',
      url: '/preview',
      headers: { authorization: 'Bearer test-token' },
      payload: previewPayload(),
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({
      success: false,
      error: { code: 'CONFLICT', details: { reason: 'SOURCE_CHANGED' } },
    });
    expect(changed.body).not.toContain('source_changed');
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('prepares and reserves the exact manual window without accepting a recipient', async () => {
    const prepared = await app.inject({
      method: 'POST',
      url: '/md_definition_001/run/prepare',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({
      success: true,
      data: {
        preparation: {
          token: 'synthetic-preparation-token',
          deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '+48•••123' },
        },
      },
    });
    expect(prepared.body).not.toContain('recipient');

    vi.spyOn(store, 'reserveRun').mockImplementation(async (input) => ({
      ok: true,
      disposition: 'reserved',
      run: input.run,
    }));
    const reserved = await app.inject({
      method: 'POST',
      url: '/md_definition_001/run',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'manual-request-001',
      },
      payload: { preparationToken: 'synthetic-preparation-token' },
    });
    expect(reserved.statusCode).toBe(202);
    expect(reserved.json()).toMatchObject({
      success: true,
      data: {
        disposition: 'reserved',
        run: { id: expect.stringMatching(/^mdr_/u), generationStatus: 'queued' },
      },
    });
    expect(reserved.body).not.toContain('recipient');
    expect(reserved.body).not.toContain('sourceAccountId');

    vi.spyOn(store, 'claimDispatch').mockResolvedValueOnce({
      ok: false,
      code: 'CLAIM_BUSY',
    });
    const contendedDispatch = await app.inject({
      method: 'POST',
      url: '/md_definition_001/run',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'manual-request-002',
      },
      payload: { preparationToken: 'synthetic-preparation-token' },
    });
    expect(contendedDispatch.statusCode).toBe(202);
    expect(contendedDispatch.json()).toMatchObject({
      success: true,
      data: { disposition: 'reserved', dispatchDisposition: 'deferred' },
    });
  });

  it('returns cursor history and a sanitized truthful run detail', async () => {
    const run = completedRun();
    vi.spyOn(store, 'listOwnedRuns').mockResolvedValueOnce({
      items: [run],
      nextCursor: 'opaque-next',
    });
    vi.spyOn(store, 'getOwnedRun').mockResolvedValueOnce(run);

    const history = await app.inject({
      method: 'GET',
      url: '/md_definition_001/runs?limit=10&generationStatus=completed',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      success: true,
      data: {
        items: [{ id: 'mdr_run_001', delivery: { status: 'sent' } }],
        nextCursor: 'opaque-next',
      },
    });

    const detail = await app.inject({
      method: 'GET',
      url: '/md_definition_001/runs/mdr_run_001',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      success: true,
      data: {
        run: {
          id: 'mdr_run_001',
          content: { headline: 'Synthetic result', summaryMarkdown: '- A bounded fact.' },
          delivery: { status: 'sent', acceptedAt: '2026-07-27T12:03:00.000Z' },
        },
      },
    });
    expect(detail.body).not.toContain('sourceAccountId');
    expect(detail.body).not.toContain('generationId');
    expect(detail.body).not.toContain('requestIdDigest');
    expect(detail.body).not.toContain('idempotencyKey');
  });

  it('retries the same failed run with a stable client request and a sanitized response', async () => {
    const failed = completedRun();
    failed.generationStatus = 'failed';
    failed.processingStage = 'failed';
    failed.safeFailureCode = 'LLM_UNAVAILABLE';
    failed.completedAt = null;
    failed.delivery.status = 'not_sent';
    failed.delivery.acceptedAt = null;
    vi.spyOn(store, 'getOwnedRun').mockResolvedValueOnce(failed);
    const retryFailedGeneration = vi
      .spyOn(store, 'retryFailedGeneration')
      .mockImplementationOnce(async (input) => ({
        ok: true,
        disposition: 'retried',
        run: {
          ...failed,
          generationStatus: 'queued',
          processingStage: 'queued',
          safeFailureCode: null,
          updatedAt: input.retriedAt,
        },
      }));
    const claimDispatch = vi.spyOn(store, 'claimDispatch');

    const response = await app.inject({
      method: 'POST',
      url: '/md_definition_001/runs/mdr_run_001/retry',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'retry-request-0001',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        disposition: 'retried',
        stage: 'generation',
        run: { id: 'mdr_run_001', generationStatus: 'queued' },
      },
    });
    expect(retryFailedGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        outbox: expect.objectContaining({ kind: 'run_request', runId: 'mdr_run_001' }),
      })
    );
    expect(claimDispatch).toHaveBeenCalledOnce();
    expect(response.body).not.toContain('synthetic-user-001');
    expect(response.body).not.toContain('requestIdDigest');
    expect(response.body).not.toContain('idempotencyKey');
  });

  it('requires a retry idempotency key before reading or writing a run', async () => {
    const getOwnedRun = vi.spyOn(store, 'getOwnedRun');
    const retryFailedGeneration = vi.spyOn(store, 'retryFailedGeneration');

    const response = await app.inject({
      method: 'POST',
      url: '/md_definition_001/runs/mdr_run_001/retry',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(getOwnedRun).not.toHaveBeenCalled();
    expect(retryFailedGeneration).not.toHaveBeenCalled();
  });

  it('requires authentication independently on every public operation', async () => {
    vi.mocked(requireAuth).mockImplementation(async (_request, reply) => {
      await reply.fail('UNAUTHORIZED', 'Authentication required');
      return null;
    });
    const authorizedHeaders = { authorization: 'Bearer test-token' };
    const cases: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      url: string;
      headers?: Record<string, string>;
      payload?: Record<string, unknown>;
    }[] = [
      { method: 'GET', url: '/' },
      {
        method: 'POST',
        url: '/',
        headers: { ...authorizedHeaders, 'idempotency-key': 'client-request-0001' },
        payload: {
          status: 'active',
          name: 'Fishing daily',
          ...previewPayload(),
        },
      },
      { method: 'GET', url: '/md_definition_001' },
      {
        method: 'PATCH',
        url: '/md_definition_001',
        payload: { expectedRevision: 1, patch: { name: 'Renamed digest' } },
      },
      {
        method: 'DELETE',
        url: '/md_definition_001',
        headers: { ...authorizedHeaders, 'idempotency-key': 'client-delete-0001' },
      },
      { method: 'GET', url: '/erasures/mde_request_001' },
      { method: 'POST', url: '/erasures/mde_request_001/resume' },
      { method: 'GET', url: '/delivery-readiness' },
      {
        method: 'POST',
        url: '/schedule-preview',
        payload: { schedule: previewPayload()['schedule'] },
      },
      { method: 'POST', url: '/preview', payload: previewPayload() },
      { method: 'POST', url: '/md_definition_001/run/prepare' },
      {
        method: 'POST',
        url: '/md_definition_001/run',
        headers: { ...authorizedHeaders, 'idempotency-key': 'manual-request-001' },
        payload: { preparationToken: 'synthetic-preparation-token' },
      },
      { method: 'GET', url: '/md_definition_001/runs' },
      {
        method: 'GET',
        url: '/md_definition_001/runs/mdr_run_001',
      },
      {
        method: 'POST',
        url: '/md_definition_001/runs/mdr_run_001/retry',
        headers: { ...authorizedHeaders, 'idempotency-key': 'retry-request-0001' },
      },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        ...testCase,
        headers: { ...authorizedHeaders, ...testCase.headers },
      });
      expect(response.statusCode, `${testCase.method} ${testCase.url}`).toBe(401);
    }
  });

  it('returns replay-safe HTTP status for existing definitions and manual runs', async () => {
    vi.spyOn(store, 'getOwnedDefinition').mockResolvedValueOnce(null);
    vi.spyOn(store, 'createDefinition').mockImplementationOnce(async ({ definition }) => ({
      ok: true,
      disposition: 'existing',
      definition,
    }));
    const existingDefinition = await app.inject({
      method: 'POST',
      url: '/',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'client-request-0001',
      },
      payload: { status: 'active', name: 'Fishing daily', ...previewPayload() },
    });
    expect(existingDefinition.statusCode).toBe(200);
    expect(existingDefinition.json()).toMatchObject({
      success: true,
      data: { disposition: 'existing' },
    });

    vi.spyOn(store, 'reserveRun').mockImplementationOnce(async (input) => ({
      ok: true,
      disposition: 'existing',
      run: input.run,
    }));
    const claimDispatch = vi.spyOn(store, 'claimDispatch');
    const existingRun = await app.inject({
      method: 'POST',
      url: '/md_definition_001/run',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'manual-request-001',
      },
      payload: { preparationToken: 'synthetic-preparation-token' },
    });
    expect(existingRun.statusCode).toBe(200);
    expect(existingRun.json()).toMatchObject({
      success: true,
      data: { disposition: 'existing', dispatchDisposition: 'not_requested' },
    });
    expect(claimDispatch).not.toHaveBeenCalled();
  });

  it('returns completed erasure immediately and reconciles a pending delivery on detail read', async () => {
    vi.spyOn(store, 'startOrResumeDefinitionErasure').mockResolvedValueOnce({
      ok: true,
      status: 'completed',
      deletedThisCall: 0,
      request: erasureRequest({ stage: 'completed', completedAt: '2026-07-27T12:05:00.000Z' }),
    });
    const erased = await app.inject({
      method: 'DELETE',
      url: '/md_definition_001',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'client-delete-0001',
      },
    });
    expect(erased.statusCode).toBe(200);

    const pending = completedRun();
    pending.delivery.status = 'pending';
    pending.delivery.acceptedAt = null;
    vi.spyOn(store, 'getOwnedRun').mockResolvedValue(pending);
    vi.spyOn(whatsappClient, 'getOutboundDeliveryState').mockResolvedValue({
      ok: true,
      value: { status: 'sent', acceptedAt: '2026-07-27T12:06:00.000Z' },
    });
    vi.spyOn(store, 'recordRunDeliveryState').mockImplementationOnce(async () => ({
      ok: true,
      disposition: 'updated',
      run: {
        ...pending,
        delivery: {
          ...pending.delivery,
          status: 'sent',
          acceptedAt: '2026-07-27T12:06:00.000Z',
        },
      },
    }));
    const detail = await app.inject({
      method: 'GET',
      url: '/md_definition_001/runs/mdr_run_001',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      success: true,
      data: { run: { delivery: { status: 'sent', acceptedAt: '2026-07-27T12:06:00.000Z' } } },
    });

    vi.spyOn(whatsappClient, 'getOutboundDeliveryState').mockResolvedValueOnce({
      ok: false,
      code: 'unavailable',
    });
    const deferredDetail = await app.inject({
      method: 'GET',
      url: '/md_definition_001/runs/mdr_run_001',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(deferredDetail.statusCode).toBe(200);
    expect(deferredDetail.json()).toMatchObject({
      success: true,
      data: { run: { delivery: { status: 'pending', acceptedAt: null } } },
    });
  });

  it('projects incomplete output as null without exposing internal state', () => {
    const run = completedRun();
    run.summaryMarkdown = null;
    run.delivery.status = 'not_sent';

    expect(toPublicRun(run)).toMatchObject({ content: null, delivery: { status: 'not_sent' } });
  });

  it('projects immutable run revision and the safe latest-run definition summary', () => {
    const run = completedRun();
    const record = {
      ...definition(),
      hasRuns: true,
      latestRun: {
        runId: run.runId,
        startedAt: run.createdAt,
        generationStatus: run.generationStatus,
        processingStage: run.processingStage,
        deliveryStatus: run.delivery.status,
      },
    } as MessageDigestDefinition & {
      latestRun: {
        runId: string;
        startedAt: string;
        generationStatus: MessageDigestRun['generationStatus'];
        processingStage: MessageDigestRun['processingStage'];
        deliveryStatus: MessageDigestRun['delivery']['status'];
      };
    };

    expect(toPublicDefinition(record)).toMatchObject({
      source: {
        chatId: 'synthetic-chat-001',
        chatType: 'group',
        displayName: 'Fishing friends',
        messageCount: 123,
        participantCount: 8,
        lastActivityAt: '2026-07-27T11:00:00.000Z',
      },
      latestRun: {
        id: 'mdr_run_001',
        startedAt: run.createdAt,
        generationStatus: 'completed',
        processingStage: 'completed',
        deliveryStatus: 'sent',
      },
    });
    expect(toPublicRun(run)).toMatchObject({ definitionRevision: record.revision });
    expect(JSON.stringify(toPublicDefinition(record))).not.toContain('requestIdDigest');
  });

  it('projects an existing definition without optional source metadata truthfully', () => {
    const record = definition();
    const source = { ...record.source };
    delete source.messageCount;
    delete source.participantCount;
    delete source.lastActivityAt;
    record.source = source;

    const projected = toPublicDefinition(record);

    expect(projected).toMatchObject({
      source: {
        chatId: 'synthetic-chat-001',
        chatType: 'group',
        displayName: 'Fishing friends',
      },
    });
    expect(projected['source']).not.toHaveProperty('messageCount');
    expect(projected['source']).not.toHaveProperty('participantCount');
    expect(projected['source']).not.toHaveProperty('lastActivityAt');
    expect(JSON.stringify(projected)).not.toContain('synthetic-account-001');
    expect(JSON.stringify(projected)).not.toContain('synthetic-generation-001');
  });

  it('projects only the active erasure ID while a definition is deleting', () => {
    expect(toPublicDefinition(definition())).toMatchObject({ erasureRequestId: null });
    expect(
      toPublicDefinition({
        ...definition(),
        status: 'deleting',
        listStatus: 'paused',
        activeErasureRequestId: 'mde_request_001',
      })
    ).toMatchObject({ erasureRequestId: 'mde_request_001' });
    expect(JSON.stringify(toPublicDefinition(definition()))).not.toContain(
      'activeErasureRequestId'
    );
  });
});

function fakeStore(): MessageDigestStore {
  const record = definition();
  const erasure = erasureRequest();
  return {
    async createDefinition(input): ReturnType<MessageDigestStore['createDefinition']> {
      return { ok: true, disposition: 'created', definition: input.definition };
    },
    async getOwnedDefinition(): ReturnType<MessageDigestStore['getOwnedDefinition']> {
      return record;
    },
    async getOwnedDefinitionByLegacyAlias(): ReturnType<
      MessageDigestStore['getOwnedDefinitionByLegacyAlias']
    > {
      return null;
    },
    async getOwnedRunContext(): ReturnType<MessageDigestStore['getOwnedRunContext']> {
      return {
        definition: record,
        state: {
          version: 1,
          definitionId: record.definitionId,
          userId: record.userId,
          revision: 1,
          checkpointAt: record.checkpointAt,
          continuityMemoryMarkdown: '',
          precedingRunId: null,
          precedingRunHash: null,
          pendingWindow: null,
          updatedAt: record.updatedAt,
        },
      };
    },
    async listOwnedDefinitions(): ReturnType<MessageDigestStore['listOwnedDefinitions']> {
      return { items: [record], nextCursor: null };
    },
    async listDueDefinitions(): ReturnType<MessageDigestStore['listDueDefinitions']> {
      return { items: [], nextCursor: null };
    },
    async listReadyDispatches(): ReturnType<MessageDigestStore['listReadyDispatches']> {
      return { items: [], nextCursor: null };
    },
    async listPendingDeliveryRuns(): ReturnType<MessageDigestStore['listPendingDeliveryRuns']> {
      return { items: [], nextCursor: null };
    },
    async updateDefinition(input): ReturnType<MessageDigestStore['updateDefinition']> {
      return {
        ok: true,
        definition: {
          ...record,
          name: input.patch.name ?? record.name,
          nameSortKey: input.patch.nameSortKey ?? record.nameSortKey,
          status: input.patch.status ?? record.status,
          listStatus: input.patch.listStatus ?? record.listStatus,
          attentionCode:
            input.patch.attentionCode === undefined
              ? record.attentionCode
              : input.patch.attentionCode,
          source: input.patch.source ?? record.source,
          instructions: input.patch.instructions ?? record.instructions,
          schedule: input.patch.schedule ?? record.schedule,
          delivery: input.patch.delivery ?? record.delivery,
          checkpointAt: input.patch.resetCheckpointAt ?? record.checkpointAt,
          nextRunAt: input.patch.nextRunAt ?? record.nextRunAt,
          revision: record.revision + 1,
          updatedAt: input.updatedAt,
        },
      };
    },
    async reserveRun(): ReturnType<MessageDigestStore['reserveRun']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async claimRunLease(): ReturnType<MessageDigestStore['claimRunLease']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async renewRunLease(): ReturnType<MessageDigestStore['renewRunLease']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async markRunProcessingStage(): ReturnType<MessageDigestStore['markRunProcessingStage']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async completeRun(): ReturnType<MessageDigestStore['completeRun']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async failRun(): ReturnType<MessageDigestStore['failRun']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async getOwnedDispatch(): ReturnType<MessageDigestStore['getOwnedDispatch']> {
      return null;
    },
    async retryFailedGeneration(): ReturnType<MessageDigestStore['retryFailedGeneration']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async retryFailedDelivery(): ReturnType<MessageDigestStore['retryFailedDelivery']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async recordRunDeliveryState(): ReturnType<MessageDigestStore['recordRunDeliveryState']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async recordRunDeliveryObservation(): ReturnType<
      MessageDigestStore['recordRunDeliveryObservation']
    > {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async getOwnedRun(): ReturnType<MessageDigestStore['getOwnedRun']> {
      return null;
    },
    async listOwnedRuns(): ReturnType<MessageDigestStore['listOwnedRuns']> {
      return { items: [], nextCursor: null };
    },
    async listOwnedLegacyRuns(): ReturnType<MessageDigestStore['listOwnedLegacyRuns']> {
      return { items: [], nextCursor: null };
    },
    async claimDispatch(): ReturnType<MessageDigestStore['claimDispatch']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async renewDispatchClaim(): ReturnType<MessageDigestStore['renewDispatchClaim']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async recordDispatchResult(): ReturnType<MessageDigestStore['recordDispatchResult']> {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async claimDeliveryAuthorization(): ReturnType<
      MessageDigestStore['claimDeliveryAuthorization']
    > {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async releaseDeliveryAuthorization(): ReturnType<
      MessageDigestStore['releaseDeliveryAuthorization']
    > {
      return { ok: false, code: 'NOT_FOUND' };
    },
    async getOwnedErasureRequest(): ReturnType<MessageDigestStore['getOwnedErasureRequest']> {
      return erasure;
    },
    async startOrResumeDefinitionErasure(
      input
    ): ReturnType<MessageDigestStore['startOrResumeDefinitionErasure']> {
      return {
        ok: true,
        status: 'in_progress',
        deletedThisCall: 1,
        request: { ...erasure, erasureRequestId: input.erasureRequestId },
      };
    },
  };
}

function fakeWhatsAppClient(): MessageDigestWhatsAppClient {
  return {
    async validateSource(input): ReturnType<MessageDigestWhatsAppClient['validateSource']> {
      return {
        ok: true,
        value: {
          sourceAccountId: 'synthetic-account-001',
          generationId: 'synthetic-generation-001',
          chatId: input.chatId,
          chatType: 'group',
          displayName: 'Fishing friends',
          messageCount: 123,
          participantCount: 8,
          lastActivityAt: '2026-07-27T11:00:00.000Z',
          sourceRevision: 'synthetic-source-revision-001',
        },
      };
    },
    async getDeliveryReadiness(): ReturnType<MessageDigestWhatsAppClient['getDeliveryReadiness']> {
      return {
        ok: true,
        value: {
          status: 'ready',
          maskedPrimaryNumber: '+48•••123',
          observationVersion: 'readiness-v1',
          observedAt: '2026-07-27T12:00:00.000Z',
        },
      };
    },
    async getOutboundDeliveryState(): ReturnType<
      MessageDigestWhatsAppClient['getOutboundDeliveryState']
    > {
      return { ok: true, value: { status: 'pending' } };
    },
    async authorizeOutboundDeliveryRetry(): ReturnType<
      MessageDigestWhatsAppClient['authorizeOutboundDeliveryRetry']
    > {
      return { ok: true };
    },
    async queryMessages(): ReturnType<MessageDigestWhatsAppClient['queryMessages']> {
      return {
        ok: true,
        value: {
          messages: [],
          sourceRevision: 'synthetic-source-revision-001',
          highWatermark: null,
          nextCursor: null,
        },
      };
    },
  };
}

function fakeAggregator(): MessageDigestAggregator {
  return {
    async aggregate(input): ReturnType<MessageDigestAggregator['aggregate']> {
      return {
        ok: true,
        kind: input.messages.length === 0 ? 'empty' : 'aggregate',
        aggregate: null,
        metadata: {
          effectiveMessageCount: input.messages.length,
          promptVersion: '1.0.0',
          model: 'or:synthetic/model',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        },
      };
    },
  };
}

function fakePreparationTokens(): ServiceContainer['runPreparationTokens'] {
  return {
    issue: () => ({ ok: true, value: 'synthetic-preparation-token' }),
    read: ({ binding }) => ({
      ok: true,
      value: {
        ...binding,
        definitionRevision: 1,
        stateRevision: 1,
        erasureEpoch: 0,
        windowStart: '2026-07-27T07:00:00.000Z',
        windowEnd: '2026-07-27T12:00:00.000Z',
        nextRunAt: '2026-07-28T07:00:00.000Z',
        persistedReadinessObservationVersion: 'readiness-v1',
        preparedReadinessObservationVersion: 'readiness-v1',
      },
    }),
  };
}

function previewPayload(): Record<string, unknown> {
  return {
    source: { chatId: 'synthetic-chat-001' },
    instructions: {
      templateId: 'fishing_group',
      text: 'Create the fishing-group summary with decisions, plans, catches, and follow-ups.',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
  };
}

function definition(): MessageDigestDefinition {
  return {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Fishing daily',
    nameSortKey: 'fishing daily',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Fishing friends',
      messageCount: 123,
      participantCount: 8,
      lastActivityAt: '2026-07-27T11:00:00.000Z',
      sourceRevision: 'synthetic-source-revision-001',
    },
    instructions: {
      templateId: 'fishing_group',
      text: 'Create the fishing-group summary with decisions, plans, catches, and follow-ups.',
      revision: '1',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'readiness-v1',
      readinessObservedAt: '2026-07-27T12:00:00.000Z',
    },
    checkpointAt: '2026-07-27T07:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}

function completedRun(): MessageDigestRun {
  const record = definition();
  return {
    version: 1,
    runId: 'mdr_run_001',
    userId: record.userId,
    definitionId: record.definitionId,
    definitionNameSnapshot: record.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: record.revision,
    instructionRevision: record.instructions.revision,
    trigger: 'manual',
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-27T07:00:00.000Z',
    windowEnd: '2026-07-27T12:00:00.000Z',
    scheduledBoundary: '2026-07-27T12:00:00.000Z',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    attempts: 1,
    sourceSnapshot: record.source,
    instructionsSnapshot: record.instructions,
    scheduleSnapshot: record.schedule,
    headline: 'Synthetic result',
    summaryMarkdown: '- A bounded fact.',
    evidenceMessageRefs: ['c'.repeat(64)],
    continuityMemoryMarkdown: 'Synthetic continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001 },
    delivery: {
      type: 'whatsapp_primary',
      status: 'sent',
      idempotencyKey: 'message-digest:mdr_run_001',
      acceptedAt: '2026-07-27T12:03:00.000Z',
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 1,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T12:01:00.000Z',
    updatedAt: '2026-07-27T12:03:00.000Z',
    completedAt: '2026-07-27T12:02:00.000Z',
  };
}

function erasureRequest(
  overrides: Partial<MessageDigestErasureRequest> = {}
): MessageDigestErasureRequest {
  return {
    version: 1,
    erasureRequestId: 'mde_request_001',
    requestIdDigest: 'c'.repeat(64),
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    erasureEpoch: 1,
    stage: 'runs',
    cursor: null,
    deletedCounts: { runs: 1, outbox: 0, state: 0, definition: 0, legacy: 0 },
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    ...overrides,
  };
}
