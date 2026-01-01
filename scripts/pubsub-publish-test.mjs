#!/usr/bin/env node
/**
 * Publish test events to Pub/Sub for local development.
 * Usage: node scripts/pubsub-publish-test.mjs [event-type]
 *
 * Event types:
 *   - media-cleanup
 *   - send-message
 *   - all (publishes one of each)
 */
import { PubSub } from '@google-cloud/pubsub';

const PROJECT_ID = process.env.PUBSUB_PROJECT_ID || 'demo-intexuraos';

const pubsub = new PubSub({ projectId: PROJECT_ID });

const EVENTS = {
  'media-cleanup': {
    topic: 'whatsapp-media-cleanup',
    data: {
      type: 'whatsapp.media.cleanup',
      userId: 'test-user-123',
      messageId: 'msg-' + Date.now(),
      gcsPaths: [
        'whatsapp/test-user-123/msg-123/photo.jpg',
        'whatsapp/test-user-123/msg-123/photo_thumb.jpg',
      ],
      timestamp: new Date().toISOString(),
    },
  },
  'send-message': {
    topic: 'whatsapp-send-message',
    data: {
      type: 'whatsapp.message.send',
      userId: 'test-user-456',
      phoneNumber: '+48123456789',
      message: 'Test message from Pub/Sub at ' + new Date().toLocaleTimeString(),
      correlationId: 'corr-' + Date.now(),
      timestamp: new Date().toISOString(),
    },
  },
  'commands-ingest': {
    topic: 'commands-ingest',
    data: {
      type: 'command.ingest',
      userId: 'test-user-789',
      sourceType: 'whatsapp_text',
      externalId: 'msg-' + Date.now(),
      text: 'Research latest AI developments',
      timestamp: new Date().toISOString(),
    },
  },
};

async function publishEvent(eventType) {
  const eventConfig = EVENTS[eventType];
  if (!eventConfig) {
    console.error(`Unknown event type: ${eventType}`);
    console.error('Available types:', Object.keys(EVENTS).join(', '));
    return;
  }

  const topic = pubsub.topic(eventConfig.topic);

  const [exists] = await topic.exists();
  if (!exists) {
    await topic.create();
    console.log(`Created topic: ${eventConfig.topic}`);
  }

  const dataBuffer = Buffer.from(JSON.stringify(eventConfig.data));
  const messageId = await topic.publishMessage({ data: dataBuffer });

  console.log(`✅ Published ${eventType} event`);
  console.log(`   Topic: ${eventConfig.topic}`);
  console.log(`   Message ID: ${messageId}`);
  console.log(`   Data:`, JSON.stringify(eventConfig.data, null, 2));
}

const args = process.argv.slice(2);
const eventType = args[0] || 'all';

if (eventType === 'all') {
  console.log('Publishing all event types...\n');
  for (const type of Object.keys(EVENTS)) {
    await publishEvent(type);
    console.log('');
  }
} else {
  await publishEvent(eventType);
}

console.log('\n🎯 Check http://localhost:8105 to see the events in the UI!');
