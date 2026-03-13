# ZAI Removal and GLM-5 Finalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution mode:** Single feature branch from `development`. Do **not** use git worktrees; repo rules override the writing-plans default. Do not open a PR with a fabricated `INT-XXX`; if no issue ID is provided, use a descriptive branch name and ask before PR creation.

**Goal:** Remove ZAI and all `glm-4.7*` usage from the repo, keep only Alibaba DashScope-backed `glm-5` in the code-task stack, and run a one-off Firestore migration so persisted user-facing data no longer exposes ZAI or legacy GLM values while historical usage data remains intact.

**Architecture:** Collapse the shared LLM contract to four application providers (`google`, `openai`, `anthropic`, `perplexity`) and remove the ZAI provider branch from pricing, key management, research selection, and app-service wiring. In the code-task subsystem, make `glm-5` the canonical stored/displayed worker type, keep it routed through DashScope in orchestrator/claude-worker, and allow the legacy string `glm` only as an input alias at configuration/parsing boundaries that is normalized immediately to `glm-5`. The immutable Firestore migration removes ZAI pricing/config data, rewrites legacy task records, and sanitizes persisted research/settings documents that would otherwise keep surfacing GLM in the app, but it does not delete historical usage records.

**Tech Stack:** TypeScript, Fastify, React/Vite, Firestore migrations (`migrations/*.mjs`), Vitest, pnpm, rg

**Implementation rules:**
- `glm-5` is allowed only in the code-task subsystem: `apps/code-agent/**`, `workers/orchestrator/**`, `workers/claude-worker/**`, the code-task UI in `apps/web/**`, and their code-task-specific docs.
- `glm` is allowed only as a configuration/input alias inside the code-task subsystem. Persisted documents, emitted API payloads, UI labels, and primary docs should use `glm-5`.
- App-wide fallback clients remain Gemini-only. Do not introduce a DashScope client outside the code-task stack.
- Firestore migration behavior is strict:
  - Remove `llmApiKeys.zai` and `llmTestResults.zai` from `user_settings`.
  - Coerce `user_settings.llmPreferences.defaultModel` from `glm-4.7` / `glm-4.7-flash` to `gemini-2.5-flash`.
  - Rewrite `code_tasks.workerType` from `glm` to `glm-5`.
  - Delete `settings/llm_pricing/providers/zai`.
  - Sanitize `researches` by removing GLM selections/results; if no non-GLM models remain after sanitization, delete the research document. If `synthesisModel` was removed but at least one selected model remains, set it to the first remaining selected model.
  - Leave historical usage/audit data such as `llm_usage_stats` untouched.

