import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ProdAppSummary {
  name: string;
  cwd: string;
  args: string[];
  env: Record<string, string | undefined>;
  filter_env?: string[];
}

interface ProdConfigSummary {
  apps: ProdAppSummary[];
}

const EXPECTED_SERVICES = [
  ['app-settings-service', '8122'],
  ['notion-service', '8112'],
  ['whatsapp-service', '8113'],
  ['mobile-notifications-service', '8114'],
  ['fishing-assistant-service', '8119'],
  ['notes-agent', '8121'],
  ['bookmarks-agent', '8124'],
  ['code-agent', '8128'],
  ['cron-agent', '8130'],
  ['hellscript-agent', '8131'],
  ['llm-usage-service', '8132'],
  ['user-service', '8110'],
  ['commands-agent', '8117'],
  ['actions-agent', '8118'],
  ['research-agent', '8116'],
  ['todos-agent', '8123'],
  ['image-service', '8120'],
  ['calendar-agent', '8125'],
  ['linear-agent', '8126'],
  ['chat-agent', '8129'],
  ['web-agent', '8127'],
  ['api-docs-hub', '8133'],
] as const;

const PROD_ENV = {
  HOME: '/home/deploy',
  PATH: process.env.PATH ?? '',
  INTEXURAOS_ENVIRONMENT: 'prod',
  INTEXURAOS_GCP_PROJECT_ID: 'intexuraos-dev-pbuchman',
};

const APP_SETTINGS_DEPENDENT_SERVICES = new Set([
  'user-service',
  'commands-agent',
  'actions-agent',
  'research-agent',
  'todos-agent',
  'image-service',
  'calendar-agent',
  'linear-agent',
  'chat-agent',
  'web-agent',
]);

const WAIT_SCRIPT = resolve(process.cwd(), 'scripts/pm2-wait-start.mjs');
const REMOVED_OBSERVABILITY_PREFIX = ['INTEXURAOS', `DA${'SH0'}`].join('_');

function loadProdConfig(env: Record<string, string | undefined> = PROD_ENV): ProdConfigSummary {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const config = require('./ecosystem.config.prod.cjs');
        process.stdout.write(JSON.stringify({
          apps: config.apps.map((app) => ({
            name: app.name,
            cwd: app.cwd,
            args: app.args,
            env: app.env,
            filter_env: app.filter_env,
          })),
        }));
      `,
    ],
    {
      cwd: process.cwd(),
      env,
    }
  );

  return JSON.parse(stdout.toString()) as ProdConfigSummary;
}

function loadProdConfigFailureMessage(env: Record<string, string | undefined>): string {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        try {
          require('./ecosystem.config.prod.cjs');
          process.stdout.write('NO_ERROR');
        } catch (error) {
          process.stdout.write(error.message);
        }
      `,
    ],
    {
      cwd: process.cwd(),
      env,
    }
  );

  return stdout.toString();
}

