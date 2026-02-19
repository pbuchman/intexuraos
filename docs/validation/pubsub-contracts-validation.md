# Pub/Sub Contracts Cross-Validation Report

**Date:** 2026-02-19
**Branch:** development
**Scope:** All Pub/Sub topics, publishers, subscribers, and IAM permissions across IntexuraOS

---

## Executive Summary

| Category                        | Count |
| ------------------------------- | ----- |
| Total Terraform topics          | 15    |
| Topics with active publishers   | 14    |
| Topics with active subscribers  | 15    |
| CRITICAL discrepancies          | 0     |
| HIGH discrepancies              | 1     |
| MEDIUM discrepancies            | 3     |
| LOW discrepancies               | 3     |

**Overall health:** The IAM permission matrix is correct and all push subscription endpoints match active route handlers. One dead publisher class exists in the codebase and documentation topic names are systematically outdated.

---

## Complete Topic Inventory

All topics use the `pubsub-push` Terraform module (HTTP push subscriptions with OIDC authentication). All topics include a dead-letter queue (DLQ) topic and pull subscription.

| # | Terraform Module                    | Topic Name                                      | Push Endpoint                                   | Ack Deadline | Subscriber SA       |
| - | ----------------------------------- | ----------------------------------------------- | ----------------------------------------------- | ------------ | ------------------- |
| 1 | `pubsub_actions_queue`              | `intexuraos-actions-queue-{env}`                | `/internal/actions/process`                     | 60s          | actions_agent       |
| 2 | `pubsub_approval_reply`             | `intexuraos-approval-reply-{env}`               | `/internal/actions/approval-reply`              | 60s          | actions_agent       |
| 3 | `pubsub_bookmark_enrich`            | `intexuraos-bookmark-enrich-{env}`              | `/internal/bookmarks/pubsub/enrich`             | 60s          | bookmarks_agent     |
| 4 | `pubsub_bookmark_summarize`         | `intexuraos-bookmark-summarize-{env}`           | `/internal/bookmarks/pubsub/summarize`          | 120s ¹       | bookmarks_agent     |
| 5 | `pubsub_calendar_preview`           | `intexuraos-calendar-preview-{env}`             | `/internal/calendar/generate-preview`           | 120s         | calendar_agent      |
| 6 | `pubsub_commands_ingest`            | `intexuraos-commands-ingest-{env}`              | `/internal/commands`                            | 60s          | commands_agent      |
| 7 | `pubsub_llm_analytics`              | `intexuraos-llm-analytics-{env}`                | `/internal/llm/pubsub/report-analytics`         | 300s         | research_agent      |
| 8 | `pubsub_llm_call`                   | `intexuraos-llm-call-{env}`                     | `/internal/llm/pubsub/process-llm-call`         | 600s ²       | research_agent      |
| 9 | `pubsub_media_cleanup`              | `intexuraos-whatsapp-media-cleanup-{env}`       | `/internal/whatsapp/pubsub/media-cleanup`       | 60s          | whatsapp_service    |
| 10| `pubsub_research_process`           | `intexuraos-research-process-{env}`             | `/internal/llm/pubsub/process-research`         | 600s ²       | research_agent      |
| 11| `pubsub_todos_processing`           | `intexuraos-todos-processing-{env}`             | `/internal/todos/pubsub/todos-processing`       | 60s          | todos_agent         |
| 12| `pubsub_whatsapp_send`              | `intexuraos-whatsapp-send-{env}`                | `/internal/whatsapp/pubsub/send-message`        | 60s          | whatsapp_service    |
| 13| `pubsub_whatsapp_transcription`     | `intexuraos-whatsapp-transcription-{env}`       | `/internal/whatsapp/pubsub/transcribe-audio`    | 600s ²       | whatsapp_service    |
| 14| `pubsub_whatsapp_webhook_process`   | `intexuraos-whatsapp-webhook-process-{env}`     | `/internal/whatsapp/pubsub/process-webhook`     | 120s         | whatsapp_service    |
| 15| `snapshot_refresh_pubsub`           | `snapshot-refresh-{env}`                        | `/internal/snapshots/refresh`                   | 600s ²       | data_insights_agent |

