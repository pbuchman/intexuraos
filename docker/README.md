# Docker

Container configurations for local development.

## Overview

Local development uses a **Pub/Sub emulator** for message isolation. Firestore
and Google Cloud Storage use the retained GCP project through an explicitly
selected least-privilege identity. Runtime configuration is rendered from an
exact numeric DEV secret-package version before containers start.

This setup provides:

- **Isolated messaging**: Pub/Sub messages stay local, preventing cross-contamination with production
- **Real data**: Firestore and GCS use actual cloud resources for realistic testing
- **Simple onboarding**: No large data syncs or complex multi-emulator orchestration

## Quick Start

```bash
# Start Pub/Sub emulator
pnpm run emulators:start

# Stop
pnpm run emulators:stop

# View logs
pnpm run emulators:logs
```

This leaves exactly **2 persistent Docker containers**. The lifecycle first starts the emulator,
builds the UI image, runs one explicit idempotent `bootstrap.mjs` process in a disposable `--rm`
container, and only then starts the non-mutating long-running server:

| Service         | Image                                                     | Ports |
| --------------- | --------------------------------------------------------- | ----- |
| pubsub-emulator | gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators | 8102  |
| pubsub-ui       | Built from tools/pubsub-ui                                | 8105  |

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

### How pubsub-ui works

The bridge reads the closed topic-to-endpoint mapping from `tools/pubsub-ui/topology.mjs`:

```javascript
{
  name: 'intex-message-ingest',
  endpoint: 'http://host.docker.internal:8134/internal/intex-agent/messages',
}
```

When a message is published to `intex-message-ingest`, pubsub-ui:

1. Pulls the message from the emulator
2. POSTs it to `http://localhost:8134/internal/intex-agent/messages`
3. Acknowledges the message after successful delivery

## Environment Variables

The Docker Compose setup requires two environment variables:

- `INTEXURAOS_INTERNAL_AUTH_TOKEN` - Authenticates forwarded messages to service endpoints
- `INTEXURAOS_GCP_PROJECT_ID` - GCP project ID for emulator configuration

These are read from the shell environment (via direnv) at `docker compose up` time.

**Setup:**

```bash
# Render one reviewed DEV package version (creates mode-0600 .envrc)
./scripts/sync-secrets.sh --version <dev-numeric-version>

# Copy local overrides template
cp .envrc.local.example .envrc.local

# Allow direnv to load variables
direnv allow
```

`sync-secrets.sh` fetches only `INTEXURAOS_SECRET_PACKAGE_DEV`, validates CRC32C,
schema, environment, and exact membership, then atomically renders the local
projection. It never reads individual legacy secrets and never accepts
`latest`. `.envrc.local` is for host-only overrides; do not copy shared secret
values into it.

Docker receives only the variables declared by Compose. The Pub/Sub emulator
does not need the package, a service-account JSON file, or Secret Manager IAM.
Any local container that uses retained Firestore/GCS receives only an explicit
short-lived or separately managed least-privilege credential, mounted
read-only. DEV intentionally contains no GCP service-account JSON. Never mount
`.envrc`, a full package payload, or an operator/provisioner credential.

## Files

| File                               | Purpose                                 |
| ---------------------------------- | --------------------------------------- |
| `docker/docker-compose.local.yaml` | Pub/Sub emulator + UI                   |
| `tools/pubsub-ui/`                 | Message bridge source code              |
| `tools/pubsub-ui/topology.mjs`     | Topic → endpoint/classification mapping |

## Troubleshooting

### Pub/Sub messages not being processed

**Symptom:** Actions stay in `pending` status, no processing happens.

**Cause:** The `pubsub-ui` container isn't running.

**Fix:**

```bash
# Check both containers are running
docker compose -f docker/docker-compose.local.yaml ps

# If pubsub-ui is missing, run the full explicit lifecycle:
pnpm run emulators:start
```

### "Topic not found" errors in service logs

**Symptom:** Service logs show `5 NOT_FOUND: Topic not found`.

**Cause:** The explicit one-shot bootstrap did not establish the tracked topics and monitor
subscriptions before the non-mutating `pubsub-ui` server started. The long-running server never
creates resources and will fail closed when they are missing.

**Fix:** Inspect the bootstrap, then rerun the local Compose stack and only restart an affected
publisher after both bootstrap and UI health pass:

```bash
docker compose -f docker/docker-compose.local.yaml logs pubsub-ui
pnpm run emulators:start
curl -fsS http://localhost:8105/health | jq -e '.drainContractVersion == 1 and .drain.topologyMatch == true'
pnpm exec pm2 restart <service-name>
```

### Verifying Pub/Sub is working

```bash
# 1. Check pubsub-ui health
curl http://localhost:8105/health | jq '.topics | length'
# Should return 14

# 2. Publish a test message
curl -X POST http://localhost:8105/publish \
  -H "Content-Type: application/json" \
  -d '{"topic": "intex-message-ingest", "data": {"type": "intex.message.ingest", "userId": "test-user", "message": "create a note", "sourceType": "whatsapp_text", "whatsappMessageId": "wamid.test", "whatsappSender": "+15551234567"}}'

# 3. Check pubsub-ui logs for forwarding
docker compose -f docker/docker-compose.local.yaml logs pubsub-ui --tail 10
```

## See Also

- [Local Development Guide](../docs/setup/05-local-dev-with-gcp-deps.md)
- [Cloud Run Services](../docs/setup/04-cloud-run-services.md)
