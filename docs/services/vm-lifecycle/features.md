# VM Lifecycle Worker

Cloud Functions for starting and stopping a GCE VM instance with health checks and graceful shutdown.

## The Problem

IntexuraOS runs long-running tasks on a dedicated GCE VM. The VM should not run 24/7:

1. **Cost waste** - An idle VM during nights and weekends costs money
2. **Manual start/stop** - Operators forget to start or stop the VM
3. **Ungraceful shutdown** - Stopping a VM mid-task can lose work
4. **No health verification** - Starting a VM does not guarantee the application is ready

## How It Helps

VM-lifecycle provides two HTTP-triggered Cloud Functions:

1. **startVm** - Starts the VM, waits for the RUNNING state, and polls a health endpoint until the application reports ready
2. **stopVm** - Notifies the orchestrator of pending shutdown, waits for running tasks to complete, then stops the VM

Cloud Scheduler invokes these functions on a weekday schedule: start at 7 AM and stop at 11 PM (Europe/Warsaw timezone).

## Key Features

**Scheduled start/stop:**

- Start VM: Monday-Friday at 7 AM (Europe/Warsaw)
- Stop VM: Daily at 11 PM (Europe/Warsaw)
- Retries: 3 attempts with exponential backoff

**Health-aware startup:**

- After the VM reaches RUNNING state, the function polls a health endpoint
- The health endpoint must return `{ "status": "ready" }` for the VM to be considered healthy
- Timeout: 3 minutes of polling with 10-second intervals
- If the VM is already running but unhealthy, it is restarted automatically

**Graceful shutdown:**

- Before stopping, the function calls the orchestrator's shutdown endpoint
- The orchestrator responds with the number of running tasks
- If tasks are running, the function waits up to 10 minutes for them to complete
- If the orchestrator is unresponsive for 2 minutes, the function proceeds with forced shutdown
- Polling interval during grace period: 30 seconds

**Internal auth:**

- Both functions require `X-Internal-Auth` header with a Bearer token
- The token is stored in Secret Manager as `INTEXURAOS_INTERNAL_AUTH_TOKEN`

## Use Cases

### Scheduled weekday start

**User Goal:** VM automatically starts before the workday begins.

**Steps:**

1. Cloud Scheduler sends a POST request to the startVm function at 7 AM Mon-Fri
2. The function checks the VM's current state
3. If RUNNING and healthy, returns immediately
4. If RUNNING but unhealthy, stops the VM, waits for TERMINATED, then starts it
5. If not RUNNING, sends a start command
6. Polls the health endpoint until the application is ready or timeout

### Scheduled nightly stop

**User Goal:** VM shuts down after business hours to save costs.

**Steps:**

1. Cloud Scheduler sends a POST request to the stopVm function at 11 PM daily
2. The function checks the VM's current state
3. If not RUNNING, returns immediately (already stopped)
4. If RUNNING, sends a shutdown notification to the orchestrator
5. Waits for running tasks to complete (up to 10 minutes)
6. Sends a stop command to the VM
7. Returns the number of tasks that were running at shutdown time

### Manual start via HTTP

**User Goal:** Start the VM outside the normal schedule.

**Steps:**

1. Send a POST request to the startVm function URL with the auth header
2. The function follows the same health-check flow as scheduled starts
3. Returns success with startup duration or failure with error message

## Key Benefits

**Cost savings** - VM runs only during business hours (Mon-Fri 7 AM to 11 PM)

**Zero data loss** - Graceful shutdown waits for tasks to complete before stopping

**Self-healing** - Unhealthy running VMs are automatically restarted

**Observable** - Startup duration and running task counts are logged and returned

## Limitations

**Single VM** - The worker manages one specific VM instance. Multi-VM support would require parameterization.

**Fixed schedule** - The start/stop schedule is hardcoded in Terraform. Changing it requires a Terraform apply.

**Health check dependency** - Startup success depends on the VM's health endpoint. If the endpoint is misconfigured, the function reports failure even if the VM is actually running.

**No weekend support** - The VM does not start on weekends. Manual intervention is needed for weekend work.
