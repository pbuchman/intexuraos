import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntexAgentServiceClient } from '../client.js';
import type { IntexAgentServiceClient, IntexAgentServiceClientConfig } from '../types.js';

const BASE_URL = 'http://intex-agent.test';
const DIGEST = 'a'.repeat(64);
const NOW = '2026-07-20T10:00:00.000Z';
const authorization = {
  version: 1 as const,
  kind: 'matrix_corpus_control_mutation' as const,
  eventId: 'event_1',
  leaseFence: '7',
  payloadDigest: DIGEST,
  attestation: 'aaa.bbb.ccc',
};
const loggerWarn = vi.fn();
const logger = {
  info: vi.fn(),
  warn: loggerWarn,
  error: vi.fn(),
  debug: vi.fn(),
} as IntexAgentServiceClientConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => nock.cleanAll());

describe('Intex Agent Matrix corpus internal client', () => {
  it('uses the production edge prefix, OIDC authorization, and runtime audience', async () => {
    const authorizationHeaderProvider = vi.fn().mockResolvedValue('Bearer evaluator-token');
    nock(BASE_URL, { reqheaders: { authorization: 'Bearer evaluator-token' } })
      .post('/internal/evals/intex-agent/matrix-corpus/current-acceptance', {
        runtimeAudience: 'hetzner-prod',
        userId: 'user_1',
      })
      .reply(200, { success: true, data: { kind: 'admission_ready', current: 'absent' } });

    const client = createIntexAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      pathPrefix: '/internal/evals/intex-agent',
      authorizationHeaderProvider,
    });

    await expect(client.getMatrixCorpusCurrentAcceptance('user_1')).resolves.toEqual({
      ok: true,
      value: { kind: 'admission_ready', current: 'absent' },
    });
    expect(authorizationHeaderProvider).toHaveBeenCalledTimes(1);
    expect(nock.isDone()).toBe(true);
  });

  it('drives every control endpoint with strict safe responses', async () => {
    nock(BASE_URL)
      .post('/internal/matrix-corpus/current-acceptance', {
        runtimeAudience: 'hetzner-prod',
        userId: 'user_1',
      })
      .reply(200, { success: true, data: { kind: 'admission_ready', current: 'absent' } })
      .post('/internal/matrix-corpus/runs/run_1/context', {
        authorization,
        request: {
          runtimeAudience: 'hetzner-prod',
          userId: 'user_1',
          leaseFence: '7',
          catalogDigest: DIGEST,
          agentModel: 'or:deepseek/deepseek-v4-flash',
          evaluatorModel: 'or:minimax/minimax-m3',
          expectedTimeZone: 'Europe/Warsaw',
        },
      })
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          promptPreferencesVersion: 0,
          promptPreferencesDigest: DIGEST,
          agentModel: 'or:deepseek/deepseek-v4-flash',
          userTimeZone: 'Europe/Warsaw',
          expiresAt: NOW,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/control-status')
      .matchHeader('x-matrix-corpus-user-id', 'user_1')
      .matchHeader('x-matrix-corpus-lease-fence', '7')
      .reply(200, { success: true, data: { kind: 'not_ready' } })
      .get('/internal/matrix-corpus/runs/run_1/scenarios/intex-eval-001/status')
      .matchHeader('x-matrix-corpus-user-id', 'user_1')
      .matchHeader('x-matrix-corpus-lease-fence', '7')
      .reply(200, {
        success: true,
        data: {
          kind: 'status',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          scenarioId: 'intex-eval-001',
          sessionId: 'session_1',
          eventRevision: 0,
          lifecycle: 'running',
          pendingConfirmationId: null,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/finalization-readiness')
      .matchHeader('x-matrix-corpus-user-id', 'user_1')
      .matchHeader('x-matrix-corpus-lease-fence', '7')
      .reply(200, {
        success: true,
        data: {
          kind: 'ready',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          revision: 2,
          projectionDigest: DIGEST,
          artifactStageDigest: DIGEST,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/retention-plan')
      .matchHeader('x-matrix-corpus-user-id', 'user_1')
      .matchHeader('x-matrix-corpus-lease-fence', '7')
      .reply(200, {
        success: true,
        data: {
          kind: 'retention_plan',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          records: [
            {
              runId: 'run_1',
              leaseFence: '7',
              startedAt: '2026-07-20T05:00:00.000Z',
              lifecycle: 'preflight',
              verdict: 'pending',
              artifactDelivery: 'pending',
              completedAt: null,
              isCurrent: true,
            },
          ],
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/scenarios/intex-eval-001/evidence')
      .matchHeader('x-matrix-corpus-session-id', 'session_1')
      .matchHeader('x-matrix-corpus-event-revision', '0')
      .reply(200, {
        success: true,
        data: {
          version: 1,
          eventRevision: 0,
          toolEvidence: [],
          agentUsage: [],
          agentUsageTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 },
          sessionProof: {
            status: 'waiting_for_user',
            startReason: 'no_active_session',
            userMessageCount: 1,
            sessionStartedCount: 0,
            supersededSessionCount: 0,
          },
          turnTerminals: [],
          strictMockProof: {
            version: 1,
            status: 'passed',
            executionMode: 'strict_mock_tools',
            mockProfileDigest: DIGEST,
            productionExecutorResolutions: 0,
            productionExecutorAdmissions: 0,
          },
        },
      })
      .put('/internal/test-runs/run_1/projection', {
        authorization,
        request: { kind: 'cas', userId: 'user_1', leaseFence: '7', command: {} },
      })
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          revision: 1,
          lifecycle: 'running',
          verdict: 'pending',
        },
      })
      .put('/internal/test-runs/run_1/artifact-delivery', { expectedRevision: 1 })
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          revision: 2,
          lifecycle: 'running',
          verdict: 'pending',
          artifactDelivery: { status: 'pending', failureCode: null, updatedAt: NOW },
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/context/finalize')
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          tombstoneDigest: DIGEST,
          scenarioContextCount: 20,
          finalizedAt: NOW,
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/terminal-control')
      .reply(200, {
        success: true,
        data: {
          kind: 'acknowledged',
          runId: 'run_1',
          leaseFence: '7',
          requestEventId: 'event_1',
          requestPayloadDigest: DIGEST,
          winner: {
            kind: 'release',
            eventId: 'event_1',
            payloadDigest: DIGEST,
            outcome: 'completed_passed',
            acknowledgedAt: NOW,
          },
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/cleanup', {
        targetRunId: 'run_old',
        targetLeaseFence: '3',
        updatedAt: NOW,
      })
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          currentRevision: 3,
          retentionReconciled: true,
          removed: {
            runs: 1,
            sessions: 1,
            events: 1,
            confirmations: 1,
            ingestReceipts: 1,
            scenarioProjections: 1,
            scenarioContexts: 1,
            runContexts: 1,
            manifests: 1,
          },
        },
      });

    const client = createClient();
    const results = [
      await client.getMatrixCorpusCurrentAcceptance('user_1'),
      await client.registerMatrixCorpusContext({
        runId: 'run_1',
        authorization,
        request: contextRequest(),
      }),
      await client.getMatrixCorpusControlStatus(identity()),
      await client.getMatrixCorpusScenarioStatus({
        ...identity(),
        scenarioId: 'intex-eval-001',
      }),
      await client.getMatrixCorpusFinalizationReadiness(identity()),
      await client.getMatrixCorpusRetentionPlan(identity()),
      await client.getMatrixCorpusEvidence({
        ...identity(),
        scenarioId: 'intex-eval-001',
        sessionId: 'session_1',
        eventRevision: 0,
      }),
      await client.mutateMatrixCorpusProjection({
        runId: 'run_1',
        authorization,
        request: { kind: 'cas', userId: 'user_1', leaseFence: '7', command: {} },
      }),
      await client.mutateMatrixCorpusArtifactDelivery({
        ...identity(),
        command: { expectedRevision: 1 },
      }),
      await client.finalizeMatrixCorpusContext({
        runId: 'run_1',
        authorization,
        request: {
          runtimeAudience: 'hetzner-prod',
          userId: 'user_1',
          leaseFence: '7',
          expectedRevision: 2,
          artifactStageDigest: DIGEST,
          terminalCandidate: {},
        },
      }),
      await client.applyMatrixCorpusTerminalControl({
        runId: 'run_1',
        envelope: terminalEnvelope(),
      }),
      await client.cleanupMatrixCorpusRun({
        ...identity(),
        request: { targetRunId: 'run_old', targetLeaseFence: '3', updatedAt: NOW },
      }),
    ];
    expect(results.map((result) => result.ok)).toEqual(Array.from({ length: 12 }, () => true));
    expect(nock.isDone()).toBe(true);
  });

  it('rejects every malformed Matrix corpus request before transport', async () => {
    const client = createClient();
    const invalid = { ok: false, error: { code: 'invalid_request' } } as const;
    const calls: Promise<unknown>[] = [
      client.getMatrixCorpusCurrentAcceptance(''),
      client.registerMatrixCorpusContext({
        runId: '',
        authorization,
        request: contextRequest(),
      }),
      client.registerMatrixCorpusContext({
        runId: 'run_1',
        authorization: {} as never,
        request: contextRequest(),
      }),
      client.registerMatrixCorpusContext({
        runId: 'run_1',
        authorization,
        request: {} as never,
      }),
      client.finalizeMatrixCorpusContext({
        runId: '',
        authorization,
        request: {} as never,
      }),
      client.finalizeMatrixCorpusContext({
        runId: 'run_1',
        authorization,
        request: null as never,
      }),
      client.getMatrixCorpusControlStatus({ runId: '', userId: 'user_1', leaseFence: '7' }),
      client.getMatrixCorpusEvidence({
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '7',
        scenarioId: '',
        sessionId: 'session_1',
        eventRevision: 0,
      }),
      client.getMatrixCorpusEvidence({
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '7',
        scenarioId: 'scenario_1',
        sessionId: '',
        eventRevision: 0,
      }),
      client.getMatrixCorpusEvidence({
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '7',
        scenarioId: 'scenario_1',
        sessionId: 'session_1',
        eventRevision: -1,
      }),
      client.getMatrixCorpusScenarioStatus({
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '7',
        scenarioId: '',
      }),
      client.getMatrixCorpusFinalizationReadiness({
        runId: '',
        userId: 'user_1',
        leaseFence: '7',
      }),
      client.getMatrixCorpusRetentionPlan({ runId: 'run_1', userId: '', leaseFence: '7' }),
      client.mutateMatrixCorpusProjection({
        runId: 'run_1',
        authorization,
        request: null as never,
      }),
      client.mutateMatrixCorpusProjection({
        runId: 'run_1',
        authorization,
        request: { kind: 'create', record: null as never },
      }),
      client.mutateMatrixCorpusProjection({
        runId: 'run_1',
        authorization,
        request: { kind: 'create', record: { userId: '', leaseFence: '7' } },
      }),
      client.mutateMatrixCorpusProjection({
        runId: 'run_1',
        authorization,
        request: { kind: 'unknown' } as never,
      }),
      client.mutateMatrixCorpusArtifactDelivery({
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '7',
        command: null as never,
      }),
      client.applyMatrixCorpusTerminalControl({ runId: '', envelope: terminalEnvelope() }),
      client.applyMatrixCorpusTerminalControl({ runId: 'run_1', envelope: {} as never }),
      client.cleanupMatrixCorpusRun({
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '7',
        request: null as never,
      }),
    ];

    for (const call of calls) await expect(call).resolves.toEqual(invalid);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('rejects unknown fields and never exposes a private upstream body', async () => {
    nock(BASE_URL)
      .post('/internal/matrix-corpus/current-acceptance')
      .reply(200, { success: true, data: { kind: 'not_ready', privateReply: 'private-sentinel' } })
      .post('/internal/matrix-corpus/current-acceptance')
      .reply(409, { success: false, error: { code: 'PRIVATE', message: 'private-sentinel' } });
    const client = createClient();

    const malformed = await client.getMatrixCorpusCurrentAcceptance('user_1');
    const rejected = await client.getMatrixCorpusCurrentAcceptance('user_1');

    expect(malformed).toEqual({ ok: false, error: { code: 'invalid_response' } });
    expect(rejected).toEqual({ ok: false, error: { code: 'rejected', httpStatus: 409 } });
    expect(JSON.stringify([malformed, rejected])).not.toContain('private-sentinel');
  });

  it('rejects a context response correlated to another run or fence', async () => {
    nock(BASE_URL)
      .post('/internal/matrix-corpus/runs/run_1/context')
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_other',
          userId: 'user_1',
          leaseFence: '7',
          promptPreferencesVersion: 0,
          promptPreferencesDigest: DIGEST,
          agentModel: 'or:deepseek/deepseek-v4-flash',
          userTimeZone: 'Europe/Warsaw',
          expiresAt: NOW,
        },
      });

    await expect(
      createClient().registerMatrixCorpusContext({
        runId: 'run_1',
        authorization,
        request: contextRequest(),
      })
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_response' } });
  });

  it('rejects a context response correlated to another agent model', async () => {
    nock(BASE_URL)
      .post('/internal/matrix-corpus/runs/run_1/context')
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          promptPreferencesVersion: 0,
          promptPreferencesDigest: DIGEST,
          agentModel: 'or:minimax/minimax-m3',
          userTimeZone: 'Europe/Warsaw',
          expiresAt: NOW,
        },
      });

    await expect(
      createClient().registerMatrixCorpusContext({
        runId: 'run_1',
        authorization,
        request: contextRequest(),
      })
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_response' } });
  });

  it('rejects every miscorrelated read projection', async () => {
    nock(BASE_URL)
      .get('/internal/matrix-corpus/runs/run_1/control-status')
      .reply(200, {
        success: true,
        data: {
          kind: 'status',
          runId: 'run_other',
          userId: 'user_1',
          leaseFence: '7',
          lifecycle: 'running',
          revision: 1,
          contextReady: true,
          manifestReady: true,
          preflightProjectionReady: true,
          retentionReconciled: true,
          contextFinalizationTombstoneDigest: null,
          terminalCandidateDigest: null,
          artifactStageDigest: null,
          terminalControlEventId: null,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/control-status')
      .reply(200, {
        success: true,
        data: {
          kind: 'status',
          runId: 'run_1',
          userId: 'user_other',
          leaseFence: '7',
          lifecycle: 'running',
          revision: 1,
          contextReady: true,
          manifestReady: true,
          preflightProjectionReady: true,
          retentionReconciled: true,
          contextFinalizationTombstoneDigest: null,
          terminalCandidateDigest: null,
          artifactStageDigest: null,
          terminalControlEventId: null,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/control-status')
      .reply(200, {
        success: true,
        data: {
          kind: 'status',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '8',
          lifecycle: 'running',
          revision: 1,
          contextReady: true,
          manifestReady: true,
          preflightProjectionReady: true,
          retentionReconciled: true,
          contextFinalizationTombstoneDigest: null,
          terminalCandidateDigest: null,
          artifactStageDigest: null,
          terminalControlEventId: null,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/scenarios/scenario_1/evidence')
      .reply(200, {
        success: true,
        data: {
          version: 1,
          eventRevision: 2,
          toolEvidence: [],
          agentUsage: [],
          agentUsageTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 },
          sessionProof: {
            status: 'waiting_for_user',
            startReason: 'no_active_session',
            userMessageCount: 1,
            sessionStartedCount: 0,
            supersededSessionCount: 0,
          },
          turnTerminals: [],
          strictMockProof: {
            version: 1,
            status: 'passed',
            executionMode: 'strict_mock_tools',
            mockProfileDigest: DIGEST,
            productionExecutorResolutions: 0,
            productionExecutorAdmissions: 0,
          },
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/scenarios/scenario_1/status')
      .reply(200, {
        success: true,
        data: {
          kind: 'status',
          runId: 'run_1',
          userId: 'user_other',
          leaseFence: '7',
          scenarioId: 'scenario_1',
          sessionId: 'session_1',
          eventRevision: 0,
          lifecycle: 'running',
          pendingConfirmationId: null,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/finalization-readiness')
      .reply(200, {
        success: true,
        data: {
          kind: 'ready',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '8',
          revision: 2,
          projectionDigest: DIGEST,
          artifactStageDigest: DIGEST,
        },
      })
      .get('/internal/matrix-corpus/runs/run_1/retention-plan')
      .reply(200, {
        success: true,
        data: {
          kind: 'retention_plan',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '7',
          records: [
            {
              runId: 'run_other',
              leaseFence: '8',
              startedAt: NOW,
              lifecycle: 'preflight',
              verdict: 'pending',
              artifactDelivery: 'pending',
              completedAt: null,
              isCurrent: true,
            },
          ],
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/context/finalize')
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_other',
          leaseFence: '7',
          tombstoneDigest: DIGEST,
          scenarioContextCount: 20,
          finalizedAt: NOW,
        },
      });
    const client = createClient();
    const results = [
      await client.getMatrixCorpusControlStatus(identity()),
      await client.getMatrixCorpusControlStatus(identity()),
      await client.getMatrixCorpusControlStatus(identity()),
      await client.getMatrixCorpusEvidence({
        ...identity(),
        scenarioId: 'scenario_1',
        sessionId: 'session_1',
        eventRevision: 0,
      }),
      await client.getMatrixCorpusScenarioStatus({ ...identity(), scenarioId: 'scenario_1' }),
      await client.getMatrixCorpusFinalizationReadiness(identity()),
      await client.getMatrixCorpusRetentionPlan(identity()),
      await client.finalizeMatrixCorpusContext({
        runId: 'run_1',
        authorization,
        request: {
          runtimeAudience: 'hetzner-prod',
          userId: 'user_1',
          leaseFence: '7',
          expectedRevision: 2,
          artifactStageDigest: DIGEST,
          terminalCandidate: {},
        },
      }),
    ];

    expect(results).toEqual(
      Array.from({ length: 8 }, () => ({ ok: false, error: { code: 'invalid_response' } }))
    );
    expect(nock.isDone()).toBe(true);
  });

  it('maps timeout, network, API, and malformed-envelope failures privately', async () => {
    nock(BASE_URL)
      .post('/internal/matrix-corpus/current-acceptance')
      .delayConnection(50)
      .reply(200, { success: true, data: { kind: 'not_ready' } })
      .post('/internal/matrix-corpus/current-acceptance')
      .replyWithError('private-network-sentinel')
      .post('/internal/matrix-corpus/current-acceptance')
      .reply(503, { success: false })
      .post('/internal/matrix-corpus/current-acceptance')
      .reply(200, { private: 'malformed-envelope' });
    const timeoutClient = createIntexAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 5,
    });

    await expect(timeoutClient.getMatrixCorpusCurrentAcceptance('user_1')).resolves.toEqual({
      ok: false,
      error: { code: 'timeout' },
    });
    const client = createClient();
    await expect(client.getMatrixCorpusCurrentAcceptance('user_1')).resolves.toEqual({
      ok: false,
      error: { code: 'unavailable' },
    });
    await expect(client.getMatrixCorpusCurrentAcceptance('user_1')).resolves.toEqual({
      ok: false,
      error: { code: 'rejected', httpStatus: 503 },
    });
    await expect(client.getMatrixCorpusCurrentAcceptance('user_1')).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_response' },
    });
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain('private-network-sentinel');
  });

  it('rejects projection, artifact, terminal, and cleanup responses with another identity', async () => {
    nock(BASE_URL)
      .put('/internal/test-runs/run_1/projection')
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_other',
          leaseFence: '7',
          revision: 1,
          lifecycle: 'running',
          verdict: 'pending',
        },
      })
      .put('/internal/test-runs/run_1/artifact-delivery')
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_1',
          leaseFence: '8',
          revision: 2,
          lifecycle: 'running',
          verdict: 'pending',
          artifactDelivery: { status: 'pending', failureCode: null, updatedAt: NOW },
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/terminal-control')
      .reply(200, {
        success: true,
        data: {
          kind: 'acknowledged',
          runId: 'run_1',
          leaseFence: '8',
          requestEventId: 'event_1',
          requestPayloadDigest: DIGEST,
          winner: {
            kind: 'release',
            eventId: 'event_1',
            payloadDigest: DIGEST,
            outcome: 'completed_passed',
            acknowledgedAt: NOW,
          },
        },
      })
      .post('/internal/matrix-corpus/runs/run_1/cleanup')
      .reply(200, {
        success: true,
        data: {
          disposition: 'applied',
          runId: 'run_1',
          userId: 'user_other',
          leaseFence: '7',
          currentRevision: 3,
          retentionReconciled: true,
          removed: {
            runs: 0,
            sessions: 0,
            events: 0,
            confirmations: 0,
            ingestReceipts: 0,
            scenarioProjections: 0,
            scenarioContexts: 0,
            runContexts: 0,
            manifests: 0,
          },
        },
      });

    const client = createClient();
    const results = [
      await client.mutateMatrixCorpusProjection({
        runId: 'run_1',
        authorization,
        request: { kind: 'cas', userId: 'user_1', leaseFence: '7', command: {} },
      }),
      await client.mutateMatrixCorpusArtifactDelivery({
        ...identity(),
        command: { expectedRevision: 1 },
      }),
      await client.applyMatrixCorpusTerminalControl({
        runId: 'run_1',
        envelope: terminalEnvelope(),
      }),
      await client.cleanupMatrixCorpusRun({
        ...identity(),
        request: { targetRunId: 'run_old', targetLeaseFence: '3', updatedAt: NOW },
      }),
    ];

    expect(results).toEqual(
      Array.from({ length: 4 }, () => ({
        ok: false,
        error: { code: 'invalid_response' },
      }))
    );
    expect(nock.isDone()).toBe(true);
  });
});

function createClient(): IntexAgentServiceClient {
  return createIntexAgentServiceClient({
    baseUrl: BASE_URL,
    internalAuthToken: 'secret',
    logger,
  });
}

function identity(): Parameters<IntexAgentServiceClient['getMatrixCorpusControlStatus']>[0] {
  return { runId: 'run_1', userId: 'user_1', leaseFence: '7' } as const;
}

function contextRequest(): Parameters<
  IntexAgentServiceClient['registerMatrixCorpusContext']
>[0]['request'] {
  return {
    runtimeAudience: 'hetzner-prod',
    userId: 'user_1',
    leaseFence: '7',
    catalogDigest: DIGEST,
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    expectedTimeZone: 'Europe/Warsaw',
  } as const;
}

function terminalEnvelope(): Parameters<
  IntexAgentServiceClient['applyMatrixCorpusTerminalControl']
>[0]['envelope'] {
  return {
    version: 1,
    kind: 'matrix_corpus_terminal_control',
    eventId: 'event_1',
    leaseFence: '7',
    payloadDigest: DIGEST,
    attestation: 'aaa.bbb.ccc',
  } as const;
}