**Files overview:**
- Create: `migrations/059_remove-zai-and-finalize-glm5.mjs` (use the next sequential migration ID if another migration lands first)
- Create: `migrations/__tests__/059_remove-zai-and-finalize-glm5.test.ts`
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Modify: `packages/llm-contract/src/__tests__/supportedModels.test.ts`
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`
- Modify: `packages/llm-factory/package.json`
- Modify: `packages/llm-pricing/src/pricingClient.ts`
- Modify: `packages/llm-pricing/src/testFixtures.ts`
- Modify: `packages/llm-pricing/src/__tests__/pricingClient.test.ts`
- Modify: `packages/internal-clients/src/user-service/types.ts`
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Modify: `packages/internal-clients/src/user-service/__tests__/client.test.ts`
- Modify: `packages/llm-prompts/src/research/modelExtractionPrompt.ts`
- Modify: `packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts`
- Modify: `packages/README.md`
- Delete: `packages/infra-glm/package.json`
- Delete: `packages/infra-glm/tsconfig.json`
- Delete: `packages/infra-glm/src/index.ts`
- Delete: `packages/infra-glm/src/client.ts`
- Delete: `packages/infra-glm/src/types.ts`
- Delete: `packages/infra-glm/src/costCalculator.ts`
- Delete: `packages/infra-glm/src/__tests__/client.test.ts`
- Delete: `packages/infra-glm/src/__tests__/costCalculator.test.ts`
- Modify: `apps/app-settings-service/src/index.ts`
- Modify: `apps/app-settings-service/src/routes/publicRoutes.ts`
- Modify: `apps/app-settings-service/src/routes/internalRoutes.ts`
- Modify: `apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts`
- Modify: `apps/app-settings-service/src/__tests__/routes/internalRoutes.test.ts`
- Modify: `apps/user-service/src/domain/settings/models/UserSettings.ts`
- Modify: `apps/user-service/src/services.ts`
- Modify: `apps/user-service/src/routes/llmKeysRoutes.ts`
- Modify: `apps/user-service/src/routes/internalRoutes.ts`
- Modify: `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`
- Modify: `apps/user-service/src/__tests__/llmKeysRoutes.test.ts`
- Modify: `apps/user-service/src/__tests__/internalRoutes.test.ts`
- Modify: `apps/user-service/src/__tests__/infra/llmValidator.test.ts`
- Modify: `apps/research-agent/src/services.ts`
- Modify: `apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts`
- Modify: `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`
- Delete: `apps/research-agent/src/infra/llm/GlmAdapter.ts`
- Delete: `apps/research-agent/src/__tests__/infra/llm/GlmAdapter.test.ts`
- Modify: `apps/research-agent/src/__tests__/domain/research/usecases/extractModelPreferences.test.ts`
- Modify: `apps/research-agent/src/__tests__/infra/llm/LlmAdapterFactory.test.ts`
- Modify: `apps/research-agent/src/__tests__/routes.test.ts`
- Modify: `apps/research-agent/package.json`
- Modify: `apps/actions-agent/src/services.ts`
- Modify: `apps/calendar-agent/src/index.ts`
- Modify: `apps/calendar-agent/src/services.ts`
- Modify: `apps/chat-agent/src/index.ts`
- Modify: `apps/chat-agent/src/services.ts`
- Modify: `apps/chat-agent/src/__tests__/services.test.ts`
- Modify: `apps/commands-agent/src/services.ts`
- Modify: `apps/data-insights-agent/src/index.ts`
- Modify: `apps/image-service/src/services.ts`
- Modify: `apps/linear-agent/src/index.ts`
- Modify: `apps/linear-agent/src/services.ts`
- Modify: `apps/todos-agent/src/services.ts`
- Modify: `apps/web-agent/src/services.ts`
- Modify: `apps/web/src/services/llmKeysApi.types.ts`
- Modify: `apps/web/src/services/researchAgentApi.types.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/ModelSelector.tsx`
- Modify: `apps/web/src/pages/ApiKeysSettingsPage.tsx`
- Modify: `apps/web/src/pages/LlmPricingPage.tsx`
- Modify: `apps/web/src/components/code-tasks/v2/shared.tsx`
- Modify: `apps/web/src/components/ConfirmSubmitModal.tsx`
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx`
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts`
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts`
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`
- Modify: `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/reviewTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/labelUtils.ts`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Modify: `apps/code-agent/src/__tests__/domain/models/codeTask.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/labelUtils.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
- Modify: `workers/claude-worker/entrypoint.sh`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `scripts/verify-env-vars.mjs`
- Modify: `docs/overview.md`
- Modify: `docs/site-index.json`
- Modify: `docs/services/app-settings-service/technical.md`
- Modify: `docs/services/app-settings-service/technical-debt.md`
- Modify: `docs/services/app-settings-service/tutorial.md`
- Modify: `docs/services/app-settings-service/agent.md`
- Modify: `docs/services/user-service/technical.md`
- Modify: `docs/services/user-service/tutorial.md`
- Modify: `docs/services/user-service/agent.md`
- Modify: `docs/services/research-agent/technical.md`
- Modify: `docs/services/research-agent/technical-debt.md`
- Modify: `docs/services/research-agent/tutorial.md`
- Modify: `docs/services/research-agent/agent.md`
- Modify: `docs/services/orchestrator/technical.md`
- Modify: `docs/services/orchestrator/features.md`
- Modify: `docs/services/orchestrator/tutorial.md`
- Modify: `docs/services/orchestrator/agent.md`
- Modify: `docs/services/claude-worker/technical.md`
- Modify: `docs/services/claude-worker/agent.md`
- Modify: `docs/packages/llm-contract/README.md`
- Modify: `docs/packages/llm-contract/agent.md`
- Modify: `docs/packages/llm-factory/README.md`
- Modify: `docs/packages/llm-factory/agent.md`
- Modify: `docs/packages/llm-pricing/README.md`
- Modify: `docs/packages/llm-pricing/agent.md`
- Modify: `docs/packages/internal-clients/README.md`
- Modify: `docs/packages/internal-clients/agent.md`
- Delete: `docs/packages/infra-glm/README.md`
- Delete: `docs/packages/infra-glm/agent.md`
- Modify: `docs/services/index.md`
- Modify: `docs/validation/ai-models-validation.md`
- Modify: `docs/validation/env-vars-validation.md`
- Modify: `docs/validation/meta-validation-report.md`
- Modify: `docs/validation/terraform-code-sync-validation.md`

**Endpoint Changes**

