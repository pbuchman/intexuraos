/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMatrixCorpusRoutes } from '../../routes/matrixCorpusRoutes.js';

const token = 'test-internal-auth-token';
const digest = 'a'.repeat(64);
const requestId = 'request_00000001';

function capabilityPayload() {
  return {
    leaseFence: '7',
    idempotencyKey: requestId,
    capability: `imc1_${'A'.repeat(43)}`,
    scenarioId: 'scenario_1',
    scenarioNumber: 1,
    scenarioLabel: 'Scenario one',
    promptNormalizationVersion: 1,
    promptDigest: 'f'.repeat(64),
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
    mockProfileDigest: 'b'.repeat(64),
    expectedToolSchedule: [],
    currentDateTime: '2026-07-20T10:01:00.000Z',
    timeZone: 'Europe/Warsaw',
  } as const;
}

function dependencies(enabled = true, runtimeAudience = 'hetzner-prod') {
  return {
    gate: {
      enabled,
      runtimeAudience,
      evaluator: {
        userId: 'configured_user',
        matrixRoomBindingDigest: digest,
        whatsappAccountBindingDigest: 'b'.repeat(64),
        whatsappSenderBindingDigest: 'c'.repeat(64),
      },
    },
    digestMatrixIdempotencyKey: vi.fn().mockReturnValue('d'.repeat(64)),
    issueControlAuthorization: vi.fn().mockResolvedValue({
      code: 'AUTHORIZED',
      authorization: {
        version: 1,
        kind: 'matrix_corpus_control_mutation',
        eventId: 'control_event_1',
        leaseFence: '7',
        payloadDigest: 'e'.repeat(64),
        attestation: 'e30.e30.AA',
      },
    }),
    controlPlane: {
      acquireProvisioningLease: vi.fn().mockResolvedValue({
        code: 'ACQUIRED',
        runId: 'run_1',
        leaseFence: '7',
        phase: 'provisioning',
        acquiredAt: '2026-07-20T10:00:00.000Z',
        expiresAt: '2026-07-20T10:05:00.000Z',
      }),
      activateRun: vi.fn().mockResolvedValue({
        code: 'ACTIVATED',
        runId: 'run_1',
        leaseFence: '7',
        phase: 'active',
        activatedAt: '2026-07-20T10:01:00.000Z',
      }),
      renewLease: vi.fn().mockResolvedValue({
        code: 'LEASE_RENEWED',
        runId: 'run_1',
        leaseFence: '7',
        phase: 'active',
        renewedAt: '2026-07-20T10:01:00.000Z',
        expiresAt: '2026-07-20T10:06:00.000Z',
      }),
      issueCapability: vi.fn().mockResolvedValue({
        code: 'CAPABILITY_ISSUED',
        runId: 'run_1',
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        issuedAt: '2026-07-20T10:01:00.000Z',
        expiresAt: '2026-07-20T10:06:00.000Z',
      }),
      recordMatrixSendProof: vi.fn().mockResolvedValue({
        code: 'MATRIX_SEND_PROOF_RECORDED',
        runId: 'run_1',
        leaseFence: '7',
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        recordedAt: '2026-07-20T10:01:01.000Z',
      }),
      getTransportStatus: vi.fn().mockResolvedValue({
        code: 'TRANSPORT_STATUS',
        runId: 'run_1',
        leaseFence: '7',
        phase: 'quiescing',
        consumedCapabilityCount: 1,
        terminalIntexMarkerCount: 1,
        terminalOutboxCount: 1,
        replyOrDeliveryWorkInFlight: 0,
        nonterminalIngestOutboxCount: 0,
        drained: true,
      }),
      quiesceRun: vi.fn().mockResolvedValue({
        code: 'QUIESCED',
        runId: 'run_1',
        leaseFence: '7',
        phase: 'quiescing',
        quiescedAt: '2026-07-20T10:02:00.000Z',
        drained: true,
      }),
      releaseRun: vi.fn().mockResolvedValue({
        code: 'RELEASE_PENDING',
        runId: 'run_1',
        leaseFence: '7',
        terminalControlId: 'terminal_1',
        eventId: 'terminal_1',
        createdAt: '2026-07-20T10:03:00.000Z',
      }),
      abortProvisioningRun: vi.fn().mockResolvedValue({
        code: 'ABANDON_PENDING',
        runId: 'run_1',
        leaseFence: '7',
        phase: 'abandon_pending',
        terminalControlId: 'terminal_abort_1',
        eventId: 'terminal_abort_1',
        reconciledAt: '2026-07-20T10:03:30.000Z',
      }),
      cleanupExactRun: vi.fn().mockResolvedValue({
        code: 'RUN_CLEANED',
        targetRunId: 'run_old',
        targetLeaseFence: '6',
        targetRunFenceDigest: 'e'.repeat(64),
        finalRevision: 1,
        cleanedAt: '2026-07-20T10:04:00.000Z',
      }),
    },
  };
}

