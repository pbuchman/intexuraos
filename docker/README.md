# Docker

Container configurations for local development.

## Firestore Emulator (for Testing)

For local test execution with real Firestore:

```bash
# Start emulator (background, persistent)
npm run emulator:start

# Run tests (auto-detect running emulator)
npm run test

# Stop emulator
npm run emulator:stop

# View emulator logs
npm run emulator:logs
```

**Key behaviors:**

- Tests auto-detect running emulator via `FIRESTORE_EMULATOR_HOST`
- If emulator not running, tests start a temporary process (killed after tests)
- Emulator data cleared between tests for isolation
- Production code is unaware of emulator - only env vars differ

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
| firestore-emulator  | 8085       | http://localhost:8085/       |

## See Also

- [Local Development Guide](../docs/setup/05-local-dev-with-gcp-deps.md)
- [Cloud Run Services](../docs/setup/04-cloud-run-services.md)
