# INT-1537 — Shared Packages: Enforce Leaf Contract, Prune Domain Leakage, Align Deps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the `packages/*` leaf-package contract from CLAUDE.md by (a) moving domain logic out of `common-core` into dedicated domain leaf packages, (b) slimming `infra-pubsub` / `http-server` / `common-http` to pure wrappers, (c) aligning divergent runtime deps via pnpm catalog + `peerDependencies`, (d) removing dead exports & dead deps, (e) regenerating stale docs and unifying build-output policy.

**Architecture:** Split into **five parallelizable subtasks**, each owning one package-family and publishing a frozen public contract that the other four subtasks treat as stable. Every subtask lands on its own feature branch (`feature/int-1537-sub-<x>`) with its own PR targeting `development`. Consumers across `apps/*` and `workers/*` are updated inside the subtask that owns the contract change — no cross-subtask file coupling.

**Tech Stack:** TypeScript 5 strict, pnpm workspaces (catalog protocol), Fastify 5, Vitest with in-memory fakes (`setServices`/`resetServices`), `knip` or `ts-prune` for dead-code gate.

---

## Evidence Anchor

- Audit: `docs/reviews/2026-04-24-refactoring-analysis.md` §9 (Shared Packages).
- Current offenders located:
  - `packages/common-core/src/labels.ts` (25 LoC), `codeTaskWorkerTypes.ts` (21), `planPathResolver.ts` (72), `internalServiceCatalog.ts` (202) — all re-exported from `packages/common-core/src/index.ts`.
  - `packages/infra-pubsub/src/{whatsappSendPublisher,todosProcessingPublisher,calendarPreviewPublisher,prTriagePublisher}.ts` — per-integration publishers inside a generic package.
  - `packages/http-server/src/health.ts:6` imports `getFirestore` from `@intexuraos/infra-firestore` and defines `checkNotionSdk`.
  - `packages/common-http/src/http/logger.ts` and `index.ts` import `redactToken`/`redactObject`/`SENSITIVE_FIELDS` from `@intexuraos/llm-utils`; definitions live in `packages/llm-utils/src/redaction.ts` (64 LoC).
  - `package.json` divergence: `packages/infra-openrouter` pins `openai ^5.3.0`; `packages/infra-gpt`, `apps/code-agent`, `workers/orchestrator` pin `^6.15.0`; `apps/retired-chat-service` pins `^4.0.0`.
  - `packages/llm-pricing/package.json` declares `@intexuraos/infra-firestore` dependency but no source file imports it.
  - Dead re-exports in `packages/common-core/src/index.ts`: `serviceFeedback` family, `ensureAllDefined`, `getFirstOrNull`, `toDateOrNull`, `toISOStringOrNull` — grep shows zero external consumers.
  - README audit: 10 of 21 packages ship a `README.md`; 11 do not (`common-core`, `common-http`, `http-contracts`, `http-server`, `infra-firestore`, `infra-notion`, `infra-openrouter`, `infra-otel`, `infra-pubsub`, `infra-whatsapp`, `internal-clients`).
  - Build output: 4 packages emit `dist/` (`infra-otel`, `internal-clients`, `llm-prompts`, `llm-utils`); 17 export from `src/`. CLAUDE.md still requires `packages/*/dist/` to exist.

## File Structure After Refactor

New domain leaf packages (sibling of `common-*`/`infra-*`, still pure/no runtime deps beyond `common-core`):

```
packages/
  linear-domain/            # NEW — Linear label vocabulary
    src/index.ts
    src/labels.ts           # ← moved from common-core
    src/__tests__/labels.test.ts
    package.json
    README.md
  code-task-domain/         # NEW — code-task worker contracts
    src/index.ts
    src/codeTaskWorkerTypes.ts   # ← moved from common-core
    src/planPathResolver.ts      # ← moved from common-core
    src/__tests__/*.test.ts
    package.json
    README.md
  service-catalog/          # NEW — internal API service catalog
    src/index.ts
    src/internalServiceCatalog.ts # ← moved from common-core
    src/__tests__/internalServiceCatalog.test.ts
    package.json
    README.md
```

Slim/modified existing packages:

```
packages/common-core/src/
  index.ts                  # domain-leakage re-exports REMOVED; dead exports REMOVED; redaction ADDED
  redaction.ts              # NEW — moved from llm-utils
  __tests__/redaction.test.ts  # NEW — moved from llm-utils

packages/infra-pubsub/src/
  basePublisher.ts          # retained
  types.ts                  # retained ONLY BasePubSub types (PublishContext, PublishError)
  index.ts                  # re-exports BasePubSubPublisher only
  # DELETE: whatsappSendPublisher.ts, todosProcessingPublisher.ts,
  #         calendarPreviewPublisher.ts, prTriagePublisher.ts, their tests,
  #         and domain typed events from types.ts

packages/http-server/src/
  health.ts                 # checkNotionSdk REMOVED; Firestore check REMOVED
  index.ts                  # updated exports
packages/http-server/package.json
                            # @intexuraos/infra-firestore dep REMOVED

packages/common-http/package.json
                            # @intexuraos/llm-utils dep REMOVED
packages/common-http/src/http/logger.ts
                            # now imports from @intexuraos/common-core

packages/llm-utils/src/
  redaction.ts              # DELETED (moved to common-core)
  __tests__/redaction.test.ts # DELETED
  index.ts                  # redaction exports REMOVED
```

Relocated typed publishers (owning services):

```
apps/whatsapp-service/src/infra/pubsub/whatsappSendPublisher.ts   # ← moved from infra-pubsub
apps/retired-checklist-service/src/infra/pubsub/todosProcessingPublisher.ts     # ← moved from infra-pubsub
apps/calendar-agent/src/infra/pubsub/calendarPreviewPublisher.ts  # ← moved from infra-pubsub
apps/code-agent/src/infra/pubsub/prTriagePublisher.ts             # ← moved from infra-pubsub
apps/notion-service/src/infra/health/notionSdkHealthCheck.ts       # ← absorbs checkNotionSdk
```

Root-level changes:

