import type { DrainTopologyTuple } from './pubsub-drain.mjs';

export interface PubSubTopicConfig {
  readonly name: string;
  readonly endpoint: string | null;
}

export const TOPIC_CONFIGS: readonly PubSubTopicConfig[];
export const TOPICS: readonly string[];
export const TOPIC_ENDPOINTS: Readonly<Record<string, string | null>>;
export function buildExpectedDrainTopology(
  environment?: Readonly<Record<string, string | undefined>>
): DrainTopologyTuple[];
