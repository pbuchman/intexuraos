# Terraform-Code Sync Cross-Validation Report

**Generated:** 2026-02-19
**Scope:** All Cloud Run services and Cloud Functions in terraform vs code
**Source:** `terraform/environments/dev/main.tf` vs `apps/*/src/index.ts` and `workers/*/`

---

## Summary

| Metric                           | Count |
| -------------------------------- | ----- |
| Cloud Run services in Terraform  | 19    |
| Cloud Functions in Terraform     | 3     |
| App directories in `apps/`       | 20    |
| Worker directories in `workers/` | 4     |
| Services matched to code         | 19    |
| Orphaned Terraform modules       | 0     |
| Missing Terraform modules        | 2     |
| Env var mismatches found         | 7     |

---

## Cloud Run Service Configuration Matrix

All Cloud Run services use the shared `cloud-run-service` module. Default values (from `terraform/modules/cloud-run-service/variables.tf`): **memory = 512Mi**, **cpu = 1**, **timeout = 300s**. Services that override defaults are noted.

| Service                      | Terraform Module               | App Path                            | Min | Max | Memory | CPU | Timeout  | Env Vars Match   | Secrets Match |
| ---------------------------- | ------------------------------ | ----------------------------------- | --- | --- | ------ | --- | -------- | ---------------- | ------------- |
| user-service                 | `user_service`                 | `apps/user-service`                 | 0   | 1   | 512Mi  | 1   | 300s     | PARTIAL (note 1) | OK            |
| notion-service               | `notion_service`               | `apps/notion-service`               | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| whatsapp-service             | `whatsapp_service`             | `apps/whatsapp-service`             | 0   | 1   | 512Mi  | 1   | **900s** | OK               | OK            |
| mobile-notifications-service | `mobile_notifications_service` | `apps/mobile-notifications-service` | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| api-docs-hub                 | `api_docs_hub`                 | `apps/api-docs-hub`                 | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| research-agent               | `research_agent`               | `apps/research-agent`               | 0   | 1   | 512Mi  | 1   | **900s** | PARTIAL (note 2) | OK            |
| commands-agent               | `commands_agent`               | `apps/commands-agent`               | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| actions-agent                | `actions_agent`                | `apps/actions-agent`                | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| data-insights-agent          | `data_insights_agent`          | `apps/data-insights-agent`          | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| image-service                | `image_service`                | `apps/image-service`                | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| notes-agent                  | `notes_agent`                  | `apps/notes-agent`                  | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| todos-agent                  | `todos_agent`                  | `apps/todos-agent`                  | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| bookmarks-agent              | `bookmarks_agent`              | `apps/bookmarks-agent`              | 0   | 1   | 512Mi  | 1   | 300s     | PARTIAL (note 3) | OK            |
| code-agent                   | `code_agent`                   | `apps/code-agent`                   | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| app-settings-service         | `app_settings_service`         | `apps/app-settings-service`         | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| calendar-agent               | `calendar_agent`               | `apps/calendar-agent`               | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| web-agent                    | `web_agent`                    | `apps/web-agent`                    | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| linear-agent                 | `linear_agent`                 | `apps/linear-agent`                 | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |
| chat-agent                   | `chat_agent`                   | `apps/chat-agent`                   | 0   | 1   | 512Mi  | 1   | 300s     | OK               | OK            |

**Note:** All services use `min_scale = 0, max_scale = 1`. CPU throttling is enabled on all services (`cpu_idle = true`).

---

## Cloud Functions Matrix

| Function                   | Terraform Module       | Worker Path            | Trigger          | Memory | Timeout | Env Vars Match   |
| -------------------------- | ---------------------- | ---------------------- | ---------------- | ------ | ------- | ---------------- |
| intexuraos-vm-start-dev    | `function_vm_start`    | `workers/vm-lifecycle` | HTTP (scheduler) | 256M   | 120s    | PARTIAL (note 4) |
| intexuraos-vm-stop-dev     | `function_vm_stop`     | `workers/vm-lifecycle` | HTTP (scheduler) | 256M   | 120s    | PARTIAL (note 4) |
| intexuraos-log-cleanup-dev | `function_log_cleanup` | `workers/log-cleanup`  | Pub/Sub          | 512M   | 540s    | PARTIAL (note 5) |

---

## Missing Terraform Modules (CRITICAL)

These app/worker directories have no Terraform Cloud Run or Cloud Function definition:

| Directory               | Type        | Severity | Reason                                                                                                                                                                                        |
| ----------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`              | Web app SPA | N/A      | Deployed as static assets to GCS bucket, NOT Cloud Run. Uses `module "web_app"` + Cloud Build. Correct.                                                                                       |
| `workers/orchestrator`  | Worker      | CRITICAL | No Cloud Run or Cloud Function module. Runs as a direct process on home-dev VM only. Not deployable to prod via Terraform.                                                                    |
| `workers/code-worker`   | Worker      | CRITICAL | No Cloud Run or Cloud Function module. Worker containers are launched dynamically by the orchestrator (not via Terraform-managed infrastructure). By design — these are ephemeral containers. |

**Clarification:** `apps/web` is intentionally not a Cloud Run service. It is a Vite SPA deployed to a GCS bucket via `module "web_app"`. This is correct and expected.

**Orchestrator:** Runs as a persistent process (`tsx watch`) on the home-dev VM, managed via PM2 locally. No cloud deployment path exists via Terraform. This is the most significant gap — the orchestrator cannot be deployed to prod Cloud Run without Terraform changes.

**code-worker:** These are ephemeral worker containers spawned at runtime by the orchestrator (not long-running services). Intended to be excluded from Terraform. Correct by design.

---

## Orphaned Terraform Modules

No Cloud Run or Cloud Function modules in Terraform point to non-existent app/worker directories. All 19 Cloud Run service modules have corresponding `apps/` directories.

---

## Env Var Mismatch Details

### Note 1 — user-service: Missing `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` in REQUIRED_ENV

**Severity: HIGH**

Terraform injects `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` as a secret:

```hcl
INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI = module.secret_manager.secret_ids["INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI"]
```

But `apps/user-service/src/index.ts` REQUIRED_ENV does not include `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI`. It only validates:

- `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`
- `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET`

The redirect URI is injected but not fail-fast validated. If the secret is missing or empty, the service may start but OAuth flow will silently fail.

---

### Note 2 — research-agent: Missing `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` in REQUIRED_ENV

**Severity: HIGH**

Terraform injects `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` as an env var:

```hcl
INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC = "intexuraos-llm-analytics-${var.environment}"
```

But `apps/research-agent/src/index.ts` REQUIRED_ENV does not include it. The topic is present in Terraform but not validated at startup. If removed or misconfigured, the service will not crash — it will silently fail to publish analytics events.

---

### Note 3 — bookmarks-agent: `INTEXURAOS_USER_SERVICE_URL` and `INTEXURAOS_APP_SETTINGS_SERVICE_URL` injected but not in REQUIRED_ENV

**Severity: MEDIUM**

Terraform injects two extra URLs for bookmarks-agent:

```hcl
INTEXURAOS_USER_SERVICE_URL         = module.user_service.service_url
INTEXURAOS_APP_SETTINGS_SERVICE_URL = module.app_settings_service.service_url
```

But `apps/bookmarks-agent/src/index.ts` REQUIRED_ENV only validates:

- `INTEXURAOS_WEB_AGENT_URL`
- `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`
- `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`
- `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`

The user service and app settings URLs are present in env but not validated. If a future code change uses these URLs without adding them to REQUIRED_ENV, the service will fail at runtime rather than startup.

Additionally, `INTEXURAOS_WEB_AGENT_URL` is in bookmarks-agent's REQUIRED_ENV but is NOT in Terraform's env_vars or secrets block. The URL is available via `common_service_env_vars` which does NOT include `INTEXURAOS_WEB_AGENT_URL`. **This is a confirmed missing env var in Terraform.**

**Confirmed Gap:** `INTEXURAOS_WEB_AGENT_URL` is required by bookmarks-agent code but NOT injected by Terraform.

---

### Note 4 — vm-lifecycle functions: Missing optional env vars

**Severity: LOW**

`workers/vm-lifecycle/src/config.ts` reads these vars with defaults:

- `INTEXURAOS_VM_ZONE` (default: `europe-central2-a`)
- `INTEXURAOS_VM_INSTANCE_NAME` (default: `cc-vm`)
- `INTEXURAOS_VM_HEALTH_URL` (default: hardcoded URL)
- `INTEXURAOS_VM_SHUTDOWN_URL` (default: hardcoded URL)

Terraform only injects:

```hcl
INTEXURAOS_ENVIRONMENT    = var.environment
INTEXURAOS_GCP_PROJECT_ID = var.project_id
```

Secrets: `INTEXURAOS_INTERNAL_AUTH_TOKEN`

The four VM config vars use hardcoded defaults that happen to be correct for the dev environment. However, these cannot be changed per-environment without code changes. They should be added to Terraform env_vars for proper configurability.

---

### Note 5 — log-cleanup: `INTEXURAOS_LOG_RETENTION_DAYS`, `INTEXURAOS_LOG_BATCH_SIZE`, `INTEXURAOS_LOG_TASKS_PER_RUN` not in Terraform

**Severity: LOW**

`workers/log-cleanup/src/cleanup.ts` reads these optional tuning vars:

- `INTEXURAOS_LOG_RETENTION_DAYS`
- `INTEXURAOS_LOG_BATCH_SIZE`
- `INTEXURAOS_LOG_TASKS_PER_RUN`

None are in Terraform (all use code defaults). Correct for now but cannot be tuned per-environment without code changes.

---

## Critical Finding: `INTEXURAOS_WEB_AGENT_URL` Missing from bookmarks-agent Terraform

**Severity: CRITICAL**

Cross-referencing bookmarks-agent's REQUIRED_ENV vs Terraform env injection:

REQUIRED_ENV in `apps/bookmarks-agent/src/index.ts`:

```
INTEXURAOS_WEB_AGENT_URL          ← REQUIRED, validated at startup
```

Terraform `module "bookmarks_agent"` env_vars (line 1246-1252 of main.tf):

```hcl
env_vars = merge(local.common_service_env_vars, {
  INTEXURAOS_PUBSUB_BOOKMARK_ENRICH     = "..."
  INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE  = "..."
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC = "..."
  INTEXURAOS_USER_SERVICE_URL           = module.user_service.service_url
  INTEXURAOS_APP_SETTINGS_SERVICE_URL   = module.app_settings_service.service_url
})
```

`INTEXURAOS_WEB_AGENT_URL` is **NOT** in the bookmarks-agent module's env_vars, and it is also **NOT** in `local.common_service_env_vars`. The service will fail startup in production with: `Missing required environment variables: INTEXURAOS_WEB_AGENT_URL`.

---

## Scheduler Jobs Summary

| Job Name                              | Schedule       | Target                                           |
| ------------------------------------- | -------------- | ------------------------------------------------ |
| intexuraos-retry-pending-commands-dev | `*/5 * * * *`  | commands-agent `/internal/retry-pending`         |
| intexuraos-retry-pending-actions-dev  | `*/5 * * * *`  | actions-agent `/internal/actions/retry-pending`  |
| intexuraos-refresh-snapshots-dev      | `*/15 * * * *` | data-insights-agent via Pub/Sub snapshot-refresh |
| intexuraos-linear-sync-hourly-dev     | `0 * * * *`    | linear-agent `/internal/linear/sync-all`         |
| intexuraos-vm-start-dev               | `0 7 * * 1-5`  | function_vm_start (Europe/Warsaw)                |
| intexuraos-vm-stop-dev                | `0 23 * * *`   | function_vm_stop (Europe/Warsaw)                 |
| intexuraos-log-cleanup-dev            | `0 3 * * *`    | function_log_cleanup via Pub/Sub (UTC)           |

---

## Pub/Sub Topics Summary

| Topic Name Pattern                      | Publisher                                                  | Subscriber           |
| --------------------------------------- | ---------------------------------------------------------- | -------------------- |
| intexuraos-whatsapp-media-cleanup-dev   | whatsapp-service                                           | whatsapp-service     |
| intexuraos-whatsapp-webhook-process-dev | whatsapp-service                                           | whatsapp-service     |
| intexuraos-whatsapp-transcription-dev   | whatsapp-service                                           | whatsapp-service     |
| intexuraos-commands-ingest-dev          | whatsapp-service                                           | commands-agent       |
| intexuraos-actions-queue-dev            | commands-agent, actions-agent                              | actions-agent        |
| intexuraos-research-process-dev         | research-agent                                             | research-agent       |
| intexuraos-llm-analytics-dev            | research-agent                                             | research-agent       |
| intexuraos-llm-call-dev                 | research-agent                                             | research-agent       |
| intexuraos-whatsapp-send-dev            | actions-agent, research-agent, bookmarks-agent, code-agent | whatsapp-service     |
| intexuraos-approval-reply-dev           | whatsapp-service                                           | actions-agent        |
| intexuraos-bookmark-enrich-dev          | bookmarks-agent                                            | bookmarks-agent      |
| intexuraos-bookmark-summarize-dev       | bookmarks-agent                                            | bookmarks-agent      |
| intexuraos-todos-processing-dev         | todos-agent                                                | todos-agent          |
| intexuraos-calendar-preview-dev         | actions-agent                                              | calendar-agent       |
| snapshot-refresh-dev                    | cloud-scheduler                                            | data-insights-agent  |
| intexuraos-log-cleanup-dev              | cloud-scheduler                                            | function_log_cleanup |

---

## Discrepancies

| ID  | Severity | Service         | Issue                                                                                                                                                                        |
| --- | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | CRITICAL | bookmarks-agent | `INTEXURAOS_WEB_AGENT_URL` in REQUIRED_ENV but missing from Terraform env_vars. Will crash at Cloud Run startup.                                                             |
| D-2 | CRITICAL | orchestrator    | No Terraform module. Cannot be deployed to Cloud Run. Only runs on home-dev VM.                                                                                              |
| D-3 | HIGH     | user-service    | `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` injected by Terraform but not in REQUIRED_ENV. No fail-fast on missing secret.                                                        |
| D-4 | HIGH     | research-agent  | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` injected by Terraform but not in REQUIRED_ENV. Silent failure if missing.                                                            |
| D-5 | MEDIUM   | bookmarks-agent | `INTEXURAOS_USER_SERVICE_URL` and `INTEXURAOS_APP_SETTINGS_SERVICE_URL` injected by Terraform but not in REQUIRED_ENV. Used by bookmarks-agent without fail-fast validation. |
| D-6 | LOW      | vm-lifecycle    | `INTEXURAOS_VM_ZONE`, `INTEXURAOS_VM_INSTANCE_NAME`, `INTEXURAOS_VM_HEALTH_URL`, `INTEXURAOS_VM_SHUTDOWN_URL` use hardcoded defaults — not configurable via Terraform.       |
| D-7 | LOW      | log-cleanup     | `INTEXURAOS_LOG_RETENTION_DAYS`, `INTEXURAOS_LOG_BATCH_SIZE`, `INTEXURAOS_LOG_TASKS_PER_RUN` use code defaults — not configurable via Terraform.                             |

