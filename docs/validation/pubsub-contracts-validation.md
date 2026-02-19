# Pub/Sub Contracts Cross-Validation Report

**Date:** 2026-02-19
**Branch:** development
**Scope:** All Pub/Sub topics, publishers, subscribers, IAM permissions, dead-letter queues, retry policies, and message schemas across IntexuraOS

---

## Executive Summary

| Category                        | Count |
| ------------------------------- | ----- |
| Total Terraform topics          | 16    |
| Topics using `pubsub-push` module (DLQ included) | 14 |
| Raw topics (no DLQ)             | 2     |
| Topics with active publishers   | 14    |
| Topics with active subscribers  | 16    |
| CRITICAL discrepancies          | 0     |
| HIGH discrepancies              | 1     |
| MEDIUM discrepancies            | 4     |
| LOW discrepancies               | 3     |

**Overall health:** IAM permission matrix is correct and all push subscription endpoints match active route handlers. One dead publisher class exists in the codebase. Documentation topic names are systematically outdated. All topics that use the `pubsub-push` module automatically receive dead-letter queue configuration. Two special-purpose topics (`log_cleanup`, `snapshot_refresh`) are raw resources without DLQ.

---

## Complete Topic Inventory

All topics using the `pubsub-push` Terraform module include: HTTP push subscription, OIDC authentication, dead-letter queue (DLQ) topic + pull subscription, and retry policy. Defaults: `max_delivery_attempts=5`, `retry_minimum_backoff=10s`, `retry_maximum_backoff=600s`, `message_retention_duration=604800s` (7 days).

| # | Terraform Resource                  | Topic Name                                      | Push Endpoint                                   | Ack Deadline | DLQ? | Subscriber SA       |
| - | ----------------------------------- | ----------------------------------------------- | ----------------------------------------------- | ------------ | ---- | ------------------- |
| 1 | `pubsub_actions_queue`              | `intexuraos-actions-queue-{env}`                | `/internal/actions/process`                     | 60s          | YES  | actions_agent       |
| 2 | `pubsub_approval_reply`             | `intexuraos-approval-reply-{env}`               | `/internal/actions/approval-reply`              | 60s          | YES  | actions_agent       |
| 3 | `pubsub_bookmark_enrich`            | `intexuraos-bookmark-enrich-{env}`              | `/internal/bookmarks/pubsub/enrich`             | 60s          | YES  | bookmarks_agent     |
| 4 | `pubsub_bookmark_summarize`         | `intexuraos-bookmark-summarize-{env}`           | `/internal/bookmarks/pubsub/summarize`          | 120s ¹       | YES  | bookmarks_agent     |
| 5 | `pubsub_calendar_preview`           | `intexuraos-calendar-preview-{env}`             | `/internal/calendar/generate-preview`           | 120s         | YES  | calendar_agent      |
| 6 | `pubsub_commands_ingest`            | `intexuraos-commands-ingest-{env}`              | `/internal/commands`                            | 60s          | YES  | commands_agent      |
| 7 | `pubsub_llm_analytics`              | `intexuraos-llm-analytics-{env}`                | `/internal/llm/pubsub/report-analytics`         | 300s         | YES  | research_agent      |
| 8 | `pubsub_llm_call`                   | `intexuraos-llm-call-{env}`                     | `/internal/llm/pubsub/process-llm-call`         | 600s ²       | YES  | research_agent      |
| 9 | `pubsub_media_cleanup`              | `intexuraos-whatsapp-media-cleanup-{env}`       | `/internal/whatsapp/pubsub/media-cleanup`       | 60s          | YES  | whatsapp_service    |
| 10| `pubsub_research_process`           | `intexuraos-research-process-{env}`             | `/internal/llm/pubsub/process-research`         | 600s ²       | YES  | research_agent      |
| 11| `pubsub_todos_processing`           | `intexuraos-todos-processing-{env}`             | `/internal/todos/pubsub/todos-processing`       | 60s          | YES  | todos_agent         |
| 12| `pubsub_whatsapp_send`              | `intexuraos-whatsapp-send-{env}`                | `/internal/whatsapp/pubsub/send-message`        | 60s          | YES  | whatsapp_service    |
| 13| `pubsub_whatsapp_transcription`     | `intexuraos-whatsapp-transcription-{env}`       | `/internal/whatsapp/pubsub/transcribe-audio`    | 600s ²       | YES  | whatsapp_service    |
| 14| `pubsub_whatsapp_webhook_process`   | `intexuraos-whatsapp-webhook-process-{env}`     | `/internal/whatsapp/pubsub/process-webhook`     | 120s         | YES  | whatsapp_service    |
| 15| `snapshot_refresh_pubsub`           | `snapshot-refresh-{env}`                        | `/internal/snapshots/refresh`                   | 600s ²       | YES  | data_insights_agent |
| 16| `google_pubsub_topic.log_cleanup`   | `intexuraos-log-cleanup-{env}`                  | Cloud Function trigger (Pub/Sub event trigger)  | N/A ³        | NO   | cloud_functions SA  |

