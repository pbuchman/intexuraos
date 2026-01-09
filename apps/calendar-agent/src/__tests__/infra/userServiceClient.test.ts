/**
 * Tests for User Service HTTP client.
 * Uses nock to mock HTTP requests.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { UserServiceClientImpl } from '../../infra/user/userServiceClient.js';

const TEST_BASE_URL = 'https://user-service.example.com';
const TEST_AUTH_TOKEN = 'test-internal-auth-token';

describe('UserServiceClientImpl', () => {
  let client: UserServiceClientImpl;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    client = new UserServiceClientImpl(TEST_BASE_URL, TEST_AUTH_TOKEN);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getOAuthToken', () => {
    it('returns token successfully', async () => {
      nock(TEST_BASE_URL)
        .get('/internal/users/user-123/oauth/google/token')
        .matchHeader('x-internal-auth', TEST_AUTH_TOKEN)
        .reply(200, {
          accessToken: 'test-access-token',
          email: 'user@example.com',
        });

      const result = await client.getOAuthToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('test-access-token');
        expect(result.value.email).toBe('user@example.com');
      }
    });

    it('returns NOT_CONNECTED when connection not found (404)', async () => {
      nock(TEST_BASE_URL)
        .get('/internal/users/user-123/oauth/google/token')
        .reply(404, {
          code: 'CONNECTION_NOT_FOUND',
          error: 'Connection not found',
        });

      const result = await client.getOAuthToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Google Calendar not connected');
      }
    });

    it('returns NOT_CONNECTED when CONNECTION_NOT_FOUND code received', async () => {
      nock(TEST_BASE_URL)
        .get('/internal/users/user-123/oauth/google/token')
        .reply(400, {
          code: 'CONNECTION_NOT_FOUND',
          error: 'Connection not found',
        });

      const result = await client.getOAuthToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });

    it('returns TOKEN_ERROR when token refresh fails', async () => {
      nock(TEST_BASE_URL)
        .get('/internal/users/user-123/oauth/google/token')
        .reply(500, {
          code: 'TOKEN_REFRESH_FAILED',
          error: 'Failed to refresh token',
        });

      const result = await client.getOAuthToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_ERROR');
        expect(result.error.message).toBe('Failed to refresh token');
      }
    });

    it('returns INTERNAL_ERROR when OAuth not configured', async () => {
      nock(TEST_BASE_URL)
        .get('/internal/users/user-123/oauth/google/token')
        .reply(503, {
          code: 'CONFIGURATION_ERROR',
          error: 'OAuth not configured',
        });

      const result = await client.getOAuthToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('OAuth not configured');
      }
    });

    it('returns INTERNAL_ERROR for other error responses', async () => {
      nock(TEST_BASE_URL)
        .get('/internal/users/user-123/oauth/google/token')
        .reply(500, {
          code: 'UNKNOWN_ERROR',
          error: 'Something went wrong',
        });

      const result = await client.getOAuthToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Something went wrong');
      }
    });

    it('returns INTERNAL_ERROR when network error occurs', async () => {
      nock(TEST_BASE_URL)
        .get('/internal/users/user-123/oauth/google/token')
        .replyWithError('Network error');

      const result = await client.getOAuthToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to communicate with user-service');
      }
    });
  });
});
