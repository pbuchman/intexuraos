# INT-744: Unified Webhook Evaluator — Design & Implementation Plan

## Summary

Replace the two disconnected webhook processing paths in code-agent (hard rules for comments/reviews + fire-and-forget GitHub Agent LLM for PR opened/sync) with a single `UnifiedEvaluator` that runs hard rules first, then routes to the GitHub Agent LLM for triage when needed. Introduce `event_decisions` Firestore collection to record every event-to-action decision. Add `review` agent type to orchestrator for automated PR review dispatch.

## Problem

1. `issue_comment` events always dispatch if hard rules pass — no triage. Bot noise ("working..."), "+1", coverage reports all create worker resumes.
2. GitHub Agent result (for PR opened/sync) is logged but never gates dispatch — fire-and-forget.
3. No audit trail linking events to the decisions made about them.
4. Two disconnected code paths in `routes/webhooks/github.ts` (lines 218-228 for rules, lines 232-243 for GitHub Agent).

## Architecture

### Three-Outcome Rule System

Replace `RuleResult.shouldDispatch: boolean` with a discriminated union:

```typescript
type RuleOutcome =
  | { action: 'dispatch'; reason: string; context?: Record<string, unknown> }
  | { action: 'skip'; reason: string; context?: Record<string, unknown> }
  | { action: 'needs_triage'; reason: string; context?: Record<string, unknown> };
```

### Event-Type-Aware Rule Chain

Rules apply differently based on event type. `SenderWhitelistRule` and `SkipPrefixRule` only apply to `issue_comment` events — `pull_request` events bypass them because today `isGitHubAgentEvent()` evaluates any in-scope PR regardless of author or body prefix.

**Rule chain for `issue_comment` events:**

```
RepositoryScopeRule → ActionableEventRule → SenderWhitelistRule → SkipPrefixRule → BotReviewEditRule
```

**Rule chain for `pull_request` events:**

```
RepositoryScopeRule → ActionableEventRule
```

**Rule chain for `pull_request_review` events:**

```
RepositoryScopeRule → ActionableEventRule → SenderWhitelistRule
```

Implementation: Each rule gets an `appliesTo(event): boolean` method, or the chain builder constructs event-type-specific chains. The simpler approach: `SenderWhitelistRule` and `SkipPrefixRule` return `{ action: 'dispatch', reason: 'RULE_NOT_APPLICABLE' }` for non-`issue_comment` events (pass-through).

### ActionableEventRule Changes

| Event                                        | Before                        | After                     |
| -------------------------------------------- | ----------------------------- | ------------------------- |
| `issue_comment` created (any sender)         | `dispatch`                    | **`needs_triage`**        |
| `issue_comment` edited (any sender)          | `dispatch` (bot only)         | **`needs_triage`**        |
| `pull_request_review` submitted              | `dispatch`                    | `dispatch` (hard, no LLM) |
| `pull_request` opened/synchronize            | `skip` (EVENT_NOT_ACTIONABLE) | **`needs_triage`**        |
| Everything else                              | `skip`                        | `skip`                    |

### Rule Chain Propagation Semantics

The chain evaluates rules sequentially. Three-outcome logic:

- `skip` → **short-circuit return** (same as today)
- `dispatch` → **continue** to next rule (rule passed, check remaining)
- `needs_triage` → **propagate** through remaining rules; if a later rule returns `skip`, that wins; if all remaining return `dispatch`, final result is `needs_triage`

This means: `ActionableEventRule` returns `needs_triage`, then `SenderWhitelistRule` can still short-circuit to `skip` for unauthorized senders. Only events that pass ALL rules with no `skip` reach triage.

```typescript
evaluate(event: GitHubPREvent): RuleOutcome {
  let pendingTriage = false;
  for (const rule of this.rules) {
    const result = rule.evaluate(event);
    if (result.action === 'skip') return result;           // short-circuit
    if (result.action === 'needs_triage') pendingTriage = true;
    // 'dispatch' → continue
  }
  return pendingTriage
    ? { action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }
    : { action: 'dispatch', reason: 'ALL_RULES_PASSED' };
}
```

### Unified Evaluator Flow

