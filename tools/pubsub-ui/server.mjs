import express from 'express';
import { PubSub } from '@google-cloud/pubsub';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8105;
const PROJECT_ID = process.env.PUBSUB_PROJECT_ID || 'demo-intexuraos';
const INTEXURAOS_INTERNAL_AUTH_TOKEN =
  process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN || 'local-dev-token';

const TOPICS = [
  'whatsapp-media-cleanup',
  'whatsapp-send-message',
  'whatsapp-webhook-process',
  'whatsapp-transcription',
  'commands-ingest',
  'actions-queue',
  'approval-reply',
  'research-process',
  'llm-analytics',
  'llm-call',
  'bookmark-enrich',
  'bookmark-summarize',
  'todos-processing-local',
];

const TOPIC_ENDPOINTS = {
  'whatsapp-send-message': 'http://host.docker.internal:8113/internal/whatsapp/pubsub/send-message',
  'whatsapp-media-cleanup':
    'http://host.docker.internal:8113/internal/whatsapp/pubsub/media-cleanup',
  'whatsapp-webhook-process':
    'http://host.docker.internal:8113/internal/whatsapp/pubsub/process-webhook',
  'whatsapp-transcription':
    'http://host.docker.internal:8113/internal/whatsapp/pubsub/transcribe-audio',
  'commands-ingest': 'http://host.docker.internal:8117/internal/commands',
  'actions-queue': 'http://host.docker.internal:8118/internal/actions/process',
  'approval-reply': 'http://host.docker.internal:8118/internal/actions/approval-reply',
  'research-process': 'http://host.docker.internal:8116/internal/llm/pubsub/process-research',
  'llm-analytics': 'http://host.docker.internal:8116/internal/llm/pubsub/report-analytics',
  'llm-call': 'http://host.docker.internal:8116/internal/llm/pubsub/process-llm-call',
  'bookmark-enrich': 'http://host.docker.internal:8124/internal/bookmarks/pubsub/enrich',
  'bookmark-summarize': 'http://host.docker.internal:8124/internal/bookmarks/pubsub/summarize',
  'todos-processing-local':
    'http://host.docker.internal:8123/internal/todos/pubsub/todos-processing',
};

const app = express();
app.use(express.json());
const clients = new Set();

const pubsub = new PubSub({ projectId: PROJECT_ID });

async function forwardToServiceEndpoint(topicName, message) {
  const endpoint = TOPIC_ENDPOINTS[topicName];
  if (!endpoint) {
    console.log(`[PubSub UI] No endpoint configured for topic: ${topicName}`);
    return;
  }

  try {
    const pubsubMessage = {
      message: {
        data: message.data.toString('base64'),
        messageId: message.id,
        publishTime: message.publishTime,
      },
      subscription: `${topicName}-push`,
    };

    console.log(`[PubSub UI] ┌─ Forwarding ${topicName}`);
    console.log(`[PubSub UI] │  Endpoint: ${endpoint}`);
    console.log(`[PubSub UI] │  Message ID: ${message.id}`);
    console.log(`[PubSub UI] │  Data size: ${message.data.length} bytes`);
    console.log(`[PubSub UI] │  Auth token (full): ${INTEXURAOS_INTERNAL_AUTH_TOKEN}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': INTEXURAOS_INTERNAL_AUTH_TOKEN,
      },
      body: JSON.stringify(pubsubMessage),
    });

    if (response.ok) {
      const responseBody = await response.text();
      console.log(`[PubSub UI] └─ Response: ${response.status} ${response.statusText}`);
      if (responseBody) {
        console.log(`[PubSub UI]    Body:`, responseBody);
      }
    } else {
      const errorBody = await response.text();
      console.error(`[PubSub UI] └─ ERROR: ${response.status} ${response.statusText}`);
      if (errorBody) {
        console.error(`[PubSub UI]    Body:`, errorBody);
      }
    }
  } catch (error) {
    console.error(`[PubSub UI] └─ EXCEPTION: ${error.message}`);
    console.error(`[PubSub UI]    Stack:`, error.stack);
  }
}

async function setupTopicsAndSubscriptions() {
  console.log('[PubSub UI] ===========================================');
  console.log('[PubSub UI] Configuration:');
  console.log('[PubSub UI]   PORT:', PORT);
  console.log('[PubSub UI]   PROJECT_ID:', PROJECT_ID);
  console.log('[PubSub UI]   PUBSUB_EMULATOR_HOST:', process.env.PUBSUB_EMULATOR_HOST);
  console.log(
    '[PubSub UI]   AUTH_TOKEN:',
    INTEXURAOS_INTERNAL_AUTH_TOKEN ? '***' + INTEXURAOS_INTERNAL_AUTH_TOKEN.slice(-4) : 'NOT SET'
  );
  console.log('[PubSub UI]   TOPICS:', TOPICS);
  console.log('[PubSub UI]   ENDPOINTS:');
  Object.entries(TOPIC_ENDPOINTS).forEach(([topic, endpoint]) => {
    console.log(`[PubSub UI]     ${topic} -> ${endpoint}`);
  });
  console.log('[PubSub UI] ===========================================');
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

      subscription.on('message', async (message) => {
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

        await forwardToServiceEndpoint(topicName, message);

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

app.post('/publish', async (req, res) => {
  const { topic, data } = req.body;

  if (!topic || !data) {
    return res.status(400).json({ error: 'Missing topic or data' });
  }

  if (!TOPICS.includes(topic)) {
    return res.status(400).json({ error: `Invalid topic. Valid topics: ${TOPICS.join(', ')}` });
  }

  try {
    const pubsubTopic = pubsub.topic(topic);
    const dataBuffer = Buffer.from(JSON.stringify(data));
    const messageId = await pubsubTopic.publishMessage({ data: dataBuffer });

    console.log(`[PubSub UI] ✓ Published manual event to ${topic}`);
    console.log(`[PubSub UI]   Message ID: ${messageId}`);
    console.log(`[PubSub UI]   Data:`, JSON.stringify(data, null, 2));

    res.json({ success: true, messageId, topic });
  } catch (error) {
    console.error(`[PubSub UI] ✗ Failed to publish to ${topic}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

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