¹ Custom retry: `retry_minimum_backoff=30s`, `retry_maximum_backoff=600s`, `max_delivery_attempts=50` (6-hour resilience window for Crawl4AI transient errors)
² 600s = GCP maximum ack deadline (used for long-running AI tasks)
³ `log_cleanup` uses Cloud Functions Pub/Sub event trigger — no subscription managed separately; Cloud Functions runtime handles delivery

---

## Dead-Letter Queue Configuration

### Module-Managed Topics (automatic DLQ)

The `pubsub-push` module always creates a DLQ topology:

```
{topic-name}           ← main topic (receives publisher messages)
{topic-name}-push      ← push subscription → Cloud Run endpoint
{topic-name}-dlq       ← dead-letter topic (receives failed messages after max_delivery_attempts)
{topic-name}-dlq-sub   ← pull subscription for manual inspection
```

The GCP Pub/Sub service account (`service-{project_number}@gcp-sa-pubsub.iam.gserviceaccount.com`) is always granted `roles/pubsub.publisher` on the DLQ topic to enable forwarding. All 14 module-managed topics follow this pattern.

| Topic                                | DLQ Topic Name                                         | Max Attempts | DLQ Retention |
| ------------------------------------ | ------------------------------------------------------ | ------------ | ------------- |
| `intexuraos-actions-queue-{env}`     | `intexuraos-actions-queue-{env}-dlq`                   | 5 (default)  | 7 days        |
| `intexuraos-approval-reply-{env}`    | `intexuraos-approval-reply-{env}-dlq`                  | 5 (default)  | 7 days        |
| `intexuraos-bookmark-enrich-{env}`   | `intexuraos-bookmark-enrich-{env}-dlq`                 | 5 (default)  | 7 days        |
| `intexuraos-bookmark-summarize-{env}`| `intexuraos-bookmark-summarize-{env}-dlq`              | **50** ¹     | 7 days        |
| `intexuraos-calendar-preview-{env}`  | `intexuraos-calendar-preview-{env}-dlq`                | 5 (default)  | 7 days        |
| `intexuraos-commands-ingest-{env}`   | `intexuraos-commands-ingest-{env}-dlq`                 | 5 (default)  | 7 days        |
| `intexuraos-llm-analytics-{env}`     | `intexuraos-llm-analytics-{env}-dlq`                   | 5 (default)  | 7 days        |
| `intexuraos-llm-call-{env}`          | `intexuraos-llm-call-{env}-dlq`                        | 5 (default)  | 7 days        |
| `intexuraos-whatsapp-media-cleanup-{env}` | `intexuraos-whatsapp-media-cleanup-{env}-dlq`     | 5 (default)  | 7 days        |
| `intexuraos-research-process-{env}`  | `intexuraos-research-process-{env}-dlq`                | 5 (default)  | 7 days        |
| `intexuraos-todos-processing-{env}`  | `intexuraos-todos-processing-{env}-dlq`                | 5 (default)  | 7 days        |
| `intexuraos-whatsapp-send-{env}`     | `intexuraos-whatsapp-send-{env}-dlq`                   | 5 (default)  | 7 days        |
| `intexuraos-whatsapp-transcription-{env}` | `intexuraos-whatsapp-transcription-{env}-dlq`     | 5 (default)  | 7 days        |
| `intexuraos-whatsapp-webhook-process-{env}` | `intexuraos-whatsapp-webhook-process-{env}-dlq` | 5 (default)  | 7 days        |
| `snapshot-refresh-{env}`             | `snapshot-refresh-{env}-dlq`                           | 5 (default)  | 7 days        |

¹ `pubsub_bookmark_summarize` intentionally sets `max_delivery_attempts=50` to provide a ~6-hour retry window for transient Crawl4AI API errors. No other topic overrides this default.

### Raw Topics (no DLQ)

