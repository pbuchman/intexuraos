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
} satisfies WhatsAppServiceClientConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createWhatsAppServiceClient', () => {
  it('forwards Matrix corpus calls through the protected evaluator edge prefix', async () => {
    nock(BASE_URL)
      .get('/internal/evals/whatsapp/matrix-corpus/readiness')
      .matchHeader('authorization', 'Bearer evaluator-token')
      .reply(200, { success: true, data: { status: 'ready' } });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: '',
      logger,
      pathPrefix: '/internal/evals/whatsapp',
      authorizationHeaderProvider: vi.fn().mockResolvedValue('Bearer evaluator-token'),
    });

    await expect(client.getMatrixCorpusReadiness()).resolves.toEqual({
      ok: true,
      value: { status: 'ready' },
    });
  });

  it('drives every Matrix corpus control endpoint with strict responses', async () => {
    const digest = 'a'.repeat(64);
    const now = '2026-07-20T10:00:00.000Z';
    const operation = { runId: 'run_1', leaseFence: '7', idempotencyKey: 'operation-key-0001' };
    nock(BASE_URL)
      .get('/internal/matrix-corpus/readiness')
      .reply(200, {
        success: true,
        data: { status: 'ready' },
      })
      .post('/internal/matrix-corpus/runs', {
        runId: 'run_1',
        idempotencyKey: 'provision-key-0001',
      })
      .reply(200, {
        success: true,
        data: {
          code: 'ACQUIRED',
          runId: 'run_1',
          phase: 'provisioning',
          leaseFence: '7',
          acquiredAt: now,
          expiresAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/activate')
      .reply(200, {
        success: true,
        data: {
          code: 'ACTIVATED',
          runId: 'run_1',
          leaseFence: '7',
          phase: 'active',
          activatedAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/lease/renew')
      .reply(200, {
        success: true,
        data: {
          code: 'LEASE_RENEWED',
          runId: 'run_1',
          leaseFence: '7',
          phase: 'active',
          renewedAt: now,
          expiresAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/capabilities')
      .reply(200, {
        success: true,
        data: {
          code: 'CAPABILITY_ISSUED',
          runId: 'run_1',
          leaseFence: '7',
          scenarioId: 'intex-eval-001',
          phase: 'start',
          turnIndex: 0,
          issuedAt: now,
          expiresAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/matrix-send-proofs', {
        leaseFence: '7',
        idempotencyKey: 'operation-key-0001',
        capability: `imc1_${'A'.repeat(43)}`,
        scenarioId: 'intex-eval-001',
        scenarioNumber: 1,
        phase: 'start',
        turnIndex: 0,
        matrixEventId: '$event-1',
        matrixRoomId: '!room:home-dev',
        messageText: 'private matrix message',
      })
      .reply(200, {
        success: true,
        data: {
          code: 'MATRIX_SEND_PROOF_RECORDED',
          runId: 'run_1',
          leaseFence: '7',
          scenarioId: 'intex-eval-001',
          phase: 'start',
          turnIndex: 0,
          recordedAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/control-authorizations', {
        leaseFence: '7',
        operation: 'register_context',
        request: { exact: true },
      })
      .reply(200, {
        success: true,
        data: {
          code: 'AUTHORIZED',
          authorization: {
            version: 1,
            kind: 'matrix_corpus_control_mutation',
            eventId: 'event_1',
            leaseFence: '7',
            payloadDigest: digest,
            attestation: 'aaa.bbb.ccc',
          },
        },
      })
      .get(
        '/internal/matrix-corpus/runs/run_1/transport-status?scenarioId=intex-eval-001&turnIndex=0'
      )
      .matchHeader('x-matrix-corpus-lease-fence', '7')
      .reply(200, {
        success: true,
        data: {
          code: 'TRANSPORT_STATUS',
          runId: 'run_1',
          leaseFence: '7',
          phase: 'active',
          consumedCapabilityCount: 1,
          terminalIntexMarkerCount: 1,
          terminalOutboxCount: 0,
          replyOrDeliveryWorkInFlight: 0,
          nonterminalIngestOutboxCount: 0,
          drained: true,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/quiesce')
      .reply(200, {
        success: true,
        data: {
          code: 'QUIESCED',
          runId: 'run_1',
          leaseFence: '7',
          phase: 'quiescing',
          quiescedAt: now,
          drained: true,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/release')
      .reply(200, {
        success: true,
        data: {
          code: 'RELEASE_PENDING',
          runId: 'run_1',
          leaseFence: '7',
          phase: 'release_pending',
          createdAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/abort-provisioning')
      .reply(200, {
        success: true,
        data: {
          code: 'ABANDON_PENDING',
          runId: 'run_1',
          leaseFence: '7',
          phase: 'abandon_pending',
          reconciledAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/cleanup')
      .reply(200, {
        success: true,
        data: {
          code: 'RUN_CLEANED',
          targetRunId: 'run_old',
          targetLeaseFence: '3',
          targetRunFenceDigest: digest,
          state: 'cleaned',
          finalRevision: 1,
          cleanedAt: now,
        },
      });

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    await expect(client.getMatrixCorpusReadiness()).resolves.toEqual({
      ok: true,
      value: { status: 'ready' },
    });
    await expect(
      client.provisionMatrixCorpusRun({ runId: 'run_1', idempotencyKey: 'provision-key-0001' })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.recordMatrixCorpusSendProof({
        ...operation,
        capability: `imc1_${'A'.repeat(43)}`,
        scenarioId: 'intex-eval-001',
        scenarioNumber: 1,
        phase: 'start',
        turnIndex: 0,
        matrixEventId: '$event-1',
        matrixRoomId: '!room:home-dev',
        messageText: 'private matrix message',
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(client.activateMatrixCorpusRun(operation)).resolves.toMatchObject({ ok: true });
    await expect(client.renewMatrixCorpusLease(operation)).resolves.toMatchObject({ ok: true });
    await expect(
      client.issueMatrixCorpusCapability({
        ...operation,
        capability: `imc1_${'A'.repeat(43)}`,
        scenarioId: 'intex-eval-001',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        promptNormalizationVersion: 1,
        promptDigest: digest,
        phase: 'start',
        turnIndex: 0,
        expectedSessionId: null,
        pendingConfirmationId: null,
        expectedDecision: null,
        mockProfile: {
          version: 1,
          calls: [],
          forbiddenSelections: [],
          unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
        },
        mockProfileDigest: digest,
        expectedToolSchedule: [],
        currentDateTime: now,
        timeZone: 'Europe/Warsaw',
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.authorizeMatrixCorpusControl({
        runId: 'run_1',
        leaseFence: '7',
        operation: 'register_context',
        request: { exact: true },
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.getMatrixCorpusTransportStatus({
        runId: 'run_1',
        leaseFence: '7',
        scenarioId: 'intex-eval-001',
        turnIndex: 0,
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(client.quiesceMatrixCorpusRun(operation)).resolves.toMatchObject({ ok: true });
    await expect(client.releaseMatrixCorpusRun(operation)).resolves.toMatchObject({ ok: true });
    await expect(client.abortProvisioningMatrixCorpusRun(operation)).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      client.cleanupMatrixCorpusRun({
        ...operation,
        targetRunId: 'run_old',
        targetLeaseFence: '3',
        targetRunFenceDigest: digest,
        expectedRevision: 0,
      })
    ).resolves.toMatchObject({ ok: true });
    expect(nock.isDone()).toBe(true);
  });

  it('rejects every malformed Matrix corpus control request before transport', async () => {
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const invalid = { ok: false, error: { code: 'invalid_request' } } as const;
    const calls: Promise<unknown>[] = [
      client.provisionMatrixCorpusRun({} as never),
      client.activateMatrixCorpusRun({} as never),
      client.renewMatrixCorpusLease({} as never),
      client.issueMatrixCorpusCapability({} as never),
      client.recordMatrixCorpusSendProof({} as never),
      client.authorizeMatrixCorpusControl({} as never),
      client.getMatrixCorpusTransportStatus({} as never),
      client.quiesceMatrixCorpusRun({} as never),
      client.releaseMatrixCorpusRun({} as never),
      client.abortProvisioningMatrixCorpusRun({} as never),
      client.cleanupMatrixCorpusRun({} as never),
    ];

    for (const call of calls) await expect(call).resolves.toEqual(invalid);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('maps Matrix corpus timeout, network, API, and malformed-envelope failures', async () => {
    nock(BASE_URL)
      .get('/internal/matrix-corpus/readiness')
      .delayConnection(50)
      .reply(200, { success: true, data: { status: 'ready' } })
      .get('/internal/matrix-corpus/readiness')
      .replyWithError('private-network-sentinel')
      .get('/internal/matrix-corpus/readiness')
      .reply(503, { success: false })
      .get('/internal/matrix-corpus/readiness')
      .reply(200, { private: 'malformed-envelope' });
    const timeoutClient = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 5,
    });

    await expect(timeoutClient.getMatrixCorpusReadiness()).resolves.toEqual({
      ok: false,
      error: { code: 'timeout' },
    });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    await expect(client.getMatrixCorpusReadiness()).resolves.toEqual({
      ok: false,
      error: { code: 'unavailable' },
    });
    await expect(client.getMatrixCorpusReadiness()).resolves.toEqual({
      ok: false,
      error: { code: 'rejected', httpStatus: 503 },
    });
    await expect(client.getMatrixCorpusReadiness()).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_response' },
    });
  });

  it('fails closed on unknown Matrix corpus response fields', async () => {
    nock(BASE_URL)
      .post('/internal/matrix-corpus/runs')
      .reply(200, {
        success: true,
        data: {
          code: 'ACQUIRED',
          runId: 'run_1',
          phase: 'provisioning',
          leaseFence: '7',
          acquiredAt: '2026-07-20T10:00:00.000Z',
          expiresAt: '2026-07-20T10:00:00.000Z',
          privateAccount: 'private-sentinel',
        },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.provisionMatrixCorpusRun({
      runId: 'run_1',
      idempotencyKey: 'provision-key-0001',
    });
    expect(result).toEqual({ ok: false, error: { code: 'invalid_response' } });
    expect(JSON.stringify(result)).not.toContain('private-sentinel');
  });

  it('does not log private Matrix corpus routes or raw network errors', async () => {
    nock(BASE_URL)
      .post('/internal/matrix-corpus/runs/run_private_route_sentinel/activate')
      .replyWithError('private-network-error-sentinel');
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.activateMatrixCorpusRun({
      runId: 'run_private_route_sentinel',
      leaseFence: '7',
      idempotencyKey: 'provision-key-0001',
    });

    expect(result).toEqual({ ok: false, error: { code: 'unavailable' } });
    expect(logger.warn).toHaveBeenCalledWith(
      { _skipSentry: true },
      'private internal-client network error'
    );
  });

  it('rejects stale or misrouted Matrix corpus identities', async () => {
    const now = '2026-07-20T10:00:00.000Z';
    nock(BASE_URL)
      .post('/internal/matrix-corpus/runs/run_1/activate')
      .reply(200, {
        success: true,
        data: {
          code: 'ACTIVATED',
          runId: 'run_other',
          leaseFence: '7',
          phase: 'active',
          activatedAt: now,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/transport-status')
      .reply(200, {
        success: true,
        data: {
          code: 'TRANSPORT_STATUS',
          runId: 'run_1',
          leaseFence: '8',
          phase: 'active',
          consumedCapabilityCount: 0,
          terminalIntexMarkerCount: 0,
          terminalOutboxCount: 0,
          replyOrDeliveryWorkInFlight: 0,
          nonterminalIngestOutboxCount: 0,
          drained: false,
        },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const operation = { runId: 'run_1', leaseFence: '7', idempotencyKey: 'operation-key-0001' };

    await expect(client.activateMatrixCorpusRun(operation)).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_response' },
    });
    await expect(
      client.getMatrixCorpusTransportStatus({ runId: 'run_1', leaseFence: '7' })
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_response' } });
  });

  it('rejects miscorrelated results from every remaining Matrix corpus mutation', async () => {
    const digest = 'a'.repeat(64);
    const now = '2026-07-20T10:00:00.000Z';
    const operation = { runId: 'run_1', leaseFence: '7', idempotencyKey: 'operation-key-0001' };
    const issueInput = {
      ...operation,
      capability: `imc1_${'A'.repeat(43)}`,
      scenarioId: 'intex-eval-001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      promptNormalizationVersion: 1 as const,
      promptDigest: digest,
      phase: 'start' as const,
      turnIndex: 0,
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: {
        version: 1 as const,
        calls: [],
        forbiddenSelections: [],
        unexpectedKnownToolPolicy: 'behavioral_failure_no_execution' as const,
      },
      mockProfileDigest: digest,
      expectedToolSchedule: [],
      currentDateTime: now,
      timeZone: 'Europe/Warsaw',
    };
    const proofInput = {
      ...operation,
      capability: `imc1_${'A'.repeat(43)}`,
      scenarioId: 'intex-eval-001',
      scenarioNumber: 1,
      phase: 'start' as const,
      turnIndex: 0,
      matrixEventId: '$event-1',
      matrixRoomId: '!room:home-dev',
      messageText: 'private matrix message',
    };
    nock(BASE_URL)
      .post('/internal/matrix-corpus/runs')
      .reply(200, {
        success: true,
        data: {
          code: 'ACQUIRED',
          runId: 'run_other',
          phase: 'provisioning',
          leaseFence: '7',
          acquiredAt: now,
          expiresAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/lease/renew')
      .reply(200, {
        success: true,
        data: {
          code: 'LEASE_RENEWED',
          runId: 'run_other',
          leaseFence: '7',
          phase: 'active',
          renewedAt: now,
          expiresAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/capabilities')
      .reply(200, {
        success: true,
        data: {
          code: 'CAPABILITY_ISSUED',
          runId: 'run_other',
          leaseFence: '7',
          scenarioId: 'intex-eval-001',
          phase: 'start',
          turnIndex: 0,
          issuedAt: now,
          expiresAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/matrix-send-proofs')
      .reply(200, {
        success: true,
        data: {
          code: 'MATRIX_SEND_PROOF_RECORDED',
          runId: 'run_other',
          leaseFence: '7',
          scenarioId: 'intex-eval-001',
          phase: 'start',
          turnIndex: 0,
          recordedAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/control-authorizations')
      .reply(200, {
        success: true,
        data: {
          code: 'AUTHORIZED',
          authorization: {
            version: 1,
            kind: 'matrix_corpus_control_mutation',
            eventId: 'event_1',
            leaseFence: '8',
            payloadDigest: digest,
            attestation: 'aaa.bbb.ccc',
          },
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/quiesce')
      .reply(200, {
        success: true,
        data: {
          code: 'QUIESCED',
          runId: 'run_other',
          leaseFence: '7',
          phase: 'quiescing',
          quiescedAt: now,
          drained: true,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/release')
      .reply(200, {
        success: true,
        data: {
          code: 'RELEASE_PENDING',
          runId: 'run_other',
          leaseFence: '7',
          phase: 'release_pending',
          createdAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/abort-provisioning')
      .reply(200, {
        success: true,
        data: {
          code: 'ABANDON_PENDING',
          runId: 'run_other',
          leaseFence: '7',
          phase: 'abandon_pending',
          reconciledAt: now,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/cleanup')
      .reply(200, {
        success: true,
        data: {
          code: 'RUN_CLEANED',
          targetRunId: 'run_other',
          targetLeaseFence: '3',
          targetRunFenceDigest: digest,
          state: 'cleaned',
          finalRevision: 1,
          cleanedAt: now,
        },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const results = [
      await client.provisionMatrixCorpusRun({
        runId: 'run_1',
        idempotencyKey: 'provision-key-0001',
      }),
      await client.renewMatrixCorpusLease(operation),
      await client.issueMatrixCorpusCapability(issueInput),
      await client.recordMatrixCorpusSendProof(proofInput),
      await client.authorizeMatrixCorpusControl({
        runId: 'run_1',
        leaseFence: '7',
        operation: 'register_context',
        request: { exact: true },
      }),
      await client.quiesceMatrixCorpusRun(operation),
      await client.releaseMatrixCorpusRun(operation),
      await client.abortProvisioningMatrixCorpusRun(operation),
      await client.cleanupMatrixCorpusRun({
        ...operation,
        targetRunId: 'run_old',
        targetLeaseFence: '3',
        targetRunFenceDigest: digest,
        expectedRevision: 0,
      }),
    ];

    expect(results).toEqual(
      Array.from({ length: 9 }, () => ({ ok: false, error: { code: 'invalid_response' } }))
    );
    expect(nock.isDone()).toBe(true);
  });

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

  it('maps private transport failures without logging routes, user IDs, or raw errors', async () => {
    nock(BASE_URL)
      .get('/internal/whatsapp/private/matrix-delivery-status/user-123')
      .replyWithError('private-status-network-sentinel')
      .post('/internal/whatsapp/private/outbound-matrix-messages')
      .replyWithError('private-send-network-sentinel');

    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const status = await client.getPrivateMatrixDeliveryStatus('user-123');
    const send = await client.sendPrivateOutboundMatrixMessage({ userId: 'user-123', text: 'hi' });

    expect(status.ok).toBe(false);
    expect(send.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    for (const call of logger.warn.mock.calls) {
      expect(call).toEqual([{ _skipSentry: true }, 'private internal-client network error']);
    }
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
      /user-123|private-status-network-sentinel|private-send-network-sentinel/iu
    );
  });

  it('validates a private group digest source through the protected owner endpoint', async () => {
    const response = {
      sourceAccountId: 'source-synthetic',
      generationId: 'generation-synthetic',
      chatId: 'chat-synthetic',
      chatType: 'group' as const,
      displayName: 'Synthetic group',
      messageCount: 12,
      participantCount: 3,
      lastActivityAt: '2026-07-27T12:34:56.000Z',
      sourceRevision: 'opaque-source-revision',
    };
    const scope = nock(BASE_URL)
      .post('/internal/whatsapp/private/digest-source/validate', {
        userId: 'user-synthetic',
        chatId: 'chat-synthetic',
        expectedGenerationId: 'generation-synthetic',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.validatePrivateDigestSource({
      userId: 'user-synthetic',
      chatId: 'chat-synthetic',
      expectedGenerationId: 'generation-synthetic',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: response });
  });

  it('rejects unknown private fields in a digest-source response', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/private/digest-source/validate')
      .reply(200, {
        success: true,
        data: {
          sourceAccountId: 'source-synthetic',
          generationId: 'generation-synthetic',
          chatId: 'chat-synthetic',
          chatType: 'direct',
          displayName: 'Synthetic contact',
          messageCount: 2,
          sourceRevision: 'opaque-source-revision',
          rawPhoneNumber: 'private-field-sentinel',
        },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.validatePrivateDigestSource({
      userId: 'user-synthetic',
      chatId: 'chat-synthetic',
    });

    expect(result).toEqual({ ok: false, error: { code: 'invalid_response' } });
    expect(JSON.stringify(result)).not.toContain('private-field-sentinel');
  });

  it('queries one strict page of private digest messages', async () => {
    const request = {
      userId: 'user-synthetic',
      sourceAccountId: 'source-synthetic',
      generationId: 'generation-synthetic',
      chatId: 'chat-synthetic',
      chatType: 'direct' as const,
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-28T00:00:00.000Z',
      limit: 100,
      cursor: 'opaque-cursor-in',
    };
    const response = {
      messages: [
        {
          messageRef: 'opaque-message-ref',
          eventTimestamp: '2026-07-27T12:34:56.000Z',
          direction: 'inbound' as const,
          authorLabel: 'Synthetic participant',
          text: 'Synthetic message',
          contentKind: 'text' as const,
        },
      ],
      sourceRevision: 'opaque-source-revision',
      highWatermark: 'opaque-high-watermark',
      nextCursor: 'opaque-cursor-out',
    };
    const scope = nock(BASE_URL)
      .post('/internal/whatsapp/private/digest-source/messages/query', request)
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.queryPrivateDigestMessages(request);

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: response });
  });

  it('gets versioned digest delivery readiness without a recipient input', async () => {
    const response = {
      status: 'ready' as const,
      maskedPrimaryNumber: '•••• 1234',
      observationVersion: 'opaque-readiness-version',
      observedAt: '2026-07-27T12:34:56.000Z',
    };
    const scope = nock(BASE_URL)
      .post('/internal/whatsapp/delivery-readiness/get', { userId: 'user-synthetic' })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.getWhatsAppDeliveryReadiness('user-synthetic');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: response });
  });

  it('gets a truthful outbound delivery state by owner and idempotency key', async () => {
    const request = {
      userId: 'user-synthetic',
      idempotencyKey: 'digest-run-synthetic',
    };
    const response = {
      status: 'sent' as const,
      acceptedAt: '2026-07-27T12:34:56.000Z',
    };
    const scope = nock(BASE_URL)
      .post('/internal/whatsapp/outbound-deliveries/get', request)
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.getOutboundDeliveryState(request);

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: response });
  });

  it('authorizes a byte-identical outbound delivery retry', async () => {
    const request = {
      userId: 'user-synthetic',
      idempotencyKey: 'digest-run-synthetic',
      payloadDigest: 'a'.repeat(64),
    };
    const scope = nock(BASE_URL)
      .post('/internal/whatsapp/outbound-deliveries/retry', request)
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: { authorized: true } });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.authorizeOutboundDeliveryRetry(request);

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: { authorized: true } });
  });

  it('rejects unknown fields in outbound delivery retry authorization', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/outbound-deliveries/retry')
      .reply(200, {
        success: true,
        data: { authorized: true, privateReceipt: 'private-retry-sentinel' },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.authorizeOutboundDeliveryRetry({
      userId: 'user-synthetic',
      idempotencyKey: 'digest-run-synthetic',
      payloadDigest: 'a'.repeat(64),
    });

    expect(result).toEqual({ ok: false, error: { code: 'invalid_response' } });
    expect(JSON.stringify(result)).not.toContain('private-retry-sentinel');
  });

  it('maps a private digest request timeout without downstream details', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/private/digest-source/validate')
      .delayConnection(50)
      .reply(200, { success: true, data: {} });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 5,
    });

    const result = await client.validatePrivateDigestSource({
      userId: 'user-synthetic',
      chatId: 'chat-synthetic',
    });

    expect(result).toEqual({ ok: false, error: { code: 'timeout' } });
  });

  it('maps a source snapshot conflict without exposing the downstream body', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/private/digest-source/messages/query')
      .reply(409, {
        success: false,
        error: {
          code: 'SOURCE_CHANGED',
          message: 'private-source-change-sentinel',
        },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.queryPrivateDigestMessages({
      userId: 'user-synthetic',
      sourceAccountId: 'source-synthetic',
      generationId: 'generation-synthetic',
      chatId: 'chat-synthetic',
      chatType: 'group',
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-28T00:00:00.000Z',
      limit: 100,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'source_changed', httpStatus: 409 },
    });
    expect(JSON.stringify(result)).not.toContain('private-source-change-sentinel');
  });

  it('fails closed for a primitive conflict body and a malformed success envelope', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/private/digest-source/messages/query')
      .reply(409, 'private-conflict-body-sentinel')
      .post('/internal/whatsapp/private/digest-source/messages/query')
      .reply(200, { success: false, data: {} });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const input = {
      userId: 'user-synthetic',
      sourceAccountId: 'source-synthetic',
      generationId: 'generation-synthetic',
      chatId: 'chat-synthetic',
      chatType: 'group' as const,
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-28T00:00:00.000Z',
      limit: 100,
    };

    const conflict = await client.queryPrivateDigestMessages(input);
    const malformed = await client.queryPrivateDigestMessages(input);

    expect(conflict).toEqual({ ok: false, error: { code: 'rejected', httpStatus: 409 } });
    expect(malformed).toEqual({ ok: false, error: { code: 'invalid_response' } });
    expect(JSON.stringify([conflict, malformed])).not.toContain('private-conflict-body-sentinel');
  });

  it('maps a private digest network failure to unavailable', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/delivery-readiness/get')
      .replyWithError('private-digest-network-sentinel');
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.getWhatsAppDeliveryReadiness('user-synthetic');

    expect(result).toEqual({ ok: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private-digest-network-sentinel');
  });

  it('maps a missing private digest source without response details', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/private/digest-source/validate')
      .reply(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: 'private-not-found-sentinel' },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.validatePrivateDigestSource({
      userId: 'user-synthetic',
      chatId: 'chat-synthetic',
    });

    expect(result).toEqual({ ok: false, error: { code: 'not_found', httpStatus: 404 } });
    expect(JSON.stringify(result)).not.toContain('private-not-found-sentinel');
  });

  it('maps another digest API rejection to its safe HTTP status only', async () => {
    nock(BASE_URL)
      .post('/internal/whatsapp/outbound-deliveries/get')
      .reply(503, {
        success: false,
        error: { code: 'UNAVAILABLE', message: 'private-api-sentinel' },
      });
    const client = createWhatsAppServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.getOutboundDeliveryState({
      userId: 'user-synthetic',
      idempotencyKey: 'digest-run-synthetic',
    });

    expect(result).toEqual({ ok: false, error: { code: 'rejected', httpStatus: 503 } });
    expect(JSON.stringify(result)).not.toContain('private-api-sentinel');
  });
});
