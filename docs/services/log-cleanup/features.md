# Log Cleanup Worker

Automated retention-based deletion of old execution logs via scheduled Cloud Function.

## The Problem

IntexuraOS tasks generate execution logs stored in Firestore. Without periodic cleanup:

1. **Storage costs grow unbounded** - Logs accumulate indefinitely
2. **Query performance degrades** - Large collections slow down reads
3. **Manual cleanup is error-prone** - Human operators forget or miss runs

## How It Helps

Log-cleanup runs as a scheduled Cloud Function that triggers the code-agent's internal cleanup endpoint daily. It enforces a configurable retention policy (default 90 days) and reports deletion metrics.

## Key Features

**Scheduled execution:**

- Runs daily at 3 AM UTC via Cloud Scheduler
- Triggered by Pub/Sub message (not HTTP)
- Automatic retry on failure (1 retry)

**Configurable retention:**

- `INTEXURAOS_LOG_RETENTION_DAYS` - Days to keep logs (default: server-side)
- `INTEXURAOS_LOG_BATCH_SIZE` - Number of logs per deletion batch
- `INTEXURAOS_LOG_TASKS_PER_RUN` - Maximum tasks to process per execution

**Structured result reporting:**

- Tasks processed count
- Tasks failed count
- Logs deleted count
- Execution duration in milliseconds

## Use Cases

### Daily automated cleanup

**User Goal:** Keep log storage under control without manual intervention.

**Steps:**

1. Cloud Scheduler publishes a message to the `intexuraos-log-cleanup` Pub/Sub topic at 3 AM UTC
2. The Cloud Function receives the event and calls `cleanupOldLogs()`
3. The function sends a POST request to `code-agent/internal/tasks/cleanup-logs` with retention parameters
4. Code-agent deletes logs older than the retention period and returns metrics
5. The function logs the result (tasks processed, logs deleted, duration)

### Manual trigger for testing

**User Goal:** Verify cleanup behavior before relying on the schedule.

**Steps:**

1. Publish a message to the `intexuraos-log-cleanup` Pub/Sub topic manually via GCP Console or `gcloud`
2. The function executes the same cleanup flow
3. Check Cloud Logging for the result metrics

## Key Benefits

**Zero operator burden** - Runs unattended on a fixed schedule

**Cost control** - Prevents unbounded Firestore storage growth

**Observability** - Structured logs report exactly how many logs were deleted and how long it took

## Limitations

**Delegated deletion** - The worker does not delete logs directly; it calls code-agent's internal API. If code-agent is down, cleanup fails.

**Single retry** - Cloud Scheduler retries once on failure. Persistent code-agent outages require manual intervention.

**No alerting** - Failed cleanups log errors but do not trigger external notifications.
