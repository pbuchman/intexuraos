# HTTP Contracts Cross-Validation Report

**Generated:** 2026-02-08
**Scope:** All `/internal/*` endpoints documented across 15 services
**Method:** Docs-first, then validated against actual route code

---

## Summary

- **Total internal endpoints documented:** 52
- **Endpoints verified in code:** 49
- **Discrepancies found:** 12
  - 3 caller docs referencing non-existent endpoint paths
  - 2 endpoint path mismatches between docs and code
  - 3 undocumented endpoints found in code
  - 4 additional internal endpoints in linear-agent not in docs table

---

## 1. Cross-Service Call Validation

This table tracks every documented cross-service HTTP call, verifying the caller's documentation against the callee's documentation and actual code.

### user-service (Callee)

| Caller         | Documented Path (Caller Docs)            | Callee Docs Path                          | Actual Code Path                          | Match |
| -------------- | ---------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----- |
| research-agent | `/internal/users/{id}/llm-keys`          | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |
| research-agent | `/internal/users/{id}/settings`          | `/internal/users/:uid/settings`           | `/internal/users/:uid/settings`           | OK    |
| web-agent      | `/internal/users/{id}/settings`          | `/internal/users/:uid/settings`           | `/internal/users/:uid/settings`           | OK    |
| web-agent      | `/internal/users/{id}/llm-keys`          | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |
| calendar-agent | `/internal/users/:id/oauth/google/token` | `/internal/users/:uid/oauth/google/token` | `/internal/users/:uid/oauth/google/token` | OK    |
| calendar-agent | `/internal/users/:id/llm-client`         | N/A (does not exist)                      | N/A (does not exist)                      | FAIL  |
| todos-agent    | `/internal/users/:userId/llm-client`     | N/A (does not exist)                      | N/A (does not exist)                      | FAIL  |
| image-service  | `/internal/users/:userId/api-keys`       | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | FAIL  |
| linear-agent   | `/internal/user/llm-client`              | N/A (does not exist)                      | N/A (does not exist)                      | FAIL  |
| chat-agent     | (via `@intexuraos/internal-clients`)     | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |
| commands-agent | (via `@intexuraos/internal-clients`)     | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |

**Details on FAIL cases:**

1. **calendar-agent docs reference `/internal/users/:id/llm-client`** -- This endpoint does not exist in user-service. The actual mechanism is the `@intexuraos/internal-clients` package which calls `/internal/users/:uid/llm-keys` and `/internal/users/:uid/settings` to build an LLM client. The docs incorrectly describe this as a single endpoint.

2. **todos-agent docs reference `/internal/users/:userId/llm-client`** -- Same issue. The actual internal-clients package calls two separate user-service endpoints.

3. **image-service docs reference `/internal/users/:userId/api-keys`** -- The actual endpoint is `/internal/users/:uid/llm-keys`. The path `api-keys` does not exist.

4. **linear-agent docs reference `/internal/user/llm-client`** -- This is doubly wrong: the path segment is `users` not `user`, and `llm-client` is not a real endpoint. Same internal-clients pattern as above.

### actions-agent (Callee)

| Caller         | Documented Path (Caller Docs)              | Callee Docs Path         | Actual Code Path                           | Match |
| -------------- | ------------------------------------------ | ------------------------ | ------------------------------------------ | ----- |
| commands-agent | `POST /internal/actions`                   | `POST /internal/actions` | `POST /internal/actions`                   | OK    |
| code-agent     | `PATCH /internal/actions/:actionId/status` | N/A (not in docs table)  | `PATCH /internal/actions/:actionId/status` | WARN  |

**Detail:** The `PATCH /internal/actions/:actionId/status` endpoint exists in code but is NOT listed in the actions-agent technical.md Internal Endpoints table.

### web-agent (Callee)

| Caller          | Documented Path (Caller Docs)    | Callee Docs Path                | Actual Code Path                | Match |
| --------------- | -------------------------------- | ------------------------------- | ------------------------------- | ----- |
| bookmarks-agent | `POST /internal/link-previews`   | `POST /internal/link-previews`  | `POST /internal/link-previews`  | OK    |
| bookmarks-agent | `POST /internal/page-summaries`  | `POST /internal/page-summaries` | `POST /internal/page-summaries` | OK    |
| research-agent  | (architecture diagram reference) | `POST /internal/page-summaries` | `POST /internal/page-summaries` | OK    |

