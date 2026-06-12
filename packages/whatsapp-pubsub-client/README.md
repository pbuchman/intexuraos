# @intexuraos/whatsapp-pubsub-client

Publisher-side leaf client for the WhatsApp send Pub/Sub topic.

This package exists so that services which only need to **enqueue** WhatsApp
messages (e.g. `code-agent`, `actions-agent`, `bookmarks-agent`,
`research-agent`, `mobile-notifications-service`) can do so without depending
on the WhatsApp consumer service (`whatsapp-service`) and without polluting
the generic `@intexuraos/infra-pubsub` package with domain-specific
publishers.

## Exports

- `createWhatsAppSendPublisher(config)` — factory returning a
  `WhatsAppSendPublisher` bound to a Pub/Sub topic.
- `WhatsAppSendPublisher` — the publisher interface.
- `WhatsAppSendPublisherConfig` — `{ projectId, topicName, logger }`.
- `SendMessageEvent` — payload shape consumed by `whatsapp-service`.
- `WhatsAppInteractiveButton` — interactive reply-button shape used in
  `SendMessageEvent.buttons`.

## Dependencies

- `@intexuraos/common-core` — `Result` helpers.
- `@intexuraos/infra-pubsub` — `BasePubSubPublisher` + `PublishError`.

## Usage

```ts
import { createWhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';

const publisher = createWhatsAppSendPublisher({
  projectId: process.env.GCP_PROJECT_ID!,
  topicName: process.env.WHATSAPP_SEND_TOPIC!,
  logger,
});

const result = await publisher.publishSendMessage({
  userId: 'user-123',
  message: 'Hello!',
});
```
