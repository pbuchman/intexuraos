import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isOk, isErr, ok, err } from '@intexuraos/common-core';
import { createHandleNoteActionUseCase } from '../domain/usecases/handleNoteAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { FakeActionRepository, FakeWhatsAppSendPublisher } from './fakes.js';
import pino from 'pino';

vi.mock('../domain/usecases/shouldAutoExecute.js', () => ({
  shouldAutoExecute: vi.fn(() => false),
}));

import { shouldAutoExecute } from '../domain/usecases/shouldAutoExecute.js';

const silentLogger = pino({ level: 'silent' });

describe('handleNoteAction usecase', () => {
  let fakeActionRepository: FakeActionRepository;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'note',
    title: 'Meeting notes',
    payload: {
      prompt: 'Discussed quarterly goals',
      confidence: 0.85,
    },
    timestamp: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  const createAction = (): {
    id: 'action-123';
    userId: 'user-456';
    commandId: 'cmd-789';
    type: 'note';
    confidence: number;
    title: string;
    status: 'pending';
    payload: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  } => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'note' as const,
    confidence: 0.85,
    title: 'Meeting notes',
    status: 'pending' as const,
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
  });

  beforeEach(() => {
    fakeActionRepository = new FakeActionRepository();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('sets action to awaiting_approval and publishes WhatsApp notification', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = createHandleNoteActionUseCase({
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('awaiting_approval');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('New note ready for approval');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');
  });

  it('fails when marking action as awaiting_approval fails', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = createHandleNoteActionUseCase({
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    fakeActionRepository.setFailNext(true, new Error('Database unavailable'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('succeeds even when WhatsApp publish fails (best-effort notification)', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = createHandleNoteActionUseCase({
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('awaiting_approval');
  });

  it('returns success when action does not exist (deleted between creation and handling)', async () => {
    const usecase = createHandleNoteActionUseCase({
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    // Should not send WhatsApp message since action doesn't exist
    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  it('returns success without sending notification when action already processed (idempotency)', async () => {
    const action = createAction();
    await fakeActionRepository.save({ ...action, status: 'awaiting_approval' });

    const usecase = createHandleNoteActionUseCase({
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    // Should not send WhatsApp message since action was already processed
    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  describe('auto-execute flow', () => {
    beforeEach(() => {
      vi.mocked(shouldAutoExecute).mockReturnValue(true);
    });

    afterEach(() => {
      vi.mocked(shouldAutoExecute).mockReturnValue(false);
    });

    it('auto-executes when shouldAutoExecute returns true and executeNoteAction is provided', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteNoteAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, resource_url: '/#/notes/note-123' })
      );

      const usecase = createHandleNoteActionUseCase({
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeNoteAction: fakeExecuteNoteAction,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);
      expect(fakeExecuteNoteAction).toHaveBeenCalledWith('action-123');

      // Action should still be pending (not updated to awaiting_approval)
      const action = await fakeActionRepository.getById('action-123');
      expect(action?.status).toBe('pending');
    });

    it('returns error when auto-execute fails', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteNoteAction = vi.fn().mockResolvedValue(
        err(new Error('Execution failed'))
      );

      const usecase = createHandleNoteActionUseCase({
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeNoteAction: fakeExecuteNoteAction,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Execution failed');
      }
    });

    it('falls back to approval flow when executeNoteAction is not provided', async () => {
      await fakeActionRepository.save(createAction());

      const usecase = createHandleNoteActionUseCase({
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);

      // Action should be updated to awaiting_approval
      const action = await fakeActionRepository.getById('action-123');
      expect(action?.status).toBe('awaiting_approval');
    });
  });
});
