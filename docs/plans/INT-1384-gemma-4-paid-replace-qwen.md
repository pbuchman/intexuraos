# Gemma 4 Paid Model: Replace Qwen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paid Gemma 4 (`google/gemma-4-31b-it`) as a supported model for both user default model selection and orchestrator worker type, replacing all Qwen references.

**Architecture:** The change replaces `qwen` worker type (DashScope API) with `gemma-4` (OpenRouter API) across the worker type enum, orchestrator config, web UI labels, and default/curated model allowlists. The existing free Gemma 4 (`google/gemma-4-31b-it:free`) remains unchanged as the `openrouter-free` worker.

**Tech Stack:** TypeScript, Fastify, Vitest, React (web app)

---

## File Map

| File                                                        | Action   | Responsibility                                                                                                             |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/common-core/src/codeTaskWorkerTypes.ts`           | Modify   | Replace `'qwen'` with `'gemma-4'` in worker types array                                                                    |
| `packages/llm-contract/src/supportedModels.ts`              | Modify   | Replace Qwen entry with paid Gemma 4 in `DEFAULT_OPENROUTER_MODELS`                                                        |
| `packages/infra-openrouter/src/defaultAllowlist.ts`         | Modify   | Replace Qwen entry with paid Gemma 4 in `DEFAULT_OPENROUTER_ALLOWED_MODELS`                                                |
| `packages/infra-openrouter/src/allowlist.ts`                | Modify   | Replace 2 Qwen entries with 1 Gemma 4 paid entry; update `OPENROUTER_VALIDATION_MODEL`; update count comment from 14 to 13 |
| `workers/orchestrator/src/services/isolation/types.ts`      | Modify   | Replace `qwen` worker config with `gemma-4` using OpenRouter API                                                           |
| `apps/web/src/components/workers/shared.tsx`                | Modify   | Replace `qwen` metadata with `'gemma-4'`; update `openrouter-free` description                                             |
| `apps/web/src/components/code-tasks/shared.tsx`             | Modify   | Replace `qwen: 'Qwen'` with `'gemma-4': 'Gemma 4'`                                                                         |
| `apps/web/src/utils/openRouterModelNames.ts`                | Modify   | Remove Qwen display name entries (Gemma 4 entry already exists)                                                            |
| `apps/web/src/utils/__tests__/openRouterModelNames.test.ts` | Modify   | Remove Qwen test cases, add paid Gemma 4 test                                                                              |
| `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`           | Modify   | Update worker type button reference from `'Qwen'` to `'Gemma 4'`                                                           |

## Key Facts

- **Paid Gemma 4 model ID:** `google/gemma-4-31b-it` (no `:free` suffix)
- **Free Gemma 4 model ID:** `google/gemma-4-31b-it:free` (unchanged, stays as `openrouter-free` worker)
- **Paid pricing (OpenRouter):** prompt `$0.00000013/token`, completion `$0.00000038/token`
- **Context length:** 262,144 tokens
- **API:** OpenRouter (`https://openrouter.ai/api`), uses `OPENROUTER_API_KEY`
- **Runtime:** `claude` (Anthropic-compatible, same as existing OpenRouter worker)
- **Curated allowlist:** Goes from 14 models (10 providers) to 13 models (9 providers) since 2 Qwen entries are replaced by 1 Gemma 4

---

### Task 1: Update Worker Types Enum

**Files:**
- Modify: `packages/common-core/src/codeTaskWorkerTypes.ts`

- [ ] **Step 1: Replace `'qwen'` with `'gemma-4'` in the worker types array**

In `packages/common-core/src/codeTaskWorkerTypes.ts`, change line 8:

```typescript
// Before:
  'qwen',
// After:
  'gemma-4',
```

The full array becomes:
```typescript
export const CODE_TASK_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
  'minimax',
  'mimo-pro',
  'glm',
  'gemma-4',
  'kimi',
  'codex',
  'codex-xhigh',
  'openrouter-free',
] as const;
```

- [ ] **Step 2: Build the package to verify no type errors**

Run: `pnpm --filter @intexuraos/common-core build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/common-core/src/codeTaskWorkerTypes.ts
git commit -m "feat: replace qwen worker type with gemma-4 in common-core enum"
```

---

### Task 2: Update Default OpenRouter Models (User Model Selection)

**Files:**
- Modify: `packages/llm-contract/src/supportedModels.ts`

- [ ] **Step 1: Replace Qwen entry with paid Gemma 4 in `DEFAULT_OPENROUTER_MODELS`**

In `packages/llm-contract/src/supportedModels.ts`, replace line 263:

```typescript
// Before:
  { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus', provider: 'Qwen' },
// After:
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B IT', provider: 'Google' },
```

Note: The free version (`google/gemma-4-31b-it:free`) is on line 261. Both free and paid Gemma 4 will now be in the default list, which is correct — they serve different purposes (free tier vs paid with better rate limits/priority).

- [ ] **Step 2: Build the package**

Run: `pnpm --filter @intexuraos/llm-contract build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/llm-contract/src/supportedModels.ts
git commit -m "feat: replace qwen with paid gemma-4 in default OpenRouter models"
```

