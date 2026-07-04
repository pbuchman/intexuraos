# Primary + Fallback Default LLM Model Selection Implementation Plan

> Supersession note (2026-07-04): The active default-model catalogs now use MiniMax M3. Any MiniMax M2.7 references below are historical plan content only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to select a primary default LLM model and an optional fallback model (including OpenRouter models) for `generate()` calls across all services, with automatic retry on the fallback when the primary fails.

**Architecture:** The feature extends the existing `LlmPreferences` domain model to include a `fallbackModel` field, widens model validation from `FastModel`-only to a new `DefaultEligibleModel` set (static fast models + 4 curated OpenRouter models), upgrades `llm-factory` to create OpenRouter-backed clients, and wraps `getLlmClient` in `internal-clients` with retry-on-fallback logic. The web UI adds a second `<select>` for the fallback model.

**Tech Stack:** TypeScript, Fastify, Firestore, React, `@intexuraos/infra-openrouter`, `@intexuraos/llm-factory`, `@intexuraos/llm-contract`, `@intexuraos/internal-clients`

---

## File Structure

| Layer                   | File                                                                    | Responsibility                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **llm-contract**        | `packages/llm-contract/src/supportedModels.ts`                          | Add `DefaultEligibleModel` type, `ALL_DEFAULT_ELIGIBLE_MODELS`, `isDefaultEligibleModel()`, `DEFAULT_OPENROUTER_MODELS` constant, `DEFAULT_MODEL_DISPLAY_NAMES` |
| **llm-contract**        | `packages/llm-contract/src/index.ts`                                    | Export new types/functions                                                                                                                                      |
| **infra-openrouter**    | `packages/infra-openrouter/src/defaultAllowlist.ts`                     | New file: 4 curated OpenRouter models for default selection with fallback pricing                                                                               |
| **infra-openrouter**    | `packages/infra-openrouter/src/index.ts`                                | Export new allowlist                                                                                                                                            |
| **llm-factory**         | `packages/llm-factory/src/llmClientFactory.ts`                          | Add OpenRouter provider support in `createLlmClient()`                                                                                                          |
| **llm-factory**         | `packages/llm-factory/src/openRouterGenerateClient.ts`                  | New file: OpenRouter `LlmGenerateClient` adapter wrapping `infra-openrouter`                                                                                    |
| **user-service model**  | `apps/user-service/src/domain/settings/models/UserSettings.ts`          | Add `fallbackModel?` to `LlmPreferences`                                                                                                                        |
| **user-service port**   | `apps/user-service/src/domain/settings/ports/UserSettingsRepository.ts` | Update `updateLlmPreferences` signature                                                                                                                         |
| **user-service infra**  | `apps/user-service/src/infra/firestore/userSettingsRepository.ts`       | Store/retrieve `fallbackModel`                                                                                                                                  |
| **user-service routes** | `apps/user-service/src/routes/settingsRoutes.ts`                        | Accept `fallbackModel` in PATCH body, validate with `isDefaultEligibleModel`                                                                                    |
| **user-service routes** | `apps/user-service/src/routes/internalRoutes.ts`                        | Return `fallbackModel` in internal settings response                                                                                                            |
| **user-service routes** | `apps/user-service/src/routes/llmKeysRoutes.ts`                         | Return `fallbackModel` in GET response; cascade-clear fallbackModel on key delete                                                                               |
| **internal-clients**    | `packages/internal-clients/src/user-service/client.ts`                  | Add fallback retry logic to `getLlmClient`                                                                                                                      |
| **web types**           | `apps/web/src/services/llmKeysApi.types.ts`                             | Add `fallbackModel` to `LlmKeysResponse`                                                                                                                        |
| **web API**             | `apps/web/src/services/llmKeysApi.ts`                                   | Add `updateLlmPreferences()` that sends both models                                                                                                             |
| **web hook**            | `apps/web/src/hooks/useLlmKeys.ts`                                      | Add `fallbackModel`, `setFallbackModel`, `setLlmPreferences`                                                                                                    |
| **web page**            | `apps/web/src/pages/ApiKeysSettingsPage.tsx`                            | Add second select box for fallback; include OpenRouter models in both selectors                                                                                 |

## Endpoint Changes

### Modified
- **PATCH `/users/:uid/settings`** - Body changes from `{ defaultModel: string }` to `{ defaultModel: string; fallbackModel?: string | null }`. Validation changes from `isFastModel()` to `isDefaultEligibleModel()`. `fallbackModel: null` clears the fallback.
- **GET `/users/:uid/settings/llm-keys`** - Response adds `fallbackModel: string | null` alongside existing `defaultModel`.
- **GET `/internal/users/:uid/settings`** - Response `llmPreferences` object adds `fallbackModel?: string` alongside existing `defaultModel`.
- **DELETE `/users/:uid/settings/llm-keys/:provider`** - Cascade now also clears `fallbackModel` if it belongs to the deleted provider.

### Created
None.

### Removed
None.

### Unchanged
All other endpoints.

---

## Task 1: Add Default-Eligible Model Types to llm-contract

**Files:**
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Test: `packages/llm-contract/src/__tests__/supportedModels.test.ts`

- [ ] **Step 1: Write failing tests for new validation function and constants**