**Modified**
- `GET /users/:uid/settings/llm-keys` removes the `zai` field from the response payload.
- `PATCH /users/:uid/settings/llm-keys` removes `zai` from the accepted provider enum.
- `POST /users/:uid/settings/llm-keys/:provider/test` removes `zai` from the provider enum.
- `DELETE /users/:uid/settings/llm-keys/:provider` removes `zai` from the provider enum.
- `GET /internal/users/:uid/llm-keys` removes the `zai` field from the decrypted-key payload.
- `POST /internal/users/:uid/llm-keys/:provider/last-used` removes `zai` from the provider enum.
- `GET /settings/pricing` removes the `zai` provider block.
- `GET /internal/settings/pricing` removes the `zai` provider block.
- Every code-agent endpoint in `apps/code-agent/src/routes/codeRoutes.ts` that accepts `workerType` allows `glm` as a legacy input alias but normalizes stored/output values to `glm-5`.
- Research-agent request/response payloads keep the same route URLs, but their supported-model enums no longer include `glm-4.7` or `glm-4.7-flash`.

**Created**
- No new HTTP endpoints.

**Removed**
- No endpoint URLs are removed; this is a contract narrowing and enum cleanup.

**Unchanged**
- Route URLs, auth behavior, and request/response envelope shape (`{ success, data }`) stay the same outside the enum/property removals above.

---

## Chunk 1: Remove ZAI from Shared Contracts and Pricing

### Task 1: Lock the shared contract with failing tests

**Files:**
- Modify: `packages/llm-contract/src/__tests__/supportedModels.test.ts`
- Modify: `packages/llm-pricing/src/__tests__/pricingClient.test.ts`
- Modify: `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`
- Modify: `apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts`
- Modify: `apps/app-settings-service/src/__tests__/routes/internalRoutes.test.ts`

- [ ] **Step 1: Update `supportedModels.test.ts` to fail on legacy GLM/ZAI**

Add/replace assertions so the test suite expects:

```ts
expect(ALL_LLM_MODELS).toHaveLength(14);
expect(isValidModel('glm-4.7')).toBe(false);
expect(isValidModel('glm-4.7-flash')).toBe(false);
expect(Object.values(LlmProviders)).not.toContain('zai');
```

- [ ] **Step 2: Update pricing/factory tests to fail on ZAI**

Make `pricingClient.test.ts` and `llmClientFactory.test.ts` expect:
- pricing responses contain only `google`, `openai`, `anthropic`, `perplexity`
- `isSupportedProvider('zai') === false`
- `createLlmClient({ model: 'glm-4.7' as never, ... })` throws unsupported-model/provider

- [ ] **Step 3: Update app-settings-service route tests to fail on `zai`**

Change route assertions so both pricing endpoints fail unless the response shape omits `zai` entirely.

- [ ] **Step 4: Run the focused tests and confirm they fail before implementation**

Run:

```bash
pnpm vitest run \
  packages/llm-contract/src/__tests__/supportedModels.test.ts \
  packages/llm-pricing/src/__tests__/pricingClient.test.ts \
  packages/llm-factory/src/__tests__/llmClientFactory.test.ts \
  apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts \
  apps/app-settings-service/src/__tests__/routes/internalRoutes.test.ts
```

Expected: FAIL with assertions still referencing `zai` / `glm-4.7`.

### Task 2: Remove ZAI from the shared model and pricing source of truth

**Files:**
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/package.json`
- Modify: `packages/llm-pricing/src/pricingClient.ts`
- Modify: `packages/llm-pricing/src/testFixtures.ts`
- Modify: `apps/app-settings-service/src/index.ts`
- Modify: `apps/app-settings-service/src/routes/publicRoutes.ts`
- Modify: `apps/app-settings-service/src/routes/internalRoutes.ts`

- [ ] **Step 1: Remove ZAI provider and GLM-4.7 models from `supportedModels.ts`**

Delete:
- `export type Zai = 'zai'`
- `Glm47` / `Glm47Flash`
- all ZAI entries from `ResearchModel`, `ValidationModel`, `FastModel`, `LLMModel`
- `LlmProviders.Zai`
- `LlmModels.Glm47` / `LlmModels.Glm47Flash`
- ZAI entries from `ALL_LLM_MODELS`, `ALL_FAST_MODELS`, `MODEL_PROVIDER_MAP`, `FAST_MODEL_DISPLAY_NAMES`

- [ ] **Step 2: Remove ZAI support from `llmClientFactory.ts`**

After this edit, `createLlmClient()` should support only the remaining app-side providers it actually instantiates. Do not import or reference `@intexuraos/infra-glm`.

- [ ] **Step 3: Remove `zai` from pricing response types and flattening logic**

In `pricingClient.ts`, update `AllPricingResponse` and `PricingContext` so the four-provider response is exhaustive and validated.

- [ ] **Step 4: Remove `zai` pricing requirements from app-settings-service**

Update both pricing routes and startup validation to:
- fetch only the remaining four providers
- compute totals without `zai`
- fail only on missing non-ZAI providers

- [ ] **Step 5: Run the focused tests again**

Run the same `pnpm vitest run ...` command from Task 1.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/llm-contract/src/supportedModels.ts \
  packages/llm-contract/src/index.ts \
  packages/llm-contract/src/__tests__/supportedModels.test.ts \
  packages/llm-factory/src/llmClientFactory.ts \
  packages/llm-factory/src/__tests__/llmClientFactory.test.ts \
  packages/llm-factory/package.json \
  packages/llm-pricing/src/pricingClient.ts \
  packages/llm-pricing/src/testFixtures.ts \
  packages/llm-pricing/src/__tests__/pricingClient.test.ts \
  apps/app-settings-service/src/index.ts \
  apps/app-settings-service/src/routes/publicRoutes.ts \
  apps/app-settings-service/src/routes/internalRoutes.ts \
  apps/app-settings-service/src/__tests__/routes/publicRoutes.test.ts \
  apps/app-settings-service/src/__tests__/routes/internalRoutes.test.ts
git commit -m "refactor: remove zai from shared llm contracts"
```

