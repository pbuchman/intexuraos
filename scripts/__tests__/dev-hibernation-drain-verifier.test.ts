import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalTopologyHash } from '../../tools/pubsub-ui/pubsub-drain.mjs';
import { evaluateUnsignedDevDrainEvidence as verifyDevDrain } from '../lib/dev-hibernation-drain-verifier.mjs';

interface SurfaceIdentityFixture {
  kind: string;
  instanceIdHash: string;
  endpointIdSha256: string;
  sourceRevision: string;
}

type CapturePhaseFixture = 'witness' | 'anchor' | 'read1' | 'read2';
type CaptureSurfaceFixture = 'pubsub' | 'orchestrator' | 'ownership';

interface LogicalCaptureFixture {
  collectorRunId: string;
  surface: CaptureSurfaceFixture;
  phase: CapturePhaseFixture;
  sequence: number;
  receiptId: string;
  startedMonotonicNs: string;
  completedMonotonicNs: string;
  receivedAt: string;
}

interface ListenerMultiplicityFixture {
  projectId: string;
  topicName: string;
  subscriptionName: string;
  classification: string;
  listeners: number;
}

interface PubSubDrainFixture {
  counterEpochId: string;
  processStartedAt: string;
  expectedTopologyHash: string;
  expectedObservedTopologyHash: string;
  preservedLegacyTopologyHash: string;
  observedTopologyHash: string;
  topologyObservedAt: string;
  topologyObservationSequence: number;
  topologyRefreshErrorsTotal: number;
  topologyMatch: boolean;
  activeListenerTopologyHash: string;
  subscriptionCounts: {
    expected: number;
    observed: number;
    classified: number;
    unclassified: number;
    missing: number;
    unexpected: number;
    orphaned: number;
    listenerless: number;
    duplicateListeners: number;
    duplicateSubscriptions: number;
    targetExpected: number;
    targetObserved: number;
    preservedLegacyExpected: number;
    preservedLegacyObserved: number;
    missingTarget: number;
    missingPreservedLegacy: number;
    preservedLegacyListeners: number;
  };
  classificationCounts: { forwarded: number; 'monitor-only': number; preservedLegacy: number };
  listenerMultiplicity: ListenerMultiplicityFixture[];
  activeListeners: number;
  setupErrors: number;
  inFlightHandlers: number;
  receivedTotal: number;
  ackedTotal: number;
  nackedTotal: number;
  forwardFailuresTotal: number;
  subscriberErrorsTotal: number;
  lastActivityAt: string | null;
  lastErrorAt: string | null;
}

interface PubSubSnapshotFixture {
  capture: LogicalCaptureFixture;
  surfaceIdentity: SurfaceIdentityFixture;
  status: string;
  drainContractVersion: number;
  drain: PubSubDrainFixture;
}

