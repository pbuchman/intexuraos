# Commands Agent - Deployment Guide

## Infrastructure

- **Platform:** Google Cloud Run
- **Scaling:** 0 to 1 instances (scale-to-zero enabled)
- **Machine Type:** E2_MEDIUM (2 vCPU, 4 GB RAM)
- **Region:** Same as GCP project

## Environment Variables

### Required Variables

| Variable                              | Source         | Description                               |
| ------------------------------------- | -------------- | ----------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | Terraform      | Google Cloud project ID                   |
| `INTEXURAOS_AUTH_JWKS_URL`            | Terraform      | Auth0 JWKS endpoint                       |
| `INTEXURAOS_AUTH_ISSUER`              | Terraform      | Auth0 issuer URL                          |
| `INTEXURAOS_AUTH_AUDIENCE`            | Terraform      | Auth0 audience (API identifier)           |
| `INTEXURAOS_USER_SERVICE_URL`         | Terraform      | user-service base URL                     |
| `INTEXURAOS_ACTIONS_AGENT_URL`        | Terraform      | actions-agent base URL                    |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | Terraform      | app-settings-service for pricing          |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | Secret Manager | Shared secret for service-to-service auth |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`     | Terraform      | PubSub topic for action events            |

### Optional Variables

| Variable                 | Default       | Description               |
| ------------------------ | ------------- | ------------------------- |
| `INTEXURAOS_SENTRY_DSN`  | (none)        | Sentry error tracking DSN |
| `INTEXURAOS_ENVIRONMENT` | `development` | Environment name          |
| `LOG_LEVEL`              | `info`        | Pino log level            |
| `PORT`                   | `8080`        | Server port               |

## Terraform Configuration

Service definition in `terraform/environments/dev/main.tf`:

```hcl
module "commands_agent" {
  source           = "../../modules/cloud-run-service"
  name             = "intexuraos-commands-agent"
  app_path         = "apps/commands-agent"
  port             = 8080
  min_scale        = 0
  max_scale        = 1
  memory           = "512Mi"
  cpu              = "2"

  secrets = merge(local.common_service_secrets, {
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  })

  env_vars = merge(local.common_service_env_vars, {
    INTEXURAOS_USER_SERVICE_URL    = module.user_service.internal_url
    INTEXURAOS_ACTIONS_AGENT_URL   = module.actions_agent.internal_url
    INTEXURAOS_APP_SETTINGS_SERVICE_URL = module.app_settings_service.internal_url
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE = module.pubsub_actions.id
  })
}
```

## Pub/Sub Configuration

### Subscribed Topics

| Topic            | Handler              | Trigger                 |
| ---------------- | -------------------- | ----------------------- |
| `command-ingest` | `/internal/commands` | WhatsApp message events |

### Published Topics

| Topic     | Event Type       | Purpose                 |
| --------- | ---------------- | ----------------------- |
| `actions` | `action.created` | Trigger action handlers |

### Push Subscription

The `command-ingest` topic uses HTTP push to Cloud Run:

```hcl
resource "google_pubsub_subscription" "commands_ingest_push" {
  name  = "commands-agent-ingest-push"
  topic = google_pubsub_topic.command_ingest.id

  push_config {
    push_endpoint = module.commands_agent.https_url
    oidc_token {
      service_account_email = google_service_account.commands_agent.email
    }
  }
}
```

## Cloud Scheduler

Retry job for pending classifications:

```hcl
resource "google_cloud_scheduler_job" "retry_pending_commands" {
  name             = "retry-pending-commands"
  schedule          = "*/5 * * * *"  # Every 5 minutes
  time_zone        = "UTC"
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = "${module.commands_agent.https_url}/internal/retry-pending"
    oidc_token {
      service_account_email = google_service_account.commands_agent.email
    }
  }
}
```

## Building

```bash
# Build service
pnpm --filter commands-agent build

# Build Docker image
gcloud builds submit --config apps/commands-agent/cloudbuild.yaml .

# Or use the script
./scripts/push-missing-images.sh
```

## Deployment

```bash
# Deploy via Terraform
tf init
tf apply -target=module.commands_agent

# Verify deployment
curl https://intexuraos-commands-agent-cj44trunra-lm.a.run.app/health
```

## Health Check

The service exposes a health check endpoint:

```bash
curl https://intexuraos-commands-agent-cj44trunra-lm.a.run.app/health
```

**Response:**

```json
{
  "status": "ok",
  "serviceName": "commands-agent",
  "version": "0.0.4",
  "timestamp": "2025-01-25T10:00:00.000Z",
  "checks": [
    {
      "name": "firestore",
      "status": "ok",
      "latencyMs": 15
    }
  ]
}
```

## Monitoring

### Sentry

Error tracking via Sentry (configured when `INTEXURAOS_SENTRY_DSN` is set).

### Cloud Logging

Logs structured as JSON:

```json
{
  "level": "info",
  "time": "2025-01-25T10:00:00.000Z",
  "msg": "Classification completed",
  "commandId": "pwa-shared:123",
  "classificationType": "todo",
  "confidence": 0.92
}
```

## Troubleshooting

### Common Issues

| Issue                           | Cause                      | Solution                           |
| ------------------------------- | -------------------------- | ---------------------------------- |
| Status `pending_classification` | No user API key            | User must configure API key        |
| Health check fails              | Firestore connection issue | Check emulator/connection config   |
| Pub/Sub push rejected           | OIDC token invalid         | Verify service account permissions |
| High latency                    | Cold start or LLM timeout  | Check min_instances setting        |

### Debug Mode

```bash
# Set debug log level
gcloud run services update commands-agent \
  --update-env-vars=LOG_LEVEL=debug
```

### View Logs

```bash
# Recent logs
gcloud logs tail /projects/PROJECT/logs/commands-agent

# Filter by command
gcloud logs filter 'jsonPayload.commandId="pwa-shared:123"'
```

## Service Account Permissions

The Cloud Run service account requires:

| Permission                  | Purpose                  |
| --------------------------- | ------------------------ |
| `datastore.users`           | Firestore access         |
| `pubsub.publisher`          | Publish to actions topic |
| `logging.logEntries.create` | Cloud Logging            |
| `cloudtasks.enqueuer`       | (if using Cloud Tasks)   |

---

**Last updated:** 2025-01-25
