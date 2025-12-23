/**
 * Tests for shared utilities
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { handleValidationError } from '../routes/v1/shared.js';
import type { FastifyReply } from 'fastify';

describe('shared utilities', () => {
  describe('handleValidationError', () => {
    it('converts Zod error to API error response', () => {
      const schema = z.object({
        notionToken: z.string().min(1),
        pageId: z.string().min(1),
      });

      const result = schema.safeParse({ notionToken: '', pageId: 'valid' });
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
        const details = callArgs[3] as { errors: { path: string; message: string }[] };
        expect(details.errors).toBeDefined();
        const paths = details.errors.map((e) => e.path);
        expect(paths).toContain('notionToken');
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
  });
});
