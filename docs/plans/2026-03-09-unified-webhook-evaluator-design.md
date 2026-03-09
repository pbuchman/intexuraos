# INT-744: Unified Webhook Evaluator — Design & Implementation Plan

## Summary

Replace the two disconnected webhook processing paths in code-agent (hard rules for comments/reviews + fire-and-forget GitHub Agent LLM for PR opened/sync) with a single `UnifiedEvaluator` that runs hard rules first, then routes to the GitHub Agent LLM for triage when needed. Introduce `event_decisions` Firestore collection to record every event-to-action decision.

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

### ActionableEventRule Changes

| Event                                        | Before                        | After                     |
| -------------------------------------------- | ----------------------------- | ------------------------- |
| `issue_comment` created (any allowed sender) | `dispatch`                    | **`needs_triage`**        |
| `issue_comment` edited (by allowed bot)      | `dispatch`                    | **`needs_triage`**        |
| `pull_request_review` submitted              | `dispatch`                    | `dispatch` (hard, no LLM) |
| `pull_request` opened/synchronize            | `skip` (EVENT_NOT_ACTIONABLE) | **`needs_triage`**        |
| Everything else                              | `skip`                        | `skip`                    |

`SenderWhitelistRule` and `SkipPrefixRule` still short-circuit to `skip` before triage.

### Unified Evaluator Flow

```
webhook → parse → save → UnifiedEvaluator.evaluate()
  │
  ├─ Hard rules say DISPATCH → dispatch immediately → record EventDecision(decidedBy: 'hard_rules')
  ├─ Hard rules say SKIP → record EventDecision(decidedBy: 'hard_rules') → done
  └─ Hard rules say NEEDS_TRIAGE → GitHub Agent LLM
      ├─ Agent calls dispatch_to_task(template) → dispatch → record EventDecision(decidedBy: 'github_agent')
      ├─ Agent calls request_review(type) → dispatch → record EventDecision(decidedBy: 'github_agent')
      └─ Agent calls skip(reason) → record EventDecision(decidedBy: 'github_agent') → done
```

Fallback: if `toolCallingClient` is undefined (no Gemini API key), `needs_triage` events dispatch directly — preserving current behavior without LLM.

### GitHub Agent Tools

**For `pull_request` events (opened/synchronize):**

| Tool                          | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `request_review(review_type)` | Request code_quality, security, or architecture review |
| `skip(reason)`                | PR is trivial — docs-only, config, auto-generated      |

**For `issue_comment` events (created/edited):**

| Tool                                 | Purpose                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| `dispatch_to_task(message_template)` | Forward to task. Templates: `pr_comment`, `bot_review_edit`    |
| `skip(reason)`                       | Not actionable — bot noise, in-progress, "+1", coverage report |

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

Owner: `code-agent`. One document per event that reaches the evaluator.

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
    reviewType?: string;
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

None. The orchestrator's prompt routing (PR-comment label → pullRequestPrompt), resume/queue logic, and completion verification are unchanged. All changes are upstream in code-agent.

## File Changes

### New Files

| File                                             | Purpose                       |
| ------------------------------------------------ | ----------------------------- |
| `domain/services/unifiedEvaluator.ts`            | UnifiedEvaluator service      |
| `domain/models/eventDecision.ts`                 | EventDecision type            |
| `domain/repositories/eventDecisionRepository.ts` | Repository port               |
| `infra/firestore/eventDecisionRepository.ts`     | Firestore implementation      |
| `domain/prompts/issueCommentTriagePrompt.ts`     | Comment triage prompt section |

### Modified Files

