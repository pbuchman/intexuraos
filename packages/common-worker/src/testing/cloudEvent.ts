/**
 * makePubSubCloudEvent — synthesizes a `CloudEvent<PubSubData>` for unit tests.
 *
 * Mirrors the shape that `@google-cloud/functions-framework` delivers for a
 * Pub/Sub-triggered Cloud Function: the JSON-encoded payload is base64-encoded
 * and placed at `event.data.message.data`. Overrides let tests inject a
 * different `id`, `source`, or `type`. To exercise the "missing message data"
 * DLQ path, pass `{ data: undefined }` (key MUST be present in the overrides
 * object — see the explicit `'data' in overrides` branch below; we don't rely
 * on spread semantics, which would silently break if a refactor changed the
 * merge order).
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

/**
 * Override shape used by `makePubSubCloudEvent`. `data` is explicitly
 * `PubSubData | undefined` so callers can pass `undefined` without a
 * double-cast in tests.
 */
export type PubSubCloudEventOverrides = Partial<Omit<PubSubCloudEvent, 'data'>> & {
  data?: PubSubData | undefined;
};

export function makePubSubCloudEvent(
  payload: unknown,
  overrides: PubSubCloudEventOverrides = {}
): PubSubCloudEvent {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  // Build the result without spreading so the "strip data" branch is explicit:
  // `'data' in overrides` lets a caller pass `{ data: undefined }` to simulate
  // the missing-message-data DLQ path without depending on object-spread merge
  // order with `undefined` values.
  const data =
    'data' in overrides ? overrides.data : { message: { data: encoded, attributes: {} } };
  return {
    id: overrides['id'] ?? 'test-event-id',
    source: overrides['source'] ?? 'test',
    type: overrides['type'] ?? 'google.cloud.pubsub.topic.v1.messagePublished',
    specversion: '1.0',
    data,
  } as PubSubCloudEvent;
}
