# INT-1012: OpenRouter Frontend Integration (Phase B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose OpenRouter to users via the web app — API key settings, curated model picker with 14 frontier models, and research page integration. Zero backend changes.

**Architecture:** Add OpenRouter as a 5th provider in the existing UI. Unlike static providers (2-3 hardcoded models each), OpenRouter displays a curated allowlist of 14 models from 10 providers, fetched from `GET /research/openrouter/models` (built in Phase A). The endpoint enriches the allowlist with live pricing. Selected models use `or:` prefixed IDs in the `selectedModels` array alongside static models. Web search is enabled by the backend via the `:online` suffix — no frontend logic needed.

**Tech Stack:** React, TailwindCSS, TypeScript strict mode, `useApiClient` hook for data fetching.

**Linear:** [INT-1012](https://linear.app/pbuchman/issue/INT-1012/openrouter-frontend-integration-phase-b)
**Parent:** [INT-616](https://linear.app/pbuchman/issue/INT-616/investigate-open-router-integration-and-multi-model-selection)
**Depends on:** [INT-1011](https://linear.app/pbuchman/issue/INT-1011/openrouter-backend-infrastructure-phase-a) (Phase A — Backend)

---

## Existing Patterns (from exploration)

**Key patterns to follow:**
- `PROVIDERS` array in `ApiKeysSettingsPage.tsx` — add `{ id: 'openrouter', name: 'OpenRouter' }`
- `validateApiKeyFormat()` switch — add `case 'openrouter'` with `sk-or-` prefix validation
- `PROVIDER_MODELS` in `ModelSelector.tsx` — static providers use this; OpenRouter renders separately
- `configuredProviders` is built from `PROVIDER_MODELS.filter(p => keys[p.id] !== null)` — OpenRouter must be added separately since it's not in `PROVIDER_MODELS`
- `useLlmKeys()` hook — returns `keys` with provider fields as masked strings or `null`
- `useApiClient()` hook — `request<T>(baseUrl, path, options)` for API calls
- `getErrorMessage` — imported from `@intexuraos/common-core/errors`
- `apiRequest(baseUrl, path, accessToken, options)` — concatenates `${baseUrl}${path}` for URL

---

## File Structure

### New Files

| File                                                       | Responsibility                                 |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `apps/web/src/components/OpenRouterModelSelector.tsx`      | Curated model picker with multi-select (max 5) |
| `apps/web/src/hooks/useOpenRouterModels.ts`                | Fetch allowlist from backend                   |
| `apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts` | Hook tests (required per CLAUDE.md)            |

### Modified Files

| File                                              | Change                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web/src/pages/ApiKeysSettingsPage.tsx`      | Add OpenRouter provider with `sk-or-` key validation                       |
| `apps/web/src/components/ModelSelector.tsx`       | Add OpenRouter section with curated model picker                           |
| `apps/web/src/pages/ResearchAgentPage.tsx`        | Handle mixed static + OpenRouter model state, extend `configuredProviders` |
| `apps/web/src/pages/ResearchDetailPage.tsx`       | Extend `configuredProviders` to include OpenRouter                         |
| `apps/web/src/services/researchAgentApi.types.ts` | Add `OpenRouterModelInfo` type, update `getProviderForModel()`             |
| `apps/web/src/services/researchAgentApi.ts`       | Add `fetchOpenRouterModels()` API function                                 |
| `apps/web/src/services/llmKeysApi.types.ts`       | Add `openrouter` to `LlmKeysResponse` and `testResults`                    |

---

## Tasks

### Task 1: API Types & Service Function

**Files:**
- Modify: `apps/web/src/services/researchAgentApi.types.ts`
- Modify: `apps/web/src/services/researchAgentApi.ts`
- Modify: `apps/web/src/services/llmKeysApi.types.ts`

- [ ] **Step 1: Add openrouter to LlmKeysResponse**

In `apps/web/src/services/llmKeysApi.types.ts`, add `openrouter` fields:

```typescript
export interface LlmKeysResponse {
  defaultModel: string | null;
  google: string | null;
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  openrouter: string | null;  // NEW
  testResults: {
    google: LlmTestResult | null;
    openai: LlmTestResult | null;
    anthropic: LlmTestResult | null;
    perplexity: LlmTestResult | null;
    openrouter: LlmTestResult | null;  // NEW
  };
}
```

- [ ] **Step 2: Update getProviderForModel for OpenRouter models**

In `apps/web/src/services/researchAgentApi.types.ts`, the web `getProviderForModel()` uses a static `MODEL_TO_PROVIDER` map. Update it to handle `or:` prefixed models:

```typescript
import { isOpenRouterModel, LlmProviders } from '@intexuraos/llm-contract';

export function getProviderForModel(model: SupportedModel): LlmProvider {
  if (isOpenRouterModel(model)) {
    return LlmProviders.OpenRouter;
  }
  return MODEL_TO_PROVIDER[model as Exclude<SupportedModel, OpenRouterModelId>];
}
```

- [ ] **Step 3: Add OpenRouterModelInfo type**

In `apps/web/src/services/researchAgentApi.types.ts`:

```typescript
/** Model info from OpenRouter curated allowlist */
export interface OpenRouterModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  pricing: {
    promptPerToken: number;
    completionPerToken: number;
  };
  inputModalities: string[];
  outputModalities: string[];
}

export interface OpenRouterModelsResponse {
  models: OpenRouterModelInfo[];
  cachedAt: string;
}
```

- [ ] **Step 4: Add API function**

In `apps/web/src/services/researchAgentApi.ts`:

```typescript
export async function fetchOpenRouterModels(
  accessToken: string
): Promise<OpenRouterModelsResponse> {
  return apiRequest<OpenRouterModelsResponse>(
    config.ResearchAgentUrl,
    '/research/openrouter/models',
    accessToken
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/researchAgentApi.types.ts apps/web/src/services/researchAgentApi.ts apps/web/src/services/llmKeysApi.types.ts
git commit -m "feat(web): add OpenRouter API types, key response types, and service function"
```

---

### Task 2: useOpenRouterModels Hook

**Files:**
- Create: `apps/web/src/hooks/useOpenRouterModels.ts`
- Test: `apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts`

- [ ] **Step 1: Write failing hook tests**

Test that:
- Fetches models when `isConfigured` is true, returns model list
- Returns empty array when `isConfigured` is false, no fetch made
- Handles API errors gracefully (sets error state, returns empty array)
- Does not re-fetch on every render (uses `fetchedRef`)

Mock `useApiClient` via `vi.mock('../useApiClient.js', ...)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts`

- [ ] **Step 3: Implement hook**

`apps/web/src/hooks/useOpenRouterModels.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from './useApiClient.js';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { OpenRouterModelInfo, OpenRouterModelsResponse } from '../services/researchAgentApi.types.js';
import { config } from '../config.js';

interface UseOpenRouterModelsResult {
  models: OpenRouterModelInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOpenRouterModels(isConfigured: boolean): UseOpenRouterModelsResult {
  const { request } = useApiClient();
  const [models, setModels] = useState<OpenRouterModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchModels = useCallback(async () => {
    if (!isConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const response = await request<OpenRouterModelsResponse>(
        config.ResearchAgentUrl,
        '/research/openrouter/models'
      );
      setModels(response.models);
      fetchedRef.current = true;
    } catch (err) {
      setError(getErrorMessage(err));
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [isConfigured, request]);

  useEffect(() => {
    if (isConfigured && !fetchedRef.current) {
      void fetchModels();
    }
  }, [isConfigured, fetchModels]);

  if (!isConfigured) {
    return { models: [], loading: false, error: null, refresh: fetchModels };
  }

  return { models, loading, error, refresh: fetchModels };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useOpenRouterModels.ts apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts
git commit -m "feat(web): add useOpenRouterModels hook for model catalog fetching"
```

---

### Task 3: API Key Settings Page

**Files:**
- Modify: `apps/web/src/pages/ApiKeysSettingsPage.tsx`

- [ ] **Step 1: Add OpenRouter to PROVIDERS array**

```typescript
{ id: 'openrouter', name: 'OpenRouter' },
```

- [ ] **Step 2: Add key format validation**

In `validateApiKeyFormat()`, add case:

```typescript
case 'openrouter':
  if (!key.startsWith('sk-or-')) {
    return 'OpenRouter API key should start with "sk-or-"';
  }
  break;
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ApiKeysSettingsPage.tsx
git commit -m "feat(web): add OpenRouter to API key settings page"
```

---

### Task 4: OpenRouterModelSelector Component

**Files:**
- Create: `apps/web/src/components/OpenRouterModelSelector.tsx`

- [ ] **Step 1: Implement component**

Props: `availableModels: OpenRouterModelInfo[]`, `selectedModelIds: string[]`, `onChange: (ids: string[]) => void`, `maxModels?: number` (default 5), `loading?: boolean`, `disabled?: boolean`.

Features:
- Search input filtering by model name (case-insensitive `includes()`)
- Each model row shows: name, provider, context length, pricing (per 1M tokens: `(price * 1_000_000).toFixed(2)`)
- Checkboxes for multi-select, disabled when max reached
- Selected models as removable chips above the list
- Loading spinner, empty state
- Model IDs passed to parent are raw (without `or:` prefix) — parent adds prefix

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/OpenRouterModelSelector.tsx
git commit -m "feat(web): add OpenRouterModelSelector component with search and multi-select"
```

---

### Task 5: ModelSelector Integration

**Files:**
- Modify: `apps/web/src/components/ModelSelector.tsx`

- [ ] **Step 1: Extend ModelSelectorProps**

Add: `openRouterModels?`, `selectedOpenRouterModels?`, `onOpenRouterChange?`, `openRouterLoading?`, `isOpenRouterConfigured?`.

- [ ] **Step 2: Add OpenRouter section**

After existing provider rows, conditionally render:

```tsx
{isOpenRouterConfigured && (
  <div className="mt-4 border-t pt-4">
    <h4 className="text-sm font-medium text-gray-700 mb-2">
      OpenRouter Models
      {selectedOpenRouterModels && selectedOpenRouterModels.length > 0 && (
        <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
          {selectedOpenRouterModels.length} selected
        </span>
      )}
    </h4>
    <OpenRouterModelSelector
      availableModels={openRouterModels ?? []}
      selectedModelIds={selectedOpenRouterModels ?? []}
      onChange={onOpenRouterChange ?? (() => {})}
      loading={openRouterLoading}
      disabled={disabled}
    />
  </div>
)}
```

- [ ] **Step 3: Update getSelectedModelsList**

Include OpenRouter models with `or:` prefix using `createOpenRouterModelId()` to maintain type safety:

```typescript
import { createOpenRouterModelId } from '@intexuraos/llm-contract';

export function getSelectedModelsList(
  selections: Map<LlmProvider, SupportedModel | null>,
  openRouterModelIds?: string[]
): SupportedModel[] {
  const staticModels = Array.from(selections.values()).filter(
    (m): m is SupportedModel => m !== null
  );
  const orModels: SupportedModel[] = (openRouterModelIds ?? []).map(
    (id) => createOpenRouterModelId(id)
  );
  return [...staticModels, ...orModels];
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ModelSelector.tsx apps/web/src/components/OpenRouterModelSelector.tsx
git commit -m "feat(web): integrate OpenRouterModelSelector into ModelSelector"
```

---

### Task 6: ResearchAgentPage & ResearchDetailPage Integration

**Files:**
- Modify: `apps/web/src/pages/ResearchAgentPage.tsx`
- Modify: `apps/web/src/pages/ResearchDetailPage.tsx`

- [ ] **Step 1: Add OpenRouter state**

```typescript
const [selectedOpenRouterModels, setSelectedOpenRouterModels] = useState<string[]>([]);
```

- [ ] **Step 2: Wire useOpenRouterModels hook**

```typescript
const isOpenRouterConfigured = keys !== null && keys.openrouter !== null;
const { models: openRouterModels, loading: openRouterLoading } = useOpenRouterModels(isOpenRouterConfigured);
```

- [ ] **Step 3: Extend configuredProviders to include OpenRouter**

Both `ResearchAgentPage.tsx` and `ResearchDetailPage.tsx` build `configuredProviders` from `PROVIDER_MODELS.filter(...)`. Since OpenRouter is NOT in `PROVIDER_MODELS`, add it manually:

```typescript
const configuredProviders: LlmProvider[] =
  keysLoading || keys === null
    ? []
    : [
        ...PROVIDER_MODELS.filter((p) => keys[p.id] !== null).map((p) => p.id),
        ...(keys.openrouter !== null ? ['openrouter' as LlmProvider] : []),
      ];
```

- [ ] **Step 4: Pass props to ModelSelector**

```tsx
<ModelSelector
  // ... existing props ...
  openRouterModels={openRouterModels}
  selectedOpenRouterModels={selectedOpenRouterModels}
  onOpenRouterChange={setSelectedOpenRouterModels}
  openRouterLoading={openRouterLoading}
  isOpenRouterConfigured={isOpenRouterConfigured}
/>
```

- [ ] **Step 5: Update submission to include OpenRouter models**

Where `getSelectedModelsList()` is called, pass `selectedOpenRouterModels`:

```typescript
const allModels = getSelectedModelsList(modelSelections, selectedOpenRouterModels);
```

- [ ] **Step 6: Update autosave to track OpenRouter model changes**

Include `selectedOpenRouterModels` in the change-detection logic for autosave.

- [ ] **Step 7: Handle edit mode (loading from draft)**

When loading a draft with `or:` prefixed models, extract them:

```typescript
const orModels = draft.selectedModels
  .filter((m) => m.startsWith('or:'))
  .map((m) => m.slice(3));
setSelectedOpenRouterModels(orModels);
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/ResearchAgentPage.tsx apps/web/src/pages/ResearchDetailPage.tsx
git commit -m "feat(web): integrate OpenRouter model selection into research pages"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 2: Manual end-to-end test**

1. Configure OpenRouter API key → verify stored and validated
2. Open research page → verify 14 curated models load
3. Select up to 5 models → verify max enforced
4. Create research with mixed static + OpenRouter models → verify results display
5. Save as draft → verify OpenRouter models persist
6. Load draft → verify OpenRouter models restored

- [ ] **Step 3: Final commit**

Stage all modified files by name.

```bash
git commit -m "feat(web): complete OpenRouter frontend integration"
```

---

## Verification

1. `pnpm run ci:tracked` — all tests pass
2. Hook tests pass with full coverage for `useOpenRouterModels`
3. Manual: configure API key, select models, run research, verify results
4. Manual: draft save/load preserves OpenRouter model selections
5. Manual: verify existing (non-OpenRouter) research flow is unchanged