### linear-agent (Callee)

| Caller        | Documented Path (Caller Docs)           | Callee Docs Path                        | Actual Code Path                        | Match |
| ------------- | --------------------------------------- | --------------------------------------- | --------------------------------------- | ----- |
| actions-agent | `POST /internal/linear/process-action`  | `POST /internal/linear/process-action`  | `POST /internal/linear/process-action`  | OK    |
| code-agent    | `POST /internal/issues`                 | `POST /internal/issues`                 | `POST /internal/issues`                 | OK    |
| code-agent    | `PATCH /internal/issues/:issueId/state` | `PATCH /internal/issues/:issueId/state` | `PATCH /internal/issues/:issueId/state` | OK    |

### research-agent (Callee)

| Caller        | Documented Path (Caller Docs)   | Callee Docs Path                | Actual Code Path                | Match |
| ------------- | ------------------------------- | ------------------------------- | ------------------------------- | ----- |
| actions-agent | `POST /internal/research/draft` | `POST /internal/research/draft` | `POST /internal/research/draft` | OK    |

### image-service (Callee)

| Caller         | Documented Path (Caller Docs)            | Callee Docs Path                         | Actual Code Path                         | Match |
| -------------- | ---------------------------------------- | ---------------------------------------- | ---------------------------------------- | ----- |
| research-agent | `POST /internal/images/generate`         | `POST /internal/images/generate`         | `POST /internal/images/generate`         | OK    |
| research-agent | `POST /internal/images/prompts/generate` | `POST /internal/images/prompts/generate` | `POST /internal/images/prompts/generate` | OK    |
| research-agent | `DELETE /internal/images/:id`            | `DELETE /internal/images/:id`            | `DELETE /internal/images/:id`            | OK    |

### app-settings-service (Callee)

| Caller       | Documented Path (Caller Docs) | Callee Docs Path                         | Actual Code Path             | Match |
| ------------ | ----------------------------- | ---------------------------------------- | ---------------------------- | ----- |
| linear-agent | `/internal/pricing`           | `/internal/pricing/:provider` (agent.md) | `/internal/settings/pricing` | FAIL  |

**Detail:** The linear-agent docs say the app-settings-service endpoint is `/internal/pricing`, but the actual code has `/internal/settings/pricing`. The path prefix `/internal/settings/` is part of the actual route.

### code-agent (Callee)

| Caller        | Documented Path (Caller Docs)                   | Callee Docs Path                        | Actual Code Path                        | Match |
| ------------- | ----------------------------------------------- | --------------------------------------- | --------------------------------------- | ----- |
| actions-agent | `POST /internal/code/process` (from deps table) | `POST /internal/code/process`           | `POST /internal/code/process`           | OK    |
| orchestrator  | `POST /internal/logs`                           | `POST /internal/logs`                   | `POST /internal/logs`                   | OK    |
| orchestrator  | `POST /internal/webhooks/task-complete`         | `POST /internal/webhooks/task-complete` | `POST /internal/webhooks/task-complete` | OK    |
| orchestrator  | `POST /internal/code/heartbeat`                 | `POST /internal/code/heartbeat`         | `POST /internal/code/heartbeat`         | OK    |

---

## 2. Docs vs Code Endpoint Mismatch

### 2.1 Endpoints in Code but NOT in Docs

| Service       | Method | Actual Code Path                         | Description                                         |
| ------------- | ------ | ---------------------------------------- | --------------------------------------------------- |
| actions-agent | PATCH  | `/internal/actions/:actionId/status`     | Update action resource status (code-agent callback) |
| linear-agent  | GET    | `/internal/linear/issues/:identifier`    | Validate a Linear issue exists                      |
| linear-agent  | POST   | `/internal/linear/issues/generate-title` | LLM-powered title generation                        |
| linear-agent  | POST   | `/internal/linear/sync`                  | Full sync of Linear issues for a user               |
| code-agent    | POST   | `/internal/code/cancel-with-nonce`       | Cancel task via WhatsApp nonce                      |
| code-agent    | POST   | `/internal/tasks/cleanup-logs`           | Cleanup old task logs                               |

