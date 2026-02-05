# INT-486: Unified Linear Issue Templates & Two-Phase Execution Model

**Status:** DRAFT - Design Phase
**Created:** 2026-02-05
**Author:** Claude (with user Piotr Buchman)
**Reviewers:** External Architect (pending)

---

## Executive Summary

This document defines a unified template system for Linear issues and a two-phase execution model that enables both specialized agents (Opus) and non-specialized agents to execute tasks reliably in IntexuraOS.

**Core Principle:** The Linear skill must allow non-specialized agents to execute tasks by providing complete context. The two-phase model separates design/validation (requires deep thinking) from execution (follows explicit instructions).

**Problem Statement:**

- Current Linear issue templates are inconsistent
- Worker system prompt has ambiguities
- No validation gate before execution
- Parent->child workflow not handled in non-interactive mode

**Solution:**

1. Unified Linear issue template (strict format, agent-agnostic)
2. Two-phase execution: Design/Validation → Execution
3. Non-interactive mode for /linear skill
4. Improved worker system prompt
5. Parent->child workflow support in orchestrator

---

## Endpoint Changes

| Service      | Method | Path                                  | Change                                                      |
| ------------ | ------ | ------------------------------------- | ----------------------------------------------------------- |
| linear-agent | GET    | `/internal/linear/issues/:identifier` | Add `labels: string[]` and `childCount: number` to response |

**Breaking Change:** This is a backward-incompatible change to an internal API contract. The `labels` and `childCount` fields are now included in all responses. Internal consumers must be updated to handle these new fields.

---

## Table of Contents

