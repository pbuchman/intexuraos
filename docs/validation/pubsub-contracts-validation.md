# Pub/Sub Contracts Cross-Validation Report

**Generated:** 2026-02-08
**Branch:** development
**Methodology:** Documentation-first analysis, then code/Terraform validation

---

## Summary

| Metric                                  | Count |
| --------------------------------------- | ----- |
| Total unique Pub/Sub topics             | 14    |
| Topics with matching docs + code        | 12    |
| Discrepancies found (docs vs docs)      | 3     |
| Discrepancies found (docs vs code)      | 5     |
| Discrepancies found (code vs Terraform) | 1     |
| Stale/obsolete references               | 2     |

---

## Complete Topic Inventory

### All Topics (Terraform-defined)

| #   | Topic Name (Terraform)                      | Module                            | Push Endpoint                                                | Subscriber Service |
| --- | ------------------------------------------- | --------------------------------- | ------------------------------------------------------------ | ------------------ |
| 1   | `intexuraos-whatsapp-media-cleanup-{env}`   | `pubsub_media_cleanup`            | `whatsapp-service/internal/whatsapp/pubsub/media-cleanup`    | whatsapp-service   |
| 2   | `intexuraos-whatsapp-webhook-process-{env}` | `pubsub_whatsapp_webhook_process` | `whatsapp-service/internal/whatsapp/pubsub/process-webhook`  | whatsapp-service   |
| 3   | `intexuraos-whatsapp-transcription-{env}`   | `pubsub_whatsapp_transcription`   | `whatsapp-service/internal/whatsapp/pubsub/transcribe-audio` | whatsapp-service   |
| 4   | `intexuraos-commands-ingest-{env}`          | `pubsub_commands_ingest`          | `commands-agent/internal/commands`                           | commands-agent     |
| 5   | `intexuraos-actions-queue-{env}`            | `pubsub_actions_queue`            | `actions-agent/internal/actions/process`                     | actions-agent      |
| 6   | `intexuraos-research-process-{env}`         | `pubsub_research_process`         | `research-agent/internal/llm/pubsub/process-research`        | research-agent     |
| 7   | `intexuraos-llm-analytics-{env}`            | `pubsub_llm_analytics`            | `research-agent/internal/llm/pubsub/report-analytics`        | research-agent     |
| 8   | `intexuraos-llm-call-{env}`                 | `pubsub_llm_call`                 | `research-agent/internal/llm/pubsub/process-llm-call`        | research-agent     |
| 9   | `intexuraos-whatsapp-send-{env}`            | `pubsub_whatsapp_send`            | `whatsapp-service/internal/whatsapp/pubsub/send-message`     | whatsapp-service   |
| 10  | `intexuraos-approval-reply-{env}`           | `pubsub_approval_reply`           | `actions-agent/internal/actions/approval-reply`              | actions-agent      |
| 11  | `intexuraos-bookmark-enrich-{env}`          | `pubsub_bookmark_enrich`          | `bookmarks-agent/internal/bookmarks/pubsub/enrich`           | bookmarks-agent    |
| 12  | `intexuraos-bookmark-summarize-{env}`       | `pubsub_bookmark_summarize`       | `bookmarks-agent/internal/bookmarks/pubsub/summarize`        | bookmarks-agent    |
| 13  | `intexuraos-todos-processing-{env}`         | `pubsub_todos_processing`         | `todos-agent/internal/todos/pubsub/todos-processing`         | todos-agent        |
| 14  | `intexuraos-calendar-preview-{env}`         | `pubsub_calendar_preview`         | `calendar-agent/internal/calendar/generate-preview`          | calendar-agent     |

### Non-module Topics (standalone resources)

| Topic Name                          | Defined In                        | Purpose                                            |
| ----------------------------------- | --------------------------------- | -------------------------------------------------- |
| `intexuraos-code-log-cleanup-{env}` | `google_pubsub_topic.log_cleanup` | Cloud Scheduler triggers log cleanup in code-agent |

