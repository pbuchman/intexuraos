# Code Agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                     |
| --------- | ------------------------------------------------------------------------- |
| Name      | code-agent                                                                |
| Role      | Orchestrate autonomous code execution tasks on user-owned worker machines |
| Goal      | Accept task requests, dispatch to workers, and return pull request URLs   |

```yaml
version: 3.6.0
port: 8128
framework: fastify
runtime: node22
deploy: cloud-run
collections:
  - code_tasks (subcollections: logs, log_lines, log_entries, turn_metrics)
  - user_spend
  - code_worker_settings
  - github-pr-events
  - github-pr-summaries
  - pr_task_locks
  - event_decisions
  - dispatch_retries
  - github-webhook-audit-events
  - github-event-log-entries
  - pr_automation_comments
  - merge_queue_watches
  - task_group_summaries
  - user_group_counts
  - execution_memories
  - execution_memory_applications
```

## Capabilities

### Task Submission

**Endpoint:** `POST /internal/code/process`

**When to use:** When actions-agent needs to dispatch a code task after user approval

**Input Schema:**

```typescript
interface ProcessCodeActionRequest {
  actionId: string;
  approvalEventId: string;
  userId: string;
  prompt: string;
  workerType?: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi';
  linearIssueId?: string;
  repository?: string;
  baseBranch?: string;
  traceId?: string;
  source?: 'whatsapp' | 'web';
}
```

**Output Schema:**

```typescript
interface ProcessCodeActionResponse {
  success: true;
  data: {
    status: 'submitted';
    codeTaskId: string;
    resourceUrl: string; // e.g., "/#/code-tasks/uuid"
  };
}
```

**Example:**

```json
// Request
{
  "actionId": "action-uuid",
  "approvalEventId": "approval-uuid",
  "userId": "auth0|user-id",
  "prompt": "Implement cursor-based pagination for bookmarks",
  "workerType": "auto",
  "linearIssueId": "INT-500"
}

// Response
{
  "success": true,
  "data": {
    "status": "submitted",
    "codeTaskId": "task_abc123",
    "resourceUrl": "/#/code-tasks/task_abc123"
  }
}
```

All prompts pass through two sanitization layers before reaching the worker:

1. **Secret redaction** (`sanitizePrompt`): Strips AWS keys, OpenAI/Anthropic API keys, Stripe secrets, GitHub tokens, Slack tokens, Bearer JWTs, PEM private keys, and secret env var assignments. Sensitive URL query parameters are redacted.
2. **Injection prevention** (`sanitizePromptForInjection`): Rejects system override markers (`[SYSTEM]`, `<|im_start|>`), strips control characters, and blocks base64 blobs over 3000 characters.

### Internal Task Submission

**Endpoint:** `POST /internal/code/submit`

**When to use:** When an internal service needs to create a task on behalf of a user without the actions-agent approval flow

**Input Schema:**

```typescript
interface InternalSubmitRequest {
  userId: string;
  prompt: string;
  workerType?: WorkerType;
  linearIssueId?: string;
  repository?: string;
  baseBranch?: string;
}
```

**Output Schema:**

```typescript
interface InternalSubmitResponse {
  success: true;
  data: {
    status: 'submitted';
    codeTaskId: string;
  };
}
```

### Task Lifecycle

```typescript
// 'planned' = planning agent completed; 'implemented' = execution agent completed; 'reviewed' = review agent completed
// 'completed' is NOT used — tasks finish as 'planned', 'implemented', or 'reviewed'
type TaskStatus =
  | 'dispatched'
  | 'running'
  | 'queued'       // waiting for worker capacity
  | 'planned'
  | 'implemented'
  | 'reviewed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'archived';    // original archived after retry

type AgentType = 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent';

// Transitions:
// queued -> dispatched (drain queue picks up task, or immediate dispatch succeeds)
// dispatched -> running (on first log chunk)
// dispatched -> planned | implemented | reviewed | failed | interrupted (on webhook)
// dispatched | running -> cancelled (on cancel)
// running -> planned | implemented | reviewed | failed | interrupted (on webhook)
// dispatched | running -> interrupted (zombie detection after 30 min)
// queued -> failed (TTL expired or queue full)
// planned | implemented | failed -> running (on sendTaskMessage with 'resumed' action)
// failed | cancelled | interrupted -> archived (when task is retried)
```

