# @intexuraos/infra-pubsub - Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/infra-pubsub
version: 3.3.0
type: module
leaf: false
dependencies:
  - @intexuraos/common-core (workspace)
  - @google-cloud/pubsub ^4.9.0
  - pino ^10.1.0
entry_points:
  - ".": ./src/index.ts
```

## Exported Types

```typescript
// types.ts
interface PublishError {
  code: 'PUBLISH_FAILED' | 'TOPIC_NOT_FOUND' | 'PERMISSION_DENIED';
  message: string;
}

interface SendMessageEvent {
  type: 'whatsapp.message.send';
  userId: string;
  message: string;
  replyToMessageId?: string;
  buttons?: WhatsAppInteractiveButton[];
  ctaUrl?: { displayText: string; url: string };
  correlationId: string;
  timestamp: string;
}

interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: { id: string; title: string };
}

interface WhatsAppSendPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}

// basePublisher.ts
interface BasePubSubPublisherConfig {
  projectId: string;
  logger: Logger;
}

type PublishContext = Record<string, unknown>;
```

## Exported Interfaces (Publishers)

```typescript
interface WhatsAppSendPublisher {
  publishSendMessage(params: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    buttons?: WhatsAppInteractiveButton[];
    ctaUrl?: { displayText: string; url: string };
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

```

## Exported Classes

```typescript
abstract class BasePubSubPublisher {
  protected readonly pubsub: PubSub;
  protected readonly logger: Logger;
  constructor(config: BasePubSubPublisherConfig);
  protected publishToTopic(
    topicName: string | null,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>>;
}
```

## Exported Factory Functions

```typescript
function createWhatsAppSendPublisher(config: WhatsAppSendPublisherConfig): WhatsAppSendPublisher;
```

## Event Type Registry

| Event Type                  | Publisher                | Consumer         |
| --------------------------- | ------------------------ | ---------------- |
| `whatsapp.message.send`     | WhatsAppSendPublisher    | whatsapp-service |

## Environment Variables (per consumer)

```
INTEXURAOS_GCP_PROJECT_ID         - GCP project ID
INTEXURAOS_WHATSAPP_SEND_TOPIC    - Topic for WhatsApp send events
```

## Dependency Graph

```
common-core -> infra-pubsub -> bookmarks-agent
                             -> code-agent
                             -> research-agent
                             -> whatsapp-service
                             -> workers/transcription
```

## Test Mock Pattern

```typescript
const fakePublisher: WhatsAppSendPublisher = {
  publishSendMessage: vi.fn().mockResolvedValue(ok(undefined)),
};

const fakePublisherWithError: WhatsAppSendPublisher = {
  publishSendMessage: vi
    .fn()
    .mockResolvedValue(err({ code: 'PUBLISH_FAILED', message: 'test error' })),
};
```

## Adding a New Publisher

1. Define the event type and config in `types.ts`
2. Create a new file extending `BasePubSubPublisher`
3. Export the interface, factory function, and types from `index.ts`
4. Add the topic env var to the consuming service's `REQUIRED_ENV`
5. Add the topic to Terraform and `ecosystem.config.cjs`
6. Run `pnpm run verify:pubsub` to validate compliance
