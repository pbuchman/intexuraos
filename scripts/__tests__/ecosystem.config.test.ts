import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface WhatsAppPubSubEnv {
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: string;
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: string;
  INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: string;
  INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: string;
  INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: string;
  INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC: string;
  INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: string;
  INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: string;
  INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC: string;
}

interface DevAppSummary {
  name: string;
  env: Record<string, string | undefined>;
}

interface DevConfigSummary {
  apps: DevAppSummary[];
}

const REMOVED_AGENT_NAMES = ['todos', 'chat', 'cron'].map((name) => `${name}-agent`);
const REMOVED_AGENT_ENV_KEYS = ['TODOS', 'CHAT', 'CRON'].flatMap((name) => [
  `INTEXURAOS_${name}_AGENT_URL`,
  `INTEXURAOS_${name}_AGENT_OPENAPI_URL`,
]);
const REMOVED_TOPIC_ENV_KEY = ['INTEXURAOS', 'TODOS', 'PROCESSING', 'TOPIC'].join('_');

function loadDevConfig(): DevConfigSummary {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const config = require('./ecosystem.config.cjs');
        process.stdout.write(JSON.stringify({
          apps: config.apps.map((app) => ({
            name: app.name,
            env: app.env,
          })),
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

  return JSON.parse(stdout.toString()) as DevConfigSummary;
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
          INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC: env.INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC,
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

function loadInheritedNodeOptions(): Record<string, string | undefined> {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        process.env.NODE_OPTIONS = process.env.FAKE_NODE_OPTIONS;
        const config = require('./ecosystem.config.cjs');
        const result = {};
        for (const app of config.apps) {
          result[app.name] = app.env.NODE_OPTIONS;
        }
        process.stdout.write(JSON.stringify(result));
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME ?? '/tmp',
        PATH: process.env.PATH ?? '',
        FAKE_NODE_OPTIONS: '--import ./removed-preload/register',
      },
    }
  );

  return JSON.parse(stdout.toString()) as Record<string, string | undefined>;
}

describe('ecosystem.config.cjs', () => {
  it('omits removed agents and their shared runtime URLs from dev PM2 config', () => {
    const config = loadDevConfig();
    const names = config.apps.map((app) => app.name);

    for (const removed of REMOVED_AGENT_NAMES) {
      expect(names).not.toContain(removed);
    }

    for (const app of config.apps) {
      for (const envKey of REMOVED_AGENT_ENV_KEYS) {
        expect(app.env[envKey], `${app.name} ${envKey}`).toBeUndefined();
      }
      expect(app.env[REMOVED_TOPIC_ENV_KEY], app.name).toBeUndefined();
      expect(app.env.INTEXURAOS_GUEST_SESSION_SECRET, app.name).toBeUndefined();
    }
  });

  it('uses home-dev Pub/Sub emulator aliases for whatsapp-service fallbacks', () => {
    expect(loadWhatsAppPubSubEnv()).toEqual({
      INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'whatsapp-send-message',
      INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: 'whatsapp-send-message-push',
      INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: 'whatsapp-media-cleanup',
      INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: 'whatsapp-media-cleanup-push',
      INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: 'commands-ingest',
      INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC: 'intex-message-ingest',
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

  it('does not inherit NODE_OPTIONS into PM2 service environments', () => {
    expect(loadInheritedNodeOptions()).toEqual({});
  });
});
