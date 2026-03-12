# Code Agent — Technical Reference

## Overview

The code-agent service orchestrates autonomous code execution tasks. It accepts task submissions from the web UI (Auth0 JWT) and the actions-agent (internal auth), sanitizes prompts through two layers (secret redaction and injection prevention), creates Firestore documents with four-layer deduplication, dispatches HMAC-signed requests to user-configured workers via Cloudflare Access, streams log chunks into Firestore subcollections, processes completion webhooks, receives GitHub PR events and dispatches follow-up instructions (or creates new tasks from PR comments), and mirrors state transitions to Linear and the actions-agent.

- **Framework:** Fastify 5 on Node.js 22+
- **Port:** 8128 (local), 8080 (Cloud Run)
- **Package:** `@intexuraos/code-agent`
- **Deploy:** Cloud Run (scale 0-1)

## Architecture

```mermaid
graph TD
    subgraph Clients
        WebUI[Web UI - Auth0 JWT]
        ActionsAgent[actions-agent - Internal Auth]
        WhatsApp[WhatsApp - via actions-agent]
        GitHub[GitHub Webhooks]
    end

    subgraph code-agent
        Routes[Routes Layer]
        WebhookRules[Webhook Rules Engine]
        UseCases[Use Cases]
        DomainServices[Domain Services]
        Repos[Repositories]
        InfraAdapters[Infra Adapters]
    end

    subgraph External
        Firestore[(Firestore)]
        Worker[Worker - Orchestrator]
        LinearAgent[linear-agent]
        ActionsAgentSvc[actions-agent]
        WhatsAppSvc[WhatsApp Service]
        UserSvc[user-service]
        CloudMonitoring[Cloud Monitoring]
    end

    WebUI -->|POST /code/submit| Routes
    ActionsAgent -->|POST /internal/code/process| Routes
    GitHub -->|POST /webhooks/github| Routes
    Worker -->|POST /internal/webhooks/task-complete| Routes
    Worker -->|POST /internal/logs| Routes
    Worker -->|POST /internal/turn-metrics| Routes

    Routes --> WebhookRules
    WebhookRules --> UseCases
    Routes --> UseCases
    UseCases --> DomainServices
    UseCases --> Repos
    DomainServices --> InfraAdapters

    Repos --> Firestore
    InfraAdapters --> Worker
    InfraAdapters --> LinearAgent
    InfraAdapters --> ActionsAgentSvc
    InfraAdapters --> WhatsAppSvc
    InfraAdapters --> UserSvc
    InfraAdapters --> CloudMonitoring
```

## Data Flow: Task Submission

```mermaid
sequenceDiagram
    participant Client
    participant CodeAgent as code-agent
    participant Sanitizer as Prompt Sanitizer
    participant Injection as Injection Guard
    participant RateLimit as Rate Limit Service
    participant Linear as linear-agent
    participant Firestore
    participant Worker as Orchestrator
    participant WhatsApp as WhatsApp Service

    Client->>CodeAgent: POST /code/submit or /internal/code/process
    CodeAgent->>Sanitizer: sanitizePrompt(prompt)
    Sanitizer-->>CodeAgent: sanitized prompt (secrets stripped)
    CodeAgent->>Injection: sanitizePromptForInjection(prompt)
    Injection-->>CodeAgent: ok / rejected
    CodeAgent->>RateLimit: checkLimits(userId, promptLength)
    RateLimit-->>CodeAgent: ok / rate_limited

    CodeAgent->>Linear: ensureIssueExists(userId, prompt)
    Linear-->>CodeAgent: issueId, title, type, labels

    CodeAgent->>Firestore: create(task) with 4-layer dedup
    Firestore-->>CodeAgent: CodeTask document

    CodeAgent->>Worker: HMAC-signed POST /tasks
    Worker-->>CodeAgent: 200 OK (accepted)

    CodeAgent->>Firestore: update(cancelNonce, expiresAt)
    CodeAgent->>WhatsApp: notifyTaskStarted(userId, task) with CTA buttons
    CodeAgent-->>Client: { status: "submitted", codeTaskId }

    Note over Worker: Worker executes task...

    Worker->>CodeAgent: POST /internal/logs (streaming)
    CodeAgent->>Firestore: storeBatch(taskId, logChunks)

    Worker->>CodeAgent: POST /internal/turn-metrics
    CodeAgent->>Firestore: store(taskId, attempt, metrics)

    Worker->>CodeAgent: POST /internal/webhooks/task-complete
    CodeAgent->>Firestore: update(status, result)
    CodeAgent->>WhatsApp: notifyTaskComplete(userId, task) with CTA URL
    CodeAgent->>Linear: markInReview(issueId)
```

