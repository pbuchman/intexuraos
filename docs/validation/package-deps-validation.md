# Package Dependency Documentation Validation

**Generated:** 2026-02-19 (v2 — Enhanced)
**Scope:** All 22 packages in `packages/`, 20 apps in `apps/`, 3 workers in `workers/` (log-cleanup, orchestrator, vm-lifecycle). Note: `workers/claude-worker` has no `package.json` and is excluded.

---

## Summary

| Check                              | Result | Details                                                             |
| ---------------------------------- | ------ | ------------------------------------------------------------------- |
| Circular dependencies              | PASS   | No cycles in @intexuraos/\* graph                                   |
| Undocumented packages              | PASS   | All 22 packages have README docs                                    |
| Version pinning — @intexuraos deps | PASS   | All 100% use `workspace:*` (packages, apps, workers)                |
| Peer dependency issues             | PASS   | No peer dependencies defined anywhere                               |
| Build order vs dependency graph    | PASS   | pnpm topological resolution handles this automatically              |
| Export surface vs docs             | PASS   | All exports documented; infra-otel `./register` noted               |
| Phantom documented deps            | OPEN   | infra-otel claims infra-sentry dep (D4, not fixed)                  |
| "Used By" count mismatches         | OPEN   | common-core Packages count wrong: says 13, lists 19 (D1, not fixed) |
| Missing deps in package docs       | FIXED  | llm-factory llm-audit dep added (D3 fixed)                          |
| Missing package in Used By         | FIXED  | llm-audit now lists llm-factory (D2 fixed)                          |

**Open discrepancies: 2** (D1 count label error, D4 phantom dependency claim)
**Fixed since v1: 2** (D2 llm-factory in llm-audit Used By; D3 llm-audit in llm-factory deps)

---

## Dependency Matrix — Package-to-Package

Which `@intexuraos/*` package depends on which other `@intexuraos/*` packages (direct dependencies from `package.json` only):

