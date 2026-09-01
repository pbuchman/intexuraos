import { createHash } from 'node:crypto';
import { canonicalTopologyHash } from '../../tools/pubsub-ui/pubsub-drain.mjs';
import {
  assembleDevDrainVerifierInput,
  verifyDevDrainArtifactSignature,
} from './dev-hibernation-drain-collector.mjs';

const PUBSUB_COUNTERS = [
  'receivedTotal',
  'ackedTotal',
  'nackedTotal',
  'forwardFailuresTotal',
  'subscriberErrorsTotal',
  'topologyRefreshErrorsTotal',
];

const ORCHESTRATOR_DRAIN_COUNTERS = ['droppedChunksTotal', 'forwarderActivityTotal'];
const ORCHESTRATOR_COUNTERS = [...ORCHESTRATOR_DRAIN_COUNTERS, 'terminalCallbackActivityTotal'];
const ORCHESTRATOR_GAUGES = [
  'activeForwarders',
  'bufferedBytes',
  'partialLineBytes',
  'queuedChunks',
  'inFlightBatches',
  'inFlightChunks',
  'activeFlushOperations',
  'openUploadRequests',
  'detachedUploadRetryPromises',
];

const OWNERSHIP_COLLECTIONS = [
  'codeTasks',
  'sessions',
  'testRuns',
  'runContexts',
  'leases',
  'ingestOutbox',
  'terminalControlOutbox',
];

const CAPTURE_PHASES = ['witness', 'anchor', 'read1', 'read2'];
const CAPTURE_SURFACES = ['pubsub', 'orchestrator', 'ownership'];
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
export const MAX_DEV_DRAIN_ARTIFACT_AGE_MS = 15 * 60 * 1_000;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, expected, path, unknown) {
  if (!isRecord(value)) {
    unknown.push(`${path}:not-object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    unknown.push(`${path}:schema`);
    return false;
  }
  return true;
}

function safeCount(value, path, unknown) {
  if (!Number.isSafeInteger(value) || value < 0) {
    unknown.push(`${path}:count`);
    return null;
  }
  return value;
}

function instant(value, path, unknown) {
  if (typeof value !== 'string') {
    unknown.push(`${path}:timestamp`);
    return null;
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    unknown.push(`${path}:timestamp`);
    return null;
  }
  return millis;
}

function nullableInstant(value, path, unknown) {
  return value === null ? null : instant(value, path, unknown);
}

function digest(value, path, unknown, length = 64) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${String(length)}}$`, 'u').test(value)) {
    unknown.push(`${path}:digest`);
    return null;
  }
  return value;
}

function parseIdentity(value, path, expectedKind, unknown) {
  if (
    !exactKeys(
      value,
      ['instanceIdHash', 'kind', 'endpointIdSha256', 'sourceRevision'],
      path,
      unknown
    )
  ) {
    return null;
  }
  if (value.kind !== expectedKind) {
    unknown.push(`${path}:kind`);
  }
  digest(value.instanceIdHash, `${path}.instanceIdHash`, unknown);
  digest(value.endpointIdSha256, `${path}.endpointIdSha256`, unknown);
  if (
    typeof value.sourceRevision !== 'string' ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.sourceRevision)
  ) {
    unknown.push(`${path}.sourceRevision`);
  }
  return JSON.stringify([
    value.kind,
    value.instanceIdHash,
    value.endpointIdSha256,
    value.sourceRevision,
  ]);
}

function monotonicInstant(value, path, unknown) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    unknown.push(`${path}:monotonic`);
    return null;
  }
  return BigInt(value);
}

function parseCapture(value, path, expectedSurface, expectedPhase, freshnessMs, unknown) {
  const keys = [
    'collectorRunId',
    'surface',
    'phase',
    'sequence',
    'receiptId',
    'startedMonotonicNs',
    'completedMonotonicNs',
    'receivedAt',
  ];
  if (!exactKeys(value, keys, path, unknown)) return null;
  digest(value.collectorRunId, `${path}.collectorRunId`, unknown, 32);
  digest(value.receiptId, `${path}.receiptId`, unknown);
  if (!CAPTURE_SURFACES.includes(value.surface) || value.surface !== expectedSurface) {
    unknown.push(`${path}.surface`);
  }
  if (!CAPTURE_PHASES.includes(value.phase) || value.phase !== expectedPhase) {
    unknown.push(`${path}.phase`);
  }
  const sequence = safeCount(value.sequence, `${path}.sequence`, unknown);
  if (sequence === 0) unknown.push(`${path}.sequence:zero`);
  const startedMonotonicNs = monotonicInstant(
    value.startedMonotonicNs,
    `${path}.startedMonotonicNs`,
    unknown
  );
  const completedMonotonicNs = monotonicInstant(
    value.completedMonotonicNs,
    `${path}.completedMonotonicNs`,
    unknown
  );
  instant(value.receivedAt, `${path}.receivedAt`, unknown);
  if (
    startedMonotonicNs !== null &&
    completedMonotonicNs !== null &&
    completedMonotonicNs <= startedMonotonicNs
  ) {
    unknown.push(`${path}:non-positive-duration`);
  }
  if (
    startedMonotonicNs !== null &&
    completedMonotonicNs !== null &&
    freshnessMs !== null &&
    completedMonotonicNs - startedMonotonicNs > BigInt(freshnessMs) * NANOSECONDS_PER_MILLISECOND
  ) {
    unknown.push(`${path}:freshness`);
  }
  return {
    collectorRunId: value.collectorRunId,
    surface: value.surface,
    phase: value.phase,
    sequence,
    receiptId: value.receiptId,
    startedMonotonicNs,
    completedMonotonicNs,
  };
}

