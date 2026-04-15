# Gemma 4 Paid Model: Replace Qwen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paid Gemma 4 (`google/gemma-4-31b-it`) as a supported model for both user default model selection and orchestrator worker type, replacing all Qwen references.

**Architecture:** The change replaces `qwen` worker type (DashScope API) with `gemma-4` (OpenRouter API) across the worker type enum, orchestrator config, web UI labels, and default/curated model allowlists. The existing free Gemma 4 (`google/gemma-4-31b-it:free`) remains unchanged as the `openrouter-free` worker.

**Tech Stack:** TypeScript, Fastify, Vitest, React (web app)

---

## File Map

| File                                                                            | Action   | Responsibility                                                                                                             |
| ------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/common-core/src/codeTaskWorkerTypes.ts`                               | Modify   | Replace `'qwen'` with `'gemma-4'` in worker types array                                                                    |
| `packages/llm-contract/src/supportedModels.ts`                                  | Modify   | Replace Qwen entry with paid Gemma 4 in `DEFAULT_OPENROUTER_MODELS`                                                        |
| `packages/infra-openrouter/src/defaultAllowlist.ts`                             | Modify   | Replace Qwen entry with paid Gemma 4 in `DEFAULT_OPENROUTER_ALLOWED_MODELS`                                                |
| `packages/infra-openrouter/src/allowlist.ts`                                    | Modify   | Replace 2 Qwen entries with 1 Gemma 4 paid entry; update `OPENROUTER_VALIDATION_MODEL`; update count comment from 14 to 13 |
| `workers/orchestrator/src/services/isolation/types.ts`                          | Modify   | Replace `qwen` worker config with `gemma-4` using OpenRouter API                                                           |
| `apps/web/src/components/workers/shared.tsx`                                    | Modify   | Replace `qwen` metadata with `'gemma-4'`; update `openrouter-free` description                                             |
| `apps/web/src/components/code-tasks/shared.tsx`                                 | Modify   | Replace `qwen: 'Qwen'` with `'gemma-4': 'Gemma 4'`                                                                         |
| `apps/web/src/utils/openRouterModelNames.ts`                                    | Modify   | Remove Qwen display name entries (Gemma 4 entry already exists)                                                            |
| `apps/web/src/utils/__tests__/openRouterModelNames.test.ts`                     | Modify   | Remove Qwen test cases, add paid Gemma 4 test                                                                              |
| `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`                               | Modify   | Update worker type button reference from `'Qwen'` to `'Gemma 4'`                                                           |
| `apps/code-agent/src/domain/utils/reviewTriage.ts`                              | Modify   | Replace `qwen` with `gemma-4` in worker-type mapping                                                                       |
| `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`                      | Modify   | Replace `qwen` with `gemma-4` in worker-type mapping                                                                       |
| `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts`                | Modify   | Replace all `qwen`/`Qwen` references with `gemma-4`/`Gemma 4` in prompt text                                               |
| `apps/actions-agent/src/domain/utils/workerTypeDetection.ts`                    | Modify   | Replace `qwen` with `gemma-4` in worker-type detection logic                                                               |
| `apps/code-agent/src/__tests__/helpers/mockServices.ts`                         | Modify   | Replace any `qwen` references with `gemma-4` in test helpers                                                               |
| `workers/orchestrator/src/start.ts`                                             | Modify   | Update startup validation: replace `qwen` DashScope probe with `gemma-4` (or remove since gemma-4 uses OpenRouter)         |
| `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`                | Modify   | Update `qwen` → `gemma-4` in worker type assertions                                                                        |
| `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`           | Modify   | Update `qwen` → `gemma-4` in orchestrator isolation type tests                                                             |
| `packages/llm-contract/src/__tests__/supportedModels.test.ts`                   | Modify   | Update Qwen model assertions to paid Gemma 4                                                                               |
| `packages/infra-openrouter/src/__tests__/defaultAllowlist.test.ts`              | Modify   | Update Qwen assertions to paid Gemma 4                                                                                     |
| `packages/infra-openrouter/src/__tests__/allowlist.test.ts`                     | Modify   | Replace Qwen entries with Gemma 4 paid in allowlist test assertions                                                        |
| `apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts`               | Modify   | Update `qwen` → `gemma-4` in review triage tests                                                                           |
| `apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts`       | Modify   | Update `qwen` → `gemma-4` in dispatch worker triage tests                                                                  |
| `apps/code-agent/src/__tests__/domain/prompts/issueCommentTriagePrompt.test.ts` | Modify   | Update `qwen`/`Qwen` → `gemma-4`/`Gemma 4` in prompt tests                                                                 |
| `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`                       | Modify   | Update `qwen` → `gemma-4` in code submit route tests                                                                       |
| `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`               | Modify   | Update `qwen` → `gemma-4` in review task tests                                                                             |
| `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`                    | Modify   | Update `qwen` → `gemma-4` in GitHub agent tests                                                                            |
| `apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts`      | Modify   | Update `qwen` → `gemma-4` in webhook automation log tests                                                                  |
| `apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts`         | Modify   | Update `qwen` → `gemma-4` in internal dispatch metadata tests                                                              |
| `apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts`            | Modify   | Update `qwen` → `gemma-4` in GitHub event log tests                                                                        |
| `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts`         | Modify   | Update `qwen` → `gemma-4` in PR task creation tests                                                                        |
| `apps/code-agent/src/__tests__/domain/models/codeTask.test.ts`                  | Modify   | Update `qwen` → `gemma-4` in code task model tests                                                                         |
| `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`        | Modify   | Update `qwen` → `gemma-4` in evaluator tests                                                                               |
| `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`   | Modify   | Update `qwen` → `gemma-4` in dispatch service tests                                                                        |
| `apps/code-agent/src/__tests__/infra/firestore/eventDecisionRepository.test.ts` | Modify   | Update `qwen` → `gemma-4` in event decision repo tests                                                                     |
| `apps/code-agent/src/__tests__/domain/utils/labelUtils.test.ts`                 | Modify   | Update `qwen` → `gemma-4` in label utils tests                                                                             |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts`                         | Modify   | Update `qwen` → `gemma-4` in webhook route tests                                                                           |
| `apps/actions-agent/src/__tests__/infra/http/codeAgentHttpClient.test.ts`       | Modify   | Update `qwen` → `gemma-4` in code agent HTTP client tests                                                                  |
| `apps/actions-agent/src/domain/utils/workerTypeDetection.test.ts`               | Modify   | Update `qwen` → `gemma-4` in worker type detection tests                                                                   |
| `apps/research-agent/src/__tests__/routes.test.ts`                              | Modify   | Update `qwen` → `gemma-4` in research agent route tests                                                                    |
| `apps/user-service/src/__tests__/infra/llmValidator.test.ts`                    | Modify   | Update `qwen` → `gemma-4` in LLM validator tests                                                                           |
| `apps/web/src/components/__tests__/GitHubEventLogTableRow.test.tsx`             | Modify   | Update `qwen` → `gemma-4` in event log table row tests                                                                     |
| `apps/web/src/hooks/__tests__/useGitHubEventLog.test.ts`                        | Modify   | Update `qwen` → `gemma-4` in GitHub event log hook tests                                                                   |

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