## Data Flow: GitHub PR Comment Dispatch

```mermaid
sequenceDiagram
    participant GitHub
    participant CodeAgent as code-agent
    participant Rules as Webhook Rules Engine
    participant Dispatch as Dispatch Service
    participant UserSvc as user-service
    participant Firestore
    participant Worker as Orchestrator

    GitHub->>CodeAgent: POST /webhooks/github (HMAC-SHA256)
    CodeAgent->>CodeAgent: verifyGitHubSignature()
    CodeAgent->>Firestore: save(parsedEvent)
    CodeAgent->>Firestore: upsert(prSummary)
    CodeAgent->>Rules: evaluate(event)
    Rules-->>CodeAgent: shouldDispatch: true/false

    alt shouldDispatch
        CodeAgent->>Dispatch: dispatch(event, decision)
        Dispatch->>Firestore: findByPR(repo, prNumber)
        alt existing task found
            Dispatch->>Worker: sendMessageToWorker(taskId, message)
        else no task found
            Dispatch->>UserSvc: resolveGitHubUsername(login)
            Dispatch->>Firestore: createTaskForPR(lockGuarded)
            Dispatch->>Worker: dispatch(task)
        end
    end
```

## Recent Changes

| Commit     | Description                                                             | Date         |
| ---------- | ----------------------------------------------------------------------- | ------------ |
| `55b959e6` | Add deep link ctaUrl to WhatsApp notifications                          | 2026-03-07   |
| `bd247a3d` | Treat Cloudflare 520–530 errors as retryable infrastructure errors      | 2026-03-07   |
| `a41ca812` | Replace PR URL text with WhatsApp CTA URL buttons                       | 2026-03-06   |
| `d2f8af51` | Rename failed task button from View Progress to Check Logs              | 2026-03-06   |
| `783dfbe7` | Extract backLinkPlanningTask helper to eliminate duplication            | 2026-03-06   |
| `ae79f3da` | Back-link planning tasks when execution tasks are created (INT-725)     | 2026-03-06   |
| `e5986ed4` | Add View Progress button to failed task notifications                   | 2026-03-06   |
| `84005b20` | Hydrate code task Linear data live                                      | 2026-03-05   |
| `b16a3c50` | Add linearIssueLabels to CodeTask model and CreateTaskInput             | 2026-03-04   |
| `171633b4` | Add prompt injection sanitization to code-agent (INT-413)               | 2026-03-04   |
| `a9c36c8c` | Add 'archived' status for retried tasks (INT-711)                       | 2026-03-04   |
| `d24a89e9` | Delete PR task lock when task reaches terminal state                    | 2026-03-04   |
| `a985c501` | Persist linearIssueLabels in processCodeAction task creation            | 2026-03-04   |

## API Endpoints

### Public Routes (Auth0 JWT)

| Method | Path                                       | Description                        | Auth  |
| ------ | ------------------------------------------ | ---------------------------------- | ----- |
| POST   | `/code/submit`                             | Submit code task from web UI       | Auth0 |
| GET    | `/code/tasks`                              | List user's tasks (paginated)      | Auth0 |
| GET    | `/code/tasks/:taskId`                      | Get task details                   | Auth0 |
| DELETE | `/code/tasks/:taskId`                      | Delete a code task                 | Auth0 |
| POST   | `/code/cancel`                             | Cancel a running task              | Auth0 |
| POST   | `/code/retry`                              | Retry a failed/cancelled task      | Auth0 |
| POST   | `/code/tasks/:taskId/feedback`             | Submit feedback on completed task  | Auth0 |
| POST   | `/code/tasks/:taskId/messages`             | Send message to running/ended task | Auth0 |
| POST   | `/code/tasks/:taskId/implement`            | Start execution from planning task | Auth0 |
| GET    | `/code/github-pr-events`                   | Query GitHub PR events             | Auth0 |
| GET    | `/code/github-pr-summaries`                | List PRs active in last 30 days    | Auth0 |
| GET    | `/code/workers/status`                     | Get worker health status           | Auth0 |
| POST   | `/code/workers/refresh-status`             | Refresh worker health status       | Auth0 |
| GET    | `/code/worker-settings`                    | Get worker settings (masked)       | Auth0 |
| POST   | `/code/worker-settings/workers`            | Add new worker                     | Auth0 |
| PATCH  | `/code/worker-settings/workers/:name`      | Update worker config               | Auth0 |
| DELETE | `/code/worker-settings/workers/:name`      | Delete worker                      | Auth0 |
| POST   | `/code/worker-settings/workers/:name/test` | Test worker connectivity           | Auth0 |
| PUT    | `/code/worker-settings/priority`           | Reorder workers by priority        | Auth0 |

