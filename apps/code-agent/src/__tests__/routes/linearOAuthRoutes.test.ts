/**
 * Integration tests for Linear OAuth routes.
 *
 * Tests:
 * - GET /oauth/linear/install - Redirect to Linear authorization URL
 * - GET /oauth/linear/callback - Exchange code for token, store credentials
 * - cleanExpiredStates() - Expired state cleanup
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock jose library for JWT validation (buildServer needs it)
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: 'test-user-id', email: 'test@example.com' },
    protectedHeader: new Uint8Array(),
  }),
}));

import { err, type Result } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { getServices, resetServices } from '../../services.js';
import type { LinearOAuthError } from '../../domain/ports/linearOAuthRepository.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../helpers/mockServices.js';

/** Original global fetch, saved before stubbing. */
let originalFetch: typeof globalThis.fetch;

/** Vitest mock function replacing global fetch. */
let mockFetch: ReturnType<typeof vi.fn>;

/**
 * Helper: build a successful token exchange response.
 */
function makeTokenResponse(accessToken = 'test-access-token'): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, token_type: 'Bearer', expires_in: 315360000 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Helper: build a successful viewer ID GraphQL response.
 */
function makeViewerResponse(viewerId = 'viewer-id-123'): Response {
  return new Response(
    JSON.stringify({ data: { viewer: { id: viewerId } } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('Linear OAuth Routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    // Set required env vars for loadConfig()
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] = 'test-verify-secret';
    process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = 'test-encryption-key-32chars!!!!!';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';
    process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] = 'test-github-secret';
    process.env['INTEXURAOS_LINEAR_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_LINEAR_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'] = 'test-webhook-secret';
    process.env['INTEXURAOS_SERVICE_URL'] = 'http://localhost:8128';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    setupTestServices();

    // Stub global fetch for mocking Linear API calls
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as typeof fetch;

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;

    // Clean up env vars
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'];
    delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
    delete process.env['INTEXURAOS_ORCHESTRATOR_SECRET'];
    delete process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'];
    delete process.env['INTEXURAOS_LINEAR_CLIENT_ID'];
    delete process.env['INTEXURAOS_LINEAR_CLIENT_SECRET'];
    delete process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'];
    delete process.env['INTEXURAOS_SERVICE_URL'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  });

  // ─── Install Endpoint ────────────────────────────────────────────────

  describe('GET /oauth/linear/install', () => {
    it('should redirect to Linear authorization URL with correct params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/linear/install',
      });

      expect(response.statusCode).toBe(302);

      const location = response.headers['location'] as string;
      expect(location).toBeDefined();

      const redirectUrl = new URL(location);
      expect(redirectUrl.origin).toBe('https://linear.app');
      expect(redirectUrl.pathname).toBe('/oauth/authorize');
      expect(redirectUrl.searchParams.get('client_id')).toBe('test-client-id');
      expect(redirectUrl.searchParams.get('redirect_uri')).toBe(
        'http://localhost:8128/oauth/linear/callback',
      );
      expect(redirectUrl.searchParams.get('response_type')).toBe('code');
      expect(redirectUrl.searchParams.get('scope')).toBe(
        'app:assignable,app:mentionable,read,write,issues:create',
      );
      expect(redirectUrl.searchParams.get('actor')).toBe('app');

      // State should be a 64-character hex string (32 random bytes)
      const state = redirectUrl.searchParams.get('state');
      expect(state).toBeDefined();
      expect(state).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ─── Callback Endpoint ───────────────────────────────────────────────

  describe('GET /oauth/linear/callback', () => {
    /**
     * Helper: hit the install endpoint and extract the state token from the redirect URL.
     */
    async function getValidState(): Promise<string> {
      const installResponse = await app.inject({
        method: 'GET',
        url: '/oauth/linear/install',
      });
      const location = installResponse.headers['location'] as string;
      const redirectUrl = new URL(location);
      const state = redirectUrl.searchParams.get('state');
      if (state === null) {
        throw new Error('No state in redirect URL');
      }
      return state;
    }

    it('should return 502 when error query param is present', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/linear/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toContain('access_denied');
    });

    it('should return 400 when code is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/linear/callback?state=some-state',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Missing code or state parameter');
    });

    it('should return 400 when state is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/linear/callback?code=some-code',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Missing code or state parameter');
    });

    it('should return 400 when both code and state are missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/linear/callback',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('should return 400 when state is not in store (invalid state)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/linear/callback?code=auth-code&state=invalid-state-token',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Invalid or expired state parameter');
    });

    it('should return 400 when state has expired', async () => {
      // First, get a valid state by calling install
      const state = await getValidState();

      // Advance time past the 10 minute TTL
      const realDateNow = Date.now;
      const currentTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(currentTime + 11 * 60 * 1000);

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('State parameter has expired');

      // Restore Date.now
      vi.spyOn(Date, 'now').mockImplementation(realDateNow);
    });

    it('should return 200 on successful token exchange and credential storage', async () => {
      const state = await getValidState();

      // Mock fetch: first call = token exchange, second call = viewer ID query
      mockFetch
        .mockResolvedValueOnce(makeTokenResponse('test-access-token'))
        .mockResolvedValueOnce(makeViewerResponse('viewer-id-123'));

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=valid-auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { message: string; appUserId: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('Linear app installed successfully');
      expect(body.data.appUserId).toBe('viewer-id-123');

      // Verify token exchange was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify first call (token exchange)
      const tokenCall = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(tokenCall[0]).toBe('https://api.linear.app/oauth/token');
      expect(tokenCall[1]?.method).toBe('POST');
      expect(tokenCall[1]?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      );

      // Verify second call (viewer ID query)
      const viewerCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(viewerCall[0]).toBe('https://api.linear.app/graphql');
      expect(viewerCall[1]?.method).toBe('POST');
    });

    it('should return 502 when token exchange returns non-ok response', async () => {
      const state = await getValidState();

      mockFetch.mockResolvedValueOnce(
        new Response('Bad Request', { status: 400 }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=bad-code&state=${state}`,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Failed to exchange authorization code');
    });

    it('should return 502 when token response has no access_token', async () => {
      const state = await getValidState();

      // Return a valid 200 response but without access_token
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token_type: 'Bearer' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('No access token in response');
    });

    it('should return 500 when viewer ID query returns non-ok response', async () => {
      const state = await getValidState();

      // Token exchange succeeds
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      // Viewer ID query fails with 401
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('OAuth callback processing failed');
    });

    it('should return 500 when viewer ID is undefined in response', async () => {
      const state = await getValidState();

      // Token exchange succeeds
      mockFetch.mockResolvedValueOnce(makeTokenResponse());
      // Viewer ID query returns response without viewer id
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { viewer: {} } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('OAuth callback processing failed');
    });

    it('should return 500 when linearOAuthRepo.save returns an error', async () => {
      const state = await getValidState();

      // Token exchange and viewer query succeed
      mockFetch
        .mockResolvedValueOnce(makeTokenResponse())
        .mockResolvedValueOnce(makeViewerResponse());

      // Override linearOAuthRepo.save to return an error
      const services = getServices();
      const originalSave = services.linearOAuthRepo.save;
      services.linearOAuthRepo.save = async (): Promise<Result<void, LinearOAuthError>> =>
        err({ code: 'internal_error', message: 'Firestore write failed' });

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to store credentials');

      // Restore original save
      services.linearOAuthRepo.save = originalSave;
    });

    it('should consume state token after use (one-time use)', async () => {
      const state = await getValidState();

      // First callback should succeed
      mockFetch
        .mockResolvedValueOnce(makeTokenResponse())
        .mockResolvedValueOnce(makeViewerResponse());

      const firstResponse = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${state}`,
      });
      expect(firstResponse.statusCode).toBe(200);

      // Second callback with same state should fail
      const secondResponse = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${state}`,
      });
      expect(secondResponse.statusCode).toBe(400);
      const body = JSON.parse(secondResponse.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Invalid or expired state parameter');
    });
  });

  // ─── cleanExpiredStates ──────────────────────────────────────────────

  describe('cleanExpiredStates', () => {
    it('should clean expired states when install endpoint is called', async () => {
      // Create a first state
      const firstInstallResponse = await app.inject({
        method: 'GET',
        url: '/oauth/linear/install',
      });
      const firstLocation = firstInstallResponse.headers['location'] as string;
      const firstState = new URL(firstLocation).searchParams.get('state') as string;

      // Advance time past the TTL
      const realDateNow = Date.now;
      const baseTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(baseTime + 11 * 60 * 1000);

      // Trigger install again - this calls cleanExpiredStates() internally
      const secondInstallResponse = await app.inject({
        method: 'GET',
        url: '/oauth/linear/install',
      });
      const secondLocation = secondInstallResponse.headers['location'] as string;
      const secondState = new URL(secondLocation).searchParams.get('state') as string;

      // Restore Date.now so callback timestamp check works
      vi.spyOn(Date, 'now').mockImplementation(realDateNow);

      // The first state should have been cleaned (expired)
      const expiredResponse = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${firstState}`,
      });
      expect(expiredResponse.statusCode).toBe(400);
      const expiredBody = JSON.parse(expiredResponse.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(expiredBody.error.code).toBe('INVALID_REQUEST');

      // The second state should still be valid (not expired)
      mockFetch
        .mockResolvedValueOnce(makeTokenResponse())
        .mockResolvedValueOnce(makeViewerResponse());

      const validResponse = await app.inject({
        method: 'GET',
        url: `/oauth/linear/callback?code=auth-code&state=${secondState}`,
      });
      expect(validResponse.statusCode).toBe(200);
    });
  });
});
