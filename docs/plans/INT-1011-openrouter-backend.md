# INT-1011: OpenRouter Backend Infrastructure (Phase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenRouter as the 5th LLM provider in the backend — type system, infra package, adapter, API key storage, pricing, schema, and model catalog endpoint — with zero user-visible changes.

**Architecture:** Widen `ResearchModel` (NOT `LLMModel`) with a branded `OpenRouterModelId` string type prefixed with `or:`. This avoids ripple effects into `PricingContext`, `MODEL_PROVIDER_MAP`, `ALL_LLM_MODELS`, and `llm-factory`. OpenRouter pricing is dynamic from their API (not Firestore). The client wraps the OpenAI SDK with a custom `baseURL`.

**Tech Stack:** TypeScript strict mode, OpenAI SDK (`openai` npm), native `fetch()`, Fastify, nock for HTTP mocking, vitest.

**Linear:** [INT-1011](https://linear.app/pbuchman/issue/INT-1011/openrouter-backend-infrastructure-phase-a)
**Parent:** [INT-616](https://linear.app/pbuchman/issue/INT-616/investigate-open-router-integration-and-multi-model-selection)
**Design Doc:** `docs/plans/INT-616-design.md`

---

## File Structure

### New Files

| File                                                             | Responsibility                       |
| ---------------------------------------------------------------- | ------------------------------------ |
| `packages/infra-openrouter/package.json`                         | Package config (ESM, workspace deps) |
| `packages/infra-openrouter/tsconfig.json`                        | TypeScript config                    |
| `packages/infra-openrouter/src/index.ts`                         | Public exports                       |
| `packages/infra-openrouter/src/types.ts`                         | OpenRouterConfig, API response types |
| `packages/infra-openrouter/src/client.ts`                        | LLM client using OpenAI SDK          |
| `packages/infra-openrouter/src/modelCatalog.ts`                  | Model catalog fetcher                |
| `packages/infra-openrouter/src/costCalculator.ts`                | Pricing conversion                   |
| `packages/infra-openrouter/src/__tests__/client.test.ts`         | Client tests                         |
| `packages/infra-openrouter/src/__tests__/modelCatalog.test.ts`   | Catalog tests                        |
| `packages/infra-openrouter/src/__tests__/costCalculator.test.ts` | Cost calculator tests                |
| `apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`         | Research adapter                     |
| `apps/research-agent/src/routes/openRouterRoutes.ts`             | Model catalog endpoint               |

### Modified Files

| File                                                           | Change                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/llm-contract/src/supportedModels.ts`                 | Add `OpenRouter` provider, `OpenRouterModelId` type, widen `ResearchModel` |
| `packages/llm-contract/src/supportedModels.test.ts`            | Tests for new types/helpers                                                |
| `packages/llm-contract/src/index.ts`                           | Export new types                                                           |
| `packages/internal-clients/src/user-service/types.ts`          | Add `openrouter` to `DecryptedApiKeys`                                     |
| `packages/internal-clients/src/user-service/client.ts`         | Add `openrouter` case to `providerToKeyField()`                            |
| `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`       | Add `case 'openrouter'`                                                    |
| `apps/research-agent/src/routes/schemas/common.ts`             | Relax `supportedModelSchema` with `anyOf`                                  |
| `apps/user-service/src/domain/settings/models/UserSettings.ts` | Add `openrouter` to key/test types                                         |
| `apps/user-service/src/routes/llmKeysRoutes.ts`                | Add `openrouter` to provider schemas                                       |
| `apps/user-service/src/routes/internalRoutes.ts`               | Add `openrouter` to internal response                                      |
| `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`          | Add OpenRouter key validation                                              |

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
import {
  // ... existing imports ...
  isOpenRouterModel,
  createOpenRouterModelId,
  getOpenRouterRawId,
  type OpenRouterModelId,
} from '../supportedModels.js';

describe('OpenRouter model helpers', () => {
  it('isOpenRouterModel returns true for or: prefixed models', () => {
    expect(isOpenRouterModel('or:anthropic/claude-sonnet-4')).toBe(true);
    expect(isOpenRouterModel('or:meta-llama/llama-3.1-70b-instruct')).toBe(true);
  });

  it('isOpenRouterModel returns false for static models', () => {
    expect(isOpenRouterModel('gemini-2.5-pro')).toBe(false);
    expect(isOpenRouterModel('claude-opus-4-5-20251101')).toBe(false);
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
    expect(LlmProviders.Google).toBe('google');
    expect(LlmProviders.OpenAI).toBe('openai');
    expect(LlmProviders.Anthropic).toBe('anthropic');
    expect(LlmProviders.Perplexity).toBe('perplexity');
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
    expect(getProviderForModel(LlmModels.ClaudeOpus45)).toBe('anthropic');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/llm-contract/src/__tests__/supportedModels.test.ts`
Expected: FAIL — `isOpenRouterModel` not exported

- [ ] **Step 3: Implement type system changes**

In `packages/llm-contract/src/supportedModels.ts`, add after the Perplexity provider type:

```typescript
export type OpenRouter = 'openrouter';
```

Update `LlmProvider` union:

```typescript
export type LlmProvider = Google | OpenAI | Anthropic | Perplexity | OpenRouter;
```

Add branded type after `SonarDeepResearch`:

```typescript
// =============================================================================
// OpenRouter Dynamic Model Types
// =============================================================================

/**
 * Branded string type for OpenRouter model IDs.
 * Format: 'or:{author}/{slug}' (e.g., 'or:anthropic/claude-sonnet-4')
 * Validated at runtime, not compile time.
 */
export type OpenRouterModelId = string & { readonly __brand: 'OpenRouterModelId' };
```

Widen `ResearchModel`:

```typescript
export type ResearchModel =
  | Gemini25Pro
  | Gemini25Flash
  | ClaudeOpus45
  | ClaudeSonnet45
  | O4MiniDeepResearch
  | GPT52
  | Sonar
  | SonarPro
  | SonarDeepResearch
  | OpenRouterModelId;
```

Add `OpenRouter` to `LlmProviders`:

```typescript
export const LlmProviders = {
  Google: 'google' as Google,
  OpenAI: 'openai' as OpenAI,
  Anthropic: 'anthropic' as Anthropic,
  Perplexity: 'perplexity' as Perplexity,
  OpenRouter: 'openrouter' as OpenRouter,
} as const;
```

Add helper functions before `getProviderForModel`:

```typescript
/**
 * Check if a model string is an OpenRouter dynamic model.
 */
export function isOpenRouterModel(model: string): model is OpenRouterModelId {
  return model.startsWith('or:') && model.length > 3;
}

/**
 * Create a branded OpenRouterModelId from a raw OpenRouter model ID.
 * @param rawId - OpenRouter model ID without prefix (e.g., 'anthropic/claude-sonnet-4')
 */
export function createOpenRouterModelId(rawId: string): OpenRouterModelId {
  return `or:${rawId}` as OpenRouterModelId;
}

/**
 * Extract the raw OpenRouter model ID (strip 'or:' prefix).
 */
export function getOpenRouterRawId(model: OpenRouterModelId): string {
  return model.slice(3);
}
```

Update `getProviderForModel` to accept `ResearchModel` and handle OpenRouter:

```typescript
/**
 * Get provider for a model.
 * Handles both static models (via MODEL_PROVIDER_MAP) and dynamic OpenRouter models.
 */
export function getProviderForModel(model: ResearchModel): LlmProvider {
  if (isOpenRouterModel(model)) {
    return LlmProviders.OpenRouter;
  }
  // After the OpenRouter guard, model is a static LLMModel
  return MODEL_PROVIDER_MAP[model as LLMModel];
}
```

Update header comment to reflect new model count.

- [ ] **Step 4: Update exports in index.ts**

In `packages/llm-contract/src/index.ts`, add to the value exports:

```typescript
  isOpenRouterModel,
  createOpenRouterModelId,
  getOpenRouterRawId,
```

Add to the type exports:

```typescript
  OpenRouter,
  OpenRouterModelId,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/llm-contract/src/__tests__/supportedModels.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Build and verify no type errors**

Run: `pnpm build`
Expected: Build succeeds. TypeScript may flag non-exhaustive switches in other packages — that's expected and will be fixed in later tasks.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-contract/src/supportedModels.ts packages/llm-contract/src/index.ts packages/llm-contract/src/__tests__/supportedModels.test.ts
git commit -m "feat(llm-contract): add OpenRouter provider type and OpenRouterModelId branded string"
```

---

### Task 2: infra-openrouter Package — Types & Cost Calculator

**Files:**
- Create: `packages/infra-openrouter/package.json`
- Create: `packages/infra-openrouter/tsconfig.json`
- Create: `packages/infra-openrouter/src/types.ts`
- Create: `packages/infra-openrouter/src/costCalculator.ts`
- Create: `packages/infra-openrouter/src/__tests__/costCalculator.test.ts`

- [ ] **Step 1: Create package scaffolding**

`packages/infra-openrouter/package.json`:

```json
{
  "name": "@intexuraos/infra-openrouter",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint:local": "eslint src --max-warnings 0"
  },
  "dependencies": {
    "@intexuraos/common-core": "workspace:*",
    "@intexuraos/llm-prompts": "workspace:*",
    "@intexuraos/llm-audit": "workspace:*",
    "@intexuraos/llm-contract": "workspace:*",
    "@intexuraos/llm-pricing": "workspace:*",
    "openai": "^4.80.0"
  },
  "devDependencies": {
    "nock": "^14.0.0"
  }
}
```

`packages/infra-openrouter/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "src/__tests__"]
}
```

- [ ] **Step 2: Create types.ts**

`packages/infra-openrouter/src/types.ts`:

```typescript
/**
 * Types for the OpenRouter client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';

export type {
  LLMError as OpenRouterError,
  ResearchResult,
  GenerateResult,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating an OpenRouter client.
 */
export interface OpenRouterConfig {
  /** OpenRouter API key */
  apiKey: string;
  /** OpenRouter model ID without or: prefix (e.g., 'anthropic/claude-sonnet-4') */
  model: string;
  /** User ID for usage tracking */
  userId: string;
  /** Cost configuration per million tokens */
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Request timeout in milliseconds. Default: 120000 (2 minutes) */
  timeoutMs?: number;
  /** Logger for structured LLM usage logging */
  logger: Logger;
}

/**
 * Normalized model info from OpenRouter catalog API.
 */
export interface OpenRouterModelInfo {
  /** Model ID (e.g., 'anthropic/claude-sonnet-4') */
  id: string;
  /** Display name (e.g., 'Anthropic: Claude Sonnet 4') */
  name: string;
  /** Maximum context length in tokens */
  contextLength: number;
  /** Pricing per token (as numbers, converted from API strings) */
  pricing: {
    promptPerToken: number;
    completionPerToken: number;
  };
  /** Input modalities (e.g., ['text', 'image']) */
  inputModalities: string[];
  /** Output modalities (e.g., ['text']) */
  outputModalities: string[];
}

/** Raw model entry from OpenRouter /api/v1/models response */
export interface OpenRouterRawModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    request: string;
    image: string;
  };
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
  };
  supported_parameters: string[];
}

/** Raw response from OpenRouter /api/v1/models */
export interface OpenRouterModelsResponse {
  data: OpenRouterRawModel[];
}
```

- [ ] **Step 3: Write failing cost calculator tests**

`packages/infra-openrouter/src/__tests__/costCalculator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { ModelPricing, TokenUsage } from '@intexuraos/llm-contract';
import { calculateTextCost, normalizeUsage, toModelPricing } from '../costCalculator.js';

describe('infra-openrouter costCalculator', () => {
  describe('toModelPricing', () => {
    it('converts OpenRouter per-token strings to per-million numbers', () => {
      const pricing = toModelPricing('0.000003', '0.000015');
      expect(pricing.inputPricePerMillion).toBeCloseTo(3.0, 6);
      expect(pricing.outputPricePerMillion).toBeCloseTo(15.0, 6);
    });

    it('sets useProviderCost to true', () => {
      const pricing = toModelPricing('0.000001', '0.000002');
      expect(pricing.useProviderCost).toBe(true);
    });

    it('handles zero pricing', () => {
      const pricing = toModelPricing('0', '0');
      expect(pricing.inputPricePerMillion).toBe(0);
      expect(pricing.outputPricePerMillion).toBe(0);
    });
  });

  describe('calculateTextCost', () => {
    const basePricing: ModelPricing = {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      useProviderCost: true,
    };

    it('uses provider cost when useProviderCost is true and cost is available', () => {
      const usage: TokenUsage = { inputTokens: 100, outputTokens: 50 };
      expect(calculateTextCost(usage, basePricing, 0.0042)).toBe(0.0042);
    });

    it('uses usage.providerCost when pricing flag is false', () => {
      const usage: TokenUsage = { inputTokens: 100, outputTokens: 50, providerCost: 0.005 };
      const pricing: ModelPricing = { ...basePricing, useProviderCost: false };
      expect(calculateTextCost(usage, pricing, undefined)).toBe(0.005);
    });

    it('falls back to token calculation when no provider cost', () => {
      const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 500_000 };
      const pricing: ModelPricing = { ...basePricing, useProviderCost: false };
      const cost = calculateTextCost(usage, pricing, undefined);
      // (1M * 3.0 + 500K * 15.0) / 1M = 3.0 + 7.5 = 10.5
      expect(cost).toBeCloseTo(10.5, 6);
    });
  });

  describe('normalizeUsage', () => {
    it('returns normalized usage with provider cost', () => {
      const pricing: ModelPricing = {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        useProviderCost: true,
      };
      const result = normalizeUsage(100, 50, 0.003, pricing);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBe(0.003);
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm vitest run packages/infra-openrouter/src/__tests__/costCalculator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement cost calculator**

`packages/infra-openrouter/src/costCalculator.ts`:

```typescript
import type { TokenUsage, NormalizedUsage, ModelPricing } from '@intexuraos/llm-contract';

/**
 * Convert OpenRouter per-token pricing strings to ModelPricing format.
 * OpenRouter returns pricing as per-token strings (e.g., "0.000003").
 * Our system uses per-million-token numbers (e.g., 3.0).
 */
export function toModelPricing(promptPerToken: string, completionPerToken: string): ModelPricing {
  return {
    inputPricePerMillion: parseFloat(promptPerToken) * 1_000_000,
    outputPricePerMillion: parseFloat(completionPerToken) * 1_000_000,
    useProviderCost: true,
  };
}

/**
 * Calculate text generation cost.
 * Prioritizes direct provider cost. Falls back to token-based calculation.
 */
export function calculateTextCost(
  usage: TokenUsage,
  pricing: ModelPricing,
  providerCost: number | undefined
): number {
  if (pricing.useProviderCost === true && providerCost !== undefined) {
    return providerCost;
  }
  if (usage.providerCost !== undefined) {
    return usage.providerCost;
  }

  const inputCost = usage.inputTokens * pricing.inputPricePerMillion;
  const outputCost = usage.outputTokens * pricing.outputPricePerMillion;
  return Math.round(inputCost + outputCost) / 1_000_000;
}

export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  providerCost: number | undefined,
  pricing: ModelPricing
): NormalizedUsage {
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    ...(providerCost !== undefined && { providerCost }),
  };

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing, providerCost),
  };
}
```

- [ ] **Step 6: Install dependencies and run tests**

Run: `pnpm install && pnpm vitest run packages/infra-openrouter/src/__tests__/costCalculator.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/infra-openrouter/
git commit -m "feat(infra-openrouter): scaffold package with types and cost calculator"
```

---

### Task 3: infra-openrouter — Model Catalog

**Files:**
- Create: `packages/infra-openrouter/src/modelCatalog.ts`
- Test: `packages/infra-openrouter/src/__tests__/modelCatalog.test.ts`

- [ ] **Step 1: Write failing catalog tests**

`packages/infra-openrouter/src/__tests__/modelCatalog.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { fetchModelCatalog } from '../modelCatalog.js';

