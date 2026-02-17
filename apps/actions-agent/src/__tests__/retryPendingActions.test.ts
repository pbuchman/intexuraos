import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRetryPendingActionsUseCase } from '../domain/usecases/retryPendingActions.js';
import type { Action } from '../domain/models/action.js';
import { FakeActionRepository, FakeActionEventPublisher } from './fakes.js';
import type { HandleResearchActionUseCase } from '../domain/usecases/handleResearchAction.js';
import type { HandleTodoActionUseCase } from '../domain/usecases/handleTodoAction.js';
import type { HandleNoteActionUseCase } from '../domain/usecases/handleNoteAction.js';
import type { HandleLinkActionUseCase } from '../domain/usecases/handleLinkAction.js';
import type { HandleCalendarActionUseCase } from '../domain/usecases/handleCalendarAction.js';
import type { HandleLinearActionUseCase } from '../domain/usecases/handleLinearAction.js';
import type { HandleCodeActionUseCase } from '../domain/usecases/handleCodeAction.js';
import { ok } from '@intexuraos/common-core';

import { createMockLogger } from './fakes.js';

const createFakeHandler = (): { execute: ReturnType<typeof vi.fn> } => ({
  execute: vi.fn().mockResolvedValue(ok({ actionId: 'test' })),
});

describe('retryPendingActions usecase', () => {
  let fakeActionRepository: FakeActionRepository;
  let fakeActionEventPublisher: FakeActionEventPublisher;
  let fakeHandlers: {
    research: HandleResearchActionUseCase;
    todo: HandleTodoActionUseCase;
    note: HandleNoteActionUseCase;
    link: HandleLinkActionUseCase;
    calendar: HandleCalendarActionUseCase;
    linear: HandleLinearActionUseCase;
    code: HandleCodeActionUseCase;
  };

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'todo',
    title: 'Test Action',
    status: 'pending',
    confidence: 0.9,
    payload: {},
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepository = new FakeActionRepository();
    fakeActionEventPublisher = new FakeActionEventPublisher();
    fakeHandlers = {
      research: createFakeHandler() as unknown as HandleResearchActionUseCase,
      todo: createFakeHandler() as unknown as HandleTodoActionUseCase,
      note: createFakeHandler() as unknown as HandleNoteActionUseCase,
      link: createFakeHandler() as unknown as HandleLinkActionUseCase,
      calendar: createFakeHandler() as unknown as HandleCalendarActionUseCase,
      linear: createFakeHandler() as unknown as HandleLinearActionUseCase,
      code: createFakeHandler() as unknown as HandleCodeActionUseCase,
    };
  });

  it('processes pending actions older than 1 hour', async () => {
    const oldAction = createAction({
      id: 'old-action',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    });
    fakeActionRepository.getActions().set(oldAction.id, oldAction);

    const usecase = createRetryPendingActionsUseCase({
      actionRepository: fakeActionRepository,
      actionEventPublisher: fakeActionEventPublisher,
      actionHandlerRegistry: fakeHandlers,
      logger: createMockLogger(),
    });

    const result = await usecase.execute();

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(fakeActionEventPublisher.getPublishedEvents()).toHaveLength(1);
  });

  it('skips pending actions younger than 1 hour', async () => {
    const recentAction = createAction({
      id: 'recent-action',
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    });
    fakeActionRepository.getActions().set(recentAction.id, recentAction);

    const usecase = createRetryPendingActionsUseCase({
      actionRepository: fakeActionRepository,
      actionEventPublisher: fakeActionEventPublisher,
      actionHandlerRegistry: fakeHandlers,
      logger: createMockLogger(),
    });

    const result = await usecase.execute();

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons['too_recent']).toBe(1);
    expect(fakeActionEventPublisher.getPublishedEvents()).toHaveLength(0);
  });

  it('correctly handles mix of old and recent actions', async () => {
    const oldAction = createAction({
      id: 'old-action',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    });
    const recentAction = createAction({
      id: 'recent-action',
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    });
    fakeActionRepository.getActions().set(oldAction.id, oldAction);
    fakeActionRepository.getActions().set(recentAction.id, recentAction);

    const usecase = createRetryPendingActionsUseCase({
      actionRepository: fakeActionRepository,
      actionEventPublisher: fakeActionEventPublisher,
      actionHandlerRegistry: fakeHandlers,
      logger: createMockLogger(),
    });

    const result = await usecase.execute();

    expect(result.total).toBe(2);
    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons['too_recent']).toBe(1);
  });

  it('skips actions without registered handler', async () => {
    const unsupportedAction = createAction({
      id: 'unsupported-action',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'unsupported' as any, // No handler registered for this type
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    fakeActionRepository.getActions().set(unsupportedAction.id, unsupportedAction);

    const usecase = createRetryPendingActionsUseCase({
      actionRepository: fakeActionRepository,
      actionEventPublisher: fakeActionEventPublisher,
      actionHandlerRegistry: fakeHandlers,
      logger: createMockLogger(),
    });

    const result = await usecase.execute();

    expect(result.skipped).toBe(1);
    expect(result.skipReasons['no_handler_registered']).toBe(1);
  });

  it('increments failed count when publish fails', async () => {
    const oldAction = createAction({
      id: 'old-action',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    fakeActionRepository.getActions().set(oldAction.id, oldAction);

    fakeActionEventPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'Test failure',
    });

    const usecase = createRetryPendingActionsUseCase({
      actionRepository: fakeActionRepository,
      actionEventPublisher: fakeActionEventPublisher,
      actionHandlerRegistry: fakeHandlers,
      logger: createMockLogger(),
    });

    const result = await usecase.execute();

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });
});
