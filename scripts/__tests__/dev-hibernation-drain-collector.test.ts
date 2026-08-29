import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  assembleDevDrainVerifierInput,
  createDevDrainCollector,
  verifyDrainCaptureWrapper,
  type DevDrainCollector,
  type OwnershipAggregateInput,
  type OwnershipCollectionRequest,
  type OwnershipObservation,
  type SignedDevDrainArtifact,
} from '../lib/dev-hibernation-drain-collector.mjs';
import {
  MAX_DEV_DRAIN_ARTIFACT_AGE_MS,
  verifyDevDrain,
  type DevDrainVerificationContext,
} from '../lib/dev-hibernation-drain-verifier.mjs';
import { canonicalTopologyHash } from '../../tools/pubsub-ui/pubsub-drain.mjs';

const TOPOLOGY = [
  {
    projectId: 'demo-intexuraos',
    topicName: 'task-events',
    subscriptionName: 'task-events-ui-monitor',
    classification: 'forwarded',
    listeners: 1,
  },
] as const;
const TOPOLOGY_HASH = canonicalTopologyHash(TOPOLOGY);
const SOURCE_REVISION = '4247a873403b952de191bf8a8001d5c950a6094b';
const EVIDENCE_RUN_ID = '20260828T002847Z-paddc4965d21e-b265702826912';
const OPERATION_NONCE = 'c'.repeat(64);
const SURFACE_IDENTITIES = {
  pubsub: { kind: 'container-process' as const, instanceIdHash: 'a'.repeat(64) },
  orchestrator: { kind: 'process' as const, instanceIdHash: 'b'.repeat(64) },
};
type HealthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function pubsubHealth(topologyObservationSequence = 1): Record<string, unknown> {
  return {
    status: 'ok',
    topics: ['private-top-level-topic-list-is-not-evidence'],
    clients: 0,
    privateTopLevelSentinel: 'must-not-be-signed',
    drainContractVersion: 1,
    drain: {
      counterEpochId: '00112233445566778899aabbccddeeff',
      processStartedAt: '2026-08-28T09:00:00.000Z',
      expectedTopologyHash: TOPOLOGY_HASH,
      observedTopologyHash: TOPOLOGY_HASH,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
      topologyObservationSequence,
      topologyRefreshErrorsTotal: 0,
      topologyMatch: true,
      activeListenerTopologyHash: TOPOLOGY_HASH,
      subscriptionCounts: {
        expected: 1,
        observed: 1,
        classified: 1,
        unclassified: 0,
        missing: 0,
        unexpected: 0,
        orphaned: 0,
        listenerless: 0,
        duplicateListeners: 0,
        duplicateSubscriptions: 0,
      },
      classificationCounts: { forwarded: 1, 'monitor-only': 0 },
      listenerMultiplicity: TOPOLOGY.map((entry) => ({ ...entry })),
      activeListeners: 1,
      setupErrors: 0,
      inFlightHandlers: 0,
      receivedTotal: 5,
      ackedTotal: 5,
      nackedTotal: 0,
      forwardFailuresTotal: 0,
      subscriberErrorsTotal: 0,
      lastActivityAt: '2026-08-28T09:30:00.000Z',
      lastErrorAt: null,
    },
  };
}

function orchestratorHealth(): Record<string, unknown> {
  return {
    healthContractVersion: 2,
    status: 'ready',
    capacity: 4,
    running: 0,
    available: 4,
    githubTokenExpiresAt: 'private-operational-field-is-not-evidence',
    workerAuths: { private: true },
    providerApiKeys: { private: { configured: true } },
    dockerHealthy: true,
    diskHealthy: true,
    workerContainers: 0,
    pendingTerminalCallbacks: 0,
    terminalCallbackActivityTotal: 11,
    logForwarderDrain: {
      counterEpochId: 'ffeeddccbbaa99887766554433221100',
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
      droppedChunksTotal: 0,
      forwarderActivityTotal: 7,
      lastActivityAt: '2026-08-28T09:30:00.000Z',
    },
  };
}

function ownershipSnapshot(): OwnershipAggregateInput {
  return {
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
  };
}