```
webhook → parse → save → UnifiedEvaluator.evaluate()
  │
  ├─ Hard rules say DISPATCH → dispatch immediately → record EventDecision(decidedBy: 'hard_rules')
  ├─ Hard rules say SKIP → record EventDecision(decidedBy: 'hard_rules') → done
  └─ Hard rules say NEEDS_TRIAGE → GitHub Agent LLM
      ├─ Agent calls dispatch_to_task(template) → dispatch via dispatchService → record EventDecision(decidedBy: 'github_agent')
      ├─ Agent calls request_review(types) → create review task (agentType: 'review') → record EventDecision(decidedBy: 'github_agent')
      └─ Agent calls skip(reason) → record EventDecision(decidedBy: 'github_agent') → done
```

**Fallback behavior (no `toolCallingClient`):**
- `issue_comment` `needs_triage` → fall back to **dispatch** (preserves current behavior: comments always dispatched)
- `pull_request` `needs_triage` → fall back to **skip** (preserves current behavior: PRs were never dispatched by rules)

**LLM error fallback:** Same split — `issue_comment` dispatches, `pull_request` skips. Log error + record decision with error reason.

### GitHub Agent Tools

**For `pull_request` events (opened/synchronize):**

| Tool                           | Purpose                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `request_review(review_types)` | Request one or more reviews: code_quality, security, architecture. Creates a review task with `agentType: 'review'`. |
| `skip(reason)`                 | PR is trivial — docs-only, config, auto-generated                                                                    |

**For `issue_comment` events (created/edited):**

| Tool                                 | Purpose                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| `dispatch_to_task(message_template)` | Forward to task. Templates: `pr_comment`, `bot_review_edit`    |
| `skip(reason)`                       | Not actionable — bot noise, in-progress, "+1", coverage report |

### GitHub Agent Return Type

```typescript
type GitHubAgentTriageResult =
  | { action: 'dispatch'; template: 'pr_comment' | 'bot_review_edit' }
  | { action: 'request_review'; reviewTypes: string[] }
  | { action: 'skip'; reason: string };
```

The UnifiedEvaluator maps this to the appropriate dispatch path:
- `dispatch` → `dispatchService.dispatch()` with template-driven message builder
- `request_review` → `createReviewTask()` (new use case, creates task with `agentType: 'review'`)
- `skip` → no dispatch

### Issue Comment Triage Prompt

The GitHub Agent prompt expands to handle both event types. For issue_comment triage:

```
DISPATCH as 'pr_comment' when:
- User is asking a question about the code
- User is requesting a change
- User is providing feedback that needs action

DISPATCH as 'bot_review_edit' when:
- Bot review is FINALIZED (all checklist items checked, no spinner, has findings)

SKIP when:
- Bot review is still in progress (spinner, unchecked items, "working...")
- Comment is bot noise ("+1", thumbs up, "LGTM", coverage report)
- Comment is a status update with no action needed
- Comment is a duplicate of already-processed content
```

### `event_decisions` Firestore Collection

Owner: `code-agent`. One document per event that reaches the evaluator. ID generation: `ed_${uuidv4()}`.

```typescript
interface EventDecision {
  id: string;
  eventId: string;                     // FK → github-pr-events
  repository: string;
  pullRequestNumber: number;

  eventType: GitHubEventType;
  eventAction: string;
  senderLogin: string;

  decidedBy: 'hard_rules' | 'github_agent';

  decision: 'dispatch' | 'skip';
  reason: string;

  dispatchAction?: 'create_task' | 'send_message' | 'request_review';
  dispatchParams?: {
    taskId?: string;
    messageTemplate?: string;
    reviewTypes?: string[];            // array — supports multiple review types per decision
  };

  llmModel?: string;
  llmCostUsd?: number;
  llmToolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
  }>;

  createdAt: Date;
  decisionLatencyMs: number;
}
```

### Orchestrator Impact

**Review agent type:** The orchestrator already accepts `agentType: 'review'` in its schema and API types, but `buildSystemPrompt()` doesn't handle it (falls through to execution prompt). INT-744 adds:

1. **`reviewPrompt`** in `system-prompt.ts` — system prompt for automated PR review tasks
2. **`REVIEW_SCHEMA`** in `completion-verifier.ts` — verification schema for review agent output
3. **`buildSystemPrompt()` routing** — handle `resolvedAgentType === 'review'`

The review prompt instructs Claude to analyze the PR, post review comments, and output a `REVIEW_AGENT_FINAL` block. No code changes, no commits — read-only analysis.

All other orchestrator behavior (PR-comment label → pullRequestPrompt, resume/queue logic, completion verification) is unchanged.

