# Meta-Validation Report — Cross-Report Consistency

**Generated:** 2026-02-19
**Scope:** Cross-checking 10 validation reports for internal consistency
**Reports analyzed:**

1. `docs/validation/http-contracts-validation.md` — HTTP endpoint validation
2. `docs/validation/pubsub-contracts-validation.md` — Pub/Sub topic validation
3. `docs/validation/ai-models-validation.md` — AI model registry validation
4. `docs/validation/firestore-validation.md` — Firestore collection validation
5. `docs/validation/package-deps-validation.md` — Package dependency validation
6. `docs/validation/env-vars-validation.md` — Environment variable validation
7. `docs/validation/route-auth-validation.md` — Route authentication validation
8. `docs/validation/service-urls-validation.md` — Service URL configuration validation
9. `docs/validation/error-contracts-validation.md` — Error handling validation
10. `docs/validation/terraform-code-sync-validation.md` — Terraform-code sync validation

---

## Executive Summary

The 10 validation reports show strong overall consistency, with the most critical cross-report alignment issue being a confirmed production-breaking bug: `INTEXURAOS_WEB_AGENT_URL` is missing from bookmarks-agent's Terraform module (found independently by both the env-vars and terraform-code-sync reports). Beyond this actionable finding, several severity escalations emerge when findings from multiple reports are combined: research-agent's dead analytics publisher creates a cascade of issues across 3 reports; code-agent accumulates the highest combined risk across error contracts, HTTP documentation gaps, and env-var mismatches; and the route-auth report's endpoint inventory diverges from the http-contracts report in meaningful ways. No direct logical contradictions between reports were found, but several double-counted findings and coverage gaps are identified below.

---

## Cross-Report Findings

### Finding 1: `INTEXURAOS_WEB_AGENT_URL` Missing from Terraform — Production Crash Confirmed

**Reports involved:** env-vars-validation (no CRITICAL label, classified as missing from bookmarks-agent REQUIRED_ENV only), terraform-code-sync-validation (CRITICAL D-1)

**Issue:** Both reports independently flag this variable, but they characterize it differently. The terraform-code-sync report correctly identifies it as CRITICAL: the variable is in bookmarks-agent's REQUIRED_ENV but not injected by Terraform's `module "bookmarks_agent"` env_vars block. The env-vars report classifies it as a LOW/implicit issue because it shows the var is present in `COMMON_SERVICE_URLS` in ecosystem.config — but misses that Terraform for bookmarks-agent does NOT include `local.common_service_env_vars` in its merge for this variable.

**Impact:** bookmarks-agent will fail startup probe in Cloud Run production with a missing required environment variable. This is the only confirmed production-breaking bug across all 10 reports.

**Severity escalation:** env-vars report: OK / terraform report: CRITICAL → **Combined: CRITICAL**

**Action:** Add `INTEXURAOS_WEB_AGENT_URL = module.web_agent.service_url` to `module "bookmarks_agent"` env_vars in `terraform/environments/dev/main.tf`.

---

### Finding 2: Research-Agent Dead Analytics Publisher — Three-Report Cascade

**Reports involved:** pubsub-contracts-validation (D-1 HIGH), env-vars-validation (H2 HIGH), terraform-code-sync-validation (D-4 HIGH)

**Issue:** All three reports independently flag the same root cause: `AnalyticsEventPublisherImpl` is not wired into research-agent's ServiceContainer, but the full infrastructure (Terraform topic, IAM, DLQ, env var) exists. Each report sees a different symptom:

- Pub/Sub report: dead publisher, topic receives no messages
- Env-vars report: `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` is in Terraform but missing from ecosystem.config and docs
- Terraform report: env var injected by Terraform but not in REQUIRED_ENV

These are all facets of the same issue. The combined picture is a partially-implemented feature that left ghost infrastructure behind — or a feature that was designed but never activated.

**Impact:** LLM analytics are silently not being recorded. The `/internal/llm/pubsub/report-analytics` endpoint exists and is reachable but is never published to. Idle Terraform resources (topic, subscription, DLQ, IAM) exist in production.

**Double-counting note:** All three reports should resolve together. Choose Option A (wire publisher) or Option B (delete everything). Do not address these three separately.

**Severity:** HIGH across all three — no escalation needed, already consistent.