const API_BASE = 'https://openrouter.ai';

describe('fetchModelCatalog', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('fetches and normalizes models from OpenRouter API', async () => {
    nock(API_BASE)
      .get('/api/v1/models')
      .matchHeader('Authorization', 'Bearer test-key')
      .reply(200, {
        data: [
          {
            id: 'anthropic/claude-sonnet-4',
            name: 'Anthropic: Claude Sonnet 4',
            context_length: 200000,
            pricing: { prompt: '0.000003', completion: '0.000015', request: '0', image: '0.0048' },
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['temperature', 'max_tokens'],
          },
        ],
      });

    const result = await fetchModelCatalog('test-key');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual({
        id: 'anthropic/claude-sonnet-4',
        name: 'Anthropic: Claude Sonnet 4',
        contextLength: 200000,
        pricing: { promptPerToken: 0.000003, completionPerToken: 0.000015 },
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
      });
    }
  });

  it('filters out non-text-output models', async () => {
    nock(API_BASE)
      .get('/api/v1/models')
      .reply(200, {
        data: [
          {
            id: 'text-model',
            name: 'Text Model',
            context_length: 4096,
            pricing: { prompt: '0.000001', completion: '0.000002', request: '0', image: '0' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            supported_parameters: [],
          },
          {
            id: 'image-model',
            name: 'Image Model',
            context_length: 4096,
            pricing: { prompt: '0.000001', completion: '0.000002', request: '0', image: '0' },
            architecture: { input_modalities: ['text'], output_modalities: ['image'] },
            supported_parameters: [],
          },
        ],
      });

    const result = await fetchModelCatalog('test-key');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.id).toBe('text-model');
    }
  });

  it('returns error on HTTP failure', async () => {
    nock(API_BASE).get('/api/v1/models').reply(401, { error: 'Invalid key' });

    const result = await fetchModelCatalog('bad-key');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_KEY');
    }
  });

  it('returns error on network failure', async () => {
    nock(API_BASE).get('/api/v1/models').replyWithError('connection refused');

    const result = await fetchModelCatalog('test-key');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_ERROR');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/infra-openrouter/src/__tests__/modelCatalog.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement model catalog**

`packages/infra-openrouter/src/modelCatalog.ts`:

```typescript
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { LLMError } from '@intexuraos/llm-contract';
import type { OpenRouterModelInfo, OpenRouterModelsResponse } from './types.js';

const API_BASE_URL = 'https://openrouter.ai';

/**
 * Fetch the model catalog from OpenRouter's /api/v1/models endpoint.
 * Filters to text-output models only.
 */
export async function fetchModelCatalog(
  apiKey: string
): Promise<Result<OpenRouterModelInfo[], LLMError>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const code = response.status === 401 ? 'INVALID_KEY' : 'API_ERROR';
      return err({
        code,
        message: `OpenRouter models API returned HTTP ${String(response.status)}`,
      });
    }

    const data = (await response.json()) as OpenRouterModelsResponse;

    const models = data.data
      .filter((m) => m.architecture.output_modalities.includes('text'))
      .map(
        (m): OpenRouterModelInfo => ({
          id: m.id,
          name: m.name,
          contextLength: m.context_length,
          pricing: {
            promptPerToken: parseFloat(m.pricing.prompt),
            completionPerToken: parseFloat(m.pricing.completion),
          },
          inputModalities: m.architecture.input_modalities,
          outputModalities: m.architecture.output_modalities,
        })
      );

    return ok(models);
  } catch (error) {
    return err({ code: 'API_ERROR', message: getErrorMessage(error) });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/infra-openrouter/src/__tests__/modelCatalog.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/infra-openrouter/src/modelCatalog.ts packages/infra-openrouter/src/__tests__/modelCatalog.test.ts
git commit -m "feat(infra-openrouter): add model catalog fetcher with text-model filtering"
```

---

### Task 4: infra-openrouter — Client

**Files:**
- Create: `packages/infra-openrouter/src/client.ts`
- Create: `packages/infra-openrouter/src/index.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`

- [ ] **Step 1: Write failing client tests**

`packages/infra-openrouter/src/__tests__/client.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { Logger } from '@intexuraos/common-core';
import type { ModelPricing } from '@intexuraos/llm-contract';

const API_BASE = 'https://openrouter.ai';

const mockAuditSuccess = vi.fn();
const mockAuditError = vi.fn();
vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn(() => ({
    success: mockAuditSuccess,
    error: mockAuditError,
  })),
}));

const mockUsageLoggerLog = vi.fn();
vi.mock('@intexuraos/llm-pricing', () => ({
  createUsageLogger: vi.fn(() => ({ log: mockUsageLoggerLog })),
}));

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

function createTestPricing(overrides?: Partial<ModelPricing>): ModelPricing {
  return {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    useProviderCost: true,
    ...overrides,
  };
}

describe('OpenRouter client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('research()', () => {
    it('sends request with correct model and headers', async () => {
      const scope = nock(API_BASE)
        .post('/api/v1/chat/completions', (body: Record<string, unknown>) => {
          return body.model === 'anthropic/claude-sonnet-4';
        })
        .matchHeader('HTTP-Referer', 'https://intexuraos.cloud')
        .matchHeader('X-Title', 'IntexuraOS Research Studio')
        .reply(200, {
          choices: [{ message: { content: 'Research result' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const { createOpenRouterClient } = await import('../client.js');
      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-4',
        userId: 'user-1',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.research('test prompt');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research result');
        expect(result.value.usage.inputTokens).toBe(100);
        expect(result.value.usage.outputTokens).toBe(50);
      }
      expect(scope.isDone()).toBe(true);
    });

    it('returns INVALID_KEY on 401', async () => {
      nock(API_BASE).post('/api/v1/chat/completions').reply(401, { error: { message: 'Invalid key' } });

      const { createOpenRouterClient } = await import('../client.js');
      const client = createOpenRouterClient({
        apiKey: 'bad-key',
        model: 'anthropic/claude-sonnet-4',
        userId: 'user-1',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.research('test');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED on 429', async () => {
      nock(API_BASE).post('/api/v1/chat/completions').reply(429, { error: { message: 'Rate limited' } });

      const { createOpenRouterClient } = await import('../client.js');
      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'test/model',
        userId: 'user-1',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.research('test');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns API_ERROR on 500', async () => {
      nock(API_BASE).post('/api/v1/chat/completions').reply(500, { error: { message: 'Server error' } });

      const { createOpenRouterClient } = await import('../client.js');
      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'test/model',
        userId: 'user-1',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.research('test');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('generate()', () => {
    it('returns generated content', async () => {
      nock(API_BASE)
        .post('/api/v1/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Generated text' } }],
          usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
        });

      const { createOpenRouterClient } = await import('../client.js');
      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'test/model',
        userId: 'user-1',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.generate('test prompt');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Generated text');
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/infra-openrouter/src/__tests__/client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement client**

`packages/infra-openrouter/src/client.ts` — Uses OpenAI SDK with baseURL override. Follow the `infra-perplexity` factory-function pattern (returns object with methods, not a class). Use `buildResearchPrompt` from `llm-prompts`, `createAuditContext` from `llm-audit`, `createUsageLogger` from `llm-pricing`. Map HTTP errors to LLMErrorCode: 401→INVALID_KEY, 429→RATE_LIMITED, 503→OVERLOADED, others→API_ERROR.

The implementation should:
- Create OpenAI client with `baseURL: 'https://openrouter.ai/api/v1'` and custom headers
- Export `createOpenRouterClient(config: OpenRouterConfig): OpenRouterClient`
- Type `OpenRouterClient = Pick<LLMClient, 'research' | 'generate'>`
- Use non-streaming JSON responses (OpenRouter supports standard OpenAI completions)
- Extract content from `choices[0].message.content`
- Extract usage from `response.usage`
- Normalize usage via `normalizeUsage()` from `costCalculator.ts`

- [ ] **Step 4: Create index.ts**

`packages/infra-openrouter/src/index.ts`:

```typescript
export { createOpenRouterClient, type OpenRouterClient } from './client.js';
export { fetchModelCatalog } from './modelCatalog.js';
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

### Task 5: API Key Storage & Validation

**Files:**
- Modify: `packages/internal-clients/src/user-service/types.ts`
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Modify: `apps/user-service/src/domain/settings/models/UserSettings.ts`
- Modify: `apps/user-service/src/routes/llmKeysRoutes.ts`
- Modify: `apps/user-service/src/routes/internalRoutes.ts`
- Modify: `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`
- Test: Update corresponding test files

- [ ] **Step 1: Update DecryptedApiKeys type**

In `packages/internal-clients/src/user-service/types.ts`, add `openrouter` field to `DecryptedApiKeys`:

```typescript
export interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
  openrouter?: string;
}
```

- [ ] **Step 2: Update providerToKeyField and getApiKeys body parsing**

In `packages/internal-clients/src/user-service/client.ts`:

1. Add case to the `providerToKeyField` switch
2. Add `openrouter` to the `getApiKeys()` response body type and null-to-undefined conversion block (around lines 93-104):

```typescript
case LlmProviders.OpenRouter:
  return 'openrouter';
```

- [ ] **Step 3: Update user-service domain model**

In `apps/user-service/src/domain/settings/models/UserSettings.ts`, add `openrouter` fields to `LlmApiKeys` and `LlmTestResults`.

- [ ] **Step 4: Update user-service routes**

In `apps/user-service/src/routes/llmKeysRoutes.ts`:
- Add `'openrouter'` to all provider enum schemas
- Add `openrouter` field to response schemas

In `apps/user-service/src/routes/internalRoutes.ts`:
- Add `openrouter` to the internal decrypted keys response

- [ ] **Step 5: Add OpenRouter key validation**

In `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`:

1. Add OpenRouter to `VALIDATION_MODELS` constant (no validation model needed — OpenRouter uses `/api/v1/key` endpoint instead)
2. Add OpenRouter to `ValidationPricing` interface
3. Add `case LlmProviders.OpenRouter` to **both** `validateKey()` AND `testRequest()`:

```typescript
// In validateKey():
case LlmProviders.OpenRouter: {
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    return err({ code: 'INVALID_KEY', message: 'Invalid OpenRouter API key' });
  }
  return ok({ valid: true });
}

// In testRequest() — use a cheap model via OpenRouter:
case LlmProviders.OpenRouter: {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
    }),
  });
  // ... handle response and return test result
}
```

- [ ] **Step 6: Update all affected tests**

Update test files for:
- `providerToKeyField('openrouter')` → returns `'openrouter'`
- Key storage routes accept `openrouter` provider
- Internal routes include `openrouter` in response
- Validator handles OpenRouter key validation

- [ ] **Step 7: Run affected workspace tests**

Run: `pnpm run verify:workspace:tracked -- user-service && pnpm run verify:workspace:tracked -- internal-clients`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add packages/internal-clients/ apps/user-service/
git commit -m "feat(user-service): add OpenRouter API key storage and validation"
```

---

### Task 6: Research Agent Adapter & Factory

**Files:**
- Create: `apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`
- Test: Update `apps/research-agent/src/__tests__/infra/llm/LlmAdapterFactory.test.ts`
- Test: Create `apps/research-agent/src/__tests__/infra/llm/OpenRouterAdapter.test.ts`

- [ ] **Step 1: Write failing adapter test**

Follow `PerplexityAdapter.test.ts` pattern. Test that:
- Constructor creates `OpenRouterClient` with correct config
- `research()` delegates to client and returns result
- Error codes are mapped correctly (INVALID_KEY, RATE_LIMITED, API_ERROR, TIMEOUT)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/research-agent/src/__tests__/infra/llm/OpenRouterAdapter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement OpenRouterAdapter**

`apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`:

```typescript
/**
 * OpenRouter adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 * Usage logging is handled by the client (packages/infra-openrouter).
 */

import { createOpenRouterClient, type OpenRouterClient } from '@intexuraos/infra-openrouter';
import type { Logger, Result } from '@intexuraos/common-core';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { getOpenRouterRawId, isOpenRouterModel } from '@intexuraos/llm-contract';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
  LlmSynthesisResult,
  SynthesisContext,
} from '../../domain/research/index.js';

export class OpenRouterAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: OpenRouterClient;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    pricing: ModelPricing,
    logger: Logger
  ) {
    // Strip or: prefix if present
    const rawModel = isOpenRouterModel(model) ? getOpenRouterRawId(model) : model;
    this.client = createOpenRouterClient({
      apiKey,
      model: rawModel,
      userId,
      pricing,
      logger,
    });
    this.model = rawModel;
    this.logger = logger;
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    this.logger.info({ model: this.model, promptLength: prompt.length }, 'OpenRouter research started');
    const result = await this.client.research(prompt);
    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'OpenRouter research failed'
      );
      return { ok: false, error };
    }
    this.logger.info(
      { model: this.model, usage: result.value.usage },
      'OpenRouter research completed'
    );
    return result;
  }

  async synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    additionalSources?: { content: string; label?: string }[],
    _synthesisContext?: SynthesisContext
  ): Promise<Result<LlmSynthesisResult, LlmError>> {
    // Build synthesis prompt from reports (same pattern as GptAdapter)
    const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports, additionalSources);
    this.logger.info({ model: this.model }, 'OpenRouter synthesis started');
    const result = await this.client.generate(synthesisPrompt);
    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code },
        'OpenRouter synthesis failed'
      );
      return { ok: false, error };
    }
    this.logger.info(
      { model: this.model, usage: result.value.usage },
      'OpenRouter synthesis completed'
    );
    return { ok: true, value: { content: result.value.content, usage: result.value.usage } };
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
```

- [ ] **Step 4: Update factory**

In `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`:
- Import `OpenRouterAdapter`
- Add `case 'openrouter':` to `createResearchProvider()`:
  ```typescript
  case 'openrouter':
    return new OpenRouterAdapter(apiKey, model, userId, pricing, logger);
  ```
- Add `case 'openrouter':` to `createSynthesizer()`:
  ```typescript
  case 'openrouter':
    return new OpenRouterAdapter(apiKey, model, userId, pricing, logger);
  ```

- [ ] **Step 5: Update factory tests**

Add OpenRouter cases to `LlmAdapterFactory.test.ts`.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run apps/research-agent/src/__tests__/infra/llm/`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add apps/research-agent/src/infra/llm/
git commit -m "feat(research-agent): add OpenRouterAdapter and factory routing"
```

---

### Task 7: Schema Relaxation & Model Catalog Endpoint

**Files:**
- Modify: `apps/research-agent/src/routes/schemas/common.ts`
- Create: `apps/research-agent/src/routes/openRouterRoutes.ts`
- Test: Schema validation tests, catalog endpoint tests

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

Add `'openrouter'` to `llmProviderSchema`:

```typescript
export const llmProviderSchema = {
  type: 'string',
  enum: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
} as const;
```

- [ ] **Step 2: Write catalog endpoint tests**

Test that `GET /research/openrouter/models` returns models when user has a key, and 404 when they don't.

- [ ] **Step 3: Implement catalog endpoint**

`apps/research-agent/src/routes/openRouterRoutes.ts` — register under `/research/openrouter/models`. Fetch user's OpenRouter API key from user-service, call `fetchModelCatalog()`, cache with 5-min TTL.

- [ ] **Step 4: Register route in research-agent app**

Wire the new route file into the Fastify app registration.

- [ ] **Step 5: Run tests**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/research-agent/src/routes/
git commit -m "feat(research-agent): relax model schema for OpenRouter and add catalog endpoint"
```