## Chunk 2: Remove ZAI from User Settings, App Services, and Web Surfaces

### Task 3: Write failing tests for key management and app fallback cleanup

**Files:**
- Modify: `apps/user-service/src/__tests__/llmKeysRoutes.test.ts`
- Modify: `apps/user-service/src/__tests__/internalRoutes.test.ts`
- Modify: `apps/user-service/src/__tests__/infra/llmValidator.test.ts`
- Modify: `packages/internal-clients/src/user-service/__tests__/client.test.ts`
- Modify: `apps/chat-agent/src/__tests__/services.test.ts`

- [ ] **Step 1: Update user-service route tests**

Make the route tests fail unless:
- response payloads omit `zai`
- provider enums reject `zai`
- decrypted internal payloads omit `zai`

- [ ] **Step 2: Update validator/client tests**

Make the tests fail unless:
- `LlmValidatorImpl` no longer validates `zai`
- `createUserServiceClient()` no longer accepts `platformZaiApiKey`
- user-service client no longer returns `zai` in `DecryptedApiKeys`
- app fallback stays Gemini-only

- [ ] **Step 3: Update chat-agent services test**

Change the guest-client test so it fails unless `chat-agent` stops requiring `INTEXURAOS_ZAI_APP_API_KEY` and stops constructing a GLM guest client.

- [ ] **Step 4: Run the focused tests and confirm failure**

Run:

```bash
pnpm vitest run \
  apps/user-service/src/__tests__/llmKeysRoutes.test.ts \
  apps/user-service/src/__tests__/internalRoutes.test.ts \
  apps/user-service/src/__tests__/infra/llmValidator.test.ts \
  packages/internal-clients/src/user-service/__tests__/client.test.ts \
  apps/chat-agent/src/__tests__/services.test.ts
```

Expected: FAIL because the code still exposes `zai` and GLM fallbacks.

### Task 4: Remove ZAI from user-service, internal clients, and app services

**Files:**
- Modify: `apps/user-service/src/domain/settings/models/UserSettings.ts`
- Modify: `apps/user-service/src/services.ts`
- Modify: `apps/user-service/src/routes/llmKeysRoutes.ts`
- Modify: `apps/user-service/src/routes/internalRoutes.ts`
- Modify: `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`
- Modify: `packages/internal-clients/src/user-service/types.ts`
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Modify: `apps/actions-agent/src/services.ts`
- Modify: `apps/calendar-agent/src/index.ts`
- Modify: `apps/calendar-agent/src/services.ts`
- Modify: `apps/chat-agent/src/index.ts`
- Modify: `apps/chat-agent/src/services.ts`
- Modify: `apps/commands-agent/src/services.ts`
- Modify: `apps/data-insights-agent/src/index.ts`
- Modify: `apps/image-service/src/services.ts`
- Modify: `apps/linear-agent/src/index.ts`
- Modify: `apps/linear-agent/src/services.ts`
- Modify: `apps/research-agent/src/services.ts`
- Modify: `apps/todos-agent/src/services.ts`
- Modify: `apps/web-agent/src/services.ts`

- [ ] **Step 1: Remove `zai` from user settings models and response schemas**

Delete `zai` from:
- `LlmApiKeys`
- `LlmTestResults`
- route schemas/responses in `llmKeysRoutes.ts`
- decrypted internal payloads in `internalRoutes.ts`

- [ ] **Step 2: Remove ZAI validation and fallback branches**

In `LlmValidatorImpl` and `createUserServiceClient()`:
- remove `LlmProviders.Zai`
- remove `platformZaiApiKey`
- keep or reuse only Gemini fallback branches where a platform fallback is still needed

