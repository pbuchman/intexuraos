# System Refactoring Analysis — 2026-04-24

**Linear issue:** [INT-1473](https://linear.app/pbuchman/issue/INT-1473/identify-and-document-system-refactoring-areas-for-microservices)
**Prepared by:** 10 parallel Opus analyst agents (senior-architect role)
**Scope:** Full monorepo (`apps/`, `workers/`, `packages/`, `terraform/`, `docs/`, CI)

## Executive Summary

IntexuraOS has a coherent macro-architecture (Fastify services, Cloud Functions workers,
shared packages, Terraform-managed Cloud Run, Firestore single-owner model) and genuine
guardrails (ServiceContainer DI, `validateRequiredEnv`, 95% branch-coverage threshold,
immutable-migrations rule, `firestore-collections.json` registry). The foundation is
solid.

The weaknesses surface at the seams — wherever one concept crosses two files, two
services, or two layers. The same dozen boilerplate blocks (Fastify bootstrap,
internal-auth helpers, logger setup, env-var validation, Firestore repository CRUD,
markdown-JSON-Zod parsing, HTTP client wrappers) are duplicated 10–21 times with
subtle drifts. Cross-cutting contracts the platform depends on (request-ID propagation,
Pub/Sub consumer ack/nack, prompt-version enforcement, env-var 3-location rule,
migration immutability) are under-enforced by CI, so drift accumulates silently until
an incident exposes it.

Nothing here is catastrophic; nothing here is aesthetic. Every finding in this report
either (a) has already caused production incidents, (b) blocks future cost/observability
work, or (c) taxes every new service added to the system. This report consolidates ten
independent audits into a prioritised refactoring backlog with one Linear issue per
area.

## Methodology

Ten Opus analyst agents were dispatched in parallel, each scoped to a disjoint area of
the system. Each agent:

1. Read the relevant CLAUDE.md rules and architecture docs.
2. Walked the codebase for their area (reading source, grepping for patterns,
   cross-referencing contracts).
3. Produced structured findings with severity, affected files (with line numbers),
   evidence, problem statement, concrete refactoring recommendation, and effort
   estimate.
4. Proposed one consolidated Linear issue for their area.

No agent was instructed to produce a fix. All agents returned only analysis. This
report aggregates and cross-references their outputs.

## Finding Areas

Ten analyst areas, producing ~100 individual findings:

| #   | Area                                            | Linear Priority   | Sub-issue   | Key Concern                                                            |
| --- | ----------------------------------------------- | ----------------- | ----------- | ---------------------------------------------------------------------- |
| 1   | Backend Apps Architecture                       | High              | INT-1529    | ServiceContainer DI drift, ~4.5k LoC duplicated server bootstrap       |
| 2   | Workers Layer                                   | Medium            | INT-1530    | Mixed deployment models, Pub/Sub ack/nack inconsistency                |
| 3   | Service-to-Service Communication                | High              | INT-1531    | Duplicated HTTP clients, no request-ID propagation, weak OIDC          |
| 4   | Firestore Data Layer                            | High              | INT-1532    | Migration-immutability violations, orphaned indexes, repo drift        |
| 5   | LLM / AI Stack                                  | High              | INT-1533    | Incomplete factory, un-versioned prompts, dropped cost attribution     |
| 6   | Web App Frontend                                | High              | INT-1534    | No code splitting, SRP violations, hook/service test gaps              |
| 7   | Testing & Coverage                              | Medium            | INT-1535    | v8-ignore explanation quality, workspace config divergence             |
| 8   | Infrastructure / Env Vars / CI-CD               | High              | INT-1536    | 3-location env-var drift, monolithic Terraform, pnpm version drift     |
| 9   | Shared Packages                                 | High              | INT-1537    | Domain leakage in `common-core` / `infra-pubsub`, peer-dep gaps        |
| 10  | Observability & Error Handling                  | High              | INT-1538    | Workers un-instrumented, no trace propagation, Sentry unhardened       |

---

## 1. Backend Apps Architecture

### Summary

The `apps/` layer has a consistent macro-shape (Fastify + `services.ts` DI +
`domain/routes/infra` split) and correctly uses shared packages for cross-cutting
primitives. However, the micro-shape has drifted significantly across the ~22 services:
four different DI init patterns, three use-case directory conventions
(`usecases`/`useCases`/`use-cases`), duplicated Fastify/OpenAPI/health-check bootstrap
(~4,568 LoC of near-identical `server.ts`), a locally-redefined `MinimalLogger` instead
of `Logger` from `common-core`, inconsistent error-response patterns (`reply.fail` vs
raw `reply.code().send()` vs `{ error }`), and at least two bloated route files in
`code-agent` / `research-agent` that mix transport, validation, and domain logic.

### Top Findings

- **Four incompatible ServiceContainer / DI initialization patterns** (Important) —
  three distinct init function names (`initializeServices` / `initServices` / lazy
  `getServices(logger)`), three distinct config-passing styles, two `setServices`
  signatures. Evidence: `apps/user-service/src/services.ts:103`,
  `apps/notion-service/src/services.ts:105`,
  `apps/whatsapp-service/src/services.ts:94`,
  `apps/app-settings-service/src/services.ts:9`.
- **Duplicated Fastify/OpenAPI/health-check bootstrap** (Important) — 21 × ~220-line
  `server.ts` files reimplement logger/cors/swagger/auth/sentry/quiet-health/
  `/health`/`/openapi.json` with subtle variations. Per-service OpenAPI components
  are redeclared despite existing shared `registerCoreSchemas`.
- **Use-case directory naming + `MinimalLogger` drift** (Minor) — `calendar-agent`
  uses `useCases`, `cron-agent` uses `use-cases`, everyone else uses `usecases`;
  `notes-agent` and `todos-agent` redeclare `MinimalLogger` instead of importing
  `Logger` from `common-core` (direct CLAUDE.md violation).
- **Oversized route files with domain leakage** (Important) —
  `apps/code-agent/src/routes/code/task-routes.ts` is 3,260 LoC;
  `apps/research-agent/src/routes/researchRoutes.ts` is 1,630 LoC;
  `apps/code-agent/src/routes/webhooks/complianceReport.ts` writes directly to
  Firestore, bypassing the repository layer.
- **Duplicated internal-auth helpers** (Minor) — `authenticateInternalScheduler` /
  `authenticateInternalPubSub` / `validateSchedulerOrInternalAuth` /
  `validatePubSubOrInternalAuth` are four near-identical implementations in
  `code-agent`, `commands-agent`, `linear-agent`, `actions-agent`. `mobile-
  notifications-service/digestRoutes.ts` additionally reads
  `process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN']` inline three times.
- **Inconsistent bootstrap/lifecycle** (Minor) — Sentry DSN is required in some
  services, optional in others; several services (`notion-service`,
  `whatsapp-service`, `linear-agent`) have no SIGTERM/SIGINT handlers at all;
  `actions-agent`'s `main().catch()` swallows startup errors.
- **REQUIRED_ENV anti-patterns** (Minor) — `apps/actions-agent`, `apps/todos-agent`,
  `apps/linear-agent` cast env values `as string` or use `?? ''` fallbacks after
  `validateRequiredEnv`, defeating validation.
- **Inconsistent HTTP error shape** (Minor) — 34 occurrences across 8 files use
  `reply.code(401).send({ error })` instead of the standard `reply.fail(...)`
  envelope.
- **CRUD repository duplication** (Minor) — `notes-agent`, `todos-agent`,
  `bookmarks-agent`, `commands-agent` each maintain ~150-LoC near-identical CRUD
  repos.
- **Inconsistent routes aggregation** (Cosmetic) — three styles: `routes/index.ts`,
  `routes/index.ts` + `routes/routes.ts`, or inline `server.ts` registration.

### Proposed Linear Issue

See [INT-1529](#a-int-1529--refactor-backend-apps--consolidate-service-bootstrap-di-and-routing-conventions-high).

---

## 2. Workers Layer

### Summary

The `workers/` folder contains five dissimilar projects sharing a directory but almost
nothing else: three true Cloud Functions (`log-cleanup`, `transcription`,
`vm-lifecycle`), one long-running Fastify server on a VM (`orchestrator`), and a
container image (`code-worker`) with no TypeScript source. Across the three genuine
Cloud Functions, each reinvents the same primitives (logger bootstrap, env-var
validation, `Logger` interface, internal-auth handling) with small but meaningful
drifts. Pub/Sub ack/nack is implemented differently per handler, creating silent
data-loss risk for `transcription`. No worker initializes Sentry, OTEL, or structured
request logging.

### Top Findings

- **Three workers redeclare the same `Logger` + pino bootstrap** (Important) —
  `log-cleanup`, `transcription`, `vm-lifecycle` each carry a 20-line copy; none use
  the existing `common-core/getLogLevel()` helper.
- **Env-var validation reinvented per worker; no `validateRequiredEnv`** (Important)
  — four different implementations (log-cleanup, transcription, vm-lifecycle,
  orchestrator); `vm-lifecycle/src/config.ts:1-15` silently falls back to hard-coded
  defaults so missing `INTEXURAOS_GCP_PROJECT_ID` deploys into the wrong project.
- **Pub/Sub ack/nack semantics inconsistent** (Critical) — `log-cleanup` throws on
  failure (redelivery); `transcription` `return`s on every parse/schema error
  (silent ACK, no DLQ). `docs/architecture/pubsub-standards.md` documents publisher
  conventions only, not consumer contract.
- **Internal-auth header format diverges in vm-lifecycle** (Important) —
  `vm-lifecycle/src/index.ts:13` expects `Bearer ${token}`; every other caller uses
  raw token in `X-Internal-Auth`. Cross-service calls would 401.
- **No Sentry / OTEL / `logIncomingRequest` in worker handlers** (Important) —
  `rg 'logIncomingRequest' workers/` → 0 matches. Only orchestrator has a bespoke
  `onResponse` structured-logger hook.
- **`workers/code-worker` is not a worker** (Minor structural) — no `src/`, no
  `package.json`, only Dockerfiles. Lives in the wrong folder.
- **`workers/orchestrator` is not a Cloud Function** (Important) — full Fastify
  server + 20 services + 8 bootstrap modules + 9-parameter `main()`. The
  architecture doc mislabels it.
- **`orchestrator/src/services/task-dispatcher.ts` is 3,030 lines** (Important) — a
  decomposition into `task-dispatcher/` has begun but the god-object core remains.
- **Shutdown polling loop with `save(await load())` no-op** (Minor) — brittle
  `while` loop at `main.ts:300-338`; no AbortController threaded to in-flight
  handlers.
- **Test scaffolds diverge; no shared worker test helper** (Minor).

---

## 3. Service-to-Service Communication

### Summary

Server-side primitives (`validateInternalAuth`, `intexuraFastifyPlugin`,
`BasePubSubPublisher`) are clean and reused consistently. The weak layer is the
**client** side: every caller hand-rolls its own `fetch(...)` + `X-Internal-Auth`
wrapper, producing 10+ near-duplicate HTTP clients in `apps/*/src/infra/http/`.
Observability is inconsistent — `X-Request-Id` is generated and logged but never
propagated on outbound calls. Authentication relies on a single static shared token
with no rotation story, and the `authenticateInternalScheduler` helper in code-agent
trusts any `Bearer …` header without verifying the OIDC token.

### Top Findings

- **Duplicated, inconsistent internal HTTP clients** (High) — 10+ near-duplicates in
  `apps/*/src/infra/http/*.ts`; `packages/internal-clients/src/shared/errors.ts`
  defines a helper that only one consumer uses.
- **`X-Request-Id` not propagated across service hops** (High) —
  `packages/common-http/src/http/requestId.ts:11` generates it on ingress; zero
  outbound clients forward it. `docs/architecture/api-contracts.md:115` explicitly
  mandates propagation.
- **OIDC validation that validates nothing** (High) —
  `apps/code-agent/src/routes/helpers/internalAuth.ts:25-29` and
  `apps/commands-agent/src/routes/helpers/internalAuth.ts:38-44` accept any
  `Authorization: Bearer xxx` as authenticated.
- **Single static internal-auth token, no rotation** (High) — one secret protects
  every `/internal/*` route in every service; rotating requires a synchronised
  redeploy of ~23 services.
- **No shared TypeScript types for request/response contracts** (Medium) —
  `http-contracts` exports only JSON Schemas; consumers redeclare response shapes
  (e.g. `research-agent/src/infra/notion/notionServiceClient.ts:13-26` mirrors
  types in `apps/notion-service` with no cross-link).
- **Inconsistent response envelope handling** (Medium) — some callers unwrap
  `{success, data}`, others cast raw JSON to the domain type.
- **Three competing correlation-ID headers** (Medium) — `X-Request-Id`, `X-Trace-Id`,
  OTel `traceparent`, none integrated.
- **Timeouts missing on most internal HTTP clients** (Medium) — only
  `calendarServiceHttpClient.ts` has proper 30s/60s AbortController timeout.
- **Topic-name env var hygiene inconsistent** (Low) — `pubsub-standards.md` lists
  6 topics, Terraform has ≥14; no single source of truth.
- **Fan-out of env-var wiring for endpoint discovery** (Low) — 20
  `INTEXURAOS_*_URL` vars duplicated across Terraform, web cloudbuild, web config,
  Vite proxy, `ecosystem.config.cjs`.

---

## 4. Firestore Data Layer

### Summary

The Firestore layer documents strong single-owner rules but enforces them post-hoc.
Git shows ~44 commits that modified already-merged migrations (including multiple
"revert formatting to restore checksum match" commits and an `079→081→082`
renumbering saga memorialised in placeholder files). `firestore.indexes.json` carries
~7 orphaned collectionGroups from a retired `data-insights-agent`. The repository
layer is split across two conventions inside `code-agent`, half of which the
ownership-verification script does not scan.

### Top Findings

- **Migrations IMMUTABLE rule is routinely violated** (High) — 44 commits modifying
  merged migrations; git log contains messages like `fix: revert migration 092
  formatting to restore checksum match`, `fix(migrations): undo bad 079→081
  rename to restore Firestore sync`.
- **`firestore.indexes.json` ↔ registry mismatch** (High) — 7 orphaned
  collectionGroups (`compositeFeeds`, `composite_feeds`,
  `composite_feed_snapshots`, `custom_data_sources`, `dataSource`, `visualizations`,
  `writing_samples` parent) have no code references.
- **Registry ↔ committed artifacts inconsistency** (High) — `firebase.json` points
  at `firestore.rules` which is gitignored but `firestore.indexes.json` is
  committed.
- **Cross-service ownership violation** (Medium) —
  `workers/orchestrator/src/scripts/view-metrics.ts:318-320` reads `code_tasks` +
  `turn_metrics` (owned by code-agent) directly.
- **Unbounded queries in backfills** (Medium) —
  `apps/code-agent/src/infra/migrations/agentRoutingContractMigration.ts` and
  `apps/code-agent/src/scripts/backfillGroupSummaries.ts` do
  `.collection('code_tasks').get()` with no pagination.
- **Repository layer inconsistency** (Medium) — `code-agent` splits repos across
  `src/infra/firestore/` and `src/infra/repositories/`; the ownership-verification
  script only scans the former.
- **Schema coupling via shared document** (Medium) — `whatsapp-service`'s two repos
  share `whatsapp_user_mappings/{userId}` with field-level ownership enforced only
  by prose comments.
- **Schema versioning / `any`-typed fields** (Medium) — no `schemaVersion` field;
  documents typed as all-optional inline types.
- **Stale registry entries without writers** (Low) — `pr_task_locks`, `user_spend`,
  `settings`, `github-pr-summaries` have no detectable references.
- **Test-infra: hardcoded legacy collection names** (XS) —
  `linearConnectionRepository.test.ts:273` uses `'linear-connections'` (dashed)
  vs production `'linear_connections'`; test silently no-ops.

---

## 5. LLM / AI Stack

### Summary

The layered LLM stack (`llm-contract`, `llm-factory`, `llm-pricing`, `llm-prompts`,
`llm-utils`, `infra-*`) fronted by a per-service `llm-usage-service` has a solid
foundation. But the "unified factory" is a misnomer — `createLlmClient()` only
accepts Google + OpenRouter, so every non-trivial caller instantiates provider SDKs
directly. CLAUDE.md's prompt-version rule is enforced only against typed
`PromptBuilder<>` declarations, so a dozen plain `buildXxxPrompt()` functions silently
bypass versioning. No infra client implements retry/backoff. No prompt caching.
`researchId` correlation is collected at the Gemini config layer but hardcoded to
`null` in the emitted usage event.

### Top Findings

- **`createLlmClient()` only supports 2 of 5 providers** (High) — research-agent
  runs a parallel factory (`apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`);
  ~1.5 kLOC of per-app adapter wrappers duplicate the package factory.
- **Prompt versioning rule bypassed by plain functions** (High) —
  `scripts/verify-prompt-versions.mjs:22` regex only matches typed
  `PromptBuilder<>`. Un-versioned plain-function prompts exist in research,
  synthesis, digest, validation-repair, chat-agent system, code-agent triage,
  code-agent cooloff, web-agent summary-repair.
- **Orchestrator maintains its own duplicate `PromptBuilder` interface** (Medium) —
  `workers/orchestrator/src/services/prompt-builder.ts` drifts from package.
- **No retry / backoff on any infra client** (High) — `grep retry|backoff|
  maxRetries packages/infra-*/src` returns zero matches; architecture doc promises
  retries.
- **`researchId` hardcoded to `null` in usage events** (High) —
  `packages/llm-pricing/src/buildUsageEvent.ts:81-88`. Breaks cost attribution for
  the flagship Research feature.
- **No prompt caching despite pricing math already wired** (Medium–High) —
  `costCalculation.ts` has `cacheReadMultiplier`/`cacheWriteMultiplier` but
  `infra-claude`/`infra-gpt` never set `cache_control`.
- **~25 files re-implement markdown → JSON → Zod pipeline** (Medium) — fix-once-
  apply-N concern.
- **Pricing table stale — missing Claude 4.7** (Medium).
- **Unknown-model cost silently defaults to $0** (Medium) —
  `ingestUsageEvents.ts:110-119` records `billedUsd: 0` with a warn log only.
- **Usage events POST one-by-one — no batching** (Low–Medium).
- **Orchestrator `ToolCallingClient` is Gemini-only, 5-iteration cap** (Low–Medium).
- **`llm-utils` is thin** (Low) — no token counter, no streaming helper, no
  structured-output helper.

---

## 6. Web App Frontend

### Summary

`apps/web` is ~21 kLOC over 41 pages / 30+ top-level components / 51 hooks / 36
services. Wiring is largely correct: `HashRouter`, `useApiClient` with Auth0, strict
TS flags. The main risks are (1) no route-level code splitting on a bundle that
already required a 5 MB PWA cache cap, (2) monolithic page/component files
(1,000+ LoC), (3) env-var drift between `cloudbuild.yaml`, `config.ts`, and the
Vite proxy, (4) route-table bloat with ~60 `<Route>` entries repeating identical
`ProtectedRoute` wrappers, and (5) hook/service/util test coverage gaps despite
CLAUDE.md requiring tests for those layers.

### Top Findings

- **No route-level code splitting** (High) — `apps/web/src/App.tsx:21-67` imports
  all 41 pages eagerly. Zero `React.lazy` matches. Bundle exceeds 4.5 MB.
- **Oversized page/component files violate SRP by 4–7×** (High) —
  `HomePage.tsx` 1,056 LoC, `ResearchAgentPage.tsx` 1,015, `Sidebar.tsx` 932,
  `LinearIssuesPage.tsx` 810, etc.
- **Env-var three-location rule drifts** (Medium) — `cloudbuild.yaml:29-30` fetches
  `image-service`/`web-agent` URLs but `config.ts` never consumes them.
- **`App.tsx` route table has ~60 entries with repeated `ProtectedRoute` wrappers**
  (Medium) — four near-identical loading-spinner blocks.
- **Hook/service/util test coverage gaps** (Medium) — 51 hooks vs 22 test files
  (~57%); 36 services vs 13 tests (~36%). Eight largest orchestrator hooks
  untested.
- **`public/action-config.yaml` templates `${INTEXURAOS_*_URL}` at runtime** (Medium)
  — invisible to the type system; config key renames silently break buttons.
- **`apiClient` lacks 401-refresh and retry; swallows non-envelope responses**
  (Medium).
- **`InboxPage` manages long-poll sync with refs + `useCallback`; stale-closure
  hazard** (Low).
- **No accessibility primitives; 10+ custom modals lack focus-trap / aria** (Low).
- **`framer-motion` in `devDependencies` but imported at runtime**
  (Low, packaging bug).

---

## 7. Testing & Coverage

### Summary

A disciplined baseline exists: 95% branch-coverage threshold, a single
`vitest.setup.ts`, a categorized `v8 ignore` whitelist enforced by hook + script.
430 `v8 ignore start` directives across 170 source files all include `@preserve`
and a valid category. Problems live at the edges: weak explanations that pass the
keyword allowlist but describe code rather than the testing blocker; workspace
vitest configs that silently drop the root `setupFiles`; every app maintains its
own `fakes.ts` with no shared `test-utils` package; `task-dispatcher.ts` alone
carries 50 v8 ignores rooted in an under-powered fake.

### Top Findings

- **v8 ignore explanations pass the keyword gate but describe the code** (Medium)
  — `researchRoutes.ts` has 32 ignores, 9 of which are identical `ts-type:
  conditional property assignment based on undefined check`.
- **`task-dispatcher.ts` v8-ignore concentration** (High) — 50 ignores; 20+ cite
  `FakeIsolationProvider` limitations.
- **No shared `@intexuraos/test-utils` package** (Medium) — 15 services each own a
  `fakes.ts`; `FakeLogger`, `FakeAuth`, `FakeHttpClient`, `FakeFirestore`-+-
  Timestamp shims duplicated.
- **Workspace vitest configs drop the root `setupFiles`** (High) —
  `apps/chat-agent/vitest.config.ts`, `apps/cron-agent`, `apps/hellscript-agent`,
  `apps/web`, `e2e`, `migrations`, `packages/infra-otel`,
  `packages/internal-clients` all miss the global Firebase/Notion/fetch setup.
- **Two packages declare coverage with no thresholds** (Medium) — `infra-otel`,
  `internal-clients`.
- **Real-time `setTimeout` waits in orchestrator tests waste 30+ seconds**
  (Medium) — `log-forwarder.test.ts` has four `setTimeout(7000)` blocks.
- **`vi.mock('node:fs'|'node:child_process')` violates "in-memory fakes only"**
  (Low) — 8 files; no documented category.
- **E2E suite is a single 390-line spec and excluded from `ci:tracked`** (Medium).
- **`describe.skip('Mock Code Agent')` stub test should be deleted** (Low).
- **`setServices()` called ~3.3× more than `resetServices()` — leak risk** (Low).
- **`.fixture.ts` / `fake*.ts` exclusion inconsistent across configs** (Low).

---

## 8. Infrastructure / Env Vars / CI-CD

### Summary

Infrastructure is largely Terraform-managed (21 Cloud Run services in a 2,988-line
`main.tf`), with a consistent `cloud-run-service` module, Secret Manager for app
secrets, and a `smart-dispatch` CI pipeline. Startup validation via
`validateRequiredEnv()` is used in 21/22 services. However, the triple-location
env-var contract is manually maintained and drift is visible today.

### Top Findings

- **Web-app `CLOUD_RUN_SERVICES` list duplicated in 3 places and silently drifts**
  (High) — `apps/web/cloudbuild.yaml:14-35` has 20 entries; both `deploy.yml`
  branches have 18 (missing `image-service`, `web-agent`).
- **Secret Manager secrets declared but never mounted** (High) — 8 secrets in
  `main.tf:520-531` have no consumers.
- **Services missing from `ecosystem.config.cjs`** (High) — `api-docs-hub`,
  `cron-agent`, `hellscript-agent`, `llm-usage-service`, `web-agent`.
- **Dead env var `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`** (Medium) — set in
  Terraform, read nowhere.
- **`api-docs-hub` missing `validateRequiredEnv`** (Medium).
- **pnpm version drift across Dockerfiles and CI** (Medium) — 8, 9, 10, `@latest`
  all ship in the same repo.
- **No `prod` Terraform environment despite documented prod tier** (High) — only
  `terraform/environments/dev/` exists.
- **`deploy.yml` MONOLITH and INDIVIDUAL branches duplicate ~80 lines of web-config
  logic** (Medium).
- **21 copy-paste Dockerfiles** (Medium) — byte-for-byte identical except service
  name; 21 near-identical deploy scripts.
- **`ecosystem.config.cjs` drifts from Terraform for PubSub topic names** (Medium)
  — INT-1451 fixed whatsapp-service; not generalised.
- **`terraform/environments/dev/main.tf` is a 2,988-line monolith** (Medium).
- **Cloud Run `secrets` block re-declared per-service** (Low).

---

## 9. Shared Packages

### Summary

Strong TypeScript hygiene (no `any` in source, strict base tsconfig), consistent
kebab-case naming, sensible top-level split. However, the "leaf package" contract
is violated: domain knowledge (Linear labels, code-task worker IDs, service catalog,
plan-path resolution) has leaked into `common-core`; `infra-pubsub` embeds
per-integration publishers; `http-server` ships a Notion-specific health helper;
`common-http` depends on `llm-utils` only to pull generic redaction. Docs are
materially stale (`packages/README.md` references phantom `infra-glm` and
`llm-audit`). 11 of 21 packages have no README. Dependency hygiene has bugs:
`llm-pricing` declares a dead `infra-firestore` dep; two packages pin divergent
`openai` majors; no `peerDependencies` anywhere.

### Top Findings

- **Domain logic in `common-core`** (High) — `labels.ts`,
  `codeTaskWorkerTypes.ts`, `internalServiceCatalog.ts`, `planPathResolver.ts`
  all encode domain knowledge.
- **`infra-pubsub` contains domain-specific publishers** (High) —
  `CalendarPreviewPublisher`, `WhatsappSendPublisher`, `TodosProcessingPublisher`,
  `PRTriagePublisher` all live in a supposedly-generic wrapper package.
- **`http-server.checkNotionSdk` is integration-specific** (Medium) —
  single-consumer helper with Notion-specific text in a generic package.
- **Inverted dependency: `common-http` → `llm-utils`** (Medium) — for generic
  redaction helpers that belong in `common-core`.
- **Divergent runtime dep versions + no `peerDependencies`** (Medium) — `openai`
  `^5.3.0` vs `^6.15.0`; `fastify` `^5.1.0` vs `^5.2.0`; no peers anywhere.
- **Dead exports / dead dependencies** (Medium) — `serviceFeedback`, nullability
  helpers, `llm-pricing → infra-firestore`.
- **Inconsistent build output** (Medium) — 4 of 21 packages emit `dist/`; CLAUDE.md
  asserts `packages/*/dist/` must exist.
- **Missing READMEs on 11/21 packages; architecture doc stale** (Low).
- **`llm-prompts` uses `export *` wildcards** (Low).
- **`internal-clients/shared/errors.ts` dynamic `await import`** (Low).
- **`normalizeUsage` duplicated across 5 infra-* packages with drifted signatures**
  (Low).
- **`http-server` depends on `infra-firestore`** (Low) — upstream→infra chain
  drags Firestore into every HTTP consumer.

---

## 10. Observability & Error Handling

### Summary

A well-designed observability foundation (`packages/infra-sentry`,
`packages/infra-otel`, `packages/common-core/errors`) but adoption is uneven. HTTP
services initialize Sentry and bolt on OTel via Dockerfile `--import`; all five
workers skip both. Trace/correlation propagation stops at process boundaries.
Sentry has no `beforeSend`, no custom PII scrubbing, no `tracesSampleRate`, no
release tagging. LLM calls track tokens/cost but not latency. Six Cloud Monitoring
alerts exist, all gated on `var.alert_email` which defaults to `null`.

### Top Findings

- **Workers completely un-instrumented** (High) — no Sentry, no OTel in
  orchestrator / vm-lifecycle / transcription / log-cleanup / code-worker.
- **No end-to-end trace correlation across HTTP + Pub/Sub boundaries** (High) —
  internal HTTP clients don't forward `x-request-id`; Pub/Sub publishers mint
  fresh `correlationId`.
- **Sentry has no `beforeSend`, sampling, release, PII scrubbing** (High) —
  `packages/infra-sentry/src/init.ts:42-59`. Arbitrary structured fields sent to
  Sentry via `scope.setExtras`.
- **Silent catch blocks swallow VM-lifecycle failures** (Medium) —
  `workers/vm-lifecycle/src/start-vm.ts:129-131`, `stop-vm.ts:57-59`, `:104-107`.
- **`IntexuraOSError` exists but is rarely adopted** (Medium) — most throws are
  plain `Error`; Fastify handler maps all to opaque 500.
- **LLM / external-API calls have no latency instrumentation** (Medium).
- **Alerts gated on `alert_email` that defaults to `null`** (Medium).
- **Pino transport duplicates stream construction across `createAppLogger` and
  `createLogStream`** (Low).
- **Empty-object `logger.error({}, …)` loses context; `err` vs `error` mix** (Low).
- **No business metrics emitted from code — custom descriptors declared-only**
  (Medium) — dashboard panels show "no data".
- **Sentry error context drops stack when `err` is missing from log payload** (Low).
- **`logIncomingRequest` compliance not enforced on all endpoints** (Low).

---

## Cross-Cutting Themes

Several themes recur across multiple areas and warrant mention as meta-findings:

1. **The three-location env-var rule is fragile** — it appears in areas #3, #6,
   #8; CLAUDE.md explicitly warns about it but there is no static enforcement. A
   single registry-driven generator would collapse all three failure modes.
2. **Duplication of "HTTP client + auth + error mapping"** appears in areas #1,
   #3, #5, #10 (each in a different shape). A single `createInternalHttpClient()`
   primitive with logger/trace/token/timeout is table stakes.
3. **CI scripts often use narrow regexes that miss obvious bypasses** —
   `verify-prompt-versions.mjs` (#5) misses plain-function prompts;
   `verify-v8-ignore` (#7) accepts weak explanations; `verify-firestore-ownership`
   (#4) skips `workers/` and `scripts/`. Hardening these gates is cheap.
4. **Domain leakage into packages** — `common-core` (#9), `infra-pubsub` (#9),
   `http-server` (#9). Each violation breeds more violations because "there's
   already domain code in here".
5. **Workers are second-class citizens** — (#2, #10) worker observability, DI,
   env-var validation, test patterns all lag the apps story. Either workers need a
   `common-worker` kit or their role should be consolidated into apps.
6. **The orchestrator is mis-placed** — (#2, #5, #9) it is treated as a worker but
   behaves like an app and maintains duplicate versions of shared interfaces.

## Proposed Linear Issues

Each area below becomes one Linear sub-issue under INT-1473. Issues are intentionally
kept at the "plan + bullets" level (per the task brief — no full specs).

### A. INT-1529 — `Refactor: Backend apps — consolidate service bootstrap, DI, and routing conventions` (High)

Canonicalize ServiceContainer init + bootstrap: shared `createFastifyApp` /
`startFastifyService` in `@intexuraos/http-server`; single `loadEnv(keys)`; delete
local `MinimalLogger`; canonicalize `domain/usecases/`; split oversized route files;
move internal-auth helpers to `common-http`; introduce generic CRUD repository in
`infra-firestore`.

### B. INT-1530 — `Refactor: Workers layer — unify bootstrap, observability, and Pub/Sub contract` (Medium)

New `packages/common-worker` with `createWorkerLogger`, `loadRequiredEnv`,
`withObservability` (Sentry + structured log + ack/nack), test helpers. Document and
enforce Pub/Sub consumer contract with DLQ topics. Relocate `workers/code-worker`;
decide whether `workers/orchestrator` moves to `apps/orchestrator`. Continue
`task-dispatcher.ts` decomposition.

### C. INT-1531 — `Refactor: Service-to-service communication — unify HTTP client, propagate traces, harden auth` (High)

Single `createInternalHttpClient` in `internal-clients`; mandatory `X-Request-Id`
propagation with verify script; real Google OIDC verification in
code-agent/commands-agent scheduler auth; dual-token support in
`validateInternalAuth` for zero-downtime rotation; Zod/Typebox schemas in
`http-contracts` with shared TS types; mandated envelope on every `/internal/*`.

### D. INT-1532 — `Refactor: Firestore data layer — enforce migration immutability, reconcile indexes, unify repository layer` (High)

Tighten `verify-migrations.mjs` to block edits to merged migrations; extend
ownership-verification to `workers/` and `scripts/`; cleanup migration for orphaned
indexes; commit policy for generated artifacts; relocate `view-metrics.ts`; replace
unbounded `.collection().get()` calls; consolidate code-agent repositories; split
shared `whatsapp_user_mappings` document.

### E. INT-1533 — `Refactor: LLM/AI stack — unify factory, enforce prompt versioning, close cost-attribution & caching gaps` (High)

Complete `createLlmClient` across all 5 providers; delete parallel research-agent
factory; widen prompt-version regex to flag plain `buildXxxPrompt` functions; thread
`researchId`/`sessionId`/`taskId` through usage events; `withRetry()` in `llm-utils`
honoring `Retry-After`; `generateStructured()` helper; wire Anthropic/OpenAI prompt
caching; batch usage events; add Claude 4.7 pricing.

### F. INT-1534 — `Refactor: Web app frontend — code-split, extract SRP violations, close test gaps, dedupe env-var wiring` (High)

Convert all routes in `App.tsx` to `React.lazy` + `Suspense`; Rollup `manualChunks`
for heavy vendors; split top-5 oversized files (HomePage, Sidebar, ResearchAgentPage,
InboxPage, LinearIssuesPage); align env-var wiring across
`cloudbuild.yaml`/`config.ts`/`vite.config.ts` with a CI check; back-fill tests for
8 largest untested hooks + untested services; harden `apiClient` (401 refresh,
X-Request-Id); adopt `@radix-ui/react-dialog`; fix `framer-motion` packaging.

### G. INT-1535 — `Refactor: Testing & coverage — tighten v8-ignore gate, extract shared test-utils, standardize vitest configs` (Medium)

Tighten `verify-v8-ignore` to require blocker noun phrases + duplicate-explanation
detection; new `packages/test-utils` for shared fakes; `vitest.shared.ts` inherited
by all workspace configs; refactor `FakeIsolationProvider`; rewrite
`log-forwarder.test.ts` with `vi.useFakeTimers()`; expand E2E coverage and wire to
nightly CI; ESLint rule coupling `setServices` with `afterEach(resetServices)`.

### H. INT-1536 — `Refactor: Infrastructure & env-var management — drift, duplication, and enforcement` (High)

Single-source `CLOUD_RUN_SERVICES` from `apps/web/service-manifest.json`; extend
`verify-env-vars.mjs` with reverse Terraform→code check and
registry→`ecosystem.config.cjs` check; extend `verify-terraform-secrets.mjs` to
require every secret be mounted; add `validateRequiredEnv` to `api-docs-hub`; pin
pnpm via `packageManager` in root; collapse 21 Dockerfiles to one shared
`docker/Dockerfile.service`; split `main.tf` into concerns; create `prod/`
environment (or correct the docs).

### I. INT-1537 — `Refactor: Shared packages — enforce leaf contract, prune domain leakage, align deps` (High)

Move domain code out of `common-core` (`labels`, `codeTaskWorkerTypes`,
`planPathResolver`, `internalServiceCatalog`) to owning apps or domain packages;
slim `infra-pubsub` to `BasePubSubPublisher` only; delete `http-server.checkNotionSdk`;
move generic redaction from `llm-utils` to `common-core`; align `openai` and
`fastify` via pnpm catalog + `peerDependencies`; remove dead exports/deps; regenerate
`packages/README.md` + `package-contracts.md` from filesystem truth; decide
source-exports vs `dist` uniformly.

### J. INT-1538 — `Refactor: Observability & error handling — unify instrumentation, propagate traces, enforce typed errors` (High)

Add `initSentry` + OTel preload to every `workers/*`; propagate `x-request-id`
through internal HTTP clients and Pub/Sub publishers via AsyncLocalStorage; harden
Sentry init (`beforeSend`, release, sampling, PII scrub); convert domain `throw new
Error` to `IntexuraOSError`; wrap LLM provider calls in OTel spans; replace silent
catches in `vm-lifecycle`; emit `code_tasks_*` metrics via a new `common-metrics`
wrapper; Slack alert channel; `verify-incoming-request-logging.mjs`.

## Next Steps

1. Each issue A–J is filed as a sub-issue under INT-1473.
2. Issues B (workers) and G (testing) should start first — they have the lowest
   blast radius and build the shared primitives the other issues depend on
   (`common-worker`, `test-utils`).
3. Issue I (shared packages) should land before issues A, C, E — it is a
   prerequisite for the cleanups proposed there.
4. Issue D (Firestore migrations tightening) should land before any further
   migration work to prevent new drift.
5. Issues C and J share a `requestId` propagation theme and should be sequenced
   together (single PR series, possibly single owner).