---

## Publisher-to-Subscriber Mapping

### Topic: `intexuraos-whatsapp-media-cleanup-{env}`

| Aspect         | Value                    |
| -------------- | ------------------------ |
| Event type     | `whatsapp.media.cleanup` |
| Publisher(s)   | whatsapp-service         |
| Subscriber     | whatsapp-service         |
| TF permissions | `whatsapp_service`       |
| Docs match     | YES                      |

### Topic: `intexuraos-whatsapp-webhook-process-{env}`

| Aspect         | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| Event types    | `whatsapp.webhook.process`, `whatsapp.linkpreview.extract` |
| Publisher(s)   | whatsapp-service                                           |
| Subscriber     | whatsapp-service                                           |
| TF permissions | `whatsapp_service`                                         |
| Docs match     | PARTIAL (see Discrepancy D1)                               |

### Topic: `intexuraos-whatsapp-transcription-{env}`

| Aspect         | Value                       |
| -------------- | --------------------------- |
| Event type     | `whatsapp.audio.transcribe` |
| Publisher(s)   | whatsapp-service            |
| Subscriber     | whatsapp-service            |
| TF permissions | `whatsapp_service`          |
| Docs match     | YES                         |

### Topic: `intexuraos-commands-ingest-{env}`

| Aspect         | Value              |
| -------------- | ------------------ |
| Event type     | `command.ingest`   |
| Publisher(s)   | whatsapp-service   |
| Subscriber     | commands-agent     |
| TF permissions | `whatsapp_service` |
| Docs match     | YES                |

### Topic: `intexuraos-actions-queue-{env}`

| Aspect         | Value                             |
| -------------- | --------------------------------- |
| Event type     | `action.created`                  |
| Publisher(s)   | commands-agent, actions-agent     |
| Subscriber     | actions-agent                     |
| TF permissions | `commands_agent`, `actions_agent` |
| Docs match     | YES                               |

### Topic: `intexuraos-research-process-{env}`

| Aspect         | Value              |
| -------------- | ------------------ |
| Event type     | `research.process` |
| Publisher(s)   | research-agent     |
| Subscriber     | research-agent     |
| TF permissions | `research_agent`   |
| Docs match     | YES                |

### Topic: `intexuraos-llm-analytics-{env}`

| Aspect         | Value                               |
| -------------- | ----------------------------------- |
| Event type     | `llm.report`                        |
| Publisher(s)   | research-agent (NOT WIRED - see D4) |
| Subscriber     | research-agent                      |
| TF permissions | `research_agent`                    |
| Docs match     | PARTIAL (see Discrepancy D4)        |

### Topic: `intexuraos-llm-call-{env}`

| Aspect         | Value            |
| -------------- | ---------------- |
| Event type     | `llm.call`       |
| Publisher(s)   | research-agent   |
| Subscriber     | research-agent   |
| TF permissions | `research_agent` |
| Docs match     | YES              |

### Topic: `intexuraos-whatsapp-send-{env}`

| Aspect         | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| Event type     | `whatsapp.message.send`                                    |
| Publisher(s)   | actions-agent, research-agent, bookmarks-agent, code-agent |
| Subscriber     | whatsapp-service                                           |
| TF permissions | `actions_agent`, `research_agent`, `bookmarks_agent`       |
| Docs match     | PARTIAL (see Discrepancy D5)                               |

### Topic: `intexuraos-approval-reply-{env}`

| Aspect         | Value                   |
| -------------- | ----------------------- |
| Event type     | `action.approval.reply` |
| Publisher(s)   | whatsapp-service        |
| Subscriber     | actions-agent           |
| TF permissions | `whatsapp_service`      |
| Docs match     | YES                     |

### Topic: `intexuraos-bookmark-enrich-{env}`

