# orchestrator — Agent Interface

> Machine-readable interface definition for AI agents interacting with the orchestrator.

---

## Identity

| Field    | Value                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name** | orchestrator                                                                                                                               |
| **Role** | Code Task Orchestration Engine                                                                                                             |
| **Goal** | Receive code tasks from code-agent, execute them in isolated Docker containers via Claude or Codex, and report results via signed webhooks |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface OrchestratorTools {
  // Submit a new code task for execution
  submitTask(params: {
    taskId: string;
    workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi' | 'codex' | 'codex-xhigh' | 'openrouter-free';
    prompt: string;
    repository?: string;
    baseBranch?: string;
    linearIssueId?: string;
    linearIssueTitle?: string;
    linearIssueLabels: string[];
    hasChildren: boolean;
    agentType?: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent';
    executionMemoryContext?: ExecutionMemoryPromptContext;
    trackingCommentId?: string;
    prNumber?: number;
    continuationPrNumber?: number;
    continuationPrBranch?: string;
    reviewTypes?: ('code_quality' | 'security' | 'architecture' | 'plan_review')[];
    slug?: string;
    webhookUrl: string;
    webhookSecret: string;
    actionId?: string;
  }): Promise<{ taskId: string; status: 'accepted' }>;
  // Auth: HMAC-signed (X-Dispatch-Timestamp + X-Dispatch-Nonce + X-Dispatch-Signature)
  // Errors: 400 (validation), 401 (auth), 503 (at capacity, docker unavailable, or auth unavailable)

  // Get current task status
  getTask(params: { taskId: string }): Promise<Task | null>;
  // Auth: None
  // Errors: 404 (not found)

  // Cancel a running task
  cancelTask(params: { taskId: string }): Promise<{ taskId: string; status: 'cancelled' }>;
  // Auth: None
  // Errors: 404 (not found), 409 (already completed)

  // Send a follow-up message to a task
  // - Running task: message is queued and delivered when the current attempt finishes
  // - Completed/failed/interrupted task: task is resumed with a new worker session
  // - Review/remediation tasks: rejected with 409
  // - Ask agent tasks: message delivered directly without resume preamble
  sendMessage(params: {
    taskId: string;
    message: string; // max 20000 chars
  }): Promise<SendMessageResult>;
  // Auth: HMAC-signed
  // Errors: 400 (validation), 404 (not found), 409 (invalid status or agent type)

  // Check service health and capacity
  getHealth(): Promise<{
    status: 'ready' | 'initializing' | 'recovering' | 'degraded' | 'auth_degraded' | 'shutting_down';
    capacity: number;
    running: number;
    available: number;
    githubTokenExpiresAt: string | null;
    workerAuths: {
      claude: WorkerAuthState;
      codex: WorkerAuthState;
    };
    dockerHealthy: boolean;
    diskHealthy: boolean;
  }>;
  // Auth: None

  // Get worker image diagnostics
  getWorkerImageInfo(): Promise<ImageInfo | { error: string }>;
  // Auth: None

  // Force refresh the GitHub App installation token
  forceTokenRefresh(): Promise<{
    status: 'refreshed';
    tokenExpiresAt: string | null;
  }>;
  // Auth: HMAC-signed

  // Request graceful shutdown
  requestShutdown(): Promise<{ status: 'shutting_down' }>;
  // Auth: HMAC-signed
}
```

### Resources

```typescript
interface OrchestratorResources {
  // Task state (persisted to disk)
  tasks: Record<string, Task>;

  // Pending webhook delivery queue
  pendingWebhooks: PendingWebhook[];