### Ask Agent (Interactive Sessions)

**Endpoints:**
- `POST /code/ask-agent/start` — Start an interactive session (Auth0 JWT)
- `GET /code/ask-agent/active` — Get active session for cross-device restoration (Auth0 JWT)

**When to use:** Back-and-forth conversations with Claude Code from the web UI

```typescript
interface StartAskAgentRequest {
  prompt: string;
}

interface StartAskAgentResponse {
  success: true;
  data: {
    status: 'submitted';
    codeTaskId: string;
  };
}

interface GetActiveAskAgentResponse {
  success: true;
  data: {
    task: {
      id: string;
      status: string;
      agentType: string;
      prompt: string;
      createdAt: string;
    } | null;
  };
}
```

**Constraints:**
- Uses `agentType: 'ask_agent'` and `workerType: 'opus'`
- No Linear issue integration
- Filtered from task list and issue group endpoints
- Subject to same rate limits as regular tasks

### Check Active Task for Linear Issue

**Endpoint:** `GET /internal/code-tasks/linear/:linearIssueId/active`

**When to use:** Before creating a new task, check if an active task exists for the same Linear issue

**Output Schema:**

```typescript
interface ActiveTaskCheckResponse {
  success: true;
  data: {
    hasActiveTask: boolean;
    taskId?: string;
    status?: TaskStatus;
  };
}
```

### Issue Groups (Paginated)

**Endpoint:** `GET /code/issue-groups`

**When to use:** Display tasks grouped by Linear issue with aggregated status

```typescript
interface IssueGroupsQuery {
  status?: 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
  sort?: 'linear-id' | 'pr-number' | 'dispatched' | 'last-updated';
  limit?: number;  // default 20, max 100
  cursor?: string;
}

type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
```

### Toggle Issue Group Important Flag

**Endpoint:** `POST /code/issue-groups/:groupKey/important`

**When to use:** Mark or unmark an issue group as high-priority

```typescript
interface ToggleImportantBody {
  important: boolean;
}
```

### Dedicated Task Status Update

**Endpoint:** `PATCH /internal/code-tasks/:id/status`

**When to use:** Orchestrator commits terminal task status before the full completion webhook

```typescript
interface UpdateTaskStatusBody {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  completedAt: string; // ISO 8601
  error?: { code: string; message: string };
  result?: { prUrl?: string; branch?: string; summary?: string };
}

// Idempotent: returns 200 no-op if task is already terminal.
// No side effects — Linear/WhatsApp/GitHub labelling stays on the task-complete webhook.
// Auth: X-Internal-Auth + HMAC-SHA256 signature over raw request body.
```

### Linear Issue Context Proxy

**Endpoint:** `GET /internal/linear/issue-context/:identifier`

**When to use:** When orchestrator needs issue description and comments for deep validation without direct Linear API access

**Output Schema:**

```typescript
interface IssueContextResponse {
  description: string | null;
  comments: Array<{ body: string; createdAt: string }>;
  planDocumentPath: string | null;
}
```

### Task Dispatch Metadata (Fallback)

**Endpoint:** `GET /internal/tasks/:taskId/dispatch-metadata`

**When to use:** When orchestrator needs dispatch metadata for a task that has been pruned from state

**Output Schema:**

```typescript
interface DispatchMetadataResponse {
  taskId: string;
  prompt: string;
  repository: string;
  baseBranch: string;
  agentType: string | null;
  workerType: string;
  linearIssueId: string | null;
  webhookSecret: string | null;
  prNumber: number | null;
}
```

### Merge Queue

**Endpoints:**
- `POST /code/merge-queue/watch` — Create a new merge queue watch
- `DELETE /code/merge-queue/watch/:watchId` — Cancel a watch
- `PUT /code/merge-queue/watch/:watchId/exclusions` — Set excluded PRs
- `GET /code/merge-queue/watches` — List active watches
- `GET /code/merge-queue/branches` — List available base branches
- `GET /code/merge-queue/prs` — List eligible PRs
- `POST /internal/merge-queue/tick` — Process one merge cycle (Cloud Scheduler)