---

### Finding 3: Endpoint Inventory Divergence Between HTTP-Contracts and Route-Auth Reports

**Reports involved:** http-contracts-validation, route-auth-validation

**Issue:** The two reports were generated from the same codebase but do not share a consistent endpoint inventory. Several discrepancies:

| Service             | HTTP Contracts (v3)                                                                           | Route-Auth Report                                                                                                                                                                                                                        | Divergence                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| actions-agent       | Lists `GET /actions`, `GET /actions/:id`, `PATCH /actions/:actionId` (3 public routes)        | Lists `GET /actions`, `PATCH /actions/:actionId`, `DELETE /actions/:actionId`, `POST /actions/batch`, `POST /actions/:actionId/execute`, `GET /actions/:actionId/preview`, `POST /actions/:actionId/resolve-duplicate` (7 public routes) | Route-auth found 4 more public endpoints not in HTTP contracts                                                                                                 |
| code-agent          | Lists specific `/code/submit`, `/code/tasks`, etc.                                            | Lists generic `/code/tasks`, `/code/tasks/:taskId`, `/code/tasks/:taskId/events`, `/code/tasks/:taskId/pr-events`, `/code/tasks/:taskId/pr-summaries`                                                                                    | Path variants differ (e.g., HTTP contracts has `/code/submit`, route-auth has no such path; route-auth has `/code/tasks/:taskId/events` not in HTTP contracts) |
| linear-agent        | Lists `GET /linear/issues`, `GET /linear/issues/:identifier`, `POST /linear/connection`, etc. | Lists `GET /linear/issues`, `POST /linear/issues`, `GET /linear/issues/:identifier`, `PATCH /linear/issues/:identifier`, `GET /linear/cycles`, `GET /linear/projects`, `POST /linear/webhooks`                                           | Route-auth lists `POST /linear/issues`, `PATCH /linear/issues/:identifier`, `GET /linear/cycles`, `GET /linear/projects` not found in HTTP contracts           |
| research-agent      | Lists public routes (`/internal/research/draft`, etc.)                                        | Lists `GET /research`, `POST /research`, `GET /research/:researchId`, `POST /internal/research/process`                                                                                                                                  | HTTP contracts lists no public routes for research-agent; route-auth lists 3 public ones + different internal paths                                            |
| user-service        | Lists `POST /auth/device/start`, `POST /auth/device/poll`, etc.                               | Lists `GET /auth/login`, `GET /auth/logout`, `GET /auth/callback`, etc.                                                                                                                                                                  | Substantially different path inventory                                                                                                                         |

**Impact:** The route-auth report appears to have analyzed different route files than the http-contracts report, or the codebase evolved between the two runs. Neither report can be fully trusted as a comprehensive endpoint inventory without reconciliation.

**Assessment:** The http-contracts report (v3, labeled as complete with 181 verified endpoints) is more likely authoritative — it was explicitly cross-referenced against code. The route-auth report may have analyzed an earlier or partially different code state.

**Action:** Reconcile the route-auth report against the HTTP contracts v3 endpoint registry. The auth patterns documented in route-auth are valuable and should be mapped to the confirmed endpoint list.

---

### Finding 4: Env-Vars and Terraform Reports Agree on HIGH Issues — Corroboration

**Reports involved:** env-vars-validation, terraform-code-sync-validation

**Issue (corroboration, not conflict):** Both reports independently identify the same HIGH-severity findings:

| Finding                                                     | Env-Vars ID                    | Terraform ID | Agreement                            |
| ----------------------------------------------------------- | ------------------------------ | ------------ | ------------------------------------ |
| `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` not in REQUIRED_ENV  | H3 HIGH                        | D-3 HIGH     | Consistent                           |
| `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` not in REQUIRED_ENV | H2 HIGH                        | D-4 HIGH     | Consistent                           |
| `INTEXURAOS_WEB_AGENT_URL` missing from Terraform           | Partially (bookmarks OK label) | D-1 CRITICAL | Partial — terraform is more accurate |

**Impact:** High confidence in these findings — two independent validators flagged the same gaps. The terraform report is more reliable on the `WEB_AGENT_URL` severity.

---

### Finding 5: Pub/Sub Topics Lack Corresponding Env-Vars Documentation in Six Services