### Internal Routes (X-Internal-Auth)

| Method | Path                                                | Description                            | Auth          |
| ------ | --------------------------------------------------- | -------------------------------------- | ------------- |
| POST   | `/internal/code/process`                            | Process code action from actions-agent | Internal      |
| PATCH  | `/internal/code-tasks/:taskId`                      | Update task status (worker callback)   | Internal      |
| GET    | `/internal/code-tasks/linear/:linearIssueId/active` | Check active task for Linear issue     | Internal      |
| GET    | `/internal/code-tasks/zombies`                      | Find zombie tasks                      | Internal      |
| POST   | `/internal/code/cancel-with-nonce`                  | Cancel task via nonce (WhatsApp)       | Internal      |
| POST   | `/internal/code/heartbeat`                          | Process heartbeat from orchestrator    | Internal+HMAC |
| POST   | `/internal/code/detect-zombies`                     | Trigger zombie detection               | Internal      |
| POST   | `/internal/tasks/cleanup-logs`                      | Trigger log cleanup                    | Internal      |
| POST   | `/internal/code/submit-phase2`                      | Submit execution phase (internal)      | Internal      |
| POST   | `/internal/drain-queue`                             | Drain task queue (Cloud Scheduler)     | Internal      |

### Webhook Routes (HMAC Signature)

| Method | Path                               | Description                           | Auth          |
| ------ | ---------------------------------- | ------------------------------------- | ------------- |
| POST   | `/internal/webhooks/task-complete` | Task completion callback              | Internal+HMAC |
| POST   | `/internal/logs`                   | Log chunk upload from orchestrator    | Internal+HMAC |
| POST   | `/internal/turn-metrics`           | Turn metrics upload from orchestrator | Internal+HMAC |
| POST   | `/webhooks/github`                 | GitHub webhook events                 | GitHub HMAC   |

### Utility Routes

| Method | Path            | Description  |
| ------ | --------------- | ------------ |
| GET    | `/health`       | Health check |
| GET    | `/openapi.json` | OpenAPI spec |
| GET    | `/docs`         | Swagger UI   |

## Domain Model

### CodeTask (collection: `code_tasks`)

The central entity. Tracks a coding task through its lifecycle.

```typescript
interface CodeTask {
  id: string;
  traceId: string;
  actionId?: string;
  approvalEventId?: string;
  retriedFrom?: string;
  userId: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen';
  workerLocation: string;
  status:
    | 'dispatched'
    | 'running'
    | 'queued'       // waiting for worker capacity (INT-619)
    | 'planned'      // planning agent completed
    | 'implemented'  // execution agent completed
    | 'failed'
    | 'interrupted'
    | 'cancelled'
    | 'archived';    // original task archived after retry (INT-711)
  prompt: string;
  sanitizedPrompt: string;    // After secret stripping + injection guard
  systemPromptHash: string;
  repository: string;
  baseBranch: string;
  linearIssueId?: string;
  prNumber?: number;          // Populated on completion
  prBranch?: string;
  parentTaskId?: string;
  followUpReason?: 'pr_comment' | 'user_feedback' | 'retry' | 'execution_implement';
  agentType?: 'planning' | 'execution' | 'pull_request';
  implementationTaskId?: string;
  linearIssueLabels?: string[];   // Persisted from Linear issue validation
  result?: TaskResult;
  error?: TaskError;
  createdAt: Timestamp;
  queuedAt?: Timestamp;
  dispatchedAt?: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;
  callbackReceived: boolean;
  webhookSecret?: string;
  lastHeartbeat?: Timestamp;
  logChunksDropped?: number;
  statusSummary?: StatusSummary;
  pendingUserMessages?: string[];
  dedupKey: string;
  cancelNonce?: string;
  cancelNonceExpiresAt?: string;
}
```