```
pnpm-workspace.yaml          # catalog entries for openai, fastify, pino, zod
package.json (root)          # ci:tracked now includes verify-dead-code & verify-package-exports
scripts/verify-dead-code.mjs          # NEW — knip gate
scripts/verify-package-exports.mjs    # NEW — validates source-exports model per policy
.claude/CLAUDE.md            # update "packages/*/dist/" rule to match source-exports model
docs/architecture/package-contracts.md   # regenerated from filesystem
packages/README.md           # regenerated from filesystem
```

---

## Subtask Contracts (Frozen Before Execution)

Each subtask is owned by a single agent. Agents may run concurrently because:

- **SUB-A** publishes THREE new `@intexuraos/*` package names and deletes six barrel exports from `@intexuraos/common-core`. Consumers switch import paths; signatures are **byte-identical** to today.
- **SUB-B** narrows the `@intexuraos/infra-pubsub` barrel to five named exports; typed publisher factories continue to exist with identical signatures inside owning services.
- **SUB-C** deletes two exports (`checkNotionSdk`, `infra-firestore` dep) from `http-server`, removes one inter-package dep (`common-http → llm-utils`), and adds one namespace (`@intexuraos/common-core/redaction`) with identical symbol shapes.
- **SUB-D** only touches manifest files and adds two CI scripts. It does not move source code.
- **SUB-E** only touches docs, READMEs, CLAUDE.md, and TSC build config.

Merge order for integration (does not affect parallel execution): SUB-D → SUB-E → SUB-C → SUB-B → SUB-A (last because it has the largest consumer-import surface). Re-base each PR on `development` before merging.

| Subtask   | Package owner                          | Touched apps/workers                                                                                      | Contract for other subtasks                                                                                                                                                                                                                                                 |
| --------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SUB-A     | common-core + 3 new domain packages    | code-agent, linear-agent, actions-agent, retired-scheduler-service, orchestrator, web, api-docs-hub                      | New barrels: `@intexuraos/linear-domain`, `@intexuraos/code-task-domain`, `@intexuraos/service-catalog`. Six symbol families removed from `@intexuraos/common-core`.                                                                                                        |
| SUB-B     | infra-pubsub                           | whatsapp-service, retired-checklist-service, calendar-agent, code-agent, research-agent, bookmarks-agent, actions-agent | `@intexuraos/infra-pubsub` exports exactly `BasePubSubPublisher`, `BasePubSubPublisherConfig`, `PublishContext`, `PublishError`, `PublishFailureReason` (+ those names only).                                                                                               |
| SUB-C     | http-server + common-http + llm-utils  | notion-service, all common-http consumers                                                                 | `@intexuraos/common-core/redaction` exports `redactToken`, `redactObject`, `SENSITIVE_FIELDS`. `http-server` no longer exports `checkNotionSdk` nor depends on `@intexuraos/infra-firestore`. `common-http` drops `@intexuraos/llm-utils` dep.                              |
| SUB-D     | root workspace + all package manifests | none (manifests only)                                                                                     | `pnpm-workspace.yaml` `catalog:` keys: `openai@^6`, `fastify@^5.2.0`, `pino@^9`, `zod@^3.24`. `infra-*`/`common-http`/`http-server` declare these as `peerDependencies`. `llm-pricing` no longer depends on `infra-firestore`. `pnpm run verify:dead-code` in `ci:tracked`. |
| SUB-E     | docs + build config                    | none (docs + tsconfig + CLAUDE.md only)                                                                   | 21/21 packages have `README.md`. `packages/README.md` + `docs/architecture/package-contracts.md` match filesystem. Source-exports model documented & enforced by `scripts/verify-package-exports.mjs` (exception: `infra-otel` retains `dist/`). CLAUDE.md rule updated.    |

**No subtask blocks another during execution.** An agent whose work depends on a barrel that another subtask will slim (e.g. SUB-B removing typed publishers while SUB-A still uses them) must inline the temporary shim in its own branch; the final merge order resolves the shim.

---

## Subtask SUB-A — common-core domain extraction

**Branch:** `feature/int-1537-sub-a-common-core-extraction`
**Owner package:** `packages/common-core` + 3 new domain packages.

**Files:**
- Create: `packages/linear-domain/{src/labels.ts,src/index.ts,src/__tests__/labels.test.ts,package.json,tsconfig.json,README.md}`
- Create: `packages/code-task-domain/{src/codeTaskWorkerTypes.ts,src/planPathResolver.ts,src/index.ts,src/__tests__/codeTaskWorkerTypes.test.ts,src/__tests__/planPathResolver.test.ts,package.json,tsconfig.json,README.md}`
- Create: `packages/service-catalog/{src/internalServiceCatalog.ts,src/index.ts,src/__tests__/internalServiceCatalog.test.ts,package.json,tsconfig.json,README.md}`
- Delete: `packages/common-core/src/{labels.ts,codeTaskWorkerTypes.ts,planPathResolver.ts,internalServiceCatalog.ts,serviceFeedback.ts,nullability.ts}` and their `__tests__/` counterparts.
- Modify: `packages/common-core/src/index.ts` (remove six export blocks + dead exports).
- Modify: `packages/common-core/package.json` (remove `./code-task-worker-types` subpath export).
- Modify consumers (global rewrite of import paths — see Step 8).

- [ ] **Step 1: Scaffold `packages/linear-domain`** (TDD)

Create the package with the exact symbol shapes from `packages/common-core/src/labels.ts`:

```json
// packages/linear-domain/package.json
{
  "name": "@intexuraos/linear-domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint:local": "eslint src --max-warnings 0"
  }
}
```

Tests (write FIRST, confirm fail, then implement):

