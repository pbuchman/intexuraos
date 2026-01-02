# Pub/Sub Architecture

> **Auto-generated documentation** - Do not edit manually.
> Last updated: 2026-01-02

This document describes the Pub/Sub architecture in IntexuraOS, including all topics, publishers, subscribers, and logging patterns.

## Overview

IntexuraOS uses Google Cloud Pub/Sub for asynchronous event-driven communication between services. All subscriptions use **HTTP push delivery** to Cloud Run endpoints (never pull subscriptions, as Cloud Run scales to zero).

Key features:

- All topics have **dead-letter queues (DLQ)** for failed message handling
- Push subscriptions use **OIDC authentication** validated by Cloud Run
- Publishers extend `BasePubSubPublisher` for consistent logging
- Subscribers use `logIncomingRequest()` for standardized request logging

---

## Flow Summary

| #   | Topic                                       | Publisher                       | Subscriber Endpoint                               | Event Type                  |
| --- | ------------------------------------------- | ------------------------------- | ------------------------------------------------- | --------------------------- |
| 1   | `intexuraos-whatsapp-media-cleanup-{env}`   | whatsapp-service                | `POST /internal/whatsapp/pubsub/media-cleanup`    | `whatsapp.media.cleanup`    |
| 2   | `intexuraos-whatsapp-webhook-process-{env}` | whatsapp-service                | `POST /internal/whatsapp/pubsub/process-webhook`  | `whatsapp.webhook.process`  |
| 3   | `intexuraos-whatsapp-transcription-{env}`   | whatsapp-service                | `POST /internal/whatsapp/pubsub/transcribe-audio` | `whatsapp.audio.transcribe` |
| 4   | `intexuraos-commands-ingest-{env}`          | whatsapp-service                | `POST /internal/router/commands`                  | `command.ingest`            |
| 5   | `intexuraos-actions-research-{env}`         | commands-router                 | `POST /internal/actions/process`                  | `action.created`            |
| 6   | `intexuraos-research-process-{env}`         | llm-orchestrator                | `POST /internal/llm/pubsub/process-research`      | `research.process`          |
| 7   | `intexuraos-llm-analytics-{env}`            | llm-orchestrator                | `POST /internal/llm/pubsub/report-analytics`      | `llm.report`                |
| 8   | `intexuraos-llm-call-{env}`                 | llm-orchestrator                | `POST /internal/llm/pubsub/process-llm-call`      | `llm.call`                  |
| 9   | `intexuraos-whatsapp-send-{env}`            | actions-agent, llm-orchestrator | `POST /internal/whatsapp/pubsub/send-message`     | `whatsapp.message.send`     |

---

## Topics Detail

### 1. WhatsApp Media Cleanup

| Aspect           | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| **Topic**        | `intexuraos-whatsapp-media-cleanup-{env}`                   |
| **Env Variable** | `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`                     |
| **Publisher**    | `apps/whatsapp-service/src/infra/pubsub/publisher.ts:42-49` |
| **Subscriber**   | `POST /internal/whatsapp/pubsub/media-cleanup`              |
| **Handler**      | `apps/whatsapp-service/src/routes/pubsubRoutes.ts:233-404`  |
| **Purpose**      | Delete GCS media files after WhatsApp message processing    |
| **Ack Deadline** | 60s                                                         |
| **DLQ**          | Yes (`-dlq` suffix)                                         |

**Event Structure:**

```typescript
interface MediaCleanupEvent {
  type: 'whatsapp.media.cleanup';
  messageId: string;
  userId: string;
  gcsPaths: string[];
}
```

**Publishing Logging (via BasePubSubPublisher):**
| Phase | Level | Context Fields |
|---------|---------|---------------------------|
| Before | `info` | `topic`, `messageId` |
| Success | `info` | `topic`, `messageId` |
| Error | `error` | `topic`, `messageId`, `error` |