| Topic                              | Reason for No DLQ                                              | Risk |
| ---------------------------------- | -------------------------------------------------------------- | ---- |
| `intexuraos-log-cleanup-{env}`     | Cloud Functions event trigger — framework handles delivery; log cleanup is fire-and-forget, loss is acceptable | LOW |

**Note:** `snapshot-refresh-{env}` uses `pubsub-push` module and has a DLQ. The log_cleanup topic is the only gap.

---

## Retry Policies

### Module Defaults

The `pubsub-push` module sets exponential backoff on all subscriptions unless overridden:

| Parameter              | Default Value | Description                                |
| ---------------------- | ------------- | ------------------------------------------ |
| `retry_minimum_backoff`| `10s`         | Minimum wait before first retry            |
| `retry_maximum_backoff`| `600s`        | Maximum wait between retries               |
| `max_delivery_attempts`| `5`           | Before sending to DLQ                      |
| `ack_deadline_seconds` | `60`          | Module default (most topics override this) |

### Per-Topic Retry Configuration

| Topic                                  | Min Backoff | Max Backoff | Max Attempts | Notes                              |
| -------------------------------------- | ----------- | ----------- | ------------ | ---------------------------------- |
| `intexuraos-bookmark-summarize-{env}`  | **30s**     | **600s**    | **50**       | Extended for Crawl4AI resilience   |
| `intexuraos-research-process-{env}`    | 10s         | 600s        | 5            | Ack deadline: 600s (long AI tasks) |
| `intexuraos-llm-call-{env}`            | 10s         | 600s        | 5            | Ack deadline: 600s (LLM calls)     |
| `intexuraos-whatsapp-transcription-{env}` | 10s      | 600s        | 5            | Ack deadline: 600s (audio to text) |
| `snapshot-refresh-{env}`              | 10s         | 600s        | 5            | Ack deadline: 600s (batch process) |
| All others                             | 10s         | 600s        | 5            | Module defaults                    |

**Key observation:** Only `pubsub_bookmark_summarize` customizes retry behavior. All other topics use module defaults. The asymmetry between `ack_deadline_seconds` (up to 600s for long-running tasks) and `max_delivery_attempts=5` means long-running tasks that always fail will be sent to DLQ after only 5 attempts (~50 minutes at max backoff).

---

## Message Schema Consistency

Validated by reading publisher implementations (`packages/infra-pubsub/src/`, `apps/*/src/infra/pubsub/`) against subscriber route handlers (`apps/*/src/routes/`).

| Topic                                   | Event Type Field          | Publisher Schema Source                                     | Subscriber Validates `type`? |
| --------------------------------------- | ------------------------- | ----------------------------------------------------------- | ---------------------------- |
| `intexuraos-actions-queue-{env}`        | `ActionCreatedEvent`      | `apps/actions-agent/src/domain/models/actionEvent.ts`       | YES (checked against model)  |
| `intexuraos-approval-reply-{env}`       | `ApprovalReplyEvent`      | `apps/whatsapp-service/src/domain/whatsapp/index.ts`        | YES                          |
| `intexuraos-bookmark-enrich-{env}`      | `bookmarks.enrich`        | `apps/bookmarks-agent/src/infra/pubsub/enrichPublisher.ts`  | YES                          |
| `intexuraos-bookmark-summarize-{env}`   | `bookmarks.summarize`     | `apps/bookmarks-agent/src/infra/pubsub/summarizePublisher.ts` | YES                        |
| `intexuraos-calendar-preview-{env}`     | `calendar.preview.generate` | `packages/infra-pubsub/src/calendarPreviewPublisher.ts`   | YES                          |
| `intexuraos-commands-ingest-{env}`      | `CommandIngestEvent`      | `apps/whatsapp-service/src/domain/whatsapp/index.ts`        | YES                          |
| `intexuraos-llm-analytics-{env}`        | `llm.report`              | `apps/research-agent/src/infra/pubsub/analyticsEventPublisher.ts` | YES (type check in handler) |
| `intexuraos-llm-call-{env}`             | `llm.call`                | `apps/research-agent/src/infra/pubsub/llmCallPublisher.ts`  | YES                          |
| `intexuraos-whatsapp-media-cleanup-{env}` | `MediaCleanupEvent`     | `apps/whatsapp-service/src/infra/pubsub/publisher.ts`       | YES                          |
| `intexuraos-research-process-{env}`     | `research.process`        | `apps/research-agent/src/infra/pubsub/researchEventPublisher.ts` | YES                     |
| `intexuraos-todos-processing-{env}`     | `todos.processing.created` | `packages/infra-pubsub/src/todosProcessingPublisher.ts`    | YES                          |
| `intexuraos-whatsapp-send-{env}`        | `whatsapp.message.send`   | `packages/infra-pubsub/src/whatsappSendPublisher.ts`        | YES                          |
| `intexuraos-whatsapp-transcription-{env}` | `TranscribeAudioEvent`  | `apps/whatsapp-service/src/infra/pubsub/publisher.ts`       | YES                          |
| `intexuraos-whatsapp-webhook-process-{env}` | `WebhookProcessEvent` / `ExtractLinkPreviewsEvent` | `apps/whatsapp-service/src/infra/pubsub/publisher.ts` | Partial — see D-4 |
| `snapshot-refresh-{env}`               | `{ trigger: "scheduled" }` | Cloud Scheduler `pubsub_target`                            | N/A (no type field)          |
| `intexuraos-log-cleanup-{env}`          | `{ trigger: "scheduled" }` | Cloud Scheduler `pubsub_target`                            | N/A (no type field)          |

