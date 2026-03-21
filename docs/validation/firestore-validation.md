# Firestore Collection Ownership Validation Report

**Generated:** 2026-03-16
**Previous run:** 2026-02-19 (ENHANCED)
**Methodology:** Cross-validation of `firestore-collections.json` registry against actual source code in `apps/*/src/infra/firestore/**/*.ts`, `packages/*/src/**/*.ts`, and `workers/*/src/**/*.ts`. Includes delta analysis of all registry changes since the previous report.

---

## 1. Master Collection Inventory

| #   | Collection                       | Registry Owner               | Code Location                                    | Status |
| --- | -------------------------------- | ---------------------------- | ------------------------------------------------ | ------ |
| 1   | `_migrations`                    | system                       | `scripts/migrate.mjs`                            | OK     |
| 2   | `actions`                        | actions-agent                | `apps/actions-agent/src/infra/firestore/`        | OK     |
| 3   | `actions_transitions`            | actions-agent                | `apps/actions-agent/src/infra/firestore/`        | OK     |
| 4   | `approval_messages`              | actions-agent                | `apps/actions-agent/src/infra/firestore/`        | OK     |
| 5   | `auth_tokens`                    | user-service                 | `apps/user-service/src/infra/firestore/`         | OK     |
| 6   | `bookmarks`                      | bookmarks-agent              | `apps/bookmarks-agent/src/infra/firestore/`      | OK     |
| 7   | `calendar_failed_events`         | calendar-agent               | `apps/calendar-agent/src/infra/firestore/`       | OK     |
| 8   | `calendar_previews`              | calendar-agent               | `apps/calendar-agent/src/infra/firestore/`       | OK     |
| 9   | `calendar_processed_actions`     | calendar-agent               | `apps/calendar-agent/src/infra/firestore/`       | OK     |
| 10  | `code_tasks`                     | code-agent                   | `apps/code-agent/src/infra/repositories/`        | OK     |
| 11  | `code_worker_settings`           | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 12  | `commands`                       | commands-agent               | `apps/commands-agent/src/infra/firestore/`       | OK     |
| 13  | `composite_feed_snapshots`       | data-insights-agent          | `apps/data-insights-agent/src/infra/firestore/`  | OK     |
| 14  | `composite_feeds`                | data-insights-agent          | `apps/data-insights-agent/src/infra/firestore/`  | OK     |
| 15  | `custom_data_sources`            | data-insights-agent          | `apps/data-insights-agent/src/infra/firestore/`  | OK     |
| 16  | `dispatch_retries`               | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 17  | `doc_embeddings`                 | chat-agent                   | `apps/chat-agent/src/infra/firestore/`           | OK     |
| 18  | `event_decisions`                | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 19  | `generated_images`               | image-service                | `apps/image-service/src/infra/firestore/`        | OK     |
| 20  | `github-event-log-entries`       | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 21  | `github-pr-events`               | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 22  | `github-pr-summaries`            | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 23  | `github-webhook-audit-events`    | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 24  | `linear_connections`             | linear-agent                 | `apps/linear-agent/src/infra/firestore/`         | OK     |
| 25  | `linear_failed_issues`           | linear-agent                 | `apps/linear-agent/src/infra/firestore/`         | OK     |
| 26  | `linear_issue_comments`          | linear-agent                 | `apps/linear-agent/src/infra/firestore/`         | OK     |
| 27  | `linear_issues`                  | linear-agent                 | `apps/linear-agent/src/infra/firestore/`         | OK     |
| 28  | `linear_processed_actions`       | linear-agent                 | `apps/linear-agent/src/infra/firestore/`         | OK     |
| 29  | `llm_api_logs`                   | research-agent               | `packages/llm-audit/src/`                        | NOTE   |
| 30  | `llm_usage_stats`                | llm-pricing                  | `packages/llm-pricing/src/`                      | NOTE   |
| 31  | `mobile_notification_signatures` | mobile-notifications-service | `apps/mobile-notifications-service/src/infra/`   | OK     |
| 32  | `mobile_notifications`           | mobile-notifications-service | `apps/mobile-notifications-service/src/infra/`   | OK     |
| 33  | `mobile_notifications_filters`   | mobile-notifications-service | `apps/mobile-notifications-service/src/infra/`   | OK     |
| 34  | `notes`                          | notes-agent                  | `apps/notes-agent/src/infra/firestore/`          | OK     |
| 35  | `notion_connections`             | notion-service               | `apps/notion-service/src/infra/firestore/`       | OK     |
| 36  | `oauth_connections`              | user-service                 | `apps/user-service/src/infra/firestore/`         | OK     |
| 37  | `pr_automation_comments`         | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 38  | `pr_task_locks`                  | code-agent                   | `apps/code-agent/src/domain/utils/prTaskLock.ts` | NOTE   |
| 39  | `research_export_settings`       | research-agent               | `apps/research-agent/src/infra/firestore/`       | OK     |
| 40  | `researches`                     | research-agent               | `apps/research-agent/src/infra/research/`        | OK     |
| 41  | `settings`                       | app-settings-service         | `apps/app-settings-service/src/infra/firestore/` | OK     |
| 42  | `todos`                          | todos-agent                  | `apps/todos-agent/src/infra/firestore/`          | OK     |
| 43  | `user_settings`                  | user-service                 | `apps/user-service/src/infra/firestore/`         | OK     |
| 44  | `user_spend`                     | code-agent                   | No repository found                              | WARN   |
| 45  | `user_usage`                     | code-agent                   | `apps/code-agent/src/infra/firestore/`           | OK     |
| 46  | `visualizations`                 | data-insights-agent          | `apps/data-insights-agent/src/infra/firestore/`  | OK     |
| 47  | `whatsapp_messages`              | whatsapp-service             | `apps/whatsapp-service/src/infra/firestore/`     | OK     |
| 48  | `whatsapp_outbound_messages`     | whatsapp-service             | `apps/whatsapp-service/src/infra/firestore/`     | OK     |
| 49  | `whatsapp_phone_verifications`   | whatsapp-service             | `apps/whatsapp-service/src/infra/firestore/`     | OK     |
| 50  | `whatsapp_user_mappings`         | whatsapp-service             | `apps/whatsapp-service/src/infra/firestore/`     | OK     |
| 51  | `whatsapp_webhook_events`        | whatsapp-service             | `apps/whatsapp-service/src/infra/firestore/`     | OK     |

