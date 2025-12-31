/**
 * Tests for JWT verification utilities.
 *
 * Note: This file uses `any` types for mocking jose library types which are
 * complex and change between versions. The eslint rules are disabled for these
 * specific mock-related operations.
 */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { clearJwksCache, type JwtConfig, verifyJwt } from '../auth/jwt.js';
import { IntexuraOSError } from '@intexuraos/common-core';

// Mock jose module
vi.mock('jose', async () => {
  const actual = await vi.importActual<typeof jose>('jose');
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(),
    jwtVerify: vi.fn(),
  };
});

describe('JWT utilities', () => {
  const mockConfig: JwtConfig = {
    jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
    issuer: 'https://auth.example.com/',
    audience: 'https://api.example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearJwksCache();
  });

  afterEach(() => {
    clearJwksCache();
  });

  describe('clearJwksCache', () => {
    it('clears the JWKS cache without error', () => {
      clearJwksCache();
      // No assertion needed - just verify no error thrown
    });
  });

  describe('verifyJwt', () => {
    it('throws UNAUTHORIZED for empty token', async () => {
      await expect(verifyJwt('', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Token is empty',
      });
    });

    it('returns verified JWT with sub and claims on success', async () => {
      const mockPayload = {
        sub: 'user-123',
        aud: 'https://api.example.com',
        iss: 'https://auth.example.com/',
        exp: Math.floor(Date.now() / 1000) + 3600,
        customClaim: 'value',
      };

      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as any);

      const result = await verifyJwt('valid-token', mockConfig);

      expect(result.sub).toBe('user-123');
      expect(result.claims).toEqual(mockPayload);
    });

    it('caches JWKS client for same URL', async () => {
      const mockPayload = { sub: 'user-123' };
      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as any);

      await verifyJwt('token1', mockConfig);
      await verifyJwt('token2', mockConfig);

      // Should only create JWKS client once
      expect(jose.createRemoteJWKSet).toHaveBeenCalledTimes(1);
    });

    it('throws UNAUTHORIZED for expired token', async () => {
      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      // Create error with required payload argument
      const expiredError = new jose.errors.JWTExpired('token expired', {});
      vi.mocked(jose.jwtVerify).mockRejectedValue(expiredError);

      await expect(verifyJwt('expired-token', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('expired-token', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Token has expired',
      });
    });

    it('throws UNAUTHORIZED for claim validation failure', async () => {
      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      // Create error with required payload argument
      const claimError = new jose.errors.JWTClaimValidationFailed('invalid audience', {});
      vi.mocked(jose.jwtVerify).mockRejectedValue(claimError);

      await expect(verifyJwt('invalid-claims-token', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('invalid-claims-token', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: expect.stringContaining('Token validation failed'),
      });
    });

    it('throws UNAUTHORIZED for invalid signature', async () => {
      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      vi.mocked(jose.jwtVerify).mockRejectedValue(
        new jose.errors.JWSSignatureVerificationFailed('bad signature')
      );

      await expect(verifyJwt('bad-sig-token', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('bad-sig-token', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Invalid token signature',
      });
    });

    it('throws UNAUTHORIZED for other JOSE errors', async () => {
      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      vi.mocked(jose.jwtVerify).mockRejectedValue(new jose.errors.JOSEError('jose error'));

      await expect(verifyJwt('jose-error-token', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('jose-error-token', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: expect.stringContaining('Token error'),
      });
    });

    it('throws UNAUTHORIZED for non-JOSE errors', async () => {
      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      vi.mocked(jose.jwtVerify).mockRejectedValue(new Error('network error'));

      await expect(verifyJwt('network-error-token', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('network-error-token', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Token verification failed',
      });
    });

    it('throws UNAUTHORIZED for missing sub claim', async () => {
      const mockPayload = {
        aud: 'https://api.example.com',
        iss: 'https://auth.example.com/',
        // sub is missing
      };

      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as any);

      await expect(verifyJwt('missing-sub-token', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('missing-sub-token', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Token missing sub claim',
      });
    });

    it('throws UNAUTHORIZED for empty sub claim', async () => {
      const mockPayload = {
        sub: '',
        aud: 'https://api.example.com',
        iss: 'https://auth.example.com/',
      };

      vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as any);
      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as any);

      await expect(verifyJwt('empty-sub-token', mockConfig)).rejects.toThrow(IntexuraOSError);
      await expect(verifyJwt('empty-sub-token', mockConfig)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Token missing sub claim',
      });
    });
  });
});