### Task 5: Update Orchestrator Worker Type Config and Startup Validation

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Modify: `workers/orchestrator/src/start.ts`

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

- [ ] **Step 2: Update startup validation in `workers/orchestrator/src/start.ts`**

In `workers/orchestrator/src/start.ts`, around lines 352-363:

```typescript
// Before:
  // GLM, Qwen, and Kimi all use the same DashScope API key — validate once via qwen.
  await Promise.all([
    ...
    dashscopeKey !== ''
      ? validateThirdPartyApiKey('qwen', dashscopeKey, suffix, logger)
      : Promise.resolve(),
    ...
  ]);
// After:
  // GLM and Kimi use the same DashScope API key — validate once via glm.
  await Promise.all([
    ...
    dashscopeKey !== ''
      ? validateThirdPartyApiKey('glm', dashscopeKey, suffix, logger)
      : Promise.resolve(),
    ...
  ]);
```

The `qwen` worker no longer exists, so the DashScope validation probe must use `glm` (or `kimi`) instead. The comment must also be updated to remove the Qwen reference.

- [ ] **Step 3: Verify `OPENROUTER_API_KEY` is already in `WorkerSecrets`**

Check that `WorkerSecrets` interface (line ~110) already includes `OPENROUTER_API_KEY`. It does — no change needed. `DASHSCOPE_API_KEY` stays because `glm` and `kimi` workers still use it.

- [ ] **Step 4: Build the orchestrator**

Run: `pnpm --filter orchestrator build`
Expected: Clean build. The `WORKER_TYPES` record is typed against `CodeTaskWorkerType`, so it must include `'gemma-4'` (from Task 1) and must NOT include `'qwen'`.

- [ ] **Step 5: Run orchestrator tests**

Run: `pnpm --filter orchestrator test`
Expected: All tests pass. If any test references `qwen` worker type, update to `gemma-4`.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/isolation/types.ts workers/orchestrator/src/start.ts
git commit -m "feat: replace qwen worker with gemma-4 in orchestrator config and startup validation"
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

### Task 7: Update Code-Agent and Actions-Agent Runtime References

