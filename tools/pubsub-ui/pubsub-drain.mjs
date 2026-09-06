import { createHash, randomBytes } from 'node:crypto';

function tupleKey(tuple) {
  return JSON.stringify([tuple.projectId, tuple.topicName, tuple.subscriptionName]);
}

function publicTuple(tuple) {
  return {
    projectId: tuple.projectId,
    topicName: tuple.topicName,
    subscriptionName: tuple.subscriptionName,
  };
}

function canonicalTupleArray(tuples) {
  return tuples
    .map((tuple) => [tuple.projectId, tuple.topicName, tuple.subscriptionName])
    .sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      return Buffer.compare(Buffer.from(leftJson, 'utf8'), Buffer.from(rightJson, 'utf8'));
    });
}

export function canonicalTopologyHash(tuples) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalTupleArray(tuples)))
    .digest('hex');
}

function resourceTail(resourceName) {
  if (typeof resourceName !== 'string') return null;
  const tail = resourceName.split('/').at(-1);
  return typeof tail === 'string' && tail.length > 0 ? tail : null;
}

export async function collectPubSubDrainTopology({
  projectIds,
  getClient,
  now = () => new Date(),
}) {
  const topics = [];
  const subscriptions = [];

  for (const projectId of [...new Set(projectIds)]) {
    const client = getClient(projectId);
    const [listedTopics] = await client.getTopics();
    const [listedSubscriptions] = await client.getSubscriptions();

    for (const topic of listedTopics) {
      const topicName = resourceTail(topic.name);
      if (topicName !== null) topics.push({ projectId, topicName });
    }

    for (const subscription of listedSubscriptions) {
      const subscriptionName = resourceTail(subscription.name);
      const rawTopic =
        subscription.metadata?.topic ??
        (typeof subscription.topic === 'string' ? subscription.topic : subscription.topic?.name);
      const topicName = resourceTail(rawTopic);
      if (subscriptionName !== null) {
        subscriptions.push({
          projectId,
          topicName: topicName ?? '<unresolved-topic>',
          subscriptionName,
        });
      }
    }
  }

  return { topics, subscriptions, topologyObservedAt: byteSafeTimestamp(now) };
}

function byteSafeTimestamp(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('Pub/Sub drain clock must return a valid Date');
  }
  return value.toISOString();
}

export class PubSubDrainTelemetry {
  #expectedTopology;
  #expectedByKey;
  #preservedLegacyTopology;
  #preservedLegacyByKey;
  #expectedObservedTopology;
  #allowedByKey;
  #now;
  #counterEpochId;
  #processStartedAt;
  #listenerCounts = new Map();
  #listenerTuples = new Map();
  #setupErrors = 0;
  #inFlightHandlers = 0;
  #receivedTotal = 0;
  #ackedTotal = 0;
  #nackedTotal = 0;
  #forwardFailuresTotal = 0;
  #subscriberErrorsTotal = 0;
  #topologyObservationSequence = 0;
  #topologyRefreshErrorsTotal = 0;
  #lastActivityAt = null;
  #lastErrorAt = null;