---

## Action Items

| Priority | Action                                                                                                                                               | Owner |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| P0       | Add `INTEXURAOS_WEB_AGENT_URL = module.web_agent.service_url` to `module "bookmarks_agent"` env_vars in `terraform/environments/dev/main.tf`         | Infra |
| P1       | Add `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` to `apps/user-service/src/index.ts` REQUIRED_ENV                                                          | Dev   |
| P1       | Add `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` to `apps/research-agent/src/index.ts` REQUIRED_ENV                                                       | Dev   |
| P2       | Add `INTEXURAOS_USER_SERVICE_URL` and `INTEXURAOS_APP_SETTINGS_SERVICE_URL` to bookmarks-agent REQUIRED_ENV, or remove them from Terraform if unused | Dev   |
| P2       | Decide on Cloud Run deployment path for `workers/orchestrator` (create Terraform module or document as dev-only)                                     | Arch  |
| P3       | Add `INTEXURAOS_VM_ZONE` and `INTEXURAOS_VM_INSTANCE_NAME` to vm-lifecycle Terraform env_vars for per-environment configurability                    | Infra |
| P3       | Add `INTEXURAOS_LOG_RETENTION_DAYS` to log-cleanup Terraform env_vars for per-environment configurability                                            | Infra |

---

## Validation Notes

- **All 19 Cloud Run modules** reference valid `apps/` directories with matching names (kebab-case directory = underscore Terraform key).
- **Default resource limits** (512Mi memory, 1 CPU) are uniform across all services. No service overrides memory or CPU — only `whatsapp_service` and `research_agent` override `timeout = "900s"`.
- **All services use `min_scale = 0, max_scale = 1`** — designed for cost-efficient dev environment, scaling to zero when idle.
- **`code-worker`** intentionally has no Terraform module — it is an ephemeral container spawned by the orchestrator at runtime.
- **`apps/web`** is correctly deployed as a GCS-hosted SPA, not Cloud Run. The `module "web_app"` handles its deployment.
- **Common secrets** (auth, Sentry DSN, ZAI key, Gemini key, Dash0) are injected to all 19 services via `local.common_service_secrets`. This is consistent with service code which reads these from environment.
