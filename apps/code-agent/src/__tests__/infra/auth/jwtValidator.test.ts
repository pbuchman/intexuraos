/**
 * Tests for JWT validator middleware
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
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
      const request: TestRequest = { headers: {}, url: '/submit' };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
    });

    it.each([
      ['missing', {}],
      ['invalid prefix', { authorization: 'Basic abc123' }],
    ])('marks %s Authorization header warnings as skipped for Sentry', async (_caseName, headers) => {
      const warn = vi.fn();
      const validator = createJwtValidator(mockConfig, {
        warn,
        debug: vi.fn(),
      } as unknown as Logger);
      const request: TestRequest = { headers, url: '/workers/status' };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { url: '/workers/status', [SKIP_SENTRY_KEY]: true },
        'Missing or invalid Authorization header'
      );
      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Basic abc123' },
        url: '/submit',
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
        url: '/submit',
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
        url: '/submit',
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
        url: '/submit',
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
        url: '/submit',
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
        url: '/submit',
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
        url: '/submit',
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

    it('should return E2E validator when E2E_MODE is enabled', async () => {
      const validator = createJwtValidator(mockConfig, logger);
      // The validator should be the E2E variant - test by calling it
      const request: TestRequest = {
        headers: { authorization: 'Bearer any-token' },
        url: '/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      // E2E validator should accept any token and use E2E_TEST_USER_ID
      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      // Should not call fail for valid Bearer token
      expect(reply.fail).not.toHaveBeenCalled();
      // Should set user from E2E_TEST_USER_ID (defaults to 'e2e-test-user')
      expect(request.user).toEqual({ userId: 'e2e-test-user', email: undefined });
    });
  });

  describe('production guard', () => {
    let originalEnvironment: string | undefined;

    beforeEach(() => {
      // Test 3 ('INTEXURAOS_ENVIRONMENT is unset') must be hermetic against an
      // ambient INTEXURAOS_ENVIRONMENT exported into the CI process — clear it
      // here and restore in afterEach. Stubs set inside each test are still
      // cleared by vi.unstubAllEnvs().
      originalEnvironment = process.env['INTEXURAOS_ENVIRONMENT'];
      delete process.env['INTEXURAOS_ENVIRONMENT'];
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      if (originalEnvironment === undefined) {
        delete process.env['INTEXURAOS_ENVIRONMENT'];
      } else {
        process.env['INTEXURAOS_ENVIRONMENT'] = originalEnvironment;
      }
    });

    it('should throw when INTEXURAOS_ENVIRONMENT=production AND E2E_MODE=true', () => {
      vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'production');
      vi.stubEnv('E2E_MODE', 'true');

      // Lock both env var names into the contract — the operator-facing
      // message must mention each one so log-grepping from either side works.
      expect(() => createJwtValidator(mockConfig, logger)).toThrow(/E2E_MODE/);
      expect(() => createJwtValidator(mockConfig, logger)).toThrow(/INTEXURAOS_ENVIRONMENT/);
      expect(() => createJwtValidator(mockConfig, logger)).toThrow(/production/);
    });

    it('should return E2E mock validator when E2E_MODE=true and INTEXURAOS_ENVIRONMENT=development', async () => {
      vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'development');
      vi.stubEnv('E2E_MODE', 'true');

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer any-token' },
        url: '/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).not.toHaveBeenCalled();
      expect(request.user).toEqual({ userId: 'e2e-test-user', email: undefined });
    });

    it('should return E2E mock validator when E2E_MODE=true and INTEXURAOS_ENVIRONMENT is unset', async () => {
      vi.stubEnv('E2E_MODE', 'true');

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer any-token' },
        url: '/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).not.toHaveBeenCalled();
      expect(request.user).toEqual({ userId: 'e2e-test-user', email: undefined });
    });

    it('should return real Auth0 validator when INTEXURAOS_ENVIRONMENT=production AND E2E_MODE is unset', async () => {
      vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'production');

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer some-token' },
        url: '/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Invalid or expired token');
    });

    it('should return real Auth0 validator when INTEXURAOS_ENVIRONMENT=production AND E2E_MODE=false', async () => {
      vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'production');
      vi.stubEnv('E2E_MODE', 'false');

      const validator = createJwtValidator(mockConfig, logger);
      const request: TestRequest = {
        headers: { authorization: 'Bearer some-token' },
        url: '/submit',
      };
      const reply = { fail: vi.fn().mockResolvedValue(undefined) };

      await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

      expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Invalid or expired token');
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
    const request: TestRequest = { headers: {}, url: '/submit' };
    const reply = { fail: vi.fn().mockResolvedValue(undefined) };

    await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

    expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
  });

  it('should return 401 when Authorization does not start with Bearer', async () => {
    const validator = createE2eJwtValidator(logger);
    const request: TestRequest = {
      headers: { authorization: 'Basic abc123' },
      url: '/submit',
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
      url: '/submit',
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
      url: '/submit',
    };
    const reply = { fail: vi.fn().mockResolvedValue(undefined) };

    await validator(request as unknown as Parameters<typeof validator>[0], reply as unknown as Parameters<typeof validator>[1]);

    expect(request.user).toEqual({
      userId: 'e2e-test-user',
      email: undefined,
    });
  });
});
