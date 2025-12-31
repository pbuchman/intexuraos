import express from 'express';
import { PubSub } from '@google-cloud/pubsub';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8105;
const PROJECT_ID = process.env.PUBSUB_PROJECT_ID || 'demo-intexuraos';

const TOPICS = [
  'whatsapp-media-cleanup',
  'whatsapp-send-message',
  'commands-ingest',
  'actions-research',
];

const app = express();
const clients = new Set();

const pubsub = new PubSub({ projectId: PROJECT_ID });

async function setupTopicsAndSubscriptions() {
  console.log('[PubSub UI] Setting up topics and subscriptions...');

  for (const topicName of TOPICS) {
    try {
      const topic = pubsub.topic(topicName);
      const [exists] = await topic.exists();

      if (!exists) {
        await topic.create();
        console.log(`[PubSub UI] Created topic: ${topicName}`);
      }

      const subscriptionName = `${topicName}-ui-monitor`;
      const subscription = topic.subscription(subscriptionName);
      const [subExists] = await subscription.exists();

      if (!subExists) {
        await subscription.create();
        console.log(`[PubSub UI] Created subscription: ${subscriptionName}`);
      }

      subscription.on('message', (message) => {
        const event = {
          topic: topicName,
          messageId: message.id,
          publishTime: message.publishTime,
          data: JSON.parse(message.data.toString()),
          attributes: message.attributes,
          receivedAt: new Date().toISOString(),
        };

        console.log(`[PubSub UI] Received message on ${topicName}:`, event.data.type);

        broadcastToClients({
          type: 'event',
          event,
        });

        message.ack();
      });

      subscription.on('error', (error) => {
        console.error(`[PubSub UI] Subscription error on ${topicName}:`, error);
      });

      console.log(`[PubSub UI] Listening on ${topicName}`);
    } catch (error) {
      console.error(`[PubSub UI] Error setting up ${topicName}:`, error);
    }
  }

  console.log('[PubSub UI] All topics configured');
}

function broadcastToClients(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => {
    client.write(message);
  });
}

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.add(res);

  res.write(`data: ${JSON.stringify({ type: 'connected', topics: TOPICS })}\n\n`);

  req.on('close', () => {
    clients.delete(res);
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', topics: TOPICS, clients: clients.size });
});

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

setupTopicsAndSubscriptions()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[PubSub UI] Dashboard running at http://localhost:${PORT}`);
      console.log(`[PubSub UI] Monitoring ${TOPICS.length} topics`);
    });
  })
  .catch((error) => {
    console.error('[PubSub UI] Failed to start:', error);
    process.exit(1);
  });