function parsePubSubSnapshot(value, path, phase, topologyFreshnessMs, unknown, nonzero) {
  if (
    !exactKeys(
      value,
      ['capture', 'surfaceIdentity', 'status', 'drainContractVersion', 'drain'],
      path,
      unknown
    )
  ) {
    return null;
  }
  const capture = parseCapture(
    value.capture,
    `${path}.capture`,
    'pubsub',
    phase,
    topologyFreshnessMs,
    unknown
  );
  const surfaceIdentity = parseIdentity(
    value.surfaceIdentity,
    `${path}.surfaceIdentity`,
    'container-process',
    unknown
  );
  if (value.status !== 'ok') unknown.push(`${path}.status`);
  if (value.drainContractVersion !== 2) unknown.push(`${path}.drainContractVersion`);
  const drain = value.drain;
  const drainKeys = [
    'counterEpochId',
    'processStartedAt',
    'expectedTopologyHash',
    'expectedObservedTopologyHash',
    'preservedLegacyTopologyHash',
    'observedTopologyHash',
    'topologyObservedAt',
    'topologyObservationSequence',
    'topologyMatch',
    'activeListenerTopologyHash',
    'subscriptionCounts',
    'classificationCounts',
    'listenerMultiplicity',
    'activeListeners',
    'setupErrors',
    'inFlightHandlers',
    ...PUBSUB_COUNTERS,
    'lastActivityAt',
    'lastErrorAt',
  ];
  if (!exactKeys(drain, drainKeys, `${path}.drain`, unknown)) return null;

  digest(drain.counterEpochId, `${path}.drain.counterEpochId`, unknown, 32);
  const processStartedAt = instant(
    drain.processStartedAt,
    `${path}.drain.processStartedAt`,
    unknown
  );
  const expectedHash = digest(
    drain.expectedTopologyHash,
    `${path}.drain.expectedTopologyHash`,
    unknown
  );
  const expectedObservedHash = digest(
    drain.expectedObservedTopologyHash,
    `${path}.drain.expectedObservedTopologyHash`,
    unknown
  );
  const preservedLegacyHash = digest(
    drain.preservedLegacyTopologyHash,
    `${path}.drain.preservedLegacyTopologyHash`,
    unknown
  );
  const observedHash = digest(
    drain.observedTopologyHash,
    `${path}.drain.observedTopologyHash`,
    unknown
  );
  const listenerHash = digest(
    drain.activeListenerTopologyHash,
    `${path}.drain.activeListenerTopologyHash`,
    unknown
  );
  const topologyObservedAt = instant(
    drain.topologyObservedAt,
    `${path}.drain.topologyObservedAt`,
    unknown
  );
  const topologyObservationSequence = safeCount(
    drain.topologyObservationSequence,
    `${path}.drain.topologyObservationSequence`,
    unknown
  );
  if (topologyObservationSequence === 0) {
    unknown.push(`${path}.drain.topologyObservationSequence:zero`);
  }
  if (drain.topologyMatch !== true) unknown.push(`${path}.drain.topologyMatch`);
  if (
    expectedHash !== null &&
    expectedObservedHash !== null &&
    (expectedHash !== listenerHash || expectedObservedHash !== observedHash)
  ) {
    unknown.push(`${path}.drain.topologyHashes`);
  }
  if (
    topologyObservedAt !== null &&
    processStartedAt !== null &&
    topologyObservedAt < processStartedAt
  ) {
    unknown.push(`${path}.drain.topologyObservedAt:before-process`);
  }

  const countKeys = [
    'expected',
    'observed',
    'classified',
    'unclassified',
    'missing',
    'unexpected',
    'orphaned',
    'listenerless',
    'duplicateListeners',
    'duplicateSubscriptions',
    'targetExpected',
    'targetObserved',
    'preservedLegacyExpected',
    'preservedLegacyObserved',
    'missingTarget',
    'missingPreservedLegacy',
    'preservedLegacyListeners',
  ];
  const counts = drain.subscriptionCounts;
  if (exactKeys(counts, countKeys, `${path}.drain.subscriptionCounts`, unknown)) {
    for (const key of countKeys)
      safeCount(counts[key], `${path}.drain.subscriptionCounts.${key}`, unknown);
    if (
      counts.expected !== counts.observed ||
      counts.observed !== counts.classified ||
      counts.unclassified !== 0 ||
      counts.missing !== 0 ||
      counts.unexpected !== 0 ||
      counts.orphaned !== 0 ||
      counts.listenerless !== 0 ||
      counts.duplicateListeners !== 0 ||
      counts.duplicateSubscriptions !== 0 ||
      counts.targetExpected !== counts.targetObserved ||
      counts.preservedLegacyExpected !== counts.preservedLegacyObserved ||
      counts.expected !== counts.targetExpected + counts.preservedLegacyExpected ||
      counts.missingTarget !== 0 ||
      counts.missingPreservedLegacy !== 0 ||
      counts.preservedLegacyListeners !== 0
    ) {
      unknown.push(`${path}.drain.subscriptionCoverage`);
    }
  }

  let parsedClassificationCounts = null;
  if (
    !exactKeys(
      drain.classificationCounts,
      ['forwarded', 'monitor-only', 'preservedLegacy'],
      `${path}.drain.classificationCounts`,
      unknown
    )
  ) {
    // exactKeys records the reason.
  } else {
    const forwarded = safeCount(
      drain.classificationCounts.forwarded,
      `${path}.drain.classificationCounts.forwarded`,
      unknown
    );
    const monitorOnly = safeCount(
      drain.classificationCounts['monitor-only'],
      `${path}.drain.classificationCounts.monitor-only`,
      unknown
    );
    const preservedLegacy = safeCount(
      drain.classificationCounts.preservedLegacy,
      `${path}.drain.classificationCounts.preservedLegacy`,
      unknown
    );
    if (
      forwarded !== null &&
      monitorOnly !== null &&
      preservedLegacy !== null &&
      isRecord(counts) &&
      forwarded + monitorOnly + preservedLegacy !== counts.observed
    ) {
      unknown.push(`${path}.drain.classificationCounts:total`);
    }
    if (forwarded !== null && monitorOnly !== null && preservedLegacy !== null) {
      parsedClassificationCounts = { forwarded, 'monitor-only': monitorOnly, preservedLegacy };
    }
  }

  if (!Array.isArray(drain.listenerMultiplicity) || drain.listenerMultiplicity.length === 0) {
    unknown.push(`${path}.drain.listenerMultiplicity`);
  } else {
    const seen = new Set();
    const listenerTuples = [];
    const listenerClassificationCounts = {
      forwarded: 0,
      'monitor-only': 0,
      preservedLegacy: 0,
    };
    let listenerTotal = 0;
    for (const [index, entry] of drain.listenerMultiplicity.entries()) {
      const entryPath = `${path}.drain.listenerMultiplicity[${String(index)}]`;
      if (
        !exactKeys(
          entry,
          ['projectId', 'topicName', 'subscriptionName', 'classification', 'listeners'],
          entryPath,
          unknown
        )
      ) {
        continue;
      }
      if (
        typeof entry.projectId !== 'string' ||
        entry.projectId.length === 0 ||
        typeof entry.topicName !== 'string' ||
        entry.topicName.length === 0 ||
        typeof entry.subscriptionName !== 'string' ||
        entry.subscriptionName.length === 0 ||
        (entry.classification !== 'forwarded' &&
          entry.classification !== 'monitor-only' &&
          entry.classification !== 'preservedLegacy')
      ) {
        unknown.push(`${entryPath}:classification`);
      }
      const key = JSON.stringify([entry.projectId, entry.topicName, entry.subscriptionName]);
      if (seen.has(key)) unknown.push(`${entryPath}:duplicate`);
      seen.add(key);
      listenerTuples.push(entry);
      if (entry.classification === 'forwarded') listenerClassificationCounts.forwarded += 1;
      if (entry.classification === 'monitor-only') {
        listenerClassificationCounts['monitor-only'] += 1;
      }
      if (entry.classification === 'preservedLegacy') {
        listenerClassificationCounts.preservedLegacy += 1;
      }
      const listeners = safeCount(entry.listeners, `${entryPath}.listeners`, unknown);
      const requiredListeners = entry.classification === 'preservedLegacy' ? 0 : 1;
      if (listeners !== requiredListeners) unknown.push(`${entryPath}.listeners:coverage`);
      if (listeners !== null) listenerTotal += listeners;
    }
    const activeListeners = safeCount(
      drain.activeListeners,
      `${path}.drain.activeListeners`,
      unknown
    );
    if (activeListeners !== null && activeListeners !== listenerTotal) {
      unknown.push(`${path}.drain.activeListeners:total`);
    }
    if (isRecord(counts) && seen.size !== counts.observed) {
      unknown.push(`${path}.drain.listenerMultiplicity:total`);
    }
    const targetListenerTuples = listenerTuples.filter(
      ({ classification }) => classification !== 'preservedLegacy'
    );
    const preservedLegacyTuples = listenerTuples.filter(
      ({ classification }) => classification === 'preservedLegacy'
    );
    if (
      expectedObservedHash !== null &&
      canonicalTopologyHash(listenerTuples) !== expectedObservedHash
    ) {
      unknown.push(`${path}.drain.listenerMultiplicity:hash`);
    }
    if (
      listenerHash !== null &&
      (canonicalTopologyHash(targetListenerTuples) !== listenerHash ||
        canonicalTopologyHash(targetListenerTuples) !== expectedHash)
    ) {
      unknown.push(`${path}.drain.listenerMultiplicity:active-hash`);
    }
    if (
      preservedLegacyHash !== null &&
      canonicalTopologyHash(preservedLegacyTuples) !== preservedLegacyHash
    ) {
      unknown.push(`${path}.drain.listenerMultiplicity:preserved-legacy-hash`);
    }
    if (
      parsedClassificationCounts !== null &&
      (listenerClassificationCounts.forwarded !== parsedClassificationCounts.forwarded ||
        listenerClassificationCounts['monitor-only'] !==
          parsedClassificationCounts['monitor-only'] ||
        listenerClassificationCounts.preservedLegacy !== parsedClassificationCounts.preservedLegacy)
    ) {
      unknown.push(`${path}.drain.listenerMultiplicity:classifications`);
    }
  }

  const setupErrors = safeCount(drain.setupErrors, `${path}.drain.setupErrors`, unknown);
  if (setupErrors !== 0) unknown.push(`${path}.drain.setupErrors:nonzero`);
  const inFlightHandlers = safeCount(
    drain.inFlightHandlers,
    `${path}.drain.inFlightHandlers`,
    unknown
  );
  if (inFlightHandlers !== null && inFlightHandlers > 0) {
    nonzero.push(`${path}.drain.inFlightHandlers`);
  }
  const parsedCounters = Object.fromEntries(
    PUBSUB_COUNTERS.map((counter) => [
      counter,
      safeCount(drain[counter], `${path}.drain.${counter}`, unknown),
    ])
  );
  const accountedDeliveries =
    parsedCounters.ackedTotal === null || parsedCounters.nackedTotal === null
      ? null
      : parsedCounters.ackedTotal + parsedCounters.nackedTotal;
  if (
    accountedDeliveries === null ||
    !Number.isSafeInteger(accountedDeliveries) ||
    parsedCounters.receivedTotal === null ||
    inFlightHandlers === null ||
    accountedDeliveries + inFlightHandlers !== parsedCounters.receivedTotal
  ) {
    unknown.push(`${path}.drain.deliveryCounters`);
  }
  const lastActivityAt = nullableInstant(
    drain.lastActivityAt,
    `${path}.drain.lastActivityAt`,
    unknown
  );
  const lastErrorAt = nullableInstant(drain.lastErrorAt, `${path}.drain.lastErrorAt`, unknown);
  if (
    Object.values(parsedCounters).some((count) => Number.isSafeInteger(count) && count > 0) &&
    lastActivityAt === null
  ) {
    unknown.push(`${path}.drain.lastActivityAt:missing-for-counters`);
  }
  if (
    ((Number.isSafeInteger(parsedCounters.forwardFailuresTotal) &&
      parsedCounters.forwardFailuresTotal > 0) ||
      (Number.isSafeInteger(parsedCounters.subscriberErrorsTotal) &&
        parsedCounters.subscriberErrorsTotal > 0) ||
      (Number.isSafeInteger(parsedCounters.topologyRefreshErrorsTotal) &&
        parsedCounters.topologyRefreshErrorsTotal > 0)) &&
    lastErrorAt === null
  ) {
    unknown.push(`${path}.drain.lastErrorAt:missing-for-errors`);
  }
  for (const [timestampName, timestamp] of [
    ['lastActivityAt', lastActivityAt],
    ['lastErrorAt', lastErrorAt],
  ]) {
    if (timestamp !== null && processStartedAt !== null && timestamp < processStartedAt) {
      unknown.push(`${path}.drain.${timestampName}:before-process`);
    }
  }
  if (lastErrorAt !== null && lastActivityAt === null) {
    unknown.push(`${path}.drain.lastErrorAt:missing-activity`);
  }
  if (lastErrorAt !== null && lastActivityAt !== null && lastErrorAt > lastActivityAt) {
    unknown.push(`${path}.drain.lastErrorAt:after-activity`);
  }

  return {
    capture,
    surfaceIdentity,
    epoch: drain.counterEpochId,
    processStartedAt: drain.processStartedAt,
    expectedTopologyHash: drain.expectedTopologyHash,
    expectedObservedTopologyHash: drain.expectedObservedTopologyHash,
    preservedLegacyTopologyHash: drain.preservedLegacyTopologyHash,
    topologyObservationSequence,
    counters: Object.fromEntries(PUBSUB_COUNTERS.map((name) => [name, drain[name]])),
    topologyObservedAt: drain.topologyObservedAt,
    lastActivityAt: drain.lastActivityAt,
    lastErrorAt: drain.lastErrorAt,
  };
}

