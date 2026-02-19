# orchestrator -- Agent Interface

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
    workerType: 'opus' | 'auto' | 'glm';
    prompt: string;
    repository?: string;
    baseBranch?: string;
    linearIssueId?: string;
    linearIssueTitle?: string;
    linearIssueLabels: string[];
    hasChildren: boolean;
    slug?: string;
    webhookUrl: string;
    webhookSecret: string;
    actionId?: string;
    retriedFrom?: string;
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
  workerType: 'opus' | 'auto' | 'glm';
  prompt: string;
  repository: string;
  baseBranch: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  slug?: string;
  webhookUrl: string;
  webhookSecret: string;
  actionId?: string;
  retriedFrom?: string; // Original task ID for retry chains
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  worktreePath: string;
  containerId: string;
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
}
```

### TaskResult (in webhook payload)

```typescript
interface TaskResult {
  prUrl?: string;
  branch: string;
  commits: number;
  summary?: string;
  ciFailed?: boolean;
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

| Method | Path                   | Auth        | Purpose             |
| ------ | ---------------------- | ----------- | ------------------- |
| POST   | `/tasks`               | HMAC signed | Submit task         |
| GET    | `/tasks/:id`           | None        | Query task status   |
| DELETE | `/tasks/:id`           | None        | Cancel task         |
| GET    | `/health`              | None        | Health check        |
| POST   | `/admin/refresh-token` | HMAC signed | Force token refresh |
| POST   | `/admin/shutdown`      | HMAC signed | Request shutdown    |

### Outbound (orchestrator -> code-agent)

| Method | Path                        | Auth                       | Purpose                   |
| ------ | --------------------------- | -------------------------- | ------------------------- |
| POST   | `{webhookUrl}`              | HMAC (X-Request-Signature) | Task completion callback  |
| POST   | `/internal/logs`            | HMAC + X-Internal-Auth     | Log chunk upload          |
| POST   | `/internal/code/heartbeat`  | HMAC (X-Request-Signature) | Running task keepalive    |
| POST   | `/internal/turn-metrics`    | HMAC + X-Internal-Auth     | Per-task resource metrics |

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
2. Build system prompt (Phase 1 or Phase 2 based on labels)
3. Spawn Docker container with Claude Code in interactive mode
4. Write system prompt to container stdin
5. Stream logs to code-agent via LogForwarder
6. Monitor container exit (30s polling)
7. On exit: check for PR via `gh pr list`, determine success/failure
8. Collect turn metrics from cgroup and session JSONL
9. Send webhook with result or error
10. Clean up token refresher and log forwarder registrations

### Timeout Behavior

| Threshold | Action                                     |
| --------- | ------------------------------------------ |
| 1h 55m    | Log warning                                |
| 2h 0m     | Kill container, send `interrupted` webhook |

### Recovery Behavior

On startup, the orchestrator:

1. Loads persisted state from `state.json`
2. Finds tasks with `running` status
3. Sends `interrupted` webhook for each
4. Updates task status to `interrupted`
5. Starts webhook retry for pending deliveries

---

## Environment

| Variable                            | Required | Default                       |
| ----------------------------------- | -------- | ----------------------------- |
| `INTEXURAOS_REPOSITORY_URL`         | Yes      | -                             |
| `INTEXURAOS_CODE_AGENT_URL`         | Yes      | -                             |
| `INTEXURAOS_ORCHESTRATOR_SECRET`    | Yes      | -                             |
| `INTEXURAOS_PROJECT_ID`             | Yes      | -                             |
| `INTEXURAOS_GITHUB_APP_ID`          | Yes      | -                             |
| `INTEXURAOS_GITHUB_INSTALLATION_ID` | Yes      | -                             |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`    | Yes      | -                             |
| `INTEXURAOS_LINEAR_API_KEY`         | Yes      | -                             |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`      | Yes      | -                             |
| `GOOGLE_APPLICATION_CREDENTIALS`    | Yes      | -                             |
| `INTEXURAOS_REPOSITORY_PATH`        | No       | `~/.claude-orchestrator/repo` |
| `INTEXURAOS_ANTHROPIC_API_KEY`      | No       | `""`                          |
| `INTEXURAOS_ZAI_APP_API_KEY`        | No       | `""`                          |
| `INTEXURAOS_WORKER_CAPACITY`        | No       | `2`                           |
| `PORT`                              | No       | `8199`                        |
| `LOG_LEVEL`                         | No       | `info`                        |

---

## Error Codes

| Code                | HTTP | Meaning                               |
| ------------------- | ---- | ------------------------------------- |
| `at_capacity`       | 503  | All worker slots occupied             |
| `invalid_request`   | 400  | Request body failed Zod validation    |
| `service_error`     | 400  | Worktree or container creation failed |
| `not_found`         | 404  | Task ID does not exist                |
| `already_completed` | 409  | Task already finished (cannot cancel) |
| `NO_PR_CREATED`     | -    | Task completed but no PR was found    |

---

## Constraints

- Maximum concurrent tasks: configurable (default 2, Docker limit 4)
- Maximum task duration: 2 hours (hard timeout)
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
- Turn metrics: non-fatal; zero values returned when cgroup path unavailable
