/**
 * Tests for Zod validation error handling.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { handleValidationError } from '../http/validation.js';

describe('Validation utilities', () => {
  describe('handleValidationError', () => {
    function createMockReply(): {
      reply: FastifyReply;
      failFn: ReturnType<typeof vi.fn>;
    } {
      const failFn = vi.fn().mockReturnThis();
      const reply = {
        fail: failFn,
      } as unknown as FastifyReply;
      return { reply, failFn };
    }

    it('converts single Zod error to API error format', () => {
      const { reply, failFn } = createMockReply();

      // Create a real Zod error
      const schema = z.object({
        email: z.string().email(),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ email: 'not-an-email' });
      } catch (e) {
        zodError = e as ZodError;
      }

      handleValidationError(zodError as ZodError, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [
          {
            path: 'email',
            message: 'Invalid email',
          },
        ],
      });
    });

    it('converts multiple Zod errors to API error format', () => {
      const { reply, failFn } = createMockReply();

      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ email: 'invalid', age: 10 });
      } catch (e) {
        zodError = e as ZodError;
      }

      handleValidationError(zodError as ZodError, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: expect.arrayContaining([
          expect.objectContaining({ path: 'email' }),
          expect.objectContaining({ path: 'age' }),
        ]),
      });
    });

    it('handles nested path errors', () => {
      const { reply, failFn } = createMockReply();

      const schema = z.object({
        user: z.object({
          profile: z.object({
            name: z.string().min(1),
          }),
        }),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ user: { profile: { name: '' } } });
      } catch (e) {
        zodError = e as ZodError;
      }

      handleValidationError(zodError as ZodError, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [
          {
            path: 'user.profile.name',
            message: expect.any(String),
          },
        ],
      });
    });

    it('returns the reply for chaining', () => {
      const { reply } = createMockReply();

      const zodError = new ZodError([
        {
          code: 'custom',
          path: ['field'],
          message: 'test error',
        },
      ]);

      const result = handleValidationError(zodError, reply);

      expect(result).toBe(reply);
    });

    it('handles array index paths', () => {
      const { reply, failFn } = createMockReply();

      const schema = z.object({
        items: z.array(z.string().min(1)),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ items: ['valid', ''] });
      } catch (e) {
        zodError = e as ZodError;
      }

      handleValidationError(zodError as ZodError, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [
          expect.objectContaining({
            path: 'items.1',
          }),
        ],
      });
    });
  });
});