**Reports involved:** pubsub-contracts-validation (D-3 MEDIUM), env-vars-validation

**Issue:** The pub/sub report flags that 6 services use outdated topic names in their `technical.md` docs (D-3). The env-vars report independently validates env vars against those same `technical.md` files. Where docs use wrong topic names, the env-vars report may have validated env vars against incorrect documented names rather than actual names.

Specific cross-impact:

| Service          | Pub/Sub D-3 (wrong doc name)                                                            | Env-Vars Impact                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| actions-agent    | Docs say `intexuraos-actions-{env}` (wrong: should be `intexuraos-actions-queue-{env}`) | Env var `INTEXURAOS_PUBSUB_ACTIONS_QUEUE` validated OK — code name is correct; docs discrepancy is docs-only |
| research-agent   | Docs say `intexuraos-llm-process-{env}` (wrong)                                         | Env vars `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` validated OK against code                                |
| whatsapp-service | Docs say `intexuraos-whatsapp-audio-transcribe-{env}` (wrong)                           | Env vars validated OK against code                                                                           |

**Assessment:** The env-vars report validated against code (REQUIRED_ENV arrays and Terraform), not docs. So doc naming errors in pub/sub D-3 do not cascade into env-vars failures. The reports are measuring different things here and no conflict exists.

---

### Finding 6: Service URL Report and HTTP Contracts Are Aligned — All Caller Services Have Endpoints

**Reports involved:** service-urls-validation, http-contracts-validation

**Issue (alignment check):** The service-urls report lists 18 services with active URL env vars (excluding api-docs-hub). Cross-checking against HTTP contracts:

- All 18 services with URL vars have documented HTTP endpoints in the contracts report. No orphaned URLs.
- The one exception is `INTEXURAOS_API_DOCS_HUB_URL`: the service-urls report flags it as in Terraform only (no code consumers), and the HTTP contracts report confirms api-docs-hub has only 2 endpoints (`GET /docs`, `GET /health`) with no internal callers. These reports agree: the URL is forward-looking infrastructure.

**Assessment:** Full alignment. No discrepancy.

---

### Finding 7: Error Contract Coverage Matches HTTP Contracts Service List

**Reports involved:** error-contracts-validation, http-contracts-validation

**Issue (alignment check):** The error-contracts report covers all 20 apps including api-docs-hub and web. The http-contracts report covers 20 services. Cross-checking `reply.fail()` counts against endpoint counts:

- Services with the most endpoints (code-agent: 27 endpoints, research-agent: 4 endpoints) roughly match their reply.fail counts (code-agent: 98, research-agent: 86). The high research-agent count relative to its endpoint count reflects complex internal logic per endpoint.
- Services with zero `reply.fail()` calls: api-docs-hub (0 endpoints needing error handling), web frontend (0 service endpoints). Both correct.

**Assessment:** The error contract report is comprehensive and consistent with endpoint coverage. No alignment gaps detected.

---

### Finding 8: Firestore `user_spend` Orphan Corroborated by Terraform Absence

**Reports involved:** firestore-validation (§10b MEDIUM), terraform-code-sync-validation

**Issue:** The firestore report flags `user_spend` as a collection with a domain model but no repository implementation, likely a deprecated feature. The terraform-code-sync report makes no mention of `user_spend` — because it validates env vars and service deployments, not Firestore schemas. There is no terraform resource for `user_spend` collection either.

**Combined assessment:** The domain model exists, the registry entry exists, but there is no repository, no use-case references, and no Terraform index or migration referencing it. This is a dead feature with no runtime impact. Cross-report corroboration strengthens the "deprecated artifact" conclusion.

---

### Finding 9: Route-Auth Report Scope vs HTTP Contracts Scope — Notable Gap in Internal Endpoint Coverage

**Reports involved:** route-auth-validation, http-contracts-validation

**Issue:** The route-auth report focuses heavily on public routes but has sparse coverage of internal endpoints. For example:

- `bookmarks-agent` route-auth lists all internal endpoints with proper auth — consistent with http-contracts
- `research-agent` route-auth lists public endpoints that HTTP contracts does NOT list as existing (suggesting route-auth may have accessed a different code state)

