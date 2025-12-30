# Docker

Container configurations for local development.

## Quick Start (Recommended)

The easiest way to run all services locally with hot-reload:

```bash
# Start everything (emulators + all 7 services with hot-reload)
npm run dev

# Start only emulators (if you want to run services manually)
npm run dev:emulators
```

This starts:
- Firebase Emulator (Firestore + Pub/Sub)
- Fake GCS Server
- All 7 services with `node --watch` (instant restart on file changes)

## Emulator Management

```bash
# Start emulators only
npm run emulators:start

# Stop emulators
npm run emulators:stop

# View emulator logs
npm run emulators:logs
```

## Services & Ports

| Service                      | Port | Health Check                  |
| ---------------------------- | ---- | ----------------------------- |
| user-service                 | 8110 | http://localhost:8110/health  |
| promptvault-service          | 8111 | http://localhost:8111/health  |
| notion-service               | 8112 | http://localhost:8112/health  |
| whatsapp-service             | 8113 | http://localhost:8113/health  |
| mobile-notifications-service | 8114 | http://localhost:8114/health  |
| api-docs-hub                 | 8115 | http://localhost:8115/docs    |
| llm-orchestrator-service     | 8116 | http://localhost:8116/health  |

### Emulator Ports

| Emulator    | Port | UI/Endpoint                               |
| ----------- | ---- | ----------------------------------------- |
| Firebase UI | 8100 | http://localhost:8100                     |
| Firestore   | 8101 | (used internally via FIRESTORE_EMULATOR_HOST) |
| Pub/Sub     | 8102 | (used internally via PUBSUB_EMULATOR_HOST)    |
| Fake GCS    | 8103 | http://localhost:8103/storage/v1/b        |

## Prerequisites

1. **Docker** - Must be running
2. **Node 22+** - For `node --watch` support
3. **Copy `.env.local.example` to `.env.local`** and fill in external API keys

```bash
cp .env.local.example .env.local
# Edit .env.local with your Auth0, WhatsApp, etc. credentials
```

## Docker Compose Files

| File                      | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `docker-compose.yaml`     | Full containerized services (legacy)       |
| `docker-compose.local.yaml` | Emulators only (Firestore, Pub/Sub, GCS) |

## Legacy: Full Docker Build

If you prefer running services in containers (slower iteration):

```bash
docker compose -f docker/docker-compose.yaml up --build
```

## Testing

Tests use **fake repositories** (in-memory) via dependency injection, so no external services are required:

```bash
npm run test          # Run all tests
npm run test:coverage # Run with coverage
```

## See Also

- [Local Development Guide](../docs/setup/05-local-dev-with-gcp-deps.md)
- [Cloud Run Services](../docs/setup/04-cloud-run-services.md)
