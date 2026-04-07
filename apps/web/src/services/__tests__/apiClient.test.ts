/**
 * Tests for apiClient service.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseConflictError, type ConflictErrorInfo, apiRequest, ApiError } from '../apiClient'; // @allow-missing-js -- Vite web app uses extensionless imports

describe('parseConflictError', () => {
  describe('Duplicate task pattern', () => {
    it('extracts task ID from duplicate prompt message', () => {
      const message = 'Similar task submitted in last 5 minutes: task_fa7666d5-bdf1-4498-b52b-1c12af89a578';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_fa7666d5-bdf1-4498-b52b-1c12af89a578',
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });

    it('extracts task ID with different format', () => {
      const message = 'Similar task submitted in last 5 minutes: task_abc-123-def-456';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_abc-123-def-456',
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });

    it('handles trailing whitespace in task ID', () => {
      const message = 'Similar task submitted in last 5 minutes: task_xyz-123 ';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_xyz-123 ', // Whitespace preserved as part of capture
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });
  });

  describe('Active task pattern', () => {
    it('extracts task ID from active task message', () => {
      const message = 'Active task already exists for this Linear issue: task_bb7666d5-bdf1-4498-b52b-1c12af89a579';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_bb7666d5-bdf1-4498-b52b-1c12af89a579',
        reason: 'active',
      } satisfies ConflictErrorInfo);
    });

    it('extracts task ID with different format', () => {
      const message = 'Active task already exists for this Linear issue: task_active-987';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_active-987',
        reason: 'active',
      } satisfies ConflictErrorInfo);
    });
  });

  describe('Duplicate approval pattern', () => {
    it('extracts task ID from duplicate approval message', () => {
      const message = 'Duplicate: task_cc7666d5-bdf1-4498-b52b-1c12af89a580';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_cc7666d5-bdf1-4498-b52b-1c12af89a580',
        reason: 'duplicate_approval',
      } satisfies ConflictErrorInfo);
    });

    it('extracts task ID with simple format', () => {
      const message = 'Duplicate: task_simple-123';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_simple-123',
        reason: 'duplicate_approval',
      } satisfies ConflictErrorInfo);
    });
  });

  describe('Unknown message patterns', () => {
    it('returns null for completely unknown message', () => {
      const message = 'Some random error message';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const message = '';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for message without task ID', () => {
      const message = 'Similar task submitted in last 5 minutes:';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for message with similar but different prefix', () => {
      const message = 'Similar task was submitted: task-123';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for duplicate message without "Duplicate:" prefix at start', () => {
      const message = 'There is a Duplicate: task-123';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });
  });

  describe('Pattern matching priority', () => {
    it('matches duplicate pattern first when message could match multiple', () => {
      // This message contains both "Duplicate:" and the duplicate pattern
      const message = 'Similar task submitted in last 5 minutes: task-123 has a Duplicate: something';
      const result = parseConflictError(message);

      // Should match the first pattern (duplicate) since we check in order
      expect(result).toEqual({
        taskId: 'task-123 has a Duplicate: something',
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });
  });
});

describe('apiRequest', () => {
  const baseUrl = 'https://api.example.com';
  const path = '/test';
  const token = 'test-token';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Create a minimal fetch Response mock compatible with jsdom. */
  function mockFetchResponse(body: unknown, status: number): Response {
    return {
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  describe('Fastify default error format fallback', () => {
    it('throws ApiError with UNKNOWN code for Fastify-style error response', async () => {
      const fastifyError = {
        message: 'Route GET:/hellscript/writing-config not found',
        error: 'Not Found',
        statusCode: 404,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(fastifyError, 404)
      );

      await expect(apiRequest(baseUrl, path, token)).rejects.toThrow(ApiError);

      try {
        await apiRequest(baseUrl, path, token);
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('UNKNOWN');
        expect(apiErr.message).toBe('Route GET:/hellscript/writing-config not found');
        expect(apiErr.status).toBe(404);
      }
    });

    it('throws ApiError with UNKNOWN code when error field is absent', async () => {
      const fastifyError = {
        message: 'Internal Server Error',
        statusCode: 500,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(fastifyError, 500)
      );

      await expect(apiRequest(baseUrl, path, token)).rejects.toThrow(ApiError);

      try {
        await apiRequest(baseUrl, path, token);
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('UNKNOWN');
        expect(apiErr.message).toBe('Internal Server Error');
        expect(apiErr.status).toBe(500);
      }
    });

    it('throws generic Invalid response format for non-Fastify non-envelope response', async () => {
      const randomResponse = { foo: 'bar' };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(randomResponse, 200)
      );

      await expect(apiRequest(baseUrl, path, token)).rejects.toThrow(ApiError);

      try {
        await apiRequest(baseUrl, path, token);
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('UNKNOWN');
        expect(apiErr.message).toBe('Invalid response format');
        expect(apiErr.status).toBe(200);
      }
    });
  });
});
