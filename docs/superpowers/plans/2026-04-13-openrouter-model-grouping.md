# OpenRouter Model Grouping in LLM Usage Reports

> Supersession note (2026-07-04): Active OpenRouter display-name mappings now use MiniMax M3. Any MiniMax M2.7 references below are historical plan content only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "OpenRouter Model" as a new group-by option on the LLM Usage page, showing a breakdown per OpenRouter model with friendly names from the allowlist.

**Architecture:** The existing backend aggregate query already supports `request.model` grouping and `providers` filtering. The change is purely frontend — add a new "OpenRouter Model" group-by mode that sends `['request.provider', 'request.model']` as the group-by with a pre-applied `providers: ['openrouter']` filter, then displays the model names using a local friendly-name mapping derived from the OpenRouter allowlist.

**Tech Stack:** React, TypeScript, TailwindCSS, existing `useLlmUsageQuery` hook

---

## File Structure

| File                                                        | Action   | Purpose                                 |
| ----------------------------------------------------------- | -------- | --------------------------------------- |
| `apps/web/src/utils/openRouterModelNames.ts`                | Create   | Static model ID → friendly name mapping |
| `apps/web/src/utils/__tests__/openRouterModelNames.test.ts` | Create   | Tests for the name resolver             |
| `apps/web/src/pages/LlmUsagePage.tsx`                       | Modify   | Add `openrouter-model` group-by mode    |

## Key Design Decisions

1. **No backend changes needed** — The backend already supports `groupBy: ['request.provider', 'request.model']` and `filters.providers: ['openrouter']`. We just wire these from the frontend.

2. **Local friendly-name mapping** — `@intexuraos/infra-openrouter` has a heavy `openai` dependency unsuitable for the web bundle. Instead, a small `openRouterModelNames.ts` utility mirrors the allowlist's model ID → name mapping as a static `Record<string, string>`, kept in sync with `packages/infra-openrouter/src/allowlist.ts`. Models not in the mapping display their raw ID.

3. **New `GroupByMode` value** — `'openrouter-model'` is added to the union type. When selected, it sends `['request.provider', 'request.model']` to the API and auto-applies `providers: ['openrouter']` filter.

---

### Task 1: Create OpenRouter model name mapping utility

**Files:**
- Create: `apps/web/src/utils/openRouterModelNames.ts`
- Create: `apps/web/src/utils/__tests__/openRouterModelNames.test.ts`

- [ ] **Step 1: Create the model name mapping utility**

Create `apps/web/src/utils/openRouterModelNames.ts`:

```typescript
/**
 * Static mapping of OpenRouter model IDs to human-readable names.
 *
 * Mirrors the curated allowlist in packages/infra-openrouter/src/allowlist.ts.
 * When a model ID is not found in this mapping, the raw ID is returned as-is.
 */

const OPENROUTER_MODEL_NAMES: Record<string, string> = {
  'qwen/qwen3.5-plus-02-15': 'Qwen 3.5 Plus',
  'qwen/qwen3.5-flash-02-23': 'Qwen 3.5 Flash',
  'minimax/minimax-m2.7': 'MiniMax M2.7',
  'x-ai/grok-4.20-beta': 'Grok 4.20 Beta',
  'x-ai/grok-4.1-fast': 'Grok 4.1 Fast',
  'moonshotai/kimi-k2.5': 'Kimi K2.5',
  'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'anthropic/claude-opus-4.6': 'Claude Opus 4.6',
  'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'openai/gpt-5.4': 'GPT-5.4',
  'openai/gpt-5.4-mini': 'GPT-5.4 Mini',
  'xiaomi/mimo-v2.5-pro': 'MiMo V2.5 Pro',
  'z-ai/glm-5-turbo': 'GLM 5 Turbo',
};

/**
 * Resolve an OpenRouter model ID to its human-readable name.
 * Returns the raw model ID if no friendly name is found.
 */
export function resolveOpenRouterModelName(modelId: string): string {
  return OPENROUTER_MODEL_NAMES[modelId] ?? modelId;
}
```

- [ ] **Step 2: Write tests for the name resolver**

Create `apps/web/src/utils/__tests__/openRouterModelNames.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveOpenRouterModelName } from '../openRouterModelNames.js';

describe('resolveOpenRouterModelName', () => {
  it('returns friendly name for known models', () => {
    expect(resolveOpenRouterModelName('anthropic/claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
    expect(resolveOpenRouterModelName('openai/gpt-5.4')).toBe('GPT-5.4');
    expect(resolveOpenRouterModelName('qwen/qwen3.5-plus-02-15')).toBe('Qwen 3.5 Plus');
    expect(resolveOpenRouterModelName('xiaomi/mimo-v2.5-pro')).toBe('MiMo V2.5 Pro');
  });

  it('returns raw ID for unknown models', () => {
    expect(resolveOpenRouterModelName('some/unknown-model')).toBe('some/unknown-model');
  });

  it('handles empty string', () => {
    expect(resolveOpenRouterModelName('')).toBe('');
  });
});
```