**Receiving Logging:**
| Phase | Level | Context Fields |
|------------|---------|-------------------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | `pubsubMessageId`, `messageId`, `userId`, `pathCount` |
| Per-file | `info` | `gcsPath` |
| Success | `info` | `pubsubMessageId`, `messageId`, `deletedCount`, `totalCount` |
| Error | `error` | `pubsubMessageId`, `messageId`, `error` |

---

### 2. WhatsApp Webhook Process

| Aspect           | Value                                                         |
| ---------------- | ------------------------------------------------------------- |
| **Topic**        | `intexuraos-whatsapp-webhook-process-{env}`                   |
| **Env Variable** | `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`                     |
| **Publisher**    | `apps/whatsapp-service/src/infra/pubsub/publisher.ts:62-70`   |
| **Subscriber**   | `POST /internal/whatsapp/pubsub/process-webhook`              |
| **Handler**      | `apps/whatsapp-service/src/routes/pubsubRoutes.ts:537-650`    |
| **Purpose**      | Async processing of WhatsApp webhook events (fast operations) |
| **Ack Deadline** | 120s                                                          |
| **DLQ**          | Yes                                                           |

**Event Structure:**

```typescript
interface WebhookProcessEvent {
  type: 'whatsapp.webhook.process';
  eventId: string;
  phoneNumberId: string;
  payload: string; // JSON stringified webhook payload
}
```

**Receiving Logging:**
| Phase | Level | Context Fields |
|------------|---------|---------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | `pubsubMessageId`, `eventId`, `phoneNumberId` |
| Success | `info` | `eventId` |
| Error | `error` | `eventId`, `error` |

---

### 3. WhatsApp Audio Transcription

| Aspect           | Value                                                            |
| ---------------- | ---------------------------------------------------------------- |
| **Topic**        | `intexuraos-whatsapp-transcription-{env}`                        |
| **Env Variable** | `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`                          |
| **Publisher**    | `apps/whatsapp-service/src/infra/pubsub/publisher.ts:72-80`      |
| **Subscriber**   | `POST /internal/whatsapp/pubsub/transcribe-audio`                |
| **Handler**      | `apps/whatsapp-service/src/routes/pubsubRoutes.ts:406-535`       |
| **Purpose**      | Audio transcription via Speechmatics (long-running, up to 5 min) |
| **Ack Deadline** | 600s (max allowed by GCP)                                        |
| **DLQ**          | Yes                                                              |

**Event Structure:**

```typescript
interface TranscribeAudioEvent {
  type: 'whatsapp.audio.transcribe';
  messageId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
  userPhoneNumber: string;
  originalWaMessageId: string;
  phoneNumberId: string;
}
```

**Receiving Logging:**
| Phase | Level | Context Fields |
|------------|---------|---------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | `pubsubMessageId`, `messageId`, `userId` |
| Success | `info` | `messageId`, `userId` |
| Error | `error` | `messageId`, `error` |

---

### 4. Commands Ingest

| Aspect           | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| **Topic**        | `intexuraos-commands-ingest-{env}`                                 |
| **Env Variable** | `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`                          |
| **Publisher**    | `apps/whatsapp-service/src/infra/pubsub/publisher.ts:52-59`        |
| **Subscriber**   | `POST /internal/router/commands`                                   |
| **Handler**      | `apps/commands-router/src/routes/internalRoutes.ts:25-184`         |
| **Purpose**      | Route commands from WhatsApp to commands-router for classification |
| **Ack Deadline** | 60s (default)                                                      |
| **DLQ**          | Yes                                                                |

**Event Structure:**

```typescript
interface CommandIngestEvent {
  type: 'command.ingest';
  userId: string;
  sourceType: 'whatsapp' | 'mobile' | 'api';
  externalId: string;
  text: string;
  timestamp: string;
}
```

**Receiving Logging:**
| Phase | Level | Context Fields |
|------------|---------|---------------------------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | `userId`, `externalId`, `sourceType`, `messageId`, `textPreview` |
| Success | `info` | `commandId`, `isNew`, `userId`, `externalId`, `status` |

