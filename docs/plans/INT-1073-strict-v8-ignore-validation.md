# Strict V8 Ignore Validation Enforcement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce strict v8 ignore validation so every exemption is provably untestable, add blocker keyword enforcement to the validation script, fix all 193 explanations that currently lack blocker keywords, and clean up documentation.

**Architecture:** Two parallel workstreams: (1) harden the validation script (`scripts/verify-v8-ignore.mjs`) with a new Phase B-1 blocker keyword check and tighten existing detectors, (2) fix all v8 ignore explanations across services to comply with the new rules. Both workstreams use the same specification (defined below) so they can execute independently.

**Tech Stack:** Node.js (validation script), TypeScript (source files with v8 ignore comments)

---

## Current State

- **344 v8 ignore blocks** across 126 files in apps/, workers/, packages/
- **26 override blocks** (all INT-1071, orchestrator only) — these are tracked separately and NOT in scope
- **193 explanations** lack blocker keywords — the script does NOT currently enforce them
- Blocker keyword requirement exists only in documentation (`.claude/reference/coverage-exemptions.md`), not in the script
- Some detectors are overly permissive (e.g., `schema` matches `body.`, `request.`, `params.`)

## Specification: New Validation Rules

### Phase B-1: Blocker Keyword Enforcement

Add a new validation phase between Phase B (syntax) and Phase C (pattern) that checks explanations contain at least one blocker keyword.

**Required blocker keywords** (case-insensitive match):
- `cannot`, `unable`, `impossible`
- `always returns`, `always succeeds`, `always has`, `always include`, `always provided`, `always defined`
- `no support`, `not mockable`, `not reachable`, `not unit-testable`, `not tracked`
- `never triggered`, `no way to`, `does not expose`
- `unreachable`, `false positive`
- `guarantees`, `guard`, `guaranteed`
- `fallback`, `defensive`
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `narrows`, `narrowing`

**Category-specific expanded keywords** (these are valid ONLY for the listed category):
- `ts-type`: Also accepts `type check`, `type narrowing`, `undefined check`, `null check`, `type system`, `nullish coalescing`, `optional property`, `spread`, `conditional`, `ternary`
- `module-init`: Also accepts `bootstrap`, `entry point`, `cold start`, `module load`, `startup`, `initialized at`, `ESM import`
- `source-map`: Also accepts `alignment`, `misattributed`, `false positive`
- `upstream`: Also accepts `defensive`, `prior check`, `early return`, `validated`, `passthrough`
- `schema`: Also accepts `Zod`, `Fastify schema`, `validation`
- `regex`: Also accepts `capture group`, `match`

### Detector Tightening

1. **`schema` detector**: Remove overly broad patterns `body.`, `request.`, `params.` — these match almost any route handler. Keep only: `.safeParse(`, `.parse(`, `/schema/i`, `/zod/i`, `/validate/i`
2. **`test-infra` detector**: No changes — the existing detector already requires genuine test-infra patterns (requireAuth, FakeAuth, FakeFirestore, etc.). The blocker keyword enforcement in Phase B-1 provides the additional explanation quality check

### NEVER-Valid Pattern Additions

Descoped — the existing NEVER-valid patterns (catch blocks, `!result.ok`, status checks) are sufficient. Adding `if(!x)` null guard detection would produce too many false positives since many `ts-type` ignores legitimately cover null guards caused by `noUncheckedIndexedAccess`. Future tightening can be done incrementally.

### Documentation Updates

1. **`.claude/reference/coverage-exemptions.md`**: Add section documenting Phase B-1 blocker keyword enforcement with the full keyword list
2. **CLAUDE.md**: No changes needed (already references coverage-exemptions.md)

---

## Subtask 1: Validation Script Hardening

**Owner:** Validation infrastructure agent
**Boundary:** `scripts/verify-v8-ignore.mjs`, `.claude/reference/coverage-exemptions.md`
**No other files are modified by this subtask.**

### Contract

**Input:** Current `scripts/verify-v8-ignore.mjs` (1191 lines, 6 phases A through F)
**Output:** Updated script with Phase B-1 added, tightened detectors, updated docs
**Verification:** `node scripts/verify-v8-ignore.mjs` must still pass (existing comments must not be broken by detector tightening — the new Phase B-1 will initially be added in `--strict` mode only, then enabled by default after Subtask 2 fixes all explanations)

### Task 1.1: Add Phase B-1 Blocker Keyword Check