**Status Lifecycle:**

```
queued -> dispatched -> running -> planned | implemented | failed | cancelled
dispatched -> interrupted (zombie detection after 30 min)
queued -> failed (TTL expired or queue full)
failed | cancelled | interrupted -> archived (when task is retried, INT-711)
```

### LogChunk (subcollection: `code_tasks/{taskId}/logs`)

Streaming log data from the worker, ordered by sequence number.

```typescript
interface LogChunk {
  id: string;
  sequence: number;
  content: string; // May contain ANSI codes
  timestamp: Timestamp;
  size: number; // Byte size
}
```

### LogLine (subcollection: `code_tasks/{taskId}/log_lines`)

Formatted log lines parsed from chunks, plus system-generated status markers and metrics blocks.

```typescript
interface LogLine {
  sequence: number;
  text: string;        // Prefixed: [assistant], [tool], [user], [system], [queued], [resumed]
  timestamp: Timestamp;
}
```

### UserUsage (collection: `user_usage`)

Rate limiting counters with time-windowed resets.

```typescript
interface UserUsage {
  userId: string;
  concurrentTasks: number;
  tasksThisHour: number;
  hourStartedAt: Timestamp;
  costToday: number;
  costThisMonth: number;
  dayStartedAt: Timestamp;
  monthStartedAt: Timestamp;
  updatedAt: Timestamp;
}
```

### UserWorkerSettings (collection: `code_worker_settings`)

Per-user encrypted worker credentials and configuration.

```typescript
interface UserWorkerSettings {
  userId: string;
  workers: WorkerConfig[]; // Max 2, ordered by priority
  createdAt: string;
  updatedAt: string;
  workerHealthStatuses?: Record<string, WorkerHealthStatus>;
}
```

### TurnMetrics (subcollection: `code_tasks/{taskId}/turn_metrics`)

Per-turn resource and performance metrics, automatically collected at turn end.

```typescript
interface TurnMetrics {
  taskId: string;
  attempt: number;
  timestamp: string;
  cpuTimeSeconds: number;
  cpuCores: number;         // Dynamic from cgroup
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

### GitHubPREvent (collection: `github-pr-events`)

Normalized GitHub webhook events for PR timeline display.

### GitHubPRSummary (collection: `github-pr-summaries`)

One document per unique PR, upserted on every webhook event. Used for the 30-day PR list view — O(PRs) instead of O(events).

```typescript
interface GitHubPRSummary {
  repository: string;
  pullRequestNumber: number;
  title: string | null;
  state: string | null; // 'open' | 'closed'
  mergedAt: Date | null;
  lastActivityAt: Date;
  firstSeenAt: Date;
}
```

Document ID format: `${repository.replace('/', '__')}#${pullRequestNumber}`

## Firestore Collections Owned

| Collection             | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `code_tasks`           | Code execution tasks (subcollections: `logs`, `log_lines`, `turn_metrics`) |
| `user_spend`           | User cost tracking for rate limiting                                       |
| `user_usage`           | Rate limiting counters (concurrent, hourly, cost)                          |
| `code_worker_settings` | Per-user worker configs with encrypted credentials                         |
| `github-pr-events`     | GitHub PR webhook events for timeline display                              |
| `github-pr-summaries`  | Per-PR rollup documents for O(PRs) list view (30-day window)               |
| `pr_task_locks`        | Per-PR task locks preventing concurrent modifications                      |

## Use Cases