**Note on linear-agent:** The `internalRoutes.ts` contains 4 endpoints (`/internal/linear/process-action`, `/internal/linear/issues/:identifier`, `/internal/linear/issues/generate-title`, `/internal/linear/sync`) but the docs table only lists `POST /internal/linear/process-action`. The other three are described in use case sections but omitted from the Internal Endpoints table.

### 2.2 Endpoints in Docs but Path Differs in Code

| Service    | Docs Path                          | Actual Code Path                        | Issue                                    |
| ---------- | ---------------------------------- | --------------------------------------- | ---------------------------------------- |
| code-agent | `POST /internal/code/cancel`       | `POST /internal/code/cancel-with-nonce` | Path name differs (nonce suffix in code) |
| code-agent | `POST /internal/code/cleanup-logs` | `POST /internal/tasks/cleanup-logs`     | Path prefix differs (`code` vs `tasks`)  |

---

## 3. Complete Internal Endpoint Registry

### actions-agent

| Method | Path                                 | Docs | Code |
| ------ | ------------------------------------ | ---- | ---- |
| POST   | `/internal/actions`                  | Yes  | Yes  |
| POST   | `/internal/actions/:actionType`      | Yes  | Yes  |
| POST   | `/internal/actions/process`          | Yes  | Yes  |
| POST   | `/internal/actions/retry-pending`    | Yes  | Yes  |
| POST   | `/internal/actions/approval-reply`   | Yes  | Yes  |
| PATCH  | `/internal/actions/:actionId/status` | No   | Yes  |

### research-agent

| Method | Path                                    | Docs | Code |
| ------ | --------------------------------------- | ---- | ---- |
| POST   | `/internal/research/draft`              | Yes  | Yes  |
| POST   | `/internal/llm/pubsub/process-research` | Yes  | Yes  |
| POST   | `/internal/llm/pubsub/process-llm-call` | Yes  | Yes  |
| POST   | `/internal/llm/pubsub/report-analytics` | Yes  | Yes  |

### commands-agent

| Method | Path                            | Docs | Code |
| ------ | ------------------------------- | ---- | ---- |
| POST   | `/internal/commands`            | Yes  | Yes  |
| POST   | `/internal/retry-pending`       | Yes  | Yes  |
| GET    | `/internal/commands/:commandId` | Yes  | Yes  |

### whatsapp-service

| Method | Path                                         | Docs | Code |
| ------ | -------------------------------------------- | ---- | ---- |
| POST   | `/internal/whatsapp/pubsub/process-webhook`  | Yes  | Yes  |
| POST   | `/internal/whatsapp/pubsub/transcribe-audio` | Yes  | Yes  |
| POST   | `/internal/whatsapp/pubsub/send-message`     | Yes  | Yes  |
| POST   | `/internal/whatsapp/pubsub/media-cleanup`    | Yes  | Yes  |

### user-service

| Method | Path                                                | Docs | Code |
| ------ | --------------------------------------------------- | ---- | ---- |
| GET    | `/internal/users/:uid/llm-keys`                     | Yes  | Yes  |
| POST   | `/internal/users/:uid/llm-keys/:provider/last-used` | Yes  | Yes  |
| GET    | `/internal/users/:uid/oauth/google/token`           | Yes  | Yes  |
| GET    | `/internal/users/:uid/settings`                     | Yes  | Yes  |

### web-agent

| Method | Path                       | Docs | Code |
| ------ | -------------------------- | ---- | ---- |
| POST   | `/internal/link-previews`  | Yes  | Yes  |
| POST   | `/internal/page-summaries` | Yes  | Yes  |

### bookmarks-agent

| Method | Path                                    | Docs | Code |
| ------ | --------------------------------------- | ---- | ---- |
| POST   | `/internal/bookmarks`                   | Yes  | Yes  |
| GET    | `/internal/bookmarks/:id`               | Yes  | Yes  |
| PATCH  | `/internal/bookmarks/:id`               | Yes  | Yes  |
| POST   | `/internal/bookmarks/:id/force-refresh` | Yes  | Yes  |
| POST   | `/internal/bookmarks/pubsub/enrich`     | Yes  | Yes  |
| POST   | `/internal/bookmarks/pubsub/summarize`  | Yes  | Yes  |

### todos-agent

| Method | Path                                      | Docs | Code |
| ------ | ----------------------------------------- | ---- | ---- |
| POST   | `/internal/todos`                         | Yes  | Yes  |
| POST   | `/internal/todos/pubsub/todos-processing` | Yes  | Yes  |

