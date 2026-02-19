# Package Dependency Documentation Validation

**Generated:** 2026-02-19
**Scope:** All 22 packages in `packages/`, 20 apps in `apps/`, 3 workers in `workers/` (log-cleanup, orchestrator, vm-lifecycle). Note: `workers/claude-worker` has no `package.json` and is excluded.

---

## Summary

| Check                             | Result   | Details                                   |
| --------------------------------- | -------- | ----------------------------------------- |
| Circular dependencies             | ✅ None   | No cycles in @intexuraos/* graph          |
| Undocumented packages             | ✅ None   | All 22 packages have README docs          |
| Phantom documented deps           | ⚠️ 1     | infra-otel docs claim infra-sentry dep    |
| "Used By" count mismatches        | ⚠️ 2     | common-core (×1), llm-audit (×1)          |
| Missing deps in package docs      | ⚠️ 1     | llm-factory missing llm-audit             |
| Packages without dep table        | ℹ️ 5     | infra-claude, infra-gemini, infra-glm, infra-gpt, infra-perplexity |

**Total discrepancies: 4** (3 count/content errors, 1 phantom dependency claim)

---

## Dependency Matrix — Package-to-Package

Which `@intexuraos/*` package depends on which other `@intexuraos/*` packages (direct dependencies from `package.json` only):

| Package            | Depends On (@intexuraos/*)                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `common-core`      | *(none — leaf)*                                                                             |
| `common-http`      | `common-core`, `llm-utils`                                                                  |
| `http-contracts`   | *(none — leaf)*                                                                             |
| `http-server`      | `common-core`, `common-http`, `infra-firestore`                                             |
| `infra-claude`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`                   |
| `infra-firestore`  | `common-core`                                                                               |
| `infra-gemini`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`                   |
| `infra-glm`        | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`                   |
| `infra-gpt`        | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`                   |
| `infra-notion`     | `common-core`                                                                               |
| `infra-otel`       | *(none — standalone OTel wrapper, no @intexuraos/* deps)*                                   |
| `infra-perplexity` | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`                   |
| `infra-pubsub`     | `common-core`                                                                               |
| `infra-sentry`     | `common-core`                                                                               |
| `infra-whatsapp`   | `common-core`                                                                               |
| `internal-clients` | `common-core`, `llm-contract`, `llm-factory`, `llm-pricing`                                |
| `llm-audit`        | `common-core`, `infra-firestore`, `llm-contract`                                            |
| `llm-contract`     | `common-core`                                                                               |
| `llm-factory`      | `common-core`, `llm-audit`, `infra-gemini`, `infra-glm`, `llm-contract`, `llm-pricing`     |
| `llm-pricing`      | `common-core`, `infra-firestore`, `llm-contract`                                            |
| `llm-prompts`      | `common-core`, `llm-contract`, `llm-utils`                                                  |
| `llm-utils`        | `common-core`                                                                               |

---

## Circular Dependency Check

Tracing all dependency chains:

- `llm-factory` → `infra-gemini` → `llm-audit`, `llm-pricing`, `llm-prompts` → (leaf deps only) ✅
- `llm-factory` → `llm-audit` → `infra-firestore` → `common-core` ✅
- `llm-factory` → `llm-pricing` → `infra-firestore` → `common-core` ✅
- `internal-clients` → `llm-factory` → (no back-edge to `internal-clients`) ✅
- `common-http` → `llm-utils` → `common-core` ✅
- `http-server` → `infra-firestore` → `common-core` ✅

**Result: No circular dependencies found.**

Notable transitive chains:
- `llm-factory` transitively depends on `infra-firestore` (via `llm-audit` and `llm-pricing`) even though it doesn't list it directly.
- Any app using `llm-factory` or `internal-clients` transitively pulls in `infra-gemini` and `infra-glm`.

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

Note: `api-docs-hub` does NOT depend on `http-contracts` directly.

### `http-server`

**Apps (19):** all apps including `api-docs-hub`

### `infra-claude`

**Apps (2):** `research-agent`, `user-service`

### `infra-firestore`

**Packages (3):** `http-server`, `llm-audit`, `llm-pricing`

**Apps (17):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `whatsapp-service`

Note: `api-docs-hub` and `web-agent` do NOT directly depend on `infra-firestore`.

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

**Apps (19):** all apps (direct `package.json` dependency + runtime `NODE_OPTIONS: '--import @intexuraos/infra-otel/register'` in `ecosystem.config.cjs`)

### `infra-perplexity`

**Apps (2):** `research-agent`, `user-service`

### `infra-pubsub`

**Apps (7):** `actions-agent`, `bookmarks-agent`, `code-agent`, `commands-agent`, `research-agent`, `todos-agent`, `whatsapp-service`

### `infra-sentry`

**Apps (19):** all apps

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

### D1 — `common-core` README: Package count wrong

| Field                        | Documented | Actual |
| ---------------------------- | ---------- | ------ |
| Used By Packages (count) | **13**     | **19** |

**Location:** `docs/packages/common-core/README.md` — `**Packages (13):**`

**Evidence:** 19 packages list `@intexuraos/common-core` in their `package.json` dependencies (verified by parsing all `packages/*/package.json`). The body of the "Used By" section correctly lists all 19 package names; only the parenthetical count is wrong.

**Fix:** Change `Packages (13)` → `Packages (19)`.

---

### D2 — `llm-audit` README: Missing `llm-factory` from "Used By"

| Field            | Documented                                                                    | Actual              |
| ---------------- | ----------------------------------------------------------------------------- | ------------------- |
| Used By Packages | `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity` | + `llm-factory` (6) |

**Location:** `docs/packages/llm-audit/README.md` — `**Packages (5):**`

**Evidence:** `packages/llm-factory/package.json` contains `"@intexuraos/llm-audit": "workspace:*"` in its dependencies.

**Fix:** Add `llm-factory` to the used-by packages list and change count to `(6)`.

---

### D3 — `llm-factory` README: Missing `llm-audit` from Dependencies

| Field        | Documented                                                               | Actual        |
| ------------ | ------------------------------------------------------------------------ | ------------- |
| Dependencies | `common-core`, `infra-gemini`, `infra-glm`, `llm-contract`, `llm-pricing` | + `llm-audit` |

**Location:** `docs/packages/llm-factory/README.md` — line 8 `**Dependencies:**`

**Evidence:** `packages/llm-factory/package.json` contains `"@intexuraos/llm-audit": "workspace:*"`.

**Fix:** Add `@intexuraos/llm-audit` to the Dependencies inline list.

---

### D4 — `infra-otel` README: Phantom dependency claim about `infra-sentry`

| Field                        | Documented                                                         | Actual                                                              |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| infra-sentry imports infra-otel | "infra-sentry imports `buildOtelConfig` and `getInstrumentations`" | `infra-sentry/package.json` has no `infra-otel` dep; source does not import from it |

**Location:** `docs/packages/infra-otel/README.md` — two places:
1. "The package also exports `buildOtelConfig` and `getInstrumentations` as a library for use by `@intexuraos/infra-sentry`'s OTel log transport."
2. "Additionally, `@intexuraos/infra-sentry` imports `buildOtelConfig` and `getInstrumentations` to configure the pino OTel log transport."

**Evidence:**
- `packages/infra-sentry/package.json` dependencies: `common-core`, `@sentry/node`, `fastify`, `pino`, `pino-opentelemetry-transport` — no `infra-otel`.
- `packages/infra-sentry/src/otelTransport.ts` imports only from `pino` (not from `@intexuraos/infra-otel`).
- `infra-sentry` implements its own OTel transport using `pino-opentelemetry-transport` directly without going through `infra-otel`.

**Fix:** Remove both claims that `infra-sentry` imports from `infra-otel`. The "Used By" section for `infra-otel` should not include `infra-sentry` as a package consumer (it is still used by all 19 apps).

---

## Informational: Missing Structured Dependency Sections

The following packages document their `@intexuraos/*` dependencies only informally (prose references rather than a structured table/list). Not blocking, but reduces documentation consistency.

| Package            | Actual @intexuraos/* Dependencies                                             |
| ------------------ | ----------------------------------------------------------------------------- |
| `infra-claude`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`     |
| `infra-gemini`     | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`     |
| `infra-glm`        | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`     |
| `infra-gpt`        | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`     |
| `infra-perplexity` | `common-core`, `llm-prompts`, `llm-audit`, `llm-contract`, `llm-pricing`     |

All five share the same dependency profile (they are all LLM provider adapters following the same pattern).

---

## Action Items

| Priority | Item                                                                             | File                                              |
| -------- | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| High     | Fix package count: `Packages (13)` → `Packages (19)` in common-core Used By     | `docs/packages/common-core/README.md`             |
| High     | Add `llm-factory` to llm-audit Used By; change count `(5)` → `(6)`              | `docs/packages/llm-audit/README.md`               |
| High     | Add `@intexuraos/llm-audit` to llm-factory Dependencies                          | `docs/packages/llm-factory/README.md`             |
| High     | Remove phantom claim that infra-sentry imports from infra-otel                   | `docs/packages/infra-otel/README.md`              |
| Low      | Add structured Dependencies sections to infra-claude, infra-gemini, infra-glm, infra-gpt, infra-perplexity READMEs | `docs/packages/infra-{claude,gemini,glm,gpt,perplexity}/README.md` |
