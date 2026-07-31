import type { FastifyInstance } from 'fastify';
import {
  authenticateInternalPubSub,
  authenticateInternalScheduler,
  logIncomingRequest,
  validateInternalAuth,
} from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchMessageDigestOutbox } from '../domain/usecases/dispatchMessageDigestOutbox.js';
import { processMessageDigestRun } from '../domain/usecases/processMessageDigestRun.js';
import { reconcileMessageDigestDelivery } from '../domain/usecases/reconcileMessageDigestDelivery.js';
import { tickMessageDigestScheduler } from '../domain/usecases/tickMessageDigestScheduler.js';
import {
  acquireMessageDigestDeliveryAuthorization,
  releaseMessageDigestDeliveryAuthorization,
} from '../domain/usecases/authorizeMessageDigestDelivery.js';
import { formatWhatsAppDigest } from '../infra/notification/formatWhatsAppDigest.js';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    authenticateInternalPubSub: vi.fn(() => ({
      authenticated: true,
      strategy: 'internal-token',
    })),
    authenticateInternalScheduler: vi.fn(() => ({
      authenticated: true,
      strategy: 'internal-token',
    })),
    logIncomingRequest: vi.fn(),
    validateInternalAuth: vi.fn(() => ({ valid: true })),
  };
});

vi.mock('../domain/usecases/processMessageDigestRun.js', () => ({
  processMessageDigestRun: vi.fn(),
}));

vi.mock('../domain/usecases/dispatchMessageDigestOutbox.js', () => ({
  dispatchMessageDigestOutbox: vi.fn(),
}));

vi.mock('../domain/usecases/reconcileMessageDigestDelivery.js', () => ({
  reconcileMessageDigestDelivery: vi.fn(),
}));

vi.mock('../infra/notification/formatWhatsAppDigest.js', () => ({
  formatWhatsAppDigest: vi.fn(),
}));

vi.mock('../domain/usecases/tickMessageDigestScheduler.js', () => ({
  tickMessageDigestScheduler: vi.fn(),
}));

vi.mock('../domain/usecases/authorizeMessageDigestDelivery.js', () => ({
  acquireMessageDigestDeliveryAuthorization: vi.fn(),
  releaseMessageDigestDeliveryAuthorization: vi.fn(),
}));