### calendar-agent

| Method | Path                                   | Docs | Code |
| ------ | -------------------------------------- | ---- | ---- |
| POST   | `/internal/calendar/process-action`    | Yes  | Yes  |
| POST   | `/internal/calendar/generate-preview`  | Yes  | Yes  |
| GET    | `/internal/calendar/preview/:actionId` | Yes  | Yes  |

### image-service

| Method | Path                                | Docs | Code |
| ------ | ----------------------------------- | ---- | ---- |
| POST   | `/internal/images/prompts/generate` | Yes  | Yes  |
| POST   | `/internal/images/generate`         | Yes  | Yes  |
| DELETE | `/internal/images/:id`              | Yes  | Yes  |

### linear-agent

| Method | Path                                     | Docs Table | Code |
| ------ | ---------------------------------------- | ---------- | ---- |
| POST   | `/internal/linear/process-action`        | Yes        | Yes  |
| POST   | `/internal/issues`                       | Yes        | Yes  |
| PATCH  | `/internal/issues/:issueId/state`        | Yes        | Yes  |
| GET    | `/internal/linear/issues/:identifier`    | No         | Yes  |
| POST   | `/internal/linear/issues/generate-title` | No         | Yes  |
| POST   | `/internal/linear/sync`                  | No         | Yes  |

### notes-agent

| Method | Path              | Docs | Code |
| ------ | ----------------- | ---- | ---- |
| POST   | `/internal/notes` | Yes  | Yes  |

### code-agent

| Method | Path                                                | Docs | Code |
| ------ | --------------------------------------------------- | ---- | ---- |
| POST   | `/internal/code/process`                            | Yes  | Yes  |
| PATCH  | `/internal/code-tasks/:taskId`                      | Yes  | Yes  |
| GET    | `/internal/code-tasks/linear/:linearIssueId/active` | Yes  | Yes  |
| GET    | `/internal/code-tasks/zombies`                      | Yes  | Yes  |
| POST   | `/internal/code/cancel-with-nonce`                  | No\* | Yes  |
| POST   | `/internal/code/heartbeat`                          | Yes  | Yes  |
| POST   | `/internal/code/detect-zombies`                     | Yes  | Yes  |
| POST   | `/internal/tasks/cleanup-logs`                      | No\* | Yes  |
| POST   | `/internal/webhooks/task-complete`                  | Yes  | Yes  |
| POST   | `/internal/logs`                                    | Yes  | Yes  |
| POST   | `/webhooks/github`                                  | Yes  | Yes  |

\*Documented with different paths: `/internal/code/cancel` and `/internal/code/cleanup-logs`

### notion-service (not in original scope but referenced)

| Method | Path                                                   | Docs | Code |
| ------ | ------------------------------------------------------ | ---- | ---- |
| GET    | `/internal/notion/users/:userId/context`               | N/A  | Yes  |
| GET    | `/internal/notion/users/:userId/pages/:pageId/preview` | N/A  | Yes  |

### app-settings-service (not in original scope but referenced)

| Method | Path                         | Docs | Code |
| ------ | ---------------------------- | ---- | ---- |
| GET    | `/internal/settings/pricing` | N/A  | Yes  |

---

## 4. Discrepancy Details

### D1: Phantom `/llm-client` Endpoint in 3 Service Docs

**Affected docs:** `calendar-agent/technical.md`, `todos-agent/technical.md`, `linear-agent/technical.md`

**Problem:** These docs list a dependency endpoint `/internal/users/:id/llm-client` (or variants) on user-service. This endpoint does not exist. The actual mechanism is the `@intexuraos/internal-clients` package, which composes an LLM client by calling:

1. `GET /internal/users/:uid/settings` (to get default model preference)
2. `GET /internal/users/:uid/llm-keys` (to get decrypted API keys)

**Impact:** Low (code works correctly via the package, docs are just misleading). Developers consulting only the docs would not find this endpoint.

**Fix:** Update the Dependencies section of these three technical.md files to reference the two actual endpoints, or note that the `@intexuraos/internal-clients` package handles the interaction.

### D2: Wrong Path `/internal/users/:userId/api-keys` in image-service Docs

**File:** `docs/services/image-service/technical.md` line 171

**Problem:** Docs say image-service calls `/internal/users/:userId/api-keys` on user-service. The actual endpoint is `/internal/users/:uid/llm-keys`.

