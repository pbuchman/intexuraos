# @intexuraos/pr-triage-pubsub-client

Publisher-side leaf client for the `code.pr.triage.requested` Pub/Sub topic. Lets webhook handlers (`code-agent`) enqueue a PR-triage request without polluting the generic `@intexuraos/infra-pubsub` package with domain-specific publishers.

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

- `createPRTriagePublisher(config)` — factory returning a `PRTriagePublisher` bound to a Pub/Sub topic.
- `PRTriagePublisher` — publisher interface (`publishPRTriage`).
- `PRTriagePublisherConfig` — `{ projectId, topicName, logger }`. An empty `topicName` skips publish and resolves to `ok` (used in environments where the push subscription is not wired up).
- `PRTriageEvent` — payload shape consumed by `code-agent`.

## Usage

```ts
import { createPRTriagePublisher } from '@intexuraos/pr-triage-pubsub-client';

const publisher = createPRTriagePublisher({
  projectId: process.env['INTEXURAOS_GCP_PROJECT_ID']!,
  topicName: process.env['INTEXURAOS_PR_TRIAGE_TOPIC'] ?? '',
  logger,
});

const result = await publisher.publishPRTriage({
  prNumber: 1988,
  repository: 'pbuchman/intexuraos',
});

if (!result.ok) {
  logger.error({ error: result.error }, 'Failed to enqueue PR triage');
}
```

## Used By

- `apps/code-agent`

## Source Files

| File                          | Purpose                            |
| ----------------------------- | ---------------------------------- |
| `src/index.ts`                | Public barrel                      |
| `src/prTriagePublisher.ts`    | `createPRTriagePublisher` factory  |
| `src/types.ts`                | `PRTriageEvent` payload shape      |
