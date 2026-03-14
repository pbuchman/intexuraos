import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices, type Services } from '../services.js';
import type { FastifyInstance } from 'fastify';
import { ok, err } from '@intexuraos/common-core';
import type { AuthUser } from '@intexuraos/common-http';

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

function createFakeServices(overrides: Partial<Services> = {}): Services {
  return {
    actionRepository: {
      getById: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listByUserId: vi.fn(),
      listByStatus: vi.fn(),
      updateStatusIf: vi.fn(),
    },
    actionTransitionRepository: {
      save: vi.fn(),
      listByActionId: vi.fn(),
    },
    actionServiceClient: {
      createAction: vi.fn(),
    },
    researchServiceClient: {
      processAction: vi.fn(),
    },
    notificationSender: {
      send: vi.fn(),
    },
    commandsAgentClient: {
      reclassify: vi.fn(),
    },
    todosServiceClient: {
      processAction: vi.fn(),
    },
    notesServiceClient: {
      processAction: vi.fn(),
    },
    bookmarksServiceClient: {
      processAction: vi.fn(),
      forceRefreshBookmark: vi.fn(),
    },
    calendarServiceClient: {
      processAction: vi.fn(),
      getPreview: vi.fn(),
      generatePreview: vi.fn(),
    },
    linearAgentClient: {
      processAction: vi.fn(),
    },
    codeAgentClient: {
      processAction: vi.fn(),
      cancelTask: vi.fn(),
    },
    actionEventPublisher: {
      publish: vi.fn(),
    },
    whatsappPublisher: {
      publish: vi.fn(),
    },
    approvalMessageRepository: {
      save: vi.fn(),
      findByWamid: vi.fn(),
      findByActionId: vi.fn(),
    },
    userServiceClient: {
      getUser: vi.fn(),
      getUserSettings: vi.fn(),
      resolveModel: vi.fn(),
    },
    handleResearchActionUseCase: { execute: vi.fn() },
    handleTodoActionUseCase: { execute: vi.fn() },
    handleNoteActionUseCase: { execute: vi.fn() },
    handleLinkActionUseCase: { execute: vi.fn() },
    handleCalendarActionUseCase: { execute: vi.fn() },
    handleLinearActionUseCase: { execute: vi.fn() },
    handleCodeActionUseCase: { execute: vi.fn() },
    executeResearchActionUseCase: vi.fn(),
    executeTodoActionUseCase: vi.fn(),
    executeNoteActionUseCase: vi.fn(),
    executeLinkActionUseCase: vi.fn(),
    executeCalendarActionUseCase: vi.fn(),
    executeLinearActionUseCase: vi.fn(),
    executeCodeActionUseCase: vi.fn(),
    retryPendingActionsUseCase: { execute: vi.fn() },
    changeActionTypeUseCase: vi.fn(),
    handleApprovalReplyUseCase: vi.fn(),
    research: { execute: vi.fn() },
    todo: { execute: vi.fn() },
    note: { execute: vi.fn() },
    link: { execute: vi.fn() },
    calendar: { execute: vi.fn() },
    linear: { execute: vi.fn() },
    code: { execute: vi.fn() },
    ...overrides,
  } as unknown as Services;
}

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
