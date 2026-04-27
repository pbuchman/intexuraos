# @intexuraos/calendar-pubsub-client

Publisher-side leaf client for the `calendar.preview.generate` Pub/Sub topic. Lets any service enqueue a calendar-preview generation request for `calendar-agent`, without taking a workspace dependency on `calendar-agent` itself.

**Type:** ESM
**Node:** >=22.0.0

## Why this package exists

`@intexuraos/infra-pubsub` is a generic, domain-free wrapper around `@google-cloud/pubsub`. Domain event types and topic-specific factory functions used to live alongside it, which created a hidden dependency: every publisher imported a payload type that semantically belonged to the consumer service.

To break that cycle, each typed publisher now lives in its own leaf client package. Publishers depend on the leaf client, the leaf client depends on `infra-pubsub`, and the consumer service depends on neither.

## Dependencies

| Package                     | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `@intexuraos/common-core`   | `Result` helpers for the publisher API   |
| `@intexuraos/infra-pubsub`  | `BasePubSubPublisher` + `PublishError`   |

## Exports

- `createCalendarPreviewPublisher(config)` — factory returning a `CalendarPreviewPublisher` bound to a Pub/Sub topic.
- `CalendarPreviewPublisher` — publisher interface (`publishCalendarPreviewGenerate`).
- `CalendarPreviewPublisherConfig` — `{ projectId, topicName, logger }`.
- `CalendarPreviewGenerateEvent` — payload shape consumed by `calendar-agent`.

## Usage

```ts
import { createCalendarPreviewPublisher } from '@intexuraos/calendar-pubsub-client';

const publisher = createCalendarPreviewPublisher({
  projectId: process.env['INTEXURAOS_GCP_PROJECT_ID']!,
  topicName: process.env['INTEXURAOS_CALENDAR_PREVIEW_TOPIC']!,
  logger,
});

const result = await publisher.publishCalendarPreviewGenerate({
  previewId: 'preview-123',
  userId: 'user-456',
});

if (!result.ok) {
  logger.error({ error: result.error }, 'Failed to enqueue calendar preview');
}
```

## Used By

Future calendar-preview producers will depend on this package; today the consumer (`calendar-agent`) self-publishes through it during scheduling/retry flows.

## Source Files

| File                                  | Purpose                                      |
| ------------------------------------- | -------------------------------------------- |
| `src/index.ts`                        | Public barrel                                |
| `src/calendarPreviewPublisher.ts`     | `createCalendarPreviewPublisher` factory     |
| `src/types.ts`                        | `CalendarPreviewGenerateEvent` payload shape |
