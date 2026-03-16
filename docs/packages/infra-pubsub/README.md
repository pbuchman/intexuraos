# @intexuraos/infra-pubsub

Cloud Pub/Sub infrastructure adapters for cross-service messaging. Provides a `BasePubSubPublisher` abstract class and concrete publisher implementations for WhatsApp messaging, todo processing, and calendar preview generation.

**Version:** 3.3.0
**Node:** >=22.0.0
**Type:** ESM

## Dependencies

| Package                   | Purpose                      |
| ------------------------- | ---------------------------- |
| `@intexuraos/common-core` | Result types, error handling |
| `@google-cloud/pubsub`    | GCP Pub/Sub client           |
| `pino`                    | Logger type                  |

## Architecture

All publishers extend `BasePubSubPublisher`, which provides:

- Topic caching (avoids recreating topic references)
- Structured logging for publish operations
- Error classification (TOPIC_NOT_FOUND, PERMISSION_DENIED, PUBLISH_FAILED)
- Graceful no-op when topic is not configured (returns success)

```
BasePubSubPublisher (abstract)
  |-- WhatsAppSendPublisherImpl    -> whatsapp-service
  |-- TodosProcessingPublisherImpl -> todos-agent
  |-- CalendarPreviewPublisherImpl -> calendar-agent
```

Each publisher exposes a factory function (`createXxxPublisher`) and an interface type. Services depend on the interface for testability.

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

  protected publishToTopic(
    topicName: string | null,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>>;
}
```

When `topicName` is `null`, `publishToTopic` logs a debug message and returns `ok(undefined)` without attempting to publish. This enables graceful degradation when a topic environment variable is not set.

### PublishError (`types.ts`)

```typescript
interface PublishError {
  code: 'PUBLISH_FAILED' | 'TOPIC_NOT_FOUND' | 'PERMISSION_DENIED';
  message: string;
}
```

### WhatsApp Send Publisher (`whatsappSendPublisher.ts`)

Publishes messages for `whatsapp-service` to send via the WhatsApp Business API.

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

function createWhatsAppSendPublisher(config: WhatsAppSendPublisherConfig): WhatsAppSendPublisher;
```

**Event type:** `whatsapp.message.send`

The publisher constructs a `SendMessageEvent` with auto-generated `correlationId` and `timestamp`. Phone number lookup happens in `whatsapp-service` using the `userId`.

**Constraint:** `buttons` and `ctaUrl` are mutually exclusive — the WhatsApp API does not support both in the same message. The publisher does not enforce this constraint; it is the caller's responsibility.

```typescript
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
```

### Todos Processing Publisher (`todosProcessingPublisher.ts`)

Publishes events for `todos-agent` to process newly created todos.

```typescript
interface TodosProcessingPublisher {
  publishTodoCreated(params: {
    todoId: string;
    userId: string;
    title: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

function createTodosProcessingPublisher(
  config: TodosProcessingPublisherConfig
): TodosProcessingPublisher;
```

**Event type:** `todos.processing.created`

```typescript
interface TodoProcessingEvent {
  type: 'todos.processing.created';
  todoId: string;
  userId: string;
  title: string;
  correlationId: string;
  timestamp: string;
}

interface TodosProcessingPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}
```

### Calendar Preview Publisher (`calendarPreviewPublisher.ts`)

Publishes events for `calendar-agent` to generate calendar event previews from natural language.

```typescript
interface CalendarPreviewPublisher {
  publishGeneratePreview(params: {
    actionId: string;
    userId: string;
    text: string;
    currentDate: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

function createCalendarPreviewPublisher(
  config: CalendarPreviewPublisherConfig
): CalendarPreviewPublisher;
```

**Event type:** `calendar.preview.generate`

```typescript
interface CalendarPreviewGenerateEvent {
  type: 'calendar.preview.generate';
  actionId: string;
  userId: string;
  text: string;
  currentDate: string;
  correlationId: string;
  timestamp: string;
}

interface CalendarPreviewPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}
```

## Usage

```typescript
import { createWhatsAppSendPublisher } from '@intexuraos/infra-pubsub';

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

**Apps (7):** `actions-agent`, `bookmarks-agent`, `code-agent`, `commands-agent`, `research-agent`, `todos-agent`, `whatsapp-service`

**Workers (1):** `workers/transcription`

## Recent Changes

| Commit     | Description                                                   |
| ---------- | ------------------------------------------------------------- |
| `55b959e6` | Add deep link `ctaUrl` to WhatsApp send event (code-agent)    |
| `a41ca812` | Replace PR URL text with WhatsApp CTA URL buttons             |
| `d0d38f53` | Address code review feedback for INT-738                      |
| `44017d5c` | Fix ESLint OOM with batched parallel lint runner              |
| `dfd702f1` | Add Sentry-enabled logger factory and migrate all apps        |
| `a9847b66` | Add WhatsApp approval buttons with nonces                     |
| `60bb9396` | Add Pub/Sub infrastructure for calendar preview               |

## Source Files

| File                              | Purpose                                      |
| --------------------------------- | -------------------------------------------- |
| `src/index.ts`                    | Entry point, re-exports                      |
| `src/types.ts`                    | Event types, config interfaces, PublishError |
| `src/basePublisher.ts`            | Abstract base publisher class                |
| `src/whatsappSendPublisher.ts`    | WhatsApp message publishing                  |
| `src/todosProcessingPublisher.ts` | Todo processing event publishing             |
| `src/calendarPreviewPublisher.ts` | Calendar preview generation publishing       |
