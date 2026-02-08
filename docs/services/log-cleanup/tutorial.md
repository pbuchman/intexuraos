# Log Cleanup Worker - Tutorial

Scheduled log retention enforcement for IntexuraOS task execution logs.

## Prerequisites

- GCP project access with Pub/Sub publish permissions
- `gcloud` CLI authenticated
- code-agent service running (target of cleanup API calls)

## Part 1: Understand the Flow

The log-cleanup worker does not run on its own schedule. Cloud Scheduler publishes a Pub/Sub message, and the Cloud Function reacts to it.

```
Cloud Scheduler (3 AM UTC)
    --> Pub/Sub topic (intexuraos-log-cleanup-dev)
        --> Cloud Function (cleanupLogs)
            --> POST code-agent/internal/tasks/cleanup-logs
                --> Firestore log deletion
```

## Part 2: Trigger a Manual Cleanup

To test cleanup outside the schedule, publish a message to the Pub/Sub topic:

```bash
gcloud pubsub topics publish intexuraos-log-cleanup-dev \
  --message='{"trigger":"manual"}'
```

The function ignores the message body. Any valid Pub/Sub message triggers the cleanup.

## Part 3: Monitor Execution

Check Cloud Logging for the function's output:

```bash
gcloud functions logs read intexuraos-log-cleanup-dev \
  --region=europe-central2 \
  --limit=20
```

Look for these log entries:

| Log Message                               | Meaning                                   |
| ----------------------------------------- | ----------------------------------------- |
| "Log cleanup triggered by Pub/Sub"        | Function received the event               |
| "Starting log cleanup via code-agent API" | About to call code-agent                  |
| "Log cleanup completed successfully"      | Cleanup finished with metrics             |
| "Log cleanup failed"                      | Cleanup encountered an error              |

## Part 4: Configure Retention Parameters

Set optional environment variables in Terraform to control cleanup behavior:

| Variable                         | Effect                                    |
| -------------------------------- | ----------------------------------------- |
| `INTEXURAOS_LOG_RETENTION_DAYS`  | How many days of logs to keep             |
| `INTEXURAOS_LOG_BATCH_SIZE`      | How many logs to delete per batch         |
| `INTEXURAOS_LOG_TASKS_PER_RUN`   | Cap on tasks processed per run            |

These values pass through to code-agent. When unset, code-agent uses its own defaults.

## Part 5: Local Development

Run the worker locally with the Cloud Functions Framework:

```bash
cd workers/log-cleanup
pnpm dev
```

The function registers as a CloudEvent handler. To simulate a Pub/Sub event locally, use the Functions Framework's built-in event format.

## Troubleshooting

| Error                                        | Cause                             | Solution                          |
| -------------------------------------------- | --------------------------------- | --------------------------------- |
| "INTEXURAOS_CODE_AGENT_URL is required"      | Missing env var                   | Set the variable in Terraform     |
| "INTEXURAOS_INTERNAL_AUTH_TOKEN is required" | Missing auth secret               | Verify Secret Manager access      |
| "API returned 503"                           | code-agent is down                | Check code-agent Cloud Run status |
| "API returned success but no data"           | code-agent returned empty body    | Check code-agent cleanup endpoint |
| Function never runs                          | Scheduler paused or misconfigured | Check Cloud Scheduler job status  |
