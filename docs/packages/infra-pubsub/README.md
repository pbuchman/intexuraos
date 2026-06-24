# @intexuraos/infra-pubsub

Generic Pub/Sub infrastructure: a thin wrapper around `@google-cloud/pubsub` that callers extend via `BasePubSubPublisher`. Domain-specific publisher factories live in dedicated leaf client packages — see [Leaf Client Packages](#leaf-client-packages) below.

**Version:** 3.6.0
**Node:** >=22.0.0
**Type:** ESM

## Dependencies

| Package                   | Purpose                      |
| ------------------------- | ---------------------------- |
| `@intexuraos/common-core` | Result types, error handling |
| `@google-cloud/pubsub`    | GCP Pub/Sub client           |
| `pino`                    | Logger type                  |

## Architecture

`BasePubSubPublisher` provides:

- Topic caching (avoids recreating topic references)
- Structured logging for publish operations
- Error classification (TOPIC_NOT_FOUND, PERMISSION_DENIED, PUBLISH_FAILED)
- Required vs optional topic helpers (`publishToTopic` vs `publishToOptionalTopic`)

```
@intexuraos/infra-pubsub          (this package — generic only)
  └── BasePubSubPublisher (abstract)
        ▲
        │ extends
        │
@intexuraos/whatsapp-pubsub-client     → consumed by whatsapp-service
@intexuraos/calendar-pubsub-client     → consumed by calendar-agent
@intexuraos/pr-triage-pubsub-client    → consumed by code-agent
```

Each leaf client package exposes a factory function (`createXxxPublisher`) and an interface type. Publisher-side services depend on the relevant leaf package, never on the consumer service.

## Public Surface

This package exports EXACTLY the following symbols (the "frozen" generic Pub/Sub contract):

- `BasePubSubPublisher` — abstract base class
- `BasePubSubPublisherConfig` — `{ projectId, logger }`
- `PublishContext` — `Record<string, unknown>` for log enrichment
- `PublishError` — `{ code: PublishFailureReason, message: string }`
- `PublishFailureReason` — `'PUBLISH_FAILED' | 'TOPIC_NOT_FOUND' | 'PERMISSION_DENIED'`

Anything else (typed events, factory functions for specific topics) lives in a leaf client package.

## API Reference

### BasePubSubPublisher (`basePublisher.ts`)

Abstract base class for all Pub/Sub publishers.

```typescript
interface BasePubSubPublisherConfig {
  projectId: string;
  logger: Logger;
}

type PublishContext = Record<string, unknown>;

abstract class BasePubSubPublisher {
  protected readonly pubsub: PubSub;
  protected readonly logger: Logger;

  constructor(config: BasePubSubPublisherConfig);

  /**
   * Publish an event to a REQUIRED topic. Subclasses must validate at
   * construction time that `topicName` is non-null.
   */
  protected publishToTopic(
    topicName: string,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>>;

  /**
   * Publish to an OPTIONAL topic. Skips publish (returns ok) when
   * `topicName === null`.
   */
  protected publishToOptionalTopic(
    topicName: string | null,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>>;
}
```

### PublishError / PublishFailureReason (`types.ts`)

```typescript
type PublishFailureReason = 'PUBLISH_FAILED' | 'TOPIC_NOT_FOUND' | 'PERMISSION_DENIED';

interface PublishError {
  code: PublishFailureReason;
  message: string;
}
```

## Leaf Client Packages

Use these to publish typed events to the corresponding consumer service. None of them require depending on the consumer app:

| Package                                 | Factory                          | Event type                   | Consumer           |
| --------------------------------------- | -------------------------------- | ---------------------------- | ------------------ |
| `@intexuraos/whatsapp-pubsub-client`    | `createWhatsAppSendPublisher`    | `whatsapp.message.send`      | `whatsapp-service` |
| `@intexuraos/calendar-pubsub-client`    | `createCalendarPreviewPublisher` | `calendar.preview.generate`  | `calendar-agent`   |
| `@intexuraos/pr-triage-pubsub-client`   | `createPRTriagePublisher`        | `code.pr.triage.requested`   | `code-agent`       |

## Usage — extending `BasePubSubPublisher`

```typescript
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type { Result } from '@intexuraos/common-core';

class MyEventPublisher extends BasePubSubPublisher {
  constructor(
    config: { projectId: string; topicName: string; logger: Logger },
    private readonly topicName: string = config.topicName
  ) {
    super({ projectId: config.projectId, logger: config.logger });
  }

  async publishMyEvent(event: MyEvent): Promise<Result<void, PublishError>> {
    return this.publishToTopic(
      this.topicName,
      event,
      { eventId: event.id },
      'my-event'
    );
  }
}
```

## Usage — publishing via a leaf client

```typescript
import { createWhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';

const publisher = createWhatsAppSendPublisher({
  projectId: process.env['INTEXURAOS_GCP_PROJECT_ID']!,
  topicName: process.env['INTEXURAOS_WHATSAPP_SEND_TOPIC']!,
  logger,
});

const result = await publisher.publishSendMessage({
  userId: 'user-123',
  message: 'Hello from IntexuraOS',
  correlationId: 'corr-456',
});

if (!result.ok) {
  logger.error({ error: result.error }, 'Failed to publish');
}
```

## Used By

`BasePubSubPublisher` is extended by publishers across the monorepo, including:

- Each of the four `*-pubsub-client` leaf packages (above).
- App-internal publishers under `apps/*/src/infra/pubsub/` (e.g. `actions-agent` action-event publisher, `bookmarks-agent` enrich/summarize publishers, `commands-agent` action-event publisher, `research-agent` analytics/llm-call/research-event publishers, `whatsapp-service` outbound-message publisher).
- `workers/transcription` transcription-completed publisher.

## Source Files

| File                   | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `src/index.ts`         | Public barrel — five symbols only                |
| `src/types.ts`         | `PublishError`, `PublishFailureReason`           |
| `src/basePublisher.ts` | `BasePubSubPublisher` abstract base class        |
