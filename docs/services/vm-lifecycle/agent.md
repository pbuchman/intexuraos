# vm-lifecycle -- Agent Interface

> Machine-readable interface definition for AI agents interacting with vm-lifecycle.

---

## Identity

| Field    | Value                                                  |
| -------- | ------------------------------------------------------ |
| **Name** | vm-lifecycle                                           |
| **Role** | VM Start/Stop Controller                               |
| **Goal** | Start and stop a GCE VM on schedule with health checks |

---

## Capabilities

### Start VM

**Endpoint:** `POST /` (Cloud Function: `startVm`)

**When to use:** When you need to bring up the GCE VM and confirm the application is ready to accept work. Use before sending tasks to the orchestrator. Safe to call if the VM is already running — it returns immediately if healthy.

**Input Schema:**

```typescript
interface StartVmInput {
  // No body required — configuration is fully environment-driven
}
```

**Output Schema:**

```typescript
interface StartVmResult {
  success: boolean;
  message: string;
  startupDurationMs?: number; // Present on all success cases; absent only when Compute API throws
}
```

**Example:**

```json
// Request: POST / (no body)

// Response 200 — started fresh
{
  "success": true,
  "message": "VM started and healthy",
  "startupDurationMs": 45000
}

// Response 200 — already running
{
  "success": true,
  "message": "VM already running and healthy",
  "startupDurationMs": 2000
}

// Response 503 — health check timed out
{
  "success": false,
  "message": "VM started but health check timed out after 3 minutes",
  "startupDurationMs": 182000
}
```

### Stop VM

**Endpoint:** `POST /` (Cloud Function: `stopVm`)

**When to use:** When you need to shut down the GCE VM gracefully. The function notifies the orchestrator first, waits for running tasks to complete (up to 10 minutes), then issues the stop command. Safe to call if the VM is already stopped.

**Input Schema:**

```typescript
interface StopVmInput {
  // No body required — configuration is fully environment-driven
}
```

**Output Schema:**

```typescript
interface StopVmResult {
  success: boolean;
  message: string;
  runningTasksAtShutdown?: number; // Number of tasks running when shutdown began
}
```

**Example:**

```json
// Request: POST / (no body)

// Response 200 — shutdown initiated
{
  "success": true,
  "message": "VM shutdown initiated",
  "runningTasksAtShutdown": 2
}

// Response 200 — already stopped
{
  "success": true,
  "message": "VM already in TERMINATED state"
}

// Response 503 — Compute API failure
{
  "success": false,
  "message": "Failed to stop VM: <error details>"
}
```

---

## Constraints

**Do NOT:**

- Call without `X-Internal-Auth: Bearer <token>` header — both functions return 401
- Use GET or any non-POST method — returns 405
- Expect synchronous completion of the VM stop — the function issues the stop command but does not wait for `TERMINATED`
- Rely on sub-120-second execution — health polling alone can take up to 3 minutes

**Requires:**

- `INTEXURAOS_INTERNAL_AUTH_TOKEN` configured in the function's Secret Manager binding
- GCE Compute API access from the `intexuraos-functions-{env}` service account
- The VM's health endpoint to return `{ "status": "ready" }` for startup to succeed

---

## Usage Patterns

### Start the VM

```bash
curl -X POST https://VM_START_FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
```

**Response:** `{ "success": true, "message": "VM started and healthy", "startupDurationMs": 45000 }`

### Stop the VM

```bash
curl -X POST https://VM_STOP_FUNCTION_URL \
  -H "X-Internal-Auth: Bearer YOUR_TOKEN"
```

**Response:** `{ "success": true, "message": "VM shutdown initiated", "runningTasksAtShutdown": 0 }`

### Check VM state directly (via gcloud)

```bash
gcloud compute instances describe cc-vm \
  --zone=europe-central2-a \
  --format='get(status)'
```

---

## Error Handling

| HTTP Status | Condition                                      | Recovery Action                                   |
| ----------- | ---------------------------------------------- | ------------------------------------------------- |
| 200         | Success (start or stop)                        | No action needed                                  |
| 401         | Missing or wrong `X-Internal-Auth` token       | Verify token value matches Secret Manager         |
| 405         | Non-POST method used                           | Send POST request                                 |
| 503         | VM operation failed (health timeout, API error) | Check Cloud Function logs; inspect VM state       |

---

## Schedule

| Action | Cron          | Timezone      | Days    |
| ------ | ------------- | ------------- | ------- |
| Start  | `0 7 * * 1-5` | Europe/Warsaw | Mon-Fri |
| Stop   | `0 23 * * *`  | Europe/Warsaw | Daily   |

---

## Dependencies

| Service/Resource  | Direction | Purpose                            |
| ----------------- | --------- | ---------------------------------- |
| GCP Compute API   | Outbound  | VM instance get, start, stop       |
| Orchestrator (VM) | Outbound  | Shutdown notification, task status |
| Health endpoint   | Outbound  | Application readiness check        |
| Cloud Scheduler   | Inbound   | Automated start/stop triggers      |

---

## Environment Variables

| Variable                         | Required | Default                                         | Description               |
| -------------------------------- | -------- | ----------------------------------------------- | ------------------------- |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | -                                               | Bearer token for auth     |
| `INTEXURAOS_GCP_PROJECT_ID`      | No       | `intexuraos`                                    | GCP project ID            |
| `INTEXURAOS_VM_ZONE`             | No       | `europe-central2-a`                             | GCE zone                  |
| `INTEXURAOS_VM_INSTANCE_NAME`    | No       | `cc-vm`                                         | VM instance name          |
| `INTEXURAOS_VM_HEALTH_URL`       | No       | `https://cc-vm.intexuraos.cloud/health`         | Health check URL          |
| `INTEXURAOS_VM_SHUTDOWN_URL`     | No       | `https://cc-vm.intexuraos.cloud/admin/shutdown` | Shutdown notification URL |

---

**Last updated:** 2026-02-19
