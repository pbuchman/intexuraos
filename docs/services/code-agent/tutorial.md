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
    "lastTestedAt": "2026-03-22T10:30:00.000Z"
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

The task progresses through statuses: `queued` -> `dispatched` -> `running` -> `planned` or `implemented` or `reviewed` (or `failed`). Tasks never reach a generic `completed` status — they finish as `planned` (planning agent), `implemented` (execution agent), or `reviewed` (review agent). If all workers are busy, the task enters `queued` status and dispatches automatically when capacity opens.

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

## Part 4: Merge Queue (10 min)

### Step 1: List available branches

```bash
curl "http://localhost:8128/code/merge-queue/branches" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

The response shows available base branches. Branches marked with `blocked: true` (such as `main`) cannot be used as merge queue targets.

### Step 2: Create a merge queue watch

```bash
curl -X POST http://localhost:8128/code/merge-queue/watch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{
    "owner": "pbuchman",
    "repo": "intexuraos",
    "baseBranch": "development"
  }'
```

Expected response:

```json
{
  "success": true,
  "data": {
    "watchId": "watch-uuid-123",
    "status": "active"
  }
}
```

### Step 3: Check watch status and merged PRs

```bash
curl "http://localhost:8128/code/merge-queue/watches" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

Each watch shows which PRs have been merged, which were skipped (with reasons like `merge_conflict`, `checks_failing`, or `checks_pending`), and the current watch status (`active`, `drained`, or `cancelled`).

### Step 4: View eligible PRs

```bash
curl "http://localhost:8128/code/merge-queue/prs" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

### Step 5: Cancel a watch

```bash
curl -X DELETE "http://localhost:8128/code/merge-queue/watch/<watchId>" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

## Part 5: Advanced Features (10 min)

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

The retry creates a new task linked to the original via the `retriedFrom` field. The original task is archived (status: `archived`). If the original task had an open PR branch, the new task inherits it so work is not lost.

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

Available worker types: `auto` (default), `opus`, `sonnet`, `minimax`, `glm`, `qwen`, `kimi`. If the linked Linear issue has a label matching a worker type, that label overrides the request.

### Query the GitHub event decision log

View the decision log showing how each webhook event was evaluated:

```bash
curl "http://localhost:8128/code/github-event-log?limit=20" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

Each entry shows the event type, action, repository, and the evaluation outcome (dispatch, skip, or request_review). For entries decided by the GitHub Agent (LLM triage), the associated `event_decisions` record includes the model's reasoning and tool calls.

### Inspect a raw webhook payload

Expand any event log entry to view the full GitHub webhook payload:

```bash
curl "http://localhost:8128/code/github-event-log/<entryId>/payload" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

### Hydrate event log rows with full detail

Fetch full audit and decision data for specific log entries:

```bash
curl -X POST http://localhost:8128/code/github-event-log/rows \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{ "ids": ["entry-uuid-1", "entry-uuid-2"] }'
```

The response includes the full GitHub webhook payload (`audit`) and the LLM decision record (`decision`) with reasoning, tool calls, and cost.

### Query GitHub PR summaries

View the list of PRs with recent activity (30-day window):

```bash
curl "http://localhost:8128/code/github-pr-summaries" \
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

| Symptom                               | Cause                                             | Fix                                                                              |
| ------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `worker_not_configured` on submit     | No workers configured or enabled for user         | Add a worker via `POST /code/worker-settings/workers` and enable it              |
| `429` rate limit on submit            | Concurrent, hourly, or cost limit exceeded        | Wait for tasks to complete, or wait for the time window to reset                 |
| `409 CONFLICT` on submit              | Deduplication triggered (same prompt in window)   | Wait or modify the prompt                                                        |
| `validation_error` on submit          | Prompt contains injection patterns                | Remove system override markers or base64 blobs from the prompt                   |
| Worker connectivity test fails        | CF Access credentials wrong or tunnel not running | Verify tunnel is running and credentials match CF dashboard                      |
| Task stuck in `dispatched` for >5 min | Worker did not start processing                   | Check orchestrator logs; task will be marked `interrupted` after 30m             |
| `UNAUTHORIZED` on webhook             | HMAC signature mismatch                           | Verify `INTEXURAOS_ORCHESTRATOR_SECRET` matches on both sides                    |
| Logs not appearing in UI              | Log chunks failing HMAC validation                | Check `INTEXURAOS_WEBHOOK_VERIFY_SECRET` matches on worker and server            |
| `too_soon` error on retry             | Cool-off period not elapsed                       | Wait the specified number of minutes before retrying                             |
| GitHub webhook returning 401          | GitHub webhook secret mismatch                    | Verify `INTEXURAOS_GITHUB_WEBHOOK_SECRET` matches GitHub app settings            |
| Task queued but never dispatched      | Workers remain busy past queue TTL                | Check worker status; task expires after 24 hours in queue                        |
| Review task not dispatching           | Workers at capacity                               | Review tasks now queue like regular tasks — they dispatch when a worker frees up |
| Merge queue watch not merging PRs     | CI checks pending or PRs have conflicts           | Check PR status on GitHub; the queue merges one PR per tick when checks pass     |
| Cannot create watch for `main`        | Main branch is blocked as merge queue target      | Use `development` or another non-blocked branch as the base branch               |

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

**Solution verification:** The created task should have `linearIssueId: "INT-500"` and the Linear issue should transition to "In Progress" when the worker starts.

### Exercise 3: Create a merge queue watch

Create a watch and observe the merge queue processing PRs:

```bash
# Create watch
curl -X POST http://localhost:8128/code/merge-queue/watch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "owner": "your-org",
    "repo": "your-repo",
    "baseBranch": "development"
  }'

# Check status after a few scheduler ticks
curl "http://localhost:8128/code/merge-queue/watches" \
  -H "Authorization: Bearer <jwt>"
```

**Solution verification:** After Cloud Scheduler triggers a few ticks, the watch should show merged PRs in the `mergedPrs` array and any skipped PRs with reasons in `skippedPrs`.

### Exercise 4: Trigger zombie detection

Use the internal endpoint to scan for zombie tasks:

```bash
curl -X POST http://localhost:8128/internal/code/detect-zombies \
  -H "X-Internal-Auth: <internal-auth-token>"
```

**Solution verification:** The response includes `detected` (count of stale tasks) and `interrupted` (count successfully marked as interrupted).

### Exercise 5: Explore the event decision log

Fetch the GitHub event decision log and inspect a raw payload:

```bash
# List recent events
curl "http://localhost:8128/code/github-event-log?limit=10" \
  -H "Authorization: Bearer <your-auth0-jwt>"

# Pick an entry ID and view its raw webhook payload
curl "http://localhost:8128/code/github-event-log/<entryId>/payload" \
  -H "Authorization: Bearer <your-auth0-jwt>"
```

**Solution verification:** The payload endpoint returns the full GitHub webhook JSON for the selected event, including all nested fields that were sent by GitHub.

### Exercise 6: Set the default review worker type

Configure which model is used for automated code reviews when the GitHub Agent does not specify one:

```bash
curl -X PATCH http://localhost:8128/code/worker-settings/default-review-worker-type \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth0-jwt>" \
  -d '{ "workerType": "sonnet" }'
```

**Solution verification:** `GET /code/worker-settings` should show `defaultReviewWorkerType: "sonnet"`.