```ts
// packages/linear-domain/src/__tests__/labels.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeLabel,
  hasCodeTaskLabel,
  hasPlanningTaskLabel,
  hasComplexTaskLabel,
} from '../index.js';

describe('normalizeLabel', () => {
  it('lowercases, trims, and replaces underscores/spaces with dashes', () => {
    expect(normalizeLabel('  Code_Task ')).toBe('code-task');
  });
});

describe('hasCodeTaskLabel', () => {
  it('matches normalized code-task label', () => {
    expect(hasCodeTaskLabel(['Code Task'])).toBe(true);
    expect(hasCodeTaskLabel(['urgent'])).toBe(false);
  });
});

describe('hasPlanningTaskLabel', () => {
  it('matches normalized planning-task label', () => {
    expect(hasPlanningTaskLabel(['PLANNING_TASK'])).toBe(true);
  });
});

describe('hasComplexTaskLabel', () => {
  it('matches normalized complex-task label', () => {
    expect(hasComplexTaskLabel(['complex task'])).toBe(true);
  });
});
```

Implementation (copy verbatim from old `packages/common-core/src/labels.ts`):

```ts
// packages/linear-domain/src/labels.ts
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}
export function hasCodeTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'code-task');
}
export function hasPlanningTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'planning-task');
}
export function hasComplexTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'complex-task');
}
```

```ts
// packages/linear-domain/src/index.ts
export {
  normalizeLabel,
  hasCodeTaskLabel,
  hasPlanningTaskLabel,
  hasComplexTaskLabel,
} from './labels.js';
```

Run: `pnpm --filter @intexuraos/linear-domain test` → PASS.

- [ ] **Step 2: Scaffold `packages/code-task-domain`**

Same procedure. The package contains the CURRENT, unmodified contents of `packages/common-core/src/codeTaskWorkerTypes.ts` and `planPathResolver.ts`. Tests: copy `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts` and `planPathResolver.test.ts` verbatim and adjust import paths.

```ts
// packages/code-task-domain/src/index.ts
export {
  CODE_TASK_WORKER_TYPES,
  isCodeTaskWorkerType,
  type CodeTaskWorkerType,
} from './codeTaskWorkerTypes.js';
export {
  resolvePlanDocumentPathFromLinearContext,
  type PlanResolutionContext,
} from './planPathResolver.js';
```

Run: `pnpm --filter @intexuraos/code-task-domain test` → PASS.

- [ ] **Step 3: Scaffold `packages/service-catalog`**

Same procedure for `internalServiceCatalog.ts`. Index barrel:

```ts
// packages/service-catalog/src/index.ts
export {
  INTERNAL_API_SERVICE_CATALOG,
  INTERNAL_API_BASE_URL_ENV_VARS,
  INTERNAL_API_OPENAPI_URL_ENV_VARS,
  buildInternalApiServiceDefinitions,
  buildInternalApiOpenApiSources,
  type InternalApiServiceCatalogEntry,
  type InternalApiServiceDefinition,
  type InternalApiOpenApiSource,
} from './internalServiceCatalog.js';
```

Run: `pnpm --filter @intexuraos/service-catalog test` → PASS.

- [ ] **Step 4: Commit the new packages (no consumer rewrites yet)**

```bash
git add packages/linear-domain packages/code-task-domain packages/service-catalog
git commit -m "feat(packages): scaffold linear-domain, code-task-domain, service-catalog [INT-1537]"
```

- [ ] **Step 5: Audit every consumer of the six symbol families (MANDATORY — memory mem_4b8fb197)**

Using the Grep tool, enumerate ALL files importing the following symbols. This is a global dependency audit — skipping any file that depends on `@intexuraos/common-core` for these names causes downstream TypeScript compile failures:

```
normalizeLabel | hasCodeTaskLabel | hasPlanningTaskLabel | hasComplexTaskLabel
CODE_TASK_WORKER_TYPES | isCodeTaskWorkerType | CodeTaskWorkerType
resolvePlanDocumentPathFromLinearContext | PlanResolutionContext
INTERNAL_API_SERVICE_CATALOG | INTERNAL_API_BASE_URL_ENV_VARS | INTERNAL_API_OPENAPI_URL_ENV_VARS
buildInternalApiServiceDefinitions | buildInternalApiOpenApiSources
InternalApiServiceCatalogEntry | InternalApiServiceDefinition | InternalApiOpenApiSource
```

Expected consumer set (from current audit — re-verify with fresh grep before rewrite):

| Symbol family          | Consumers                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| labels                 | `apps/{code-agent,linear-agent,web}`, `workers/orchestrator`                                                                                     |
| codeTaskWorkerTypes    | `apps/{code-agent,linear-agent,actions-agent,web}`, `workers/orchestrator`, `migrations/*`, `e2e/*`                                              |
| planPathResolver       | `apps/code-agent/src/domain/usecases/{getLinearIssueContext,createReviewTask}.ts`, `workers/orchestrator/src/services/deep-validator-helpers.ts` |
| internalServiceCatalog | `apps/web/src/config.ts`, `apps/api-docs-hub`, tests                                                                                             |

Write findings to `docs/plans/INT-1537-sub-a-consumer-audit.md` as a checklist.

Run: `pnpm -w tsc --noEmit` → confirm it still passes BEFORE any consumer rewrite.

- [ ] **Step 6: Add the three new packages as workspace deps on every consumer app/worker**

For each consumer discovered in Step 5, add the owning package (`@intexuraos/linear-domain`, `@intexuraos/code-task-domain`, and/or `@intexuraos/service-catalog`) to `"dependencies"` in its `package.json` as `"workspace:*"`. Example for `apps/code-agent/package.json`:

```diff
   "dependencies": {
     "@intexuraos/common-core": "workspace:*",
+    "@intexuraos/code-task-domain": "workspace:*",
+    "@intexuraos/linear-domain": "workspace:*",
```

Run: `pnpm install` → PASS (lockfile updated).

- [ ] **Step 7: Rewrite consumer imports (one service at a time, commit per service)**

For every file identified in Step 5, change:

```ts
// BEFORE
import { hasCodeTaskLabel } from '@intexuraos/common-core';
// AFTER
import { hasCodeTaskLabel } from '@intexuraos/linear-domain';
```

Rewrite strategy: process one consumer (app/worker) at a time; run `pnpm --filter <consumer> typecheck && pnpm --filter <consumer> test` after each; commit per consumer with message `refactor(<consumer>): move domain imports to leaf packages [INT-1537]`.