**Schema consistency status:** All schemas are consistent between publisher and subscriber where an active publisher exists. The `intexuraos-llm-analytics-{env}` topic has a schema defined but no active publisher (see D-1). The `intexuraos-whatsapp-webhook-process-{env}` multiplexes two event types without discriminated routing (see D-4).

### Shared Publisher Package

The `packages/infra-pubsub` package centralizes shared event schemas used by multiple publishers:

| Type exported                  | Used by publishers                                                      |
| ------------------------------ | ----------------------------------------------------------------------- |
| `SendMessageEvent`             | actions-agent, research-agent, bookmarks-agent, code-agent (all via `createWhatsAppSendPublisher`) |
| `TodoProcessingEvent`          | todos-agent (`createTodosProcessingPublisher`)                          |
| `CalendarPreviewGenerateEvent` | actions-agent (`createCalendarPreviewPublisher`)                        |

This centralization ensures publisher-subscriber schema contracts are enforced at the TypeScript type level for these three topics.

---

## Publisher–Subscriber Map

| Topic                                           | Publisher(s)                                                   | Subscriber          | Pattern                                         |
| ----------------------------------------------- | -------------------------------------------------------------- | ------------------- | ----------------------------------------------- |
| `intexuraos-actions-queue-{env}`                | commands-agent, actions-agent                                  | actions-agent       | Fan-out + self-loop for deferred work           |
| `intexuraos-approval-reply-{env}`               | whatsapp-service                                               | actions-agent       | User approval responses                         |
| `intexuraos-bookmark-enrich-{env}`              | bookmarks-agent                                                | bookmarks-agent     | Self-loop: async link metadata fetch            |
| `intexuraos-bookmark-summarize-{env}`           | bookmarks-agent                                                | bookmarks-agent     | Self-loop: async AI summarization               |
| `intexuraos-calendar-preview-{env}`             | actions-agent                                                  | calendar-agent      | Cross-service preview generation                |
| `intexuraos-commands-ingest-{env}`              | whatsapp-service                                               | commands-agent      | Entry point for user commands from WhatsApp     |
| `intexuraos-llm-analytics-{env}`                | *(dead code — see D-1)*                                        | research-agent      | **INACTIVE** — no active publisher              |
| `intexuraos-llm-call-{env}`                     | research-agent                                                 | research-agent      | Self-loop: individual LLM call dispatch         |
| `intexuraos-whatsapp-media-cleanup-{env}`       | whatsapp-service                                               | whatsapp-service    | Self-loop: deferred media expiry cleanup        |
| `intexuraos-research-process-{env}`             | research-agent                                                 | research-agent      | Self-loop: async research task execution        |
| `intexuraos-todos-processing-{env}`             | todos-agent                                                    | todos-agent         | Self-loop: AI todo item extraction              |
| `intexuraos-whatsapp-send-{env}`                | actions-agent, research-agent, bookmarks-agent, code-agent    | whatsapp-service    | Multi-publisher notification bus                |
| `intexuraos-whatsapp-transcription-{env}`       | whatsapp-service                                               | whatsapp-service    | Self-loop: audio-to-text transcription          |
| `intexuraos-whatsapp-webhook-process-{env}`     | whatsapp-service (two event types)                             | whatsapp-service    | Self-loop: async webhook + link-preview events  |
| `snapshot-refresh-{env}`                        | Cloud Scheduler                                                | data-insights-agent | Scheduled trigger (not a service publisher)     |
| `intexuraos-log-cleanup-{env}`                  | Cloud Scheduler                                                | Cloud Function      | Scheduled trigger for log retention enforcement |

