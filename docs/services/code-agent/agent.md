# Code Agent - Agent Reference

Machine-readable reference for AI agents interacting with the code-agent service.

## Identity

```yaml
name: code-agent
version: 3.2.0
port: 8128
framework: fastify
runtime: node22
deploy: cloud-run
collections:
  - code_tasks (subcollections: logs, log_lines, turn_metrics)
  - user_spend
  - user_usage
  - code_worker_settings
  - github-pr-events
  - github-pr-summaries
  - pr_task_locks
```

## Capabilities

### Task Submission

```typescript
// Internal (from actions-agent)
interface ProcessCodeActionRequest {
  actionId: string;
  approvalEventId: string;
  userId: string;
  prompt: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
  linearIssueId?: string;
  repository?: string;
  baseBranch?: string;
  traceId?: string;
  source?: 'whatsapp' | 'web';
}

// Public (from web UI)
interface SubmitCodeTaskRequest {
  prompt: string; // 1-100000 chars
  workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus'; // default: 'auto'
  workerLocation?: string; // 1-32 chars
  linearIssueId?: string;
  linearIssueTitle?: string;
}
```

All prompts pass through two sanitization layers before reaching the worker:

1. **Secret redaction** (`sanitizePrompt`): Strips AWS keys, OpenAI/Anthropic API keys, Stripe secrets, GitHub tokens, Slack tokens, Bearer JWTs, PEM private keys, and secret env var assignments. Sensitive URL query parameters are redacted.
2. **Injection prevention** (`sanitizePromptForInjection`): Rejects system override markers (`[SYSTEM]`, `<|im_start|>`), strips control characters, and blocks base64 blobs over 3000 characters.

### Task Lifecycle

```typescript
// 'planned' = planning agent completed; 'implemented' = execution agent completed
// 'completed' is NOT used -- tasks finish as 'planned' or 'implemented'
type TaskStatus =
  | 'dispatched'
  | 'running'
  | 'queued'       // waiting for worker capacity (INT-619)
  | 'planned'
  | 'implemented'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'archived';    // original archived after retry (INT-711)

// Transitions:
// dispatched -> running (on first log chunk)
// dispatched -> planned | implemented | failed | interrupted (on webhook)
// dispatched | running -> cancelled (on cancel)
// running -> planned | implemented | failed | interrupted (on webhook)
// dispatched | running -> interrupted (zombie detection after 30 min)
// queued -> dispatched (drain queue picks up task)
// queued -> failed (TTL expired or queue full)
// planned | implemented | failed -> running (on sendTaskMessage with 'resumed' action)
// failed | cancelled | interrupted -> archived (when task is retried, INT-711)
```

### Task Completion Webhook

```typescript
interface TaskCompleteWebhook {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted';
  result?: {
    prUrl?: string;
    branch: string;
    commits: number;
    summary: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
    comment_replied?: boolean;
    planning_outcome_label?: 'planned' | 'unclear';
    planning_linear_url?: string;
    planning_subtask_urls?: string;
    planning_pr_url?: string;
    execution_outcome_label?: 'implemented';
    execution_linear_issue_url?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  duration?: number;
}
```

### Rate Limits

```typescript
const LIMITS = {
  maxConcurrentTasks: 3,
  maxTasksPerHour: 10,
  maxPromptLength: 10000,
  dailyCostCap: 20, // dollars
  monthlyCostCap: 200, // dollars
  estimatedCostPerTask: 1.17,
};
```

### Task Retry

```typescript
interface RetryTaskRequest {
  originalTaskId: string;
  userId: string;
  additionalContext?: string;
}

// Constraints:
// - Original must be 'failed', 'cancelled', or 'interrupted'
// - 5-minute cool-off for failed tasks (cancelled/interrupted bypass)
// - No active task on same Linear issue
// - User must have configured workers
// - Original task is archived (status -> 'archived')
```

### Task Feedback

```typescript
interface SubmitTaskFeedbackRequest {
  originalTaskId: string;
  userId: string;
  feedback: string;
}

// Constraints:
// - Original must be 'planned' or 'implemented' (completed phase)
// - No active task on same Linear issue
// - User must have configured workers
```