| Package            | Depends On (@intexuraos/\*)                                                            |
| ------------------ | -------------------------------------------------------------------------------------- |
| `common-core`      | _(none — leaf)_                                                                        |
| `common-http`      | `common-core`, `llm-utils`                                                             |
| `http-contracts`   | _(none — leaf)_                                                                        |
| `http-server`      | `common-core`, `common-http`, `infra-firestore`                                        |
| `infra-claude`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-firestore`  | `common-core`                                                                          |
| `infra-gemini`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-glm`        | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-gpt`        | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-notion`     | `common-core`                                                                          |
| `infra-otel`       | _(none — standalone OTel wrapper, no @intexuraos/_ deps)\*                             |
| `infra-perplexity` | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`               |
| `infra-pubsub`     | `common-core`                                                                          |
| `infra-sentry`     | `common-core`                                                                          |
| `infra-whatsapp`   | `common-core`                                                                          |
| `internal-clients` | `common-core`, `llm-contract`, `llm-factory`, `llm-pricing`                            |
| `llm-audit`        | `common-core`, `infra-firestore`, `llm-contract`                                       |
| `llm-contract`     | `common-core`                                                                          |
| `llm-factory`      | `common-core`, `llm-audit`, `infra-gemini`, `infra-glm`, `llm-contract`, `llm-pricing` |
| `llm-pricing`      | `common-core`, `infra-firestore`, `llm-contract`                                       |
| `llm-prompts`      | `common-core`, `llm-contract`, `llm-utils`                                             |
| `llm-utils`        | `common-core`                                                                          |

---

## Circular Dependency Check

Tracing all dependency chains:

- `llm-factory` → `infra-gemini` → `llm-audit`, `llm-pricing`, `llm-prompts` → (leaf deps only) PASS
- `llm-factory` → `llm-audit` → `infra-firestore` → `common-core` PASS
- `llm-factory` → `llm-pricing` → `infra-firestore` → `common-core` PASS
- `internal-clients` → `llm-factory` → (no back-edge to `internal-clients`) PASS
- `common-http` → `llm-utils` → `common-core` PASS
- `http-server` → `infra-firestore` → `common-core` PASS

**Result: No circular dependencies found.**

Notable transitive chains:

- `llm-factory` transitively depends on `infra-firestore` (via `llm-audit` and `llm-pricing`) even though it doesn't list it directly.
- Any app using `llm-factory` or `internal-clients` transitively pulls in `infra-gemini` and `infra-glm`.

---

## ENHANCED: Version Pinning Verification

All `@intexuraos/*` inter-package dependencies must use `workspace:*`. This ensures:

- pnpm resolves to the local workspace copy (no accidental registry version)
- Topological build order is computed from the dependency graph automatically

**Result: PASS — 100% of @intexuraos/_ dependencies use `workspace:_` across all 22 packages, 20 apps, and 3 workers.**

No packages, apps, or workers use pinned semver, ranges, or git references for `@intexuraos/*` dependencies.

---

## ENHANCED: Peer Dependency Check

Peer dependencies require consumers to install matching versions manually. They are appropriate for framework plugins and packages that need to avoid bundling heavy dependencies.

| Package    | Peer Dependencies |
| ---------- | ----------------- |
| _(all 22)_ | None              |

**Result: PASS — No peer dependencies defined anywhere in the package graph.**

Note: `fastify` appears as a regular `dependency` in `infra-sentry` and `common-http`, not as a peer dependency. This is intentional — these packages need the actual Fastify types at build time and are not Fastify plugins that would be registered across different app instances.

---

## ENHANCED: Build Order Verification

pnpm uses topological resolution automatically when processing `workspace:*` references. `pnpm -r --if-present build` runs packages in the correct order without any additional configuration.

**Computed topological build order for `packages/*`:**

| Level | Packages                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `common-core`, `http-contracts`, `infra-otel` _(leaf packages, no @intexuraos deps)_                                                        |
| 2     | `infra-firestore`, `infra-notion`, `infra-pubsub`, `infra-sentry`, `infra-whatsapp`, `llm-contract`, `llm-utils` _(depend only on level 1)_ |
| 3     | `llm-audit`, `llm-pricing`, `common-http`, `llm-prompts` _(depend on levels 1-2)_                                                           |
| 4     | `http-server`, `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity` _(depend on levels 1-3)_                        |
| 5     | `llm-factory` _(depends on infra-gemini + infra-glm from level 4)_                                                                          |
| 6     | `internal-clients` _(depends on llm-factory from level 5)_                                                                                  |

**Result: PASS — Build order is correct and enforced automatically by pnpm workspace resolution.**

Special case: `infra-otel`'s `./register` export points to `./dist/register.js` (compiled output), while all other exports point to `./src/*.ts`. This requires `pnpm build` to be run before consuming the `./register` entry point. The main `.` export (`./src/index.ts`) works without building. This is documented in the infra-otel README.

---

## ENHANCED: Exported Types vs Documented API Surface

Each package's `exports` field in `package.json` defines the public API surface. All packages export via `"."` → `./src/index.ts` (source-based, no build required), except:

| Package       | Export Path  | Points To            | Doc Status                                                      |
| ------------- | ------------ | -------------------- | --------------------------------------------------------------- |
| `common-core` | `./errors`   | `./src/errors.ts`    | DOCUMENTED — README lists both entry points in an Exports table |
| `infra-otel`  | `./register` | `./dist/register.js` | DOCUMENTED — README explains the side-effect bootstrap pattern  |

**Result: PASS — All non-standard exports are documented.**

---

## Reverse Dependency Map — Which Apps/Workers Use Each Package

Derived from actual `package.json` files. Direct dependencies only.

### `common-core`

**Packages (19):** `common-http`, `http-server`, `infra-claude`, `infra-firestore`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-notion`, `infra-perplexity`, `infra-pubsub`, `infra-sentry`, `infra-whatsapp`, `internal-clients`, `llm-audit`, `llm-contract`, `llm-factory`, `llm-pricing`, `llm-prompts`, `llm-utils`

**Apps (19):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web`, `web-agent`, `whatsapp-service`

**Workers (3):** `log-cleanup`, `orchestrator`, `vm-lifecycle`

### `common-http`

**Packages (1):** `http-server`

**Apps (19):** `actions-agent`, `api-docs-hub`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web-agent`, `whatsapp-service`

### `http-contracts`

**Apps (18):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web-agent`, `whatsapp-service`

Note: `api-docs-hub` and `web` do NOT depend on `http-contracts` directly.

### `http-server`

**Apps (19):** all apps including `api-docs-hub` (but not `web`)

### `infra-claude`

**Apps (2):** `research-agent`, `user-service`

### `infra-firestore`

**Packages (3):** `http-server`, `llm-audit`, `llm-pricing`

**Apps (17):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `whatsapp-service`

Note: `api-docs-hub`, `web-agent`, and `web` do NOT directly depend on `infra-firestore`.

### `infra-gemini`

**Packages (1):** `llm-factory`

**Apps (6):** `commands-agent`, `data-insights-agent`, `image-service`, `research-agent`, `todos-agent`, `user-service`

### `infra-glm`

**Packages (1):** `llm-factory`

**Apps (4):** `chat-agent`, `research-agent`, `todos-agent`, `user-service`

### `infra-gpt`

**Apps (3):** `image-service`, `research-agent`, `user-service`

### `infra-notion`

**Apps (2):** `notion-service`, `research-agent`

### `infra-otel`

**Apps (19):** all apps except `web` (direct `package.json` dependency; also loaded via `NODE_OPTIONS: '--import @intexuraos/infra-otel/register'` in `ecosystem.config.cjs`)

### `infra-perplexity`

**Apps (2):** `research-agent`, `user-service`

### `infra-pubsub`

**Apps (7):** `actions-agent`, `bookmarks-agent`, `code-agent`, `commands-agent`, `research-agent`, `todos-agent`, `whatsapp-service`

### `infra-sentry`

**Apps (19):** all apps except `web`

### `infra-whatsapp`

**Apps (1):** `whatsapp-service`

### `internal-clients`

**Apps (11):** `actions-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

### `llm-audit`

**Packages (6):** `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`, `llm-factory`

**Apps (1):** `image-service`

**Workers (1):** `orchestrator`

### `llm-contract`

**Packages (10):** `llm-factory`, `llm-pricing`, `llm-audit`, `llm-prompts`, `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-glm`, `infra-perplexity`, `internal-clients`

**Apps (14):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `user-service`, `web`, `web-agent`

**Workers (1):** `orchestrator`

### `llm-factory`

**Packages (1):** `internal-clients`

**Apps (10):** `actions-agent`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

**Workers (1):** `orchestrator`

### `llm-pricing`

**Packages (7):** `llm-factory`, `internal-clients`, `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`

**Apps (12):** `actions-agent`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `user-service`, `web-agent`

**Workers (1):** `orchestrator`

### `llm-prompts`

**Packages (5):** `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`

**Apps (9):** `actions-agent`, `calendar-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

### `llm-utils`

**Packages (2):** `llm-prompts`, `common-http`

**Apps (6):** `calendar-agent`, `commands-agent`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

---

## Discrepancies Found

### D1 — `common-core` README: Package count label wrong (OPEN — not fixed since v1)

**Severity: HIGH**

| Field                    | Documented | Actual |
| ------------------------ | ---------- | ------ |
| Used By Packages (count) | **13**     | **19** |

**Location:** `docs/packages/common-core/README.md` line 223 — `**Packages (13):**`

**Evidence:** The body of the "Used By" line correctly lists all 19 package names. Only the parenthetical count label is wrong. Counting the backtick-delimited names in the same line yields 19: `common-http`, `http-server`, `infra-pubsub`, `infra-firestore`, `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-glm`, `infra-notion`, `infra-perplexity`, `infra-sentry`, `infra-whatsapp`, `internal-clients`, `llm-utils`, `llm-prompts`, `llm-pricing`, `llm-factory`, `llm-audit`, `llm-contract`.

**Fix:** Change `Packages (13)` → `Packages (19)`.

---

### D2 — `llm-audit` README: Missing `llm-factory` from "Used By" (FIXED in v2)

Previously documented packages count was `(5)` and omitted `llm-factory`. The README now correctly shows `**Packages (6):** infra-claude, infra-gemini, infra-glm, infra-gpt, infra-perplexity, llm-factory`.

---

### D3 — `llm-factory` README: Missing `llm-audit` from Dependencies (FIXED in v2)

Previously the inline Dependencies line omitted `@intexuraos/llm-audit`. The README now correctly lists it.

---

### D4 — `infra-otel` README: Phantom dependency claim about `infra-sentry` (OPEN — not fixed since v1)

**Severity: MEDIUM**

| Field                                | Documented                                                                | Actual                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| infra-sentry imports from infra-otel | Claims `infra-sentry` imports `buildOtelConfig` and `getInstrumentations` | `infra-sentry/package.json` has no `infra-otel` dep; source does not import it |

**Location:** `docs/packages/infra-otel/README.md` — two places:

1. Line: "The package also exports `buildOtelConfig` and `getInstrumentations` as a library for use by `@intexuraos/infra-sentry`'s OTel log transport."
2. "Additionally, `@intexuraos/infra-sentry` imports `buildOtelConfig` and `getInstrumentations` to configure its pino OTel log transport."

**Evidence:**

- `packages/infra-sentry/package.json` dependencies: `common-core`, `@sentry/node`, `fastify`, `pino`, `pino-opentelemetry-transport` — no `infra-otel` present.
- `packages/infra-sentry/src/otelTransport.ts` imports only `pino` — not `@intexuraos/infra-otel`.
- `infra-sentry` implements its OTel transport directly via `pino-opentelemetry-transport`, not through `infra-otel`'s `getInstrumentations()`.

The `./register` entry point in `infra-otel` initializes OTel for the process. `infra-sentry` separately handles pino log forwarding to Dash0 via `pino-opentelemetry-transport`. These are two distinct integration paths that do not cross.

**Fix:** Remove both sentences claiming `infra-sentry` imports from `infra-otel`. The "Used By" section for `infra-otel` should note only the 19 apps (not `infra-sentry` as a package consumer).

---

## Informational: Structural Documentation Patterns

### LLM Provider Adapter Pattern

The five LLM provider adapter packages (`infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`) share identical dependency profiles:

| Dependency     | Role                                    |
| -------------- | --------------------------------------- |
| `common-core`  | Result types, Logger, error handling    |
| `llm-contract` | LLMClient interface, model types        |
| `llm-prompts`  | buildResearchPrompt for research method |
| `llm-audit`    | AuditContext for every LLM call         |
| `llm-pricing`  | UsageLogger for cost tracking           |

Each adapter uses a structured Dependencies table in its README. `infra-claude` and `infra-gpt` note they do not support injectable `auditSink`/`usageSink` (unlike `infra-gemini` and `infra-glm` which do). This distinction is documented correctly per-package.

### Dual-Consumer Pattern: infra-gemini and infra-glm

Both `infra-gemini` and `infra-glm` are consumed by two distinct paths:

1. **Direct** — apps like `research-agent`, `user-service`, `todos-agent` import them for provider-specific configuration
2. **Via factory** — `llm-factory` imports them and creates clients dynamically via `createLlmClient()`

Apps that use `llm-factory` or `internal-clients` transitively pull in both `infra-gemini` and `infra-glm` even without directly importing them.

### infra-otel Dual-Use Architecture

`infra-otel` has two usage modes documented in its README:

1. **Process bootstrap** — `./register` entry point loaded via `NODE_OPTIONS: '--import @intexuraos/infra-otel/register'` in PM2 ecosystem config. This bootstraps OTel tracing/metrics for all 19 services without code changes.
2. **Library** — `.` entry point exports `buildOtelConfig` and `getInstrumentations` for use by other packages. However, no other package currently imports these functions (D4 documents the phantom claim about `infra-sentry`).

---

## v2 vs v1 Comparison

| Area                             | v1 Status       | v2 Status                                  |
| -------------------------------- | --------------- | ------------------------------------------ |
| Circular dependency check        | PASS            | PASS (unchanged)                           |
| D1 common-core count             | OPEN (13 vs 19) | OPEN (still unfixed)                       |
| D2 llm-audit missing llm-factory | OPEN            | FIXED (now shows 6 packages)               |
| D3 llm-factory missing dep       | OPEN            | FIXED (llm-audit now in deps list)         |
| D4 phantom infra-sentry claim    | OPEN            | OPEN (still unfixed)                       |
| Version pinning                  | Not checked     | PASS — all workspace:\*                    |
| Peer dependencies                | Not checked     | PASS — none defined                        |
| Build order                      | Not checked     | PASS — pnpm handles topologically          |
| Export surface                   | Not checked     | PASS — all non-standard exports documented |

---

## Action Items

| Priority | Severity | Item                                                                              | File                                  |
| -------- | -------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| 1        | HIGH     | Fix package count label: `Packages (13)` → `Packages (19)` in common-core Used By | `docs/packages/common-core/README.md` |
| 2        | MEDIUM   | Remove phantom claim that infra-sentry imports buildOtelConfig from infra-otel    | `docs/packages/infra-otel/README.md`  |
