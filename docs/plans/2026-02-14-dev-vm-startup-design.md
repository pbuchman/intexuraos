# Dev VM Startup & Local Dev Simplification

**Date:** 2026-02-14
**Status:** Approved

## Problem

The dev VM has no reliable boot sequence. After reboot:

1. Docker emulators don't auto-start (no restart policy, no systemd unit)
2. PM2 resurrects services without direnv, so env vars are missing
3. Services crash-loop waiting for emulators and missing secrets

Additionally, the local dev Docker Compose is overweight: it runs Firestore, Firebase Auth, GCS, and Pub/Sub emulators when only Pub/Sub actually needs local emulation (Firestore and GCS use real GCP, Firebase Auth is handled by Auth0).

## Design

### Docker Compose: Pub/Sub Only

Replace the current 3-container setup (firebase-emulator, fake-gcs, pubsub-ui) with 2 lightweight containers:

```yaml
services:
  pubsub-emulator:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators
    ports:
      - '8102:8102'
    command: gcloud beta emulators pubsub start --host-port=0.0.0.0:8102 --project=demo-intexuraos
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8102']
      interval: 5s
      timeout: 3s
      start_period: 10s
      retries: 5

  pubsub-ui:
    build:
      context: ../tools/pubsub-ui
      dockerfile: Dockerfile
    ports:
      - '8105:8105'
    environment:
      - PUBSUB_EMULATOR_HOST=pubsub-emulator:8102
      - PUBSUB_PROJECT_ID=${INTEXURAOS_GCP_PROJECT_ID:-demo-intexuraos}
      - PORT=8105
      - INTEXURAOS_INTERNAL_AUTH_TOKEN=${INTEXURAOS_INTERNAL_AUTH_TOKEN}
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    depends_on:
      pubsub-emulator:
        condition: service_healthy
```

**Why Pub/Sub stays local:** Multiple environments sharing GCP Pub/Sub topics causes message duplication/splitting. Local emulator provides complete isolation.

**Why everything else uses real GCP:** Firestore, GCS, and Firebase Auth work via ADC with the service account key. No emulation overhead needed.

### Project-Wide Cleanup

Remove all references to:

- `FIREBASE_AUTH_EMULATOR_HOST` — source code, configs, docs, examples
- `STORAGE_EMULATOR_HOST` — configs, docs, examples
- `FIRESTORE_EMULATOR_HOST` — configs, docs, examples
- `fake-gcs` container and `-local` bucket name patterns
- Firebase emulator container, `firebase.json` emulator config
- Firestore sync/export scripts and data directories

### Environment Changes

**`ecosystem.config.cjs`:**

- Remove `FIREBASE_AUTH_EMULATOR_HOST: 'localhost:8104'`

**`.envrc.local` (dev VM):**

- Change bucket names to real GCS (drop `-local` suffix)

**`.envrc.local.example`:**

- Remove Firestore/GCS/Firebase Auth emulator sections
- Keep Pub/Sub emulator section (the one local dependency)
- Bucket names point to real GCS

### Systemd Boot Sequence (Dev VM)

Boot order:

1. Docker daemon starts
2. `intexuraos-emulators.service` starts Pub/Sub emulator + pubsub-ui via `direnv exec`
3. `pm2-pbuchman.service` (depends on emulators) starts all app services via `direnv exec`

**New: `/etc/systemd/system/intexuraos-emulators.service`**

- `After=docker.service`
- `ExecStart=direnv exec /home/pbuchman/deploy/intexuraos docker compose -f docker/docker-compose.local.yaml up -d`
- Waits for Pub/Sub emulator health

**Modified: `/etc/systemd/system/pm2-pbuchman.service`**

- Add `After=intexuraos-emulators.service`
- Change ExecStart to: `direnv exec /home/pbuchman/deploy/intexuraos pm2 resurrect`

Docker Compose env vars (like `INTEXURAOS_INTERNAL_AUTH_TOKEN`) are read from the shell environment at `docker compose up` time via `direnv exec`.

### Documentation Refresh

Rewrite `docs/setup/05-local-dev-with-gcp-deps.md` as the canonical local dev guide:

- One setup that works on any Unix machine
- Docker Compose = Pub/Sub emulator + pubsub-ui only
- How to sync secrets from GCP Secret Manager
- How to run the full stack locally (manual)
- How to auto-start on a persistent dev VM (systemd setup)

## Files Changed

| File                                       | Action   | Description                                        |
| ------------------------------------------ | -------- | -------------------------------------------------- |
| `docker/docker-compose.local.yaml`         | Modified | 2 containers: pubsub-emulator + pubsub-ui          |
| `ecosystem.config.cjs`                     | Modified | Remove FIREBASE_AUTH_EMULATOR_HOST                 |
| `.envrc.local`                             | Modified | Real GCS bucket names                              |
| `.envrc.local.example`                     | Modified | Remove emulator sections, single canonical setup   |
| `docs/setup/05-local-dev-with-gcp-deps.md` | Rewrite  | Canonical local dev guide                          |
| `firebase.json`                            | Remove   | Only used by removed firebase-emulator container   |
| Project-wide                               | Cleanup  | Remove FIREBASE_AUTH_EMULATOR_HOST references      |
| Project-wide                               | Cleanup  | Remove STORAGE_EMULATOR_HOST references            |
| Project-wide                               | Cleanup  | Remove FIRESTORE_EMULATOR_HOST references          |
| Project-wide                               | Cleanup  | Remove fake-gcs and -local bucket patterns         |
| Project-wide                               | Cleanup  | Remove Firestore sync/export scripts and data dirs |
| systemd units (VM only, not in repo)       | Created  | intexuraos-emulators.service, updated pm2 service  |
