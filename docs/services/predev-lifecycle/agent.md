# predev-lifecycle -- Agent Interface

> Machine-readable interface definition for AI agents interacting with predev-lifecycle.

---

## Identity

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| **Name** | predev-lifecycle                                               |
| **Role** | Pre-Dev Environment Lifecycle Manager                          |
| **Goal** | Manage a scale-to-zero GCP Spot VM for cloud-based development |

---

## Capabilities

### Functions

This worker deploys four Cloud Functions from a single codebase:

| Function    | Type       | Purpose                                     |
| ----------- | ---------- | ------------------------------------------- |
| gateway     | HTTP       | Proxy requests to VM or show Starting page  |
| webhook     | HTTP       | Receive GitHub push events and update state |
| idleCheck   | CloudEvent | Shut down VM after 30 minutes of inactivity |
| reportReady | HTTP       | Accept VM boot callback with IP and branch  |

### HTTP Endpoints (gateway)

| Method | Path                    | Purpose                           | Auth |
| ------ | ----------------------- | --------------------------------- | ---- |
| GET    | `/internal/branch-lock` | Get current state and lock status | None |
| POST   | `/internal/branch-lock` | Set branch lock                   | None |
| GET    | `/devbar/logs`          | SSE proxy to VM log stream        | None |
| GET    | `/devbar/events`        | SSE proxy to VM event stream      | None |
| \*     | `/*`                    | Proxy to VM                       | None |

### HTTP Endpoints (webhook)

| Method | Path | Purpose                     | Auth                  |
| ------ | ---- | --------------------------- | --------------------- |
| POST   | `/`  | Receive GitHub push webhook | HMAC-SHA256 signature |

### HTTP Endpoints (report-ready)

| Method | Path | Purpose                    | Auth |
| ------ | ---- | -------------------------- | ---- |
| POST   | `/`  | VM reports boot completion | None |

### PubSub Events

- **Publishes:** `predev-code-update-{env}` (branch and commit info for VM hot reload)
- **Subscribes:** `predev-idle-check-{env}` (Cloud Scheduler triggers idle check)

### Types

```typescript
interface PredevState {
  status: 'stopped' | 'starting' | 'running' | 'stopping';
  vmIp: string | null;
  branch: string;
  commitSha: string | null;
  commitMessage: string | null;
  branchLocked: boolean;
  lastActivity: Date;
  startedAt: Date | null;
}

interface BranchLockResponse {
  locked: boolean;
  branch: string;
  commitSha: string | null;
  commitMessage: string | null;
  status: string;
}

interface ReadyPayload {
  ip: string;
  branch: string;
}

interface CodeUpdateMessage {
  branch: string;
  commitSha: string;
  timestamp: string;
}
```

---

## Constraints

| Rule                   | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| **Single VM**          | Only one pre-dev instance exists at a time             |
| **Public gateway**     | No authentication on gateway; relies on URL obscurity  |
| **Webhook signature**  | GitHub pushes must have valid HMAC-SHA256 signature    |
| **Branch lock**        | When locked, pushes to other branches are ignored      |
| **Idle timeout**       | VM shuts down after 30 minutes without gateway traffic |
| **State in Firestore** | All state persists in `predev-state/current` document  |
| **MIG-based scaling**  | VM starts/stops via MIG resize (0 or 1 instances)      |

---

## Usage Patterns

### Check environment status

```bash
curl -s https://GATEWAY_URL/internal/branch-lock | jq
# { "locked": false, "branch": "development", "status": "running", ... }
```

### Lock branch for a demo

```bash
curl -X POST https://GATEWAY_URL/internal/branch-lock \
  -H "Content-Type: application/json" \
  -d '{"locked": true}'
```

### Trigger branch switch via webhook

```bash
# GitHub automatically sends this on push, but for testing:
curl -X POST https://WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=COMPUTED_HMAC" \
  -H "x-github-event: push" \
  -d '{"ref":"refs/heads/feature-branch","after":"abc123"}'
```

### Report VM ready (called by VM startup script)

```bash
curl -X POST https://REPORT_READY_URL \
  -H "Content-Type: application/json" \
  -d '{"ip":"10.128.0.42","branch":"development"}'
```

---

## State Machine

```
stopped --> starting  (gateway request triggers MIG resize)
starting --> running  (VM calls report-ready)
running --> stopping  (idle-check detects 30 min inactivity)
stopping --> stopped  (MIG resized to 0)
```

---

## Dependencies

| Service/Resource | Direction | Purpose                           |
| ---------------- | --------- | --------------------------------- |
| Firestore        | Both      | Read/write state                  |
| GCP Compute API  | Outbound  | MIG resize for VM start/stop      |
| GCP Pub/Sub      | Both      | Idle-check trigger, code-update   |
| GitHub           | Inbound   | Push webhook events               |
| Cloud Scheduler  | Inbound   | 5-minute idle-check trigger       |
| Spot VM          | Both      | Target VM for proxy and callbacks |

---

**Last updated:** 2026-02-08
