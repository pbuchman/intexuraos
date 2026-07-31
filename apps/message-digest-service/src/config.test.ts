import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadConfig,
  REQUIRED_MESSAGE_DIGEST_ENV,
  validateMessageDigestConfigEnv,
} from './config.js';

const originalEnv = { ...process.env };

describe('message-digest-service config', () => {
  beforeEach(() => {
    process.env = requiredEnvironment();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('declares the exact required environment contract', () => {
    expect(REQUIRED_MESSAGE_DIGEST_ENV).toEqual([
      'INTEXURAOS_GCP_PROJECT_ID',
      'INTEXURAOS_AUTH_JWKS_URL',
      'INTEXURAOS_AUTH_ISSUER',
      'INTEXURAOS_AUTH_AUDIENCE',
      'INTEXURAOS_INTERNAL_AUTH_TOKEN',
      'INTEXURAOS_WHATSAPP_SERVICE_URL',
      'INTEXURAOS_LLM_USAGE_SERVICE_URL',
      'INTEXURAOS_OPENROUTER_APP_API_KEY',
      'INTEXURAOS_DIGEST_LLM_MODEL',
      'INTEXURAOS_PUBSUB_MESSAGE_DIGEST_RUN_TOPIC',
      'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
      'INTEXURAOS_WEB_APP_URL',
    ]);
  });

  it('uses port 8135 by default and loads the production contract', () => {
    delete process.env['PORT'];
    const config = loadConfig();

    expect(config).toMatchObject({
      port: 8135,
      gcpProjectId: 'synthetic-project',
      firestoreProjectId: 'synthetic-project',
      pubsubProjectId: 'synthetic-project',
      storageMode: 'persistent',
      authJwksUrl: 'https://auth.invalid/jwks',
      authIssuer: 'https://auth.invalid/',
      authAudience: 'urn:synthetic:api',
      internalAuthToken: 'synthetic-internal-token',
      whatsappServiceUrl: 'http://127.0.0.1:8113',
      llmUsageServiceUrl: 'http://127.0.0.1:8132',
      openRouterAppApiKey: 'synthetic-openrouter-key',
      digestLlmModel: 'or:synthetic/model',
      messageDigestRunTopic: 'synthetic-message-digest-run',
      whatsappSendTopic: 'synthetic-whatsapp-send',
      webAppUrl: 'http://127.0.0.1:3000',
      environment: 'production',
      runtime: 'prod',
    });
    expect(config.firestoreEmulatorHost).toBeUndefined();
    expect(config.pubsubEmulatorHost).toBeUndefined();
  });

  it('reports every missing or blank required variable without exposing values', () => {
    delete process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'];
    process.env['INTEXURAOS_DIGEST_LLM_MODEL'] = '   ';

    expect(validateMessageDigestConfigEnv()).toEqual([
      'INTEXURAOS_WHATSAPP_SERVICE_URL',
      'INTEXURAOS_DIGEST_LLM_MODEL',
    ]);
    expect(() => loadConfig()).toThrow(
      'Missing required message-digest-service environment variables: INTEXURAOS_WHATSAPP_SERVICE_URL, INTEXURAOS_DIGEST_LLM_MODEL'
    );
  });

  it('fails closed when a required value disappears after validation', () => {
    let projectIdReads = 0;
    const unstableEnvironment = new Proxy(requiredEnvironment(), {
      get(target, property, receiver): unknown {
        if (property === 'INTEXURAOS_GCP_PROJECT_ID') {
          projectIdReads += 1;
          return projectIdReads === 1 ? 'synthetic-project' : undefined;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(() => loadConfig(unstableEnvironment)).toThrow(
      'Required message-digest-service environment variable became unavailable: INTEXURAOS_GCP_PROJECT_ID'
    );
  });

  it('pins local MVP persistence and publication to both isolated emulators', () => {
    process.env['INTEXURAOS_RUNTIME'] = 'dev';
    process.env['INTEXURAOS_ENVIRONMENT'] = 'development';
    process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8101';
    process.env['PUBSUB_EMULATOR_HOST'] = '127.0.0.1:8102';

    expect(loadConfig()).toMatchObject({
      storageMode: 'emulator',
      firestoreProjectId: 'intexuraos-message-digest-mvp-local',
      pubsubProjectId: 'intexuraos-message-digest-mvp-local',
      firestoreEmulatorHost: '127.0.0.1:8101',
      pubsubEmulatorHost: '127.0.0.1:8102',
      runtime: 'dev',
    });
  });

  it('defaults an omitted runtime to dev when both local emulators are configured', () => {
    delete process.env['INTEXURAOS_RUNTIME'];
    process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8101';
    process.env['PUBSUB_EMULATOR_HOST'] = '127.0.0.1:8102';

    expect(loadConfig()).toMatchObject({
      runtime: 'dev',
      storageMode: 'emulator',
      firestoreProjectId: 'intexuraos-message-digest-mvp-local',
      pubsubProjectId: 'intexuraos-message-digest-mvp-local',
    });
  });

  it.each([
    ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8101'],
    ['PUBSUB_EMULATOR_HOST', '127.0.0.1:8102'],
  ] as const)('refuses local MVP mode with only %s configured', (name, value) => {
    process.env['INTEXURAOS_RUNTIME'] = 'dev';
    delete process.env['FIRESTORE_EMULATOR_HOST'];
    delete process.env['PUBSUB_EMULATOR_HOST'];
    process.env[name] = value;

    expect(() => loadConfig()).toThrow(
      'Local message-digest-service requires both FIRESTORE_EMULATOR_HOST and PUBSUB_EMULATOR_HOST'
    );
  });

  it('refuses local MVP mode when both emulator hosts are absent', () => {
    process.env['INTEXURAOS_RUNTIME'] = 'dev';
    delete process.env['FIRESTORE_EMULATOR_HOST'];
    delete process.env['PUBSUB_EMULATOR_HOST'];

    expect(() => loadConfig()).toThrow(
      'Local message-digest-service requires both FIRESTORE_EMULATOR_HOST and PUBSUB_EMULATOR_HOST'
    );
  });

  it('refuses emulator leakage in production runtime', () => {
    process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8101';
    process.env['PUBSUB_EMULATOR_HOST'] = '127.0.0.1:8102';

    expect(() => loadConfig()).toThrow(
      'Production message-digest-service cannot use Firestore or Pub/Sub emulators'
    );
  });

  it.each([
    ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8101'],
    ['PUBSUB_EMULATOR_HOST', '127.0.0.1:8102'],
  ] as const)('refuses a half-configured emulator outside local and production modes', (name, value) => {
    process.env['INTEXURAOS_RUNTIME'] = 'test';
    delete process.env['FIRESTORE_EMULATOR_HOST'];
    delete process.env['PUBSUB_EMULATOR_HOST'];
    process.env[name] = value;

    expect(() => loadConfig()).toThrow(
      'Message Digest emulator storage requires both FIRESTORE_EMULATOR_HOST and PUBSUB_EMULATOR_HOST'
    );
  });

  it.each(['0', '65536', '12.5', 'not-a-port'])('rejects invalid service port %s', (port) => {
    process.env['PORT'] = port;

    expect(() => loadConfig()).toThrow('Invalid message-digest-service PORT');
  });

  it('loads optional Sentry and default environment values while trimming configuration', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = '  https://sentry.invalid/1  ';
    delete process.env['INTEXURAOS_ENVIRONMENT'];
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = '  synthetic-project  ';

    expect(loadConfig()).toMatchObject({
      gcpProjectId: 'synthetic-project',
      sentryDsn: 'https://sentry.invalid/1',
      environment: 'development',
    });
  });
});

function requiredEnvironment(): NodeJS.ProcessEnv {
  return {
    ...originalEnv,
    PORT: '8135',
    INTEXURAOS_GCP_PROJECT_ID: 'synthetic-project',
    INTEXURAOS_AUTH_JWKS_URL: 'https://auth.invalid/jwks',
    INTEXURAOS_AUTH_ISSUER: 'https://auth.invalid/',
    INTEXURAOS_AUTH_AUDIENCE: 'urn:synthetic:api',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'synthetic-internal-token',
    INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://127.0.0.1:8113',
    INTEXURAOS_LLM_USAGE_SERVICE_URL: 'http://127.0.0.1:8132',
    INTEXURAOS_OPENROUTER_APP_API_KEY: 'synthetic-openrouter-key',
    INTEXURAOS_DIGEST_LLM_MODEL: 'or:synthetic/model',
    INTEXURAOS_PUBSUB_MESSAGE_DIGEST_RUN_TOPIC: 'synthetic-message-digest-run',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'synthetic-whatsapp-send',
    INTEXURAOS_WEB_APP_URL: 'http://127.0.0.1:3000',
    INTEXURAOS_ENVIRONMENT: 'production',
    INTEXURAOS_RUNTIME: 'prod',
    FIRESTORE_EMULATOR_HOST: '',
    PUBSUB_EMULATOR_HOST: '',
  };
}