| Aspect         | Value              |
| -------------- | ------------------ |
| Event type     | `bookmarks.enrich` |
| Publisher(s)   | bookmarks-agent    |
| Subscriber     | bookmarks-agent    |
| TF permissions | `bookmarks_agent`  |
| Docs match     | YES                |

### Topic: `intexuraos-bookmark-summarize-{env}`

| Aspect         | Value                 |
| -------------- | --------------------- |
| Event type     | `bookmarks.summarize` |
| Publisher(s)   | bookmarks-agent       |
| Subscriber     | bookmarks-agent       |
| TF permissions | `bookmarks_agent`     |
| Docs match     | YES                   |

### Topic: `intexuraos-todos-processing-{env}`

| Aspect         | Value                      |
| -------------- | -------------------------- |
| Event type     | `todos.processing.created` |
| Publisher(s)   | todos-agent                |
| Subscriber     | todos-agent                |
| TF permissions | `todos_agent`              |
| Docs match     | YES                        |

### Topic: `intexuraos-calendar-preview-{env}`

| Aspect         | Value                       |
| -------------- | --------------------------- |
| Event type     | `calendar.preview.generate` |
| Publisher(s)   | actions-agent               |
| Subscriber     | calendar-agent              |
| TF permissions | `actions_agent`             |
| Docs match     | YES                         |

---

## Discrepancies

### D1: whatsapp-service docs claim separate `whatsapp-linkpreview` topic (DOCS vs CODE)

**Severity:** MEDIUM (documentation inaccuracy)

**In documentation** (`docs/services/whatsapp-service/technical.md`, line 248):

```
| whatsapp.linkpreview.extract | whatsapp-linkpreview | Link preview extraction |
```

The docs also list `INTEXURAOS_PUBSUB_WHATSAPP_LINKPREVIEW` as a required env var (line 317).

**In code** (`apps/whatsapp-service/src/infra/pubsub/publisher.ts`, line 92):

```typescript
// publishExtractLinkPreviews uses this.webhookProcessTopic
const result = await this.publishToTopic(
  this.webhookProcessTopic, // <-- NOT a separate topic
  event,
  { messageId: event.messageId },
  'extract link previews'
);
```

**In Terraform:** No `pubsub_whatsapp_linkpreview` module exists. No `INTEXURAOS_PUBSUB_WHATSAPP_LINKPREVIEW` env var is set.

**In code REQUIRED_ENV:** `INTEXURAOS_PUBSUB_WHATSAPP_LINKPREVIEW` is NOT in the `REQUIRED_ENV` array in `apps/whatsapp-service/src/index.ts`.

**Actual behavior:** The `whatsapp.linkpreview.extract` event is published to the SAME topic as `whatsapp.webhook.process` (the webhook process topic). The subscriber handler at `/internal/whatsapp/pubsub/process-webhook` routes based on the event `type` field.

**Fix needed:** Update `docs/services/whatsapp-service/technical.md`:

- Published Events table: change topic for `whatsapp.linkpreview.extract` from `whatsapp-linkpreview` to `whatsapp-webhook-process`
- Remove `INTEXURAOS_PUBSUB_WHATSAPP_LINKPREVIEW` from the Configuration env var table

---

### D2: pubsub-standards.md references non-existent services (DOCS vs DOCS)

**Severity:** LOW (stale documentation)

**In documentation** (`docs/architecture/pubsub-standards.md`, lines 100-101):

```
| INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC | llm-orchestrator | Research processing |
| INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC | commands-router  | Research actions    |
```

**Issues:**

1. `llm-orchestrator` is not a service. The `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` is used by `research-agent`.
2. `commands-router` is not a service. `INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC` does not exist in any current code or Terraform. It appears in archived continuity docs (`continuity/archive/023-user-approval-workflow/`) as a historical artifact.

**Fix needed:** Update the Environment Variables table in `docs/architecture/pubsub-standards.md`:

- Change `llm-orchestrator` to `research-agent` for `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC`
- Remove `INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC` / `commands-router` row entirely (this topic no longer exists)
- Add missing entries for topics not listed (see D3)

---

### D3: pubsub-standards.md env var table is incomplete (DOCS vs CODE)

**Severity:** LOW (incomplete documentation)

**In documentation** (`docs/architecture/pubsub-standards.md`, lines 94-101), the Environment Variables table lists 6 entries.

**Actually in use** (from code and Terraform):

| Variable                                   | Service(s)                    | Missing from table |
| ------------------------------------------ | ----------------------------- | ------------------ |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | commands-agent, actions-agent | YES                |
| `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`        | bookmarks-agent               | YES                |
| `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`     | bookmarks-agent               | YES                |
| `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | actions-agent                 | YES                |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | research-agent                | YES                |
| `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`    | research-agent                | YES                |
| `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`   | whatsapp-service              | YES                |
| `INTEXURAOS_TODOS_PROCESSING_TOPIC`        | todos-agent                   | YES                |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | whatsapp-service              | YES                |

**Note:** The `INTEXURAOS_TODOS_PROCESSING_TOPIC` env var does NOT follow the `INTEXURAOS_PUBSUB_*` prefix convention. All other Pub/Sub topic env vars use `INTEXURAOS_PUBSUB_*`.

**Fix needed:** Update `docs/architecture/pubsub-standards.md` Environment Variables table to include all 14+ topic env vars.

---

### D4: research-agent analytics publisher exists in code but is not wired (CODE inconsistency)

**Severity:** LOW (unused code, infrastructure provisioned but unused)

**Code exists:**

- `apps/research-agent/src/infra/pubsub/analyticsEventPublisher.ts` - Full publisher implementation
- `apps/research-agent/src/routes/internalRoutes.ts` - Subscription handler at `/internal/llm/pubsub/report-analytics`
- Tests exist for the handler

**But NOT wired:**

- `apps/research-agent/src/services.ts` does NOT import or instantiate the `AnalyticsEventPublisher`
- `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` is NOT in the `REQUIRED_ENV` array in `apps/research-agent/src/index.ts`
- The `ServiceContainer` interface does NOT include `analyticsEventPublisher`

**Terraform IS provisioned:**

- `module.pubsub_llm_analytics` exists with push endpoint to research-agent
- `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` IS set in Terraform env vars for research-agent

**Documentation says it exists:**

- `docs/services/research-agent/technical.md` lists `llm.report` as a published event type and `llm-analytics` as a subscribed topic

**Actual behavior:** The Terraform topic and subscription exist and are properly configured. The subscription handler endpoint exists and will accept messages. However, NO code path currently publishes to the `llm-analytics` topic because the publisher is not instantiated in the service container. The subscriber handler will never receive messages.

---

### D5: code-agent publishes to whatsapp-send topic but lacks Terraform IAM permission (CODE vs TERRAFORM)

**Severity:** HIGH (potential production permission error)

**In code** (`apps/code-agent/src/index.ts`, line 31):

```typescript
'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',  // required env var
```

**In code** (`apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`):
The `WhatsAppNotifierImpl` uses `WhatsAppSendPublisher` from `@intexuraos/infra-pubsub` to publish to the whatsapp-send topic.

**In Terraform** (`terraform/environments/dev/main.tf`, line 777-781):

```hcl
publisher_service_accounts = {
  actions_agent   = module.iam.service_accounts["actions_agent"]
  research_agent  = module.iam.service_accounts["research_agent"]
  bookmarks_agent = module.iam.service_accounts["bookmarks_agent"]
}
```

**Missing:** `code_agent` is NOT listed in `publisher_service_accounts` for the `pubsub_whatsapp_send` module.

**In Terraform** (`terraform/environments/dev/main.tf`, line 1414):

```hcl
INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC = "intexuraos-whatsapp-send-${var.environment}"
```

The env var IS set for code-agent, but the service account lacks publish permission.

**Impact:** In production, the code-agent's attempt to publish WhatsApp notifications will fail with `PERMISSION_DENIED`. This affects task start/complete/fail notifications sent via WhatsApp for code tasks.

**Fix needed:** Add `code_agent` to the `publisher_service_accounts` map in `module "pubsub_whatsapp_send"`.

---

### D6: whatsapp-service docs env var naming mismatch (DOCS vs CODE)

**Severity:** LOW (documentation inaccuracy)

**In documentation** (`docs/services/whatsapp-service/technical.md`, lines 314-319):

```
| INTEXURAOS_PUBSUB_WHATSAPP_WEBHOOK_PROCESS  | webhook processing       |
| INTEXURAOS_PUBSUB_WHATSAPP_AUDIO_TRANSCRIBE | audio transcription      |
| INTEXURAOS_PUBSUB_COMMAND_INGEST            | command ingest           |
| INTEXURAOS_PUBSUB_ACTION_APPROVAL_REPLY     | approval reply           |
```

**In code** (`apps/whatsapp-service/src/index.ts`, REQUIRED_ENV array):

```
INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC    (not WHATSAPP_WEBHOOK_PROCESS)
INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC      (not WHATSAPP_AUDIO_TRANSCRIBE)
INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC    (not COMMAND_INGEST)
INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC     (not ACTION_APPROVAL_REPLY)
```

**Fix needed:** Update the Configuration table in `docs/services/whatsapp-service/technical.md` to match actual env var names.

---

### D7: whatsapp-service docs list missing `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` subscription (DOCS inconsistency)

**Severity:** LOW (documentation omission)

**In documentation** (`docs/services/whatsapp-service/technical.md`), the "Subscribed Events" table lists:

```
| whatsapp.message.send     | /internal/whatsapp/pubsub/send-message     |
```

But this event type is `whatsapp.message.send`, while the `SendMessageEvent` in code uses the type `whatsapp.message.send`. This is correct.

However, the service also subscribes to its own `whatsapp-webhook-process` topic for both `whatsapp.webhook.process` AND `whatsapp.linkpreview.extract` events. The docs only list `whatsapp.webhook.process` in the subscribed events table but not the link preview routing.

---

## Services with No Pub/Sub (Confirmed)

The following services correctly document having NO Pub/Sub involvement:

| Service       | Docs confirm no Pub/Sub  | Code confirms no Pub/Sub |
| ------------- | ------------------------ | ------------------------ |
| chat-agent    | YES (explicit)           | YES                      |
| web-agent     | N/A (no Pub/Sub section) | YES (HTTP-only service)  |
| image-service | N/A (no Pub/Sub section) | YES (HTTP-only service)  |

---

## Cross-Service Event Flow Validation

### Flow 1: WhatsApp Message to Action Processing

```
User -> WhatsApp API -> whatsapp-service
  -> [webhook-process topic] -> whatsapp-service (async processing)
  -> [commands-ingest topic] -> commands-agent (classification)
  -> [actions-queue topic] -> actions-agent (action handling)
  -> [whatsapp-send topic] -> whatsapp-service (notification)