**When to use:** When multiple bot-authored PRs target the same branch and need ordered merging

```typescript
type MergeQueueWatchStatus = 'active' | 'drained' | 'cancelled';
type SkipReason = 'merge_conflict' | 'checks_failing' | 'checks_pending' | 'mergeability_unknown' | 'not_eligible_author';

interface TickResult {
  watchId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  action: 'merged' | 'skipped_all' | 'drained' | 'error';
  mergedPrNumber?: number;
  remainingPrs: number;
  skipped: Array<{ prNumber: number; reason: SkipReason }>;
}
```

**Constraints:**
- The `main` branch is blocked as a merge queue base branch
- One PR is merged per watch per tick
- PRs must pass CI checks and have no merge conflicts to be eligible
- Only bot-authored PRs or PRs from the repo owner are eligible

### GitHub Agent (PR Triage)

```typescript
// Two-tier evaluation pipeline for GitHub webhook events
interface UnifiedEvaluator {
  evaluate(event: GitHubPREvent, logger: Logger): Promise<void>;
}

// Step 1: Hard rules (deterministic)
// - CodeWorkerOutputRule: skips events from code worker bots
// - DraftPRRule: blocks ALL code-tasks on draft PRs (isDraft === true)
// - CIFailureRule: detects CI failures on agent PR branches
// - ActionableEventRule: filters to supported event+action combos
// - ProtectedBaseBranchRule: skips pushes to protected branches
// - SenderWhitelistRule: only ALLOWED_BOTS + repo owner
// - SkipPrefixRule: ignores @claude, @codex, @ignore prefixes

// Step 2: LLM triage (Gemini tool calling, only if needs_triage)
interface GitHubAgentEvalResult {
  action: 'skip' | 'request_review' | 'dispatch';
  reason?: string;
  reviewTypes?: ('code_quality' | 'security' | 'architecture')[];
  workerType?: WorkerType;
  messageTemplate?: string;
}

// Triage output is validated against Zod schemas (TriageSkipSchema, TriageReviewSchema).
// Invalid output triggers automatic repair prompt via buildTriageRepairMessage.
// LLM retries once with failed response as corrective context.
// GitHub Agent uses per-user resolveToolCallingClient: tries user's own Google API key
// first, falls back to platform INTEXURAOS_GEMINI_APP_API_KEY. Only activates when a
// valid key is available.

// PR triage runs asynchronously via Pub/Sub push subscription (INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC).
// The webhook publishes a PRTriageEvent and returns immediately; the push handler evaluates.

// onReviewSkipped callback: when LLM triage skips a review for an execution-origin task,
// sets 'ready-to-merge' label on the Linear issue and records automation log.
```

### Remediation Task

```typescript
interface CreateRemediationTaskRequest {
  repository: string;
  prNumber: number;
  senderLogin: string;
  workerType: WorkerType;
  eventId: string;
  linearIssueId?: string;
  baseBranch?: string;
  prBranch?: string;
}

interface CreateRemediationTaskResult {
  status: 'queued';
  taskId: string;
  workerType: WorkerType;
}

// Constraints:
// - agentType: 'remediation', systemPromptHash: 'remediation-auto'
// - No dedup (multiple remediation tasks can coexist)
// - Pushes to existing PR branch, does not create new PRs
// - Scope limited to review findings only
// - Runs /nitpick-nuker to fetch and address findings
```

### Execution Memory Pipeline

```typescript
// Pre-run retrieval: prepareExecutionMemoryContext
// - Normalizes task prompt + Linear issue context into semantic query (Gemini)
// - Generates vector embedding (OpenAI text-embedding-3-small)
// - Searches execution_memories collection via vector similarity
// - Reranks candidates with scoring weights (min threshold: 0.55)
// - Returns top 3 matched memories injected into agent context
// - Tracks application in execution_memory_applications collection

// Post-run distillation: processExecutionMemoryBacklog (Cloud Scheduler)
// - Claims pending tasks with executionMemoryPostRun.status === 'pending'
// - Evaluates memory application outcomes (positive/neutral/negative/unknown)
// - Distills new memories from execution logs (Gemini)
// - Deduplicates via fingerprint hash
// - Generates embedding and stores in execution_memories collection
// - Memory types: implementation_pattern, verification_pattern, pitfall_pattern,
//   decomposition_pattern, planning_decision, review_finding

// Feature-flagged: requires INTEXURAOS_EXECUTION_MEMORY_ENABLED=true
// Requires both INTEXURAOS_GEMINI_APP_API_KEY and INTEXURAOS_OPENAI_APP_API_KEY
// Only eligible for execution and planning agent types (isMemoryEligibleAgent)
```