**Total: 51 collections** (46 in registry + `_migrations` system entry = 47 registry entries; 4 have notes, 1 has a warning).

---

## 2. Delta Since Previous Report (2026-02-19)

Five new collections were added to `firestore-collections.json` after the previous report, all owned by `code-agent` and all confirmed implemented in code:

| Collection                    | Commit      | Linear Issue | Repository File                                                            |
| ----------------------------- | ----------- | ------------ | -------------------------------------------------------------------------- |
| `dispatch_retries`            | `269c7b29`  | —            | `apps/code-agent/src/infra/firestore/dispatchRetryRepository.ts`           |
| `event_decisions`             | `04cdefccf` | INT-744      | `apps/code-agent/src/infra/firestore/eventDecisionRepository.ts`           |
| `github-webhook-audit-events` | `2284f068f` | INT-831      | `apps/code-agent/src/infra/firestore/gitHubWebhookAuditEventRepository.ts` |
| `github-event-log-entries`    | `2284f068f` | INT-831      | `apps/code-agent/src/infra/firestore/gitHubEventLogEntryRepository.ts`     |
| `pr_automation_comments`      | `84e8d051a` | INT-852      | `apps/code-agent/src/infra/firestore/prAutomationCommentRepository.ts`     |

Additionally, commit `be0eaa8be` added `subcollections: ["logs", "log_lines", "turn_metrics"]` to the `code_tasks` registry entry.

**All new entries are properly registered and implemented. No gaps.**

---

## 3. Ownership Conflict Analysis