function ownershipCaptureOptions(): {
  collectOwnership: (request: OwnershipCollectionRequest) => Promise<OwnershipObservation>;
} {
  return {
    collectOwnership: async (request) => ({
      observationReceiptId: request.observationReceiptId,
      aggregate: ownershipSnapshot(),
    }),
  };
}

function controlledClock(): {
  advanceMs: (milliseconds: number) => void;
  monotonicNowNs: () => bigint;
  now: () => Date;
} {
  let monotonicNs = 1_000_000_000n;
  let wallMs = Date.parse('2026-08-28T10:00:00.000Z');
  return {
    advanceMs(milliseconds): void {
      monotonicNs += BigInt(milliseconds) * 1_000_000n;
      wallMs += milliseconds;
    },
    monotonicNowNs(): bigint {
      monotonicNs += 1_000n;
      return monotonicNs;
    },
    now(): Date {
      wallMs += 1;
      return new Date(wallMs);
    },
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function verificationContext(
  artifact: SignedDevDrainArtifact,
  overrides: Partial<DevDrainVerificationContext> = {}
): DevDrainVerificationContext {
  return {
    expectedEvidenceRunId: artifact.evidenceRunId,
    expectedOperationNonce: artifact.operationNonce,
    currentTime: new Date(artifact.createdAt),
    maxAgeMs: 60_000,
    consumeOperationNonce: (): boolean => true,
    ...overrides,
  };
}

function collectorFixture(overrides: { fetchImpl?: HealthFetch } = {}): {
  clock: ReturnType<typeof controlledClock>;
  collector: DevDrainCollector;
  fetchImpl: Mock<HealthFetch>;
  publicKey: KeyObject;
} {
  const clock = controlledClock();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  let topologyObservationSequence = 0;
  const fetchImpl = vi.fn<HealthFetch>(async (input, _init) => {
    const url = String(input);
    if (url !== 'http://127.0.0.1:8105/health') return response(orchestratorHealth());
    topologyObservationSequence += 1;
    return response(pubsubHealth(topologyObservationSequence));
  });
  const collector = createDevDrainCollector({
    collectorRunId: '0123456789abcdef0123456789abcdef',
    endpoints: {
      pubsub: 'http://127.0.0.1:8105/health',
      orchestrator: 'http://127.0.0.1:8090/health',
    },
    fetchImpl,
    monotonicNowNs: clock.monotonicNowNs,
    now: clock.now,
    signingPrivateKey: privateKey,
    evidenceRunId: EVIDENCE_RUN_ID,
    operationNonce: OPERATION_NONCE,
    sourceRevisions: { pubsub: SOURCE_REVISION, orchestrator: SOURCE_REVISION },
    surfaceIdentities: SURFACE_IDENTITIES,
    ...overrides,
  });
  return { clock, collector, fetchImpl, publicKey };
}

describe('DEV hibernation drain collector', () => {
  it('collects, projects, signs, and assembles one ordered privacy-safe verifier sequence', async () => {
    const { clock, collector, fetchImpl, publicKey } = collectorFixture();
    const witness = await collector.capture('witness');
    const anchor = await collector.capture('anchor', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    const read1 = await collector.capture('read1', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    const read2 = await collector.capture('read2', ownershipCaptureOptions());
    const verifierArtifact = await collector.buildVerifierArtifact({
      requiredQuietIntervalMs: 600_000,
      topologyFreshnessMs: 30_000,
    });

    expect(
      verifyDevDrain(verifierArtifact, publicKey, verificationContext(verifierArtifact))
    ).toEqual({
      pendingStatus: 'zero',
      reasons: [],
    });
    expect(verifierArtifact.evidenceRunId).toBe(EVIDENCE_RUN_ID);
    expect(verifierArtifact.operationNonce).toBe(OPERATION_NONCE);
    expect(verifierArtifact.createdAt).toBe(read2.ownership.evidence.capture.receivedAt);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    }
    expect(witness.pubsub.evidence.capture.sequence).toBe(1);
    expect(anchor.pubsub.evidence.capture.sequence).toBe(2);
    expect(read1.pubsub.evidence.capture.sequence).toBe(3);
    expect(read2.pubsub.evidence.capture.sequence).toBe(4);
    expect(read2.orchestrator.evidence.surfaceIdentity).toEqual({
      ...SURFACE_IDENTITIES.orchestrator,
      endpointIdSha256: createHash('sha256').update('http://127.0.0.1:8090/health').digest('hex'),
      sourceRevision: SOURCE_REVISION,
    });
    expect(verifyDrainCaptureWrapper(read2.pubsub, publicKey)).toBe(true);
    expect(verifyDrainCaptureWrapper(read2.orchestrator, publicKey)).toBe(true);
    expect(verifyDrainCaptureWrapper(read2.ownership, publicKey)).toBe(true);

    const serialized = JSON.stringify({ witness, anchor, read1, read2 });
    expect(serialized).not.toContain('must-not-be-signed');
    expect(serialized).not.toContain('private-operational-field');
    expect(serialized).not.toContain('workerAuths');
    expect(serialized).not.toContain('providerApiKeys');
    expect(serialized).not.toContain('127.0.0.1');
  });

  it('rejects an unbound or malformed source revision before collection', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() =>
      createDevDrainCollector({
        endpoints: {
          pubsub: 'http://127.0.0.1:8105/health',
          orchestrator: 'http://127.0.0.1:8090/health',
        },
        signingPrivateKey: privateKey,
        evidenceRunId: EVIDENCE_RUN_ID,
        operationNonce: OPERATION_NONCE,
        sourceRevisions: { pubsub: 'main', orchestrator: SOURCE_REVISION },
        surfaceIdentities: SURFACE_IDENTITIES,
      })
    ).toThrow(/source revision/u);
  });

  it('rejects a reused signed read1 wrapper as read2 even with huge freshness', async () => {
    const { clock, collector, publicKey } = collectorFixture();
    const witness = await collector.capture('witness');
    const anchor = await collector.capture('anchor', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    const read1 = await collector.capture('read1', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    await collector.capture('read2', ownershipCaptureOptions());

    expect(() =>
      assembleDevDrainVerifierInput({
        captures: { witness, anchor, read1, read2: read1 },
        publicKey,
        requiredQuietIntervalMs: 600_000,
        topologyFreshnessMs: Number.MAX_SAFE_INTEGER,
      })
    ).toThrow(/phase/u);
  });

  it('rejects a stale ownership observation reused for a later measured phase', async () => {
    const { clock, collector } = collectorFixture();
    await collector.capture('witness');
    let staleObservation: OwnershipObservation | undefined;
    const collectOwnership = async (
      request: OwnershipCollectionRequest
    ): Promise<OwnershipObservation> => {
      staleObservation ??= {
        observationReceiptId: request.observationReceiptId,
        aggregate: ownershipSnapshot(),
      };
      return staleObservation;
    };
    await collector.capture('anchor', { collectOwnership });
    clock.advanceMs(600_000);

    await expect(collector.capture('read1', { collectOwnership })).rejects.toThrow(
      /ownership observation receipt/u
    );
  });

  it('rejects signature tampering before producing verifier input', async () => {
    const { collector, publicKey } = collectorFixture();
    const witness = await collector.capture('witness');
    const tampered = structuredClone(witness.pubsub);
    tampered.evidence.drain.receivedTotal += 1;

    expect(verifyDrainCaptureWrapper(tampered, publicKey)).toBe(false);
  });

  it('cannot turn a signed nonzero result into zero by mutating evidence after build', async () => {
    let pubsubSequence = 0;
    let orchestratorRead = 0;
    const fetchImpl = vi.fn<HealthFetch>(async (input) => {
      if (String(input) === 'http://127.0.0.1:8105/health') {
        pubsubSequence += 1;
        return response(pubsubHealth(pubsubSequence));
      }
      orchestratorRead += 1;
      const health = orchestratorHealth();
      if (orchestratorRead === 4) {
        (health.logForwarderDrain as Record<string, unknown>).activeForwarders = 1;
      }
      return response(health);
    });
    const { clock, collector, publicKey } = collectorFixture({ fetchImpl });
    await collector.capture('witness');
    await collector.capture('anchor', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    await collector.capture('read1', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    await collector.capture('read2', ownershipCaptureOptions());
    const artifact = await collector.buildVerifierArtifact({
      requiredQuietIntervalMs: 600_000,
      topologyFreshnessMs: 30_000,
    });
    expect(verifyDevDrain(artifact, publicKey, verificationContext(artifact)).pendingStatus).toBe(
      'nonzero'
    );

    const tampered = structuredClone(artifact);
    tampered.captures.read2.orchestrator.evidence.logForwarderDrain.activeForwarders = 0;
    expect(
      verifyDevDrain(tampered, publicKey, verificationContext(artifact)).pendingStatus
    ).not.toBe('zero');
  });

  it('binds policy, result, timestamp, and source revisions to the final signature', async () => {
    const { clock, collector, publicKey } = collectorFixture();
    await collector.capture('witness');
    await collector.capture('anchor', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    await collector.capture('read1', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    await collector.capture('read2', ownershipCaptureOptions());
    const artifact = await collector.buildVerifierArtifact({
      requiredQuietIntervalMs: 600_000,
      topologyFreshnessMs: 30_000,
    });
    expect(verifyDevDrain(artifact, publicKey, verificationContext(artifact)).pendingStatus).toBe(
      'zero'
    );

    const mutations: ((value: SignedDevDrainArtifact) => void)[] = [
      (value): void => {
        value.requiredQuietIntervalMs += 1;
      },
      (value): void => {
        value.topologyFreshnessMs += 1;
      },
      (value): void => {
        value.result = { pendingStatus: 'nonzero', reasons: ['tampered'] };
      },
      (value): void => {
        value.createdAt = '2026-01-01T00:00:00.000Z';
      },
      (value): void => {
        value.sourceRevisions.pubsub = 'f'.repeat(40);
      },
      (value): void => {
        value.evidenceRunId = 'other-evidence-run-0001';
      },
      (value): void => {
        value.operationNonce = 'e'.repeat(64);
      },
    ];
    for (const mutate of mutations) {
      const tampered = structuredClone(artifact);
      mutate(tampered);
      expect(verifyDevDrain(tampered, publicKey, verificationContext(artifact))).toEqual({
        pendingStatus: 'unknown',
        reasons: ['artifact:signature'],
      });
    }
  });

  it('fails closed on replay, stale evidence, and run or operation context mismatch', async () => {
    const { clock, collector, publicKey } = collectorFixture();
    await collector.capture('witness');
    await collector.capture('anchor', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    await collector.capture('read1', ownershipCaptureOptions());
    clock.advanceMs(600_000);
    await collector.capture('read2', ownershipCaptureOptions());
    const artifact = await collector.buildVerifierArtifact({
      requiredQuietIntervalMs: 600_000,
      topologyFreshnessMs: 30_000,
    });

    const consumed = new Set<string>();
    const replayContext = verificationContext(artifact, {
      consumeOperationNonce: ({ operationNonce }): boolean => {
        if (consumed.has(operationNonce)) return false;
        consumed.add(operationNonce);
        return true;
      },
    });
    expect(verifyDevDrain(artifact, publicKey, replayContext).pendingStatus).toBe('zero');
    expect(verifyDevDrain(artifact, publicKey, replayContext)).toEqual({
      pendingStatus: 'unknown',
      reasons: ['artifact:replay'],
    });

    expect(
      verifyDevDrain(
        artifact,
        publicKey,
        verificationContext(artifact, { expectedEvidenceRunId: 'other-evidence-run-0001' })
      )
    ).toEqual({ pendingStatus: 'unknown', reasons: ['artifact:evidence-run'] });
    expect(
      verifyDevDrain(
        artifact,
        publicKey,
        verificationContext(artifact, { expectedOperationNonce: 'e'.repeat(64) })
      )
    ).toEqual({ pendingStatus: 'unknown', reasons: ['artifact:operation-nonce'] });
    expect(
      verifyDevDrain(
        artifact,
        publicKey,
        verificationContext(artifact, {
          currentTime: new Date(Date.parse(artifact.createdAt) + 60_001),
        })
      )
    ).toEqual({ pendingStatus: 'unknown', reasons: ['artifact:stale'] });
    expect(
      verifyDevDrain(
        artifact,
        publicKey,
        verificationContext(artifact, {
          maxAgeMs: MAX_DEV_DRAIN_ARTIFACT_AGE_MS + 1,
        })
      )
    ).toEqual({ pendingStatus: 'unknown', reasons: ['artifact:context'] });
    expect(
      verifyDevDrain(
        artifact,
        publicKey,
        verificationContext(artifact, {
          currentTime: new Date(Date.parse(artifact.createdAt) - 1),
        })
      )
    ).toEqual({ pendingStatus: 'unknown', reasons: ['artifact:future'] });
    expect(
      verifyDevDrain(artifact, publicKey, undefined as unknown as DevDrainVerificationContext)
    ).toEqual({ pendingStatus: 'unknown', reasons: ['artifact:context'] });
  });

  it('fails closed without signing privacy-hostile nested health data', async () => {
    const privateSentinel = 'private-message-payload-must-never-escape';
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) !== 'http://127.0.0.1:8105/health') {
        return response(orchestratorHealth());
      }
      const health = pubsubHealth();
      const drain = health.drain as Record<string, unknown>;
      drain.payload = privateSentinel;
      return response(health);
    });
    const { collector } = collectorFixture({ fetchImpl });

    await expect(collector.capture('witness')).rejects.toThrow(/privacy-safe contract/u);
    await expect(collector.capture('witness')).rejects.not.toThrow(privateSentinel);
  });

  it('rejects privacy-hostile values hidden in allowlisted Pub/Sub scalar fields', async () => {
    const privateSentinel = 'PRIVATE PAYLOAD: contact@pbuchman.com';
    const fetchImpl = vi.fn<HealthFetch>(async (input) => {
      if (String(input) !== 'http://127.0.0.1:8105/health') {
        return response(orchestratorHealth());
      }
      const health = pubsubHealth();
      (health.drain as Record<string, unknown>).counterEpochId = privateSentinel;
      return response(health);
    });
    const { collector } = collectorFixture({ fetchImpl });

    await expect(collector.capture('witness')).rejects.toThrow(/privacy-safe contract/u);
    await expect(collector.capture('witness')).rejects.not.toThrow(privateSentinel);
  });

  it('bounds and validates every allowlisted Pub/Sub resource identifier', async () => {
    const privateSentinel = 'private/payload/inside/topic-name';
    const fetchImpl = vi.fn<HealthFetch>(async (input) => {
      if (String(input) !== 'http://127.0.0.1:8105/health') {
        return response(orchestratorHealth());
      }
      const health = pubsubHealth();
      const drain = health.drain as Record<string, unknown>;
      const entries = drain.listenerMultiplicity as Record<string, unknown>[];
      const firstEntry = entries[0];
      if (firstEntry !== undefined) firstEntry.topicName = privateSentinel;
      return response(health);
    });
    const { collector } = collectorFixture({ fetchImpl });

    await expect(collector.capture('witness')).rejects.toThrow(/privacy-safe contract/u);
    await expect(collector.capture('witness')).rejects.not.toThrow(privateSentinel);

    const oversizedFetch = vi.fn<HealthFetch>(async (input) => {
      if (String(input) !== 'http://127.0.0.1:8105/health') {
        return response(orchestratorHealth());
      }
      const health = pubsubHealth();
      const drain = health.drain as Record<string, unknown>;
      const template = (drain.listenerMultiplicity as Record<string, unknown>[])[0];
      if (template === undefined) throw new Error('missing listener template');
      drain.listenerMultiplicity = Array.from({ length: 2_049 }, () => ({ ...template }));
      return response(health);
    });
    const { collector: oversizedCollector } = collectorFixture({ fetchImpl: oversizedFetch });
    await expect(oversizedCollector.capture('witness')).rejects.toThrow(/privacy-safe contract/u);
  });

  it('rejects privacy-hostile values hidden in allowlisted orchestrator fields', async () => {
    const privateSentinel = 'PRIVATE PAYLOAD: callback secret';
    const fetchImpl = vi.fn<HealthFetch>(async (input) => {
      if (String(input) === 'http://127.0.0.1:8105/health') return response(pubsubHealth());
      const health = orchestratorHealth();
      (health.logForwarderDrain as Record<string, unknown>).processStartedAt = privateSentinel;
      return response(health);
    });
    const { collector } = collectorFixture({ fetchImpl });

    await expect(collector.capture('witness')).rejects.toThrow(/privacy-safe contract/u);
    await expect(collector.capture('witness')).rejects.not.toThrow(privateSentinel);
  });

  it('rejects privacy-hostile values hidden in allowlisted ownership fields', async () => {
    const privateSentinel = 'PRIVATE PAYLOAD: Firestore document';
    const { collector } = collectorFixture();
    await collector.capture('witness');
    const collectOwnership = async (
      request: OwnershipCollectionRequest
    ): Promise<OwnershipObservation> => ({
      observationReceiptId: request.observationReceiptId,
      aggregate: {
        ...ownershipSnapshot(),
        nonzeroCount: privateSentinel,
      } as unknown as OwnershipAggregateInput,
    });

    await expect(collector.capture('anchor', { collectOwnership })).rejects.toThrow(
      /privacy-safe contract/u
    );
    await expect(collector.capture('anchor', { collectOwnership })).rejects.not.toThrow(
      privateSentinel
    );
  });

  it.each([
    ['Pub/Sub status', 'pubsub', { ...pubsubHealth(), status: 'degraded' }],
    ['orchestrator status', 'orchestrator', { ...orchestratorHealth(), status: 'starting' }],
    [
      'orchestrator Docker health',
      'orchestrator',
      { ...orchestratorHealth(), dockerHealthy: false },
    ],
    ['orchestrator disk health', 'orchestrator', { ...orchestratorHealth(), diskHealthy: false }],
  ])('fails closed before signing when %s is not healthy', async (_name, surface, unhealthy) => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const isPubSub = String(input) === 'http://127.0.0.1:8105/health';
      if ((surface === 'pubsub' && isPubSub) || (surface === 'orchestrator' && !isPubSub)) {
        return response(unhealthy);
      }
      return response(isPubSub ? pubsubHealth() : orchestratorHealth());
    });
    const { collector } = collectorFixture({ fetchImpl });

    await expect(collector.capture('witness')).rejects.toThrow(/health/u);
  });

  it('fails closed on HTTP errors without reading or echoing a response body', async () => {
    const privateSentinel = 'private-upstream-error-body';
    const fetchImpl = vi.fn(async () => response({ error: privateSentinel }, 503));
    const { collector } = collectorFixture({ fetchImpl });

    await expect(collector.capture('witness')).rejects.toThrow(/health request failed/u);
    await expect(collector.capture('witness')).rejects.not.toThrow(privateSentinel);
  });

  it('requires the exact phase order and ownership evidence after witness', async () => {
    const { collector } = collectorFixture();

    await expect(collector.capture('anchor', ownershipCaptureOptions())).rejects.toThrow(
      /expected witness/u
    );
    await collector.capture('witness');
    const captureWithoutRequiredOptions = collector.capture as unknown as (
      phase: 'anchor'
    ) => Promise<unknown>;
    await expect(captureWithoutRequiredOptions('anchor')).rejects.toThrow(/ownership/u);
  });

  it('serializes capture state and permits a clean retry after an interrupted boundary', async () => {
    let releaseFirstRequest: (() => void) | undefined;
    let signalFirstRequest: (() => void) | undefined;
    const firstRequestStarted = new Promise<void>((resolve) => {
      signalFirstRequest = resolve;
    });
    const firstRequestReleased = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let requestCount = 0;
    const fetchImpl = vi.fn<HealthFetch>(async (input) => {
      requestCount += 1;
      if (requestCount === 1) {
        signalFirstRequest?.();
        await firstRequestReleased;
      }
      const isPubSub = String(input) === 'http://127.0.0.1:8105/health';
      return response(isPubSub ? pubsubHealth(requestCount) : orchestratorHealth());
    });
    const { collector } = collectorFixture({ fetchImpl });

    const firstCapture = collector.capture('witness');
    await firstRequestStarted;
    await expect(collector.capture('witness')).rejects.toThrow(/in progress/u);
    releaseFirstRequest?.();
    await firstCapture;

    await expect(collector.capture('anchor', ownershipCaptureOptions())).resolves.toBeDefined();
  });
});
