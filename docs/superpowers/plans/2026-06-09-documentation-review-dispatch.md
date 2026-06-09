# Documentation Review Dispatch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add documentation as a first-class automated PR review type so docs-only PRs are reviewed instead of skipped.

**Architecture:** Keep the existing GitHub Agent flow: `apps/code-agent` decides `reviewTypes`, persists them on the review task, and `workers/orchestrator` builds the review prompt from those types. Add a `documentation` review type to the shared review-type constants, dispatch docs-only non-plan PRs deterministically, and teach the review agent how to perform documentation reviews. Separately, make pull-request-agent output valid when no Linear issue exists so PR/comment workflows do not fabricate `INT-XXX`.

**Tech Stack:** TypeScript, Vitest, Zod, PromptBuilder prompts, code-agent domain tests, orchestrator prompt and completion-verifier tests.

---

## Constraints And Rules

- Do not create a git worktree. `.claude/CLAUDE.md` forbids worktrees in this repo.
- Use TDD: write the failing test first, confirm it fails, implement the smallest code change, then rerun the test.
- Prompt edits require semver version bumps:
  - `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts` currently `5.2.0`; this is behavior-changing, bump to `6.0.0`.
  - `workers/orchestrator/src/services/prompts/review-prompt.ts` currently `10.0.1`; adding a review type is behavior-changing, bump to `11.0.0`.
  - `workers/orchestrator/src/services/prompts/pull-request-prompt.ts` currently `5.0.1`; no-Linear behavior is behavior-changing, bump to `6.0.0`.
- Do not fabricate Linear issue IDs. For repo contribution PRs, still follow `.claude/reference/cross-linking.md`: if the human task has no issue ID and you are about to create a branch/PR for this implementation, ask before PR creation. This plan's no-Linear requirement is about the automated pull-request agent prompt and completion verifier, not permission for this implementation worker to invent IDs.
- Before any commit, `pnpm run ci:tracked` must pass completely.

## Endpoint Changes

- **Modified:** None.
- **Created:** None.
- **Removed:** None.
- **Unchanged:** Existing code-agent and orchestrator dispatch endpoints continue to carry `reviewTypes?: string[]`; this change only adds a new allowed value and prompt behavior.

## File Structure

- Modify `apps/code-agent/src/domain/constants/reviewTypes.ts`
  - Add `documentation` to the canonical review type list and the LLM tool enum.
- Modify `apps/code-agent/src/domain/utils/planDetection.ts`
  - Keep `isPlanFile()` and `evaluatePlanFiles()` behavior.
  - Add documentation-file detection and a deterministic docs-only review evaluator.
- Modify `apps/code-agent/src/domain/usecases/githubAgent/dispatchAgent.ts`
  - Check plan-only first, docs-only second.
  - Improve `request_review` tool descriptions so the LLM understands all review types.
  - Keep `plan_review` excluded from the LLM tool enum.
- Modify `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`
  - Replace docs-only skip guidance with documentation-review guidance.
  - Add clearer review-type guidance for existing tools.
- Modify code-agent tests:
  - `apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts`
  - `apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts`
  - `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`
  - `apps/code-agent/src/__tests__/domain/usecases/githubAgent/dispatchAgent.test.ts`
  - Update any tests that assert docs-only skip text, especially `apps/code-agent/src/__tests__/routes/webhooks/automationLogFlows.test.ts` if affected by snapshots/fixtures.
- Modify `workers/orchestrator/src/services/prompts/review-prompt.ts`
  - Add a `documentation` section to `REVIEW_TYPE_SECTIONS`.
  - Add documentation-review instructions to Review Scope.
- Modify orchestrator prompt tests:
  - `workers/orchestrator/src/__tests__/system-prompt.test.ts`
- Modify `workers/orchestrator/src/services/prompts/pull-request-prompt.ts`
  - Render Linear-reading instructions only when `linearIssueId` exists.
  - Omit the PR-description Linear line when no Linear issue exists.
  - Change final block contract text to allow `Linear issue: none`.