  // GitHub App installation token
  githubToken: { token: string; expiresAt: string } | null;
}
```

---

## Data Types

### Task

```typescript
interface Task {
  taskId: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi' | 'codex' | 'codex-xhigh' | 'openrouter-free';
  runtime?: 'claude' | 'codex';
  runtimeSessionId?: string;
  prompt: string;
  repository: string;
  baseBranch: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearIssueLabels: string[];
  hasChildren?: boolean;
  slug?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
  retriedFrom?: string;
  agentType?: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent';
  executionMemoryContext?: ExecutionMemoryPromptContext;
  trackingCommentId?: string;
  prNumber?: number;
  continuationPrNumber?: number;
  continuationPrBranch?: string;
  reviewTypes?: ('code_quality' | 'security' | 'architecture' | 'plan_review')[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  worktreePath: string;
  containerId: string;
  startedAt: string;
  completedAt?: string;
  attemptCount?: number;
  maxAttempts?: number;
  lastExitCode?: number;
  verificationHistory?: TaskVerificationRecord[];
  resumedAfterSuccess?: boolean;
  lastSuccessResult?: TaskResult;
  pendingResumeStart?: PendingResumeStart;
}

interface TaskVerificationRecord {
  attempt: number;
  passed: boolean;
  missingFields: string[];
  verifierFailure: boolean;
  createdAt: string;
}

interface PendingResumeStart {
  prompt: string;
  acceptedAt: string;
}
```

### ExecutionMemoryPromptContext

```typescript
interface ExecutionMemoryPromptContext {
  applicationId: string;
  retrievalVersion: string;
  querySummary: string;
  matchedMemories: ExecutionMemoryPromptMemory[];
}

interface ExecutionMemoryPromptMemory {
  memoryId: string;
  title: string;
  memoryType: 'implementation_pattern' | 'verification_pattern' | 'pitfall_pattern' | 'decomposition_pattern' | 'planning_decision' | 'review_finding';
  score: number;
  appliesWhen: string;
  action: string;
  avoid: string;
  verification: string;
}
```

### SendMessageResult

```typescript
interface SendMessageResult {
  action: 'queued' | 'resumed';
  pendingMessages?: string[];
}
```

### TaskResult (in webhook payload)

```typescript
interface TaskResult {
  prUrl?: string;
  branch?: string;
  commits?: number;
  commitDetails?: { sha: string; message: string }[];
  summary?: string;
  ciFailed?: boolean;
  comment_replied?: boolean;
  planning_outcome_label?: 'planned' | 'unclear';
  planning_superpowers_writing_plans_used?: '0' | '1';
  planning_linear_url?: string;
  planning_is_complex?: '0' | '1';
  planning_has_plan_doc?: '0' | '1';
  planning_subtask_urls?: string;
  planning_pr_url?: string;
  planning_unclear_clarification?: string;
  execution_outcome_label?: 'implemented' | 'already_completed';
  execution_superpowers_subagent_driven_dev_used?: '0' | '1';
  execution_superpowers_requesting_code_review_used?: '0' | '1';
  execution_memory_ids_used?: string;
  execution_memory_ids_rejected?: string;
  execution_memory_usage_summary?: string;
  execution_linear_issue_url?: string;
  review_comments_posted?: string;
  review_id?: string;
  review_types?: string;
  requirements_tracker_updated?: string;
  gh_actions_status?: string;
  needs_remediation?: string;
  review_body?: string;
  review_inline_comments?: string;
  requires_re_review?: string;
  rebaseResult?: {
    attempted: boolean;
    success: boolean;
    conflictFiles?: string[];
  };
}
```

### TaskError (in webhook payload)

```typescript
interface TaskError {
  code: string;
  message: string;
  remediation?: {
    action: 'retry' | 'wait' | 'fix_code' | 'contact_support' | 'retry_smaller';
    retryAfter?: string;
    manualSteps?: string[];
    worktreePath?: string;
  };
}
```

### WebhookPayload (sent to webhookUrl)

```typescript
interface WebhookPayload {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  result?: TaskResult;
  error?: TaskError;
  duration: number; // milliseconds
}
```

Planning Agent note:

- `planned` outcome is sent as `status='completed'`
- `unclear` outcome is sent as `status='failed'` with `error.code='PLANNING_AGENT_UNCLEAR'`
- All planned outcomes (including SIMPLE tasks) require an evidence PR
- Deterministic Linear label/state/comment normalization is performed by `code-agent`, not orchestrator

Execution Agent note:

- `implemented` is sent as `status='completed'`
- `already_completed` is sent as `status='completed'` with `execution_outcome_label='already_completed'`
- All execution outcomes require `gh_pr_url` evidence
- Orchestrator verification is Gemini semantic validation of worker responses (latest response first)
- Orchestrator flattens execution verifier metadata into `execution_*` fields on `result`
- Memory usage is reported via `execution_memory_ids_used`, `execution_memory_ids_rejected`, `execution_memory_usage_summary`
- Worker owns GitHub execution (code/tests/CI/PR/review loop); PR descriptions include mandatory `Worker Type` and `Model` lines
- `code-agent` owns deterministic Linear enforcement for successful execution callbacks (executed issue only)

Review Agent note:

- Completed review is sent as `status='completed'`
- Orchestrator flattens review verifier metadata into `review_*` fields on `result`
- Review Agent does not push code changes — read-only PR review only
- `reviewTypes` controls which review scopes are included: `code_quality`, `security`, `architecture`, `plan_review`
- `plan_review` mode cross-references implementation against the original plan document
- `needs_remediation` signals whether a Remediation Agent should be dispatched

Remediation Agent note:

- Works on existing PR branch — implements fixes for review findings
- `requires_re_review` signals whether the changes warrant another review pass
- Messages via `sendMessage()` are rejected with `409`

Ask Agent note:

- No PR creation, no Linear issue management
- Messages delivered directly without resume preamble
- Completion contract is lighter — no PR URL or outcome label required
- `AskUserQuestion` tool is prohibited in the prompt

### TurnMetrics (sent to code-agent after task completion)

```typescript
interface TurnMetrics {
  taskId: string;
  attempt: number;
  timestamp: string;
  cpuTimeSeconds: number;
  cpuCores: number;
  peakMemoryMB: number;
  wallTimeSeconds: number;
  apiWaitSeconds: number;
  toolExecSeconds: number;
  backgroundWaitSeconds: number;
  overheadSeconds: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  apiCallCount: number;
  cpuUtilizationPercent: number;
  idlePercent: number;
}
```

### WorkerAuthState (in HealthResponse)

```typescript
type WorkerAuthState = {
  status: 'active' | 'expired' | 'not_configured' | 'invalid' | 'refresh_failed';
  authMode: 'oauth' | 'chatgpt' | null;
  refreshSupported: boolean;
  message?: string;
  expiresAt?: string;
  expiresInMinutes?: number;
  lastRefreshAt?: string;
  subscriptionType?: string;
};
```

### AgentComplianceReport (posted on PR)

```typescript
interface AgentComplianceReport {
  claimVerification: {
    ciTrackedCalled: { called: boolean; exitCode: number; msgRef: string };
    prCreated: { created: boolean; url: string; msgRef: string };
    commitCount: number;
    summaryAccurate: boolean;
    summaryContradictions: string[];
  };
  contractCompliance: {
    subagentDrivenDevInvoked: { invoked: boolean; msgRef: string };
    requestingCodeReviewInvoked: { invoked: boolean; msgRef: string };
    codeReviewerDispatched: { dispatched: boolean; msgRef: string };
    correctOrder: boolean;
    skillViolations: string[];
  };
  anomalies: Array<{
    type: 'fabrication' | 'hallucination' | 'protocol_violation' | 'other';
    severity: 'critical' | 'warning' | 'minor' | 'pass';
    msgRef: string;
    description: string;
  }>;
  executionMetrics: {
    totalMessages: number;
    hookViolationCount: number;
    toolErrorCount: number;
    subagentDispatchCount: number;
  };
}
```

---

## Communication Protocol

### Inbound (code-agent -> orchestrator)

| Method | Path                   | Auth        | Purpose                        |
| ------ | ---------------------- | ----------- | ------------------------------ |
| POST   | `/tasks`               | HMAC signed | Submit task                    |
| GET    | `/tasks/:id`           | None        | Query task status              |
| DELETE | `/tasks/:id`           | None        | Cancel task                    |
| POST   | `/tasks/:id/message`   | HMAC signed | Send follow-up message to task |
| GET    | `/health`              | None        | Health check                   |
| GET    | `/meta/worker-image`   | None        | Worker image diagnostics       |
| POST   | `/admin/refresh-token` | HMAC signed | Force token refresh            |
| POST   | `/admin/shutdown`      | HMAC signed | Request shutdown               |

### Outbound (orchestrator -> code-agent)

| Method | Path                                     | Auth                       | Purpose                       |
| ------ | ---------------------------------------- | -------------------------- | ----------------------------- |
| POST   | `{webhookUrl}`                           | HMAC (X-Request-Signature) | Task completion callback      |
| POST   | `/internal/logs`                         | HMAC + X-Internal-Auth     | Log chunk upload              |
| POST   | `/internal/code/heartbeat`               | HMAC (X-Request-Signature) | Running task keepalive        |
| POST   | `/internal/turn-metrics`                 | HMAC + X-Internal-Auth     | Per-task resource metrics     |
| POST   | `/internal/webhooks/task-event`          | HMAC + X-Internal-Auth     | PR automation log events      |
| GET    | `/internal/linear/issue-context/:id`     | X-Internal-Auth            | Linear issue context (proxy)  |

### HMAC Signature Format

**Inbound (dispatch):**

```
message = "{timestamp}.{nonce}.{json_body}"
signature = HMAC-SHA256(orchestratorSecret, message)
Headers: X-Dispatch-Timestamp, X-Dispatch-Nonce, X-Dispatch-Signature
```

**Outbound (webhook):**

```
message = "{timestamp}.{json_body}"
signature = HMAC-SHA256(webhookSecret, message)
Headers: X-Request-Timestamp, X-Request-Signature
```

**Outbound (logs):**

```
message = "{timestamp}.{json_body}"
signature = HMAC-SHA256(webhookSecret, message)
Headers: X-Request-Timestamp, X-Request-Signature, X-Internal-Auth
```

**Outbound (turn-metrics):**

```
message = "{timestamp}.{json_body}"
signature = HMAC-SHA256(orchestratorSecret, message)
Headers: X-Request-Timestamp, X-Request-Signature, X-Internal-Auth
```

---

## Behavioral Rules

### Task Submission

1. Check Docker health gate — reject with `503` if unhealthy
2. Check worker auth availability for target runtime — reject with `503` if not ready
3. Validate request body against Zod schema
4. Check capacity (atomic via mutex)
5. Return `202 Accepted` immediately (async execution)
6. If at capacity, return `503 Service Unavailable`

### Task Execution Flow

1. Create git worktree from `origin/{baseBranch}` (base branch fetched from origin first)
2. If `continuationPrBranch` is set, checkout existing PR branch for retried tasks
3. Validate API key for the target model provider (cached 5 minutes)
4. Build system prompt (agent-specific via `agentType`, with execution memory injection)
5. Pull worker image (15-minute timeout, separated from container creation)
6. Spawn a code-worker container for the selected runtime (2-minute creation timeout)
7. Write system prompt to container stdin
8. Stream logs to code-agent via LogForwarder
9. Monitor container exit (30s polling)
10. On exit: flush logs, check for PR via `gh pr list` + `gh pr checks`
11. Detect fatal exit codes (137/139) from tail of raw logs — skip Gemini verification, trigger immediate retry
12. Run completion verification (Gemini semantic validation with agent-specific Zod schemas)
13. If verification **fails** and `attempt < maxAttempts`: resume session with follow-up prompt listing missing criteria
14. If verification **passes**: run Agent Compliance Validation for execution tasks, collect turn metrics, send webhook
15. If max attempts reached without passing: send webhook with `TASK_COMPLETION_VERIFICATION_FAILED` error
16. Clean up token refresher, log forwarder, and task timers
17. If any queued messages arrived during execution: deliver them immediately as a new session
18. For ask_agent: check pending messages and flush task logs before teardown

### Startup Recovery

On startup, the orchestrator:

1. Loads persisted state from `state.json`
2. Finds tasks with `running` status
3. Checks for pending accepted resumes (`pendingResumeStart` field) and recovers them
4. Attempts to discover running Docker containers (60s timeout)
5. For each running task:
   - If container is still running: adopt it (re-attach monitoring, log forwarding, token refresh)
   - If container has exited or is unreachable: send `interrupted` webhook
6. Detects stateless orphan containers (in Docker but not in state.json) for periodic cleanup
7. Updates task status accordingly
8. Starts webhook retry for pending deliveries

### Timeout Behavior

| Threshold | Action                                     |
| --------- | ------------------------------------------ |
| 2h 55m    | Log warning                                |
| 3h 0m     | Kill container, send `interrupted` webhook |

---

## Environment

| Variable                                  | Required | Default                            |
| ----------------------------------------- | -------- | ---------------------------------- |
| `INTEXURAOS_REPOSITORY_URL`               | Yes      | -                                  |
| `INTEXURAOS_CODE_AGENT_URL`               | Yes      | -                                  |
| `INTEXURAOS_ORCHESTRATOR_SECRET`          | Yes      | -                                  |
| `INTEXURAOS_PROJECT_ID`                   | Yes      | -                                  |
| `INTEXURAOS_GITHUB_APP_ID`                | Yes      | -                                  |
| `INTEXURAOS_GITHUB_INSTALLATION_ID`       | Yes      | -                                  |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`          | Yes      | -                                  |
| `INTEXURAOS_LINEAR_API_KEY`               | Yes      | -                                  |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`            | Yes      | -                                  |
| `INTEXURAOS_GEMINI_APP_API_KEY`           | Yes      | -                                  |
| `INTEXURAOS_MINIMAX_APP_API_KEY`          | Yes      | -                                  |
| `INTEXURAOS_DASHSCOPE_APP_API_KEY`        | Yes      | -                                  |
| `INTEXURAOS_ZAI_APP_API_KEY`              | Yes      | -                                  |
| `GOOGLE_APPLICATION_CREDENTIALS`          | Yes      | -                                  |
| `INTEXURAOS_OPENROUTER_APP_API_KEY`       | No       | (empty — disables compliance)      |
| `INTEXURAOS_COMPLIANCE_MODEL`             | No       | `xiaomi/mimo-v2-pro`               |
| `INTEXURAOS_REPOSITORY_PATH`              | No       | `~/.code-orchestrator/repo`        |
| `INTEXURAOS_WORKER_CAPACITY`              | No       | `2`                                |
| `INTEXURAOS_COMPLETION_MAX_ATTEMPTS`      | No       | `3`                                |
| `INTEXURAOS_PRESERVE_WORKER_CONTAINERS`   | No       | `1`                                |
| `INTEXURAOS_CODE_WORKER_IMAGE`            | No       | (GCR Artifact Registry)            |
| `INTEXURAOS_CODE_WORKER_FORENSICS`        | No       | `0`                                |
| `INTEXURAOS_CODE_WORKER_FORENSICS_PATH`   | No       | `~/.code-orchestrator/forensics`   |
| `INTEXURAOS_GIT_USER_NAME`                | No       | (host git config)                  |
| `INTEXURAOS_GIT_USER_EMAIL`               | No       | (host git config)                  |
| `INTEXURAOS_GITHUB_APP_PRIVATE_KEY`       | No       | (Secret Manager)                   |
| `KEEP_CONTAINERS_ALIVE`                   | No       | `0`                                |
| `PORT`                                    | No       | `8199`                             |
| `LOG_LEVEL`                               | No       | `info`                             |

---

## Error Codes

| Code                                  | HTTP | Meaning                                                        |
| ------------------------------------- | ---- | -------------------------------------------------------------- |
| `at_capacity`                         | 503  | All worker slots occupied                                      |
| `docker_unavailable`                  | 503  | Docker daemon is not responding                                |
| `auth_unavailable`                    | 503  | Selected worker runtime auth is not ready                      |
| `invalid_request`                     | 400  | Request body failed Zod validation                             |
| `service_error`                       | 400  | Worktree or container creation failed                          |
| `not_found`                           | 404  | Task ID does not exist                                         |
| `already_completed`                   | 409  | Task already finished (cannot cancel)                          |
| `invalid_status`                      | 409  | Message sent to task with status that does not accept messages |
| `invalid_agent_type`                  | 409  | Message sent to review/remediation task (not supported)        |
| `NO_PR_CREATED`                       | -    | Task completed but no PR was found                             |
| `TASK_COMPLETION_VERIFICATION_FAILED` | -    | Max attempts reached without passing completion verification   |
| `TASK_COMPLETION_VERIFIER_FAILED`     | -    | Gemini verifier unreachable or returned invalid JSON           |
| `RESUME_ATTEMPT_FAILED`               | -    | Could not start a follow-up attempt container                  |
| `SETUP_FAILED`                        | -    | Task setup failed (worktree creation, API key invalid, etc.)   |
| `PLANNING_AGENT_UNCLEAR`              | -    | Planning agent could not produce a plan                        |

---

## Constraints

- Maximum concurrent tasks: configurable (default 2, via `INTEXURAOS_WORKER_CAPACITY`)
- Maximum task duration: 3 hours per attempt (hard timeout); multi-attempt tasks can run longer
- Maximum completion attempts: configurable (default 3, via `INTEXURAOS_COMPLETION_MAX_ATTEMPTS`)
- Maximum message length for `/tasks/:id/message`: 20,000 characters
- Maximum log size per task: 4 MB
- Log chunk size: 64 KB max
- Webhook retry: 3 attempts with 5s/15s/45s delays
- Pending webhook TTL: 24 hours
- Nonce cache TTL: 10 minutes
- Timestamp tolerance: 5 minutes
- GitHub token refresh: 5 minutes (service), 30 minutes (per-container)
- Heartbeat interval: 10 minutes
- Container memory limit: 8 GB
- Container CPU limit: 4 cores
- Image pull timeout: 15 minutes
- Container creation timeout: 2 minutes
- Turn metrics: non-fatal; zero values returned when cgroup path unavailable (macOS)
- Completion verifier: required; verifier failure marks task `failed` (no false positives)
- Container adoption timeout: 60 seconds on startup
- Worker types: 10 (auto, opus, sonnet for Anthropic; minimax for MiniMax; glm, qwen, kimi for DashScope; codex, codex-xhigh for Codex; openrouter-free for OpenRouter)
- Worker runtimes: 2 (claude, codex)
- Agent Compliance Validation: requires OpenRouter API key; skipped when not configured
- Agent Compliance Validator transcript limit: 720,000 characters
- GitHub comment size limit: 65,536 characters (split across multiple comments if needed)
- Container preservation: selective by agent type (execution and planning preserved; review, PR, and remediation cleaned up); one preserved container per PR
- Linear issue context: fetched via code-agent proxy only
- Evidence PR required for all execution outcomes and all planned outcomes (including SIMPLE tasks)
- Review/remediation agent types reject `sendMessage()` with 409
- Ask agent tasks skip PR resume preamble and prohibit `AskUserQuestion`
