# Docker

Container configurations for local development.

## Quick Start (Recommended)

```bash
# Start emulators (uses existing local data)
pnpm run emulators:start

# Start all services via PM2
pnpm run services:start

# Or combined (emulators + services, no sync)
pnpm run dev

# Full sync from GCP + start everything
pnpm run dev:sync
```

This starts **3 Docker containers**:

| Container         | Purpose                                       | Port            |
| ----------------- | --------------------------------------------- | --------------- |
| firebase-emulator | Firestore, Pub/Sub emulator, Firebase Auth    | 8100-8102, 8104 |
| fake-gcs          | Google Cloud Storage emulator                 | 8103            |
| pubsub-ui         | Pub/Sub message bridge + monitoring dashboard | 8105            |

Plus **18 services** via PM2 with auto-restart.

## Pub/Sub Architecture (Local)

In production, GCP Pub/Sub automatically pushes messages to Cloud Run endpoints. Locally, the **pubsub-ui** container bridges this gap:

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Service        │     │  Pub/Sub     │     │  pubsub-ui  │
│  (publisher)    │────▶│  Emulator    │────▶│  (bridge)   │
│                 │     │  :8102       │     │  :8105      │
└─────────────────┘     └──────────────┘     └──────┬──────┘
                                                    │ HTTP POST
                                                    ▼
                                             ┌─────────────┐
                                             │  Service    │
                                             │  (handler)  │
                                             │  /internal/ │
                                             └─────────────┘
```

**pubsub-ui** performs two functions:

1. **Message forwarding**: Pulls from emulator, POSTs to local service endpoints
2. **Monitoring dashboard**: Real-time event visualization at http://localhost:8105

## Emulator Management

```bash
# Start emulators (no sync)
pnpm run emulators:start

# Sync from GCP then start emulators
pnpm run emulators:sync

# Stop emulators
pnpm run emulators:stop

# View emulator logs
pnpm run emulators:logs
```

## Service Management (PM2)

```bash
# Start all services
pnpm run services:start

# Stop all services
pnpm run services:stop

# View service status
pnpm run services:status

# View logs (live tail)
pnpm run services:logs

# Interactive monitoring TUI
pnpm run services:monit

# Restart all services
pnpm run services:restart
```

### Emulator Ports

| Emulator      | Port | UI/Endpoint                                        |
| ------------- | ---- | -------------------------------------------------- |
| Firebase UI   | 8100 | http://localhost:8100                              |
| Firestore     | 8101 | (used internally via FIRESTORE_EMULATOR_HOST)      |
| Pub/Sub       | 8102 | (used internally via PUBSUB_EMULATOR_HOST)         |
| Fake GCS      | 8103 | http://localhost:8103/storage/v1/b                 |
| Firebase Auth | 8104 | (used internally via FIREBASE_AUTH_EMULATOR_HOST)  |
| Pub/Sub UI    | 8105 | http://localhost:8105 (message bridge + dashboard) |

## Prerequisites

1. **Docker** - Must be running
2. **Node 22+** - For `node --watch` support
3. **direnv** - For environment variable management
4. **Sync secrets and configure local overrides:**

```bash
# Sync secrets from GCP Secret Manager (creates .envrc)
./scripts/sync-secrets.sh

# Copy local overrides template
cp .envrc.local.example .envrc.local

# Allow direnv to load variables
direnv allow
```

The `.envrc.local` file overrides cloud service URLs with localhost URLs for local development.

## Docker Compose Files

| File                        | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `docker-compose.local.yaml` | Emulators only (Firestore, Pub/Sub, GCS) |

## Troubleshooting

### Pub/Sub messages not being processed

**Symptom:** Actions stay in `pending` status, no processing happens.

**Cause:** The `pubsub-ui` container isn't running.

**Fix:**

```bash
# Check all 3 containers are running
docker compose -f docker/docker-compose.local.yaml ps

# If pubsub-ui is missing, restart all:
docker compose -f docker/docker-compose.local.yaml up -d --build
```

### "Topic not found" errors in service logs

**Symptom:** Service logs show `5 NOT_FOUND: Topic not found`.

**Cause:** pubsub-ui creates topics on startup. If services started before pubsub-ui was ready, the topics don't exist yet.

**Fix:** Restart the affected service after pubsub-ui is fully running:

```bash
pnpm exec pm2 restart actions-agent
```

### Verifying Pub/Sub is working

```bash
# 1. Check pubsub-ui health
curl http://localhost:8105/health | jq '.topics | length'
# Should return 14

# 2. Publish a test message
curl -X POST http://localhost:8105/publish \
  -H "Content-Type: application/json" \
  -d '{"topic": "actions-queue", "data": {"type": "test"}}'

# 3. Check pubsub-ui logs for forwarding
docker compose -f docker/docker-compose.local.yaml logs pubsub-ui --tail 10
```

## Testing

Tests use **fake repositories** (in-memory) via dependency injection, so no external services are required:

```bash
pnpm run test          # Run all tests
pnpm run test:coverage # Run with coverage
```

## See Also

- [Local Development Guide](../docs/setup/05-local-dev-with-gcp-deps.md)
- [Cloud Run Services](../docs/setup/04-cloud-run-services.md)
