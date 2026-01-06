/**
 * Tests for notes-agent configuration loading.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('returns default port 8080 when PORT not set', () => {
      delete process.env['PORT'];

      const config = loadConfig();

      expect(config.port).toBe(8080);
    });

    it('parses PORT from environment variable', () => {
      process.env['PORT'] = '9000';

      const config = loadConfig();

      expect(config.port).toBe(9000);
    });

    it('returns empty string for gcpProjectId when not set', () => {
      delete process.env['INTEXURAOS_GCP_PROJECT_ID'];

      const config = loadConfig();

      expect(config.gcpProjectId).toBe('');
    });

    it('uses gcpProjectId from environment variable', () => {
      process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'my-gcp-project';

      const config = loadConfig();

      expect(config.gcpProjectId).toBe('my-gcp-project');
    });

    it('returns empty string for internalAuthKey when not set', () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_KEY'];

      const config = loadConfig();

      expect(config.internalAuthKey).toBe('');
    });

    it('uses internalAuthKey from environment variable', () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_KEY'] = 'secret-key-123';

      const config = loadConfig();

      expect(config.internalAuthKey).toBe('secret-key-123');
    });

    describe('auth config', () => {
      it('returns empty strings for auth config when not set', () => {
        delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
        delete process.env['INTEXURAOS_AUTH_ISSUER'];
        delete process.env['INTEXURAOS_AUTH_AUDIENCE'];

        const config = loadConfig();

        expect(config.auth.jwksUrl).toBe('');
        expect(config.auth.issuer).toBe('');
        expect(config.auth.audience).toBe('');
      });

      it('uses auth config from environment variables', () => {
        process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://example.com/.well-known/jwks.json';
        process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://example.com/';
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'notes-api';

        const config = loadConfig();

        expect(config.auth.jwksUrl).toBe('https://example.com/.well-known/jwks.json');
        expect(config.auth.issuer).toBe('https://example.com/');
        expect(config.auth.audience).toBe('notes-api');
      });
    });

    it('returns complete config with all values', () => {
      process.env['PORT'] = '3000';
      process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'prod-project';
      process.env['INTEXURAOS_INTERNAL_AUTH_KEY'] = 'prod-secret';
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/jwks';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'notes-service';

      const config = loadConfig();

      expect(config).toEqual({
        port: 3000,
        gcpProjectId: 'prod-project',
        internalAuthKey: 'prod-secret',
        auth: {
          jwksUrl: 'https://auth.example.com/jwks',
          issuer: 'https://auth.example.com/',
          audience: 'notes-service',
        },
      });
    });
  });
});
