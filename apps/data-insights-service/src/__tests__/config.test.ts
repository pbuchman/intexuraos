import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, validateConfigEnv } from '../config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('returns default config when no env vars set', () => {
      delete process.env['PORT'];
      delete process.env['HOST'];
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
      delete process.env['USER_SERVICE_URL'];

      const config = loadConfig();

      expect(config.port).toBe(8080);
      expect(config.host).toBe('0.0.0.0');
      expect(config.internalAuthToken).toBe('');
      expect(config.userServiceUrl).toBe('http://localhost:8110');
    });

    it('uses env vars when set', () => {
      process.env['PORT'] = '9000';
      process.env['HOST'] = '127.0.0.1';
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
      process.env['USER_SERVICE_URL'] = 'http://user-service:8080';

      const config = loadConfig();

      expect(config.port).toBe(9000);
      expect(config.host).toBe('127.0.0.1');
      expect(config.internalAuthToken).toBe('test-token');
      expect(config.userServiceUrl).toBe('http://user-service:8080');
    });
  });

  describe('validateConfigEnv', () => {
    it('returns empty array when all required vars are set', () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://example.com/.well-known/jwks.json';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://example.com/';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'my-api';

      const missing = validateConfigEnv();

      expect(missing).toEqual([]);
    });

    it('returns missing vars when not set', () => {
      delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
      delete process.env['INTEXURAOS_AUTH_ISSUER'];
      delete process.env['INTEXURAOS_AUTH_AUDIENCE'];

      const missing = validateConfigEnv();

      expect(missing).toContain('INTEXURAOS_AUTH_JWKS_URL');
      expect(missing).toContain('INTEXURAOS_AUTH_ISSUER');
      expect(missing).toContain('INTEXURAOS_AUTH_AUDIENCE');
    });

    it('returns missing vars when set to empty string', () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = '';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://example.com/';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'my-api';

      const missing = validateConfigEnv();

      expect(missing).toContain('INTEXURAOS_AUTH_JWKS_URL');
      expect(missing).not.toContain('INTEXURAOS_AUTH_ISSUER');
    });
  });
});
