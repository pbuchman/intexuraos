# Review Agent Quality Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the review agent with IntexuraOS-specific coding standards, CI awareness, commit history analysis, triage reasoning, PR author context, architecture validation rules, and cross-PR context to dramatically improve automated code review quality.

**Architecture:** Changes span two services. The orchestrator's `reviewPrompt` system prompt (v4.0.0 → v5.0.0) gains 5 new sections covering project standards, CI, commits, architecture, and cross-PR context. The code-agent's `createReviewTask` use case gains two new optional fields (`triageReasoning`, `prAuthorLogin`) threaded from the `unifiedEvaluator`. Design decision: hybrid approach — inline critical rules in system prompt (~800 tokens), instruct agent to read `/repo/.claude/CLAUDE.md` for full details.

**Tech Stack:** TypeScript, Vitest, Fastify (code-agent), Docker isolation (orchestrator workers)

---

## Context for implementer

The review agent is a read-only automated PR reviewer dispatched by the orchestrator. Its system prompt at `workers/orchestrator/src/services/system-prompt.ts` (`reviewPrompt` v4.0.0, lines 561-704) currently gives generic review categories (code_quality, security, architecture) with zero IntexuraOS-specific knowledge. The user prompt built by `apps/code-agent/src/domain/usecases/createReviewTask.ts:buildReviewPrompt()` (lines 149-181) is minimal — just PR number, review types, and optional comment.

The review agent has the full repo cloned at `/repo` (which contains `.claude/CLAUDE.md` and `.claude/reference/`), but the prompt never tells it to read those files. The triage evaluator's LLM reasoning about *why* a review was requested is captured in `EventDecision.llmReasoning` but never passed to the review agent. The PR author login is available on `GitHubPREvent.prAuthorLogin` but not included in the review prompt.

Item 8 (subagent deep reviews for large PRs) is tracked separately in **INT-982**.

---

## Files

| File                                                                     | Change                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/system-prompt.ts`                     | Version bump 4.0.0→5.0.0, add 5 new sections to review prompt                     |
| `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`      | ~7 new test cases for review prompt content                                       |
| `apps/code-agent/src/domain/usecases/createReviewTask.ts`                | Add `triageReasoning?`, `prAuthorLogin?` to request, enrich `buildReviewPrompt()` |
| `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`        | ~4 new test cases for prompt enrichment                                           |
| `apps/code-agent/src/domain/services/unifiedEvaluator.ts`                | Thread `reasoning` + `prAuthorLogin` to `createReviewTask` call                   |
| `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts` | ~3 new test cases for field threading                                             |

---

## Task 1: Add CI Status Check to Gathering PR Context

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:627-631`
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

The `### Gathering PR Context` section currently has 3 steps. Add step 4 for CI status.

- [ ] **Step 1: Write failing test**

Add to existing review prompt tests in `system-prompt.test.ts`:

```typescript
it('review agent prompt includes CI status check instruction', () => {
  const result = buildSystemPrompt({ ...reviewBaseParams, agentType: 'review' });
  expect(result).toContain('gh pr checks');
  expect(result).toContain('CI is failing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && npx vitest run src/services/__tests__/system-prompt.test.ts -t "CI status"`
Expected: FAIL — prompt does not contain `gh pr checks`

- [ ] **Step 3: Add CI status step to system prompt**

In `system-prompt.ts`, inside `reviewPrompt.build()` return template, after line 631 (`3. Fetch existing comments`), add:

```
4. Check CI status: \`gh pr checks {pr_number} --json name,state,bucket\`
   The \`bucket\` field categorizes each check as \`pass\`, \`fail\`, \`pending\`, \`skipping\`, or \`cancel\`.
   If CI is failing, prioritize reviewing the areas causing failures. Flag coverage decreases.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/orchestrator && npx vitest run src/services/__tests__/system-prompt.test.ts -t "CI status"`
Expected: PASS

---