function parseOrchestratorSnapshot(value, path, phase, topologyFreshnessMs, unknown, nonzero) {
  const keys = [
    'capture',
    'surfaceIdentity',
    'healthContractVersion',
    'status',
    'dockerHealthy',
    'diskHealthy',
    'running',
    'workerContainers',
    'pendingTerminalCallbacks',
    'terminalCallbackActivityTotal',
    'logForwarderDrain',
  ];
  if (!exactKeys(value, keys, path, unknown)) return null;
  const capture = parseCapture(
    value.capture,
    `${path}.capture`,
    'orchestrator',
    phase,
    topologyFreshnessMs,
    unknown
  );
  const surfaceIdentity = parseIdentity(
    value.surfaceIdentity,
    `${path}.surfaceIdentity`,
    'process',
    unknown
  );
  if (value.healthContractVersion !== 2) unknown.push(`${path}.healthContractVersion`);
  if (value.status !== 'ready') unknown.push(`${path}.status`);
  if (value.dockerHealthy !== true) unknown.push(`${path}.dockerHealthy`);
  if (value.diskHealthy !== true) unknown.push(`${path}.diskHealthy`);
  for (const field of ['running', 'workerContainers', 'pendingTerminalCallbacks']) {
    const count = safeCount(value[field], `${path}.${field}`, unknown);
    if (count !== null && count > 0) nonzero.push(`${path}.${field}`);
  }
  const terminalCallbackActivityTotal = safeCount(
    value.terminalCallbackActivityTotal,
    `${path}.terminalCallbackActivityTotal`,
    unknown
  );

  const drain = value.logForwarderDrain;
  const drainKeys = [
    'counterEpochId',
    'processStartedAt',
    ...ORCHESTRATOR_GAUGES,
    ...ORCHESTRATOR_DRAIN_COUNTERS,
    'lastActivityAt',
  ];
  if (!exactKeys(drain, drainKeys, `${path}.logForwarderDrain`, unknown)) return null;
  digest(drain.counterEpochId, `${path}.logForwarderDrain.counterEpochId`, unknown, 32);
  const processStartedAt = instant(
    drain.processStartedAt,
    `${path}.logForwarderDrain.processStartedAt`,
    unknown
  );
  for (const gauge of ORCHESTRATOR_GAUGES) {
    const count = safeCount(drain[gauge], `${path}.logForwarderDrain.${gauge}`, unknown);
    if (count !== null && count > 0) nonzero.push(`${path}.logForwarderDrain.${gauge}`);
  }
  const parsedCounters = Object.fromEntries(
    ORCHESTRATOR_DRAIN_COUNTERS.map((counter) => [
      counter,
      safeCount(drain[counter], `${path}.logForwarderDrain.${counter}`, unknown),
    ])
  );
  const lastActivityAt = nullableInstant(
    drain.lastActivityAt,
    `${path}.logForwarderDrain.lastActivityAt`,
    unknown
  );
  if (
    Object.values(parsedCounters).some((count) => Number.isSafeInteger(count) && count > 0) &&
    lastActivityAt === null
  ) {
    unknown.push(`${path}.logForwarderDrain.lastActivityAt:missing-for-counters`);
  }
  if (lastActivityAt !== null && processStartedAt !== null && lastActivityAt < processStartedAt) {
    unknown.push(`${path}.logForwarderDrain.lastActivityAt:before-process`);
  }

  return {
    capture,
    surfaceIdentity,
    epoch: drain.counterEpochId,
    processStartedAt: drain.processStartedAt,
    counters: {
      ...Object.fromEntries(ORCHESTRATOR_DRAIN_COUNTERS.map((name) => [name, drain[name]])),
      terminalCallbackActivityTotal,
    },
    lastActivityAt: drain.lastActivityAt,
  };
}