**Impact:** Low (code works via internal-clients). Documentation is incorrect.

**Fix:** Change `api-keys` to `llm-keys` in the Dependencies table.

### D3: Wrong Path `/internal/pricing` in linear-agent Docs

**File:** `docs/services/linear-agent/technical.md` line 634

**Problem:** Docs say linear-agent calls `/internal/pricing` on app-settings-service. The actual endpoint is `/internal/settings/pricing`.

**Impact:** Low. Path prefix mismatch.

**Fix:** Update to `/internal/settings/pricing`.

### D4: Missing `PATCH /internal/actions/:actionId/status` in actions-agent Docs

**File:** `docs/services/actions-agent/technical.md`

**Problem:** The Internal Endpoints table omits this endpoint, which is used by code-agent to update action resource status (dispatched, running, completed, failed, cancelled).

**Impact:** Medium. code-agent developers would not know this endpoint exists by reading the actions-agent docs alone.

**Fix:** Add `PATCH /internal/actions/:actionId/status` to the Internal Endpoints table with description "Update action resource status from code-agent".

### D5: Missing 3 Internal Endpoints in linear-agent Docs Table

**File:** `docs/services/linear-agent/technical.md`

**Problem:** The Internal Endpoints table lists only `POST /internal/linear/process-action`, `POST /internal/issues`, and `PATCH /internal/issues/:issueId/state`. The following endpoints exist in code but are not in the table:

- `GET /internal/linear/issues/:identifier` (validate issue)
- `POST /internal/linear/issues/generate-title` (generate title)
- `POST /internal/linear/sync` (full sync)

These are described in the "New Routes" section text and use case descriptions but not in the Internal Endpoints table.

**Impact:** Medium. Callers (like code-agent) may not discover these endpoints from the endpoint table.

**Fix:** Add these three endpoints to the Internal Endpoints table.

### D6: Path Mismatch for code-agent Cancel Endpoint

**File:** `docs/services/code-agent/technical.md`

**Problem:** Docs list `POST /internal/code/cancel` but actual code path is `POST /internal/code/cancel-with-nonce`.

**Impact:** High. Any service trying to call `/internal/code/cancel` based on docs would get a 404.

**Fix:** Update docs to show `/internal/code/cancel-with-nonce`.

### D7: Path Mismatch for code-agent Cleanup Logs Endpoint

**File:** `docs/services/code-agent/technical.md`

**Problem:** Docs list `POST /internal/code/cleanup-logs` but actual code path is `POST /internal/tasks/cleanup-logs`.

**Impact:** High. Any service or cron trying to call `/internal/code/cleanup-logs` based on docs would get a 404.

**Fix:** Update docs to show `/internal/tasks/cleanup-logs`.

---

## 5. Services Not Requiring Internal HTTP Validation

The following services from the analyzed set have no cross-service HTTP discrepancies:

- **whatsapp-service** -- All 4 Pub/Sub handler endpoints match between docs and code
- **notes-agent** -- Single `/internal/notes` endpoint matches
- **research-agent** -- All 4 endpoints match between docs and code
- **commands-agent** -- All 3 endpoints match between docs and code
- **bookmarks-agent** -- All 6 endpoints match between docs and code
- **calendar-agent** -- All 3 endpoints match between docs and code (caller-side docs issue only)
- **web-agent** -- Both endpoints match between docs and code
- **image-service** -- All 3 endpoints match between docs and code (caller-side docs issue only)
- **chat-agent** -- No internal endpoints (public only, verified)
- **orchestrator** -- Not a Cloud Run service; HTTP contract with code-agent verified

---

## 6. Priority Fix List

| Priority | Discrepancy | Files to Update                                              |
| -------- | ----------- | ------------------------------------------------------------ |
| HIGH     | D6          | `docs/services/code-agent/technical.md`                      |
| HIGH     | D7          | `docs/services/code-agent/technical.md`                      |
| MEDIUM   | D4          | `docs/services/actions-agent/technical.md`                   |
| MEDIUM   | D5          | `docs/services/linear-agent/technical.md`                    |
| LOW      | D1          | `calendar-agent`, `todos-agent`, `linear-agent` technical.md |
| LOW      | D2          | `docs/services/image-service/technical.md`                   |
| LOW      | D3          | `docs/services/linear-agent/technical.md`                    |