- [ ] **Step 3: Run tests to verify**

```bash
cd /repo && pnpm vitest run apps/web/src/utils/__tests__/openRouterModelNames.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/utils/openRouterModelNames.ts apps/web/src/utils/__tests__/openRouterModelNames.test.ts
git commit -m "feat: add OpenRouter model name mapping utility

Static mapping of OpenRouter model IDs to friendly names, mirroring
the allowlist in packages/infra-openrouter/src/allowlist.ts.

Fixes INT-1366"
```

---

### Task 2: Add `openrouter-model` group-by mode to LlmUsagePage

**Files:**
- Modify: `apps/web/src/pages/LlmUsagePage.tsx`

- [ ] **Step 1: Import the model name resolver**

Add import at the top of the file (after the existing imports):

```typescript
import { resolveOpenRouterModelName } from '@/utils/openRouterModelNames';
```

- [ ] **Step 2: Add `openrouter-model` to GroupByMode type**

Change line 18 from:
```typescript
type GroupByMode = 'none' | 'day' | 'component' | 'service' | 'model';
```
to:
```typescript
type GroupByMode = 'none' | 'day' | 'component' | 'service' | 'model' | 'openrouter-model';
```

- [ ] **Step 3: Add `openrouter-model` to GROUP_BY_MAP**

Add new entry to the map:
```typescript
const GROUP_BY_MAP: Record<GroupByMode, string[]> = {
  none: [],
  day: ['day'],
  component: ['source.component'],
  service: ['source.service'],
  model: ['request.model'],
  'openrouter-model': ['request.provider', 'request.model'],
};
```

- [ ] **Step 4: Add `openrouter-model` to GROUP_BY_OPTIONS**

Add the new option to the array:
```typescript
const GROUP_BY_OPTIONS: { key: GroupByMode; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'day', label: 'Day' },
  { key: 'component', label: 'Component' },
  { key: 'service', label: 'Service' },
  { key: 'model', label: 'Model' },
  { key: 'openrouter-model', label: 'OpenRouter Model' },
];
```

- [ ] **Step 5: Update `isGroupByMode` validator**

Add `'openrouter-model'` to the accepted values:
```typescript
function isGroupByMode(v: unknown): v is GroupByMode {
  return typeof v === 'string' && ['none', 'day', 'component', 'service', 'model', 'openrouter-model'].includes(v);
}
```

- [ ] **Step 6: Update `getGroupLabel` to handle openrouter-model**

Modify the `getGroupLabel` function to handle the multi-field grouping for `openrouter-model`:

```typescript
function getGroupLabel(row: UsageQueryRow, groupBy: GroupByMode): string {
  if (groupBy === 'openrouter-model') {
    const modelId = row.group['request.model'];
    if (typeof modelId === 'string') return resolveOpenRouterModelName(modelId);
    return 'Unknown';
  }
  const key = GROUP_BY_MAP[groupBy][0];
  if (key === undefined) return 'Unknown';
  const value = row.group[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return 'Unknown';
}
```

- [ ] **Step 7: Auto-apply openrouter provider filter when openrouter-model is selected**

In the `LlmUsagePage` component, add a `useMemo` to inject the `providers: ['openrouter']` filter when `groupBy` is `openrouter-model`. Insert before the `queryResult` hook call:

```typescript
  // Auto-apply openrouter filter when grouping by openrouter model
  const effectiveFilters = useMemo(() => {
    if (groupBy === 'openrouter-model') {
      return { ...filters, providers: ['openrouter'] };
    }
    return filters;
  }, [groupBy, filters]);

  // Aggregate query hook (active when groupBy !== 'none')
  const queryGroupBy = GROUP_BY_MAP[groupBy];
  const queryResult = useLlmUsageQuery({
    timeRange: resolvedTimeRange,
    filters: effectiveFilters,
    groupBy: queryGroupBy,
    enabled: !isRawMode && !isCustomIncomplete,
  });
```

- [ ] **Step 8: Add `useMemo` import if not already present**

Verify that `useMemo` is in the React import on line 5. It should already be there from the existing code:
```typescript
import { useCallback, useEffect, useMemo, useState } from 'react';
```

- [ ] **Step 9: Run workspace verification**

```bash
cd /repo && pnpm run verify:workspace:tracked -- web
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/LlmUsagePage.tsx
git commit -m "feat: add OpenRouter Model group-by option to LLM usage page

Adds 'OpenRouter Model' as a new group-by mode that auto-applies the
openrouter provider filter and displays friendly model names from the
allowlist mapping.

Fixes INT-1366"
```

---

### Task 3: Run full CI verification

- [ ] **Step 1: Run full tracked CI**

```bash
cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-llm-openrouter-grouping.txt
```

Expected: all workspaces pass

- [ ] **Step 2: Verify no errors in output**

```bash
rg "error|FAIL" /tmp/ci-output-llm-openrouter-grouping.txt -C3
```

Expected: no matches