| Use Case                 | File                                          | Description                                                      |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------- |
| processCodeAction        | `domain/usecases/processCodeAction.ts`        | Create task with dedup, sanitize prompt, dispatch                |
| createTaskForPR          | `domain/usecases/createTaskForPR.ts`          | Create task from GitHub PR comment (user lookup + lock guard)    |
| cancelTaskWithNonce      | `domain/usecases/cancelTaskWithNonce.ts`      | Cancel via WhatsApp nonce validation                             |
| processHeartbeat         | `domain/usecases/processHeartbeat.ts`         | Update heartbeat timestamps for zombie detection                 |
| detectZombieTasks        | `domain/usecases/detectZombieTasks.ts`        | Find and interrupt stale tasks (30 min)                          |
| cleanupTaskLogs          | `domain/usecases/cleanupTaskLogs.ts`          | Archive logs older than 90 days                                  |
| retryTask                | `domain/usecases/retryTask.ts`                | Retry failed/cancelled with cool-off, archives original          |
| submitTaskFeedback       | `domain/usecases/submitTaskFeedback.ts`       | Follow-up on completed tasks with feedback                       |
| sendTaskMessage          | `domain/usecases/sendTaskMessage.ts`          | Send message to running task (queued) or resume ended            |
| submitToExecutionAgent   | `domain/usecases/submitToExecutionAgent.ts`   | Start execution agent from completed planning task               |
| drainTaskQueue           | `domain/usecases/drainTaskQueue.ts`           | Dispatch oldest queued task or expire if past TTL (INT-619)      |
| backLinkPlanningTask     | `domain/usecases/backLinkPlanningTask.ts`     | Back-link planning task to execution task (INT-725, best-effort) |
| enrichReviewWithComments | `domain/usecases/enrichReviewWithComments.ts` | Enrich PR review with comment thread context                     |

## Domain Services

| Service                | Interface                                   | Purpose                                                  |
| ---------------------- | ------------------------------------------- | -------------------------------------------------------- |
| LinearIssueService     | `domain/services/linearIssueService.ts`     | Validate/create Linear issues, state transitions         |
| RateLimitService       | `domain/services/rateLimitService.ts`       | Check and record rate limits per user                    |
| TaskDispatcherService  | `domain/services/taskDispatcher.ts`         | Dispatch tasks to workers with HMAC and fallback         |
| WhatsAppNotifier       | `domain/services/whatsappNotifier.ts`       | Send WhatsApp notifications with CTA URL buttons         |
| StatusMirrorService    | `infra/services/statusMirrorServiceImpl.ts` | Mirror task status to actions-agent                      |
| MetricsClient          | `domain/services/metrics.ts`                | Record Cloud Monitoring metrics                          |
| WebhookRulesService    | `domain/services/gitHubWebhookRules.ts`     | Evaluate GitHub webhook events against domain rules      |
| WebhookDispatchService | `domain/services/gitHubDispatchService.ts`  | Dispatch tasks from actionable GitHub webhook events     |
| GitHubMessageBuilder   | `domain/services/gitHubMessageBuilder.ts`   | Build task prompts from GitHub PR event context          |

## Domain Utilities

| Utility                     | File                                             | Purpose                                                     |
| --------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| sanitizePrompt              | `domain/utils/promptSanitization.ts`             | Strip secrets (AWS, API keys, PEM, env vars) from prompts   |
| sanitizePromptForInjection  | `domain/utils/promptInjectionSanitizer.ts`       | Reject system override markers, base64 blobs, control chars |
| labelUtils                  | `domain/utils/labelUtils.ts`                     | Check Linear labels (code-task, unclear, worker type)       |
| secrets                     | `domain/utils/secrets.ts`                        | Generate webhook secrets and cancel nonces                  |
| prTaskLock                  | `domain/utils/prTaskLock.ts`                     | Build and delete PR task locks for concurrent dispatch      |
| metricsLogFormatter         | `domain/formatters/metricsLogFormatter.ts`       | Format TurnMetrics as visual log blocks for the transcript  |

## Dependencies (Service-to-Service)

| Target Service      | Communication         | Purpose                                         |
| ------------------- | --------------------- | ----------------------------------------------- |
| linear-agent        | HTTP (internal auth)  | Issue CRUD, state transitions, title generation |
| actions-agent       | HTTP (internal auth)  | Action status updates                           |
| user-service        | HTTP (internal auth)  | GitHub username resolution, OAuth tokens        |
| whatsapp-service    | Pub/Sub               | WhatsApp message sending with CTA buttons       |
| Worker/Orchestrator | HTTP (CF Access+HMAC) | Task dispatch, cancellation, messaging          |

## Configuration

### Required Environment Variables

