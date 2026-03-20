# Review Agent Plan Awareness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the review agent mandatory requirements validation — validate implementation against the Linear issue description (always) and a referenced plan document (when present). When no plan exists, the description IS the plan.

**Architecture:** Code-agent fetches the Linear issue description at review task creation time via `LinearAgentClient`, resolves any plan document path from it, and embeds both into the existing `prompt` field via `buildReviewPrompt()`. The system prompt instructs the agent to validate against the description (mandatory) and, when a plan path is present, read it from `/repo` and validate every item (hard gate). No new Firestore fields. No MCP needed — the description is in the prompt, the plan is on disk.

**Tech Stack:** TypeScript, Fastify (code-agent), common-core package

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing internal endpoints

---

### Task 1: Extract plan path resolution to common-core

The `resolvePlanDocumentPathFromLinearContext` logic in `deep-validator-helpers.ts` is pure string parsing with no I/O. Extract it to `common-core` so code-agent can import it. The orchestrator re-imports from common-core.

**Files:**
- Create: `packages/common-core/src/planPathResolver.ts`
- Create: `packages/common-core/src/__tests__/planPathResolver.test.ts`
- Modify: `packages/common-core/src/index.ts` (add export)
- Modify: `workers/orchestrator/src/services/deep-validator-helpers.ts` (re-import from common-core)
- Modify: `workers/orchestrator/src/services/__tests__/deep-validator-helpers.test.ts` (remove moved tests)

- [ ] **Step 1: Write failing tests for plan path resolution in common-core**

Copy test cases from `workers/orchestrator/src/services/__tests__/deep-validator-helpers.test.ts` `describe('resolvePlanDocumentPathFromLinearContext')` block (lines 59-148) into the new test file. Update imports to `common-core`.

```typescript
// packages/common-core/src/__tests__/planPathResolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlanDocumentPathFromLinearContext } from '../planPathResolver.js';

// Copy all test cases from deep-validator-helpers.test.ts
// describe('resolvePlanDocumentPathFromLinearContext') block
```

Run: `pnpm vitest run packages/common-core/src/__tests__/planPathResolver.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 2: Move plan path resolution code to common-core**

Move from `workers/orchestrator/src/services/deep-validator-helpers.ts` to `packages/common-core/src/planPathResolver.ts`:
- `PLAN_DOCUMENT_LINE_REGEX`, `PLAN_DOCUMENT_PATH_REGEX`
- `normalizePlanDocumentPath`, `extractPlanDocumentPathCandidate`, `extractCanonicalPlanDocumentPath`
- `resolvePlanDocumentPathFromLinearContext`

Define minimal interface in common-core:
```typescript
export interface PlanResolutionContext {
  description: string | undefined;
  comments: { body: string }[];
}
```

Export `resolvePlanDocumentPathFromLinearContext` and `PlanResolutionContext` from `packages/common-core/src/index.ts`.

- [ ] **Step 3: Run common-core tests**

Run: `pnpm vitest run packages/common-core/src/__tests__/planPathResolver.test.ts`
Expected: PASS

- [ ] **Step 4: Update deep-validator-helpers to re-import from common-core**

In `workers/orchestrator/src/services/deep-validator-helpers.ts`:
- Remove moved functions and regex constants
- Import and re-export `resolvePlanDocumentPathFromLinearContext` from `@intexuraos/common-core`
- Keep `fetchLinearIssueContext`, `readPlanReferencedInLinearIssue`, `extractPrNumber` (I/O-dependent, stay in orchestrator)
- Ensure `LinearIssueContext` extends `PlanResolutionContext` (it adds `createdAt` to comments)

- [ ] **Step 5: Remove moved tests from orchestrator**

In `workers/orchestrator/src/services/__tests__/deep-validator-helpers.test.ts`, remove the `describe('resolvePlanDocumentPathFromLinearContext')` block.

- [ ] **Step 6: Run orchestrator tests**

Run: `pnpm vitest run workers/orchestrator/src/services/__tests__/deep-validator-helpers.test.ts`
Expected: PASS

- [ ] **Step 7: Build and verify**

Run: `pnpm build && pnpm vitest run packages/common-core workers/orchestrator`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/common-core/src/planPathResolver.ts packages/common-core/src/__tests__/planPathResolver.test.ts packages/common-core/src/index.ts workers/orchestrator/src/services/deep-validator-helpers.ts workers/orchestrator/src/services/__tests__/deep-validator-helpers.test.ts
git commit -m "refactor: extract plan path resolution to common-core"
```

---

### Task 2: Add `getIssueDescription` to LinearAgentClient port

The existing `fetchIssueForDisplay` receives `description` from the API but drops it. Add a focused method that returns just the description. Hexagonal architecture — the port defines what the domain needs.

