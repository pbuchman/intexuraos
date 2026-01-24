import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createHandleCodeActionUseCase } from '../domain/usecases/handleCodeAction.js';
import { registerActionHandler } from '../domain/usecases/createIdempotentActionHandler.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { FakeActionRepository, FakeWhatsAppSendPublisher, createFakeExecuteCodeActionUseCase } from './fakes.js';
import pino from 'pino';

vi.mock('../domain/usecases/shouldAutoExecute.js', () => ({
  shouldAutoExecute: vi.fn(() => false),
}));

import { shouldAutoExecute } from '../domain/usecases/shouldAutoExecute.js';

const silentLogger = pino({ level: 'silent' });

describe('handleCodeAction usecase', () => {
  let fakeActionRepository: FakeActionRepository;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'code',
    title: 'Fix authentication bug',
    payload: {
      prompt: 'Fix the login bug',
      confidence: 0.95,
    },
    timestamp: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  const createAction = (): {
    id: 'action-123';
    userId: 'user-456';
    commandId: 'cmd-789';
    type: 'code';
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
    type: 'code' as const,
    confidence: 0.95,
    title: 'Fix authentication bug',
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

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
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
    expect(messages[0]?.message).toContain('Code task: Fix the login bug');
    expect(messages[0]?.message).toContain('Estimated cost: $1-2');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');
  });

  it('truncates prompt preview when prompt is longer than 100 characters', async () => {
    const longPrompt = 'Fix the login bug that occurs when users try to authenticate with their credentials and the system fails to validate the token properly';
    const action = createAction({
      payload: { prompt: longPrompt, confidence: 0.95 },
    });
    await fakeActionRepository.save(action);

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const event = createEvent({
      payload: { prompt: longPrompt, confidence: 0.95 },
    });
    await usecase.execute(event);

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('Code task:');
    const promptInMessage = messages[0]?.message.split('Code task: ')[1]?.split('\n')[0];
    expect(promptInMessage?.length).toBeLessThanOrEqual(103); // "Code task: " (12) + "..." (3) + 100 char prompt = 115 max
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    await fakeActionRepository.save(createAction());
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
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
  });

  it('auto-executes when shouldAutoExecute returns true', async () => {
    const mockShouldAutoExecute = vi.mocked(shouldAutoExecute);
    mockShouldAutoExecute.mockReturnValue(true);

    await fakeActionRepository.save(createAction());

    const fakeExecuteCodeAction = createFakeExecuteCodeActionUseCase();

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
      executeCodeAction: fakeExecuteCodeAction,
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    // Verify auto-execution happened (action should be completed)
    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('completed');

    mockShouldAutoExecute.mockRestore();
  });

  it('does not auto-execute when shouldAutoExecute returns false', async () => {
    const mockShouldAutoExecute = vi.mocked(shouldAutoExecute);
    mockShouldAutoExecute.mockReturnValue(false);

    await fakeActionRepository.save(createAction());

    const fakeExecuteCodeAction = createFakeExecuteCodeActionUseCase();

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
      executeCodeAction: fakeExecuteCodeAction,
    });

    const event = createEvent();
    await usecase.execute(event);

    // Verify approval flow (not auto-execution)
    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('awaiting_approval');

    mockShouldAutoExecute.mockRestore();
  });

  describe('idempotency', () => {
    it('returns ok immediately when action already in awaiting_approval status', async () => {
      const action = createAction({ status: 'awaiting_approval' });
      await fakeActionRepository.save(action);

      const usecase = registerActionHandler(createHandleCodeActionUseCase, {
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

      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
    });
  });
});
