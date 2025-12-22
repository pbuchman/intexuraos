/**
 * Tests for Auth0 client implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Auth0ClientImpl, loadAuth0Config } from '../client.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Auth0ClientImpl', () => {
  const testConfig = {
    domain: 'test-tenant.eu.auth0.com',
    clientId: 'test-client-id',
  };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('refreshAccessToken', () => {
    it('should successfully refresh access token', async () => {
      const refreshToken = 'test-refresh-token';
      const mockResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email offline_access',
        id_token: 'new-id-token',
        refresh_token: 'new-refresh-token', // rotation enabled
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new Auth0ClientImpl(testConfig);
      const result = await client.refreshAccessToken(refreshToken);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('new-access-token');
        expect(result.value.tokenType).toBe('Bearer');
        expect(result.value.expiresIn).toBe(3600);
        expect(result.value.scope).toBe('openid profile email offline_access');
        expect(result.value.idToken).toBe('new-id-token');
        expect(result.value.refreshToken).toBe('new-refresh-token');
      }

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(`https://${testConfig.domain}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        body: expect.stringContaining('grant_type=refresh_token'),
      });
    });

    it('should handle refresh without rotation (no new refresh token)', async () => {
      const refreshToken = 'test-refresh-token';
      const mockResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        // No refresh_token in response (rotation disabled)
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new Auth0ClientImpl(testConfig);
      const result = await client.refreshAccessToken(refreshToken);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.refreshToken).toBeUndefined();
      }
    });

    it('should handle invalid_grant error', async () => {
      const refreshToken = 'expired-refresh-token';
      const mockError = {
        error: 'invalid_grant',
        error_description: 'Refresh token is invalid or expired',
      };

      mockFetch.mockResolvedValueOnce({
        status: 403,
        json: () => Promise.resolve(mockError),
      });

      const client = new Auth0ClientImpl(testConfig);
      const result = await client.refreshAccessToken(refreshToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_GRANT');
        expect(result.error.message).toContain('invalid or expired');
      }
    });

    it('should handle generic Auth0 errors', async () => {
      const refreshToken = 'test-refresh-token';
      const mockError = {
        error: 'server_error',
        error_description: 'Internal server error',
      };

      mockFetch.mockResolvedValueOnce({
        status: 500,
        json: () => Promise.resolve(mockError),
      });

      const client = new Auth0ClientImpl(testConfig);
      const result = await client.refreshAccessToken(refreshToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Internal server error');
      }
    });

    it('should handle network errors', async () => {
      const refreshToken = 'test-refresh-token';

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new Auth0ClientImpl(testConfig);
      const result = await client.refreshAccessToken(refreshToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Network error');
      }
    });

    it('should handle non-JSON error responses', async () => {
      const refreshToken = 'test-refresh-token';

      mockFetch.mockResolvedValueOnce({
        status: 502,
        json: () => Promise.resolve('Bad Gateway'),
      });

      const client = new Auth0ClientImpl(testConfig);
      const result = await client.refreshAccessToken(refreshToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('token refresh failed');
      }
    });

    it('should properly encode refresh token in request body', async () => {
      const refreshToken = 'special+chars=&';
      const mockResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new Auth0ClientImpl(testConfig);
      await client.refreshAccessToken(refreshToken);

      const callArgs = mockFetch.mock.calls[0];
      if (Array.isArray(callArgs) && callArgs[1] !== undefined) {
        const options = callArgs[1] as Record<string, unknown>;
        if (typeof options['body'] === 'string') {
          const body = options['body'];
          // Verify refresh token is URL encoded
          expect(body).toContain(encodeURIComponent(refreshToken));
        } else {
          throw new Error('Expected body to be a string');
        }
      } else {
        throw new Error('Expected fetch to be called with arguments');
      }
    });
  });
});

describe('loadAuth0Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a clean copy of env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns config when both domain and clientId are set', () => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['AUTH0_CLIENT_ID'] = 'test-client-id';

    const config = loadAuth0Config();

    expect(config).toEqual({
      domain: 'test.auth0.com',
      clientId: 'test-client-id',
    });
  });

  it('returns null when domain is missing', () => {
    delete process.env['AUTH0_DOMAIN'];
    process.env['AUTH0_CLIENT_ID'] = 'test-client-id';

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });

  it('returns null when clientId is missing', () => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    delete process.env['AUTH0_CLIENT_ID'];

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });

  it('returns null when domain is empty string', () => {
    process.env['AUTH0_DOMAIN'] = '';
    process.env['AUTH0_CLIENT_ID'] = 'test-client-id';

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });

  it('returns null when clientId is empty string', () => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['AUTH0_CLIENT_ID'] = '';

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });
});
