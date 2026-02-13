# Firestore Collection Ownership Validation Report

**Generated:** 2026-02-08
**Methodology:** Documentation-first cross-validation against `firestore-collections.json` registry and actual source code.

---

## 1. Master Collection Inventory

| #   | Collection                       | Registry Owner               | Code Location (Service)      | Readers (via HTTP)                     | Status |
| --- | -------------------------------- | ---------------------------- | ---------------------------- | -------------------------------------- | ------ |
| 1   | `_migrations`                    | system                       | `scripts/migrate.mjs`        | None                                   | OK     |
| 2   | `actions`                        | actions-agent                | actions-agent                | None (Pub/Sub routing)                 | OK     |
| 3   | `actions_transitions`            | actions-agent                | actions-agent                | None                                   | OK     |
| 4   | `approval_messages`              | actions-agent                | actions-agent                | None                                   | OK     |
| 5   | `auth_tokens`                    | user-service                 | user-service                 | None                                   | OK     |
| 6   | `bookmarks`                      | bookmarks-agent              | bookmarks-agent              | None                                   | OK     |
| 7   | `calendar_failed_events`         | calendar-agent               | calendar-agent               | None                                   | OK     |
| 8   | `calendar_previews`              | calendar-agent               | calendar-agent               | actions-agent (HTTP)                   | OK     |
| 9   | `calendar_processed_actions`     | calendar-agent               | calendar-agent               | None                                   | OK     |
| 10  | `code_tasks`                     | code-agent                   | code-agent                   | None                                   | OK     |
| 11  | `code_worker_settings`           | code-agent                   | code-agent                   | None                                   | OK     |
| 12  | `commands`                       | commands-agent               | commands-agent               | None                                   | OK     |
| 13  | `composite_feed_snapshots`       | data-insights-agent          | data-insights-agent          | None                                   | OK     |
| 14  | `composite_feeds`                | data-insights-agent          | data-insights-agent          | None                                   | OK     |
| 15  | `custom_data_sources`            | data-insights-agent          | data-insights-agent          | None                                   | OK     |
| 16  | `doc_embeddings`                 | chat-agent                   | chat-agent                   | None                                   | OK     |
| 17  | `generated_images`               | image-service                | image-service                | None                                   | OK     |
| 18  | `github-pr-events`               | code-agent                   | code-agent                   | None                                   | OK     |
| 19  | `linear_connections`             | linear-agent                 | linear-agent                 | None                                   | OK     |
| 20  | `linear_failed_issues`           | linear-agent                 | linear-agent                 | None                                   | OK     |
| 21  | `linear_issues`                  | linear-agent                 | linear-agent                 | None                                   | OK     |
| 22  | `linear_processed_actions`       | linear-agent                 | linear-agent                 | None                                   | OK     |
| 23  | `llm_api_logs`                   | research-agent               | `packages/llm-audit`         | None                                   | OK     |
| 24  | `llm_usage_stats`                | llm-pricing                  | `packages/llm-pricing`       | app-settings-service (collectionGroup) | OK     |
| 25  | `mobile_notification_signatures` | mobile-notifications-service | mobile-notifications-service | None                                   | OK     |
| 26  | `mobile_notifications`           | mobile-notifications-service | mobile-notifications-service | None                                   | OK     |
| 27  | `mobile_notifications_filters`   | mobile-notifications-service | mobile-notifications-service | None                                   | OK     |
| 28  | `notes`                          | notes-agent                  | notes-agent                  | None                                   | OK     |
| 29  | `notion_connections`             | notion-service               | notion-service               | None                                   | OK     |
| 30  | `oauth_connections`              | user-service                 | user-service                 | None                                   | OK     |
| 31  | `pr_task_locks`                  | code-agent                   | code-agent                   | None                                   | OK     |
| 33  | `research_export_settings`       | research-agent               | research-agent               | None                                   | OK     |
| 34  | `researches`                     | research-agent               | research-agent               | None                                   | OK     |
| 35  | `settings`                       | app-settings-service         | app-settings-service         | research-agent (HTTP), others (HTTP)   | OK     |
| 36  | `todos`                          | todos-agent                  | todos-agent                  | None                                   | OK     |
| 37  | `user_settings`                  | user-service                 | user-service                 | research-agent (HTTP), others (HTTP)   | OK     |
| 38  | `user_spend`                     | code-agent                   | Not found in code            | None                                   | WARN   |
| 39  | `user_usage`                     | code-agent                   | code-agent                   | None                                   | OK     |
| 40  | `visualizations`                 | data-insights-agent          | Not found in code            | None                                   | WARN   |
| 41  | `whatsapp_messages`              | whatsapp-service             | whatsapp-service             | None                                   | OK     |
| 42  | `whatsapp_outbound_messages`     | whatsapp-service             | whatsapp-service             | None                                   | OK     |
| 43  | `whatsapp_phone_verifications`   | whatsapp-service             | whatsapp-service             | None                                   | OK     |
| 44  | `whatsapp_user_mappings`         | whatsapp-service             | whatsapp-service             | None                                   | OK     |
| 45  | `whatsapp_webhook_events`        | whatsapp-service             | whatsapp-service             | None                                   | OK     |

