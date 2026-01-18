#!/usr/bin/env node
/**
 * Publish test events to Pub/Sub for local development.
 * Usage: node scripts/pubsub-publish-test.mjs [event-type]
 *
 * Event types:
 *   - media-cleanup
 *   - send-message
 *   - webhook-process
 *   - transcription
 *   - commands-ingest
 *   - actions-queue
 *   - research-process
 *   - llm-analytics
 *   - llm-call
 *   - bookmark-enrich
 *   - bookmark-summarize
 *   - todos-processing
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
      message: 'Test message from Pub/Sub at ' + new Date().toLocaleTimeString(),
      correlationId: 'corr-' + Date.now(),
      timestamp: new Date().toISOString(),
    },
  },
  'webhook-process': {
    topic: 'whatsapp-webhook-process',
    data: {
      type: 'whatsapp.webhook.process',
      eventId: 'evt-' + Date.now(),
      payload: {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'test-business-account',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: 'test-phone-id',
                  },
                  messages: [
                    {
                      from: '+9876543210',
                      id: 'msg-' + Date.now(),
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body: 'Test webhook message' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      },
      phoneNumberId: 'test-phone-id',
      receivedAt: new Date().toISOString(),
    },
  },
  transcription: {
    topic: 'whatsapp-transcription',
    data: {
      type: 'whatsapp.audio.transcribe',
      messageId: 'msg-' + Date.now(),
      userId: 'test-user-456',
      gcsPaths: 'whatsapp/test-user-456/audio-' + Date.now() + '.ogg',
      mimeType: 'audio/ogg',
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
  'actions-queue': {
    topic: 'actions-queue',
    data: {
      type: 'action.created',
      actionId: 'action-' + Date.now(),
      userId: 'test-user-101',
      commandId: 'cmd-' + Date.now(),
      actionType: 'research',
      title: 'Research Task',
      payload: {
        prompt: 'Research latest AI developments',
        confidence: 0.95,
        selectedLlms: ['google', 'anthropic'],
      },
      timestamp: new Date().toISOString(),
    },
  },
  'research-process': {
    topic: 'research-process',
    data: {
      type: 'research.process',
      researchId: 'research-' + Date.now(),
      userId: 'test-user-101',
      triggeredBy: 'action-' + Date.now(),
    },
  },
  'llm-analytics': {
    topic: 'llm-analytics',
    data: {
      type: 'llm.report',
      researchId: 'research-' + Date.now(),
      userId: 'test-user-101',
      provider: 'google',
      model: 'gemini-2.0-flash-exp',
      inputTokens: 1024,
      outputTokens: 512,
      durationMs: 1500,
    },
  },
  'llm-call': {
    topic: 'llm-call',
    data: {
      type: 'llm.call',
      researchId: 'research-' + Date.now(),
      userId: 'test-user-101',
      model: 'gemini-2.0-flash-exp',
      prompt: 'Research latest AI developments',
    },
  },
  'bookmark-enrich': {
    topic: 'bookmark-enrich',
    data: {
      type: 'bookmarks.enrich',
      bookmarkId: 'bookmark-' + Date.now(),
      userId: 'test-user-303',
      url: 'https://example.com/article-' + Date.now(),
    },
  },
  'bookmark-summarize': {
    topic: 'bookmark-summarize',
    data: {
      type: 'bookmarks.summarize',
      bookmarkId: 'bookmark-' + Date.now(),
      userId: 'test-user-303',
    },
  },
  'todos-processing': {
    topic: 'todos-processing-local',
    data: {
      type: 'todos.processing.created',
      todoId: 'todo-' + Date.now(),
      userId: 'test-user-202',
      correlationId: 'corr-' + Date.now(),
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
