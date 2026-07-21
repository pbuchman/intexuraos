# Intex Agent DeepSeek Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete execution-goal steps 2–4: make DeepSeek V4 Flash the shared Intex Agent default, persist an independent per-user preference, resolve one immutable runtime model per product turn, and expose the three-option settings UX.

**Architecture:** `@intexuraos/llm-contract` owns the only canonical catalog. User Service owns selector persistence and availability. Intex Agent obtains one strict internal runtime snapshot and uses the platform OpenRouter key. Web consumes the existing authenticated settings surface and never authorizes availability itself.

**Tech Stack:** TypeScript, Fastify, Firestore transactions, React, Vitest, OpenRouter adapters.

## Global Constraints

- This file is planning output only. Ultra reasoning must not implement it.
- After step 1, use a GPT-5.6 Extra High orchestrator. Delegate bounded RED/GREEN work to
  `gpt-5.6-terra` at medium or high reasoning; reserve the orchestrator for dependency,
  integration, and review decisions. Do not use Ultra during steps 2–4.
- Follow the exact contracts in
  [`2026-07-19-intex-agent-test-runs-ux-design.md`](../specs/2026-07-19-intex-agent-test-runs-ux-design.md).
- Use TDD: add the named RED assertion, run it and record the intended failure, then make
  the smallest production change and rerun it GREEN.
- Finish, independently review, hash-checkpoint, and send the frozen WhatsApp completion
  message for step 2 before starting step 3; apply the same gate between steps 3 and 4.
  Steps 2–4 create no Git commit; step 13 commits the single unchanged CI-tested tree.
- Never add DeepSeek, MiniMax, or Gemini to the general BYOK default-model allowlist solely
  for this feature. The Intex-specific catalog is independent.
- Do not run `pnpm run ci:tracked` in steps 2–4. Use only the focused commands below; the
  next repository-wide gate is step 13.

## Locked File Map

### Create

- `packages/infra-openrouter/src/intexAgentCatalog.ts`
- `packages/infra-openrouter/src/__tests__/intexAgentCatalog.test.ts`
- `packages/infra-openrouter/src/catalogClient.ts`
- `packages/infra-openrouter/src/__tests__/catalogClient.test.ts`
- `apps/user-service/src/config.ts`
- `apps/user-service/src/__tests__/config.test.ts`
- `apps/user-service/src/domain/settings/intexAgentModelAvailability.ts`
- `apps/user-service/src/__tests__/domain/settings/intexAgentModelAvailability.test.ts`
- `apps/web/src/hooks/useIntexAgentModel.ts`
- `apps/web/src/hooks/__tests__/useIntexAgentModel.test.ts`
- `apps/web/src/components/IntexAgentModelCard.tsx`
- `apps/web/src/components/__tests__/IntexAgentModelCard.test.tsx`

### Modify