function parseOwnership(value, path, phase, topologyFreshnessMs, unknown, nonzero) {
  if (
    !exactKeys(
      value,
      ['capture', 'observationReceiptId', 'nonzeroCount', 'unknownCount', 'collections'],
      path,
      unknown
    )
  ) {
    return null;
  }
  const capture = parseCapture(
    value.capture,
    `${path}.capture`,
    'ownership',
    phase,
    topologyFreshnessMs,
    unknown
  );
  const observationReceiptId = digest(
    value.observationReceiptId,
    `${path}.observationReceiptId`,
    unknown
  );
  const nonzeroCount = safeCount(value.nonzeroCount, `${path}.nonzeroCount`, unknown);
  const unknownCount = safeCount(value.unknownCount, `${path}.unknownCount`, unknown);
  if (!exactKeys(value.collections, OWNERSHIP_COLLECTIONS, `${path}.collections`, unknown)) {
    return { capture, observationReceiptId };
  }
  let computedNonzero = 0;
  let computedUnknown = 0;
  for (const collection of OWNERSHIP_COLLECTIONS) {
    const entry = value.collections[collection];
    const entryPath = `${path}.collections.${collection}`;
    if (!exactKeys(entry, ['nonzero', 'unknown'], entryPath, unknown)) continue;
    const entryNonzero = safeCount(entry.nonzero, `${entryPath}.nonzero`, unknown);
    const entryUnknown = safeCount(entry.unknown, `${entryPath}.unknown`, unknown);
    if (entryNonzero !== null) computedNonzero += entryNonzero;
    if (entryUnknown !== null) computedUnknown += entryUnknown;
  }
  if (nonzeroCount !== null && nonzeroCount !== computedNonzero) {
    unknown.push(`${path}.nonzeroCount:total`);
  }
  if (unknownCount !== null && unknownCount !== computedUnknown) {
    unknown.push(`${path}.unknownCount:total`);
  }
  if (unknownCount !== null && unknownCount > 0) unknown.push(`${path}.unknownCount:nonzero`);
  if (nonzeroCount !== null && nonzeroCount > 0) nonzero.push(`${path}.nonzeroCount`);
  return { capture, observationReceiptId };
}

