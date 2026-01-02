/**
 * Tests for shared utilities
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAuth0Config } from '../routes/shared.js';

describe('shared utilities', () => {
  let savedDomain: string | undefined;
  let savedClientId: string | undefined;
  let savedAudience: string | undefined;
  beforeEach(() => {
    savedDomain = process.env['INTEXURAOS_AUTH0_DOMAIN'];
    savedClientId = process.env['INTEXURAOS_AUTH0_CLIENT_ID'];
    savedAudience = process.env['INTEXURAOS_AUTH_AUDIENCE'];
  });
  afterEach(() => {
    if (savedDomain !== undefined) {
      process.env['INTEXURAOS_AUTH0_DOMAIN'] = savedDomain;
    } else {
      delete process.env['INTEXURAOS_AUTH0_DOMAIN'];
    }
    if (savedClientId !== undefined) {
      process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = savedClientId;
    } else {
      delete process.env['INTEXURAOS_AUTH0_CLIENT_ID'];
    }
    if (savedAudience !== undefined) {
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = savedAudience;
    } else {
      delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    }
  });
  describe('loadAuth0Config', () => {
    it('returns null when INTEXURAOS_AUTH0_DOMAIN is missing', () => {
      delete process.env['INTEXURAOS_AUTH0_DOMAIN'];
      process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = 'test-client';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns null when INTEXURAOS_AUTH0_CLIENT_ID is missing', () => {
      process.env['INTEXURAOS_AUTH0_DOMAIN'] = 'test.auth0.com';
      delete process.env['INTEXURAOS_AUTH0_CLIENT_ID'];
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns null when INTEXURAOS_AUTH_AUDIENCE is missing', () => {
      process.env['INTEXURAOS_AUTH0_DOMAIN'] = 'test.auth0.com';
      process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = 'test-client';
      delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns null when INTEXURAOS_AUTH0_DOMAIN is empty', () => {
      process.env['INTEXURAOS_AUTH0_DOMAIN'] = '';
      process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = 'test-client';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns config when all vars are set', () => {
      process.env['INTEXURAOS_AUTH0_DOMAIN'] = 'test.auth0.com';
      process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = 'test-client';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
      const config = loadAuth0Config();
      expect(config).not.toBeNull();
      expect(config?.domain).toBe('test.auth0.com');
      expect(config?.clientId).toBe('test-client');
      expect(config?.audience).toBe('test-audience');
      expect(config?.jwksUrl).toBe('https://test.auth0.com/.well-known/jwks.json');
      expect(config?.issuer).toBe('https://test.auth0.com/');
    });
  });
});
