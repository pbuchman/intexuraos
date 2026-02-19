# log-cleanup -- Agent Interface

> Machine-readable interface definition for AI agents interacting with log-cleanup.

---

## Identity

| Field    | Value                                                            |
| -------- | ---------------------------------------------------------------- |
| **Name** | log-cleanup                                                      |
| **Role** | Scheduled Log Retention Worker                                   |
| **Goal** | Delete execution logs older than the configured retention period |

---

## Capabilities

### Trigger

| Type    | Source                         | Entry Point   |
| ------- | ------------------------------ | ------------- |
| Pub/Sub | `intexuraos-log-cleanup-{env}` | `cleanupLogs` |

This worker has no HTTP endpoints. It reacts to Pub/Sub CloudEvents and calls code-agent's internal API.

### Internal API Call

```typescript
interface CleanupRequest {
  retentionDays?: number;
  batchSize?: number;
  tasksPerRun?: number;
}

interface CleanupResponse {
  success: boolean;
  data?: {
    tasksProcessed: number;
    tasksFailed: number;
    logsDeleted: number;
    durationMs: number;
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### Types

```typescript
interface CleanupResult {
  success: boolean;
  message: string;
  tasksProcessed: number;
  tasksFailed: number;
  logsDeleted: number;
  durationMs: number;
}
```

---

## Constraints

| Rule                    | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| **No direct DB access** | Deletion happens via code-agent, not direct Firestore calls      |
| **Pub/Sub only**        | Cannot be invoked via HTTP                                       |
| **Auth required**       | Uses `X-Internal-Auth` header for code-agent calls               |
| **Idempotent**          | Safe to trigger multiple times; code-agent handles deduplication |

---

## Usage Patterns

### Trigger manual cleanup

```bash
gcloud pubsub topics publish intexuraos-log-cleanup-dev \
  --message='{"trigger":"manual"}'
```

### Check last run result

```bash
gcloud functions logs read intexuraos-log-cleanup-dev \
  --region=europe-central2 \
  --limit=5 \
  --format=json | jq '.[].textPayload'
```

---

## Dependencies

| Service    | Direction | Purpose                       |
| ---------- | --------- | ----------------------------- |
| code-agent | Outbound  | Log deletion via internal API |

---

## Environment Variables

| Variable                         | Required | Description                |
| -------------------------------- | -------- | -------------------------- |
| `INTEXURAOS_CODE_AGENT_URL`      | Yes      | Base URL of code-agent     |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | Shared internal auth token |
| `INTEXURAOS_LOG_RETENTION_DAYS`  | No       | Days to keep logs          |
| `INTEXURAOS_LOG_BATCH_SIZE`      | No       | Logs per deletion batch    |
| `INTEXURAOS_LOG_TASKS_PER_RUN`   | No       | Max tasks per run          |

---

**Last updated:** 2026-02-19