### Send Task Message

```typescript
interface SendTaskMessageRequest {
  taskId: string;
  userId: string;
  message: string; // 1-10000 chars
}

interface SendTaskMessageResult {
  action: 'queued' | 'resumed';
}

// 'queued'  -- task is running; message held in pendingUserMessages, delivered at turn end
// 'resumed' -- task is in terminal state (planned/implemented/failed); task re-dispatched via --continue
// Constraints:
// - Task must be owned by userId
// - Status must NOT be 'cancelled' or 'dispatched'
// - User must have configured workers
```

### Execution Agent Implementation

```typescript
interface SubmitToExecutionAgentRequest {
  originalTaskId: string;
  userId: string;
}

interface SubmitToExecutionAgentResult {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: string;
  implementationOf: string;
}

// Constraints:
// - Original task must have status 'planned' and agentType 'planning'
// - Original task must have a linked Linear issue
// - Linear issue must have 'code-task' label (set by planning agent)
// - Linear issue must NOT have 'unclear' label
// - No existing implementationTaskId on planning task (optimistic lock)
// - No active task on same Linear issue
// - User must have configured workers
// - Planning task back-linked via implementationTaskId (INT-725)
```

### Worker Settings

```typescript
interface WorkerConfigInput {
  name: string; // 3-32 chars, /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/
  url: string; // URI format
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
}

// Constraints:
// - Max 2 workers per user
// - Name immutable after creation
// - Secrets stored encrypted (AES-256-GCM)
// - Masked in API responses (last 3 chars visible)
```

### Turn Metrics

Per-turn resource metrics stored automatically at turn end in the `turn_metrics` subcollection.

```typescript
interface TurnMetrics {
  taskId: string;
  attempt: number;
  timestamp: string; // ISO 8601
  // Resource (cgroup)
  cpuTimeSeconds: number;
  cpuCores: number;
  peakMemoryMB: number;
  // Time classification
  wallTimeSeconds: number;
  apiWaitSeconds: number;
  toolExecSeconds: number;
  backgroundWaitSeconds: number;
  overheadSeconds: number;
  // Token accounting
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  apiCallCount: number;
  // Derived
  cpuUtilizationPercent: number;
  idlePercent: number;
}

// Stored at: code_tasks/{taskId}/turn_metrics/{attempt:0001}
```

### Prompt Sanitization

```typescript
// sanitizePrompt() is applied to all prompts at every entry point.
// Returns the sanitized string (pure function, no side effects).
//
// Patterns stripped (layer 1 - secret redaction):
// 1. PEM private key blocks (RSA, EC, DSA)
// 2. AWS access key IDs (AKIA...)
// 3. OpenAI / Anthropic API keys (sk-...)
// 4. Stripe secret keys (sk_live_..., sk_test_...)
// 5. GitHub tokens (ghp_, gho_, ghs_, ghr_)
// 6. Slack tokens (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-)
// 7. Bearer JWTs (JWT-shaped only)
// 8. Secret/password env var assignments (DB_PASSWORD=...)
// 9. Sensitive URL query parameters (token, api_key, apikey, access_token)
// 10. Max length enforcement (100,000 chars)
// 11. Whitespace normalization

// sanitizePromptForInjection() (layer 2 - injection prevention):
// Rejects: system override markers, base64 blobs > 3000 chars
// Strips: control characters (preserves \t, \n, \r)
// Returns: Result<string, error> -- rejects with 'empty_prompt' or 'base64_blob_detected'
```

### Cancel via Nonce

```typescript
interface CancelTaskWithNonceRequest {
  taskId: string;
  nonce: string; // 4 hex chars
  userId: string;
}

// Constraints:
// - Nonce must match task's cancelNonce
// - Nonce must not be expired (15 min TTL)
// - User must own the task
// - Task must be in dispatched or running status
```

### GitHub Webhook Rules Engine

