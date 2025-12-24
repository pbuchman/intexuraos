/**
 * Tests for shared utilities
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { loadAuth0Config, handleValidationError } from '../routes/v1/shared.js';
import type { FastifyReply } from 'fastify';
describe('shared utilities', () => {
  let savedDomain: string | undefined;
  let savedClientId: string | undefined;
  let savedAudience: string | undefined;
  beforeEach(() => {
    savedDomain = process.env['AUTH0_DOMAIN'];
    savedClientId = process.env['AUTH0_CLIENT_ID'];
    savedAudience = process.env['AUTH_AUDIENCE'];
  });
  afterEach(() => {
    if (savedDomain !== undefined) {
      process.env['AUTH0_DOMAIN'] = savedDomain;
    } else {
      delete process.env['AUTH0_DOMAIN'];
    }
    if (savedClientId !== undefined) {
      process.env['AUTH0_CLIENT_ID'] = savedClientId;
    } else {
      delete process.env['AUTH0_CLIENT_ID'];
    }
    if (savedAudience !== undefined) {
      process.env['AUTH_AUDIENCE'] = savedAudience;
    } else {
      delete process.env['AUTH_AUDIENCE'];
    }
  });
  describe('loadAuth0Config', () => {
    it('returns null when AUTH0_DOMAIN is missing', () => {
      delete process.env['AUTH0_DOMAIN'];
      process.env['AUTH0_CLIENT_ID'] = 'test-client';
      process.env['AUTH_AUDIENCE'] = 'test-audience';
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns null when AUTH0_CLIENT_ID is missing', () => {
      process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
      delete process.env['AUTH0_CLIENT_ID'];
      process.env['AUTH_AUDIENCE'] = 'test-audience';
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns null when AUTH_AUDIENCE is missing', () => {
      process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
      process.env['AUTH0_CLIENT_ID'] = 'test-client';
      delete process.env['AUTH_AUDIENCE'];
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns null when AUTH0_DOMAIN is empty', () => {
      process.env['AUTH0_DOMAIN'] = '';
      process.env['AUTH0_CLIENT_ID'] = 'test-client';
      process.env['AUTH_AUDIENCE'] = 'test-audience';
      expect(loadAuth0Config()).toBeNull();
    });
    it('returns config when all vars are set', () => {
      process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
      process.env['AUTH0_CLIENT_ID'] = 'test-client';
      process.env['AUTH_AUDIENCE'] = 'test-audience';
      const config = loadAuth0Config();
      expect(config).not.toBeNull();
      expect(config?.domain).toBe('test.auth0.com');
      expect(config?.clientId).toBe('test-client');
      expect(config?.audience).toBe('test-audience');
      expect(config?.jwksUrl).toBe('https://test.auth0.com/.well-known/jwks.json');
      expect(config?.issuer).toBe('https://test.auth0.com/');
    });
  });
  describe('handleValidationError', () => {
    it('converts Zod error to API error response', () => {
      const schema = z.object({
        userId: z.string().min(1),
        email: z.string().email(),
      });
      const result = schema.safeParse({ userId: '', email: 'invalid-email' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mockFail = vi.fn().mockReturnThis();
        const mockReply = {
          fail: mockFail,
        } as unknown as FastifyReply;
        handleValidationError(result.error, mockReply);
        expect(mockFail).toHaveBeenCalledTimes(1);
        const callArgs = mockFail.mock.calls[0] as unknown[];
        expect(callArgs[0]).toBe('INVALID_REQUEST');
        expect(callArgs[1]).toBe('Validation failed');
        expect(callArgs[2]).toBeUndefined();
        const details = callArgs[3] as { errors: { path: string; message: string }[] };
        expect(details.errors).toBeDefined();
        expect(details.errors.length).toBeGreaterThanOrEqual(2);
        const paths = details.errors.map((e) => e.path);
        expect(paths).toContain('userId');
        expect(paths).toContain('email');
      }
    });
    it('handles single validation error', () => {
      const schema = z.object({
        name: z.string().min(3),
      });
      const result = schema.safeParse({ name: 'ab' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mockFail = vi.fn().mockReturnThis();
        const mockReply = {
          fail: mockFail,
        } as unknown as FastifyReply;
        handleValidationError(result.error, mockReply);
        expect(mockFail).toHaveBeenCalledTimes(1);
        const callArgs = mockFail.mock.calls[0] as unknown[];
        expect(callArgs[0]).toBe('INVALID_REQUEST');
        const details = callArgs[3] as { errors: { path: string; message: string }[] };
        expect(details.errors).toBeDefined();
        expect(details.errors.length).toBe(1);
        expect(details.errors[0]?.path).toBe('name');
        expect(typeof details.errors[0]?.message).toBe('string');
      }
    });
    it('handles nested path in validation error', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            age: z.number().min(0),
          }),
        }),
      });
      const result = schema.safeParse({ user: { profile: { age: -1 } } });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mockFail = vi.fn().mockReturnThis();
        const mockReply = {
          fail: mockFail,
        } as unknown as FastifyReply;
        handleValidationError(result.error, mockReply);
        expect(mockFail).toHaveBeenCalledTimes(1);
        const callArgs = mockFail.mock.calls[0] as unknown[];
        const details = callArgs[3] as { errors: { path: string; message: string }[] };
        expect(details.errors).toBeDefined();
        expect(details.errors.length).toBe(1);
        expect(details.errors[0]?.path).toBe('user.profile.age');
      }
    });
  });
});
