# INT-852: Unified PR Automation Log

## Problem

GitHub PRs processed by IntexuraOS automation have 11 silent paths where decisions happen without visible feedback on the PR:

1. Webhook-route skips (unsupported event types, invalid payloads, duplicate deliveries, out-of-scope repos via `shouldProcessRepository()`)
2. Hard-rule skips (`CodeWorkerOutputRule`, `ActionableEventRule`, `ProtectedBaseBranchRule`, `SenderWhitelistRule`, `SkipPrefixRule`, `BotReviewEditRule`)
3. Hard-rule direct dispatches (e.g., `pull_request_review.submitted`)
4. LLM triage skips on `issue_comment` events
5. LLM triage failures (non-`@review` commands)
6. No LLM configured -- silent fallback
7. Successful execution completion
8. Successful review completion
9. Successful planning completion
10. Task failure without `prNumber`
11. Task dispatched but never started

Current notification logic is scattered across `prTaskNotification.ts` (4 comment builders -- 2 private: `buildTaskDispatchComment`, `buildDispatchFailedComment`; 2 exported: `buildTaskFailureComment`, `buildReviewReplacementComment` -- and 4 posting functions) and `unifiedEvaluator.ts` (2 comment builders, 2 inline error builders). There are 8 distinct comment formats with inconsistent structure.

## Solution

A single `PRCommentService` within code-agent that:
- Owns all PR notification logic behind a domain-agnostic port interface
- Maintains one status comment per PR, created at webhook receipt and PATCHed as events happen
- Accepts a typed discriminated union of 11 event types covering the full automation lifecycle
- Replaces all 8 existing comment builders and posting functions

## Architecture

### Domain Port

```typescript
interface AutomationLog {
  record(prRef: PRRef, event: AutomationEvent): Promise<void>;
}

interface PRRef {
  repository: string;   // e.g., "pbuchman/intexuraos"
  prNumber: number;
}
```

All decision points call `automationLog.record(prRef, event)`. The domain layer does not know that events are rendered as GitHub PR comments.

### Infrastructure Implementation

`GitHubPRAutomationLog` implements `AutomationLog`:

1. Look up `pr_automation_comments` Firestore doc by `{repository}:{prNumber}`
2. Render event to markdown via `AutomationCommentRenderer.renderEvent(event)`
3. If no doc exists: POST new GitHub comment with header + event line, save `{commentId, tokenUserId}` to Firestore
4. If doc exists: GET current comment body from GitHub API, append new event line, PATCH comment via existing `updateIssueComment`
5. Update Firestore doc (`eventCount`, `updatedAt`)

Error handling: best-effort throughout. Log warnings on failure, never block the caller. Matches existing pattern.

### Dependencies

```
GitHubPRAutomationLog
  |-- GitHubPRClient (existing port -- add getIssueComment; reuse existing updateIssueComment for PATCH)
  |-- PRAutomationCommentRepository (new -- Firestore CRUD)
  +-- UserServiceClient (existing -- OAuth token resolution for updates)
```

### New Firestore Collection: `pr_automation_comments`

Owner: `code-agent`. Registered in `firestore-collections.json`.

```typescript
// Document ID: "{repository}:{prNumber}" e.g. "pbuchman/intexuraos:42"
interface PRAutomationComment {
  repository: string;
  prNumber: number;
  commentId: number;       // GitHub comment ID for GET/PATCH
  tokenUserId: string;     // IntexuraOS user ID whose OAuth token to use
  eventCount: number;
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
}
```

### Services Wiring

In `apps/code-agent/src/services.ts`:

```typescript
// New port
automationLog: AutomationLog;

// Wired as:
automationLog: new GitHubPRAutomationLog({
  gitHubPRClient,
  prAutomationCommentRepo: new FirestorePRAutomationCommentRepository(firestore),
  resolveOAuthToken: async (userId) => userServiceClient.getOAuthToken(userId, 'github'),
  logger,
}),
```

Injected into: `unifiedEvaluator`, `gitHubDispatchService`, use case callers (`createTaskForPR`, `createReviewTask`), and the new `task-event` route handler.