function parseBoundary(value, name, topologyFreshnessMs, requireOwnership, unknown, nonzero) {
  const keys = requireOwnership
    ? ['completedAt', 'pubsub', 'orchestrator', 'ownership']
    : ['completedAt', 'pubsub', 'orchestrator'];
  if (!exactKeys(value, keys, name, unknown)) return null;
  const completedAt = instant(value.completedAt, `${name}.completedAt`, unknown);
  const pubsub = parsePubSubSnapshot(
    value.pubsub,
    `${name}.pubsub`,
    name,
    topologyFreshnessMs,
    unknown,
    nonzero
  );
  const orchestrator = parseOrchestratorSnapshot(
    value.orchestrator,
    `${name}.orchestrator`,
    name,
    topologyFreshnessMs,
    unknown,
    nonzero
  );
  const ownership = requireOwnership
    ? parseOwnership(
        value.ownership,
        `${name}.ownership`,
        name,
        topologyFreshnessMs,
        unknown,
        nonzero
      )
    : null;
  return { completedAt, pubsub, orchestrator, ownership };
}

function compareMonotonicTimestamp(field, before, after, surfaceName, unknown, nonzero) {
  if (after === before) return;
  if (before !== null && after === null) {
    unknown.push(`${surfaceName}.${field}:cleared`);
    return;
  }
  const beforeInstant = before === null ? null : Date.parse(before);
  const afterInstant = after === null ? null : Date.parse(after);
  if (beforeInstant !== null && afterInstant !== null && afterInstant < beforeInstant) {
    unknown.push(`${surfaceName}.${field}:regressed`);
  } else {
    nonzero.push(`${surfaceName}.${field}:advanced`);
  }
}

