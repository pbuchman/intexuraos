# Pub/Sub Contracts Cross-Validation Report

**Date:** 2026-03-16
**Branch:** docs/full-refresh-v4
**Previous report:** 2026-02-19 (superseded by this document)
**Scope:** All Pub/Sub topics, publishers, subscribers, IAM permissions, dead-letter queues, retry policies, and message schemas across IntexuraOS

---

## Executive Summary

| Category                                         | Count |
| ------------------------------------------------ | ----- |
| Total Terraform topics                           | 16    |
| Topics using `pubsub-push` module (DLQ included) | 14    |
| Raw topics (no DLQ)                              | 2     |
| Topics with active publishers                    | 14    |
| Topics with active subscribers                   | 16    |
| CRITICAL discrepancies                           | 0     |
| HIGH discrepancies                               | 1     |
| MEDIUM discrepancies                             | 4     |
| LOW discrepancies                                | 4     |

**Overall health:** IAM permission matrix is correct and all push subscription endpoints match active route handlers. One dead publisher class exists in the codebase (unchanged from previous report). The transcription architecture was refactored since the last report — the old `intexuraos-whatsapp-transcription-{env}` self-loop topic has been replaced by a Cloud Function pipeline using `audio-stored` → Cloud Function → `transcription-completed`. Documentation topic names remain systematically outdated. One ghost subscription entry exists in `ecosystem.config.cjs`.

**Changes since 2026-02-19 report:**
- Topic count increased from 15 → 16: `pubsub_whatsapp_transcription` removed; three topics added (`audio_stored`, `pubsub_transcription_completed`, `pubsub_srt_transcription_completed`)
- `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC` removed from whatsapp-service (no longer needed)
- New worker: `workers/transcription/` (Cloud Function, publishes `intexuraos-transcription-completed-{env}`)
- D-1 and D-2 (dead analytics publisher) remain unresolved
- New discrepancy D-8: ghost `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` in ecosystem.config.cjs

---

## Complete Topic Inventory

All topics using the `pubsub-push` Terraform module include: HTTP push subscription, OIDC authentication, dead-letter queue (DLQ) topic + pull subscription, and retry policy. Defaults: `max_delivery_attempts=5`, `retry_minimum_backoff=10s`, `retry_maximum_backoff=600s`, `message_retention_duration=604800s` (7 days).

| #   | Terraform Resource                   | Topic Name                                     | Push Endpoint                                       | Ack Deadline | DLQ? | Subscriber SA             |
| --- | ------------------------------------ | ---------------------------------------------- | --------------------------------------------------- | ------------ | ---- | ------------------------- |
| 1   | `pubsub_actions_queue`               | `intexuraos-actions-queue-{env}`               | `/internal/actions/process`                         | 60s          | YES  | actions_agent             |
| 2   | `pubsub_approval_reply`              | `intexuraos-approval-reply-{env}`              | `/internal/actions/approval-reply`                  | 60s          | YES  | actions_agent             |
| 3   | `pubsub_bookmark_enrich`             | `intexuraos-bookmark-enrich-{env}`             | `/internal/bookmarks/pubsub/enrich`                 | 60s          | YES  | bookmarks_agent           |
| 4   | `pubsub_bookmark_summarize`          | `intexuraos-bookmark-summarize-{env}`          | `/internal/bookmarks/pubsub/summarize`              | 120s ¹       | YES  | bookmarks_agent           |
| 5   | `pubsub_calendar_preview`            | `intexuraos-calendar-preview-{env}`            | `/internal/calendar/generate-preview`               | 120s         | YES  | calendar_agent            |
| 6   | `pubsub_commands_ingest`             | `intexuraos-commands-ingest-{env}`             | `/internal/commands`                                | 60s          | YES  | commands_agent            |
| 7   | `pubsub_llm_analytics`               | `intexuraos-llm-analytics-{env}`               | `/internal/llm/pubsub/report-analytics`             | 300s         | YES  | research_agent            |
| 8   | `pubsub_llm_call`                    | `intexuraos-llm-call-{env}`                    | `/internal/llm/pubsub/process-llm-call`             | 600s ²       | YES  | research_agent            |
| 9   | `pubsub_media_cleanup`               | `intexuraos-whatsapp-media-cleanup-{env}`      | `/internal/whatsapp/pubsub/media-cleanup`           | 60s          | YES  | whatsapp_service          |
| 10  | `pubsub_research_process`            | `intexuraos-research-process-{env}`            | `/internal/llm/pubsub/process-research`             | 600s ²       | YES  | research_agent            |
| 11  | `pubsub_srt_transcription_completed` | `intexuraos-srt-transcription-completed-{env}` | `/internal/whatsapp/pubsub/transcription-completed` | 120s         | YES  | whatsapp_service          |
| 12  | `pubsub_todos_processing`            | `intexuraos-todos-processing-{env}`            | `/internal/todos/pubsub/todos-processing`           | 60s          | YES  | todos_agent               |
| 13  | `pubsub_transcription_completed`     | `intexuraos-transcription-completed-{env}`     | `/internal/whatsapp/pubsub/transcription-completed` | 60s          | YES  | whatsapp_service          |
| 14  | `pubsub_whatsapp_send`               | `intexuraos-whatsapp-send-{env}`               | `/internal/whatsapp/pubsub/send-message`            | 60s          | YES  | whatsapp_service          |
| 15  | `pubsub_whatsapp_webhook_process`    | `intexuraos-whatsapp-webhook-process-{env}`    | `/internal/whatsapp/pubsub/process-webhook`         | 120s         | YES  | whatsapp_service          |
| 16  | `google_pubsub_topic.audio_stored`   | `intexuraos-audio-stored-{env}`                | Cloud Function event trigger (transcription worker) | N/A ³        | NO   | transcription_function SA |
| —   | `google_pubsub_topic.log_cleanup`    | `intexuraos-log-cleanup-{env}`                 | Cloud Function event trigger (log cleanup)          | N/A ³        | NO   | cloud_functions SA        |

