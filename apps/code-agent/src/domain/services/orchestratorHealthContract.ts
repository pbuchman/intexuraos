export interface LogForwarderDrainContract {
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

export interface OrchestratorHealthContract {
  healthContractVersion: 2;
  status: 'ready';
  capacity: number;
  running: number;
  available: number;
  workerContainers: number | null;
  pendingTerminalCallbacks: number | null;
  terminalCallbackActivityTotal: number;
  workerAuths: Record<string, unknown>;
  providerApiKeys: Record<string, { configured: boolean }>;
  dockerHealthy: boolean;
  diskHealthy: boolean;
  logForwarderDrain: LogForwarderDrainContract;
}

const REQUIRED_FIELDS = [
  'healthContractVersion',
  'status',
  'capacity',
  'running',
  'available',
  'workerContainers',
  'pendingTerminalCallbacks',
  'terminalCallbackActivityTotal',
  'workerAuths',
  'providerApiKeys',
  'dockerHealthy',
  'diskHealthy',
  'logForwarderDrain',
] as const;

const DRAIN_FIELDS = [
  'counterEpochId',
  'processStartedAt',
  'activeForwarders',
  'bufferedBytes',
  'partialLineBytes',
  'queuedChunks',
  'inFlightBatches',
  'inFlightChunks',
  'activeFlushOperations',
  'openUploadRequests',
  'detachedUploadRetryPromises',
  'droppedChunksTotal',
  'forwarderActivityTotal',
  'lastActivityAt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableSafeCount(value: unknown): value is number | null {
  return value === null || isSafeCount(value);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function isLogForwarderDrain(value: unknown): value is LogForwarderDrainContract {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...DRAIN_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    return false;
  }
  if (
    typeof value['counterEpochId'] !== 'string' ||
    !/^[0-9a-f]{32}$/u.test(value['counterEpochId']) ||
    !isIsoInstant(value['processStartedAt']) ||
    (value['lastActivityAt'] !== null && !isIsoInstant(value['lastActivityAt']))
  ) {
    return false;
  }
  return DRAIN_FIELDS.filter(
    (field) =>
      field !== 'counterEpochId' && field !== 'processStartedAt' && field !== 'lastActivityAt'
  ).every((field) => isSafeCount(value[field]));
}

export function hasLegacyCapacityHealth(data: unknown): boolean {
  return (
    isRecord(data) &&
    data['status'] === 'ready' &&
    typeof data['capacity'] === 'number' &&
    typeof data['running'] === 'number' &&
    typeof data['available'] === 'number'
  );
}

export function parseOrchestratorHealthContract(
  data: unknown
):
  | { ok: true; value: OrchestratorHealthContract }
  | { ok: false; missingFields: string[] } {
  if (!isRecord(data)) return { ok: false, missingFields: [...REQUIRED_FIELDS] };

  const missingFields = REQUIRED_FIELDS.filter((field) => {
    const value = data[field];
    if (field === 'healthContractVersion') return value !== 2;
    if (field === 'status') return value !== 'ready';
    if (field === 'capacity' || field === 'running' || field === 'available') {
      return typeof value !== 'number';
    }
    if (
      field === 'workerContainers' ||
      field === 'pendingTerminalCallbacks'
    ) {
      return !isNullableSafeCount(value);
    }
    if (field === 'terminalCallbackActivityTotal') return !isSafeCount(value);
    if (field === 'dockerHealthy' || field === 'diskHealthy') return typeof value !== 'boolean';
    if (field === 'logForwarderDrain') return !isLogForwarderDrain(value);
    return !isRecord(value);
  });

  if (missingFields.length > 0) return { ok: false, missingFields: [...missingFields] };
  return { ok: true, value: data as unknown as OrchestratorHealthContract };
}