| Variable                           | Description                                   |
| ---------------------------------- | --------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`        | GCP project ID                                |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`   | Internal service auth token                   |
| `INTEXURAOS_WEBHOOK_VERIFY_SECRET` | HMAC secret for webhook validation            |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`  | AES key for encrypting worker credentials     |
| `INTEXURAOS_ORCHESTRATOR_SECRET`   | HMAC secret for orchestrator dispatch signing |
| `INTEXURAOS_GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC-SHA256 secret             |
| `INTEXURAOS_SERVICE_URL`           | This service's public URL (for webhook URLs)  |

### Production-Only Environment Variables

| Variable                                 | Description                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `INTEXURAOS_WHATSAPP_SERVICE_URL`        | WhatsApp service URL                                                   |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`  | Pub/Sub topic for WhatsApp messages                                    |
| `INTEXURAOS_LINEAR_AGENT_URL`            | linear-agent service URL                                               |
| `INTEXURAOS_ACTIONS_AGENT_URL`           | actions-agent service URL                                              |
| `INTEXURAOS_USER_SERVICE_URL`            | user-service URL (GitHub username resolution)                          |
| `INTEXURAOS_AUTH_AUDIENCE`               | Auth0 audience                                                         |
| `INTEXURAOS_AUTH_ISSUER`                 | Auth0 issuer                                                           |
| `INTEXURAOS_AUTH_JWKS_URL`               | Auth0 JWKS endpoint                                                    |
| `INTEXURAOS_WEB_URL`                     | Web app URL for task deep links (defaults to https://intexuraos.cloud) |

### Optional Environment Variables

| Variable                         | Description                                   |
| -------------------------------- | --------------------------------------------- |
| `INTEXURAOS_QUEUE_MAX_SIZE`      | Max queued tasks (default: 10)                |
| `INTEXURAOS_QUEUE_TTL_MINUTES`   | Queue expiry in minutes (default: 30)         |

### Rate Limit Defaults

| Limit                | Value   |
| -------------------- | ------- |
| Max concurrent tasks | 3       |
| Max tasks per hour   | 10      |
| Max prompt length    | 10,000  |
| Monthly cost cap     | $200    |
| Estimated cost/task  | $1.17   |
| Zombie threshold     | 30 min  |
| Log retention        | 90 days |
| Cancel nonce TTL     | 15 min  |
| Retry cool-off       | 5 min   |
| Queue TTL            | 30 min  |
| Queue max size       | 10      |

## Gotchas

1. **Worker credentials are per-user.** There are no global/fallback workers. If a user has no configured workers, task submission fails with `worker_not_configured`.
2. **HMAC validation requires raw body.** Fastify parses JSON, so the GitHub webhook handler reconstructs the raw body via `JSON.stringify(request.body)` for signature verification.
3. **Log chunk sequence 0 triggers status transition.** When the first log chunk arrives, the service transitions the task from `dispatched` to `running`.
4. **Cancelled tasks bypass the 5-minute retry cool-off.** Only failed tasks enforce the cool-off period.
5. **E2E mode replaces all external clients with no-ops.** Set `E2E_MODE=true` to use mock Linear, WhatsApp, and actions-agent clients.
6. **PR events API applies two deduplication passes.** `GET /code/github-pr-events` runs `deduplicateCommentEvents` (keeps first occurrence, updates body to latest) then `deduplicatePRBody` (removes PR body from all but the most recent `pull_request` event) before returning results. The raw events in Firestore are unmodified.
7. **`github-pr-summaries` documents use `__` instead of `/` in repository names.** Firestore path separator conflicts with repo slugs, so `owner/repo` becomes `owner__repo#prNumber` as the document ID.
8. **Prompt sanitization runs before dispatch but after dedup key generation.** The `dedupKey` is computed from the raw prompt so that repeated submissions of the same prompt (with or without secrets) are correctly deduplicated. The worker only ever sees the sanitized version.
9. **Sender whitelist for PR comment dispatch.** Only comments from `claude[bot]`, `chatgpt-codex-connector[bot]`, and the repository owner trigger task dispatch. Other senders are silently ignored.
10. **Bot review edit triage.** When a whitelisted bot edits its comment, the dispatch message instructs the agent to check whether the review is still in progress (spinner, short body, unchecked items) before acting.
11. **Turn metrics use orchestrator HMAC, not per-task HMAC.** The `/internal/turn-metrics` endpoint validates signatures against `INTEXURAOS_ORCHESTRATOR_SECRET`, not the per-task webhook secret.
12. **Retried tasks archive the original.** When a task is retried (INT-711), the original task's status changes to `archived`, keeping the task list focused on active work. The new task links back via `retriedFrom`.
13. **Cloudflare 520–530 errors are retryable.** The task dispatcher treats Cloudflare tunnel errors (520–530 range) as infrastructure failures and falls back to the next worker, rather than failing the task immediately.
14. **PR task locks guard concurrent dispatch.** When a GitHub PR comment triggers task creation, a Firestore transaction-based lock (`pr_task_locks` collection) prevents duplicate tasks from concurrent webhook deliveries. Locks are cleaned up when tasks reach terminal status.
15. **createTaskForPR resolves GitHub usernames.** The `UserLookupService` chains `user-service` GitHub OAuth resolution with `code_worker_settings` GitHub username fallback to map a GitHub login to an IntexuraOS userId.
16. **Linear issue labels drive worker type.** If a Linear issue has a label matching a supported worker type (e.g., `opus`, `sonnet`), that overrides the user-requested worker type for the task.
17. **SkipPrefixRule filters @claude/@codex/@ignore.** Comments starting with these prefixes are silently ignored by the webhook rules engine, preventing unwanted task dispatch from bot mentions or explicit ignore markers.
18. **Gemini-extracted task summaries.** When a task completes, the orchestrator's `CompletionVerifier` uses `gemini-2.5-flash` to extract a 3–5 sentence narrative summary from the agent's output. If the agent's own summary is missing or too brief, Gemini writes one from the logs. The summary is injected into `TaskResult.summary` (now optional alongside `branch` and `commits`).
19. **PR title auto-update with Linear ID.** When `createTaskForPR` creates a new Linear issue from a PR comment, it prepends `[INT-XXX]` to the GitHub PR title using the commenter's GitHub OAuth token. This is best-effort — failures are logged but do not block task creation.
20. **Mandatory Linear comments reading.** All agent types (planning, execution, pull request) read the full Linear issue and all its comments (newest-first) as their mandatory first action before doing any work. This ensures clarifications added after an "unclear" flag are incorporated on re-execution.