¹ Custom retry: `retry_minimum_backoff=30s`, `retry_maximum_backoff=600s`, `max_delivery_attempts=50` (6-hour resilience window for Crawl4AI transient errors)
² 600s = GCP maximum ack deadline (used for long-running AI tasks)
³ Cloud Functions Pub/Sub event trigger — no subscription managed separately; Cloud Functions runtime handles delivery. `log_cleanup` is scheduled fire-and-forget; `audio_stored` triggers the transcription Cloud Function.

**Note on transcription topics:** Both `pubsub_srt_transcription_completed` and `pubsub_transcription_completed` push to the same endpoint (`/internal/whatsapp/pubsub/transcription-completed`). `pubsub_srt_transcription_completed` is owned by an external srt-service (publisher_service_accounts is empty — whatsapp-service only defines the push subscription). `pubsub_transcription_completed` is published by the `workers/transcription` Cloud Function using `INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC`.

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

| Topic                                          | DLQ Topic Name                                      | Max Attempts | DLQ Retention |
| ---------------------------------------------- | --------------------------------------------------- | ------------ | ------------- |
| `intexuraos-actions-queue-{env}`               | `intexuraos-actions-queue-{env}-dlq`                | 5 (default)  | 7 days        |
| `intexuraos-approval-reply-{env}`              | `intexuraos-approval-reply-{env}-dlq`               | 5 (default)  | 7 days        |
| `intexuraos-bookmark-enrich-{env}`             | `intexuraos-bookmark-enrich-{env}-dlq`              | 5 (default)  | 7 days        |
| `intexuraos-bookmark-summarize-{env}`          | `intexuraos-bookmark-summarize-{env}-dlq`           | **50** ¹     | 7 days        |
| `intexuraos-calendar-preview-{env}`            | `intexuraos-calendar-preview-{env}-dlq`             | 5 (default)  | 7 days        |
| `intexuraos-commands-ingest-{env}`             | `intexuraos-commands-ingest-{env}-dlq`              | 5 (default)  | 7 days        |
| `intexuraos-llm-analytics-{env}`               | `intexuraos-llm-analytics-{env}-dlq`                | 5 (default)  | 7 days        |
| `intexuraos-llm-call-{env}`                    | `intexuraos-llm-call-{env}-dlq`                     | 5 (default)  | 7 days        |
| `intexuraos-whatsapp-media-cleanup-{env}`      | `intexuraos-whatsapp-media-cleanup-{env}-dlq`       | 5 (default)  | 7 days        |
| `intexuraos-research-process-{env}`            | `intexuraos-research-process-{env}-dlq`             | 5 (default)  | 7 days        |
| `intexuraos-srt-transcription-completed-{env}` | `intexuraos-srt-transcription-completed-{env}-dlq`  | 5 (default)  | 7 days        |
| `intexuraos-todos-processing-{env}`            | `intexuraos-todos-processing-{env}-dlq`             | 5 (default)  | 7 days        |
| `intexuraos-transcription-completed-{env}`     | `intexuraos-transcription-completed-{env}-dlq`      | 5 (default)  | 7 days        |
| `intexuraos-whatsapp-send-{env}`               | `intexuraos-whatsapp-send-{env}-dlq`                | 5 (default)  | 7 days        |
| `intexuraos-whatsapp-webhook-process-{env}`    | `intexuraos-whatsapp-webhook-process-{env}-dlq`     | 5 (default)  | 7 days        |

