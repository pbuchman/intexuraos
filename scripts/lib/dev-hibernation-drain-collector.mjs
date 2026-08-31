import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPTURE_PHASES = ['witness', 'anchor', 'read1', 'read2'];
const CAPTURE_SURFACES = ['pubsub', 'orchestrator', 'ownership'];
const OWNERSHIP_COLLECTIONS = [
  'codeTasks',
  'sessions',
  'testRuns',
  'runContexts',
  'leases',
  'ingestOutbox',
  'terminalControlOutbox',
];
const PUBSUB_DRAIN_KEYS = [
  'counterEpochId',
  'processStartedAt',
  'expectedTopologyHash',
  'observedTopologyHash',
  'topologyObservedAt',
  'topologyObservationSequence',
  'topologyRefreshErrorsTotal',
  'topologyMatch',
  'activeListenerTopologyHash',
  'subscriptionCounts',
  'classificationCounts',
  'listenerMultiplicity',
  'activeListeners',
  'setupErrors',
  'inFlightHandlers',
  'receivedTotal',
  'ackedTotal',
  'nackedTotal',
  'forwardFailuresTotal',
  'subscriberErrorsTotal',
  'lastActivityAt',
  'lastErrorAt',
];
const SUBSCRIPTION_COUNT_KEYS = [
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
];
const ORCHESTRATOR_DRAIN_KEYS = [
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
];
const WRAPPER_KEYS = [
  'schemaVersion',
  'signatureAlgorithm',
  'keyIdSha256',
  'surface',
  'phase',
  'evidence',
  'signatureBase64',
];
const ARTIFACT_KEYS = [
  'schemaVersion',
  'artifactType',
  'signatureAlgorithm',
  'keyIdSha256',
  'evidenceRunId',
  'operationNonce',
  'createdAt',
  'sourceRevisions',
  'requiredQuietIntervalMs',
  'topologyFreshnessMs',
  'captures',
  'result',
  'signatureBase64',
];
const MAX_HEALTH_RESPONSE_BYTES = 1024 * 1024;
const HOST_UNIT_NAMES = [
  'pm2-pbuchman.service',
  'intexuraos-emulators.service',
  'pm2-journal-bridge.service',
  'intexuraos-log-viewer.service',
  'intexuraos-log-server.service',
  'alloy.service',
];
const LAST_GOOD_KEYS = [
  'schemaVersion',
  'evidenceRunId',
  'intexuraosRevision',
  'pbuchmanDevRevision',
  'installManifestSha256',
  'profile',
  'unitFileStates',
  'expectedCandidatePorts',
  'staticReleaseTarget',
  'staticReleaseFiles',
  'pm2EcosystemPath',
  'pm2EcosystemSha256',
  'pm2Processes',
  'composeCheckoutRevision',
  'composeFileSha256',
  'imageDigests',
  'referencedObjects',
  'devDrainSourceRevisions',
  'devDrainNodeSha256',
  'devDrainNodeVersion',
  'devDrainVerifierSources',
];
const REFERENCED_OBJECT_NAMES = [
  'activeHealth',
  'externalIntegrations',
  'secretPackage',
  'serviceAccountPrincipal',
];
const ALLOY_EVIDENCE_KEYS = [
  'bufferFlushComplete',
  'evidenceRunId',
  'observedAt',
  'operationNonce',
  'pm2Only',
  'result',
  'schemaVersion',
];
const OBSERVABILITY_FENCE_KEYS = [
  'artifactType',
  'bufferFlushComplete',
  'continuityHealthy',
  'evidenceRunId',
  'observedAt',
  'operationNonce',
  'pendingBufferCount',
  'phase',
  'result',
  'schemaVersion',
  'terminalTailComplete',
];