```typescript
// In packages/llm-contract/src/__tests__/supportedModels.test.ts
// Add a new describe block:

describe('DefaultEligibleModel', () => {
  describe('DEFAULT_OPENROUTER_MODELS', () => {
    it('contains exactly 4 models', () => {
      expect(DEFAULT_OPENROUTER_MODELS).toHaveLength(4);
    });

    it('contains the expected model IDs', () => {
      const ids = DEFAULT_OPENROUTER_MODELS.map((m) => m.id);
      expect(ids).toContain('google/gemma-4-31b-it:free');
      expect(ids).toContain('minimax/minimax-m2.7');
      expect(ids).toContain('qwen/qwen3.6-plus');
      expect(ids).toContain('nvidia/nemotron-3-super-120b-a12b:free');
    });
  });

  describe('isDefaultEligibleModel', () => {
    it('accepts all fast models', () => {
      for (const model of ALL_FAST_MODELS) {
        expect(isDefaultEligibleModel(model)).toBe(true);
      }
    });

    it('accepts OpenRouter default models with or: prefix', () => {
      expect(isDefaultEligibleModel('or:google/gemma-4-31b-it:free')).toBe(true);
      expect(isDefaultEligibleModel('or:minimax/minimax-m2.7')).toBe(true);
      expect(isDefaultEligibleModel('or:qwen/qwen3.6-plus')).toBe(true);
      expect(isDefaultEligibleModel('or:nvidia/nemotron-3-super-120b-a12b:free')).toBe(true);
    });

    it('rejects unknown models', () => {
      expect(isDefaultEligibleModel('unknown-model')).toBe(false);
    });

    it('rejects OpenRouter models not in default allowlist', () => {
      expect(isDefaultEligibleModel('or:anthropic/claude-sonnet-4.6')).toBe(false);
    });

    it('rejects non-fast static models', () => {
      expect(isDefaultEligibleModel('gemini-2.5-pro')).toBe(false);
      expect(isDefaultEligibleModel('claude-opus-4-5-20251101')).toBe(false);
    });
  });

  describe('DEFAULT_MODEL_DISPLAY_NAMES', () => {
    it('has entries for all fast models', () => {
      for (const model of ALL_FAST_MODELS) {
        expect(DEFAULT_MODEL_DISPLAY_NAMES[model]).toBeDefined();
      }
    });

    it('has entries for all default OpenRouter models', () => {
      for (const m of DEFAULT_OPENROUTER_MODELS) {
        const orId = `or:${m.id}`;
        expect(DEFAULT_MODEL_DISPLAY_NAMES[orId]).toBeDefined();
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- llm-contract`
Expected: FAIL - `isDefaultEligibleModel`, `DEFAULT_OPENROUTER_MODELS`, `DEFAULT_MODEL_DISPLAY_NAMES` not found.

- [ ] **Step 3: Implement the types and validation**

In `packages/llm-contract/src/supportedModels.ts`, add after the `FAST_MODEL_DISPLAY_NAMES` block (around line 245):

```typescript
// =============================================================================
// Default-Eligible Models (for user's default model preference)
// =============================================================================

/**
 * Curated OpenRouter models available for default model selection.
 * These are high-quality models accessible via OpenRouter API.
 */
export interface DefaultOpenRouterModel {
  /** Raw OpenRouter model ID (without 'or:' prefix) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Provider name for UI grouping */
  provider: string;
}

export const DEFAULT_OPENROUTER_MODELS: readonly DefaultOpenRouterModel[] = [
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B IT', provider: 'Google' },
  { id: 'minimax/minimax-m2.7', name: 'MiniMax M2.7', provider: 'MiniMax' },
  { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus', provider: 'Qwen' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron 3 Super 120B', provider: 'NVIDIA' },
] as const;

/**
 * Set of OpenRouter model IDs (with 'or:' prefix) eligible for default selection.
 */
const DEFAULT_OPENROUTER_MODEL_IDS: ReadonlySet<string> = new Set(
  DEFAULT_OPENROUTER_MODELS.map((m) => `or:${m.id}`)
);

/**
 * A model that can be selected as the user's default LLM model.
 * Includes all FastModel values plus curated OpenRouter models (with 'or:' prefix).
 */
export type DefaultEligibleModel = FastModel | OpenRouterModelId;

/**
 * Check if a string is a valid model for default selection.
 * Accepts all fast models AND the curated OpenRouter default models.
 */
export function isDefaultEligibleModel(model: string): model is DefaultEligibleModel {
  if (isFastModel(model)) return true;
  return DEFAULT_OPENROUTER_MODEL_IDS.has(model);
}

/**
 * Human-readable display names for all default-eligible models.
 * Keys are model IDs (static LLMModel strings or 'or:' prefixed OpenRouter IDs).
 */
export const DEFAULT_MODEL_DISPLAY_NAMES: Record<string, string> = {
  ...FAST_MODEL_DISPLAY_NAMES,
  ...Object.fromEntries(
    DEFAULT_OPENROUTER_MODELS.map((m) => [`or:${m.id}`, m.name])
  ),
};
```

In `packages/llm-contract/src/index.ts`, add to the exports:

```typescript
export {
  // ... existing exports ...
  isDefaultEligibleModel,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_MODEL_DISPLAY_NAMES,
} from './supportedModels.js';

export type {
  // ... existing type exports ...
  DefaultEligibleModel,
  DefaultOpenRouterModel,
} from './supportedModels.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- llm-contract`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/llm-contract/src/supportedModels.ts packages/llm-contract/src/index.ts packages/llm-contract/src/__tests__/supportedModels.test.ts
git commit -m "feat(llm-contract): add DefaultEligibleModel type and OpenRouter default models"
```

---

## Task 2: Add Default Model Allowlist to infra-openrouter

**Files:**
- Create: `packages/infra-openrouter/src/defaultAllowlist.ts`
- Modify: `packages/infra-openrouter/src/index.ts`
- Test: `packages/infra-openrouter/src/__tests__/defaultAllowlist.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/infra-openrouter/src/__tests__/defaultAllowlist.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPENROUTER_ALLOWED_MODELS,
  getDefaultAllowlistPricing,
  isDefaultAllowedModel,
} from '../defaultAllowlist.js';