**Result: No ownership conflicts found.**

Each collection in `firestore-collections.json` has exactly one owner. No two services access the same Firestore collection directly.

---

## 4. Cross-Service Direct Firestore Access

**Result: No violations found.**

All production Firestore collection access is within the owning service's `src/infra/` directory. Cross-service data access follows the HTTP pattern (`/internal/{service}/{resource}` with `X-Internal-Auth`).

The one apparent exception is `app-settings-service` reading `llm_usage_stats` via `collectionGroup('by_user')` — this is addressed in section 7.

---

## 5. Collections in Registry But Not Found in Production Code

### 5a. `user_spend` — Orphaned Domain Model

**Registry:** `user_spend` (owner: `code-agent`, description: "User cost tracking for rate limiting")

**Code investigation:**

| Location                                         | Finding                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/models/userSpend.ts` | Domain model interface defined; doc comment says `Collection: user_spend` |
| `apps/code-agent/src/infra/`                     | No repository file (`*spend*` files: none found)                          |
| `apps/code-agent/src/`                           | No use cases reference `UserSpend` or `user_spend` collection name        |

**Interpretation:** The repository was never implemented. The `user_usage` collection (fully implemented at `apps/code-agent/src/infra/firestore/userUsageFirestoreRepository.ts`) supersedes it for rate-limiting purposes. `user_spend` is a deprecated design artifact — the domain model exists with a design reference note ("Lines 2616-2671") but no actual data is being written to this collection.

**Status: OPEN — unchanged from previous report.**

**Recommended action:** Remove `user_spend` from `firestore-collections.json` and delete `apps/code-agent/src/domain/models/userSpend.ts`.

**Severity:** MEDIUM

---

## 6. Collections in Code But Not in Registry

### 6a. `log_entries` subcollection in `code_tasks`

**File:** `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:645`

```typescript
const logEntriesRef = taskRef.collection('log_entries');
```

The registry defines `code_tasks.subcollections` as `["logs", "log_lines", "turn_metrics"]`. The subcollection `log_entries` is accessed in the `deleteTask` cleanup path but is absent from the registry subcollection list.

**Context:** This is a legacy cleanup-only read path. No write code creating `log_entries` documents exists anywhere in the codebase. The code reads and deletes any existing `log_entries` documents for backward compatibility during task deletion. No active writes produce this subcollection.

**Status: OPEN — unchanged from previous report.**

**Recommended action:** Either add `"log_entries"` to `code_tasks.subcollections` in the registry for documentation completeness, or add a code comment explaining this is a one-off legacy cleanup path.

**Severity:** LOW

---

## 7. Architectural Notes (Package-Owned Collections)

Two registry entries assign ownership to packages rather than apps. This is architecturally coherent but deviates from the registry schema constraint that "Owner must match an existing service directory: `apps/<owner>/`".

### 7a. `llm_api_logs` — Owned by `research-agent`, written by `packages/llm-audit`

**Registry owner:** `research-agent`

**Actual writer:** `packages/llm-audit/src/sink.ts` (`FirestoreAuditSink` class, `COLLECTION_NAME = 'llm_api_logs'`).

**Services using `llm-audit`:** `packages/llm-factory`, `packages/infra-perplexity`, `packages/infra-gemini`, `packages/infra-claude`, `packages/infra-gpt`, `workers/orchestrator`, `apps/image-service` — meaning any service using these packages may write to `llm_api_logs`, not just `research-agent`.

**Issue:** The registry attributes ownership to `research-agent`, but `llm_api_logs` is written by a shared infrastructure package used across many services. The `research-agent` attribution is a legacy simplification.

**Severity:** LOW (no runtime violation; data integrity is maintained)

### 7b. `llm_usage_stats` — Owned by `llm-pricing` (a package, not an app)

**Registry owner:** `llm-pricing`

**Writer:** `packages/llm-pricing/src/usageLogger.ts` (`COLLECTION_NAME = 'llm_usage_stats'`). Used by 12 apps (all that depend on `@intexuraos/llm-pricing`).

**Reader:** `apps/app-settings-service/src/infra/firestore/usageStatsRepository.ts` — reads via `db.collectionGroup('by_user')`. This is a direct Firestore read from a collection not owned by `app-settings-service` per the registry.

**Assessment:** The `app-settings-service` cross-collection-group read is the only case in the codebase where a service reads a collection it doesn't own via direct Firestore access (rather than HTTP). It is read-only and uses a collection group query, not direct document writes. This is an intentional architectural trade-off documented in the previous report.

**Severity:** LOW (intentional, read-only, well-documented)

---

## 8. `pr_task_locks` — Non-Standard Access Pattern

**Registry:** `pr_task_locks` (owner: `code-agent`)

**Code location:** `apps/code-agent/src/domain/utils/prTaskLock.ts` — uses `firestore.doc(lockDocPath).delete()` (direct document reference, not via a repository class in `src/infra/firestore/`).

**Issue:** The collection is accessed from the domain layer (`src/domain/utils/`) rather than the infra layer (`src/infra/firestore/`). The validation script scans `src/infra/firestore/**/*.ts` and would not detect this collection reference, making the automated ownership check blind to it.

**Ownership is correct** (code-agent accesses its own collection). The deviation is structural, not a data integrity issue.

**Severity:** LOW (structural deviation; validation script coverage gap)

---

## 9. Legacy Migration Collection Names

Migrations reference several collection names not in the current registry. These are expected for historical migrations operating on data that predates or was renamed before the current registry:

| Migration Collection Name        | Status                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `app_settings`                   | Deprecated — replaced by `settings`. Migration `027_delete_app_settings.mjs` deletes it.                                |
| `users`                          | Never in registry — migrations reference for data backfills (e.g., `025_default_llm_model.mjs`).                        |
| `worker_settings`                | Old name — renamed to `code_worker_settings`. Migration `053_remove-github-username-from-worker-settings.mjs` reads it. |
| `settings/llm_pricing/providers` | Subcollection path of `settings` — architecturally correct (owned by `app-settings-service`).                           |

No action needed. Migrations are immutable by policy and these names reflect the historical state at migration time.

---

## 10. Summary of Findings

### Passing

- No ownership conflicts (each collection has exactly one owner)
- No cross-service direct Firestore write violations
- All 5 collections added since the previous report are properly registered and implemented
- All collections in the registry with non-NOTE/non-WARN status have confirmed repository implementations

### Open Warnings

| #   | Collection / Issue                                                            | Severity | Status                            |
| --- | ----------------------------------------------------------------------------- | -------- | --------------------------------- |
| 5a  | `user_spend` in registry with no repository implementation                    | MEDIUM   | Open (unchanged since 2026-02-19) |
| 6a  | `log_entries` subcollection accessed in cleanup code but absent from registry | LOW      | Open (unchanged since 2026-02-19) |

### Architectural Notes (No Action Required)

| #   | Issue                                                                                                      | Severity |
| --- | ---------------------------------------------------------------------------------------------------------- | -------- |
| 7a  | `llm_api_logs` registry owner (`research-agent`) does not match actual writer (`packages/llm-audit`)       | LOW      |
| 7b  | `llm_usage_stats` owner is `llm-pricing` (a package, not an app); `app-settings-service` reads it directly | LOW      |
| 8   | `pr_task_locks` accessed from domain layer, outside `src/infra/firestore/` — validation script blind spot  | LOW      |

### Previously Reported Items (Resolved)

| #     | Issue                                                                             | Resolution       |
| ----- | --------------------------------------------------------------------------------- | ---------------- |
| 4a–4d | Documentation naming errors in 4 service docs                                     | Fixed 2026-02-19 |
| 10a   | Stale `dataSource` / `compositeFeeds` entries in `firestore.indexes.json`         | Fixed 2026-02-19 |
| 6b    | `github-pr-summaries` and `linear_issue_comments` missing from previous inventory | Fixed 2026-02-19 |