**Files:**
- Modify: `apps/code-agent/src/domain/utils/reviewTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- Modify: `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts`
- Modify: `apps/actions-agent/src/domain/utils/workerTypeDetection.ts`
- Modify: `apps/code-agent/src/__tests__/helpers/mockServices.ts`

- [ ] **Step 1: Update `reviewTriage.ts`**

In `apps/code-agent/src/domain/utils/reviewTriage.ts`, replace `qwen: 'qwen'` with `'gemma-4': 'gemma-4'` in the worker-type mapping.

- [ ] **Step 2: Update `dispatchWorkerTriage.ts`**

In `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`, replace `qwen: 'qwen'` with `'gemma-4': 'gemma-4'` in the worker-type mapping.

- [ ] **Step 3: Update `issueCommentTriagePrompt.ts`**

In `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts`, replace all `qwen`/`Qwen` references with `gemma-4`/`Gemma 4` in prompt text:
- `'- Use \`qwen\` for Qwen review requests.'` → `'- Use \`gemma-4\` for Gemma 4 review requests.'`
- `'- If the comment requests architecture review and does not name a worker, prefer \`qwen\`.'` → `'- If the comment requests architecture review and does not name a worker, prefer \`gemma-4\`.'`
- Update example lines referencing `qwen` → `gemma-4`

Bump the prompt `version` field (patch or minor as appropriate per Prompt Versioning rules).

- [ ] **Step 4: Update `workerTypeDetection.ts`**

In `apps/actions-agent/src/domain/utils/workerTypeDetection.ts`, replace `qwen` with `gemma-4` in worker-type detection logic.

- [ ] **Step 5: Update `mockServices.ts`**

In `apps/code-agent/src/__tests__/helpers/mockServices.ts`, replace any `qwen` references with `gemma-4`.

- [ ] **Step 6: Build and run code-agent and actions-agent tests**

Run:
```bash
pnpm --filter @intexuraos/code-agent build && pnpm --filter @intexuraos/code-agent test
pnpm --filter @intexuraos/actions-agent build && pnpm --filter @intexuraos/actions-agent test
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/utils/reviewTriage.ts apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts apps/actions-agent/src/domain/utils/workerTypeDetection.ts apps/code-agent/src/__tests__/helpers/mockServices.ts
git commit -m "feat: replace qwen with gemma-4 in code-agent and actions-agent runtime files"
```

---

### Task 8: Update All Tests

**Files (all test files that reference `qwen`):**
- Modify: `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`
- Modify: `packages/llm-contract/src/__tests__/supportedModels.test.ts`
- Modify: `packages/infra-openrouter/src/__tests__/defaultAllowlist.test.ts`
- Modify: `packages/infra-openrouter/src/__tests__/allowlist.test.ts`
- Modify: `apps/web/src/utils/__tests__/openRouterModelNames.test.ts`
- Modify: `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`
- Modify: `apps/web/src/components/__tests__/GitHubEventLogTableRow.test.tsx`
- Modify: `apps/web/src/hooks/__tests__/useGitHubEventLog.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/prompts/issueCommentTriagePrompt.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Modify: `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`
- Modify: `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/models/codeTask.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`
- Modify: `apps/code-agent/src/__tests__/infra/firestore/eventDecisionRepository.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/labelUtils.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
- Modify: `apps/actions-agent/src/__tests__/infra/http/codeAgentHttpClient.test.ts`
- Modify: `apps/actions-agent/src/domain/utils/workerTypeDetection.test.ts`
- Modify: `apps/research-agent/src/__tests__/routes.test.ts`
- Modify: `apps/user-service/src/__tests__/infra/llmValidator.test.ts`

- [ ] **Step 1: Update package-level tests**

In each package test file, replace `qwen`/`Qwen` references with `gemma-4`/`Gemma 4`:
- `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`: Update worker type assertions
- `packages/llm-contract/src/__tests__/supportedModels.test.ts`: Update Qwen model assertions to paid Gemma 4
- `packages/infra-openrouter/src/__tests__/defaultAllowlist.test.ts`: Update Qwen assertions to paid Gemma 4
- `packages/infra-openrouter/src/__tests__/allowlist.test.ts`: Replace Qwen entries with Gemma 4 paid

- [ ] **Step 2: Update orchestrator tests**

In `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`: Update `qwen` → `gemma-4` in orchestrator isolation type tests.

- [ ] **Step 3: Update code-agent tests**

In all `apps/code-agent/src/__tests__/` files listed above: Replace every `qwen`/`Qwen` reference with `gemma-4`/`Gemma 4`. This includes:
- Worker type references in test fixtures and assertions
- Mock data containing `qwen` worker type
- Prompt text expectations in `issueCommentTriagePrompt.test.ts`
- Triage/dispatch test expectations

- [ ] **Step 4: Update actions-agent, research-agent, user-service, and web app tests**

- `apps/actions-agent/` tests: Update worker type references
- `apps/research-agent/src/__tests__/routes.test.ts`: Update `qwen` → `gemma-4`
- `apps/user-service/src/__tests__/infra/llmValidator.test.ts`: Update Qwen model references
- `apps/web/` tests: Update openRouterModelNames test, CodeTaskNewPage test, GitHubEventLogTableRow test, useGitHubEventLog test

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests pass across all workspaces.

- [ ] **Step 6: Audit for any remaining Qwen references**

Run: `rg -i "qwen" --glob "*.ts" --glob "*.tsx" --glob "*.json" --glob "*.cjs"` from repo root.
Expected: No remaining references in source code (plan docs are fine).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: update all tests for gemma-4 replacing qwen across packages, apps, and workers"
```

---

### Task 9: Full CI Verification

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