¹ `pubsub_bookmark_summarize` intentionally sets `max_delivery_attempts=50` to provide a ~6-hour retry window for transient Crawl4AI API errors. No other topic overrides this default.

### Raw Topics (no DLQ)

| Topic                              | Reason for No DLQ                                                                                              | Risk |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| `intexuraos-log-cleanup-{env}`     | Cloud Functions event trigger — framework handles delivery; log cleanup is fire-and-forget, loss is acceptable | LOW  |
| `intexuraos-audio-stored-{env}`    | Cloud Functions event trigger — triggers transcription worker; no subscription managed separately              | LOW  |

---

## Retry Policies

### Module Defaults

The `pubsub-push` module sets exponential backoff on all subscriptions unless overridden:

| Parameter               | Default Value | Description                                |
| ----------------------- | ------------- | ------------------------------------------ |
| `retry_minimum_backoff` | `10s`         | Minimum wait before first retry            |
| `retry_maximum_backoff` | `600s`        | Maximum wait between retries               |
| `max_delivery_attempts` | `5`           | Before sending to DLQ                      |
| `ack_deadline_seconds`  | `60`          | Module default (most topics override this) |

### Per-Topic Retry Configuration

| Topic                                      | Min Backoff | Max Backoff | Max Attempts | Notes                              |
| ------------------------------------------ | ----------- | ----------- | ------------ | ---------------------------------- |
| `intexuraos-bookmark-summarize-{env}`      | **30s**     | **600s**    | **50**       | Extended for Crawl4AI resilience   |
| `intexuraos-research-process-{env}`        | 10s         | 600s        | 5            | Ack deadline: 600s (long AI tasks) |
| `intexuraos-llm-call-{env}`                | 10s         | 600s        | 5            | Ack deadline: 600s (LLM calls)     |
| All others                                 | 10s         | 600s        | 5            | Module defaults                    |

---

## Message Schema Consistency

Validated by reading publisher implementations against subscriber route handlers.

| Topic                                          | Event Type Field                                     | Publisher Schema Source                                                     | Subscriber Validates `type`?       |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `intexuraos-actions-queue-{env}`               | `ActionCreatedEvent`                                 | `apps/actions-agent/src/domain/models/actionEvent.ts`                       | YES                                |
| `intexuraos-approval-reply-{env}`              | `ApprovalReplyEvent`                                 | `apps/whatsapp-service/src/domain/whatsapp/index.ts`                        | YES                                |
| `intexuraos-bookmark-enrich-{env}`             | `bookmarks.enrich`                                   | `apps/bookmarks-agent/src/infra/pubsub/enrichPublisher.ts`                  | YES                                |
| `intexuraos-bookmark-summarize-{env}`          | `bookmarks.summarize`                                | `apps/bookmarks-agent/src/infra/pubsub/summarizePublisher.ts`               | YES                                |
| `intexuraos-calendar-preview-{env}`            | `calendar.preview.generate`                          | `packages/infra-pubsub/src/calendarPreviewPublisher.ts`                     | YES                                |
| `intexuraos-commands-ingest-{env}`             | `CommandIngestEvent`                                 | `apps/whatsapp-service/src/domain/whatsapp/index.ts`                        | YES                                |
| `intexuraos-llm-analytics-{env}`               | `llm.report`                                         | `apps/research-agent/src/infra/pubsub/analyticsEventPublisher.ts`           | YES (handler exists, no publisher) |
| `intexuraos-llm-call-{env}`                    | `llm.call`                                           | `apps/research-agent/src/infra/pubsub/llmCallPublisher.ts`                  | YES                                |
| `intexuraos-whatsapp-media-cleanup-{env}`      | `MediaCleanupEvent`                                  | `apps/whatsapp-service/src/infra/pubsub/publisher.ts`                       | YES                                |
| `intexuraos-research-process-{env}`            | `research.process`                                   | `apps/research-agent/src/infra/pubsub/researchEventPublisher.ts`            | YES                                |
| `intexuraos-srt-transcription-completed-{env}` | `srt.transcription.completed`                        | srt-service (external — schema inferred from subscriber)                    | YES — explicit type check          |
| `intexuraos-todos-processing-{env}`            | `todos.processing.created`                           | `packages/infra-pubsub/src/todosProcessingPublisher.ts`                     | YES                                |
| `intexuraos-transcription-completed-{env}`     | `srt.transcription.completed`                        | `workers/transcription/src/publishers/transcription-completed-publisher.ts` | YES — same type check              |
| `intexuraos-whatsapp-send-{env}`               | `whatsapp.message.send`                              | `packages/infra-pubsub/src/whatsappSendPublisher.ts`                        | YES                                |
| `intexuraos-whatsapp-webhook-process-{env}`    | `WebhookProcessEvent` / `ExtractLinkPreviewsEvent`   | `apps/whatsapp-service/src/infra/pubsub/publisher.ts`                       | Partial — see D-4                  |
| `intexuraos-audio-stored-{env}`                | `AudioStoredEvent`                                   | `apps/whatsapp-service/src/infra/pubsub/publisher.ts`                       | N/A (Cloud Function trigger)       |
| `intexuraos-log-cleanup-{env}`                 | `{ trigger: "scheduled" }`                           | Cloud Scheduler `pubsub_target`                                             | N/A (no type field)                |

