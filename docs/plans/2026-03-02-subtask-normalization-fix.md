# Subtask Normalization Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Thread subtask URLs through the orchestrator→code-agent pipeline so `enforcePlanningOutcome` can normalize subtasks via Linear API directly, eliminating the race condition with local Firestore sync.

**Architecture:** Three independent service changes: (1) orchestrator extracts `subtask_urls` from agent output via Gemini verifier and threads to webhook payload, (2) linear-agent adds `parentId` to `validateIssue` response, (3) code-agent uses subtask URLs + `validateIssue` for direct normalization instead of `fetchIssueTree`.

**Tech Stack:** TypeScript, Zod, Fastify, Vitest

**Design doc:** `docs/plans/2026-03-02-subtask-normalization-fix-design.md`

---

## Parallel Agent Breakdown

Three independent tasks, executable in parallel by separate agents. No shared files between tasks.

| Task | Service       | Model  | Files                                                             | Why this model                                     |
| ---- | ------------- | ------ | ----------------------------------------------------------------- | -------------------------------------------------- |
| 1    | orchestrator  | sonnet | `completion-verifier.ts`, `task-dispatcher.ts`, `task.ts` + tests | Mechanical: add field to schema, thread through    |
| 2    | linear-agent  | haiku  | `validateIssue.ts`, `internalRoutes.ts`, port + HTTP client       | Trivial: add one field to return type and response |
| 3    | code-agent    | sonnet | `webhookRoutes.ts`, `codeTask.ts` + tests                         | Logic rewrite: URL-based normalization + tests     |

### Interface Contract (agents must produce these exact types)

**Orchestrator → code-agent webhook payload** (new field):
```typescript
planning_subtask_urls?: string  // comma-separated Linear URLs, or empty string
```

**linear-agent validateIssue response** (new field):
```typescript
parentId: string | null  // UUID of parent issue, null if top-level
```

---

## Task 1: Orchestrator — Extract and Thread `subtask_urls`

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:34-43` (PlanningAgentData)
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:71-79` (PLANNING_SCHEMA)
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:118-140` (buildPlanningPrompt)
- Modify: `workers/orchestrator/src/types/task.ts:71-87` (TaskResult)
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:1070-1079` (buildResultFromVerification)
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

### Step 1: Write failing test — schema accepts subtask_urls

In `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`, update ALL existing `PLANNING_SCHEMA.safeParse` calls to include `subtask_urls` field. Then add a new test:

```typescript
it('accepts complex planned with subtask_urls', () => {
  const result = PLANNING_SCHEMA.safeParse({
    outcome: 'planned',
    superpowers_writing_plans: 'used',
    linear_url: 'https://linear.app/pbuchman/issue/INT-681',
    is_complex: '1',
    subtask_urls: 'https://linear.app/pbuchman/issue/INT-682/create-transcription-worker,https://linear.app/pbuchman/issue/INT-683/user-service-add-transcription-preferences',
    pr_url: 'https://github.com/pbuchman/intexuraos/pull/972',
    summary: 'Planned complex task with subtasks.',
    unclear_clarification: '',
  });
  expect(result.success).toBe(true);
});

it('accepts simple planned with empty subtask_urls', () => {
  const result = PLANNING_SCHEMA.safeParse({
    outcome: 'planned',
    superpowers_writing_plans: 'used',
    linear_url: 'https://linear.app/pbuchman/issue/INT-100',
    is_complex: '0',
    subtask_urls: '',
    pr_url: '',
    summary: 'Simple plan.',
    unclear_clarification: '',
  });
  expect(result.success).toBe(true);
});
```

### Step 2: Run test to verify it fails

Run: `cd workers/orchestrator && pnpm test -- --run -t "subtask_urls"`
Expected: FAIL — `subtask_urls` not in schema yet

### Step 3: Add subtask_urls to PLANNING_SCHEMA and PlanningAgentData

In `completion-verifier.ts:71-79`, add `subtask_urls: z.string()` after `is_complex`:

