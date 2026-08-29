import type { KeyObject } from 'node:crypto';
import type { PubSubDrainSnapshot } from '../../tools/pubsub-ui/pubsub-drain.mjs';

export type DrainCapturePhase = 'witness' | 'anchor' | 'read1' | 'read2';
export type DrainCaptureSurface = 'pubsub' | 'orchestrator' | 'ownership';

export interface DrainSurfaceTargetIdentity {
  kind: 'container-process' | 'process';
  instanceIdHash: string;
}

export interface DrainSurfaceIdentity extends DrainSurfaceTargetIdentity {
  endpointIdSha256: string;
  sourceRevision: string;
}

export interface DrainLogicalCapture {
  collectorRunId: string;
  surface: DrainCaptureSurface;
  phase: DrainCapturePhase;
  sequence: number;
  receiptId: string;
  startedMonotonicNs: string;
  completedMonotonicNs: string;
  receivedAt: string;
}

export interface OrchestratorDrainEvidence {
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

export interface PubSubCaptureEvidence {
  capture: DrainLogicalCapture;
  surfaceIdentity: DrainSurfaceIdentity & { kind: 'container-process' };
  status: 'ok';
  drainContractVersion: 1;
  drain: PubSubDrainSnapshot;
}

export interface OrchestratorCaptureEvidence {
  capture: DrainLogicalCapture;
  surfaceIdentity: DrainSurfaceIdentity & { kind: 'process' };
  healthContractVersion: 2;
  status: 'ready';
  dockerHealthy: true;
  diskHealthy: true;
  running: number;
  workerContainers: number | null;
  pendingTerminalCallbacks: number | null;
  terminalCallbackActivityTotal: number | null;
  logForwarderDrain: OrchestratorDrainEvidence;
}

export type OwnershipCollection =
  | 'codeTasks'
  | 'sessions'
  | 'testRuns'
  | 'runContexts'
  | 'leases'
  | 'ingestOutbox'
  | 'terminalControlOutbox';

export interface OwnershipAggregateInput {
  nonzeroCount: number;
  unknownCount: number;
  collections: Record<OwnershipCollection, { nonzero: number; unknown: number }>;
}

export interface OwnershipCaptureEvidence extends OwnershipAggregateInput {
  capture: DrainLogicalCapture;
  observationReceiptId: string;
}

export interface OwnershipCollectionRequest {
  collectorRunId: string;
  surface: 'ownership';
  phase: 'anchor' | 'read1' | 'read2';
  sequence: number;
  observationReceiptId: string;
}

export interface OwnershipObservation {
  observationReceiptId: string;
  aggregate: OwnershipAggregateInput;
}

export interface SignedDrainCaptureWrapper<Surface extends DrainCaptureSurface, Evidence> {
  schemaVersion: 1;
  signatureAlgorithm: 'Ed25519';
  keyIdSha256: string;
  surface: Surface;
  phase: DrainCapturePhase;
  evidence: Evidence;
  signatureBase64: string;
}

export type PubSubCaptureWrapper = SignedDrainCaptureWrapper<'pubsub', PubSubCaptureEvidence>;
export type OrchestratorCaptureWrapper = SignedDrainCaptureWrapper<
  'orchestrator',
  OrchestratorCaptureEvidence
>;
export type OwnershipCaptureWrapper = SignedDrainCaptureWrapper<
  'ownership',
  OwnershipCaptureEvidence
>;

export interface WitnessCaptureSet {
  pubsub: PubSubCaptureWrapper;
  orchestrator: OrchestratorCaptureWrapper;
}

export interface OwnedCaptureSet extends WitnessCaptureSet {
  ownership: OwnershipCaptureWrapper;
}

export interface DrainCaptureSequence {
  witness: WitnessCaptureSet;
  anchor: OwnedCaptureSet;
  read1: OwnedCaptureSet;
  read2: OwnedCaptureSet;
}

export interface DevDrainVerifierInput {
  contractVersion: 1;
  requiredQuietIntervalMs: number;
  topologyFreshnessMs: number;
  witness: {
    completedAt: string;
    pubsub: PubSubCaptureEvidence;
    orchestrator: OrchestratorCaptureEvidence;
  };
  anchor: {
    completedAt: string;
    pubsub: PubSubCaptureEvidence;
    orchestrator: OrchestratorCaptureEvidence;
    ownership: OwnershipCaptureEvidence;
  };
  read1: DevDrainVerifierInput['anchor'];
  read2: DevDrainVerifierInput['anchor'];
}

export interface DevDrainVerificationResult {
  pendingStatus: 'zero' | 'nonzero' | 'unknown';
  reasons: string[];
}

export interface SignedDevDrainArtifact {
  schemaVersion: 1;
  artifactType: 'dev-drain-final';
  signatureAlgorithm: 'Ed25519';
  keyIdSha256: string;
  evidenceRunId: string;
  operationNonce: string;
  createdAt: string;
  sourceRevisions: {
    pubsub: string;
    orchestrator: string;
  };
  requiredQuietIntervalMs: number;
  topologyFreshnessMs: number;
  captures: DrainCaptureSequence;
  result: DevDrainVerificationResult;
  signatureBase64: string;
}

export interface DevDrainCollector {
  capture(phase: 'witness'): Promise<WitnessCaptureSet>;
  capture(
    phase: 'anchor' | 'read1' | 'read2',
    options: {
      collectOwnership: (request: OwnershipCollectionRequest) => Promise<OwnershipObservation>;
    }
  ): Promise<OwnedCaptureSet>;
  buildVerifierArtifact(options: {
    requiredQuietIntervalMs: number;
    topologyFreshnessMs: number;
  }): Promise<SignedDevDrainArtifact>;
}

export function verifyDrainCaptureWrapper(wrapper: unknown, publicKeyInput: KeyObject): boolean;

export function verifyDevDrainArtifactSignature(
  artifact: unknown,
  publicKeyInput: KeyObject
): boolean;

export function assembleDevDrainVerifierInput(options: {
  captures: DrainCaptureSequence;
  publicKey: KeyObject;
  requiredQuietIntervalMs: number;
  topologyFreshnessMs: number;
}): DevDrainVerifierInput;

export function createDevDrainCollector(options: {
  endpoints: { pubsub: string; orchestrator: string };
  fetchImpl?: typeof fetch;
  now?: () => Date;
  monotonicNowNs?: () => bigint;
  requestTimeoutMs?: number;
  collectorRunId?: string;
  evidenceRunId: string;
  operationNonce: string;
  signingPrivateKey: KeyObject;
  sourceRevisions: { pubsub: string; orchestrator: string };
  surfaceIdentities: {
    pubsub: DrainSurfaceTargetIdentity & { kind: 'container-process' };
    orchestrator: DrainSurfaceTargetIdentity & { kind: 'process' };
  };
}): DevDrainCollector;

export interface LastGoodReferencedValueBase {
  evidenceRunId: string;
  observedAt: string;
}

export interface LastGoodActiveState {
  schemaVersion: 1;
  evidenceRunId: string;
  intexuraosRevision: string;
  pbuchmanDevRevision: string;
  installManifestSha256: string;
  profile: {
    mode: 'active-post-cutover';
    path: string;
    revision: string;
    sha256: string;
  };
  unitFileStates: Record<string, 'enabled' | 'disabled'>;
  expectedCandidatePorts: number[];
  staticReleaseTarget: string;
  staticReleaseFiles: Record<string, string>;
  pm2EcosystemPath: string;
  pm2EcosystemSha256: string;
  pm2Processes: { cwd: string; execPath: string; name: string; status: 'online' }[];
  composeCheckoutRevision: string;
  composeFileSha256: string;
  imageDigests: [string, string];
  referencedObjects: {
    activeHealth: {
      path: string;
      sha256: string;
      value: LastGoodReferencedValueBase & { checks: string[]; result: 'PASS' };
    };
    externalIntegrations: {
      path: string;
      sha256: string;
      value: LastGoodReferencedValueBase & {
        states: Record<string, string | number | boolean>;
      };
    };
    secretPackage: {
      path: string;
      sha256: string;
      value: LastGoodReferencedValueBase & { projectionIds: string[]; version: number };
    };
    serviceAccountPrincipal: {
      path: string;
      sha256: string;
      value: LastGoodReferencedValueBase & { id: string; kind: string };
    };
  };
  devDrainSourceRevisions: { orchestrator: string; pubsub: string };
  devDrainNodeSha256: string;
  devDrainNodeVersion: string;
  devDrainVerifierSources: Record<string, string>;
}

export interface AlloyFlushEvidence {
  bufferFlushComplete: true;
  evidenceRunId: string;
  observedAt: string;
  operationNonce: string;
  pm2Only: true;
  result: 'PASS';
  schemaVersion: 1;
}

export interface DevHostObservabilityFence {
  artifactType: 'dev-host-observability-fence';
  bufferFlushComplete: true;
  continuityHealthy: true;
  evidenceRunId: string;
  observedAt: string;
  operationNonce: string;
  pendingBufferCount: 0;
  phase: 'terminal-log-tail' | 'final-alloy-flush';
  result: 'PASS';
  schemaVersion: 1;
  terminalTailComplete: true;
}

export interface AlloyDebugSnapshot {
  capturedAt: string;
  configSha256: string;
  invocationId: string;
  mainPid: number;
  pm2Only: true;
  source: {
    activeFilesTotal: number;
    fileBytesTotal: number;
    readBytesTotal: number;
    readLinesTotal: number;
  };
  write: {
    batchRetriesTotal: number;
    droppedEntriesTotal: number;
    sentEntriesTotal: number;
  };
}

export interface HostObservabilitySnapshot {
  alloy: AlloyDebugSnapshot;
  capturedAt: string;
  logServer: { childProcessCount: number; clients: number };
  terminalTail: {
    complete: boolean;
    expectedMarkerCount: number;
    observedMarkerCount: number;
  };
  units: Record<
    | 'pm2-pbuchman.service'
    | 'intexuraos-emulators.service'
    | 'pm2-journal-bridge.service'
    | 'intexuraos-log-viewer.service'
    | 'intexuraos-log-server.service'
    | 'alloy.service',
    { activeState: 'active' | 'inactive'; invocationId: string; mainPid: number }
  >;
}

export function buildLastGoodActiveState(
  input: unknown,
  options: {
    evidenceDirectory: string;
    expectedCandidatePorts: number[];
    expectedUnits: string[];
    expectedVerifierSources: string[];
    maxReferenceAgeMs: number;
    now: () => Date;
    profileRoot: string;
    referenceGroupId?: number;
    referenceOwnerId?: number;
    referenceReadHook?: (path: string, name: string) => void;
    staticReleaseRoot: string;
  }
): Readonly<LastGoodActiveState>;

export function buildAlloyFlushEvidence(input: unknown): Readonly<AlloyFlushEvidence>;

export function buildDevHostObservabilityFence(input: unknown): Readonly<DevHostObservabilityFence>;

export function publishImmutableEvidence(options: {
  directory: string;
  fileName: string;
  value: unknown;
  ownerId?: number;
  groupId?: number;
  beforePublish?: (paths: { temporaryPath: string; finalPath: string }) => void;
}): Readonly<{ fileName: string; path: string; sha256: string }>;

export function parseAlloyDebugMetrics(
  text: string
): Readonly<Pick<AlloyDebugSnapshot, 'source' | 'write'>>;

export function evaluateAlloyFlushProof(options: {
  baseline: unknown;
  first: unknown;
  second: unknown;
  expectedFileCount: number;
  minimumStableIntervalMs?: number;
}): {
  pendingBufferCount: number | null;
  reasons: string[];
  status: 'PASS' | 'UNKNOWN';
};

export function runDevHostObservabilityObserver(options: {
  evidenceRunId: string;
  getSnapshot: () => Promise<HostObservabilitySnapshot | undefined>;
  maxPolls: number;
  maxSnapshotAgeMs?: number;
  minimumStableIntervalMs?: number;
  now: () => Date;
  operationNonce: string;
  publish: (publication: {
    fileName: string;
    value: AlloyFlushEvidence | DevHostObservabilityFence;
  }) => Promise<unknown>;
  sleep: () => Promise<void>;
}): Promise<{
  publications: unknown[];
  reasons: string[];
  result: 'PASS' | 'UNKNOWN';
}>;

export function inspectAlloyPm2OnlyConfig(text: string, expectedGlob: string): boolean;

export function createLinuxHostSnapshotReader(options: {
  evidenceRunId: string;
  operationNonce: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  execute?: typeof import('node:child_process').execFileSync;
  alloyConfigPath?: string;
  alloyMetricsUrl?: string;
  logServerHealthUrl?: string;
  pm2LogDirectory?: string;
}): () => Promise<HostObservabilitySnapshot>;

export function runDevHostEvidenceCli(
  args: string[],
  dependencies?: {
    allowNonRoot?: boolean;
    ownerId?: number;
    groupId?: number;
    now?: () => Date;
    sleep?: () => Promise<void>;
    policy?: unknown;
    linuxObserver?: Omit<
      Parameters<typeof createLinuxHostSnapshotReader>[0],
      'evidenceRunId' | 'operationNonce'
    >;
    onPublication?: (
      publication: Readonly<{
        fileName: string;
        path: string;
        sha256: string;
      }>
    ) => void;
  }
): Promise<unknown>;