**Note on transcription event type:** Both `pubsub_srt_transcription_completed` and `pubsub_transcription_completed` produce events with `type: 'srt.transcription.completed'`. The whatsapp-service subscriber at `/internal/whatsapp/pubsub/transcription-completed` checks this type explicitly (line 561 of `pubsubRoutes.ts`). Both topics share the same handler — the schema contract is consistent.

### Shared Publisher Package

The `packages/infra-pubsub` package centralizes shared event schemas used by multiple publishers:

| Type exported                  | Used by publishers                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `SendMessageEvent`             | actions-agent, research-agent, bookmarks-agent, code-agent (all via `createWhatsAppSendPublisher`) |
| `TodoProcessingEvent`          | todos-agent (`createTodosProcessingPublisher`)                                                     |
| `CalendarPreviewGenerateEvent` | actions-agent (`createCalendarPreviewPublisher`)                                                   |

---

## Publisher–Subscriber Map

| Topic                                          | Publisher(s)                                               | Subscriber              | Pattern                                                   |
| ---------------------------------------------- | ---------------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `intexuraos-actions-queue-{env}`               | commands-agent, actions-agent                              | actions-agent           | Fan-out + self-loop for deferred work                     |
| `intexuraos-approval-reply-{env}`              | whatsapp-service                                           | actions-agent           | User approval responses                                   |
| `intexuraos-audio-stored-{env}`                | whatsapp-service                                           | transcription Cloud Fn  | Trigger: audio file ready for transcription               |
| `intexuraos-bookmark-enrich-{env}`             | bookmarks-agent                                            | bookmarks-agent         | Self-loop: async link metadata fetch                      |
| `intexuraos-bookmark-summarize-{env}`          | bookmarks-agent                                            | bookmarks-agent         | Self-loop: async AI summarization                         |
| `intexuraos-calendar-preview-{env}`            | actions-agent                                              | calendar-agent          | Cross-service preview generation                          |
| `intexuraos-commands-ingest-{env}`             | whatsapp-service                                           | commands-agent          | Entry point for user commands from WhatsApp               |
| `intexuraos-llm-analytics-{env}`               | _(dead code — see D-1)_                                    | research-agent          | **INACTIVE** — no active publisher                        |
| `intexuraos-llm-call-{env}`                    | research-agent                                             | research-agent          | Self-loop: individual LLM call dispatch                   |
| `intexuraos-log-cleanup-{env}`                 | Cloud Scheduler                                            | Cloud Function          | Scheduled trigger for log retention enforcement           |
| `intexuraos-research-process-{env}`            | research-agent                                             | research-agent          | Self-loop: async research task execution                  |
| `intexuraos-srt-transcription-completed-{env}` | srt-service (external)                                     | whatsapp-service        | Cross-service: srt-service transcription results          |
| `intexuraos-todos-processing-{env}`            | todos-agent                                                | todos-agent             | Self-loop: AI todo item extraction                        |
| `intexuraos-transcription-completed-{env}`     | transcription Cloud Function (`workers/transcription`)     | whatsapp-service        | Cloud Function → service: Speechmatics transcription done |
| `intexuraos-whatsapp-media-cleanup-{env}`      | whatsapp-service                                           | whatsapp-service        | Self-loop: deferred media expiry cleanup                  |
| `intexuraos-whatsapp-send-{env}`               | actions-agent, research-agent, bookmarks-agent, code-agent | whatsapp-service        | Multi-publisher notification bus                          |
| `intexuraos-whatsapp-webhook-process-{env}`    | whatsapp-service (two event types — see D-4)               | whatsapp-service        | Self-loop: async webhook + link-preview events            |

---

## IAM Permission Matrix

