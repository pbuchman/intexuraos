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

interface TodosProcessingPublisher {
  publishTodoCreated(params: {
    todoId: string;
    userId: string;
    title: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

interface CalendarPreviewPublisher {
  publishGeneratePreview(params: {
    actionId: string;
    userId: string;
    text: string;
    currentDate: string;
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
function createTodosProcessingPublisher(
  config: TodosProcessingPublisherConfig
): TodosProcessingPublisher;
function createCalendarPreviewPublisher(
  config: CalendarPreviewPublisherConfig
): CalendarPreviewPublisher;
```

## Event Type Registry

| Event Type                  | Publisher                | Consumer         |
| --------------------------- | ------------------------ | ---------------- |
| `whatsapp.message.send`     | WhatsAppSendPublisher    | whatsapp-service |
| `todos.processing.created`  | TodosProcessingPublisher | todos-agent      |
| `calendar.preview.generate` | CalendarPreviewPublisher | calendar-agent   |

## Environment Variables (per consumer)

```
INTEXURAOS_GCP_PROJECT_ID         - GCP project ID
INTEXURAOS_WHATSAPP_SEND_TOPIC    - Topic for WhatsApp send events
INTEXURAOS_TODOS_PROCESSING_TOPIC - Topic for todo processing events
INTEXURAOS_CALENDAR_PREVIEW_TOPIC - Topic for calendar preview events
```

## Dependency Graph

```
common-core -> infra-pubsub -> actions-agent
                             -> bookmarks-agent
                             -> code-agent
                             -> commands-agent
                             -> research-agent
                             -> todos-agent
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
