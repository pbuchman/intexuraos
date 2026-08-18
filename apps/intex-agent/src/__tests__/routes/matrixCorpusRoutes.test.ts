import { createHash } from 'node:crypto';

import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { canonicalMatrixCorpusControlRequestDigestInputV1 } from '@intexuraos/http-contracts';
import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testRunRecord, testRunScenario } from '../domain/testRuns/testRunFixtures.js';
import {
  createMatrixCorpusRoutes,
  type MatrixCorpusRoutesDependencies,
} from '../../routes/matrixCorpusRoutes.js';

const internalAuthToken = 'matrix-corpus-route-token';
const now = '2026-07-20T10:00:00.000Z';

type TestMock = ReturnType<typeof vi.fn>;

interface RouteFixture {
  dependencies: MatrixCorpusRoutesDependencies;
  contextService: Readonly<{ registerRun: TestMock; finalizeRun: TestMock }>;
  contextRepository: Readonly<{ getRunContext: TestMock }>;
  manifestRepository: Readonly<{ getExact: TestMock }>;
  testRunRepository: Readonly<{
    getCurrentAcceptance: TestMock;
    listLatestForUser: TestMock;
    createOrGet: TestMock;
    getExact: TestMock;
    getScenarioConsistent: TestMock;
    applyProjection: TestMock;
    applyArtifactDelivery: TestMock;
    cleanupExactRun: TestMock;
    finalizeRun: TestMock;
    applyTerminalControl: TestMock;
    applyAbandonedRecovery: TestMock;
  }>;
  sessionRepository: Readonly<{ listMatrixCorpusEventsExact: TestMock }>;
  evidenceService: Readonly<{ getExact: TestMock }>;
  verifyAttestation: TestMock;
}

function contextBody(
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    runtimeAudience: 'hetzner-prod',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    expectedTimeZone: 'Europe/Warsaw',
    ...overrides,
  };
}

function finalizationBody(): Readonly<{
  runtimeAudience: 'hetzner-prod';
  userId: string;
  leaseFence: string;
  expectedRevision: number;
  artifactStageDigest: string;
  terminalCandidate: Readonly<{
    version: 1;
    runId: string;
    userId: string;
    leaseFence: string;
    outcome: 'completed_passed';
    projectionDigest: string;
    artifactStageRevision: number;
    artifactCandidateDigest: string;
    createdAt: string;
  }>;
}> {
  return {
    runtimeAudience: 'hetzner-prod',
    userId: 'auth0:user_1',
    leaseFence: '7',
    expectedRevision: 1,
    artifactStageDigest: 'e'.repeat(64),
    terminalCandidate: {
      version: 1 as const,
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      outcome: 'completed_passed' as const,
      projectionDigest: 'b'.repeat(64),
      artifactStageRevision: 1,
      artifactCandidateDigest: 'c'.repeat(64),
      createdAt: now,
    },
  };
}

type ControlOperation =
  | 'register_context'
  | 'finalize_run'
  | 'create_projection'
  | 'advance_projection';

function authorizedMutation(
  operation: ControlOperation,
  request: Readonly<Record<string, unknown>>,
  runId = 'run_1'
): Readonly<Record<string, unknown>> {
  const requestDigest = createHash('sha256')
    .update(
      canonicalMatrixCorpusControlRequestDigestInputV1({
        version: 1,
        operation,
        runId,
        request,
      }),
      'utf8'
    )
    .digest('hex');
  return {
    authorization: {
      version: 1,
      kind: 'matrix_corpus_control_mutation',
      eventId: `${operation}_event`,
      leaseFence: '7',
      payloadDigest: requestDigest,
      attestation: 'e30.e30.AA',
    },
    request,
  };
}

const terminalEnvelope = {
  version: 1,
  kind: 'matrix_corpus_terminal_control',
  eventId: 'terminal_event_1',
  leaseFence: '7',
  payloadDigest: 'f'.repeat(64),
  attestation: 'e30.e30.AA',
} as const;
const abandonedEnvelope = {
  version: 1,
  kind: 'matrix_corpus_terminal_control',
  eventId: 'abandoned_event_1',
  leaseFence: '7',
  payloadDigest: 'a'.repeat(64),
  attestation: 'e30.e30.AA',
} as const;