All IAM grants use `roles/pubsub.publisher`. Verified against Terraform `publisher_service_accounts` maps in `terraform/environments/dev/main.tf`.

| Service Account         | Topics Granted Publisher IAM                                                                                | Active in Code? |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | --------------- |
| whatsapp_service        | media_cleanup, webhook_process, commands_ingest, whatsapp_send, approval_reply, **audio_stored**            | YES ✓           |
| commands_agent          | actions_queue                                                                                               | YES ✓           |
| actions_agent           | actions_queue, whatsapp_send, calendar_preview                                                              | YES ✓           |
| research_agent          | research_process, **llm_analytics** _(dead code)_, llm_call, whatsapp_send                                  | PARTIAL ⚠       |
| bookmarks_agent         | bookmark_enrich, bookmark_summarize, whatsapp_send                                                          | YES ✓           |
| code_agent              | whatsapp_send                                                                                               | YES ✓           |
| todos_agent             | todos_processing                                                                                            | YES ✓           |
| transcription_function  | transcription_completed                                                                                     | YES ✓           |
| cloud_scheduler SA      | log_cleanup                                                                                                 | YES ✓           |
| srt-service             | srt_transcription_completed (external — publisher_service_accounts = {} in Terraform)                       | EXTERNAL        |

**Notes:**
- `research_agent` has publisher IAM for `llm_analytics` but `AnalyticsEventPublisherImpl` is not wired into the ServiceContainer. IAM grant is harmless but unnecessary. See D-1.
- `pubsub_srt_transcription_completed` has `publisher_service_accounts = {}` — whatsapp-service only defines the push subscription. The srt-service publishes independently; no IAM grant is managed in this repo.

---

## REQUIRED_ENV Validation

| Service              | Env Var                                           | REQUIRED_ENV?       | Terraform env_vars?                                       | ecosystem.config.cjs?  | Status  |
| -------------------- | ------------------------------------------------- | ------------------- | --------------------------------------------------------- | ---------------------- | ------- |
| actions-agent        | `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`                 | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| actions-agent        | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`           | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| actions-agent        | `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC`        | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| bookmarks-agent      | `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`               | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| bookmarks-agent      | `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`            | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| bookmarks-agent      | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`           | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| code-agent           | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`           | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| commands-agent       | `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`                 | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| research-agent       | `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC`        | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| research-agent       | `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`                | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| research-agent       | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`           | **NO** ⚠            | YES (hardcoded string)                                    | **NO** ⚠               | D-2 ⚠   |
| research-agent       | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`           | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| todos-agent          | `INTEXURAOS_TODOS_PROCESSING_TOPIC`               | YES                 | YES (hardcoded string)                                    | YES (non-standard key) | D-5 ⚠   |
| transcription worker | `INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC` | YES (startup throw) | YES (`module.pubsub_transcription_completed.topic_name`)  | N/A (Cloud Function)   | OK ✓    |
| whatsapp-service     | `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`           | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| whatsapp-service     | `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`         | YES                 | YES (`module.pubsub_commands_ingest.topic_name`)          | YES                    | OK ✓    |
| whatsapp-service     | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`           | YES                 | YES (hardcoded string)                                    | YES                    | OK ✓    |
| whatsapp-service     | `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`         | YES                 | YES (`module.pubsub_whatsapp_webhook_process.topic_name`) | YES                    | OK ✓    |
| whatsapp-service     | `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC`            | YES                 | YES (`google_pubsub_topic.audio_stored.name`)             | YES                    | OK ✓    |
| whatsapp-service     | `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`          | YES                 | YES (`module.pubsub_approval_reply.topic_name`)           | YES                    | OK ✓    |
| whatsapp-service     | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION`    | **NO**              | **NO** (not in Terraform env_vars)                        | YES ⚠ (ghost entry)    | D-8 ⚠   |

---

## Terraform vs ecosystem.config.cjs Topic Name Match

All topic env vars set in Terraform `env_vars` are compared against local fallback values in `ecosystem.config.cjs`.

| Env Var                                     | Terraform Value                                           | ecosystem.config.cjs Default | Match?  |
| ------------------------------------------- | --------------------------------------------------------- | ---------------------------- | ------- |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`           | `intexuraos-actions-queue-dev`                            | `actions-queue`              | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`     | `intexuraos-whatsapp-send-dev`                            | `whatsapp-send-message`      | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC`  | `intexuraos-research-process-dev`                         | `research-process`           | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`          | `intexuraos-llm-call-dev`                                 | `llm-call`                   | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC`  | `intexuraos-calendar-preview-dev`                         | `calendar-preview`           | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`         | `intexuraos-bookmark-enrich-dev`                          | `bookmark-enrich`            | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`      | `intexuraos-bookmark-summarize-dev`                       | `bookmark-summarize`         | ALIAS ⚠ |
| `INTEXURAOS_TODOS_PROCESSING_TOPIC`         | `intexuraos-todos-processing-dev`                         | `todos-processing`           | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`     | `intexuraos-whatsapp-media-cleanup-dev`                   | `whatsapp-media-cleanup`     | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`   | `intexuraos-commands-ingest-dev` (module output)          | `commands-ingest`            | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`   | `intexuraos-whatsapp-webhook-process-dev` (module output) | `whatsapp-webhook-process`   | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC`      | `intexuraos-audio-stored-dev`                             | `audio-stored-dev`           | ALIAS ⚠ |
| `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`    | `intexuraos-approval-reply-dev` (module output)           | `approval-reply`             | ALIAS ⚠ |