---

### 5. Actions Research

| Aspect           | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| **Topic**        | `intexuraos-actions-research-{env}`                                   |
| **Env Variable** | `INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC`                            |
| **Publisher**    | `apps/commands-router/src/infra/pubsub/actionEventPublisher.ts:16-25` |
| **Subscriber**   | `POST /internal/actions/process`                                      |
| **Handler**      | `apps/actions-agent/src/routes/internalRoutes.ts:413-569`             |
| **Purpose**      | Process research action events from classified commands               |
| **Ack Deadline** | 60s (default)                                                         |
| **DLQ**          | Yes                                                                   |

**Event Structure:**

```typescript
interface ActionCreatedEvent {
  type: 'action.created';
  actionId: string;
  userId: string;
  commandId: string;
  actionType: 'research' | 'todo' | 'note' | 'link' | 'calendar' | 'reminder';
  title: string;
  payload: {
    prompt: string;
    confidence: number;
  };
  timestamp: string;
}
```

**Publishing Logging (via BasePubSubPublisher):**
| Phase | Level | Context Fields |
|---------|---------|---------------------------- |
| Before | `info` | `topic`, `actionId`, `actionType` |
| Success | `info` | `topic`, `actionId`, `actionType` |
| Error | `error` | `topic`, `actionId`, `actionType`, `error` |

**Receiving Logging:**
| Phase | Level | Context Fields |
|------------|---------|---------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| No handler | `info` | `actionType`, `actionId`, `messageId` |
| Success | `info` | `actionId`, `actionType` |
| Error | `error` | `err`, `actionType`, `actionId` |

---

### 6. Research Process

| Aspect           | Value                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| **Topic**        | `intexuraos-research-process-{env}`                                      |
| **Env Variable** | `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC`                               |
| **Publisher**    | `apps/llm-orchestrator/src/infra/pubsub/researchEventPublisher.ts:31-38` |
| **Subscriber**   | `POST /internal/llm/pubsub/process-research`                             |
| **Handler**      | `apps/llm-orchestrator/src/routes/internalRoutes.ts:158-326`             |
| **Purpose**      | Async research processing with multiple LLMs                             |
| **Ack Deadline** | 600s (max allowed by GCP)                                                |
| **DLQ**          | Yes                                                                      |

**Event Structure:**

```typescript
interface ResearchProcessEvent {
  type: 'research.process';
  researchId: string;
  userId: string;
  triggeredBy: 'create' | 'approve';
}
```

**Publishing Logging (via BasePubSubPublisher):**
| Phase | Level | Context Fields |
|---------|---------|------------------------------------|
| Before | `info` | `topic`, `researchId`, `triggeredBy` |
| Success | `info` | `topic`, `researchId`, `triggeredBy` |
| Error | `error` | `topic`, `researchId`, `triggeredBy`, `error` |

**Receiving Logging:**
| Phase | Level | Context Fields |
|------------|---------|-------------------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | `researchId`, `userId`, `triggeredBy`, `messageId` |
| Search mode| `info` | `researchId`, `searchMode` |
| Success | `info` | `researchId` |
| Error | `error` | `researchId`, `error` |

---

### 7. LLM Analytics

