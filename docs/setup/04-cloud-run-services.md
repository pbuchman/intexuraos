# 04 - Cloud Run Services

This document describes the Cloud Run service configuration and operations.

## Services Overview

| Service             | Cloud Run Name               | Port | Health Endpoint |
| ------------------- | ---------------------------- | ---- | --------------- |
| Auth Service        | `praxos-auth-service`        | 8080 | `/health`       |
| PromptVault Service | `praxos-promptvault-service` | 8080 | `/health`       |
| Notion Service      | `praxos-notion-service`      | 8080 | `/health`       |

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

| Environment Variable | Secret Name            |
| -------------------- | ---------------------- |
| `AUTH_JWKS_URL`      | `PRAXOS_AUTH_JWKS_URL` |
| `AUTH_ISSUER`        | `PRAXOS_AUTH_ISSUER`   |
| `AUTH_AUDIENCE`      | `PRAXOS_AUTH_AUDIENCE` |

## View Service Status

```bash
# List all Cloud Run services
gcloud run services list

# Get specific service details
gcloud run services describe praxos-auth-service --region=europe-central2
gcloud run services describe praxos-promptvault-service --region=europe-central2

# Get service URL
gcloud run services describe praxos-auth-service \
  --region=europe-central2 \
  --format="value(status.url)"
```

## View Logs

```bash
# Stream logs for auth-service
gcloud run services logs read praxos-auth-service \
  --region=europe-central2 \
  --tail=50

# Stream logs (follow mode)
gcloud run services logs tail praxos-auth-service \
  --region=europe-central2

# Filter by severity
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=praxos-auth-service AND severity>=ERROR" \
  --limit=20
```

Or use [Cloud Logging Console](https://console.cloud.google.com/logs).

## Health Check

Verify services are healthy:

```bash
# Get service URLs
AUTH_URL=$(gcloud run services describe praxos-auth-service \
  --region=europe-central2 --format="value(status.url)")
PROMPTVAULT_URL=$(gcloud run services describe praxos-promptvault-service \
  --region=europe-central2 --format="value(status.url)")
NOTION_URL=$(gcloud run services describe praxos-notion-service \
  --region=europe-central2 --format="value(status.url)")

# Check health endpoints
curl -s $AUTH_URL/health | jq
curl -s $PROMPTVAULT_URL/health | jq
curl -s $NOTION_URL/health | jq
```

Expected response:

```json
{
  "status": "ok",
  "serviceName": "auth-service",
  "version": "0.0.1",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "checks": [
    { "name": "secrets", "status": "ok", "latencyMs": 0, "details": null },
    { "name": "firestore", "status": "ok", "latencyMs": 0, "details": null }
  ]
}
```

## OpenAPI Documentation

Each service exposes Swagger UI:

- Auth Service: `$AUTH_URL/docs`
- PromptVault Service: `$PROMPTVAULT_URL/docs`
- Notion Service: `$NOTION_URL/docs`

OpenAPI spec:

- Auth Service: `$AUTH_URL/openapi.json`
- PromptVault Service: `$PROMPTVAULT_URL/openapi.json`
- Notion Service: `$NOTION_URL/openapi.json`

## Manual Deployment

Deploy a specific image manually:

```bash
# Deploy auth-service
gcloud run deploy praxos-auth-service \
  --image=europe-central2-docker.pkg.dev/PROJECT_ID/praxos-dev/auth-service:latest \
  --region=europe-central2 \
  --platform=managed

# Deploy promptvault-service
gcloud run deploy praxos-promptvault-service \
  --image=europe-central2-docker.pkg.dev/PROJECT_ID/praxos-dev/promptvault-service:latest \
  --region=europe-central2 \
  --platform=managed

# Deploy notion-service
gcloud run deploy praxos-notion-service \
  --image=europe-central2-docker.pkg.dev/PROJECT_ID/praxos-dev/notion-service:latest \
  --region=europe-central2 \
  --platform=managed
```

## Rollback

Rollback to a previous revision:

```bash
# List revisions
gcloud run revisions list --service=praxos-auth-service --region=europe-central2

# Route traffic to specific revision
gcloud run services update-traffic praxos-auth-service \
  --region=europe-central2 \
  --to-revisions=praxos-auth-service-00001-abc=100
```

## Troubleshooting

### Service not starting

Check startup probe configuration and health endpoint.

```bash
# View recent logs
gcloud run services logs read praxos-auth-service \
  --region=europe-central2 \
  --limit=100
```

### Secret access errors

Ensure service account has `roles/secretmanager.secretAccessor` on all secrets.

```bash
# Check IAM bindings
gcloud secrets get-iam-policy PRAXOS_AUTH_JWKS_URL
```

### Cold start issues

Services scale to zero. First request after idle period takes longer.

To keep warm (not recommended for dev):

```bash
gcloud run services update praxos-auth-service \
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