### Automation Log

```typescript
// All PR automation events are recorded to a unified, append-only GitHub PR comment.
interface AutomationLog {
  record(prRef: PRRef, event: AutomationEvent, tokenUserId?: string): Promise<void>;
}

type AutomationEvent =
  | { type: 'webhook_received'; eventType: string; action: string; sender: string; deliveryId: string }
  | { type: 'skipped'; decidedBy: 'webhook_route' | 'hard_rules' | 'llm_triage'; reason: string }
  | { type: 'triage_dispatch'; reviewTypes?: string[]; workerType?: string; cost: number; reasoning: string }
  | { type: 'triage_failed'; error: string; fallbackAction: 'dispatch' | 'skip' | 'none' }
  | { type: 'task_dispatched'; taskId: string; workerType: string; agentType: AgentType }
  | { type: 'task_dispatch_failed'; error: string }
  | { type: 'task_started'; taskId: string; workerType: string; attempt: number }
  | { type: 'task_completed'; taskId: string; status: string; duration: number }
  | { type: 'task_failed'; taskId: string; error: string; errorCode: string }
  | { type: 'task_interrupted'; taskId: string }
  | { type: 'review_replaced'; replacedTaskId: string }
  | { type: 'remediation_decision'; required: boolean; source: string; signal: string };
```

### Task Completion Webhook

```typescript
interface TaskCompleteWebhook {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
    comment_replied?: boolean;
    planning_outcome_label?: 'planned' | 'unclear';
    planning_linear_url?: string;
    planning_subtask_urls?: string;
    planning_pr_url?: string;
    planning_unclear_clarification?: string;
    execution_outcome_label?: 'implemented' | 'already_completed';
    execution_linear_issue_url?: string;
    execution_memory_ids_used?: string;
    execution_memory_ids_rejected?: string;
    execution_memory_usage_summary?: string;
    review_comments_posted?: string;
    review_types?: string;
    review_body?: string;
    review_inline_comments?: string;
    requirements_tracker_updated?: string;
    gh_actions_status?: string;
    needs_remediation?: string;
    requires_re_review?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  duration?: number;
  resumedCompletion?: boolean;
}
```

### Rate Limits

```typescript
const LIMITS = {
  maxConcurrentTasks: 3,
  maxTasksPerHour: 10,
  maxPromptLength: 10000,
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
// - New task inherits open PR branch from original
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

// 'queued'  — task is running; message held in pendingUserMessages, delivered at turn end
// 'resumed' — task is in terminal state (planned/implemented/reviewed/failed/cancelled); task re-dispatched via --continue
// Constraints:
// - Task must be owned by userId
// - Status must NOT be 'queued' (only queued tasks reject messages)
// - User must have configured workers
// - Works for ask_agent tasks as well as regular tasks
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
// - Planning task back-linked via implementationTaskId
```

### Create Review Task

