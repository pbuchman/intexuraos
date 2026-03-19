# INT-1011: OpenRouter Backend Infrastructure (Phase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenRouter as the 5th LLM provider in the backend — type system, infra package, adapter, API key storage, pricing, schema, and curated model allowlist — with zero user-visible changes.

**Architecture:** Widen `ResearchModel` (NOT `LLMModel`) with a branded `OpenRouterModelId` string type prefixed with `or:`. This avoids ripple effects into `PricingContext`, `MODEL_PROVIDER_MAP`, `ALL_LLM_MODELS`, and `llm-factory`. OpenRouter pricing is dynamic from their API (not Firestore). The client wraps the OpenAI SDK with a custom `baseURL`. Web search is enabled via the `:online` model suffix (OpenRouter platform feature, works on all models). Only a curated allowlist of 14 frontier models is exposed.

**Tech Stack:** TypeScript strict mode, OpenAI SDK (`openai` npm), native `fetch()`, Fastify, nock for HTTP mocking, vitest.

**Linear:** [INT-1011](https://linear.app/pbuchman/issue/INT-1011/openrouter-backend-infrastructure-phase-a)
**Parent:** [INT-616](https://linear.app/pbuchman/issue/INT-616/investigate-open-router-integration-and-multi-model-selection)
**Design Doc:** `docs/plans/INT-616-design.md`

---

## Key Design Decisions

### Curated Allowlist (not "show all 350 models")

Instead of fetching the full OpenRouter catalog dynamically, we maintain a **hardcoded allowlist** of 14 frontier models from 10 providers. This avoids overwhelming users and ensures quality. The allowlist lives in `packages/infra-openrouter/src/allowlist.ts` and can be updated via code changes.

### Web Search via `:online` Suffix

All OpenRouter models support web search by appending `:online` to the model ID (e.g., `anthropic/claude-sonnet-4.6:online`). This is an OpenRouter platform feature powered by Exa search (~$0.02/request). The backend appends `:online` to the model ID when making the API call if research requires web search. Citations come back as `annotations` in the response.

### Allowlist (14 models, 10 providers)

```typescript
// packages/infra-openrouter/src/allowlist.ts
export const OPENROUTER_ALLOWED_MODELS = [
  // Qwen
  { id: 'qwen/qwen3.5-plus-02-15', name: 'Qwen 3.5 Plus', provider: 'Qwen' },
  { id: 'qwen/qwen3.5-flash-02-23', name: 'Qwen 3.5 Flash', provider: 'Qwen' },
  // MiniMax
  { id: 'minimax/minimax-m2.7', name: 'MiniMax M2.7', provider: 'MiniMax' },
  // xAI
  { id: 'x-ai/grok-4.20-beta', name: 'Grok 4.20 Beta', provider: 'xAI' },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', provider: 'xAI' },
  // Moonshot
  { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', provider: 'Moonshot' },
  // Anthropic
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'Anthropic' },
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'Anthropic' },
  // Google
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'Google' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
  // OpenAI
  { id: 'openai/gpt-5.4', name: 'GPT-5.4', provider: 'OpenAI' },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'OpenAI' },
  // Xiaomi
  { id: 'xiaomi/mimo-v2-pro', name: 'MiMo V2 Pro', provider: 'Xiaomi' },
  // Z.ai
  { id: 'z-ai/glm-5-turbo', name: 'GLM 5 Turbo', provider: 'Z.ai' },
] as const;
```

---

## File Structure

### New Files

| File                                                             | Responsibility                       |
| ---------------------------------------------------------------- | ------------------------------------ |
| `packages/infra-openrouter/package.json`                         | Package config (ESM, workspace deps) |
| `packages/infra-openrouter/tsconfig.json`                        | TypeScript config                    |
| `packages/infra-openrouter/src/index.ts`                         | Public exports                       |
| `packages/infra-openrouter/src/types.ts`                         | OpenRouterConfig, API response types |
| `packages/infra-openrouter/src/allowlist.ts`                     | Curated model allowlist with pricing |
| `packages/infra-openrouter/src/client.ts`                        | LLM client using OpenAI SDK          |
| `packages/infra-openrouter/src/costCalculator.ts`                | Pricing conversion                   |
| `packages/infra-openrouter/src/__tests__/client.test.ts`         | Client tests                         |
| `packages/infra-openrouter/src/__tests__/allowlist.test.ts`      | Allowlist validation tests           |
| `packages/infra-openrouter/src/__tests__/costCalculator.test.ts` | Cost calculator tests                |
| `apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`         | Research adapter                     |
| `apps/research-agent/src/routes/openRouterRoutes.ts`             | Allowlist endpoint                   |

### Modified Files

| File                                                           | Change                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/llm-contract/src/supportedModels.ts`                 | Add `OpenRouter` provider, `OpenRouterModelId` type, widen `ResearchModel`          |
| `packages/llm-contract/src/__tests__/supportedModels.test.ts`  | Tests for new types/helpers                                                         |
| `packages/llm-contract/src/index.ts`                           | Export new types                                                                    |
| `packages/internal-clients/src/user-service/types.ts`          | Add `openrouter` to `DecryptedApiKeys`                                              |
| `packages/internal-clients/src/user-service/client.ts`         | Add `openrouter` case to `providerToKeyField()`, update `getApiKeys()` body parsing |
| `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`       | Add `case 'openrouter'`                                                             |
| `apps/research-agent/src/routes/schemas/common.ts`             | Relax `supportedModelSchema` with `anyOf`                                           |
| `apps/user-service/src/domain/settings/models/UserSettings.ts` | Add `openrouter` to key/test types                                                  |
| `apps/user-service/src/routes/llmKeysRoutes.ts`                | Add `openrouter` to provider schemas                                                |
| `apps/user-service/src/routes/internalRoutes.ts`               | Add `openrouter` to internal response                                               |
| `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`          | Add OpenRouter key validation (both `validateKey()` and `testRequest()`)            |

---

## Tasks

### Task 1: Type System Foundation

**Files:**
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Test: `packages/llm-contract/src/__tests__/supportedModels.test.ts`

- [ ] **Step 1: Write failing tests for new OpenRouter types**

Add to `packages/llm-contract/src/__tests__/supportedModels.test.ts`:

```typescript
describe('OpenRouter model helpers', () => {
  it('isOpenRouterModel returns true for or: prefixed models', () => {
    expect(isOpenRouterModel('or:anthropic/claude-sonnet-4')).toBe(true);
    expect(isOpenRouterModel('or:meta-llama/llama-3.1-70b-instruct')).toBe(true);
  });

  it('isOpenRouterModel returns false for static models', () => {
    expect(isOpenRouterModel('gemini-2.5-pro')).toBe(false);
    expect(isOpenRouterModel('')).toBe(false);
  });

  it('createOpenRouterModelId adds or: prefix', () => {
    const id = createOpenRouterModelId('anthropic/claude-sonnet-4');
    expect(id).toBe('or:anthropic/claude-sonnet-4');
    expect(isOpenRouterModel(id)).toBe(true);
  });

  it('getOpenRouterRawId strips or: prefix', () => {
    const id = createOpenRouterModelId('meta-llama/llama-3.1-70b');
    expect(getOpenRouterRawId(id)).toBe('meta-llama/llama-3.1-70b');
  });
});

describe('LlmProviders constants', () => {
  it('contains all 5 providers (including OpenRouter)', () => {
    expect(LlmProviders.OpenRouter).toBe('openrouter');
  });
});

describe('getProviderForModel', () => {
  it('returns openrouter for OpenRouter model IDs', () => {
    const orModel = createOpenRouterModelId('anthropic/claude-sonnet-4');
    expect(getProviderForModel(orModel)).toBe('openrouter');
  });

  it('returns correct provider for static models (unchanged)', () => {
    expect(getProviderForModel(LlmModels.Gemini25Pro)).toBe('google');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/llm-contract/src/__tests__/supportedModels.test.ts`
Expected: FAIL — `isOpenRouterModel` not exported

- [ ] **Step 3: Implement type system changes**

In `packages/llm-contract/src/supportedModels.ts`:

1. Add `export type OpenRouter = 'openrouter';`
2. Extend union: `type LlmProvider = Google | OpenAI | Anthropic | Perplexity | OpenRouter;`
3. Add branded type:
```typescript
export type OpenRouterModelId = string & { readonly __brand: 'OpenRouterModelId' };
```
4. Widen `ResearchModel` to include `| OpenRouterModelId`
5. Add `OpenRouter` to `LlmProviders` constant
6. Add helpers: `isOpenRouterModel()`, `createOpenRouterModelId()`, `getOpenRouterRawId()`
7. Update `getProviderForModel()`:
```typescript
export function getProviderForModel(model: ResearchModel): LlmProvider {
  if (isOpenRouterModel(model)) {
    return LlmProviders.OpenRouter;
  }
  // After the OpenRouter guard, model is a static LLMModel
  return MODEL_PROVIDER_MAP[model as LLMModel];
}
```

- [ ] **Step 4: Update exports in index.ts**

Add `isOpenRouterModel`, `createOpenRouterModelId`, `getOpenRouterRawId` to value exports. Add `OpenRouter`, `OpenRouterModelId` to type exports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/llm-contract/src/__tests__/supportedModels.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Build and verify no type errors**

Run: `pnpm build`

- [ ] **Step 7: Commit**

```bash
git add packages/llm-contract/src/supportedModels.ts packages/llm-contract/src/index.ts packages/llm-contract/src/__tests__/supportedModels.test.ts
git commit -m "feat(llm-contract): add OpenRouter provider type and OpenRouterModelId branded string"
```

---

### Task 2: infra-openrouter Package — Types, Allowlist & Cost Calculator

**Files:**
- Create: `packages/infra-openrouter/package.json`
- Create: `packages/infra-openrouter/tsconfig.json`
- Create: `packages/infra-openrouter/src/types.ts`
- Create: `packages/infra-openrouter/src/allowlist.ts`
- Create: `packages/infra-openrouter/src/costCalculator.ts`
- Test: `packages/infra-openrouter/src/__tests__/costCalculator.test.ts`
- Test: `packages/infra-openrouter/src/__tests__/allowlist.test.ts`

- [ ] **Step 1: Create package scaffolding**

`packages/infra-openrouter/package.json` — follow `infra-perplexity` pattern. Dependencies: `@intexuraos/common-core`, `@intexuraos/llm-prompts`, `@intexuraos/llm-audit`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`, `openai`. Dev: `nock`.

`packages/infra-openrouter/tsconfig.json` — extends `../../tsconfig.base.json`, noEmit, rootDir `src/`.

- [ ] **Step 2: Create types.ts**

`packages/infra-openrouter/src/types.ts` — `OpenRouterConfig` interface (apiKey, model, userId, pricing, timeoutMs?, logger). Re-export `LLMError as OpenRouterError`, `ResearchResult`, `GenerateResult`, `ModelPricing` from `llm-contract`. Add `OpenRouterModelInfo` with id, name, provider, contextLength, pricing, inputModalities, outputModalities.

- [ ] **Step 3: Create allowlist.ts**

`packages/infra-openrouter/src/allowlist.ts` — hardcoded array of 14 `AllowedOpenRouterModel` entries with `id`, `name`, `provider`. Export `OPENROUTER_ALLOWED_MODELS` constant and `isAllowedModel(id: string): boolean` helper.

- [ ] **Step 4: Write failing cost calculator tests**

Test `toModelPricing()` converts per-token strings to per-million numbers with `useProviderCost: true`. Test `calculateTextCost()` priority: provider cost → usage.providerCost → fallback calculation. Test `normalizeUsage()` returns correct totals.

- [ ] **Step 5: Implement cost calculator**

`packages/infra-openrouter/src/costCalculator.ts` — follow `infra-perplexity/costCalculator.ts` pattern. `toModelPricing(promptPerToken, completionPerToken): ModelPricing` converts OpenRouter's per-token price strings to per-million numbers.

- [ ] **Step 6: Write allowlist tests**

Test that `OPENROUTER_ALLOWED_MODELS` has exactly 14 entries, all have required fields, `isAllowedModel()` returns true for allowed and false for unknown.

- [ ] **Step 7: Install dependencies and run tests**

Run: `pnpm install && pnpm vitest run packages/infra-openrouter/src/__tests__/`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add packages/infra-openrouter/
git commit -m "feat(infra-openrouter): scaffold package with types, allowlist, and cost calculator"
```

---

### Task 3: infra-openrouter — Client

**Files:**
- Create: `packages/infra-openrouter/src/client.ts`
- Create: `packages/infra-openrouter/src/index.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`

- [ ] **Step 1: Write failing client tests**

Test that:
- `research()` sends correct model ID and custom headers (`HTTP-Referer`, `X-Title`) to `https://openrouter.ai/api/v1/chat/completions`
- Returns `Result` with content and normalized usage on success
- Maps 401 → `INVALID_KEY`, 429 → `RATE_LIMITED`, 500 → `API_ERROR`
- Model ID is passed without `or:` prefix (stripped by adapter, not client)

Use `nock` for HTTP mocking, `vi.mock()` for `@intexuraos/llm-audit` and `@intexuraos/llm-pricing`, dynamic `import()` for module under test (same pattern as `infra-perplexity` tests).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/infra-openrouter/src/__tests__/client.test.ts`

- [ ] **Step 3: Implement client**

`packages/infra-openrouter/src/client.ts`:
- Factory function `createOpenRouterClient(config): OpenRouterClient` (not a class)
- `OpenRouterClient = Pick<LLMClient, 'research' | 'generate'>`
- Uses OpenAI SDK with `baseURL: 'https://openrouter.ai/api/v1'` and custom headers
- Non-streaming JSON responses
- Error mapping: 401→INVALID_KEY, 429→RATE_LIMITED, 503→OVERLOADED, timeout→TIMEOUT, other→API_ERROR
- Usage normalization via `normalizeUsage()` from `costCalculator.ts`
- Audit context and usage logger integration (same pattern as `infra-perplexity`)

- [ ] **Step 4: Create index.ts**

```typescript
export { createOpenRouterClient, type OpenRouterClient } from './client.js';
export { OPENROUTER_ALLOWED_MODELS, isAllowedModel } from './allowlist.js';
export { calculateTextCost, normalizeUsage, toModelPricing } from './costCalculator.js';
export type { OpenRouterConfig, OpenRouterError, OpenRouterModelInfo, ResearchResult, GenerateResult } from './types.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/infra-openrouter/src/__tests__/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/infra-openrouter/src/client.ts packages/infra-openrouter/src/index.ts packages/infra-openrouter/src/__tests__/client.test.ts
git commit -m "feat(infra-openrouter): add OpenRouter LLM client using OpenAI SDK"
```

---

### Task 4: API Key Storage & Validation

**Files:**
- Modify: `packages/internal-clients/src/user-service/types.ts`
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Modify: `apps/user-service/src/domain/settings/models/UserSettings.ts`
- Modify: `apps/user-service/src/routes/llmKeysRoutes.ts`
- Modify: `apps/user-service/src/routes/internalRoutes.ts`
- Modify: `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`
- Test: Update corresponding test files

- [ ] **Step 1: Update DecryptedApiKeys type**

In `packages/internal-clients/src/user-service/types.ts`, add `openrouter?: string` to `DecryptedApiKeys`.

- [ ] **Step 2: Update providerToKeyField and getApiKeys body parsing**

In `packages/internal-clients/src/user-service/client.ts`:
1. Add `case LlmProviders.OpenRouter: return 'openrouter';` to the switch
2. Add `openrouter` to the `getApiKeys()` response body type and the null-to-undefined conversion block

- [ ] **Step 3: Update user-service domain model**

In `apps/user-service/src/domain/settings/models/UserSettings.ts`, add `openrouter` fields to `LlmApiKeys` and `LlmTestResults`.

- [ ] **Step 4: Update user-service routes**

In `llmKeysRoutes.ts` — add `'openrouter'` to all provider enum schemas and response schemas.
In `internalRoutes.ts` — add `openrouter` to internal decrypted keys response.

- [ ] **Step 5: Add OpenRouter key validation**

In `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`:
1. Add OpenRouter to `VALIDATION_MODELS` constant
2. Add OpenRouter to `ValidationPricing` interface
3. Add `case LlmProviders.OpenRouter` to **both** `validateKey()` AND `testRequest()`:
   - `validateKey()`: Use `GET https://openrouter.ai/api/v1/key` (lightweight, no model call)
   - `testRequest()`: Use `POST https://openrouter.ai/api/v1/chat/completions` with a cheap model (`openai/gpt-4o-mini`)

- [ ] **Step 6: Update all affected tests**

- `providerToKeyField('openrouter')` → returns `'openrouter'`
- Key storage routes accept `openrouter` provider
- Internal routes include `openrouter` in response
- Validator handles OpenRouter key validation and test request

- [ ] **Step 7: Run affected workspace tests**

Run: `pnpm run verify:workspace:tracked -- user-service && pnpm run verify:workspace:tracked -- internal-clients`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add packages/internal-clients/ apps/user-service/
git commit -m "feat(user-service): add OpenRouter API key storage and validation"
```

---

### Task 5: Research Agent Adapter & Factory

**Files:**
- Create: `apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`
- Test: `apps/research-agent/src/__tests__/infra/llm/OpenRouterAdapter.test.ts`
- Test: Update `apps/research-agent/src/__tests__/infra/llm/LlmAdapterFactory.test.ts`

- [ ] **Step 1: Write failing adapter test**

Follow `PerplexityAdapter.test.ts` pattern. Test:
- Constructor creates client with correct config (or: prefix stripped)
- `research()` delegates to client and returns result
- `synthesize()` delegates to `client.generate()` with synthesis prompt
- Error codes are mapped correctly

- [ ] **Step 2: Implement OpenRouterAdapter**

`apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`:
- Implements `LlmResearchProvider` AND `LlmSynthesisProvider`
- Constructor strips `or:` prefix via `getOpenRouterRawId()`
- `research()` — delegates to `client.research()`, maps errors via `mapToLlmError()`
- `synthesize()` — builds synthesis prompt, delegates to `client.generate()`, returns `{ content, usage }`
- `mapToLlmError()` — normalizes error codes (same pattern as `PerplexityAdapter`)

- [ ] **Step 3: Update factory**

In `LlmAdapterFactory.ts`:
- Import `OpenRouterAdapter`
- Add `case 'openrouter':` to `createResearchProvider()` → `new OpenRouterAdapter(...)`
- Add `case 'openrouter':` to `createSynthesizer()` → `new OpenRouterAdapter(...)`

- [ ] **Step 4: Update factory tests**

Add OpenRouter cases to `LlmAdapterFactory.test.ts`.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/research-agent/src/__tests__/infra/llm/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/research-agent/src/infra/llm/ apps/research-agent/src/__tests__/infra/llm/
git commit -m "feat(research-agent): add OpenRouterAdapter and factory routing"
```

---

### Task 6: Schema Relaxation & Allowlist Endpoint

**Files:**
- Modify: `apps/research-agent/src/routes/schemas/common.ts`
- Create: `apps/research-agent/src/routes/openRouterRoutes.ts`
- Test: Schema validation tests, allowlist endpoint tests

- [ ] **Step 1: Update supportedModelSchema**

In `apps/research-agent/src/routes/schemas/common.ts`:

```typescript
export const supportedModelSchema = {
  anyOf: [
    { type: 'string', enum: ALL_LLM_MODELS },
    { type: 'string', pattern: '^or:[a-z0-9-]+/[a-z0-9._:-]+$' },
  ],
} as const;
```

Add `'openrouter'` to `llmProviderSchema` enum.

- [ ] **Step 2: Write allowlist endpoint tests**

Test that `GET /research/openrouter/models`:
- Returns the curated allowlist with pricing from OpenRouter API when user has a key
- Returns 404 when user has no OpenRouter key configured
- Enriches allowlist entries with live pricing from OpenRouter's `/api/v1/models` endpoint

- [ ] **Step 3: Implement allowlist endpoint**

`apps/research-agent/src/routes/openRouterRoutes.ts`:
- `GET /research/openrouter/models` — requires auth
- Fetches user's OpenRouter API key from user-service
- Calls OpenRouter `/api/v1/models` to get live pricing for allowlisted models
- Merges allowlist metadata with live pricing
- Caches result in memory (5-min TTL)
- Returns `{ models: OpenRouterModelInfo[], cachedAt: string }`

- [ ] **Step 4: Register route**

Wire the new route file into research-agent's Fastify app.

- [ ] **Step 5: Run tests**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/research-agent/src/routes/
git commit -m "feat(research-agent): relax model schema for OpenRouter and add allowlist endpoint"
```

---

### Task 7: Exhaustive Switch Audit & Pricing Resolution

- [ ] **Step 1: Find all LlmProvider switches**

Run: `pnpm build 2>&1 | grep -i "not assignable\|exhaustive\|openrouter"` to find TypeScript errors.

- [ ] **Step 2: Fix each non-exhaustive switch**

Add `case 'openrouter':` with appropriate handling in every file that switches on `LlmProvider`.

- [ ] **Step 3: Add pricing resolution for OpenRouter models**

In research-agent's LLM call processing (where `pricingContext.getPricing(model)` is called), add a guard:
- If `isOpenRouterModel(model)` → use `toModelPricing()` from `infra-openrouter` with pricing from the allowlist/catalog
- Else → existing `pricingContext.getPricing(model)` path

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 5: Commit**

Stage all files modified during the audit by name (use `git status` to identify them).

```bash
git commit -m "feat: complete OpenRouter backend integration — exhaustive switch audit and pricing resolution"
```

---

### Task 8: Design Doc Update & Final Verification

- [ ] **Step 1: Update design doc**

Add a "Phase Split" section and "Curated Allowlist" section to `docs/plans/INT-616-design.md`.

- [ ] **Step 2: Final CI run**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add docs/plans/INT-616-design.md
git commit -m "docs: update OpenRouter design doc with phase split and allowlist"
```

---

## Endpoint Changes

| Category     | Endpoint                                            | Change                                           |
| ------------ | --------------------------------------------------- | ------------------------------------------------ |
| **Created**  | `GET /research/openrouter/models`                   | Curated allowlist with live pricing              |
| **Modified** | `POST /research`                                    | Schema accepts `or:` prefixed models via `anyOf` |
| **Modified** | `POST /research/draft`                              | Same schema change                               |
| **Modified** | `POST /research/:id/enhance`                        | Same schema change                               |
| **Modified** | `PATCH /research/:id`                               | Same schema change                               |
| **Modified** | `GET /users/:uid/settings/llm-keys`                 | Response includes `openrouter` field             |
| **Modified** | `PATCH /users/:uid/settings/llm-keys`               | Accepts `'openrouter'` as provider               |
| **Modified** | `DELETE /users/:uid/settings/llm-keys/:provider`    | Accepts `'openrouter'`                           |
| **Modified** | `POST /users/:uid/settings/llm-keys/:provider/test` | Accepts `'openrouter'`                           |
| **Modified** | `GET /internal/users/:uid/llm-keys`                 | Response includes `openrouter` field             |
| Unchanged    | All other endpoints                                 | No changes                                       |

---

## Verification

1. `pnpm install && pnpm build` — all packages compile without errors
2. `pnpm run ci:tracked` — all tests pass, coverage thresholds met
3. Manual: deploy to dev environment, confirm existing research flow works unchanged
4. Manual: call `GET /research/openrouter/models` with a test API key → verify 14 models returned with pricing
5. Manual: attempt `POST /research` with `selectedModels: ["or:x-ai/grok-4.1-fast"]` and a configured OpenRouter key → verify research executes