**Note:** `ExtractLinkPreviewsEvent` from whatsapp-service is published to `this.webhookProcessTopic` — it reuses `intexuraos-whatsapp-webhook-process-{env}` rather than a dedicated link-preview topic. See D-4.

---

## IAM Permission Matrix

All IAM grants use `roles/pubsub.publisher`. Verified against Terraform `publisher_service_accounts` maps in `terraform/environments/dev/main.tf`.

| Service Account  | Topics Granted Publisher IAM                                                                                  | Active in Code? |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | --------------- |
| whatsapp_service | media_cleanup, webhook_process, transcription, commands_ingest, whatsapp_send, approval_reply                | YES ✓           |
| commands_agent   | actions_queue                                                                                                 | YES ✓           |
| actions_agent    | actions_queue, whatsapp_send, calendar_preview                                                                | YES ✓           |
| research_agent   | research_process, **llm_analytics** *(dead code)*, llm_call, whatsapp_send                                  | PARTIAL ⚠       |
| bookmarks_agent  | bookmark_enrich, bookmark_summarize, whatsapp_send                                                            | YES ✓           |
| code_agent       | whatsapp_send                                                                                                 | YES ✓           |
| todos_agent      | todos_processing                                                                                              | YES ✓           |
| cloud_scheduler  | snapshot_refresh (via `google_pubsub_topic_iam_member.scheduler_publishes_log_cleanup`)                      | YES ✓           |

**research_agent IAM note:** Has publisher IAM for `llm_analytics` but `AnalyticsEventPublisherImpl` is not wired into the ServiceContainer. IAM grant is harmless but unnecessary. See D-1.

---

## REQUIRED_ENV Validation

| Service          | Env Var                                    | REQUIRED_ENV? | Terraform env_vars?         | ecosystem.config.cjs? | Status  |
| ---------------- | ------------------------------------------ | ------------- | --------------------------- | --------------------- | ------- |
| actions-agent    | `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| actions-agent    | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| actions-agent    | `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| bookmarks-agent  | `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`        | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| bookmarks-agent  | `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`     | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| bookmarks-agent  | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| commands-agent   | `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| code-agent       | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| research-agent   | `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| research-agent   | `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| research-agent   | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`    | **NO** ⚠     | YES (hardcoded string)      | **NO** ⚠             | D-2 ⚠  |
| research-agent   | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| todos-agent      | `INTEXURAOS_TODOS_PROCESSING_TOPIC`        | YES           | YES (hardcoded string)      | YES (non-standard key)| D-5 ⚠  |
| whatsapp-service | `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`  | YES           | YES (`module.pubsub_commands_ingest.topic_name`) | YES    | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES (hardcoded string)      | YES                   | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | YES           | YES (`module.pubsub_whatsapp_webhook_process.topic_name`) | YES | OK ✓ |
| whatsapp-service | `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`    | YES           | YES (`module.pubsub_whatsapp_transcription.topic_name`) | YES | OK ✓ |
| whatsapp-service | `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`   | YES           | YES (`module.pubsub_approval_reply.topic_name`) | YES     | OK ✓    |
| data-insights    | *(none — Cloud Scheduler pushes directly)* | N/A           | N/A                         | N/A                   | OK ✓    |

---

## Terraform vs ecosystem.config.cjs Topic Name Match

All topic env vars set in Terraform `env_vars` are compared against local fallback values in `ecosystem.config.cjs` to validate that local development uses equivalent routing.

