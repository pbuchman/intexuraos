import { describe, it, expect, beforeEach } from 'vitest';
import { createChangeActionTypeUseCase } from '../../domain/usecases/changeActionType.js';
import {
  FakeActionRepository,
  FakeActionTransitionRepository,
  FakeCommandsAgentClient,
  createMockLogger,
} from '../fakes.js';
import type { Action } from '../../domain/models/action.js';

describe('ChangeActionTypeUseCase', () => {
  let actionRepository: FakeActionRepository;
  let actionTransitionRepository: FakeActionTransitionRepository;
  let commandsAgentClient: FakeCommandsAgentClient;
  let useCase: ReturnType<typeof createChangeActionTypeUseCase>;

  const testAction: Action = {
    id: 'action-1',
    userId: 'user-1',
    commandId: 'cmd-1',
    type: 'note',
    confidence: 0.85,
    title: 'Test action',
    status: 'pending',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    actionRepository = new FakeActionRepository();
    actionTransitionRepository = new FakeActionTransitionRepository();
    commandsAgentClient = new FakeCommandsAgentClient();

    useCase = createChangeActionTypeUseCase({
      actionRepository,
      actionTransitionRepository,
      commandsAgentClient,
      logger: createMockLogger(),
    });
  });

  it('returns NOT_FOUND for non-existent action', async () => {
    const result = await useCase({
      actionId: 'non-existent',
      userId: 'user-1',
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND for action belonging to different user', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: 'other-user',
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns INVALID_REQUEST for processing action', async () => {
    await actionRepository.save({ ...testAction, status: 'processing' });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('returns INVALID_REQUEST for completed action', async () => {
    await actionRepository.save({ ...testAction, status: 'completed' });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('returns INVALID_REQUEST for failed action', async () => {
    await actionRepository.save({ ...testAction, status: 'failed' });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('returns INVALID_REQUEST for rejected action', async () => {
    await actionRepository.save({ ...testAction, status: 'rejected' });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('returns INVALID_REQUEST for archived action', async () => {
    await actionRepository.save({ ...testAction, status: 'archived' });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('allows type change for pending action', async () => {
    await actionRepository.save({ ...testAction, status: 'pending' });
    commandsAgentClient.setCommand(testAction.commandId, 'Test command text');

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(true);

    const updatedAction = await actionRepository.getById(testAction.id);
    expect(updatedAction?.type).toBe('todo');
  });

  it('allows type change for awaiting_approval action', async () => {
    await actionRepository.save({ ...testAction, status: 'awaiting_approval' });
    commandsAgentClient.setCommand(testAction.commandId, 'Test command text');

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'research',
    });

    expect(result.ok).toBe(true);

    const updatedAction = await actionRepository.getById(testAction.id);
    expect(updatedAction?.type).toBe('research');
  });

  it('skips transition log when type unchanged', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: testAction.type,
    });

    expect(result.ok).toBe(true);
    expect(actionTransitionRepository.getTransitions()).toHaveLength(0);
  });

  it('returns NOT_FOUND if command missing', async () => {
    await actionRepository.save({ ...testAction });
    // Don't set command in client

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('logs transition before updating action', async () => {
    await actionRepository.save({ ...testAction });
    commandsAgentClient.setCommand(testAction.commandId, 'Original command text');

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'todo',
    });

    expect(result.ok).toBe(true);

    const transitions = actionTransitionRepository.getTransitions();
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      userId: testAction.userId,
      actionId: testAction.id,
      commandId: testAction.commandId,
      commandText: 'Original command text',
      originalType: 'note',
      newType: 'todo',
      originalConfidence: 0.85,
    });
  });

  it('updates action type and updatedAt', async () => {
    const freshAction = { ...testAction };
    const originalUpdatedAt = freshAction.updatedAt;
    await actionRepository.save(freshAction);
    commandsAgentClient.setCommand(freshAction.commandId, 'Test command');

    await useCase({
      actionId: freshAction.id,
      userId: freshAction.userId,
      newType: 'calendar',
    });

    const updatedAction = await actionRepository.getById(freshAction.id);
    expect(updatedAction?.type).toBe('calendar');
    expect(updatedAction?.updatedAt).not.toBe(originalUpdatedAt);
  });
});
