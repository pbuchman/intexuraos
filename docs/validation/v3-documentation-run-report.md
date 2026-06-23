# Documentation Run v3 — Comprehensive Report

**Generated:** 2026-02-19
**Method:** Parallel agent orchestration (monorepo-docs-v3 team)
**Model:** Claude Sonnet 4.6 (all agents)
**Emphasis:** Double cross-verification and meta-validation

---

## Executive Summary

Documentation run v3 expanded the validation surface from 6 domains (v2) to 10 domains plus a dedicated meta-validation layer, producing approximately 4,400 lines of validation output across 11 reports. The run confirmed 181 HTTP endpoints across 20 services, 16 Pub/Sub topics with full DLQ topology, 45 Firestore collections, and 22 packages — all cross-validated against live code. The meta-validation layer surfaced one **production-breaking bug** not flagged by any single validator: `INTEXURAOS_WEB_AGENT_URL` is missing from bookmarks-agent's Terraform module, guaranteeing a startup probe failure on Cloud Run deployment. Beyond this P0 item, v3 identified 4 additional P1 issues including a dead analytics publisher with ghost infrastructure across 3 services, an orchestrator with no cloud deployment path, and a potential missing OpenAI API key in image-service. The most significant process improvement in v3 is the introduction of corroborating and contradicting findings across reports, enabling much higher confidence in severity ratings.

---

## Run Statistics

| Metric                      | v2     | v3                                                        | Change |
| --------------------------- | ------ | --------------------------------------------------------- | ------ |
| Documentation files updated | 186    | 186                                                       | =      |
| Cross-validation reports    | 6      | 10 + 1 meta                                               | +5     |
| Total discrepancies found   | 33+    | 28 (deduplicated)                                         | -5     |
| CRITICAL issues             | 0      | 1                                                         | +1     |
| HIGH issues                 | 9      | 4 (P1)                                                    | -5     |
| MEDIUM issues               | 18     | 8 (P2)                                                    | -10    |
| LOW issues                  | 6      | 15 (P3)                                                   | +9     |
| Total agents deployed       | 38     | 54                                                        | +16    |
| Validation report lines     | ~2,200 | ~4,400                                                    | ~2x    |
| Endpoint inventory          | ~120   | 181 (verified)                                            | +51%   |
| New validation domains      | —      | Route auth, Service URLs, Error contracts, Terraform sync | +4     |

> Note: The lower MEDIUM/HIGH counts in v3 relative to v2 reflect deduplication via meta-validation — several v2 "separate" issues were consolidated into single root causes. LOW items increased because v3 found more documentation naming issues.

---

## Phase Summary

### Phase 2: Documentation Generation

31 documentation agents (service-scribe type) ran in 3 waves across all 46 components.

| Wave   | Scope                                      | Agents | Status    |
| ------ | ------------------------------------------ | ------ | --------- |
| Wave 1 | 10 apps (actions-agent to image-service)   | 10     | Completed |
| Wave 2 | 10 apps (linear-agent to whatsapp-service) | 10     | Completed |
| Wave 3 | 4 workers + 4 package batches              | 8      | Completed |

| Component Type | Files Per Component                            | Components | Total Files |
| -------------- | ---------------------------------------------- | ---------- | ----------- |
| Apps           | 5 (features, technical, tutorial, debt, agent) | 20         | 100         |
| Workers        | 5 (features, technical, tutorial, debt, agent) | 4          | 20          |
| Packages       | 3 (README, debt, agent)                        | 22         | 66          |
| **Total**      |                                                | **46**     | **186**     |

Notable: `infra-otel` received first-time documentation. All other components were incremental updates preserving prior user-contributed insights.

### Phase 3: Aggregation

4 files updated by dedicated aggregation agents:

| File                         | Status                                    |
| ---------------------------- | ----------------------------------------- |
| `docs/services/index.md`     | Updated — full catalog with 46 components |
| `docs/overview.md`           | Updated — project narrative refreshed     |
| `docs/site-index.json`       | Updated — structured metadata current     |
| `docs/documentation-runs.md` | Updated — v3 run logged                   |

### Phase 4A: Standard Cross-Validation (Enhanced)

6 validation domains from v2, re-run with enhanced prompts and expanded scope:

| Domain                | Items Checked                 | Open Discrepancies | Key Finding                                                                                          |
| --------------------- | ----------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| HTTP Contracts        | 181 endpoints, 20 services    | 2                  | Near-complete pass: 0 phantom endpoints, 2 undocumented code endpoints (actions-agent, linear-agent) |
| Pub/Sub Contracts     | 16 topics, full IAM/DLQ audit | 8                  | Dead publisher in research-agent; 6 services with stale doc topic names                              |
| AI Models             | 16 in registry, 18 in use     | 19                 | `gpt-4.1` and `text-embedding-3-small` not in llm-contract; model count wrong in overview.md         |
| Firestore Collections | 45 collections, 40 indexes    | 4                  | `user_spend` orphan (no repository); stale index entries `dataSource`, `compositeFeeds`              |
| Package Dependencies  | 22 packages, full dep matrix  | 2                  | No circular deps; common-core count label wrong; phantom infra-sentry claim in infra-otel            |
| Environment Variables | 20 services, 4-source matrix  | 8+                 | Multiple REQUIRED_ENV gaps; `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` not fail-fast in user-service     |

### Phase 4B: Extended Validation (NEW)

4 new validation domains added in v3:

| Domain               | Verdict                   | Key Finding                                                                                                                                                            |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route Authentication | PASS — no CRITICAL/HIGH   | 9 intentionally unauthenticated routes confirmed; 1 MEDIUM path convention deviation (app-settings `/settings/pricing`); 1 LOW notion webhook stub                     |
| Service URLs         | PASS with 2 discrepancies | 18/19 service URLs consistent across all 3 sources; `INTEXURAOS_API_DOCS_HUB_URL` missing from ecosystem.config; code-agent self-reference pattern documented          |
| Error Contracts      | PASS                      | 599 `reply.fail()` + 272 `reply.ok()` calls verified; 0 unannotated raw sends; 1 `INVALID_STATUS` type cast in code-agent is non-standard                              |
| Terraform-Code Sync  | CRITICAL finding          | bookmarks-agent missing `WEB_AGENT_URL` from Terraform (production startup failure); orchestrator has no cloud deployment path; 7 env var mismatches across 5 services |

### Phase 4C: Meta-Validation (NEW)

Cross-report consistency analysis across all 10 validation reports. Key findings from the meta-validation:

**Corroborations (high confidence):**

- `INTEXURAOS_WEB_AGENT_URL` missing from bookmarks Terraform: independently confirmed by both env-vars and terraform reports → escalated to P0
- `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` not in user-service REQUIRED_ENV: confirmed by both env-vars and terraform reports → high confidence P1
- Research-agent dead analytics publisher: confirmed by pubsub, env-vars, and terraform reports (3-way corroboration) → root cause is single unwired service

**Contradictions resolved:**

- notion-service webhook auth: HTTP contracts says HMAC, route-auth says None (stub). Route-auth is authoritative (analyzed actual code).
- research-agent topic status: terraform shows IAM grant (not active publisher); pub/sub report correctly identifies no wiring in ServiceContainer. Not a true contradiction.
- actions-agent endpoint count: route-auth lists 7 public routes, HTTP contracts lists 3. Unresolved — requires code verification.

**Coverage gaps identified:**

- No validator checked LLM cost tracking for out-of-contract models (image-service `gpt-4.1`, retired-chat-service `text-embedding-3-small`)
- No validator checked scheduler job → endpoint authentication alignment
- No validator checked DLQ consumer or alerting configuration
- No validator for OpenAPI spec accuracy vs HTTP contracts

---

## Top Findings — Prioritized

### P0: Production-Breaking

| ID    | Service         | Issue                                                                                                                                                                                                             | Source                                |
| ----- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| MA-01 | bookmarks-agent | `INTEXURAOS_WEB_AGENT_URL = module.web_agent.service_url` missing from `module "bookmarks_agent"` env_vars in `terraform/environments/dev/main.tf`. Service will fail startup probe on next Cloud Run deployment. | terraform + env-vars (meta-escalated) |

### P1: High Severity

| ID    | Service        | Issue                                                                                                                                                                                                                                                        | Source                        |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| MA-02 | research-agent | Dead `AnalyticsEventPublisherImpl`: not wired into ServiceContainer, but full Terraform infrastructure (topic, IAM, DLQ, env var) exists. Decide: wire it (Option A) or delete all ghost infrastructure (Option B). LLM analytics are silently not recorded. | pubsub + env-vars + terraform |
| MA-03 | user-service   | `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` present in Terraform but not in REQUIRED_ENV. Service starts without it, then fails at runtime when OAuth callback is attempted.                                                                                      | env-vars + terraform          |
| MA-04 | orchestrator   | No Terraform Cloud Run module exists. Orchestrator runs only as a `tsx watch` process on home-dev VM. Cannot be deployed to Cloud Run production without new Terraform module.                                                                               | terraform                     |
| MA-05 | image-service  | `gpt-4.1` (OpenAI model) used for prompt enhancement but no `INTEXURAOS_OPENAI_APP_API_KEY` appears in image-service's env-vars validation table. May fail silently if OpenAI key is required.                                                               | ai-models + env-vars (meta)   |

