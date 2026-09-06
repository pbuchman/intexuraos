# Pub/Sub Event Monitor UI

Real-time web dashboard for monitoring Pub/Sub events during local development.

## Features

- **Live event stream** - See events as they arrive via Server-Sent Events (SSE)
- **Color-coded topics** - Each topic has a distinct color for easy identification
- **Expandable JSON** - Click any event to see full message payload
- **Topic filtering** - Show/hide events by topic
- **Event statistics** - Track total event count in real-time
- **Explicit local bridge topology** - Forwards only the tracked, classified monitor subscriptions
- **Drain health contract** - Reports privacy-safe topology, listener, handler, and monotonic counters

## Quick Start

The UI is automatically started when you run:

```bash
pnpm run dev
```

Then open: **http://localhost:8105**

## Publishing Test Events

Use the helper script to publish test events:

```bash
# Publish all event types
node scripts/pubsub-publish-test.mjs all

# Publish specific event type
node scripts/pubsub-publish-test.mjs media-cleanup
node scripts/pubsub-publish-test.mjs send-message
node scripts/pubsub-publish-test.mjs webhook-process
node scripts/pubsub-publish-test.mjs transcription
node scripts/pubsub-publish-test.mjs intex-message-ingest
node scripts/pubsub-publish-test.mjs research-process
node scripts/pubsub-publish-test.mjs llm-analytics
node scripts/pubsub-publish-test.mjs llm-call
node scripts/pubsub-publish-test.mjs bookmark-enrich
node scripts/pubsub-publish-test.mjs bookmark-summarize
node scripts/pubsub-publish-test.mjs message-digest-run
node scripts/pubsub-publish-test.mjs runtime-credential-canary
```

## Monitored Topics

| Topic                                      | Color        | Event Type                  |
| ------------------------------------------ | ------------ | --------------------------- |
| `whatsapp-media-cleanup`                   | Purple       | Media file deletion         |
| `whatsapp-send-message`                    | Green        | Outbound WhatsApp messages  |
| `whatsapp-webhook-process`                 | Light Purple | WhatsApp webhook processing |
| `whatsapp-audio-stored`                    | Light Green  | Audio transcription input   |
| `whatsapp-transcription-completed`         | Light Green  | Audio transcription result  |
| `intex-message-ingest`                     | Blue         | Intex Agent message routing |
| `research-process`                         | Blue         | Research task processing    |
| `llm-analytics`                            | Indigo       | LLM usage analytics         |
| `llm-call`                                 | Purple       | LLM API calls               |
| `bookmark-enrich`                          | Orange       | Bookmark metadata enriching |
| `bookmark-summarize`                       | Teal         | Bookmark AI summarization   |
| `pr-triage`                                | Purple       | Pull-request triage         |
| `message-digest-runs`                      | Amber        | Message Digest generation   |
| `intexuraos-runtime-credential-canary-dev` | Cyan         | Runtime credential canary   |

## Architecture

```
┌─────────────────┐   (pull listeners)   ┌──────────────┐
│  Pub/Sub        │ ────────────────────▶ │  Pub/Sub UI  │
│  Emulator :8102 │                       │  :8105       │
└─────────────────┘                       └──────┬───────┘
                                                │
                         ┌──────────────────────┴─────────────────────┐
                         │ (HTTP bridge)                              │ (SSE)
                         ▼                                            ▼
                ┌──────────────────┐                         ┌────────────────┐
                │ Local services   │                         │ Browser        │
                │ /internal/*      │                         │ Dashboard      │
                └──────────────────┘                         └────────────────┘
```

The local stack separates mutation from observation:

1. **One-shot bootstrap process (`bootstrap.mjs`):**
   - Idempotently creates the tracked local topics and `*-ui-monitor` subscriptions
   - Is invoked explicitly by the full local `emulators:start`/DEV resume lifecycle before the
     long-running bridge starts
   - Runs in a disposable `--rm` container built from the same image and closes its Pub/Sub clients;
     it does not add a third persistent container

2. **Long-running UI/bridge (`server.mjs`):**
   - Verifies that every required topic and subscription already exists; missing resources fail closed
   - Attaches exactly one listener to every explicitly classified monitor subscription
   - Forwards classified events to the corresponding local service handler
   - Forwards events to browser via Server-Sent Events (SSE)
   - Displays real-time event stream in dashboard

**Bridge forwarding endpoints configured:**

