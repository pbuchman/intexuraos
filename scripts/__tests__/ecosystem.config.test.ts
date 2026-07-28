import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface WhatsAppPubSubEnv {
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: string;
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: string;
  INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: string;
  INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: string;
  INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: string;
  INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC: string;
  INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: string;
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
const MATRIX_CORPUS_ENV_NAMES = [
  'INTEXURAOS_MATRIX_CORPUS_ENABLED',
  'INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME',
  'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE',
  'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
  'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
  'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
  'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
] as const;
const TEST_RUNS_READ_FLAG = 'INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED' as const;
const TERRAFORM_DEV_MAIN = readFileSync('terraform/environments/dev/main.tf', 'utf8');

function loadDevConfig(extraEnv: Record<string, string> = {}): DevConfigSummary {
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
        ...extraEnv,
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
          INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: env.INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC,
          INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC: env.INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC,
          INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: env.INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC,
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
        const names = ${JSON.stringify(['code-agent', 'intex-agent', 'mobile-notifications-service', 'research-agent'])};
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

function loadInheritedEmulatorEnv(): Record<string, Record<string, string | undefined>> {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8101';
        process.env.STORAGE_EMULATOR_HOST = 'http://localhost:8103';
        process.env.PUBSUB_EMULATOR_HOST = 'stale-pubsub:9999';
        const config = require('./ecosystem.config.cjs');
        const result = {};
        for (const app of config.apps) {
          result[app.name] = {
            FIRESTORE_EMULATOR_HOST: app.env.FIRESTORE_EMULATOR_HOST,
            STORAGE_EMULATOR_HOST: app.env.STORAGE_EMULATOR_HOST,
            PUBSUB_EMULATOR_HOST: app.env.PUBSUB_EMULATOR_HOST,
          };
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

  return JSON.parse(stdout.toString()) as Record<string, Record<string, string | undefined>>;
}

describe('ecosystem.config.cjs', () => {
  it('propagates an explicit validated release SHA to every Home Dev backend', () => {
    const releaseSha = '1234567890abcdef1234567890abcdef12345678';
    const config = loadDevConfig({ INTEXURAOS_COMMIT_SHA: releaseSha });

    expect(config.apps).not.toHaveLength(0);
    for (const app of config.apps) {
      expect(app.env.INTEXURAOS_COMMIT_SHA, app.name).toBe(releaseSha);
    }
  });

  it('falls back to the exact git HEAD for every Home Dev backend', () => {
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    const config = loadDevConfig({ INTEXURAOS_COMMIT_SHA: 'UNKNOWN' });

    expect(expected).toMatch(/^[0-9a-f]{40}$/u);
    for (const app of config.apps) {
      expect(app.env.INTEXURAOS_COMMIT_SHA, app.name).toBe(expected);
    }
  });

  it('omits release without crashing when neither env nor git yields an exact SHA', () => {
    const config = loadDevConfig({
      INTEXURAOS_COMMIT_SHA: 'invalid',
      PATH: '',
    });

    for (const app of config.apps) {
      expect(app.env.INTEXURAOS_COMMIT_SHA, app.name).toBeUndefined();
    }
  });

  it('declares exactly the production Matrix corpus runtime secrets in Terraform', () => {
    const matrixCorpusSection =
      TERRAFORM_DEV_MAIN.split('# Production Matrix corpus evaluator')[1]?.split(
        '# Firebase configuration for web app'
      )[0] ?? '';

    expect(matrixCorpusSection).not.toBe('');
    expect(matrixCorpusSection).not.toMatch(/synthetic-|home-dev|BEGIN PRIVATE|contact@/);
    for (const name of MATRIX_CORPUS_ENV_NAMES.slice(3)) {
      expect(matrixCorpusSection.match(new RegExp(`"${name}"`, 'g'))?.length, name).toBe(1);
    }
    for (const name of MATRIX_CORPUS_ENV_NAMES.slice(0, 3)) {
      expect(matrixCorpusSection, name).not.toContain(`"${name}"`);
    }
  });

  it('passes the closed Matrix corpus tuples only to WhatsApp and Intex in Home Dev', () => {
    const seeded = Object.fromEntries(
      MATRIX_CORPUS_ENV_NAMES.map((name, index) => [name, `synthetic-${String(index)}`])
    );
    seeded['INTEXURAOS_MATRIX_CORPUS_ENABLED'] = 'true';
    seeded['INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME'] = 'home-dev';
    seeded['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] = 'home-dev';
    const config = loadDevConfig(seeded);
    const byName = new Map(config.apps.map((app) => [app.name, app.env]));
    const whatsapp = byName.get('whatsapp-service');
    const intex = byName.get('intex-agent');

    expect(whatsapp).toMatchObject(
      Object.fromEntries(MATRIX_CORPUS_ENV_NAMES.slice(0, 10).map((name) => [name, seeded[name]]))
    );
    expect(whatsapp?.INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY).toBeUndefined();
    expect(intex).toMatchObject({
      INTEXURAOS_MATRIX_CORPUS_ENABLED: 'true',
      INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'home-dev',
      INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'home-dev',
      INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID:
        seeded['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'],
      INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION:
        seeded['INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION'],
      INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY:
        seeded['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'],
      INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION:
        seeded['INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION'],
      INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY:
        seeded['INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY'],
    });
    for (const name of MATRIX_CORPUS_ENV_NAMES.slice(4, 8)) {
      expect(intex?.[name], name).toBeUndefined();
    }
    expect(intex?.INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY).toBeUndefined();

    for (const app of config.apps) {
      if (app.name === 'whatsapp-service' || app.name === 'intex-agent') continue;
      for (const name of MATRIX_CORPUS_ENV_NAMES) {
        if (
          app.name === 'user-service' &&
          (name === 'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE' ||
            name === 'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID')
        )
          continue;
        expect(app.env[name], `${app.name} ${name}`).toBeUndefined();
      }
    }
  });

  it('keeps User Service Test Runs disabled with its required production audience while preserving Home Dev Matrix reads for Intex Agent', () => {
    const config = loadDevConfig({
      INTEXURAOS_MATRIX_CORPUS_ENABLED: 'true',
      INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'home-dev',
      INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'home-dev',
      INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: 'auth0:evaluator',
      [TEST_RUNS_READ_FLAG]: 'ambient-false-must-not-win',
    });
    const byName = new Map(config.apps.map((app) => [app.name, app.env]));

    expect(byName.get('user-service')?.[TEST_RUNS_READ_FLAG]).toBe('false');
    expect(byName.get('user-service')?.INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE).toBe(
      'hetzner-prod'
    );
    expect(byName.get('user-service')?.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID).toBe(
      'auth0:evaluator'
    );

    expect(byName.get('intex-agent')?.[TEST_RUNS_READ_FLAG]).toBe('true');
    expect(byName.get('intex-agent')?.INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE).toBe('home-dev');
    expect(byName.get('intex-agent')?.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID).toBe(
      'auth0:evaluator'
    );
    for (const app of config.apps) {
      if (app.name === 'user-service' || app.name === 'intex-agent') continue;
      expect(app.env[TEST_RUNS_READ_FLAG], app.name).toBeUndefined();
    }
  });

  it('keeps Test Runs reads disabled unless the complete trusted Home Dev tuple is explicit', () => {
    const config = loadDevConfig({
      INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'home-dev',
      INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: 'auth0:evaluator',
      [TEST_RUNS_READ_FLAG]: 'true',
    });
    const byName = new Map(config.apps.map((app) => [app.name, app.env]));

    expect(byName.get('user-service')?.[TEST_RUNS_READ_FLAG]).toBe('false');
    expect(byName.get('intex-agent')?.[TEST_RUNS_READ_FLAG]).toBe('false');
  });

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
      INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: 'whatsapp-audio-stored',
      INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC: 'intex-message-ingest',
      INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: 'whatsapp-webhook-process',
    });
  });

  it('uses externally reachable dev web app URL for WhatsApp link producers', () => {
    expect(loadWhatsAppLinkProducerWebAppEnv()).toEqual({
      'code-agent': 'https://dev.intexuraos.cloud',
      'intex-agent': 'https://dev.intexuraos.cloud',
      'mobile-notifications-service': 'https://dev.intexuraos.cloud',
      'research-agent': 'https://dev.intexuraos.cloud',
    });
  });

  it('does not inherit NODE_OPTIONS into PM2 service environments', () => {
    expect(loadInheritedNodeOptions()).toEqual({});
  });

  it('overrides local datastore emulators while pinning Pub/Sub to the local emulator', () => {
    const envByApp = loadInheritedEmulatorEnv();

    for (const [appName, env] of Object.entries(envByApp)) {
      expect(env.FIRESTORE_EMULATOR_HOST, appName).toBe('');
      expect(env.STORAGE_EMULATOR_HOST, appName).toBe('');
      expect(env.PUBSUB_EMULATOR_HOST, appName).toBe('localhost:8102');
    }
  });

  it('forces home-dev runtime environment tags even when the shell exports stale values', () => {
    const config = loadDevConfig({
      INTEXURAOS_ENVIRONMENT: 'development',
      INTEXURAOS_RUNTIME: 'development',
    });

    for (const app of config.apps) {
      expect(app.env.INTEXURAOS_ENVIRONMENT, app.name).toBe('dev');
      expect(app.env.INTEXURAOS_RUNTIME, app.name).toBe('dev');
    }
  });

  it('passes the untracked selector subject and platform key to User Service only while enabled', () => {
    const absent = loadDevConfig();
    const absentUserService = absent.apps.find((app) => app.name === 'user-service');

    expect(absentUserService?.env.INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID).toBe('disabled');
    expect(absentUserService?.env.INTEXURAOS_OPENROUTER_APP_API_KEY).toBeUndefined();

    const empty = loadDevConfig({
      INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID: '',
      INTEXURAOS_OPENROUTER_APP_API_KEY: 'platform-openrouter-key',
    });
    const emptyUserService = empty.apps.find((app) => app.name === 'user-service');

    expect(emptyUserService?.env.INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID).toBe('disabled');
    expect(emptyUserService?.env.INTEXURAOS_OPENROUTER_APP_API_KEY).toBeUndefined();

    const enabled = loadDevConfig({
      INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID: 'machine-local-subject',
      INTEXURAOS_OPENROUTER_APP_API_KEY: 'platform-openrouter-key',
    });
    const enabledUserService = enabled.apps.find((app) => app.name === 'user-service');

    expect(enabledUserService?.env.INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID).toBe(
      'machine-local-subject'
    );
    expect(enabledUserService?.env.INTEXURAOS_OPENROUTER_APP_API_KEY).toBe(
      'platform-openrouter-key'
    );
    for (const app of enabled.apps) {
      if (app.name !== 'user-service') {
        expect(app.env.INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID, app.name).toBeUndefined();
      }
    }

    const disabled = loadDevConfig({
      INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID: 'disabled',
      INTEXURAOS_OPENROUTER_APP_API_KEY: 'platform-openrouter-key',
    });
    const disabledUserService = disabled.apps.find((app) => app.name === 'user-service');

    expect(disabledUserService?.env.INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID).toBe('disabled');
    expect(disabledUserService?.env.INTEXURAOS_OPENROUTER_APP_API_KEY).toBeUndefined();
  });

  it('keeps the production Terraform selector fail-closed without a tracked subject or User Service key grant', () => {
    const terraform = readFileSync('terraform/environments/dev/main.tf', 'utf8');

    expect(terraform).toContain('INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID = "disabled"');
    expect(terraform).not.toMatch(/auth0\|/u);
    expect(terraform).toContain('INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED = "false"');
  });

  it('documents home-dev Sentry DSNs with the canonical dev environment label', () => {
    const envExample = readFileSync('.envrc.local.example', 'utf8');

    expect(envExample).toContain('export INTEXURAOS_ENVIRONMENT=dev');
    expect(envExample).not.toContain('export INTEXURAOS_ENVIRONMENT=development');
    expect(envExample).toMatch(/INTEXURAOS_SENTRY_DSN=.*\/4510703655321680"/);
    expect(envExample).toMatch(/INTEXURAOS_SENTRY_DSN_WEB=.*\/4510703657812048"/);
    expect(envExample).toContain('export INTEXURAOS_SENTRY_WEBHOOK_SECRET=');
    expect(envExample).toContain('export INTEXURAOS_SENTRY_AUTOMATION_USER_ID=');
    expect(envExample).toContain(
      'export INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY=pbuchman/intexuraos'
    );
    expect(envExample).toContain('export INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH=development');
  });
});