```typescript
// Domain-level rules that evaluate GitHub PR events for actionability.
// Rules are composed in a chain; all must pass for dispatch.

interface WebhookRule {
  evaluate(event: GitHubPREvent): RuleResult;
}

// Active rules:
// 1. ActionableEventRule - filters to supported event+action combos
// 2. SenderWhitelistRule - only ALLOWED_BOTS + repo owner
// 3. SkipPrefixRule - ignores @claude, @codex, @ignore prefixes

// When all rules pass, WebhookDispatchService dispatches:
// - Existing task found for PR: sendTaskMessage (queue or resume)
// - No task found: createTaskForPR (lock-guarded, user lookup)
```

## Constraints

### Authentication

| Route Pattern          | Auth Method                        |
| ---------------------- | ---------------------------------- |
| `/code/*`              | Auth0 JWT (via `onRequest` hook)   |
| `/internal/*`          | `X-Internal-Auth` header           |
| `/internal/webhooks/*` | `X-Internal-Auth` + HMAC signature |
| `/webhooks/github`     | GitHub HMAC-SHA256 signature       |

### Deduplication Layers

```
Layer 0: approvalEventId (approval replay prevention)
Layer 1: actionId (Pub/Sub retry prevention)
Layer 2: dedupKey = sha256(userId + prompt)[0:16] (UI double-tap prevention)
Layer 3: linearIssueId active check (one active task per issue)
```

### Rate Limit Error Codes

```typescript
type RateLimitErrorCode =
  | 'concurrent_limit' // 429 - max 3 concurrent
  | 'hourly_limit' // 429 - max 10/hour
  | 'daily_cost_limit' // 429 - $20/day cap
  | 'monthly_cost_limit' // 429 - $200/month cap
  | 'prompt_too_long' // 429 - >10000 chars
  | 'service_unavailable'; // 503 - usage DB unreachable
```

### GitHub Webhook Sender Whitelist

PR comment auto-dispatch only processes comments from:

- `claude[bot]`
- `chatgpt-codex-connector[bot]`
- Repository owner (matches `repository.owner.login`)

All other senders are silently ignored. Comments starting with `@claude`, `@codex`, or `@ignore` are also skipped.

## Usage Patterns

### Submit task from actions-agent

```
POST /internal/code/process
X-Internal-Auth: <token>
X-Trace-Id: <trace-id>

{
  "actionId": "action-uuid",
  "approvalEventId": "approval-uuid",
  "userId": "auth0|user-id",
  "payload": {
    "prompt": "Implement cursor-based pagination for bookmarks",
    "workerType": "auto",
    "linearIssueId": "INT-500"
  }
}

-> 200: { "success": true, "data": { "status": "submitted", "codeTaskId": "uuid", "resourceUrl": "/#/code-tasks/uuid" } }
-> 409: { "success": false, "error": { "code": "CONFLICT", "message": "Duplicate: existing-task-id" } }
-> 503: { "success": false, "error": { "code": "MISCONFIGURED", "message": "Worker unavailable" } }
```

### Submit task from web UI

```
POST /code/submit
Authorization: Bearer <auth0-jwt>

{
  "prompt": "Add error handling to the login flow",
  "workerType": "opus"
}

-> 200: { "success": true, "data": { "status": "submitted", "codeTaskId": "uuid" } }
-> 429: { "success": false, "error": { "code": "concurrent_limit", "message": "Maximum 3 concurrent tasks" } }
```

### List tasks

```
GET /code/tasks?status=running,dispatched&limit=10
Authorization: Bearer <auth0-jwt>

-> 200: { "success": true, "data": { "tasks": [...], "nextCursor": "cursor-id" } }
```

Note: The `status` parameter accepts comma-separated values (e.g., `running,dispatched`) to filter by multiple statuses simultaneously. Tasks include live-hydrated Linear issue data (state, labels, priority).

### Start execution agent implementation

```
POST /code/tasks/:taskId/implement
Authorization: Bearer <auth0-jwt>

-> 200: { "success": true, "data": { "codeTaskId": "uuid", "resourceUrl": "/code/tasks/uuid", "workerLocation": "home-mac", "implementationOf": "original-task-id" } }
-> 400: { "success": false, "error": { "code": "invalid_status", "message": "Task must be a completed planning task to start implementation" } }
-> 400: { "success": false, "error": { "code": "label_not_ready", "message": "The code-task label hasn't been added yet." } }
-> 409: { "success": false, "error": { "code": "already_implemented", "message": "Implementation already started" } }
```