**Impact:** The route-auth report cannot be used as a definitive internal endpoint auth checklist. The authentication patterns it documents (dual-auth OIDC+Internal, HMAC, etc.) are valuable reference material, but the endpoint inventory is incomplete.

---

### Finding 10: AI Models Report Is the Least Cross-Referenced — Coverage Gap

**Reports involved:** ai-models-validation (standalone)

**Issue:** None of the other 9 reports reference AI model usage. The AI models report identifies that `gpt-4.1` and `text-embedding-3-small` are used in production but not in the central `llm-contract`. No other report validates whether the services using these models (image-service for `gpt-4.1`, retired-chat-service for `text-embedding-3-small`) have the necessary API key env vars.

Cross-checking:

- `image-service` env-vars validation shows `INTEXURAOS_OPENAI_APP_API_KEY` is present in retired-chat-service but does NOT appear in the image-service env-vars table. image-service uses `gpt-4.1` (an OpenAI model) but the env-vars report shows no OpenAI key for image-service — only ZAI and Gemini keys plus the suspicious `INTEXURAOS_GUEST_ZAI_API_KEY` and `INTEXURAOS_ZAI_API_KEY` doc errors.
- This is a potential gap: if `gpt-4.1` requires `INTEXURAOS_OPENAI_APP_API_KEY`, and that key is not in image-service's env-vars, the prompt enhancement feature may fail silently.

**Impact:** Potential uncaught env-var gap for image-service's `gpt-4.1` usage. The env-vars report does not mention any OpenAI key for image-service at all.

---

### Finding 11: Package Dependencies Report Shows No Service-Level Impact — Isolated Findings

**Reports involved:** package-deps-validation, all service reports

**Issue:** The package-deps report found 2 open discrepancies (common-core count label wrong, phantom infra-sentry claim in infra-otel README). Neither of these affects runtime behavior. Cross-checking with other reports:

- The phantom `infra-sentry` claim in `infra-otel` README (D4) has no corresponding issue in any other report — because it's purely a documentation error with no runtime dependency.
- The common-core count error (D1, says 13 packages use it, actual 19) has no impact on any service report.

**Assessment:** Package-deps report findings are fully isolated. No cascade to other reports.

---

### Finding 12: App-Settings-Service Internal Route Path Convention — Two Reports Agree

**Reports involved:** route-auth-validation (MEDIUM), http-contracts-validation

**Issue:** The route-auth report flags that `GET /settings/pricing` is served internally without the `/internal/` prefix — a convention deviation. The HTTP contracts report lists both the public and internal variants at the same path `/settings/pricing` with different auth layers, consistent with the route-auth finding.

**Assessment:** Both reports agree on the facts. The convention deviation is real. The route-auth report correctly labels it MEDIUM and recommends renaming to `GET /internal/settings/pricing`.

---

### Finding 13: Notion-Service Webhook Stub — Low Risk, Both Reports Agree

**Reports involved:** route-auth-validation (LOW), http-contracts-validation

**Issue:** HTTP contracts shows `POST /notion/webhooks` with auth `HMAC`. Route-auth shows the same path with `None` auth and calls it a stub. This is a discrepancy: HTTP contracts says HMAC, route-auth says no signature verification.

**Impact:** The HTTP contracts report may have documented the intended auth (HMAC) rather than the actual implementation (none — stub). The route-auth report, which analyzed actual code, is more accurate here.

**Assessment:** Minor documentation inconsistency in HTTP contracts. The route-auth finding (no auth = stub endpoint) is likely authoritative.

---

## Service Risk Matrix