```typescript
interface CreateReviewTaskRequest {
  repository: string;
  prNumber: number;
  senderLogin: string;
  reviewTypes: string[];        // 'code_quality' | 'security' | 'architecture'
  workerType?: WorkerType;      // Falls back to user's defaultReviewWorkerType
  eventId: string;
  prTitle?: string;
  prBody?: string;
  reviewComment?: string;
  baseBranch?: string;
}

interface CreateReviewTaskResult {
  status: 'created' | 'queued';
  taskId: string;
  workerType: WorkerType;
}

// Constraints:
// - PR-scoped dedup: reuses active review task for same PR
// - Active review tasks replaced if newer review requested
// - Best-effort Linear issue linking for UI grouping
// - Sets agentType: 'review' on dispatch
// - Queue support when workers at capacity
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

interface UserWorkerSettings {
  workers: WorkerConfig[];            // Max 2, ordered by priority
  defaultReviewWorkerType?: WorkerType; // Default model for review tasks
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
// Returns: Result<string, error> — rejects with 'empty_prompt' or 'base64_blob_detected'
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
// 1. CodeWorkerOutputRule - skips events from intexuraos-code-worker[bot]
// 2. CIFailureRule - detects check_suite failures on agent PR branches
// 3. ActionableEventRule - filters to supported event+action combos
// 4. ProtectedBaseBranchRule - skips pushes to protected base branches
// 5. SenderWhitelistRule - only ALLOWED_BOTS + repo owner
// 6. SkipPrefixRule - ignores @claude, @codex, @ignore prefixes

// Outcomes: dispatch | skip | needs_triage
// When needs_triage: UnifiedEvaluator invokes GitHub Agent (Gemini)
// When dispatch: WebhookDispatchService dispatches directly
```

### Merge Conflict Detection

```typescript
interface MergeConflictDetector {
  detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void>;
  reconcile(logger: Logger): Promise<ReconcileResult>;
}

// detectOnPush: Triggered on push events to base branches.
// Checks bot-authored PRs for merge conflicts.
// Posts GitHub comment and dispatches resolution task.
// Bot author remapped to PR owner for correct worker dispatch.

// reconcile: Triggered by Cloud Scheduler every minute.
// Syncs open/closed state from GitHub into Firestore.
// Refreshes mergeConflictStatus for open PRs.
// Skips closed PRs to avoid wasted API calls.

interface ReconcileResult {
  processed: number;
  closed: number;
  reopened: number;
  mergeConflictRefreshed: number;
  skipped: number;
  error: number;
}
```

### Self-Healing Failure Triage

```typescript
// triageFailedTask classifies task failures and decides: auto-retry, permanent failure, or escalate.
// Auto-retry dispatches to a different worker (excludes failedWorkerLocation).
// Max 3 auto-retry attempts per task (autoRetryAttempt field).
// Tasks failing with TASK_EXIT_CODE_OVERRIDE trigger automatic retry.
// WhatsApp notification sent on auto-retry with attempt number and reason.
```

### Auto-Archive

```typescript
// Stale groups: POST /internal/archive-stale-groups (hourly cron)
// Archives issue groups where all tasks have updatedAt older than staleness threshold (default 7 days).
// Groups with active tasks are skipped.

// Merged tasks: POST /internal/auto-archive-merged-tasks (daily cron)
// Archives tasks whose PRs were merged more than threshold days ago (default 7).
// Groups tasks by Linear issue; only archives entire groups where all tasks are terminal with merged PRs.
// Active tasks in same group prevent archival.
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
  | 'concurrent_limit'    // 429 - max 3 concurrent
  | 'hourly_limit'        // 429 - max 10/hour
  | 'prompt_too_long'     // 429 - >10000 chars
  | 'service_unavailable'; // 503 - usage DB unreachable
```

### GitHub Webhook Sender Whitelist

PR comment auto-dispatch only processes comments from:

- `claude[bot]`
- `chatgpt-codex-connector[bot]`
- `intexuraos-code-worker[bot]`
- Repository owner (matches `repository.owner.login`)

All other senders receive a GitHub comment explaining the rejection. Comments starting with `@claude`, `@codex`, or `@ignore` are also skipped.

### Blocked Merge Queue Branches

The `main` branch cannot be used as a merge queue base branch. It appears in the branch list with `blocked: true` for visibility.

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

### Submit task from internal service

```
POST /internal/code/submit
X-Internal-Auth: <token>

{
  "userId": "auth0|user-id",
  "prompt": "Fix the broken import in utils.ts",
  "workerType": "auto",
  "linearIssueId": "INT-500"
}

-> 200: { "success": true, "data": { "status": "submitted", "codeTaskId": "uuid" } }
-> 400: { "success": false, "error": { "code": "INVALID_REQUEST", "message": "..." } }
-> 503: { "success": false, "error": { "code": "MISCONFIGURED", "message": "Worker unavailable" } }
```