### GitHub PR summaries (list view)

```
GET /code/github-pr-summaries
Authorization: Bearer <auth0-jwt>

-> 200: {
  "success": true,
  "data": {
    "prs": [{
      "repository": "org/repo",
      "pullRequestNumber": 42,
      "title": "Add cursor-based pagination",
      "status": "open" | "closed" | "merged",
      "lastActivityAt": "2026-03-07T10:00:00.000Z"
    }]
  }
}
```

Notes:

- Returns PRs with any activity in the last 30 days
- Sorted by PR number descending
- O(PRs) query backed by `github-pr-summaries` collection

### GitHub PR events

```
GET /code/github-pr-events?repository=org/repo&pullRequestNumber=42&limit=50
Authorization: Bearer <auth0-jwt>

-> 200: {
  "success": true,
  "data": {
    "events": [{
      "pullRequestNumber": 42,
      "title": "Add cursor-based pagination",
      "repository": "org/repo",
      "eventType": "pull_request" | "pull_request_review" | "pull_request_review_comment" | "issue_comment" | "push",
      "action": "opened" | "synchronize" | "submitted" | "created" | null,
      "senderLogin": "username",
      "createdAt": "2026-03-07T10:00:00.000Z",
      "eventUrl": "https://github.com/org/repo/compare/abc...def",
      "body": "Comment text or PR description (deduplicated)"
    }]
  }
}
```

Notes:

- `pullRequestNumber` requires `repository` to also be set
- Per-PR queries return oldest-first; repository/all queries return newest-first
- Comment `edited` events are merged with their original -- same position, latest body
- PR body appears only on the most recent `pull_request` event

### Send message to task

```
POST /code/tasks/:taskId/messages
Authorization: Bearer <auth0-jwt>

{ "message": "Please also add error handling for the null case" }

-> 200: { "success": true, "data": { "action": "queued" } }   // task is running
-> 200: { "success": true, "data": { "action": "resumed" } }  // task was ended, now re-dispatched
-> 400: { "success": false, "error": { "code": "invalid_status", ... } }  // task cancelled/dispatched
```

### Cancel task (from web UI)

```
POST /code/cancel
Authorization: Bearer <auth0-jwt>

{ "taskId": "uuid" }

-> 200: { "success": true, "data": { "cancelled": true } }
```

### Cancel task (from WhatsApp via actions-agent)

```
POST /internal/code/cancel-with-nonce
X-Internal-Auth: <token>

{
  "taskId": "uuid",
  "nonce": "a1b2",
  "userId": "auth0|user-id"
}

-> 200: { "success": true, "data": { "cancelled": true } }
```

### Receive task completion webhook

```
POST /internal/webhooks/task-complete
X-Internal-Auth: <token>
X-Webhook-Signature: sha256=<hmac>

{
  "taskId": "uuid",
  "status": "completed",
  "result": {
    "prUrl": "https://github.com/org/repo/pull/42",
    "branch": "feature/pagination",
    "commits": 3,
    "summary": "Added cursor-based pagination to bookmarks endpoint"
  },
  "duration": 847
}

-> 200: { "received": true }
```

### Receive turn metrics

```
POST /internal/turn-metrics
X-Internal-Auth: <token>
X-Webhook-Signature: sha256=<hmac>

{
  "taskId": "uuid",
  "attempt": 1,
  "timestamp": "2026-03-07T10:30:00.000Z",
  "cpuTimeSeconds": 42.5,
  "cpuCores": 10,
  "peakMemoryMB": 2100,
  "wallTimeSeconds": 120,
  "apiWaitSeconds": 60,
  "toolExecSeconds": 30,
  "backgroundWaitSeconds": 10,
  "overheadSeconds": 20,
  "totalInputTokens": 45000,
  "totalOutputTokens": 12000,
  "totalCacheReadTokens": 35000,
  "totalCacheCreationTokens": 5000,
  "apiCallCount": 15,
  "cpuUtilizationPercent": 42.5,
  "idlePercent": 78.2
}

-> 200: { "received": true }
```

