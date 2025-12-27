/**
 * Tests for handleValidationError function
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { handleValidationError } from '../http/validation.js';

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

  it('returns the reply for chaining', () => {
    const schema = z.object({
      name: z.string().min(3),
    });
    const result = schema.safeParse({ name: 'ab' });
    expect(result.success).toBe(false);

    if (!result.success) {
      const mockReply = {
        fail: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;

      const returnValue = handleValidationError(result.error, mockReply);
      expect(returnValue).toBe(mockReply);
    }
  });

  it('handles multiple validation errors', () => {
    const schema = z.object({
      notionToken: z.string().min(1),
      pageId: z.string().min(1),
    });

    const result = schema.safeParse({ notionToken: '', pageId: '' });
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
      expect(details.errors.length).toBeGreaterThanOrEqual(2);
      const paths = details.errors.map((e) => e.path);
      expect(paths).toContain('notionToken');
      expect(paths).toContain('pageId');
    }
  });
});
