# INT-1012: OpenRouter Frontend Integration (Phase B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose OpenRouter to users via the web app — API key settings, dynamic model picker with search/filter/multi-select, and research page integration. Zero backend changes.

**Architecture:** Add OpenRouter as a 5th provider in the existing UI. Unlike static providers (2-3 hardcoded models each), OpenRouter uses a dynamic model catalog fetched from `GET /research/openrouter/models` (built in Phase A). A new `OpenRouterModelSelector` component handles search, category filtering, and multi-select (max 5). Selected models use `or:` prefixed IDs in the `selectedModels` array alongside static models.

**Tech Stack:** React, TailwindCSS, TypeScript strict mode, `useApiClient` hook for data fetching.

**Linear:** [INT-1012](https://linear.app/pbuchman/issue/INT-1012/openrouter-frontend-integration-phase-b)
**Parent:** [INT-616](https://linear.app/pbuchman/issue/INT-616/investigate-open-router-integration-and-multi-model-selection)
**Depends on:** [INT-1011](https://linear.app/pbuchman/issue/INT-1011/openrouter-backend-infrastructure-phase-a) (Phase A — Backend)

---

## File Structure

### New Files

| File                                                       | Responsibility                                   |
| ---------------------------------------------------------- | ------------------------------------------------ |
| `apps/web/src/components/OpenRouterModelSelector.tsx`      | Searchable, filterable multi-select model picker |
| `apps/web/src/hooks/useOpenRouterModels.ts`                | Fetch and cache model catalog from backend       |
| `apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts` | Hook tests (required per CLAUDE.md)              |

### Modified Files

| File                                              | Change                                               |
| ------------------------------------------------- | ---------------------------------------------------- |
| `apps/web/src/pages/ApiKeysSettingsPage.tsx`      | Add OpenRouter provider with `sk-or-` key validation |
| `apps/web/src/components/ModelSelector.tsx`       | Add OpenRouter section with dynamic model picker     |
| `apps/web/src/pages/ResearchAgentPage.tsx`        | Handle mixed static + OpenRouter model state         |
| `apps/web/src/pages/ResearchDetailPage.tsx`       | Extend configuredProviders to include OpenRouter     |
| `apps/web/src/services/researchAgentApi.types.ts` | Add `OpenRouterModelInfo` type, extend model types   |
| `apps/web/src/services/researchAgentApi.ts`       | Add `fetchOpenRouterModels()` API function           |

---

## Existing Patterns (from exploration)

**Key patterns to follow:**
- `PROVIDERS` array in `ApiKeysSettingsPage.tsx` — add OpenRouter entry with `{ id: 'openrouter', name: 'OpenRouter' }`
- `validateApiKeyFormat()` switch — add `case 'openrouter'` with `sk-or-` prefix validation
- `PROVIDER_MODELS` array in `ModelSelector.tsx` — static providers use this; OpenRouter section renders separately
- `useLlmKeys()` hook — already returns `keys` with provider fields; backend Phase A added `openrouter`
- `useApiClient()` hook — `request<T>(baseUrl, path, options)` for API calls
- `Map<LlmProvider, SupportedModel | null>` — model selection state in `ResearchAgentPage`
- `getSelectedModelsList()` — extracts non-null models from Map for submission

---

## Tasks

### Task 1: API Types & Service Function

**Files:**
- Modify: `apps/web/src/services/researchAgentApi.types.ts`
- Modify: `apps/web/src/services/researchAgentApi.ts`

- [ ] **Step 1: Add OpenRouterModelInfo type**

In `apps/web/src/services/researchAgentApi.types.ts`:

```typescript
/** Model info from OpenRouter catalog API */
export interface OpenRouterModelInfo {
  /** Model ID (e.g., 'anthropic/claude-sonnet-4') — without or: prefix */
  id: string;
  /** Display name (e.g., 'Anthropic: Claude Sonnet 4') */
  name: string;
  /** Maximum context length in tokens */
  contextLength: number;
  /** Pricing per token */
  pricing: {
    promptPerToken: number;
    completionPerToken: number;
  };
  /** Input modalities (e.g., ['text', 'image']) */
  inputModalities: string[];
  /** Output modalities (e.g., ['text']) */
  outputModalities: string[];
}

/** Response from GET /research/openrouter/models */
export interface OpenRouterModelsResponse {
  models: OpenRouterModelInfo[];
  cachedAt: string;
}
```

- [ ] **Step 2: Add API function**

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

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/
git commit -m "feat(web): add OpenRouter model catalog API types and service function"
```

---

### Task 2: useOpenRouterModels Hook

**Files:**
- Create: `apps/web/src/hooks/useOpenRouterModels.ts`
- Test: `apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts`

- [ ] **Step 1: Write failing hook tests**

`apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOpenRouterModels } from '../useOpenRouterModels.js';

// Mock useApiClient
const mockRequest = vi.fn();
vi.mock('../useApiClient.js', () => ({
  useApiClient: () => ({ request: mockRequest, isAuthenticated: true }),
}));

describe('useOpenRouterModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches models when OpenRouter key is configured', async () => {
    mockRequest.mockResolvedValueOnce({
      models: [
        {
          id: 'anthropic/claude-sonnet-4',
          name: 'Claude Sonnet 4',
          contextLength: 200000,
          pricing: { promptPerToken: 0.000003, completionPerToken: 0.000015 },
          inputModalities: ['text'],
          outputModalities: ['text'],
        },
      ],
      cachedAt: '2026-03-19T00:00:00Z',
    });

    const { result } = renderHook(() => useOpenRouterModels(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0]?.id).toBe('anthropic/claude-sonnet-4');
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when no OpenRouter key configured', () => {
    const { result } = renderHook(() => useOpenRouterModels(false));

    expect(result.current.models).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('handles API error gracefully', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useOpenRouterModels(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.models).toEqual([]);
    expect(result.current.error).toBe('Network error');
  });

  it('does not re-fetch on every render', async () => {
    mockRequest.mockResolvedValueOnce({ models: [], cachedAt: '' });

    const { result, rerender } = renderHook(() => useOpenRouterModels(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender();
    rerender();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/src/hooks/__tests__/useOpenRouterModels.test.ts`
Expected: FAIL — module not found

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

/**
 * Fetch OpenRouter model catalog. Only fetches when `isConfigured` is true.
 * Caches results — re-fetch via `refresh()`.
 */
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
const PROVIDERS: ProviderConfig[] = [
  { id: 'google', name: 'Google (Gemini)' },
  { id: 'openai', name: 'OpenAI (GPT)' },
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'perplexity', name: 'Perplexity (Sonar)' },
  { id: 'openrouter', name: 'OpenRouter' },
];
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

- [ ] **Step 3: Verify manually in dev**

Run: `pnpm --filter web dev`
Navigate to settings page, verify OpenRouter provider row appears.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ApiKeysSettingsPage.tsx
git commit -m "feat(web): add OpenRouter to API key settings page"
```

---

### Task 4: OpenRouterModelSelector Component

**Files:**
- Create: `apps/web/src/components/OpenRouterModelSelector.tsx`

- [ ] **Step 1: Implement component**

`apps/web/src/components/OpenRouterModelSelector.tsx`:

The component should:
- Accept props: `availableModels: OpenRouterModelInfo[]`, `selectedModelIds: string[]`, `onChange: (ids: string[]) => void`, `maxModels?: number` (default 5), `loading?: boolean`, `disabled?: boolean`
- Render a search input that filters models by name
- Show a scrollable list of models with checkboxes
- Each model row shows: name, context length, pricing (input/output per 1M tokens)
- Disable further selection when max reached (show message)
- Show selected models as removable chips/tags above the list
- Use TailwindCSS classes consistent with existing UI patterns
- Handle loading state with spinner
- Handle empty state (no models found / no search results)

Key implementation details:
- Format pricing: convert per-token to per-million for display (`(price * 1_000_000).toFixed(2)`)
- Search: case-insensitive `includes()` on `model.name`
- Selection: toggle model ID in/out of `selectedModelIds` array
- Model IDs passed to parent are raw (without `or:` prefix) — the parent adds the prefix

- [ ] **Step 2: Verify in Storybook or dev**

Manually check rendering with mock data.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/OpenRouterModelSelector.tsx
git commit -m "feat(web): add OpenRouterModelSelector component with search and multi-select"
```

---

### Task 5: ModelSelector Integration

**Files:**
- Modify: `apps/web/src/components/ModelSelector.tsx`

- [ ] **Step 1: Extend ModelSelectorProps**

Add new props:

```typescript
interface ModelSelectorProps {
  // ... existing props ...
  /** OpenRouter models from catalog API */
  openRouterModels?: OpenRouterModelInfo[];
  /** Currently selected OpenRouter model IDs (without or: prefix) */
  selectedOpenRouterModels?: string[];
  /** Callback when OpenRouter selection changes */
  onOpenRouterChange?: (modelIds: string[]) => void;
  /** Whether OpenRouter models are loading */
  openRouterLoading?: boolean;
}
```

- [ ] **Step 2: Add OpenRouter section**

After the existing provider rows, conditionally render the OpenRouter section:

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

Extend the helper to include OpenRouter models with `or:` prefix:

```typescript
export function getSelectedModelsList(
  selections: Map<LlmProvider, SupportedModel | null>,
  openRouterModelIds?: string[]
): SupportedModel[] {
  const staticModels = Array.from(selections.values()).filter(
    (m): m is SupportedModel => m !== null
  );
  const orModels = (openRouterModelIds ?? []).map(
    (id) => `or:${id}` as SupportedModel
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

### Task 6: ResearchAgentPage Integration

**Files:**
- Modify: `apps/web/src/pages/ResearchAgentPage.tsx`

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

Both `ResearchAgentPage.tsx` and `ResearchDetailPage.tsx` build `configuredProviders` from `PROVIDER_MODELS.filter(...)`. Since OpenRouter is NOT in `PROVIDER_MODELS` (it's dynamic, not static), add OpenRouter manually:

```typescript
const configuredProviders: LlmProvider[] =
  keysLoading || keys === null
    ? []
    : [
        ...PROVIDER_MODELS.filter((p) => keys[p.id] !== null).map((p) => p.id),
        ...(keys.openrouter !== null ? ['openrouter' as LlmProvider] : []),
      ];
```

Apply the same pattern in `ResearchDetailPage.tsx`.

- [ ] **Step 4: Pass props to ModelSelector**

```tsx
<ModelSelector
  // ... existing props ...
  openRouterModels={openRouterModels}
  selectedOpenRouterModels={selectedOpenRouterModels}
  onOpenRouterChange={setSelectedOpenRouterModels}
  openRouterLoading={openRouterLoading}
/>
```

- [ ] **Step 4: Update submission to include OpenRouter models**

Where `getSelectedModelsList()` is called, pass `selectedOpenRouterModels`:

```typescript
const allModels = getSelectedModelsList(modelSelections, selectedOpenRouterModels);
```

- [ ] **Step 5: Update autosave to track OpenRouter model changes**

Include `selectedOpenRouterModels` in the change-detection logic for autosave.

- [ ] **Step 6: Handle edit mode (loading from draft)**

When loading a draft that contains `or:` prefixed models, extract them into `selectedOpenRouterModels` state:

```typescript
const orModels = draft.selectedModels
  .filter((m) => m.startsWith('or:'))
  .map((m) => m.slice(3));
setSelectedOpenRouterModels(orModels);
```

- [ ] **Step 7: Verify end-to-end in dev**

Run: `pnpm --filter web dev`
1. Configure OpenRouter API key in settings
2. Open new research page
3. Verify OpenRouter section appears with models
4. Select models, submit research
5. Verify `or:` prefixed models in request payload (browser DevTools)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/ResearchAgentPage.tsx
git commit -m "feat(web): integrate OpenRouter model selection into research page"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 2: Manual end-to-end test**

1. Configure OpenRouter API key → verify stored and validated
2. Open research page → verify model catalog loads
3. Search for a model → verify filtering works
4. Select 5 models → verify max enforced
5. Create research with mixed static + OpenRouter models → verify results display
6. Save as draft → verify OpenRouter models persist
7. Load draft → verify OpenRouter models restored

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(web): complete OpenRouter frontend integration"
```

---

## Verification

1. `pnpm run ci:tracked` — all tests pass
2. Hook tests pass with full coverage for `useOpenRouterModels`
3. Manual: configure API key, search/select models, run research, verify results
4. Manual: draft save/load preserves OpenRouter model selections
5. Manual: verify existing (non-OpenRouter) research flow is unchanged
