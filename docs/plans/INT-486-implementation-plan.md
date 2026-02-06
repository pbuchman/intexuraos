# Implementation Plan: INT-486 Phase 1 Logic Refinement (Clean Break Strategy)

This plan covers Phase 1 of the INT-486 design, strictly enforcing the new Two-Phase Execution Model and Non-Interactive Mode with **NO backward compatibility**.

## User Review Required

> [!IMPORTANT]
> **Breaking Change**: This implementation enforces a "Clean Break" strategy.
>
> - Workflows for legacy issues/prompts are NOT supported.
> - The orchestrator will assume ALL tasks follow the new structure (e.g., Non-Interactive by default).
> - Older issues must be updated to the new template manually.

## Proposed Changes

### Logic Refinement: Orchestrator `workers/orchestrator`

> [!NOTE]
> **No Linear SDK in Orchestrator.** Labels and child info come from `code-agent`, not fetched by orchestrator.

#### [MODIFY] `src/services/task-dispatcher.ts`

- Update `submitTask` to accept `linearIssueLabels: string[]` from `code-agent` request.
- Pass `labels` to `buildSystemPrompt`.
- (No LinearClient instantiation - orchestrator does not call Linear directly).

#### [MODIFY] `src/services/system-prompt.ts`

- Update `buildSystemPrompt` signature to accept `hasChildren: boolean` and `linearIssueLabels: string[]`.
- **Logic:**
  - If `labels` MISSING `code-task`:
    - Inject `[PHASE 1: DESIGN & VALIDATION]` prompt.
    - Instruction: "Create `docs/plans/INT-${issueId}-design.md` with reasoning. Commit. Create PR. STOP."
  - If `labels` includes `code-task`:
    - Inject `[PHASE 2: STRICT EXECUTION]` prompt.
    - Enforce `NON-INTERACTIVE MODE`.
    - Enforce NO LIMITS on tokens/loops.
    - Inject `[PARENT EXECUTION MODE]` if `hasChildren` is true.
- Remove "but" and "however" from forbidden keywords list.

#### [MODIFY] `src/services/isolation/docker-provider.ts`

- Remove the concatenation of `systemPrompt` + `prompt`.
- Use `systemPrompt` exclusively.

## Verification Plan

### Automated Tests

- **System Prompt Tests:**
  - Update `src/services/__tests__/system-prompt.test.ts`.
  - Add test case: `should include PARENT sections when hasChildren is true`.
  - Add test case: `should include NON-INTERACTIVE banner`.
  - Add test case: `should NOT contain confirmation questions`.
  - Run: `pnpm run test workers/orchestrator`

### Verification Steps

1. **Build:** `pnpm build` (to ensure deps are linked/built).
2. **Test:** `pnpm run test workers/orchestrator`.
3. **CI:** `pnpm run ci:tracked`.

### Manual Validation

- Since this is a backend logic change for worker execution, automated unit tests on `system-prompt` are the primary validation method.
- We will verify that the generated prompt matches the expectation in the design doc.

---

## System Prompt Text (Exact)

### `[PHASE 1: DESIGN & VALIDATION]` Block

```markdown
[PHASE 1: DESIGN & VALIDATION]
You are an autonomous **Design Agent**. Your task is to analyze and plan the implementation for the assigned Linear issue.

**DO NOT EXECUTE CODE.** Your goal is to produce artifacts that clarify instructions for another agent to execute later.

### Mandatory Outputs

1.  **Updated Linear Issue:**
    - Ensure the issue description matches the Unified Issue Template (see `.claude/skills/linear/templates/unified-issue.md`).
    - Fill in all missing sections:
      - `## Test Requirements` (with table format)
      - `## Original User Instruction`
      - `## Summary`
      - `## Requirements` (Functional / Non-Functional)
      - `## Scope` (In Scope / Out of Scope)
      - `## Files to Modify`
      - `## Acceptance Criteria`

2.  **Design Document PR:**
    - Create file: `docs/plans/INT-${issueId}-design.md`
    - Content:
      - Summary of the task.
      - Detailed implementation steps.
      - Reasoning log (why certain choices were made).
      - List of files to modify.
      - Test plan summary.
    - Commit message: `[INT-${issueId}] Design plan`
    - Branch: `design/INT-${issueId}`
    - Create PR with description summarizing the plan.

3.  **Add `code-task` Label:** (CRITICAL)
    - Use Linear MCP: `mcp__linear__create_issue_label({ issueId: "${issueId}", labelName: "code-task" })`
    - This signals the issue is ready for Phase 2 execution.

### Completion Criteria

