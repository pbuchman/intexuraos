# Pub/Sub Standards

## Overview

All Pub/Sub publishers in the codebase extend `BasePubSubPublisher` from `@intexuraos/infra-pubsub`. This ensures consistent error handling, logging, and topic management.

## Creating a New Publisher

### 1. Extend BasePubSubPublisher

```typescript
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type { Result } from '@intexuraos/common-core';

export interface MyEventPublisherConfig {
  projectId: string;
  topicName: string;
}

export class MyEventPublisher extends BasePubSubPublisher {
  private readonly topicName: string;

  constructor(config: MyEventPublisherConfig) {
    super({ projectId: config.projectId, loggerName: 'my-event-publisher' });
    this.topicName = config.topicName;
  }

  async publishMyEvent(event: MyEvent): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { eventId: event.id }, // Context for logging
      'my event' // Human-readable description
    );
  }
}
```

### 2. Configure Topic via Environment Variable

Topic names should come from environment variables, not hardcoded:

```typescript
// ❌ Wrong - hardcoded topic
const topicName = 'intexuraos-my-topic-dev';

// ✅ Correct - from environment
const topicName = process.env['INTEXURAOS_PUBSUB_MY_TOPIC'];
```

### 3. Handle Domain-Specific Errors

If your domain requires a different error type, map the result:

```typescript
async publishMyEvent(event: MyEvent): Promise<Result<void, MyDomainError>> {
  const result = await this.publishToTopic(this.topicName, event, {}, 'my event');

  if (result.ok) {
    return ok(undefined);
  }

  return err({
    code: 'INTERNAL_ERROR',
    message: result.error.message,
  });
}
```

## Consumer Contract

Consumers (Cloud Functions workers triggered by Pub/Sub) MUST wrap their handlers in the `withObservability` helper from `@intexuraos/common-worker`. This guarantees uniform ack/nack semantics, structured observability logs, Sentry reporting, and correct dead-letter routing across every worker. See the package contract in [`docs/plans/2026-04-24-workers-layer-refactor.md`](../plans/2026-04-24-workers-layer-refactor.md) §3.3.

### AckResult return values

Handlers MUST return an `AckResult` describing the disposition of each message. The `AckDecision` enum has exactly three variants:

- `AckDecision.Ack = 'ack'` — handler succeeded; Pub/Sub ACKs the message.
- `AckDecision.Nack = 'nack'` — transient failure; Pub/Sub redelivers per the subscription's retry policy.
- `AckDecision.DeadLetter = 'dlq'` — permanent failure (e.g., schema mismatch, unknown event type); message is published to the configured DLQ topic and ACKed.

```typescript
export interface AckResult {
  readonly decision: AckDecision;
  readonly reason?: string;
}
```

### `withObservability` wrapper semantics

The wrapper translates each `AckResult` into the corresponding wire behavior:

| `AckDecision`                                           | Wire behavior                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AckDecision.Ack`                                       | resolve (Pub/Sub ACKs).                                                                  |
| `AckDecision.Nack`                                      | throw (Pub/Sub redelivers; triggers subscription retry policy).                          |
| `AckDecision.DeadLetter` with `dlqPublish` provided     | publish payload + reason to DLQ and resolve.                                             |
| `AckDecision.DeadLetter` without `dlqPublish` provided  | treat as Nack (redeliver) and log a WARN — never silently ACK.                           |
| Handler throws                                          | reported to Sentry, re-thrown as Nack.                                                   |

The wrapper also emits structured `worker_request_*` log entries on entry and exit (e.g. `worker_request_start`, `worker_request_ack`, `worker_request_nack`, `worker_request_dlq`) so every message has a paired start/finish trace.

### Worked example: transcription translation table

The transcription worker historically used `return` (silent ACK) for every parse / schema / event-type failure, masking malformed messages from the DLQ. Under the consumer contract, each early return becomes an explicit `AckResult`:

| Old behavior                                                                  | New behavior                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `messageData === undefined` → `return` (silent ACK)                           | `return { decision: AckDecision.DeadLetter, reason: 'missing_message_data' }`  |
| JSON parse throws → `return` (silent ACK)                                     | `return { decision: AckDecision.DeadLetter, reason: 'parse_error' }`           |
| `audioEvent.type !== 'whatsapp.audio.stored'` → `return` (silent ACK)         | `return { decision: AckDecision.DeadLetter, reason: 'unexpected_event_type' }` |
| `!isAudioStoredEvent(audioEvent)` → `return` (silent ACK)                     | `return { decision: AckDecision.DeadLetter, reason: 'invalid_event_schema' }`  |
| Successful transcription publish                                              | `return { decision: AckDecision.Ack }`                                         |
| Transcription or downstream throws                                            | Let it propagate → `withObservability` turns into Nack (redelivery)            |

## PublishError Codes

The shared `PublishError` type has three codes:

| Code                | Description                       |
| ------------------- | --------------------------------- |
| `PUBLISH_FAILED`    | Generic publish failure           |
| `TOPIC_NOT_FOUND`   | Topic doesn't exist               |
| `PERMISSION_DENIED` | Service account lacks permissions |

## Topic Naming Convention

Topics follow the pattern: `intexuraos-{domain}-{purpose}-{environment}`

Examples:

- `intexuraos-whatsapp-webhook-process-dev`
- `intexuraos-intex-message-ingest-prod`
- `intexuraos-research-process-staging`

## Environment Variables

All topic configuration uses `INTEXURAOS_PUBSUB_*` prefix:

| Variable                                   | Service          | Description              |
| ------------------------------------------ | ---------------- | ------------------------ |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | whatsapp-service | Media cleanup events     |
| `INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC` | whatsapp-service | Intex text ingestion     |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | whatsapp-service | Webhook async processing |
| `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`    | whatsapp-service | Audio transcription      |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | research-agent   | Research processing      |

## What BasePubSubPublisher Provides

1. **PubSub client management** - Creates and caches topic references
2. **Consistent logging** - Pre/post publish logs with context
3. **Error mapping** - Converts GCP errors to `PublishError` codes
4. **Optional topics** - Gracefully handles null topic names (skips publish)
5. **Silent test mode** - Suppresses logs when `NODE_ENV=test`

## Local Development

### Architecture

In production, GCP Pub/Sub automatically pushes messages to Cloud Run service endpoints. Locally, the **pubsub-ui** Docker container bridges this gap:

```
Service (publisher) → Pub/Sub Emulator (:8102) → pubsub-ui (:8105) → Service (handler)
```

**pubsub-ui** pulls messages from the emulator and POSTs them to local service endpoints (for example, `http://localhost:8113/internal/whatsapp/pubsub/process-webhook`).

### Starting Local Pub/Sub

```bash
# Start all Docker containers (includes pubsub-ui)
pnpm run dev

# Or just emulators
pnpm run emulators:start
```

### Monitoring Dashboard

Open http://localhost:8105 to view the Pub/Sub monitoring dashboard:

- Real-time event stream
- Topic filtering
- Message payload inspection

### Common Issues

**"Topic not found" errors**: The pubsub-ui container creates topics on startup. If PM2 services started before pubsub-ui, restart them:

```bash
pnpm exec pm2 restart all
```

**Messages not processing**: Verify pubsub-ui is running:

```bash
docker compose -f docker/docker-compose.local.yaml ps
curl http://localhost:8105/health | jq '.topics | length'  # Should be 14
```

## Verification

A verification script ensures all publishers extend `BasePubSubPublisher`:

```bash
pnpm run verify:pubsub
```

This runs as part of `pnpm run ci`.
