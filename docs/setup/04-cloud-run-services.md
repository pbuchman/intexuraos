# 04 - Cloud Run Services

This document describes the Cloud Run service configuration and operations.

## Services Overview

| Service                      | Cloud Run Name                            | Local Port | Health Endpoint |
| ---------------------------- | ----------------------------------------- | ---------- | --------------- |
| User Service                 | `intexuraos-user-service`                 | 8110       | `/health`       |
| Notion Service               | `intexuraos-notion-service`               | 8112       | `/health`       |
| WhatsApp Service             | `intexuraos-whatsapp-service`             | 8113       | `/health`       |
| Mobile Notifications Service | `intexuraos-mobile-notifications-service` | 8114       | `/health`       |
| Research Agent               | `intexuraos-research-agent`               | 8116       | `/health`       |
| Image Service                | `intexuraos-image-service`                | 8120       | `/health`       |
| Notes Agent                  | `intexuraos-notes-agent`                  | 8121       | `/health`       |
| App Settings Service         | `intexuraos-app-settings-service`         | 8122       | `/health`       |
| Bookmarks Agent              | `intexuraos-bookmarks-agent`              | 8124       | `/health`       |
| Calendar Agent               | `intexuraos-calendar-agent`               | 8125       | `/health`       |
| Linear Agent                 | `intexuraos-linear-agent`                 | 8126       | `/health`       |
| Web Agent                    | `intexuraos-web-agent`                    | 8127       | `/health`       |
| Code Agent                   | `intexuraos-code-agent`                   | 8128       | `/health`       |
| API Docs Hub                 | `intexuraos-api-docs-hub`                 | —          | `/health`       |

## Service Configuration

All services are configured with:

- **Min instances**: 0 (scale to zero)
- **Max instances**: 2 (dev environment limit)
- **CPU**: 1 vCPU
- **Memory**: 512Mi
- **Timeout**: 300s
- **Ingress**: All traffic (public)
- **Authentication**: Allow unauthenticated (JWT validation is app-level)

## Environment Variables

Services receive secrets from Secret Manager:

| Environment Variable | Secret Name                |
| -------------------- | -------------------------- |
| `AUTH_JWKS_URL`      | `INTEXURAOS_AUTH_JWKS_URL` |
| `AUTH_ISSUER`        | `INTEXURAOS_AUTH_ISSUER`   |
| `AUTH_AUDIENCE`      | `INTEXURAOS_AUTH_AUDIENCE` |

## View Service Status

```bash
# List all Cloud Run services
gcloud run services list

# Get specific service details
gcloud run services describe intexuraos-user-service --region=europe-central2

# Get service URL
gcloud run services describe intexuraos-user-service \
  --region=europe-central2 \
  --format="value(status.url)"
```

## View Logs

```bash
# Stream logs for user-service
gcloud run services logs read intexuraos-user-service \
  --region=europe-central2 \
  --tail=50

# Stream logs (follow mode)
gcloud run services logs tail intexuraos-user-service \
  --region=europe-central2

# Filter by severity
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=intexuraos-user-service AND severity>=ERROR" \
  --limit=20
```

Or use [Cloud Logging Console](https://console.cloud.google.com/logs).

## Health Check

Verify services are healthy:

```bash
# Get service URL for any service
SVC_URL=$(gcloud run services describe intexuraos-user-service \
  --region=europe-central2 --format="value(status.url)")

# Check health endpoint
curl -s $SVC_URL/health | jq
```

To check all services at once:

```bash
SERVICES=(
  intexuraos-user-service
  intexuraos-notion-service
  intexuraos-whatsapp-service
  intexuraos-mobile-notifications-service
  intexuraos-research-agent
  intexuraos-image-service
  intexuraos-notes-agent
  intexuraos-app-settings-service
  intexuraos-bookmarks-agent
  intexuraos-calendar-agent
  intexuraos-linear-agent
  intexuraos-web-agent
  intexuraos-code-agent
  intexuraos-api-docs-hub
)

for svc in "${SERVICES[@]}"; do
  url=$(gcloud run services describe $svc --region=europe-central2 --format="value(status.url)" 2>/dev/null)
  if [ -n "$url" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" $url/health)
    echo "$svc: HTTP $status"
  fi
done
```

Expected response:

```json
{
  "status": "ok",
  "serviceName": "user-service",
  "version": "0.0.1",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "checks": [
    { "name": "secrets", "status": "ok", "latencyMs": 0, "details": null },
    { "name": "firestore", "status": "ok", "latencyMs": 0, "details": null }
  ]
}
```

## OpenAPI Documentation

Each service exposes Swagger UI at `<SERVICE_URL>/docs` and the raw spec at `<SERVICE_URL>/openapi.json`.

All specs are aggregated by the `api-docs-hub` service (see `apps/api-docs-hub/`).

Example:

```bash
USER_URL=$(gcloud run services describe intexuraos-user-service \
  --region=europe-central2 --format="value(status.url)")

# Swagger UI
open $USER_URL/docs

# Raw OpenAPI spec
curl -s $USER_URL/openapi.json | jq
```

## Manual Deployment

Deploy a specific image manually (replace `<service-name>` with the app directory name, e.g. `user-service`, `code-agent`):

```bash
gcloud run deploy intexuraos-<service-name> \
  --image=europe-central2-docker.pkg.dev/PROJECT_ID/intexuraos-dev/<service-name>:latest \
  --region=europe-central2 \
  --platform=managed
```

Backend services follow this pattern. Service names correspond to their `apps/` directory names (e.g. `apps/code-agent` -> `intexuraos-code-agent`).

In normal operation, deployments are handled automatically by Cloud Build on push to the `development` branch (managed by Terraform).

## Rollback

Rollback to a previous revision:

```bash
# List revisions
gcloud run revisions list --service=intexuraos-user-service --region=europe-central2

# Route traffic to specific revision
gcloud run services update-traffic intexuraos-user-service \
  --region=europe-central2 \
  --to-revisions=intexuraos-user-service-00001-abc=100
```

## Troubleshooting

### Service not starting

Check startup probe configuration and health endpoint.

```bash
# View recent logs
gcloud run services logs read intexuraos-user-service \
  --region=europe-central2 \
  --limit=100
```

### Secret access errors

Ensure service account has `roles/secretmanager.secretAccessor` on all secrets.

```bash
# Check IAM bindings
gcloud secrets get-iam-policy INTEXURAOS_AUTH_JWKS_URL
```

### Cold start issues

Services scale to zero. First request after idle period takes longer.

To keep warm (not recommended for dev):

```bash
gcloud run services update intexuraos-user-service \
  --min-instances=1 \
  --region=europe-central2
```

## Summary

After completing these steps, you should have:

- [x] Cloud Run services deployed and healthy
- [x] Health endpoints responding
- [x] Logs accessible
- [x] OpenAPI documentation available

## Next Step

→ [05-local-dev-with-gcp-deps.md](./05-local-dev-with-gcp-deps.md)
