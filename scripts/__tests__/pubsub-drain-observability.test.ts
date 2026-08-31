import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  collectPubSubDrainTopology,
  PubSubDrainTelemetry,
  canonicalTopologyHash,
  type DrainTopologyTuple,
} from '../../tools/pubsub-ui/pubsub-drain.mjs';
import { buildExpectedDrainTopology, TOPIC_CONFIGS } from '../../tools/pubsub-ui/topology.mjs';
import { buildLocalEmulatorStartPlan } from '../lib/local-emulator-lifecycle.mjs';

const repoRoot = resolve(__dirname, '..', '..');
const serverSource = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/server.mjs'), 'utf8');
const bootstrapSource = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/bootstrap.mjs'), 'utf8');
const dockerfileSource = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/Dockerfile'), 'utf8');
const composeSource = readFileSync(resolve(repoRoot, 'docker/docker-compose.local.yaml'), 'utf8');
const readmeSource = readFileSync(resolve(repoRoot, 'tools/pubsub-ui/README.md'), 'utf8');

const FORWARDED_SUBSCRIPTION: DrainTopologyTuple = {
  projectId: 'project-a',
  topicName: 'topic-a',
  subscriptionName: 'topic-a-ui-monitor',
  classification: 'forwarded',
};
const MONITOR_SUBSCRIPTION: DrainTopologyTuple = {
  projectId: 'project-b',
  topicName: 'topic-b',
  subscriptionName: 'topic-b-ui-monitor',
  classification: 'monitor-only',
};
const EXPECTED: DrainTopologyTuple[] = [FORWARDED_SUBSCRIPTION, MONITOR_SUBSCRIPTION];
const OBSERVED_FORWARDED = {
  projectId: FORWARDED_SUBSCRIPTION.projectId,
  topicName: FORWARDED_SUBSCRIPTION.topicName,
  subscriptionName: FORWARDED_SUBSCRIPTION.subscriptionName,
};

const OBSERVED = EXPECTED.map(({ projectId, topicName, subscriptionName }) => ({
  projectId,
  topicName,
  subscriptionName,
}));

function readyTelemetry(): PubSubDrainTelemetry {
  const telemetry = new PubSubDrainTelemetry({
    expectedTopology: EXPECTED,
    now: (): Date => new Date('2026-08-28T10:00:00.000Z'),
    counterEpochId: '00112233445566778899aabbccddeeff',
  });
  telemetry.recordListenerStarted(FORWARDED_SUBSCRIPTION);
  telemetry.recordListenerStarted(MONITOR_SUBSCRIPTION);
  return telemetry;
}