describe('Message Digest internal routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.mocked(authenticateInternalPubSub).mockReturnValue({
      authenticated: true,
      strategy: 'internal-token',
    });
    vi.mocked(authenticateInternalScheduler).mockReturnValue({
      authenticated: true,
      strategy: 'internal-token',
    });
    vi.mocked(validateInternalAuth).mockReturnValue({ valid: true });
    vi.mocked(tickMessageDigestScheduler).mockResolvedValue({
      ok: true,
      recoveredDispatches: 1,
      reconciledDeliveries: 1,
      reservedRuns: 1,
      deferredDefinitions: 0,
      nextCursor: null,
    });
    vi.mocked(processMessageDigestRun).mockResolvedValue({
      ok: true,
      disposition: 'completed',
      run: {} as never,
    });
    vi.mocked(dispatchMessageDigestOutbox).mockResolvedValue({
      ok: true,
      disposition: 'published',
    });
    vi.mocked(reconcileMessageDigestDelivery).mockResolvedValue({
      ok: true,
      disposition: 'sent',
      run: {} as never,
    });
    vi.mocked(formatWhatsAppDigest).mockReturnValue({ ok: false, code: 'RUN_NOT_COMPLETED' });
    vi.mocked(acquireMessageDigestDeliveryAuthorization).mockResolvedValue({
      ok: true,
      disposition: 'authorized',
      fence: 3,
      expiresAt: '2026-07-27T12:02:00.000Z',
    });
    vi.mocked(releaseMessageDigestDeliveryAuthorization).mockResolvedValue({
      ok: true,
      disposition: 'released',
    });
    setServices(fakeServices());
    app = await buildServer({ healthChecks: [] });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    vi.clearAllMocks();
  });

  it('documents and authenticates the bounded scheduler tick', async () => {
    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApi.json().paths).toMatchObject({
      '/internal/message-digests/scheduler/tick': expect.any(Object),
      '/internal/message-digests/pubsub/run': expect.any(Object),
      '/internal/message-digests/delivery-authorizations/acquire': expect.any(Object),
      '/internal/message-digests/delivery-authorizations/release': expect.any(Object),
    });

    vi.mocked(authenticateInternalScheduler).mockReturnValueOnce({ authenticated: false });
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      payload: { limit: 25 },
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      payload: { limit: 25, cursor: 'opaque-cursor' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { recoveredDispatches: 1, reconciledDeliveries: 1, reservedRuns: 1 },
    });
    expect(tickMessageDigestScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, cursor: 'opaque-cursor' }),
      expect.any(Object)
    );
  });

  it('wires scheduler and run-worker adapters to their bounded dependencies', async () => {
    vi.mocked(tickMessageDigestScheduler).mockImplementationOnce(async (_input, dependencies) => {
      await dependencies.dispatchOutbox('mdo_dispatch_001');
      await dependencies.reconcileDelivery({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
      });
      return {
        ok: true,
        recoveredDispatches: 1,
        reconciledDeliveries: 1,
        reservedRuns: 0,
        deferredDefinitions: 0,
        nextCursor: null,
      };
    });
    const scheduler = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      payload: {},
    });
    expect(scheduler.statusCode).toBe(200);
    expect(dispatchMessageDigestOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outboxId: 'mdo_dispatch_001' }),
      expect.any(Object)
    );
    expect(reconcileMessageDigestDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'mdr_run_001' }),
      expect.any(Object)
    );

    vi.mocked(processMessageDigestRun).mockImplementationOnce(async (_input, dependencies) => {
      dependencies.formatDelivery({} as never);
      await dependencies.dispatchOutbox('mdo_delivery_001');
      return { ok: true, disposition: 'completed', run: {} as never };
    });
    const worker = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope(runRequest()),
    });
    expect(worker.statusCode).toBe(200);
    expect(formatWhatsAppDigest).toHaveBeenCalledWith({
      run: {},
      webAppUrl: 'https://intexuraos.cloud',
    });
    expect(dispatchMessageDigestOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outboxId: 'mdo_delivery_001' }),
      expect.any(Object)
    );
  });

  it('checks the same opaque definition through the real owner-safe public read projection', async () => {
    const getOwnedDefinition = vi.fn(async (userId: string, definitionId: string) =>
      userId === 'synthetic-owner-001' && definitionId === 'md_definition_001'
        ? ({ definitionId } as never)
        : null
    );
    setServices({
      ...fakeServices(),
      messageDigestStore: { getOwnedDefinition } as never,
    });
    const url = '/internal/message-digests/cutover/check';
    const payload = {
      ownerUserId: 'synthetic-owner-001',
      foreignUserId: 'synthetic-foreign-001',
      definitionId: 'md_definition_001',
    };

    const missingRole = await app.inject({ method: 'POST', url, payload });
    expect(missingRole.statusCode).toBe(401);

    vi.mocked(validateInternalAuth).mockReturnValueOnce({
      valid: false,
      reason: 'token_mismatch',
    });
    const invalidToken = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-internal-caller-role': 'message_digest_cutover_verifier' },
      payload,
    });
    expect(invalidToken.statusCode).toBe(401);

    const extra = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-internal-caller-role': 'message_digest_cutover_verifier' },
      payload: { ...payload, sourceAccountId: 'forbidden' },
    });
    expect(extra.statusCode).toBe(400);

    const sameOwner = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-internal-caller-role': 'message_digest_cutover_verifier' },
      payload: { ...payload, foreignUserId: `  ${payload.ownerUserId}  ` },
    });
    expect(sameOwner.statusCode).toBe(400);
    expect(getOwnedDefinition).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-internal-caller-role': 'message_digest_cutover_verifier' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { ownerDefinitionVisible: true, foreignDefinitionVisible: false },
    });
    expect(getOwnedDefinition.mock.calls).toEqual([
      ['synthetic-owner-001', 'md_definition_001'],
      ['synthetic-foreign-001', 'md_definition_001'],
    ]);
    expect(response.body).not.toContain('synthetic-owner-001');
    expect(response.body).not.toContain('md_definition_001');
    expect(logIncomingRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ bodyPreviewLength: 0, includeHeaders: false })
    );

    setServices({
      ...fakeServices(),
      messageDigestStore: {
        getOwnedDefinition: vi.fn(async () => {
          throw new Error('synthetic cutover read failure');
        }),
      } as never,
    });
    const unavailable = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-internal-caller-role': 'message_digest_cutover_verifier' },
      payload,
    });
    expect(unavailable.statusCode).toBe(503);
  });

  it('acquires and releases a caller-role-bound delivery authorization without logging content', async () => {
    const headers = { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' };
    const acquired = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/acquire',
      headers,
      payload: authorizationBody(),
    });
    expect(acquired.statusCode).toBe(200);
    expect(acquired.json()).toEqual({
      success: true,
      data: {
        disposition: 'authorized',
        fence: 3,
        expiresAt: '2026-07-27T12:02:00.000Z',
      },
      diagnostics: {
        requestId: expect.any(String),
        durationMs: expect.any(Number),
      },
    });
    expect(acquireMessageDigestDeliveryAuthorization).toHaveBeenCalledWith(
      authorizationBody(),
      expect.objectContaining({ store: expect.any(Object) })
    );

    const released = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/release',
      headers,
      payload: { ...authorizationBody(), fence: 3 },
    });
    expect(released.statusCode).toBe(200);
    expect(released.json()).toEqual({
      success: true,
      data: { disposition: 'released' },
      diagnostics: {
        requestId: expect.any(String),
        durationMs: expect.any(Number),
      },
    });
    expect(releaseMessageDigestDeliveryAuthorization).toHaveBeenCalledWith(
      { ...authorizationBody(), fence: 3 },
      expect.objectContaining({ store: expect.any(Object) })
    );
  });

  it('denies missing auth/caller role and rejects additional authorization fields before storage', async () => {
    vi.mocked(validateInternalAuth).mockReturnValueOnce({
      valid: false,
      reason: 'token_mismatch',
    });
    const invalidToken = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/acquire',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: authorizationBody(),
    });
    expect(invalidToken.statusCode).toBe(401);

    for (const headers of [{}, { 'x-internal-caller-role': 'scheduler' }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/message-digests/delivery-authorizations/acquire',
        headers,
        payload: authorizationBody(),
      });
      expect(response.statusCode).toBe(401);
    }
    const unauthorizedRelease = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/release',
      headers: { 'x-internal-caller-role': 'scheduler' },
      payload: { ...authorizationBody(), fence: 3 },
    });
    expect(unauthorizedRelease.statusCode).toBe(401);
    const extra = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/release',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: { ...authorizationBody(), fence: 3, message: 'forbidden content' },
    });
    expect(extra.statusCode).toBe(400);
    expect(acquireMessageDigestDeliveryAuthorization).not.toHaveBeenCalled();
    expect(releaseMessageDigestDeliveryAuthorization).not.toHaveBeenCalled();
  });

  it('rejects missing or malformed delivery payload digests before the use case', async () => {
    const headers = { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' };
    const { payloadDigest: _missing, ...withoutPayloadDigest } = authorizationBody();
    const missing = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/acquire',
      headers,
      payload: withoutPayloadDigest,
    });
    const malformed = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/release',
      headers,
      payload: { ...authorizationBody(), payloadDigest: 'not-a-digest', fence: 3 },
    });

    expect(missing.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(acquireMessageDigestDeliveryAuthorization).not.toHaveBeenCalled();
    expect(releaseMessageDigestDeliveryAuthorization).not.toHaveBeenCalled();
  });

  it('maps an invalid release decision through the stable error envelope', async () => {
    vi.mocked(releaseMessageDigestDeliveryAuthorization).mockResolvedValueOnce({
      ok: false,
      code: 'INVALID_REQUEST',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/release',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: { ...authorizationBody(), fence: 3 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });

    vi.mocked(acquireMessageDigestDeliveryAuthorization).mockResolvedValueOnce({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    const invalidAcquire = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/acquire',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: authorizationBody(),
    });
    expect(invalidAcquire.statusCode).toBe(400);
    expect(invalidAcquire.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });

    vi.mocked(releaseMessageDigestDeliveryAuthorization).mockRejectedValueOnce(
      new Error('synthetic release persistence failure')
    );
    const unavailableRelease = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/release',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: { ...authorizationBody(), fence: 3 },
    });
    expect(unavailableRelease.statusCode).toBe(503);
  });

  it('acks denied authorization and makes contention or unexpected storage failure retryable', async () => {
    vi.mocked(acquireMessageDigestDeliveryAuthorization).mockResolvedValueOnce({
      ok: true,
      disposition: 'denied',
    });
    const denied = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/acquire',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: authorizationBody(),
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toMatchObject({ success: true, data: { disposition: 'denied' } });

    vi.mocked(acquireMessageDigestDeliveryAuthorization).mockResolvedValueOnce({
      ok: true,
      disposition: 'busy',
    });
    const busy = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/acquire',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: authorizationBody(),
    });
    expect(busy.statusCode).toBe(503);

    vi.mocked(acquireMessageDigestDeliveryAuthorization).mockRejectedValueOnce(
      new Error('synthetic persistence failure')
    );
    const unavailable = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/delivery-authorizations/acquire',
      headers: { 'x-internal-caller-role': 'whatsapp_message_digest_delivery' },
      payload: authorizationBody(),
    });
    expect(unavailable.statusCode).toBe(503);
  });

  it('decodes one exact run request and uses the Pub/Sub message ID as worker identity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope(runRequest()),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { accepted: true, disposition: 'completed' },
    });
    expect(processMessageDigestRun).toHaveBeenCalledWith(
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        workerId: 'pubsub:synthetic-message-001',
      },
      expect.any(Object)
    );
  });

  it('accepts and ignores provider-owned Pub/Sub metadata while keeping known fields bounded', async () => {
    const envelope = pubsubEnvelope(runRequest());
    const message = envelope['message'] as Record<string, unknown>;
    const response = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: {
        ...envelope,
        deliveryAttempt: 1,
        message: {
          ...message,
          attributes: { intexuraos_operator_replay: 'synthetic-hotfix' },
          message_id: 'synthetic-provider-alias-must-be-ignored',
          orderingKey: 'synthetic-ordering-key',
          publish_time: '2026-07-27T12:59:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(processMessageDigestRun).toHaveBeenCalledWith(
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        workerId: 'pubsub:synthetic-message-001',
      },
      expect.any(Object)
    );

    for (const invalidDeliveryAttempt of [-1, 1.5]) {
      const invalid = await app.inject({
        method: 'POST',
        url: '/internal/message-digests/pubsub/run',
        payload: { ...envelope, deliveryAttempt: invalidDeliveryAttempt },
      });
      expect(invalid.statusCode).toBe(400);
    }

    const unexpectedMessageField = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: {
        ...envelope,
        message: { ...message, providerOwnedMetadata: { opaque: true } },
      },
    });
    expect(unexpectedMessageField.statusCode).toBe(200);
    expect(processMessageDigestRun).toHaveBeenNthCalledWith(
      2,
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        workerId: 'pubsub:synthetic-message-001',
      },
      expect.any(Object)
    );

    const tooManyAttributes = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`key-${String(index)}`, 'value'])
    );
    for (const invalidMessage of [
      { ...message, attributes: { invalid: { nested: true } } },
      { ...message, orderingKey: { nested: true } },
      { ...message, attributes: tooManyAttributes },
      { ...message, attributes: { ['k'.repeat(257)]: 'value' } },
      { ...message, attributes: { key: 'v'.repeat(1_025) } },
      { ...message, orderingKey: 'o'.repeat(1_025) },
    ]) {
      const invalid = await app.inject({
        method: 'POST',
        url: '/internal/message-digests/pubsub/run',
        payload: { ...envelope, message: invalidMessage },
      });
      expect(invalid.statusCode).toBe(400);
    }

    const unexpected = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: { ...envelope, unexpectedField: 1 },
    });
    expect(unexpected.statusCode).toBe(400);
    expect(processMessageDigestRun).toHaveBeenCalledTimes(2);
  });

  it('acks terminal duplicates and asks Pub/Sub to retry a busy lease', async () => {
    vi.mocked(processMessageDigestRun).mockResolvedValueOnce({
      ok: true,
      disposition: 'already_terminal',
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope(runRequest()),
    });
    expect(duplicate.statusCode).toBe(200);

    vi.mocked(processMessageDigestRun).mockResolvedValueOnce({
      ok: true,
      disposition: 'deferred',
    });
    const deferred = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope(runRequest()),
    });
    expect(deferred.statusCode).toBe(503);
  });

  it('rejects unauthenticated, non-canonical, malformed, and wrong-type Pub/Sub payloads', async () => {
    vi.mocked(authenticateInternalPubSub).mockReturnValueOnce({ authenticated: false });
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope(runRequest()),
    });
    expect(unauthorized.statusCode).toBe(401);

    const extra = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope({ ...runRequest(), recipient: 'forbidden' }),
    });
    expect(extra.statusCode).toBe(400);

    const malformed = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelopeBytes('not-json'),
    });
    expect(malformed.statusCode).toBe(400);

    const nonCanonicalBase64 = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: {
        message: {
          data: 'e30==',
          messageId: 'synthetic-message-001',
          publishTime: '2026-07-27T12:01:00.000Z',
        },
        subscription: 'projects/synthetic/subscriptions/message-digest-runs',
      },
    });
    expect(nonCanonicalBase64.statusCode).toBe(400);

    const wrongType = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope({ ...runRequest(), type: 'message-digest.other' }),
    });
    expect(wrongType.statusCode).toBe(400);
    expect(processMessageDigestRun).not.toHaveBeenCalled();
  });

  it('uses scheduler defaults, maps invalid work, and requests retry after unexpected failures', async () => {
    const defaults = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      payload: {},
    });
    expect(defaults.statusCode).toBe(200);
    expect(tickMessageDigestScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
      expect.any(Object)
    );

    vi.mocked(tickMessageDigestScheduler).mockResolvedValueOnce({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      payload: { limit: 25 },
    });
    expect(invalid.statusCode).toBe(400);

    vi.mocked(tickMessageDigestScheduler).mockRejectedValueOnce(new Error('synthetic failure'));
    const retry = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      payload: { limit: 25 },
    });
    expect(retry.statusCode).toBe(503);
  });

  it('acknowledges safe worker failures and requests retry after an unexpected worker exception', async () => {
    vi.mocked(processMessageDigestRun).mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    const failed = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope(runRequest()),
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      success: true,
      data: { accepted: true, disposition: 'failed' },
    });

    vi.mocked(processMessageDigestRun).mockRejectedValueOnce(new Error('synthetic failure'));
    const retry = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: pubsubEnvelope(runRequest()),
    });
    expect(retry.statusCode).toBe(503);
  });
});