- [ ] **Step 3: Audit every app service that still depends on `INTEXURAOS_ZAI_APP_API_KEY`**

For each file listed above:
- remove `platformZaiApiKey`
- remove `Glm47` / `Glm47Flash` from required model arrays
- remove `INTEXURAOS_ZAI_APP_API_KEY` from `REQUIRED_ENV`
- ensure any remaining platform fallback is Gemini-only

- [ ] **Step 4: Re-run the focused tests**

Run the same `pnpm vitest run ...` command from Task 3.

Expected: PASS.

### Task 5: Remove ZAI/GLM choices from the web settings and research UI

**Files:**
- Modify: `apps/web/src/services/llmKeysApi.types.ts`
- Modify: `apps/web/src/services/researchAgentApi.types.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/ModelSelector.tsx`
- Modify: `apps/web/src/pages/ApiKeysSettingsPage.tsx`
- Modify: `apps/web/src/pages/LlmPricingPage.tsx`

- [ ] **Step 1: Narrow the API and type surfaces**

Remove `zai` and `glm-4.7*` from the frontend type maps and provider lists.

- [ ] **Step 2: Remove ZAI from settings and pricing pages**

Delete the ZAI provider row/block from:
- API key settings
- default-model grouping
- pricing cards

- [ ] **Step 3: Remove GLM models from research selection UI**

Update the research model selector types so the only available research providers are `google`, `openai`, `anthropic`, and `perplexity`.

- [ ] **Step 4: Run workspace verification for the most critical app surfaces**

Run:

```bash
pnpm run verify:workspace:tracked -- user-service
pnpm run verify:workspace:tracked -- app-settings-service
pnpm run verify:workspace:tracked -- chat-agent
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/user-service/src/domain/settings/models/UserSettings.ts \
  apps/user-service/src/services.ts \
  apps/user-service/src/routes/llmKeysRoutes.ts \
  apps/user-service/src/routes/internalRoutes.ts \
  apps/user-service/src/infra/llm/LlmValidatorImpl.ts \
  apps/user-service/src/__tests__/llmKeysRoutes.test.ts \
  apps/user-service/src/__tests__/internalRoutes.test.ts \
  apps/user-service/src/__tests__/infra/llmValidator.test.ts \
  packages/internal-clients/src/user-service/types.ts \
  packages/internal-clients/src/user-service/client.ts \
  packages/internal-clients/src/user-service/__tests__/client.test.ts \
  apps/actions-agent/src/services.ts \
  apps/calendar-agent/src/index.ts \
  apps/calendar-agent/src/services.ts \
  apps/chat-agent/src/index.ts \
  apps/chat-agent/src/services.ts \
  apps/chat-agent/src/__tests__/services.test.ts \
  apps/commands-agent/src/services.ts \
  apps/data-insights-agent/src/index.ts \
  apps/image-service/src/services.ts \
  apps/linear-agent/src/index.ts \
  apps/linear-agent/src/services.ts \
  apps/research-agent/src/services.ts \
  apps/todos-agent/src/services.ts \
  apps/web-agent/src/services.ts \
  apps/web/src/services/llmKeysApi.types.ts \
  apps/web/src/services/researchAgentApi.types.ts \
  apps/web/src/types/index.ts \
  apps/web/src/components/ModelSelector.tsx \
  apps/web/src/pages/ApiKeysSettingsPage.tsx \
  apps/web/src/pages/LlmPricingPage.tsx
git commit -m "refactor: remove zai from app settings and services"
```

## Chunk 3: Remove ZAI from Research Agent and Delete `infra-glm`

### Task 6: Write failing tests for research model extraction and adapter cleanup

**Files:**
- Modify: `apps/research-agent/src/__tests__/domain/research/usecases/extractModelPreferences.test.ts`
- Modify: `apps/research-agent/src/__tests__/infra/llm/LlmAdapterFactory.test.ts`
- Modify: `apps/research-agent/src/__tests__/routes.test.ts`
- Modify: `packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts`

- [ ] **Step 1: Update research extraction tests**

Make them fail unless:
- ZAI keys are ignored
- `glm-4.7*` is never selected
- provider defaults and keywords contain only the remaining app providers

- [ ] **Step 2: Update adapter-factory tests**

Make them fail unless:
- `createResearchProvider()` and `createSynthesizer()` no longer branch on `zai`
- no `GlmAdapter` instance can be constructed

- [ ] **Step 3: Run the focused tests and confirm failure**

Run:

```bash
pnpm vitest run \
  apps/research-agent/src/__tests__/domain/research/usecases/extractModelPreferences.test.ts \
  apps/research-agent/src/__tests__/infra/llm/LlmAdapterFactory.test.ts \
  apps/research-agent/src/__tests__/routes.test.ts \
  packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts
```

