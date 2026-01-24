/**
 * Tests for ActionsAgentClient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { Logger } from 'pino';
import {
  createActionsAgentClient,
  type ActionsAgentClient,
} from '../../../infra/actionsAgent/client.js';

const createFakeLogger = (): Logger =>
  pino({
    level: 'silent',
  });

describe('ActionsAgentClient', () => {
  let client: ActionsAgentClient;
  const baseUrl = 'http://localhost:8080';
  const internalAuthToken = 'test-internal-token';

  beforeEach(() => {
    client = createActionsAgentClient({ baseUrl, internalAuthToken, logger: createFakeLogger() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createAction', () => {
    const validParams = {
      userId: 'user-123',
      commandId: 'cmd-456',
      type: 'todo' as const,
      title: 'Test action',
      confidence: 0.95,
    };

    it('returns action on successful response', async () => {
      const mockAction = {
        id: 'action-789',
        userId: 'user-123',
        commandId: 'cmd-456',
        type: 'todo',
        title: 'Test action',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockAction }),
      } as Response);

      const result = await client.createAction(validParams);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('action-789');
        expect(result.value.type).toBe('todo');
      }
    });

    it('sends correct request to actions agent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'action-1' } }),
      } as Response);

      await client.createAction(validParams);

      expect(fetchSpy).toHaveBeenCalledWith(
        `${baseUrl}/internal/actions`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-auth': internalAuthToken,
          },
          body: JSON.stringify(validParams),
        })
      );
    });

    it('sends payload when provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'action-1' } }),
      } as Response);

      const paramsWithPayload = {
        ...validParams,
        payload: { key: 'value', nested: { data: true } },
      };

      await client.createAction(paramsWithPayload);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(paramsWithPayload),
        })
      );
    });

    it('returns error on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid request body',
      } as Response);

      const result = await client.createAction(validParams);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to create action');
        expect(result.error.message).toContain('400');
        expect(result.error.message).toContain('Bad Request');
      }
    });

    it('returns error when success is false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false }),
      } as Response);

      const result = await client.createAction(validParams);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('response.success is false');
      }
    });

    it('returns error on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await client.createAction(validParams);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to create action: Network error');
      }
    });

    it('handles non-Error throws', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('String error');

      const result = await client.createAction(validParams);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to create action: Unknown error');
      }
    });

    it('returns error on 500 internal server error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Something went wrong',
      } as Response);

      const result = await client.createAction(validParams);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('500');
      }
    });

    it('returns error on 401 unauthorized', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid auth token',
      } as Response);

      const result = await client.createAction(validParams);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('401');
        expect(result.error.message).toContain('Unauthorized');
      }
    });

    it('handles different action types', async () => {
      const types = ['todo', 'research', 'note', 'link', 'calendar', 'reminder'] as const;

      for (const type of types) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { id: 'action-1', type } }),
        } as Response);

        const result = await client.createAction({ ...validParams, type });
        expect(result.ok).toBe(true);
      }
    });
  });
});