**Files:**
- Modify: `apps/code-agent/src/domain/ports/linearAgentClient.ts`
- Modify: `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`
- Modify: all test fakes implementing `LinearAgentClient`

- [ ] **Step 1: Add `getIssueDescription` to the port interface**

In `apps/code-agent/src/domain/ports/linearAgentClient.ts`, add to `LinearAgentClient`:

```typescript
  /**
   * Fetch the description of a Linear issue.
   * Used by review task creation to embed requirements context in the prompt.
   */
  getIssueDescription(request: ValidateIssueRequest): Promise<Result<string | undefined, LinearAgentError>>;
```

- [ ] **Step 2: Implement in HTTP client**

In `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`, reuse the `/internal/linear/issues/:identifier` endpoint:

```typescript
    async getIssueDescription(request: ValidateIssueRequest): Promise<Result<string | undefined, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Internal-Auth': internalAuthToken,
            'X-User-Id': request.userId,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.warn({ status: response.status, error: errorText }, 'linear-agent getIssueDescription failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: { description: string | null };
        };

        if (!body.success || body.data === undefined) {
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        return ok(body.data.description ?? undefined);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },
```

- [ ] **Step 3: Add `getIssueDescription` to all test fakes**

Search: `grep -rn 'createIssue.*Promise\|LinearAgentClient' apps/code-agent/src/__tests__/ --include='*.ts'`

Add `getIssueDescription: vi.fn().mockResolvedValue(ok(undefined))` to every fake.

- [ ] **Step 4: Verify typecheck and tests**

Run: `pnpm tsc --noEmit -p apps/code-agent/tsconfig.json && pnpm vitest run apps/code-agent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/ports/linearAgentClient.ts apps/code-agent/src/infra/http/linearAgentHttpClient.ts
git commit -m "feat(code-agent): add getIssueDescription to LinearAgentClient port"
```

---

### Task 3: Embed issue description and plan path in review prompt

Wire up the port method and common-core plan path resolver into `createReviewTask`. The description and plan path are embedded in the existing `prompt` field — no new Firestore fields.

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/createReviewTask.test.ts`

- [ ] **Step 1: Write failing test — prompt includes description and plan path**

```typescript
it('embeds issue description and plan path in review prompt', async () => {
  mockLinearAgentClient.getIssueDescription.mockResolvedValue(
    ok('Implement feature X.\n\nPlan document: docs/plans/2026-03-20-feature-x.md')
  );

  const result = await createReviewTask(deps, request);
  expect(result.ok).toBe(true);

  const createCall = mockCodeTaskRepo.create.mock.calls[0]![0]!;
  expect(createCall.prompt).toContain('### Issue Requirements');
  expect(createCall.prompt).toContain('Implement feature X.');
  expect(createCall.prompt).toContain('### Plan Document');
  expect(createCall.prompt).toContain('docs/plans/2026-03-20-feature-x.md');
});
```

- [ ] **Step 2: Write failing test — prompt includes description without plan**

```typescript
it('embeds issue description without plan section when no plan reference', async () => {
  mockLinearAgentClient.getIssueDescription.mockResolvedValue(
    ok('Fix the login bug on mobile.')
  );

  const result = await createReviewTask(deps, request);
  expect(result.ok).toBe(true);

  const createCall = mockCodeTaskRepo.create.mock.calls[0]![0]!;
  expect(createCall.prompt).toContain('### Issue Requirements');
  expect(createCall.prompt).toContain('Fix the login bug on mobile.');
  expect(createCall.prompt).not.toContain('### Plan Document');
});
```

- [ ] **Step 3: Write failing test — description fetch failure is best-effort**

```typescript
it('creates prompt without requirements when getIssueDescription fails', async () => {
  mockLinearAgentClient.getIssueDescription.mockResolvedValue(
    err({ code: 'UNAVAILABLE', message: 'Linear is down' })
  );

  const result = await createReviewTask(deps, request);
  expect(result.ok).toBe(true);

  const createCall = mockCodeTaskRepo.create.mock.calls[0]![0]!;
  expect(createCall.prompt).not.toContain('### Issue Requirements');
});
```

- [ ] **Step 4: Run tests to confirm failure**

Run: `pnpm vitest run apps/code-agent/src/domain/usecases/__tests__/createReviewTask.test.ts`
Expected: FAIL

- [ ] **Step 5: Implement fetch + resolve in createReviewTask**

In `apps/code-agent/src/domain/usecases/createReviewTask.ts`, add import:

```typescript
import { resolvePlanDocumentPathFromLinearContext } from '@intexuraos/common-core';
```

After the `resolveLinearIssueId` block (around line 314), add:

```typescript
  // Best-effort: fetch issue description for review requirements context
  let issueDescription: string | undefined;
  let planDocumentPath: string | undefined;
  if (linearIssueId !== undefined && linearAgentClient !== undefined) {
    try {
      const descResult = await linearAgentClient.getIssueDescription({
        userId,
        identifier: linearIssueId,
      });
      if (descResult.ok && descResult.value !== undefined) {
        issueDescription = descResult.value;
        planDocumentPath = resolvePlanDocumentPathFromLinearContext({
          description: issueDescription,
          comments: [],
        });
      }
    } catch (error: unknown) {
      logger.warn({ error, linearIssueId }, 'Failed to fetch issue description for review context');
    }
  }
