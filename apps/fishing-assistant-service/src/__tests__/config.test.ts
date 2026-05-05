import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('fishing assistant config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['PORT'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_USER_SERVICE_URL'];
    delete process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'];
    delete process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
    delete process.env['INTEXURAOS_OPENAI_APP_API_KEY'];
    delete process.env['INTEXURAOS_SENTRY_DSN'];
    delete process.env['INTEXURAOS_ENVIRONMENT'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads defaults for optional runtime values', () => {
    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.environment).toBe('development');
    expect(config.sentryDsn).toBeUndefined();
  });

  it('loads all service endpoints and secrets from environment variables', () => {
    process.env['PORT'] = '8119';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'intexuraos-dev-pbuchman';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/jwks';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'internal-token';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://localhost:8110';
    process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'] = 'http://localhost:8114';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://localhost:8132';
    process.env['INTEXURAOS_OPENAI_APP_API_KEY'] = 'openai-key';
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://sentry.example.com/1';
    process.env['INTEXURAOS_ENVIRONMENT'] = 'dev';

    const config = loadConfig();

    expect(config).toEqual({
      port: 8119,
      gcpProjectId: 'intexuraos-dev-pbuchman',
      authJwksUrl: 'https://auth.example.com/jwks',
      authIssuer: 'https://auth.example.com/',
      authAudience: 'urn:intexuraos:api',
      internalAuthToken: 'internal-token',
      userServiceUrl: 'http://localhost:8110',
      mobileNotificationsServiceUrl: 'http://localhost:8114',
      llmUsageServiceUrl: 'http://localhost:8132',
      openAiAppApiKey: 'openai-key',
      sentryDsn: 'https://sentry.example.com/1',
      environment: 'dev',
    });
  });
});
