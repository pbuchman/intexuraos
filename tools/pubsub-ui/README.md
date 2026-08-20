# Pub/Sub Event Monitor UI

Real-time web dashboard for monitoring Pub/Sub events during local development.

## Features

- **Live event stream** - See events as they arrive via Server-Sent Events (SSE)
- **Color-coded topics** - Each topic has a distinct color for easy identification
- **Expandable JSON** - Click any event to see full message payload
- **Topic filtering** - Show/hide events by topic
- **Event statistics** - Track total event count in real-time
- **Auto-configured push subscriptions** - Automatically sets up push endpoints to service handlers

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
| `message-digest-runs`                      | Amber        | Message Digest generation   |
| `intexuraos-runtime-credential-canary-dev` | Cyan         | Runtime credential canary   |

## Architecture

```
┌─────────────────┐
│  Pub/Sub        │
│  Emulator       │
│  :8102          │
└────────┬────────┘
         │
         ├─────────────────────┬──────────────────────┐
         │ (push)              │ (pull-monitor)       │
         ▼                     ▼                      │
  ┌─────────────┐      ┌──────────────┐              │
  │  Services   │      │  Pub/Sub UI  │◀─────────────┘
  │  :8113,8118 │      │  :8105       │
  │  (POST /    │      └──────┬───────┘
  │  internal/) │             │ (SSE)
  └─────────────┘             ▼
                       ┌──────────────┐
                       │   Browser    │
                       │  Dashboard   │
                       └──────────────┘
```

**The UI performs two functions:**

1. **Monitoring (pull subscriptions):**
   - Creates pull subscriptions (`*-ui-monitor`) for all topics
   - Forwards events to browser via Server-Sent Events (SSE)
   - Displays real-time event stream in dashboard

2. **Worker setup (push subscriptions):**
   - Auto-creates push subscriptions on startup
   - Configures Pub/Sub to POST events to service endpoints
   - Services receive events at `/internal/*/pubsub/*` endpoints

**Push endpoints configured:**

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
PORT=8105 \
node server.mjs
```

## Adding New Topics

Edit `server.mjs` and add to the `TOPICS` array:

```javascript
const TOPICS = [
  'whatsapp-media-cleanup',
  'whatsapp-send-message',
  'whatsapp-webhook-process',
  'whatsapp-audio-stored',
  'whatsapp-transcription-completed',
  'intex-message-ingest',
  'research-process',
  'llm-analytics',
  'llm-call',
  'bookmark-enrich',
  'bookmark-summarize',
  'message-digest-runs',
  'your-new-topic', // Add here
];
```

The UI will automatically:

- Create the topic if it doesn't exist
- Create a monitoring subscription
- Start displaying events
- Add a filter button