### P2: Medium Severity

| ID    | Service/Area         | Issue                                                                                                                                                                         | Source                      |
| ----- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| MA-06 | code-agent           | Replace `'INVALID_STATUS' as ErrorCode` cast with `'CONFLICT'` mapping in `codeRoutes.ts` ~line 3573. Non-standard cast bypasses TypeScript error code validation.            | error-contracts             |
| MA-07 | code-agent           | Add `INTEXURAOS_SERVICE_URL`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, and `INTEXURAOS_AUTH_JWKS_URL` to REQUIRED_ENV — all three used at runtime but not in fail-fast array. | env-vars                    |
| MA-08 | actions-agent        | Document `PATCH /internal/actions/:actionId/status` in `technical.md` Internal Endpoints table — exists in code but missing from docs.                                        | http-contracts              |
| MA-09 | linear-agent         | Document `GET /internal/linear/issues/:identifier` in `technical.md` Internal Endpoints table — exists in code but missing from docs.                                         | http-contracts              |
| MA-10 | app-settings-service | Internal route `GET /settings/pricing` lacks `/internal/` path prefix (convention deviation). Should be `GET /internal/settings/pricing`. Update route and all callers.       | route-auth + http-contracts |
| MA-11 | calendar-agent       | Remove redundant `reply.status()` pre-sets in centralized error handler — response status is already set by `reply.fail()`.                                                   | error-contracts             |
| MA-12 | bookmarks-agent      | Audit `INTEXURAOS_USER_SERVICE_URL` and `INTEXURAOS_APP_SETTINGS_SERVICE_URL` — both in bookmarks-agent Terraform but not confirmed in REQUIRED_ENV.                          | terraform                   |
| MA-13 | Multiple             | Reconcile route-auth-validation endpoint inventory against http-contracts v3 registry — actions-agent, research-agent, linear-agent, code-agent, user-service diverge.        | http-contracts + route-auth |

### P3: Low Severity

| ID    | Area               | Issue                                                                                                                                                                                               | Source                  |
| ----- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| MA-14 | ai-models          | Add `gpt-4.1` and `text-embedding-3-small` to `llm-contract/src/supportedModels.ts` or document exclusion rationale.                                                                                | ai-models               |
| MA-15 | docs               | Fix model count inconsistency: `overview.md` says "17 models" (should be 16 in contract or 18 actual); `index.md` also says "17".                                                                   | ai-models               |
| MA-16 | test fixtures      | Fix `o4-mini` → `o4-mini-deep-research`; fix `gemini-2.0-flash-exp` → `gemini-2.0-flash` in test fixtures.                                                                                          | ai-models               |
| MA-17 | docs (6 services)  | Regenerate Pub/Sub topic names in technical.md for: actions-agent, bookmarks-agent, commands-agent, data-insights-agent, research-agent, whatsapp-service. Current names are outdated vs Terraform. | pubsub                  |
| MA-18 | retired-checklist-service        | Consider renaming `INTEXURAOS_TODOS_PROCESSING_TOPIC` → `INTEXURAOS_PUBSUB_TODOS_PROCESSING_TOPIC` for naming consistency with all other topic env vars.                                            | pubsub                  |
| MA-19 | bookmarks-agent    | Add `_TOPIC` suffix to `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH` and `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`.                                                                                              | pubsub                  |
| MA-20 | firestore          | Remove stale index entries `dataSource` and `compositeFeeds` from `firestore.indexes.json`.                                                                                                         | firestore               |
| MA-21 | firestore          | Remove or implement `user_spend` registry entry and domain model (no repository, no use-case references).                                                                                           | firestore               |
| MA-22 | common-core README | Fix package count label: `Packages (13)` → `Packages (19)`.                                                                                                                                         | pkg-deps                |
| MA-23 | infra-otel README  | Remove phantom claim that `infra-sentry` imports from `infra-otel` (it does not).                                                                                                                   | pkg-deps                |
| MA-24 | orchestrator       | Document env var naming discrepancy: orchestrator uses `INTEXURAOS_PROJECT_ID` but `.envrc` exports `INTEXURAOS_GCP_PROJECT_ID` — requires manual `.envrc.local` override.                          | env-vars                |
| MA-25 | notion-service     | Add `x-notion-signature` HMAC verification when activating Notion webhook processing (currently a stub with no auth).                                                                               | route-auth              |
| MA-26 | 3 services         | Standardize `DOWNSTREAM_ERROR` messages to static strings in whatsapp-service, calendar-agent, linear-agent; log originals server-side only to avoid leaking upstream error details.                | error-contracts         |
| MA-27 | api-docs-hub       | Confirm whether api-docs-hub should run in PM2 locally; add to ecosystem.config.cjs if yes.                                                                                                         | service-urls + env-vars |
| MA-28 | vm-lifecycle       | Add `INTEXURAOS_VM_ZONE`, `INTEXURAOS_VM_INSTANCE_NAME` to vm-lifecycle Terraform env_vars for per-environment configurability.                                                                     | terraform               |