Expected: FAIL because research-agent still allows GLM and ZAI.

### Task 7: Remove GLM from research-agent and delete the unused package

**Files:**
- Modify: `apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts`
- Modify: `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`
- Delete: `apps/research-agent/src/infra/llm/GlmAdapter.ts`
- Delete: `apps/research-agent/src/__tests__/infra/llm/GlmAdapter.test.ts`
- Modify: `packages/llm-prompts/src/research/modelExtractionPrompt.ts`
- Modify: `apps/research-agent/package.json`
- Modify: `packages/README.md`
- Delete: `packages/infra-glm/package.json`
- Delete: `packages/infra-glm/tsconfig.json`
- Delete: `packages/infra-glm/src/index.ts`
- Delete: `packages/infra-glm/src/client.ts`
- Delete: `packages/infra-glm/src/types.ts`
- Delete: `packages/infra-glm/src/costCalculator.ts`
- Delete: `packages/infra-glm/src/__tests__/client.test.ts`
- Delete: `packages/infra-glm/src/__tests__/costCalculator.test.ts`

- [ ] **Step 1: Remove GLM models, display names, keywords, and provider defaults from research selection**

Update both `extractModelPreferences.ts` and `modelExtractionPrompt.ts` so the research flow cannot mention or select GLM.

- [ ] **Step 2: Remove the `GlmAdapter` branch and file**

After this edit, research-agent should only construct Gemini, Claude, GPT, and Perplexity adapters.

- [ ] **Step 3: Delete `packages/infra-glm` and remove workspace dependencies**

Also remove `@intexuraos/infra-glm` from every remaining `package.json` that still references it.

- [ ] **Step 4: Re-run the focused tests**

Run the same `pnpm vitest run ...` command from Task 6.

Expected: PASS.

- [ ] **Step 5: Run research-agent workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- research-agent
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts \
  apps/research-agent/src/infra/llm/LlmAdapterFactory.ts \
  apps/research-agent/src/__tests__/domain/research/usecases/extractModelPreferences.test.ts \
  apps/research-agent/src/__tests__/infra/llm/LlmAdapterFactory.test.ts \
  apps/research-agent/src/__tests__/routes.test.ts \
  packages/llm-prompts/src/research/modelExtractionPrompt.ts \
  packages/llm-prompts/src/research/__tests__/modelExtractionPrompt.test.ts \
  apps/research-agent/package.json \
  packages/README.md
git add -u packages/infra-glm apps/research-agent/src/infra/llm apps/research-agent/src/__tests__/infra/llm
git commit -m "refactor: remove glm from research agent"
```

## Chunk 4: Rename the Code-Task Worker Contract to `glm-5` and Backfill Firestore

### Task 8: Write failing tests for the `glm` → `glm-5` contract rename

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/models/codeTask.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/labelUtils.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

- [ ] **Step 1: Update code-agent tests to fail unless `glm-5` is the canonical GLM worker type**

Cover:
- stored/output model/type unions use `glm-5`
- `@worker glm-5` is accepted
- bare `@worker glm` is accepted and normalized to `glm-5`
- label parsing/route validation normalize `glm` to `glm-5`

- [ ] **Step 2: Update orchestrator tests**

Make them fail unless:
- worker schemas accept `glm-5`
- `WORKER_TYPES['glm-5']` maps to DashScope with `model: 'glm-5'`
- any remaining `'glm'` usage is confined to explicit alias-normalization logic, not primary runtime/storage keys

- [ ] **Step 3: Run the focused tests and confirm failure**

Run:

```bash
pnpm vitest run \
  apps/code-agent/src/__tests__/domain/models/codeTask.test.ts \
  apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts \
  apps/code-agent/src/__tests__/domain/utils/labelUtils.test.ts \
  apps/code-agent/src/__tests__/routes/codeSubmit.test.ts \
  apps/code-agent/src/__tests__/routes/codeRoutes.test.ts \
  workers/orchestrator/src/__tests__/task-dispatcher.test.ts \
  workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
```

Expected: FAIL because the stack still uses `glm`.

### Task 9: Rename the code-task worker type and UI/docs to `glm-5`

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts`
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts`
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`
- Modify: `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/reviewTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/labelUtils.ts`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Modify: `apps/web/src/components/code-tasks/v2/shared.tsx`
- Modify: `apps/web/src/components/ConfirmSubmitModal.tsx`
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx`
- Modify: `apps/web/src/types/index.ts`
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`
- Modify: `workers/claude-worker/entrypoint.sh`

- [ ] **Step 1: Rename the canonical code-task worker enum/value to `glm-5` and centralize the alias**

Update every persisted/output union, schema enum, route type, and UI selector value to `glm-5`. Allow `glm` only in a small normalization layer at configuration/parsing boundaries; do not spread the alias across unrelated files.