Additional rewrites for `packages/common-core/package.json` sub-path export (`./code-task-worker-types`): replace those imports with `@intexuraos/code-task-domain`.

- [ ] **Step 8: Delete the six common-core files and their tests; trim `common-core/src/index.ts`**

```bash
git rm packages/common-core/src/labels.ts packages/common-core/src/__tests__/labels.test.ts
git rm packages/common-core/src/codeTaskWorkerTypes.ts packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts
git rm packages/common-core/src/planPathResolver.ts packages/common-core/src/__tests__/planPathResolver.test.ts
git rm packages/common-core/src/internalServiceCatalog.ts packages/common-core/src/__tests__/internalServiceCatalog.test.ts
git rm packages/common-core/src/serviceFeedback.ts packages/common-core/src/__tests__/serviceFeedback.test.ts
git rm packages/common-core/src/nullability.ts packages/common-core/src/__tests__/nullability.test.ts
```

Edit `packages/common-core/src/index.ts` — remove the six export blocks (`labels`, `codeTaskWorkerTypes`, `planPathResolver`, `internalServiceCatalog`, `serviceFeedback`, `nullability`). Keep only: `result`, `errors`, `logging`, `serviceErrorCodes`, `tracing`.

Edit `packages/common-core/package.json` — remove `"./code-task-worker-types": "./src/codeTaskWorkerTypes.ts"` from `exports`.

- [ ] **Step 9: Repo-wide verification**

```bash
pnpm install
pnpm -w tsc --noEmit 2>&1 | tee /tmp/ci-sub-a-tsc.txt
pnpm run ci:tracked 2>&1 | tee /tmp/ci-sub-a-full.txt
```

Expected: no TypeScript errors, no test failures. If any consumer was missed in Step 5, the compile pass fails here — loop back.

- [ ] **Step 10: Update `docs/packages/common-core/README.md` + `agent.md`**

Remove references to the deleted modules. Add a "Migration Notice" section pointing to the three new packages.

- [ ] **Step 11: Commit & open PR**

```bash
git add -A packages/common-core packages/linear-domain packages/code-task-domain packages/service-catalog apps/ workers/ docs/
git commit -m "refactor(common-core): extract domain packages + remove dead exports [INT-1537]"
gh pr create --base development --head feature/int-1537-sub-a-common-core-extraction \
  --title "[INT-1537] [refactor] common-core domain extraction (SUB-A)" \
  --body "$(cat <<'EOF'
## Summary
- Extract `labels`, `codeTaskWorkerTypes`, `planPathResolver`, `internalServiceCatalog` from `common-core` into three new leaf domain packages.
- Delete dead exports (`serviceFeedback`, `ensureAllDefined`, `getFirstOrNull`, `toDateOrNull`, `toISOStringOrNull`).
- Rewrite consumer imports across all apps and workers.

## Test plan
- [ ] `pnpm run ci:tracked` passes repo-wide.
- [ ] Grep `@intexuraos/common-core` shows no callers of removed symbols.

Fixes INT-1537 (sub-task A)
EOF
)"
```

---

## Subtask SUB-B — infra-pubsub slim-down

**Branch:** `feature/int-1537-sub-b-infra-pubsub-slim`
**Owner package:** `packages/infra-pubsub` + 4 owning services.

**Files:**
- Modify: `packages/infra-pubsub/src/index.ts` (reduce to BasePubSub only).
- Modify: `packages/infra-pubsub/src/types.ts` (keep only `PublishError` / `PublishFailureReason`; delete integration-specific event types).
- Delete: `packages/infra-pubsub/src/{whatsappSendPublisher,todosProcessingPublisher,calendarPreviewPublisher,prTriagePublisher}.ts` and their test files.
- Create: `apps/whatsapp-service/src/infra/pubsub/whatsappSendPublisher.ts` (+ tests).
- Create: `apps/retired-checklist-service/src/infra/pubsub/todosProcessingPublisher.ts` (+ tests).
- Create: `apps/calendar-agent/src/infra/pubsub/calendarPreviewPublisher.ts` (+ tests) — create `infra/pubsub` dir if absent.
- Create: `apps/code-agent/src/infra/pubsub/prTriagePublisher.ts` (+ tests).
- Modify: every importer listed below.

**Importer map (verified):**
- `createWhatsAppSendPublisher` → `apps/{code-agent,bookmarks-agent,research-agent,actions-agent}/src/services.ts|index.ts|config.ts` (publisher), `apps/whatsapp-service/src/...` (consumer — receives Pub/Sub push).
- `createTodosProcessingPublisher` → `apps/retired-checklist-service/src/services.ts`.
- `createCalendarPreviewPublisher` → resolve via grep during execution (current consumers).
- `createPRTriagePublisher` → `apps/code-agent/src/services/factories/publisherFactory.ts`.

- [ ] **Step 1: Enumerate consumers** (MANDATORY — memory mem_4b8fb197)

Grep tool, record results in `docs/plans/INT-1537-sub-b-consumer-audit.md`:

- `createWhatsAppSendPublisher|WhatsAppSendPublisher|WhatsAppSendPublisherConfig|SendMessageEvent|WhatsAppInteractiveButton`
- `createTodosProcessingPublisher|TodosProcessingPublisher|TodoProcessingEvent|TodosProcessingPublisherConfig`
- `createCalendarPreviewPublisher|CalendarPreviewPublisher|CalendarPreviewGenerateEvent|CalendarPreviewPublisherConfig`
- `createPRTriagePublisher|PRTriagePublisher|PRTriageEvent|PRTriagePublisherConfig`

- [ ] **Step 2: Relocate WhatsApp publisher (TDD)**

Create `apps/whatsapp-service/src/infra/pubsub/whatsappSendPublisher.ts` containing the EXACT source of `packages/infra-pubsub/src/whatsappSendPublisher.ts` with one change: type imports (`SendMessageEvent`, `WhatsAppSendPublisherConfig`, `WhatsAppInteractiveButton`) must be co-located inside the same file or a sibling `types.ts` in `apps/whatsapp-service/src/infra/pubsub/`. Publish test file with identical cases to `packages/infra-pubsub/src/__tests__/whatsappSendPublisher.test.ts`.