describe('Pub/Sub drain observability', () => {
  it('has one explicit closed classification for every configured topic', () => {
    expect(TOPIC_CONFIGS).toHaveLength(14);
    expect(new Set(TOPIC_CONFIGS.map(({ name }) => name)).size).toBe(TOPIC_CONFIGS.length);
    expect(TOPIC_CONFIGS.find(({ name }) => name === 'whatsapp-audio-stored')).toEqual({
      name: 'whatsapp-audio-stored',
      endpoint: null,
    });
    expect(
      buildExpectedDrainTopology({
        PUBSUB_PROJECT_ID: 'project-a',
        MESSAGE_DIGEST_PUBSUB_PROJECT_ID: 'project-b',
      }).every(
        ({ classification }) => classification === 'forwarded' || classification === 'monitor-only'
      )
    ).toBe(true);
  });

  it('refreshes topology only through list operations on every collection', async () => {
    const getTopics = vi.fn(async () => [[{ name: 'projects/project-a/topics/topic-a' }]] as const);
    const getSubscriptions = vi.fn(
      async () =>
        [
          [
            {
              name: 'projects/project-a/subscriptions/topic-a-ui-monitor',
              metadata: { topic: 'projects/project-a/topics/topic-a' },
            },
          ],
        ] as const
    );
    const getClient = vi.fn(() => ({ getTopics, getSubscriptions }));

    const first = await collectPubSubDrainTopology({
      projectIds: ['project-a', 'project-a'],
      getClient,
      now: (): Date => new Date('2026-08-28T10:00:00.000Z'),
    });
    const second = await collectPubSubDrainTopology({
      projectIds: ['project-a'],
      getClient,
      now: (): Date => new Date('2026-08-28T10:00:01.000Z'),
    });

    expect(first).toEqual({
      topics: [{ projectId: 'project-a', topicName: 'topic-a' }],
      subscriptions: [
        {
          projectId: 'project-a',
          topicName: 'topic-a',
          subscriptionName: 'topic-a-ui-monitor',
        },
      ],
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });
    expect(second.topologyObservedAt).toBe('2026-08-28T10:00:01.000Z');
    expect(getTopics).toHaveBeenCalledTimes(2);
    expect(getSubscriptions).toHaveBeenCalledTimes(2);
    expect(getClient).toHaveBeenCalledTimes(2);
  });

  it('fails closed when either non-mutating topology list operation fails', async () => {
    const getTopics = vi.fn(async () => [[]] as const);
    const getSubscriptions = vi.fn(async () => {
      throw new Error('list unavailable');
    });

    await expect(
      collectPubSubDrainTopology({
        projectIds: ['project-a'],
        getClient: () => ({ getTopics, getSubscriptions }),
      })
    ).rejects.toThrow('list unavailable');

    const telemetry = readyTelemetry();
    telemetry.recordTopologyRefreshError();
    const snapshot = telemetry.snapshot({
      topics: [],
      subscriptions: [],
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
      topologyRefreshFailed: true,
    });
    expect(snapshot).toMatchObject({
      topologyMatch: false,
      observedTopologyHash: null,
      topologyObservedAt: null,
      topologyRefreshErrorsTotal: 1,
      lastErrorAt: '2026-08-28T10:00:00.000Z',
    });

    const recovered = telemetry.snapshot({
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions: OBSERVED,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });
    expect(recovered.topologyRefreshErrorsTotal).toBe(1);
  });

  it('keeps startup/listener setup non-mutating and wraps JSON decoding inside handler accounting', () => {
    expect(serverSource).not.toContain('topic.create(');
    expect(serverSource).not.toContain('subscription.create(');
    expect(serverSource).toContain('collectPubSubDrainTopology({');
    expect(serverSource).toContain('drainContractVersion: 1');
    expect(serverSource.indexOf('drainTelemetry.observeMessage({')).toBeLessThan(
      serverSource.indexOf('JSON.parse(message.data.toString())')
    );
    expect(serverSource).toContain("subscription.on('close'");
    expect(
      serverSource.match(/drainTelemetry\.recordListenerStopped\(drainSubscription\)/gu)
    ).toHaveLength(2);
  });

  it('keeps topology bootstrap separate from every long-running bridge start', () => {
    expect(composeSource).not.toMatch(/^\s{2}pubsub-bootstrap:/mu);
    expect(composeSource).toMatch(/^\s{2}pubsub-ui:/mu);
    expect(dockerfileSource).toContain('CMD ["node", "server.mjs"]');
    expect(dockerfileSource).not.toContain('bootstrap.mjs');
    expect(existsSync(resolve(repoRoot, 'tools/pubsub-ui/start.mjs'))).toBe(false);
    expect(bootstrapSource).toContain('await client.close()');
  });

  it('documents the single pull-listener to HTTP-bridge delivery path', () => {
    const architecture = readmeSource.slice(
      readmeSource.indexOf('## Architecture'),
      readmeSource.indexOf('**Bridge forwarding endpoints configured:**')
    );

    expect(architecture).toContain('(pull listeners)');
    expect(architecture).toContain('(HTTP bridge)');
    expect(architecture).not.toContain('(push)');
    expect(architecture).not.toContain(':8118');
  });

  it('makes full local startup an explicit staged topology mutation', () => {
    expect(buildLocalEmulatorStartPlan()).toEqual([
      ['up', '-d', '--wait', 'pubsub-emulator'],
      ['build', 'pubsub-ui'],
      ['run', '--rm', '--no-deps', 'pubsub-ui', 'node', 'bootstrap.mjs'],
      ['up', '-d', '--no-build', 'pubsub-ui'],
    ]);
  });

  it('hashes the same sorted whitespace-free tuple array regardless of input order', () => {
    expect(canonicalTopologyHash(OBSERVED)).toBe(canonicalTopologyHash([...OBSERVED].reverse()));
    expect(canonicalTopologyHash(OBSERVED)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('reports complete classified topology with exactly one listener per subscription', () => {
    const snapshot = readyTelemetry().snapshot({
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions: OBSERVED,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });

    expect(snapshot).toMatchObject({
      counterEpochId: '00112233445566778899aabbccddeeff',
      processStartedAt: '2026-08-28T10:00:00.000Z',
      topologyObservationSequence: 1,
      topologyRefreshErrorsTotal: 0,
      topologyMatch: true,
      activeListeners: 2,
      setupErrors: 0,
      inFlightHandlers: 0,
      receivedTotal: 0,
      ackedTotal: 0,
      nackedTotal: 0,
      forwardFailuresTotal: 0,
      subscriberErrorsTotal: 0,
      lastActivityAt: null,
      lastErrorAt: null,
      subscriptionCounts: {
        expected: 2,
        observed: 2,
        classified: 2,
        unclassified: 0,
        missing: 0,
        unexpected: 0,
        orphaned: 0,
        listenerless: 0,
        duplicateListeners: 0,
        duplicateSubscriptions: 0,
      },
      classificationCounts: { forwarded: 1, 'monitor-only': 1 },
    });
    expect(snapshot.expectedTopologyHash).toBe(snapshot.observedTopologyHash);
    expect(snapshot.activeListenerTopologyHash).toBe(snapshot.observedTopologyHash);
    expect(snapshot.listenerMultiplicity).toEqual([
      expect.objectContaining({ projectId: 'project-a', listeners: 1 }),
      expect.objectContaining({ projectId: 'project-b', listeners: 1 }),
    ]);
  });

  it('advances a process-local sequence only after a successful topology observation', () => {
    const telemetry = readyTelemetry();
    const observation = {
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions: OBSERVED,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    };

    expect(telemetry.snapshot(observation).topologyObservationSequence).toBe(1);
    expect(
      telemetry.snapshot({ ...observation, topologyRefreshFailed: true })
        .topologyObservationSequence
    ).toBe(1);
    expect(telemetry.snapshot(observation).topologyObservationSequence).toBe(2);
  });

  it.each([
    ['missing subscription', OBSERVED.slice(0, 1)],
    [
      'unexpected subscription',
      [
        ...OBSERVED,
        {
          projectId: 'project-a',
          topicName: 'topic-a',
          subscriptionName: 'unexpected-subscription',
        },
      ],
    ],
    [
      'orphaned subscription',
      [
        ...OBSERVED,
        {
          projectId: 'project-a',
          topicName: 'missing-topic',
          subscriptionName: 'orphaned-subscription',
        },
      ],
    ],
  ])('makes topology non-matching for %s', (_name, subscriptions) => {
    const snapshot = readyTelemetry().snapshot({
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });

    expect(snapshot.topologyMatch).toBe(false);
    expect(
      snapshot.subscriptionCounts.missing +
        snapshot.subscriptionCounts.unexpected +
        snapshot.subscriptionCounts.orphaned
    ).toBeGreaterThan(0);
  });

  it('rejects listener-less and duplicate-listener topology even when tuple hashes match', () => {
    const telemetry = readyTelemetry();
    telemetry.recordListenerStarted(FORWARDED_SUBSCRIPTION);
    const snapshot = telemetry.snapshot({
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions: OBSERVED,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });

    expect(snapshot.expectedTopologyHash).toBe(snapshot.observedTopologyHash);
    expect(snapshot.topologyMatch).toBe(false);
    expect(snapshot.subscriptionCounts.duplicateListeners).toBe(1);
  });

  it('rejects duplicate observed subscriptions instead of deduplicating them in the hash', () => {
    const snapshot = readyTelemetry().snapshot({
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions: [...OBSERVED, OBSERVED_FORWARDED],
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });

    expect(snapshot.topologyMatch).toBe(false);
    expect(snapshot.subscriptionCounts.duplicateSubscriptions).toBe(1);
    expect(snapshot.observedTopologyHash).not.toBe(snapshot.expectedTopologyHash);
  });

  it('includes an unexpected active listener in listener topology and supports teardown', () => {
    const telemetry = readyTelemetry();
    const unexpected = {
      projectId: 'project-a',
      topicName: 'topic-a',
      subscriptionName: 'unexpected-listener',
      classification: 'forwarded',
    };
    telemetry.recordListenerStarted(unexpected);
    const unsafe = telemetry.snapshot({
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions: OBSERVED,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });
    expect(unsafe.topologyMatch).toBe(false);
    expect(unsafe.activeListenerTopologyHash).not.toBe(unsafe.observedTopologyHash);

    telemetry.recordListenerStopped(unexpected);
    const safe = telemetry.snapshot({
      topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
      subscriptions: OBSERVED,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });
    expect(safe.topologyMatch).toBe(true);
  });

  it('rejects duplicate expected tuples and unknown classifications', () => {
    expect(
      () =>
        new PubSubDrainTelemetry({
          expectedTopology: [...EXPECTED, FORWARDED_SUBSCRIPTION],
        })
    ).toThrow(/duplicate/u);
    expect(
      () =>
        new PubSubDrainTelemetry({
          expectedTopology: [{ ...FORWARDED_SUBSCRIPTION, classification: 'ignored' }],
        })
    ).toThrow(/classified/u);
  });

  it('keeps a handler in flight until forwarding and ack accounting are observable', async () => {
    const telemetry = readyTelemetry();
    let releaseForward!: (value: boolean) => void;
    const forward = new Promise<boolean>((resolve) => {
      releaseForward = resolve;
    });
    const ack = vi.fn();
    const nack = vi.fn();

    const handling = telemetry.observeMessage({
      subscription: FORWARDED_SUBSCRIPTION,
      forward: async () => await forward,
      ack,
      nack,
    });
    await Promise.resolve();

    expect(telemetry.counters()).toMatchObject({
      inFlightHandlers: 1,
      receivedTotal: 1,
      ackedTotal: 0,
    });

    releaseForward(true);
    await handling;

    expect(ack).toHaveBeenCalledOnce();
    expect(nack).not.toHaveBeenCalled();
    expect(telemetry.counters()).toMatchObject({
      inFlightHandlers: 0,
      receivedTotal: 1,
      ackedTotal: 1,
      nackedTotal: 0,
      forwardFailuresTotal: 0,
    });
  });

  it('records forwarding failure and nack before releasing the handler', async () => {
    const telemetry = readyTelemetry();
    const ack = vi.fn();
    const nack = vi.fn();

    await telemetry.observeMessage({
      subscription: FORWARDED_SUBSCRIPTION,
      forward: async () => false,
      ack,
      nack,
    });

    expect(ack).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledOnce();
    expect(telemetry.counters()).toMatchObject({
      inFlightHandlers: 0,
      nackedTotal: 1,
      forwardFailuresTotal: 1,
    });
  });

  it('does not misclassify an ack handoff exception as a forwarding failure', async () => {
    const telemetry = readyTelemetry();
    const nack = vi.fn();

    await telemetry.observeMessage({
      subscription: FORWARDED_SUBSCRIPTION,
      forward: async () => true,
      ack: () => {
        throw new Error('ack handoff failed');
      },
      nack,
    });

    expect(nack).toHaveBeenCalledOnce();
    expect(telemetry.counters()).toMatchObject({
      inFlightHandlers: 0,
      ackedTotal: 0,
      nackedTotal: 1,
      forwardFailuresTotal: 0,
      subscriberErrorsTotal: 1,
      lastErrorAt: '2026-08-28T10:00:00.000Z',
    });
  });

  it('tracks setup and subscriber errors without exposing error details', () => {
    const telemetry = readyTelemetry();
    telemetry.recordSetupError(FORWARDED_SUBSCRIPTION);
    telemetry.recordSubscriberError(MONITOR_SUBSCRIPTION);

    const serialized = JSON.stringify(
      telemetry.snapshot({
        topics: OBSERVED.map(({ projectId, topicName }) => ({ projectId, topicName })),
        subscriptions: OBSERVED,
        topologyObservedAt: '2026-08-28T10:00:00.000Z',
      })
    );
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('messageId');
    expect(serialized).not.toContain('ackId');
    expect(serialized).not.toContain('callback');
    expect(serialized).not.toContain('secret');
    expect(telemetry.counters()).toMatchObject({
      setupErrors: 1,
      subscriberErrorsTotal: 1,
    });
  });

  it('exposes only the recursively allowlisted privacy-safe snapshot schema', () => {
    const telemetry = new PubSubDrainTelemetry({
      expectedTopology: EXPECTED.map((tuple) => ({ ...tuple, secret: 'not-public' })),
      now: (): Date => new Date('2026-08-28T10:00:00.000Z'),
      counterEpochId: '00112233445566778899aabbccddeeff',
    });
    for (const tuple of EXPECTED) {
      const hostileListener = { ...tuple, callback: 'private' };
      telemetry.recordListenerStarted(hostileListener);
    }
    const hostileObserved = OBSERVED.map((tuple) => ({
      ...tuple,
      payload: 'private',
      messageId: 'private',
      ackId: 'private',
      attributes: { private: true },
    }));
    const snapshot = telemetry.snapshot({
      topics: hostileObserved,
      subscriptions: hostileObserved,
      topologyObservedAt: '2026-08-28T10:00:00.000Z',
    });

    expect(Object.keys(snapshot).sort()).toEqual(
      [
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
      ].sort()
    );
    expect(Object.keys(snapshot.subscriptionCounts).sort()).toEqual(
      [
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
      ].sort()
    );
    expect(Object.keys(snapshot.classificationCounts).sort()).toEqual(
      ['forwarded', 'monitor-only'].sort()
    );
    for (const listener of snapshot.listenerMultiplicity) {
      expect(Object.keys(listener).sort()).toEqual(
        ['projectId', 'topicName', 'subscriptionName', 'classification', 'listeners'].sort()
      );
    }
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });

  it('generates a new immutable 128-bit counter epoch for each process instance', () => {
    const first = new PubSubDrainTelemetry({ expectedTopology: EXPECTED });
    const second = new PubSubDrainTelemetry({ expectedTopology: EXPECTED });

    expect(first.counters().counterEpochId).toMatch(/^[0-9a-f]{32}$/u);
    expect(second.counters().counterEpochId).toMatch(/^[0-9a-f]{32}$/u);
    expect(first.counters().counterEpochId).not.toBe(second.counters().counterEpochId);
    expect(first.counters().counterEpochId).toBe(first.counters().counterEpochId);
  });
});
