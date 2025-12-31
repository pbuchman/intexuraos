/**
 * Tests for validation error handler.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { createValidationErrorHandler } from '../validation-handler.js';

describe('Validation Error Handler', () => {
  function createMockReply(): {
    reply: FastifyReply;
    statusFn: ReturnType<typeof vi.fn>;
    failFn: ReturnType<typeof vi.fn>;
  } {
    const statusFn = vi.fn().mockReturnThis();
    const failFn = vi.fn().mockResolvedValue(undefined);
    const reply = {
      status: statusFn,
      fail: failFn,
    } as unknown as FastifyReply;
    return { reply, statusFn, failFn };
  }

  function createMockRequest(): {
    request: FastifyRequest;
    logErrorFn: ReturnType<typeof vi.fn>;
  } {
    const logErrorFn = vi.fn();
    const request = {
      log: {
        error: logErrorFn,
      },
    } as unknown as FastifyRequest;
    return { request, logErrorFn };
  }

  describe('createValidationErrorHandler', () => {
    it('returns an async error handler function', () => {
      const handler = createValidationErrorHandler();
      expect(typeof handler).toBe('function');
    });

    it('handles validation errors with instancePath', async () => {
      const handler = createValidationErrorHandler();
      const { reply, statusFn, failFn } = createMockReply();
      const { request } = createMockRequest();

      const validationError = {
        validation: [
          { instancePath: '/email', message: 'must be a valid email' },
          { instancePath: '/name', message: 'is required' },
        ],
      } as unknown as FastifyError;

      await handler(validationError, request, reply);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [
          { path: 'email', message: 'must be a valid email' },
          { path: 'name', message: 'is required' },
        ],
      });
    });

    it('uses missingProperty for top-level required fields', async () => {
      const handler = createValidationErrorHandler();
      const { reply, failFn } = createMockReply();
      const { request } = createMockRequest();

      const validationError = {
        validation: [
          {
            instancePath: '',
            params: { missingProperty: 'userId' },
            message: "must have required property 'userId'",
          },
        ],
      } as unknown as FastifyError;

      await handler(validationError, request, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [{ path: 'userId', message: "must have required property 'userId'" }],
      });
    });

    it('defaults path to body when instancePath is empty and no missingProperty', async () => {
      const handler = createValidationErrorHandler();
      const { reply, failFn } = createMockReply();
      const { request } = createMockRequest();

      const validationError = {
        validation: [{ instancePath: '', message: 'must be object' }],
      } as unknown as FastifyError;

      await handler(validationError, request, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [{ path: 'body', message: 'must be object' }],
      });
    });

    it('handles nested paths correctly', async () => {
      const handler = createValidationErrorHandler();
      const { reply, failFn } = createMockReply();
      const { request } = createMockRequest();

      const validationError = {
        validation: [{ instancePath: '/user/address/city', message: 'must be string' }],
      } as unknown as FastifyError;

      await handler(validationError, request, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [{ path: 'user.address.city', message: 'must be string' }],
      });
    });

    it('defaults message to Invalid value when not provided', async () => {
      const handler = createValidationErrorHandler();
      const { reply, failFn } = createMockReply();
      const { request } = createMockRequest();

      const validationError = {
        validation: [{ instancePath: '/field' }],
      } as unknown as FastifyError;

      await handler(validationError, request, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [{ path: 'field', message: 'Invalid value' }],
      });
    });

    it('handles non-validation errors as internal errors', async () => {
      const handler = createValidationErrorHandler();
      const { reply, statusFn, failFn } = createMockReply();
      const { request, logErrorFn } = createMockRequest();

      const nonValidationError = new Error('Something broke') as FastifyError;

      await handler(nonValidationError, request, reply);

      expect(logErrorFn).toHaveBeenCalledWith({ err: nonValidationError }, 'Unhandled error');
      expect(statusFn).toHaveBeenCalledWith(500);
      expect(failFn).toHaveBeenCalledWith('INTERNAL_ERROR', 'Internal error');
    });

    it('handles errors without validation property as internal errors', async () => {
      const handler = createValidationErrorHandler();
      const { reply, statusFn, failFn } = createMockReply();
      const { request } = createMockRequest();

      const errorWithoutValidation = { message: 'Generic error' } as FastifyError;

      await handler(errorWithoutValidation, request, reply);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(failFn).toHaveBeenCalledWith('INTERNAL_ERROR', 'Internal error');
    });

    it('handles validation error with undefined instancePath', async () => {
      const handler = createValidationErrorHandler();
      const { reply, failFn } = createMockReply();
      const { request } = createMockRequest();

      const validationError = {
        validation: [{ message: 'must be valid' }],
      } as unknown as FastifyError;

      await handler(validationError, request, reply);

      expect(failFn).toHaveBeenCalledWith('INVALID_REQUEST', 'Validation failed', undefined, {
        errors: [{ path: 'body', message: 'must be valid' }],
      });
    });
  });
});