function compareSurfaceSequence(
  surfaceName,
  boundaries,
  counterNames,
  requiredQuietIntervalMs,
  unknown,
  nonzero
) {
  const surfaces = boundaries.map((boundary) => boundary?.[surfaceName] ?? null);
  if (surfaces.some((surface) => surface === null)) return;
  const first = surfaces[0];
  const receipts = new Set();
  for (const [index, current] of surfaces.entries()) {
    const expectedSequence = index + 1;
    if (current.capture?.sequence !== expectedSequence) {
      unknown.push(`${surfaceName}.capture:sequence`);
    }
    if (current.capture !== null) {
      if (receipts.has(current.capture.receiptId)) {
        unknown.push(`${surfaceName}.capture:reused-receipt`);
      }
      receipts.add(current.capture.receiptId);
    }
    if (index === 0) continue;
    if (
      current.surfaceIdentity !== first.surfaceIdentity ||
      current.epoch !== first.epoch ||
      current.processStartedAt !== first.processStartedAt
    ) {
      unknown.push(`${surfaceName}:process-continuity`);
    }
    if (
      surfaceName === 'pubsub' &&
      (current.expectedTopologyHash !== first.expectedTopologyHash ||
        current.expectedObservedTopologyHash !== first.expectedObservedTopologyHash ||
        current.preservedLegacyTopologyHash !== first.preservedLegacyTopologyHash)
    ) {
      unknown.push(`${surfaceName}:expected-topology-continuity`);
    }
    const previous = surfaces[index - 1];
    if (
      current.capture?.collectorRunId !== first.capture?.collectorRunId ||
      current.capture?.startedMonotonicNs === null ||
      previous.capture?.completedMonotonicNs === null ||
      current.capture?.startedMonotonicNs <= previous.capture?.completedMonotonicNs
    ) {
      unknown.push(`${surfaceName}.capture:order`);
    }
    for (const counter of counterNames) {
      const before = previous.counters[counter];
      const after = current.counters[counter];
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)) continue;
      if (after < before) unknown.push(`${surfaceName}.${counter}:reset`);
      else if (after > before) nonzero.push(`${surfaceName}.${counter}:delta`);
    }
    compareMonotonicTimestamp(
      'lastActivityAt',
      previous.lastActivityAt,
      current.lastActivityAt,
      surfaceName,
      unknown,
      nonzero
    );
    if (surfaceName === 'pubsub') {
      if (
        !Number.isSafeInteger(previous.topologyObservationSequence) ||
        !Number.isSafeInteger(current.topologyObservationSequence) ||
        current.topologyObservationSequence <= previous.topologyObservationSequence
      ) {
        unknown.push(`${surfaceName}.topologyObservationSequence:not-advanced`);
      }
      compareMonotonicTimestamp(
        'lastErrorAt',
        previous.lastErrorAt,
        current.lastErrorAt,
        surfaceName,
        unknown,
        nonzero
      );
      if (Date.parse(current.topologyObservedAt) < Date.parse(previous.topologyObservedAt)) {
        unknown.push(`${surfaceName}.topologyObservedAt:regressed`);
      }
    }
  }

  if (requiredQuietIntervalMs === null) return;
  const requiredQuietIntervalNs = BigInt(requiredQuietIntervalMs) * NANOSECONDS_PER_MILLISECOND;
  for (const [beforeIndex, afterIndex, intervalName] of [
    [1, 2, 'anchor-to-read1'],
    [2, 3, 'read1-to-read2'],
  ]) {
    const before = surfaces[beforeIndex]?.capture?.completedMonotonicNs;
    const after = surfaces[afterIndex]?.capture?.completedMonotonicNs;
    if (before !== null && before !== undefined && after !== null && after !== undefined) {
      if (after - before < requiredQuietIntervalNs) {
        unknown.push(`${surfaceName}.${intervalName}:quiet-interval`);
      }
    }
  }
}

