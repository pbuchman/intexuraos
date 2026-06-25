# @intexuraos/whatsapp-pubsub-client

Publisher-side leaf client for the `whatsapp.message.send` Pub/Sub topic. Lets any service enqueue an outbound WhatsApp message for `whatsapp-service` to deliver, without taking a workspace dependency on `whatsapp-service` itself.

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

- `createWhatsAppSendPublisher(config)` — factory returning a `WhatsAppSendPublisher` bound to a Pub/Sub topic.
- `WhatsAppSendPublisher` — publisher interface (`publishSendMessage`).
- `WhatsAppSendPublisherConfig` — `{ projectId, topicName, logger }`.
- `SendMessageEvent` — payload shape consumed by `whatsapp-service`.
- `WhatsAppInteractiveButton` — interactive reply-button shape used in `SendMessageEvent.buttons`.

## Usage

```ts
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
  logger.error({ error: result.error }, 'Failed to enqueue WhatsApp send');
}
```

## Used By

- `apps/code-agent`
- `apps/bookmarks-agent`
- `apps/research-agent`
- `apps/mobile-notifications-service`

## Source Files

| File                              | Purpose                                  |
| --------------------------------- | ---------------------------------------- |
| `src/index.ts`                    | Public barrel                            |
| `src/whatsappSendPublisher.ts`    | `createWhatsAppSendPublisher` factory    |
| `src/types.ts`                    | `SendMessageEvent`, button shapes        |
