import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUpdateActionUseCase } from '../../domain/usecases/updateAction.js';
import { FakeActionRepository, createMockLogger } from '../fakes.js';
import type { Action } from '../../domain/models/action.js';
import type { ChangeActionTypeUseCase } from '../../domain/usecases/changeActionType.js';

describe('UpdateActionUseCase', () => {
  let actionRepository: FakeActionRepository;
  let changeActionTypeUseCase: ReturnType<typeof vi.fn>;
  let useCase: ReturnType<typeof createUpdateActionUseCase>;

  const testAction: Action = {
    id: 'action-1',
    userId: 'user-1',
    commandId: 'cmd-1',
    type: 'todo',
    confidence: 0.85,
    title: 'Test action',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    actionRepository = new FakeActionRepository();
    changeActionTypeUseCase = vi.fn().mockResolvedValue({ ok: true, value: { actionId: 'action-1' } });
    useCase = createUpdateActionUseCase({
      actionRepository,
      changeActionTypeUseCase: changeActionTypeUseCase as unknown as ChangeActionTypeUseCase,
      logger: createMockLogger(),
    });
  });

  it('returns NOT_FOUND when action does not exist', async () => {
    const result = await useCase({
      actionId: 'non-existent',
      userId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when userId does not match', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: 'other-user',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('updates status only', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      status: 'processing',
    });

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.action.status).toBe('processing');
      expect(result.value.action.type).toBe('todo');
    }
    expect(changeActionTypeUseCase).not.toHaveBeenCalled();
  });

  it('updates type only', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      type: 'note',
    });

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.action.type).toBe('note');
      expect(result.value.action.status).toBe('awaiting_approval');
    }
    expect(changeActionTypeUseCase).toHaveBeenCalledWith({
      actionId: testAction.id,
      userId: testAction.userId,
      newType: 'note',
    });
  });

  it('updates both status and type', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      status: 'processing',
      type: 'note',
    });

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.action.status).toBe('processing');
      expect(result.value.action.type).toBe('note');
    }
  });

  it('returns error when changeActionTypeUseCase fails', async () => {
    await actionRepository.save({ ...testAction });
    changeActionTypeUseCase.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Cannot change type' },
    });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      type: 'note',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(result.error.message).toBe('Cannot change type');
    }
  });

  it('skips type change when type is same as current', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      type: 'todo',
    });

    expect(result.ok).toBe(true);
    expect(changeActionTypeUseCase).not.toHaveBeenCalled();
  });

  it('skips status update when type change fails with both status and type', async () => {
    await actionRepository.save({ ...testAction });
    changeActionTypeUseCase.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Cannot change type' },
    });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      status: 'processing',
      type: 'note',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
    // Verify status was NOT updated in repository
    const storedAction = await actionRepository.getById(testAction.id);
    expect(storedAction?.status).toBe('awaiting_approval');
  });

  it('returns action with updated type when only type changes', async () => {
    await actionRepository.save({ ...testAction });

    const result = await useCase({
      actionId: testAction.id,
      userId: testAction.userId,
      type: 'note',
    });

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.action.type).toBe('note');
      expect(result.value.action.status).toBe('awaiting_approval');
    }
  });
});
