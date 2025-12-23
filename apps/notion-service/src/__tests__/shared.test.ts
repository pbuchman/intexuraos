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
        const mockReply = {
          fail: vi.fn().mockReturnThis(),
        } as unknown as FastifyReply;

        handleValidationError(result.error, mockReply);

        expect(mockReply.fail).toHaveBeenCalledWith(
          'INVALID_REQUEST',
          'Validation failed',
          undefined,
          expect.objectContaining({
            errors: expect.arrayContaining([expect.objectContaining({ path: 'notionToken' })]),
          })
        );
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
        const mockReply = {
          fail: vi.fn().mockReturnThis(),
        } as unknown as FastifyReply;

        handleValidationError(result.error, mockReply);

        expect(mockReply.fail).toHaveBeenCalledWith(
          'INVALID_REQUEST',
          'Validation failed',
          undefined,
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({ path: 'notionToken' }),
              expect.objectContaining({ path: 'pageId' }),
            ]),
          })
        );
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
