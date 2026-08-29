import { randomBytes } from 'node:crypto';

export interface MockLogForwarderDrain {
  counterEpochId: string;
  processStartedAt: string;
  activeForwarders: number;
  bufferedBytes: number;
  partialLineBytes: number;
  queuedChunks: number;
  inFlightBatches: number;
  inFlightChunks: number;
  activeFlushOperations: number;
  openUploadRequests: number;
  detachedUploadRetryPromises: number;
  droppedChunksTotal: number;
  forwarderActivityTotal: number;
  lastActivityAt: string | null;
}

export interface MockClaudeHealth {
  healthContractVersion: 2;
  status: 'ready';
  capacity: number;
  running: number;
  available: number;
  workerContainers: number | null;
  pendingTerminalCallbacks: number | null;
  terminalCallbackActivityTotal: number | null;
  workerAuths: {
    claude: { status: 'active'; authMode: 'mock'; refreshSupported: false };
    codex: { status: 'not_configured'; refreshSupported: false };
  };
  providerApiKeys: Record<string, { configured: boolean }>;
  dockerHealthy: boolean;
  diskHealthy: boolean;
  logForwarderDrain: MockLogForwarderDrain;
}

const counterEpochId = randomBytes(16).toString('hex');
const processStartedAt = new Date().toISOString();

const emptyLogForwarderDrain: MockLogForwarderDrain = {
  counterEpochId,
  processStartedAt,
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

export function buildMockClaudeHealth(running: number): MockClaudeHealth {
  const capacity = 3;

  return {
    healthContractVersion: 2,
    status: 'ready',
    capacity,
    running,
    available: capacity - running,
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
    logForwarderDrain: { ...emptyLogForwarderDrain },
  };
}