**ALIAS interpretation:** All ALIAS entries indicate correct behavior — `ecosystem.config.cjs` reads from `process.env.*` and uses the short name only as a fallback when the actual env var is not set. At runtime (both local dev with `.envrc` loaded and Cloud Run), the actual `intexuraos-*-{env}` name is always used. The short fallback names exist only for isolated component testing without `.envrc`.

---

## Discrepancies

### D-1 · HIGH · Dead Analytics Publisher — Topic Receives No Messages

**Location:** `apps/research-agent/src/infra/pubsub/analyticsEventPublisher.ts`

**Description:** `AnalyticsEventPublisherImpl` is implemented and exported from `apps/research-agent/src/infra/pubsub/index.ts`, but is **not present in `ServiceContainer`** and not instantiated anywhere in `services.ts`. The Terraform infrastructure for this topic (topic, push subscription, IAM, DLQ) fully exists but the topic is never published to.

**Evidence:**
- `apps/research-agent/src/services.ts`: `ServiceContainer` has `researchEventPublisher` and `llmCallPublisher` but no analytics publisher field
- `apps/research-agent/src/infra/pubsub/index.ts`: exports `AnalyticsEventPublisherImpl`, `createAnalyticsEventPublisher`, `type AnalyticsEventPublisher`
- `terraform/environments/dev/main.tf` line 741: `module "pubsub_llm_analytics"` exists with full push subscription
- `terraform/environments/dev/main.tf` line 1066: `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` set in research-agent env vars but not in REQUIRED_ENV
- No references to `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` in any `.ts` source file

**Impact:** LLM usage analytics are not being reported to this topic. Terraform resource is live but idle. The route handler at `/internal/llm/pubsub/report-analytics` receives no messages.

**Action items:**
- [ ] **Option A:** Wire `AnalyticsEventPublisherImpl` into research-agent's `ServiceContainer`, add `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` to `REQUIRED_ENV` in `apps/research-agent/src/index.ts`, add to `ecosystem.config.cjs`, and publish analytics events at appropriate call sites
- [ ] **Option B:** If analytics is intentionally abandoned, delete: publisher class (`analyticsEventPublisher.ts`), Terraform `pubsub_llm_analytics` module and IAM grant, `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` env var from research-agent Terraform block, and route handler `/internal/llm/pubsub/report-analytics`

---

### D-2 · MEDIUM · Missing REQUIRED_ENV and ecosystem Entry for LLM Analytics Topic

**Location:** `apps/research-agent/src/index.ts`, `ecosystem.config.cjs`

**Description:** Terraform sets `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` in research-agent's `env_vars`, but:
1. `REQUIRED_ENV` in `index.ts` does not include it — no startup validation
2. `ecosystem.config.cjs` `SERVICE_ENV_MAPPINGS['research-agent']` does not include it — no local dev override

**Impact:** If the env var were removed from Terraform, the service would start successfully with a missing var — violating the fail-fast startup principle.

**Action item:** Resolved by D-1 — either add to REQUIRED_ENV + ecosystem (Option A) or remove the env var from Terraform (Option B).

---

### D-3 · MEDIUM · Documentation Topic Names Systematically Outdated

**Location:** `docs/services/*/technical.md` for multiple services

**Description:** Service `technical.md` files contain Published Events and Subscribed Events tables with topic names that no longer match Terraform. The transcription refactoring has introduced additional staleness since the last report.