| File                                    | Change                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/services/gitHubWebhookRules.ts` | `RuleResult` → `RuleOutcome` discriminated union; `WebhookRule.evaluate()` returns `RuleOutcome`; `ActionableEventRule` returns `needs_triage` for issue_comment and PR opened/sync |
| `domain/usecases/githubAgent.ts`        | Add `dispatch_to_task` tool; accept issue_comment events; remove `isGitHubAgentEvent()` (replaced by rules)                                                                         |
| `domain/prompts/githubAgentPrompt.ts`   | Handle both PR and comment event types in prompt builder; bump version to 2.0.0                                                                                                     |
| `routes/webhooks/github.ts`             | Replace two paths with single `unifiedEvaluator.evaluate()` call; remove `isGitHubAgentEvent` import                                                                                |
| `services.ts`                           | Add `UnifiedEvaluator` and `EventDecisionRepository` to container; wire deps                                                                                                        |
| `firestore-collections.json`            | Add `event_decisions` collection (owner: code-agent)                                                                                                                                |

## Implementation Plan

All paths are within `apps/code-agent/src/` unless noted otherwise.

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

Refactor `RuleResult` into the `RuleOutcome` discriminated union.

**Files:**
- MODIFY `domain/services/gitHubWebhookRules.ts`:
  - Replace `RuleResult` with `RuleOutcome` type
  - Update `WebhookRule` interface: `evaluate()` returns `RuleOutcome`
  - Update `ActionableEventRule`:
    - `issue_comment` created → `needs_triage`
    - `issue_comment` edited by allowed bot → `needs_triage`
    - `pull_request_review` submitted → `dispatch`
    - `pull_request` opened/synchronize → `needs_triage`
  - Update `SenderWhitelistRule`, `SkipPrefixRule` to return `RuleOutcome`
  - Update `GitHubWebhookRules.evaluate()` chain logic:
    - If rule returns `skip` → short-circuit return
    - If rule returns `needs_triage` → propagate (don't short-circuit)
    - If all rules pass with `dispatch` → return `dispatch`

**Tests first:**
- Update all existing rule tests for new return type
- Add tests for `needs_triage` outcomes on issue_comment and PR events
- Test chain behavior: `needs_triage` propagates through remaining rules, `skip` still short-circuits

**Critical:** This step changes the public interface of `WebhookRulesService`. The dispatch service and route handler temporarily break — that's OK, they're fixed in steps 4/5.

### Step 3: Expand GitHub Agent for Issue Comment Triage

Add `dispatch_to_task` tool and accept `issue_comment` events.

**Files:**
- MODIFY `domain/usecases/githubAgent.ts`:
  - Rename `evaluatePREvent` → `evaluateEvent` (accepts both event types)
  - Remove `pull_request`-only validation; accept `issue_comment` too
  - Add `dispatch_to_task` tool definition with `message_template` parameter (enum: `pr_comment`, `bot_review_edit`)
  - Rename `skip_review` → `skip` (used for both event types)
  - Return structured result including dispatch action and template
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

### Step 4: UnifiedEvaluator Service

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
       a. If no `toolCallingClient` → fall back to dispatch directly (log warning)
       b. Call `evaluateEvent(deps, event)`
       c. Map LLM result to dispatch or skip
       d. If dispatch → call `dispatchService.dispatch()` with template from LLM
       e. Save EventDecision(decidedBy: github_agent, ...) → return
  - Handle LLM errors gracefully — if triage fails, fall back to dispatch (don't lose events)

**Tests first:**
- Hard rule dispatch → dispatches, records decision, no LLM called
- Hard rule skip → records decision, no LLM called, no dispatch
- Needs triage → LLM says dispatch → dispatches with correct template, records decision
- Needs triage → LLM says skip → no dispatch, records decision
- Needs triage → no LLM available → falls back to dispatch, records decision with reason
- Needs triage → LLM fails → falls back to dispatch, records decision with error
- Decision latency recorded correctly

### Step 5: Wire Everything & Update Route

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
  - Message builder selection now driven by `dispatchParams.messageTemplate` from triage, not hardcoded in `createWebhookMessageBuilder`

**Tests first:**
- Integration test: issue_comment webhook → triage → dispatch or skip
- Integration test: pull_request webhook → triage → request_review or skip
- Integration test: pull_request_review webhook → hard dispatch (no LLM)
- Verify `setServices()` test helpers still work with new container shape
- Route handler test: single code path, no dual dispatch

### Step 6: Audit & Cleanup

- Remove dead code: `isGitHubAgentEvent()`, any unused imports
- Audit: search for `RuleResult` references across codebase — ensure all updated to `RuleOutcome`
- Run `pnpm run ci:tracked` — must pass
- Verify existing webhook rule tests still pass with new types

## Endpoint Changes

- **Modified:** `POST /webhooks/github` — internal behavior change only, same request/response contract
- **Created:** none
- **Removed:** none
- **Unchanged:** all other endpoints

## Risks

1. **LLM latency on webhook response** — triage is fire-and-forget (same as current dispatch), so webhook returns 200 immediately. LLM latency only affects dispatch timing, not GitHub's webhook timeout.
2. **LLM unavailability** — fallback to direct dispatch. No events lost.
3. **RuleOutcome type change breaks tests** — Step 2 intentionally breaks consumers. Steps 4/5 fix them. Run in sequence.