function fixture(): RouteFixture {
  const contextService = {
    registerRun: vi.fn(
      async (input: {
        agentModel: 'or:deepseek/deepseek-v4-flash' | 'or:minimax/minimax-m3';
      }) => ({
        ok: true as const,
        disposition: 'applied' as const,
        snapshot: {
          promptPreferencesVersion: 2,
          promptPreferencesDigest: 'b'.repeat(64),
          agentModel: input.agentModel,
          userTimeZone: 'Europe/Warsaw',
          expiresAt: '2026-07-21T10:00:00.000Z',
        },
      })
    ),
    finalizeRun: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      context: {
        version: 1 as const,
        status: 'finalized' as const,
        runtimeAudience: 'hetzner-prod' as const,
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        scenarioContextCount: 1,
        finalizedAt: now,
      },
    })),
  };
  const contextRepository = {
    getRunContext: vi.fn(async () => ({
      ok: true as const,
      context: {
        version: 1 as const,
        status: 'active' as const,
        runtimeAudience: 'hetzner-prod' as const,
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        agentModel: 'or:deepseek/deepseek-v4-flash' as const,
        evaluatorModel: 'or:minimax/minimax-m3' as const,
        promptPreferencesVersion: 2,
        promptPreferencesDigest: 'b'.repeat(64),
        encryptedPromptContext: {
          version: 1 as const,
          algorithm: 'aes-256-gcm' as const,
          keyVersion: 'key_v1',
          nonce: 'A'.repeat(16),
          ciphertext: 'A'.repeat(16),
          authenticationTag: 'A'.repeat(22),
        },
        userTimeZone: 'Europe/Warsaw',
        createdAt: now,
        expiresAt: '2026-07-21T10:00:00.000Z',
        invalidatedAt: null,
      },
    })),
  };
  const manifestRepository = {
    getExact: vi.fn(async () => ({
      ok: true as const,
      manifest: {
        version: 1 as const,
        runtimeAudience: 'hetzner-prod' as const,
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        scenarioBindings: [],
        artifactStage: null,
        terminalCandidate: null,
        createdAt: now,
      },
    })),
  };
  const testRunRepository = {
    getCurrentAcceptance: vi.fn(async () => ({
      ok: true as const,
      acceptance: {
        kind: 'admission_ready' as const,
        current: 'absent' as const,
      },
    })),
    listLatestForUser: vi.fn(async () => ({
      ok: true as const,
      records: [testRunRecord()],
    })),
    createOrGet: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      record: testRunRecord(),
    })),
    getExact: vi.fn(async () => ({ ok: true as const, record: testRunRecord() })),
    getScenarioConsistent: vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND' as const })),
    applyProjection: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      record: testRunRecord({ revision: 1, lifecycle: 'running' }),
    })),
    applyArtifactDelivery: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      record: testRunRecord({ revision: 1, lifecycle: 'running' }),
    })),
    cleanupExactRun: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      currentRecord: testRunRecord({
        runId: 'run_current',
        leaseFence: '8',
        revision: 1,
        retentionReconciled: true,
      }),
      removed: {
        runs: 1,
        sessions: 1,
        events: 2,
        confirmations: 0,
        ingestReceipts: 1,
        scenarioProjections: 1,
        scenarioContexts: 0,
        runContexts: 1,
        manifests: 1,
      },
    })),
    finalizeRun: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      record: testRunRecord({
        revision: 2,
        lifecycle: 'finalizing',
        artifactDelivery: { status: 'staged', failureCode: null, updatedAt: now },
        contextFinalizationTombstoneDigest: 'd'.repeat(64),
        artifactStageDigest: 'e'.repeat(64),
        terminalCandidate: finalizationBody().terminalCandidate,
      }),
      tombstoneDigest: 'd'.repeat(64),
      scenarioContextCount: 1,
      finalizedAt: now,
    })),
    applyTerminalControl: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      record: testRunRecord({
        revision: 3,
        lifecycle: 'completed',
        verdict: 'passed',
        finishedAt: now,
        terminalWinner: {
          kind: 'release' as const,
          eventId: 'terminal_event_1',
          payloadDigest: 'f'.repeat(64),
          outcome: 'completed_passed' as const,
          acknowledgedAt: now,
        },
      }),
    })),
    applyAbandonedRecovery: vi.fn(async () => ({
      ok: true as const,
      disposition: 'applied' as const,
      winner: {
        kind: 'abandoned' as const,
        eventId: 'abandoned_event_1',
        payloadDigest: 'a'.repeat(64),
        outcome: 'provisioning_noop' as const,
        acknowledgedAt: now,
      },
    })),
  };
  const evidenceService = {
    getExact: vi.fn(async () => ({
      ok: true as const,
      evidence: {
        version: 1 as const,
        eventRevision: 3,
        toolEvidence: [
          {
            event: 'selected' as const,
            toolName: 'create_link' as const,
            turnIndex: 0,
            ordinal: 1,
            facts: [{ name: 'hasUrl' as const, value: true }],
          },
        ],
        agentUsage: [
          {
            turnIndex: 0,
            stage: 'agent_generation' as const,
            callOrdinal: 1,
            inputTokens: 5,
            outputTokens: 2,
            totalTokens: 7,
            costNanoUsd: 42,
          },
        ],
        agentUsageTotals: {
          inputTokens: 5,
          outputTokens: 2,
          totalTokens: 7,
          costNanoUsd: 42,
        },
        sessionProof: {
          status: 'waiting_for_user' as const,
          startReason: 'no_active_session' as const,
          userMessageCount: 1,
          sessionStartedCount: 0,
          supersededSessionCount: 0,
        },
        turnTerminals: [
          {
            status: 'completed' as const,
            turnIndex: 0,
            replyCount: 1,
            replyDigests: ['c'.repeat(64)],
            terminalMarkerDigest: 'd'.repeat(64),
            recordedAt: now,
          },
        ],
        strictMockProof: {
          version: 1 as const,
          status: 'passed' as const,
          executionMode: 'strict_mock_tools' as const,
          mockProfileDigest: 'b'.repeat(64),
          productionExecutorResolutions: 0 as const,
          productionExecutorAdmissions: 0 as const,
        },
      },
    })),
  };
  const sessionRepository = {
    listMatrixCorpusEventsExact: vi.fn(async () => ({ ok: true as const, events: [] })),
  };
  const verifyAttestation = vi.fn(async (input: unknown) => {
    if (
      typeof input === 'object' &&
      input !== null &&
      'kind' in input &&
      input.kind === 'matrix_corpus_control_mutation' &&
      'eventId' in input &&
      typeof input.eventId === 'string' &&
      'leaseFence' in input &&
      typeof input.leaseFence === 'string' &&
      'payloadDigest' in input &&
      typeof input.payloadDigest === 'string'
    ) {
      const operation = input.eventId.replace(/_event$/u, '') as ControlOperation;
      return {
        ok: true as const,
        claims: {
          version: 1 as const,
          kind: 'matrix_corpus_control_mutation' as const,
          issuer: 'whatsapp-service' as const,
          audience: 'intex-agent' as const,
          runtimeAudience: 'hetzner-prod' as const,
          keyVersion: 'key_v1',
          eventId: input.eventId,
          leaseFence: input.leaseFence,
          payloadDigest: input.payloadDigest,
          issuedAt: now,
          expiresAt: '2026-07-20T10:05:00.000Z',
          payload: {
            version: 1 as const,
            kind: operation,
            eventId: input.eventId,
            runId: 'run_1',
            userId: 'auth0:user_1',
            leaseFence: input.leaseFence,
            requestDigest: input.payloadDigest,
            createdAt: now,
          },
        },
      };
    }
    const isAbandoned =
      typeof input === 'object' &&
      input !== null &&
      'eventId' in input &&
      input.eventId === 'abandoned_event_1';
    return {
      ok: true as const,
      claims: {
      version: 1 as const,
      kind: 'matrix_corpus_terminal_control' as const,
      issuer: 'whatsapp-service' as const,
      audience: 'intex-agent' as const,
      runtimeAudience: 'hetzner-prod' as const,
      keyVersion: 'key_v1',
      eventId: isAbandoned ? 'abandoned_event_1' : 'terminal_event_1',
      leaseFence: '7',
      payloadDigest: isAbandoned ? 'a'.repeat(64) : 'f'.repeat(64),
      issuedAt: now,
      expiresAt: '2026-07-20T10:05:00.000Z',
      payload: {
        version: 1 as const,
        kind: isAbandoned ? ('abandoned' as const) : ('release' as const),
        eventId: isAbandoned ? 'abandoned_event_1' : 'terminal_event_1',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        tombstoneDigest: isAbandoned ? null : 'c'.repeat(64),
        terminalCandidateDigest: isAbandoned ? null : 'd'.repeat(64),
        artifactStageDigest: isAbandoned ? null : 'e'.repeat(64),
        createdAt: now,
      },
    },
    };
  });
  const dependencies = {
    enabled: true,
    configuredUserId: 'auth0:user_1',
    contextService,
    contextRepository,
    manifestRepository,
    testRunRepository,
    sessionRepository,
    evidenceService,
    verifyAttestation,
    now: () => now,
  } as unknown as MatrixCorpusRoutesDependencies;
  return {
    dependencies,
    contextService,
    contextRepository,
    manifestRepository,
    testRunRepository,
    sessionRepository,
    evidenceService,
    verifyAttestation,
  };
}