## File Changes

### New Files (code-agent)

| File                                             | Purpose                              |
| ------------------------------------------------ | ------------------------------------ |
| `domain/services/unifiedEvaluator.ts`            | UnifiedEvaluator service             |
| `domain/models/eventDecision.ts`                 | EventDecision type                   |
| `domain/repositories/eventDecisionRepository.ts` | Repository port                      |
| `infra/firestore/eventDecisionRepository.ts`     | Firestore implementation             |
| `domain/prompts/issueCommentTriagePrompt.ts`     | Comment triage prompt section        |
| `domain/usecases/createReviewTask.ts`            | Create task with agentType: 'review' |

### Modified Files (code-agent)

| File                                       | Change                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/services/gitHubWebhookRules.ts`    | `RuleResult` → `RuleOutcome` discriminated union; `WebhookRule.evaluate()` returns `RuleOutcome`; event-type-aware rule applicability; chain propagation with `needs_triage` + `skip` semantics   |
| `domain/usecases/githubAgent.ts`           | Add `dispatch_to_task` tool; accept issue_comment events; return `GitHubAgentTriageResult`; remove `isGitHubAgentEvent()` (replaced by rules)                                                     |
| `domain/prompts/githubAgentPrompt.ts`      | Handle both PR and comment event types in prompt builder; bump version to 2.0.0                                                                                                                   |
| `routes/webhooks/github.ts`                | Replace two paths with single `unifiedEvaluator.evaluate()` call; remove `isGitHubAgentEvent` import                                                                                              |
| `services.ts`                              | Add `UnifiedEvaluator` and `EventDecisionRepository` to container; wire deps                                                                                                                      |
| `domain/services/gitHubDispatchService.ts` | Update `DispatchContext.decision` type from `RuleResult` to `RuleOutcome`; message builder selection driven by `messageTemplate` param from triage                                                |

### Modified Files (orchestrator)

| File                                                       | Change                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/system-prompt.ts`       | Add `reviewPrompt` PromptBuilder; handle `resolvedAgentType === 'review'` in `buildSystemPrompt()` |
| `workers/orchestrator/src/services/completion-verifier.ts` | Add `REVIEW_SCHEMA` Zod schema; handle `'review'` CompletionAgentType                              |
| `workers/orchestrator/src/services/task-dispatcher.ts`     | Add `'review'` to CompletionAgentType resolution chain                                             |

### Modified Files (root)

| File                         | Change                                                    |
| ---------------------------- | --------------------------------------------------------- |
| `firestore-collections.json` | Add `event_decisions` collection (owner: code-agent)      |

## Implementation Plan

Paths are within `apps/code-agent/src/` unless noted otherwise.

### Step 1: Event Decision Model & Repository

Create the domain model and Firestore persistence for decision records.

**Files:**
- CREATE `domain/models/eventDecision.ts` — `EventDecision` type, `CreateEventDecisionInput` type
- CREATE `domain/repositories/eventDecisionRepository.ts` — `EventDecisionRepository` port with `save(input): Promise<Result<EventDecision, RepositoryError>>`
- CREATE `infra/firestore/eventDecisionRepository.ts` — Firestore implementation
- MODIFY `firestore-collections.json` — add `event_decisions` entry

**Tests first:**
- `__tests__/infra/firestore/eventDecisionRepository.test.ts` — save, retrieve, validate fields

### Step 2: Three-Outcome Rule System

Refactor `RuleResult` into the `RuleOutcome` discriminated union with event-type-aware applicability.

**Files:**
- MODIFY `domain/services/gitHubWebhookRules.ts`:
  - Replace `RuleResult` with `RuleOutcome` type
  - Update `WebhookRule` interface: `evaluate()` returns `RuleOutcome`
  - Update `ActionableEventRule`:
    - `issue_comment` created → `needs_triage`
    - `issue_comment` edited → `needs_triage`
    - `pull_request_review` submitted → `dispatch`
    - `pull_request` opened/synchronize → `needs_triage`
  - Update `SenderWhitelistRule`: return pass-through `dispatch` for non-`issue_comment` events
  - Update `SkipPrefixRule`: return pass-through `dispatch` for non-`issue_comment` events
  - Update `GitHubWebhookRules.evaluate()` chain logic:
    - If rule returns `skip` → short-circuit return
    - If rule returns `needs_triage` → set `pendingTriage` flag, continue to next rule
    - If rule returns `dispatch` → continue to next rule
    - After all rules: return `needs_triage` if flag set, else `dispatch`

