# @intexuraos/calendar-pubsub-client

Publisher-side leaf client for the calendar-preview Pub/Sub topic.

This package exists so that services which only need to **enqueue** a
calendar preview generation request can do so without depending on the
consumer service (`calendar-agent`) and without polluting the generic
`@intexuraos/infra-pubsub` package with domain-specific publishers.

## Exports

- `createCalendarPreviewPublisher(config)` — factory returning a
  `CalendarPreviewPublisher` bound to a Pub/Sub topic.
- `CalendarPreviewPublisher` — the publisher interface.
- `CalendarPreviewPublisherConfig` — `{ projectId, topicName, logger }`.
- `CalendarPreviewGenerateEvent` — payload shape consumed by `calendar-agent`.

## Dependencies

- `@intexuraos/common-core` — `Result` helpers.
- `@intexuraos/infra-pubsub` — `BasePubSubPublisher` + `PublishError`.
