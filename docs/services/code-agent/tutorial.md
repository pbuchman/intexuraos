# Code Agent — Getting Started Tutorial

**Time estimate:** 30-45 minutes

## Prerequisites

- Node.js 22+
- pnpm installed
- Firestore emulator running (or GCP project access)
- Built packages (`pnpm build` from repo root)
- A configured worker machine (Mac Mini or VM with orchestrator installed)
- Cloudflare Access credentials for your worker tunnel

## Part 1: Running Locally (10 min)

### Step 1: Start the service

The service runs on port 8128 in local development. Start it via the ecosystem config:

```bash
pnpm run dev:code-agent
```

Or run directly:

```bash
cd apps/code-agent
node --watch --experimental-strip-types src/index.ts
```

### Step 2: Verify the health endpoint

```bash
curl http://localhost:8128/health
```

Expected response:

```json
{ "status": "ok", "service": "code-agent" }
```

### Step 3: Explore the API docs

Open [http://localhost:8128/docs](http://localhost:8128/docs) in your browser to see the Swagger UI with all available endpoints.

## Part 2: Configure a Worker (10 min)

Before you can submit tasks, you need to configure at least one worker. Workers are user-specific — each user manages their own worker machines.

### Step 1: Add a worker via API

```bash
curl -X POST http://localhost:8128/code/worker-settings/workers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{
    "name": "home-mac",
    "url": "https://your-worker.tunnel.example.com",
    "cfAccessClientId": "your-cf-client-id",
    "cfAccessClientSecret": "your-cf-client-secret",
    "dispatchSigningSecret": "your-hmac-secret"
  }'
```

Worker names must be 3-32 characters, lowercase alphanumeric with hyphens.

### Step 2: Test connectivity

```bash
curl -X POST http://localhost:8128/code/worker-settings/workers/home-mac/test \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

Expected response:

```json
{
  "success": true,
  "data": {
    "testStatus": "success",
    "testMessage": "Connection successful",
    "lastTestedAt": "2026-03-07T10:30:00.000Z"
  }
}
```

### Step 3: Verify settings

```bash
curl http://localhost:8128/code/worker-settings \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

Secrets appear masked in the response (e.g., `"cfAccessClientSecret": "...xyz"`).

## Part 3: Submit a Code Task (10 min)

### Step 1: Submit via the public endpoint

```bash
curl -X POST http://localhost:8128/code/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{
    "prompt": "Add a /health endpoint to the bookmarks-agent service",
    "workerType": "auto"
  }'
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "submitted",
    "codeTaskId": "task_abc123-def456-..."
  }
}
```

Note: If you accidentally include a secret in your prompt (e.g., `DB_PASSWORD=s3cr3t`), Code Agent strips it before the prompt reaches the worker. If you include system override markers (e.g., `[SYSTEM]`), the submission is rejected with a `validation_error`. Both sanitization layers run automatically.

### Step 2: Check task status

```bash
curl http://localhost:8128/code/tasks/<codeTaskId> \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

The task progresses through statuses: `dispatched` -> `running` -> `planned` or `implemented` (or `failed`). Tasks never reach a generic `completed` status — they finish as `planned` (planning agent) or `implemented` (execution agent). If all workers are busy, the task enters `queued` status and dispatches automatically when capacity opens.

### Step 3: List your tasks

```bash
curl "http://localhost:8128/code/tasks?limit=10" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

You can filter by status (supports multiple statuses):

```bash
curl "http://localhost:8128/code/tasks?status=running&status=dispatched&limit=10" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

Note: Tasks that have been retried show status `archived` and link to the new task via `retriedFrom`.

### Step 4: Cancel a running task

```bash
curl -X POST http://localhost:8128/code/cancel \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{ "taskId": "<codeTaskId>" }'
```

## Part 4: Advanced Features (10 min)

### Retry a failed task

After a task fails, wait for the cool-off period (5 minutes for failed tasks, immediate for cancelled), then retry with optional additional context:

```bash
curl -X POST http://localhost:8128/code/retry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{
    "taskId": "<failedTaskId>",
    "additionalContext": "The test failure was due to a missing mock. Add a mock for the UserService dependency."
  }'
```

The retry creates a new task linked to the original via the `retriedFrom` field. The original task is archived (status: `archived`).

### Submit feedback on a completed task

After reviewing a completed task, provide follow-up feedback to create a new task:

```bash
curl -X POST http://localhost:8128/code/tasks/<completedTaskId>/feedback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{
    "feedback": "The implementation looks good but please add input validation for the limit query parameter."
  }'
```

### Send a message to a running or ended task

Send mid-session guidance to a running task (queued for next turn) or resume an ended task with new instructions:

```bash
curl -X POST http://localhost:8128/code/tasks/<taskId>/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{
    "message": "Also validate that the limit parameter is between 1 and 100."
  }'
```

Expected response when task is running (message queued):

```json
{ "success": true, "data": { "action": "queued" } }
```

Expected response when task has ended (task resumed):

```json
{ "success": true, "data": { "action": "resumed" } }
```

### Start execution agent implementation

After a planning agent task completes (`status: 'planned'`), you can trigger execution agent implementation:

```bash
curl -X POST http://localhost:8128/code/tasks/<plannedTaskId>/implement \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

Execution agent tasks reuse the original prompt but run in strict execution mode, and the Linear issue must have the `code-task` label (set by the planning agent). The planning task is back-linked to the new execution task via `implementationTaskId`.

