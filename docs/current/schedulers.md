# Cloud Scheduler Jobs

> **Auto-generated documentation** - Do not edit manually.
> Last updated: 2026-01-02

Cloud Scheduler is used for periodic tasks like retrying failed operations and cleanup jobs.

## Jobs Summary

| #   | Job Name                                  | Service         | Endpoint                               | Schedule      | Purpose                             |
| --- | ----------------------------------------- | --------------- | -------------------------------------- | ------------- | ----------------------------------- |
| 1   | `intexuraos-retry-pending-commands-{env}` | commands-router | `POST /internal/router/retry-pending`  | `*/5 * * * *` | Retry stuck command classifications |
| 2   | `intexuraos-retry-pending-actions-{env}`  | actions-agent   | `POST /internal/actions/retry-pending` | `*/5 * * * *` | Retry stuck action event publishing |

## Jobs Detail

### 1. Retry Pending Commands

| Aspect             | Value                                                               |
| ------------------ | ------------------------------------------------------------------- |
| **Job**            | `intexuraos-retry-pending-commands-{env}`                           |
| **Service**        | commands-router                                                     |
| **Endpoint**       | `POST /internal/router/retry-pending`                               |
| **Handler**        | `apps/commands-router/src/routes/internalRoutes.ts:186-248`         |
| **Use Case**       | `apps/commands-router/src/domain/usecases/retryPendingCommands.ts`  |
| **Schedule**       | `*/5 * * * *` (every 5 minutes)                                     |
| **Timezone**       | UTC                                                                 |
| **Purpose**        | Retry classification for commands stuck in `pending_classification` |
| **Retry Count**    | 1                                                                   |
| **Retry Duration** | 60s max (5-30s backoff)                                             |
| **OIDC Auth**      | Yes (`intexuraos-scheduler-{env}`)                                  |

**Handler Logic:**

1. Query Firestore for commands with `pending_classification` status
2. For each pending command:
   - Fetch user's API keys from user-service
   - Skip if user has no Google API key
   - Run LLM classification
   - If classified (not "unclassified"): create action via actions-agent, publish `action.created` event
   - Update command status to `classified`
3. Return metrics: `{processed, skipped, failed, total}`

**Handler Logging:**

| Phase            | Level  | Context Fields                            |
| ---------------- | ------ | ----------------------------------------- |
| Request received | `info` | headers (redacted), body preview          |
| Auth success     | `info` | OIDC authentication detected              |
| Auth failure     | `warn` | failure reason                            |
| Completion       | `info` | `processed`, `skipped`, `failed`, `total` |

**Use Case Logging:**

| Phase                    | Level   | Context Fields                                  |
| ------------------------ | ------- | ----------------------------------------------- |
| Start                    | `info`  | "Starting retry of pending classifications"     |
| Commands found           | `info`  | `count`                                         |
| Processing command       | `info`  | `commandId`, `userId`                           |
| API key fetch failed     | `debug` | `commandId`, `userId`, `errorCode`              |
| No Google API key        | `debug` | `commandId`, `userId`                           |
| Classification completed | `info`  | `commandId`, `classificationType`, `confidence` |
| Action creation failed   | `error` | `commandId`, `error`                            |
| Action created           | `info`  | `commandId`, `actionId`                         |
| Command classified       | `info`  | `commandId`, `status`                           |
| Classification exception | `error` | `commandId`, `error`                            |
| Summary                  | `info`  | `processed`, `skipped`, `failed`, `total`       |

**Error Handling:**

| Error Scenario           | Behavior                  | Result             |
| ------------------------ | ------------------------- | ------------------ |
| Auth failure             | 401 response + warn log   | Request rejected   |
| API key fetch fails      | Skip command (debug log)  | Counted as skipped |
| No Google API key        | Skip command (debug log)  | Counted as skipped |
| Classification exception | Mark failed, store reason | Counted as failed  |
| Action creation fails    | Skip (error log)          | Counted as failed  |

---

### 2. Retry Pending Actions

| Aspect             | Value                                                           |
| ------------------ | --------------------------------------------------------------- |
| **Job**            | `intexuraos-retry-pending-actions-{env}`                        |
| **Service**        | actions-agent                                                   |
| **Endpoint**       | `POST /internal/actions/retry-pending`                          |
| **Handler**        | `apps/actions-agent/src/routes/internalRoutes.ts:572-634`       |
| **Use Case**       | `apps/actions-agent/src/domain/usecases/retryPendingActions.ts` |
| **Schedule**       | `*/5 * * * *` (every 5 minutes)                                 |
| **Timezone**       | UTC                                                             |
| **Purpose**        | Retry processing for actions stuck in `pending` status          |
| **Retry Count**    | 1                                                               |
| **Retry Duration** | 60s max (5-30s backoff)                                         |
| **OIDC Auth**      | Yes (`intexuraos-scheduler-{env}`)                              |

**Handler Logic:**

1. Query Firestore for actions with `pending` status
2. For each pending action:
   - Look up handler for the action type
   - Skip if no handler registered
   - Reconstruct `ActionCreatedEvent` from action data
   - Re-publish `action.created` event to Pub/Sub
3. Return metrics: `{processed, skipped, failed, total}`

**Handler Logging:**

| Phase            | Level  | Context Fields                   |
| ---------------- | ------ | -------------------------------- |
| Request received | `info` | headers (redacted), body preview |
| Auth success     | `info` | OIDC authentication detected     |
| Auth failure     | `warn` | failure reason                   |

**Use Case Logging:**

| Phase                | Level   | Context Fields                            |
| -------------------- | ------- | ----------------------------------------- |
| Start                | `info`  | "Starting retry of pending actions"       |
| Actions found        | `info`  | `count`                                   |
| Processing action    | `info`  | `actionId`, `userId`, `actionType`        |
| No handler for type  | `debug` | `actionId`, `actionType`                  |
| Event publish failed | `error` | `actionId`, `error`                       |
| Event re-published   | `info`  | `actionId`, `actionType`                  |
| Summary              | `info`  | `processed`, `skipped`, `failed`, `total` |

**Error Handling:**

| Error Scenario             | Behavior                  | Result             |
| -------------------------- | ------------------------- | ------------------ |
| Auth failure               | 401 response + warn log   | Request rejected   |
| No handler for action type | Skip action (debug log)   | Counted as skipped |
| Event publish fails        | Continue loop (error log) | Counted as failed  |

---

## Terraform Configuration

**Location:** `terraform/environments/dev/main.tf`

### Service Account

```hcl
resource "google_service_account" "cloud_scheduler" {
  account_id   = "intexuraos-scheduler-${var.environment}"
  display_name = "Cloud Scheduler Service Account"
  description  = "Service account for Cloud Scheduler to invoke Cloud Run endpoints"
}
```

### IAM Bindings

Each scheduler job's service account has `roles/run.invoker` permission on its target Cloud Run service.

### Common Retry Configuration

Both jobs use identical retry settings:

| Setting                | Value |
| ---------------------- | ----- |
| `retry_count`          | 1     |
| `max_retry_duration`   | 60s   |
| `min_backoff_duration` | 5s    |
| `max_backoff_duration` | 30s   |

### Authentication Pattern

All scheduler jobs use OIDC tokens:

```hcl
oidc_token {
  service_account_email = google_service_account.cloud_scheduler.email
  audience              = module.target_service.service_url
}
```

Handlers detect OIDC via the presence of authorization bearer token and fall back to `x-internal-auth` header validation.