- Modify completion verifier:
  - `workers/orchestrator/src/services/completion-verifier/contracts.ts`
  - `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`
  - `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`

## Chunk 1: Code-Agent Review Type And Dispatch

### Task 1: Add `documentation` To Review Type Constants

**Files:**
- Modify: `apps/code-agent/src/domain/constants/reviewTypes.ts`
- Test: `apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts`

- [ ] **Step 1: Write the failing test**

Add expectations that `documentation` is accepted globally and exposed to the LLM:

```ts
expect(ALL_REVIEW_TYPES).toContain('documentation');
expect(LLM_TOOL_REVIEW_TYPES).toContain('documentation');
expect([...LLM_TOOL_REVIEW_TYPES]).toEqual(
  expect.arrayContaining(['code_quality', 'security', 'architecture', 'test_quality', 'documentation']),
);
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/constants/reviewTypes.test.ts
```

Expected: FAIL because `documentation` is absent.

- [ ] **Step 3: Implement the minimal change**

Update the constant:

```ts
export const ALL_REVIEW_TYPES = [
  'code_quality',
  'security',
  'architecture',
  'plan_review',
  'test_quality',
  'documentation',
] as const;
```

No special filter is needed: `LLM_TOOL_REVIEW_TYPES` only excludes `plan_review`, so `documentation` will be available to the LLM tool enum.

- [ ] **Step 4: Rerun the focused test**

Run the same command. Expected: PASS.

### Task 2: Detect Docs-Only Non-Plan PRs Deterministically

**Files:**
- Modify: `apps/code-agent/src/domain/utils/planDetection.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/gitHubWebhookRules.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests beside the existing `evaluatePlanFiles` tests:

```ts
it('returns dispatch with documentation for docs-only non-plan PR', () => {
  const files = [
    { filename: 'README.md' },
    { filename: 'docs/services/code-agent/technical.md' },
  ];

  const result = evaluateReviewFiles(files);

  expect(result).toEqual({
    action: 'dispatch',
    reason: 'DOCUMENTATION_ONLY_PR',
    context: { reviewType: 'documentation' },
  });
});

it('keeps plan_review precedence for plan-only PRs', () => {
  const files = [{ filename: 'docs/superpowers/plans/feature-plan.md' }];

  expect(evaluateReviewFiles(files)).toEqual({
    action: 'dispatch',
    reason: 'PLAN_ONLY_PR',
    context: { reviewType: 'plan_review' },
  });
});

it('returns needs_triage for mixed docs and code', () => {
  const files = [
    { filename: 'docs/services/code-agent/technical.md' },
    { filename: 'apps/code-agent/src/index.ts' },
  ];

  expect(evaluateReviewFiles(files)).toEqual({
    action: 'needs_triage',
    reason: 'NOT_REVIEW_ONLY_PR',
  });
});
```

Import the new `evaluateReviewFiles` from the same module used by the test. Keep the existing `evaluatePlanFiles` tests until the new function is wired; do not delete coverage unless it is redundant after refactor.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/services/gitHubWebhookRules.test.ts
```

Expected: FAIL because `evaluateReviewFiles` does not exist.

- [ ] **Step 3: Implement the minimal detection**

In `planDetection.ts`, add:

```ts
export function isDocumentationFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (isPlanFile(filename)) return true;
  if (lower.startsWith('docs/') && /\.(md|mdx|rst|adoc|txt)$/.test(lower)) return true;
  return /(^|\/)(readme|changelog|contributing|architecture|runbook|adr)[^/]*\.(md|mdx|rst|adoc|txt)$/.test(lower);
}

export function evaluateReviewFiles(files: { filename: string }[]): RuleOutcome {
  const planResult = evaluatePlanFiles(files);
  if (planResult.action === 'dispatch') return planResult;

  if (files.length === 0) {
    return { action: 'needs_triage', reason: 'NO_FILES_TO_EVALUATE' };
  }

  if (files.every((f) => isDocumentationFile(f.filename))) {
    return {
      action: 'dispatch',
      reason: 'DOCUMENTATION_ONLY_PR',
      context: { reviewType: 'documentation' },
    };
  }

  return { action: 'needs_triage', reason: 'NOT_REVIEW_ONLY_PR' };
}
```