---

### Task 8: Exhaustive Switch Audit & Pricing Resolution

**Files:**
- Various files across the codebase that switch on `LlmProvider`

- [ ] **Step 1: Find all LlmProvider switches**

Run: `pnpm build 2>&1 | grep -i "not assignable\|exhaustive\|openrouter"` to find TypeScript errors from non-exhaustive switches.

- [ ] **Step 2: Fix each non-exhaustive switch**

For each file that switches on `LlmProvider`:
- Add `case 'openrouter':` with appropriate handling
- If the switch is in a context where OpenRouter doesn't apply (e.g., `llm-factory` which is Google-only), verify it already has a default/throw

- [ ] **Step 3: Add pricing resolution for OpenRouter models**

In the research-agent's LLM call processing (where `pricingContext.getPricing(model)` is called), add a guard for OpenRouter models:
- If `isOpenRouterModel(model)` → use `toModelPricing()` from `infra-openrouter` with pricing from the model catalog
- Else → existing `pricingContext.getPricing(model)` path

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS — entire monorepo builds and tests pass

- [ ] **Step 5: Commit**

Stage all files modified during the audit (use `git status` to identify them, then `git add` each specifically).

```bash
git commit -m "feat: complete OpenRouter backend integration — exhaustive switch audit and pricing resolution"
```

---

### Task 9: Design Doc Update & Final Verification

**Files:**
- Modify: `docs/plans/INT-616-design.md`

- [ ] **Step 1: Update design doc**

Add a "Phase Split" section to `docs/plans/INT-616-design.md` documenting:
- Phase A (INT-1011): Backend — completed
- Phase B (INT-1012): Frontend — pending
- The boundary: HTTP API contract between phases

- [ ] **Step 2: Final CI run**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add docs/plans/INT-616-design.md
git commit -m "docs: update OpenRouter design doc with phase split"
```

---

## Endpoint Changes

| Category     | Endpoint                                            | Change                                           |
| ------------ | --------------------------------------------------- | ------------------------------------------------ |
| **Created**  | `GET /research/openrouter/models`                   | Model catalog proxy (5-min cache)                |
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
4. Manual: call `GET /research/openrouter/models` with a test API key (via curl) → verify JSON response with model list
5. Manual: attempt `POST /research` with `selectedModels: ["or:anthropic/claude-sonnet-4"]` and a configured OpenRouter key → verify research executes
