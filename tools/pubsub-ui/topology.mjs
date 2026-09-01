import { resolvePubSubProjectId, resolvePubSubProjectIds } from './pubsub-forwarding.mjs';

export const TOPIC_CONFIGS = Object.freeze([
  {
    name: 'whatsapp-media-cleanup',
    endpoint: 'http://host.docker.internal:8113/internal/whatsapp/pubsub/media-cleanup',
  },
  {
    name: 'whatsapp-send-message',
    endpoint: 'http://host.docker.internal:8113/internal/whatsapp/pubsub/send-message',
  },
  {
    name: 'whatsapp-webhook-process',
    endpoint: 'http://host.docker.internal:8113/internal/whatsapp/pubsub/process-webhook',
  },
  { name: 'whatsapp-audio-stored', endpoint: null },
  {
    name: 'whatsapp-transcription-completed',
    endpoint: 'http://host.docker.internal:8113/internal/whatsapp/pubsub/transcription-completed',
  },
  {
    name: 'intex-message-ingest',
    endpoint: 'http://host.docker.internal:8134/internal/intex-agent/messages',
  },
  {
    name: 'research-process',
    endpoint: 'http://host.docker.internal:8116/internal/llm/pubsub/process-research',
  },
  {
    name: 'llm-analytics',
    endpoint: 'http://host.docker.internal:8116/internal/llm/pubsub/report-analytics',
  },
  {
    name: 'llm-call',
    endpoint: 'http://host.docker.internal:8116/internal/llm/pubsub/process-llm-call',
  },
  {
    name: 'bookmark-enrich',
    endpoint: 'http://host.docker.internal:8124/internal/bookmarks/pubsub/enrich',
  },
  {
    name: 'bookmark-summarize',
    endpoint: 'http://host.docker.internal:8124/internal/bookmarks/pubsub/summarize',
  },
  {
    name: 'pr-triage',
    endpoint: 'http://host.docker.internal:8128/internal/code/pubsub/pr-triage',
  },
  {
    name: 'message-digest-runs',
    endpoint: 'http://host.docker.internal:8135/internal/message-digests/pubsub/run',
  },
  { name: 'intexuraos-runtime-credential-canary-dev', endpoint: null },
]);

export const TOPICS = Object.freeze(TOPIC_CONFIGS.map(({ name }) => name));
export const TOPIC_ENDPOINTS = Object.freeze(
  Object.fromEntries(TOPIC_CONFIGS.map(({ name, endpoint }) => [name, endpoint]))
);

export const PRESERVED_LEGACY_TOPIC_CONFIGS = Object.freeze(
  [
    'actions-queue',
    'approval-reply',
    'calendar-preview',
    'commands-ingest',
    'snapshot-refresh',
    'todos-processing',
    'whatsapp-transcription',
  ].map((name) => Object.freeze({ name, subscriptionName: `${name}-ui-monitor` }))
);

export function buildExpectedDrainTopology(environment = {}) {
  return TOPIC_CONFIGS.flatMap(({ name: topicName, endpoint }) =>
    resolvePubSubProjectIds(topicName, environment).map((projectId) => ({
      projectId,
      topicName,
      subscriptionName: `${topicName}-ui-monitor`,
      classification: endpoint === null ? 'monitor-only' : 'forwarded',
    }))
  );
}

export function buildPreservedLegacyDrainTopology(environment = {}) {
  return PRESERVED_LEGACY_TOPIC_CONFIGS.map(({ name: topicName, subscriptionName }) => ({
    projectId: resolvePubSubProjectId(topicName, environment),
    topicName,
    subscriptionName,
    classification: 'preservedLegacy',
  }));
}