- `packages/llm-contract/src/supportedModels.ts`
- `packages/llm-contract/src/index.ts`
- `packages/llm-contract/src/__tests__/supportedModels.test.ts`
- `packages/infra-openrouter/src/allowlist.ts`
- `packages/infra-openrouter/src/client.ts`
- `packages/infra-openrouter/src/costCalculator.ts`
- `packages/infra-openrouter/src/index.ts`
- `packages/infra-openrouter/src/__tests__/allowlist.test.ts`
- `packages/infra-openrouter/src/__tests__/client.test.ts`
- `packages/infra-openrouter/src/__tests__/costCalculator.test.ts`
- `packages/infra-openrouter/src/__tests__/toolCallingClient.test.ts`
- `packages/llm-factory/src/llmClientFactory.ts`
- `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`
- `apps/research-agent/src/routes/openRouterRoutes.ts`
- `apps/research-agent/src/__tests__/routes/openRouterRoutes.test.ts`
- `apps/user-service/src/domain/settings/models/UserSettings.ts`
- `apps/user-service/src/domain/settings/ports/UserSettingsRepository.ts`
- `apps/user-service/src/infra/firestore/userSettingsRepository.ts`
- `apps/user-service/src/routes/llmKeysRoutes.ts`
- `apps/user-service/src/routes/settingsRoutes.ts`
- `apps/user-service/src/routes/internalRoutes.ts`
- `apps/user-service/src/index.ts`
- `apps/user-service/src/services.ts`
- `apps/user-service/src/__tests__/infra/userSettingsRepository.test.ts`
- `apps/user-service/src/__tests__/llmKeysRoutes.test.ts`
- `apps/user-service/src/__tests__/settingsRoutes.test.ts`
- `apps/user-service/src/__tests__/internalRoutes.test.ts`
- `apps/user-service/src/__tests__/openapi-contract.test.ts`
- `apps/user-service/src/__tests__/schemas.test.ts`
- `apps/user-service/src/__tests__/fakes.ts`
- `packages/internal-clients/src/user-service/types.ts`
- `packages/internal-clients/src/user-service/client.ts`
- `packages/internal-clients/src/user-service/__tests__/client.test.ts`
- `apps/intex-agent/src/domain/agent/systemPrompt.ts`
- `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- `apps/intex-agent/src/config.ts`
- `apps/intex-agent/src/services.ts`
- `apps/intex-agent/src/__tests__/config.test.ts`
- `apps/intex-agent/src/__tests__/services.test.ts`
- `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`
- `apps/intex-agent/package.json`
- `apps/web/src/services/llmKeysApi.types.ts`
- `apps/web/src/services/llmKeysApi.ts`
- `apps/web/src/services/__tests__/llmKeysApi.test.ts`
- `apps/web/src/pages/ApiKeysSettingsPage.tsx`
- `apps/web/src/pages/__tests__/ApiKeysSettingsPage.test.tsx`
- `apps/web/src/hooks/index.ts`
- `apps/web/src/services/index.ts`
- `ecosystem.config.cjs`
- `ecosystem.config.prod.cjs`
- `terraform/environments/dev/main.tf`
- `scripts/__tests__/ecosystem.config.test.ts`
- `scripts/__tests__/ecosystem.prod.config.test.ts`
- `pnpm-lock.yaml`

## Step 2 — Shared Catalog and DeepSeek Default

### Task 2.1: Freeze the canonical three-model contract

- [ ] Add RED cases to `packages/llm-contract/src/__tests__/supportedModels.test.ts` for
  exact membership, ordering, labels/providers, unsafe inputs, the DeepSeek default, and
  tool-calling eligibility for all three models.
- [ ] Run the focused test and retain the missing-export/default failure in the task log.
- [ ] In `supportedModels.ts`, add these exact public symbols:

```ts
export type IntexAgentModel =
  | OpenRouterDeepSeekV4Flash
  | OpenRouterMiniMaxM3
  | OpenRouterGemini3FlashPreview;

export const IntexAgentModels = {
  DeepSeekV4Flash: createOpenRouterModelId('deepseek/deepseek-v4-flash') as OpenRouterDeepSeekV4Flash,
  MiniMaxM3: createOpenRouterModelId('minimax/minimax-m3') as OpenRouterMiniMaxM3,
  Gemini3FlashPreview: createOpenRouterModelId('google/gemini-3-flash-preview') as OpenRouterGemini3FlashPreview,
} as const;

