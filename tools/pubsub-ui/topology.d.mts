import type { DrainTopologyTuple } from './pubsub-drain.mjs';

export interface PubSubTopicConfig {
  readonly name: string;
  readonly endpoint: string | null;
}

export interface PreservedLegacyTopicConfig {
  readonly name: string;
  readonly subscriptionName: string;
}

export const TOPIC_CONFIGS: readonly PubSubTopicConfig[];
export const TOPICS: readonly string[];
export const TOPIC_ENDPOINTS: Readonly<Record<string, string | null>>;
export const PRESERVED_LEGACY_TOPIC_CONFIGS: readonly PreservedLegacyTopicConfig[];
export function buildExpectedDrainTopology(
  environment?: Readonly<Record<string, string | undefined>>
): DrainTopologyTuple[];
export function buildPreservedLegacyDrainTopology(
  environment?: Readonly<Record<string, string | undefined>>
): DrainTopologyTuple[];
