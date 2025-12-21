# Docker

Container configurations for local development.

## Local Development

```bash
# Build and run all services
docker compose -f docker/docker-compose.yaml up --build

# Run in background
docker compose -f docker/docker-compose.yaml up -d --build

# View logs
docker compose -f docker/docker-compose.yaml logs -f

# Stop
docker compose -f docker/docker-compose.yaml down
```

## Prerequisites

1. Create `.env.local` in repo root (see [Local Development Guide](../docs/setup/05-local-dev-with-gcp-deps.md))
2. Authenticate with GCP: `gcloud auth application-default login`

## Services

| Service             | Local Port | Health Check                 |
| ------------------- | ---------- | ---------------------------- |
| auth-service        | 8080       | http://localhost:8080/health |
| promptvault-service | 8081       | http://localhost:8081/health |

## See Also

- [Local Development Guide](../docs/setup/05-local-dev-with-gcp-deps.md)
- [Cloud Run Services](../docs/setup/04-cloud-run-services.md)