## File Structure

```
apps/code-agent/src/
  index.ts                          # Entry point, env validation, startup
  server.ts                         # Fastify server setup, CORS, Swagger
  config.ts                         # Config loader (env -> Config interface)
  services.ts                       # DI container (ServiceContainer)
  domain/
    models/
      codeTask.ts                   # CodeTask, TaskStatus, TaskResult, TaskError
      gitHubPREvent.ts              # GitHub webhook event model
      gitHubPRSummary.ts            # Per-PR summary for list view
      logChunk.ts                   # Log chunk model (HMAC-signed uploads)
      logLine.ts                    # FormattedLogLine (for LogLineRepository)
      signing.ts                    # Signing error types
      turnMetrics.ts                # Per-turn CPU/memory/token metrics
      userSpend.ts                  # User spend tracking model
      userUsage.ts                  # User usage + DEFAULT_LIMITS
      worker.ts                     # WorkerLocation type
      workerSettings.ts             # UserWorkerSettings, WorkerCredentials, WorkerHealthState
    ports/
      gitHubPRClient.ts             # GitHub PR HTTP client interface
      gitHubUsernameResolver.ts     # GitHub username -> userId resolution
      linearAgentClient.ts          # Linear agent client interface
      userLookupService.ts          # GitHub login -> IntexuraOS user resolution
      userUsageRepository.ts        # User usage repository interface
      workerHealthProbe.ts          # Worker health probe interface
      workerSettingsRepository.ts   # Worker settings repository interface
    repositories/
      codeTaskRepository.ts         # CodeTask CRUD + dedup interface
      gitHubPREventRepository.ts    # GitHub PR event repository interface
      gitHubPRSummaryRepository.ts  # PR summary repository interface
      logChunkRepository.ts         # Log chunk storage interface
      logLineRepository.ts          # LogLine storage interface
      turnMetricsRepository.ts      # Turn metrics storage interface
    services/
      gitHubDispatchService.ts      # Webhook dispatch orchestration
      gitHubMessageBuilder.ts       # Build prompts from PR events
      gitHubWebhookRules.ts         # Domain rules for webhook actionability
      linearIssueService.ts         # Linear issue management service
      logFormatter.ts               # Log chunk -> log line parser
      metrics.ts                    # MetricsClient interface
      rateLimitService.ts           # Rate limit checking and recording
      statusMirrorService.ts        # Status mirror service interface
      taskDispatcher.ts             # Task dispatch interface + types
      whatsappNotifier.ts           # WhatsApp notification interface
    usecases/
      backLinkPlanningTask.ts       # Back-link planning -> execution (INT-725)
      cancelTaskWithNonce.ts        # Cancel via nonce
      cleanupTaskLogs.ts            # Log archival
      createTaskForPR.ts            # Create task from PR comment (lock-guarded)
      detectZombieTasks.ts          # Zombie detection
      drainTaskQueue.ts             # Queue draining (INT-619)
      enrichReviewWithComments.ts   # Enrich PR review with comment context
      processCodeAction.ts          # Main task creation + dispatch
      processHeartbeat.ts           # Heartbeat processing
      retryTask.ts                  # Task retry with cool-off + archival
      sendTaskMessage.ts            # Send message to running/ended task
      submitTaskFeedback.ts         # Feedback follow-up
      submitToExecutionAgent.ts     # Execution agent from planning
    utils/
      labelUtils.ts                 # Linear label checks (code-task, unclear, worker type)
      promptInjectionSanitizer.ts   # System keyword, base64, control char rejection (INT-413)
      promptSanitization.ts         # Secret stripping and whitespace normalization
      prTaskLock.ts                 # PR task lock helpers
      secrets.ts                    # Webhook secret and cancel nonce generation
    formatters/
      metricsLogFormatter.ts        # TurnMetrics -> formatted log block
  infra/
    auth/
      index.ts                     # Auth exports
      jwtValidator.ts              # Auth0 JWT validation
    clients/
      actionsAgentClient.ts        # Actions agent HTTP client
    firestore/
      encryption.ts                # AES-256-GCM encryption for worker creds
      gitHubPREventsRepository.ts  # GitHub PR events Firestore impl
      gitHubPRSummariesRepository.ts    # PR summary Firestore impl (upsert + list)
      userUsageFirestoreRepository.ts   # User usage Firestore impl
      workerSettingsRepository.ts  # Worker settings Firestore impl
    http/
      gitHubPRHttpClient.ts        # GitHub PR HTTP client for title updates
      linearAgentHttpClient.ts     # Linear agent HTTP client
    migrations/
      agentRoutingContractMigration.ts  # Agent routing contract migration
    repositories/
      firestoreCodeTaskRepository.ts    # CodeTask Firestore impl
      firestoreLogChunkRepository.ts    # LogChunk Firestore impl
      firestoreLogLineRepository.ts     # LogLine Firestore impl
      firestoreTurnMetricsRepository.ts # TurnMetrics subcollection impl
    services/
      gitHubUsernameResolverImpl.ts  # GitHub username resolution via user-service
      hmacSigning.ts               # HMAC signing utilities
      statusMirrorServiceImpl.ts   # Action status mirroring impl
      taskDispatcherImpl.ts        # Task dispatch with CF Access + fallback
      userLookupServiceImpl.ts     # User lookup (GitHub -> IntexuraOS user)
      whatsappNotifierImpl.ts      # WhatsApp notification via Pub/Sub
      workerHealthProbe.ts         # Worker health probing impl
    github-event-parser.ts         # GitHub webhook payload parser
    github-webhook-auth.ts         # GitHub HMAC-SHA256 verification
    metrics.ts                     # Cloud Monitoring metrics impl
    webhookValidation.ts           # Webhook HMAC validation
  routes/
    index.ts                       # Route registration
    codeRoutes.ts                  # Main code task routes (internal + public)
    webhookRoutes.ts               # Task completion + log + turn-metrics webhooks
    workerSettingsRoutes.ts        # Worker settings CRUD routes
    code/
      index.ts                     # Code route exports
      extractEventUrl.ts           # Extract clickable GitHub URLs from webhook payloads
      github-pre-events.ts         # GitHub PR events query route (with dedup passes)
      github-pr-summaries.ts       # PR summaries list route (30-day window)
    webhooks/
      index.ts                     # Webhook route aggregator
      github.ts                    # GitHub webhook handler + rules evaluation + dispatch
```
