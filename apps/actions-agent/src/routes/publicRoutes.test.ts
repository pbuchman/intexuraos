import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices, type Services } from '../services.js';
import type { FastifyInstance } from 'fastify';
import { ok, err } from '@intexuraos/common-core';
import type { AuthUser } from '@intexuraos/common-http';
import { createFakeServices } from './__test-helpers__/fakeServices.js';

/**
 * Mock requireAuth to return a fake user without doing real JWT validation.
 * The publicRoutes import requireAuth from '@intexuraos/common-http'.
 */
vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const original = await importOriginal<typeof import('@intexuraos/common-http')>();
  return {
    ...original,
    requireAuth: vi.fn().mockImplementation(
      async (_request: unknown, _reply: unknown): Promise<AuthUser | null> => {
        return { userId: 'user-1', claims: { email: 'test@test.com' } };
      }
    ),
  };
});

let app: FastifyInstance;

describe('GET /actions', () => {
  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    resetServices();
    await app.close();
  });

  it('returns actions for the authenticated user', async () => {
    const listByUserId = vi.fn().mockResolvedValue([
      {
        id: 'action-1',
        userId: 'user-1',
        commandId: 'cmd-1',
        type: 'note',
        confidence: 0.9,
        title: 'Test Note',
        status: 'pending',
        payload: {},
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]);
    setServices(
      createFakeServices({
        actionRepository: {
          getById: vi.fn(),
          save: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          listByUserId,
          listByStatus: vi.fn(),
          updateStatusIf: vi.fn(),
        } as unknown as Services['actionRepository'],
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/actions',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data.actions).toHaveLength(1);
    expect(json.data.actions[0].id).toBe('action-1');
  });

  it('passes status filter when query param is provided', async () => {
    const listByUserId = vi.fn().mockResolvedValue([]);
    setServices(
      createFakeServices({
        actionRepository: {
          getById: vi.fn(),
          save: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          listByUserId,
          listByStatus: vi.fn(),
          updateStatusIf: vi.fn(),
        } as unknown as Services['actionRepository'],
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/actions?status=pending,completed',
    });

    expect(response.statusCode).toBe(200);
    expect(listByUserId).toHaveBeenCalledWith('user-1', {
      status: ['pending', 'completed'],
    });
  });
});

describe('GET /actions/:actionId/preview', () => {
  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    resetServices();
    await app.close();
  });

  it('returns DOWNSTREAM_ERROR when calendarServiceClient.getPreview returns err', async () => {
    const getPreview = vi.fn().mockResolvedValue(err(new Error('downstream fail')));
    const getById = vi.fn().mockResolvedValue({
      id: 'action-cal',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'calendar',
      confidence: 0.95,
      title: 'Calendar Event',
      status: 'awaiting_approval',
      payload: { prompt: 'schedule meeting' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    setServices(
      createFakeServices({
        actionRepository: {
          getById,
          save: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          listByUserId: vi.fn(),
          listByStatus: vi.fn(),
          updateStatusIf: vi.fn(),
        } as unknown as Services['actionRepository'],
        calendarServiceClient: {
          processAction: vi.fn(),
          getPreview,
          generatePreview: vi.fn(),
        } as unknown as Services['calendarServiceClient'],
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/actions/action-cal/preview',
    });

    expect(response.statusCode).toBe(502);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('DOWNSTREAM_ERROR');
    expect(json.error.message).toBe('Failed to fetch preview');
  });

  it('returns preview data when calendarServiceClient.getPreview succeeds', async () => {
    const previewData = {
      actionId: 'action-cal',
      userId: 'user-1',
      status: 'ready' as const,
      summary: 'Team Meeting',
      start: '2024-01-15T10:00:00Z',
      generatedAt: '2024-01-01T00:00:00Z',
    };
    const getPreview = vi.fn().mockResolvedValue(ok(previewData));
    const getById = vi.fn().mockResolvedValue({
      id: 'action-cal',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'calendar',
      confidence: 0.95,
      title: 'Calendar Event',
      status: 'awaiting_approval',
      payload: { prompt: 'schedule meeting' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    setServices(
      createFakeServices({
        actionRepository: {
          getById,
          save: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          listByUserId: vi.fn(),
          listByStatus: vi.fn(),
          updateStatusIf: vi.fn(),
        } as unknown as Services['actionRepository'],
        calendarServiceClient: {
          processAction: vi.fn(),
          getPreview,
          generatePreview: vi.fn(),
        } as unknown as Services['calendarServiceClient'],
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/actions/action-cal/preview',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data.preview.summary).toBe('Team Meeting');
    expect(json.data.preview.actionId).toBe('action-cal');
  });

  it('returns NOT_FOUND when action does not belong to user', async () => {
    const getById = vi.fn().mockResolvedValue({
      id: 'action-other',
      userId: 'other-user',
      commandId: 'cmd-1',
      type: 'calendar',
      confidence: 0.95,
      title: 'Other User Event',
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    setServices(
      createFakeServices({
        actionRepository: {
          getById,
          save: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          listByUserId: vi.fn(),
          listByStatus: vi.fn(),
          updateStatusIf: vi.fn(),
        } as unknown as Services['actionRepository'],
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/actions/action-other/preview',
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns INVALID_REQUEST when action type is not calendar', async () => {
    const getById = vi.fn().mockResolvedValue({
      id: 'action-note',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'note',
      confidence: 0.9,
      title: 'A Note',
      status: 'pending',
      payload: {},
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    setServices(
      createFakeServices({
        actionRepository: {
          getById,
          save: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          listByUserId: vi.fn(),
          listByStatus: vi.fn(),
          updateStatusIf: vi.fn(),
        } as unknown as Services['actionRepository'],
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/actions/action-note/preview',
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toBe('Preview is only available for calendar actions');
  });
});