  constructor({
    expectedTopology,
    preservedLegacyTopology = [],
    now = () => new Date(),
    counterEpochId,
  } = {}) {
    if (!Array.isArray(expectedTopology)) {
      throw new Error('expectedTopology must be an array');
    }
    if (!Array.isArray(preservedLegacyTopology)) {
      throw new Error('preservedLegacyTopology must be an array');
    }
    this.#expectedTopology = expectedTopology.map((tuple) => ({ ...tuple }));
    this.#preservedLegacyTopology = preservedLegacyTopology.map((tuple) => ({ ...tuple }));
    const expectedKeys = new Set();
    for (const tuple of this.#expectedTopology) {
      if (
        typeof tuple.projectId !== 'string' ||
        tuple.projectId.length === 0 ||
        typeof tuple.topicName !== 'string' ||
        tuple.topicName.length === 0 ||
        typeof tuple.subscriptionName !== 'string' ||
        tuple.subscriptionName.length === 0 ||
        (tuple.classification !== 'forwarded' && tuple.classification !== 'monitor-only')
      ) {
        throw new Error('expectedTopology contains an invalid classified tuple');
      }
      const key = tupleKey(tuple);
      if (expectedKeys.has(key)) throw new Error('expectedTopology contains a duplicate tuple');
      expectedKeys.add(key);
    }
    this.#expectedByKey = new Map(this.#expectedTopology.map((tuple) => [tupleKey(tuple), tuple]));
    const preservedLegacyKeys = new Set();
    for (const tuple of this.#preservedLegacyTopology) {
      if (
        typeof tuple.projectId !== 'string' ||
        tuple.projectId.length === 0 ||
        typeof tuple.topicName !== 'string' ||
        tuple.topicName.length === 0 ||
        typeof tuple.subscriptionName !== 'string' ||
        tuple.subscriptionName.length === 0 ||
        tuple.classification !== 'preservedLegacy'
      ) {
        throw new Error('preservedLegacyTopology contains an invalid preservedLegacy tuple');
      }
      const key = tupleKey(tuple);
      if (preservedLegacyKeys.has(key)) {
        throw new Error('preservedLegacyTopology contains a duplicate tuple');
      }
      if (expectedKeys.has(key)) {
        throw new Error('preservedLegacyTopology overlaps expectedTopology');
      }
      preservedLegacyKeys.add(key);
    }
    this.#preservedLegacyByKey = new Map(
      this.#preservedLegacyTopology.map((tuple) => [tupleKey(tuple), tuple])
    );
    this.#expectedObservedTopology = [...this.#expectedTopology, ...this.#preservedLegacyTopology];
    this.#allowedByKey = new Map(
      this.#expectedObservedTopology.map((tuple) => [tupleKey(tuple), tuple])
    );
    this.#now = now;
    this.#counterEpochId = counterEpochId ?? randomBytes(16).toString('hex');
    if (!/^[0-9a-f]{32}$/u.test(this.#counterEpochId)) {
      throw new Error('counterEpochId must encode exactly 128 random bits');
    }
    this.#processStartedAt = byteSafeTimestamp(this.#now);
  }

  #markActivity() {
    this.#lastActivityAt = byteSafeTimestamp(this.#now);
  }

  #markError() {
    const timestamp = byteSafeTimestamp(this.#now);
    this.#lastActivityAt = timestamp;
    this.#lastErrorAt = timestamp;
  }

  recordListenerStarted(subscription) {
    const key = tupleKey(subscription);
    this.#listenerTuples.set(key, { ...subscription });
    this.#listenerCounts.set(key, (this.#listenerCounts.get(key) ?? 0) + 1);
  }

  recordListenerStopped(subscription) {
    const key = tupleKey(subscription);
    const current = this.#listenerCounts.get(key) ?? 0;
    if (current <= 1) {
      this.#listenerCounts.delete(key);
      this.#listenerTuples.delete(key);
      return;
    }
    this.#listenerCounts.set(key, current - 1);
  }

  recordSetupError(_subscription) {
    this.#setupErrors += 1;
    this.#markError();
  }

  recordSubscriberError(_subscription) {
    this.#subscriberErrorsTotal += 1;
    this.#markError();
  }

  recordTopologyRefreshError() {
    this.#topologyRefreshErrorsTotal += 1;
    this.#markError();
  }

  async observeMessage({ forward, ack, nack }) {
    this.#receivedTotal += 1;
    this.#inFlightHandlers += 1;
    this.#markActivity();

    try {
      let forwarded = false;
      try {
        forwarded = (await forward()) === true;
      } catch {
        forwarded = false;
      }

      if (forwarded) {
        try {
          ack();
          this.#ackedTotal += 1;
          this.#markActivity();
          return;
        } catch {
          this.#subscriberErrorsTotal += 1;
          this.#markError();
          try {
            nack();
            this.#nackedTotal += 1;
            this.#markActivity();
          } catch {
            this.#subscriberErrorsTotal += 1;
            this.#markError();
          }
        }
        return;
      }

      this.#forwardFailuresTotal += 1;
      this.#markError();
      try {
        nack();
        this.#nackedTotal += 1;
        this.#markActivity();
      } catch {
        this.#subscriberErrorsTotal += 1;
        this.#markError();
      }
    } finally {
      this.#inFlightHandlers -= 1;
    }
  }

  counters() {
    return {
      counterEpochId: this.#counterEpochId,
      processStartedAt: this.#processStartedAt,
      setupErrors: this.#setupErrors,
      inFlightHandlers: this.#inFlightHandlers,
      receivedTotal: this.#receivedTotal,
      ackedTotal: this.#ackedTotal,
      nackedTotal: this.#nackedTotal,
      forwardFailuresTotal: this.#forwardFailuresTotal,
      subscriberErrorsTotal: this.#subscriberErrorsTotal,
      topologyRefreshErrorsTotal: this.#topologyRefreshErrorsTotal,
      lastActivityAt: this.#lastActivityAt,
      lastErrorAt: this.#lastErrorAt,
    };
  }

  snapshot({ topics, subscriptions, topologyObservedAt, topologyRefreshFailed = false }) {
    if (!topologyRefreshFailed) this.#topologyObservationSequence += 1;
    const observedTopics = new Set(
      topics.map(({ projectId, topicName }) => JSON.stringify([projectId, topicName]))
    );
    const observedByKey = new Map(subscriptions.map((tuple) => [tupleKey(tuple), tuple]));
    const duplicateSubscriptions = subscriptions.length - observedByKey.size;
    const targetKeys = new Set(this.#expectedByKey.keys());
    const preservedLegacyKeys = new Set(this.#preservedLegacyByKey.keys());
    const expectedKeys = new Set(this.#allowedByKey.keys());
    const observedKeys = new Set(observedByKey.keys());
    const missingTarget = [...targetKeys].filter((key) => !observedKeys.has(key)).length;
    const missingPreservedLegacy = [...preservedLegacyKeys].filter(
      (key) => !observedKeys.has(key)
    ).length;
    const missing = missingTarget + missingPreservedLegacy;
    const unexpected = [...observedKeys].filter((key) => !expectedKeys.has(key)).length;
    const orphaned = subscriptions.filter(
      ({ projectId, topicName }) =>
        typeof topicName !== 'string' || !observedTopics.has(JSON.stringify([projectId, topicName]))
    ).length;
    const classified = subscriptions.filter((tuple) =>
      this.#allowedByKey.has(tupleKey(tuple))
    ).length;
    const unclassified = subscriptions.length - classified;
    const targetObserved = subscriptions.filter((tuple) =>
      this.#expectedByKey.has(tupleKey(tuple))
    ).length;
    const preservedLegacyObserved = subscriptions.filter((tuple) =>
      this.#preservedLegacyByKey.has(tupleKey(tuple))
    ).length;

    const union = new Map();
    for (const tuple of this.#expectedObservedTopology) union.set(tupleKey(tuple), tuple);
    for (const tuple of subscriptions) {
      if (!union.has(tupleKey(tuple))) union.set(tupleKey(tuple), tuple);
    }
    for (const tuple of this.#listenerTuples.values()) {
      if (!union.has(tupleKey(tuple))) union.set(tupleKey(tuple), tuple);
    }
    const listenerMultiplicity = [...union.values()]
      .map((tuple) => {
        const expected = this.#allowedByKey.get(tupleKey(tuple));
        return {
          ...publicTuple(tuple),
          classification: expected?.classification ?? 'unclassified',
          listeners: this.#listenerCounts.get(tupleKey(tuple)) ?? 0,
        };
      })
      .sort((left, right) =>
        Buffer.compare(Buffer.from(tupleKey(left), 'utf8'), Buffer.from(tupleKey(right), 'utf8'))
      );
    const listenerless = listenerMultiplicity.filter(
      (entry) => this.#expectedByKey.has(tupleKey(entry)) && entry.listeners === 0
    ).length;
    const duplicateListeners = listenerMultiplicity.filter(
      (entry) => this.#expectedByKey.has(tupleKey(entry)) && entry.listeners > 1
    ).length;
    const preservedLegacyListeners = listenerMultiplicity
      .filter((entry) => this.#preservedLegacyByKey.has(tupleKey(entry)))
      .reduce((total, entry) => total + entry.listeners, 0);
    const activeListeners = listenerMultiplicity.reduce(
      (total, entry) => total + entry.listeners,
      0
    );

    const activeListenerTuples = listenerMultiplicity
      .filter((entry) => entry.listeners > 0)
      .map(publicTuple);
    const expectedTopologyHash = canonicalTopologyHash(this.#expectedTopology);
    const expectedObservedTopologyHash = canonicalTopologyHash(this.#expectedObservedTopology);
    const preservedLegacyTopologyHash = canonicalTopologyHash(this.#preservedLegacyTopology);
    const observedTopologyHash = topologyRefreshFailed
      ? null
      : canonicalTopologyHash(subscriptions);
    const activeListenerTopologyHash = canonicalTopologyHash(activeListenerTuples);
    const classificationCounts = { forwarded: 0, 'monitor-only': 0, preservedLegacy: 0 };
    for (const tuple of subscriptions) {
      const classification =
        this.#allowedByKey.get(tupleKey(tuple))?.classification ?? 'unclassified';
      classificationCounts[classification] = (classificationCounts[classification] ?? 0) + 1;
    }

    const topologyMatch =
      !topologyRefreshFailed &&
      expectedObservedTopologyHash === observedTopologyHash &&
      activeListenerTopologyHash === expectedTopologyHash &&
      missing === 0 &&
      unexpected === 0 &&
      orphaned === 0 &&
      unclassified === 0 &&
      listenerless === 0 &&
      duplicateListeners === 0 &&
      preservedLegacyListeners === 0 &&
      duplicateSubscriptions === 0 &&
      this.#setupErrors === 0;

    return {
      ...this.counters(),
      expectedTopologyHash,
      expectedObservedTopologyHash,
      preservedLegacyTopologyHash,
      observedTopologyHash,
      topologyObservedAt: topologyRefreshFailed ? null : topologyObservedAt,
      topologyObservationSequence: this.#topologyObservationSequence,
      topologyMatch,
      activeListenerTopologyHash,
      subscriptionCounts: {
        expected: this.#expectedObservedTopology.length,
        observed: subscriptions.length,
        classified,
        unclassified,
        missing,
        unexpected,
        orphaned,
        listenerless,
        duplicateListeners,
        duplicateSubscriptions,
        targetExpected: this.#expectedTopology.length,
        targetObserved,
        preservedLegacyExpected: this.#preservedLegacyTopology.length,
        preservedLegacyObserved,
        missingTarget,
        missingPreservedLegacy,
        preservedLegacyListeners,
      },
      classificationCounts,
      listenerMultiplicity,
      activeListeners,
    };
  }
}
