# Add 'Review' Status to Code Task Workflow

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `review` as a new status value in the `AgentType` union, displayed in the UI when PR/issue comments trigger task creation.

**Architecture:** This is a status label change, not a new agent type with its own prompts. The existing PR Review Mode overlay already handles PR comment scenarios. We simply add `'review'` to the type union and use it instead of `'pull_request'` for comment-triggered tasks.

**Tech Stack:** TypeScript, React (web app), Fastify (code-agent)

---

## Scope Clarification

**What this IS:**
- Adding `'review'` as a fourth value in the AgentType union
- Updating UI to show "Review" badge (amber) for these tasks
- Setting `agentType: 'review'` when PR/issue comments create tasks

**What this is NOT:**
- No new `buildReviewPrompt()` function - PR Review Mode overlay exists
- No new `REVIEW_AGENT_FINAL` completion block - use existing `PULL_REQUEST_AGENT_FINAL`
- No new completion verifier logic - treat `'review'` like `'pull_request'`

---

## Task 1: Update AgentType in Domain Model

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:21`

**Step 1: Update the AgentType definition**

```typescript
export type AgentType = 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run typecheck**

Run: `pnpm --filter code-agent typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts
git commit -m "feat(code-agent): add 'review' to AgentType union"
```

---

## Task 2: Update Web App Type Definition

**Files:**
- Modify: `apps/web/src/types/index.ts` (search for agentType in CodeTask interface)

**Step 1: Update the agentType field**

```typescript
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(web): add 'review' to agentType in CodeTask type"
```

---

## Task 3: Update Repository and Service Types

**Files:**
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` (CreateTaskInput)
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`

**Step 1: Update all agentType fields to include 'review'**

Search for `'planning' | 'execution' | 'pull_request'` and add `| 'review'`.

**Step 2: Run typecheck**

Run: `pnpm --filter code-agent typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/domain/services/taskDispatcher.ts apps/code-agent/src/infra/services/taskDispatcherImpl.ts
git commit -m "feat(code-agent): add 'review' to repository and service types"
```

---

## Task 4: Update Route Schema Enums

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`

**Step 1: Update all agentType enum declarations**

Search for `enum: ['planning', 'execution', 'pull_request']` and update to:

```typescript
enum: ['planning', 'execution', 'pull_request', 'review']
```

Also update any TypeScript type annotations.

**Step 2: Run typecheck**

Run: `pnpm --filter code-agent typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts
git commit -m "feat(code-agent): add 'review' to route schema enums"
```

---

## Task 5: Update Orchestrator Type

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (SystemPromptParams interface)

**Step 1: Update SystemPromptParams agentType field**

```typescript
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run typecheck**

Run: `pnpm --filter orchestrator typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts
git commit -m "feat(orchestrator): add 'review' to SystemPromptParams agentType"
```

---

## Task 6: Update Web App UI Badge

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx`

**Step 1: Add Review badge rendering**

Add after the execution badge conditional:

```tsx
: task.agentType === 'review' ? (
  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
    Review
  </span>
)
```

**Step 2: Run build**

Run: `pnpm --filter web build`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/pages/CodeTasksPage.tsx apps/web/src/pages/CodeTaskViewPage.tsx
git commit -m "feat(web): add Review badge to task list and detail views"
```

---

## Task 7: Update createTaskForPR

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createTaskForPR.ts`
- Test: `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts`

**Step 1: Change agentType from 'pull_request' to 'review'**

Search for `agentType: 'pull_request'` and change to:

```typescript
agentType: 'review',
```

**Step 2: Update existing tests**

Update any test assertions that check for `agentType: 'pull_request'` to expect `'review'` instead.

**Step 3: Run tests**

Run: `pnpm --filter code-agent test -- --run createTaskForPR.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/createTaskForPR.ts apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts
git commit -m "feat(code-agent): use 'review' agentType for PR comment tasks"
```

---

## Task 8: Update Webhook Completion Handling

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts`

**Step 1: Add 'review' to execution-like completion logic**

Find the status resolution logic and add `|| task.agentType === 'review'`:

```typescript
const resolvedStatus =
  result?.planning_outcome_label === 'planned'
    ? 'planned'
    : task.agentType === 'execution' || task.agentType === 'pull_request' || task.agentType === 'review'
      ? 'implemented'
      : 'planned';
```

**Step 2: Run tests**

Run: `pnpm --filter code-agent test -- --run webhooks.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts
git commit -m "feat(code-agent): handle 'review' agent type in webhook completion"
```

---

## Task 9: Update Usecase Type Preservation

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts`

**Step 1: Update type annotations**

Add `| 'review'` to all agentType type annotations.

**Step 2: Update logic to preserve 'review'**

Ensure 'review' is preserved like 'pull_request' in follow-up tasks:

```typescript
const agentType =
  originalTask.agentType === 'review'
    ? 'review'
    : originalTask.agentType === 'pull_request'
      ? 'pull_request'
      : hasCodeTaskLabel(labels) ? 'execution' : 'planning';
```

**Step 3: Run tests**

Run: `pnpm --filter code-agent test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitTaskFeedback.ts apps/code-agent/src/domain/usecases/retryTask.ts apps/code-agent/src/domain/usecases/processCodeAction.ts
git commit -m "feat(code-agent): preserve 'review' agentType in usecases"
```

---

## Task 10: Update Migration Types

**Files:**
- Modify: `apps/code-agent/src/infra/migrations/agentRoutingContractMigration.ts`

**Step 1: Update AgentType**

```typescript
type AgentType = 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run tests**

Run: `pnpm --filter code-agent test -- --run agentRoutingContractMigration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/infra/migrations/agentRoutingContractMigration.ts
git commit -m "feat(code-agent): add 'review' to migration AgentType"
```

---

## Task 11: Run Full CI

**Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

**Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: PASS

---

## Summary

| Task | What                       | Files Changed |
| ---- | -------------------------- | ------------- |
| 1    | Domain model type          | 1             |
| 2    | Web app type               | 1             |
| 3    | Repository/service types   | 3             |
| 4    | Route schema enums         | 1             |
| 5    | Orchestrator type          | 1             |
| 6    | UI badge                   | 2             |
| 7    | createTaskForPR            | 2             |
| 8    | Webhook completion         | 1             |
| 9    | Usecase preservation       | 3             |
| 10   | Migration types            | 1             |
| 11   | Full CI                    | -             |

**Total: 11 tasks, ~16 files changed**

This is a straightforward type extension across the codebase. No new prompts, no new completion blocks, no architectural changes.