Export the publisher from a shared `apps/whatsapp-service/src/infra/pubsub/index.ts`. Also add the factory + types to `packages/http-contracts/src/whatsapp.ts` so publisher-side services (code-agent, research-agent, bookmarks-agent, actions-agent) can import the TYPES from `@intexuraos/http-contracts` while the factory remains co-located in whatsapp-service. Rationale: publishers outside whatsapp-service must not import from another app.

Decision: instead of duplicating the factory in every publisher-side service, create a new **micro-package** `@intexuraos/whatsapp-pubsub-client` that exports ONLY the `createWhatsAppSendPublisher` factory + types. Package layout:

```
packages/whatsapp-pubsub-client/
  src/index.ts
  src/whatsappSendPublisher.ts  # ← moved here
  src/types.ts
  src/__tests__/whatsappSendPublisher.test.ts
  package.json
  README.md
```

This keeps infra-pubsub pure (BasePubSubPublisher only) while letting unrelated services publish without depending on `whatsapp-service`. Apply the same pattern to the other three publishers:

- `packages/retired-checklist-pubsub-client`
- `packages/calendar-pubsub-client`
- `packages/pr-triage-pubsub-client`

Each is a leaf client package depending only on `@intexuraos/infra-pubsub` + `@intexuraos/common-core`.

Tests (copied verbatim from existing infra-pubsub test files, import paths updated):

```ts
// packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWhatsAppSendPublisher } from '../whatsappSendPublisher.js';
// ... identical body to packages/infra-pubsub/src/__tests__/whatsappSendPublisher.test.ts
```

Run: `pnpm --filter @intexuraos/whatsapp-pubsub-client test` → PASS.

- [ ] **Step 3: Repeat Step 2 for `retired-checklist-pubsub-client`, `calendar-pubsub-client`, `pr-triage-pubsub-client`**

Each is created from verbatim copies of the corresponding current `packages/infra-pubsub/src/<publisher>.ts` + test. Confirm `pnpm --filter <new-pkg> test` passes after each.

- [ ] **Step 4: Update consumer imports**

For every file enumerated in Step 1, change:

```ts
// BEFORE
import { createWhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
// AFTER
import { createWhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
```

Add corresponding workspace dep to each consumer's `package.json`. Commit per consumer.

- [ ] **Step 5: Delete typed publishers from `infra-pubsub`**

```bash
git rm packages/infra-pubsub/src/{whatsappSendPublisher,todosProcessingPublisher,calendarPreviewPublisher,prTriagePublisher}.ts
git rm packages/infra-pubsub/src/__tests__/{whatsappSendPublisher,todosProcessingPublisher,calendarPreviewPublisher,prTriagePublisher}.test.ts
```

Edit `packages/infra-pubsub/src/types.ts` — keep only generic types:

```ts
export interface PublishError {
  reason: 'timeout' | 'permission-denied' | 'unknown';
  message: string;
  cause?: unknown;
}
// delete SendMessageEvent, WhatsAppInteractiveButton, WhatsAppSendPublisherConfig,
// TodoProcessingEvent, TodosProcessingPublisherConfig,
// CalendarPreviewGenerateEvent, CalendarPreviewPublisherConfig,
// PRTriageEvent, PRTriagePublisherConfig
```

Edit `packages/infra-pubsub/src/index.ts`:

```ts
export type { PublishError } from './types.js';
export {
  BasePubSubPublisher,
  type BasePubSubPublisherConfig,
  type PublishContext,
} from './basePublisher.js';
```

- [ ] **Step 6: Verify**

```bash
pnpm install
pnpm -w tsc --noEmit 2>&1 | tee /tmp/ci-sub-b-tsc.txt
pnpm run ci:tracked 2>&1 | tee /tmp/ci-sub-b-full.txt
```

Expected: PASS. Any failure = missed consumer.

- [ ] **Step 7: Update docs**

Modify `docs/architecture/pubsub-standards.md` and `docs/packages/infra-pubsub/README.md` to describe the new package layout.

- [ ] **Step 8: Commit & open PR** (title: `[INT-1537] [refactor] infra-pubsub slim-down (SUB-B)`)

---

## Subtask SUB-C — http-server + common-http slimming + redaction move

**Branch:** `feature/int-1537-sub-c-http-packages`
**Owner packages:** `packages/http-server`, `packages/common-http`, `packages/llm-utils`, `packages/common-core`.

**Files:**
- Create: `packages/common-core/src/redaction.ts` (moved from `llm-utils`).
- Create: `packages/common-core/src/__tests__/redaction.test.ts` (moved).
- Modify: `packages/common-core/src/index.ts` (add redaction exports).
- Modify: `packages/common-core/package.json` (add `./redaction` sub-path export for ESM-direct imports).
- Delete: `packages/llm-utils/src/redaction.ts`, test, and `index.ts` re-exports.
- Modify: `packages/common-http/src/http/logger.ts` (import redaction from common-core).
- Modify: `packages/common-http/src/index.ts` (remove `llm-utils` re-exports).
- Modify: `packages/common-http/package.json` (remove `@intexuraos/llm-utils` dep).
- Delete: `checkNotionSdk` from `packages/http-server/src/health.ts` + `index.ts` + its test.
- Create: `apps/notion-service/src/infra/health/notionSdkHealthCheck.ts` + test.
- Modify: `apps/notion-service/src/server.ts` (register its own health component).
- Modify: `packages/http-server/src/health.ts` (remove `getFirestore` + Firestore check; require each service to pass a `Record<string, HealthCheck>` into the generic checker).
- Modify: `packages/http-server/src/__tests__/health.test.ts` (drop Firestore + Notion-specific cases, add generic adapter cases).
- Modify: `packages/http-server/package.json` (remove `@intexuraos/infra-firestore` dep).
- Modify: all apps using `registerHealthCheck` to pass their own Firestore check — see Step 5.

- [ ] **Step 1: Move redaction to common-core (TDD)**

Copy `packages/llm-utils/src/redaction.ts` → `packages/common-core/src/redaction.ts`, byte-for-byte. Copy its test file and adjust import path:

```ts
// packages/common-core/src/__tests__/redaction.test.ts
import { describe, it, expect } from 'vitest';
import { redactToken, redactObject, SENSITIVE_FIELDS } from '../redaction.js';
// ... test bodies copied verbatim
```

Append to `packages/common-core/src/index.ts`:

```ts
// Redaction helpers for logging
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';
```

Append to `packages/common-core/package.json` exports map:

```json
"./redaction": "./src/redaction.ts"
```

Run: `pnpm --filter @intexuraos/common-core test` → PASS.

- [ ] **Step 2: Rewrite common-http to consume from common-core**

```ts
// packages/common-http/src/http/logger.ts — change
import { redactToken, redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-utils';
// to
import { redactToken, redactObject, SENSITIVE_FIELDS } from '@intexuraos/common-core';
```

Remove re-exports of redaction from `packages/common-http/src/index.ts` if any. Remove `@intexuraos/llm-utils` from `packages/common-http/package.json` `"dependencies"`.

Run: `pnpm install && pnpm --filter @intexuraos/common-http test` → PASS.

- [ ] **Step 3: Delete redaction from llm-utils**

```bash
git rm packages/llm-utils/src/redaction.ts
git rm packages/llm-utils/src/__tests__/redaction.test.ts
```

Edit `packages/llm-utils/src/index.ts` — remove the three redaction exports.

Audit any OTHER consumer of `@intexuraos/llm-utils` that imports `redactToken`/`redactObject`/`SENSITIVE_FIELDS` via grep (memory mem_4b8fb197). If found, redirect to `@intexuraos/common-core`.

Run: `pnpm -w tsc --noEmit` → PASS.

- [ ] **Step 4: Extract `checkNotionSdk` into notion-service**

Move the body of `checkNotionSdk` from `packages/http-server/src/health.ts` into `apps/notion-service/src/infra/health/notionSdkHealthCheck.ts`. Create its test (either copy from `packages/http-server/src/__tests__/health.test.ts` or write new). Update `apps/notion-service/src/server.ts` to register the local health check via whatever API SUB-C's refactored `registerHealthCheck(fastify, { checks })` exposes.

Delete `checkNotionSdk` export from `packages/http-server/src/health.ts` and `index.ts`; delete matching test cases.

- [ ] **Step 5: Decouple Firestore from http-server**

Refactor `packages/http-server/src/health.ts` so it no longer imports `@intexuraos/infra-firestore`. Replace the current shape:

```ts
// BEFORE (approx):
import { getFirestore } from '@intexuraos/infra-firestore';
export async function registerHealthCheck(fastify, opts) {
  // hardcoded firestore check
}
```

with:

```ts
// AFTER:
export interface HealthCheck {
  name: string;
  check: () => Promise<{ ok: true } | { ok: false; detail?: string }>;
}
export async function registerHealthCheck(
  fastify: FastifyInstance,
  opts: { checks: HealthCheck[] }
): Promise<void> {
  // iterate opts.checks
}
```

Each app that previously relied on the built-in Firestore check now registers its own `firestoreHealthCheck` (already present in most apps via `getFirestore()`).

Update `packages/http-server/package.json` — remove `"@intexuraos/infra-firestore": "workspace:*"` from `"dependencies"`.

- [ ] **Step 6: Update every `registerHealthCheck` caller**

Grep: `registerHealthCheck(`. Expected callers: every Fastify app. For each, supply the service's Firestore check explicitly. Commit per app.

- [ ] **Step 7: Verify repo-wide**

```bash
pnpm install
pnpm -w tsc --noEmit 2>&1 | tee /tmp/ci-sub-c-tsc.txt
pnpm run ci:tracked 2>&1 | tee /tmp/ci-sub-c-full.txt
```

- [ ] **Step 8: Commit & open PR** (title: `[INT-1537] [refactor] http-server + common-http slim, move redaction (SUB-C)`)

---

## Subtask SUB-D — Dependency alignment, `peerDependencies`, dead-code gate

**Branch:** `feature/int-1537-sub-d-deps`
**Owner:** root workspace + every `package.json` in `packages/`.

**Files:**
- Modify: `pnpm-workspace.yaml` (add `catalog:` block).
- Modify: every `packages/*/package.json` that declares `openai`, `fastify`, `pino`, `zod`, or `@google-cloud/firestore` at a hard version.
- Modify: `packages/llm-pricing/package.json` (remove `@intexuraos/infra-firestore` dep).
- Modify: `apps/retired-chat-service/package.json` (bump `openai` to catalog).
- Create: `scripts/verify-dead-code.mjs` (knip runner + allowlist).
- Create: `scripts/verify-package-exports.mjs` (source-exports policy gate).
- Modify: `package.json` root (`ci:tracked` script includes new gates).
- Create: `knip.json` (or `.knip.jsonc`) config.

- [ ] **Step 1: Introduce pnpm catalog**

Edit `/repo/pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'workers/*'
  - 'tools/log-server'
  - 'tools/sample-data'
  - 'e2e'
  - 'e2e/mock-claude'

catalog:
  openai: ^6.15.0
  fastify: ^5.2.0
  pino: ^9.5.0
  zod: ^3.24.1
  '@google-cloud/firestore': ^7.11.0
```

(Verify actual current maxima via `pnpm list --depth 0 --filter ./packages --json`; pick the highest pinned non-major-breaking value. Document choices in `docs/plans/INT-1537-sub-d-catalog-choices.md`.)

- [ ] **Step 2: Rewrite every affected `package.json` to use `catalog:`**

Example:

```diff
   "dependencies": {
-    "openai": "^5.3.0"
+    "openai": "catalog:"
   }
```

Do this for every occurrence of the catalogued deps in:

- `packages/infra-openrouter/package.json` (openai 5→catalog)
- `packages/infra-gpt/package.json` (openai 6→catalog)
- `apps/code-agent/package.json` (openai 6→catalog)
- `apps/retired-chat-service/package.json` (openai 4→catalog; bump may be breaking — validate behavior & bump tests)
- `workers/orchestrator/package.json` (openai 6→catalog)
- Every `fastify`/`pino`/`zod` consumer in `packages/*`.