## Task 2: Add Mandatory Commit History Analysis Section

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (insert between Gathering PR Context and Full Repository Access)
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('review agent prompt includes mandatory commit history analysis', () => {
  const result = buildSystemPrompt({ ...reviewBaseParams, agentType: 'review' });
  expect(result).toContain('### Commit History Analysis (MANDATORY)');
  expect(result).toContain('gh pr view {pr_number} --json commits');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && npx vitest run src/services/__tests__/system-prompt.test.ts -t "commit history"`
Expected: FAIL

- [ ] **Step 3: Insert new section in system prompt**

In `reviewPrompt.build()`, after the `### Gathering PR Context` section (including new CI step) and before `### Full Repository Access`, insert:

```
### Commit History Analysis (MANDATORY)

Before reviewing code, examine the branch commit history:
\`\`\`bash
gh pr view {pr_number} --json commits
\`\`\`
Understanding the sequence of changes helps distinguish intentional design decisions from incremental patches that may need consolidation.
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

---

## Task 3: Add Related Changes Context Section

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (insert after Full Repository Access)
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('review agent prompt includes related changes context section', () => {
  const result = buildSystemPrompt({ ...reviewBaseParams, agentType: 'review' });
  expect(result).toContain('### Related Changes Context');
  expect(result).toContain('gh pr list --state merged');
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL

- [ ] **Step 3: Insert section after Full Repository Access**

```
### Related Changes Context

Check recent merged PRs for related context:
\`\`\`bash
gh pr list --state merged --base development --limit 10 --json number,title,headRefName,mergedAt
\`\`\`
This helps identify conflicting patterns, compound changes across multiple PRs, or recent refactors that the current PR should align with.
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

---

## Task 4: Add IntexuraOS Coding Standards Section

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (insert after Related Changes Context)
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

This is the biggest single addition. Keep it concise — the agent can read full details from `/repo/.claude/CLAUDE.md`.

- [ ] **Step 1: Write failing test**

```typescript
it('review agent prompt includes IntexuraOS Coding Standards section', () => {
  const result = buildSystemPrompt({ ...reviewBaseParams, agentType: 'review' });
  expect(result).toContain('### IntexuraOS Coding Standards');
  expect(result).toContain('noUncheckedIndexedAccess');
  expect(result).toContain('exactOptionalPropertyTypes');
  expect(result).toContain('.js extension');
  expect(result).toContain('v8 ignore');
  expect(result).toContain('/repo/.claude/CLAUDE.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL

- [ ] **Step 3: Insert coding standards section**

```
### IntexuraOS Coding Standards (Quick Reference)

Key rules to validate during review. Read \`/repo/.claude/CLAUDE.md\` and \`/repo/.claude/reference/\` for full project standards.

**TypeScript Strict Mode:**
- \`noUncheckedIndexedAccess\`: array/object access must use \`arr[0] ?? fallback\`, never bare \`arr[0]\`
- \`exactOptionalPropertyTypes\`: use \`?:\` not \`| undefined\` for optional props
- \`strictBooleanExpressions\`: explicit \`=== true\`, never bare truthy checks on non-booleans
- Wrap numbers in template literals with \`String()\`

**Code Patterns:**
- Result type: narrow with \`if (!result.ok) return result;\` before accessing \`.value\`
- ESM imports MUST use \`.js\` extension (except \`apps/web\` — Vite handles resolution; look for \`@allow-missing-js\` escape hatch)
- Mock Logger needs all 4 methods: \`info\`, \`warn\`, \`error\`, \`debug\`

**Testing:**
- DI pattern: \`setServices({fakes})\` in beforeEach, \`resetServices()\` in afterEach
- Route tests: \`app.inject()\`
- 100% branch coverage required, or valid \`/* v8 ignore <CATEGORY> -- reason @preserve */\`
- Valid categories: \`ts-type\`, \`regex\`, \`module-init\`, \`async-timing\`, \`test-infra\`, \`upstream\`, \`module-mock\`, \`schema\`, \`source-map\`, \`auth-guard\`
- v8 ignore proof MUST name the testing BLOCKER, not describe the code

**Prompt Versioning:**
- All \`PromptBuilder\` prompts need a semver \`version\` field
- Bump: MAJOR = behavior change, MINOR = new examples, PATCH = typos
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

---

## Task 5: Add Architecture Validation Checklist Section

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (insert after Coding Standards)
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('review agent prompt includes architecture validation checklist', () => {
  const result = buildSystemPrompt({ ...reviewBaseParams, agentType: 'review' });
  expect(result).toContain('### Architecture Validation Checklist');
  expect(result).toContain('getServices()');
  expect(result).toContain('logIncomingRequest()');
  expect(result).toContain('firestore-collections.json');
  expect(result).toContain('/internal/');
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL

- [ ] **Step 3: Insert architecture checklist section**

```
### Architecture Validation Checklist

When reviewing changes that touch module boundaries, verify:
- Apps CANNOT import from other apps (check import paths)
- Routes MUST use \`getServices()\` for dependency injection
- Service-to-service communication uses \`/internal/{resource-name}\` with \`X-Internal-Auth\` header
- ALL endpoints MUST call \`logIncomingRequest()\`
- Firestore: one collection owner per service — cross-service access MUST go via HTTP (check \`firestore-collections.json\`)
- Pub/Sub publishers MUST extend \`BasePubSubPublisher\`
- New env vars must appear in 3 locations: \`apps/<service>/src/index.ts\` REQUIRED_ENV, \`terraform/environments/dev/main.tf\`, \`ecosystem.config.cjs\`
- Migrations are IMMUTABLE — never edit existing migrations, create new ones
- PR titles MUST contain \`[INT-XXX]\` identifier
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

---

## Task 6: Bump Version and Add Section Ordering Test

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:564` (version bump)
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Bump version**

Change `version: '4.0.0'` to `version: '5.0.0'` on line 564 of `system-prompt.ts`.

- [ ] **Step 2: Write version test**

```typescript
it('review agent prompt version is 5.0.0', () => {
  expect(reviewPrompt.version).toBe('5.0.0');
});
```

- [ ] **Step 3: Write section ordering test**

```typescript
it('review agent prompt sections appear in correct order', () => {
  const result = buildSystemPrompt({ ...reviewBaseParams, agentType: 'review' });
  const indices = [
    result.indexOf('### Gathering PR Context'),
    result.indexOf('### Commit History Analysis'),
    result.indexOf('### Full Repository Access'),
    result.indexOf('### Related Changes Context'),
    result.indexOf('### IntexuraOS Coding Standards'),
    result.indexOf('### Architecture Validation Checklist'),
    result.indexOf('### Posting Review Comments'),
  ];
  for (let i = 1; i < indices.length; i++) {
    expect(indices[i]).toBeGreaterThan(indices[i - 1] ?? -1);
  }
});
```

- [ ] **Step 4: Run all orchestrator tests**

Run: `pnpm run verify:workspace:tracked orchestrator`
Expected: ALL PASS

- [ ] **Step 5: Commit orchestrator changes**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): enrich review agent prompt with coding standards, CI, commit history, architecture rules

Bump reviewPrompt v4.0.0 → v5.0.0 (MAJOR — new mandatory sections).

New sections:
- CI status check in Gathering PR Context
- Commit History Analysis (MANDATORY)
- Related Changes Context
- IntexuraOS Coding Standards (Quick Reference)
- Architecture Validation Checklist"
```

---

## Task 7: Extend CreateReviewTaskRequest and Enrich User Prompt

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts:29-40` (interface) and `:149-181` (buildReviewPrompt)
- Test: `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`

- [ ] **Step 1: Write failing tests for prAuthorLogin**

Add to `createReviewTask.test.ts`:

```typescript
it('includes PR author login in prompt when provided', async () => {
  const deps = createFakeDeps();
  const result = await createReviewTask(deps, {
    ...baseRequest,
    prAuthorLogin: 'feature-dev',
  });
  expect(result.ok).toBe(true);
  const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
  expect(createCall?.[0]?.prompt).toContain('PR author: feature-dev');
});

it('omits PR author line when prAuthorLogin is not provided', async () => {
  const deps = createFakeDeps();
  await createReviewTask(deps, baseRequest);
  const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
  expect(createCall?.[0]?.prompt).not.toContain('PR author:');
});
```

- [ ] **Step 2: Write failing tests for triageReasoning**

```typescript
it('includes triage reasoning in prompt when provided', async () => {
  const deps = createFakeDeps();
  await createReviewTask(deps, {
    ...baseRequest,
    triageReasoning: 'Auth logic changed, security review warranted.',
  });
  const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
  expect(createCall?.[0]?.prompt).toContain('### Triage Context');
  expect(createCall?.[0]?.prompt).toContain('Auth logic changed, security review warranted.');
});

it('omits triage context section when triageReasoning is not provided', async () => {
  const deps = createFakeDeps();
  await createReviewTask(deps, baseRequest);
  const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
  expect(createCall?.[0]?.prompt).not.toContain('### Triage Context');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/usecases/createReviewTask.test.ts -t "PR author|triage"`
Expected: FAIL

- [ ] **Step 4: Add fields to CreateReviewTaskRequest interface**

In `createReviewTask.ts` line 29-40, add after `baseBranch?: string;`:

```typescript
triageReasoning?: string;
prAuthorLogin?: string;
```

- [ ] **Step 5: Enrich buildReviewPrompt()**

In `buildReviewPrompt()` (line 149), after line 155 (`Worker type requested: ${workerType}`):

```typescript
if (request.prAuthorLogin !== undefined) {
  lines.push(`PR author: ${request.prAuthorLogin}`);
}
```

After the `reviewComment` block (after line 164):

```typescript
if (request.triageReasoning !== undefined) {
  lines.push(
    '### Triage Context',
    '',
    'The automated triage system flagged this PR for review with the following reasoning:',
    request.triageReasoning,
    '',
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Expected: PASS

---

## Task 8: Thread Fields from UnifiedEvaluator

**Files:**
- Modify: `apps/code-agent/src/domain/services/unifiedEvaluator.ts:223-240`
- Test: `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `unifiedEvaluator.test.ts` in the `request_review` describe block:

```typescript
it('threads triageReasoning from LLM reasoning to createReviewTask', async () => {
  // Setup: mock evaluateEvent to return reasoning
  // Assert: createReviewTask called with triageReasoning matching reasoning
});

it('threads prAuthorLogin from event to createReviewTask when non-null', async () => {
  // Setup: create event with prAuthorLogin: 'feature-dev'
  // Assert: createReviewTask called with prAuthorLogin: 'feature-dev'
});

it('omits prAuthorLogin when event has null prAuthorLogin', async () => {
  // Setup: create event with prAuthorLogin: null
  // Assert: createReviewTask called WITHOUT prAuthorLogin key
});
```

Note: Follow existing test patterns in the file. The `createReviewTask` dep is already mocked. The `reasoning` variable is destructured at line 185: `const { triage, usage, reasoning } = llmResult.value;`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/services/unifiedEvaluator.test.ts -t "triageReasoning|prAuthorLogin"`
Expected: FAIL

- [ ] **Step 3: Add conditional spreads to createReviewTask call**

In `unifiedEvaluator.ts` line 223-240, after line 237 (`baseBranch` spread), add:

```typescript
...(reasoning !== undefined && { triageReasoning: reasoning }),
...(event.prAuthorLogin !== null && { prAuthorLogin: event.prAuthorLogin }),
```

The `reasoning` is already destructured at line 185. `event.prAuthorLogin` is `string | null` on `GitHubPREvent`.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Run full code-agent verification**

Run: `pnpm run verify:workspace:tracked code-agent`
Expected: ALL PASS

- [ ] **Step 6: Commit code-agent changes**

```bash
git add apps/code-agent/src/domain/usecases/createReviewTask.ts apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts apps/code-agent/src/domain/services/unifiedEvaluator.ts apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts
git commit -m "feat(code-agent): enrich review task prompt with triage reasoning and PR author

Add triageReasoning and prAuthorLogin optional fields to CreateReviewTaskRequest.
Thread LLM reasoning and event.prAuthorLogin from unifiedEvaluator to review prompt."
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS — zero failures across all workspaces

- [ ] **Step 2: Verify no coverage regressions**

Check that coverage thresholds still pass for both `orchestrator` and `code-agent` workspaces.

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All endpoints unchanged. Only prompt content and optional request interface fields change.

## Reusable Patterns

- Conditional spread: `...(value !== null && { field: value })` — used extensively in `unifiedEvaluator.ts` (lines 231-238)
- `toContain()` assertions on prompt content — used in `system-prompt.test.ts` (lines 518-716)
- `vi.mocked(deps.codeTaskRepo.create).mock.calls[0]` pattern for inspecting prompt — used in `createReviewTask.test.ts`