```typescript
export const PLANNING_SCHEMA = z.object({
  outcome: z.enum(['planned', 'unclear']),
  superpowers_writing_plans: z.enum(['used', 'not used']),
  linear_url: z.string(),
  is_complex: z.enum(['0', '1']),
  subtask_urls: z.string(),
  pr_url: z.string(),
  summary: z.string(),
  unclear_clarification: z.string(),
});
```

In `completion-verifier.ts:34-43`, add to `PlanningAgentData`:

```typescript
export interface PlanningAgentData {
  agentType: 'planning';
  outcome: 'planned' | 'unclear';
  superpowers_writing_plans: 'used' | 'not used';
  linear_url: string;
  is_complex: '0' | '1';
  subtask_urls: string;
  pr_url: string;
  summary: string;
  unclear_clarification: string;
}
```

### Step 4: Update buildPlanningPrompt extraction instructions

In `completion-verifier.ts:129`, add after the `is_complex` line:

```typescript
'- subtask_urls: comma-separated Linear issue URLs for all subtasks created (string, empty string if none)',
```

Update the example JSON at line 135 to include `"subtask_urls":"https://linear.app/pbuchman/issue/INT-632/...,https://linear.app/pbuchman/issue/INT-633/..."`.

### Step 5: Add to TaskResult and buildResultFromVerification

In `workers/orchestrator/src/types/task.ts:82`, add after `planning_is_complex`:

```typescript
planning_subtask_urls?: string;
```

In `task-dispatcher.ts:1075`, add after `base.planning_is_complex = agentData.is_complex;`:

```typescript
base.planning_subtask_urls = agentData.subtask_urls;
```

### Step 6: Fix all existing test fixtures

All existing tests that use `PLANNING_SCHEMA.safeParse` MUST now include `subtask_urls`. Add `subtask_urls: ''` (or appropriate value) to every existing test fixture.

### Step 7: Run tests and verify

Run: `cd workers/orchestrator && pnpm test -- --run`
Expected: ALL PASS

### Step 8: Commit

```bash
git add workers/orchestrator/src/services/completion-verifier.ts \
       workers/orchestrator/src/types/task.ts \
       workers/orchestrator/src/services/task-dispatcher.ts \
       workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "feat: extract subtask_urls in planning completion verifier"
```

---

## Task 2: Linear-agent — Add parentId to validateIssue Response

**Files:**
- Modify: `apps/linear-agent/src/domain/useCases/validateIssue.ts:22-31` (ValidatedIssue)
- Modify: `apps/linear-agent/src/domain/useCases/validateIssue.ts:100-107` (return value)
- Modify: `apps/code-agent/src/domain/ports/linearAgentClient.ts:35-44` (ValidatedIssue port)
- Modify: `apps/code-agent/src/infra/http/linearAgentHttpClient.ts` (HTTP response mapping)
- Test: `apps/linear-agent/src/__tests__/domain/useCases/validateIssue.test.ts`
- Test: `apps/code-agent/src/__tests__/` (update mock fixtures)

### Step 1: Write failing test in linear-agent

In `apps/linear-agent/src/__tests__/domain/useCases/validateIssue.test.ts`, find an existing test that checks the return value and add an assertion:

```typescript
expect(result.value.parentId).toBe('parent-uuid'); // or null for top-level
```

### Step 2: Run test to verify it fails

Run: `cd apps/linear-agent && pnpm test -- --run -t "validateIssue"`
Expected: FAIL — `parentId` not in response

### Step 3: Add parentId to ValidatedIssue interface (linear-agent)

In `apps/linear-agent/src/domain/useCases/validateIssue.ts:22-31`:

```typescript
export interface ValidatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: LinearLabel[];
  childCount: number;
  parentId: string | null;
}
```

### Step 4: Add parentId to the return value

In `apps/linear-agent/src/domain/useCases/validateIssue.ts:100-107`, add `parentId`:

```typescript
return ok({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  url: issue.url,
  labels: issue.labels,
  childCount: issue.childCount,
  parentId: issue.parentId ?? null,
});
```

Note: `LinearIssueWithTeam` extends `LinearIssue` which has `parentId?: string | null`. Use `?? null` to normalize undefined to null.