### Start Ask Agent session

```
POST /code/ask-agent/start
Authorization: Bearer <auth0-jwt>

{
  "prompt": "What files use the CodeTask interface?"
}

-> 200: { "success": true, "data": { "status": "submitted", "codeTaskId": "task_uuid" } }
-> 429: { "success": false, "error": { "code": "RATE_LIMITED", "message": "..." } }
```

### List issue groups

```
GET /code/issue-groups?status=active&sort=last-updated&limit=20
Authorization: Bearer <auth0-jwt>

-> 200: { "success": true, "data": { "groups": [...], "nextCursor": "cursor-id", "counts": { "active": 5, "needsAction": 2, ... } } }
```

### Create merge queue watch

```
POST /code/merge-queue/watch
Authorization: Bearer <auth0-jwt>

{
  "owner": "pbuchman",
  "repo": "intexuraos",
  "baseBranch": "development"
}

-> 200: { "success": true, "data": { "watchId": "uuid", "status": "active" } }
-> 400: { "success": false, "error": { "code": "INVALID_REQUEST", "message": "Cannot create merge queue watch for blocked branch: main" } }
```

### List tasks

```
GET /code/tasks?status=running,dispatched&limit=10
Authorization: Bearer <auth0-jwt>

-> 200: { "success": true, "data": { "tasks": [...], "nextCursor": "cursor-id" } }
```

Note: The `status` parameter accepts comma-separated values. Tasks with `agentType: 'ask_agent'` are excluded. Tasks include live-hydrated Linear issue data.

### Start execution agent implementation

```
POST /code/tasks/:taskId/implement
Authorization: Bearer <auth0-jwt>

-> 200: { "success": true, "data": { "codeTaskId": "uuid", "resourceUrl": "/code/tasks/uuid", "workerLocation": "home-mac", "implementationOf": "original-task-id" } }
-> 400: { "success": false, "error": { "code": "invalid_status", "message": "Task must be a completed planning task to start implementation" } }
-> 400: { "success": false, "error": { "code": "label_not_ready", "message": "The code-task label hasn't been added yet." } }
-> 409: { "success": false, "error": { "code": "already_implemented", "message": "Implementation already started" } }
```

### Send message to task

```
POST /code/tasks/:taskId/messages
Authorization: Bearer <auth0-jwt>

{ "message": "Please also add error handling for the null case" }

-> 200: { "success": true, "data": { "action": "queued" } }   // task is running
-> 200: { "success": true, "data": { "action": "resumed" } }  // task was ended, now re-dispatched
-> 400: { "success": false, "error": { "code": "invalid_status", ... } }  // task cancelled/dispatched
```

### Drain task + retry queues (Cloud Scheduler)

```
POST /internal/drain-queue
X-Internal-Auth: <token>

// Drains retry queue first (failed webhook dispatches), then task queue (queued tasks)
-> 200: { "success": true, "data": { "action": "dispatched", "taskId": "uuid" } }
-> 200: { "success": true, "data": { "action": "expired", "taskId": "uuid" } }
-> 200: { "success": true, "data": { "action": "still_busy", "taskId": "uuid" } }
-> 200: { "success": true, "data": { "action": "empty" } }
```

### Get issue context for orchestrator (proxy)

