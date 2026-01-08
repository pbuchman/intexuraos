import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isOk, isErr, ok, err } from '@intexuraos/common-core';
import { createHandleTodoActionUseCase } from '../domain/usecases/handleTodoAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { FakeActionServiceClient, FakeWhatsAppSendPublisher } from './fakes.js';
import pino from 'pino';

vi.mock('../domain/usecases/shouldAutoExecute.js', () => ({
  shouldAutoExecute: vi.fn(() => false),
}));

import { shouldAutoExecute } from '../domain/usecases/shouldAutoExecute.js';

const silentLogger = pino({ level: 'silent' });

describe('handleTodoAction usecase', () => {
  let fakeActionClient: FakeActionServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'todo',
    title: 'Buy groceries',
    payload: {
      prompt: 'Milk, eggs, bread',
      confidence: 0.9,
    },
    timestamp: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionClient = new FakeActionServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('sets action to awaiting_approval and publishes WhatsApp notification', async () => {
    const usecase = createHandleTodoActionUseCase({
      actionServiceClient: fakeActionClient,
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

    const actionStatus = fakeActionClient.getStatusUpdates().get('action-123');
    expect(actionStatus).toBe('awaiting_approval');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('New todo ready for approval');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');
  });

  it('fails when marking action as awaiting_approval fails', async () => {
    const usecase = createHandleTodoActionUseCase({
      actionServiceClient: fakeActionClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    fakeActionClient.setFailNext(true, new Error('Database unavailable'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('succeeds even when WhatsApp publish fails (best-effort notification)', async () => {
    const usecase = createHandleTodoActionUseCase({
      actionServiceClient: fakeActionClient,
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

    const actionStatus = fakeActionClient.getStatusUpdates().get('action-123');
    expect(actionStatus).toBe('awaiting_approval');
  });

  describe('auto-execute flow', () => {
    beforeEach(() => {
      vi.mocked(shouldAutoExecute).mockReturnValue(true);
    });

    afterEach(() => {
      vi.mocked(shouldAutoExecute).mockReturnValue(false);
    });

    it('auto-executes when shouldAutoExecute returns true and executeTodoAction is provided', async () => {
      const fakeExecuteTodoAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, resource_url: '/#/todos/todo-123' })
      );

      const usecase = createHandleTodoActionUseCase({
        actionServiceClient: fakeActionClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeTodoAction: fakeExecuteTodoAction,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);
      expect(fakeExecuteTodoAction).toHaveBeenCalledWith('action-123');
      expect(fakeActionClient.getStatusUpdates().get('action-123')).toBeUndefined();
    });

    it('returns error when auto-execute fails', async () => {
      const fakeExecuteTodoAction = vi.fn().mockResolvedValue(
        err(new Error('Execution failed'))
      );

      const usecase = createHandleTodoActionUseCase({
        actionServiceClient: fakeActionClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeTodoAction: fakeExecuteTodoAction,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Execution failed');
      }
    });

    it('falls back to approval flow when executeTodoAction is not provided', async () => {
      const usecase = createHandleTodoActionUseCase({
        actionServiceClient: fakeActionClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);
      expect(fakeActionClient.getStatusUpdates().get('action-123')).toBe('awaiting_approval');
    });
  });
});