After creating the PR and adding the label, **STOP**. Do not proceed to implementation.
Output: `Phase 1 Complete. Design PR created. Label 'code-task' added. Awaiting review.`
```

---

### Linear-Agent Changes (Prerequisite)

> [!CAUTION]  
> **Verified Gap:** `validateIssue` endpoint does NOT currently return labels or children.  
> The `LinearIssueWithTeam` type only includes: `id`, `identifier`, `title`, `description`, `priority`, `state`, `url`, `timestamps`, `teamId`.

#### [MODIFY] `apps/linear-agent/src/domain/models.ts`

Add labels and childCount to `LinearIssueWithTeam`:

```typescript
export interface LinearIssueWithTeam extends LinearIssue {
  teamId: string;
  labels: string[]; // NEW
  childCount: number; // NEW
}
```

#### [MODIFY] `apps/linear-agent/src/infra/linear/linearApiClient.ts`

Update `mapSingleIssueWithTeam` to fetch labels and children:

```typescript
async function mapSingleIssueWithTeam(issue: Issue): Promise<LinearIssueWithTeam> {
  const state = await issue.state;
  const team = await issue.team;
  const labelsConnection = await issue.labels(); // NEW
  const labels = labelsConnection.nodes.map((l) => l.name); // NEW

  // Query children
  const client = getOrCreateClient(apiKey); // need to pass apiKey
  const children = await client.issues({
    filter: { parent: { id: { eq: issue.id } } },
    first: 1,
  });
  const childCount = children.nodes.length; // NEW

  return {
    // ... existing fields ...
    labels, // NEW
    childCount, // NEW
  };
}
```

#### [MODIFY] `apps/linear-agent/src/routes/internalRoutes.ts`

Update response schema for `/internal/linear/issues/:identifier` to include labels and childCount.

---

### Code-Agent Changes

> [!IMPORTANT]
> **Files identified for modification:**
>
> - `apps/code-agent/src/domain/ports/linearAgentClient.ts`
> - `apps/code-agent/src/domain/services/linearIssueService.ts`
> - `apps/code-agent/src/domain/services/taskDispatcher.ts`

#### [MODIFY] `linearAgentClient.ts`

Update `ValidatedIssue` interface:

```typescript
export interface ValidatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[]; // NEW
  childCount: number; // NEW
}
```

#### [MODIFY] `linearIssueService.ts`

Update `EnsureIssueResult` interface:

```typescript
export interface EnsureIssueResult {
  linearIssueId?: string;
  linearIssueTitle: string;
  linearIssueType?: LinearIssueType;
  linearFallback: boolean;
  linearIssueLabels: string[]; // NEW (from validated.labels)
  hasChildren: boolean; // NEW (validated.childCount > 0)
}
```

#### [MODIFY] `taskDispatcher.ts`

Update `DispatchRequest` interface:

```typescript
export interface DispatchRequest {
  taskId: string;
  linearIssueId?: string;
  linearIssueLabels: string[]; // NEW
  hasChildren: boolean; // NEW
  prompt: string;
  // ... rest unchanged
}
```

---

### `[PHASE 2: STRICT EXECUTION]` Block

```markdown
[PHASE 2: STRICT EXECUTION]
You are in **NON-INTERACTIVE MODE**. Execute the task autonomously.

### Mandatory First Action

/linear ${linearIssueId}

### Post-Skill Execution

Follow all instructions from the Linear issue description and any additional user instructions provided below.

### Execution Rules

1.  **No Confirmation Prompts:** Do NOT ask "Should I commit?", "Ready to push?", etc.
2.  **Complete Checkpoints Autonomously:**
    - Write tests (from Test Requirements).
    - Implement code (from Requirements).
    - Run `pnpm run ci:tracked`.
    - Commit if CI passes.
    - Push to remote.
    - Create PR.
    - Update Linear to "In Review".
3.  **On CI Failure:** Fix the issue, re-run CI, continue. Stop only if unable to resolve after 3 attempts.

### Resource Limits

**NONE.** Complete the task regardless of token usage.
```

---

## Linear Skill Modifications

### [MODIFY] `.claude/skills/linear/SKILL.md`

> [!NOTE]
> **Skill is NOT context-aware.** The difference between orchestrator and CLI execution is that the orchestrator's system prompt provides complete context (issue description, test requirements, etc.) _before_ invoking `/linear`. The skill itself does NOT detect or branch on execution context.

**Changes to SKILL.md:**

1. Remove any rules that assume interactive behavior is always required.
2. Update workflows to execute based on the context provided in the prompt.
3. Remove redundant "Automatic Completion (NO ASKING)" rule (now handled by Phase 2 system prompt).
4. **Remove confirmation prompts from workflows.** When invoked, skill proceeds smoothly with execution without asking.

### [NEW] `.claude/skills/linear/templates/unified-issue.md`

Create template based on the design doc template. This file will be referenced by Phase 1 agent.
**Content source:** Copy from design doc section "Unified Linear Issue Template".

---

## Linear Skill Cleanup (Outdated Content)

### [DELETE] `templates/issue-description.md`

**Reason:** Superseded by `unified-issue.md`. Contains same sections but is now redundant and could cause confusion.

### [UPDATE] `templates/subtask-description.md`

**Changes:**

- Remove embedded execution rules (lines 49-111). These are now handled by the `[PHASE 2: STRICT EXECUTION]` system prompt.
- Add reference: "See parent issue and system context for execution rules."
- Keep structural template (Test Requirements, Context, Scope, Requirements, Acceptance Criteria).

### [UPDATE] `SKILL.md`

**Changes:**

- Add Non-Interactive Mode Detection section (as specified above).
- Remove or update "Automatic Completion (NO ASKING)" rule (now redundant, handled by Phase 2 prompt).
- Clarify that template validation is Phase 1, execution is Phase 2.

### [REVIEW] Workflows

All workflows in `workflows/` should be reviewed to ensure they do NOT include interactive confirmation prompts. Key files:

- `work-existing.md`
- `parent-execution.md`
- `create-issue.md`

**Goal:** Ensure workflows defer to the system prompt for execution behavior (interactive vs non-interactive).
