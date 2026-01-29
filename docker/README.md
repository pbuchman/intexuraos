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

This starts:

- Firebase Emulator (Firestore + Pub/Sub + Auth)
- Fake GCS Server
- All 18 services via PM2 with auto-restart

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
