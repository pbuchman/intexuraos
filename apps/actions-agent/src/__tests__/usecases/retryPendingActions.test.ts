import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRetryPendingActionsUseCase } from '../../domain/usecases/retryPendingActions.js';
import type { ActionRepository } from '../../domain/ports/actionRepository.js';
import type { ActionEventPublisher } from '../../infra/pubsub/actionEventPublisher.js';
import type { ActionHandlerRegistry } from '../../domain/usecases/actionHandlerRegistry.js';
import type { Action } from '../../domain/models/action.js';
import { ok, err } from '@intexuraos/common-core';
import pino from 'pino';

const createTestAction = (overrides: Partial<Action> = {}): Action => ({
  id: 'action-1',
  userId: 'user-1',
  commandId: 'cmd-1',
  type: 'research',
  confidence: 0.9,
  title: 'Test Action',
  status: 'pending',
  payload: {},
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('retryPendingActions', () => {
  let mockRepository: {
    listByStatus: ReturnType<typeof vi.fn>;
  };
  let mockPublisher: {
    publishActionCreated: ReturnType<typeof vi.fn>;
  };
  let mockRegistry: ActionHandlerRegistry;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    mockRepository = {
      listByStatus: vi.fn(),
    };
    mockPublisher = {
      publishActionCreated: vi.fn(),
    };
    mockRegistry = {
      research: {
        execute: vi.fn().mockResolvedValue(ok({ actionId: 'action-1' })),
      },
      todo: {
        execute: vi.fn().mockResolvedValue(ok({ actionId: 'action-1' })),
      },
      note: {
        execute: vi.fn().mockResolvedValue(ok({ actionId: 'action-1' })),
      },
      link: {
        execute: vi.fn().mockResolvedValue(ok({ actionId: 'action-1' })),
      },
      calendar: {
        execute: vi.fn().mockResolvedValue(ok({ actionId: 'action-1' })),
      },
      linear: {
        execute: vi.fn().mockResolvedValue(ok({ actionId: 'action-1' })),
      },
    };
  });

  it('returns empty result when no pending actions', async () => {
    mockRepository.listByStatus.mockResolvedValue([]);

    const useCase = createRetryPendingActionsUseCase({
      actionRepository: mockRepository as unknown as ActionRepository,
      actionEventPublisher: mockPublisher as unknown as ActionEventPublisher,
      actionHandlerRegistry: mockRegistry,
      logger,
    });

    const result = await useCase.execute();

    expect(result).toEqual({ processed: 0, skipped: 0, failed: 0, total: 0, skipReasons: {} });
    expect(mockRepository.listByStatus).toHaveBeenCalledWith('pending');
  });

  it('skips actions without handler', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsupportedAction = createTestAction({ type: 'unsupported' as any });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unknownAction = createTestAction({ id: 'action-2', type: 'unknown' as any });
    mockRepository.listByStatus.mockResolvedValue([unsupportedAction, unknownAction]);

    const useCase = createRetryPendingActionsUseCase({
      actionRepository: mockRepository as unknown as ActionRepository,
      actionEventPublisher: mockPublisher as unknown as ActionEventPublisher,
      actionHandlerRegistry: mockRegistry,
      logger,
    });

    const result = await useCase.execute();

    expect(result).toEqual({
      processed: 0,
      skipped: 2,
      failed: 0,
      total: 2,
      skipReasons: { no_handler_registered: 2 },
    });
    expect(mockPublisher.publishActionCreated).not.toHaveBeenCalled();
  });

  it('publishes event for actions with handler', async () => {
    mockRepository.listByStatus.mockResolvedValue([createTestAction({ type: 'research' })]);
    mockPublisher.publishActionCreated.mockResolvedValue(ok(undefined));

    const useCase = createRetryPendingActionsUseCase({
      actionRepository: mockRepository as unknown as ActionRepository,
      actionEventPublisher: mockPublisher as unknown as ActionEventPublisher,
      actionHandlerRegistry: mockRegistry,
      logger,
    });

    const result = await useCase.execute();

    expect(result).toEqual({
      processed: 1,
      skipped: 0,
      failed: 0,
      total: 1,
      skipReasons: {},
    });
    expect(mockPublisher.publishActionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'action.created',
        actionId: 'action-1',
        actionType: 'research',
      })
    );
  });

  it('handles publish failure gracefully', async () => {
    mockRepository.listByStatus.mockResolvedValue([createTestAction({ type: 'research' })]);
    mockPublisher.publishActionCreated.mockResolvedValue(
      err({ code: 'PUBLISH_FAILED', message: 'Network error' })
    );

    const useCase = createRetryPendingActionsUseCase({
      actionRepository: mockRepository as unknown as ActionRepository,
      actionEventPublisher: mockPublisher as unknown as ActionEventPublisher,
      actionHandlerRegistry: mockRegistry,
      logger,
    });

    const result = await useCase.execute();

    expect(result).toEqual({
      processed: 0,
      skipped: 0,
      failed: 1,
      total: 1,
      skipReasons: {},
    });
  });

  it('processes multiple actions independently', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsupportedAction = createTestAction({ id: 'action-2', type: 'unsupported' as any });
    mockRepository.listByStatus.mockResolvedValue([
      createTestAction({ id: 'action-1', type: 'research' }),
      unsupportedAction,
      createTestAction({ id: 'action-3', type: 'research' }),
    ]);
    mockPublisher.publishActionCreated
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(err({ code: 'PUBLISH_FAILED', message: 'Error' }));

    const useCase = createRetryPendingActionsUseCase({
      actionRepository: mockRepository as unknown as ActionRepository,
      actionEventPublisher: mockPublisher as unknown as ActionEventPublisher,
      actionHandlerRegistry: mockRegistry,
      logger,
    });

    const result = await useCase.execute();

    expect(result).toEqual({
      processed: 1,
      skipped: 1,
      failed: 1,
      total: 3,
      skipReasons: { no_handler_registered: 1 },
    });
  });
});
