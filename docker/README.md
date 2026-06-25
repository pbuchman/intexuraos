# Docker

Container configurations for local development.

## Overview

Local development uses a **Pub/Sub emulator** for message isolation. All other GCP services (Firestore, Google Cloud Storage) use **real GCP** via Application Default Credentials (ADC).

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

This starts **2 Docker containers**:

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

The bridge reads topic-to-endpoint mappings from `tools/pubsub-ui/topics.json`:

```json
{
  "intex-message-ingest": {
    "endpoint": "http://localhost:8134/internal/intex-agent/messages",
    "description": "Route WhatsApp text messages into Intex"
  }
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
# Sync secrets from GCP Secret Manager (creates .envrc)
./scripts/sync-secrets.sh

# Copy local overrides template
cp .envrc.local.example .envrc.local

# Allow direnv to load variables
direnv allow
```

## Files

| File                               | Purpose                    |
| ---------------------------------- | -------------------------- |
| `docker/docker-compose.local.yaml` | Pub/Sub emulator + UI      |
| `tools/pubsub-ui/`                 | Message bridge source code |
| `tools/pubsub-ui/topics.json`      | Topic → endpoint mapping   |

## Troubleshooting

### Pub/Sub messages not being processed

**Symptom:** Actions stay in `pending` status, no processing happens.

**Cause:** The `pubsub-ui` container isn't running.

**Fix:**

```bash
# Check both containers are running
docker compose -f docker/docker-compose.local.yaml ps

# If pubsub-ui is missing, restart all:
docker compose -f docker/docker-compose.local.yaml up -d --build
```

### "Topic not found" errors in service logs

**Symptom:** Service logs show `5 NOT_FOUND: Topic not found`.

**Cause:** pubsub-ui creates topics on startup. If services started before pubsub-ui was ready, the topics don't exist yet.

**Fix:** Restart the affected service after pubsub-ui is fully running:

```bash
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
