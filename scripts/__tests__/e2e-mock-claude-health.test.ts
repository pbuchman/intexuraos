import { describe, expect, it } from 'vitest';
import { parseOrchestratorHealthContract } from '../../apps/code-agent/src/domain/services/orchestratorHealthContract.js';
import { buildMockClaudeHealth } from '../../e2e/mock-claude/health.js';

describe('E2E mock Claude health contract', () => {
  it('returns the worker capability details required by code-agent dispatch checks', () => {
    const health = buildMockClaudeHealth(1);
    expect(health).toEqual({
      healthContractVersion: 2,
      status: 'ready',
      capacity: 3,
      running: 1,
      available: 2,
      workerContainers: 0,
      pendingTerminalCallbacks: 0,
      terminalCallbackActivityTotal: 0,
      workerAuths: {
        claude: { status: 'active', authMode: 'mock', refreshSupported: false },
        codex: { status: 'not_configured', refreshSupported: false },
      },
      providerApiKeys: {},
      dockerHealthy: true,
      diskHealthy: true,
      logForwarderDrain: {
        counterEpochId: expect.stringMatching(/^[0-9a-f]{32}$/u),
        processStartedAt: expect.any(String),
        activeForwarders: 0,
        bufferedBytes: 0,
        partialLineBytes: 0,
        queuedChunks: 0,
        inFlightBatches: 0,
        inFlightChunks: 0,
        activeFlushOperations: 0,
        openUploadRequests: 0,
        detachedUploadRetryPromises: 0,
        droppedChunksTotal: 0,
        forwarderActivityTotal: 0,
        lastActivityAt: null,
      },
    });
    expect(new Date(health.logForwarderDrain.processStartedAt).toISOString()).toBe(
      health.logForwarderDrain.processStartedAt
    );
    expect(parseOrchestratorHealthContract(health)).toMatchObject({ ok: true });
    expect(buildMockClaudeHealth(0).logForwarderDrain).toEqual(health.logForwarderDrain);
  });
});