---

### Task 3: Update Default Allowlist (Pricing)

**Files:**
- Modify: `packages/infra-openrouter/src/defaultAllowlist.ts`

- [ ] **Step 1: Replace Qwen entry with paid Gemma 4 in `DEFAULT_OPENROUTER_ALLOWED_MODELS`**

In `packages/infra-openrouter/src/defaultAllowlist.ts`, replace lines 45-51:

```typescript
// Before:
  {
    id: 'qwen/qwen3.6-plus',
    name: 'Qwen 3.6 Plus',
    provider: 'Qwen',
    promptPerToken: '0.00000026',
    completionPerToken: '0.00000156',
  },
// After:
  {
    id: 'google/gemma-4-31b-it',
    name: 'Gemma 4 31B IT',
    provider: 'Google',
    promptPerToken: '0.00000013',
    completionPerToken: '0.00000038',
  },
```

- [ ] **Step 2: Build the package**

Run: `pnpm --filter @intexuraos/infra-openrouter build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/infra-openrouter/src/defaultAllowlist.ts
git commit -m "feat: replace qwen with paid gemma-4 in default allowlist with pricing"
```

---

### Task 4: Update Curated Allowlist and Validation Model

**Files:**
- Modify: `packages/infra-openrouter/src/allowlist.ts`

- [ ] **Step 1: Replace 2 Qwen entries with 1 Gemma 4 paid entry**

In `packages/infra-openrouter/src/allowlist.ts`, replace lines 40-56 (both Qwen entries):

```typescript
// Before:
  // Qwen
  {
    id: 'qwen/qwen3.5-plus-02-15',
    name: 'Qwen 3.5 Plus',
    provider: 'Qwen',
    contextLength: 1_000_000,
    promptPerToken: '0.00000026',
    completionPerToken: '0.00000156',
  },
  {
    id: 'qwen/qwen3.5-flash-02-23',
    name: 'Qwen 3.5 Flash',
    provider: 'Qwen',
    contextLength: 1_000_000,
    promptPerToken: '0.00000007',
    completionPerToken: '0.00000026',
  },
// After:
  // Google (Gemma)
  {
    id: 'google/gemma-4-31b-it',
    name: 'Gemma 4 31B IT',
    provider: 'Google',
    contextLength: 262_144,
    promptPerToken: '0.00000013',
    completionPerToken: '0.00000038',
  },
```

- [ ] **Step 2: Update the model count comment**

Update both JSDoc comments at lines 1 and 36-37:

```typescript
// Line 1 area:
// Before: "Curated allowlist of 14 frontier models from 10 providers."
// After:  "Curated allowlist of 13 frontier models from 9 providers."

// Line 36-37:
// Before: "Curated allowlist of 14 frontier models from 10 providers."
// After:  "Curated allowlist of 13 frontier models from 9 providers."
```

- [ ] **Step 3: Update `OPENROUTER_VALIDATION_MODEL`**

Replace line 186:

```typescript
// Before:
export const OPENROUTER_VALIDATION_MODEL = 'qwen/qwen3.5-flash-02-23' as const;
// After:
export const OPENROUTER_VALIDATION_MODEL = 'google/gemma-4-31b-it' as const;
```

- [ ] **Step 4: Build and run existing tests**

Run: `pnpm --filter @intexuraos/infra-openrouter build && pnpm --filter @intexuraos/infra-openrouter test`
Expected: Build and tests pass. If any test references Qwen model IDs, update them.

- [ ] **Step 5: Commit**

```bash
git add packages/infra-openrouter/src/allowlist.ts
git commit -m "feat: replace qwen entries with gemma-4 paid in curated allowlist"
```

---

### Task 5: Update Orchestrator Worker Type Config

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/types.ts`

- [ ] **Step 1: Replace `qwen` worker config with `gemma-4`**

In `workers/orchestrator/src/services/isolation/types.ts`, replace lines 78-83:

```typescript
// Before:
  qwen: {
    runtime: 'claude',
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'qwen3.5-plus',
  },
// After:
  'gemma-4': {
    runtime: 'claude',
    apiBaseUrl: 'https://openrouter.ai/api',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    model: 'google/gemma-4-31b-it',
    effort: 'high',
  },
```

Key differences from the old `qwen` config:
- Uses OpenRouter API instead of DashScope
- Uses `OPENROUTER_API_KEY` instead of `DASHSCOPE_API_KEY`
- Includes `effort: 'high'` (matches the existing `openrouter-free` pattern)
- Model ID uses OpenRouter format (`google/gemma-4-31b-it`)

- [ ] **Step 2: Verify `OPENROUTER_API_KEY` is already in `WorkerSecrets`**

Check that `WorkerSecrets` interface (line ~110) already includes `OPENROUTER_API_KEY`. It does — no change needed. `DASHSCOPE_API_KEY` stays because `glm` and `kimi` workers still use it.

- [ ] **Step 3: Build the orchestrator**

Run: `pnpm --filter orchestrator build`
Expected: Clean build. The `WORKER_TYPES` record is typed against `CodeTaskWorkerType`, so it must include `'gemma-4'` (from Task 1) and must NOT include `'qwen'`.

- [ ] **Step 4: Run orchestrator tests**

Run: `pnpm --filter orchestrator test`
Expected: All tests pass. If any test references `qwen` worker type, update to `gemma-4`.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/isolation/types.ts
git commit -m "feat: replace qwen worker with gemma-4 in orchestrator config"
```