- [ ] **Step 2: Keep the DashScope runtime mapping**

In orchestrator/claude-worker, preserve the existing DashScope base URL and `DASHSCOPE_API_KEY`, but key it under `glm-5`.

- [ ] **Step 3: Update user-facing code-task labels**

Use `GLM-5` / `Alibaba GLM-5` wording in the code-task UI and docs. The plain `glm` string is reserved for accepted input alias handling only.

- [ ] **Step 4: Re-run the focused tests**

Run the same `pnpm vitest run ...` command from Task 8.

Expected: PASS.

### Task 10: Add the one-off Firestore migration and its tests

**Files:**
- Create: `migrations/059_remove-zai-and-finalize-glm5.mjs`
- Create: `migrations/__tests__/059_remove-zai-and-finalize-glm5.test.ts`

- [ ] **Step 1: Write the migration test first**

Use fake Firestore fixtures that prove the migration:

```ts
await firestore.collection('user_settings').doc('u1').set({
  llmApiKeys: { zai: encryptedKey, google: encryptedKey },
  llmTestResults: { zai: { status: 'success', message: 'ok', testedAt: now } },
  llmPreferences: { defaultModel: 'glm-4.7-flash' },
});

await firestore.collection('code_tasks').doc('t1').set({ workerType: 'glm' });
await firestore.doc('settings/llm_pricing/providers/zai').set({ provider: 'zai', models: {} });
await firestore.collection('researches').doc('r1').set({
  selectedModels: ['glm-4.7', 'gemini-2.5-pro'],
  synthesisModel: 'glm-4.7',
  llmResults: [
    { provider: 'zai', model: 'glm-4.7', status: 'completed' },
    { provider: 'google', model: 'gemini-2.5-pro', status: 'completed' },
  ],
});
```

Assert that after `up(context)`:
- `zai` fields are gone from `user_settings`
- `defaultModel` is `gemini-2.5-flash`
- `code_tasks.workerType === 'glm-5'`
- the ZAI pricing doc is deleted
- research docs are sanitized or deleted according to the rules at the top of this plan
- historical usage data is unchanged

- [ ] **Step 2: Implement the migration**

Inside `up(context)`:
- iterate `user_settings`
- iterate `code_tasks`
- iterate `researches`
- delete `settings/llm_pricing/providers/zai`

Keep the migration idempotent and batch writes in safe chunks.

- [ ] **Step 3: Run the migration test**

Run:

```bash
pnpm vitest run migrations/__tests__/059_remove-zai-and-finalize-glm5.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run critical workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/code-agent/src/domain/models/codeTask.ts \
  apps/code-agent/src/domain/repositories/codeTaskRepository.ts \
  apps/code-agent/src/domain/services/taskDispatcher.ts \
  apps/code-agent/src/domain/usecases/processCodeAction.ts \
  apps/code-agent/src/domain/usecases/retryTask.ts \
  apps/code-agent/src/domain/usecases/submitTaskFeedback.ts \
  apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts \
  apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts \
  apps/code-agent/src/domain/utils/reviewTriage.ts \
  apps/code-agent/src/domain/utils/labelUtils.ts \
  apps/code-agent/src/infra/services/taskDispatcherImpl.ts \
  apps/code-agent/src/routes/codeRoutes.ts \
  apps/code-agent/src/__tests__/domain/models/codeTask.test.ts \
  apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts \
  apps/code-agent/src/__tests__/domain/utils/labelUtils.test.ts \
  apps/code-agent/src/__tests__/routes/codeSubmit.test.ts \
  apps/code-agent/src/__tests__/routes/codeRoutes.test.ts \
  apps/web/src/components/code-tasks/v2/shared.tsx \
  apps/web/src/components/ConfirmSubmitModal.tsx \
  apps/web/src/pages/CodeTaskNewPage.tsx \
  apps/web/src/pages/CodeTaskViewPage.tsx \
  apps/web/src/types/index.ts \
  workers/orchestrator/src/services/isolation/types.ts \
  workers/orchestrator/src/types/schemas.ts \
  workers/orchestrator/src/services/task-dispatcher.ts \
  workers/orchestrator/src/services/isolation/docker-provider.ts \
  workers/orchestrator/src/__tests__/task-dispatcher.test.ts \
  workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts \
  workers/claude-worker/entrypoint.sh \
  migrations/059_remove-zai-and-finalize-glm5.mjs \
  migrations/__tests__/059_remove-zai-and-finalize-glm5.test.ts
git commit -m "refactor: finalize glm-5 worker migration"
```

## Chunk 5: Remove Environment/Docs Residue and Prove the Cleanup