- `whatsapp-send-message` → `POST /internal/whatsapp/pubsub/send-message` (:8113)
- `whatsapp-media-cleanup` → `POST /internal/whatsapp/pubsub/media-cleanup` (:8113)
- `whatsapp-webhook-process` → `POST /internal/whatsapp/pubsub/process-webhook` (:8113)
- `whatsapp-transcription-completed` → `POST /internal/whatsapp/pubsub/transcription-completed` (:8113)
- `intex-message-ingest` → `POST /internal/intex-agent/messages` (:8134)
- `research-process` → `POST /internal/llm/pubsub/process-research` (:8116)
- `llm-analytics` → `POST /internal/llm/pubsub/report-analytics` (:8116)
- `llm-call` → `POST /internal/llm/pubsub/process-llm-call` (:8116)
- `bookmark-enrich` → `POST /internal/bookmarks/pubsub/enrich` (:8124)
- `bookmark-summarize` → `POST /internal/bookmarks/pubsub/summarize` (:8124)
- `pr-triage` → `POST /internal/code/pubsub/pr-triage` (:8128)
- `message-digest-runs` → `POST /internal/message-digests/pubsub/run` (:8135)

`intexuraos-runtime-credential-canary-dev` has no service endpoint. Its local
monitor subscription consumes only manual canary events; the Terraform-owned
production topic deliberately has no subscription.

## Environment Variables

| Variable                           | Default                               | Description                                 |
| ---------------------------------- | ------------------------------------- | ------------------------------------------- |
| `PUBSUB_EMULATOR_HOST`             | `firebase-emulator:8102`              | Pub/Sub emulator address                    |
| `PUBSUB_PROJECT_ID`                | `demo-intexuraos`                     | Default emulator project ID                 |
| `MESSAGE_DIGEST_PUBSUB_PROJECT_ID` | `intexuraos-message-digest-mvp-local` | Isolated Message Digest emulator project ID |
| `PORT`                             | `8105`                                | UI server port                              |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`   | `local-dev-token`                     | Token for push endpoint auth header         |

Message Digest events use a separate emulator project so their lifecycle remains isolated from
other local service data until the coordinated production cutover. The forwarder also listens for
`whatsapp-send-message` in both the default and isolated projects, because Message Digest publishes
its delivery outbox through the same isolated local client; manual UI publishing remains on the
default project.

## Development

To run standalone (outside docker-compose):

```bash
cd tools/pubsub-ui
pnpm install
PUBSUB_EMULATOR_HOST=localhost:8102 \
PUBSUB_PROJECT_ID=demo-intexuraos \
node bootstrap.mjs

PUBSUB_EMULATOR_HOST=localhost:8102 \
PUBSUB_PROJECT_ID=demo-intexuraos \
PORT=8105 \
node server.mjs
```

## Drain health

`GET /health` retains `status`, `topics`, and `clients`, and adds
`drainContractVersion: 2` plus a privacy-safe `drain` object. Every request refreshes topology with
non-mutating `ListTopics` and `ListSubscriptions` calls. A match requires the exact active target
topology with one listener per target and the exact preserved-legacy topology with zero listeners.
A missing, unexpected, orphaned, unclassified, listener-less target, duplicated, listened-to legacy,
or unrefreshable subscription makes `topologyMatch` false. Preserved legacy subscriptions remain
backlog/recovery resources and are never consumed by this bridge. The contract exposes only resource
names, classifications, counts, SHA-256 topology hashes,
process identity fields, and timestamps; it never exposes message payloads, IDs, attributes, ack
IDs, callback data, or secrets. `topologyObservationSequence` advances only after a successful
topology refresh; drain evidence requires it to advance with every independently collected health
observation while the process epoch and topology hashes remain continuous.
`topologyRefreshErrorsTotal` is a process-lifetime monotonic counter that advances on every failed
refresh, including failures that share a timestamp with a later successful observation.

## Adding New Topics

Edit `topology.mjs` and add one explicit entry to `TOPIC_CONFIGS`:

```javascript
const TOPIC_CONFIGS = [
  // ...
  {
    name: 'your-new-topic',
    endpoint: 'http://host.docker.internal:8123/internal/example/pubsub/handle',
  },
];
```

Use `endpoint: null` only for an intentional `monitor-only` topic. Then run `pnpm run
emulators:start`; its explicit lifecycle performs the one-shot bootstrap before starting the UI.
The UI image entrypoint itself never mutates topology and will refuse to report a matching topology
until the topic and its monitor subscription exist. A bridge-only restart or M7.0 telemetry
activation must never invoke `bootstrap.mjs`.

- Add the matching dashboard metadata when the topic should be visible in the browser filter.