function compareOwnershipSequence(boundaries, requiredQuietIntervalMs, unknown) {
  const ownership = boundaries.slice(1).map((boundary) => boundary?.ownership ?? null);
  if (ownership.some((surface) => surface === null)) return;
  const first = ownership[0];
  const receipts = new Set();
  const observationReceipts = new Set();
  for (const [index, current] of ownership.entries()) {
    if (current.capture?.sequence !== index + 1) unknown.push('ownership.capture:sequence');
    if (current.capture !== null) {
      if (receipts.has(current.capture.receiptId)) unknown.push('ownership.capture:reused-receipt');
      receipts.add(current.capture.receiptId);
    }
    if (current.observationReceiptId !== null) {
      if (observationReceipts.has(current.observationReceiptId)) {
        unknown.push('ownership.observationReceiptId:reused');
      }
      observationReceipts.add(current.observationReceiptId);
    }
    if (index === 0) continue;
    const previous = ownership[index - 1];
    if (
      current.capture?.collectorRunId !== first.capture?.collectorRunId ||
      current.capture?.startedMonotonicNs === null ||
      previous.capture?.completedMonotonicNs === null ||
      current.capture?.startedMonotonicNs <= previous.capture?.completedMonotonicNs
    ) {
      unknown.push('ownership.capture:order');
    }
  }
  if (requiredQuietIntervalMs === null) return;
  const requiredQuietIntervalNs = BigInt(requiredQuietIntervalMs) * NANOSECONDS_PER_MILLISECOND;
  for (const [beforeIndex, afterIndex, intervalName] of [
    [0, 1, 'anchor-to-read1'],
    [1, 2, 'read1-to-read2'],
  ]) {
    const before = ownership[beforeIndex]?.capture?.completedMonotonicNs;
    const after = ownership[afterIndex]?.capture?.completedMonotonicNs;
    if (before !== null && before !== undefined && after !== null && after !== undefined) {
      if (after - before < requiredQuietIntervalNs) {
        unknown.push(`ownership.${intervalName}:quiet-interval`);
      }
    }
  }
}

function compareCollectorCaptureOrder(boundaries, unknown) {
  const captures = boundaries.flatMap((boundary) =>
    [boundary?.pubsub, boundary?.orchestrator, boundary?.ownership]
      .filter((surface) => surface !== null && surface !== undefined)
      .map((surface) => surface.capture)
  );
  let previousCompletedMonotonicNs = null;
  for (const capture of captures) {
    if (
      capture?.startedMonotonicNs !== null &&
      capture?.startedMonotonicNs !== undefined &&
      previousCompletedMonotonicNs !== null &&
      capture.startedMonotonicNs <= previousCompletedMonotonicNs
    ) {
      unknown.push('collector-run:capture-order');
    }
    if (capture?.completedMonotonicNs !== null && capture?.completedMonotonicNs !== undefined) {
      previousCompletedMonotonicNs = capture.completedMonotonicNs;
    }
  }
}

export function evaluateUnsignedDevDrainEvidence(input) {
  const unknown = [];
  const nonzero = [];
  const topKeys = [
    'contractVersion',
    'requiredQuietIntervalMs',
    'topologyFreshnessMs',
    'witness',
    'anchor',
    'read1',
    'read2',
  ];
  if (!exactKeys(input, topKeys, 'input', unknown)) {
    return { pendingStatus: 'unknown', reasons: [...new Set(unknown)].sort() };
  }
  if (input.contractVersion !== 1) unknown.push('input.contractVersion');
  const requiredQuietIntervalMs = safeCount(
    input.requiredQuietIntervalMs,
    'input.requiredQuietIntervalMs',
    unknown
  );
  const topologyFreshnessMs = safeCount(
    input.topologyFreshnessMs,
    'input.topologyFreshnessMs',
    unknown
  );
  if (requiredQuietIntervalMs !== null && requiredQuietIntervalMs < 600_000) {
    unknown.push('input.requiredQuietIntervalMs:too-short');
  }
  if (topologyFreshnessMs !== null && topologyFreshnessMs === 0) {
    unknown.push('input.topologyFreshnessMs:zero');
  }

  const boundaries = [
    parseBoundary(input.witness, 'witness', topologyFreshnessMs, false, unknown, nonzero),
    parseBoundary(input.anchor, 'anchor', topologyFreshnessMs, true, unknown, nonzero),
    parseBoundary(input.read1, 'read1', topologyFreshnessMs, true, unknown, nonzero),
    parseBoundary(input.read2, 'read2', topologyFreshnessMs, true, unknown, nonzero),
  ];

  const collectorRunIds = new Set();
  for (const boundary of boundaries) {
    for (const surface of [boundary?.pubsub, boundary?.orchestrator, boundary?.ownership]) {
      if (surface?.capture?.collectorRunId !== undefined) {
        collectorRunIds.add(surface.capture.collectorRunId);
      }
    }
  }
  if (collectorRunIds.size !== 1) unknown.push('collector-run:continuity');
  compareCollectorCaptureOrder(boundaries, unknown);

  compareSurfaceSequence(
    'pubsub',
    boundaries,
    PUBSUB_COUNTERS,
    requiredQuietIntervalMs,
    unknown,
    nonzero
  );
  compareSurfaceSequence(
    'orchestrator',
    boundaries,
    ORCHESTRATOR_COUNTERS,
    requiredQuietIntervalMs,
    unknown,
    nonzero
  );
  compareOwnershipSequence(boundaries, requiredQuietIntervalMs, unknown);

  const reasons = [...new Set(unknown.length > 0 ? unknown : nonzero)].sort();
  if (unknown.length > 0) return { pendingStatus: 'unknown', reasons };
  if (nonzero.length > 0) return { pendingStatus: 'nonzero', reasons };
  return { pendingStatus: 'zero', reasons: [] };
}

function artifactUnknown(reason) {
  return { pendingStatus: 'unknown', reasons: [reason] };
}

