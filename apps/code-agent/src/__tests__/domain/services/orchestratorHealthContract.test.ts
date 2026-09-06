import { describe, expect, it } from 'vitest';
import {
  hasLegacyCapacityHealth,
  parseOrchestratorHealthContract,
} from '../../../domain/services/orchestratorHealthContract.js';

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    healthContractVersion: 2,
    status: 'ready',
    capacity: 2,
    running: 0,
    available: 2,
    workerContainers: 0,
    pendingTerminalCallbacks: 0,
    terminalCallbackActivityTotal: 0,
    workerAuths: {},
    providerApiKeys: {},
    dockerHealthy: true,
    diskHealthy: true,
    logForwarderDrain: {
      counterEpochId: '00112233445566778899aabbccddeeff',
      processStartedAt: '2026-08-28T10:00:00.000Z',
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
    ...overrides,
  };
}

describe('orchestrator health v2 consumer contract', () => {
  it('rejects a non-object response before reading contract fields', () => {
    expect(parseOrchestratorHealthContract(null)).toMatchObject({ ok: false });
  });

  it('accepts the complete privacy-safe v2 response', () => {
    expect(parseOrchestratorHealthContract(response())).toMatchObject({
      ok: true,
      value: { healthContractVersion: 2, status: 'ready' },
    });
  });

  it('rejects v1 and reports the two new required fields in stable order', () => {
    const legacy = response();
    legacy['healthContractVersion'] = 1;
    Reflect.deleteProperty(legacy, 'logForwarderDrain');
    expect(parseOrchestratorHealthContract(legacy)).toEqual({
      ok: false,
      missingFields: ['healthContractVersion', 'logForwarderDrain'],
    });
    expect(hasLegacyCapacityHealth(legacy)).toBe(true);
  });

  it('rejects malformed epochs, negative gauges, timestamps, and extra privacy-hostile keys', () => {
    const malformed = response();
    malformed['logForwarderDrain'] = {
      ...(malformed['logForwarderDrain'] as Record<string, unknown>),
      counterEpochId: 'reused',
      queuedChunks: -1,
      lastActivityAt: 'today',
      taskId: 'must-not-be-consumed',
    };
    expect(parseOrchestratorHealthContract(malformed)).toEqual({
      ok: false,
      missingFields: ['logForwarderDrain'],
    });
  });

  it('validates every drain identity and timestamp branch independently', () => {
    const malformedFields: [string, unknown][] = [
      ['counterEpochId', 123],
      ['processStartedAt', 0],
      ['lastActivityAt', 'today'],
    ];

    for (const [field, value] of malformedFields) {
      const candidate = response();
      candidate['logForwarderDrain'] = {
        ...(candidate['logForwarderDrain'] as Record<string, unknown>),
        [field]: value,
      };
      expect(parseOrchestratorHealthContract(candidate)).toEqual({
        ok: false,
        missingFields: ['logForwarderDrain'],
      });
    }

    const active = response();
    active['logForwarderDrain'] = {
      ...(active['logForwarderDrain'] as Record<string, unknown>),
      lastActivityAt: '2026-08-28T10:00:01.000Z',
    };
    expect(parseOrchestratorHealthContract(active)).toMatchObject({ ok: true });
  });

  it('requires fail-closed ownership fields and accepts null only for instantaneous gauges', () => {
    const unknown = response({ workerContainers: null, pendingTerminalCallbacks: null });
    expect(parseOrchestratorHealthContract(unknown)).toMatchObject({ ok: true });

    const malformed = response({
      workerContainers: -1,
      pendingTerminalCallbacks: 'zero',
      terminalCallbackActivityTotal: null,
    });
    expect(parseOrchestratorHealthContract(malformed)).toEqual({
      ok: false,
      missingFields: [
        'workerContainers',
        'pendingTerminalCallbacks',
        'terminalCallbackActivityTotal',
      ],
    });
  });
});