¹ Custom retry: min 30s backoff, max 50 delivery attempts (Crawl4AI resilience window)
² 600s = GCP maximum ack deadline (used for long-running AI tasks)

---

## Publisher–Subscriber Map

| Topic                                           | Publisher(s)                                                   | Subscriber          | Pattern                                     |
| ----------------------------------------------- | -------------------------------------------------------------- | ------------------- | ------------------------------------------- |
| `intexuraos-actions-queue-{env}`                | commands-agent, actions-agent                                  | actions-agent       | Fan-out + self-loop for deferred work       |
| `intexuraos-approval-reply-{env}`               | whatsapp-service                                               | actions-agent       | User approval responses                     |
| `intexuraos-bookmark-enrich-{env}`              | bookmarks-agent                                                | bookmarks-agent     | Self-loop: async link metadata fetch        |
| `intexuraos-bookmark-summarize-{env}`           | bookmarks-agent                                                | bookmarks-agent     | Self-loop: async AI summarization           |
| `intexuraos-calendar-preview-{env}`             | actions-agent                                                  | calendar-agent      | Cross-service preview generation            |
| `intexuraos-commands-ingest-{env}`              | whatsapp-service                                               | commands-agent      | Entry point for user commands from WhatsApp |
| `intexuraos-llm-analytics-{env}`                | *(dead code — see D-1)*                                        | research-agent      | **INACTIVE** — no active publisher          |
| `intexuraos-llm-call-{env}`                     | research-agent                                                 | research-agent      | Self-loop: individual LLM call dispatch     |
| `intexuraos-whatsapp-media-cleanup-{env}`       | whatsapp-service                                               | whatsapp-service    | Self-loop: deferred media expiry cleanup    |
| `intexuraos-research-process-{env}`             | research-agent                                                 | research-agent      | Self-loop: async research task execution    |
| `intexuraos-todos-processing-{env}`             | todos-agent                                                    | todos-agent         | Self-loop: AI todo item extraction          |
| `intexuraos-whatsapp-send-{env}`                | actions-agent, research-agent, bookmarks-agent, code-agent    | whatsapp-service    | Multi-publisher notification bus            |
| `intexuraos-whatsapp-transcription-{env}`       | whatsapp-service                                               | whatsapp-service    | Self-loop: audio-to-text transcription      |
| `intexuraos-whatsapp-webhook-process-{env}`     | whatsapp-service                                               | whatsapp-service    | Self-loop: async webhook processing         |
| `snapshot-refresh-{env}`                        | Cloud Scheduler                                                | data-insights-agent | Scheduled trigger (not a service publisher) |

**Note:** `ExtractLinkPreviewsEvent` from whatsapp-service is published to `intexuraos-whatsapp-webhook-process-{env}` — it reuses the webhook-process topic, **not** a dedicated link-preview topic. See D-4.

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
| cloud_scheduler  | snapshot_refresh                                                                                              | YES ✓           |

**research_agent IAM note:** Has publisher IAM for `llm_analytics` but `AnalyticsEventPublisherImpl` is not wired into the ServiceContainer. IAM grant is harmless but unnecessary. See D-1.

---

## REQUIRED_ENV Validation

