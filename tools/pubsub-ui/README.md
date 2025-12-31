# Pub/Sub Event Monitor UI

Real-time web dashboard for monitoring Pub/Sub events during local development.

## Features

- 🔴 **Live event stream** - See events as they arrive via Server-Sent Events (SSE)
- 🎨 **Color-coded topics** - Each topic has a distinct color for easy identification
- 🔍 **Expandable JSON** - Click any event to see full message payload
- 🎯 **Topic filtering** - Show/hide events by topic
- 📊 **Event statistics** - Track total event count in real-time

## Quick Start

The UI is automatically started when you run:

```bash
npm run dev
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
node scripts/pubsub-publish-test.mjs commands-ingest
```

## Monitored Topics

| Topic                    | Color  | Event Type                 |
| ------------------------ | ------ | -------------------------- |
| `whatsapp-media-cleanup` | Purple | Media file deletion        |
| `whatsapp-send-message`  | Green  | Outbound WhatsApp messages |
| `commands-ingest`        | Orange | Command routing            |
| `actions-research`       | Cyan   | Research requests          |

## Architecture

```
┌─────────────────┐
│  Pub/Sub        │
│  Emulator       │
│  :8102          │
└────────┬────────┘
         │
         ├─────────────────────┐
         │                     │
         ▼                     ▼
  ┌─────────────┐      ┌──────────────┐
  │  Services   │      │  Pub/Sub UI  │
  │  (push/pull)│      │  :8105       │
  └─────────────┘      └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │   Browser    │
                       │  (SSE client)│
                       └──────────────┘
```

The UI:

1. Creates pull subscriptions for all topics
2. Forwards events to browser via Server-Sent Events
3. Acknowledges messages after broadcasting

## Environment Variables

| Variable               | Default                | Description              |
| ---------------------- | ---------------------- | ------------------------ |
| `PUBSUB_EMULATOR_HOST` | `pubsub-emulator:8102` | Pub/Sub emulator address |
| `PUBSUB_PROJECT_ID`    | `demo-intexuraos`      | GCP project ID           |
| `PORT`                 | `8105`                 | UI server port           |

## Development

To run standalone (outside docker-compose):

```bash
cd tools/pubsub-ui
npm install
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
  'commands-ingest',
  'actions-research',
  'your-new-topic', // Add here
];
```

The UI will automatically:

- Create the topic if it doesn't exist
- Create a monitoring subscription
- Start displaying events
- Add a filter button