| Service                      | HTTP Contracts           | Pub/Sub               | AI Models                             | Firestore                           | Pkg Deps | Env Vars                          | Route Auth               | Service URLs | Error Contracts              | Terraform                    | Combined Risk |
| ---------------------------- | ------------------------ | --------------------- | ------------------------------------- | ----------------------------------- | -------- | --------------------------------- | ------------------------ | ------------ | ---------------------------- | ---------------------------- | ------------- |
| research-agent               | PASS                     | HIGH (dead publisher) | MEDIUM (model naming)                 | PASS                                | N/A      | HIGH (analytics topic gap)        | PASS                     | OK           | PASS                         | HIGH (analytics topic)       | **HIGH**      |
| bookmarks-agent              | PASS                     | PASS                  | N/A                                   | PASS                                | N/A      | LOW (doc naming)                  | PASS                     | OK           | PASS                         | **CRITICAL** (WEB_AGENT_URL) | **CRITICAL**  |
| code-agent                   | HIGH (2 undoc endpoints) | N/A                   | N/A                                   | PASS                                | N/A      | HIGH (3 vars no REQUIRED_ENV)     | PASS                     | OK           | MEDIUM (INVALID_STATUS cast) | PASS                         | **HIGH**      |
| actions-agent                | HIGH (1 undoc endpoint)  | PASS                  | N/A                                   | PASS                                | N/A      | PASS                              | PASS                     | OK           | PASS                         | PASS                         | **MEDIUM**    |
| linear-agent                 | HIGH (1 undoc endpoint)  | PASS                  | N/A                                   | MEDIUM (camelCase names — fixed)    | N/A      | HIGH (GCP_PROJECT_ID not in docs) | PASS                     | OK           | PASS                         | PASS                         | **MEDIUM**    |
| user-service                 | PASS                     | N/A                   | N/A                                   | LOW (users → user_settings — fixed) | N/A      | HIGH (GOOGLE_OAUTH_REDIRECT_URI)  | PASS                     | OK           | PASS                         | HIGH (same)                  | **HIGH**      |
| image-service                | PASS                     | N/A                   | CRITICAL (gpt-4.1 not in contract)    | PASS                                | N/A      | HIGH (phantom doc vars)           | PASS                     | OK           | PASS                         | PASS                         | **HIGH**      |
| whatsapp-service             | PASS                     | PASS                  | N/A                                   | LOW (prefix names — fixed)          | N/A      | PASS                              | PASS                     | OK           | LOW (raw error msgs)         | PASS                         | **LOW**       |
| calendar-agent               | PASS                     | PASS                  | MEDIUM (llm-factory scope)            | PASS                                | N/A      | LOW (optional LLM keys)           | PASS                     | OK           | MEDIUM (redundant status)    | PASS                         | **MEDIUM**    |
| retired-chat-service                   | PASS                     | N/A                   | N/A (text-embedding unregistered)     | PASS                                | N/A      | PASS                              | PASS                     | OK           | PASS                         | PASS                         | **LOW**       |
| commands-agent               | PASS                     | PASS                  | MEDIUM (GLM-4.7-Flash missing)        | PASS                                | N/A      | PASS                              | PASS                     | OK           | PASS                         | PASS                         | **LOW**       |
| retired-checklist-service                  | PASS                     | LOW (env var prefix)  | MEDIUM (Via commands-agent wrong)     | PASS                                | N/A      | PASS                              | PASS                     | OK           | PASS                         | PASS                         | **LOW**       |
| app-settings-service         | PASS                     | N/A                   | N/A                                   | PASS                                | N/A      | PASS                              | MEDIUM (path convention) | OK           | PASS                         | PASS                         | **LOW**       |
| notion-service               | PASS                     | N/A                   | N/A                                   | PASS                                | N/A      | PASS                              | LOW (webhook stub)       | OK           | PASS                         | PASS                         | **LOW**       |
| notes-agent                  | PASS                     | N/A                   | N/A                                   | PASS                                | N/A      | PASS                              | PASS                     | OK           | PASS                         | PASS                         | **PASS**      |
| mobile-notifications-service | PASS                     | N/A                   | N/A                                   | PASS                                | N/A      | PASS                              | PASS                     | OK           | PASS                         | PASS                         | **PASS**      |
| web-agent                    | PASS                     | N/A                   | MEDIUM (user-config dynamic)          | PASS                                | N/A      | PASS                              | PASS                     | OK           | LOW (partial-success)        | PASS                         | **LOW**       |
| api-docs-hub                 | PASS                     | N/A                   | N/A                                   | N/A                                 | N/A      | MEDIUM (no ecosystem)             | N/A                      | MEDIUM       | PASS                         | PASS                         | **LOW**       |
| orchestrator                 | N/A (worker)             | N/A                   | N/A                                   | N/A                                 | N/A      | HIGH (PROJECT_ID naming)          | N/A                      | N/A          | N/A                          | **CRITICAL** (no Terraform)  | **CRITICAL**  |

---

## Contradictions Found