```
GET /internal/linear/issue-context/:identifier
X-Internal-Auth: <token>

-> 200: { "description": "Issue description...", "comments": [...], "planDocumentPath": "/docs/plans/INT-123.md" }
-> 404: { "success": false, "error": { "code": "NOT_FOUND", "message": "Issue INT-999 not found" } }
-> 502: { "success": false, "error": { "code": "DOWNSTREAM_ERROR", "message": "linear-agent error: ..." } }
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

| HTTP | Code                    | When                                        |
| ---- | ----------------------- | ------------------------------------------- |
| 401  | `UNAUTHORIZED`          | Missing or invalid auth                     |
| 400  | `INVALID_REQUEST`       | Bad request body or params                  |
| 400  | `INVALID_WORKER`        | Worker name doesn't match configured worker |
| 400  | `validation_error`      | Prompt failed injection sanitization        |
| 404  | `NOT_FOUND`             | Task or worker not found                    |
| 409  | `CONFLICT`              | Deduplication triggered                     |
| 429  | `RATE_LIMITED`          | Rate limit exceeded (see code for type)     |
| 502  | `DOWNSTREAM_ERROR`      | Upstream service error (e.g., linear-agent) |
| 503  | `MISCONFIGURED`         | Worker unavailable or no workers configured |
| 503  | `QUEUE_FULL`            | Task queue at capacity                      |
| 503  | `WORKER_NOT_CONFIGURED` | No enabled workers for user                 |
| 500  | `INTERNAL_ERROR`        | Unexpected server error                     |

## Events

### Outgoing HTTP Calls

| Target        | Endpoint                                              | When                       |
| ------------- | ----------------------------------------------------- | -------------------------- |
| Worker        | `POST {workerUrl}/tasks`                              | Task dispatch              |
| Worker        | `DELETE {workerUrl}/tasks/{taskId}`                   | Task cancellation          |
| Worker        | `POST {workerUrl}/tasks/{taskId}/messages`            | Send message               |
| Worker        | `GET {workerUrl}/health`                              | Connectivity test          |
| linear-agent  | `POST /internal/linear/issues`                        | Issue creation             |
| linear-agent  | `PATCH /internal/linear/issues/{id}/state`            | State transition           |
| linear-agent  | `POST /internal/linear/issues/validate`               | Issue validation           |
| linear-agent  | `POST /internal/linear/issues/generate-title`         | LLM title generation       |
| linear-agent  | `POST /internal/linear/issues/{id}/comments`          | Comment addition           |
| actions-agent | `PATCH /internal/actions/{id}/status`                 | Action status update       |
| user-service  | `GET /internal/users/oauth-token`                     | GitHub OAuth token         |
| user-service  | `GET /internal/users/by-github-username`              | GitHub username resolution |
| GitHub API    | `PATCH /repos/{owner}/{repo}/pulls/{number}`          | PR title update            |
| GitHub API    | `GET /repos/{owner}/{repo}/pulls/{number}/files`      | PR file list (triage)      |
| GitHub API    | `POST /repos/{owner}/{repo}/issues/{number}/comments` | Automation log comment     |
| GitHub API    | `PUT /repos/{owner}/{repo}/pulls/{number}/merge`      | Merge queue auto-merge     |
| GitHub API    | `GET /repos/{owner}/{repo}/commits/{sha}/status`      | CI check status            |
| Gemini API    | Tool-calling inference                                | PR triage evaluation       |
| Gemini API    | Text generation                                       | Memory distillation/eval   |
| OpenAI API    | Embeddings                                            | Memory vector embedding    |

### Outgoing Pub/Sub

| Topic                        | When                               | Payload                               |
| ---------------------------- | ---------------------------------- | ------------------------------------- |
| `intexuraos-whatsapp-send-*` | Task started, completed, or failed | WhatsApp message with CTA URL buttons |

### Incoming Webhooks

| Source       | Path                                    | Trigger                           |
| ------------ | --------------------------------------- | --------------------------------- |
| Orchestrator | `/internal/webhooks/task-complete`      | Task finished (completed/failed)  |
| Orchestrator | `/internal/webhooks/task-event`         | Task lifecycle events (auto log)  |
| Orchestrator | `/internal/webhooks/compliance-report`  | Compliance report from worker     |
| Orchestrator | `/internal/logs`                        | Log chunks during execution       |
| Orchestrator | `/internal/turn-metrics`                | Per-turn resource metrics         |
| GitHub       | `/webhooks/github`                      | PR events (push, review, comment) |

### Metrics (Cloud Monitoring)

| Metric                  | Type      | Labels                 |
| ----------------------- | --------- | ---------------------- |
| `tasks_submitted`       | Counter   | `workerType`, `source` |
| `tasks_completed`       | Counter   | `workerType`, `status` |
| `task_duration_seconds` | Histogram | `workerType`           |
| `active_tasks`          | Gauge     | `workerLocation`       |
| `task_cost_dollars`     | Counter   | `workerType`, `userId` |