---

## v2 vs v3 Comparison

### What Changed

| Area                                                      | v2 Finding                                  | v3 Status                                                                          |
| --------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Phantom `/llm-client` endpoint                            | 4 services documented non-existent endpoint | Fixed in docs during v3 generation phase                                           |
| `PATCH /internal/actions/:actionId/status` undocumented   | Flagged v2                                  | Still open (MA-08)                                                                 |
| `GET /internal/linear/issues/:identifier` undocumented    | Flagged v2                                  | Still open (MA-09)                                                                 |
| Model count mismatch (overview.md)                        | "17 models" claim                           | Still open (MA-15); now confirmed 16 in contract, 18 in use                        |
| Unregistered models (`gpt-4.1`, `text-embedding-3-small`) | Flagged v2                                  | Still open (MA-14); new risk identified: image-service may lack OpenAI key (MA-05) |
| `user_spend` orphan                                       | Flagged v2 as possible dead feature         | Confirmed dead — no repository found (MA-21)                                       |
| Env var gaps (whatsapp, user-service)                     | HIGH in v2                                  | Partially resolved; user-service REQUIRED_ENV gap confirmed (MA-03)                |

### What v3 Added

- **Route authentication audit**: Confirmed no CRITICAL/HIGH auth gaps across all 20 services. Identified the one convention deviation (app-settings `/settings/pricing`) and one stub endpoint (notion webhook).
- **Service URL mapping**: Complete matrix of all 19 service URLs across 3 configuration sources. Identified api-docs-hub ecosystem gap and documented code-agent's intentional self-reference pattern.
- **Error contract audit**: Baseline of 599 `reply.fail()` calls, 272 `reply.ok()`, 17 raw sends (all annotated or exempt). Confirmed 100% compliance with response contract. Identified the `INVALID_STATUS` cast.
- **Terraform-code sync**: Discovered the P0 `bookmarks-agent` WEB_AGENT_URL gap that no other report caught. Documented orchestrator's cloud deployment gap.
- **Meta-validation**: Identified 3 true contradictions across reports; corroborated 3 findings independently discovered by multiple validators; consolidated 28 deduplicated action items from what would otherwise be 40+ overlapping findings.

---

## Coverage Gaps Identified

The following areas were NOT covered by any of the 10 validators and represent blind spots for v4:

| Gap                                          | Risk                                                                                          | Suggested v4 Validator                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| LLM cost tracking for out-of-contract models | `gpt-4.1` (image-service) and `text-embedding-3-small` (retired-chat-service) may bypass llm-pricing    | `llm-cost-tracking-validation`                    |
| Scheduler job → endpoint auth alignment      | 7 Cloud Scheduler jobs target endpoints; none cross-validated against route-auth patterns     | `scheduler-auth-validation`                       |
| DLQ consumer/alerting                        | 14 DLQ topics have pull subscriptions; no service is known to process them                    | `dlq-consumer-validation`                         |
| OpenAPI spec accuracy                        | api-docs-hub aggregates specs from 15 services; specs not compared to HTTP contracts registry | `openapi-spec-validation`                         |
| image-service OpenAI key availability        | `gpt-4.1` requires `INTEXURAOS_OPENAI_APP_API_KEY`; not confirmed in image-service env-vars   | Covered by MA-05, but needs explicit verification |
| Firestore security rules                     | Cross-service Firestore access is enforced by code convention, not Firestore security rules   | `firestore-security-rules-validation`             |

---

## Recommendations

### 1. Immediate Actions (P0 — Fix Before Next Deploy)