function collectorError(message) {
  return new Error(`DEV drain collector: ${message}`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze(value) {
  if ((!isRecord(value) && !Array.isArray(value)) || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) throw collectorError(`${label} violates the privacy-safe contract`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
}

function privacyScalar(value, label) {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
  return value;
}

function requirePrivacySafeCount(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
}

function requirePrivacySafeDigest(value, length, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${String(length)}}$`, 'u').test(value)) {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
}

function requirePrivacySafeInstant(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string') {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
}

function requirePrivacySafeResourceId(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._~+%-]*$/u.test(value)
  ) {
    throw collectorError(`${label} violates the privacy-safe contract`);
  }
}

function scalarProjection(value, keys, label) {
  exactKeys(value, keys, label);
  return Object.fromEntries(keys.map((key) => [key, privacyScalar(value[key], `${label}.${key}`)]));
}

function validateSurfaceIdentity(value, expectedKind, label) {
  exactKeys(value, ['kind', 'instanceIdHash'], label);
  if (
    value.kind !== expectedKind ||
    typeof value.instanceIdHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.instanceIdHash)
  ) {
    throw collectorError(`${label} is invalid`);
  }
  return { kind: value.kind, instanceIdHash: value.instanceIdHash };
}

function validateSourceRevision(value, label) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)) {
    throw collectorError(`${label} source revision is invalid`);
  }
  return value;
}

function bindSurfaceIdentity(identity, endpoint, sourceRevision) {
  return {
    ...identity,
    endpointIdSha256: createHash('sha256').update(endpoint).digest('hex'),
    sourceRevision,
  };
}

function canonicalTimestamp(now, label) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw collectorError(`${label} clock is invalid`);
  }
  return value.toISOString();
}

function endpointUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw collectorError(`${label} endpoint is invalid`);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/health' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw collectorError(`${label} endpoint is invalid`);
  }
  return parsed.toString();
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw collectorError('signed evidence is not canonical JSON');
}

function publicKeyContext(key) {
  const publicKey = key?.type === 'public' ? key : createPublicKey(key);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw collectorError('evidence signing key must be Ed25519');
  }
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    keyIdSha256: createHash('sha256').update(publicDer).digest('hex'),
    publicKey,
  };
}

function signingContext(key) {
  const privateKey = key?.type === 'private' ? key : createPrivateKey(key);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw collectorError('evidence signing key must be Ed25519');
  }
  return { privateKey, ...publicKeyContext(privateKey) };
}

function unsignedWrapper(wrapper) {
  return {
    schemaVersion: wrapper.schemaVersion,
    signatureAlgorithm: wrapper.signatureAlgorithm,
    keyIdSha256: wrapper.keyIdSha256,
    surface: wrapper.surface,
    phase: wrapper.phase,
    evidence: wrapper.evidence,
  };
}

function unsignedArtifact(artifact) {
  return {
    schemaVersion: artifact.schemaVersion,
    artifactType: artifact.artifactType,
    signatureAlgorithm: artifact.signatureAlgorithm,
    keyIdSha256: artifact.keyIdSha256,
    evidenceRunId: artifact.evidenceRunId,
    operationNonce: artifact.operationNonce,
    createdAt: artifact.createdAt,
    sourceRevisions: artifact.sourceRevisions,
    requiredQuietIntervalMs: artifact.requiredQuietIntervalMs,
    topologyFreshnessMs: artifact.topologyFreshnessMs,
    captures: artifact.captures,
    result: artifact.result,
  };
}

function signWrapper({ privateKey, keyIdSha256, surface, phase, evidence }) {
  const unsigned = {
    schemaVersion: 1,
    signatureAlgorithm: 'Ed25519',
    keyIdSha256,
    surface,
    phase,
    evidence,
  };
  const signatureBase64 = signBytes(
    null,
    Buffer.from(canonicalJson(unsigned), 'utf8'),
    privateKey
  ).toString('base64');
  return { ...unsigned, signatureBase64 };
}

function signArtifact({ privateKey, keyIdSha256, artifact }) {
  const unsigned = {
    schemaVersion: 1,
    artifactType: 'dev-drain-final',
    signatureAlgorithm: 'Ed25519',
    keyIdSha256,
    ...artifact,
  };
  const signatureBase64 = signBytes(
    null,
    Buffer.from(canonicalJson(unsigned), 'utf8'),
    privateKey
  ).toString('base64');
  return { ...unsigned, signatureBase64 };
}

export function verifyDrainCaptureWrapper(wrapper, publicKeyInput) {
  try {
    const candidate = structuredClone(wrapper);
    exactKeys(candidate, WRAPPER_KEYS, 'signed capture wrapper');
    if (
      candidate.schemaVersion !== 1 ||
      candidate.signatureAlgorithm !== 'Ed25519' ||
      !CAPTURE_SURFACES.includes(candidate.surface) ||
      !CAPTURE_PHASES.includes(candidate.phase) ||
      typeof candidate.signatureBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(candidate.signatureBase64)
    ) {
      return false;
    }
    const { keyIdSha256, publicKey } = publicKeyContext(publicKeyInput);
    if (candidate.keyIdSha256 !== keyIdSha256) return false;
    const signature = Buffer.from(candidate.signatureBase64, 'base64');
    if (signature.toString('base64') !== candidate.signatureBase64) return false;
    return verifyBytes(
      null,
      Buffer.from(canonicalJson(unsignedWrapper(candidate)), 'utf8'),
      publicKey,
      signature
    );
  } catch {
    return false;
  }
}

export function verifyDevDrainArtifactSignature(artifact, publicKeyInput) {
  try {
    const candidate = structuredClone(artifact);
    exactKeys(candidate, ARTIFACT_KEYS, 'signed verifier artifact');
    if (
      candidate.schemaVersion !== 1 ||
      candidate.artifactType !== 'dev-drain-final' ||
      candidate.signatureAlgorithm !== 'Ed25519' ||
      typeof candidate.signatureBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(candidate.signatureBase64)
    ) {
      return false;
    }
    const { keyIdSha256, publicKey } = publicKeyContext(publicKeyInput);
    if (candidate.keyIdSha256 !== keyIdSha256) return false;
    const signature = Buffer.from(candidate.signatureBase64, 'base64');
    if (signature.toString('base64') !== candidate.signatureBase64) return false;
    return verifyBytes(
      null,
      Buffer.from(canonicalJson(unsignedArtifact(candidate)), 'utf8'),
      publicKey,
      signature
    );
  } catch {
    return false;
  }
}

function projectPubSubHealth(value) {
  if (!isRecord(value) || value.status !== 'ok' || value.drainContractVersion !== 1) {
    throw collectorError('Pub/Sub health violates the privacy-safe contract');
  }
  const drain = value.drain;
  exactKeys(drain, PUBSUB_DRAIN_KEYS, 'Pub/Sub drain');
  const subscriptionCounts = scalarProjection(
    drain.subscriptionCounts,
    SUBSCRIPTION_COUNT_KEYS,
    'Pub/Sub subscription counts'
  );
  const classificationCounts = scalarProjection(
    drain.classificationCounts,
    ['forwarded', 'monitor-only'],
    'Pub/Sub classification counts'
  );
  if (!Array.isArray(drain.listenerMultiplicity)) {
    throw collectorError('Pub/Sub listener multiplicity violates the privacy-safe contract');
  }
  if (drain.listenerMultiplicity.length > 2_048) {
    throw collectorError('Pub/Sub listener multiplicity violates the privacy-safe contract');
  }
  const listenerMultiplicity = drain.listenerMultiplicity.map((entry) => {
    const projected = scalarProjection(
      entry,
      ['projectId', 'topicName', 'subscriptionName', 'classification', 'listeners'],
      'Pub/Sub listener multiplicity entry'
    );
    requirePrivacySafeResourceId(projected.projectId, 'Pub/Sub listener project ID');
    requirePrivacySafeResourceId(projected.topicName, 'Pub/Sub listener topic name');
    requirePrivacySafeResourceId(projected.subscriptionName, 'Pub/Sub listener subscription name');
    if (projected.classification !== 'forwarded' && projected.classification !== 'monitor-only') {
      throw collectorError('Pub/Sub listener classification violates the privacy-safe contract');
    }
    requirePrivacySafeCount(projected.listeners, 'Pub/Sub listener count');
    return projected;
  });
  const projectedDrain = scalarProjection(
    Object.fromEntries(
      PUBSUB_DRAIN_KEYS.filter(
        (key) =>
          key !== 'subscriptionCounts' &&
          key !== 'classificationCounts' &&
          key !== 'listenerMultiplicity'
      ).map((key) => [key, drain[key]])
    ),
    PUBSUB_DRAIN_KEYS.filter(
      (key) =>
        key !== 'subscriptionCounts' &&
        key !== 'classificationCounts' &&
        key !== 'listenerMultiplicity'
    ),
    'Pub/Sub drain scalars'
  );
  requirePrivacySafeDigest(projectedDrain.counterEpochId, 32, 'Pub/Sub counter epoch');
  requirePrivacySafeInstant(projectedDrain.processStartedAt, 'Pub/Sub process start');
  requirePrivacySafeDigest(projectedDrain.expectedTopologyHash, 64, 'Pub/Sub expected topology');
  requirePrivacySafeDigest(
    projectedDrain.observedTopologyHash,
    64,
    'Pub/Sub observed topology',
    true
  );
  requirePrivacySafeInstant(
    projectedDrain.topologyObservedAt,
    'Pub/Sub topology observation',
    true
  );
  requirePrivacySafeDigest(
    projectedDrain.activeListenerTopologyHash,
    64,
    'Pub/Sub listener topology'
  );
  if (typeof projectedDrain.topologyMatch !== 'boolean') {
    throw collectorError('Pub/Sub topology match violates the privacy-safe contract');
  }
  for (const field of [
    'topologyObservationSequence',
    'topologyRefreshErrorsTotal',
    'activeListeners',
    'setupErrors',
    'inFlightHandlers',
    'receivedTotal',
    'ackedTotal',
    'nackedTotal',
    'forwardFailuresTotal',
    'subscriberErrorsTotal',
  ]) {
    requirePrivacySafeCount(projectedDrain[field], `Pub/Sub ${field}`);
  }
  requirePrivacySafeInstant(projectedDrain.lastActivityAt, 'Pub/Sub last activity', true);
  requirePrivacySafeInstant(projectedDrain.lastErrorAt, 'Pub/Sub last error', true);
  for (const [field, count] of Object.entries(subscriptionCounts)) {
    requirePrivacySafeCount(count, `Pub/Sub subscription ${field}`);
  }
  for (const [field, count] of Object.entries(classificationCounts)) {
    requirePrivacySafeCount(count, `Pub/Sub classification ${field}`);
  }
  return {
    status: 'ok',
    drainContractVersion: 1,
    drain: {
      ...projectedDrain,
      subscriptionCounts,
      classificationCounts,
      listenerMultiplicity,
    },
  };
}

function projectOrchestratorHealth(value) {
  if (
    !isRecord(value) ||
    value.healthContractVersion !== 2 ||
    value.status !== 'ready' ||
    value.dockerHealthy !== true ||
    value.diskHealthy !== true
  ) {
    throw collectorError('orchestrator health violates the privacy-safe contract');
  }
  const topLevel = scalarProjection(
    {
      status: value.status,
      dockerHealthy: value.dockerHealthy,
      diskHealthy: value.diskHealthy,
      running: value.running,
      workerContainers: value.workerContainers,
      pendingTerminalCallbacks: value.pendingTerminalCallbacks,
      terminalCallbackActivityTotal: value.terminalCallbackActivityTotal,
    },
    [
      'status',
      'dockerHealthy',
      'diskHealthy',
      'running',
      'workerContainers',
      'pendingTerminalCallbacks',
      'terminalCallbackActivityTotal',
    ],
    'orchestrator health scalars'
  );
  const logForwarderDrain = scalarProjection(
    value.logForwarderDrain,
    ORCHESTRATOR_DRAIN_KEYS,
    'orchestrator log forwarder drain'
  );
  requirePrivacySafeCount(topLevel.running, 'orchestrator running');
  requirePrivacySafeCount(topLevel.workerContainers, 'orchestrator worker containers', true);
  requirePrivacySafeCount(
    topLevel.pendingTerminalCallbacks,
    'orchestrator pending terminal callbacks',
    true
  );
  requirePrivacySafeCount(
    topLevel.terminalCallbackActivityTotal,
    'orchestrator terminal callback activity',
    true
  );
  requirePrivacySafeDigest(
    logForwarderDrain.counterEpochId,
    32,
    'orchestrator forwarder counter epoch'
  );
  requirePrivacySafeInstant(
    logForwarderDrain.processStartedAt,
    'orchestrator forwarder process start'
  );
  for (const field of ORCHESTRATOR_DRAIN_KEYS.filter(
    (key) => key !== 'counterEpochId' && key !== 'processStartedAt' && key !== 'lastActivityAt'
  )) {
    requirePrivacySafeCount(logForwarderDrain[field], `orchestrator forwarder ${field}`);
  }
  requirePrivacySafeInstant(
    logForwarderDrain.lastActivityAt,
    'orchestrator forwarder last activity',
    true
  );
  return { healthContractVersion: 2, ...topLevel, logForwarderDrain };
}

function projectOwnershipCollection(value, collection) {
  const projected = scalarProjection(value, ['nonzero', 'unknown'], `ownership ${collection}`);
  requirePrivacySafeCount(projected.nonzero, `ownership ${collection} nonzero`);
  requirePrivacySafeCount(projected.unknown, `ownership ${collection} unknown`);
  return projected;
}

function projectOwnership(value) {
  exactKeys(value, ['nonzeroCount', 'unknownCount', 'collections'], 'ownership snapshot');
  const counts = scalarProjection(
    { nonzeroCount: value.nonzeroCount, unknownCount: value.unknownCount },
    ['nonzeroCount', 'unknownCount'],
    'ownership aggregate counts'
  );
  requirePrivacySafeCount(counts.nonzeroCount, 'ownership nonzero count');
  requirePrivacySafeCount(counts.unknownCount, 'ownership unknown count');
  exactKeys(value.collections, OWNERSHIP_COLLECTIONS, 'ownership collections');
  const collections = Object.fromEntries(
    OWNERSHIP_COLLECTIONS.map((collection) => [
      collection,
      projectOwnershipCollection(value.collections[collection], collection),
    ])
  );
  return { ...counts, collections };
}

function projectOwnershipObservation(value, expectedReceiptId) {
  exactKeys(value, ['observationReceiptId', 'aggregate'], 'ownership observation');
  if (value.observationReceiptId !== expectedReceiptId) {
    throw collectorError('ownership observation receipt does not match this capture');
  }
  return {
    observationReceiptId: expectedReceiptId,
    ...projectOwnership(value.aggregate),
  };
}

async function readHealthJson(fetchImpl, url, surface, requestTimeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-store' },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw collectorError(`${surface} health request failed`);
  }
  if (!response.ok) throw collectorError(`${surface} health request failed`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:;|$)/iu.test(contentType)) {
    throw collectorError(`${surface} health response is not JSON`);
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_HEALTH_RESPONSE_BYTES)
  ) {
    throw collectorError(`${surface} health response exceeds the safe limit`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw collectorError(`${surface} health response could not be read`);
  }
  if (bytes.byteLength > MAX_HEALTH_RESPONSE_BYTES) {
    throw collectorError(`${surface} health response exceeds the safe limit`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw collectorError(`${surface} health response is invalid JSON`);
  }
}

function validateCollectorRunId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/u.test(value)) {
    throw collectorError('collector run ID must encode 128 bits');
  }
  return value;
}

function validateEvidenceRunId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  ) {
    throw collectorError('evidence run ID is invalid');
  }
  return value;
}

function validateMonotonicClockValue(value) {
  if (typeof value !== 'bigint' || value < 0n) {
    throw collectorError('monotonic clock is invalid');
  }
  return value;
}

function boundaryCompletionReceivedAt(wrappers) {
  return wrappers.at(-1).evidence.capture.receivedAt;
}

function requireWrapper(wrapper, publicKey, surface, phase) {
  if (!verifyDrainCaptureWrapper(wrapper, publicKey)) {
    throw collectorError(`invalid ${surface} ${phase} signature`);
  }
  if (wrapper.surface !== surface) throw collectorError(`${phase} surface mismatch`);
  if (wrapper.phase !== phase) throw collectorError(`${surface} capture phase mismatch`);
  if (
    !isRecord(wrapper.evidence) ||
    !isRecord(wrapper.evidence.capture) ||
    wrapper.evidence.capture.surface !== surface ||
    wrapper.evidence.capture.phase !== phase
  ) {
    throw collectorError(`${surface} ${phase} evidence marker mismatch`);
  }
  return wrapper.evidence;
}

export function assembleDevDrainVerifierInput({
  captures,
  publicKey,
  requiredQuietIntervalMs,
  topologyFreshnessMs,
}) {
  let captureSnapshot;
  try {
    captureSnapshot = structuredClone(captures);
  } catch {
    throw collectorError('capture sequence violates the privacy-safe contract');
  }
  exactKeys(captureSnapshot, CAPTURE_PHASES, 'capture sequence');
  const boundaries = {};
  for (const phase of CAPTURE_PHASES) {
    const expectedSurfaces = phase === 'witness' ? ['pubsub', 'orchestrator'] : CAPTURE_SURFACES;
    exactKeys(captureSnapshot[phase], expectedSurfaces, `${phase} captures`);
    const evidence = Object.fromEntries(
      expectedSurfaces.map((surface) => [
        surface,
        requireWrapper(captureSnapshot[phase][surface], publicKey, surface, phase),
      ])
    );
    boundaries[phase] = {
      completedAt: boundaryCompletionReceivedAt(
        expectedSurfaces.map((surface) => captureSnapshot[phase][surface])
      ),
      ...evidence,
    };
  }
  return deepFreeze(
    structuredClone({
      contractVersion: 1,
      requiredQuietIntervalMs,
      topologyFreshnessMs,
      witness: boundaries.witness,
      anchor: boundaries.anchor,
      read1: boundaries.read1,
      read2: boundaries.read2,
    })
  );
}

export function createDevDrainCollector(options) {
  if (!isRecord(options)) throw collectorError('options are required');
  const endpoints = options.endpoints;
  exactKeys(endpoints, ['pubsub', 'orchestrator'], 'collector endpoints');
  const pubsubEndpoint = endpointUrl(endpoints.pubsub, 'Pub/Sub');
  const orchestratorEndpoint = endpointUrl(endpoints.orchestrator, 'orchestrator');
  const sourceRevisions = options.sourceRevisions;
  exactKeys(sourceRevisions, ['pubsub', 'orchestrator'], 'source revisions');
  const pubsubSourceRevision = validateSourceRevision(sourceRevisions.pubsub, 'Pub/Sub');
  const orchestratorSourceRevision = validateSourceRevision(
    sourceRevisions.orchestrator,
    'orchestrator'
  );
  const surfaceIdentities = options.surfaceIdentities;
  exactKeys(surfaceIdentities, ['pubsub', 'orchestrator'], 'surface identities');
  const pubsubIdentity = bindSurfaceIdentity(
    validateSurfaceIdentity(
      surfaceIdentities.pubsub,
      'container-process',
      'Pub/Sub surface identity'
    ),
    pubsubEndpoint,
    pubsubSourceRevision
  );
  const orchestratorIdentity = bindSurfaceIdentity(
    validateSurfaceIdentity(
      surfaceIdentities.orchestrator,
      'process',
      'orchestrator surface identity'
    ),
    orchestratorEndpoint,
    orchestratorSourceRevision
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw collectorError('fetch implementation is unavailable');
  const now = options.now ?? (() => new Date());
  const monotonicNowNs = options.monotonicNowNs ?? (() => process.hrtime.bigint());
  if (typeof now !== 'function' || typeof monotonicNowNs !== 'function') {
    throw collectorError('collector clocks are invalid');
  }
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 120_000
  ) {
    throw collectorError('request timeout is invalid');
  }
  const collectorRunId = validateCollectorRunId(
    options.collectorRunId ?? randomBytes(16).toString('hex')
  );
  const evidenceRunId = validateEvidenceRunId(options.evidenceRunId);
  if (
    typeof options.operationNonce !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(options.operationNonce)
  ) {
    throw collectorError('operation nonce must encode 256 bits');
  }
  const operationNonce = options.operationNonce;
  const signing = signingContext(options.signingPrivateKey);
  const captures = {};
  let nextPhaseIndex = 0;
  let captureInProgress = false;
  let lastLogicalMonotonicNs = -1n;

  function logicalNow() {
    const observed = validateMonotonicClockValue(monotonicNowNs());
    lastLogicalMonotonicNs =
      observed > lastLogicalMonotonicNs ? observed : lastLogicalMonotonicNs + 1n;
    return lastLogicalMonotonicNs;
  }

  async function signedCapture(surface, phase, sequence, identity, collect) {
    const startedMonotonicNs = logicalNow();
    const snapshot = await collect({
      collectorRunId,
      surface,
      phase,
      sequence,
      observationReceiptId: randomBytes(32).toString('hex'),
    });
    const completedMonotonicNs = logicalNow();
    const receivedAt = canonicalTimestamp(now, 'collector');
    const receiptId = createHash('sha256')
      .update(
        JSON.stringify([
          collectorRunId,
          surface,
          phase,
          sequence,
          startedMonotonicNs.toString(),
          completedMonotonicNs.toString(),
        ])
      )
      .digest('hex');
    const capture = {
      collectorRunId,
      surface,
      phase,
      sequence,
      receiptId,
      startedMonotonicNs: startedMonotonicNs.toString(),
      completedMonotonicNs: completedMonotonicNs.toString(),
      receivedAt,
    };
    const evidence =
      identity === null
        ? { capture, ...snapshot }
        : { capture, surfaceIdentity: identity, ...snapshot };
    return signWrapper({ ...signing, surface, phase, evidence });
  }

  async function capture(phase, captureOptions = {}) {
    if (captureInProgress) throw collectorError('capture is already in progress');
    const expectedPhase = CAPTURE_PHASES[nextPhaseIndex];
    if (phase !== expectedPhase) {
      throw collectorError(`expected ${String(expectedPhase)} capture`);
    }
    const requiresOwnership = phase !== 'witness';
    if (requiresOwnership && typeof captureOptions.collectOwnership !== 'function') {
      throw collectorError(`${phase} ownership collector is required`);
    }
    if (!requiresOwnership && captureOptions.collectOwnership !== undefined) {
      throw collectorError('witness must not contain ownership evidence');
    }
    captureInProgress = true;
    try {
      const phaseSequence = nextPhaseIndex + 1;
      const pubsub = await signedCapture('pubsub', phase, phaseSequence, pubsubIdentity, async () =>
        projectPubSubHealth(
          await readHealthJson(fetchImpl, pubsubEndpoint, 'Pub/Sub', requestTimeoutMs)
        )
      );
      const orchestrator = await signedCapture(
        'orchestrator',
        phase,
        phaseSequence,
        orchestratorIdentity,
        async () =>
          projectOrchestratorHealth(
            await readHealthJson(fetchImpl, orchestratorEndpoint, 'orchestrator', requestTimeoutMs)
          )
      );
      const boundary = { pubsub, orchestrator };
      if (requiresOwnership) {
        boundary.ownership = await signedCapture(
          'ownership',
          phase,
          phaseSequence - 1,
          null,
          async (request) => {
            let observation;
            try {
              observation = await captureOptions.collectOwnership(request);
            } catch {
              throw collectorError('ownership observation failed');
            }
            return projectOwnershipObservation(observation, request.observationReceiptId);
          }
        );
      }
      captures[phase] = boundary;
      nextPhaseIndex += 1;
      return structuredClone(boundary);
    } finally {
      captureInProgress = false;
    }
  }

  async function buildVerifierArtifact({ requiredQuietIntervalMs, topologyFreshnessMs }) {
    if (nextPhaseIndex !== CAPTURE_PHASES.length) {
      throw collectorError('complete witness, anchor, read1, and read2 captures are required');
    }
    const verifierInput = assembleDevDrainVerifierInput({
      captures,
      publicKey: signing.publicKey,
      requiredQuietIntervalMs,
      topologyFreshnessMs,
    });
    const { evaluateUnsignedDevDrainEvidence } =
      await import('./dev-hibernation-drain-verifier.mjs');
    const result = evaluateUnsignedDevDrainEvidence(verifierInput);
    const artifact = signArtifact({
      ...signing,
      artifact: {
        evidenceRunId,
        operationNonce,
        createdAt: verifierInput.read2.completedAt,
        sourceRevisions: {
          pubsub: pubsubSourceRevision,
          orchestrator: orchestratorSourceRevision,
        },
        requiredQuietIntervalMs,
        topologyFreshnessMs,
        captures: structuredClone(captures),
        result,
      },
    });
    return structuredClone(artifact);
  }

  return { capture, buildVerifierArtifact };
}

function hostEvidenceError(message) {
  return new Error(`DEV host evidence: ${message}`);
}

function cloneRecord(value, label) {
  try {
    return structuredClone(value);
  } catch {
    throw hostEvidenceError(`${label} violates the privacy-safe contract`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw hostEvidenceError(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

function requireRevision(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw hostEvidenceError(`${label} must be a 40-character revision`);
  }
  return value;
}

function requireOperationNonce(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw hostEvidenceError('operation nonce must encode 256 bits');
  }
  return value;
}

function requireUtcSecond(value, label) {
  if (
    typeof value !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw hostEvidenceError(`${label} must be a canonical UTC-second timestamp`);
  }
  return value;
}

function currentUtcSecond(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw hostEvidenceError('clock is invalid');
  }
  return value.toISOString().replace(/\.[0-9]{3}Z$/u, 'Z');
}

function requireAbsolutePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    !value.startsWith('/') ||
    resolve(value) !== value
  ) {
    throw hostEvidenceError(`${label} must be a canonical absolute path`);
  }
  return value;
}

function requirePathBelow(value, root, label) {
  const canonicalValue = requireAbsolutePath(value, label);
  const canonicalRoot = requireAbsolutePath(root, `${label} root`);
  const child = relative(canonicalRoot, canonicalValue);
  if (child === '' || child.startsWith('..') || child.startsWith('/')) {
    throw hostEvidenceError(`${label} must be below the protected evidence directory`);
  }
  return canonicalValue;
}

function requireSafeString(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw hostEvidenceError(`${label} violates the privacy-safe contract`);
  }
  return value;
}

function requireSafeStringArray(value, label) {
  if (!Array.isArray(value) || value.length > 4096) {
    throw hostEvidenceError(`${label} violates the privacy-safe contract`);
  }
  return value.map((entry, index) => requireSafeString(entry, `${label}[${String(index)}]`));
}

function requireSafeScalarMap(value, label) {
  if (!isRecord(value) || Object.keys(value).length > 4096) {
    throw hostEvidenceError(`${label} violates the privacy-safe contract`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._~+%-]{0,254}$/u.test(key)) {
      throw hostEvidenceError(`${label} violates the privacy-safe contract`);
    }
    if (
      (typeof entry !== 'string' && typeof entry !== 'boolean' && typeof entry !== 'number') ||
      (typeof entry === 'number' && !Number.isFinite(entry)) ||
      (typeof entry === 'string' && (entry.length > 255 || /[\u0000-\u001f\u007f]/u.test(entry)))
    ) {
      throw hostEvidenceError(`${label} violates the privacy-safe contract`);
    }
  }
  return value;
}

function requireReferenceValue(name, value, evidenceRunId, options) {
  const expectedKeys = {
    activeHealth: ['checks', 'evidenceRunId', 'observedAt', 'result'],
    externalIntegrations: ['evidenceRunId', 'observedAt', 'states'],
    secretPackage: ['evidenceRunId', 'observedAt', 'projectionIds', 'version'],
    serviceAccountPrincipal: ['evidenceRunId', 'id', 'kind', 'observedAt'],
  }[name];
  exactKeys(value, expectedKeys, `${name} referenced value`);
  if (value.evidenceRunId !== evidenceRunId) {
    throw hostEvidenceError(`${name} evidence run does not match`);
  }
  const observedAt = requireUtcSecond(value.observedAt, `${name}.observedAt`);
  const observedAtMs = Date.parse(observedAt);
  const nowValue = options.now();
  if (!(nowValue instanceof Date) || !Number.isFinite(nowValue.getTime())) {
    throw hostEvidenceError('capture clock is invalid');
  }
  if (
    observedAtMs > nowValue.getTime() ||
    nowValue.getTime() - observedAtMs > options.maxReferenceAgeMs
  ) {
    throw hostEvidenceError(`${name} reference is not fresh enough for initial capture`);
  }
  if (name === 'activeHealth') {
    if (value.result !== 'PASS') throw hostEvidenceError('active health is not a PASS');
    requireSafeStringArray(value.checks, 'active health checks');
  } else if (name === 'externalIntegrations') {
    requireSafeScalarMap(value.states, 'external integration states');
  } else if (name === 'secretPackage') {
    if (!Number.isSafeInteger(value.version) || value.version < 1) {
      throw hostEvidenceError('secret package version must be a positive integer');
    }
    requireSafeStringArray(value.projectionIds, 'secret package projection IDs');
  } else {
    requireSafeString(value.kind, 'service-account kind');
    requireSafeString(value.id, 'service-account ID');
  }
  return value;
}

function stableFileIdentity(stat) {
  return {
    dev: stat.dev.toString(),
    gid: stat.gid.toString(),
    ino: stat.ino.toString(),
    mode: stat.mode.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    nlink: stat.nlink.toString(),
    size: stat.size.toString(),
    uid: stat.uid.toString(),
  };
}

function readPrivateReferencedObject(path, expectedSha256, embeddedValue, options, name) {
  const canonicalRoot = realpathSync(options.evidenceDirectory);
  const canonicalPath = realpathSync(path);
  const child = relative(canonicalRoot, canonicalPath);
  if (child === '' || child.startsWith('..') || child.startsWith('/')) {
    throw hostEvidenceError(`${name} path escapes the protected evidence directory`);
  }
  if (canonicalPath !== path) {
    throw hostEvidenceError(`${name} path is not canonical or contains a symlink`);
  }
  const ownerId = options.referenceOwnerId ?? 0;
  const groupId = options.referenceGroupId ?? 0;
  const before = lstatSync(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    (before.mode & 0o777n) !== 0o600n ||
    before.uid !== BigInt(ownerId) ||
    before.gid !== BigInt(groupId)
  ) {
    throw hostEvidenceError(`${name} referenced file metadata is unsafe`);
  }
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor, { bigint: true });
    if (canonicalJson(stableFileIdentity(opened)) !== canonicalJson(stableFileIdentity(before))) {
      throw hostEvidenceError(`${name} referenced file changed before open`);
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength > MAX_HEALTH_RESPONSE_BYTES) {
      throw hostEvidenceError(`${name} referenced file exceeds the safe limit`);
    }
    options.referenceReadHook?.(path, name);
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true });
    if (
      canonicalJson(stableFileIdentity(afterDescriptor)) !==
        canonicalJson(stableFileIdentity(before)) ||
      canonicalJson(stableFileIdentity(afterPath)) !== canonicalJson(stableFileIdentity(before))
    ) {
      throw hostEvidenceError(`${name} referenced file changed during read`);
    }
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw hostEvidenceError(`${name} referenced file hash mismatch`);
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw hostEvidenceError(`${name} referenced file is invalid JSON`);
    }
    const canonicalBytes = Buffer.from(`${canonicalJson(parsed)}\n`, 'utf8');
    if (!bytes.equals(canonicalBytes)) {
      throw hostEvidenceError(`${name} referenced file is not canonical JSON`);
    }
    if (canonicalJson(parsed) !== canonicalJson(embeddedValue)) {
      throw hostEvidenceError(`${name} embedded value differs from referenced bytes`);
    }
    return parsed;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireStringSet(actual, expected, label) {
  if (
    !Array.isArray(expected) ||
    expected.some((entry) => typeof entry !== 'string') ||
    actual.length !== expected.length ||
    [...actual].sort().some((entry, index) => entry !== [...expected].sort()[index])
  ) {
    throw hostEvidenceError(`${label} differs from the installed policy`);
  }
}

/**
 * Builds the immutable M8 configuration snapshot. Freshness is a capture-time property here;
 * consumers later verify its bytes and references by hash without expiring the rollback snapshot.
 */
export function buildLastGoodActiveState(input, options) {
  const candidate = cloneRecord(input, 'last-good input');
  exactKeys(candidate, LAST_GOOD_KEYS, 'last-good input');
  if (!isRecord(options)) throw hostEvidenceError('last-good options are required');
  if (
    !Number.isSafeInteger(options.maxReferenceAgeMs) ||
    options.maxReferenceAgeMs < 1 ||
    typeof options.now !== 'function'
  ) {
    throw hostEvidenceError('last-good freshness options are invalid');
  }
  const evidenceRunId = validateEvidenceRunId(candidate.evidenceRunId);
  const intexuraosRevision = requireRevision(candidate.intexuraosRevision, 'IntexuraOS revision');
  requireRevision(candidate.pbuchmanDevRevision, 'pbuchman-dev revision');
  requireSha256(candidate.installManifestSha256, 'install manifest');
  if (candidate.schemaVersion !== 1) throw hostEvidenceError('last-good schema version is invalid');

  exactKeys(candidate.profile, ['mode', 'path', 'revision', 'sha256'], 'last-good profile');
  const expectedProfilePath = `${requireAbsolutePath(options.profileRoot, 'profile root')}/${intexuraosRevision}/active-post-cutover.caddy`;
  if (
    candidate.profile.mode !== 'active-post-cutover' ||
    candidate.profile.revision !== intexuraosRevision ||
    candidate.profile.path !== expectedProfilePath
  ) {
    throw hostEvidenceError('last-good profile identity is invalid');
  }
  requireSha256(candidate.profile.sha256, 'profile');

  if (!isRecord(candidate.unitFileStates)) {
    throw hostEvidenceError('unit file states violate the privacy-safe contract');
  }
  requireStringSet(Object.keys(candidate.unitFileStates), options.expectedUnits, 'unit file set');
  for (const state of Object.values(candidate.unitFileStates)) {
    if (state !== 'enabled' && state !== 'disabled') {
      throw hostEvidenceError('unit file state must be enabled or disabled');
    }
  }
  if (
    !Array.isArray(candidate.expectedCandidatePorts) ||
    candidate.expectedCandidatePorts.length !== options.expectedCandidatePorts?.length ||
    candidate.expectedCandidatePorts.some(
      (port, index) =>
        !Number.isSafeInteger(port) ||
        port < 1 ||
        port > 65535 ||
        port !== options.expectedCandidatePorts[index]
    )
  ) {
    throw hostEvidenceError('candidate ports differ from the installed policy');
  }

  const expectedStaticTarget = `${requireAbsolutePath(options.staticReleaseRoot, 'static release root')}/${intexuraosRevision}`;
  if (candidate.staticReleaseTarget !== expectedStaticTarget) {
    throw hostEvidenceError('static release target is invalid');
  }
  if (
    !isRecord(candidate.staticReleaseFiles) ||
    Object.keys(candidate.staticReleaseFiles).length < 1
  ) {
    throw hostEvidenceError('static release file set is empty');
  }
  for (const [path, sha256] of Object.entries(candidate.staticReleaseFiles)) {
    if (
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      path.length < 1 ||
      path.length > 4096
    ) {
      throw hostEvidenceError('static release file path is unsafe');
    }
    requireSha256(sha256, `static release file ${path}`);
  }

  requireAbsolutePath(candidate.pm2EcosystemPath, 'PM2 ecosystem path');
  requireSha256(candidate.pm2EcosystemSha256, 'PM2 ecosystem');
  if (!Array.isArray(candidate.pm2Processes) || candidate.pm2Processes.length < 1) {
    throw hostEvidenceError('PM2 process set is empty');
  }
  const processNames = new Set();
  for (const process of candidate.pm2Processes) {
    exactKeys(process, ['cwd', 'execPath', 'name', 'status'], 'PM2 process');
    requireAbsolutePath(process.cwd, 'PM2 cwd');
    requireAbsolutePath(process.execPath, 'PM2 executable');
    requireSafeString(process.name, 'PM2 process name');
    if (process.status !== 'online' || processNames.has(process.name)) {
      throw hostEvidenceError('PM2 process set is invalid');
    }
    processNames.add(process.name);
  }
  if (candidate.composeCheckoutRevision !== intexuraosRevision) {
    throw hostEvidenceError('compose checkout revision is invalid');
  }
  requireSha256(candidate.composeFileSha256, 'compose file');
  if (
    !Array.isArray(candidate.imageDigests) ||
    candidate.imageDigests.length !== 2 ||
    new Set(candidate.imageDigests).size !== 2 ||
    candidate.imageDigests.some(
      (image) => typeof image !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(image)
    )
  ) {
    throw hostEvidenceError('candidate image IDs are invalid');
  }

  exactKeys(candidate.referencedObjects, REFERENCED_OBJECT_NAMES, 'last-good referenced objects');
  for (const name of REFERENCED_OBJECT_NAMES) {
    const reference = candidate.referencedObjects[name];
    exactKeys(reference, ['path', 'sha256', 'value'], `${name} referenced object`);
    requirePathBelow(reference.path, options.evidenceDirectory, `${name} path`);
    requireSha256(reference.sha256, `${name} artifact`);
    const referencedValue = readPrivateReferencedObject(
      reference.path,
      reference.sha256,
      reference.value,
      options,
      name
    );
    requireReferenceValue(name, referencedValue, evidenceRunId, options);
  }

  exactKeys(candidate.devDrainSourceRevisions, ['orchestrator', 'pubsub'], 'drain revisions');
  validateSourceRevision(candidate.devDrainSourceRevisions.orchestrator, 'orchestrator');
  validateSourceRevision(candidate.devDrainSourceRevisions.pubsub, 'Pub/Sub');
  requireSha256(candidate.devDrainNodeSha256, 'drain Node executable');
  if (
    typeof candidate.devDrainNodeVersion !== 'string' ||
    !/^v[0-9]+\.[0-9]+\.[0-9]+$/u.test(candidate.devDrainNodeVersion)
  ) {
    throw hostEvidenceError('drain Node version is invalid');
  }
  if (!isRecord(candidate.devDrainVerifierSources)) {
    throw hostEvidenceError('drain verifier sources violate the privacy-safe contract');
  }
  requireStringSet(
    Object.keys(candidate.devDrainVerifierSources),
    options.expectedVerifierSources,
    'drain verifier source set'
  );
  for (const [path, sha256] of Object.entries(candidate.devDrainVerifierSources)) {
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw hostEvidenceError('drain verifier source path is unsafe');
    }
    requireSha256(sha256, `drain verifier source ${path}`);
  }
  return deepFreeze(candidate);
}

export function buildAlloyFlushEvidence(input) {
  const candidate = cloneRecord(input, 'Alloy evidence');
  exactKeys(candidate, ALLOY_EVIDENCE_KEYS, 'Alloy evidence');
  if (
    candidate.schemaVersion !== 1 ||
    candidate.result !== 'PASS' ||
    candidate.pm2Only !== true ||
    candidate.bufferFlushComplete !== true
  ) {
    throw hostEvidenceError('Alloy evidence cannot declare PASS without a complete PM2-only flush');
  }
  validateEvidenceRunId(candidate.evidenceRunId);
  requireOperationNonce(candidate.operationNonce);
  requireUtcSecond(candidate.observedAt, 'Alloy observedAt');
  return deepFreeze(candidate);
}

export function buildDevHostObservabilityFence(input) {
  const candidate = cloneRecord(input, 'observability fence');
  exactKeys(candidate, OBSERVABILITY_FENCE_KEYS, 'observability fence');
  if (
    candidate.schemaVersion !== 1 ||
    candidate.artifactType !== 'dev-host-observability-fence' ||
    (candidate.phase !== 'terminal-log-tail' && candidate.phase !== 'final-alloy-flush') ||
    candidate.result !== 'PASS' ||
    candidate.continuityHealthy !== true ||
    candidate.terminalTailComplete !== true ||
    candidate.bufferFlushComplete !== true ||
    candidate.pendingBufferCount !== 0
  ) {
    throw hostEvidenceError('observability fence cannot declare PASS without complete proof');
  }
  validateEvidenceRunId(candidate.evidenceRunId);
  requireOperationNonce(candidate.operationNonce);
  requireUtcSecond(candidate.observedAt, 'observability fence observedAt');
  return deepFreeze(candidate);
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function publishImmutableEvidence({
  directory,
  fileName,
  value,
  ownerId = process.getuid?.() ?? 0,
  groupId = process.getgid?.() ?? 0,
  beforePublish,
}) {
  if (
    typeof fileName !== 'string' ||
    fileName !== basename(fileName) ||
    fileName.startsWith('.') ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.json$/u.test(fileName)
  ) {
    throw hostEvidenceError('evidence file name is unsafe');
  }
  const canonicalDirectory = realpathSync(requireAbsolutePath(directory, 'evidence directory'));
  if (canonicalDirectory !== directory) {
    throw hostEvidenceError('evidence directory must be canonical');
  }
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    directoryStat.uid !== ownerId ||
    directoryStat.gid !== groupId ||
    (directoryStat.mode & 0o022) !== 0
  ) {
    throw hostEvidenceError('evidence directory ownership or mode is unsafe');
  }
  const finalPath = join(directory, fileName);
  if (lstatIfPresent(finalPath) !== null) {
    throw hostEvidenceError(`evidence already exists: ${fileName}`);
  }
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
  const suffix = randomBytes(16).toString('hex');
  const lockPath = join(
    directory,
    `.publish-${createHash('sha256').update(fileName).digest('hex')}.lock`
  );
  const temporaryPath = join(directory, `.evidence-${suffix}.tmp`);
  let lockDescriptor;
  let temporaryDescriptor;
  let directoryDescriptor;
  let published = false;
  try {
    lockDescriptor = openSync(
      lockPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600
    );
    writeFileSync(lockDescriptor, `${String(process.pid)}\n`, 'utf8');
    fsyncSync(lockDescriptor);
    closeSync(lockDescriptor);
    lockDescriptor = undefined;
    if (lstatIfPresent(finalPath) !== null) {
      throw hostEvidenceError(`evidence already exists: ${fileName}`);
    }
    temporaryDescriptor = openSync(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600
    );
    writeFileSync(temporaryDescriptor, bytes);
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;
    chmodSync(temporaryPath, 0o600);
    if (lstatIfPresent(finalPath) !== null) {
      throw hostEvidenceError(`evidence already exists: ${fileName}`);
    }
    beforePublish?.({ finalPath, temporaryPath });
    try {
      // link is the no-clobber publication primitive: it atomically installs the already-fsynced
      // inode and fails with EEXIST if any writer won the final name after the preceding check.
      linkSync(temporaryPath, finalPath);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw hostEvidenceError(`evidence already exists: ${fileName}`);
      }
      throw error;
    }
    unlinkSync(temporaryPath);
    published = true;
    directoryDescriptor = openSync(directory, fsConstants.O_RDONLY);
    fsyncSync(directoryDescriptor);
    closeSync(directoryDescriptor);
    directoryDescriptor = undefined;
    const finalStat = lstatSync(finalPath);
    if (
      !finalStat.isFile() ||
      finalStat.uid !== ownerId ||
      finalStat.gid !== groupId ||
      (finalStat.mode & 0o777) !== 0o600 ||
      finalStat.nlink !== 1
    ) {
      throw hostEvidenceError('published evidence metadata is unsafe');
    }
    const publishedBytes = readFileSync(finalPath);
    if (!publishedBytes.equals(bytes)) {
      throw hostEvidenceError('published evidence bytes changed');
    }
    return deepFreeze({
      fileName,
      path: finalPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  } finally {
    if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
    if (!published && lstatIfPresent(temporaryPath) !== null) unlinkSync(temporaryPath);
    if (lstatIfPresent(lockPath) !== null) unlinkSync(lockPath);
  }
}

const ALLOY_SNAPSHOT_KEYS = [
  'capturedAt',
  'configSha256',
  'invocationId',
  'mainPid',
  'pm2Only',
  'source',
  'write',
];
const ALLOY_SOURCE_KEYS = [
  'activeFilesTotal',
  'fileBytesTotal',
  'readBytesTotal',
  'readLinesTotal',
];
const ALLOY_WRITE_KEYS = ['batchRetriesTotal', 'droppedEntriesTotal', 'sentEntriesTotal'];

function validateAlloySnapshot(value) {
  exactKeys(value, ALLOY_SNAPSHOT_KEYS, 'Alloy snapshot');
  exactKeys(value.source, ALLOY_SOURCE_KEYS, 'Alloy source metrics');
  exactKeys(value.write, ALLOY_WRITE_KEYS, 'Alloy write metrics');
  requireUtcSecond(value.capturedAt, 'Alloy snapshot timestamp');
  requireSha256(value.configSha256, 'Alloy config');
  if (
    typeof value.invocationId !== 'string' ||
    !/^[0-9a-f]{32,64}$/u.test(value.invocationId) ||
    !Number.isSafeInteger(value.mainPid) ||
    value.mainPid < 1 ||
    value.pm2Only !== true
  ) {
    throw hostEvidenceError('Alloy process identity or ownership is invalid');
  }
  for (const [name, count] of [...Object.entries(value.source), ...Object.entries(value.write)]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw hostEvidenceError(`Alloy metric ${name} is invalid`);
    }
  }
  return value;
}

function equalMetrics(left, right) {
  return (
    canonicalJson({ source: left.source, write: left.write }) ===
    canonicalJson({
      source: right.source,
      write: right.write,
    })
  );
}

export function evaluateAlloyFlushProof({
  baseline,
  first,
  second,
  expectedFileCount,
  minimumStableIntervalMs = 20_000,
}) {
  const reasons = [];
  let baselineValue;
  let firstValue;
  let secondValue;
  try {
    baselineValue = validateAlloySnapshot(cloneRecord(baseline, 'Alloy baseline'));
    firstValue = validateAlloySnapshot(cloneRecord(first, 'Alloy first proof'));
    secondValue = validateAlloySnapshot(cloneRecord(second, 'Alloy second proof'));
  } catch {
    return { pendingBufferCount: null, reasons: ['invalid-alloy-snapshot'], status: 'UNKNOWN' };
  }
  if (!Number.isSafeInteger(expectedFileCount) || expectedFileCount < 1) {
    return {
      pendingBufferCount: null,
      reasons: ['invalid-expected-file-count'],
      status: 'UNKNOWN',
    };
  }
  if (!Number.isSafeInteger(minimumStableIntervalMs) || minimumStableIntervalMs < 1_000) {
    return { pendingBufferCount: null, reasons: ['invalid-stable-interval'], status: 'UNKNOWN' };
  }
  const baselineTime = Date.parse(baselineValue.capturedAt);
  const firstTime = Date.parse(firstValue.capturedAt);
  const secondTime = Date.parse(secondValue.capturedAt);
  if (firstTime < baselineTime || secondTime <= firstTime) {
    reasons.push('alloy-scrape-clock-regressed');
  }
  if (secondTime - firstTime < minimumStableIntervalMs) {
    reasons.push('alloy-stable-interval-too-short');
  }
  const identity = ({ invocationId, mainPid, configSha256 }) => ({
    configSha256,
    invocationId,
    mainPid,
  });
  if (
    canonicalJson(identity(baselineValue)) !== canonicalJson(identity(firstValue)) ||
    canonicalJson(identity(firstValue)) !== canonicalJson(identity(secondValue))
  ) {
    reasons.push('alloy-continuity-changed');
  }
  for (const group of ['source', 'write']) {
    for (const key of Object.keys(baselineValue[group])) {
      if (
        firstValue[group][key] < baselineValue[group][key] ||
        secondValue[group][key] < firstValue[group][key]
      ) {
        reasons.push(`alloy-counter-decreased:${group}.${key}`);
      }
    }
  }
  if (!equalMetrics(firstValue, secondValue)) reasons.push('alloy-proof-not-stable');
  if (secondValue.source.activeFilesTotal !== expectedFileCount) {
    reasons.push('alloy-active-file-count-mismatch');
  }
  if (secondValue.source.readBytesTotal !== secondValue.source.fileBytesTotal) {
    reasons.push('alloy-file-tail-incomplete');
  }
  if (secondValue.write.droppedEntriesTotal !== baselineValue.write.droppedEntriesTotal) {
    reasons.push('alloy-dropped-entries-advanced');
  }
  if (secondValue.write.batchRetriesTotal !== baselineValue.write.batchRetriesTotal) {
    reasons.push('alloy-retries-advanced');
  }
  const pendingBufferCount =
    secondValue.source.readLinesTotal -
    secondValue.write.sentEntriesTotal -
    secondValue.write.droppedEntriesTotal;
  if (!Number.isSafeInteger(pendingBufferCount) || pendingBufferCount < 0) {
    reasons.push('alloy-conservation-invalid');
  } else if (pendingBufferCount !== 0) {
    reasons.push('alloy-buffer-not-empty');
  }
  return {
    pendingBufferCount: Number.isSafeInteger(pendingBufferCount) ? pendingBufferCount : null,
    reasons,
    status: reasons.length === 0 ? 'PASS' : 'UNKNOWN',
  };
}

function parseMetricLabels(raw) {
  const labels = {};
  if (raw === undefined || raw === '') return labels;
  const matcher = /(?:^|,)([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"\\])*)"/gu;
  let cursor = 0;
  for (const match of raw.matchAll(matcher)) {
    if (match.index !== cursor) throw hostEvidenceError('invalid Alloy metric labels');
    labels[match[1]] = match[2].replace(/\\([\\"n])/gu, (_all, escaped) =>
      escaped === 'n' ? '\n' : escaped
    );
    cursor = match.index + match[0].length;
  }
  if (cursor !== raw.length) throw hostEvidenceError('invalid Alloy metric labels');
  return labels;
}

export function parseAlloyDebugMetrics(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_HEALTH_RESPONSE_BYTES) {
    throw hostEvidenceError('Alloy metrics response is invalid');
  }
  const expected = {
    loki_source_file_files_active_total: [],
    loki_source_file_file_bytes_total: [],
    loki_source_file_read_bytes_total: [],
    loki_source_file_read_lines_total: [],
    loki_write_batch_retries_total: [],
    loki_write_dropped_entries_total: [],
    loki_write_sent_entries_total: [],
  };
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)(?:\s+[^\s]+)?$/u.exec(
      line
    );
    if (match === null || !(match[1] in expected)) continue;
    const labels = parseMetricLabels(match[2]);
    const isSource = match[1].startsWith('loki_source_file_');
    if (isSource && labels.component_id !== 'loki.source.file.pm2_logs') continue;
    if (!isSource) {
      if (
        labels.component_id !== 'loki.write.grafana_cloud' ||
        labels.endpoint !== 'pm2_grafana_cloud'
      ) {
        continue;
      }
    }
    const value = Number(match[3]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw hostEvidenceError(`invalid Alloy metric ${match[1]}`);
    }
    expected[match[1]].push(value);
  }
  for (const [name, values] of Object.entries(expected)) {
    if (values.length === 0) throw hostEvidenceError(`missing Alloy metric ${name}`);
  }
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return deepFreeze({
    source: {
      activeFilesTotal: sum(expected.loki_source_file_files_active_total),
      fileBytesTotal: sum(expected.loki_source_file_file_bytes_total),
      readBytesTotal: sum(expected.loki_source_file_read_bytes_total),
      readLinesTotal: sum(expected.loki_source_file_read_lines_total),
    },
    write: {
      batchRetriesTotal: sum(expected.loki_write_batch_retries_total),
      droppedEntriesTotal: sum(expected.loki_write_dropped_entries_total),
      sentEntriesTotal: sum(expected.loki_write_sent_entries_total),
    },
  });
}

function validateUnitObservation(value, name) {
  exactKeys(value, ['activeState', 'invocationId', 'mainPid'], `unit ${name}`);
  if (value.activeState === 'active') {
    if (
      typeof value.invocationId !== 'string' ||
      !/^[0-9a-f]{32,64}$/u.test(value.invocationId) ||
      !Number.isSafeInteger(value.mainPid) ||
      value.mainPid < 1
    ) {
      throw hostEvidenceError(`active unit ${name} identity is invalid`);
    }
  } else if (value.activeState !== 'inactive' || value.invocationId !== '' || value.mainPid !== 0) {
    throw hostEvidenceError(`inactive unit ${name} identity is invalid`);
  }
  return value;
}

function validateHostObservation(value) {
  exactKeys(
    value,
    ['alloy', 'capturedAt', 'logServer', 'terminalTail', 'units'],
    'host observation'
  );
  requireUtcSecond(value.capturedAt, 'host observation timestamp');
  exactKeys(value.units, HOST_UNIT_NAMES, 'host unit observations');
  for (const unit of HOST_UNIT_NAMES) validateUnitObservation(value.units[unit], unit);
  exactKeys(value.logServer, ['childProcessCount', 'clients'], 'log server observation');
  exactKeys(
    value.terminalTail,
    ['complete', 'expectedMarkerCount', 'observedMarkerCount'],
    'terminal tail observation'
  );
  for (const count of [
    value.logServer.childProcessCount,
    value.logServer.clients,
    value.terminalTail.expectedMarkerCount,
    value.terminalTail.observedMarkerCount,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw hostEvidenceError('host observation count is invalid');
    }
  }
  if (typeof value.terminalTail.complete !== 'boolean') {
    throw hostEvidenceError('terminal-tail completeness is invalid');
  }
  validateAlloySnapshot(value.alloy);
  if (value.alloy.capturedAt !== value.capturedAt) {
    throw hostEvidenceError('host and Alloy observation timestamps differ');
  }
  return value;
}

function unitsHaveState(snapshot, active, inactive) {
  return (
    active.every((unit) => snapshot.units[unit].activeState === 'active') &&
    inactive.every((unit) => snapshot.units[unit].activeState === 'inactive')
  );
}

function activeUnitContinuity(baseline, current, unitsToCheck) {
  return unitsToCheck.every(
    (unit) =>
      current.units[unit].activeState === 'active' &&
      current.units[unit].mainPid === baseline.units[unit].mainPid &&
      current.units[unit].invocationId === baseline.units[unit].invocationId
  );
}

function terminalTailPass(snapshot) {
  return (
    snapshot.terminalTail.complete === true &&
    snapshot.terminalTail.expectedMarkerCount > 0 &&
    snapshot.terminalTail.observedMarkerCount === snapshot.terminalTail.expectedMarkerCount &&
    snapshot.logServer.clients === 0 &&
    snapshot.logServer.childProcessCount === 0
  );
}

export async function runDevHostObservabilityObserver(options) {
  if (!isRecord(options)) throw hostEvidenceError('observer options are required');
  const evidenceRunId = validateEvidenceRunId(options.evidenceRunId);
  const operationNonce = requireOperationNonce(options.operationNonce);
  if (
    typeof options.getSnapshot !== 'function' ||
    typeof options.publish !== 'function' ||
    typeof options.sleep !== 'function' ||
    typeof options.now !== 'function' ||
    !Number.isSafeInteger(options.maxPolls) ||
    options.maxPolls < 2 ||
    !Number.isSafeInteger(options.minimumStableIntervalMs ?? 20_000) ||
    (options.minimumStableIntervalMs ?? 20_000) < 1_000 ||
    !Number.isSafeInteger(options.maxSnapshotAgeMs ?? 30_000) ||
    (options.maxSnapshotAgeMs ?? 30_000) < (options.minimumStableIntervalMs ?? 20_000)
  ) {
    throw hostEvidenceError('observer options are invalid');
  }
  const publications = [];
  const minimumStableIntervalMs = options.minimumStableIntervalMs ?? 20_000;
  const maxSnapshotAgeMs = options.maxSnapshotAgeMs ?? 30_000;
  const publish = async (fileName, value) => {
    const publication = { fileName, value };
    const result = await options.publish(publication);
    publications.push(result);
    return result;
  };
  let polls = 0;
  let baseline;
  try {
    baseline = validateHostObservation(cloneRecord(await options.getSnapshot(), 'host baseline'));
    polls += 1;
  } catch {
    return { publications, reasons: ['invalid-host-baseline'], result: 'UNKNOWN' };
  }
  if (!unitsHaveState(baseline, HOST_UNIT_NAMES, [])) {
    return { publications, reasons: ['baseline-units-not-active'], result: 'UNKNOWN' };
  }
  const snapshotFreshAt = (snapshot, nowValue) => {
    const capturedAt = Date.parse(snapshot.capturedAt);
    return capturedAt <= nowValue.getTime() && nowValue.getTime() - capturedAt <= maxSnapshotAgeMs;
  };
  let observationNow = options.now();
  if (!(observationNow instanceof Date) || !Number.isFinite(observationNow.getTime())) {
    return { publications, reasons: ['invalid-observer-clock'], result: 'UNKNOWN' };
  }
  if (!snapshotFreshAt(baseline, observationNow)) {
    return { publications, reasons: ['stale-host-baseline'], result: 'UNKNOWN' };
  }
  let lastCapturedAtMs = Date.parse(baseline.capturedAt);

  let preflightFirst = baseline;
  let terminalFirst = null;
  let finalFirst = null;
  let phase = 'preflight';
  while (polls < options.maxPolls) {
    await options.sleep();
    let current;
    try {
      current = validateHostObservation(
        cloneRecord(await options.getSnapshot(), 'host observation')
      );
      polls += 1;
    } catch {
      return { publications, reasons: ['invalid-host-observation'], result: 'UNKNOWN' };
    }
    observationNow = options.now();
    if (
      !(observationNow instanceof Date) ||
      !Number.isFinite(observationNow.getTime()) ||
      !snapshotFreshAt(current, observationNow)
    ) {
      return { publications, reasons: ['stale-host-observation'], result: 'UNKNOWN' };
    }
    const currentCapturedAtMs = Date.parse(current.capturedAt);
    if (currentCapturedAtMs <= lastCapturedAtMs) {
      return {
        publications,
        reasons: ['host-observation-clock-did-not-advance'],
        result: 'UNKNOWN',
      };
    }
    lastCapturedAtMs = currentCapturedAtMs;
    if (
      current.units['alloy.service'].activeState !== 'active' ||
      !activeUnitContinuity(baseline, current, ['alloy.service'])
    ) {
      return { publications, reasons: ['alloy-continuity-changed'], result: 'UNKNOWN' };
    }

    if (phase === 'preflight') {
      if (!unitsHaveState(current, HOST_UNIT_NAMES, [])) {
        return { publications, reasons: ['runtime-stopped-before-preflight'], result: 'UNKNOWN' };
      }
      const proof = evaluateAlloyFlushProof({
        baseline: baseline.alloy,
        expectedFileCount: baseline.alloy.source.activeFilesTotal,
        first: preflightFirst.alloy,
        minimumStableIntervalMs,
        second: current.alloy,
      });
      if (proof.status === 'PASS') {
        const value = buildAlloyFlushEvidence({
          bufferFlushComplete: true,
          evidenceRunId,
          observedAt: current.capturedAt,
          operationNonce,
          pm2Only: true,
          result: 'PASS',
          schemaVersion: 1,
        });
        try {
          await publish(`alloy-flush-${operationNonce}.json`, value);
        } catch {
          return { publications, reasons: ['preflight-publication-failed'], result: 'UNKNOWN' };
        }
        phase = 'terminal';
      } else {
        preflightFirst = current;
      }
      continue;
    }

    if (phase === 'terminal') {
      const terminalActive = [
        'pm2-journal-bridge.service',
        'intexuraos-log-viewer.service',
        'intexuraos-log-server.service',
        'alloy.service',
      ];
      const terminalInactive = ['pm2-pbuchman.service', 'intexuraos-emulators.service'];
      if (!unitsHaveState(current, terminalActive, terminalInactive)) {
        continue;
      }
      if (!activeUnitContinuity(baseline, current, terminalActive)) {
        return { publications, reasons: ['terminal-unit-continuity-changed'], result: 'UNKNOWN' };
      }
      if (!terminalTailPass(current)) {
        terminalFirst = null;
        continue;
      }
      if (terminalFirst === null) {
        terminalFirst = current;
        continue;
      }
      const proof = evaluateAlloyFlushProof({
        baseline: baseline.alloy,
        expectedFileCount: baseline.alloy.source.activeFilesTotal,
        first: terminalFirst.alloy,
        minimumStableIntervalMs,
        second: current.alloy,
      });
      if (proof.status !== 'PASS') {
        terminalFirst = current;
        continue;
      }
      const value = buildDevHostObservabilityFence({
        artifactType: 'dev-host-observability-fence',
        bufferFlushComplete: true,
        continuityHealthy: true,
        evidenceRunId,
        observedAt: current.capturedAt,
        operationNonce,
        pendingBufferCount: 0,
        phase: 'terminal-log-tail',
        result: 'PASS',
        schemaVersion: 1,
        terminalTailComplete: true,
      });
      try {
        await publish(`terminal-log-tail-${operationNonce}.json`, value);
      } catch {
        return { publications, reasons: ['terminal-publication-failed'], result: 'UNKNOWN' };
      }
      phase = 'final';
      continue;
    }

    const finalActive = ['alloy.service'];
    const finalInactive = HOST_UNIT_NAMES.filter((unit) => unit !== 'alloy.service');
    if (!unitsHaveState(current, finalActive, finalInactive)) continue;
    if (!terminalTailPass(current)) {
      finalFirst = null;
      continue;
    }
    if (finalFirst === null) {
      finalFirst = current;
      continue;
    }
    const proof = evaluateAlloyFlushProof({
      baseline: baseline.alloy,
      expectedFileCount: baseline.alloy.source.activeFilesTotal,
      first: finalFirst.alloy,
      minimumStableIntervalMs,
      second: current.alloy,
    });
    if (proof.status !== 'PASS') {
      finalFirst = current;
      continue;
    }
    const value = buildDevHostObservabilityFence({
      artifactType: 'dev-host-observability-fence',
      bufferFlushComplete: true,
      continuityHealthy: true,
      evidenceRunId,
      observedAt: current.capturedAt,
      operationNonce,
      pendingBufferCount: 0,
      phase: 'final-alloy-flush',
      result: 'PASS',
      schemaVersion: 1,
      terminalTailComplete: true,
    });
    try {
      await publish(`final-alloy-flush-${operationNonce}.json`, value);
    } catch {
      return { publications, reasons: ['final-publication-failed'], result: 'UNKNOWN' };
    }
    return { publications, reasons: [], result: 'PASS' };
  }
  return { publications, reasons: [`observer-timeout:${phase}`], result: 'UNKNOWN' };
}

export function inspectAlloyPm2OnlyConfig(
  text,
  expectedLogGlob = '/home/pbuchman/.pm2/logs/*.log'
) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_HEALTH_RESPONSE_BYTES) {
    return false;
  }
  const sources = [...text.matchAll(/^\s*loki\.source\.([a-z0-9_]+)\s+"([^"]+)"\s*\{/gmu)];
  const writes = [...text.matchAll(/^\s*loki\.write\s+"([^"]+)"\s*\{/gmu)];
  const stages = [...text.matchAll(/^\s*stage\.([a-z0-9_]+)(?:\s|\{)/gmu)].map((match) => match[1]);
  return (
    sources.length === 1 &&
    sources[0][1] === 'file' &&
    sources[0][2] === 'pm2_logs' &&
    writes.length === 1 &&
    writes[0][1] === 'grafana_cloud' &&
    stages.length === 1 &&
    stages[0] === 'decolorize' &&
    text.includes(`__path__         = ${JSON.stringify(expectedLogGlob)},`) &&
    text.includes('forward_to = [loki.relabel.pm2_labels.receiver]') &&
    text.includes('forward_to = [loki.process.pm2_logs.receiver]') &&
    text.includes('forward_to = [loki.write.grafana_cloud.receiver]') &&
    text.includes('sync_period = "10s"') &&
    text.includes('name     = "pm2_grafana_cloud"')
  );
}

function commandOutput(execute, command, args) {
  return execute(command, args, {
    encoding: 'utf8',
    env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin' },
    maxBuffer: MAX_HEALTH_RESPONSE_BYTES,
    timeout: 10_000,
  });
}

function readSystemdUnit(execute, unit) {
  const output = commandOutput(execute, '/usr/bin/systemctl', [
    'show',
    unit,
    '--property=ActiveState',
    '--property=InvocationID',
    '--property=MainPID',
    '--no-pager',
  ]);
  const values = Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=');
        if (separator < 1) throw hostEvidenceError(`cannot parse systemd identity for ${unit}`);
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
  exactKeys(values, ['ActiveState', 'InvocationID', 'MainPID'], `systemd identity ${unit}`);
  if (values.ActiveState === 'inactive') {
    return { activeState: 'inactive', invocationId: '', mainPid: 0 };
  }
  const mainPid = Number(values.MainPID);
  if (
    values.ActiveState !== 'active' ||
    !/^[0-9a-f]{32,64}$/u.test(values.InvocationID) ||
    !Number.isSafeInteger(mainPid) ||
    mainPid < 1
  ) {
    throw hostEvidenceError(`systemd identity for ${unit} is not provably active or inactive`);
  }
  return { activeState: 'active', invocationId: values.InvocationID, mainPid };
}

function logFileIdentity(stat) {
  return {
    dev: stat.dev,
    gid: stat.gid,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    uid: stat.uid,
  };
}

function enumeratePm2LogFiles(directory) {
  const canonicalDirectory = realpathSync(directory);
  if (canonicalDirectory !== directory) {
    throw hostEvidenceError('PM2 log directory is not canonical');
  }
  const files = readdirSync(directory)
    .filter((name) => /-(?:out|error)\.log$/u.test(name))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o022) !== 0 ||
        realpathSync(path) !== path
      ) {
        throw hostEvidenceError(`unsafe PM2 log source: ${name}`);
      }
      return { identity: logFileIdentity(stat), name, path, size: stat.size };
    });
  if (files.length < 1 || files.length > 4096) {
    throw hostEvidenceError('PM2 log source set is empty or unbounded');
  }
  return files;
}

function requireStableLogFiles(baseline, current) {
  if (baseline.length !== current.length) throw hostEvidenceError('PM2 log file set changed');
  for (let index = 0; index < baseline.length; index += 1) {
    if (
      baseline[index].path !== current[index].path ||
      canonicalJson(baseline[index].identity) !== canonicalJson(current[index].identity)
    ) {
      throw hostEvidenceError('PM2 log file identity changed');
    }
  }
}

function readCgroupPids(unit) {
  const path = `/sys/fs/cgroup/system.slice/${unit}/cgroup.procs`;
  const text = readFileSync(path, 'utf8').trim();
  if (text === '') return [];
  const pids = text.split('\n').map(Number);
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid < 1)) {
    throw hostEvidenceError(`invalid cgroup membership for ${unit}`);
  }
  return pids;
}

function bridgeOpenFilesCoverLogs(logFiles) {
  const opened = new Set();
  for (const pid of readCgroupPids('pm2-journal-bridge.service')) {
    const descriptorDirectory = `/proc/${String(pid)}/fd`;
    for (const descriptor of readdirSync(descriptorDirectory)) {
      try {
        const target = readlinkSync(join(descriptorDirectory, descriptor));
        if (target.startsWith('/')) opened.add(target.replace(/ \(deleted\)$/u, ''));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return logFiles.every(({ path }) => opened.has(path));
}

function markerFor(logFile, evidenceRunId, operationNonce) {
  const digest = createHash('sha256')
    .update(
      canonicalJson([
        evidenceRunId,
        operationNonce,
        logFile.name,
        logFile.identity.dev,
        logFile.identity.ino,
      ])
    )
    .digest('hex');
  return `intexuraos-dev-hibernation-marker:${digest}`;
}

function appendTerminalMarkers(logFiles, evidenceRunId, operationNonce) {
  for (const logFile of logFiles) {
    let descriptor;
    try {
      descriptor = openSync(
        logFile.path,
        fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW
      );
      const opened = fstatSync(descriptor);
      if (canonicalJson(logFileIdentity(opened)) !== canonicalJson(logFile.identity)) {
        throw hostEvidenceError(`PM2 log changed before terminal marker: ${logFile.name}`);
      }
      writeFileSync(descriptor, `\n${markerFor(logFile, evidenceRunId, operationNonce)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

function observedTerminalMarkerCount(execute, logFiles, evidenceRunId, operationNonce, since) {
  let observed = 0;
  for (const logFile of logFiles) {
    const service = logFile.name.replace(/-(?:out|error)\.log$/u, '');
    const output = commandOutput(execute, '/usr/bin/journalctl', [
      '--since',
      since,
      '--output=cat',
      '--no-pager',
      `SYSLOG_IDENTIFIER=pm2:${service}`,
    ]);
    if (output.split('\n').includes(markerFor(logFile, evidenceRunId, operationNonce)))
      observed += 1;
  }
  return observed;
}

async function fetchLocalText(fetchImpl, url, expectedContentType) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw hostEvidenceError('local observer URL is invalid');
  }
  if (
    parsed.protocol !== 'http:' ||
    (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw hostEvidenceError('observer accepts only unauthenticated loopback HTTP');
  }
  let response;
  try {
    response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { accept: expectedContentType, 'cache-control': 'no-store' },
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw hostEvidenceError('local observer request failed');
  }
  if (!response.ok) throw hostEvidenceError('local observer request failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_HEALTH_RESPONSE_BYTES) {
    throw hostEvidenceError('local observer response exceeds the safe limit');
  }
  return bytes.toString('utf8');
}

function readProtectedAlloyConfig(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== 0 ||
    stat.gid !== 0 ||
    (stat.mode & 0o022) !== 0 ||
    realpathSync(path) !== path
  ) {
    throw hostEvidenceError('Alloy config metadata is unsafe');
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength > MAX_HEALTH_RESPONSE_BYTES) {
    throw hostEvidenceError('Alloy config exceeds the safe limit');
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    text: bytes.toString('utf8'),
  };
}

/**
 * Linux adapter used by the immutable CLI. It mutates no unit or queue. The only non-evidence
 * writes are nonce-derived terminal marker lines appended after PM2 and the emulator are inactive;
 * without those markers the current tail|systemd-cat bridge has no authoritative terminal offset.
 */
export function createLinuxHostSnapshotReader(options) {
  if (!isRecord(options)) throw hostEvidenceError('Linux observer options are required');
  const evidenceRunId = validateEvidenceRunId(options.evidenceRunId);
  const operationNonce = requireOperationNonce(options.operationNonce);
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const execute = options.execute ?? execFileSync;
  const alloyConfigPath = options.alloyConfigPath ?? '/etc/alloy/config.alloy';
  const alloyMetricsUrl = options.alloyMetricsUrl ?? 'http://127.0.0.1:12345/metrics';
  const logServerHealthUrl = options.logServerHealthUrl ?? 'http://127.0.0.1:8106/health';
  const pm2LogDirectory = options.pm2LogDirectory ?? '/home/pbuchman/.pm2/logs';
  const expectedLogGlob = `${pm2LogDirectory}/*.log`;
  let baselineFiles;
  let baselineCapturedAt;
  let markersAppended = false;

  return async function getSnapshot() {
    const units = Object.fromEntries(
      HOST_UNIT_NAMES.map((unit) => [unit, readSystemdUnit(execute, unit)])
    );
    const logFiles = enumeratePm2LogFiles(pm2LogDirectory);
    if (baselineFiles === undefined) {
      if (!HOST_UNIT_NAMES.every((unit) => units[unit].activeState === 'active')) {
        throw hostEvidenceError('observer baseline requires every DEV unit active');
      }
      baselineFiles = logFiles;
      baselineCapturedAt = currentUtcSecond(now);
    } else {
      requireStableLogFiles(baselineFiles, logFiles);
    }

    const alloyConfig = readProtectedAlloyConfig(alloyConfigPath);
    if (!inspectAlloyPm2OnlyConfig(alloyConfig.text, expectedLogGlob)) {
      throw hostEvidenceError('Alloy config is not the exact PM2-only pipeline');
    }
    const metricsText = await fetchLocalText(fetchImpl, alloyMetricsUrl, 'text/plain');
    const metrics = parseAlloyDebugMetrics(metricsText);
    if (
      metrics.source.activeFilesTotal !== logFiles.length ||
      metrics.source.fileBytesTotal !== logFiles.reduce((total, file) => total + file.size, 0)
    ) {
      throw hostEvidenceError('Alloy source metrics do not cover the exact PM2 log set');
    }

    const terminalUnitsReady =
      units['pm2-pbuchman.service'].activeState === 'inactive' &&
      units['intexuraos-emulators.service'].activeState === 'inactive' &&
      [
        'pm2-journal-bridge.service',
        'intexuraos-log-viewer.service',
        'intexuraos-log-server.service',
        'alloy.service',
      ].every((unit) => units[unit].activeState === 'active');
    if (terminalUnitsReady && !markersAppended) {
      if (!bridgeOpenFilesCoverLogs(logFiles)) {
        throw hostEvidenceError('journal bridge file descriptors do not cover every PM2 log');
      }
      appendTerminalMarkers(logFiles, evidenceRunId, operationNonce);
      commandOutput(execute, '/usr/bin/journalctl', ['--sync']);
      markersAppended = true;
    }
    const observedMarkerCount = markersAppended
      ? observedTerminalMarkerCount(
          execute,
          baselineFiles,
          evidenceRunId,
          operationNonce,
          baselineCapturedAt
        )
      : 0;

    let clients = 0;
    let childProcessCount = 0;
    if (units['intexuraos-log-server.service'].activeState === 'active') {
      const healthText = await fetchLocalText(fetchImpl, logServerHealthUrl, 'application/json');
      let health;
      try {
        health = JSON.parse(healthText);
      } catch {
        throw hostEvidenceError('log server health is invalid JSON');
      }
      exactKeys(health, ['clients', 'status'], 'log server health');
      if (health.status !== 'ok' || !Number.isSafeInteger(health.clients) || health.clients < 0) {
        throw hostEvidenceError('log server health is invalid');
      }
      clients = health.clients;
      childProcessCount = Math.max(
        0,
        readCgroupPids('intexuraos-log-server.service').filter(
          (pid) => pid !== units['intexuraos-log-server.service'].mainPid
        ).length
      );
    }
    const capturedAt = currentUtcSecond(now);
    return {
      alloy: {
        capturedAt,
        configSha256: alloyConfig.sha256,
        invocationId: units['alloy.service'].invocationId,
        mainPid: units['alloy.service'].mainPid,
        pm2Only: true,
        ...metrics,
      },
      capturedAt,
      logServer: { childProcessCount, clients },
      terminalTail: {
        complete: markersAppended && observedMarkerCount === baselineFiles.length,
        expectedMarkerCount: baselineFiles.length,
        observedMarkerCount,
      },
      units,
    };
  };
}

function readPrivateCliJson(path, directory, ownerId, groupId) {
  requirePathBelow(path, directory, 'CLI input');
  if (realpathSync(path) !== path) throw hostEvidenceError('CLI input path is not canonical');
  const before = lstatSync(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    (before.mode & 0o777n) !== 0o600n ||
    before.uid !== BigInt(ownerId) ||
    before.gid !== BigInt(groupId)
  ) {
    throw hostEvidenceError('CLI input metadata is unsafe');
  }
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true });
    if (
      canonicalJson(stableFileIdentity(before)) !== canonicalJson(stableFileIdentity(after)) ||
      canonicalJson(stableFileIdentity(before)) !== canonicalJson(stableFileIdentity(afterPath))
    ) {
      throw hostEvidenceError('CLI input changed during read');
    }
    if (bytes.byteLength > MAX_HEALTH_RESPONSE_BYTES) {
      throw hostEvidenceError('CLI input exceeds the safe limit');
    }
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!bytes.equals(Buffer.from(`${canonicalJson(parsed)}\n`, 'utf8'))) {
      throw hostEvidenceError('CLI input is not canonical JSON');
    }
    return parsed;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseCliFlags(args, expectedFlags) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      typeof flag !== 'string' ||
      !expectedFlags.includes(flag) ||
      typeof value !== 'string' ||
      value === '' ||
      flag in result
    ) {
      throw Object.assign(hostEvidenceError('invalid CLI arguments'), { exitCode: 64 });
    }
    result[flag] = value;
  }
  if (Object.keys(result).length !== expectedFlags.length) {
    throw Object.assign(hostEvidenceError('missing CLI arguments'), { exitCode: 64 });
  }
  return result;
}

