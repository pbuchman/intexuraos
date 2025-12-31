/**
 * Tests for mobile-notifications-service config.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, validateConfigEnv } from '../config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('loads default values when env vars are not set', () => {
      delete process.env['PORT'];
      delete process.env['HOST'];

      const config = loadConfig();

      expect(config.port).toBe(8080);
      expect(config.host).toBe('0.0.0.0');
    });

    it('loads custom port from env', () => {
      process.env['PORT'] = '3000';

      const config = loadConfig();

      expect(config.port).toBe(3000);
    });

    it('loads custom host from env', () => {
      process.env['HOST'] = '127.0.0.1';

      const config = loadConfig();

      expect(config.host).toBe('127.0.0.1');
    });

    it('coerces string port to number', () => {
      process.env['PORT'] = '9000';

      const config = loadConfig();

      expect(config.port).toBe(9000);
      expect(typeof config.port).toBe('number');
    });
  });

  describe('validateConfigEnv', () => {
    it('returns empty array when all required vars are set', () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://example.com/.well-known/jwks.json';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://example.com';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'api://example';

      const missing = validateConfigEnv();

      expect(missing).toEqual([]);
    });

    it('returns missing vars when some are not set', () => {
      delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
      delete process.env['INTEXURAOS_AUTH_ISSUER'];
      delete process.env['INTEXURAOS_AUTH_AUDIENCE'];

      const missing = validateConfigEnv();

      expect(missing).toContain('INTEXURAOS_AUTH_JWKS_URL');
      expect(missing).toContain('INTEXURAOS_AUTH_ISSUER');
      expect(missing).toContain('INTEXURAOS_AUTH_AUDIENCE');
    });

    it('treats empty string as missing', () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = '';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://example.com';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'api://example';

      const missing = validateConfigEnv();

      expect(missing).toContain('INTEXURAOS_AUTH_JWKS_URL');
      expect(missing).not.toContain('INTEXURAOS_AUTH_ISSUER');
    });
  });
});
