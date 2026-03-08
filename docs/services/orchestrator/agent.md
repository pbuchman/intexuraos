# orchestrator — Agent Interface

> Machine-readable interface definition for AI agents interacting with the orchestrator.

---

## Identity

| Field    | Value                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Name** | orchestrator                                                                                                           |
| **Role** | Code Task Orchestration Engine                                                                                         |
| **Goal** | Receive code tasks from code-agent, execute them in isolated Docker containers, and report results via signed webhooks |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface OrchestratorTools {
  // Submit a new code task for execution
  submitTask(params: {
    taskId: string;
    workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
    prompt: string;
    repository?: string;
    baseBranch?: string;
    linearIssueId?: string;
    linearIssueTitle?: string;
    linearIssueLabels: string[];
    hasChildren: boolean;
    agentType?: 'planning' | 'execution' | 'pull_request';
    planningPrBranch?: string;
    planningPrUrl?: string;
    slug?: string;
    webhookUrl: string;
    webhookSecret: string;
    actionId?: string;
  }): Promise<{ taskId: string; status: 'accepted' }>;
  // Auth: HMAC-signed (X-Dispatch-Timestamp + X-Dispatch-Nonce + X-Dispatch-Signature)
  // Errors: 400 (validation), 401 (auth), 503 (at capacity)

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
  sendMessage(params: {
    taskId: string;
    message: string; // max 20000 chars
  }): Promise<SendMessageResult>;
  // Auth: HMAC-signed
  // Errors: 400 (validation), 404 (not found), 409 (invalid status, e.g. cancelled)

  // Check service health and capacity
  getHealth(): Promise<{
    status:
      | 'ready'
      | 'initializing'
      | 'recovering'
      | 'degraded'
      | 'auth_degraded'
      | 'shutting_down';
    capacity: number;
    running: number;
    available: number;
    githubTokenExpiresAt: string | null;
    anthropicOAuth: OAuthState;
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
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
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
  retriedFrom?: string; // Original task ID for retry chains
  agentType?: 'planning' | 'execution' | 'pull_request';
  planningPrBranch?: string; // Branch name of planning PR to merge into execution worktree
  planningPrUrl?: string; // PR URL to close after successful execution
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  worktreePath: string;
  containerId: string;
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
  attemptCount?: number; // Current attempt (starts at 1)
  maxAttempts?: number; // Maximum before terminal failure
  lastExitCode?: number; // Exit code of most recent attempt
  verificationHistory?: TaskVerificationRecord[]; // Completion verifier results per attempt
  resumedAfterSuccess?: boolean; // Set when a completed task is resumed via sendMessage()
}

interface TaskVerificationRecord {
  attempt: number;
  passed: boolean;
  missingFields: string[];
  verifierFailure: boolean; // true if Gemini was unreachable or returned invalid JSON
  createdAt: string;
}
```

### SendMessageResult

```typescript
interface SendMessageResult {
  action: 'queued' | 'resumed';
  pendingMessages?: string[]; // Set when action is 'queued', lists all queued messages
}
```

### TaskResult (in webhook payload)

```typescript
interface TaskResult {
  prUrl?: string;
  branch?: string;
  commits?: number;
  summary?: string;
  ciFailed?: boolean;
  comment_replied?: boolean;
  planning_outcome_label?: 'planned' | 'unclear';
  planning_superpowers_writing_plans_used?: '0' | '1';
  planning_linear_url?: string;
  planning_is_complex?: '0' | '1';
  planning_subtask_urls?: string;
  planning_pr_url?: string;
  planning_unclear_clarification?: string;
  execution_outcome_label?: 'implemented';
  execution_superpowers_executing_plans_used?: '0' | '1';
  execution_superpowers_requesting_code_review_used?: '0' | '1';
  execution_linear_issue_url?: string;
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
- Deterministic Linear label/state/comment normalization is performed by `code-agent`, not orchestrator

Execution Agent note:

- `implemented` is sent as `status='completed'`
- Orchestrator verification is Gemini semantic validation of Claude responses only (latest response first)
- Orchestrator flattens execution verifier metadata into `execution_*` fields on `result`
- Worker owns GitHub execution (code/tests/CI/PR/review loop)
- `code-agent` owns deterministic Linear enforcement for successful execution callbacks (executed issue only)

### TurnMetrics (sent to code-agent after task completion)

```typescript
interface TurnMetrics {
  taskId: string;
  attempt: number;
  timestamp: string; // ISO 8601 (completedAt)
  // Resource (cgroup)
  cpuTimeSeconds: number;
  cpuCores: number;
  peakMemoryMB: number;
  // Time classification (session JSONL)
  wallTimeSeconds: number;
  apiWaitSeconds: number;
  toolExecSeconds: number;
  backgroundWaitSeconds: number;
  overheadSeconds: number;
  // Tokens (session JSONL)
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  apiCallCount: number;
  // Derived
  cpuUtilizationPercent: number;
  idlePercent: number;
}
```

### OAuthState (in HealthResponse)

```typescript
type OAuthState =
  | { status: 'active'; expiresInMinutes: number }
  | { status: 'expired'; message: string }
  | { status: 'not_configured'; message: string };
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

| Method | Path                       | Auth                       | Purpose                   |
| ------ | -------------------------- | -------------------------- | ------------------------- |
| POST   | `{webhookUrl}`             | HMAC (X-Request-Signature) | Task completion callback  |
| POST   | `/internal/logs`           | HMAC + X-Internal-Auth     | Log chunk upload          |
| POST   | `/internal/code/heartbeat` | HMAC (X-Request-Signature) | Running task keepalive    |
| POST   | `/internal/turn-metrics`   | HMAC + X-Internal-Auth     | Per-task resource metrics |

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

1. Validate request body against Zod schema
2. Check capacity (atomic via mutex)
3. Return `202 Accepted` immediately (async execution)
4. If at capacity, return `503 Service Unavailable`

### Task Execution Flow

1. Create git worktree from `origin/{baseBranch}`
2. If `planningPrBranch` is set, merge planning branch into worktree
3. Validate API key for the target model provider (cached 5 minutes)
4. Build system prompt (agent-specific: planning/execution/pull_request via labels + `agentType`)
5. Spawn Docker container with Claude Code in interactive mode
6. Write system prompt to container stdin
7. Stream logs to code-agent via LogForwarder
8. Monitor container exit (30s polling)
9. On exit: flush logs, check for PR via `gh pr list` + `gh pr checks`
10. Run completion verification (Gemini semantic validation of Claude responses with agent-specific Zod schemas)
11. If verification **fails** and `attempt < maxAttempts`: resume session with follow-up prompt listing missing criteria
12. If verification **passes** or max attempts reached: collect turn metrics, send webhook with result or error
13. Clean up token refresher, log forwarder, and task timers
14. If any queued messages arrived during execution: deliver them immediately as a new session

### Startup Recovery

On startup, the orchestrator:

1. Loads persisted state from `state.json`
2. Finds tasks with `running` status
3. Attempts to discover running Docker containers (5s timeout)
4. For each running task:
   - If container is still running: adopt it (re-attach monitoring, log forwarding, token refresh)
   - If container has exited or is unreachable: send `interrupted` webhook
5. Updates task status accordingly
6. Starts webhook retry for pending deliveries

### Timeout Behavior

| Threshold | Action                                     |
| --------- | ------------------------------------------ |
| 1h 55m    | Log warning                                |
| 2h 0m     | Kill container, send `interrupted` webhook |

---

## Environment

| Variable                                       | Required | Default                       |
| ---------------------------------------------- | -------- | ----------------------------- |
| `INTEXURAOS_REPOSITORY_URL`                    | Yes      | -                             |
| `INTEXURAOS_CODE_AGENT_URL`                    | Yes      | -                             |
| `INTEXURAOS_ORCHESTRATOR_SECRET`               | Yes      | -                             |
| `INTEXURAOS_PROJECT_ID`                        | Yes      | -                             |
| `INTEXURAOS_GITHUB_APP_ID`                     | Yes      | -                             |
| `INTEXURAOS_GITHUB_INSTALLATION_ID`            | Yes      | -                             |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`               | Yes      | -                             |
| `INTEXURAOS_LINEAR_API_KEY`                    | Yes      | -                             |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`                 | Yes      | -                             |
| `INTEXURAOS_GEMINI_APP_API_KEY`                | Yes      | -                             |
| `INTEXURAOS_ZAI_APP_API_KEY`                   | Yes      | -                             |
| `INTEXURAOS_MINIMAX_APP_API_KEY`               | Yes      | -                             |
| `INTEXURAOS_DASHSCOPE_APP_API_KEY`             | Yes      | -                             |
| `GOOGLE_APPLICATION_CREDENTIALS`               | Yes      | -                             |
| `INTEXURAOS_REPOSITORY_PATH`                   | No       | `~/.claude-orchestrator/repo` |
| `INTEXURAOS_WORKER_CAPACITY`                   | No       | `2`                           |
| `INTEXURAOS_COMPLETION_MAX_ATTEMPTS`           | No       | `3`                           |
| `INTEXURAOS_PRESERVE_FAILED_WORKER_CONTAINERS` | No       | `1`                           |
| `INTEXURAOS_CLAUDE_WORKER_IMAGE`               | No       | (GCR Artifact Registry)       |
| `INTEXURAOS_GIT_USER_NAME`                     | No       | (host git config)             |
| `INTEXURAOS_GIT_USER_EMAIL`                    | No       | (host git config)             |
| `INTEXURAOS_FORENSICS_ENABLED`                 | No       | `0`                           |
| `INTEXURAOS_FORENSICS_CORE_DUMPS`              | No       | `0`                           |
| `INTEXURAOS_FORENSICS_EXEC_PERSISTENCE`        | No       | `0`                           |
| `INTEXURAOS_FORENSICS_CRASH_SNAPSHOTS`         | No       | `0`                           |
| `PORT`                                         | No       | `8199`                        |
| `LOG_LEVEL`                                    | No       | `info`                        |

---

## Error Codes

| Code                                  | HTTP | Meaning                                                        |
| ------------------------------------- | ---- | -------------------------------------------------------------- |
| `at_capacity`                         | 503  | All worker slots occupied                                      |
| `invalid_request`                     | 400  | Request body failed Zod validation                             |
| `service_error`                       | 400  | Worktree or container creation failed                          |
| `not_found`                           | 404  | Task ID does not exist                                         |
| `already_completed`                   | 409  | Task already finished (cannot cancel)                          |
| `invalid_status`                      | 409  | Message sent to task with status that does not accept messages |
| `NO_PR_CREATED`                       | -    | Task completed but no PR was found                             |
| `TASK_COMPLETION_VERIFICATION_FAILED` | -    | Max attempts reached without passing completion verification   |
| `TASK_COMPLETION_VERIFIER_FAILED`     | -    | Gemini verifier unreachable or returned invalid JSON           |
| `RESUME_ATTEMPT_FAILED`               | -    | Could not start a follow-up attempt container                  |
| `SETUP_FAILED`                        | -    | Task setup failed (worktree creation, API key invalid, etc.)   |

---

## Constraints

- Maximum concurrent tasks: configurable (default 2, via `INTEXURAOS_WORKER_CAPACITY`)
- Maximum task duration: 2 hours per attempt (hard timeout); multi-attempt tasks can run longer
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
- Turn metrics: non-fatal; zero values returned when cgroup path unavailable (macOS)
- Completion verifier: required; verifier failure marks task `failed` (no false positives)
- Container adoption timeout: 5 seconds on startup
- Worker types: 6 (opus, auto, sonnet for Anthropic; glm for ZAI; minimax for MiniMax; qwen3.5-plus for Alibaba Cloud)