function fakeServices(): ServiceContainer {
  return {
    config: { webAppUrl: 'https://intexuraos.cloud' } as never,
    logger: {} as never,
    firestore: {} as never,
    whatsappServiceClient: {} as never,
    messageDigestStore: {} as never,
    messageDigestWhatsAppClient: {} as never,
    usageSink: {} as never,
    messageDigestAggregator: {} as never,
    pubsub: {} as never,
    messageDigestRunPublisher: { publish: vi.fn() },
    whatsappSendPublisher: { publish: vi.fn() },
    runPreparationTokens: {} as never,
  };
}

function runRequest(): Record<string, unknown> {
  return {
    type: 'message-digest.run',
    version: 1,
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    requestedAt: '2026-07-27T12:00:00.000Z',
  };
}

function authorizationBody(): Record<string, unknown> {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    idempotencyKey: 'message-digest:mdr_run_001',
    payloadDigest: 'a'.repeat(64),
    ownerDigest: 'd'.repeat(64),
  };
}

function pubsubEnvelope(data: Record<string, unknown>): Record<string, unknown> {
  return pubsubEnvelopeBytes(JSON.stringify(data));
}

function pubsubEnvelopeBytes(data: string): Record<string, unknown> {
  return {
    message: {
      data: Buffer.from(data, 'utf8').toString('base64'),
      messageId: 'synthetic-message-001',
      publishTime: '2026-07-27T12:01:00.000Z',
    },
    subscription: 'projects/synthetic/subscriptions/message-digest-runs',
  };
}
