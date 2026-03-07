# VM Lifecycle Worker -- Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** GCP project access, `gcloud` CLI authenticated, `INTEXURAOS_INTERNAL_AUTH_TOKEN` value
> **You will learn:** How to start and stop the coding VM manually, monitor function execution, and troubleshoot common issues

---

## What You Will Build

A working understanding of:

- The automated weekday schedule that manages the VM
- How to trigger manual start and stop operations
- How to read function logs to diagnose problems
- How to verify VM state and scheduler status

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS GCP project (`intexuraos-dev-pbuchman`)
- [ ] `gcloud` CLI authenticated with appropriate IAM permissions
- [ ] The `INTEXURAOS_INTERNAL_AUTH_TOKEN` value (from Secret Manager or environment config)

---

## Part 1: Understand the Schedule (2 minutes)

The VM follows an automated schedule managed by Cloud Scheduler:

| Event | Schedule                            | Timezone      |
| ----- | ----------------------------------- | ------------- |
| Start | 7:00 AM Monday through Friday       | Europe/Warsaw |
| Stop  | 11:00 PM daily (including weekends) | Europe/Warsaw |

On weekends, the VM remains stopped because only the stop scheduler runs daily. The start scheduler runs only on weekdays.

### What Just Happened?

Cloud Scheduler sends a POST request to the respective Cloud Function at the scheduled time. The function handles all the complexity -- health checks, task draining, error recovery -- so the scheduler only needs to fire and forget.

---

## Part 2: Start the VM Manually (5 minutes)

To start the VM outside the scheduled time (for example, on a weekend):

### Step 2.1: Send the Start Request

```bash
curl -X POST https://FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
```

Replace `FUNCTION_URL` with the Cloud Function URL from Terraform output `function_vm_start_uri`.

### Step 2.2: Read the Response

**Successful start (200):**

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

**Health check failed (503):**

```json
{
  "success": false,
  "message": "VM started but health check timed out after 3 minutes",
  "startupDurationMs": 182000
}
```

**Checkpoint:** A `startupDurationMs` value under 60000 (60 seconds) is typical for a warm start. Cold starts can take 30-90 seconds depending on the application initialization time.

---

## Part 3: Stop the VM Manually (5 minutes)

To trigger a graceful shutdown:

### Step 3.1: Send the Stop Request

```bash
curl -X POST https://STOP_FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
```

### Step 3.2: Read the Response

**Shutdown initiated (200):**

```json
{
  "success": true,
  "message": "VM shutdown initiated",
  "runningTasksAtShutdown": 2
}
```

The `runningTasksAtShutdown` field reports how many coding tasks were still running when the shutdown started. The function waited for them to complete (or until the 10-minute grace period expired) before issuing the stop command.

**Already stopped (200):**

```json
{
  "success": true,
  "message": "VM already in TERMINATED state"
}
```

**Checkpoint:** If `runningTasksAtShutdown` is greater than 0, the function waited for those tasks before stopping. Check the function logs to see the wait duration.

---

## Part 4: Monitor Function Execution (5 minutes)

View Cloud Function logs to understand what happened during a start or stop operation.

### Step 4.1: Read Start Function Logs

```bash
gcloud functions logs read intexuraos-vm-start-dev \
  --region=europe-central2 \
  --limit=15
```

**Key log messages:**

| Message                                | Meaning                                    |
| -------------------------------------- | ------------------------------------------ |
| "Starting VM instance"                 | Function invoked                           |
| "Current VM status"                    | Fetched VM state from Compute API          |
| "VM running but unhealthy, restarting" | Running VM failed health check, restarting |
| "Start operation initiated"            | GCE start command sent                     |
| "VM reached RUNNING state"             | VM transitioned to RUNNING                 |
| "VM health check passed"               | Application reported ready                 |
| "Health check timed out"               | 3-minute timeout reached without ready     |

### Step 4.2: Read Stop Function Logs

```bash
gcloud functions logs read intexuraos-vm-stop-dev \
  --region=europe-central2 \
  --limit=15
```

**Key log messages:**

| Message                                             | Meaning                               |
| --------------------------------------------------- | ------------------------------------- |
| "Initiating VM shutdown"                            | Function invoked                      |
| "Orchestrator acknowledged shutdown"                | Orchestrator received shutdown notice |
| "Waiting for running tasks to complete"             | Tasks still running, entering wait    |
| "All tasks completed or orchestrator shutting down" | Safe to stop                          |
| "Orchestrator unresponsive, proceeding"             | 2-minute timeout, forced shutdown     |
| "Grace period expired"                              | 10-minute wait ended, forcing stop    |
| "Stop operation initiated"                          | GCE stop command sent                 |

---

## Part 5: Check VM Status Directly (2 minutes)

Verify the VM's current state in GCP:

```bash
gcloud compute instances describe cc-vm \
  --zone=europe-central2-a \
  --format='get(status)'
```

Expected values: `RUNNING`, `STAGING`, `STOPPING`, `TERMINATED`.

---

## Part 6: Check Cloud Scheduler Jobs (2 minutes)

View the scheduler job status:

```bash
# List all scheduler jobs
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

---

## Troubleshooting

| Issue                                   | Cause                            | Solution                                    |
| --------------------------------------- | -------------------------------- | ------------------------------------------- |
| 401 Unauthorized                        | Missing or wrong auth token      | Verify `X-Internal-Auth` header value       |
| 405 Method not allowed                  | Used GET instead of POST         | Send a POST request                         |
| "VM started but health check timed out" | Application did not report ready | SSH into VM and check application logs      |
| "Failed to start VM"                    | Compute API error                | Check IAM permissions and quotas            |
| VM does not start on schedule           | Scheduler job paused             | Resume the scheduler job in GCP Console     |
| Shutdown takes longer than 10 minutes   | Tasks exceeded grace period      | Check orchestrator for stuck tasks          |
| "Orchestrator unresponsive"             | Application crashed before stop  | Forced shutdown proceeds; investigate later |

---

## Next Steps

Now that you understand the basics:

1. Read the [Technical Reference](technical.md) for detailed flow diagrams and timing constants
2. Review the [Agent Interface](agent.md) for programmatic integration patterns
3. Check [Technical Debt](technical-debt.md) for known issues and planned improvements

---

## Exercises

Test your understanding:

1. **Easy:** Start the VM manually and verify it reports healthy
2. **Medium:** Stop the VM while a coding task is running and observe the grace period behavior in the logs
3. **Hard:** Modify the Cloud Scheduler start time to 8 AM via Terraform and verify the change takes effect

<details>
<summary>Solutions</summary>

### Exercise 1: Manual Start

```bash
curl -X POST https://FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
# Expect: { "success": true, "message": "VM started and healthy" }
```

### Exercise 2: Graceful Shutdown with Running Tasks

```bash
# 1. Start a coding task via the web UI or API
# 2. Immediately trigger the stop function
curl -X POST https://STOP_FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
# 3. Check logs for "Waiting for running tasks to complete"
gcloud functions logs read intexuraos-vm-stop-dev \
  --region=europe-central2 --limit=20
```

### Exercise 3: Change Scheduler Time

Edit `terraform/environments/dev/main.tf`, find the `google_cloud_scheduler_job.vm_start` resource, change `schedule = "0 7 * * 1-5"` to `schedule = "0 8 * * 1-5"`, then run `terraform apply`.

</details>
