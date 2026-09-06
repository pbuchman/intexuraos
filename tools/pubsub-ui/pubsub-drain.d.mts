export interface DrainTopologyTuple {
  projectId: string;
  topicName: string;
  subscriptionName: string;
  classification: 'forwarded' | 'monitor-only' | 'preservedLegacy';
}

export interface ObservedDrainTopologyTuple {
  projectId: string;
  topicName: string;
  subscriptionName: string;
}

export interface PubSubDrainSnapshot {
  counterEpochId: string;
  processStartedAt: string;
  expectedTopologyHash: string;
  expectedObservedTopologyHash: string;
  preservedLegacyTopologyHash: string;
  observedTopologyHash: string | null;
  topologyObservedAt: string | null;
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
  classificationCounts: Record<string, number>;
  listenerMultiplicity: Array<
    ObservedDrainTopologyTuple & { classification: string; listeners: number }
  >;
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

export function canonicalTopologyHash(tuples: readonly ObservedDrainTopologyTuple[]): string;

export function collectPubSubDrainTopology(options: {
  projectIds: readonly string[];
  getClient: (projectId: string) => {
    getTopics(): Promise<readonly [readonly { name: string }[], ...unknown[]]>;
    getSubscriptions(): Promise<
      readonly [
        readonly {
          name: string;
          metadata?: { topic?: string | null };
          topic?: string | { name: string };
        }[],
        ...unknown[],
      ]
    >;
  };
  now?: () => Date;
}): Promise<{
  topics: Array<{ projectId: string; topicName: string }>;
  subscriptions: ObservedDrainTopologyTuple[];
  topologyObservedAt: string;
}>;

export class PubSubDrainTelemetry {
  constructor(options: {
    expectedTopology: readonly DrainTopologyTuple[];
    preservedLegacyTopology?: readonly DrainTopologyTuple[];
    now?: () => Date;
    counterEpochId?: string;
  });
  recordListenerStarted(subscription: DrainTopologyTuple): void;
  recordListenerStopped(subscription: DrainTopologyTuple): void;
  recordSetupError(subscription: DrainTopologyTuple): void;
  recordSubscriberError(subscription: DrainTopologyTuple): void;
  recordTopologyRefreshError(): void;
  observeMessage(options: {
    subscription: DrainTopologyTuple;
    forward: () => Promise<boolean>;
    ack: () => void;
    nack: () => void;
  }): Promise<void>;
  counters(): Pick<
    PubSubDrainSnapshot,
    | 'counterEpochId'
    | 'processStartedAt'
    | 'setupErrors'
    | 'inFlightHandlers'
    | 'receivedTotal'
    | 'ackedTotal'
    | 'nackedTotal'
    | 'forwardFailuresTotal'
    | 'subscriberErrorsTotal'
    | 'topologyRefreshErrorsTotal'
    | 'lastActivityAt'
    | 'lastErrorAt'
  >;
  snapshot(observation: {
    topics: readonly { projectId: string; topicName: string }[];
    subscriptions: readonly ObservedDrainTopologyTuple[];
    topologyObservedAt: string;
    topologyRefreshFailed?: boolean;
  }): PubSubDrainSnapshot;
}