If TypeScript rejects the new `reason` strings because `RuleOutcome` is narrowed elsewhere, update that type in `apps/code-agent/src/domain/services/gitHubWebhookRules.ts` and its tests to include `DOCUMENTATION_ONLY_PR` and `NOT_REVIEW_ONLY_PR`.

- [ ] **Step 4: Rerun focused tests**

Expected: PASS.

### Task 3: Wire Docs-Only Dispatch Into GitHub Agent

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/githubAgent/dispatchAgent.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/githubAgent/dispatchAgent.test.ts`

- [ ] **Step 1: Write the failing dispatch test**

Add a docs-only test beside the plan-only short-circuit test:

```ts
it('short-circuits for docs-only non-plan PR with documentation review', async () => {
  const prClient = createFakeGitHubPRClient();
  vi.mocked(prClient.getPullRequestFiles).mockResolvedValue(ok([
    { filename: 'README.md', status: 'modified', additions: 12, deletions: 3 },
    { filename: 'docs/services/code-agent/technical.md', status: 'modified', additions: 20, deletions: 4 },
  ]));
  const resolveToolCallingClient = vi.fn().mockResolvedValue(ok(createFakeToolCallingClient()));
  const deps = createDeps({ gitHubPRClient: prClient, resolveToolCallingClient });

  const result = await dispatchPRAgent(deps, createFakePREvent(), 'intexuraos', 'intexuraos');

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.kind).toBe('deterministic');
    if (result.value.kind === 'deterministic') {
      expect(result.value.triage).toEqual({ action: 'request_review', reviewTypes: ['documentation'] });
      expect(result.value.reasoning).toContain('Documentation-only PR');
    }
  }
  expect(resolveToolCallingClient).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/githubAgent/dispatchAgent.test.ts
```

Expected: FAIL because docs-only PRs still go through LLM and/or skip.

- [ ] **Step 3: Implement the dispatch wiring**

In `dispatchAgent.ts`:

- Replace the `evaluatePlanFiles(files)` import/use with `evaluateReviewFiles(files)`.
- Keep the log/reasoning specific:

```ts
const reviewFileResult = evaluateReviewFiles(files);
if (reviewFileResult.action === 'dispatch') {
  const reviewType = reviewFileResult.context?.reviewType;
  if (reviewType === 'plan_review' || reviewType === 'documentation') {
    logger.info(
      { repository: event.repository, prNumber: event.pullRequestNumber, fileCount: files.length, reviewType },
      `${reviewType === 'plan_review' ? 'Plan-only' : 'Documentation-only'} PR detected - dispatching ${reviewType} without LLM triage`
    );
    return {
      ok: true,
      value: {
        kind: 'deterministic',
        triage: { action: 'request_review', reviewTypes: [reviewType] },
        reasoning: `${reviewType === 'plan_review' ? 'Plan-only' : 'Documentation-only'} PR detected - deterministic dispatch to ${reviewType}`,
      },
    };
  }
}
```

Use a local `const reviewType = ...` and explicit equality checks so TypeScript strict mode narrows safely.

- [ ] **Step 4: Improve the PR `request_review` tool description**

Still in `dispatchAgent.ts`, replace the vague tool description with purpose-specific wording:

```ts
description: 'Request one automated PR review scope. Use code_quality for source changes, security for auth/secrets/user-input risk, architecture for cross-boundary design changes, test_quality for substantial test changes, and documentation for docs content accuracy/completeness.',
```

Update the `review_type` parameter description similarly:

```ts
description: 'The review scope to request. Request multiple scopes with separate unique calls when the PR needs more than one perspective.',
```

For the `skip` tool, remove docs from the description:

```ts
description: 'Skip this PR only when it is not reviewable or is trivial/generated metadata. Do not skip documentation-only PRs; those use documentation review.',
```

- [ ] **Step 5: Rerun focused tests**

Expected: PASS.

## Chunk 2: GitHub Agent Prompt Improvements

### Task 4: Update PR Triage Prompt For Existing Tools And Documentation

**Files:**
- Modify: `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`
- Test: `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Add tests for:

```ts
it('contains documentation review guidance and does not tell docs-only PRs to skip', () => {
  const result = githubAgentPrompt.build({
    repository: 'owner/repo',
    prNumber: 1,
    prTitle: 'docs update',
    prBody: 'body',
    action: 'opened',
    senderLogin: 'user',
    eventType: 'pull_request',
    files: [{ filename: 'README.md', status: 'modified', additions: 3, deletions: 1 }],
  });

  expect(result).toContain('documentation');
  expect(result).toContain('Docs-only PR');
  expect(result).toContain('request_review({"review_type":"documentation"})');
  expect(result).not.toContain('documentation-only change, no code to review');
});

it('describes existing review scopes with dispatch criteria', () => {
  const result = githubAgentPrompt.build({
    repository: 'owner/repo',
    prNumber: 1,
    prTitle: 'feature',
    prBody: 'body',
    action: 'opened',
    senderLogin: 'user',
    eventType: 'pull_request',
    files: [],
  });

  expect(result).toContain('source files or implementation behavior');
  expect(result).toContain('auth, authorization, secrets, tokens, user input');
  expect(result).toContain('cross-service');
  expect(result).toContain('false positives');
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/prompts/githubAgentPrompt.test.ts
```

Expected: FAIL because prompt still says docs-only skip and version is old.

- [ ] **Step 3: Update the prompt**

In `githubAgentPrompt.ts`:

- Bump `version` to `6.0.0`.
- Change instruction 4 from docs/config/auto-generated skip to:

```ts
'4. If the PR is not reviewable or is only trivial/generated metadata, use `skip`. Do not skip documentation-only PRs; request `documentation` review.',
```

- Replace review type bullets with clearer dispatch criteria:

```ts
'- **code_quality**: General source review. Request for source files or implementation behavior changes; focus on correctness, maintainability, dead code, error handling, and project conventions.',
'- **security**: Security-focused review. Request when changes touch auth, authorization, secrets, tokens, API endpoints, external input parsing, command execution, webhook validation, or user input handling.',
'- **architecture**: Design review. Request when changes cross service/package boundaries, introduce new patterns, alter dependency direction, change data ownership, or affect scalability/coupling.',
'- **test_quality**: Test review. Request when PR has significant test file changes (.test.ts, .spec.ts) or test infrastructure changes. Checks false positives, isolation, assertion strength, v8 ignore legitimacy, and test design.',
'- **documentation**: Documentation review. Request for docs-only non-plan PRs and for substantial docs changes mixed with code. Checks accuracy against code, broken/obsolete instructions, missing prerequisites, unclear examples, and internal consistency.',
```

- Keep the plan-only line:

```ts
'If all changed files are plan documents (*plan*.md), skip LLM triage - plan reviews are handled by deterministic `plan_review` dispatch before this prompt is used.',
```

- Replace Example 3 with documentation dispatch:

```ts
'Example 3 - Docs-only PR:',
'1. Call `request_review({"review_type":"documentation"})`',
'2. Respond: "Requested documentation review for this docs-only PR."',
```

- Add a new skip example for generated metadata:

```ts
'Example 5 - Generated metadata only:',
'1. Call `skip({"reason":"Generated metadata only, no reviewable content."})`',
'2. Respond: "Skipped - generated metadata only."',
```

- [ ] **Step 4: Update version test**