### Task 11: Remove remaining env, Terraform, and docs references

**Files:**
- Modify: `terraform/environments/dev/main.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `scripts/verify-env-vars.mjs`
- Modify: `workers/orchestrator/README.md`
- Modify: every docs file still returned by the grep commands below, including the paths listed in the Files overview

- [ ] **Step 1: Remove ZAI env vars and secrets**

Delete:
- `INTEXURAOS_ZAI_APP_API_KEY`
- any Terraform Secret Manager wiring for it
- any environment-validator requirements for it

Do **not** remove `DASHSCOPE_API_KEY`; keep it only where the code-task stack needs it.

- [ ] **Step 2: Sweep docs with grep before editing**

Run:

```bash
rg -l "(?i)\\bz\\.ai\\b|\\bzai\\b|api\\.z\\.ai|INTEXURAOS_ZAI_APP_API_KEY|platformZaiApiKey|LlmProviders\\.Zai|Glm47|Glm47Flash|glm-4\\.7" docs packages apps workers terraform scripts ecosystem.config.cjs
```

Use that file list to drive edits until the command returns nothing.

- [ ] **Step 3: Update code-task docs to `glm-5` / Alibaba / DashScope wording**

Allowed docs after this step:
- `docs/services/orchestrator/**`
- `docs/services/claude-worker/**`
- any code-task-specific UI docs you touched while renaming the worker contract

Everything else should stop mentioning GLM entirely.

### Task 12: Run hard verification gates, then full CI

**Files:**
- No new files; verification only

- [ ] **Step 1: Run the forbidden-reference gate**

Run:

```bash
rg -n "(?i)\\bz\\.ai\\b|\\bzai\\b|api\\.z\\.ai|INTEXURAOS_ZAI_APP_API_KEY|platformZaiApiKey|LlmProviders\\.Zai|Glm47|Glm47Flash|glm-4\\.7" .
```

Expected: no output.

- [ ] **Step 2: Run the `glm-5` allowlist gate**

Run:

```bash
rg -n "\\bglm-5\\b" apps packages workers docs terraform scripts ecosystem.config.cjs
```

Expected: hits only under the code-task allowlist:
- `apps/code-agent/**`
- `apps/web/src/components/code-tasks/**`
- `apps/web/src/pages/CodeTask*.tsx`
- `apps/web/src/types/index.ts`
- `workers/orchestrator/**`
- `workers/claude-worker/**`
- `docs/services/orchestrator/**`
- `docs/services/claude-worker/**`

If `docs/site-index.json` or any non-code-task file still appears, fix it before continuing.

- [ ] **Step 2a: Run the `glm` alias containment gate**

Run:

```bash
rg -n "\\bglm\\b" apps packages workers docs terraform scripts ecosystem.config.cjs
```

Expected: hits only in the code-task alias-normalization/configuration layer and migration fixtures/tests that intentionally cover legacy `glm` input. No app-setting, research, pricing, or non-code-task docs may still contain bare `glm`.

- [ ] **Step 3: Run full CI with captured output**

Run:

```bash
pnpm run ci:tracked | tee /tmp/ci-output-zai-removal.txt
```

Expected: PASS.

If it fails, inspect with:

```bash
rg "error|FAIL" -C3 /tmp/ci-output-zai-removal.txt
```

- [ ] **Step 4: Final commit**

```bash
git add terraform/environments/dev/main.tf ecosystem.config.cjs scripts/verify-env-vars.mjs docs
git commit -m "docs: remove zai references and finalize glm-5 cleanup"
```

## Final completion checklist

- [ ] `rg -n "(?i)\\bz\\.ai\\b|\\bzai\\b|api\\.z\\.ai|INTEXURAOS_ZAI_APP_API_KEY|platformZaiApiKey|LlmProviders\\.Zai|Glm47|Glm47Flash|glm-4\\.7" .` returns nothing.
- [ ] `rg -n "\\bglm-5\\b" ...` only returns the code-task allowlist paths.
- [ ] `rg -n "\\bglm\\b" ...` only returns the intentionally preserved code-task alias-normalization/configuration paths.
- [ ] `pnpm run verify:workspace:tracked -- app-settings-service` passes.
- [ ] `pnpm run verify:workspace:tracked -- user-service` passes.
- [ ] `pnpm run verify:workspace:tracked -- research-agent` passes.
- [ ] `pnpm run verify:workspace:tracked -- code-agent` passes.
- [ ] `pnpm run verify:workspace:tracked -- orchestrator` passes.
- [ ] `pnpm run ci:tracked` passes.
- [ ] No `@intexuraos/infra-glm` dependency remains in the workspace.

Plan complete and saved to `docs/superpowers/plans/2026-03-12-zai-removal-glm5-finalization.md`. Ready to execute?