| Env Var                                    | Terraform Value                                       | ecosystem.config.cjs Default       | Match? |
| ------------------------------------------ | ----------------------------------------------------- | ---------------------------------- | ------ |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | `intexuraos-actions-queue-dev`                        | `actions-queue`                    | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | `intexuraos-whatsapp-send-dev`                        | `whatsapp-send-message`            | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | `intexuraos-research-process-dev`                     | `research-process`                 | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | `intexuraos-llm-call-dev`                             | `llm-call`                         | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | `intexuraos-calendar-preview-dev`                     | `calendar-preview`                 | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`        | `intexuraos-bookmark-enrich-dev`                      | `bookmark-enrich`                  | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`     | `intexuraos-bookmark-summarize-dev`                   | `bookmark-summarize`               | ALIAS ⚠ |
| `INTEXURAOS_TODOS_PROCESSING_TOPIC`        | `intexuraos-todos-processing-dev`                     | `todos-processing`                 | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | `intexuraos-whatsapp-media-cleanup-dev`               | `whatsapp-media-cleanup`           | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`  | `intexuraos-commands-ingest-dev` (module output)      | `commands-ingest`                  | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | `intexuraos-whatsapp-webhook-process-dev` (module output) | `whatsapp-webhook-process`     | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`    | `intexuraos-whatsapp-transcription-dev` (module output) | `whatsapp-transcription`         | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`   | `intexuraos-approval-reply-dev` (module output)       | `approval-reply`                   | ALIAS ⚠ |

**ALIAS interpretation:** All ALIAS entries indicate correct behavior — the `ecosystem.config.cjs` reads from `process.env.*` and uses the short name only as a fallback when the actual env var is not set. At runtime (both local dev with `.envrc` loaded and Cloud Run), the actual `intexuraos-*-{env}` name is always used. The short fallback names exist only for isolated component testing. See D-8 for nuance.

---

## Discrepancies

### D-1 · HIGH · Dead Analytics Publisher — Topic Receives No Messages

**Location:** `apps/research-agent/src/infra/pubsub/analyticsEventPublisher.ts`

**Description:** `AnalyticsEventPublisherImpl` is implemented and exported from `apps/research-agent/src/infra/pubsub/index.ts`, but is **not present in `ServiceContainer`** and not instantiated anywhere in `services.ts`. The Terraform infrastructure for this topic (topic, subscription, IAM, DLQ) fully exists but the topic is never published to.

**Evidence:**
- `apps/research-agent/src/services.ts`: `ServiceContainer` has `researchEventPublisher` and `llmCallPublisher` but no analytics publisher field
- `apps/research-agent/src/infra/pubsub/index.ts`: exports `AnalyticsEventPublisherImpl`, `createAnalyticsEventPublisher`, `type AnalyticsEventPublisher`
- `terraform/environments/dev/main.tf` line 719: `module "pubsub_llm_analytics"` exists with full push subscription
- `terraform/environments/dev/main.tf` line 1039: `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` set in research-agent env vars but not in REQUIRED_ENV

**Impact:** LLM usage analytics are not being reported to this topic. Terraform resource is live but idle. The route handler at `/internal/llm/pubsub/report-analytics` receives no messages.

**Action items:**
- [ ] **Option A:** Wire `AnalyticsEventPublisherImpl` into research-agent's `ServiceContainer`, add `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` to REQUIRED_ENV, and publish analytics events where appropriate
- [ ] **Option B:** If analytics is intentionally abandoned, delete: publisher class, Terraform `pubsub_llm_analytics` module and IAM, `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` env var from research-agent, and route handler `/internal/llm/pubsub/report-analytics`

---

### D-2 · MEDIUM · Missing REQUIRED_ENV and ecosystem Entry for LLM Analytics Topic

**Location:** `apps/research-agent/src/index.ts`, `ecosystem.config.cjs`

**Description:** Terraform sets `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` in research-agent's `env_vars`, but:
1. `REQUIRED_ENV` in `index.ts` does not include it — no startup validation
2. `ecosystem.config.cjs` `SERVICE_ENV_MAPPINGS['research-agent']` does not include it — no local dev override

**Impact:** If the env var were removed from Terraform, the service would start successfully with a missing var — violating the fail-fast startup principle. Low immediate risk, medium maintainability risk.

**Action item:** Resolved by D-1 — either add to REQUIRED_ENV + ecosystem (Option A) or remove the env var from Terraform (Option B).

---

### D-3 · MEDIUM · Documentation Topic Names Systematically Outdated

**Location:** `docs/services/*/technical.md` for 6 services

**Description:** All `technical.md` Published Events and Subscribed Events tables use topic name variants that differ from actual Terraform topic names. These are documentation-only errors with no runtime impact.

| Service          | Documented Topic                                   | Actual Topic                                    |
| ---------------- | -------------------------------------------------- | ----------------------------------------------- |
| actions-agent    | `intexuraos-actions-{env}` (published)             | `intexuraos-actions-queue-{env}`                |
| bookmarks-agent  | `intexuraos-bookmarks-enrich-{env}`                | `intexuraos-bookmark-enrich-{env}`              |
| bookmarks-agent  | `intexuraos-bookmarks-summarize-{env}`             | `intexuraos-bookmark-summarize-{env}`           |
| bookmarks-agent  | `intexuraos-whatsapp-message-send-{env}`           | `intexuraos-whatsapp-send-{env}`                |
| commands-agent   | `intexuraos-actions-{env}` (published)             | `intexuraos-actions-queue-{env}`                |
| commands-agent   | `intexuraos-command-ingest-{env}` (subscribed)     | `intexuraos-commands-ingest-{env}`              |
| data-insights    | `Cloud Scheduler (intexuraos-data-insights-{env})` | `snapshot-refresh-{env}` via Cloud Scheduler    |
| research-agent   | `intexuraos-llm-process-{env}` (published)         | `intexuraos-research-process-{env}`             |
| research-agent   | `intexuraos-llm-report-{env}` (published)          | `intexuraos-llm-analytics-{env}`                |
| research-agent   | `intexuraos-llm-process-queue-{env}` (subscribed)  | `intexuraos-research-process-{env}`             |
| research-agent   | `intexuraos-llm-call-queue-{env}` (subscribed)     | `intexuraos-llm-call-{env}`                     |
| whatsapp-service | `intexuraos-whatsapp-audio-transcribe-{env}`       | `intexuraos-whatsapp-transcription-{env}`       |
| whatsapp-service | `intexuraos-command-ingest-{env}`                  | `intexuraos-commands-ingest-{env}`              |
| whatsapp-service | `intexuraos-approval-replies-{env}` (plural)       | `intexuraos-approval-reply-{env}` (singular)    |

Documented push endpoint paths also differ from actual paths (docs use generic `/internal/webhooks/*`; code uses service-specific paths e.g. `/internal/bookmarks/pubsub/enrich`).

**Action item:** Re-run `document-service` on: actions-agent, bookmarks-agent, commands-agent, data-insights-agent, research-agent, whatsapp-service.

---

### D-4 · MEDIUM · Link Preview Falsely Documented as Separate Pub/Sub Topic + Multiplex Ambiguity

**Location:** `docs/services/whatsapp-service/technical.md`, `apps/whatsapp-service/src/infra/pubsub/publisher.ts`

**Description:** Documentation lists `intexuraos-whatsapp-linkpreview-extract-{env}` as a published event topic. This topic does not exist in Terraform. The `publishExtractLinkPreviews()` method in code publishes to `this.webhookProcessTopic` — it reuses `intexuraos-whatsapp-webhook-process-{env}`.

This means `intexuraos-whatsapp-webhook-process-{env}` multiplexes two distinct event types (`WebhookProcessEvent` and `ExtractLinkPreviewsEvent`) through a single topic, but the subscriber route handler at `/internal/whatsapp/pubsub/process-webhook` must discriminate between them. No explicit schema validation or type discriminator enforcement is visible in the handler.

**Evidence:**
- `apps/whatsapp-service/src/infra/pubsub/publisher.ts` lines 88–98: `publishExtractLinkPreviews()` passes `this.webhookProcessTopic` to `publishToTopic()`
- No `pubsub_whatsapp_linkpreview` module exists in `terraform/environments/dev/main.tf`

**Impact:** Documentation only for the topic name error. The multiplexing creates a schema consistency gap — future changes to either event type must be coordinated at the same endpoint. Low immediate risk.

**Action items:**
- [ ] Update whatsapp-service `technical.md` to clarify that link preview extraction events are dispatched through the `intexuraos-whatsapp-webhook-process-{env}` topic
- [ ] Consider adding explicit type-based routing in the webhook-process subscriber for defensive handling

---

### D-5 · LOW · todos-agent Env Var Missing `PUBSUB_` Prefix

**Location:** `apps/todos-agent/src/index.ts`, `ecosystem.config.cjs`

**Description:** todos-agent uses `INTEXURAOS_TODOS_PROCESSING_TOPIC` rather than `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC`, deviating from the `INTEXURAOS_PUBSUB_*` naming convention used by all other publishers. Also, `ecosystem.config.cjs` lists it under `INTEXURAOS_TODOS_PROCESSING_TOPIC` matching the non-standard name.

**Impact:** No runtime issue. Terraform correctly matches the non-standard name. Minor inconsistency for tooling or automated checks that scan for `PUBSUB_` prefixed env vars.

**Action item:** Low priority — rename env var in lockstep across `apps/todos-agent/src/index.ts`, `apps/todos-agent/src/services.ts`, `terraform/environments/dev/main.tf`, and `ecosystem.config.cjs`.

---

### D-6 · LOW · snapshot-refresh Topic Deviates from Naming Convention

**Location:** `terraform/environments/dev/main.tf` line 1751

**Description:** The data-insights snapshot refresh topic is named `snapshot-refresh-{env}` rather than following the `intexuraos-{purpose}-{env}` convention used by all 15 other topics.

**Impact:** No runtime issue. May cause confusion in log analysis or monitoring dashboards that filter by `intexuraos-` prefix.

**Action item:** Low priority — rename to `intexuraos-snapshot-refresh-{env}` in Terraform if naming conventions are being enforced.

---

### D-7 · LOW · bookmarks-agent Env Vars Missing `_TOPIC` Suffix

**Location:** `apps/bookmarks-agent/src/index.ts`

**Description:** bookmarks-agent uses `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH` and `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE` without the `_TOPIC` suffix that all other service pub/sub env vars use.

**Impact:** No runtime issue. Terraform matches these names correctly. Minor inconsistency.

**Action item:** Low priority — rename env vars to add `_TOPIC` suffix for consistency, updating `index.ts`, `services.ts`, `terraform/environments/dev/main.tf`, and `ecosystem.config.cjs`.

---

### D-8 · INFORMATIONAL · ecosystem.config.cjs Fallback Values Are Development Shorthand Only

**Location:** `ecosystem.config.cjs` `SERVICE_ENV_MAPPINGS`

**Description:** All Pub/Sub topic env vars in `ecosystem.config.cjs` use short fallback names (e.g. `whatsapp-send-message`, `research-process`) rather than the full `intexuraos-*-{env}` Terraform names. This is by design — the fallback values are only used when the actual env var is absent.

At runtime:
- **Local dev with `.envrc` loaded:** actual `intexuraos-*-dev` names are used (from `.envrc` → environment vars)
- **Cloud Run:** actual `intexuraos-*-{env}` names are used (from Terraform `env_vars`)
- **Isolated component test without `.envrc`:** fallback names are used — these correspond to emulator topic names, not production names

**Impact:** No issue. Correct design. Documented here for clarity.

---

## Action Items Summary

| ID  | Severity      | Service / Owner        | Action                                                                                           |
| --- | ------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| D-1 | HIGH          | research-agent         | Wire `AnalyticsEventPublisherImpl` into ServiceContainer OR remove publisher + Terraform topic + route handler |
| D-2 | MEDIUM        | research-agent         | Add `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` to REQUIRED_ENV + ecosystem (resolved by D-1)       |
| D-3 | MEDIUM        | docs                   | Regenerate `technical.md` for 6 services with correct topic names and endpoint paths             |
| D-4 | MEDIUM        | docs / whatsapp-service| Update technical.md: `publishExtractLinkPreviews` reuses `webhook-process` topic, not separate  |
| D-5 | LOW           | todos-agent            | Consider renaming `INTEXURAOS_TODOS_PROCESSING_TOPIC` → `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC` |
| D-6 | LOW           | infra                  | Consider renaming `snapshot-refresh-{env}` → `intexuraos-snapshot-refresh-{env}`               |
| D-7 | LOW           | bookmarks-agent        | Consider adding `_TOPIC` suffix to bookmark pub/sub env var names                               |
| D-8 | INFORMATIONAL | N/A                    | ecosystem.config.cjs fallback names are development shorthand — no action required              |

---

## Sources

| Source                                             | Purpose                                              |
| -------------------------------------------------- | ---------------------------------------------------- |
| `docs/services/*/technical.md` (23 files)         | Documented published/subscribed events per service   |
| `terraform/environments/dev/main.tf`               | Authoritative topic definitions, subscriptions, IAM  |
| `terraform/modules/pubsub-push/`                   | Module schema (topic + DLQ + push sub + IAM pattern) |
| `apps/*/src/infra/pubsub/*.ts`                     | Publisher implementations and topic wiring           |
| `packages/infra-pubsub/src/*.ts`                   | Shared publisher types and event schemas             |
| `apps/*/src/services.ts`                           | ServiceContainer wiring (publisher activation)       |
| `apps/*/src/index.ts`                              | REQUIRED_ENV declarations per service                |
| `ecosystem.config.cjs`                             | Local dev topic name fallbacks and service env vars  |