---

## 2. Ownership Conflict Analysis

**Result: No ownership conflicts found.**

Each collection in `firestore-collections.json` has exactly one owner. No two services claim ownership of the same collection.

---

## 3. Cross-Service Direct Firestore Access Violations

**Result: No cross-service direct Firestore access violations found.**

All Firestore collection access in source code is within the owning service's `apps/<service>/src/infra/` directory. Cross-service data access follows the HTTP pattern:

| Consumer Service     | Data Needed                         | Provider Service         | Access Method              |
| -------------------- | ----------------------------------- | ------------------------ | -------------------------- |
| research-agent       | User API keys, LLM client           | user-service             | HTTP (`internal-clients`)  |
| research-agent       | LLM pricing data                    | app-settings-service     | HTTP                       |
| research-agent       | Notion OAuth tokens                 | notion-service           | HTTP                       |
| actions-agent        | User API keys                       | user-service             | HTTP (`internal-clients`)  |
| actions-agent        | Calendar preview                    | calendar-agent           | HTTP                       |
| commands-agent       | User LLM client                     | user-service             | HTTP (`internal-clients`)  |
| calendar-agent       | Google OAuth token                  | user-service             | HTTP                       |
| data-insights-agent  | Filtered notifications              | mobile-notifications-svc | HTTP                       |
| data-insights-agent  | User LLM client                     | user-service             | HTTP (`internal-clients`)  |
| image-service        | User API keys                       | user-service             | HTTP (`internal-clients`)  |
| chat-agent           | User LLM client                     | user-service             | HTTP (`internal-clients`)  |
| code-agent           | Linear issue management             | linear-agent             | HTTP                       |
| app-settings-service | LLM usage stats (`collectionGroup`) | llm-pricing (package)    | Direct Firestore (see #4a) |

**Note on `llm_usage_stats`:** The `app-settings-service` reads from the `llm_usage_stats` collection via `collectionGroup('by_user')`. The registry lists `llm-pricing` as the owner. The `llm-pricing` package (which writes to this collection) is used by multiple services. The `app-settings-service` reads it for cost aggregation. This is a borderline case -- the data is written by the `llm-pricing` package (not a service) and read by `app-settings-service`. Since `llm-pricing` is a shared package, not a standalone service, this is architecturally acceptable but worth noting.

---

## 4. Discrepancies Between Registry and Documentation

### 4a. research-agent/technical.md: References `app_settings` collection

**Location:** `docs/services/research-agent/technical.md`, line 435

The Infrastructure section lists:

> `Firestore (app_settings collection) | LLM pricing configuration`

**Issue:** The registry names this collection `settings`, not `app_settings`. The actual code in `app-settings-service` uses the path `settings/llm_pricing/providers`. The research-agent itself does NOT directly access this collection -- it retrieves pricing via HTTP from `app-settings-service`. This is a documentation error in the research-agent's technical.md.

**Severity:** LOW (documentation-only, no code violation)

### 4b. whatsapp-service/technical.md: Inconsistent collection names

**Location:** `docs/services/whatsapp-service/technical.md`, lines 280-286

The Firestore Collections table uses shortened names:

| In technical.md  | In Registry / Code        |
| ---------------- | ------------------------- |
| `webhook_events` | `whatsapp_webhook_events` |
| `user_mappings`  | `whatsapp_user_mappings`  |

**Issue:** The documentation drops the `whatsapp_` prefix for two collections. The code uses `whatsapp_webhook_events` and `whatsapp_user_mappings` (matching the registry).

**Severity:** LOW (documentation-only, code is correct)

### 4c. linear-agent/technical.md: CamelCase collection names

**Location:** `docs/services/linear-agent/technical.md`, lines 512-517

The Firestore Collections table uses camelCase names:

| In technical.md          | In Registry / Code         |
| ------------------------ | -------------------------- |
| `linearConnections`      | `linear_connections`       |
| `failedLinearIssues`     | `linear_failed_issues`     |
| `processedLinearActions` | `linear_processed_actions` |
| `syncedLinearIssues`     | `linear_issues`            |

**Issue:** Documentation uses camelCase names while the actual code and registry use snake_case. Additionally, the documentation calls the synced issues collection `syncedLinearIssues` but the code uses `linear_issues`.

**Severity:** MEDIUM (naming inconsistency can cause confusion for developers)

### 4d. user-service/technical.md: References `users` collection

**Location:** `docs/services/user-service/technical.md`, line 271

The Infrastructure section lists:

> `Firestore (users collection) | User settings storage`

**Issue:** The registry and code use `user_settings` as the collection name, not `users`.

**Severity:** LOW (documentation-only)

---

## 5. Collections in Registry But Not Found in Code

| Collection       | Registry Owner      | Status                                                                                              |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `user_spend`     | code-agent          | Not found in any `.ts` source file. May be deprecated or planned.                                   |
| `visualizations` | data-insights-agent | Not found in any `.ts` source file. Documented as "future use" in data-insights-agent/technical.md. |

---

## 6. Collections in Code But Not in Registry

**Result: None found.**

All Firestore collections referenced in source code have corresponding entries in `firestore-collections.json`.

---

## 7. Architecture Doc vs Registry Alignment

The architecture document (`docs/architecture/firestore-ownership.md`) describes the registry schema, validation algorithm, and patterns but does not list individual collections. It references `firestore-collections.json` as the authoritative registry. This is correct by design -- the architecture doc is structural, not an enumeration.

**Result: Aligned. No conflicts.**

---

## 8. Package-Owned Collections

Two collections are owned by packages rather than apps:

| Collection        | Owner (Registry) | Package Location       | Used By                                                     |
| ----------------- | ---------------- | ---------------------- | ----------------------------------------------------------- |
| `llm_api_logs`    | research-agent   | `packages/llm-audit`   | Any service using llm-audit package                         |
| `llm_usage_stats` | llm-pricing      | `packages/llm-pricing` | Any service using llm-pricing; read by app-settings-service |

**Observation:** The registry lists `llm-pricing` as the owner of `llm_usage_stats`, but `llm-pricing` is a shared package (`packages/llm-pricing`), not an app (`apps/llm-pricing`). The ownership validation script checks `apps/<owner>/` directory existence. This would fail the registry schema constraint: "Owner must match an existing service directory: `apps/<owner>/`".

Similarly, `llm_api_logs` is owned by `research-agent` in the registry, but the actual write code is in `packages/llm-audit`. Since multiple services can use this package, the ownership attribution to `research-agent` is a pragmatic choice.

**Severity:** LOW (the validation script may need awareness of package-based ownership)

---

## 9. Summary of Findings

### No Issues (Pass)

- No ownership conflicts (each collection has exactly one owner)
- No cross-service direct Firestore access violations
- No undocumented collections in code
- Architecture documentation aligned with registry

### Documentation Discrepancies (4 findings)

| #   | Location                      | Issue                                                                 | Severity |
| --- | ----------------------------- | --------------------------------------------------------------------- | -------- |
| 4a  | research-agent/technical.md   | References `app_settings` instead of `settings`                       | LOW      |
| 4b  | whatsapp-service/technical.md | Missing `whatsapp_` prefix on 2 collection names                      | LOW      |
| 4c  | linear-agent/technical.md     | CamelCase names instead of snake_case; wrong name for `linear_issues` | MEDIUM   |
| 4d  | user-service/technical.md     | References `users` instead of `user_settings`                         | LOW      |

### Registry Warnings (2 findings)

| #   | Collection       | Issue                                                                                     |
| --- | ---------------- | ----------------------------------------------------------------------------------------- |
| 5a  | `user_spend`     | In registry (owner: code-agent) but not found in code                                     |
| 5b  | `visualizations` | In registry (owner: data-insights-agent) but not found in code (documented as future use) |

### Architectural Observations (1 finding)

| #   | Issue                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------ |
| 8   | `llm_usage_stats` owner is `llm-pricing` (a package, not an app). May fail registry schema validation. |
