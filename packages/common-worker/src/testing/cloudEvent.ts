/**
 * makePubSubCloudEvent — synthesizes a `CloudEvent<PubSubData>` for unit tests.
 *
 * Mirrors the shape that `@google-cloud/functions-framework` delivers for a
 * Pub/Sub-triggered Cloud Function: the JSON-encoded payload is base64-encoded
 * and placed at `event.data.message.data`. Overrides let tests inject a
 * different `id`, `source`, or `type`. To exercise the "missing message data"
 * DLQ path, pass `{ data: undefined }` as an override — the spread copies the
 * undefined value over the default.
 */
import type { CloudEvent } from '@google-cloud/functions-framework';

export interface PubSubMessage {
  data?: string;
  attributes?: Record<string, string>;
}

export interface PubSubData {
  message: PubSubMessage;
}

export type PubSubCloudEvent = CloudEvent<PubSubData>;

export function makePubSubCloudEvent(
  payload: unknown,
  overrides: Partial<PubSubCloudEvent> = {}
): PubSubCloudEvent {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  const base: PubSubCloudEvent = {
    id: overrides.id ?? 'test-event-id',
    source: overrides.source ?? 'test',
    type: overrides.type ?? 'google.cloud.pubsub.topic.v1.messagePublished',
    specversion: '1.0',
    data: { message: { data: encoded, attributes: {} } },
  };
  return { ...base, ...overrides };
}