**Files:**
- Modify: `scripts/verify-v8-ignore.mjs` (insert after line ~581, Phase B)

- [ ] **Step 1: Write the blocker keyword validation function**

```javascript
// ============================================================================
// PHASE B-1: Blocker Keyword Enforcement
// ============================================================================

const BLOCKER_KEYWORDS = [
  'cannot', 'unable', 'impossible',
  'always returns', 'always succeeds', 'always has', 'always include',
  'always provided', 'always defined',
  'no support', 'not mockable', 'not reachable', 'not unit-testable', 'not tracked',
  'never triggered', 'no way to', 'does not expose',
  'unreachable', 'false positive',
  'guarantees', 'guard', 'guaranteed',
  'fallback', 'defensive',
  'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes',
  'narrows', 'narrowing',
];

const CATEGORY_SPECIFIC_KEYWORDS = {
  'ts-type': ['type check', 'type narrowing', 'undefined check', 'null check',
              'type system', 'nullish coalescing', 'optional property', 'spread',
              'conditional', 'ternary'],
  'module-init': ['bootstrap', 'entry point', 'cold start', 'module load',
                  'startup', 'initialized at', 'ESM import'],
  'source-map': ['alignment', 'misattributed', 'false positive'],
  'upstream': ['defensive', 'prior check', 'early return', 'validated', 'passthrough'],
  'schema': ['Zod', 'Fastify schema', 'validation'],
  'regex': ['capture group', 'match'],
};

function validateBlockerKeywords(comments) {
  const errors = [];

  for (const comment of comments) {
    if (comment.type === 'stop') continue;

    const explanation = (comment.explanation ?? '').toLowerCase();
    const categoryKeywords = CATEGORY_SPECIFIC_KEYWORDS[comment.category] ?? [];
    const allKeywords = [...BLOCKER_KEYWORDS, ...categoryKeywords];

    const hasBlocker = allKeywords.some((kw) => explanation.includes(kw.toLowerCase()));

    if (!hasBlocker) {
      errors.push({
        file: comment.file,
        line: comment.line,
        message:
          `Explanation lacks blocker keyword. ` +
          `Must contain at least one of: ${BLOCKER_KEYWORDS.slice(0, 5).join(', ')}, ... ` +
          `See .claude/reference/coverage-exemptions.md for full list.`,
      });
    }
  }

  return { errors };
}
```

- [ ] **Step 2: Wire Phase B-1 into the main function**

In the `main()` function, after Phase B and before Phase C, add:

```javascript
// Phase B-1: Blocker keyword enforcement
const { errors: blockerErrors } = validateBlockerKeywords(Array.from(validComments));
```

Then add `blockerErrors` to the `allErrors` array:
```javascript
const allErrors = [...syntaxErrors, ...blockerErrors, ...patternErrors, ...neverValidErrors, ...coverageErrors];
```

- [ ] **Step 3: Run validation to check which comments fail**

Run: `node scripts/verify-v8-ignore.mjs 2>&1 | head -50`

Expected: Some errors from comments lacking blocker keywords. Note the count.

- [ ] **Step 4: Verify all 344 comments are still parsed correctly**

Run: `node scripts/verify-v8-ignore.mjs 2>&1 | grep "v8 ignore comments validated"`