describe('Matrix corpus private routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = internalAuthToken;
  });

  afterEach(async () => {
    await app?.close();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  async function start(dependencies: MatrixCorpusRoutesDependencies): Promise<void> {
    app = Fastify({ logger: false });
    await app.register(intexuraFastifyPlugin);
    await app.register(fastifySwagger, {
      openapi: { info: { title: 'Intex Matrix corpus route test', version: '1.0.0' } },
    });
    await app.register(createMatrixCorpusRoutes(dependencies));
    await app.ready();
  }

  it('registers no private Matrix corpus routes when the feature is disabled', async () => {
    const fixtureValue = fixture();
    await start({ ...fixtureValue.dependencies, enabled: false });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/current-acceptance',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: { runtimeAudience: 'hetzner-prod', userId: 'auth0:user_1' },
    });

    expect(response.statusCode).toBe(404);
    expect(fixtureValue.testRunRepository.getCurrentAcceptance).not.toHaveBeenCalled();
  });

  it('requires internal auth and the exact configured user before repository access', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      payload: authorizedMutation('register_context', contextBody()),
    });
    const foreign = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation('register_context', {
        ...contextBody(),
        userId: 'auth0:foreign',
      }),
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(foreign.statusCode).toBe(404);
    expect(fixtureValue.contextService.registerRun).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/internal/matrix-corpus/current-acceptance', { runtimeAudience: 'hetzner-prod', userId: 'auth0:user_1' }],
    ['POST', '/internal/matrix-corpus/runs/run_1/cleanup', { targetRunId: 'run_old', targetLeaseFence: '6', updatedAt: now }],
    ['POST', '/internal/matrix-corpus/runs/run_1/context/finalize', authorizedMutation('finalize_run', finalizationBody())],
    ['GET', '/internal/matrix-corpus/runs/run_1/retention-plan', undefined],
    ['GET', '/internal/matrix-corpus/runs/run_1/control-status', undefined],
    ['GET', '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/status', undefined],
    ['GET', '/internal/matrix-corpus/runs/run_1/finalization-readiness', undefined],
    ['GET', '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/evidence', undefined],
    ['PUT', '/internal/test-runs/run_1/projection', authorizedMutation('create_projection', { kind: 'create', record: testRunRecord() })],
    ['PUT', '/internal/test-runs/run_1/artifact-delivery', { expectedRevision: 0, next: { status: 'ready', terminalControlEventId: 'terminal_event_1' }, updatedAt: now }],
    ['POST', '/internal/matrix-corpus/runs/run_1/terminal-control', terminalEnvelope],
  ] as const)('rejects %s %s before any operation-specific work without internal auth', async (method, url, payload) => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });

    expect(response.statusCode).toBe(401);
  });

  it('returns the closed current-acceptance admission gate for the configured user', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/current-acceptance',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: { runtimeAudience: 'hetzner-prod', userId: 'auth0:user_1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ kind: 'admission_ready', current: 'absent' });
    expect(fixtureValue.testRunRepository.getCurrentAcceptance).toHaveBeenCalledWith(
      'auth0:user_1'
    );
  });

  it('validates current acceptance before lookup and closes repository failures as not ready', async () => {
    const fixtureValue = fixture();
    fixtureValue.testRunRepository.getCurrentAcceptance.mockResolvedValueOnce({
      ok: false as const,
      code: 'CORRUPT_RECORD' as const,
    });
    await start(fixtureValue.dependencies);

    const malformed = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/current-acceptance',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: { runtimeAudience: 'hetzner-prod' },
    });
    const foreign = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/current-acceptance',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: { runtimeAudience: 'hetzner-prod', userId: 'auth0:foreign' },
    });
    const failed = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/current-acceptance',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: { runtimeAudience: 'hetzner-prod', userId: 'auth0:user_1' },
    });

    expect(malformed.statusCode).toBe(400);
    expect(foreign.statusCode).toBe(404);
    expect(failed.statusCode).toBe(200);
    expect(failed.json().data).toEqual({ kind: 'not_ready' });
  });

  it('registers immutable encrypted context and rejects unknown request fields', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation('register_context', contextBody()),
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation('register_context', {
        ...contextBody(),
        promptContent: 'must not be accepted',
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      disposition: 'applied',
      promptPreferencesVersion: 2,
      agentModel: 'or:deepseek/deepseek-v4-flash',
    });
    expect(invalid.statusCode).toBe(400);
    expect(fixtureValue.contextService.registerRun).toHaveBeenCalledOnce();
  });

  it('accepts MiniMax M3 as the immutable Matrix corpus agent model', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation(
        'register_context',
        contextBody({ agentModel: 'or:minimax/minimax-m3' })
      ),
    });
    const unsupported = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation(
        'register_context',
        contextBody({ agentModel: 'or:google/gemini-3.6-flash' })
      ),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      agentModel: 'or:minimax/minimax-m3',
    });
    expect(unsupported.statusCode).toBe(400);
    expect(fixtureValue.contextService.registerRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentModel: 'or:minimax/minimax-m3' })
    );
    expect(fixtureValue.contextService.registerRun).toHaveBeenCalledOnce();
  });

  it('rejects unsigned or request-digest-tampered authority mutations', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const signed = authorizedMutation('register_context', contextBody());

    const unsigned = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: contextBody(),
    });
    const tampered = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: {
        ...signed,
        request: { ...contextBody(), catalogDigest: 'd'.repeat(64) },
      },
    });

    expect(unsigned.statusCode).toBe(400);
    expect(tampered.statusCode).toBe(400);
    expect(fixtureValue.contextService.registerRun).not.toHaveBeenCalled();
  });

  it('rejects foreign users and invalid control attestations on finalization and projection routes', async () => {
    const fixtureValue = fixture();
    fixtureValue.verifyAttestation
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_SIGNATURE' } as never)
      .mockResolvedValueOnce({
        ok: true,
        claims: { kind: 'matrix_corpus_terminal_control' },
      } as never)
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_SIGNATURE' } as never);
    await start(fixtureValue.dependencies);
    const headers = { 'x-internal-auth': internalAuthToken };

    const foreignFinalizationRequest = {
      ...finalizationBody(),
      userId: 'auth0:foreign',
    };
    const foreignFinalization = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context/finalize',
      headers,
      payload: authorizedMutation('finalize_run', foreignFinalizationRequest),
    });
    expect(foreignFinalization.statusCode).toBe(404);

    for (const expectedStatus of [400, 400]) {
      const invalidFinalization = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs/run_1/context/finalize',
        headers,
        payload: authorizedMutation('finalize_run', finalizationBody()),
      });
      expect(invalidFinalization.statusCode).toBe(expectedStatus);
    }

    const foreignProjectionRequest = {
      kind: 'create',
      record: testRunRecord({ userId: 'auth0:foreign' }),
    };
    const foreignProjection = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/projection',
      headers,
      payload: authorizedMutation('create_projection', foreignProjectionRequest),
    });
    expect(foreignProjection.statusCode).toBe(404);

    const projectionRequest = { kind: 'create', record: testRunRecord() };
    const invalidProjection = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/projection',
      headers,
      payload: authorizedMutation('create_projection', projectionRequest),
    });
    expect(invalidProjection.statusCode).toBe(400);
    expect(fixtureValue.testRunRepository.createOrGet).not.toHaveBeenCalled();
  });

  it('creates the preflight projection and applies revision CAS without terminal evaluator writes', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const createRequest = { kind: 'create', record: testRunRecord() };
    const create = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/projection',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation('create_projection', createRequest),
    });
    const casRequest = {
      kind: 'cas',
      userId: 'auth0:user_1',
      leaseFence: '7',
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: now,
        scenario: null,
        finalization: null,
      },
    };
    const cas = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/projection',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation('advance_projection', casRequest),
    });

    expect(create.statusCode).toBe(200);
    expect(cas.statusCode).toBe(200);
    expect(create.json().data).toMatchObject({
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    expect(cas.json().data).toMatchObject({
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    expect(fixtureValue.testRunRepository.createOrGet).toHaveBeenCalledOnce();
    expect(fixtureValue.testRunRepository.applyProjection).toHaveBeenCalledOnce();
  });

  it('rejects a projection whose body run does not match the path run', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const request = {
      kind: 'create',
      record: testRunRecord({ runId: 'run_2' }),
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/projection',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation('create_projection', request),
    });

    expect(response.statusCode).toBe(404);
    expect(fixtureValue.testRunRepository.createOrGet).not.toHaveBeenCalled();
  });

  it('rejects an unknown projection body field before attestation or repository access', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const request = { kind: 'create', record: testRunRecord() };
    const payload = {
      ...authorizedMutation('create_projection', request),
      unexpected: 'must-not-be-stripped',
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/projection',
      headers: { 'x-internal-auth': internalAuthToken },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(fixtureValue.verifyAttestation).not.toHaveBeenCalled();
    expect(fixtureValue.testRunRepository.createOrGet).not.toHaveBeenCalled();
  });

  it('applies a closed exact-run artifact delivery transition with the current fence', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const command = {
      expectedRevision: 0,
      next: {
        status: 'staged',
        jsonCandidateDigest: '1'.repeat(64),
        markdownCandidateDigest: '2'.repeat(64),
      },
      updatedAt: now,
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/artifact-delivery',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
      payload: command,
    });

    expect(response.statusCode).toBe(200);
    expect(fixtureValue.testRunRepository.applyArtifactDelivery).toHaveBeenCalledWith({
      identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
      command,
    });
    expect(response.json().data).toMatchObject({
      disposition: 'applied',
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      revision: 1,
    });
  });

  it('accepts a terminal-bound report validation failure without leaving delivery staged', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const command = {
      expectedRevision: 4,
      next: {
        status: 'failed',
        failureCode: 'REPORT_VALIDATION_FAILED',
        terminalControlEventId: 'terminal_event_1',
      },
      updatedAt: now,
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/artifact-delivery',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
      payload: command,
    });

    expect(response.statusCode).toBe(200);
    expect(fixtureValue.testRunRepository.applyArtifactDelivery).toHaveBeenCalledWith({
      identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
      command,
    });
  });

  it('cleans up one terminal run using the current provisioning identity and exact target fence', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_current/cleanup',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '8',
      },
      payload: {
        targetRunId: 'run_target',
        targetLeaseFence: '7',
        updatedAt: now,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fixtureValue.testRunRepository.cleanupExactRun).toHaveBeenCalledWith({
      currentIdentity: {
        runId: 'run_current',
        userId: 'auth0:user_1',
        leaseFence: '8',
      },
      targetIdentity: {
        runId: 'run_target',
        userId: 'auth0:user_1',
        leaseFence: '7',
      },
      updatedAt: now,
    });
    expect(response.json().data).toMatchObject({
      disposition: 'applied',
      runId: 'run_current',
      userId: 'auth0:user_1',
      leaseFence: '8',
      currentRevision: 1,
      retentionReconciled: true,
      removed: { runs: 1, sessions: 1, events: 2 },
    });
  });

  it('rejects cleanup for a foreign current user before repository access', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_current/cleanup',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:foreign',
        'x-matrix-corpus-lease-fence': '8',
      },
      payload: {
        targetRunId: 'run_target',
        targetLeaseFence: '7',
        updatedAt: now,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(fixtureValue.testRunRepository.cleanupExactRun).not.toHaveBeenCalled();
  });

  it('rejects artifact delivery before repository access without exact auth, fence, and body', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const response = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/artifact-delivery',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:foreign',
        'x-matrix-corpus-lease-fence': '7',
      },
      payload: {
        expectedRevision: 0,
        next: { status: 'ready', terminalControlEventId: 'terminal_event_1' },
        updatedAt: now,
        privatePath: '/tmp/report.md',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(fixtureValue.testRunRepository.applyArtifactDelivery).not.toHaveBeenCalled();
  });

  it('hides artifact delivery from a foreign user even with an otherwise valid body', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const response = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/artifact-delivery',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:foreign',
        'x-matrix-corpus-lease-fence': '7',
      },
      payload: {
        expectedRevision: 0,
        next: { status: 'ready', terminalControlEventId: 'terminal_event_1' },
        updatedAt: now,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(fixtureValue.testRunRepository.applyArtifactDelivery).not.toHaveBeenCalled();
  });

  it('returns closed activation status and finalization tombstone digest', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const status = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/control-status',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
    });
    const finalized = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context/finalize',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: authorizedMutation('finalize_run', {
        ...finalizationBody(),
      }),
    });

    expect(status.statusCode).toBe(200);
    expect(status.json().data).toMatchObject({
      kind: 'status',
      contextReady: true,
      manifestReady: true,
      preflightProjectionReady: true,
      retentionReconciled: true,
    });
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().data).toMatchObject({
      disposition: 'applied',
      tombstoneDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(fixtureValue.testRunRepository.finalizeRun).toHaveBeenCalledWith({
      identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
      expectedRevision: 1,
      updatedAt: now,
      artifactStageDigest: 'e'.repeat(64),
      terminalCandidate: finalizationBody().terminalCandidate,
    });
    expect(fixtureValue.contextService.finalizeRun).not.toHaveBeenCalled();
  });

  it('reports not ready unless context manifest and projection are one exact preflight', async () => {
    const fixtureValue = fixture();
    fixtureValue.testRunRepository.getExact.mockResolvedValue({
      ok: true,
      record: testRunRecord({ lifecycle: 'running', revision: 1 }),
    });
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/control-status',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      kind: 'status',
      lifecycle: 'running',
      preflightProjectionReady: false,
    });
  });

  it('reports finalized control evidence with durable terminal digests', async () => {
    const fixtureValue = fixture();
    fixtureValue.contextRepository.getRunContext.mockResolvedValue({
      ok: true,
      context: {
        version: 1,
        status: 'finalized',
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        scenarioContextCount: 20,
        finalizedAt: now,
      },
    });
    fixtureValue.testRunRepository.getExact.mockResolvedValue({
      ok: true,
      record: testRunRecord({
        lifecycle: 'finalizing',
        contextFinalizationTombstoneDigest: 'd'.repeat(64),
        terminalCandidate: finalizationBody().terminalCandidate,
      }),
    });
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/control-status',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      kind: 'status',
      lifecycle: 'finalizing',
      contextFinalizationTombstoneDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      terminalCandidateDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('verifies signed terminal control and returns the first authoritative winner', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/terminal-control',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: terminalEnvelope,
    });

    expect(response.statusCode).toBe(200);
    expect(fixtureValue.verifyAttestation).toHaveBeenCalledWith(terminalEnvelope);
    expect(response.json().data).toEqual({
      kind: 'acknowledged',
      runId: 'run_1',
      leaseFence: '7',
      requestEventId: 'terminal_event_1',
      requestPayloadDigest: 'f'.repeat(64),
      winner: {
        kind: 'release',
        eventId: 'terminal_event_1',
        payloadDigest: 'f'.repeat(64),
        outcome: 'completed_passed',
        acknowledgedAt: now,
      },
    });
  });

  it('uses durable repository recovery for an abandoned terminal control', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/terminal-control',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: abandonedEnvelope,
    });

    expect(response.statusCode).toBe(200);
    expect(fixtureValue.testRunRepository.applyAbandonedRecovery).toHaveBeenCalledWith({
      identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
      command: {
        kind: 'abandoned',
        eventId: 'abandoned_event_1',
        payloadDigest: 'a'.repeat(64),
        acknowledgedAt: now,
      },
    });
    expect(fixtureValue.testRunRepository.applyTerminalControl).not.toHaveBeenCalled();
    expect(response.json().data.winner).toMatchObject({ outcome: 'provisioning_noop' });
  });

  it('rejects malformed, unverifiable, foreign, and winnerless terminal controls', async () => {
    const fixtureValue = fixture();
    const verified = await fixtureValue.dependencies.verifyAttestation(terminalEnvelope);
    if (!verified.ok) throw new Error('terminal-control fixture attestation must verify');
    fixtureValue.verifyAttestation.mockClear();
    fixtureValue.verifyAttestation
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_ATTESTATION' })
      .mockResolvedValueOnce({
        ...verified,
        claims: {
          ...verified.claims,
          payload: { ...verified.claims.payload, userId: 'auth0:foreign' },
        },
      });
    fixtureValue.testRunRepository.applyTerminalControl.mockResolvedValueOnce({
      ok: true,
      disposition: 'applied',
      record: testRunRecord({ terminalWinner: null }),
    });
    await start(fixtureValue.dependencies);

    for (const [payload, expectedStatus] of [
      [{}, 400],
      [terminalEnvelope, 400],
      [terminalEnvelope, 404],
      [terminalEnvelope, 409],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs/run_1/terminal-control',
        headers: { 'x-internal-auth': internalAuthToken },
        payload,
      });
      expect(response.statusCode).toBe(expectedStatus);
    }
  });

  it('reads exact-fence/revision safe evidence without returning private identity or messages', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/evidence',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
        'x-matrix-corpus-session-id': 'session_private_1',
        'x-matrix-corpus-event-revision': '3',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fixtureValue.evidenceService.getExact).toHaveBeenCalledWith({
      identity: {
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_private_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
      },
      expectedEventRevision: 3,
    });
    expect(response.json().data).toEqual({
      version: 1,
      eventRevision: 3,
      toolEvidence: [
        {
          event: 'selected',
          toolName: 'create_link',
          turnIndex: 0,
          ordinal: 1,
          facts: [{ name: 'hasUrl', value: true }],
        },
      ],
      agentUsage: [
        {
          turnIndex: 0,
          stage: 'agent_generation',
          callOrdinal: 1,
          inputTokens: 5,
          outputTokens: 2,
          totalTokens: 7,
          costNanoUsd: 42,
        },
      ],
      agentUsageTotals: {
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
        costNanoUsd: 42,
      },
      sessionProof: {
        status: 'waiting_for_user',
        startReason: 'no_active_session',
        userMessageCount: 1,
        sessionStartedCount: 0,
        supersededSessionCount: 0,
      },
      turnTerminals: [
        {
          status: 'completed',
          turnIndex: 0,
          replyCount: 1,
          replyDigests: ['c'.repeat(64)],
          terminalMarkerDigest: 'd'.repeat(64),
          recordedAt: now,
        },
      ],
      strictMockProof: {
        version: 1,
        status: 'passed',
        executionMode: 'strict_mock_tools',
        mockProfileDigest: 'b'.repeat(64),
        productionExecutorResolutions: 0,
        productionExecutorAdmissions: 0,
      },
    });
    expect(response.body).not.toContain('session_private_1');
    expect(response.body).not.toContain('auth0:user_1');
  });

  it('reads the exact scenario session binding needed by the live evaluator', async () => {
    const fixtureValue = fixture();
    fixtureValue.manifestRepository.getExact.mockResolvedValue({
      ok: true,
      manifest: {
        version: 1,
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        scenarioBindings: [
          {
            scenarioId: 'scenario_001',
            scenarioNumber: 1,
            scenarioLabel: 'Scenario 001/020',
            sessionId: 'session_1',
          },
        ],
        artifactStage: null,
        terminalCandidate: null,
        createdAt: now,
      },
    });
    fixtureValue.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValue({
      ok: true,
      events: Array.from({ length: 4 }, (_, index) => ({
        id: `event_${String(index + 1)}`,
        sessionId: 'session_1',
        userId: 'auth0:user_1',
        type: 'assistant_message',
        payload: {},
        createdAt: now,
        eventSequence: index + 1,
      })),
    });
    fixtureValue.testRunRepository.getExact.mockResolvedValue({
      ok: true,
      record: testRunRecord({
        scenarios: [
          {
            ...testRunScenario(1),
            lifecycle: 'running',
            sessionId: 'session_1',
            eventWatermark: 4,
          },
        ],
      }),
    });
    await start(fixtureValue.dependencies);
    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/status',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      kind: 'status',
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      scenarioId: 'scenario_001',
      sessionId: 'session_1',
      eventRevision: 4,
      lifecycle: 'running',
      pendingConfirmationId: null,
    });
  });

  it('fails closed across missing, inconsistent, and ambiguous scenario-status evidence', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const headers = {
      'x-internal-auth': internalAuthToken,
      'x-matrix-corpus-runtime-audience': 'hetzner-prod',
      'x-matrix-corpus-user-id': 'auth0:user_1',
      'x-matrix-corpus-lease-fence': '7',
    };
    const url = '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/status';

    const invalidIdentity = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'x-matrix-corpus-lease-fence': '0' },
    });
    expect(invalidIdentity.statusCode).toBe(404);

    fixtureValue.testRunRepository.getExact.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    const missingRun = await app.inject({ method: 'GET', url, headers });
    expect(missingRun.json().data).toEqual({ kind: 'not_ready' });

    const missingBinding = await app.inject({ method: 'GET', url, headers });
    expect(missingBinding.json().data).toEqual({ kind: 'not_ready' });

    const binding = {
      scenarioId: 'scenario_001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      sessionId: 'session_1',
    };
    fixtureValue.manifestRepository.getExact.mockResolvedValue({
      ok: true,
      manifest: {
        version: 1,
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        scenarioBindings: [binding],
        artifactStage: null,
        terminalCandidate: null,
        createdAt: now,
      },
    });
    fixtureValue.testRunRepository.getExact.mockResolvedValue({
      ok: true,
      record: testRunRecord({
        scenarios: [
          {
            ...testRunScenario(1),
            scenarioId: 'scenario_001',
            scenarioLabel: 'Scenario 001/020',
            sessionId: 'session_1',
            lifecycle: 'completed',
          },
        ],
      }),
    });
    fixtureValue.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: false,
      code: 'CORRUPT_RECORD',
    });
    const failedEvents = await app.inject({ method: 'GET', url, headers });
    expect(failedEvents.json().data).toEqual({ kind: 'not_ready' });

    fixtureValue.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: true,
      events: [
        { type: 'assistant_message', payload: {}, eventSequence: 1 },
        { type: 'assistant_message', payload: {}, eventSequence: 3 },
      ],
    });
    const sequenceGap = await app.inject({ method: 'GET', url, headers });
    expect(sequenceGap.json().data).toEqual({ kind: 'not_ready' });

    fixtureValue.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: true,
      events: [
        {
          type: 'confirmation_requested',
          payload: { confirmationId: 'confirmation_1' },
          eventSequence: 1,
        },
        {
          type: 'confirmation_requested',
          payload: { confirmationId: 'confirmation_2' },
          eventSequence: 2,
        },
      ],
    });
    const ambiguousPending = await app.inject({ method: 'GET', url, headers });
    expect(ambiguousPending.json().data).toEqual({ kind: 'not_ready' });

    fixtureValue.sessionRepository.listMatrixCorpusEventsExact.mockResolvedValueOnce({
      ok: true,
      events: [
        {
          type: 'confirmation_requested',
          payload: { confirmationId: 'confirmation_1' },
          eventSequence: 1,
        },
      ],
    });
    const completed = await app.inject({ method: 'GET', url, headers });
    expect(completed.json().data).toMatchObject({
      kind: 'status',
      lifecycle: 'completed',
      pendingConfirmationId: 'confirmation_1',
    });
  });

  it('returns finalization readiness only for one fully projected staged run', async () => {
    const fixtureValue = fixture();
    const scenarios = Array.from({ length: 20 }, (_, index) =>
      testRunScenario(index + 1, {
        scenarioId: `intex-eval-${String(index + 1).padStart(3, '0')}`,
        scenarioLabel: `Scenario ${String(index + 1).padStart(3, '0')}/020`,
        scenarioRevision: 1,
        eventWatermark: 3,
        lifecycle: 'completed',
        verdict: 'passed',
        completedTurns: 1,
        completedReplies: 1,
        deterministicVerdict: 'passed',
        semanticVerdict: 'passed',
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        sessionId: `session_${String(index + 1)}`,
        sessionBindingDigest: createHash('sha256').update(`session_${String(index + 1)}`).digest('hex'),
      })
    );
    fixtureValue.testRunRepository.getExact.mockResolvedValue({
      ok: true,
      record: testRunRecord({
        revision: 22,
        lifecycle: 'running',
        scenarios,
        artifactDelivery: { status: 'staged', failureCode: null, updatedAt: now },
        artifactStageDigest: 'e'.repeat(64),
      }),
    });
    fixtureValue.testRunRepository.getScenarioConsistent.mockImplementation(
      async ({ scenarioId }: { scenarioId: string }) => {
        const scenario = scenarios.find((candidate) => candidate.scenarioId === scenarioId);
        if (scenario === undefined || scenario.sessionId === null || scenario.sessionBindingDigest === null)
          return { ok: false as const, code: 'NOT_FOUND' as const };
        return {
          ok: true as const,
          projection: {
            schemaVersion: 1 as const,
            runId: 'run_1',
            userId: 'auth0:user_1',
            sessionId: scenario.sessionId,
            sessionBindingDigest: scenario.sessionBindingDigest,
            scenarioId: scenario.scenarioId,
            scenarioNumber: scenario.scenarioNumber,
            scenarioLabel: scenario.scenarioLabel,
            runRevision: 22,
            scenarioRevision: scenario.scenarioRevision,
            eventWatermark: scenario.eventWatermark,
            lifecycle: scenario.lifecycle,
            verdict: scenario.verdict,
            plannedTurns: scenario.plannedTurns,
            completedTurns: scenario.completedTurns,
            toolEvidence: [],
            deterministicChecks: [],
            replyEvaluations: [],
            agentUsage: [],
          },
        };
      }
    );
    fixtureValue.manifestRepository.getExact.mockResolvedValue({
      ok: true,
      manifest: {
        version: 1,
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        scenarioBindings: scenarios.map((scenario) => ({
          scenarioId: scenario.scenarioId,
          scenarioNumber: scenario.scenarioNumber,
          scenarioLabel: scenario.scenarioLabel,
          sessionId: scenario.sessionId ?? '',
        })),
        artifactStage: {
          revision: 22,
          jsonCandidateDigest: '1'.repeat(64),
          markdownCandidateDigest: '2'.repeat(64),
          compositeDigest: 'e'.repeat(64),
          stagedAt: now,
        },
        terminalCandidate: null,
        createdAt: now,
      },
    });
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/finalization-readiness',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      kind: 'ready',
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      revision: 22,
      projectionDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      artifactStageDigest: 'e'.repeat(64),
    });
    expect(fixtureValue.testRunRepository.getScenarioConsistent).toHaveBeenCalledTimes(20);
  });

  it('keeps finalization readiness closed for invalid identity, missing roots, mismatched bindings, and failed projections', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const headers = {
      'x-internal-auth': internalAuthToken,
      'x-matrix-corpus-runtime-audience': 'hetzner-prod',
      'x-matrix-corpus-user-id': 'auth0:user_1',
      'x-matrix-corpus-lease-fence': '7',
    };
    const url = '/internal/matrix-corpus/runs/run_1/finalization-readiness';

    const invalidIdentity = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'x-matrix-corpus-user-id': 'auth0:foreign' },
    });
    expect(invalidIdentity.statusCode).toBe(404);

    fixtureValue.testRunRepository.getExact.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    const missingRun = await app.inject({ method: 'GET', url, headers });
    expect(missingRun.json().data).toEqual({ kind: 'not_ready' });

    const scenario = {
      ...testRunScenario(1),
      scenarioId: 'scenario_001',
      scenarioLabel: 'Scenario 001/020',
      sessionId: 'session_1',
      sessionBindingDigest: 'b'.repeat(64),
      lifecycle: 'completed' as const,
    };
    fixtureValue.testRunRepository.getExact.mockResolvedValue({
      ok: true,
      record: testRunRecord({
        lifecycle: 'running',
        scenarios: [scenario],
        artifactDelivery: { status: 'staged', failureCode: null, updatedAt: now },
        artifactStageDigest: 'e'.repeat(64),
      }),
    });
    const missingBinding = await app.inject({ method: 'GET', url, headers });
    expect(missingBinding.json().data).toEqual({ kind: 'not_ready' });

    fixtureValue.manifestRepository.getExact.mockResolvedValue({
      ok: true,
      manifest: {
        version: 1,
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        scenarioBindings: [
          {
            scenarioId: 'scenario_001',
            scenarioNumber: 1,
            scenarioLabel: 'Scenario 001/020',
            sessionId: 'session_1',
          },
        ],
        artifactStage: null,
        terminalCandidate: null,
        createdAt: now,
      },
    });
    fixtureValue.testRunRepository.getScenarioConsistent.mockResolvedValue({
      ok: false,
      code: 'REVISION_CONFLICT',
    });
    const failedProjection = await app.inject({ method: 'GET', url, headers });
    expect(failedProjection.json().data).toEqual({ kind: 'not_ready' });
  });

  it('maps evidence failures to a static response without exposing the thrown error', async () => {
    const fixtureValue = fixture();
    fixtureValue.evidenceService.getExact.mockRejectedValue(
      new Error('PRIVATE_EVIDENCE_THROWN_SENTINEL https://secret.invalid')
    );
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/evidence',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
        'x-matrix-corpus-session-id': 'session_private_1',
        'x-matrix-corpus-event-revision': '3',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/PRIVATE_EVIDENCE_THROWN_SENTINEL|secret\.invalid/u);
  });

  it('returns only the bounded exact identities needed for pre-activation retention', async () => {
    const fixtureValue = fixture();
    const current = testRunRecord({
      runId: 'run_1',
      leaseFence: '7',
      lifecycle: 'preflight',
      retentionReconciled: true,
    });
    const prior = testRunRecord({
      runId: 'run_old',
      leaseFence: '6',
      lifecycle: 'completed',
      verdict: 'failed',
      finishedAt: now,
      artifactDelivery: { status: 'ready', failureCode: null, updatedAt: now },
      terminalCandidate: finalizationBody().terminalCandidate,
      terminalWinner: {
        kind: 'release',
        eventId: 'terminal_old',
        payloadDigest: 'c'.repeat(64),
        outcome: 'completed_failed',
        acknowledgedAt: now,
      },
    });
    fixtureValue.testRunRepository.getExact.mockResolvedValue({ ok: true, record: current });
    fixtureValue.testRunRepository.listLatestForUser.mockResolvedValue({
      ok: true,
      records: [current, prior],
    });
    await start(fixtureValue.dependencies);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/retention-plan',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      kind: 'retention_plan',
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      records: [
        {
          runId: 'run_1',
          leaseFence: '7',
          startedAt: now,
          lifecycle: 'preflight',
          verdict: 'pending',
          artifactDelivery: 'pending',
          completedAt: null,
          isCurrent: true,
        },
        {
          runId: 'run_old',
          leaseFence: '6',
          startedAt: now,
          lifecycle: 'completed',
          verdict: 'failed',
          artifactDelivery: 'ready',
          completedAt: now,
          isCurrent: false,
        },
      ],
    });
    expect(fixtureValue.testRunRepository.listLatestForUser).toHaveBeenCalledWith(
      'auth0:user_1',
      4
    );
  });

  it('keeps retention planning closed for invalid identity and incomplete bounded evidence', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const headers = {
      'x-internal-auth': internalAuthToken,
      'x-matrix-corpus-runtime-audience': 'hetzner-prod',
      'x-matrix-corpus-user-id': 'auth0:user_1',
      'x-matrix-corpus-lease-fence': '7',
    };
    const url = '/internal/matrix-corpus/runs/run_1/retention-plan';

    const invalidIdentity = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'x-matrix-corpus-user-id': 'auth0:foreign' },
    });
    expect(invalidIdentity.statusCode).toBe(404);

    fixtureValue.testRunRepository.getExact
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce({
        ok: true,
        record: testRunRecord({ lifecycle: 'running' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        record: testRunRecord({ lifecycle: 'preflight' }),
      });
    fixtureValue.testRunRepository.listLatestForUser
      .mockResolvedValueOnce({ ok: true, records: [testRunRecord()] })
      .mockResolvedValueOnce({ ok: true, records: [testRunRecord()] })
      .mockResolvedValueOnce({ ok: true, records: [] });

    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(409);
    }
  });

  it('maps cleanup validation and every repository failure class to closed HTTP responses', async () => {
    const fixtureValue = fixture();
    fixtureValue.testRunRepository.cleanupExactRun
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_INPUT' })
      .mockResolvedValueOnce({ ok: false, code: 'EVIDENCE_MISMATCH' });
    await start(fixtureValue.dependencies);
    const headers = {
      'x-internal-auth': internalAuthToken,
      'x-matrix-corpus-runtime-audience': 'hetzner-prod',
      'x-matrix-corpus-user-id': 'auth0:user_1',
      'x-matrix-corpus-lease-fence': '8',
    };
    const validPayload = {
      targetRunId: 'run_target',
      targetLeaseFence: '7',
      updatedAt: now,
    };
    const malformed = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_current/cleanup',
      headers,
      payload: { ...validPayload, private: true },
    });
    expect(malformed.statusCode).toBe(400);
    for (const statusCode of [404, 400, 409]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs/run_current/cleanup',
        headers,
        payload: validPayload,
      });
      expect(response.statusCode).toBe(statusCode);
    }
  });

  it('maps every closed context-service failure and finalization repository rejection', async () => {
    const fixtureValue = fixture();
    fixtureValue.contextService.registerRun
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce({ ok: false, code: 'EXPIRED' })
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_INPUT' })
      .mockResolvedValueOnce({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    fixtureValue.testRunRepository.finalizeRun.mockResolvedValueOnce({
      ok: false,
      code: 'FINALIZATION_MISMATCH',
    });
    await start(fixtureValue.dependencies);
    const headers = { 'x-internal-auth': internalAuthToken };
    const contextPayload = authorizedMutation('register_context', contextBody());
    for (const statusCode of [404, 410, 400, 409]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/matrix-corpus/runs/run_1/context',
        headers,
        payload: contextPayload,
      });
      expect(response.statusCode).toBe(statusCode);
    }

    const malformed = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context/finalize',
      headers,
      payload: {},
    });
    expect(malformed.statusCode).toBe(400);
    const rejected = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/context/finalize',
      headers,
      payload: authorizedMutation('finalize_run', finalizationBody()),
    });
    expect(rejected.statusCode).toBe(409);
  });

  it('closes control status on invalid identity, missing roots, and mismatched catalog evidence', async () => {
    const fixtureValue = fixture();
    await start(fixtureValue.dependencies);
    const headers = {
      'x-internal-auth': internalAuthToken,
      'x-matrix-corpus-runtime-audience': 'hetzner-prod',
      'x-matrix-corpus-user-id': 'auth0:user_1',
      'x-matrix-corpus-lease-fence': '7',
    };
    const invalid = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/control-status',
      headers: { ...headers, 'x-matrix-corpus-lease-fence': '0' },
    });
    expect(invalid.statusCode).toBe(404);

    fixtureValue.contextRepository.getRunContext.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_FOUND',
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/control-status',
      headers,
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.json().data).toEqual({ kind: 'not_ready' });

    fixtureValue.manifestRepository.getExact.mockResolvedValueOnce({
      ok: true,
      manifest: {
        version: 1,
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'f'.repeat(64),
        scenarioBindings: [],
        artifactStage: null,
        terminalCandidate: null,
        createdAt: now,
      },
    });
    const mismatch = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/control-status',
      headers,
    });
    expect(mismatch.statusCode).toBe(200);
    expect(mismatch.json().data).toEqual({ kind: 'not_ready' });
  });

  it('maps malformed evidence headers and both closed evidence failures', async () => {
    const fixtureValue = fixture();
    fixtureValue.evidenceService.getExact
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce({ ok: false, code: 'REVISION_MISMATCH' });
    await start(fixtureValue.dependencies);
    const headers = {
      'x-internal-auth': internalAuthToken,
      'x-matrix-corpus-runtime-audience': 'hetzner-prod',
      'x-matrix-corpus-user-id': 'auth0:user_1',
      'x-matrix-corpus-lease-fence': '7',
      'x-matrix-corpus-session-id': 'session_private_1',
      'x-matrix-corpus-event-revision': '3',
    };
    const malformed = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/evidence',
      headers: { ...headers, 'x-matrix-corpus-event-revision': '9007199254740992' },
    });
    expect(malformed.statusCode).toBe(404);
    const missingAudience = await app.inject({
      method: 'GET',
      url: '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/evidence',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-matrix-corpus-user-id': 'auth0:user_1',
        'x-matrix-corpus-lease-fence': '7',
        'x-matrix-corpus-session-id': 'session_private_1',
        'x-matrix-corpus-event-revision': '3',
      },
    });
    expect(missingAudience.statusCode).toBe(404);
    for (const statusCode of [404, 409]) {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/matrix-corpus/runs/run_1/scenarios/scenario_001/evidence',
        headers,
      });
      expect(response.statusCode).toBe(statusCode);
    }
  });

  it('maps projection, artifact, and both terminal-control repository rejections', async () => {
    const fixtureValue = fixture();
    fixtureValue.testRunRepository.createOrGet.mockResolvedValueOnce({
      ok: false,
      code: 'DOCUMENT_TOO_LARGE',
    });
    fixtureValue.testRunRepository.applyArtifactDelivery.mockResolvedValueOnce({
      ok: false,
      code: 'REVISION_CONFLICT',
    });
    fixtureValue.testRunRepository.applyTerminalControl.mockResolvedValueOnce({
      ok: false,
      code: 'TERMINAL_CONFLICT',
    });
    fixtureValue.testRunRepository.applyAbandonedRecovery.mockResolvedValueOnce({
      ok: false,
      code: 'EVIDENCE_MISMATCH',
    });
    await start(fixtureValue.dependencies);
    const auth = { 'x-internal-auth': internalAuthToken };
    const projectionRecord = testRunRecord();
    const projection = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/projection',
      headers: auth,
      payload: authorizedMutation('create_projection', {
        kind: 'create',
        record: projectionRecord,
      }),
    });
    expect(projection.statusCode).toBe(409);

    const controlHeaders = {
      ...auth,
      'x-matrix-corpus-runtime-audience': 'hetzner-prod',
      'x-matrix-corpus-user-id': 'auth0:user_1',
      'x-matrix-corpus-lease-fence': '7',
    };
    const artifact = await app.inject({
      method: 'PUT',
      url: '/internal/test-runs/run_1/artifact-delivery',
      headers: controlHeaders,
      payload: {
        expectedRevision: 0,
        next: {
          status: 'staged',
          jsonCandidateDigest: '1'.repeat(64),
          markdownCandidateDigest: '2'.repeat(64),
        },
        updatedAt: now,
      },
    });
    expect(artifact.statusCode).toBe(409);

    const release = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/terminal-control',
      headers: auth,
      payload: terminalEnvelope,
    });
    expect(release.statusCode).toBe(409);
    const abandoned = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/terminal-control',
      headers: auth,
      payload: abandonedEnvelope,
    });
    expect(abandoned.statusCode).toBe(409);
  });

  it('publishes all private Matrix corpus operations with closed OpenAPI contracts', async () => {
    await start(fixture().dependencies);
    const spec = app.swagger() as unknown as {
      paths?: Record<
        string,
        Record<
          string,
          {
            operationId?: string;
            requestBody?: unknown;
            responses?: Record<string, unknown>;
          }
        >
      >;
    };
    const operations = [
      ['/internal/matrix-corpus/current-acceptance', 'post', 'getMatrixCorpusCurrentAcceptance'],
      ['/internal/matrix-corpus/runs/{runId}/cleanup', 'post', 'cleanupExactMatrixCorpusRun'],
      ['/internal/matrix-corpus/runs/{runId}/context', 'post', 'registerMatrixCorpusRunContext'],
      ['/internal/matrix-corpus/runs/{runId}/context/finalize', 'post', 'finalizeMatrixCorpusRun'],
      ['/internal/matrix-corpus/runs/{runId}/control-status', 'get', 'getMatrixCorpusControlStatus'],
      ['/internal/matrix-corpus/runs/{runId}/finalization-readiness', 'get', 'getMatrixCorpusFinalizationReadiness'],
      ['/internal/matrix-corpus/runs/{runId}/scenarios/{scenarioId}/status', 'get', 'getMatrixCorpusScenarioStatus'],
      ['/internal/matrix-corpus/runs/{runId}/scenarios/{scenarioId}/evidence', 'get', 'getMatrixCorpusSafeEvidence'],
      ['/internal/test-runs/{runId}/projection', 'put', 'mutateMatrixCorpusTestRunProjection'],
      ['/internal/test-runs/{runId}/artifact-delivery', 'put', 'mutateMatrixCorpusTestRunArtifactDelivery'],
      ['/internal/matrix-corpus/runs/{runId}/terminal-control', 'post', 'applyMatrixCorpusTerminalControl'],
    ] as const;

    for (const [path, method, operationId] of operations) {
      const operation = spec.paths?.[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      if (method !== 'get') expect(operation?.requestBody).toBeDefined();
      expect(operation?.responses?.['200']).toBeDefined();
      expect(operation?.responses?.['400']).toBeDefined();
      expect(operation?.responses?.['401']).toBeDefined();
      expect(operation?.responses?.['404']).toBeDefined();
      expect(operation?.responses?.['409']).toBeDefined();
    }

    const projection = spec.paths?.['/internal/test-runs/{runId}/projection']?.['put'];
    expect(JSON.stringify(projection?.requestBody)).toContain('"reply_format"');
    const requestBody = jsonObject(projection?.requestBody);
    const content = jsonObject(requestBody['content']);
    const media = jsonObject(content['application/json']);
    const bodySchema = jsonObject(media['schema']);
    const bodyProperties = jsonObject(bodySchema['properties']);
    const requestSchema = jsonObject(bodyProperties['request']);
    const variants = requestSchema['oneOf'];
    expect(Array.isArray(variants)).toBe(true);
    const createVariant = jsonObject((variants as unknown[])[0]);
    const createProperties = jsonObject(createVariant['properties']);
    const recordSchema = jsonObject(createProperties['record']);
    expect(recordSchema['additionalProperties']).toBe(false);
    const recordProperties = jsonObject(recordSchema['properties']);
    const scenariosSchema = jsonObject(recordProperties['scenarios']);
    const scenarioItem = jsonObject(scenariosSchema['items']);
    expect(scenarioItem['additionalProperties']).toBe(false);

    const casVariant = jsonObject((variants as unknown[])[1]);
    const casProperties = jsonObject(casVariant['properties']);
    const commandSchema = jsonObject(casProperties['command']);
    expect(commandSchema['additionalProperties']).toBe(false);
    const commandProperties = jsonObject(commandSchema['properties']);
    const scenarioMutation = jsonObject(commandProperties['scenario']);
    const scenarioMutationVariants = scenarioMutation['oneOf'];
    expect(Array.isArray(scenarioMutationVariants)).toBe(true);
    expect(jsonObject((scenarioMutationVariants as unknown[])[0])['additionalProperties']).toBe(
      false
    );
  });
});

function jsonObject(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}
