# vm-lifecycle -- Agent Interface

> Machine-readable interface definition for AI agents interacting with vm-lifecycle.

---

## Identity

| Field    | Value                                                    |
| -------- | -------------------------------------------------------- |
| **Name** | vm-lifecycle                                             |
| **Role** | VM Start/Stop Controller                                 |
| **Goal** | Start and stop a GCE VM on schedule with health checks   |

---

## Capabilities

### Functions

| Function  | Type | Entry Point | Purpose                                    |
| --------- | ---- | ----------- | ------------------------------------------ |
| startVm   | HTTP | `startVm`   | Start VM and verify application health     |
| stopVm    | HTTP | `stopVm`    | Gracefully stop VM after tasks complete    |

### HTTP Endpoints

| Method | Function | Purpose                                      | Auth                     |
| ------ | -------- | -------------------------------------------- | ------------------------ |
| POST   | startVm  | Start VM, wait for health check              | `X-Internal-Auth` Bearer |
| POST   | stopVm   | Notify orchestrator, wait for tasks, stop VM | `X-Internal-Auth` Bearer |

### Types

```typescript
interface StartVmResult {
  success: boolean;
  message: string;
  startupDurationMs?: number;
}

interface StopVmResult {
  success: boolean;
  message: string;
  runningTasksAtShutdown?: number;
}

interface VM_CONFIG {
  PROJECT_ID: string;
  ZONE: string;
  INSTANCE_NAME: string;
  HEALTH_ENDPOINT: string;
  SHUTDOWN_ENDPOINT: string;
  HEALTH_POLL_INTERVAL_MS: 10_000;
  HEALTH_POLL_TIMEOUT_MS: 180_000;
  SHUTDOWN_GRACE_PERIOD_MS: 600_000;
  SHUTDOWN_POLL_INTERVAL_MS: 30_000;
  ORCHESTRATOR_UNRESPONSIVE_TIMEOUT_MS: 120_000;
}
```

---

## Constraints

| Rule                     | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| **Auth required**        | Both endpoints require `X-Internal-Auth: Bearer <token>`     |
| **POST only**            | Both endpoints reject non-POST methods with 405              |
| **Single VM**            | Manages one specific instance defined in config              |
| **Health check**         | Startup only succeeds if health endpoint returns `ready`     |
| **Graceful shutdown**    | Stop waits up to 10 min for running tasks before stopping    |
| **Forced fallback**      | If orchestrator is unresponsive for 2 min, stop proceeds     |

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

### Check if VM is running (via gcloud)

```bash
gcloud compute instances describe cc-vm \
  --zone=europe-central2-a \
  --format='get(status)'
```

---

## Schedule

| Action | Cron           | Timezone      | Days         |
| ------ | -------------- | ------------- | ------------ |
| Start  | `0 7 * * 1-5`  | Europe/Warsaw | Mon-Fri      |
| Stop   | `0 23 * * *`   | Europe/Warsaw | Daily        |

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

| Variable                         | Required | Default                                         | Description                |
| -------------------------------- | -------- | ----------------------------------------------- | -------------------------- |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | -                                               | Bearer token for auth      |
| `INTEXURAOS_GCP_PROJECT_ID`     | No       | `intexuraos`                                    | GCP project ID             |
| `INTEXURAOS_VM_ZONE`            | No       | `europe-central2-a`                             | GCE zone                   |
| `INTEXURAOS_VM_INSTANCE_NAME`   | No       | `cc-vm`                                         | VM instance name           |
| `INTEXURAOS_VM_HEALTH_URL`      | No       | `https://cc-vm.intexuraos.cloud/health`         | Health check URL           |
| `INTEXURAOS_VM_SHUTDOWN_URL`    | No       | `https://cc-vm.intexuraos.cloud/admin/shutdown` | Shutdown notification URL  |

---

**Last updated:** 2026-02-08