For `apps/retired-chat-service`, read its OpenAI usage first; if v6 API changed, add migration steps here (none expected for simple `chat.completions.create`).

Run: `pnpm install` → PASS. Run `pnpm -w tsc --noEmit` → PASS.

- [ ] **Step 3: Convert shared runtime libs to `peerDependencies`**

For each of `packages/infra-*`, `packages/common-http`, `packages/http-server`, move `fastify`/`pino`/`zod`/`@google-cloud/firestore` from `"dependencies"` → `"peerDependencies"` (keep `"devDependencies"` mirror pinned to `catalog:` so tests run):

```json
"peerDependencies": {
  "fastify": "^5.2.0"
},
"devDependencies": {
  "fastify": "catalog:"
}
```

Run: `pnpm install --strict-peer-dependencies=false && pnpm run ci:tracked`. Verify peer-dep warnings are only about missing peers that consumers already supply.

- [ ] **Step 4: Delete `@intexuraos/infra-firestore` dep from `llm-pricing`**

```diff
// packages/llm-pricing/package.json
   "dependencies": {
     "@intexuraos/common-core": "workspace:*",
-    "@intexuraos/infra-firestore": "workspace:*",
     "@intexuraos/llm-contract": "workspace:*"
   },
```

Run: `pnpm install && pnpm --filter @intexuraos/llm-pricing test` → PASS.

- [ ] **Step 5: Add `knip` dead-code gate**

Install: `pnpm add -Dw knip`. Add `/repo/knip.json`:

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "workspaces": {
    ".": {
      "entry": ["scripts/**/*.mjs"]
    },
    "packages/*": {
      "entry": ["src/index.ts"],
      "project": ["src/**/*.ts"]
    },
    "apps/*": {
      "entry": ["src/index.ts", "src/start.ts"],
      "project": ["src/**/*.ts"]
    },
    "workers/*": {
      "entry": ["src/main.ts", "src/start.ts", "src/index.ts"],
      "project": ["src/**/*.ts"]
    }
  }
}
```

Create `/repo/scripts/verify-dead-code.mjs`:

```js
// Runs knip; exits non-zero if unlisted exports / files detected.
import { execSync } from 'node:child_process';
try {
  execSync('pnpm exec knip --no-progress --reporter symbols', { stdio: 'inherit' });
} catch (err) {
  console.error('Dead-code check failed. Fix or allowlist in knip.json.');
  process.exit(1);
}
```

Wire into root `package.json`:

```json
"scripts": {
  "verify:dead-code": "node scripts/verify-dead-code.mjs",
  "ci:tracked": "... && pnpm run verify:dead-code"
}
```

First run is expected to surface MORE dead symbols than we removed. Decide per symbol: delete, or explicit allowlist entry in `knip.json` with a one-line comment.

- [ ] **Step 6: Final verification**

```bash
pnpm install
pnpm run ci:tracked 2>&1 | tee /tmp/ci-sub-d-full.txt
```

- [ ] **Step 7: Commit & open PR** (title: `[INT-1537] [refactor] align deps, peerDependencies, knip gate (SUB-D)`)

---

## Subtask SUB-E — Docs, READMEs, build-output policy

**Branch:** `feature/int-1537-sub-e-docs-build-policy`
**Owner:** docs + CLAUDE.md + tsconfig + CI policy script.

**Files:**
- Modify: `packages/README.md` (regenerate).
- Modify: `docs/architecture/package-contracts.md` (regenerate).
- Create: stub `README.md` for 11 packages currently missing one.
- Modify: `.claude/CLAUDE.md` (update `packages/*/dist/` rule).
- Create: `scripts/verify-package-exports.mjs` (policy gate).
- Modify: `package.json` root (`ci:tracked` includes the new gate).
- Modify: `packages/*/tsconfig.json` (where needed) to standardise the source-exports model.

- [ ] **Step 1: Pick the build-output model**

Decision (documented in this plan): **source-exports is the default**; `dist/` is only emitted for `infra-otel` because its `--import @intexuraos/infra-otel/register` hook must resolve at Node's ESM loader stage without transpilation-on-the-fly.

Record rationale in new `docs/architecture/package-build-output.md`.

- [ ] **Step 2: Regenerate `packages/README.md`**

Write a script `/repo/scripts/generate-packages-readme.mjs` that walks `packages/*/package.json` and emits a markdown table (name, version, purpose pulled from the package's README H1). Run it. Commit both the generator and the output.

- [ ] **Step 3: Regenerate `docs/architecture/package-contracts.md`**

Rewrite the document from filesystem truth. Every package listed in the table must exist on disk; every package on disk must appear. Remove phantom `infra-glm`/`llm-audit` entries.

- [ ] **Step 4: Add stub READMEs for the 11 packages missing them**

For each of: `common-core`, `common-http`, `http-contracts`, `http-server`, `infra-firestore`, `infra-notion`, `infra-openrouter`, `infra-otel`, `infra-pubsub`, `infra-whatsapp`, `internal-clients` — create a 30-line README following the template from `packages/llm-utils/README.md`:

```markdown
# @intexuraos/<name>

<one-line purpose>

## Contract

- Public exports: <bullet list from src/index.ts>
- Runtime peers: <list>
- Depends on: <list>

## Usage

\`\`\`ts
import { X } from '@intexuraos/<name>';
\`\`\`

## Tests

\`pnpm --filter @intexuraos/<name> test\`
```

Fill per package from current `src/index.ts`.

- [ ] **Step 5: Update CLAUDE.md**

Edit `/repo/.claude/CLAUDE.md` "Verification" block:

```diff
- **Verification:** Run from repo root. (1) `pnpm run verify:workspace:tracked -- <app-name>`. (2) Verify `packages/*/dist/` exists. (3) `pnpm run ci:tracked` must pass.
+ **Verification:** Run from repo root. (1) `pnpm run verify:workspace:tracked -- <app-name>`. (2) Only `packages/infra-otel` emits a `dist/` — all other packages export directly from `src/`. (3) `pnpm run ci:tracked` must pass.
```