**Tests first:**
- Update all existing rule tests for new return type
- Add tests for `needs_triage` outcomes on issue_comment and PR events
- Test chain propagation: `needs_triage` followed by `skip` → `skip` wins
- Test chain propagation: `needs_triage` followed by `dispatch` → `needs_triage` propagates
- Test `SenderWhitelistRule` passes through for `pull_request` events
- Test `SkipPrefixRule` passes through for `pull_request` events

**Critical:** This step changes the public interface of `WebhookRulesService`. The dispatch service and route handler temporarily break — that's OK, they're fixed in steps 5/6.

### Step 3: Expand GitHub Agent for Issue Comment Triage

Add `dispatch_to_task` tool, accept `issue_comment` events, and return structured triage result.

**Files:**
- MODIFY `domain/usecases/githubAgent.ts`:
  - Rename `evaluatePREvent` → `evaluateEvent` (accepts both event types)
  - Remove `pull_request`-only validation; accept `issue_comment` too
  - Add `dispatch_to_task` tool definition with `message_template` parameter (enum: `pr_comment`, `bot_review_edit`)
  - Rename `skip_review` → `skip` (used for both event types)
  - Change `request_review` parameter from `review_type: string` to `review_types: string[]` (supports multiple)
  - Return `GitHubAgentTriageResult` (structured union type, not ad-hoc `GitHubAgentResult`)
  - Remove `isGitHubAgentEvent()` export (no longer needed)
- CREATE `domain/prompts/issueCommentTriagePrompt.ts`:
  - Prompt section for comment triage instructions
  - Decision criteria for dispatch vs skip
- MODIFY `domain/prompts/githubAgentPrompt.ts`:
  - Expand `GitHubAgentPromptInput` with `eventType`, `commentBody`, `isEdit`, `isBotSender`
  - Conditionally include PR file analysis OR comment triage section
  - Conditionally include appropriate tool descriptions
  - Bump version to `2.0.0` (behavior change)

**Tests first:**
- Test `evaluateEvent` with issue_comment event → LLM calls `dispatch_to_task`
- Test `evaluateEvent` with issue_comment event → LLM calls `skip`
- Test `evaluateEvent` with pull_request event → LLM calls `request_review` (existing behavior preserved)
- Test prompt builder outputs correct sections for each event type
- Test rejection of unsupported event types
- Test `request_review` with multiple review types

### Step 4: Review Agent Type in Orchestrator

Add the review prompt, verification schema, and routing for `agentType: 'review'`.

**Files (all in `workers/orchestrator/src/`):**
- MODIFY `services/system-prompt.ts`:
  - Add `reviewPrompt: PromptBuilder<SystemPromptParams>` — instructs Claude to perform read-only PR review, post review comments via `gh api`, output `REVIEW_AGENT_FINAL` block
  - Update `buildSystemPrompt()`: add `if (resolvedAgentType === 'review') return reviewPrompt.build(params);` before the planning/execution branches
- MODIFY `services/completion-verifier.ts`:
  - Add `REVIEW_SCHEMA = z.object({ gh_pr_url, review_comments_posted, review_types, summary })`
  - Handle `'review'` in the verification prompt builder
- MODIFY `services/task-dispatcher.ts`:
  - Add `'review'` to the CompletionAgentType resolution: `task.agentType === 'review' ? 'review' : ...`

**Tests first:**
- Test `buildSystemPrompt()` with `agentType: 'review'` → returns review prompt
- Test `REVIEW_SCHEMA` validates expected fields
- Test CompletionAgentType resolves `'review'` correctly
- Test review prompt content includes PR analysis instructions

### Step 5: UnifiedEvaluator Service & Review Task Creation

Create the service that ties rules, GitHub Agent, decision recording, and dispatch together.