```

Update `buildReviewPrompt` signature to accept optional `issueDescription` and `planDocumentPath`:

```typescript
function buildReviewPrompt(request: CreateReviewTaskRequest & {
  workerType: WorkerType;
  issueDescription?: string;
  planDocumentPath?: string;
}): string {
```

At the end of `buildReviewPrompt`, after the existing instructions, append:

```typescript
  if (request.issueDescription !== undefined) {
    lines.push(
      '',
      '### Issue Requirements',
      '',
      'The following is the Linear issue description. This defines what the implementation must achieve.',
      '',
      request.issueDescription,
    );

    if (request.planDocumentPath !== undefined) {
      lines.push(
        '',
        '### Plan Document',
        '',
        `Plan file path: ${request.planDocumentPath}`,
      );
    }
  }
```

Pass the new fields at the call site:

```typescript
  const prompt = buildReviewPrompt({
    ...request,
    workerType: effectiveWorkerType,
    issueDescription,
    planDocumentPath,
  });
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run apps/code-agent/src/domain/usecases/__tests__/createReviewTask.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/usecases/createReviewTask.ts apps/code-agent/src/domain/usecases/__tests__/createReviewTask.test.ts
git commit -m "feat(code-agent): embed issue description and plan path in review prompt"
```

---

### Task 4: Add requirements validation to review system prompt

Add mandatory instructions to the system prompt. The agent must validate implementation against the issue description (always present in the task prompt). When a plan document path is in the prompt, reading and validating against it is a hard gate.

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (reviewPrompt.build)
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Write failing test — requirements validation instructions present**

```typescript
it('includes requirements validation instructions in review prompt', () => {
  const result = reviewPrompt.build({
    ...baseParams,
    linearIssueId: 'INT-100',
  });

  expect(result).toContain('### Requirements Validation (MANDATORY');
  expect(result).toContain('Issue Requirements');
  expect(result).toContain('Plan Compliance');
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement requirements validation section**

In `workers/orchestrator/src/services/system-prompt.ts`, inside `reviewPrompt.build()`, replace the existing "Reading the Linear Issue" conditional block with a stronger version. After "### Review Scope" and before "### Gathering PR Context", add:

```typescript
### Requirements Validation (MANDATORY — NON-NEGOTIABLE)

The task prompt includes an "Issue Requirements" section containing the Linear issue description. This is the REQUIREMENTS SPECIFICATION for this PR. You MUST:

1. Read the "Issue Requirements" section in the task prompt
2. Compare every requirement against the PR implementation
3. Flag any deviation, missing requirement, or incomplete implementation as a 🔴 finding
4. Include a "Requirements Coverage" section in your review summary

When no separate plan document is referenced, the issue description IS the plan. Validate against it directly.

### Plan Compliance (MANDATORY HARD GATE when plan exists — NON-NEGOTIABLE)

If the task prompt includes a "Plan Document" section with a file path:

1. Read the plan file: \`cat /repo/<path from task prompt>\`
2. Compare EVERY section and requirement in the plan against the PR diff
3. For each plan item, classify as: ✅ implemented, ⚠️ partially implemented, or ❌ missing
4. Include the full mapping in a "Plan Compliance" section of your review summary
5. Flag any ❌ missing or ⚠️ partially implemented item as a 🔴 finding

This is a HARD GATE. If the plan file exists in the task prompt but cannot be read from /repo, report this as a blocking issue. Do NOT skip plan validation.

If no "Plan Document" section exists in the task prompt, skip this section — the issue description serves as the plan (see Requirements Validation above).
```

Remove the existing "Reading the Linear Issue" MCP instructions block (the `linearIssueId !== undefined` conditional that tells the agent to call `mcp__linear__get_issue`). The description is now in the prompt — no MCP fetch needed.

Keep the `linearIssueId` reference at the top of the prompt for Linear issue linking/metadata, but remove the MCP fetch instructions.

Bump version from `'4.0.0'` to `'5.0.0'` (major — behavioral change).

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
Expected: PASS (fix any existing tests that assert on the old MCP fetch block)

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): add mandatory requirements and plan validation to review prompt"
```

---

### Task 5: Full CI verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: PASS

- [ ] **Step 3: Commit any remaining fixes**

If CI reveals issues, fix and commit.