function validSourceRevision(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function validEvidenceRunId(value) {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

function sameResult(left, right) {
  return (
    left.pendingStatus === right.pendingStatus &&
    left.reasons.length === right.reasons.length &&
    left.reasons.every((reason, index) => reason === right.reasons[index])
  );
}

function verificationContext(value) {
  const unknown = [];
  if (
    !exactKeys(
      value,
      [
        'expectedEvidenceRunId',
        'expectedOperationNonce',
        'currentTime',
        'maxAgeMs',
        'consumeOperationNonce',
      ],
      'artifact.context',
      unknown
    ) ||
    !validEvidenceRunId(value.expectedEvidenceRunId) ||
    typeof value.expectedOperationNonce !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.expectedOperationNonce) ||
    !(value.currentTime instanceof Date) ||
    !Number.isFinite(value.currentTime.getTime()) ||
    !Number.isSafeInteger(value.maxAgeMs) ||
    value.maxAgeMs < 1 ||
    value.maxAgeMs > MAX_DEV_DRAIN_ARTIFACT_AGE_MS ||
    typeof value.consumeOperationNonce !== 'function'
  ) {
    return null;
  }
  return {
    expectedEvidenceRunId: value.expectedEvidenceRunId,
    expectedOperationNonce: value.expectedOperationNonce,
    currentTimeMs: value.currentTime.getTime(),
    maxAgeMs: value.maxAgeMs,
    consumeOperationNonce: value.consumeOperationNonce,
  };
}

export function verifyDevDrain(artifact, publicKeyInput, contextInput) {
  try {
    const candidate = structuredClone(artifact);
    if (!verifyDevDrainArtifactSignature(candidate, publicKeyInput)) {
      return artifactUnknown('artifact:signature');
    }
    const context = verificationContext(contextInput);
    if (context === null) return artifactUnknown('artifact:context');
    const artifactUnknownReasons = [];
    const createdAt = instant(candidate.createdAt, 'artifact.createdAt', artifactUnknownReasons);
    if (!validEvidenceRunId(candidate.evidenceRunId)) {
      return artifactUnknown('artifact:evidence-run');
    }
    if (
      typeof candidate.operationNonce !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(candidate.operationNonce)
    ) {
      return artifactUnknown('artifact:operation-nonce');
    }
    if (candidate.evidenceRunId !== context.expectedEvidenceRunId) {
      return artifactUnknown('artifact:evidence-run');
    }
    if (candidate.operationNonce !== context.expectedOperationNonce) {
      return artifactUnknown('artifact:operation-nonce');
    }
    if (createdAt !== null && createdAt > context.currentTimeMs) {
      return artifactUnknown('artifact:future');
    }
    if (createdAt !== null && context.currentTimeMs - createdAt > context.maxAgeMs) {
      return artifactUnknown('artifact:stale');
    }
    if (
      !exactKeys(
        candidate.sourceRevisions,
        ['pubsub', 'orchestrator'],
        'artifact.sourceRevisions',
        artifactUnknownReasons
      )
    ) {
      return artifactUnknown('artifact:source-revisions');
    }
    if (
      !validSourceRevision(candidate.sourceRevisions.pubsub) ||
      !validSourceRevision(candidate.sourceRevisions.orchestrator)
    ) {
      return artifactUnknown('artifact:source-revisions');
    }
    if (
      !exactKeys(
        candidate.result,
        ['pendingStatus', 'reasons'],
        'artifact.result',
        artifactUnknownReasons
      ) ||
      !['zero', 'nonzero', 'unknown'].includes(candidate.result.pendingStatus) ||
      !Array.isArray(candidate.result.reasons) ||
      candidate.result.reasons.some(
        (reason) => typeof reason !== 'string' || reason.length === 0 || reason.length > 512
      )
    ) {
      return artifactUnknown('artifact:result');
    }
    if (artifactUnknownReasons.length > 0) return artifactUnknown('artifact:schema');

    const verifierInput = assembleDevDrainVerifierInput({
      captures: candidate.captures,
      publicKey: publicKeyInput,
      requiredQuietIntervalMs: candidate.requiredQuietIntervalMs,
      topologyFreshnessMs: candidate.topologyFreshnessMs,
    });
    for (const boundary of [
      verifierInput.witness,
      verifierInput.anchor,
      verifierInput.read1,
      verifierInput.read2,
    ]) {
      if (
        boundary.pubsub.surfaceIdentity.sourceRevision !== candidate.sourceRevisions.pubsub ||
        boundary.orchestrator.surfaceIdentity.sourceRevision !==
          candidate.sourceRevisions.orchestrator
      ) {
        return artifactUnknown('artifact:source-revisions');
      }
    }
    if (candidate.createdAt !== verifierInput.read2.completedAt) {
      return artifactUnknown('artifact:created-at');
    }
    const computedResult = evaluateUnsignedDevDrainEvidence(verifierInput);
    if (!sameResult(computedResult, candidate.result)) {
      return artifactUnknown('artifact:result-mismatch');
    }
    const artifactIdSha256 = createHash('sha256')
      .update(Buffer.from(candidate.signatureBase64, 'base64'))
      .digest('hex');
    let consumed = false;
    try {
      consumed =
        context.consumeOperationNonce(
          Object.freeze({
            evidenceRunId: candidate.evidenceRunId,
            operationNonce: candidate.operationNonce,
            artifactIdSha256,
            createdAt: candidate.createdAt,
          })
        ) === true;
    } catch {
      consumed = false;
    }
    if (!consumed) return artifactUnknown('artifact:replay');
    return computedResult;
  } catch {
    return artifactUnknown('artifact:invalid');
  }
}