### Contradiction 1: Notion-Service Webhook Auth — HTTP Contracts vs Route-Auth

| Report                    | Claim                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| http-contracts-validation | `POST /notion/webhooks` Auth: `HMAC`                                       |
| route-auth-validation     | `POST /notion/webhooks` Auth: `None` (stub with no signature verification) |

**Resolution:** Route-auth analyzed actual code and found no verification. HTTP contracts likely documented intended future auth. **Route-auth is authoritative here.**

### Contradiction 2: research-agent Pub/Sub Topic Status

| Report                         | Claim                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| pubsub-contracts-validation    | `intexuraos-llm-analytics` topic has no active publisher (dead code)                            |
| terraform-code-sync-validation | Publisher `intexuraos-llm-analytics-dev` listed as publisher: `research-agent` in pub/sub table |

**Resolution:** The terraform-code-sync report's Pub/Sub table shows the Terraform-configured publisher service account. This is the IAM grant, not an active publisher in code. The pub/sub report's finding (not wired in ServiceContainer) is the more precise code-level observation. **No true contradiction — different levels of analysis.**

### Contradiction 3: Route-Auth and HTTP Contracts on actions-agent Public Endpoints

| Report                    | Public Endpoints Listed                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| http-contracts-validation | `GET /actions`, `GET /actions/:id`, `PATCH /actions/:actionId`                                                                                                                                                   |
| route-auth-validation     | `GET /actions`, `PATCH /actions/:actionId`, `DELETE /actions/:actionId`, `POST /actions/batch`, `POST /actions/:actionId/execute`, `GET /actions/:actionId/preview`, `POST /actions/:actionId/resolve-duplicate` |

**Resolution:** Route-auth lists more endpoints. Either the HTTP contracts report is incomplete for actions-agent public routes, or route-auth analyzed a different code version. The HTTP contracts report explicitly claims 181 verified endpoints after v3 expansion — this discrepancy should be investigated. **Unresolved: requires code verification.**

---

## Coverage Gaps

### Gap 1: No Validator Checked LLM Cost Tracking End-to-End

The AI models report notes that `gpt-4.1` and `text-embedding-3-small` are not in the central pricing contract (`llm-contract`). No validator checked whether the services using out-of-contract models (`image-service`, `retired-chat-service`) have cost tracking wired up through `llm-pricing`. If these models are used without going through `llm-pricing`, usage costs may be untracked. Note: `llm_usage_stats` and `llm-audit` were removed as part of INT-1342.

### Gap 2: No Validator Checked Scheduler Job → Endpoint Alignment

The terraform-code-sync report lists 7 scheduled jobs with their target endpoints. No other report validates whether those endpoint paths (e.g., `commands-agent /internal/retry-pending`, `actions-agent /internal/actions/retry-pending`, `linear-agent /internal/linear/sync-all`) are correctly authenticated for OIDC scheduler tokens. The route-auth report mentions the scheduler OIDC pattern but does not explicitly validate each scheduler job's endpoint against the pattern.

### Gap 3: No Validator Checked DLQ Message Processing

The pub/sub report thoroughly documents DLQ configuration (all 14 module-managed topics have DLQs with pull subscriptions). No validator checked whether any service has a DLQ consumer or alerting configured. DLQ messages accumulate silently if no consumer processes them.

### Gap 4: Firestore Security — No Validator for Cross-Service Access Patterns at Runtime

The firestore report confirms no static cross-service Firestore access. No validator checked whether services writing to shared collections (e.g., via `llm-pricing`) do so only within their declared scope. Note: `llm-audit` and `llm_api_logs` were removed as part of INT-1342.

### Gap 5: No Validator for OpenAPI Specification Accuracy

`api-docs-hub` aggregates OpenAPI specs from 15 services via `*_OPENAPI_URL` env vars. No validator checked whether the OpenAPI specs served by each service accurately reflect the HTTP contracts validated in the http-contracts report. The http-contracts report validates code vs docs; the OpenAPI specs are a third representation that may diverge from both.

### Gap 6: No Cross-Validation of `image-service` OpenAI Key Availability

As noted in Finding 10: `image-service` uses `gpt-4.1` (an OpenAI model) but no `INTEXURAOS_OPENAI_APP_API_KEY` appears in its env-vars validation table. This gap was not flagged by any single report.

