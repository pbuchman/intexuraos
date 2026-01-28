# Docker

Container configurations for local development.

## Quick Start (Recommended)

The easiest way to run all services locally with hot-reload:

```bash
# Start everything (emulators + all services with hot-reload)
pnpm run dev

# Start only emulators (if you want to run services manually)
ppnpm run dev:emulators
```

This starts:

- Firebase Emulator (Firestore + Pub/Sub)
- Fake GCS Server
- All 7 services with `node --watch` (instant restart on file changes)

## Emulator Management

```bash
# Start emulators only
pnpm run emulators:start

# Stop emulators
pnpm run emulators:stop

# View emulator logs
pnpm run emulators:logs
```

### Emulator Ports

| Emulator    | Port | UI/Endpoint                                   |
| ----------- | ---- | --------------------------------------------- |
| Firebase UI | 8100 | http://localhost:8100                         |
| Firestore   | 8101 | (used internally via FIRESTORE_EMULATOR_HOST) |
| Pub/Sub     | 8102 | (used internally via PUBSUB_EMULATOR_HOST)    |
| Fake GCS    | 8103 | http://localhost:8103/storage/v1/b            |

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

## Testing

Tests use **fake repositories** (in-memory) via dependency injection, so no external services are required:

```bash
pnpm run test          # Run all tests
ppnpm run test:coverage # Run with coverage
```

## See Also

- [Local Development Guide](../docs/setup/05-local-dev-with-gcp-deps.md)
- [Cloud Run Services](../docs/setup/04-cloud-run-services.md)
