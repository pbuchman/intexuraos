import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface WhatsAppPubSubEnv {
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: string;
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: string;
  INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: string;
  INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: string;
  INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: string;
  INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: string;
  INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: string;
  INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC: string;
}

function loadWhatsAppPubSubEnv(): WhatsAppPubSubEnv {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const config = require('./ecosystem.config.cjs');
        const app = config.apps.find((entry) => entry.name === 'whatsapp-service');
        if (!app) {
          throw new Error('whatsapp-service missing from ecosystem config');
        }

        const env = app.env;
        process.stdout.write(JSON.stringify({
          INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC,
          INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION,
          INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC,
          INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION,
          INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: env.INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC,
          INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: env.INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC,
          INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: env.INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC,
          INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC: env.INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC,
        }));
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME ?? '/tmp',
        PATH: process.env.PATH ?? '',
      },
    }
  );

  return JSON.parse(stdout.toString()) as WhatsAppPubSubEnv;
}

function loadWhatsAppLinkProducerWebAppEnv(): Record<string, string | undefined> {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const config = require('./ecosystem.config.cjs');
        const names = ${JSON.stringify(['actions-agent', 'code-agent', 'mobile-notifications-service', 'research-agent'])};
        const result = {};
        for (const name of names) {
          const app = config.apps.find((entry) => entry.name === name);
          if (!app) {
            throw new Error(name + ' missing from ecosystem config');
          }
          result[name] = app.env.INTEXURAOS_WEB_APP_URL;
        }
        process.stdout.write(JSON.stringify(result));
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME ?? '/tmp',
        PATH: process.env.PATH ?? '',
      },
    }
  );

  return JSON.parse(stdout.toString()) as Record<string, string | undefined>;
}

describe('ecosystem.config.cjs', () => {
  it('uses home-dev Pub/Sub emulator aliases for whatsapp-service fallbacks', () => {
    expect(loadWhatsAppPubSubEnv()).toEqual({
      INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'whatsapp-send-message',
      INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: 'whatsapp-send-message-push',
      INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: 'whatsapp-media-cleanup',
      INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: 'whatsapp-media-cleanup-push',
      INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: 'commands-ingest',
      INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: 'whatsapp-webhook-process',
      INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: 'whatsapp-transcription',
      INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC: 'approval-reply',
    });
  });

  it('uses externally reachable dev web app URL for WhatsApp link producers', () => {
    expect(loadWhatsAppLinkProducerWebAppEnv()).toEqual({
      'actions-agent': 'https://dev.intexuraos.cloud',
      'code-agent': 'https://dev.intexuraos.cloud',
      'mobile-notifications-service': 'https://dev.intexuraos.cloud',
      'research-agent': 'https://dev.intexuraos.cloud',
    });
  });
});