### Drain task queue (Cloud Scheduler)

```
POST /internal/drain-queue
X-Internal-Auth: <token>

-> 200: { "success": true, "data": { "action": "dispatched", "taskId": "uuid" } }
-> 200: { "success": true, "data": { "action": "expired", "taskId": "uuid" } }
-> 200: { "success": true, "data": { "action": "still_busy", "taskId": "uuid" } }
-> 200: { "success": true, "data": { "action": "empty" } }
```

## Error Handling

### Error Response Format

All errors follow the IntexuraOS contract:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

### Error Code Mapping

| HTTP | Code               | When                                        |
| ---- | ------------------ | ------------------------------------------- |
| 401  | `UNAUTHORIZED`     | Missing or invalid auth                     |
| 400  | `INVALID_REQUEST`  | Bad request body or params                  |
| 400  | `INVALID_WORKER`   | Worker name doesn't match configured worker |
| 400  | `validation_error` | Prompt failed injection sanitization        |
| 404  | `NOT_FOUND`        | Task or worker not found                    |
| 409  | `CONFLICT`         | Deduplication triggered                     |
| 429  | `RATE_LIMITED`     | Rate limit exceeded (see code for type)     |
| 503  | `MISCONFIGURED`    | Worker unavailable or no workers configured |
| 500  | `INTERNAL_ERROR`   | Unexpected server error                     |

## Events

### Outgoing HTTP Calls

| Target        | Endpoint                                      | When                       |
| ------------- | --------------------------------------------- | -------------------------- |
| Worker        | `POST {workerUrl}/tasks`                      | Task dispatch              |
| Worker        | `DELETE {workerUrl}/tasks/{taskId}`           | Task cancellation          |
| Worker        | `POST {workerUrl}/tasks/{taskId}/messages`    | Send message               |
| Worker        | `GET {workerUrl}/health`                      | Connectivity test          |
| linear-agent  | `POST /internal/linear/issues`                | Issue creation             |
| linear-agent  | `PATCH /internal/linear/issues/{id}/state`    | State transition           |
| linear-agent  | `POST /internal/linear/issues/validate`       | Issue validation           |
| linear-agent  | `POST /internal/linear/issues/generate-title` | LLM title generation       |
| linear-agent  | `POST /internal/linear/issues/{id}/comments`  | Comment addition           |
| actions-agent | `PATCH /internal/actions/{id}/status`         | Action status update       |
| user-service  | `GET /internal/users/oauth-token`             | GitHub OAuth token         |
| user-service  | `GET /internal/users/by-github-username`      | GitHub username resolution |

### Outgoing Pub/Sub

| Topic                        | When                               | Payload                                       |
| ---------------------------- | ---------------------------------- | --------------------------------------------- |
| `intexuraos-whatsapp-send-*` | Task started, completed, or failed | WhatsApp message with CTA URL buttons         |

### Incoming Webhooks

| Source       | Path                               | Trigger                            |
| ------------ | ---------------------------------- | ---------------------------------- |
| Orchestrator | `/internal/webhooks/task-complete` | Task finished (completed/failed)   |
| Orchestrator | `/internal/logs`                   | Log chunks during execution        |
| Orchestrator | `/internal/turn-metrics`           | Per-turn resource metrics          |
| GitHub       | `/webhooks/github`                 | PR events (push, review, comment)  |

### Metrics (Cloud Monitoring)

| Metric                  | Type      | Labels                 |
| ----------------------- | --------- | ---------------------- |
| `tasks_submitted`       | Counter   | `workerType`, `source` |
| `tasks_completed`       | Counter   | `workerType`, `status` |
| `task_duration_seconds` | Histogram | `workerType`           |
| `active_tasks`          | Gauge     | `workerLocation`       |
| `task_cost_dollars`     | Counter   | `workerType`, `userId` |
