import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['PORT'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default values when env vars are not set', () => {
    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.gcpProjectId).toBe('');
    expect(config.auth.jwksUrl).toBe('');
    expect(config.auth.issuer).toBe('');
    expect(config.auth.audience).toBe('');
    expect(config.internalAuthKey).toBe('');
  });

  it('loads values from environment variables', () => {
    process.env['PORT'] = '3000';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret-key';

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.gcpProjectId).toBe('test-project');
    expect(config.auth.jwksUrl).toBe('https://auth.example.com/.well-known/jwks.json');
    expect(config.auth.issuer).toBe('https://auth.example.com/');
    expect(config.auth.audience).toBe('test-audience');
    expect(config.internalAuthKey).toBe('secret-key');
  });
});