---

## Consolidated Action Items

Unified, prioritized, deduplicated across all 10 reports:

### P0 — Production-Breaking (Fix Immediately)

| ID    | Service         | Issue                                                                                                             | Source Reports      |
| ----- | --------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------- |
| MA-01 | bookmarks-agent | Add `INTEXURAOS_WEB_AGENT_URL = module.web_agent.service_url` to `module "bookmarks_agent"` env_vars in Terraform | terraform, env-vars |

### P1 — High Severity (Fix Before Next Deploy)

| ID    | Service        | Issue                                                                                                                                                                                                                                                                          | Source Reports              |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| MA-02 | research-agent | Decide: wire `AnalyticsEventPublisherImpl` into ServiceContainer (Option A) OR delete publisher class + Terraform topic + IAM + env var + route handler (Option B). Also add/remove `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` from REQUIRED_ENV and ecosystem.config accordingly | pubsub, env-vars, terraform |
| MA-03 | user-service   | Add `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` to REQUIRED_ENV in `apps/user-service/src/index.ts`                                                                                                                                                                                 | env-vars, terraform         |
| MA-04 | orchestrator   | Document and resolve deployment gap: orchestrator has no Terraform Cloud Run module. Either create a Terraform module or explicitly document as dev-VM-only                                                                                                                    | terraform                   |
| MA-05 | image-service  | Investigate whether `gpt-4.1` usage requires `INTEXURAOS_OPENAI_APP_API_KEY` in image-service (not currently in its env-vars). Add to Terraform and ecosystem.config if needed                                                                                                 | ai-models, env-vars (meta)  |

### P2 — Medium Severity (Fix in Current Sprint)

| ID    | Service                   | Issue                                                                                                                                                                                            | Source Reports             |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| MA-06 | code-agent                | Replace `'INVALID_STATUS' as ErrorCode` cast with `'CONFLICT'` mapping in codeRoutes.ts ~line 3573                                                                                               | error-contracts            |
| MA-07 | code-agent                | Add `INTEXURAOS_SERVICE_URL`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, and `INTEXURAOS_AUTH_JWKS_URL` to REQUIRED_ENV — all three are used at runtime                                            | env-vars                   |
| MA-08 | actions-agent             | Document `PATCH /internal/actions/:actionId/status` in actions-agent technical.md Internal Endpoints table                                                                                       | http-contracts             |
| MA-09 | linear-agent              | Document `GET /internal/linear/issues/:identifier` in linear-agent technical.md Internal Endpoints table                                                                                         | http-contracts             |
| MA-10 | app-settings-service      | Rename internal route `GET /settings/pricing` → `GET /internal/settings/pricing` for convention compliance, update all callers                                                                   | route-auth, http-contracts |
| MA-11 | calendar-agent            | Remove redundant `reply.status()` pre-sets in centralized error handler                                                                                                                          | error-contracts            |
| MA-12 | bookmarks-agent           | Add `INTEXURAOS_USER_SERVICE_URL` and `INTEXURAOS_APP_SETTINGS_SERVICE_URL` to bookmarks-agent REQUIRED_ENV, or remove from Terraform env if unused                                              | terraform                  |
| MA-13 | Route-auth reconciliation | Reconcile route-auth-validation endpoint inventory against http-contracts v3 registry — resolve discrepancies in actions-agent, research-agent, linear-agent, code-agent, user-service endpoints | http-contracts, route-auth |

### P3 — Low Severity (Schedule for Backlog)