function requireCliRoot(dependencies) {
  const uid = dependencies.ownerId ?? process.getuid?.() ?? 0;
  const gid = dependencies.groupId ?? process.getgid?.() ?? 0;
  if (!dependencies.allowNonRoot && (uid !== 0 || gid !== 0)) {
    throw hostEvidenceError('host evidence CLI requires root');
  }
  return { gid, uid };
}

function readInstalledPolicy(dependencies) {
  if (dependencies.policy !== undefined)
    return cloneRecord(dependencies.policy, 'installed policy');
  const path = '/usr/local/lib/intexuraos-dev/mode-policy.json';
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== 0 ||
    stat.gid !== 0 ||
    (stat.mode & 0o777) !== 0o444 ||
    realpathSync(path) !== path
  ) {
    throw hostEvidenceError('installed policy metadata is unsafe');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requireHostEvidencePolicy(policy) {
  const value = cloneRecord(policy?.evidence, 'host evidence policy');
  exactKeys(
    value,
    [
      'alloyFlushFilePrefix',
      'alloyFileMatchSyncPeriodMs',
      'hostRoot',
      'lastGoodFileName',
      'maxSnapshotAgeMs',
      'minimumStableIntervalMs',
      'observerPollIntervalMs',
    ],
    'host evidence policy'
  );
  if (
    value.alloyFlushFilePrefix !== 'alloy-flush-' ||
    value.alloyFileMatchSyncPeriodMs !== 10_000 ||
    value.hostRoot !== '/var/lib/intexuraos-dev/evidence' ||
    value.lastGoodFileName !== 'last-good-active-state.json' ||
    !Number.isSafeInteger(value.observerPollIntervalMs) ||
    value.observerPollIntervalMs < 1_000 ||
    !Number.isSafeInteger(value.minimumStableIntervalMs) ||
    value.minimumStableIntervalMs < value.alloyFileMatchSyncPeriodMs * 2 ||
    !Number.isSafeInteger(value.maxSnapshotAgeMs) ||
    value.maxSnapshotAgeMs < value.minimumStableIntervalMs
  ) {
    throw hostEvidenceError('host evidence policy is invalid');
  }
  return value;
}

function assertCanonicalHostEvidenceDirectory(directory, evidenceRunId, policy, dependencies) {
  if (dependencies.allowNonRoot) return;
  if (directory !== `${policy.hostRoot}/${evidenceRunId}`) {
    throw hostEvidenceError('evidence directory is not the canonical host run root');
  }
}

export async function runDevHostEvidenceCli(args, dependencies = {}) {
  const command = args[0];
  if (!['publish-last-good', 'publish-alloy-preflight', 'observe-host'].includes(command)) {
    throw Object.assign(
      hostEvidenceError('usage: publish-last-good|publish-alloy-preflight|observe-host'),
      {
        exitCode: 64,
      }
    );
  }
  const { gid, uid } = requireCliRoot(dependencies);
  const installedPolicy = readInstalledPolicy(dependencies);
  const evidencePolicy = requireHostEvidencePolicy(installedPolicy);
  if (command === 'observe-host') {
    const flags = parseCliFlags(args.slice(1), [
      '--evidence-dir',
      '--evidence-run-id',
      '--operation-nonce',
    ]);
    const evidenceRunId = validateEvidenceRunId(flags['--evidence-run-id']);
    const operationNonce = requireOperationNonce(flags['--operation-nonce']);
    const evidenceDirectory = requireAbsolutePath(flags['--evidence-dir'], 'evidence directory');
    assertCanonicalHostEvidenceDirectory(
      evidenceDirectory,
      evidenceRunId,
      evidencePolicy,
      dependencies
    );
    const getSnapshot = createLinuxHostSnapshotReader({
      evidenceRunId,
      operationNonce,
      ...dependencies.linuxObserver,
    });
    return runDevHostObservabilityObserver({
      evidenceRunId,
      getSnapshot,
      maxPolls: 240,
      maxSnapshotAgeMs: evidencePolicy.maxSnapshotAgeMs,
      minimumStableIntervalMs: evidencePolicy.minimumStableIntervalMs,
      now: dependencies.now ?? (() => new Date()),
      operationNonce,
      publish: async ({ fileName, value }) => {
        const publication = publishImmutableEvidence({
          directory: evidenceDirectory,
          fileName,
          groupId: gid,
          ownerId: uid,
          value,
        });
        dependencies.onPublication?.(publication);
        return publication;
      },
      sleep:
        dependencies.sleep ??
        (() =>
          new Promise((resolveSleep) =>
            setTimeout(resolveSleep, evidencePolicy.observerPollIntervalMs)
          )),
    });
  }

  const flags = parseCliFlags(args.slice(1), ['--evidence-dir', '--input']);
  const evidenceDirectory = requireAbsolutePath(flags['--evidence-dir'], 'evidence directory');
  const input = readPrivateCliJson(flags['--input'], evidenceDirectory, uid, gid);
  if (command === 'publish-alloy-preflight') {
    exactKeys(
      input,
      [
        'baseline',
        'evidenceRunId',
        'expectedFileCount',
        'first',
        'minimumStableIntervalMs',
        'operationNonce',
        'second',
      ],
      'Alloy preflight input'
    );
    const proof = evaluateAlloyFlushProof(input);
    if (proof.status !== 'PASS') throw hostEvidenceError('Alloy preflight proof is UNKNOWN');
    const evidenceRunId = validateEvidenceRunId(input.evidenceRunId);
    const operationNonce = requireOperationNonce(input.operationNonce);
    if (input.minimumStableIntervalMs !== evidencePolicy.minimumStableIntervalMs) {
      throw hostEvidenceError('Alloy preflight interval differs from installed policy');
    }
    assertCanonicalHostEvidenceDirectory(
      evidenceDirectory,
      evidenceRunId,
      evidencePolicy,
      dependencies
    );
    const evidence = buildAlloyFlushEvidence({
      bufferFlushComplete: true,
      evidenceRunId,
      observedAt: input.second.capturedAt,
      operationNonce,
      pm2Only: true,
      result: 'PASS',
      schemaVersion: 1,
    });
    return publishImmutableEvidence({
      directory: evidenceDirectory,
      fileName: `${evidencePolicy.alloyFlushFilePrefix}${operationNonce}.json`,
      groupId: gid,
      ownerId: uid,
      value: evidence,
    });
  }

  const evidenceRunId = validateEvidenceRunId(input.evidenceRunId);
  assertCanonicalHostEvidenceDirectory(
    evidenceDirectory,
    evidenceRunId,
    evidencePolicy,
    dependencies
  );
  const lastGood = buildLastGoodActiveState(input, {
    evidenceDirectory,
    expectedCandidatePorts: installedPolicy.ports?.candidate,
    expectedUnits: installedPolicy.units?.stopSet,
    expectedVerifierSources: installedPolicy.signedDrain?.sourceFiles,
    maxReferenceAgeMs: installedPolicy.signedDrain?.maxArtifactAgeMs,
    now: dependencies.now ?? (() => new Date()),
    profileRoot: '/var/lib/intexuraos-dev/profiles',
    referenceGroupId: gid,
    referenceOwnerId: uid,
    staticReleaseRoot: '/var/www/intexuraos-dev/releases',
  });
  return publishImmutableEvidence({
    directory: evidenceDirectory,
    fileName: evidencePolicy.lastGoodFileName,
    groupId: gid,
    ownerId: uid,
    value: lastGood,
  });
}

function isDirectExecution() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  runDevHostEvidenceCli(process.argv.slice(2), {
    onPublication: (publication) => {
      process.stdout.write(`${canonicalJson({ result: 'PASS', ...publication })}\n`);
    },
  })
    .then((result) => {
      if (result?.result === 'UNKNOWN') {
        process.stderr.write(`DEV host evidence: ${result.reasons.join(',')}\n`);
        process.exitCode = 1;
      } else if (result?.sha256 !== undefined) {
        process.stdout.write(`${canonicalJson({ result: 'PASS', ...result })}\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'DEV host evidence failed'}\n`
      );
      process.exitCode = Number.isSafeInteger(error?.exitCode) ? error.exitCode : 1;
    });
}