1. [Two-Phase Execution Model](#two-phase-execution-model)
2. [Unified Linear Issue Template](#unified-linear-issue-template)
3. [Non-Interactive /linear Skill](#non-interactive-linear-skill)
4. [Worker System Prompt Fixes](#worker-system-prompt-fixes)
5. [Parent->Child Workflow](#parentchild-workflow)
6. [Implementation Plan](#implementation-plan)
7. [Validation & Enforcement](#validation--enforcement)

---

## Two-Phase Execution Model

### Philosophy

**Goal:** Enable specialized agents to design/validate, then allow non-specialized agents to execute.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TWO-PHASE EXECUTION                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1: DESIGN & VALIDATION (Specialized Agent - Opus)          │
│  ─────────────────────────────────────────────────────────────────   │
│  • Validate Linear issue follows template                            │
│  • If NOT valid: STOP, report what's missing, iterate with user    │
│  • If valid: Proceed to execution phase                              │
│  • Requires: Deep thinking, design skills, user interaction         │
│                                                                      │
│                           ↓ (Issue Validated)                         │
│                                                                      │
│  PHASE 2: EXECUTION (Any Agent - Non-Specialized OK)              │
│  ─────────────────────────────────────────────────────────────────   │
│  • Follow explicit instructions from validated issue                 │
│  • Execute code changes, tests, PR creation                           │
│  • Complete autonomously (non-interactive mode)                      │
│  • Requires: Following instructions, not design skills              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Matters

| Aspect           | Phase 1 (Design)            | Phase 2 (Execution)              |
| ---------------- | --------------------------- | -------------------------------- |
| Agent Capability | Deep thinking, design       | Can follow instructions          |
| User Interaction | High (iteration)            | None (autonomous)                |
| Failure Mode     | Stop, report gap            | Stop on error only               |
| Key Skill        | Identifying missing context | Implementing specified artifacts |

### Phase 1: Design & Validation (Default)

**Trigger:** Issue assigned to worker WITHOUT `code-task` label.

**Goal:** Produce a complete execution plan and update the Linear issue.

**Output Artifacts:**

1.  **Updated Linear Issue:** Fill in `Test Requirements`, `Files to Modify`, etc.
2.  **Design PR:** Create a PR containing ONLY `docs/plans/INT-XXX-design.md` with the reasoning log.

**Agent Behavior:**

- Analyze the request.
- Iterate on design (internally).
- Update Linear description with the strict template.
- Create branch `design/INT-XXX`.
- Commit `docs/plans/INT-XXX-design.md`.
- Create PR.
- **STOP.** (Do not execute code).

**Agent:** Specialized (Opus recommended for deep analysis)

### Quality Checks

- [ ] Test Requirements table is complete (not "add tests later")
- [ ] Each test has: Name, Function, Scenario, Expected
- [ ] Requirements are specific (not "investigate and fix")
- [ ] Acceptance criteria are measurable
- [ ] Dependencies explicitly listed
- [ ] Scope is bounded (In Scope / Out of Scope)

### Context Completeness

- [ ] Files to modify listed (if code change)
- [ ] Technical context provided (if needed)
- [ ] Related issues/PRs linked (if applicable)

### Validation Outcome

**PASS:** Proceed to Phase 2 (Execution)

**FAIL:**

1. STOP execution
2. Report missing sections with specifics
3. DO NOT create any code
4. Wait for user to update issue or provide override

**OVERRIDE:**
User may explicitly override with: "Execute anyway" or "Skip validation"

````

### Phase 2: Execution (Strict)

**Trigger:** Issue assigned to worker WITH `code-task` label.

**Pre-requisite:** Phase 1 complete (or issue manually created with all sections).

**Execution Mode:** NON-INTERACTIVE

```markdown
## Phase 2: Autonomous Execution

**Agent:** Any (Opus, Sonnet, Haiku - all can execute)

### Execution Rules

1.  **Validation:** Check if issue has `code-task` label. If missing -> STOP (or fallback to Phase 1 logic if safe).
2.  **Follow Instructions:** Execute strictly based on the issue description.
3.  **Complete Checkpoints:**
    -   Write tests (from Test Requirements)
    -   Implement code (from Requirements)
    -   Run CI (pnpm run ci:tracked)
    -   Commit if CI passes
    -   Push to remote
    -   Create PR
    -   Update Linear to "In Review"

### Resource Limits
**NONE.** The user has explicitly accepted the risk of high token usage/loops to ensure completion of complex tasks.

### Forbidden in Phase 2

- ❌ Asking "Should I implement X?"
- ❌ Asking "Ready to commit?"
- ❌ Asking for clarification on scope
- ❌ Adding "smart improvements" not in scope
````

---

## Unified Linear Issue Template

### Design Principles

1. **Agent-Agnostic:** Any agent reading this issue should understand what to do
2. **Complete Context:** All information needed for execution must be in the issue
3. **Validatable:** Machine-readable checklist for validation
4. **Bounded Scope:** Clear In/Out lists prevent scope creep

### The Template

```markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests (`apps/<service>/src/__tests__/`):**

| Test Name | Endpoint/Function | Scenario          | Expected          |
| --------- | ----------------- | ----------------- | ----------------- |
| <name>    | <what is tested>  | <input/condition> | <output/behavior> |
| ...       | ...               | ...               | ...               |

**Frontend Tests (if applicable):**

- <test case 1>
- <test case 2>

---

## Original User Instruction

> <verbatim user input - preserve exactly as received>

_Preserve typos, grammar, raw phrasing. This is the source of truth._

---

## Summary

<1-2 sentence summary of what needs to be done>

---

## Requirements

### Functional Requirements

- <Requirement 1>
- <Requirement 2>
- <Requirement 3>

### Non-Functional Requirements

- <Performance requirement, if applicable>
- <Security requirement, if applicable>
- <Compatibility requirement, if applicable>

---

## Scope

### In Scope

- <Specific deliverable 1>
- <Specific deliverable 2>
- <Specific file(s) to modify>

### Out of Scope (DO NOT)

- <Explicit exclusion 1>
- <Explicit exclusion 2>
- <Related work that should NOT be included>

---

## Files to Modify

**Primary Changes:**

- `path/to/file1.ts` - <what changes expected>

**Secondary Changes (if needed):**

- `path/to/file2.ts` - <what changes expected>

**Tests to Add/Modify:**

- `path/to/test/file.test.ts` - <what tests needed>

---

## Acceptance Criteria

- [ ] All tests in Test Requirements table pass
- [ ] `pnpm run ci:tracked` passes (all 4 checks)
- [ ] PR created with issue ID in title: `[INT-XXX] Description`
- [ ] Linear state updated to "In Review"
- [ ] <Specific criterion 1>
- [ ] <Specific criterion 2>
- [ ] <Specific criterion 3>

---

## Dependencies

**Blocked By:**

- [INT-XXX](url) - <why this blocks current work>

**Blocks:**

- [INT-XXX](url) - <what this enables>

---

## Technical Context

<Provide any architecture notes, constraints, or background needed for implementation>

**Example:**

- Uses Firestore collection: `items`
- Requires API: `POST /internal/process`
- Dependent on: `@intexuraos/common-types` package

---

## Related

- **Parent Issue:** [INT-XXX](url)
- **Sentry:** [Issue Title](url) (if applicable)
- **Documentation:** [Doc Link](url)

---

## Execution Notes (Optional)

<Additional context for execution phase - hints, gotchas, implementation preferences>
```

### Required Sections (All Issues)

| Section                   | Required?   | Validation Rule                                    |
| ------------------------- | ----------- | -------------------------------------------------- |
| Test Requirements         | YES         | Table format, at least 1 test row                  |
| Original User Instruction | YES         | Blockquote format present                          |
| Summary                   | YES         | 1-2 sentences, not empty                           |
| Requirements              | YES         | At least 1 bullet                                  |
| Acceptance Criteria       | YES         | At least 3 checkboxes, includes tests/CI/PR/Linear |
| Scope                     | YES         | In Scope list present                              |
| Files to Modify           | Conditional | Required for code changes                          |
| Dependencies              | Conditional | Required if blocked/blocks exist                   |
| Technical Context         | Optional    | N/A                                                |
| Related                   | Optional    | N/A                                                |

### Conditional Rules

```
IF issue involves code changes:
  THEN "Files to Modify" is REQUIRED
  AND "Technical Context" is RECOMMENDED

IF issue has dependencies:
  THEN "Dependencies" section is REQUIRED

IF issue is part of parent/child hierarchy:
  THEN "Related" section MUST include parent/child links
```

---

## Non-Interactive /linear Skill

### Current State

The `/linear` skill assumes interactive execution:

- Asks user for clarification
- Pauses at checkpoints
- Expects confirmation before proceeding

### Required Changes

**Detection:** `/linear` must detect execution context:

```typescript
// In SKILL.md or workflow files
interface ExecutionContext {
  mode: 'interactive' | 'non-interactive';
  source: 'cli' | 'worker' | 'code-agent';
}

function detectExecutionContext(): ExecutionContext {
  // If called from worker/code-agent: non-interactive
  // If called from CLI by user: interactive
}
```

**Behavior Changes:**

| Situation                       | Current (Interactive) | New (Non-Interactive)       |
| ------------------------------- | --------------------- | --------------------------- |
| Issue missing Test Requirements | Ask user to add       | STOP, report error          |
| Unclear requirement             | Ask for clarification | STOP, report what's unclear |
| Before committing               | Ask "commit?"         | Auto-commit if CI passes    |
| Before creating PR              | Ask "create PR?"      | Auto-create PR              |
| CI failure                      | Ask how to proceed    | Fix, retry, continue        |

**Non-Interactive Mode Rules:**

```markdown
## Non-Interactive Execution Mode

When invoked from worker/code-agent, /linear operates in NON-INTERACTIVE mode:

### Validation Phase

- Check issue template completeness
- If invalid: STOP with specific error
- If valid: proceed to execution

### Execution Phase

- No user prompts
- No confirmations
- All checkpoints automatic
- Only stop on unrecoverable error

### Forbidden

- ❌ "Would you like me to commit?"
- ❌ "Should I create a PR?"
- ❌ "How should I handle X?"
- ❌ Any question that requires user input

### Required

- ✅ Automatic checkpoint completion
- ✅ CI failure → fix → retry
- ✅ Report completion with cross-links
```

---

## Worker System Prompt Fixes

### Current Issues

| #   | Issue                               | Location                 | Severity |
| --- | ----------------------------------- | ------------------------ | -------- |
| 1   | Double prompt (sanitization bypass) | `docker-provider.ts:224` | HIGH     |
| 2   | No parent issue handling            | `system-prompt.ts`       | HIGH     |
| 3   | Branch check not emphasized         | `system-prompt.ts`       | HIGH     |
| 4   | No CI failure handling              | `system-prompt.ts`       | MEDIUM   |
| 5   | "but/however" in forbidden keywords | `system-prompt.ts`       | LOW      |
| 6   | No NON-INTERACTIVE declaration      | `system-prompt.ts`       | HIGH     |

### Proposed System Prompt Structure

```typescript
/**
 * Build system prompt for worker execution.
 *
 * @param params - Task parameters
 * @param hasChildren - Whether the Linear issue has child subtasks
 * @returns Complete system prompt for non-interactive execution
 */
export function buildSystemPrompt(params: SystemPromptParams, hasChildren: boolean = false): string;
```

### New System Prompt Template

````markdown
[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS running in Docker isolation.
⚠️ NON-INTERACTIVE MODE: Execute automatically. NEVER ask for confirmation.

Task ID: ${taskId}
Worktree: ${worktreePath}
Linear Issue: ${linearIssueId}
Repository: ${repository}
Base Branch: ${baseBranch}

---

[PHASE 1: PRE-FLIGHT VALIDATION]

Before ANY code changes, complete these steps in order:

1. **Check Current Branch** (CRITICAL - prevents development commits):
   ```bash
   git branch --show-current
   ```
````

✅ OK: On feature branch (contains INT-)
❌ FAIL: On 'development' or 'main' → STOP → Create branch first

```bash
git fetch origin
git checkout -b fix/INT-${issueId} origin/development
```

2. **Check for Child Issues** (determines workflow):

   ```javascript
   // Call Linear MCP
   mcp__linear__list_issues({ parentId: '${parentUuid}', team: 'IntexuraOS' });
   ```

   ✅ Children exist → Use PARENT EXECUTION MODE (see below)
   ✅ No children → Use STANDARD WORKFLOW

3. **Update Linear State** (signals work started):
   ```javascript
   mcp__linear__update_issue({ id: '${issueId}', state: 'In Progress' });
   ```

---

${hasChildren ? PARENT_EXECUTION_MODE : STANDARD_WORKFLOW}

---

[REQUIREMENTS - NON-NEGOTIABLE]

1. **CLAUDE.md Instructions** - Read and follow ALL rules in worktree CLAUDE.md
2. **Test-First Development** - Write failing test BEFORE implementation code
3. **CI Gate** - `pnpm run ci:tracked` MUST pass before commit/push
4. **Automatic Completion** - After implementation: CI → commit → push → PR → "In Review"

---

[CI FAILURE HANDLING]

When `pnpm run ci:tracked` fails:

1. Capture: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-fail.txt`
2. Analyze: `bat /tmp/ci-fail.txt` or `rg "error|FAIL" /tmp/ci-fail.txt -C3`
3. Fix: ALL errors (even in other workspaces - ownership mindset)
4. Retry: Re-run CI until it passes
5. Continue: Only commit/push after CI passes

---

[EXECUTION CHECKLIST]

After completing work:

- [ ] All Test Requirements implemented
- [ ] pnpm run ci:tracked passes (all 4 checks)
- [ ] Changes committed with [INT-${issueId}] prefix
- [ ] Pushed to remote
- [ ] PR created with [INT-${issueId}] in title
- [ ] PR description complete with required sections
- [ ] Linear state updated to "In Review"
- [ ] PR attached to Linear issue (verify in Linear UI)

---

[TASK]

${sanitizedPrompt}

---

[END OF PROMPT]

Execute automatically. Complete all checkpoints. NEVER ask for confirmation.

````

### Parent Execution Mode Section

```markdown
[PARENT EXECUTION MODE]

This issue has ${childCount} child subtasks. Use parent workflow:

**Branch:** Single branch for ALL children: ${parentBranchName}
**PR:** Single PR for parent, updated after each child
**Execution:** Execute ALL children continuously without stopping

**After Each Child:**
1. Commit: `git commit -m "INT-${childId}: ${description}"`
2. Push: `git push`
3. Update PR description: mark child ✅, add to progress log
4. Continue to next child immediately (NO announcements)

**After ALL Children Complete:**
1. Update PR description with final status
2. Update Linear parent state to "In Review"
3. Report completion with summary of all children

**Child Order:** Execute by tier number (tier-0 → tier-1 → tier-2)
````

### Standard Workflow Section

```markdown
[STANDARD WORKFLOW]

**Branch:** Create feature branch: `fix/INT-${issueId}` from origin/development
**PR:** One PR for this issue
**Execution:** Complete requirements, then create PR

**After Implementation:**

1. Run CI: `pnpm run ci:tracked`
2. Commit with issue ID in message
3. Push to remote
4. Create PR with issue ID in title
5. Update Linear state to "In Review"
```

---

## Parent->Child Workflow

### Current Gap

The orchestrator creates a worker with a single system prompt, but:

- No detection of whether the Linear issue has children
- No special handling for parent execution mode
- Worker may create multiple branches/PRs instead of one

### Proposed Flow

```
┌─────────────────┐
│  code-agent     │
│  receives task   │
│  with linearId   │
└──────┬──────────┘
       │
       ▼
┌─────────────────────────┐
│  orchestrator            │
│                           │
│  1. Fetch issue details   │
│     mcp__linear__get_issue│
│                           │
│  2. Check for children    │
│     mcp__linear__list_issues│
│     (parentId: issueId)   │
│                           │
│  3. Build system prompt   │
│     with hasChildren flag  │
└──────┬────────────────────┘
       │
       ▼
┌─────────────────────────┐
│  docker-provider        │
│                           │
│  const systemPrompt =    │
│    buildSystemPrompt(   │
│      params,             │
│      hasChildren         │
│    )                     │
│                           │
│  const fullPrompt =      │
│    systemPrompt          │
│  // No duplicate prompt! │
└──────┬────────────────────┘
       │
       ▼
┌─────────────────────────┐
│  claude-worker          │
│  (Docker container)     │
│                           │
│  - Receives fullPrompt   │
│  - Detects children      │
│    from system prompt    │
│  - Executes workflow     │
└─────────────────────────┘
```

### Orchestrator Changes Required

**File:** `workers/orchestrator/src/services/task-dispatcher.ts`

```typescript
async dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
  // ... existing code ...

  // NEW: Check for child issues before building prompt
  let hasChildren = false;
  let childCount = 0;

  if (request.linearIssueId !== undefined) {
    // Fetch issue to get UUID
    const issueResult = await this.linearClient.getIssue(request.linearIssueId);
    if (issueResult.ok) {
      const issue = issueResult.value;

      // Check for children
      const childrenResult = await this.linearClient.listIssues({
        parentId: issue.id,
        team: 'IntexuraOS',
        limit: 20
      });

      if (childrenResult.ok && childrenResult.value.length > 0) {
        hasChildren = true;
        childCount = childrenResult.value.length;
      }
    }
  }

  // Build system prompt with hasChildren flag
  const systemPrompt = buildSystemPrompt({
    taskId: request.taskId,
    worktreePath: worktreePath,
    linearIssueId: request.linearIssueId,
    prompt: request.prompt,
    repository: request.repository,
    baseBranch: request.baseBranch,
  }, hasChildren);

  // Remove the double prompt issue - use systemPrompt only
  const fullPrompt = systemPrompt;

  // ... rest of dispatch logic ...
}
```

**File:** `workers/orchestrator/src/services/system-prompt.ts`

```typescript
export interface SystemPromptParams {
  taskId: string;
  worktreePath: string;
  linearIssueId?: string;
  prompt: string;
  repository: string;
  baseBranch: string;
}

export function buildSystemPrompt(
  params: SystemPromptParams,
  hasChildren: boolean = false
): string {
  const { taskId, worktreePath, linearIssueId, prompt, repository, baseBranch } = params;
  const sanitizedPrompt = sanitizePrompt(prompt);

  // Select workflow section based on hasChildren
  const workflowSection = hasChildren
    ? PARENT_EXECUTION_MODE(linearIssueId!)
    : STANDARD_WORKFLOW(linearIssueId!);

  const systemPrompt = `[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS running in Docker isolation.
⚠️ NON-INTERACTIVE MODE: Execute automatically. NEVER ask for confirmation.

Task ID: ${taskId}
Worktree: ${worktreePath}
${linearIssueId ? `Linear Issue: ${linearIssueId}` : ''}
Repository: ${repository}
Base Branch: ${baseBranch}

---

[PHASE 1: PRE-FLIGHT VALIDATION]

Before ANY code changes, complete these steps in order:

1. **Check Current Branch** (CRITICAL - prevents development commits):
   git branch --show-current
   ✅ OK: On feature branch (contains INT-)
   ❌ FAIL: On 'development' or 'main' → Create branch first:
   git fetch origin && git checkout -b fix/INT-${linearIssueId || 'task'} origin/development

2. **Check for Child Issues** (already done - ${hasChildren ? 'PARENT MODE' : 'STANDARD MODE'}):
   ${hasChildren ? `Use PARENT EXECUTION MODE (see below)` : `Use STANDARD WORKFLOW (see below)`}

3. **Update Linear State** (signals work started):
   Call mcp__linear__update_issue with state "In Progress"

---

${workflowSection}

---

[REQUIREMENTS - NON-NEGOTIABLE]

1. **CLAUDE.md Instructions** - Read and follow ALL rules in worktree CLAUDE.md
2. **Test-First Development** - Write failing test BEFORE implementation code
3. **CI Gate** - pnpm run ci:tracked MUST pass before commit/push
4. **Automatic Completion** - After implementation: CI → commit → push → PR → "In Review"

---

[CI FAILURE HANDLING]

When pnpm run ci:tracked fails:
1. Capture: pnpm run ci:tracked 2>&1 | tee /tmp/ci-fail.txt
2. Analyze: bat /tmp/ci-fail.txt or rg "error|FAIL" /tmp/ci-fail.txt -C3
3. Fix: ALL errors (even in other workspaces - ownership mindset)
4. Retry: Re-run CI until it passes
5. Continue: Only commit/push after CI passes

---

[EXECUTION CHECKLIST]

After completing work:
- [ ] All Test Requirements implemented
- [ ] pnpm run ci:tracked passes (all 4 checks)
- [ ] Changes committed with [INT-${linearIssueId || 'task'}] prefix
- [ ] Pushed to remote
- [ ] PR created with [INT-${linearIssueId || 'task'}] in title
- [ ] PR description complete with required sections
- [ ] Linear state updated to "In Review"
- [ ] PR attached to Linear issue (verify in Linear UI)

---

[TASK]

${sanitizedPrompt}

---

[END OF PROMPT]

Execute automatically. Complete all checkpoints. NEVER ask for confirmation.`;

  return systemPrompt.length > MAX_PROMPT_LENGTH
    ? systemPrompt.slice(0, MAX_PROMPT_LENGTH)
    : systemPrompt;
}

// Helper workflow sections
function STANDARD_WORKFLOW(issueId: string): string {
  return `[STANDARD WORKFLOW]

**Branch:** Create feature branch: \`fix/INT-${issueId}\` from origin/development
**PR:** One PR for this issue
**Execution:** Complete requirements, then create PR

**After Implementation:**
1. Run CI: \`pnpm run ci:tracked\`
2. Commit with issue ID in message
3. Push to remote
4. Create PR with issue ID in title
5. Update Linear state to "In Review"`;
}

function PARENT_EXECUTION_MODE(issueId: string): string {
  return `[PARENT EXECUTION MODE]

This Linear issue has child subtasks. Use parent workflow:

**Branch:** Single branch for ALL children: \`feature/INT-${issueId}\`
**PR:** Single PR for parent, updated after each child
**Execution:** Execute ALL children continuously without stopping

**After Each Child:**
1. Commit with child issue ID: \`git commit -m "INT-\\${childId}: description"\`
2. Push: \`git push\`
3. Update PR description: mark child ✅, add to progress log
4. Continue to next child immediately (NO announcements, NO "Next Step:" messages)

**After ALL Children Complete:**
1. Update PR description with final status
2. Update Linear parent state to "In Review"
3. Report completion with summary of all children

**Child Order:** Execute by tier number (tier-0 → tier-1 → tier-2)
**IMPORTANT:** Your next tool call after completing a child MUST be starting the next child. Do NOT output "Next Step:" - this ends your turn.`;
}
```

---

## Implementation Plan

### Phase 1: Foundation (Critical Fixes)

| Task                            | File                 | Change                                               |
| ------------------------------- | -------------------- | ---------------------------------------------------- |
| Fix double prompt               | `docker-provider.ts` | Use `systemPrompt` only, not `systemPrompt + prompt` |
| Add hasChildren detection       | `task-dispatcher.ts` | Query Linear API for children before building prompt |
| Add parent/standard workflows   | `system-prompt.ts`   | Separate workflow sections                           |
| Remove "but/however" keywords   | `system-prompt.ts`   | Update FORBIDDEN_KEYWORDS array                      |
| Add NON-INTERACTIVE declaration | `system-prompt.ts`   | Add to system context                                |
| Emphasize branch check          | `system-prompt.ts`   | Move to PRE-FLIGHT section                           |

### Phase 2: Template Validation

| Task                      | Component    | Description                                    |
| ------------------------- | ------------ | ---------------------------------------------- |
| Validation function       | Linear skill | Check all required sections present            |
| Validation error messages | Linear skill | Specific feedback on what's missing            |
| Stop on invalid issue     | Linear skill | Don't proceed to execution if validation fails |
| User override mechanism   | Linear skill | Allow "Execute anyway" to bypass               |

### Phase 3: /linear Skill Non-Interactive Mode

| Task                     | Component              | Description                                  |
| ------------------------ | ---------------------- | -------------------------------------------- |
| Detect execution context | Linear skill           | Determine if running in worker vs CLI        |
| Remove user prompts      | Linear skill workflows | Eliminate "Should I?" style questions        |
| Auto-completion          | Linear skill workflows | Commit → push → PR → In Review automatically |
| Update templates         | Linear skill templates | Add non-interactive variant guidance         |

### Phase 4: Testing & Documentation

| Task                   | Description                                   |
| ---------------------- | --------------------------------------------- |
| System prompt tests    | Test both standard and parent execution modes |
| Validation tests       | Ensure all required sections checked          |
| E2E worker tests       | Verify full flow with parent/child issues     |
| Update CLAUDE.md       | Document new execution model                  |
| Update Linear SKILL.md | Add non-interactive mode documentation        |

---

## Validation & Enforcement

### Template Validation Rules

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  section: string;
  message: string;
  severity: 'error' | 'warning';
}

function validateLinearIssue(issue: LinearIssue): ValidationResult {
  const errors: ValidationError[] = [];

  // Check Test Requirements
  if (!issue.description.includes('## Test Requirements')) {
    errors.push({
      section: 'Test Requirements',
      message: 'Missing ## Test Requirements section (MANDATORY)',
      severity: 'error',
    });
  }

  // Check for table format in Test Requirements
  const desc = issue.description;
  const testRequirementsMatch = desc.match(/## Test Requirements[\s\S]*?\n\n/);
  if (testRequirementsMatch) {
    const testSection = testRequirementsMatch[0];
    if (!testSection.includes('|') || !testSection.includes('Test Name')) {
      errors.push({
        section: 'Test Requirements',
        message:
          'Test Requirements must be in table format with columns: Test Name, Endpoint/Function, Scenario, Expected',
        severity: 'error',
      });
    }
  }

  // Check other required sections...
  // (similar checks for Original User Instruction, Summary, etc.)

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  };
}
```

### Enforcement Points

| Point           | When                         | Action on Fail                        |
| --------------- | ---------------------------- | ------------------------------------- |
| Issue creation  | `/linear <desc>`             | Validate template, warn if incomplete |
| Worker dispatch | `task-dispatcher.dispatch()` | Validate before creating worker       |
| Pre-commit hook | `git commit`                 | Check linked issues follow template   |
| CI pipeline     | `pnpm run ci`                | Optional: lint issue descriptions     |

---

## Open Questions

| Question                               | Context                        | Decision Needed                          |
| -------------------------------------- | ------------------------------ | ---------------------------------------- |
| Should validation be blocking?         | Worker can't wait for user     | Yes - stop and report error              |
| How to handle existing invalid issues? | Grandfather clause             | Allow override, warn on use              |
| Should we add "code-task" label?       | Routing/identification         | Yes - helps identify worker-ready issues |
| Max prompt length?                     | Current 4000 chars             | Keep 4000, make truncation smart         |
| Parent issue child limit?              | How many children is too many? | 20 is current MCP limit, use that        |

---

## Appendix A: Example Valid Issue

```markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests (`apps/code-agent/src/__tests__/infra/services/taskDispatcher.test.ts`):**

| Test Name                              | Endpoint/Function   | Scenario                          | Expected                               |
| -------------------------------------- | ------------------- | --------------------------------- | -------------------------------------- |
| system prompt includes NON-INTERACTIVE | buildSystemPrompt() | hasChildren=false, code-task mode | Contains "NON-INTERACTIVE MODE"        |
| parent execution mode detected         | buildSystemPrompt() | hasChildren=true                  | Contains PARENT_EXECUTION_MODE section |
| branch check emphasized                | buildSystemPrompt() | Any mode                          | PRE-FLIGHT section before GIT WORKFLOW |

**Frontend Tests:** N/A

---

## Original User Instruction

> We need to fix the worker system prompt to be non-interactive and handle parent issues properly.

---

## Summary

Update the worker system prompt to support non-interactive execution mode and properly handle Linear issues with child subtasks.

---

## Requirements

### Functional Requirements

- Add NON-INTERACTIVE declaration to system context
- Add PRE-FLIGHT VALIDATION section before any git operations
- Detect parent issues (hasChildren) and use appropriate workflow
- Remove "but" and "however" from forbidden keywords
- Fix double prompt issue in docker-provider

### Non-Functional Requirements

- System prompt must remain under 4000 characters
- Must be backward compatible with existing worker flow
- Must support both standard and parent execution modes

---

## Scope

### In Scope

- `workers/orchestrator/src/services/system-prompt.ts` - Refactor prompt generation
- `workers/orchestrator/src/services/isolation/docker-provider.ts` - Fix double prompt
- `workers/orchestrator/src/services/task-dispatcher.ts` - Add child detection

### Out of Scope (DO NOT)

- Modifying Linear skill workflows (separate issue)
- Changing issue templates (separate issue)
- Adding new validation infrastructure (separate issue)

---

## Files to Modify

**Primary Changes:**

- `workers/orchestrator/src/services/system-prompt.ts` - Add workflow variants, hasChildren parameter

**Secondary Changes:**

- `workers/orchestrator/src/services/isolation/docker-provider.ts` - Remove duplicate prompt
- `workers/orchestrator/src/services/task-dispatcher.ts` - Add Linear API calls for child detection

**Tests to Add/Modify:**

- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts` - Test all variants

---

## Acceptance Criteria

- [ ] All tests in Test Requirements table pass
- [ ] `pnpm run ci:tracked` passes (all 4 checks)
- [ ] PR created with [INT-486] in title
- [ ] Linear state updated to "In Review"
- [ ] Non-interactive mode explicitly declared in prompt
- [ ] Parent execution mode works for issues with children
- [ ] Double prompt issue resolved
- [ ] "but/however" removed from forbidden keywords

---

## Dependencies

**Blocked By:** None

**Blocks:**

- [INT-XXX] Linear skill non-interactive mode updates

---

## Technical Context

The worker system prompt is currently built for interactive execution but runs in a non-interactive Docker container. This causes:

- Workers stopping to ask for confirmation that never comes
- No handling of parent issues with children
- Ambiguous instructions leading to development commits

The orchestrator has access to Linear API and can detect child issues before building the system prompt.

---

## Related

- **Issue:** INT-486
- **Parent:** N/A
```

---

## Document Metadata

**Issue:** INT-486
**Status:** DRAFT - Pending Architect Review
**Version:** 2.0 (Refactored for 2-phase execution model)
**Last Updated:** 2026-02-05

**Key Changes from v1.0:**

- Added two-phase execution model (Design/Validation → Execution)
- Emphasized that Linear skill is for non-specialized agents
- Refined scope to 4 specific deliverables
- Added Phase 1 validation gate concept
- Unified issue template (agent-agnostic)