| ID    | Service/Area                                     | Issue                                                                                                                                                         | Source Reports         |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| MA-14 | ai-models                                        | Add `gpt-4.1` and `text-embedding-3-small` to `llm-contract/src/supportedModels.ts` or document exclusion rationale                                           | ai-models              |
| MA-15 | ai-models                                        | Fix model count in overview.md (says "17 models", should be 16 per contract or 18 actual) and index.md                                                        | ai-models              |
| MA-16 | ai-models                                        | Fix `o4-mini` in test fixtures → should be `o4-mini-deep-research`; fix `gemini-2.0-flash-exp` → `gemini-2.0-flash`                                           | ai-models              |
| MA-17 | docs (5 services)                                | Regenerate technical.md Pub/Sub topic names for actions-agent, bookmarks-agent, commands-agent, research-agent, whatsapp-service                              | pubsub                 |
| MA-18 | retired-checklist-service                                      | Consider renaming `INTEXURAOS_TODOS_PROCESSING_TOPIC` → `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC` for naming consistency                                     | pubsub, env-vars       |
| MA-19 | bookmarks-agent                                  | Add `_TOPIC` suffix to `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH` and `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE` env var names                                           | pubsub                 |
| MA-20 | firestore                                        | Remove stale index entries `dataSource` and `compositeFeeds` from `firestore.indexes.json`                                                                    | firestore              |
| MA-21 | firestore                                        | Remove or implement `user_spend` registry entry and domain model                                                                                              | firestore              |
| MA-22 | common-core README                               | Fix package count label: `Packages (13)` → `Packages (19)`                                                                                                    | pkg-deps               |
| MA-23 | infra-otel README                                | Remove phantom claim that infra-sentry imports from infra-otel                                                                                                | pkg-deps               |
| MA-24 | orchestrator                                     | Document env var naming: orchestrator uses `INTEXURAOS_PROJECT_ID` but `.envrc` exports `INTEXURAOS_GCP_PROJECT_ID` — requires manual `.envrc.local` override | env-vars               |
| MA-25 | notion-service                                   | When activating Notion webhook processing, add `x-notion-signature` HMAC verification                                                                         | route-auth             |
| MA-26 | whatsapp-service / calendar-agent / linear-agent | Standardize `DOWNSTREAM_ERROR` messages to static strings; log originals server-side only                                                                     | error-contracts        |
| MA-27 | api-docs-hub                                     | Confirm whether api-docs-hub should run locally via PM2; add to ecosystem.config.cjs if yes                                                                   | service-urls, env-vars |
| MA-28 | vm-lifecycle                                     | Add `INTEXURAOS_VM_ZONE`, `INTEXURAOS_VM_INSTANCE_NAME` to vm-lifecycle Terraform env_vars for per-environment configurability                                | terraform              |

---

## Report Quality Assessment

| Report                         | Thoroughness                                                    | Consistency                                            | Actionability                                                    | Notes                                                                                |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| http-contracts-validation      | HIGH — 181 endpoints fully verified                             | HIGH — clear v3 vs v2 history                          | HIGH — specific file locations for fixes                         | Most authoritative endpoint source                                                   |
| pubsub-contracts-validation    | HIGH — all 16 topics, IAM, DLQ, schemas                         | HIGH                                                   | HIGH                                                             | Thorough DLQ documentation; D-1 dead publisher is the key finding                    |
| ai-models-validation           | HIGH — 19 issues found                                          | MEDIUM — some categories overlap                       | HIGH                                                             | Best documentation of the 3-tier naming problem                                      |
| firestore-validation           | HIGH — all 45 collections, indexes                              | HIGH                                                   | MEDIUM — some findings marked fixed without verification context | `user_spend` orphan well-investigated                                                |
| package-deps-validation        | HIGH — full dep matrix, build order                             | HIGH                                                   | HIGH (2 open items)                                              | Clean pass overall; small surface area                                               |
| env-vars-validation            | HIGH — 4-source matrix for each service                         | HIGH                                                   | HIGH                                                             | Misses the WEB_AGENT_URL severity; terraform report is more accurate on that finding |
| route-auth-validation          | MEDIUM — auth patterns excellent, endpoint inventory incomplete | LOW — diverges from http-contracts on several services | MEDIUM                                                           | Auth pattern documentation is high value; endpoint coverage needs reconciliation     |
| service-urls-validation        | MEDIUM — focused scope, clean matrix                            | HIGH                                                   | MEDIUM (2 items)                                                 | Clean pass; api-docs-hub gap is documented                                           |
| error-contracts-validation     | HIGH — quantified all reply.fail/ok/send calls                  | HIGH                                                   | HIGH                                                             | Excellent systematic coverage; INVALID_STATUS cast is a real type safety issue       |
| terraform-code-sync-validation | HIGH — all services, env var cross-ref                          | HIGH                                                   | HIGH — P0/P1/P2/P3 priorities                                    | Most actionable report; CRITICAL bookmarks finding is the highest-priority item      |