describe('ecosystem.config.prod.cjs', () => {
  it('refuses to load unless INTEXURAOS_ENVIRONMENT is prod', () => {
    expect(
      loadProdConfigFailureMessage({ HOME: '/home/deploy', PATH: process.env.PATH ?? '' })
    ).toBe('Refusing to start PM2 without INTEXURAOS_ENVIRONMENT=prod');
  });

  it('contains the exact Hetzner backend service inventory and no web dev server', () => {
    const config = loadProdConfig();
    expect(config.apps.map((app) => [app.name, app.env.PORT])).toEqual(EXPECTED_SERVICES);
    expect(config.apps.some((app) => app.name === 'web')).toBe(false);
    expect(config.apps.some((app) => app.name === 'data-insights-agent')).toBe(false);
  });

  it('sets production runtime env without Pub/Sub emulator leakage', () => {
    const config = loadProdConfig({
      ...PROD_ENV,
      PUBSUB_EMULATOR_HOST: 'localhost:8085',
      INTEXURAOS_GITHUB_APP_PRIVATE_KEY: 'github-private-key',
      INTEXURAOS_LINEAR_API_KEY: 'linear-api-key',
      INTEXURAOS_MINIMAX_APP_API_KEY: 'minimax-key',
      INTEXURAOS_SENTRY_AUTH_TOKEN: 'sentry-auth-token',
      INTEXURAOS_SSL_PRIVATE_KEY: 'ssl-private-key',
    });

    for (const app of config.apps) {
      expect(app.env.INTEXURAOS_ENVIRONMENT, app.name).toBe('prod');
      expect(app.env.INTEXURAOS_RUNTIME, app.name).toBe('prod');
      expect(app.env.NODE_ENV, app.name).toBe('production');
      expect(app.env.GOOGLE_APPLICATION_CREDENTIALS, app.name).toBe(
        '/home/deploy/runtime-sa-key.json'
      );
      expect(app.filter_env, app.name).toContain('INTEXURAOS_');
      expect(app.filter_env, app.name).toContain('GOOGLE_APPLICATION_CREDENTIALS');
      expect(app.filter_env, app.name).toContain(
        'HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS'
      );
      expect(app.filter_env, app.name).toContain('CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE');
      expect(app.env.PUBSUB_EMULATOR_HOST, app.name).toBeUndefined();
      expect(app.env.INTEXURAOS_GITHUB_APP_PRIVATE_KEY, app.name).toBeUndefined();
      expect(app.env.INTEXURAOS_LINEAR_API_KEY, app.name).toBeUndefined();
      expect(app.env.INTEXURAOS_MINIMAX_APP_API_KEY, app.name).toBeUndefined();
      expect(app.env.INTEXURAOS_SENTRY_AUTH_TOKEN, app.name).toBeUndefined();
      expect(app.env.INTEXURAOS_SSL_PRIVATE_KEY, app.name).toBeUndefined();
      expect(app.env[`${REMOVED_OBSERVABILITY_PREFIX}_AUTH_TOKEN`], app.name).toBeUndefined();
      expect(app.env[`${REMOVED_OBSERVABILITY_PREFIX}_OTLP_ENDPOINT`], app.name).toBeUndefined();
      expect(app.env.NODE_OPTIONS, app.name).toBeUndefined();
    }
  });

  it('parses the prod env file without mutating the launcher process environment', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'intexuraos-prod-env-'));
    const envFile = resolve(tempDir, '.env.prod');

    try {
      writeFileSync(
        envFile,
        [
          'INTEXURAOS_ENVIRONMENT="prod"',
          'GOOGLE_APPLICATION_CREDENTIALS="/home/deploy/runtime-sa-key.json"',
          'INTEXURAOS_INTERNAL_AUTH_TOKEN="from-env-file"',
          'INTEXURAOS_WHATSAPP_ACCESS_TOKEN="from-env-file"',
        ].join('\n')
      );

      const stdout = execFileSync(
        process.execPath,
        [
          '-e',
          `
            const config = require('./ecosystem.config.prod.cjs');
            const whatsapp = config.apps.find((app) => app.name === 'whatsapp-service');
            process.stdout.write(JSON.stringify({
              processSecret: process.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN ?? null,
              appSecret: whatsapp.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
            }));
          `,
        ],
        {
          cwd: process.cwd(),
          env: {
            HOME: '/home/deploy',
            PATH: process.env.PATH ?? '',
            INTEXURAOS_PROD_ENV_FILE: envFile,
          },
        }
      );

      expect(JSON.parse(stdout.toString())).toEqual({
        processSecret: null,
        appSecret: 'from-env-file',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prefers the prod env file over launcher credential and secret overrides', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'intexuraos-prod-env-'));
    const envFile = resolve(tempDir, '.env.prod');

    try {
      writeFileSync(
        envFile,
        [
          'INTEXURAOS_ENVIRONMENT="prod"',
          'GOOGLE_APPLICATION_CREDENTIALS="/home/deploy/runtime-sa-key.json"',
          'INTEXURAOS_INTERNAL_AUTH_TOKEN="runtime-token"',
          'INTEXURAOS_WHATSAPP_ACCESS_TOKEN="runtime-whatsapp-token"',
        ].join('\n')
      );

      const config = loadProdConfig({
        HOME: '/home/deploy',
        PATH: process.env.PATH ?? '',
        INTEXURAOS_PROD_ENV_FILE: envFile,
        GOOGLE_APPLICATION_CREDENTIALS: '/home/deploy/provisioner-sa-key.json',
        HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS: '/home/deploy/provisioner-sa-key.json',
        CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: '/home/deploy/provisioner-sa-key.json',
        INTEXURAOS_WHATSAPP_ACCESS_TOKEN: 'launcher-whatsapp-token',
      });
      const byName = new Map(config.apps.map((app) => [app.name, app]));

      expect(byName.get('whatsapp-service')?.env.GOOGLE_APPLICATION_CREDENTIALS).toBe(
        '/home/deploy/runtime-sa-key.json'
      );
      expect(byName.get('whatsapp-service')?.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN).toBe(
        'runtime-whatsapp-token'
      );
      expect(
        byName.get('whatsapp-service')?.env.HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS
      ).toBeUndefined();
      expect(
        byName.get('whatsapp-service')?.env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE
      ).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes runtime secrets only to the services that need them', () => {
    const config = loadProdConfig({
      ...PROD_ENV,
      INTEXURAOS_AUTH0_CLIENT_ID: 'auth0-client',
      INTEXURAOS_GEMINI_APP_API_KEY: 'gemini-key',
      INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET: 'github-oauth-secret',
      INTEXURAOS_GUEST_SESSION_SECRET: 'guest-session-secret',
      INTEXURAOS_INTERNAL_AUTH_TOKEN: 'internal-token',
      INTEXURAOS_OPENAI_APP_API_KEY: 'openai-key',
      INTEXURAOS_OPENROUTER_APP_API_KEY: 'openrouter-key',
      INTEXURAOS_ORCHESTRATOR_SECRET: 'orchestrator-secret',
      INTEXURAOS_WHATSAPP_ACCESS_TOKEN: 'whatsapp-token',
    });
    const byName = new Map(config.apps.map((app) => [app.name, app]));

    expect(byName.get('whatsapp-service')?.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN).toBe(
      'whatsapp-token'
    );
    expect(byName.get('user-service')?.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN).toBeUndefined();
    expect(byName.get('notion-service')?.env.INTEXURAOS_INTERNAL_AUTH_TOKEN).toBe('internal-token');
    expect(byName.get('notion-service')?.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN).toBeUndefined();
    expect(byName.get('chat-agent')?.env.INTEXURAOS_GUEST_SESSION_SECRET).toBe(
      'guest-session-secret'
    );
    expect(byName.get('code-agent')?.env.INTEXURAOS_OPENROUTER_APP_API_KEY).toBe('openrouter-key');
    expect(byName.get('whatsapp-service')?.env.INTEXURAOS_OPENROUTER_APP_API_KEY).toBeUndefined();
    expect(byName.get('user-service')?.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET).toBe(
      'github-oauth-secret'
    );
    expect(byName.get('chat-agent')?.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET).toBeUndefined();
  });

  it('waits for app-settings-service before starting app-settings-dependent services', () => {
    const config = loadProdConfig();

    for (const app of config.apps) {
      if (APP_SETTINGS_DEPENDENT_SERVICES.has(app.name)) {
        expect(app.args, app.name).toEqual([WAIT_SCRIPT, 'src/index.ts']);
        expect(app.env.WAIT_FOR_SERVICE, app.name).toBe('http://127.0.0.1:8122/health');
      } else {
        expect(app.args, app.name).toEqual(['src/index.ts']);
        expect(app.env.WAIT_FOR_SERVICE, app.name).toBeUndefined();
      }
    }
  });

  it('uses localhost service URLs and retained GCP topic names for prod-on-Hetzner', () => {
    const config = loadProdConfig();
    const byName = new Map(config.apps.map((app) => [app.name, app]));

    expect(byName.get('actions-agent')?.env.INTEXURAOS_COMMANDS_AGENT_URL).toBe(
      'http://127.0.0.1:8117'
    );
    expect(byName.get('linear-agent')?.env.INTEXURAOS_CODE_AGENT_URL).toBe('http://127.0.0.1:8128');
    expect(byName.get('linear-agent')?.env.INTEXURAOS_SERVICE_URL).toBe(
      'https://intexuraos.cloud/api/linear'
    );
    expect(byName.get('code-agent')?.env.INTEXURAOS_SERVICE_URL).toBe(
      'https://intexuraos.cloud/api/code'
    );
    expect(byName.get('code-agent')?.env.INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL).toBe(
      'https://intexuraos.cloud/api/code'
    );
    expect(byName.get('whatsapp-service')?.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC).toBe(
      'intexuraos-whatsapp-send-dev'
    );
    expect(byName.get('commands-agent')?.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE).toBe(
      'intexuraos-actions-queue-dev'
    );
    expect(byName.get('research-agent')?.env.INTEXURAOS_PUBSUB_LLM_CALL_TOPIC).toBe(
      'intexuraos-llm-call-dev'
    );
  });
});
