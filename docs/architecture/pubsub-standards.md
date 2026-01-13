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

## PublishError Codes

The shared `PublishError` type has three codes:

| Code                | Description                       |
| -------------------  | ---------------------------------  |
| `PUBLISH_FAILED`    | Generic publish failure           |
| `TOPIC_NOT_FOUND`   | Topic doesn't exist               |
| `PERMISSION_DENIED` | Service account lacks permissions |

## Topic Naming Convention

Topics follow the pattern: `intexuraos-{domain}-{purpose}-{environment}`

Examples:

- `intexuraos-whatsapp-webhook-process-dev`
- `intexuraos-commands-ingest-prod`
- `intexuraos-research-process-staging`

## Environment Variables

All topic configuration uses `INTEXURAOS_PUBSUB_*` prefix:

| Variable                                   | Service          | Description              |
| ------------------------------------------  | ----------------  | ------------------------  |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | whatsapp-service | Media cleanup events     |
| `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`  | whatsapp-service | Command ingestion        |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | whatsapp-service | Webhook async processing |
| `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`    | whatsapp-service | Audio transcription      |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | llm-orchestrator | Research processing      |
| `INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC` | commands-router  | Research actions         |

## What BasePubSubPublisher Provides

1. **PubSub client management** - Creates and caches topic references
2. **Consistent logging** - Pre/post publish logs with context
3. **Error mapping** - Converts GCP errors to `PublishError` codes
4. **Optional topics** - Gracefully handles null topic names (skips publish)
5. **Silent test mode** - Suppresses logs when `NODE_ENV=test`

## Verification

A verification script ensures all publishers extend `BasePubSubPublisher`:

```bash
pnpm run verify:pubsub
```

This runs as part of `pnpm run ci`.