```

**Status:** CONSISTENT across docs, code, and Terraform.

### Flow 2: Research Processing

```
actions-agent -> research-agent (HTTP: POST /internal/research/draft)
research-agent
  -> [research-process topic] -> research-agent (self-subscribe for processing)
  -> [llm-call topic] -> research-agent (self-subscribe for individual LLM calls)
  -> [whatsapp-send topic] -> whatsapp-service (completion notification)
```

**Status:** CONSISTENT. Note: research-agent self-publishes and self-subscribes for both topics.

### Flow 3: Bookmark Enrichment Pipeline

```
actions-agent -> bookmarks-agent (HTTP: POST /internal/bookmarks)
bookmarks-agent
  -> [bookmark-enrich topic] -> bookmarks-agent (OG metadata fetch)
  -> [bookmark-summarize topic] -> bookmarks-agent (AI summary)
  -> [whatsapp-send topic] -> whatsapp-service (summary delivery)
```

**Status:** CONSISTENT across docs, code, and Terraform.

### Flow 4: Approval Reply Flow

```
User -> WhatsApp API -> whatsapp-service
  -> [approval-reply topic] -> actions-agent (process approval)
  -> [actions-queue topic] -> actions-agent (re-process approved action)
```

**Status:** CONSISTENT across docs, code, and Terraform.

### Flow 5: Calendar Preview Generation

```
actions-agent
  -> [calendar-preview topic] -> calendar-agent (generate preview)