---

### Task 6: Update Web App UI Labels and Display Names

**Files:**
- Modify: `apps/web/src/components/workers/shared.tsx`
- Modify: `apps/web/src/components/code-tasks/shared.tsx`
- Modify: `apps/web/src/utils/openRouterModelNames.ts`

- [ ] **Step 1: Update `WORKER_TYPE_METADATA` in `apps/web/src/components/workers/shared.tsx`**

Replace line 10:
```typescript
// Before:
  qwen: { name: 'Qwen', description: 'Advanced Qwen model with thinking enabled' },
// After:
  'gemma-4': { name: 'Gemma 4', description: 'Google Gemma 4 31B via OpenRouter with paid-tier priority' },
```

Also update line 14 (openrouter-free description references Qwen):
```typescript
// Before:
  'openrouter-free': { name: 'OpenRouter Free', description: 'Free-tier model via OpenRouter (Qwen 3.6 Plus) with zero API cost' },
// After:
  'openrouter-free': { name: 'OpenRouter Free', description: 'Free-tier model via OpenRouter (Gemma 4 31B IT) with zero API cost' },
```

- [ ] **Step 2: Update `WORKER_TYPE_LABELS` in `apps/web/src/components/code-tasks/shared.tsx`**

Replace line 17:
```typescript
// Before:
  qwen: 'Qwen',
// After:
  'gemma-4': 'Gemma 4',
```

- [ ] **Step 3: Update display names in `apps/web/src/utils/openRouterModelNames.ts`**

Remove the two Qwen entries from the curated allowlist section (lines 11-12):
```typescript
// Remove these two lines:
  'qwen/qwen3.5-plus-02-15': 'Qwen 3.5 Plus',
  'qwen/qwen3.5-flash-02-23': 'Qwen 3.5 Flash',
```

Remove the Qwen entry from the default allowlist section (line 27):
```typescript
// Remove this line:
  'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
```

The `'google/gemma-4-31b-it': 'Gemma 4 31B IT'` entry already exists on line 26 — no addition needed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workers/shared.tsx apps/web/src/components/code-tasks/shared.tsx apps/web/src/utils/openRouterModelNames.ts
git commit -m "feat: update web UI labels and display names for gemma-4 replacing qwen"
```

---

### Task 7: Update Tests

**Files:**
- Modify: `apps/web/src/utils/__tests__/openRouterModelNames.test.ts`
- Modify: `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`

- [ ] **Step 1: Update openRouterModelNames tests**

In `apps/web/src/utils/__tests__/openRouterModelNames.test.ts`:

Remove test cases that reference Qwen models:
- Remove: `expect(resolveOpenRouterModelName('qwen/qwen3.5-plus-02-15')).toBe('Qwen 3.5 Plus');`
- Remove: `expect(resolveOpenRouterModelName('qwen/qwen3.6-plus')).toBe('Qwen 3.6 Plus');`
- Remove: `expect(resolveOpenRouterModelName('qwen/qwen3.5-flash-02-23:online')).toBe('Qwen 3.5 Flash');`

Add test case for paid Gemma 4 (if not already covered):
```typescript
expect(resolveOpenRouterModelName('google/gemma-4-31b-it')).toBe('Gemma 4 31B IT');
```

- [ ] **Step 2: Update CodeTaskNewPage test**

In `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`, update line 303-304:

```typescript
// Before:
    fireEvent.click(screen.getByRole('button', { name: 'Qwen' }));
    expect(screen.getByText('Advanced Qwen model with thinking enabled')).toBeInTheDocument();
// After:
    fireEvent.click(screen.getByRole('button', { name: 'Gemma 4' }));
    expect(screen.getByText('Google Gemma 4 31B via OpenRouter with paid-tier priority')).toBeInTheDocument();
```

- [ ] **Step 3: Run all web app tests**

Run: `pnpm --filter @intexuraos/web test`
Expected: All tests pass.

- [ ] **Step 4: Audit for any remaining Qwen references**

Run: `rg -i "qwen" --type ts --type tsx` from repo root.
Expected: No remaining references in source code (there may be references in old plan docs — those are fine).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/__tests__/openRouterModelNames.test.ts apps/web/src/__tests__/CodeTaskNewPage.test.tsx
git commit -m "test: update tests for gemma-4 replacing qwen"
```

---

### Task 8: Full CI Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully.

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass.

- [ ] **Step 3: Final audit for stale Qwen references**

Run from repo root:
```bash
rg -i "qwen" --glob "*.ts" --glob "*.tsx" --glob "*.json" --glob "*.cjs"
```

Ignore hits in: `docs/plans/`, `node_modules/`, `.git/`. All source code should be Qwen-free.

## Endpoint Changes

- **Modified:** None (no HTTP endpoint changes)
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing endpoints unchanged; model config is internal
