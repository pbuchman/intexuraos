export function emptyLogForwarderDrain(): Record<string, unknown> {
  return {
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
  };
}

export function orchestratorHealthV2(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
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
    logForwarderDrain: emptyLogForwarderDrain(),
    ...overrides,
  };
}