| Service          | Documented Topic                                    | Actual Topic                                           |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------ |
| actions-agent    | `intexuraos-actions-{env}` (published)              | `intexuraos-actions-queue-{env}`                       |
| bookmarks-agent  | `intexuraos-bookmarks-enrich-{env}`                 | `intexuraos-bookmark-enrich-{env}`                     |
| bookmarks-agent  | `intexuraos-bookmarks-summarize-{env}`              | `intexuraos-bookmark-summarize-{env}`                  |
| bookmarks-agent  | `intexuraos-whatsapp-message-send-{env}`            | `intexuraos-whatsapp-send-{env}`                       |
| commands-agent   | `intexuraos-actions-{env}` (published)              | `intexuraos-actions-queue-{env}`                       |
| commands-agent   | `intexuraos-command-ingest-{env}` (subscribed)      | `intexuraos-commands-ingest-{env}`                     |
| research-agent   | `intexuraos-llm-process-{env}` (published)          | `intexuraos-research-process-{env}`                    |
| research-agent   | `intexuraos-llm-report-{env}` (published)           | `intexuraos-llm-analytics-{env}`                       |
| research-agent   | `intexuraos-llm-process-queue-{env}` (subscribed)   | `intexuraos-research-process-{env}`                    |
| research-agent   | `intexuraos-llm-call-queue-{env}` (subscribed)      | `intexuraos-llm-call-{env}`                            |
| whatsapp-service | `intexuraos-whatsapp-audio-transcribe-{env}`        | removed; replaced by `intexuraos-audio-stored-{env}`   |
| whatsapp-service | `intexuraos-command-ingest-{env}`                   | `intexuraos-commands-ingest-{env}`                     |
| whatsapp-service | `intexuraos-approval-replies-{env}` (plural)        | `intexuraos-approval-reply-{env}` (singular)           |
| whatsapp-service | _(missing)_                                         | `intexuraos-transcription-completed-{env}` (new)       |
| whatsapp-service | _(missing)_                                         | `intexuraos-srt-transcription-completed-{env}` (new)   |

**Action item:** Re-run `document-service` on: actions-agent, bookmarks-agent, commands-agent, research-agent, whatsapp-service. Also update `workers/transcription` docs to reflect the new `INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC` publishing.

---

### D-4 · MEDIUM · Link Preview Reuses Webhook Topic — Multiplex Ambiguity

**Location:** `docs/services/whatsapp-service/technical.md`, `apps/whatsapp-service/src/infra/pubsub/publisher.ts`

**Description:** Documentation lists `intexuraos-whatsapp-linkpreview-extract-{env}` as a published event topic. This topic does not exist in Terraform. The `publishExtractLinkPreviews()` method in code publishes to `this.webhookProcessTopic` — it reuses `intexuraos-whatsapp-webhook-process-{env}`.

This means `intexuraos-whatsapp-webhook-process-{env}` multiplexes two distinct event types (`WebhookProcessEvent` and `ExtractLinkPreviewsEvent`) through a single topic. The subscriber route handler at `/internal/whatsapp/pubsub/process-webhook` must discriminate between them without a discriminated-union type guard.

**Evidence:**
- `apps/whatsapp-service/src/infra/pubsub/publisher.ts` lines 88–98: `publishExtractLinkPreviews()` passes `this.webhookProcessTopic` to `publishToTopic()`
- No `pubsub_whatsapp_linkpreview` module exists in `terraform/environments/dev/main.tf`

**Action items:**
- [ ] Update whatsapp-service `technical.md` to document that link preview extraction events are dispatched through the `intexuraos-whatsapp-webhook-process-{env}` topic
- [ ] Consider adding explicit type-based routing in the webhook-process subscriber for defensive handling

---

### D-5 · LOW · todos-agent Env Var Missing `PUBSUB_` Prefix

**Location:** `apps/todos-agent/src/index.ts`, `ecosystem.config.cjs`, `terraform/environments/dev/main.tf` line 1246

**Description:** todos-agent uses `INTEXURAOS_TODOS_PROCESSING_TOPIC` rather than `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC`, deviating from the `INTEXURAOS_PUBSUB_*` naming convention used by all other publishers. Terraform, source code, and ecosystem.config.cjs are internally consistent with the non-standard name.

**Impact:** No runtime issue. Minor inconsistency for tooling that scans for `PUBSUB_`-prefixed env vars.

**Action item:** Low priority — rename env var in lockstep across `apps/todos-agent/src/index.ts`, `apps/todos-agent/src/services.ts`, `terraform/environments/dev/main.tf`, and `ecosystem.config.cjs`.

---

### D-6 · LOW · bookmarks-agent Env Vars Missing `_TOPIC` Suffix

**Location:** `apps/bookmarks-agent/src/index.ts`

**Description:** bookmarks-agent uses `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH` and `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE` without the `_TOPIC` suffix present on all other service pub/sub env vars. Terraform and ecosystem.config.cjs consistently use the same non-standard names.