export const DEFAULT_INTEX_AGENT_MODEL = IntexAgentModels.DeepSeekV4Flash;
export const INTEX_AGENT_MODEL_OPTIONS = [
  { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash', provider: 'DeepSeek' },
  { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3', provider: 'MiniMax' },
  { id: IntexAgentModels.Gemini3FlashPreview, label: 'Gemini 3 Flash Preview', provider: 'Google' },
] as const;
```

- [ ] Implement `isIntexAgentModel(value: unknown)` as non-throwing exact membership.
- [ ] Extend `OpenRouterToolCallingModel`, `OpenRouterToolCallingModels`, and
  `ALL_TOOL_CALLING_MODELS`; export the new contract from `index.ts`.
- [ ] Rerun the contract test GREEN.

### Task 2.2: Admit and account for DeepSeek at the adapter boundary

- [ ] Add RED cases for raw DeepSeek allowlisting, exact fallback metadata, live catalog
  rejection, tool calls, and every LLM-factory entry point.
- [ ] Add raw `deepseek/deepseek-v4-flash` only to `OPENROUTER_ALLOWED_MODELS` with context
  `1_048_576`, prompt `0.000000098`, and completion `0.000000196` USD/token.
- [ ] Implement `intexAgentCatalog.ts` with:

```ts
export const INTEX_AGENT_CATALOG_SNAPSHOT_VERSION = '2026-07-19' as const;
export const INTEX_AGENT_REQUIRED_PARAMETERS =
  ['tools', 'tool_choice', 'response_format', 'structured_outputs'] as const;
export function assertIntexAgentCatalogConformance(
  liveCatalog: unknown,
  fetchedAt: string
): IntexAgentCatalogEvidence;
```

- [ ] Implement `catalogClient.ts` as the sole bounded OpenRouter `/api/v1/models` fetcher:
  ten-second timeout, response-size/schema bounds, no raw-body logging, one startup fetch,
  a five-minute freshness deadline, and a single-flight refresh. Refactor Research Agent
  to consume it instead of retaining an app-local catalog parser.

- [ ] Store the reviewed canonical DeepSeek slug, cache-read price
  `0.0000000196`, text modalities, context, required parameters, and catalog-entry digest.
- [ ] Fail closed on absent entries, context below one million, malformed/non-positive
  prompt or completion prices, or missing required parameters. Do not invent zero cost.
- [ ] Audit MiniMax and Gemini through the same catalog path and prove all generation,
  classifier, structured-repair, and tool-calling factories retain the canonical `or:` ID
  until the OpenRouter wire adapter strips it.
- [ ] Preserve positive finite provider-reported cost through both generation and
  tool-calling clients. Add RED/GREEN tests for `normalizeUsage()`, missing/malformed cost,
  and catalog admission so evaluation can reject unknown cost rather than silently treating
  it as zero.

### Step 2 verification and handoff

```bash
pnpm exec vitest run \
  packages/llm-contract/src/__tests__/supportedModels.test.ts \
  packages/infra-openrouter/src/__tests__/allowlist.test.ts \
  packages/infra-openrouter/src/__tests__/intexAgentCatalog.test.ts \
  packages/infra-openrouter/src/__tests__/catalogClient.test.ts \
  packages/infra-openrouter/src/__tests__/client.test.ts \
  packages/infra-openrouter/src/__tests__/costCalculator.test.ts \
  packages/infra-openrouter/src/__tests__/toolCallingClient.test.ts \
  packages/llm-factory/src/__tests__/llmClientFactory.test.ts \
  apps/research-agent/src/__tests__/routes/openRouterRoutes.test.ts
pnpm --filter @intexuraos/llm-contract typecheck
pnpm --filter @intexuraos/infra-openrouter typecheck
pnpm --filter @intexuraos/llm-factory typecheck
pnpm --filter @intexuraos/research-agent typecheck
pnpm run verify:package-exports
pnpm run verify:workspace:tracked -- research-agent
```

- [ ] Have an independent subagent review type boundaries, fallback metadata, and no
  accidental general-BYOK expansion; resolve all Critical/Important findings.
- [ ] Record the reviewed step-2 content hashes and focused evidence in the active goal,
  machine-confirm the step-2 WhatsApp message, then advance to step 3 without a Git commit.

## Step 3 — Per-User Persistence and Runtime Resolution

### Task 3.1: Add an independent revision-safe preference

- [ ] Write RED repository tests for absent revision zero, set, reset, no-op absent reset,
  stale CAS, safe-integer exhaustion, corrupt persisted values, sibling preservation, and
  concurrent general-model/provider-key writes.
- [ ] Extend `LlmPreferences` with optional `intexAgentModel` and
  `intexAgentModelRevision`; make `defaultModel` optional so an Intex-only document is valid.
- [ ] Add repository operations whose closed results distinguish
  `updated | unchanged | conflict | revision_exhausted | invalid_stored_value`.
- [ ] Implement one Firestore transaction that updates/deletes only the Intex field path,
  advances only its revision, and preserves every sibling. Narrow the current whole-map
  `clearLlmPreferences()` behavior to default/fallback field deletion.
- [ ] Convert every existing read-before-create sibling writer—`updateLlmApiKey`,
  `updateLlmTestResult`, `updateLlmLastUsed`, and `updateLlmPreferences`—to transactional
  or atomic field-path semantics. Barrier tests cover both commit orders against selector
  creation and prove no lost model/revision, metadata, or unrelated sibling.

### Task 3.2: Expose self-only settings and the internal runtime contract

- [ ] Write RED route tests for auth-before-availability, exact self-only access, available
  and unavailable projections, strict three-option responses, mixed-arm rejection, `409`
  CAS conflict, and static revision-exhaustion/invalid-state errors.
- [ ] Extend `GET /users/:uid/settings/llm-keys` with the exact
  `IntexAgentModelSelectorV1` union from the specification (`status: 'available'` or
  `status: 'unavailable'`).
- [ ] Extend `PATCH /users/:uid/settings` with the independent body
  `{ intexAgentModel: IntexAgentModel | null, expectedRevision: number }`; reject mixed or
  unknown fields and never require BYOK.
- [ ] Add `GET /internal/users/:uid/settings/intex-agent-runtime`. Available users receive
  explicit/effective/source/revision/time zone; unavailable runtime/user receives only
  DeepSeek `platform_default` plus time zone and does not decode a stored selector.
- [ ] Make selector availability depend on both exact Home Dev user rollout and a fresh
  conformant catalog snapshot from the reusable client. User Service performs the startup
  fetch only when rollout is enabled, stores no catalog payload, marks the selector
  unavailable on failure/staleness, and single-flight refreshes before freshness expires.
  Production sentinel `disabled` performs no fetch and needs no OpenRouter secret.
- [ ] Add strict internal-client types/decoder and URL encoding in
  `packages/internal-clients/src/user-service/`.
- [ ] Wire `INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID`: machine-local exact Home Dev
  subject, production sentinel `disabled`, no account identifier in tracked source.
- [ ] Add the selector variable to User Service `REQUIRED_ENV`, config parsing, PM2/dev/
  Terraform wiring, and exact ecosystem tests. Deliver the existing platform OpenRouter
  key to User Service only in selector-enabled Home Dev; do not add it to the production
  User Service secret list.

### Task 3.3: Use one immutable model snapshot per ordinary turn

- [ ] Write RED Intex tests proving exactly one runtime lookup per turn and equality of the
  model used by classification, generation, tool continuation, and response repair.
- [ ] Remove local static Gemini selection from `systemPrompt.ts`/`ServiceConfig.model`.
- [ ] Replace separate time-zone lookup with one `resolveRuntimeSettings()` call in
  `handleIncomingMessage.ts`; pass its immutable snapshot into the runner.
- [ ] Make product factories use the snapshot and platform OpenRouter key. Provider failure
  is explicit and cannot change the snapshot. Keep endpoint-evaluator forcing for step 11.
- [ ] Intex Agent uses the same catalog client/readiness object; an unavailable or stale
  catalog makes selector/corpus admission unavailable and is never replaced by the tracked
  fallback snapshot. Startup/readiness tests cover pass, fail, stale, refresh, and recovery.

### Step 3 verification and handoff

```bash
pnpm exec vitest run \
  apps/user-service/src/__tests__/infra/userSettingsRepository.test.ts \
  apps/user-service/src/__tests__/llmKeysRoutes.test.ts \
  apps/user-service/src/__tests__/settingsRoutes.test.ts \
  apps/user-service/src/__tests__/internalRoutes.test.ts \
  apps/user-service/src/__tests__/config.test.ts \
  apps/user-service/src/__tests__/domain/settings/intexAgentModelAvailability.test.ts \
  apps/user-service/src/__tests__/openapi-contract.test.ts \
  apps/user-service/src/__tests__/schemas.test.ts \
  packages/internal-clients/src/user-service/__tests__/client.test.ts \
  apps/intex-agent/src/__tests__/services.test.ts \
  apps/intex-agent/src/__tests__/config.test.ts \
  apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts \
  scripts/__tests__/ecosystem.config.test.ts \
  scripts/__tests__/ecosystem.prod.config.test.ts
pnpm --filter @intexuraos/user-service typecheck
pnpm --filter @intexuraos/internal-clients typecheck
pnpm --filter @intexuraos/intex-agent typecheck
pnpm run verify:workspace:tracked -- user-service
pnpm run verify:workspace:tracked -- intex-agent
pnpm verify:workspace-deps
```

- [ ] Obtain independent data-integrity/privacy review, resolve findings, record the
  step-3 hash/evidence checkpoint, machine-confirm its WhatsApp message, and advance to
  step 4 without a Git commit.

## Step 4 — Model Settings UX

### Task 4.1: Add the strict client and latest-intent mutation pump

- [ ] Write RED API/hook tests for exact request bytes, optimistic state, rollback to the
  highest confirmed value, serialized rapid choices, one `409` refresh/rebase, unmount,
  logout, and user switch.
- [ ] Add selector/update DTOs in `llmKeysApi.types.ts` and
  `updateIntexAgentModel()` in `llmKeysApi.ts`; its body contains only the Intex model and
  expected revision.
- [ ] Implement `useIntexAgentModel()` with one mutation in flight, latest-intent wins,
  server-returned revisions, independent saving/error state, and subject-scoped cancellation.
- [ ] Treat live capability revocation (`available -> unavailable`) like a subject change:
  abort the in-flight mutation, discard late responses, and remove every selector state and
  focus target immediately.

### Task 4.2: Render the independent accessible card

- [ ] Write RED component/page tests for exact option order, DeepSeek absent default,
  explicit-only reset, immediate save, unavailable omission, BYOK independence, keyboard
  labels, loading/error states, and narrow viewport rendering.
- [ ] Implement `IntexAgentModelCard.tsx` and mount it in `ApiKeysSettingsPage.tsx` without
  sharing mutation state with default/fallback or API keys.
- [ ] Export only the required hook/service/component symbols. Do not add web environment
  flags or expose test-mode/evaluator controls.

### Step 4 verification and handoff

```bash
pnpm --filter @intexuraos/web exec vitest run \
  src/services/__tests__/llmKeysApi.test.ts \
  src/hooks/__tests__/useIntexAgentModel.test.ts \
  src/components/__tests__/IntexAgentModelCard.test.tsx \
  src/pages/__tests__/ApiKeysSettingsPage.test.tsx
pnpm run verify:workspace:tracked -- web
```

- [ ] Obtain independent UX/accessibility and API-contract review, resolve findings,
  record the step-4 hash/evidence checkpoint, machine-confirm its WhatsApp message, and
  advance to step 5 without a Git commit.