## Event Catalog

```typescript
type AutomationEvent =
  // Phase 1: Webhook arrival
  | {
      type: 'webhook_received';
      eventType: string;       // e.g., "pull_request"
      action: string;          // e.g., "opened"
      sender: string;          // GitHub login
      deliveryId: string;      // X-GitHub-Delivery header
    }

  // Phase 2: Decision -- skip
  | {
      type: 'skipped';
      decidedBy: 'webhook_route' | 'hard_rules' | 'llm_triage';
      reason: string;          // e.g., "PROTECTED_BASE_BRANCH"
      ruleName?: string;       // e.g., "ProtectedBaseBranchRule"
      cost?: number;           // LLM cost in USD (llm_triage only)
      reasoning?: string;      // LLM reasoning (llm_triage only)
      toolCalls?: string[];    // Deduplicated tool call summaries
    }

  // Phase 3: Decision -- dispatch via LLM triage
  | {
      type: 'triage_dispatch';
      reviewTypes?: string[];  // e.g., ["code_review", "architecture"]
      workerType?: string;     // e.g., "opus"
      cost: number;
      reasoning: string;
      toolCalls: string[];
    }

  // Phase 3b: Triage failure
  | {
      type: 'triage_failed';
      error: string;
      fallbackAction: 'dispatch' | 'skip' | 'none';
    }

  // Phase 4: Task dispatch
  | {
      type: 'task_dispatched';
      taskId: string;
      workerType: string;
      agentType: string;       // "planning" | "execution" | "review"
      linearIssueId?: string;
    }
  | {
      type: 'task_dispatch_failed';
      error: string;
      errorCode?: string;
    }

  // Phase 5: Task lifecycle (from orchestrator via task-event endpoint)
  | {
      type: 'task_started';
      taskId: string;
      workerType: string;
      attempt: number;
    }
  | {
      type: 'task_completed';
      taskId: string;
      status: string;          // "implemented" | "reviewed" | "planned"
      duration: number;        // milliseconds
      prUrl?: string;
      commits?: Array<{ sha: string; message: string }>;
    }
  | {
      type: 'task_failed';
      taskId: string;
      error: string;
      errorCode?: string;
      duration?: number;
    }
  | {
      type: 'task_interrupted';
      taskId: string;
      duration?: number;
    }

  // Phase 6: Review lifecycle
  | {
      type: 'review_replaced';
      replacedTaskId: string;
      replacedWorkerType?: string;
    };
```

### Coverage Matrix