| Service          | Env Var                                    | REQUIRED_ENV? | Terraform env_vars? | Status  |
| ---------------- | ------------------------------------------ | ------------- | ------------------- | ------- |
| actions-agent    | `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | YES           | YES                 | OK ✓    |
| actions-agent    | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES                 | OK ✓    |
| actions-agent    | `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | YES           | YES                 | OK ✓    |
| bookmarks-agent  | `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`        | YES           | YES                 | OK ✓    |
| bookmarks-agent  | `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`     | YES           | YES                 | OK ✓    |
| bookmarks-agent  | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES                 | OK ✓    |
| commands-agent   | `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | YES           | YES                 | OK ✓    |
| code-agent       | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | PROD_ONLY ³   | YES                 | OK ✓    |
| research-agent   | `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | YES           | YES                 | OK ✓    |
| research-agent   | `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | YES           | YES                 | OK ✓    |
| research-agent   | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`    | **NO** ⚠     | YES                 | D-2 ⚠  |
| research-agent   | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES                 | OK ✓    |
| todos-agent      | `INTEXURAOS_TODOS_PROCESSING_TOPIC`        | YES           | YES                 | D-5 ⚠  |
| whatsapp-service | `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | YES           | YES                 | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`  | YES           | YES                 | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES           | YES                 | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | YES           | YES                 | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`    | YES           | YES                 | OK ✓    |
| whatsapp-service | `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`   | YES           | YES                 | OK ✓    |
| data-insights    | *(none — Cloud Scheduler pushes directly)* | N/A           | N/A                 | OK ✓    |

³ `code-agent` uses `PRODUCTION_ONLY_ENV` — validated in prod, optional in E2E mode.

---

## Discrepancies

### D-1 · HIGH · Dead Analytics Publisher — Topic Receives No Messages

**Location:** `apps/research-agent/src/infra/pubsub/analyticsEventPublisher.ts`

**Description:** `AnalyticsEventPublisherImpl` is implemented and exported from `apps/research-agent/src/infra/pubsub/index.ts`, but is **not present in `ServiceContainer`** and not instantiated anywhere in `services.ts`. The Terraform infrastructure for this topic (topic, subscription, DLQ, IAM) fully exists but the topic is never published to.

**Evidence:**
- `apps/research-agent/src/services.ts`: `ServiceContainer` has `researchEventPublisher` and `llmCallPublisher` but no analytics publisher field
- `apps/research-agent/src/infra/pubsub/index.ts`: exports `AnalyticsEventPublisherImpl`, `createAnalyticsEventPublisher`, `type AnalyticsEventPublisher`
- `terraform/environments/dev/main.tf` line 719: `module "pubsub_llm_analytics"` exists with full push subscription
- `terraform/environments/dev/main.tf` line 1039: `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` is set in research-agent env vars but never validated at startup

**Impact:** LLM usage analytics are not being reported to this topic. Terraform resource is live but idle. The route handler at `/internal/llm/pubsub/report-analytics` receives no messages.

**Action items:**
- [ ] **Option A:** Wire `AnalyticsEventPublisherImpl` into research-agent's `ServiceContainer`, add `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` to REQUIRED_ENV, and publish analytics events where appropriate
- [ ] **Option B:** If analytics is intentionally abandoned, delete: publisher class, Terraform `pubsub_llm_analytics` module and IAM, `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` env var from research-agent

---

### D-2 · MEDIUM · Missing REQUIRED_ENV for LLM Analytics Topic Env Var

**Location:** `apps/research-agent/src/index.ts`

**Description:** Terraform sets `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` in research-agent's `env_vars`, but `REQUIRED_ENV` in `index.ts` does not include it. No startup validation occurs if this var is removed from Terraform.

**Impact:** If the env var were removed from Terraform, the service would start successfully with a missing var — violating the fail-fast startup principle. Low immediate risk, medium maintainability risk.

**Action item:** Resolved by D-1 — either add to REQUIRED_ENV (Option A) or remove the env var from Terraform (Option B).

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

### D-4 · MEDIUM · Link Preview Falsely Documented as a Separate Pub/Sub Topic

**Location:** `docs/services/whatsapp-service/technical.md`

**Description:** Documentation lists `intexuraos-whatsapp-linkpreview-extract-{env}` as a published event topic. This topic does not exist in Terraform. The `publishExtractLinkPreviews()` method in code publishes to `this.webhookProcessTopic` — it reuses `intexuraos-whatsapp-webhook-process-{env}`.

**Evidence:**
- `apps/whatsapp-service/src/infra/pubsub/publisher.ts` lines 88–98: `publishExtractLinkPreviews()` passes `this.webhookProcessTopic` to `publishToTopic()`
- No `pubsub_whatsapp_linkpreview` module exists in `terraform/environments/dev/main.tf`

**Impact:** Documentation only. Link preview events are correctly processed via the webhook-process pipeline. No missing infrastructure.

**Action item:** Update whatsapp-service `technical.md` to clarify that link preview extraction events are dispatched through the `intexuraos-whatsapp-webhook-process-{env}` topic.

---

### D-5 · LOW · todos-agent Env Var Missing `PUBSUB_` Prefix

**Location:** `apps/todos-agent/src/index.ts`

**Description:** todos-agent uses `INTEXURAOS_TODOS_PROCESSING_TOPIC` rather than `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC`, deviating from the `INTEXURAOS_PUBSUB_*` naming convention used by all other publishers.

**Impact:** No runtime issue. Terraform correctly matches the non-standard name. Minor inconsistency for tooling or automated checks that scan for `PUBSUB_` prefixed env vars.

**Action item:** Low priority — rename env var in lockstep across `apps/todos-agent/src/index.ts`, `apps/todos-agent/src/services.ts`, and `terraform/environments/dev/main.tf`.

---

### D-6 · LOW · snapshot-refresh Topic Deviates from Naming Convention

**Location:** `terraform/environments/dev/main.tf` line 1751

**Description:** The data-insights snapshot refresh topic is named `snapshot-refresh-{env}` rather than following the `intexuraos-{purpose}-{env}` convention used by all 14 other topics.

**Impact:** No runtime issue. May cause confusion in log analysis or monitoring dashboards that filter by `intexuraos-` prefix.

**Action item:** Low priority — rename to `intexuraos-snapshot-refresh-{env}` in Terraform if naming conventions are being enforced.

---

### D-7 · LOW · bookmarks-agent Env Vars Missing `_TOPIC` Suffix

**Location:** `apps/bookmarks-agent/src/index.ts`

**Description:** bookmarks-agent uses `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH` and `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE` without the `_TOPIC` suffix that all other service pub/sub env vars use.

**Impact:** No runtime issue. Terraform matches these names correctly. Minor inconsistency.

**Action item:** Low priority — rename env vars to add `_TOPIC` suffix for consistency.

---

## Action Items Summary

| ID  | Severity | Service / Owner        | Action                                                                                           |
| --- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| D-1 | HIGH     | research-agent         | Wire `AnalyticsEventPublisherImpl` into ServiceContainer OR remove publisher + Terraform topic  |
| D-2 | MEDIUM   | research-agent         | Add `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` to REQUIRED_ENV (resolved by D-1)                  |
| D-3 | MEDIUM   | docs                   | Regenerate `technical.md` for 6 services with correct topic names and endpoint paths            |
| D-4 | MEDIUM   | docs / whatsapp-service| Update technical.md: `publishExtractLinkPreviews` reuses `webhook-process` topic, not separate  |
| D-5 | LOW      | todos-agent            | Consider renaming `INTEXURAOS_TODOS_PROCESSING_TOPIC` → `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC` |
| D-6 | LOW      | infra                  | Consider renaming `snapshot-refresh-{env}` → `intexuraos-snapshot-refresh-{env}`               |
| D-7 | LOW      | bookmarks-agent        | Consider adding `_TOPIC` suffix to bookmark pub/sub env var names                               |

---

## Sources

| Source                                             | Purpose                                              |
| -------------------------------------------------- | ---------------------------------------------------- |
| `docs/services/*/technical.md` (23 files)         | Documented published/subscribed events per service   |
| `terraform/environments/dev/main.tf`               | Authoritative topic definitions, subscriptions, IAM  |
| `terraform/modules/pubsub-push/`                   | Module schema (topic + DLQ + push sub + IAM pattern) |
| `apps/*/src/infra/pubsub/*.ts`                     | Publisher implementations and topic wiring           |
| `apps/*/src/services.ts`                           | ServiceContainer wiring (publisher activation)       |
| `apps/*/src/index.ts`                              | REQUIRED_ENV declarations per service                |