describe('defaultAllowlist', () => {
  describe('DEFAULT_OPENROUTER_ALLOWED_MODELS', () => {
    it('contains exactly 4 models', () => {
      expect(DEFAULT_OPENROUTER_ALLOWED_MODELS).toHaveLength(4);
    });

    it('each model has required fields', () => {
      for (const model of DEFAULT_OPENROUTER_ALLOWED_MODELS) {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.provider).toBeDefined();
        expect(model.promptPerToken).toBeDefined();
        expect(model.completionPerToken).toBeDefined();
      }
    });
  });

  describe('isDefaultAllowedModel', () => {
    it('returns true for allowed model IDs', () => {
      expect(isDefaultAllowedModel('google/gemma-4-31b-it:free')).toBe(true);
      expect(isDefaultAllowedModel('minimax/minimax-m2.7')).toBe(true);
    });

    it('returns false for non-allowed model IDs', () => {
      expect(isDefaultAllowedModel('anthropic/claude-sonnet-4.6')).toBe(false);
      expect(isDefaultAllowedModel('unknown')).toBe(false);
    });
  });

  describe('getDefaultAllowlistPricing', () => {
    it('returns pricing for allowed models', () => {
      const pricing = getDefaultAllowlistPricing('google/gemma-4-31b-it:free');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPricePerMillion).toBeGreaterThanOrEqual(0);
      expect(pricing?.outputPricePerMillion).toBeGreaterThanOrEqual(0);
    });

    it('returns undefined for non-allowed models', () => {
      expect(getDefaultAllowlistPricing('unknown')).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- infra-openrouter`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement the default allowlist**

Create `packages/infra-openrouter/src/defaultAllowlist.ts`:

```typescript
/**
 * Curated allowlist of OpenRouter models eligible for default model selection.
 *
 * These models are available as the user's primary or fallback default LLM model.
 * Separate from the research allowlist — this is a smaller, curated set of
 * reliable models suitable for general-purpose generate() calls.
 */

import type { ModelPricing } from '@intexuraos/llm-contract';
import { toModelPricing } from './costCalculator.js';

/**
 * Allowlist entry for a default-eligible OpenRouter model.
 */
export interface DefaultAllowedOpenRouterModel {
  /** Model ID as used in OpenRouter API (e.g., 'google/gemma-4-31b-it:free') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider name */
  provider: string;
  /** Fallback prompt price per token */
  promptPerToken: string;
  /** Fallback completion price per token */
  completionPerToken: string;
}

/**
 * Curated list of 4 OpenRouter models for default model selection.
 */
export const DEFAULT_OPENROUTER_ALLOWED_MODELS: readonly DefaultAllowedOpenRouterModel[] = [
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B IT',
    provider: 'Google',
    promptPerToken: '0',
    completionPerToken: '0',
  },
  {
    id: 'minimax/minimax-m2.7',
    name: 'MiniMax M2.7',
    provider: 'MiniMax',
    promptPerToken: '0.0000003',
    completionPerToken: '0.0000012',
  },
  {
    id: 'qwen/qwen3.6-plus',
    name: 'Qwen 3.6 Plus',
    provider: 'Qwen',
    promptPerToken: '0.00000026',
    completionPerToken: '0.00000156',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B',
    provider: 'NVIDIA',
    promptPerToken: '0',
    completionPerToken: '0',
  },
] as const;

/**
 * Check if a raw model ID (without 'or:' prefix) is in the default allowlist.
 */
export function isDefaultAllowedModel(modelId: string): boolean {
  return DEFAULT_OPENROUTER_ALLOWED_MODELS.some((m) => m.id === modelId);
}

/**
 * Get fallback pricing for a default-allowlisted model.
 * Returns undefined if the model is not in the default allowlist.
 */
export function getDefaultAllowlistPricing(rawModelId: string): ModelPricing | undefined {
  const model = DEFAULT_OPENROUTER_ALLOWED_MODELS.find((m) => m.id === rawModelId);
  if (!model) {
    return undefined;
  }
  return toModelPricing(model.promptPerToken, model.completionPerToken);
}
```

Add exports to `packages/infra-openrouter/src/index.ts`:

```typescript
export {
  DEFAULT_OPENROUTER_ALLOWED_MODELS,
  isDefaultAllowedModel,
  getDefaultAllowlistPricing,
  type DefaultAllowedOpenRouterModel,
} from './defaultAllowlist.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- infra-openrouter`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/infra-openrouter/src/defaultAllowlist.ts packages/infra-openrouter/src/index.ts packages/infra-openrouter/src/__tests__/defaultAllowlist.test.ts
git commit -m "feat(infra-openrouter): add default model allowlist with 4 curated OpenRouter models"
```

---

## Task 3: Add OpenRouter Generate Client to llm-factory

**Files:**
- Create: `packages/llm-factory/src/openRouterGenerateClient.ts`
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/index.ts`
- Test: `packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts`
- Test: existing `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`

**Context:** Currently `createLlmClient()` throws for non-Google providers. This task adds OpenRouter support so that `or:`-prefixed models can be used as default models. The OpenRouter generate client wraps `createOpenRouterClient` from `infra-openrouter`.

- [ ] **Step 1: Write failing tests for OpenRouter generate client**

```typescript
// packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOpenRouterGenerateClient } from '../openRouterGenerateClient.js';
import type { LlmGenerateClient } from '../llmClientFactory.js';
import { createFakeLogger } from '@intexuraos/common-core/testFixtures';
import { NoopUsageSink } from '@intexuraos/llm-pricing';

describe('createOpenRouterGenerateClient', () => {
  it('returns an object with a generate method', () => {
    const client = createOpenRouterGenerateClient({
      apiKey: 'sk-or-test-key',
      model: 'or:google/gemma-4-31b-it:free',
      userId: 'user-123',
      pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0 },
      logger: createFakeLogger(),
      usageSink: new NoopUsageSink(),
    });

    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('satisfies the LlmGenerateClient interface', () => {
    const client: LlmGenerateClient = createOpenRouterGenerateClient({
      apiKey: 'sk-or-test-key',
      model: 'or:google/gemma-4-31b-it:free',
      userId: 'user-123',
      pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0 },
      logger: createFakeLogger(),
      usageSink: new NoopUsageSink(),
    });

    expect(client.generate).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- llm-factory`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement the OpenRouter generate client**

Create `packages/llm-factory/src/openRouterGenerateClient.ts`:

```typescript
/**
 * OpenRouter LlmGenerateClient adapter.
 *
 * Wraps the infra-openrouter client to satisfy the LlmGenerateClient interface
 * used by all services that call getLlmClient().
 */

import { createOpenRouterClient } from '@intexuraos/infra-openrouter';
import { getOpenRouterRawId, isOpenRouterModel } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import { err } from '@intexuraos/common-core';
import type { LlmClientConfig, LlmGenerateClient, GenerateResult, LLMError } from './llmClientFactory.js';

/**
 * Create an LlmGenerateClient backed by OpenRouter.
 *
 * Strips the 'or:' prefix before passing to the OpenRouter API client,
 * and maps OpenRouter errors to the LLMError interface.
 */
export function createOpenRouterGenerateClient(config: LlmClientConfig): LlmGenerateClient {
  const rawModel = isOpenRouterModel(config.model)
    ? getOpenRouterRawId(config.model)
    : (config.model as string);

  const orClient = createOpenRouterClient({
    apiKey: config.apiKey,
    model: rawModel,
    userId: config.userId,
    pricing: config.pricing,
    logger: config.logger,
    usageSink: config.usageSink,
  });

  return {
    async generate(prompt: string): Promise<Result<GenerateResult, LLMError>> {
      const result = await orClient.generate(prompt);
      if (!result.ok) {
        return err({
          code: result.error.code === 'INVALID_KEY' ? 'AUTH_ERROR' : 'API_ERROR',
          message: result.error.message,
        });
      }
      return result;
    },
  };
}
```

- [ ] **Step 4: Update `createLlmClient` to support OpenRouter**

In `packages/llm-factory/src/llmClientFactory.ts`, change the provider check to support OpenRouter:

Replace this block (lines 118-135):
```typescript
export function createLlmClient(config: LlmClientConfig): LlmGenerateClient {
  // Validate model is supported
  if (!isValidModel(config.model)) {
    const model = config.model as string;
    throw new Error(`Unsupported LLM model: ${model}`);
  }

  // Check provider first, before model validation
  const provider = LlmProviders.Google;
  const providerForModel = getProviderForModel(config.model);
  if (providerForModel !== provider) {
    throw new Error(
      `Unsupported LLM provider: ${providerForModel}. Only ${provider} is supported.`
    );
  }

  return createGeminiClient(config);
}
```

With:
```typescript
export function createLlmClient(config: LlmClientConfig): LlmGenerateClient {
  const model = config.model as string;

  // OpenRouter models (or: prefix) are routed to the OpenRouter client
  if (isOpenRouterModel(model)) {
    return createOpenRouterGenerateClient(config);
  }

  // Validate model is a known static model
  if (!isValidModel(config.model)) {
    throw new Error(`Unsupported LLM model: ${model}`);
  }

  // Static models: check provider
  const providerForModel = getProviderForModel(config.model);
  if (providerForModel !== LlmProviders.Google) {
    throw new Error(
      `Unsupported LLM provider: ${providerForModel}. Only ${LlmProviders.Google} is supported.`
    );
  }

  return createGeminiClient(config);
}
```

Add import at top of `llmClientFactory.ts`:
```typescript
import { isOpenRouterModel } from '@intexuraos/llm-contract';
import { createOpenRouterGenerateClient } from './openRouterGenerateClient.js';
```

Update the `SupportedProvider` type and `isSupportedProvider`:
```typescript
type SupportedProvider = typeof LlmProviders.Google | typeof LlmProviders.OpenRouter;

export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return provider === LlmProviders.Google || provider === LlmProviders.OpenRouter;
}
```

Update `packages/llm-factory/src/index.ts` to export the new client:
```typescript
export { createOpenRouterGenerateClient } from './openRouterGenerateClient.js';
```

- [ ] **Step 5: Add test for OpenRouter routing in factory**

Add to `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`:

```typescript
describe('OpenRouter routing', () => {
  it('creates an OpenRouter client for or: prefixed models', () => {
    const client = createLlmClient({
      apiKey: 'sk-or-test',
      model: 'or:google/gemma-4-31b-it:free' as LLMModel,
      userId: 'user-123',
      pricing: { inputPricePerMillion: 0, outputPricePerMillion: 0 },
      logger: createFakeLogger(),
      usageSink: new NoopUsageSink(),
    });

    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- llm-factory`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/llm-factory/src/openRouterGenerateClient.ts packages/llm-factory/src/llmClientFactory.ts packages/llm-factory/src/index.ts packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts packages/llm-factory/src/__tests__/llmClientFactory.test.ts
git commit -m "feat(llm-factory): add OpenRouter provider support for default model selection"
```

---

## Task 4: Update User Settings Domain Model and Repository

**Files:**
- Modify: `apps/user-service/src/domain/settings/models/UserSettings.ts`
- Modify: `apps/user-service/src/domain/settings/ports/UserSettingsRepository.ts`
- Modify: `apps/user-service/src/infra/firestore/userSettingsRepository.ts`
- Test: existing `apps/user-service/src/__tests__/` (repository tests)

- [ ] **Step 1: Write failing tests for updated repository**

Find and update the existing repository tests to include fallback model scenarios. Add tests such as:

```typescript
describe('updateLlmPreferences with fallbackModel', () => {
  it('stores both defaultModel and fallbackModel', async () => {
    const repo = new FirestoreUserSettingsRepository();
    await repo.updateLlmPreferences('user-1', LlmModels.Gemini25Flash, 'or:google/gemma-4-31b-it:free');

    const result = await repo.getSettings('user-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.llmPreferences?.defaultModel).toBe(LlmModels.Gemini25Flash);
    expect(result.value?.llmPreferences?.fallbackModel).toBe('or:google/gemma-4-31b-it:free');
  });

  it('stores defaultModel only when fallbackModel is undefined', async () => {
    const repo = new FirestoreUserSettingsRepository();
    await repo.updateLlmPreferences('user-1', LlmModels.Gemini25Flash);

    const result = await repo.getSettings('user-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.llmPreferences?.defaultModel).toBe(LlmModels.Gemini25Flash);
    expect(result.value?.llmPreferences?.fallbackModel).toBeUndefined();
  });

  it('clears fallbackModel when null is passed', async () => {
    const repo = new FirestoreUserSettingsRepository();
    // Set both first
    await repo.updateLlmPreferences('user-1', LlmModels.Gemini25Flash, 'or:google/gemma-4-31b-it:free');
    // Clear fallback
    await repo.updateLlmPreferences('user-1', LlmModels.Gemini25Flash, null);

    const result = await repo.getSettings('user-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.llmPreferences?.fallbackModel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- user-service`
Expected: FAIL - signature mismatch / property not found.

- [ ] **Step 3: Update the domain model**

In `apps/user-service/src/domain/settings/models/UserSettings.ts`, update `LlmPreferences`:

```typescript
/**
 * LLM preferences for user-selected models.
 */
export interface LlmPreferences {
  defaultModel: LLMModel; // User's preferred default LLM model
  fallbackModel?: string; // Optional fallback model (LLMModel or OpenRouterModelId)
}
```

- [ ] **Step 4: Update the repository port**

In `apps/user-service/src/domain/settings/ports/UserSettingsRepository.ts`, update the method signature:

```typescript
/**
 * Update the user's default LLM model preference and optional fallback.
 * Creates the settings document if it doesn't exist.
 * Pass `null` for fallbackModel to clear it; pass `undefined` to leave it unchanged.
 */
updateLlmPreferences(
  userId: string,
  defaultModel: LLMModel,
  fallbackModel?: string | null
): Promise<Result<void, SettingsError>>;
```

- [ ] **Step 5: Update the Firestore repository implementation**

In `apps/user-service/src/infra/firestore/userSettingsRepository.ts`, update `updateLlmPreferences`:

```typescript
async updateLlmPreferences(
  userId: string,
  defaultModel: LLMModel,
  fallbackModel?: string | null
): Promise<Result<void, SettingsError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const doc = await docRef.get();

    if (!doc.exists) {
      const now = new Date().toISOString();
      const preferences: Record<string, unknown> = { defaultModel };
      if (fallbackModel !== undefined && fallbackModel !== null) {
        preferences['fallbackModel'] = fallbackModel;
      }
      await docRef.set({
        userId,
        llmPreferences: preferences,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const updates: Record<string, unknown> = {
        'llmPreferences.defaultModel': defaultModel,
        updatedAt: new Date().toISOString(),
      };
      if (fallbackModel === null) {
        updates['llmPreferences.fallbackModel'] = FieldValue.delete();
      } else if (fallbackModel !== undefined) {
        updates['llmPreferences.fallbackModel'] = fallbackModel;
      }
      await docRef.update(updates);
    }

    return ok(undefined);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to update LLM preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
```

Also update `clearLlmPreferences` — the existing comment notes it deletes the entire `llmPreferences` field, which is correct since it now has two sub-fields. No change needed there.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- user-service`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/user-service/src/domain/settings/models/UserSettings.ts apps/user-service/src/domain/settings/ports/UserSettingsRepository.ts apps/user-service/src/infra/firestore/userSettingsRepository.ts
git commit -m "feat(user-service): add fallbackModel to LlmPreferences domain model and repository"
```

---

## Task 5: Update User-Service Routes for Fallback Model

**Files:**
- Modify: `apps/user-service/src/routes/settingsRoutes.ts`
- Modify: `apps/user-service/src/routes/internalRoutes.ts`
- Modify: `apps/user-service/src/routes/llmKeysRoutes.ts`
- Test: existing route tests

**Context:** Three route files need changes:
1. `settingsRoutes.ts` PATCH — accept `fallbackModel`, validate with `isDefaultEligibleModel` instead of `isFastModel`
2. `internalRoutes.ts` GET — return `fallbackModel` in internal settings response
3. `llmKeysRoutes.ts` GET — return `fallbackModel`; DELETE — cascade clear fallbackModel

- [ ] **Step 1: Write failing tests for the PATCH endpoint changes**

Add test cases for:
- Accepting `fallbackModel` in the request body
- Validating `defaultModel` with `isDefaultEligibleModel` (accepts OpenRouter models)
- Validating `fallbackModel` with `isDefaultEligibleModel`
- Accepting `fallbackModel: null` to clear it
- Rejecting invalid `fallbackModel` values

```typescript
it('accepts defaultModel as an OpenRouter model', async () => {
  const response = await app.inject({
    method: 'PATCH',
    url: '/users/user-1/settings',
    headers: { authorization: 'Bearer valid-token' },
    payload: { defaultModel: 'or:google/gemma-4-31b-it:free' },
  });
  expect(response.statusCode).toBe(200);
});

it('accepts fallbackModel alongside defaultModel', async () => {
  const response = await app.inject({
    method: 'PATCH',
    url: '/users/user-1/settings',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      defaultModel: 'gemini-2.5-flash',
      fallbackModel: 'or:minimax/minimax-m2.7',
    },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body.data.defaultModel).toBe('gemini-2.5-flash');
  expect(body.data.fallbackModel).toBe('or:minimax/minimax-m2.7');
});

it('clears fallbackModel when null is passed', async () => {
  const response = await app.inject({
    method: 'PATCH',
    url: '/users/user-1/settings',
    headers: { authorization: 'Bearer valid-token' },
    payload: { defaultModel: 'gemini-2.5-flash', fallbackModel: null },
  });
  expect(response.statusCode).toBe(200);
});

it('rejects invalid fallbackModel', async () => {
  const response = await app.inject({
    method: 'PATCH',
    url: '/users/user-1/settings',
    headers: { authorization: 'Bearer valid-token' },
    payload: { defaultModel: 'gemini-2.5-flash', fallbackModel: 'invalid-model' },
  });
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- user-service`
Expected: FAIL

- [ ] **Step 3: Update settingsRoutes.ts PATCH endpoint**

In `apps/user-service/src/routes/settingsRoutes.ts`:

1. Change import from `isFastModel` to `isDefaultEligibleModel`:
```typescript
import { isDefaultEligibleModel, getProviderForModel } from '@intexuraos/llm-contract';
```

2. Update body schema to accept optional `fallbackModel`:
```typescript
body: {
  type: 'object',
  required: ['defaultModel'],
  properties: {
    defaultModel: {
      type: 'string',
      description: 'Default model for generate() calls',
    },
    fallbackModel: {
      type: ['string', 'null'],
      description: 'Optional fallback model. Pass null to clear.',
    },
  },
},
```

3. Update response schema to include `fallbackModel`:
```typescript
data: {
  type: 'object',
  properties: {
    defaultModel: { type: 'string' },
    fallbackModel: { type: 'string', nullable: true },
  },
},
```

4. Update the handler validation logic:
```typescript
const body = request.body as { defaultModel: string; fallbackModel?: string | null };

// Validate defaultModel
if (!isDefaultEligibleModel(body.defaultModel)) {
  return await reply.fail('INVALID_REQUEST', `Invalid model: ${body.defaultModel}. Must be a supported default model.`);
}

// Validate fallbackModel if provided (null means "clear it")
if (body.fallbackModel !== undefined && body.fallbackModel !== null) {
  if (!isDefaultEligibleModel(body.fallbackModel)) {
    return await reply.fail('INVALID_REQUEST', `Invalid fallback model: ${body.fallbackModel}. Must be a supported default model.`);
  }

  // Verify user has API key for fallback model's provider
  const fallbackProvider = getProviderForModel(body.fallbackModel);
  const hasFallbackKey = settingsResult.value?.llmApiKeys?.[fallbackProvider] !== undefined;
  if (!hasFallbackKey) {
    return await reply.fail(
      'INVALID_REQUEST',
      `Cannot set fallback model to ${body.fallbackModel}: no API key configured for provider '${fallbackProvider}'`
    );
  }
}

// Save both
const result = await userSettingsRepository.updateLlmPreferences(
  params.uid,
  body.defaultModel,
  body.fallbackModel
);

if (!result.ok) {
  return await reply.fail('INTERNAL_ERROR', result.error.message);
}

return await reply.ok({
  defaultModel: body.defaultModel,
  fallbackModel: body.fallbackModel ?? null,
});
```

- [ ] **Step 4: Update internalRoutes.ts to return fallbackModel**

In `apps/user-service/src/routes/internalRoutes.ts`, update the GET `/internal/users/:uid/settings` response schema:

```typescript
llmPreferences: {
  type: 'object',
  properties: {
    defaultModel: { type: 'string' },
    fallbackModel: { type: 'string' },
  },
},
```

The response handler already returns `settings?.llmPreferences` which will now include `fallbackModel` if present.

- [ ] **Step 5: Update llmKeysRoutes.ts GET and DELETE**

In the GET `/users/:uid/settings/llm-keys` response:
1. Add `fallbackModel` to the response schema alongside `defaultModel`
2. Add to the response body:
```typescript
return await reply.ok({
  defaultModel: settings?.llmPreferences?.defaultModel ?? null,
  fallbackModel: settings?.llmPreferences?.fallbackModel ?? null,
  // ... existing fields ...
});
```

In the DELETE handler's cascade logic (around line 565-572), also cascade-clear `fallbackModel`:
```typescript
// Cascade: clear defaultModel/fallbackModel if they belong to the deleted provider
const settingsResult = await userSettingsRepository.getSettings(params.uid);
if (settingsResult.ok) {
  const prefs = settingsResult.value?.llmPreferences;
  const currentDefault = prefs?.defaultModel;
  const currentFallback = prefs?.fallbackModel;

  let shouldClear = false;
  if (currentDefault !== undefined) {
    const defaultProvider = getProviderForModel(currentDefault);
    if (defaultProvider === params.provider) {
      shouldClear = true;
    }
  }

  // Check if fallback belongs to deleted provider
  let shouldClearFallback = false;
  if (currentFallback !== undefined) {
    const fallbackProvider = getProviderForModel(currentFallback);
    if (fallbackProvider === params.provider) {
      shouldClearFallback = true;
    }
  }

  if (shouldClear) {
    await userSettingsRepository.clearLlmPreferences(params.uid);
  } else if (shouldClearFallback) {
    // Clear only the fallback, keep defaultModel intact
    await userSettingsRepository.updateLlmPreferences(params.uid, currentDefault!, null);
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- user-service`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/user-service/src/routes/settingsRoutes.ts apps/user-service/src/routes/internalRoutes.ts apps/user-service/src/routes/llmKeysRoutes.ts
git commit -m "feat(user-service): accept fallbackModel in settings PATCH, return in GET, cascade on key delete"
```

---

## Task 6: Add Fallback Retry Logic to getLlmClient in internal-clients

**Files:**
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Modify: `packages/internal-clients/src/user-service/types.ts`
- Test: `packages/internal-clients/src/__tests__/user-service/client.test.ts`

**Context:** `getLlmClient` currently creates one LLM client. It must now:
1. Read both `defaultModel` and `fallbackModel` from settings
2. Create the primary client (no change to existing flow)
3. Wrap the client: if `generate()` fails AND a fallback model exists, create a fallback client and retry once
4. If no fallback model: let the error propagate (no retry)
5. Maximum 2 attempts total

- [ ] **Step 1: Write failing tests for fallback behavior**

```typescript
describe('getLlmClient fallback behavior', () => {
  it('returns a client that retries with fallback model on primary failure', async () => {
    // Setup: user has defaultModel=gemini-2.5-flash, fallbackModel=or:google/gemma-4-31b-it:free
    // Primary generate() fails, fallback succeeds
    // Assert: the returned client.generate() succeeds with fallback content
  });

  it('returns primary result when primary succeeds (no fallback attempted)', async () => {
    // Setup: primary generate() succeeds
    // Assert: result is from primary, not fallback
  });

  it('returns primary error when no fallback model is configured', async () => {
    // Setup: user has no fallbackModel, primary fails
    // Assert: error is returned from primary
  });

  it('returns fallback error when both primary and fallback fail', async () => {
    // Setup: both fail
    // Assert: error from fallback attempt is returned
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- internal-clients`
Expected: FAIL

- [ ] **Step 3: Update getLlmClient to support fallback**

In `packages/internal-clients/src/user-service/client.ts`, modify `getLlmClient`:

The key changes are:

1. Read `fallbackModel` from the settings response alongside `defaultModel`:
```typescript
const settingsBody = (await settingsResponse.json()) as {
  success: boolean;
  data: {
    llmPreferences?: {
      defaultModel: string;
      fallbackModel?: string;
    };
  };
};

const rawModel = settingsBody.data.llmPreferences?.defaultModel ?? LlmModels.Gemini25Flash;
const fallbackModelRaw = settingsBody.data.llmPreferences?.fallbackModel;
```

2. Accept OpenRouter models using `isDefaultEligibleModel` instead of `isValidModel` for validation (add `isDefaultEligibleModel` to imports from `@intexuraos/llm-contract`):
```typescript
import {
  getProviderForModel,
  isDefaultEligibleModel,
  isValidModel,
  LlmModels,
  LlmProviders,
  type LlmProvider,
} from '@intexuraos/llm-contract';
```

3. Create a helper to build a client for a given model + keys:
```typescript
function buildClient(
  model: string,
  apiKeys: Record<string, string | null | undefined>,
  config: UserServiceConfig
): LlmGenerateClient | null {
  const provider = getProviderForModel(model);
  const keyField = providerToKeyField(provider);
  const apiKey = apiKeys[keyField];

  if (apiKey === null || apiKey === undefined) {
    return null;
  }

  // For OpenRouter models, use allowlist pricing; for static models, use pricing context
  let pricing;
  if (isOpenRouterModel(model)) {
    const rawId = getOpenRouterRawId(model);
    pricing = getDefaultAllowlistPricing(rawId);
    if (pricing === undefined) {
      // Fallback: zero pricing (free models or unknown)
      pricing = { inputPricePerMillion: 0, outputPricePerMillion: 0 };
    }
  } else {
    pricing = config.pricingContext.getPricing(model as LLMModel);
  }

  return createLlmClient({
    apiKey,
    model: model as LLMModel,
    userId: config.logger.bindings?.()?.userId as string ?? '',
    pricing,
    logger: config.logger,
    usageSink: config.usageSink,
  });
}
```

4. Wrap the primary client with fallback retry:
```typescript
// If fallback model exists, wrap the client with retry logic
if (fallbackModelRaw !== undefined && isDefaultEligibleModel(fallbackModelRaw)) {
  const primaryClient = client;
  const wrappedClient: LlmGenerateClient = {
    async generate(prompt: string) {
      const primaryResult = await primaryClient.generate(prompt);
      if (primaryResult.ok) {
        return primaryResult;
      }

      logger.warn(
        { userId, primaryModel: defaultModel, fallbackModel: fallbackModelRaw, error: primaryResult.error },
        'Primary model failed, attempting fallback'
      );

      const fallbackClient = buildClient(fallbackModelRaw, keysBody.data, config);
      if (fallbackClient === null) {
        logger.warn({ userId, fallbackModel: fallbackModelRaw }, 'No API key for fallback model');
        return primaryResult;
      }

      return await fallbackClient.generate(prompt);
    },
  };
  return ok(wrappedClient);
}

return ok(client);
```

Add needed imports:
```typescript
import { getDefaultAllowlistPricing } from '@intexuraos/infra-openrouter';
import { isOpenRouterModel, getOpenRouterRawId, isDefaultEligibleModel } from '@intexuraos/llm-contract';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- internal-clients`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/internal-clients/src/user-service/client.ts packages/internal-clients/src/user-service/types.ts
git commit -m "feat(internal-clients): add fallback model retry logic to getLlmClient"
```

---

## Task 7: Update Web App Types and API Layer

**Files:**
- Modify: `apps/web/src/services/llmKeysApi.types.ts`
- Modify: `apps/web/src/services/llmKeysApi.ts`
- Modify: `apps/web/src/hooks/useLlmKeys.ts`

- [ ] **Step 1: Update LlmKeysResponse type**

In `apps/web/src/services/llmKeysApi.types.ts`, add `fallbackModel`:

```typescript
export interface LlmKeysResponse {
  defaultModel: string | null;
  fallbackModel: string | null;
  google: string | null;
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  openrouter: string | null;
  testResults: {
    google: LlmTestResult | null;
    openai: LlmTestResult | null;
    anthropic: LlmTestResult | null;
    perplexity: LlmTestResult | null;
    openrouter: LlmTestResult | null;
  };
}
```

- [ ] **Step 2: Update the API function**

In `apps/web/src/services/llmKeysApi.ts`, update `updateDefaultModel` to send both models. Rename to `updateLlmPreferences`:

```typescript
/**
 * Update the user's default and fallback LLM models.
 */
export async function updateLlmPreferences(
  accessToken: string,
  userId: string,
  defaultModel: string,
  fallbackModel?: string | null
): Promise<{ defaultModel: string; fallbackModel: string | null }> {
  return await apiRequest<{ defaultModel: string; fallbackModel: string | null }>(
    config.authServiceUrl,
    `/users/${userId}/settings`,
    accessToken,
    {
      method: 'PATCH',
      body: { defaultModel, ...(fallbackModel !== undefined && { fallbackModel }) },
    }
  );
}
```

Keep the old `updateDefaultModel` as a thin wrapper for backward compatibility (or update all call sites to use `updateLlmPreferences`):

```typescript
/**
 * Update the user's default LLM model.
 * @deprecated Use updateLlmPreferences instead.
 */
export async function updateDefaultModel(
  accessToken: string,
  userId: string,
  defaultModel: string
): Promise<{ defaultModel: string }> {
  return await apiRequest<{ defaultModel: string }>(
    config.authServiceUrl,
    `/users/${userId}/settings`,
    accessToken,
    {
      method: 'PATCH',
      body: { defaultModel },
    }
  );
}
```

Add `updateLlmPreferences` to the exports.

- [ ] **Step 3: Update the useLlmKeys hook**

In `apps/web/src/hooks/useLlmKeys.ts`:

1. Add `fallbackModel` to the return interface:
```typescript
interface UseLlmKeysResult {
  keys: LlmKeysResponse | null;
  defaultModel: string | null;
  fallbackModel: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  savingDefaultModel: boolean;
  setDefaultModel: (model: string) => Promise<void>;
  setFallbackModel: (model: string | null) => Promise<void>;
  setKey: (provider: LlmProvider, apiKey: string) => Promise<void>;
  deleteKey: (provider: LlmProvider) => Promise<void>;
  testKey: (provider: LlmProvider) => Promise<LlmTestResult>;
  refresh: (showLoading?: boolean) => Promise<void>;
}
```

2. Update `setDefaultModel` to use `updateLlmPreferences` — it sends the current fallback along:
```typescript
const setDefaultModel = useCallback(
  async (model: string): Promise<void> => {
    const userId = user?.sub;
    if (userId === undefined) return;

    const previousModel = keys?.defaultModel ?? null;
    setSavingDefaultModel(true);
    setError(null);

    setKeys((prev) => {
      if (prev === null) return prev;
      return { ...prev, defaultModel: model };
    });

    try {
      const token = await getAccessToken();
      await updateLlmPreferences(token, userId, model, keys?.fallbackModel);
    } catch (err) {
      setKeys((prev) => {
        if (prev === null) return prev;
        return { ...prev, defaultModel: previousModel };
      });
      setError(getErrorMessage(err, 'Failed to save default model'));
    } finally {
      setSavingDefaultModel(false);
    }
  },
  [user?.sub, getAccessToken, keys?.defaultModel, keys?.fallbackModel]
);
```

3. Add `setFallbackModel`:
```typescript
const setFallbackModel = useCallback(
  async (model: string | null): Promise<void> => {
    const userId = user?.sub;
    if (userId === undefined) return;

    const currentDefault = keys?.defaultModel;
    if (currentDefault === null || currentDefault === undefined) return;

    const previousFallback = keys?.fallbackModel ?? null;
    setSavingDefaultModel(true);
    setError(null);

    setKeys((prev) => {
      if (prev === null) return prev;
      return { ...prev, fallbackModel: model };
    });

    try {
      const token = await getAccessToken();
      await updateLlmPreferences(token, userId, currentDefault, model);
    } catch (err) {
      setKeys((prev) => {
        if (prev === null) return prev;
        return { ...prev, fallbackModel: previousFallback };
      });
      setError(getErrorMessage(err, 'Failed to save fallback model'));
    } finally {
      setSavingDefaultModel(false);
    }
  },
  [user?.sub, getAccessToken, keys?.defaultModel, keys?.fallbackModel]
);
```

4. Add to return:
```typescript
const fallbackModel = keys?.fallbackModel ?? null;

return {
  keys, defaultModel, fallbackModel, loading, refreshing, error, savingDefaultModel,
  setKey, deleteKey, testKey, setDefaultModel, setFallbackModel, refresh,
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/services/llmKeysApi.types.ts apps/web/src/services/llmKeysApi.ts apps/web/src/hooks/useLlmKeys.ts
git commit -m "feat(web): add fallback model to API types, API functions, and useLlmKeys hook"
```

---

## Task 8: Update Web UI with Two Model Selectors

**Files:**
- Modify: `apps/web/src/pages/ApiKeysSettingsPage.tsx`

- [ ] **Step 1: Update model grouping to include OpenRouter models**

Replace the `groupModelsByProvider` function to build groups from both `ALL_FAST_MODELS` AND `DEFAULT_OPENROUTER_MODELS`:

```typescript
import {
  ALL_FAST_MODELS,
  FAST_MODEL_DISPLAY_NAMES,
  LlmProviders,
  MODEL_PROVIDER_MAP,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_MODEL_DISPLAY_NAMES,
  type FastModel,
  type LlmProvider as ContractLlmProvider,
} from '@intexuraos/llm-contract';

interface ModelOption {
  model: string;
  name: string;
  disabled: boolean;
}

interface ModelGroup {
  provider: string;
  label: string;
  models: ModelOption[];
}

/**
 * Group default-eligible models by provider for dropdown display.
 * Includes fast models (if provider configured + test passing) and
 * OpenRouter default models (if OpenRouter configured + test passing).
 */
function groupDefaultEligibleModels(
  configuredProviders: Set<string>,
  testResults?: TestResults
): ModelGroup[] {
  const groups = new Map<string, ModelOption[]>();

  // Add fast models (existing logic)
  for (const model of ALL_FAST_MODELS) {
    const provider = MODEL_PROVIDER_MAP[model] as string;
    const isConfigured = configuredProviders.has(provider);
    const testResult = testResults?.[provider as keyof TestResults];
    const hasPassingTest = testResult?.status === 'success';

    if (!isConfigured || !hasPassingTest) continue;

    const existing = groups.get(provider) ?? [];
    existing.push({
      model,
      name: FAST_MODEL_DISPLAY_NAMES[model],
      disabled: false,
    });
    groups.set(provider, existing);
  }

  // Add OpenRouter default models (if OpenRouter is configured and tested)
  const orConfigured = configuredProviders.has(LlmProviders.OpenRouter);
  const orTest = testResults?.openrouter;
  const orPassing = orTest?.status === 'success';

  if (orConfigured && orPassing) {
    for (const orModel of DEFAULT_OPENROUTER_MODELS) {
      const orId = `or:${orModel.id}`;
      const providerLabel = `OpenRouter (${orModel.provider})`;
      // Group all OpenRouter models under 'openrouter'
      const existing = groups.get('openrouter') ?? [];
      existing.push({
        model: orId,
        name: orModel.name,
        disabled: false,
      });
      groups.set('openrouter', existing);
    }
  }

  const result: ModelGroup[] = [];
  for (const [provider, models] of groups) {
    result.push({
      provider,
      label: PROVIDER_GROUP_LABELS[provider] ?? provider,
      models,
    });
  }

  return result;
}
```

- [ ] **Step 2: Add the fallback model select box**

In the JSX, after the existing default model `<Card>`, add the fallback card:

```tsx
const { keys, defaultModel, fallbackModel, loading, error, savingDefaultModel, setKey, deleteKey, testKey, setDefaultModel, setFallbackModel } = useLlmKeys();

// ... existing default model card ...

<Card className="mb-6">
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0 flex-1">
      <h3 className="font-medium text-slate-900 dark:text-slate-100">Fallback Model</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        If the default model fails, this model is used as a fallback. Optional.
      </p>
    </div>
    <div className="relative flex items-center gap-2">
      {savingDefaultModel ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      ) : null}
      <select
        value={fallbackModel ?? ''}
        onChange={(e): void => {
          const value = e.target.value;
          if (value === '') {
            void setFallbackModel(null);
          } else {
            void setFallbackModel(value);
          }
        }}
        disabled={savingDefaultModel || defaultModel === null}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
      >
        <option value="">None (no fallback)</option>
        {modelGroups.map((group) => (
          <optgroup key={group.provider} label={group.label}>
            {group.models
              .filter((m) => m.model !== defaultModel)
              .map((m) => (
                <option key={m.model} value={m.model} disabled={m.disabled}>
                  {m.name}{m.disabled ? ' (No API key)' : ''}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  </div>
  {defaultModel === null ? (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Select a default model first to enable fallback selection.
      </p>
    </div>
  ) : null}
</Card>
```

- [ ] **Step 3: Update hasKeyForDefaultModel check for OpenRouter**

The existing `hasKeyForDefaultModel` check uses `MODEL_PROVIDER_MAP` which only covers static models. For OpenRouter models, the provider is always `openrouter`. Update:

```typescript
import { getProviderForModel } from '@intexuraos/llm-contract';

const currentProvider = defaultModel !== null
  ? getProviderForModel(defaultModel)
  : null;
const hasKeyForDefaultModel = currentProvider !== null && configuredProviders.has(currentProvider);
```

- [ ] **Step 4: Update groupModelsByProvider calls**

Replace the old `groupModelsByProvider` call with `groupDefaultEligibleModels`:

```typescript
const modelGroups = groupDefaultEligibleModels(configuredProviders, keys?.testResults);
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ApiKeysSettingsPage.tsx
git commit -m "feat(web): add fallback model selector and OpenRouter models to default model UI"
```

---

## Task 9: Build, Verify, and Final CI

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build`
Expected: PASS — all packages compile.

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS — all tests, lint, type checks pass.

- [ ] **Step 3: Fix any issues found and commit**

If CI fails, fix issues and commit fixes individually.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git commit -m "fix: address CI feedback for default/fallback model feature"
```

---

## Key Design Decisions

1. **`DefaultEligibleModel` vs expanding `FastModel`**: We introduce a new type rather than adding OpenRouter models to `FastModel`, because `FastModel` is used elsewhere (e.g., tool calling, cheap validation) where OpenRouter models aren't appropriate.

2. **`or:` prefix convention reused**: OpenRouter default models use the same `or:` prefix as research models. This keeps the existing `getProviderForModel()` and `isOpenRouterModel()` functions working without changes.

3. **Separate allowlist from research models**: The 4 curated default models go in `defaultAllowlist.ts`, separate from the research `allowlist.ts`. Different use cases, different model sets.

4. **Fallback is lazy**: The fallback client is only created when the primary fails. No upfront cost for users who never need the fallback.

5. **`fallbackModel: null` clears, `undefined` is "no change"**: Consistent with REST PATCH semantics — explicit null means "remove", absent means "don't touch".

6. **Validation widened from `isFastModel` to `isDefaultEligibleModel`**: The PATCH endpoint now accepts both fast models and the curated OpenRouter models. This is backward compatible — all previously valid values are still valid.

7. **Retry semantics**: Maximum 2 attempts (primary + fallback). If the user has no fallback, the error from the primary is returned directly. If both fail, the fallback error is returned (it's the more recent, actionable error).