### Step 5: Update code-agent port interface

In `apps/code-agent/src/domain/ports/linearAgentClient.ts:35-44`:

```typescript
export interface ValidatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[];
  childCount: number;
  parentId: string | null;
}
```

### Step 6: Update code-agent HTTP client mapping

In `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`, find the `validateIssue` method response mapping and add `parentId` to the parsed response.

### Step 7: Update test fixtures in both services

Any mock that returns `ValidatedIssue` must now include `parentId`. Search for `validateIssue` mocks in both `apps/linear-agent/src/__tests__/` and `apps/code-agent/src/__tests__/`.

### Step 8: Run tests and verify

Run: `cd apps/linear-agent && pnpm test -- --run` then `cd apps/code-agent && pnpm test -- --run`
Expected: ALL PASS

### Step 9: Commit

```bash
git add apps/linear-agent/src/domain/useCases/validateIssue.ts \
       apps/code-agent/src/domain/ports/linearAgentClient.ts \
       apps/code-agent/src/infra/http/linearAgentHttpClient.ts \
       apps/linear-agent/src/__tests__/ \
       apps/code-agent/src/__tests__/
git commit -m "feat: add parentId to validateIssue response"
```

---

## Task 3: Code-agent — URL-based Subtask Normalization

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:72-74` (TaskResult type)
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:39-40` (Body type)
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:66-89` (JSON schema)
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:132` (handler signature)
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:264-324` (enforcePlanningOutcome complex branch)
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

### Step 1: Add planning_subtask_urls to types and schema

In `apps/code-agent/src/domain/models/codeTask.ts`, after `planning_is_complex` (line 72):

```typescript
planning_subtask_urls?: string;
```

In `webhookRoutes.ts`, add to the Body type (line 39 area), JSON schema properties (line 76 area, in the "strictly validated" section), and handler signature (line 132).

### Step 2: Write failing test — URL-based normalization path

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, add a new test:

```typescript
it('complex planned: normalizes subtasks via URL-based resolution', async () => {
  // Create task with planning agentType
  const createResult = await codeTaskRepo.create({
    userId: 'user-123',
    prompt: 'Plan complex task',
    sanitizedPrompt: 'Plan complex task',
    systemPromptHash: 'default',
    workerType: 'auto',
    workerLocation: 'mac',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace_123',
    linearIssueId: 'INT-123',
    webhookSecret: 'test-webhook-secret',
    agentType: 'planning',
  });
  expect(createResult.ok).toBe(true);
  if (!createResult.ok) throw new Error('Failed to create task');
  const task = createResult.value;

  const linearAgentClient = getServices().linearAgentClient;
  const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
  const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);
  const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
  const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);
  const addCommentSpy = vi.mocked(linearAgentClient.addComment);

  // First call: validate parent issue
  validateIssueSpy.mockReset();
  validateIssueSpy.mockResolvedValueOnce(
    ok({
      id: 'original-uuid',
      identifier: 'INT-123',
      title: 'Original issue',
      url: 'https://linear.app/intexuraos/issue/INT-123',
      labels: [],
      childCount: 2,
      parentId: null,
    })
  );
  // Second + third calls: validate subtask identifiers
  validateIssueSpy.mockResolvedValueOnce(
    ok({
      id: 'child-1-uuid',
      identifier: 'INT-200',
      title: 'Subtask 1',
      url: 'https://linear.app/intexuraos/issue/INT-200',
      labels: [],
      childCount: 0,
      parentId: 'original-uuid',
    })
  );
  validateIssueSpy.mockResolvedValueOnce(
    ok({
      id: 'child-2-uuid',
      identifier: 'INT-201',
      title: 'Subtask 2',
      url: 'https://linear.app/intexuraos/issue/INT-201',
      labels: [],
      childCount: 0,
      parentId: 'original-uuid',
    })
  );

  updateIssueStateSpy.mockClear();
  updateIssueMetadataSpy.mockClear();
  addCommentSpy.mockClear();

  const payload = {
    taskId: task.id,
    status: 'completed' as const,
    result: {
      summary: 'Created complex plan with subtasks',
      planning_outcome_label: 'planned' as const,
      planning_superpowers_writing_plans_used: '1' as const,
      planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
      planning_is_complex: '1' as const,
      planning_subtask_urls: 'https://linear.app/intexuraos/issue/INT-200/subtask-1,https://linear.app/intexuraos/issue/INT-201/subtask-2',
      planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
      planning_unclear_clarification: '',
    },
  };

  const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

  const response = await app.inject({
    method: 'POST',
    url: '/internal/webhooks/task-complete',
    headers: {
      'x-internal-auth': 'test-internal-token',
      'x-request-timestamp': timestamp,
      'x-request-signature': signature,
    },
    payload,
  });

  expect(response.statusCode).toBe(200);

  // fetchIssueTree should NOT be called when URLs are provided
  expect(fetchIssueTreeSpy).not.toHaveBeenCalled();

  // validateIssue called 3 times: parent + 2 subtasks
  expect(validateIssueSpy).toHaveBeenCalledTimes(3);

  // Both subtasks normalized: state → todo, labels → code-task
  expect(updateIssueStateSpy).toHaveBeenCalledWith(
    expect.objectContaining({ issueId: 'child-1-uuid', state: 'todo' })
  );
  expect(updateIssueStateSpy).toHaveBeenCalledWith(
    expect.objectContaining({ issueId: 'child-2-uuid', state: 'todo' })
  );
  expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
    expect.objectContaining({ issueId: 'child-1-uuid', addLabels: ['code-task'] })
  );
  expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
    expect.objectContaining({ issueId: 'child-2-uuid', addLabels: ['code-task'] })
  );
});
```

Also add a test for the fallback path (empty subtask_urls + isComplex=1 falls back to fetchIssueTree).

### Step 3: Run test to verify it fails

Run: `cd apps/code-agent && pnpm test -- --run -t "URL-based"`
Expected: FAIL — new field not recognized, new logic not implemented

### Step 4: Rewrite the isComplex branch in enforcePlanningOutcome

Replace `webhookRoutes.ts:264-324` (the entire `if (isComplex)` block) with:

```typescript
if (isComplex) {
  const subtaskUrls = (planningResult.planning_subtask_urls ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  if (subtaskUrls.length > 0) {
    // URL-based resolution — no race condition with local sync
    for (const url of subtaskUrls) {
      const identifier = parseLinearIdentifierFromUrl(url);
      if (identifier === null) {
        return { ok: false, message: `Invalid subtask URL: ${url}` };
      }

      const subtaskValidation = await linearAgentClient.validateIssue({
        userId: task.userId,
        identifier,
      });
      if (!subtaskValidation.ok) {
        return { ok: false, message: `Failed to validate subtask ${identifier}: ${subtaskValidation.error.message}` };
      }

      const subtask = subtaskValidation.value;
      if (subtask.parentId !== originalIssueUuid) {
        return { ok: false, message: `Subtask ${subtask.identifier} is not a direct child of the input issue — task rejected` };
      }

      const normalizeState = await linearAgentClient.updateIssueState({
        userId: task.userId,
        issueId: subtask.id,
        state: 'todo',
      });
      if (!normalizeState.ok) {
        return { ok: false, message: `Failed to normalize subtask ${subtask.identifier} state: ${normalizeState.error.message}` };
      }

      const normalizeMetadata = await linearAgentClient.updateIssueMetadata({
        userId: task.userId,
        issueId: subtask.id,
        assigneeId: null,
        removeLabels: ['planned', 'unclear'],
      });
      if (!normalizeMetadata.ok) {
        return { ok: false, message: `Failed to normalize subtask ${subtask.identifier} metadata: ${normalizeMetadata.error.message}` };
      }
    }

    // Comment PR URL on issue if provided
    const planningPrUrl = planningResult.planning_pr_url ?? '';
    if (planningPrUrl !== '') {
      const prComment = await linearAgentClient.addComment({
        userId: task.userId,
        issueId: originalIssueUuid,
        body: `Planning PR: ${planningPrUrl}`,
      });
      if (!prComment.ok) {
        return { ok: false, message: `Failed to comment planning PR: ${prComment.error.message}` };
      }
    }

    // LAST: stamp code-task on each subtask — proof of successful processing
    for (const url of subtaskUrls) {
      const identifier = parseLinearIdentifierFromUrl(url);
      if (identifier === null) continue; // already validated above
      const subtaskValidation = await linearAgentClient.validateIssue({
        userId: task.userId,
        identifier,
      });
      if (!subtaskValidation.ok) continue; // already validated above

      const stampCodeTask = await linearAgentClient.updateIssueMetadata({
        userId: task.userId,
        issueId: subtaskValidation.value.id,
        addLabels: ['code-task'],
      });
      if (!stampCodeTask.ok) {
        return { ok: false, message: `Failed to add code-task label to subtask ${identifier}: ${stampCodeTask.error.message}` };
      }
    }
  } else {
    // Fallback: no URLs provided — use tree fetch (original behavior)
    request.log.warn(
      { taskId, linearIssueId: task.linearIssueId },
      'Complex planning completed without subtask URLs — falling back to fetchIssueTree'
    );

    const treeResult = await linearAgentClient.fetchIssueTree({
      userId: task.userId,
      issueId: originalIssueUuid,
    });
    if (!treeResult.ok) {
      return { ok: false, message: `Failed to fetch issue tree: ${treeResult.error.message}` };
    }

    const descendants = treeResult.value.descendants;

    for (const descendant of descendants) {
      if (descendant.parentId !== originalIssueUuid) {
        return { ok: false, message: `Subtask ${descendant.identifier} is not a direct child of the input issue — task rejected` };
      }

      const normalizeState = await linearAgentClient.updateIssueState({
        userId: task.userId,
        issueId: descendant.id,
        state: 'todo',
      });
      if (!normalizeState.ok) {
        return { ok: false, message: `Failed to normalize subtask ${descendant.identifier} state: ${normalizeState.error.message}` };
      }

      const normalizeMetadata = await linearAgentClient.updateIssueMetadata({
        userId: task.userId,
        issueId: descendant.id,
        assigneeId: null,
        removeLabels: ['planned', 'unclear'],
      });
      if (!normalizeMetadata.ok) {
        return { ok: false, message: `Failed to normalize subtask ${descendant.identifier} metadata: ${normalizeMetadata.error.message}` };
      }
    }

    const planningPrUrl = planningResult.planning_pr_url ?? '';
    if (planningPrUrl !== '') {
      const prComment = await linearAgentClient.addComment({
        userId: task.userId,
        issueId: originalIssueUuid,
        body: `Planning PR: ${planningPrUrl}`,
      });
      if (!prComment.ok) {
        return { ok: false, message: `Failed to comment planning PR: ${prComment.error.message}` };
      }
    }

    for (const descendant of descendants) {
      const stampCodeTask = await linearAgentClient.updateIssueMetadata({
        userId: task.userId,
        issueId: descendant.id,
        addLabels: ['code-task'],
      });
      if (!stampCodeTask.ok) {
        return { ok: false, message: `Failed to add code-task label to subtask ${descendant.identifier}: ${stampCodeTask.error.message}` };
      }
    }
  }
}
```

### Step 5: Update existing test fixtures

All existing webhook tests that send `planning_is_complex: '1'` need `planning_subtask_urls` added to the payload. Existing tests that use `fetchIssueTree` should still work via the fallback path (send empty `planning_subtask_urls: ''`).

### Step 6: Run tests and verify

Run: `cd apps/code-agent && pnpm test -- --run`
Expected: ALL PASS

### Step 7: Commit

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts \
       apps/code-agent/src/domain/models/codeTask.ts \
       apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "feat: URL-based subtask normalization in enforcePlanningOutcome"
```

---

## Task 4: Final CI Verification

**After all three tasks merge:**

### Step 1: Run full CI

```bash
pnpm run ci:tracked
```

Expected: ALL PASS

### Step 2: Commit any remaining fixes

If CI surfaces cross-service type issues from the merge, fix and commit.
