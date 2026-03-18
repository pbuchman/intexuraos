import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['PORT'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
    delete process.env['INTEXURAOS_SENTRY_DSN'];
    delete process.env['INTEXURAOS_ENVIRONMENT'];
    delete process.env['INTEXURAOS_CODE_AGENT_URL'];
    delete process.env['INTEXURAOS_GEMINI_APP_API_KEY'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default values when env vars are not set', () => {
    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.gcpProjectId).toBe('');
    expect(config.internalAuthToken).toBe('');
    expect(config.authAudience).toBe('');
    expect(config.authIssuer).toBe('');
    expect(config.authJwksUrl).toBe('');
    expect(config.sentryDsn).toBe('');
    expect(config.environment).toBe('development');
    expect(config.allowedServices).toEqual([]);
    expect(config.geminiApiKey).toBe('');
  });

  it('loads values from environment variables', () => {
    process.env['PORT'] = '3000';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://sentry.example.com/123';
    process.env['INTEXURAOS_ENVIRONMENT'] = 'production';
    process.env['INTEXURAOS_GEMINI_APP_API_KEY'] = 'gemini-key';

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.gcpProjectId).toBe('test-project');
    expect(config.internalAuthToken).toBe('secret-token');
    expect(config.authAudience).toBe('test-audience');
    expect(config.authIssuer).toBe('https://auth.example.com/');
    expect(config.authJwksUrl).toBe('https://auth.example.com/.well-known/jwks.json');
    expect(config.sentryDsn).toBe('https://sentry.example.com/123');
    expect(config.environment).toBe('production');
    expect(config.geminiApiKey).toBe('gemini-key');
  });

  it('populates allowedServices when INTEXURAOS_CODE_AGENT_URL is set', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'https://code-agent.example.com';

    const config = loadConfig();

    expect(config.allowedServices).toHaveLength(1);
    expect(config.allowedServices[0]?.key).toBe('code-agent');
    expect(config.allowedServices[0]?.name).toBe('Code Agent');
    expect(config.allowedServices[0]?.url).toBe('https://code-agent.example.com');
    expect(config.allowedServices[0]?.openapiUrl).toBe('https://code-agent.example.com/openapi.json');
  });

  it('does not add code-agent to allowedServices when URL is empty string', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = '';

    const config = loadConfig();

    expect(config.allowedServices).toEqual([]);
  });
});
