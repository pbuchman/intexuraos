# VM Lifecycle Worker - Tutorial

Managing VM start/stop schedules and manual operations.

## Prerequisites

- GCP project access with Compute Engine and Cloud Functions permissions
- `gcloud` CLI authenticated
- `INTEXURAOS_INTERNAL_AUTH_TOKEN` value (from Secret Manager)

## Part 1: Understand the Schedule

The VM follows an automated schedule managed by Cloud Scheduler:

| Event | Schedule                      | Timezone       |
| ----- | ----------------------------- | -------------- |
| Start | 7 AM Monday-Friday            | Europe/Warsaw  |
| Stop  | 11 PM daily (including weekends) | Europe/Warsaw |

On weekends, the VM remains stopped because only the stop scheduler runs daily. The start scheduler runs only on weekdays.

## Part 2: Start the VM Manually

To start the VM outside the scheduled time:

```bash
curl -X POST https://FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
```

**Successful response (200):**

```json
{
  "success": true,
  "message": "VM started and healthy",
  "startupDurationMs": 45000
}
```

**Already running (200):**

```json
{
  "success": true,
  "message": "VM already running and healthy",
  "startupDurationMs": 2000
}
```

**Startup failed (503):**

```json
{
  "success": false,
  "message": "VM started but health check timed out after 3 minutes",
  "startupDurationMs": 182000
}
```

## Part 3: Stop the VM Manually

To trigger a graceful shutdown:

```bash
curl -X POST https://STOP_FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
```

**Response (200):**

```json
{
  "success": true,
  "message": "VM shutdown initiated",
  "runningTasksAtShutdown": 2
}
```

The `runningTasksAtShutdown` field tells you how many tasks were still running when the shutdown started. The function waited for them to complete (or until the 10-minute grace period expired) before issuing the stop command.

## Part 4: Monitor Function Execution

View Cloud Function logs to understand what happened:

```bash
# Start function logs
gcloud functions logs read intexuraos-vm-start-dev \
  --region=europe-central2 \
  --limit=15

# Stop function logs
gcloud functions logs read intexuraos-vm-stop-dev \
  --region=europe-central2 \
  --limit=15
```

**Key log messages for startVm:**

| Message                                | Meaning                                   |
| -------------------------------------- | ----------------------------------------- |
| "Starting VM instance"                 | Function invoked                          |
| "Current VM status"                    | Fetched VM state from Compute API         |
| "VM running but unhealthy, restarting" | Running VM failed health check, restarting |
| "Start operation initiated"            | GCE start command sent                    |
| "VM reached RUNNING state"             | VM is in RUNNING state                    |
| "VM health check passed"              | Application is ready                      |
| "Health check timed out"              | 3-minute timeout reached without ready    |

**Key log messages for stopVm:**

| Message                                      | Meaning                                  |
| -------------------------------------------- | ---------------------------------------- |
| "Initiating VM shutdown"                     | Function invoked                         |
| "Orchestrator acknowledged shutdown"         | Orchestrator received shutdown notice    |
| "Waiting for running tasks to complete"      | Tasks still running, waiting             |
| "All tasks completed or orchestrator shutting down" | Safe to stop                      |
| "Orchestrator unresponsive, proceeding"      | 2-minute timeout, forced shutdown        |
| "Grace period expired"                       | 10-minute wait ended, forcing stop       |
| "Stop operation initiated"                   | GCE stop command sent                    |

## Part 5: Check VM Status Directly

Verify the VM's state in GCP:

```bash
gcloud compute instances describe cc-vm \
  --zone=europe-central2-a \
  --format='get(status)'
```

Expected values: `RUNNING`, `STAGING`, `STOPPING`, `TERMINATED`.

## Part 6: Check Cloud Scheduler Jobs

View the scheduler job status:

```bash
# List jobs
gcloud scheduler jobs list --location=europe-central2

# Describe the start job
gcloud scheduler jobs describe intexuraos-vm-start-dev \
  --location=europe-central2
```

To manually trigger the scheduler (equivalent to waiting for the scheduled time):

```bash
gcloud scheduler jobs run intexuraos-vm-start-dev \
  --location=europe-central2
```

## Troubleshooting

| Issue                                    | Cause                              | Solution                                    |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------- |
| 401 Unauthorized                         | Missing or wrong auth token        | Verify `X-Internal-Auth` header value       |
| 405 Method not allowed                   | Used GET instead of POST           | Send a POST request                         |
| "VM started but health check timed out"  | Application did not report ready   | SSH into VM and check application logs      |
| "Failed to start VM"                     | Compute API error                  | Check IAM permissions and quotas            |
| VM does not start on schedule            | Scheduler job paused               | Resume the scheduler job in GCP Console     |
| Shutdown takes > 10 minutes              | Tasks exceeded grace period        | Check orchestrator for stuck tasks          |
| "Orchestrator unresponsive"              | Application crashed before stop    | Forced shutdown proceeds; investigate later |