interface OrchestratorDrainFixture {
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

interface OrchestratorSnapshotFixture {
  capture: LogicalCaptureFixture;
  healthContractVersion: number;
  surfaceIdentity: SurfaceIdentityFixture;
  status: string;
  dockerHealthy: boolean;
  diskHealthy: boolean;
  running: number;
  workerContainers: number;
  pendingTerminalCallbacks: number;
  terminalCallbackActivityTotal: number;
  logForwarderDrain: OrchestratorDrainFixture;
}

interface OwnershipSnapshotFixture {
  capture: LogicalCaptureFixture;
  observationReceiptId: string;
  nonzeroCount: number;
  unknownCount: number;
  collections: Record<
    | 'codeTasks'
    | 'sessions'
    | 'testRuns'
    | 'runContexts'
    | 'leases'
    | 'ingestOutbox'
    | 'terminalControlOutbox',
    { nonzero: number; unknown: number }
  >;
}

interface DrainBoundaryFixture {
  completedAt: string;
  pubsub: PubSubSnapshotFixture;
  orchestrator: OrchestratorSnapshotFixture;
}

interface OwnedDrainBoundaryFixture extends DrainBoundaryFixture {
  ownership: OwnershipSnapshotFixture;
}

interface DrainSequenceFixture {
  contractVersion: number;
  requiredQuietIntervalMs: number;
  topologyFreshnessMs: number;
  witness: DrainBoundaryFixture;
  anchor: OwnedDrainBoundaryFixture;
  read1: OwnedDrainBoundaryFixture;
  read2: OwnedDrainBoundaryFixture;
}

const LISTENER_MULTIPLICITY: ListenerMultiplicityFixture[] = [
  {
    projectId: 'a',
    topicName: 'a',
    subscriptionName: 'a',
    classification: 'forwarded',
    listeners: 1,
  },
  {
    projectId: 'b',
    topicName: 'b',
    subscriptionName: 'b',
    classification: 'monitor-only',
    listeners: 1,
  },
  {
    projectId: 'c',
    topicName: 'legacy-c',
    subscriptionName: 'legacy-c',
    classification: 'preservedLegacy',
    listeners: 0,
  },
];
const TARGET_LISTENER_MULTIPLICITY = LISTENER_MULTIPLICITY.filter(
  ({ classification }) => classification !== 'preservedLegacy'
);
const PRESERVED_LEGACY_LISTENER_MULTIPLICITY = LISTENER_MULTIPLICITY.filter(
  ({ classification }) => classification === 'preservedLegacy'
);
const EXPECTED_HASH = canonicalTopologyHash(TARGET_LISTENER_MULTIPLICITY);
const EXPECTED_OBSERVED_HASH = canonicalTopologyHash(LISTENER_MULTIPLICITY);
const PRESERVED_LEGACY_HASH = canonicalTopologyHash(PRESERVED_LEGACY_LISTENER_MULTIPLICITY);
const EPOCH_PUBSUB = '00112233445566778899aabbccddeeff';
const EPOCH_ORCHESTRATOR = 'ffeeddccbbaa99887766554433221100';
const COLLECTOR_RUN_ID = '1234567890abcdef1234567890abcdef';
const SOURCE_REVISION = '4247a873403b952de191bf8a8001d5c950a6094b';

function logicalCapture(
  surface: CaptureSurfaceFixture,
  phase: CapturePhaseFixture,
  sequence: number,
  completedMonotonicMs: number,
  receivedAt: string,
  durationMs = 5
): LogicalCaptureFixture {
  return {
    collectorRunId: COLLECTOR_RUN_ID,
    surface,
    phase,
    sequence,
    receiptId: createHash('sha256')
      .update(`${surface}:${phase}:${String(sequence)}`)
      .digest('hex'),
    startedMonotonicNs: String(BigInt(completedMonotonicMs - durationMs) * 1_000_000n),
    completedMonotonicNs: String(BigInt(completedMonotonicMs) * 1_000_000n),
    receivedAt,
  };
}

function pubsubSnapshot(
  capturedAt: string,
  capture: LogicalCaptureFixture,
  overrides: Partial<PubSubDrainFixture> = {}
): PubSubSnapshotFixture {
  return {
    capture,
    surfaceIdentity: {
      kind: 'container-process',
      instanceIdHash: 'c'.repeat(64),
      endpointIdSha256: 'd'.repeat(64),
      sourceRevision: SOURCE_REVISION,
    },
    status: 'ok',
    drainContractVersion: 2,
    drain: {
      counterEpochId: EPOCH_PUBSUB,
      processStartedAt: '2026-08-28T09:00:00.000Z',
      expectedTopologyHash: EXPECTED_HASH,
      expectedObservedTopologyHash: EXPECTED_OBSERVED_HASH,
      preservedLegacyTopologyHash: PRESERVED_LEGACY_HASH,
      observedTopologyHash: EXPECTED_OBSERVED_HASH,
      topologyObservedAt: capturedAt,
      topologyObservationSequence: capture.sequence,
      topologyRefreshErrorsTotal: 0,
      topologyMatch: true,
      activeListenerTopologyHash: EXPECTED_HASH,
      subscriptionCounts: {
        expected: 3,
        observed: 3,
        classified: 3,
        unclassified: 0,
        missing: 0,
        unexpected: 0,
        orphaned: 0,
        listenerless: 0,
        duplicateListeners: 0,
        duplicateSubscriptions: 0,
        targetExpected: 2,
        targetObserved: 2,
        preservedLegacyExpected: 1,
        preservedLegacyObserved: 1,
        missingTarget: 0,
        missingPreservedLegacy: 0,
        preservedLegacyListeners: 0,
      },
      classificationCounts: { forwarded: 1, 'monitor-only': 1, preservedLegacy: 1 },
      listenerMultiplicity: LISTENER_MULTIPLICITY.map((entry) => ({ ...entry })),
      activeListeners: 2,
      setupErrors: 0,
      inFlightHandlers: 0,
      receivedTotal: 10,
      ackedTotal: 8,
      nackedTotal: 2,
      forwardFailuresTotal: 2,
      subscriberErrorsTotal: 0,
      lastActivityAt: '2026-08-28T09:30:00.000Z',
      lastErrorAt: '2026-08-28T09:30:00.000Z',
      ...overrides,
    },
  };
}

function orchestratorSnapshot(
  capture: LogicalCaptureFixture,
  overrides: Partial<OrchestratorDrainFixture> = {}
): OrchestratorSnapshotFixture {
  return {
    capture,
    healthContractVersion: 2,
    surfaceIdentity: {
      kind: 'process',
      instanceIdHash: 'b'.repeat(64),
      endpointIdSha256: 'e'.repeat(64),
      sourceRevision: SOURCE_REVISION,
    },
    status: 'ready',
    dockerHealthy: true,
    diskHealthy: true,
    running: 0,
    workerContainers: 0,
    pendingTerminalCallbacks: 0,
    terminalCallbackActivityTotal: 11,
    logForwarderDrain: {
      counterEpochId: EPOCH_ORCHESTRATOR,
      processStartedAt: '2026-08-28T09:00:00.000Z',
      activeForwarders: 0,
      bufferedBytes: 0,
      partialLineBytes: 0,
      queuedChunks: 0,
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
      openUploadRequests: 0,
      detachedUploadRetryPromises: 0,
      droppedChunksTotal: 1,
      forwarderActivityTotal: 20,
      lastActivityAt: '2026-08-28T09:30:00.000Z',
      ...overrides,
    },
  };
}

function ownershipSnapshot(
  capture: LogicalCaptureFixture,
  overrides: Partial<OwnershipSnapshotFixture> = {}
): OwnershipSnapshotFixture {
  return {
    capture,
    observationReceiptId: createHash('sha256')
      .update(`ownership-observation:${capture.phase}:${String(capture.sequence)}`)
      .digest('hex'),
    nonzeroCount: 0,
    unknownCount: 0,
    collections: {
      codeTasks: { nonzero: 0, unknown: 0 },
      sessions: { nonzero: 0, unknown: 0 },
      testRuns: { nonzero: 0, unknown: 0 },
      runContexts: { nonzero: 0, unknown: 0 },
      leases: { nonzero: 0, unknown: 0 },
      ingestOutbox: { nonzero: 0, unknown: 0 },
      terminalControlOutbox: { nonzero: 0, unknown: 0 },
    },
    ...overrides,
  };
}

function sequence(): DrainSequenceFixture {
  const witnessAt = '2026-08-28T10:00:00.000Z';
  const anchorAt = '2026-08-28T10:00:01.000Z';
  const read1At = '2026-08-28T10:10:01.000Z';
  const read2At = '2026-08-28T10:20:01.000Z';
  return {
    contractVersion: 1,
    requiredQuietIntervalMs: 600_000,
    topologyFreshnessMs: 30_000,
    witness: {
      completedAt: witnessAt,
      pubsub: pubsubSnapshot(witnessAt, logicalCapture('pubsub', 'witness', 1, 1_000, witnessAt)),
      orchestrator: orchestratorSnapshot(
        logicalCapture('orchestrator', 'witness', 1, 1_010, witnessAt)
      ),
    },
    anchor: {
      completedAt: anchorAt,
      pubsub: pubsubSnapshot(anchorAt, logicalCapture('pubsub', 'anchor', 2, 2_000, anchorAt)),
      orchestrator: orchestratorSnapshot(
        logicalCapture('orchestrator', 'anchor', 2, 2_010, anchorAt)
      ),
      ownership: ownershipSnapshot(logicalCapture('ownership', 'anchor', 1, 2_020, anchorAt)),
    },
    read1: {
      completedAt: read1At,
      pubsub: pubsubSnapshot(read1At, logicalCapture('pubsub', 'read1', 3, 602_000, read1At)),
      orchestrator: orchestratorSnapshot(
        logicalCapture('orchestrator', 'read1', 3, 602_010, read1At)
      ),
      ownership: ownershipSnapshot(logicalCapture('ownership', 'read1', 2, 602_020, read1At)),
    },
    read2: {
      completedAt: read2At,
      pubsub: pubsubSnapshot(read2At, logicalCapture('pubsub', 'read2', 4, 1_202_000, read2At)),
      orchestrator: orchestratorSnapshot(
        logicalCapture('orchestrator', 'read2', 4, 1_202_010, read2At)
      ),
      ownership: ownershipSnapshot(logicalCapture('ownership', 'read2', 3, 1_202_020, read2At)),
    },
  };
}

function verify(input: DrainSequenceFixture = sequence()): ReturnType<typeof verifyDevDrain> {
  return verifyDevDrain(input);
}

function requireListener(input: DrainSequenceFixture, index: number): ListenerMultiplicityFixture {
  const listener = input.read2.pubsub.drain.listenerMultiplicity[index];
  if (listener === undefined) throw new Error(`missing listener fixture at index ${String(index)}`);
  return listener;
}

describe('DEV hibernation drain verifier', () => {
  it('is the only component that emits zero for a stable complete quiet sequence', () => {
    expect(verify()).toEqual({ pendingStatus: 'zero', reasons: [] });
  });

  it('compares process identities semantically rather than by JSON key insertion order', () => {
    const input = sequence();
    input.read2.pubsub.surfaceIdentity = {
      instanceIdHash: 'c'.repeat(64),
      kind: 'container-process',
      endpointIdSha256: 'd'.repeat(64),
      sourceRevision: SOURCE_REVISION,
    };
    expect(verify(input)).toEqual({ pendingStatus: 'zero', reasons: [] });
  });

  it('requires endpoint and source-revision bindings to remain continuous', () => {
    const endpointChanged = sequence();
    endpointChanged.read2.pubsub.surfaceIdentity.endpointIdSha256 = 'f'.repeat(64);
    expect(verify(endpointChanged).pendingStatus).toBe('unknown');

    const revisionChanged = sequence();
    revisionChanged.read2.orchestrator.surfaceIdentity.sourceRevision = 'a'.repeat(40);
    expect(verify(revisionChanged).pendingStatus).toBe('unknown');
  });

  it.each([
    ['buffered', 'bufferedBytes', 1],
    ['partial line', 'partialLineBytes', 1],
    ['queued', 'queuedChunks', 1],
    ['upload in flight', 'inFlightBatches', 1],
    ['chunk in flight', 'inFlightChunks', 1],
    ['retrying flush', 'activeFlushOperations', 1],
    ['active forwarder', 'activeForwarders', 1],
    ['open upload request', 'openUploadRequests', 1],
    ['detached upload retry promise', 'detachedUploadRetryPromises', 1],
  ])('never emits zero for %s work', (_name, field, value) => {
    const input = sequence();
    Object.assign(input.read2.orchestrator.logForwarderDrain, { [field]: value });
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it.each([
    ['worker container', 'workerContainers'],
    ['pending terminal callback', 'pendingTerminalCallbacks'],
  ])('never emits zero for a live %s', (_name, field) => {
    const input = sequence();
    Object.assign(input.read2.orchestrator, { [field]: 1 });
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('detects terminal callback activity and fails closed if its process counter resets', () => {
    const advanced = sequence();
    advanced.read2.orchestrator.terminalCallbackActivityTotal += 1;
    expect(verify(advanced).pendingStatus).toBe('nonzero');

    const reset = sequence();
    reset.read2.orchestrator.terminalCallbackActivityTotal -= 1;
    expect(verify(reset).pendingStatus).toBe('unknown');
  });

  it.each([
    ['Pub/Sub status', { surface: 'pubsub', patch: { status: 'degraded' } }],
    ['orchestrator status', { status: 'starting' }],
    ['Docker health', { dockerHealthy: false }],
    ['disk health', { diskHealthy: false }],
  ])('fails closed for unhealthy %s evidence', (_name, scenario) => {
    const input = sequence();
    if ('surface' in scenario) Object.assign(input.read2.pubsub, scenario.patch);
    else Object.assign(input.read2.orchestrator, scenario);
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed when newly required orchestrator ownership evidence is absent or null', () => {
    const absent = sequence();
    delete (absent.read2.orchestrator as Partial<OrchestratorSnapshotFixture>).workerContainers;
    expect(verify(absent).pendingStatus).toBe('unknown');

    const nullable = sequence();
    Object.assign(nullable.read2.orchestrator.logForwarderDrain, { openUploadRequests: null });
    expect(verify(nullable).pendingStatus).toBe('unknown');

    const callbackUnknown = sequence();
    Object.assign(callbackUnknown.read2.orchestrator, { pendingTerminalCallbacks: null });
    expect(verify(callbackUnknown).pendingStatus).toBe('unknown');

    const callbackCounterUnknown = sequence();
    Object.assign(callbackCounterUnknown.read2.orchestrator, {
      terminalCallbackActivityTotal: null,
    });
    expect(verify(callbackCounterUnknown).pendingStatus).toBe('unknown');
  });

  it('never emits zero for a message handler in flight', () => {
    const input = sequence();
    input.read2.pubsub.drain.receivedTotal += 1;
    input.read2.pubsub.drain.inFlightHandlers = 1;
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('fails closed for a stable unaccounted delivery handoff gap', () => {
    const input = sequence();
    for (const boundary of [input.witness, input.anchor, input.read1, input.read2]) {
      boundary.pubsub.drain.receivedTotal += 1;
    }
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it.each([
    ['successful ack', 'ackedTotal'],
    ['nack', 'nackedTotal'],
    ['forward failure', 'forwardFailuresTotal'],
    ['subscriber error', 'subscriberErrorsTotal'],
    ['message receive', 'receivedTotal'],
  ])('detects %s completed between snapshots', (_name, counter) => {
    const input = sequence();
    if (counter === 'ackedTotal' || counter === 'nackedTotal') {
      input.read2.pubsub.drain.receivedTotal += 1;
    }
    if (counter === 'receivedTotal') {
      input.read2.pubsub.drain.ackedTotal += 1;
    }
    Object.assign(input.read2.pubsub.drain, {
      [counter]:
        Number(input.read2.pubsub.drain[counter as keyof typeof input.read2.pubsub.drain]) + 1,
    });
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('detects transient forwarder activity completed between same-tick snapshots', () => {
    const input = sequence();
    input.read2.orchestrator.logForwarderDrain.forwarderActivityTotal += 2;
    input.read2.orchestrator.logForwarderDrain.lastActivityAt =
      input.read1.orchestrator.logForwarderDrain.lastActivityAt;
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('detects a failed upload even after the forwarder closes', () => {
    const input = sequence();
    input.read2.orchestrator.logForwarderDrain.droppedChunksTotal += 1;
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it.each([
    [
      'process restart',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.orchestrator.surfaceIdentity.instanceIdHash = 'd'.repeat(64);
        return input;
      },
    ],
    [
      'Pub/Sub process restart',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.surfaceIdentity.instanceIdHash = 'd'.repeat(64);
        input.read2.pubsub.drain.counterEpochId = 'f'.repeat(32);
        input.read2.pubsub.drain.processStartedAt = '2026-08-28T10:19:00.000Z';
        return input;
      },
    ],
    [
      'counter epoch mismatch',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.counterEpochId = 'f'.repeat(32);
        return input;
      },
    ],
    [
      'expected topology change',
      (): DrainSequenceFixture => {
        const input = sequence();
        const replacementHash = 'f'.repeat(64);
        input.read2.pubsub.drain.expectedTopologyHash = replacementHash;
        input.read2.pubsub.drain.observedTopologyHash = replacementHash;
        input.read2.pubsub.drain.activeListenerTopologyHash = replacementHash;
        return input;
      },
    ],
    [
      'counter reset',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.receivedTotal = 9;
        return input;
      },
    ],
    [
      'same-surface topology timestamp before process start',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.topologyObservedAt = '2026-08-28T08:59:59.999Z';
        return input;
      },
    ],
    [
      'same-surface topology timestamp regression',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.topologyObservedAt = '2026-08-28T10:10:00.999Z';
        return input;
      },
    ],
    [
      'duplicate listener',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.subscriptionCounts.duplicateListeners = 1;
        requireListener(input, 0).listeners = 2;
        return input;
      },
    ],
    [
      'duplicate observed subscription',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.subscriptionCounts.duplicateSubscriptions = 1;
        return input;
      },
    ],
    [
      'listener startup failure',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.setupErrors = 1;
        return input;
      },
    ],
    [
      'incomplete topology',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.pubsub.drain.topologyMatch = false;
        return input;
      },
    ],
    [
      'unknown durable work',
      (): DrainSequenceFixture => {
        const input = sequence();
        input.read2.ownership.unknownCount = 1;
        input.read2.ownership.collections.leases.unknown = 1;
        return input;
      },
    ],
  ])('returns unknown for %s', (_name, build) => {
    expect(verify(build()).pendingStatus).toBe('unknown');
  });

  it('returns nonzero for authoritative active work', () => {
    const input = sequence();
    input.read2.ownership.nonzeroCount = 1;
    input.read2.ownership.collections.codeTasks.nonzero = 1;
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('recomputes the listener tuple hash instead of trusting supplied hashes', () => {
    const input = sequence();
    requireListener(input, 0).topicName = 'tampered';
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('cross-checks listener classifications against aggregate classification counts', () => {
    const input = sequence();
    requireListener(input, 1).classification = 'forwarded';
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('rejects activity between witness and anchor', () => {
    const input = sequence();
    input.anchor.pubsub.drain.receivedTotal += 1;
    input.anchor.pubsub.drain.ackedTotal += 1;
    input.read1.pubsub.drain.receivedTotal += 1;
    input.read1.pubsub.drain.ackedTotal += 1;
    input.read2.pubsub.drain.receivedTotal += 1;
    input.read2.pubsub.drain.ackedTotal += 1;
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('requires both full quiet intervals', () => {
    const input = sequence();
    input.read1.pubsub.capture.completedMonotonicNs = String(601_999n * 1_000_000n);
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('requires the collector-wide signed capture order, not only per-surface order', () => {
    const input = sequence();
    input.anchor.orchestrator.capture.startedMonotonicNs = String(1_990n * 1_000_000n);
    input.anchor.orchestrator.capture.completedMonotonicNs = String(1_995n * 1_000_000n);
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('independently requires the full second quiet interval', () => {
    const input = sequence();
    input.read2.orchestrator.capture.completedMonotonicNs = String(1_202_009n * 1_000_000n);
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('does not compare operator wall-clock telemetry across surface clocks', () => {
    const input = sequence();
    input.witness.completedAt = '2040-01-01T00:00:00.000Z';
    input.anchor.completedAt = '2020-01-01T00:00:00.000Z';
    input.read1.pubsub.capture.receivedAt = '2010-01-01T00:00:00.000Z';
    for (const boundary of [input.witness, input.anchor, input.read1, input.read2]) {
      boundary.pubsub.drain.processStartedAt = '2050-01-01T00:00:00.000Z';
      boundary.pubsub.drain.topologyObservedAt = '2050-01-01T01:00:00.000Z';
      boundary.pubsub.drain.lastActivityAt = '2050-01-01T00:30:00.000Z';
      boundary.pubsub.drain.lastErrorAt = '2050-01-01T00:30:00.000Z';
      boundary.orchestrator.logForwarderDrain.processStartedAt = '2060-01-01T00:00:00.000Z';
      boundary.orchestrator.logForwarderDrain.lastActivityAt = '2060-01-01T00:30:00.000Z';
    }
    expect(verify(input)).toEqual({ pendingStatus: 'zero', reasons: [] });
  });

  it('rejects a surface capture that exceeds the configured freshness window', () => {
    const input = sequence();
    input.read2.pubsub.capture.startedMonotonicNs = String(1_171_999n * 1_000_000n);
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('rejects an authoritative ownership capture that exceeds the freshness window', () => {
    const input = sequence();
    input.read2.ownership.capture.startedMonotonicNs = String(1_171_000n * 1_000_000n);
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('rejects activity timestamps before the same-surface process start', () => {
    const input = sequence();
    for (const boundary of [input.witness, input.anchor, input.read1, input.read2]) {
      boundary.pubsub.drain.lastActivityAt = '2026-08-28T08:59:59.999Z';
    }
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('cannot emit zero when read1 signed-capture inputs are reused as read2', () => {
    const input = sequence();
    input.topologyFreshnessMs = Number.MAX_SAFE_INTEGER;
    input.read2.completedAt = '2099-01-01T00:00:00.000Z';
    input.read2.pubsub = structuredClone(input.read1.pubsub);
    input.read2.orchestrator = structuredClone(input.read1.orchestrator);
    input.read2.ownership = structuredClone(input.read1.ownership);

    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('cannot emit zero when Pub/Sub returns a reused topology observation in a fresh receipt', () => {
    const input = sequence();
    input.topologyFreshnessMs = Number.MAX_SAFE_INTEGER;
    input.read2.pubsub.drain.topologyObservationSequence =
      input.read1.pubsub.drain.topologyObservationSequence;
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed when lastErrorAt exists without lastActivityAt', () => {
    const input = sequence();
    input.read2.pubsub.drain.lastActivityAt = null;
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed when lastErrorAt is after same-surface lastActivityAt', () => {
    const input = sequence();
    input.read2.pubsub.drain.lastErrorAt = '2026-08-28T09:30:00.001Z';
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed when Pub/Sub counters have activity without lastActivityAt', () => {
    const input = sequence();
    for (const boundary of [input.witness, input.anchor, input.read1, input.read2]) {
      boundary.pubsub.drain.lastActivityAt = null;
      boundary.pubsub.drain.lastErrorAt = null;
    }
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed when Pub/Sub failure counters have no lastErrorAt', () => {
    const input = sequence();
    for (const boundary of [input.witness, input.anchor, input.read1, input.read2]) {
      boundary.pubsub.drain.lastErrorAt = null;
    }
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed when orchestrator activity counters have no lastActivityAt', () => {
    const input = sequence();
    for (const boundary of [input.witness, input.anchor, input.read1, input.read2]) {
      boundary.orchestrator.logForwarderDrain.lastActivityAt = null;
    }
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed when lastErrorAt regresses or clears within one process', () => {
    const regressed = sequence();
    regressed.read2.pubsub.drain.lastErrorAt = '2026-08-28T09:29:59.999Z';
    expect(verify(regressed).pendingStatus).toBe('unknown');

    const cleared = sequence();
    cleared.read2.pubsub.drain.forwardFailuresTotal = 0;
    cleared.read2.pubsub.drain.lastErrorAt = null;
    expect(verify(cleared).pendingStatus).toBe('unknown');
  });

  it('detects lastErrorAt advancing while counters and lastActivityAt stay stable', () => {
    const input = sequence();
    for (const boundary of [input.witness, input.anchor, input.read1, input.read2]) {
      boundary.pubsub.drain.lastActivityAt = '2026-08-28T09:45:00.000Z';
    }
    input.read2.pubsub.drain.lastErrorAt = '2026-08-28T09:40:00.000Z';
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('detects a same-tick topology refresh error hidden by a later successful read', () => {
    const input = sequence();
    input.read1.pubsub.drain.topologyRefreshErrorsTotal = 1;
    input.read2.pubsub.drain.topologyRefreshErrorsTotal = 1;

    expect(input.anchor.pubsub.drain.lastErrorAt).toBe(input.read1.pubsub.drain.lastErrorAt);
    expect(verify(input).pendingStatus).toBe('nonzero');
  });

  it('fails closed for malformed or privacy-hostile snapshots', () => {
    const input = sequence() as ReturnType<typeof sequence> & { payload?: string };
    input.payload = 'must-not-exist';
    expect(verify(input).pendingStatus).toBe('unknown');
  });

  it('fails closed for a privacy-hostile nested drain field', () => {
    const input = sequence();
    const listener = requireListener(input, 0) as ListenerMultiplicityFixture & {
      payload?: string;
    };
    listener.payload = 'must-not-exist';
    expect(verify(input).pendingStatus).toBe('unknown');
  });
});