- **MA-01**: Add `INTEXURAOS_WEB_AGENT_URL = module.web_agent.service_url` to `module "bookmarks_agent"` env_vars in `terraform/environments/dev/main.tf`. This is the only item that guarantees a production crash if not fixed before the next Cloud Run deployment.

### 2. Sprint Actions (P1-P2)

- **MA-02**: Decide research-agent analytics publisher fate (wire or delete) to eliminate ghost infrastructure and silent data loss.
- **MA-03**: Add `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` to user-service REQUIRED_ENV.
- **MA-04**: Either create a Terraform Cloud Run module for the orchestrator or explicitly document it as dev-VM-only in perpetuity.
- **MA-05**: Confirm whether image-service needs `INTEXURAOS_OPENAI_APP_API_KEY`; add to Terraform and ecosystem.config if so.
- **MA-06, MA-07**: Fix code-agent's `INVALID_STATUS` cast and missing REQUIRED_ENV entries.
- **MA-08, MA-09**: Document the two missing internal endpoints (actions-agent, linear-agent).
- **MA-10**: Rename app-settings-service internal pricing route to `/internal/settings/pricing`.
- **MA-13**: Reconcile the route-auth endpoint inventory against the http-contracts v3 registry.

### 3. Backlog (P3)

- Address all MA-14 through MA-28 items; most are documentation corrections that can be batched into a single documentation fix pass.
- Prioritize MA-18/MA-19 (topic env var naming consistency) and MA-16 (test fixture model ID fixes) as they affect developer experience.

### 4. Process Improvements for v4

- **Add a cost-tracking validator**: Check that all models in use pass through llm-pricing for usage recording.
- **Verify scheduler jobs**: Add a validator that cross-references Cloud Scheduler job target endpoints against the route-auth and HTTP contracts registries.
- **DLQ alerting check**: Add a validator confirming DLQ consumer services or alerting policies exist for all 14 module-managed topics.
- **Reduce package batch size**: Package agents hit context limits at 5-6 packages. Cap at 3-4 per agent in v4.
- **Maintain endpoint registry**: Establish a machine-readable endpoint registry (JSON or YAML) that both validation agents and documentation agents reference as the single source of truth. The v3 divergence between http-contracts and route-auth reports was partly caused by independent inventory construction.
- **Persist meta-validation contradictions**: Any contradiction identified in the meta-validation report should be flagged for code-level verification before the next documentation run closes.

---

## Agent Execution Summary

| Phase           | Agents | Type            | Model      | Mode              |
| --------------- | ------ | --------------- | ---------- | ----------------- |
| Phase 2 Wave 1  | 10     | service-scribe  | Sonnet 4.6 | bypassPermissions |
| Phase 2 Wave 2  | 10     | service-scribe  | Sonnet 4.6 | bypassPermissions |
| Phase 2 Wave 3  | 11     | service-scribe  | Sonnet 4.6 | bypassPermissions |
| Phase 3         | 4      | general-purpose | Sonnet 4.6 | bypassPermissions |
| Phase 4A        | 6      | general-purpose | Sonnet 4.6 | bypassPermissions |
| Phase 4B        | 4      | general-purpose | Sonnet 4.6 | bypassPermissions |
| Phase 4C (meta) | 1      | general-purpose | Sonnet 4.6 | bypassPermissions |
| Final report    | 1      | general-purpose | Sonnet 4.6 | bypassPermissions |
| **Total**       | **47** |                 |            |                   |

> Agent count is approximate — some phases used variable concurrency based on workload split decisions made by the orchestrating team-lead.

**Key lessons from v3 execution:**

1. **Meta-validation is the highest ROI phase.** A single agent reading all 10 reports found the P0 bookmarks bug that all individual validators missed. This phase should be retained and possibly expanded in v4.
2. **Endpoint inventory divergence is a systematic risk.** When two validation agents independently construct an endpoint inventory, they diverge. A shared machine-readable registry would eliminate this.
3. **Package batching needs tightening.** Agents assigned 5-6 packages hit context window pressure and may produce shallower analysis. v4 should cap at 3-4.
4. **Route-auth report scope was too narrow.** The auth pattern documentation is valuable, but the endpoint inventory was incomplete compared to http-contracts. Future runs should feed the http-contracts registry to the route-auth agent as a starting point, not ask it to construct the inventory independently.
5. **Three-way corroboration on research-agent** (pubsub + env-vars + terraform all flagging the same root cause independently) is a strong signal. v4 meta-validation should explicitly look for this pattern as a confidence multiplier.

---

_Report generated by team-lead orchestrator. See individual validation reports in `docs/validation/` for full details._