| Aspect           | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| **Topic**        | `intexuraos-llm-analytics-{env}`                                          |
| **Env Variable** | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`                                   |
| **Publisher**    | `apps/llm-orchestrator/src/infra/pubsub/analyticsEventPublisher.ts:35-42` |
| **Subscriber**   | `POST /internal/llm/pubsub/report-analytics`                              |
| **Handler**      | `apps/llm-orchestrator/src/routes/internalRoutes.ts:328-437`              |
| **Purpose**      | Report LLM usage analytics to user-service                                |
| **Ack Deadline** | 300s                                                                      |
| **DLQ**          | Yes                                                                       |

**Event Structure:**

```typescript
interface LlmAnalyticsEvent {
  type: 'llm.report';
  researchId: string;
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}
```

**Publishing Logging (via BasePubSubPublisher):**
| Phase | Level | Context Fields |
|---------|---------|---------------------------|
| Before | `info` | `topic`, `provider`, `model` |
| Success | `info` | `topic`, `provider`, `model` |
| Error | `error` | `topic`, `provider`, `model`, `error` |

**Receiving Logging:**
| Phase | Level | Context Fields |
|------------|---------|---------------------------- |
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Success | `info` | `provider`, `userId` |
| Error | `warn` | `provider`, `error` |

---

### 8. LLM Call

| Aspect           | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| **Topic**        | `intexuraos-llm-call-{env}`                                        |
| **Env Variable** | `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`                                 |
| **Publisher**    | `apps/llm-orchestrator/src/infra/pubsub/llmCallPublisher.ts:30-37` |
| **Subscriber**   | `POST /internal/llm/pubsub/process-llm-call`                       |
| **Handler**      | `apps/llm-orchestrator/src/routes/internalRoutes.ts:439-778`       |
| **Purpose**      | Execute individual LLM calls in separate Cloud Run instances       |
| **Ack Deadline** | 600s (max allowed by GCP)                                          |
| **DLQ**          | Yes                                                                |

**Event Structure:**

```typescript
interface LlmCallEvent {
  type: 'llm.call';
  researchId: string;
  userId: string;
  provider: 'anthropic' | 'openai' | 'google' | 'perplexity';
  prompt: string;
}
```

**Publishing Logging (via BasePubSubPublisher):**
| Phase | Level | Context Fields |
|---------|---------|-------------------------------- |
| Before | `info` | `topic`, `researchId`, `provider` |
| Success | `info` | `topic`, `researchId`, `provider` |
| Error | `error` | `topic`, `researchId`, `provider`, `error` |

**Receiving Logging:**
| Phase | Level | Context Fields |
|-----------------|---------|---------------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | `researchId`, `userId`, `provider`, `messageId` |
| Idempotency skip| `info` | `researchId`, `provider`, `status` |
| Start call | `info` | `researchId`, `provider`, `searchMode` |
| Call success | `info` | `researchId`, `provider`, `durationMs`, `contentLength` |
| Call failure | `error` | `researchId`, `provider`, `error`, `durationMs` |
| Synthesis | `info` | `researchId` |
| All failed | `warn` | `researchId` |
| Partial failure | `warn` | `researchId`, `failedProviders` |

---

### 9. WhatsApp Send Message

| Aspect           | Value                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| **Topic**        | `intexuraos-whatsapp-send-{env}`                                                                             |
| **Env Variable** | `INTEXURAOS_WHATSAPP_SEND_TOPIC` (actions-agent), `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` (llm-orchestrator) |
| **Publisher**    | `packages/infra-pubsub/src/whatsappSendPublisher.ts:35-104`                                                  |
| **Subscriber**   | `POST /internal/whatsapp/pubsub/send-message`                                                                |
| **Handler**      | `apps/whatsapp-service/src/routes/pubsubRoutes.ts:41-231`                                                    |
| **Purpose**      | Send WhatsApp messages to users (phone lookup done by subscriber)                                            |
| **Ack Deadline** | 60s (default)                                                                                                |
| **DLQ**          | Yes                                                                                                          |

**Event Structure:**

```typescript
interface SendMessageEvent {
  type: 'whatsapp.message.send';
  userId: string;
  message: string;
  replyToMessageId?: string;
  correlationId: string;
  timestamp: string;
}
```

**Publishing Logging (standalone, not BasePubSubPublisher):**
| Phase | Level | Context Fields |
|---------|---------|---------------------------------------|
| Before | `info` | `topic`, `correlationId`, `userId` |
| Success | `info` | `topic`, `correlationId` |
| Error | `error` | `topic`, `correlationId`, `error` |

**Receiving Logging:**
| Phase | Level | Context Fields |
|--------------|---------|-----------------------------------------------|
| Request | `info` | headers (redacted), body preview |
| Auth | `info` | `from` header |
| Processing | `info` | `messageId`, `userId`, `correlationId` |
| Phone lookup | `info` | `messageId`, `userId`, `phoneNumber` (masked) |
| Not connected| `warn` | `messageId`, `userId`, `correlationId` |
| Success | `info` | `messageId`, `userId`, `correlationId` |
| Error | `error` | `messageId`, `userId`, `correlationId`, `error` |

---

## Reusable Components

### BasePubSubPublisher

**Location:** `packages/infra-pubsub/src/basePublisher.ts`

**Purpose:** Abstract base class providing consistent logging and error handling for all Pub/Sub publishers.

**Logging Pattern:**
| Phase | Level | Fields | Lines |
|----------------|---------|-------------------------------------|---------|
| Topic disabled | `debug` | `context`, `event` | 63-67 |
| Before publish | `info` | `topic`, `...context` | 74-77 |
| After success | `info` | `topic`, `...context` | 81-84 |
| On error | `error` | `topic`, `...context`, `error` | 90-93 |

**Error Mapping:**
| Error Contains | Code | Meaning |
|-------------------|---------------------|----------------------------|
| `NOT_FOUND` | `TOPIC_NOT_FOUND` | Topic doesn't exist |
| `PERMISSION_DENIED` | `PERMISSION_DENIED` | Missing IAM permissions |
| (default) | `PUBLISH_FAILED` | Generic publish failure |

**Implementations:**
| Publisher | Service | Logger Name |
|------------------------------|------------------|-------------------------------|
| GcpPubSubPublisher | whatsapp-service | `whatsapp-pubsub-publisher` |
| ActionEventPublisher | actions-agent | `action-event-publisher` |
| ActionEventPublisher | commands-router | `action-event-publisher` |
| ResearchEventPublisherImpl | llm-orchestrator | `research-event-publisher` |
| AnalyticsEventPublisherImpl | llm-orchestrator | `analytics-event-publisher` |
| LlmCallPublisherImpl | llm-orchestrator | `llm-call-publisher` |

### logIncomingRequest()

**Location:** `packages/common-http/src/http/logger.ts:126-162`

**Purpose:** Standard logging for incoming HTTP requests with automatic header redaction.

**Features:**

- Redacts sensitive headers using `SENSITIVE_FIELDS` from `@intexuraos/common-core`
- Truncates body preview to configurable length (default: 500 chars)
- Best-effort error handling (won't crash request if logging fails)

**Usage:** All Pub/Sub subscriber endpoints call this BEFORE authentication:

```typescript
logIncomingRequest(request, {
  message: 'Received PubSub push to /internal/...',
  bodyPreviewLength: 500,
});
```

---

## Logging Coverage Summary

### Publishers

| Publisher                   | Logging | Base Class | File                                                                |
| --------------------------- | ------- | ---------- | ------------------------------------------------------------------- |
| GcpPubSubPublisher          | Yes     | Yes        | `apps/whatsapp-service/src/infra/pubsub/publisher.ts`               |
| ActionEventPublisher (AA)   | Yes     | Yes        | `apps/actions-agent/src/infra/pubsub/actionEventPublisher.ts`       |
| ActionEventPublisher (CR)   | Yes     | Yes        | `apps/commands-router/src/infra/pubsub/actionEventPublisher.ts`     |
| ResearchEventPublisherImpl  | Yes     | Yes        | `apps/llm-orchestrator/src/infra/pubsub/researchEventPublisher.ts`  |
| AnalyticsEventPublisherImpl | Yes     | Yes        | `apps/llm-orchestrator/src/infra/pubsub/analyticsEventPublisher.ts` |
| LlmCallPublisherImpl        | Yes     | Yes        | `apps/llm-orchestrator/src/infra/pubsub/llmCallPublisher.ts`        |
| WhatsAppSendPublisher       | Yes     | No         | `packages/infra-pubsub/src/whatsappSendPublisher.ts`                |

### Subscribers

| Endpoint                                     | Service          | logIncomingRequest | Success Logging |
| -------------------------------------------- | ---------------- | ------------------ | --------------- |
| `/internal/whatsapp/pubsub/media-cleanup`    | whatsapp-service | Yes                | Yes             |
| `/internal/whatsapp/pubsub/process-webhook`  | whatsapp-service | Yes                | Yes             |
| `/internal/whatsapp/pubsub/transcribe-audio` | whatsapp-service | Yes                | Yes             |
| `/internal/whatsapp/pubsub/send-message`     | whatsapp-service | Yes                | Yes             |
| `/internal/router/commands`                  | commands-router  | Yes                | Yes             |
| `/internal/actions/process`                  | actions-agent    | Yes                | Yes             |
| `/internal/actions/:actionType`              | actions-agent    | Yes                | Yes             |
| `/internal/llm/pubsub/process-research`      | llm-orchestrator | Yes                | Yes             |
| `/internal/llm/pubsub/report-analytics`      | llm-orchestrator | Yes                | Yes             |
| `/internal/llm/pubsub/process-llm-call`      | llm-orchestrator | Yes                | Yes             |

---

## Sensitive Data Protection

| Data Type     | Protection             | Implementation                               |
| ------------- | ---------------------- | -------------------------------------------- |
| Phone numbers | Masked (`****` suffix) | `maskPhoneNumber()` in pubsubRoutes.ts:29-33 |
| Headers       | Auto-redacted          | `SENSITIVE_FIELDS` in common-core            |
| Body          | Truncated preview      | `logIncomingRequest()` bodyPreviewLength     |
| API keys      | Never logged           | Fetched per-request, not in events           |

---

## Terraform Configuration

### Module: pubsub-push

**Location:** `terraform/modules/pubsub-push/`

All topics use the `pubsub-push` module which creates:

- Main topic
- Dead-letter topic (`-dlq` suffix)
- Push subscription with OIDC authentication
- DLQ subscription (for manual inspection)
- Publisher IAM bindings
- DLQ publisher IAM for Pub/Sub service account

**Default Configuration:**
| Setting | Value |
|----------------------------|---------------|
| Ack deadline | 60s (configurable) |
| Message retention | 7 days |
| Retry min backoff | 10s |
| Retry max backoff | 600s (10 min) |
| Max delivery attempts | 5 |
| DLQ ack deadline | 600s |
| DLQ message retention | 7 days |

---

## Event Flow Diagrams

### Command Processing Flow

```
WhatsApp Webhook
    |
    v
[whatsapp-service] --publish--> [commands-ingest topic]
                                      |
                                      v (push)
                              [commands-router] --publish--> [actions-research topic]
                                                                    |
                                                                    v (push)
                                                            [actions-agent] --HTTP--> [llm-orchestrator]
                                                                    |
                                                                    v
                                                            [Create draft research]
```

### Research Processing Flow

```
[llm-orchestrator API]
    |
    v
Create Research --publish--> [research-process topic]
                                    |
                                    v (push)
                            [llm-orchestrator: process-research]
                                    |
                                    v
                            --publish--> [llm-call topic] (per provider)
                                              |
                                              v (push, parallel)
                                    [llm-orchestrator: process-llm-call]
                                              |
                                              v
                                    Execute LLM call, update results
                                              |
                                              v (when all complete)
                                    Run synthesis, notify user
```

### WhatsApp Message Sending Flow

```
[actions-agent] or [llm-orchestrator]
    |
    v
--publish--> [whatsapp-send topic]
                    |
                    v (push)
            [whatsapp-service: send-message]
                    |
                    v
            Lookup phone by userId
                    |
                    v
            Send via WhatsApp Cloud API
```