### Choose a model

You can specify which AI model to use via the `workerType` parameter:

```bash
curl -X POST http://localhost:8128/code/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{
    "prompt": "Fix the login redirect loop",
    "workerType": "opus"
  }'
```

Available worker types: `auto` (default), `opus`, `sonnet`, `minimax`, `glm`, `qwen`. If the linked Linear issue has a label matching a worker type, that label overrides the request.

### Query GitHub PR summaries

View the list of PRs with recent activity (30-day window):

```bash
curl "http://localhost:8128/code/github-pr-summaries" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

### Query GitHub PR events

View the timeline of GitHub events for your PRs:

```bash
curl "http://localhost:8128/code/github-pr-events?repository=pbuchman/intexuraos&limit=20" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

### Internal: Process code action (from actions-agent)

This is called by the actions-agent after WhatsApp approval:

```bash
curl -X POST http://localhost:8128/internal/code/process \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: <internal-auth-token>" \
  -d '{
    "actionId": "action-123",
    "approvalEventId": "approval-456",
    "userId": "user-789",
    "payload": {
      "prompt": "Fix the login redirect loop on Safari",
      "workerType": "auto",
      "linearIssueId": "INT-500"
    }
  }'
```

## Troubleshooting

| Symptom                               | Cause                                             | Fix                                                                   |
| ------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `worker_not_configured` on submit     | No workers configured or enabled for user         | Add a worker via `POST /code/worker-settings/workers` and enable it   |
| `429` rate limit on submit            | Concurrent, hourly, or cost limit exceeded        | Wait for tasks to complete, or wait for the time window to reset      |
| `409 CONFLICT` on submit              | Deduplication triggered (same prompt in 5 min)    | Wait 5 minutes or modify the prompt                                   |
| `validation_error` on submit          | Prompt contains injection patterns                | Remove system override markers or base64 blobs from the prompt        |
| Worker connectivity test fails        | CF Access credentials wrong or tunnel not running | Verify tunnel is running and credentials match CF dashboard           |
| Task stuck in `dispatched` for >5 min | Worker did not start processing                   | Check orchestrator logs; task will be marked `interrupted` after 30m  |
| `UNAUTHORIZED` on webhook             | HMAC signature mismatch                           | Verify `INTEXURAOS_ORCHESTRATOR_SECRET` matches on both sides         |
| Logs not appearing in UI              | Log chunks failing HMAC validation                | Check `INTEXURAOS_WEBHOOK_VERIFY_SECRET` matches on worker and server |
| `too_soon` error on retry             | Cool-off period not elapsed                       | Wait the specified number of minutes before retrying                  |
| GitHub webhook returning 401          | GitHub webhook secret mismatch                    | Verify `INTEXURAOS_GITHUB_WEBHOOK_SECRET` matches GitHub app settings |
| Task queued but never dispatched      | Workers remain busy past queue TTL                | Check worker status; task expires after 30 min in queue               |

## Exercises

### Exercise 1: Add a second worker

Configure a second worker (e.g., `cloud-vm`) and reorder priority so it becomes the primary:

```bash
# Add second worker
curl -X POST http://localhost:8128/code/worker-settings/workers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "name": "cloud-vm",
    "url": "https://vm.tunnel.example.com",
    "cfAccessClientId": "vm-client-id",
    "cfAccessClientSecret": "vm-client-secret",
    "dispatchSigningSecret": "vm-hmac-secret"
  }'

# Reorder: cloud-vm first
curl -X PUT http://localhost:8128/code/worker-settings/priority \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{ "workerNames": ["cloud-vm", "home-mac"] }'
```

**Solution verification:** `GET /code/worker-settings` should show `cloud-vm` before `home-mac` in the `workers` array.

### Exercise 2: Submit a task with a Linear issue

Submit a task linked to an existing Linear issue:

```bash
curl -X POST http://localhost:8128/code/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "prompt": "Implement the solution described in the Linear issue",
    "linearIssueId": "INT-500"
  }'
```

**Solution verification:** The created task should have `linearIssueId: "INT-500"` and the `linearIssueLabels` field populated from the issue. The Linear issue should transition to "In Progress" when the worker starts.

### Exercise 3: Trigger zombie detection

Use the internal endpoint to scan for zombie tasks:

```bash
curl -X POST http://localhost:8128/internal/code/detect-zombies \
  -H "X-Internal-Auth: <internal-auth-token>"
```

**Solution verification:** The response includes `detected` (count of stale tasks) and `interrupted` (count successfully marked as interrupted).

### Exercise 4: Explore PR event deduplication

Fetch events for a specific PR and observe the deduplication in action:

```bash
curl "http://localhost:8128/code/github-pr-events?repository=pbuchman/intexuraos&pullRequestNumber=42" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

Look at the response:

- Each comment appears **once** even if it was edited (body reflects the latest version).
- The PR description (`body`) appears only on the **most recent** `pull_request` event.
- `synchronize` events (new commits pushed) include an `eventUrl` compare link: `https://github.com/org/repo/compare/before...after`.
- Other events include a direct link to the comment or review on GitHub.

**Solution verification:** If the same PR received 3 commits (3 `synchronize` events) and 1 edited comment, you should see 3 synchronize events (each with a unique compare URL) and 1 comment entry (not 2).