Expected: `✓ 344 v8 ignore comments validated`

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-v8-ignore.mjs
git commit -m "feat: add Phase B-1 blocker keyword enforcement to v8 ignore validation"
```

### Task 1.2: Tighten Schema Detector

**Files:**
- Modify: `scripts/verify-v8-ignore.mjs` (lines ~364-384, schema detector)

- [ ] **Step 1: Remove overly broad patterns from schema detector**

Replace the `schema` detector's patterns array. Remove `body.`, `request.`, `params.` — keep only genuine schema validation patterns:

```javascript
const patterns = [
  /\.safeParse\s*\(/,
  /\.parse\s*\(/,
  /schema/i,
  /zod/i,
  /validate/i,
];
```

- [ ] **Step 2: Run validation to check for regressions**

Run: `node scripts/verify-v8-ignore.mjs 2>&1`

Check that no existing `schema` category comments now fail pattern validation. If any do, examine them — if they're genuinely schema-related but only referenced `body.` or `request.`, they need the explanation updated (done in Subtask 2) or the category changed.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-v8-ignore.mjs
git commit -m "fix: tighten schema detector to remove overly broad body/request/params patterns"
```

### Task 1.3: Update Coverage Exemptions Documentation

**Files:**
- Modify: `.claude/reference/coverage-exemptions.md`

- [ ] **Step 1: Add Phase B-1 documentation**

Add a new section after "Explanation Quality" documenting the blocker keyword enforcement:

```markdown
## Blocker Keyword Enforcement (CI-enforced)

The validation script (Phase B-1) enforces that every v8 ignore explanation contains at least one blocker keyword. This prevents descriptions that merely describe code behavior instead of naming the testing blocker.

**Universal blocker keywords** (accepted for all categories):
`cannot`, `unable`, `impossible`, `always returns`, `always succeeds`, `always has`, `always include`, `always provided`, `always defined`, `no support`, `not mockable`, `not reachable`, `not unit-testable`, `not tracked`, `never triggered`, `no way to`, `does not expose`, `unreachable`, `false positive`, `guarantees`, `guard`, `guaranteed`, `fallback`, `defensive`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `narrows`, `narrowing`

**Category-specific keywords** (accepted only for the listed category):
- `ts-type`: `type check`, `type narrowing`, `undefined check`, `null check`, `type system`, `nullish coalescing`, `optional property`, `spread`, `conditional`, `ternary`
- `module-init`: `bootstrap`, `entry point`, `cold start`, `module load`, `startup`, `initialized at`, `ESM import`
- `source-map`: `alignment`, `misattributed`
- `upstream`: `prior check`, `early return`, `validated`, `passthrough`
- `schema`: `Zod`, `Fastify schema`, `validation`
- `regex`: `capture group`, `match`
```

- [ ] **Step 2: Commit**

```bash
git add .claude/reference/coverage-exemptions.md
git commit -m "docs: document Phase B-1 blocker keyword enforcement rules"
```

---

## Subtask 2: Cross-Service V8 Ignore Explanation Audit & Fix

**Owner:** Cross-service audit agent
**Boundary:** All `.ts` files in `apps/`, `workers/`, `packages/` that contain `/* v8 ignore start --` comments
**No script or doc files are modified by this subtask.**

### Contract

**Input:** 193 v8 ignore explanations that currently lack blocker keywords (listed below by service)
**Output:** All 193 explanations updated to include at least one blocker keyword from the specification above
**Verification:** `node scripts/verify-v8-ignore.mjs` must pass with zero blocker keyword errors
**Rule:** Only the comment text changes. No code logic changes. No new v8 ignore comments. No removal of existing comments.

### Explanation Fix Patterns

When updating an explanation, follow these patterns:

| Current (BAD)                                             | Fixed (GOOD)                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `message undefined check`                                 | `noUncheckedIndexedAccess guard for message property`                          |
| `TypeScript type narrowing makes branch unreachable`      | `ts-type narrowing makes fallback branch unreachable`                          |
| `optional property check`                                 | `exactOptionalPropertyTypes guard for optional property`                       |
| `conditional spread filtered by undefined check`          | `conditional spread: fallback unreachable after undefined narrowing`           |
| `type narrowing for overloaded logger signature`          | `type narrowing guard for overloaded logger signature`                         |
| `costUsd should be defined but TypeScript can't prove it` | `TypeScript cannot narrow costUsd type after upstream ok check`                |
| `Firestore integration requires real database mock`       | `FakeFirestore cannot simulate real database query results`                    |
| `schema validation happens first`                         | `schema validation guard: Fastify schema rejects invalid input before handler` |
| `test setup mocks all services as healthy`                | `test-infra cannot simulate unhealthy service state`                           |

### Files by Service (with approximate count of fixes needed)

**apps/actions-agent** (7 fixes):
- `src/domain/usecases/approval/handleButtonResponse.ts`
- `src/domain/usecases/approval/handleProceedToImplementationButton.ts`
- `src/domain/usecases/executeActionTemplate.ts`
- `src/domain/usecases/executeLinearAction.ts`
- `src/domain/usecases/executeNoteAction.ts`
- `src/domain/usecases/executeResearchAction.ts`
- `src/domain/usecases/executeTodoAction.ts`

**apps/app-settings-service** (1 fix):
- `src/infra/firestore/usageStatsRepository.ts`

**apps/calendar-agent** (6 fixes):
- `src/infra/firestore/calendarPreviewRepository.ts`

**apps/chat-agent** (1 fix):
- `src/routes/chatRoutes.ts`

**apps/code-agent** (5 fixes):
- `src/routes/webhookRoutes.ts`
- `src/routes/webhooks/github.ts`

**apps/cron-agent** (1 fix):
- `src/infra/firestore-execution-repository.ts`

**apps/data-insights-agent** (1 fix):
- `src/routes/dataInsightsRoutes.ts`

**apps/hellscript-agent** (1 fix):
- `src/server.ts`

**apps/linear-agent** (12 fixes):
- `src/domain/issueDisplayMapper.ts`
- `src/domain/issueTreeBuilder.ts`
- `src/domain/useCases/processWebhook.ts`
- `src/infra/firestore/linearCommentRepository.ts`
- `src/infra/firestore/linearConnectionRepository.ts`
- `src/infra/firestore/linearIssueRepository.ts`
- `src/infra/http/codeAgentHttpClient.ts`
- `src/routes/internalIssuesRoutes.ts`
- `src/routes/linearRoutes.ts`

**apps/mobile-notifications-service** (4 fixes):
- `src/infra/firestore/firestoreNotificationRepository.ts`
- `src/infra/firestore/firestoreSignatureConnectionRepository.ts`
- `src/routes/notificationRoutes.ts`
- `src/routes/statusRoutes.ts`

**apps/notion-service** (3 fixes):
- `src/infra/firestore/notionConnectionRepository.ts`
- `src/routes/integrationRoutes.ts`
- `src/routes/internalRoutes.ts`

**apps/research-agent** (~40 fixes):
- `src/domain/research/formatLlmError.ts`
- `src/domain/research/usecases/processResearch.ts`
- `src/domain/research/usecases/retryFromFailed.ts`
- `src/domain/research/usecases/runSynthesis.ts`
- `src/domain/research/utils/htmlGenerator.ts`
- `src/infra/llm/ContextInferenceAdapter.ts`
- `src/infra/notion/markdownToNotionBlocks.ts`
- `src/infra/research/FirestoreResearchRepository.ts`
- `src/routes/helpers/completionHandlers.ts`
- `src/routes/internalRoutes.ts`
- `src/routes/researchRoutes.ts`

**apps/user-service** (5 fixes):
- `src/domain/settings/formatLlmError.ts`
- `src/infra/firestore/oauthConnectionRepository.ts`
- `src/routes/deviceRoutes.ts`
- `src/routes/frontendRoutes.ts`
- `src/routes/tokenRoutes.ts`

**apps/whatsapp-service** (~15 fixes):
- `src/domain/whatsapp/usecases/processWebhookEventUseCase.ts`
- `src/infra/firestore/messageRepository.ts`
- `src/routes/shared.ts`
- `src/routes/verificationRoutes.ts`
- `src/routes/webhookRoutes.ts`

**workers/log-cleanup** (1 fix):
- `src/cleanup.ts`

**workers/orchestrator** (~30 fixes, excluding INT-1071 overrides):
- `src/routes.ts`
- `src/scripts/view-metrics.ts`
- `src/services/isolation/docker-provider.ts`
- `src/services/task-dispatcher.ts`
- `src/services/turn-metrics-collector.ts`
- `src/services/webhook-client.ts`
- `src/services/worktree-manager.ts`
- `src/start.ts`

**workers/transcription** (2 fixes):
- `src/index.ts`
- `src/logger.ts`

**workers/vm-lifecycle** (1 fix):
- `src/start-vm.ts`

**packages/infra-otel** (1 fix):
- `src/register.ts`

**packages/infra-pubsub** (1 fix):
- `src/whatsappSendPublisher.ts`

**packages/infra-sentry** (1 fix):
- `src/otelTransport.ts`

**packages/llm-prompts** (8 fixes):
- `src/dataInsights/parseInsightResponse.ts`
- `src/research/modelExtractionPrompt.ts`
- `src/research/researchPrompt.ts`
- `src/research/synthesisPrompt.ts`
- `src/todos/itemExtractionPrompt.ts`
- `src/validation/inputImprovementPrompt.ts`

### Execution Strategy

Process files service by service. For each file:

1. Read the file
2. Find all `/* v8 ignore start --` comments
3. Check if explanation contains a blocker keyword from the specification
4. If not, update the explanation to include one while preserving accuracy
5. Only change the comment text — never change code logic

After all fixes:

- [ ] **Final step: Run validation**

Run: `node scripts/verify-v8-ignore.mjs`
Expected: `✓ 344 v8 ignore comments validated` with zero errors

- [ ] **Commit all fixes**

Stage all modified `.ts` files (only comment text changed, no code logic):

```bash
git add apps/ workers/ packages/
git commit -m "fix: update 193 v8 ignore explanations to include blocker keywords"
```
