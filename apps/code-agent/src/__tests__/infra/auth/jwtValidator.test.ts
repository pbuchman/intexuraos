/**
 * Tests for JWT validator middleware
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJwtValidator, createE2eJwtValidator, type JwtValidatorConfig } from '../../../infra/auth/jwtValidator.js';
import pino from 'pino';
import type { Logger } from 'pino';
import * as jose from 'jose';

interface TestRequest {
  headers: Record<string, string | undefined>;
  url: string;
  user?: { userId: string; email: string | undefined };
}

// Mock jose module at top level
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

describe('createJwtValidator', () => {
  let logger: Logger;
  const mockConfig: JwtValidatorConfig = {
    audience: 'https://api.intexuraos.cloud',
    issuer: 'https://intexuraos.eu.auth0.com/',
    jwksUri: 'https://intexuraos.eu.auth0.com/.well-known/jwks.json',
  };

  beforeEach(() => {
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;
    vi.clearAllMocks();
    // Reset to default mock (rejects)
    mockedJwtVerify.mockRejectedValue(new Error('JWT verification failed'));
  });

  describe('missing authorization header', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = { headers: {}, url: '/code/submit' };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Basic abc123' },
        url: '/code/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
    });
  });

  describe('invalid token', () => {
    it('should return 401 when token is malformed', async () => {
      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer invalid.token.here' },
        url: '/code/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Invalid or expired token');
    });
  });

  describe('valid token', () => {
    it('should set request.user with userId from sub claim', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: { sub: 'auth0|user123', email: 'user@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer valid.token.here' },
        url: '/code/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(request.user).toEqual({
        userId: 'auth0|user123',
        email: 'user@example.com',
      });
      expect(reply.fail).not.toHaveBeenCalled();
    });

    it('should return 401 when token is missing sub claim', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: { email: 'user@example.com' }, // No sub claim
        protectedHeader: new Uint8Array(),
      } as never);

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer valid.token.here' },
        url: '/code/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Invalid token: missing user identifier');
    });

    it('should handle token without email claim', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: { sub: 'auth0|user123' }, // No email
        protectedHeader: new Uint8Array(),
      } as never);

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer valid.token.here' },
        url: '/code/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(request.user).toEqual({
        userId: 'auth0|user123',
        email: undefined,
      });
      expect(reply.fail).not.toHaveBeenCalled();
    });

    it('should handle token with non-string email claim', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: { sub: 'auth0|user123', email: 12345 },
        protectedHeader: new Uint8Array(),
      } as never);

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer valid.token.here' },
        url: '/code/submit',
      };
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(request.user).toEqual({
        userId: 'auth0|user123',
        email: undefined,
      });
      expect(reply.status).not.toHaveBeenCalled();
    });
  });

  describe('token extraction', () => {
    it('should extract token from Bearer header correctly', async () => {
      mockedJwtVerify.mockImplementation(async (token) => {
        expect(token).toBe('my-token');
        return {
          payload: { sub: 'auth0|user456' },
          protectedHeader: new Uint8Array(),
        } as never;
      });

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer my-token' },
        url: '/code/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(request.user).toEqual({
        userId: 'auth0|user456',
      });
    });
  });

  describe('E2E mode', () => {
    beforeEach(() => {
      vi.stubEnv('E2E_MODE', 'true');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should return E2E validator when E2E_MODE is enabled', () => {
      const validator = createJwtValidator(mockConfig, logger);
      // The validator should be the E2E variant - test by calling it
      const request: TestRequest = {
        headers: { authorization: 'Bearer any-token' },
        url: '/code/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      // E2E validator should accept any token and use E2E_TEST_USER_ID
      validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]).then(() => {
        // Should not call fail for valid Bearer token
        expect(reply.fail).not.toHaveBeenCalled();
      });
    });
  });
});

describe('createE2eJwtValidator', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env['E2E_TEST_USER_ID'];
  });

  it('should return 401 when Authorization header is missing', async () => {
    const validator = createE2eJwtValidator(logger);
    const request: TestRequest = { headers: {}, url: '/code/submit' };
    const reply = { fail: vi.fn().mockResolvedValue(undefined) };

    await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

    expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
  });

  it('should return 401 when Authorization does not start with Bearer', async () => {
    const validator = createE2eJwtValidator(logger);
    const request: TestRequest = {
      headers: { authorization: 'Basic abc123' },
      url: '/code/submit',
    };
    const reply = { fail: vi.fn().mockResolvedValue(undefined) };

    await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

    expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
  });

  it('should accept any Bearer token and set user from E2E_TEST_USER_ID', async () => {
    process.env['E2E_TEST_USER_ID'] = 'e2e-ci-test';

    const validator = createE2eJwtValidator(logger);
    const request: TestRequest = {
      headers: { authorization: 'Bearer any-token-value' },
      url: '/code/submit',
    };
    const reply = { fail: vi.fn().mockResolvedValue(undefined) };

    await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

    expect(request.user).toEqual({
      userId: 'e2e-ci-test',
      email: undefined,
    });
    expect(reply.fail).not.toHaveBeenCalled();
  });

  it('should use default user ID when E2E_TEST_USER_ID is not set', async () => {
    const validator = createE2eJwtValidator(logger);
    const request: TestRequest = {
      headers: { authorization: 'Bearer test-token' },
      url: '/code/submit',
    };
    const reply = { fail: vi.fn().mockResolvedValue(undefined) };

    await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

    expect(request.user).toEqual({
      userId: 'e2e-test-user',
      email: undefined,
    });
  });
});