**Files:**
- CREATE `domain/services/unifiedEvaluator.ts`:
  - `UnifiedEvaluatorDeps` interface
  - `createUnifiedEvaluator()` factory
  - `evaluate(event, logger)` method:
    1. `startTime = Date.now()`
    2. Run `webhookRules.evaluate(event)`
    3. If `skip` → save EventDecision(decidedBy: hard_rules, decision: skip) → return
    4. If `dispatch` → call `dispatchService.dispatch()` → save EventDecision(decidedBy: hard_rules, decision: dispatch) → return
    5. If `needs_triage`:
       a. If no `toolCallingClient`:
          - `issue_comment` → fall back to dispatch (log warning)
          - `pull_request` → fall back to skip (log warning)
       b. Call `evaluateEvent(deps, event)`
       c. Map `GitHubAgentTriageResult`:
          - `dispatch` → call `dispatchService.dispatch()` with template from LLM
          - `request_review` → call `createReviewTask()` with review types
          - `skip` → no dispatch
       d. Save EventDecision(decidedBy: github_agent, ...) → return
  - Handle LLM errors gracefully:
    - `issue_comment` → fall back to dispatch (don't lose events)
    - `pull_request` → fall back to skip (preserve current behavior)
- CREATE `domain/usecases/createReviewTask.ts`:
  - Creates a code task with `agentType: 'review'` via existing `createTaskForPR` infrastructure
  - Prompt includes review types requested and PR context

**Tests first:**
- Hard rule dispatch → dispatches, records decision, no LLM called
- Hard rule skip → records decision, no LLM called, no dispatch
- Needs triage (issue_comment) → LLM says dispatch → dispatches with correct template, records decision
- Needs triage (issue_comment) → LLM says skip → no dispatch, records decision
- Needs triage (pull_request) → LLM says request_review → creates review task, records decision with reviewTypes
- Needs triage (pull_request) → LLM says skip → no dispatch, records decision
- Needs triage (issue_comment) → no LLM → falls back to dispatch
- Needs triage (pull_request) → no LLM → falls back to skip
- Needs triage → LLM fails → event-type-aware fallback
- Decision latency recorded correctly

### Step 6: Wire Everything & Update Route

Connect the UnifiedEvaluator to the service container and simplify the route handler.

**Files:**
- MODIFY `services.ts`:
  - Add `EventDecisionRepository` and `UnifiedEvaluator` to `ServiceContainer`
  - Wire `createUnifiedEvaluator()` with all deps
- MODIFY `routes/webhooks/github.ts`:
  - Remove `isGitHubAgentEvent` and `evaluatePREvent` imports
  - Replace lines 218-243 (dual path) with single `void unifiedEvaluator.evaluate(savedEvent, logger)`
  - Remove direct `webhookRules` and `dispatchService` usage from route
- MODIFY `domain/services/gitHubDispatchService.ts`:
  - Update `DispatchContext.decision` type from `RuleResult` to `RuleOutcome`
  - Add optional `messageTemplate` field to `DispatchContext` for LLM-driven template selection
  - Update all tests that construct `DispatchContext` with `RuleResult` → `RuleOutcome`

**Tests first:**
- Integration test: issue_comment webhook → triage → dispatch or skip
- Integration test: pull_request webhook → triage → request_review or skip
- Integration test: pull_request_review webhook → hard dispatch (no LLM)
- Verify `setServices()` test helpers still work with new container shape
- Route handler test: single code path, no dual dispatch

### Step 7: Audit & Cleanup

- Remove dead code: `isGitHubAgentEvent()`, any unused imports
- Audit: search for `RuleResult` references across codebase — ensure all updated to `RuleOutcome`
- Run `pnpm run ci:tracked` — must pass (code-agent AND orchestrator)
- Verify existing webhook rule tests still pass with new types

## Endpoint Changes

- **Modified:** `POST /webhooks/github` — internal behavior change only, same request/response contract
- **Created:** none
- **Removed:** none
- **Unchanged:** all other endpoints

## Risks

1. **LLM latency on webhook response** — triage is fire-and-forget (same as current dispatch), so webhook returns 200 immediately. LLM latency only affects dispatch timing, not GitHub's webhook timeout.
2. **LLM unavailability** — event-type-aware fallback: issue_comments dispatch (preserves current behavior), pull_requests skip (preserves current behavior). No events silently lost.
3. **RuleOutcome type change breaks tests** — Step 2 intentionally breaks consumers. Steps 5/6 fix them. Run in sequence.
4. **Review prompt quality** — new review agent type has no production history. Start with conservative prompt; iterate based on EventDecision audit data.
5. **Cross-workspace CI** — Steps 1-3, 5-6 affect code-agent only. Step 4 affects orchestrator. Step 7 runs full `pnpm run ci:tracked` across both.
