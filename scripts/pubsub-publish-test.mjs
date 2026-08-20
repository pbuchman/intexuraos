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
 *   - intex-message-ingest
 *   - research-process
 *   - llm-analytics
 *   - llm-call
 *   - bookmark-enrich
 *   - bookmark-summarize
 *   - message-digest-run
 *   - runtime-credential-canary
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
    topic: 'whatsapp-audio-stored',
    data: {
      type: 'whatsapp.audio.stored',
      messageId: 'msg-' + Date.now(),
      userId: 'test-user-456',
      mediaId: 'media-' + Date.now(),
      gcsPath: 'whatsapp/test-user-456/audio-' + Date.now() + '.ogg',
      mimeType: 'audio/ogg',
      timestamp: new Date().toISOString(),
    },
  },
  'intex-message-ingest': {
    topic: 'intex-message-ingest',
    data: {
      type: 'intex.message.ingest',
      userId: 'test-user-789',
      sourceType: 'whatsapp_text',
      messageId: 'wamid.test-' + Date.now(),
      text: 'Create a calendar event for tomorrow at 10 for planning',
      whatsappSender: '+15551234567',
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
      provider: 'openrouter',
      model: 'or:google/gemini-3.6-flash',
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
      model: 'or:google/gemini-3.6-flash',
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
  'message-digest-run': {
    topic: 'message-digest-runs',
    data: {
      type: 'message-digest.run',
      version: 1,
      userId: 'test-user-404',
      definitionId: 'md_test-digest-001',
      runId: 'mdr_test-run-001',
      requestedAt: new Date().toISOString(),
    },
  },
  'runtime-credential-canary': {
    topic: 'intexuraos-runtime-credential-canary-dev',
    data: {
      type: 'runtime.credential.canary',
      canary: 'manual-local',
      requestedAt: new Date().toISOString(),
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