```

**Status:** CONSISTENT across docs, code, and Terraform.

### Flow 6: Todo Processing

```
todos-agent
  -> [todos-processing topic] -> todos-agent (AI item extraction)
```

**Status:** CONSISTENT. Note: env var uses `INTEXURAOS_TODOS_PROCESSING_TOPIC` (without `PUBSUB_` prefix), which deviates from the naming convention.

### Flow 7: Code Agent WhatsApp Notifications

```
code-agent
  -> [whatsapp-send topic] -> whatsapp-service (task notifications)
```

**Status:** BROKEN IN TERRAFORM - code-agent lacks IAM publish permission (see D5).

---

## Naming Convention Audit

### Env Var Naming Convention: `INTEXURAOS_PUBSUB_*`

| Env Var                                    | Service          | Follows Convention                 |
| ------------------------------------------ | ---------------- | ---------------------------------- |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`    | whatsapp-service | YES                                |
| `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`  | whatsapp-service | YES                                |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`  | whatsapp-service | YES                                |
| `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`    | whatsapp-service | YES                                |
| `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`   | whatsapp-service | YES                                |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | multiple         | YES                                |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | commands/actions | YES                                |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | research-agent   | YES                                |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | research-agent   | YES                                |
| `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`    | research-agent   | YES                                |
| `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`        | bookmarks-agent  | YES                                |
| `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`     | bookmarks-agent  | YES                                |
| `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | actions-agent    | YES                                |
| **`INTEXURAOS_TODOS_PROCESSING_TOPIC`**    | todos-agent      | **NO** (missing `PUBSUB_` segment) |

---

## Action Items

### Critical (Production Impact)

| #   | Issue                                                              | File(s) to Fix                                                                                               |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | D5: code-agent lacks IAM publish permission on whatsapp-send topic | `terraform/environments/dev/main.tf` (add `code_agent` to `pubsub_whatsapp_send.publisher_service_accounts`) |

### Documentation Fixes

| #   | Issue                                                       | File(s) to Fix                                |
| --- | ----------------------------------------------------------- | --------------------------------------------- |
| 2   | D1: linkpreview topic does not exist as separate topic      | `docs/services/whatsapp-service/technical.md` |
| 3   | D2: stale service names in pubsub-standards                 | `docs/architecture/pubsub-standards.md`       |
| 4   | D3: incomplete env var table in pubsub-standards            | `docs/architecture/pubsub-standards.md`       |
| 5   | D6: env var names wrong in whatsapp-service docs            | `docs/services/whatsapp-service/technical.md` |
| 6   | D7: missing linkpreview routing detail in subscribed events | `docs/services/whatsapp-service/technical.md` |

### Code Cleanup (Low Priority)

| #   | Issue                                                             | File(s)                                                                                                                    |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 7   | D4: analytics publisher exists but not wired in service container | `apps/research-agent/src/services.ts`, `apps/research-agent/src/infra/pubsub/analyticsEventPublisher.ts`                   |
| 8   | todos-agent uses non-standard env var name                        | `apps/todos-agent/src/index.ts` (`INTEXURAOS_TODOS_PROCESSING_TOPIC` should be `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC`) |