**Impact:** No runtime issue. Minor inconsistency.

**Action item:** Low priority — rename env vars to add `_TOPIC` suffix for consistency across `index.ts`, `config.ts`, `terraform/environments/dev/main.tf`, and `ecosystem.config.cjs`.

---

### D-7 · INFORMATIONAL · ecosystem.config.cjs Fallback Values Are Development Shorthand Only

**Location:** `ecosystem.config.cjs` `SERVICE_ENV_MAPPINGS`

**Description:** All Pub/Sub topic env vars in `ecosystem.config.cjs` use short fallback names (e.g. `whatsapp-send-message`, `research-process`) rather than the full `intexuraos-*-{env}` Terraform names. This is by design — the fallback values are only used when the actual env var is absent.

At runtime:
- **Local dev with `.envrc` loaded:** actual `intexuraos-*-dev` names are used (from `.envrc`)
- **Cloud Run:** actual `intexuraos-*-{env}` names are used (from Terraform `env_vars`)
- **Isolated component test without `.envrc`:** fallback short names are used — these correspond to emulator topic names

**Impact:** No issue. Correct design. Documented here for clarity.

---

### D-8 · LOW · Ghost `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` in ecosystem.config.cjs

**Location:** `ecosystem.config.cjs` line 71, `apps/whatsapp-service/src/index.ts`

**Description:** `ecosystem.config.cjs` includes `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` in the `whatsapp-service` env mappings (fallback: `whatsapp-send-message-sub`). However:
1. This variable is not in whatsapp-service's `REQUIRED_ENV` list
2. It is not set in whatsapp-service's Terraform `env_vars` block
3. No source file in `apps/whatsapp-service/src/` reads this env var

The whatsapp-service operates as a Pub/Sub **subscriber** via HTTP push (GCP pushes to `/internal/whatsapp/pubsub/send-message`), not as a pull subscriber. A subscription name env var is not needed.

**Impact:** No runtime impact — unused env var. Leftover from a prior architecture where whatsapp-service used pull subscriptions.

**Action item:** Remove `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` from `ecosystem.config.cjs` `whatsapp-service` section.

---

## Action Items Summary

| ID  | Severity      | Service / Owner         | Action                                                                                                                                                       |
| --- | ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | HIGH          | research-agent          | Wire `AnalyticsEventPublisherImpl` into ServiceContainer OR remove publisher class + Terraform `pubsub_llm_analytics` module + IAM + env var + route handler |
| D-2 | MEDIUM        | research-agent          | Add `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` to REQUIRED_ENV + ecosystem.config.cjs (resolved by D-1)                                                         |
| D-3 | MEDIUM        | docs                    | Regenerate `technical.md` for actions-agent, bookmarks-agent, commands-agent, research-agent, whatsapp-service with correct topic names                      |
| D-4 | MEDIUM        | docs / whatsapp-service | Update technical.md: `publishExtractLinkPreviews` reuses `webhook-process` topic, not a separate topic                                                       |
| D-5 | LOW           | todos-agent             | Rename `INTEXURAOS_TODOS_PROCESSING_TOPIC` → `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC` across 4 files                                                       |
| D-6 | LOW           | bookmarks-agent         | Add `_TOPIC` suffix to `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH` and `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE` across 4 files                                         |
| D-7 | INFORMATIONAL | N/A                     | ecosystem.config.cjs fallback names are development shorthand — no action required                                                                           |
| D-8 | LOW           | whatsapp-service        | Remove ghost `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` from `ecosystem.config.cjs`                                                                      |

---

## Sources

| Source                                              | Purpose                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `terraform/environments/dev/main.tf`                | Authoritative topic definitions, subscriptions, IAM  |
| `terraform/modules/pubsub-push/main.tf`             | Module schema (topic + DLQ + push sub + IAM pattern) |
| `terraform/modules/pubsub/main.tf`                  | Pull subscription module schema                      |
| `apps/*/src/infra/pubsub/*.ts`                      | Publisher implementations and topic wiring           |
| `apps/*/src/services.ts`                            | ServiceContainer wiring (publisher activation)       |
| `apps/*/src/index.ts`                               | REQUIRED_ENV declarations per service                |
| `apps/whatsapp-service/src/routes/pubsubRoutes.ts`  | Subscriber route handlers and event type validation  |
| `workers/transcription/src/`                        | Transcription Cloud Function publisher               |
| `packages/infra-pubsub/src/*.ts`                    | Shared publisher types and event schemas             |
| `ecosystem.config.cjs`                              | Local dev topic name fallbacks and service env vars  |
| `docs/architecture/pubsub-standards.md`             | Documented naming conventions and topic table        |