| Silent Path                      | Event Type                                                           |
| -------------------------------- | -------------------------------------------------------------------- |
| Webhook-route skips              | `skipped` with `decidedBy: 'webhook_route'`                          |
| Hard-rule skips                  | `skipped` with `decidedBy: 'hard_rules'`                             |
| Hard-rule direct dispatch        | `task_dispatched` (no triage involved, dispatched directly by rules) |
| LLM skip on `issue_comment`      | `skipped` with `decidedBy: 'llm_triage'`                             |
| LLM triage failure (non-@review) | `triage_failed`                                                      |
| No LLM configured                | `triage_failed` with `error: 'no_llm_configured'`                    |
| Execution completes successfully | `task_completed` with `status: 'implemented'`                        |
| Review completes successfully    | `task_completed` with `status: 'reviewed'`                           |
| Planning completes successfully  | `task_completed` with `status: 'planned'`                            |
| Task fails without `prNumber`    | `task_failed` (PR resolved from task record's stored PR context)     |
| Task dispatched, never starts    | `task_dispatched` with no subsequent `task_started`                  |

## Comment Format

All comments start with `@ignore` (prevents webhook feedback loops via `SkipPrefixRule`).

Each event renders as one line with optional collapsible detail:

```markdown
**{HH:MM UTC}** -- {one-line summary}
<details><summary>{detail label}</summary>

{expanded content}
</details>
```

### Full Lifecycle Example

```markdown
@ignore
### IntexuraOS Automation

**14:03** -- `pull_request.opened` by @pbuchman

**14:03** -- Triage -> **Dispatching review** (`code_review`, `architecture`)
<details><summary>$0.003 | 1 tool call</summary>

- `request_review(types: ["code_review", "architecture"])`
- Reasoning: PR modifies core auth logic and adds new endpoint
</details>

**14:03** -- Task dispatched: [`task_abc123`](https://intexuraos.cloud/#/code-tasks/task_abc123) | opus

**14:04** -- Task started | attempt 1

**14:13** -- **Completed** | 8m 42s | [PR #1234](https://github.com/org/repo/pull/1234)
<details><summary>2 commits</summary>

- [`abc1234`](https://github.com/org/repo/commit/abc1234) fix: add auth middleware
- [`def5678`](https://github.com/org/repo/commit/def5678) test: auth middleware tests
</details>
```

### Skip Example

```markdown
@ignore
### IntexuraOS Automation

**14:03** -- `pull_request.opened` by @pbuchman

**14:03** -- **Skipped** | PROTECTED_BASE_BRANCH
<details><summary>Hard rules decision</summary>

- Rule: ProtectedBaseBranchRule
- PR targets `main` -- release merges are already reviewed
</details>
```

### Failure Example

```markdown
@ignore
### IntexuraOS Automation

**14:03** -- `issue_comment.created` by @pbuchman

**14:03** -- Triage -> **Dispatching task**
<details><summary>$0.002 | 1 tool call</summary>

- `dispatch_to_task(template: "default")`
- Reasoning: User requests implementation
</details>

**14:03** -- Task dispatched: [`task_xyz789`](https://intexuraos.cloud/#/code-tasks/task_xyz789) | sonnet

**14:04** -- Task started | attempt 1

**14:15** -- **Failed** | 11m 03s | CI_FAILED
<details><summary>Error detail</summary>

- Error: CI pipeline failed after implementation
- Task ID: `task_xyz789`
</details>
```

## Orchestrator Changes

### New Endpoint: `POST /internal/webhooks/task-event`

Code-agent receives structured lifecycle events from the orchestrator.

```typescript
// Request body
interface TaskEventWebhookBody {
  taskId: string;
  event: 'task_started' | 'task_completed' | 'task_failed' | 'task_interrupted';
  attempt?: number;
  workerType?: string;
  duration?: number;       // milliseconds
  commits?: Array<{ sha: string; message: string }>;
  prUrl?: string;
  prNumber?: number;
  error?: { code: string; message: string };
}
```

Signed with HMAC-SHA256 using the task's webhook secret (same pattern as `task-complete`).

### Orchestrator: Enhanced `checkForResult()`

Current behavior: queries `gh pr list --json url,number,headRefName,title,commits` and extracts commit count as `commits.length`.

Enhanced behavior: extract individual commit SHAs and messages:

```typescript
// Current: commits?: unknown[]
// Enhanced:
commits?: Array<{ oid: string; messageHeadline: string }>

// Mapped to result:
result.commitDetails = pr.commits?.map(c => ({
  sha: c.oid,
  message: c.messageHeadline,
}));
```

**Limitation**: `checkForResult()` has two code paths -- `gh pr list` (standard) and `gh pr view` (continuation PRs). Commit SHA extraction is implemented for the `gh pr list` path. The `gh pr view` path for continuation PRs should be enhanced in a follow-up to also extract commit details.

### Orchestrator: URL Routing for Task Lifecycle Events

The orchestrator does not have a `callbackBaseUrl` -- it stores a full `task.webhookUrl` per task (e.g., `https://code-agent.../internal/webhooks/task-complete`), set by the dispatching use cases (`createTaskForPR.ts:346`, `createReviewTask.ts`, `retryTask.ts`).

**Approach**: Derive the task-event URL from the existing `task.webhookUrl` by replacing the path suffix:

```typescript
// In task-dispatcher.ts helper:
function getTaskEventUrl(webhookUrl: string): string {
  return webhookUrl.replace('/internal/webhooks/task-complete', '/internal/webhooks/task-event');
}
```

This avoids adding a new field to the task data model. Both endpoints share the same service base URL and the same `webhookSecret` for HMAC validation.

### Orchestrator: New `task_started` Event

In `task-dispatcher.ts`, after container launch succeeds, send:

```typescript
await this.webhookClient.send({
  url: getTaskEventUrl(task.webhookUrl),
  secret: task.webhookSecret,
  payload: {
    taskId: task.taskId,
    event: 'task_started',
    attempt: task.currentAttempt,
    workerType: task.workerType,
  },
  taskId: task.taskId,
});
```

### Orchestrator: Enhanced `finalizeTask()`

The existing `task-complete` callback continues to work. The `task-complete` handler in `webhookRoutes.ts` calls `automationLog.record()` for `task_completed` / `task_failed` / `task_interrupted` events, including commit details from the enhanced result payload.

## Code-Agent Changes

### New Files

| File                                                   | Purpose                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `src/domain/ports/automationLog.ts`                    | Port interface: `AutomationLog`, `PRRef`, `AutomationEvent` types |
| `src/domain/services/automationCommentRenderer.ts`     | Pure function: event -> markdown line(s)                          |
| `src/infra/services/gitHubPRAutomationLog.ts`          | Infrastructure: implements `AutomationLog` via GitHub API         |
| `src/infra/firestore/prAutomationCommentRepository.ts` | Firestore CRUD for `pr_automation_comments`                       |
| `src/routes/webhooks/taskEvent.ts`                     | Route handler for `POST /internal/webhooks/task-event`            |

### Modified Files

| File                                                | Change                                                                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services.ts`                                   | Wire `AutomationLog` into service container                                                                                                                                                                             |
| `src/domain/services/unifiedEvaluator.ts`           | Replace inline comment builders with `automationLog.record()`                                                                                                                                                           |
| `src/domain/services/gitHubDispatchService.ts`      | Replace notification calls with `automationLog.record()`                                                                                                                                                                |
| `src/domain/usecases/createTaskForPR.ts`            | Replace `notifyPROfTaskDispatch()` and `notifyDispatchFailed()` calls                                                                                                                                                   |
| `src/domain/usecases/createReviewTask.ts`           | Replace `notifyPROfTaskDispatch()` and `notifyReviewReplaced()` calls                                                                                                                                                   |
| `src/domain/utils/continuationPr.ts`                | Replace `postContinuationPrComment()` and `bootstrapContinuationPrTaskComment()` with `automationLog.record()`                                                                                                          |
| `src/routes/webhookRoutes.ts`                       | Replace `notifyTaskOutcome()` calls (6 sites) with `automationLog.record()`                                                                                                                                             |
| `src/routes/webhooks/github.ts`                     | Add `automationLog.record()` for `webhook_received` and route-level skips                                                                                                                                               |
| `src/infra/http/gitHubPRHttpClient.ts`              | Add `getIssueComment()` method (for GET before update)                                                                                                                                                                  |
| `src/domain/ports/gitHubPRClient.ts`                | Add `getIssueComment` to port interface                                                                                                                                                                                 |
| `src/domain/usecases/detectMergeConflictsOnPush.ts` | Out of scope: posts `@ignore`-prefixed merge conflict comments via `postPRComment` but these are standalone conflict notifications, not automation lifecycle events. Update `fetchGitHubToken` import after relocation. |

### Deleted Code

| Target                                   | Detail                                                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/utils/prTaskNotification.ts` | Delete file. All 4 builders + 4 posting functions replaced by `AutomationLog`.                                                                                                           |
| `fetchGitHubToken` utility               | Relocate to `src/domain/utils/gitHubTokenResolver.ts` before deleting `prTaskNotification.ts` -- used by `createTaskForPR.ts`, `detectMergeConflictsOnPush.ts`, and `continuationPr.ts`. |

Note: `notifyTaskOutcome()` (the actually-used export from `prTaskNotification.ts`) is called 6 times from `webhookRoutes.ts`. All call sites are migrated to `automationLog.record()`.

### PR Title Update Logic

The current `notifyPROfTaskDispatch()` has a side effect: it updates the PR title to include `[INT-XXX]` when a Linear issue is linked. This behavior is orthogonal to the automation log and must be preserved. It will be extracted to `createTaskForPR.ts` and `createReviewTask.ts` as a direct `gitHubPRClient.updatePRTitle()` call at the use case level.

## GitHubPRClient Port Changes

```typescript
// Added to existing port interface (updateIssueComment already exists for PATCH):
getIssueComment(
  token: string,
  owner: string,
  repo: string,
  commentId: number,
): Promise<Result<{ body: string }>>;
```

HTTP implementation:
- `GET https://api.github.com/repos/{owner}/{repo}/issues/comments/{commentId}`

The existing `updateIssueComment` method handles `PATCH https://api.github.com/repos/{owner}/{repo}/issues/comments/{commentId}`.

## Firestore Migration

New migration file: `migrations/061_create-pr-automation-comments.mjs`

Creates the `pr_automation_comments` collection. No composite indexes needed -- lookups are by document ID only.

## Testing Strategy

| Component                       | Test Type       | Pattern                                                                                                                                  |
| ------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AutomationCommentRenderer`     | Unit            | Pure function: event in, markdown out. One test per event type + edge cases (long reasoning, empty tool calls, missing optional fields). |
| `GitHubPRAutomationLog`         | Unit            | Fake `GitHubPRClient` + fake `PRAutomationCommentRepository`. Verify create-new vs. get-append-update flow.                              |
| `PRAutomationCommentRepository` | Unit            | In-memory Firestore fake. CRUD operations.                                                                                               |
| `unifiedEvaluator`              | Update existing | Replace comment body assertions with `automationLog.record()` call assertions.                                                           |
| `gitHubDispatchService`         | Update existing | Replace notification assertions with `automationLog.record()` assertions.                                                                |
| `createTaskForPR`               | Update existing | Replace `notifyPROfTaskDispatch()` assertions with `automationLog.record()` assertions.                                                  |
| `createReviewTask`              | Update existing | Replace `notifyPROfTaskDispatch()` / `notifyReviewReplaced()` assertions.                                                                |
| `webhookRoutes`                 | Update existing | Replace `notifyTaskOutcome()` assertions (6 sites) with `automationLog.record()`.                                                        |
| `webhooks/github.ts`            | Update existing | Verify `automationLog.record()` called for webhook_received and route-level skips.                                                       |
| `taskEvent route`               | New             | Verify HMAC validation + `automationLog.record()` dispatch.                                                                              |

All tests use in-memory fakes -- no external dependencies.

## Concurrency

Two events for the same PR arriving simultaneously could race on GET + PATCH. The GET of the second event might miss the first PATCH, silently dropping an event line. Mitigations:

1. **Primary**: Events for the same PR are naturally sequential (webhook -> triage -> dispatch -> completion). Concurrent events are rare.
2. **Secondary**: If concurrency becomes an issue, add a `version` field to the `pr_automation_comments` Firestore doc. Use Firestore transactions with optimistic concurrency: read version, GET comment, PATCH comment, write version. Retry on version conflict.

## Endpoint Changes

### Created

| Endpoint                             | Service    | Purpose                                          |
| ------------------------------------ | ---------- | ------------------------------------------------ |
| `POST /internal/webhooks/task-event` | code-agent | Receives task lifecycle events from orchestrator |

### Modified

_None_

### Removed

_None_

### Unchanged

All existing webhook endpoints (`POST /webhooks/github`, `POST /internal/webhooks/task-complete`, etc.)

## Future Enhancements

1. **Real-time turn reporting**: Parse Claude Code session JSONL during execution for individual turn visibility (tool calls, file edits, test runs)
2. **Commit streaming**: Periodic `git log` checks during execution to report commits as they happen, not just at completion
3. **Continuation PR commits**: Enhance `gh pr view` code path in `checkForResult()` to also extract commit SHAs (currently only the `gh pr list` path extracts them)
4. **Multi-PR tasks**: Tasks that create PRs to multiple repos -- track automation comments across repos
