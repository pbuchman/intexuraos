import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads config from environment variables', () => {
    process.env['PORT'] = '3000';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://jwks.example.com';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://issuer.example.com';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
    process.env['INTEXURAOS_INTERNAL_AUTH_KEY'] = 'test-key';

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.gcpProjectId).toBe('test-project');
    expect(config.auth.jwksUrl).toBe('https://jwks.example.com');
    expect(config.auth.issuer).toBe('https://issuer.example.com');
    expect(config.auth.audience).toBe('test-audience');
    expect(config.internalAuthKey).toBe('test-key');
  });

  it('uses default values when environment variables are not set', () => {
    delete process.env['PORT'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_KEY'];

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.gcpProjectId).toBe('');
    expect(config.auth.jwksUrl).toBe('');
    expect(config.auth.issuer).toBe('');
    expect(config.auth.audience).toBe('');
    expect(config.internalAuthKey).toBe('');
  });
});
