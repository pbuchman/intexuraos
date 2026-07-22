/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIntexAgentMatrixCorpusClient } from '../../../infra/http/intexAgentMatrixCorpusClient.js';

const userId = 'private_user_fixture';
const runId = 'run_1';
const leaseFence = '7';
const payloadDigest = '1'.repeat(64);
const signedTerminalEnvelope = {
  version: 1 as const,
  kind: 'matrix_corpus_terminal_control' as const,
  eventId: 'terminal_1',
  leaseFence,
  payloadDigest,
  attestation: 'e30.e30.AA',
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'FAILED', message: 'safe failure' } }),
    { status: 500, headers: { 'content-type': 'application/json' } }
  );
}

function fixture() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    client: createIntexAgentMatrixCorpusClient({
      baseUrl: 'https://intex-agent.example.test/',
      internalAuthToken: 'private-internal-auth-fixture',
      logger,
      timeoutMs: 1_000,
    }),
    logger,
  };
}

describe('IntexAgentMatrixCorpusClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the closed authenticated paths and runtime-decodes all three responses', async () => {
    const current = fixture();
    fetchMock
      .mockResolvedValueOnce(success({ kind: 'admission_ready', current: 'absent' }))
      .mockResolvedValueOnce(
        success({
          kind: 'status',
          runId,
          userId,
          leaseFence,
          lifecycle: 'preflight',
          revision: 2,
          contextReady: false,
          manifestReady: false,
          preflightProjectionReady: false,
          retentionReconciled: false,
          contextFinalizationTombstoneDigest: null,
          terminalCandidateDigest: null,
          artifactStageDigest: null,
          terminalControlEventId: null,
        })
      )
      .mockResolvedValueOnce(
        success({
          kind: 'acknowledged',
          runId,
          leaseFence,
          requestEventId: 'terminal_1',
          requestPayloadDigest: payloadDigest,
          winner: {
            kind: 'abandoned',
            eventId: 'terminal_1',
            payloadDigest,
            outcome: 'stopped_not_evaluated',
            acknowledgedAt: '2026-07-20T10:00:00.000Z',
          },
        })
      );

    await expect(
      current.client.getCurrentAcceptance({ runtimeAudience: 'hetzner-prod', userId })
    ).resolves.toEqual({ kind: 'admission_ready', current: 'absent' });
    await expect(
      current.client.getControlStatus({
        runtimeAudience: 'hetzner-prod',
        runId,
        userId,
        leaseFence,
      })
    ).resolves.toEqual(
      expect.objectContaining({ kind: 'status', runId, userId, leaseFence, revision: 2 })
    );
    await expect(
      current.client.postTerminalControl({ runId, envelope: signedTerminalEnvelope })
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'acknowledged',
        runId,
        leaseFence,
        requestEventId: 'terminal_1',
        requestPayloadDigest: payloadDigest,
      })
    );

    const [acceptanceUrl, acceptanceInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(acceptanceUrl).toBe('https://intex-agent.example.test/internal/matrix-corpus/current-acceptance');
    expect(acceptanceInit.method).toBe('POST');
    expect(acceptanceInit.headers).toEqual(
      expect.objectContaining({ 'x-internal-auth': 'private-internal-auth-fixture' })
    );
    expect(JSON.parse(String(acceptanceInit.body))).toEqual({
      runtimeAudience: 'hetzner-prod',
      userId,
    });

    const [statusUrl, statusInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(statusUrl).toBe(
      'https://intex-agent.example.test/internal/matrix-corpus/runs/run_1/control-status'
    );
    expect(statusInit.method).toBe('GET');
    expect(statusInit.headers).toEqual(
      expect.objectContaining({
        'x-internal-auth': 'private-internal-auth-fixture',
        'x-matrix-corpus-runtime-audience': 'hetzner-prod',
        'x-matrix-corpus-user-id': userId,
        'x-matrix-corpus-lease-fence': leaseFence,
      })
    );

    const [terminalUrl, terminalInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(terminalUrl).toBe(
      'https://intex-agent.example.test/internal/matrix-corpus/runs/run_1/terminal-control'
    );
    expect(terminalInit.method).toBe('POST');
    expect(JSON.parse(String(terminalInit.body))).toEqual(signedTerminalEnvelope);
  });

  it('fails closed to not-ready for malformed successful responses', async () => {
    const current = fixture();
    fetchMock.mockImplementation(() =>
      Promise.resolve(success({ kind: 'not_ready', extra: 'rejected' }))
    );

    await expect(
      current.client.getCurrentAcceptance({ runtimeAudience: 'hetzner-prod', userId })
    ).resolves.toEqual({ kind: 'not_ready' });
    await expect(
      current.client.getControlStatus({
        runtimeAudience: 'hetzner-prod',
        runId,
        userId,
        leaseFence,
      })
    ).resolves.toEqual({ kind: 'not_ready' });
    await expect(
      current.client.postTerminalControl({ runId, envelope: signedTerminalEnvelope })
    ).resolves.toEqual({ kind: 'not_ready' });
  });

  it('rejects every invalid request locally without crossing the HTTP boundary', async () => {
    const current = fixture();

    await expect(current.client.getCurrentAcceptance({} as never)).resolves.toEqual({
      kind: 'not_ready',
    });
    await expect(current.client.getControlStatus({} as never)).resolves.toEqual({
      kind: 'not_ready',
    });
    await expect(current.client.getTurnTerminal({ turnIndex: 20 } as never)).resolves.toEqual({
      kind: 'not_ready',
    });
    await expect(current.client.postTerminalControl({} as never)).resolves.toEqual({
      kind: 'not_ready',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails every operation closed for non-success HTTP responses', async () => {
    const current = fixture();
    fetchMock.mockResolvedValue(failure());

    await expect(
      current.client.getCurrentAcceptance({ runtimeAudience: 'hetzner-prod', userId })
    ).resolves.toEqual({ kind: 'not_ready' });
    await expect(
      current.client.getControlStatus({ runtimeAudience: 'hetzner-prod', runId, userId, leaseFence })
    ).resolves.toEqual({ kind: 'not_ready' });
    await expect(
      current.client.getTurnTerminal({
        runtimeAudience: 'hetzner-prod',
        runId,
        userId,
        leaseFence,
        scenarioId: 'scenario_1',
        turnIndex: 0,
      })
    ).resolves.toEqual({ kind: 'not_ready' });
    await expect(
      current.client.postTerminalControl({ runId, envelope: signedTerminalEnvelope })
    ).resolves.toEqual({ kind: 'not_ready' });
  });

  it('reads one exact safe turn terminal through scenario status and evidence', async () => {
    const current = fixture();
    const terminalMarkerDigest = '2'.repeat(64);
    const recordedAt = '2026-07-20T10:00:02.000Z';
    fetchMock
      .mockResolvedValueOnce(
        success({
          kind: 'status',
          runId,
          userId,
          leaseFence,
          scenarioId: 'scenario_1',
          sessionId: 'session_1',
          eventRevision: 4,
          lifecycle: 'running',
          pendingConfirmationId: null,
        })
      )
      .mockResolvedValueOnce(
        success({
          version: 1,
          eventRevision: 4,
          toolEvidence: [],
          agentUsage: [],
          agentUsageTotals: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costNanoUsd: 0,
          },
          turnTerminals: [
            {
              status: 'completed',
              turnIndex: 0,
              replyCount: 1,
              replyDigests: ['3'.repeat(64)],
              terminalMarkerDigest,
              recordedAt,
            },
          ],
          strictMockProof: {
            version: 1,
            status: 'passed',
            executionMode: 'strict_mock_tools',
            mockProfileDigest: '4'.repeat(64),
            productionExecutorResolutions: 0,
            productionExecutorAdmissions: 0,
          },
        })
      );

    await expect(
      current.client.getTurnTerminal({
        runtimeAudience: 'hetzner-prod',
        runId,
        userId,
        leaseFence,
        scenarioId: 'scenario_1',
        turnIndex: 0,
      })
    ).resolves.toEqual({
      kind: 'terminal',
      runId,
      userId,
      leaseFence,
      scenarioId: 'scenario_1',
      turnIndex: 0,
      status: 'completed',
      terminalMarkerDigest,
      recordedAt,
    });

    const [statusUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [evidenceUrl, evidenceInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(statusUrl).toBe(
      'https://intex-agent.example.test/internal/matrix-corpus/runs/run_1/scenarios/scenario_1/status'
    );
    expect(evidenceUrl).toBe(
      'https://intex-agent.example.test/internal/matrix-corpus/runs/run_1/scenarios/scenario_1/evidence'
    );
    expect(evidenceInit.headers).toEqual(
      expect.objectContaining({
        'x-matrix-corpus-session-id': 'session_1',
        'x-matrix-corpus-event-revision': '4',
      })
    );
  });

  it('fails closed when status or terminal acknowledgment belongs to another identity', async () => {
    const current = fixture();
    fetchMock
      .mockResolvedValueOnce(
        success({
          kind: 'status',
          runId: 'run_other',
          userId,
          leaseFence,
          lifecycle: 'preflight',
          contextReady: false,
          manifestReady: false,
          preflightProjectionReady: false,
          retentionReconciled: false,
          contextFinalizationTombstoneDigest: null,
          terminalCandidateDigest: null,
          artifactStageDigest: null,
        })
      )
      .mockResolvedValueOnce(
        success({
          kind: 'acknowledged',
          runId,
          leaseFence: '8',
          requestEventId: 'terminal_1',
          requestPayloadDigest: payloadDigest,
          winner: {
            kind: 'abandoned',
            eventId: 'terminal_1',
            payloadDigest,
            outcome: 'stopped_not_evaluated',
            acknowledgedAt: '2026-07-20T10:00:00.000Z',
          },
        })
      );

    await expect(
      current.client.getControlStatus({
        runtimeAudience: 'hetzner-prod',
        runId,
        userId,
        leaseFence,
      })
    ).resolves.toEqual({ kind: 'not_ready' });
    await expect(
      current.client.postTerminalControl({ runId, envelope: signedTerminalEnvelope })
    ).resolves.toEqual({ kind: 'not_ready' });
  });

  it.each([
    ['not-ready result', { kind: 'not_ready' }],
    ['wrong run', controlStatus({ runId: 'run_other' })],
    ['wrong user', controlStatus({ userId: 'user_other' })],
    ['wrong fence', controlStatus({ leaseFence: '8' })],
  ] as const)('rejects control status with %s', async (_label, response) => {
    const current = fixture();
    fetchMock.mockResolvedValueOnce(success(response));

    await expect(
      current.client.getControlStatus({ runtimeAudience: 'hetzner-prod', runId, userId, leaseFence })
    ).resolves.toEqual({ kind: 'not_ready' });
  });

  it.each([
    ['not-ready result', { kind: 'not_ready' }],
    ['wrong run', terminalAcknowledgement({ runId: 'run_other' })],
    ['wrong fence', terminalAcknowledgement({ leaseFence: '8' })],
    ['wrong event', terminalAcknowledgement({ requestEventId: 'terminal_other' })],
    ['wrong payload', terminalAcknowledgement({ requestPayloadDigest: '2'.repeat(64) })],
  ] as const)('rejects terminal acknowledgment with %s', async (_label, response) => {
    const current = fixture();
    fetchMock.mockResolvedValueOnce(success(response));

    await expect(
      current.client.postTerminalControl({ runId, envelope: signedTerminalEnvelope })
    ).resolves.toEqual({ kind: 'not_ready' });
  });

  it.each([
    ['not-ready status', { kind: 'not_ready' }],
    ['wrong run', scenarioStatus({ runId: 'run_other' })],
    ['wrong user', scenarioStatus({ userId: 'user_other' })],
    ['wrong fence', scenarioStatus({ leaseFence: '8' })],
    ['wrong scenario', scenarioStatus({ scenarioId: 'scenario_other' })],
  ] as const)('rejects turn evidence after %s', async (_label, response) => {
    const current = fixture();
    fetchMock.mockResolvedValueOnce(success(response));

    await expect(current.client.getTurnTerminal(turnTerminalInput())).resolves.toEqual({
      kind: 'not_ready',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects unavailable, ambiguous, absent, and malformed exact turn evidence', async () => {
    const unavailable = fixture();
    fetchMock
      .mockResolvedValueOnce(success(scenarioStatus()))
      .mockResolvedValueOnce(failure());
    await expect(unavailable.client.getTurnTerminal(turnTerminalInput())).resolves.toEqual({
      kind: 'not_ready',
    });

    for (const turnTerminals of [
      [],
      [turnTerminal(), turnTerminal()],
      [{ ...turnTerminal(), terminalMarkerDigest: 'not-a-digest' }],
    ]) {
      const current = fixture();
      fetchMock
        .mockResolvedValueOnce(success(scenarioStatus()))
        .mockResolvedValueOnce(success(evidence(turnTerminals)));
      await expect(current.client.getTurnTerminal(turnTerminalInput())).resolves.toEqual({
        kind: 'not_ready',
      });
    }
  });

  it('does not expose transport exceptions payloads attestations or identifiers in logs', async () => {
    const current = fixture();
    const privateTransportError = 'private-provider-error-fixture';
    fetchMock.mockRejectedValue(new Error(privateTransportError));

    await current.client.getCurrentAcceptance({ runtimeAudience: 'hetzner-prod', userId });
    await current.client.getControlStatus({
      runtimeAudience: 'hetzner-prod',
      runId,
      userId,
      leaseFence,
    });
    await current.client.postTerminalControl({ runId, envelope: signedTerminalEnvelope });

    const captured = JSON.stringify([
      ...current.logger.info.mock.calls,
      ...current.logger.warn.mock.calls,
      ...current.logger.error.mock.calls,
      ...current.logger.debug.mock.calls,
    ]);
    for (const privateValue of [
      privateTransportError,
      userId,
      runId,
      leaseFence,
      signedTerminalEnvelope.attestation,
      'private-internal-auth-fixture',
    ]) {
      expect(captured).not.toContain(privateValue);
    }
  });
});

function controlStatus(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    kind: 'status' as const,
    runId,
    userId,
    leaseFence,
    lifecycle: 'preflight' as const,
    contextReady: false,
    manifestReady: false,
    preflightProjectionReady: false,
    retentionReconciled: false,
    contextFinalizationTombstoneDigest: null,
    terminalCandidateDigest: null,
    artifactStageDigest: null,
    ...overrides,
  };
}

function terminalAcknowledgement(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    kind: 'acknowledged' as const,
    runId,
    leaseFence,
    requestEventId: 'terminal_1',
    requestPayloadDigest: payloadDigest,
    winner: {
      kind: 'abandoned' as const,
      eventId: 'terminal_1',
      payloadDigest,
      outcome: 'stopped_not_evaluated' as const,
      acknowledgedAt: '2026-07-20T10:00:00.000Z',
    },
    ...overrides,
  };
}

function scenarioStatus(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    kind: 'status' as const,
    runId,
    userId,
    leaseFence,
    scenarioId: 'scenario_1',
    sessionId: 'session_1',
    eventRevision: 4,
    lifecycle: 'running' as const,
    pendingConfirmationId: null,
    ...overrides,
  };
}

function turnTerminal() {
  return {
    status: 'completed' as const,
    turnIndex: 0,
    replyCount: 1,
    replyDigests: ['3'.repeat(64)],
    terminalMarkerDigest: '2'.repeat(64),
    recordedAt: '2026-07-20T10:00:02.000Z',
  };
}

function evidence(turnTerminals: readonly unknown[]) {
  return {
    version: 1,
    eventRevision: 4,
    toolEvidence: [],
    agentUsage: [],
    agentUsageTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 },
    turnTerminals,
    strictMockProof: {
      version: 1,
      status: 'passed',
      executionMode: 'strict_mock_tools',
      mockProfileDigest: '4'.repeat(64),
      productionExecutorResolutions: 0,
      productionExecutorAdmissions: 0,
    },
  };
}

function turnTerminalInput() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId,
    userId,
    leaseFence,
    scenarioId: 'scenario_1',
    turnIndex: 0,
  };
}