- [ ] **Step 6: Add `verify-package-exports.mjs`**

Create `/repo/scripts/verify-package-exports.mjs`:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = readdirSync('packages').filter((p) => !p.startsWith('.') && existsSync(join('packages', p, 'package.json')));
const EXCEPTIONS = new Set(['infra-otel']);
const failures = [];

for (const pkg of PACKAGES) {
  const pkgJson = JSON.parse(readFileSync(join('packages', pkg, 'package.json'), 'utf8'));
  const exportsMap = pkgJson.exports ?? {};
  const mainExport = typeof exportsMap === 'string' ? exportsMap : exportsMap['.'];
  if (!mainExport) continue;
  const points = typeof mainExport === 'string' ? [mainExport] : Object.values(mainExport);
  const usesDist = points.some((p) => typeof p === 'string' && p.startsWith('./dist/'));
  if (EXCEPTIONS.has(pkg)) {
    if (!usesDist) failures.push(`${pkg}: expected dist/ exports (exception pkg)`);
  } else if (usesDist) {
    failures.push(`${pkg}: exports must reference ./src/ not ./dist/`);
  }
}

if (failures.length) {
  console.error('Package-export policy violations:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log(`Package-export policy OK (${PACKAGES.length} packages).`);
```

Wire into root `package.json` `"ci:tracked"`.

- [ ] **Step 7: Verify**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-sub-e-full.txt
```

Any dist-based export outside `infra-otel` must be converted (or the exception list expanded with explicit rationale committed to this plan).

- [ ] **Step 8: Commit & open PR** (title: `[INT-1537] [refactor] regenerate docs + build-output policy (SUB-E)`)

---

## Endpoint Changes

- **Modified:** none — this is a packaging refactor; no HTTP surface changes.
- **Created:** none.
- **Removed:** none.
- **Unchanged:** all `/internal/*` and `/health` routes keep their existing contract; SUB-C refactors the `registerHealthCheck` in-process API only.

## Acceptance Criteria

- [ ] `packages/common-core/src/` contains no domain logic: no `labels`, `codeTaskWorkerTypes`, `planPathResolver`, `internalServiceCatalog`, `serviceFeedback`, `nullability`. `src/index.ts` exports only generic primitives.
- [ ] Three new leaf domain packages exist: `@intexuraos/linear-domain`, `@intexuraos/code-task-domain`, `@intexuraos/service-catalog`, each with tests that migrated from `common-core`.
- [ ] `@intexuraos/infra-pubsub` exports only `BasePubSubPublisher`, `BasePubSubPublisherConfig`, `PublishContext`, `PublishError`. All integration-specific publishers live in their owning leaf client packages.
- [ ] `packages/http-server` no longer exports `checkNotionSdk` and no longer depends on `@intexuraos/infra-firestore`. Each service registers its own Firestore health check.
- [ ] `@intexuraos/common-core` exposes `redactToken`, `redactObject`, `SENSITIVE_FIELDS`; `@intexuraos/common-http` no longer depends on `@intexuraos/llm-utils`; redaction symbols deleted from `llm-utils`.
- [ ] A single `openai` major is pinned repo-wide via pnpm catalog; `fastify`, `pino`, `zod` also catalogued.
- [ ] Every `infra-*`, `common-http`, `http-server` declares `fastify`/`pino`/`zod`/firestore as `peerDependencies` with a `devDependencies` mirror.
- [ ] `packages/llm-pricing/package.json` no longer declares `@intexuraos/infra-firestore` as a dep.
- [ ] `knip`-based `verify:dead-code` CI gate is part of `ci:tracked` and passes.
- [ ] 21/21 packages ship a `README.md`; `packages/README.md` and `docs/architecture/package-contracts.md` match filesystem reality.
- [ ] `.claude/CLAUDE.md` `packages/*/dist/` rule reflects the chosen model; `scripts/verify-package-exports.mjs` enforces it.
- [ ] `pnpm run ci:tracked` passes on all five feature branches AND on `development` after all are merged.

## Test Plan

- [ ] Unit: Each new leaf package has 95% branch coverage via migrated tests.
- [ ] Unit: `packages/common-core/src/__tests__/redaction.test.ts` passes.
- [ ] Integration: `pnpm --filter apps/whatsapp-service test`, `pnpm --filter apps/retired-checklist-service test`, `pnpm --filter apps/calendar-agent test`, `pnpm --filter apps/code-agent test`, `pnpm --filter apps/notion-service test` all PASS.
- [ ] Repo: `pnpm -w tsc --noEmit` PASS (no missed consumer).
- [ ] Repo: `pnpm run ci:tracked` PASS.
- [ ] Repo: `pnpm exec knip --no-progress` PASS on each merged branch.
- [ ] Manual: dispatch a code task end-to-end (linear-agent → code-agent → orchestrator) to validate label parsing, worker-type enum, plan-path resolution, and publisher routing still work after the import-path changes.

## Risks & Mitigations

- **Circular-dep risk when packages import each other post-extraction.** Mitigation: each new leaf domain package depends ONLY on `@intexuraos/common-core`; verified by adding an ESLint `import/no-cycle` rule run in CI.
- **pnpm catalog `openai` bump breaks `retired-chat-service`** (currently pinned to v4). Mitigation: SUB-D Step 2 includes an explicit adapter-behavior test run; if breakage, document it in `docs/plans/INT-1537-sub-d-catalog-choices.md` and either bump with a code fix or keep `retired-chat-service` off-catalog with a TODO.
- **knip surfaces more dead code than expected.** Mitigation: allowlist with rationale in `knip.json`; escalate large findings to a follow-up ticket rather than ballooning this refactor.
- **Consumer import-path rewrites miss a file** (per memory mem_4b8fb197). Mitigation: each sub-plan mandates a global grep + compile check BEFORE deleting the old export, AND a final `pnpm -w tsc --noEmit` pass AFTER deletion.

## Rollback

Every subtask lands on a separate feature branch with a separate PR. Individual rollback = revert the PR. Since signatures do not change, reverting one subtask does not destabilize the others.