describe('Matrix corpus control routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = token;
  });

  afterEach(async () => {
    await app?.close();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  async function start(deps = dependencies(), logLines?: string[]): Promise<typeof deps> {
    app = Fastify(
      logLines === undefined
        ? { logger: false }
        : {
            logger: {
              stream: {
                write(message: string) {
                  logLines.push(message);
                },
              },
            },
          }
    );
    await app.register(intexuraFastifyPlugin);
    await app.register(fastifySwagger, {
      openapi: { info: { title: 'Matrix corpus route test', version: '1.0.0' } },
    });
    await app.register(createMatrixCorpusRoutes(deps));
    await app.ready();
    return deps;
  }

  it('does not register any route when disabled or outside home-dev', async () => {
    for (const deps of [dependencies(false), dependencies(true, 'dev')]) {
      await start(deps);
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs',
        payload: { ignored: 'x'.repeat(10_000) },
      });
      expect(response.statusCode).toBe(404);
      expect(deps.controlPlane.acquireProvisioningLease).not.toHaveBeenCalled();
      await app.close();
    }
  });

  it('authenticates then injects the configured evaluator binding into provisioning', async () => {
    const deps = await start();
    const missingAuth = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs',
      payload: { runId: 'run_1', idempotencyKey: requestId },
    });
    expect(missingAuth.statusCode).toBe(401);
    expect(deps.controlPlane.acquireProvisioningLease).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs',
      headers: { 'x-internal-auth': token },
      payload: { runId: 'run_1', idempotencyKey: requestId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().data).toEqual({
      code: 'ACQUIRED',
      runId: 'run_1',
      phase: 'provisioning',
      leaseFence: '7',
      acquiredAt: '2026-07-20T10:00:00.000Z',
      expiresAt: '2026-07-20T10:05:00.000Z',
    });
    expect(deps.controlPlane.acquireProvisioningLease).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'configured_user',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: 'b'.repeat(64),
      whatsappSenderBindingDigest: 'c'.repeat(64),
      idempotencyKey: requestId,
    });
  });

  it('protects readiness with internal auth and returns only the closed ready marker', async () => {
    await start();

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/readiness',
    });
    expect(unauthorized.statusCode).toBe(401);

    const ready = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/readiness',
      headers: { 'x-internal-auth': token },
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data).toEqual({ status: 'ready' });
  });

  it('rejects unknown and injected authority fields before the domain call', async () => {
    const deps = await start();
    for (const extra of [
      { userId: 'other_user' },
      { enabled: true },
      { runtimeAudience: 'hetzner-prod' },
      { matrixRoomBindingDigest: digest },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs',
        headers: { 'x-internal-auth': token },
        payload: { runId: 'run_1', idempotencyKey: requestId, ...extra },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(deps.controlPlane.acquireProvisioningLease).not.toHaveBeenCalled();
  });

  it('exposes the remaining seven closed routes and projects only safe response fields', async () => {
    const deps = await start();
    const headers = { 'x-internal-auth': token };
    const operationPayload = { leaseFence: '7', idempotencyKey: requestId };

    const activate = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/activate',
      headers,
      payload: operationPayload,
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().data).toEqual({
      code: 'ACTIVATED',
      runId: 'run_1',
      leaseFence: '7',
      phase: 'active',
      activatedAt: '2026-07-20T10:01:00.000Z',
    });
    expect(deps.controlPlane.activateRun).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'configured_user',
      leaseFence: '7',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: 'b'.repeat(64),
      whatsappSenderBindingDigest: 'c'.repeat(64),
      idempotencyKey: requestId,
    });

    const renew = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/lease/renew',
      headers,
      payload: operationPayload,
    });
    expect(renew.statusCode).toBe(200);
    expect(renew.json().data).toEqual({
      code: 'LEASE_RENEWED',
      runId: 'run_1',
      leaseFence: '7',
      phase: 'active',
      renewedAt: '2026-07-20T10:01:00.000Z',
      expiresAt: '2026-07-20T10:06:00.000Z',
    });

    const issue = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/capabilities',
      headers,
      payload: {
        ...capabilityPayload(),
      },
    });
    expect(issue.statusCode).toBe(200);
    expect(issue.headers['cache-control']).toBe('no-store');
    expect(issue.json().data).toEqual({
      code: 'CAPABILITY_ISSUED',
      runId: 'run_1',
      leaseFence: '7',
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      issuedAt: '2026-07-20T10:01:00.000Z',
      expiresAt: '2026-07-20T10:06:00.000Z',
    });
    expect(deps.controlPlane.issueCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeAudience: 'hetzner-prod',
        userId: 'configured_user',
        matrixRoomBindingDigest: digest,
        whatsappAccountBindingDigest: 'b'.repeat(64),
        whatsappSenderBindingDigest: 'c'.repeat(64),
        matrixIdempotencyKeyDigest: 'd'.repeat(64),
        rawCapability: `imc1_${'A'.repeat(43)}`,
      })
    );

    const matrixMessageText = `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · imc1_${'A'.repeat(43)}\n\nPrivate test`;
    const sendProof = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/matrix-send-proofs',
      headers,
      payload: {
        leaseFence: '7',
        idempotencyKey: requestId,
        capability: `imc1_${'A'.repeat(43)}`,
        scenarioId: 'scenario_1',
        scenarioNumber: 1,
        phase: 'start',
        turnIndex: 0,
        matrixEventId: '$event-1',
        matrixRoomId: '!room:home-dev',
        messageText: matrixMessageText,
      },
    });
    expect(sendProof.statusCode).toBe(200);
    expect(sendProof.json().data).toEqual({
      code: 'MATRIX_SEND_PROOF_RECORDED',
      runId: 'run_1',
      leaseFence: '7',
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      recordedAt: '2026-07-20T10:01:01.000Z',
    });
    expect(deps.controlPlane.recordMatrixSendProof).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'configured_user',
        matrixRoomBindingDigest: digest,
        matrixEventId: '$event-1',
        matrixRoomId: '!room:home-dev',
        messageText: matrixMessageText,
      })
    );

    const status = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/transport-status?scenarioId=scenario_1&turnIndex=0',
      headers: { ...headers, 'x-matrix-corpus-lease-fence': '7' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toEqual({
      code: 'TRANSPORT_STATUS',
      runId: 'run_1',
      leaseFence: '7',
      phase: 'quiescing',
      consumedCapabilityCount: 1,
      terminalIntexMarkerCount: 1,
      terminalOutboxCount: 1,
      replyOrDeliveryWorkInFlight: 0,
      nonterminalIngestOutboxCount: 0,
      drained: true,
    });
    expect(deps.controlPlane.getTransportStatus).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'configured_user',
      leaseFence: '7',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: 'b'.repeat(64),
      whatsappSenderBindingDigest: 'c'.repeat(64),
    });

    const quiesce = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/quiesce',
      headers,
      payload: operationPayload,
    });
    expect(quiesce.statusCode).toBe(200);

    const release = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/release',
      headers,
      payload: operationPayload,
    });
    expect(release.statusCode).toBe(200);
    expect(release.json().data).toEqual({
      code: 'RELEASE_PENDING',
      runId: 'run_1',
      leaseFence: '7',
      phase: 'release_pending',
      createdAt: '2026-07-20T10:03:00.000Z',
    });

    const cleanup = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/cleanup',
      headers,
      payload: {
        leaseFence: '7',
        targetRunId: 'run_old',
        targetLeaseFence: '6',
        targetRunFenceDigest: 'e'.repeat(64),
        expectedRevision: 0,
        idempotencyKey: requestId,
      },
    });
    expect(cleanup.statusCode).toBe(200);
    expect(cleanup.json().data).toEqual({
      code: 'RUN_CLEANED',
      targetRunId: 'run_old',
      targetLeaseFence: '6',
      targetRunFenceDigest: 'e'.repeat(64),
      state: 'cleaned',
      finalRevision: 1,
      cleanedAt: '2026-07-20T10:04:00.000Z',
    });
    expect(deps.controlPlane.cleanupExactRun).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'configured_user',
      leaseFence: '7',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: 'b'.repeat(64),
      whatsappSenderBindingDigest: 'c'.repeat(64),
      targetRunId: 'run_old',
      targetLeaseFence: '6',
      targetRunFenceDigest: 'e'.repeat(64),
      expectedRevision: 0,
      idempotencyKey: requestId,
    });

    const abort = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/abort-provisioning',
      headers,
      payload: operationPayload,
    });
    expect(abort.statusCode).toBe(200);
    expect(abort.json().data).toEqual({
      code: 'ABANDON_PENDING',
      runId: 'run_1',
      leaseFence: '7',
      phase: 'abandon_pending',
      reconciledAt: '2026-07-20T10:03:30.000Z',
    });
    expect(deps.controlPlane.abortProvisioningRun).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'configured_user',
      leaseFence: '7',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: 'b'.repeat(64),
      whatsappSenderBindingDigest: 'c'.repeat(64),
      idempotencyKey: requestId,
    });
  });

  it('rejects extra fields, query-fence authority, and nested mock-profile drift', async () => {
    const deps = await start();
    const headers = { 'x-internal-auth': token };
    const operationPayload = { leaseFence: '7', idempotencyKey: requestId };
    const operationRoutes = ['activate', 'lease/renew', 'quiesce', 'release', 'abort-provisioning'];
    for (const suffix of operationRoutes) {
      const response = await app.inject({
        method: 'POST',
        url: `/internal/matrix-corpus/runs/run_1/${suffix}`,
        headers,
        payload: { ...operationPayload, userId: 'injected_user' },
      });
      expect(response.statusCode).toBe(400);
    }

    const issue = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/capabilities',
      headers,
      payload: {
        ...capabilityPayload(),
        mockProfile: { ...capabilityPayload().mockProfile, extra: true },
      },
    });
    expect(issue.statusCode).toBe(400);

    const queryFence = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/transport-status?leaseFence=7',
      headers: { ...headers, 'x-matrix-corpus-lease-fence': '7' },
    });
    expect(queryFence.statusCode).toBe(400);

    const missingFence = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/transport-status',
      headers,
    });
    expect(missingFence.statusCode).toBe(400);

    const cleanup = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/cleanup',
      headers,
      payload: {
        leaseFence: '7',
        targetRunId: 'run_old',
        targetLeaseFence: '6',
        targetRunFenceDigest: 'e'.repeat(64),
        expectedRevision: Number.MAX_SAFE_INTEGER,
        idempotencyKey: requestId,
      },
    });
    expect(cleanup.statusCode).toBe(400);

    for (const call of Object.values(deps.controlPlane)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('issues a closed signed authorization for one exact Intex mutation', async () => {
    const deps = await start();
    const request = {
      operation: 'register_context',
      leaseFence: '7',
      request: {
        runtimeAudience: 'hetzner-prod',
        userId: 'configured_user',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/control-authorizations',
      headers: { 'x-internal-auth': token },
      payload: request,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().data.authorization).toMatchObject({
      kind: 'matrix_corpus_control_mutation',
      eventId: 'control_event_1',
      leaseFence: '7',
    });
    expect(deps.issueControlAuthorization).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'configured_user',
      leaseFence: '7',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: 'b'.repeat(64),
      whatsappSenderBindingDigest: 'c'.repeat(64),
      operation: 'register_context',
      request: request.request,
    });
  });

  it('fails capability issuance closed for digest and semantic contract failures', async () => {
    const deps = await start();
    deps.digestMatrixIdempotencyKey
      .mockImplementationOnce(() => {
        throw new Error('digest unavailable');
      })
      .mockReturnValueOnce('invalid')
      .mockReturnValue('d'.repeat(64));
    const headers = { 'x-internal-auth': token };

    for (const expectedStatus of [500, 500]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs/run_1/capabilities',
        headers,
        payload: capabilityPayload(),
      });
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json().data).toEqual({ code: 'CORRUPT_STATE' });
    }

    const semanticallyInvalid = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/capabilities',
      headers,
      payload: {
        ...capabilityPayload(),
        phase: 'turn',
        expectedSessionId: null,
      },
    });
    expect(semanticallyInvalid.statusCode).toBe(400);
    expect(deps.controlPlane.issueCapability).not.toHaveBeenCalled();
  });

  it('maps authorization issuer throws and every malformed result shape without leaking details', async () => {
    const deps = await start();
    deps.issueControlAuthorization
      .mockRejectedValueOnce(new Error('private issuer failure'))
      .mockResolvedValueOnce({ code: 'NOT_READY' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ code: 7 });
    const payload = {
      operation: 'register_context',
      leaseFence: '7',
      request: { runtimeAudience: 'hetzner-prod' },
    };
    const expected = [
      [500, 'CORRUPT_STATE'],
      [409, 'NOT_READY'],
      [500, 'CORRUPT_STATE'],
      [500, 'CORRUPT_STATE'],
      [500, 'CORRUPT_STATE'],
    ] as const;

    for (const [status, code] of expected) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs/run_1/control-authorizations',
        headers: { 'x-internal-auth': token },
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().data).toEqual({ code });
      expect(response.body).not.toContain('private issuer failure');
    }
  });

  it('contains domain throws, malformed results, capability expiry, and cleanup progress', async () => {
    const deps = await start();
    const headers = { 'x-internal-auth': token };
    const operationPayload = { leaseFence: '7', idempotencyKey: requestId };

    deps.controlPlane.activateRun
      .mockRejectedValueOnce(new Error('private domain failure'))
      .mockResolvedValueOnce({ private: 'malformed' });
    for (const _attempt of [0, 1]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs/run_1/activate',
        headers,
        payload: operationPayload,
      });
      expect(response.statusCode).toBe(500);
      expect(response.json().data).toEqual({ code: 'CORRUPT_STATE' });
    }

    deps.controlPlane.issueCapability.mockResolvedValueOnce({
      code: 'CAPABILITY_EXPIRED',
    });
    const expired = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/capabilities',
      headers,
      payload: capabilityPayload(),
    });
    expect(expired.statusCode).toBe(410);

    deps.controlPlane.cleanupExactRun.mockResolvedValueOnce({
      code: 'RUN_CLEANUP_PROGRESS',
      targetRunId: 'run_old',
      targetLeaseFence: '6',
      targetRunFenceDigest: 'e'.repeat(64),
      committedRevision: 1,
      remainingChildCount: 2,
      chunkCommittedAt: '2026-07-20T10:04:00.000Z',
    });
    const progress = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/cleanup',
      headers,
      payload: {
        leaseFence: '7',
        targetRunId: 'run_old',
        targetLeaseFence: '6',
        targetRunFenceDigest: 'e'.repeat(64),
        expectedRevision: 0,
        idempotencyKey: requestId,
      },
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().data).toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
      state: 'progress',
      committedRevision: 1,
      remainingChildCount: 2,
    });
  });

  it('authenticates before every operation and maps closed domain outcomes', async () => {
    const deps = await start();
    deps.controlPlane.activateRun.mockResolvedValueOnce({ code: 'NOT_READY', gate: 'activation' });
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/activate',
      payload: { malformed: true },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(deps.controlPlane.activateRun).not.toHaveBeenCalled();

    const notReady = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/activate',
      headers: { 'x-internal-auth': token },
      payload: { leaseFence: '7', idempotencyKey: requestId },
    });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json().data).toEqual({ code: 'NOT_READY' });

    deps.controlPlane.getTransportStatus.mockResolvedValueOnce({
      code: 'LEASE_EXPIRED',
      expiresAt: '2026-07-20T10:00:00.000Z',
    });
    const expired = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/transport-status',
      headers: {
        'x-internal-auth': token,
        'x-matrix-corpus-lease-fence': '7',
      },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().data).toEqual({ code: 'LEASE_EXPIRED' });

    deps.controlPlane.cleanupExactRun.mockResolvedValueOnce({ code: 'NOT_FOUND' });
    const missing = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/cleanup',
      headers: { 'x-internal-auth': token },
      payload: {
        leaseFence: '7',
        targetRunId: 'run_old',
        targetLeaseFence: '6',
        targetRunFenceDigest: 'e'.repeat(64),
        expectedRevision: 0,
        idempotencyKey: requestId,
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().data).toEqual({ code: 'NOT_FOUND' });
  });

  it('authenticates capability, Matrix proof, and control-authorization routes before domain work', async () => {
    const deps = await start();
    const matrixMessageText = `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · imc1_${'A'.repeat(43)}\n\nPrivate test`;
    const requests = [
      {
        url: '/internal/matrix-corpus/runs/run_1/capabilities',
        payload: capabilityPayload(),
      },
      {
        url: '/internal/matrix-corpus/runs/run_1/matrix-send-proofs',
        payload: {
          leaseFence: '7',
          idempotencyKey: requestId,
          capability: `imc1_${'A'.repeat(43)}`,
          scenarioId: 'scenario_1',
          scenarioNumber: 1,
          phase: 'start',
          turnIndex: 0,
          matrixEventId: '$event-1',
          matrixRoomId: '!room:home-dev',
          messageText: matrixMessageText,
        },
      },
      {
        url: '/internal/matrix-corpus/runs/run_1/control-authorizations',
        payload: {
          operation: 'register_context',
          leaseFence: '7',
          request: { runtimeAudience: 'hetzner-prod' },
        },
      },
    ] as const;

    for (const request of requests) {
      const response = await app.inject({ method: 'POST', ...request });
      expect(response.statusCode).toBe(401);
    }
    expect(deps.digestMatrixIdempotencyKey).not.toHaveBeenCalled();
    expect(deps.controlPlane.issueCapability).not.toHaveBeenCalled();
    expect(deps.controlPlane.recordMatrixSendProof).not.toHaveBeenCalled();
    expect(deps.issueControlAuthorization).not.toHaveBeenCalled();
  });

  it('publishes readiness plus all ten strict operations without request-controlled authority fields', async () => {
    await start();
    const spec = (
      app as FastifyInstance & {
        swagger(): {
          paths?: Record<string, Record<string, { operationId?: string; requestBody?: unknown }>>;
        };
      }
    ).swagger();
    const operations = [
      ['/internal/matrix-corpus/readiness', 'get', 'getMatrixCorpusReadiness'],
      ['/internal/matrix-corpus/runs', 'post', 'createMatrixCorpusRun'],
      ['/internal/matrix-corpus/runs/{runId}/activate', 'post', 'activateMatrixCorpusRun'],
      [
        '/internal/matrix-corpus/runs/{runId}/lease/renew',
        'post',
        'renewMatrixCorpusRunLease',
      ],
      [
        '/internal/matrix-corpus/runs/{runId}/capabilities',
        'post',
        'issueMatrixCorpusCapability',
      ],
      [
        '/internal/matrix-corpus/runs/{runId}/control-authorizations',
        'post',
        'issueMatrixCorpusControlAuthorization',
      ],
      [
        '/internal/matrix-corpus/runs/{runId}/transport-status',
        'get',
        'getMatrixCorpusTransportStatus',
      ],
      ['/internal/matrix-corpus/runs/{runId}/quiesce', 'post', 'quiesceMatrixCorpusRun'],
      ['/internal/matrix-corpus/runs/{runId}/release', 'post', 'releaseMatrixCorpusRun'],
      [
        '/internal/matrix-corpus/runs/{runId}/abort-provisioning',
        'post',
        'abortProvisioningMatrixCorpusRun',
      ],
      ['/internal/matrix-corpus/runs/{runId}/cleanup', 'post', 'cleanupMatrixCorpusRun'],
    ] as const;
    for (const [path, method, operationId] of operations) {
      expect(spec.paths?.[path]?.[method]?.operationId).toBe(operationId);
    }

    const serialized = JSON.stringify(spec.paths);
    expect(serialized).toContain('x-internal-auth');
    expect(serialized).toContain('additionalProperties');
    expect(serialized).toContain('writeOnly');
    expect(serialized).not.toContain('matrixRoomBindingDigest');
    expect(serialized).not.toContain('whatsappAccountBindingDigest');
    expect(serialized).not.toContain('whatsappSenderBindingDigest');
    expect(serialized).not.toContain('"userId"');
    expect(serialized).not.toContain('runtimeAudience');
  });

  it('never logs the sensitive transport-status lease-fence header', async () => {
    const logLines: string[] = [];
    await start(dependencies(), logLines);
    const sensitiveLeaseFence = '918273645546372819';

    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/transport-status',
      headers: {
        'x-internal-auth': token,
        'x-matrix-corpus-lease-fence': sensitiveLeaseFence,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(logLines.join('')).not.toContain(sensitiveLeaseFence);
  });
});
