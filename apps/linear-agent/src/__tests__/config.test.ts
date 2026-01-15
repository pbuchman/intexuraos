import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns defaults when env vars are missing', () => {
    delete process.env['PORT'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_USER_SERVICE_URL'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.gcpProjectId).toBe('');
    expect(config.userServiceUrl).toBe('');
    expect(config.internalAuthToken).toBe('');
  });

  it('uses env vars when provided', () => {
    process.env['PORT'] = '3000';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'my-project';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret-token';

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.gcpProjectId).toBe('my-project');
    expect(config.userServiceUrl).toBe('http://user-service');
    expect(config.internalAuthToken).toBe('secret-token');
  });
});