Change the prompt version test from `5.2.0` to `6.0.0`.

- [ ] **Step 5: Rerun prompt tests**

Expected: PASS.

## Chunk 3: Orchestrator Documentation Review Prompt

### Task 5: Add Documentation Review Structure And Instructions

**Files:**
- Modify: `workers/orchestrator/src/services/prompts/review-prompt.ts`
- Test: `workers/orchestrator/src/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests under `describe('reviewPrompt', ...)`:

```ts
it('renders documentation review structure when documentation is requested', () => {
  const prompt = reviewPrompt.build({
    taskId: 'task-doc-review',
    linearIssueLabels: [],
    agentType: 'review',
    reviewTypes: ['documentation'],
  });

  expect(prompt).toContain('Automated Code Review');
  expect(prompt).toContain('documentation');
  expect(prompt).toContain('### Documentation');
  expect(prompt).toContain('content accuracy');
  expect(prompt).not.toContain('### Code Quality');
});

it('includes documentation in the review scope list', () => {
  const prompt = reviewPrompt.build({
    taskId: 'task-doc-review',
    linearIssueLabels: [],
    agentType: 'review',
    reviewTypes: ['documentation'],
  });

  expect(prompt).toContain('**documentation**');
  expect(prompt).toContain('Verify claims against the repository');
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test -- src/__tests__/system-prompt.test.ts
```

Expected: FAIL because `documentation` has no structure/instructions.

- [ ] **Step 3: Implement prompt support**

In `review-prompt.ts`:

- Bump `version` to `11.0.0`.
- Add to `REVIEW_TYPE_SECTIONS`:

```ts
documentation: `### Documentation
**Verdict:** Accurate / Minor issues / Needs correction
- Finding 1...`,
```

- Add to Review Scope:

```ts
- **documentation**: Documentation content review. Verify claims against the repository and current behavior. Check commands, file paths, endpoint names, environment variables, setup steps, examples, links, internal consistency, and whether prerequisites or warnings are missing. Flag stale, misleading, unverifiable, or incomplete guidance. Do NOT perform general code_quality/security/architecture review unless those types were also requested.
```

Keep the review read-only; documentation findings should be actionable and line-specific.

- [ ] **Step 4: Update version tests**

In `workers/orchestrator/src/__tests__/system-prompt.test.ts`, update the review prompt version expectation to `11.0.0`.

- [ ] **Step 5: Rerun focused tests**

Expected: PASS.

## Chunk 4: Pull-Request Agent Without Linear

### Task 6: Make Pull-Request Prompt Conditional On Linear Issue

**Files:**
- Modify: `workers/orchestrator/src/services/prompts/pull-request-prompt.ts`
- Test: `workers/orchestrator/src/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests:

```ts
it('does not require Linear issue reading when pull request task has no Linear issue', () => {
  const prompt = pullRequestPrompt.build({
    taskId: 'task-pr-no-linear',
    linearIssueLabels: [],
    agentType: 'pull_request',
  });

  expect(prompt).toContain('No Linear issue is associated');
  expect(prompt).not.toContain('mcp__linear__get_issue');
  expect(prompt).not.toContain('INT-XXX');
});

it('keeps Linear issue reading when pull request task has Linear issue', () => {
  const prompt = pullRequestPrompt.build({
    taskId: 'task-pr-linear',
    linearIssueId: 'INT-123',
    linearIssueTitle: 'Fix docs',
    linearIssueLabels: [],
    agentType: 'pull_request',
  });

  expect(prompt).toContain("mcp__linear__get_issue({ id: 'INT-123' })");
  expect(prompt).toContain('Linear: [INT-123 Fix docs]');
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test -- src/__tests__/system-prompt.test.ts
```

Expected: FAIL because the prompt currently always requires Linear and renders `INT-XXX`.

- [ ] **Step 3: Implement conditional Linear sections**

In `pull-request-prompt.ts`:

- Bump `version` to `6.0.0`.
- Replace the unconditional "Reading the Linear Issue" section with a conditional:

```ts
${linearIssueId !== undefined
  ? `### Reading the Linear Issue (MANDATORY FIRST ACTION - NON-NEGOTIABLE)

Before doing ANY work, you MUST read the Linear issue AND all its comments:

1. Read the issue: \`mcp__linear__get_issue({ id: '${linearIssueId}' })\`
2. Read ALL comments: \`mcp__linear__list_comments({ issueId: '<issueId>' })\`
...
`
  : `### Context

No Linear issue is associated with this pull-request task. Do not call Linear tools, do not invent an INT issue ID, and do not add a Linear link to the PR description. Use the PR review/comment context as the source of requirements.`
}
```

- In "PR Description Update", render the Linear line only when `linearIssueId !== undefined`:

```ts
${linearIssueId !== undefined ? `- Linear: [${linearIssueId}${linearIssueTitle !== undefined ? ` ${linearIssueTitle}` : ''}](https://linear.app/pbuchman/issue/${linearIssueId})` : ''}
```

- In `PULL_REQUEST_AGENT_FINAL`, change:

```text
- Linear issue: <full Linear URL, or "none" when no Linear issue is associated>
```

- [ ] **Step 4: Update version test**

Change pull-request prompt version expectation from `5.0.1` to `6.0.0`.

- [ ] **Step 5: Rerun focused tests**

Expected: PASS.

### Task 7: Let Completion Verifier Accept Pull-Request Tasks With No Linear Issue

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/contracts.ts`
- Test: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`
- Test: `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`

- [ ] **Step 1: Write failing verifier test**

Add to `block-parser.test.ts`:

```ts
it('accepts pull_request final block with Linear issue none', () => {
  const transcript = [
    'PULL_REQUEST_AGENT_FINAL:',
    '- PR: https://github.com/pbuchman/intexuraos/pull/2099',
    '- CI evidence: pnpm run ci:tracked successful',
    '- Linear issue: none',
    '- Comment replied: yes',
    '- Tracking comment ID: 123',
    '- Tracking comment: updated',
    '- Total PR comments posted: 1',
    '- memory_ids_used: none',
    '- memory_ids_rejected: none',
    '- memory_usage_summary: none',
    '- Summary: * Addressed PR feedback without Linear context.',
  ].join('\n');

  const verdict = verifyCompletion({
    transcript,
    agentType: 'pull_request',
    workerType: 'codex',
    executionMemoryContext: undefined,
    lastExitCode: undefined,
  });

  expect(verdict.kind).toBe('parsed');
  if (verdict.kind !== 'parsed') return;
  expect(verdict.missingRequired).not.toContain('linear_issue');
  expect(verdict.data['linear_issue']).toBe('');
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test -- src/__tests__/services/completion-verifier/block-parser.test.ts
```

Expected: FAIL because `pull_request.linear_issue` is currently required as URL.

- [ ] **Step 3: Update contract**

In `contracts.ts`, change the pull-request `linear_issue` field to:

```ts
{
  name: 'linear_issue',
  alias: ['Linear issue'],
  kind: 'url',
  required: false,
  emptyAliases: DEFAULT_EMPTY_ALIASES,
},
```

- [ ] **Step 4: Keep prompt/contract round-trip valid**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test -- src/__tests__/services/completion-verifier/contracts.test.ts
```

If this fails because the prompt still lacks `- Linear issue:`, keep the final block field in the prompt as described in Task 6. The field should be present, but the value may be `none`.

- [ ] **Step 5: Rerun verifier tests**

Expected: PASS.

## Chunk 5: Integration Verification And Review Loop

### Task 8: Run Targeted Test Set

**Files:** No code changes unless failures reveal missing coverage.

- [ ] **Step 1: Run code-agent targeted tests**

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/domain/constants/reviewTypes.test.ts \
  src/__tests__/domain/services/gitHubWebhookRules.test.ts \
  src/__tests__/domain/prompts/githubAgentPrompt.test.ts \
  src/__tests__/domain/usecases/githubAgent/dispatchAgent.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run orchestrator targeted tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- \
  src/__tests__/system-prompt.test.ts \
  src/__tests__/services/completion-verifier/block-parser.test.ts \
  src/__tests__/services/completion-verifier/contracts.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run tracked workspace verification**

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: PASS.

- [ ] **Step 4: Run full tracked CI**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-documentation-review-dispatch.txt
```

Expected: PASS. If it fails, inspect with:

```bash
rg "error|FAIL" -C 3 /tmp/ci-output-documentation-review-dispatch.txt
```

Fix every failure before committing.

### Task 9: Request Code Review And Apply Fixes

**Files:** Any files touched by review findings.

- [ ] **Step 1: Invoke the requesting-code-review skill**

Use `superpowers:requesting-code-review` after targeted tests and `pnpm run ci:tracked` pass.

- [ ] **Step 2: Gather SHAs for the review request**

```bash
BASE_SHA=$(git merge-base HEAD origin/development)
HEAD_SHA=$(git rev-parse HEAD)
```

- [ ] **Step 3: Dispatch the code reviewer**

Use the `superpowers:code-reviewer` subagent with:

```text
WHAT_WAS_IMPLEMENTED:
Added documentation as a first-class review type. Docs-only non-plan PRs now dispatch documentation reviews; plan-only PRs still dispatch plan_review. GitHub Agent prompt/tool descriptions explain existing review types. Orchestrator review prompt includes documentation review instructions. Pull-request agent and completion verifier accept no-Linear PR tasks without fabricating INT-XXX.

PLAN_OR_REQUIREMENTS:
docs/superpowers/plans/2026-06-09-documentation-review-dispatch.md

BASE_SHA:
<BASE_SHA>

HEAD_SHA:
<HEAD_SHA>

DESCRIPTION:
Review documentation-review dispatch, prompt behavior, review type propagation, no-Linear pull-request completion, and tests.
```

- [ ] **Step 4: Apply reviewer fixes**

For every Critical or Important finding:

1. Write or update a failing test that captures the issue.
2. Run the focused test and confirm it fails.
3. Implement the smallest fix.
4. Rerun the focused test.
5. Rerun the relevant workspace verification.

Minor findings may be fixed immediately if they are low-risk and scoped. If rejecting a finding, document the technical reason with code/test evidence.

- [ ] **Step 5: Re-request review after fixes**

If any Critical or Important finding was fixed, dispatch the code reviewer again with the new `BASE_SHA`/`HEAD_SHA` or with the original base and updated head. Continue until there are zero Critical and zero Important findings.

- [ ] **Step 6: Final CI before commit/PR**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-documentation-review-dispatch-final.txt
```

Expected: PASS. Do not commit or open a PR until this passes.

## PR Creation Notes

- Target branch: `development`.
- Do not include `INT-XXX` in the PR title/body unless a real issue ID is provided by the user or task context.
- If no real issue ID exists and project cross-linking rules require one for this implementation PR, ask the user before creating the PR. Do not fabricate.
- The automated pull-request agent prompt must support no Linear issue by emitting `Linear issue: none` and omitting Linear links from the PR description update.

## Success Criteria

- Docs-only non-plan PR file sets dispatch `reviewTypes: ['documentation']` without LLM triage.
- Plan-only PR file sets still dispatch `reviewTypes: ['plan_review']`.
- Mixed docs/code PRs can request `documentation` alongside `code_quality`, `architecture`, `security`, or `test_quality`.
- GitHub Agent tool descriptions and prompt guidance clearly explain each existing review type.
- Review agent prompt renders a dedicated Documentation section and scope guidance.
- Pull-request-agent prompt and completion verifier accept no-Linear PR work without `INT-XXX`.
- Targeted tests, workspace verification, `pnpm run ci:tracked`, and the requested code-review loop all pass.
