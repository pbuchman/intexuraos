import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isOk } from '@intexuraos/common-core';
import { createHandleCodeActionUseCase } from '../domain/usecases/handleCodeAction.js';
import { registerActionHandler } from '../domain/usecases/createIdempotentActionHandler.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import type { ActionStatus } from '../domain/models/action.js';
import type { Logger } from 'pino';
import {
  FakeActionRepository,
  FakeWhatsAppSendPublisher,
  createFakeExecuteCodeActionUseCaseWithRepo,
} from './fakes.js';

vi.mock('../domain/usecases/shouldAutoExecute.js', () => ({
  shouldAutoExecute: vi.fn(() => false),
}));

import { shouldAutoExecute } from '../domain/usecases/shouldAutoExecute.js';

// Create a proper logger mock that actually logs (for coverage)
const createMockLogger = (): Logger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'silent',
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    msgPrefix: '',
  }) as unknown as Logger;

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

  const createAction = (overrides: Partial<{
    payload: Record<string, unknown>;
    status: ActionStatus;
  }> = {}): {
    id: 'action-123';
    userId: 'user-456';
    commandId: 'cmd-789';
    type: 'code';
    confidence: number;
    title: string;
    status: ActionStatus;
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
    status: 'pending' as ActionStatus,
    payload: { prompt: 'Fix the login bug', confidence: 0.95, ...overrides.payload },
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
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
      logger: createMockLogger(),
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
    expect(messages[0]?.message).toContain('Code task:');
    expect(messages[0]?.message).toContain('Fix the login bug');
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
      logger: createMockLogger(),
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
      logger: createMockLogger(),
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

    const fakeExecuteCodeAction = createFakeExecuteCodeActionUseCaseWithRepo(fakeActionRepository);

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
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

    const fakeExecuteCodeAction = createFakeExecuteCodeActionUseCaseWithRepo(fakeActionRepository);

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
      executeCodeAction: fakeExecuteCodeAction,
    });

    const event = createEvent();
    await usecase.execute(event);

    // Verify approval flow (not auto-execution)
    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('awaiting_approval');

    mockShouldAutoExecute.mockRestore();
  });

  it('returns error when auto-execute fails', async () => {
    const mockShouldAutoExecute = vi.mocked(shouldAutoExecute);
    mockShouldAutoExecute.mockReturnValue(true);

    await fakeActionRepository.save(createAction());

    const fakeExecuteCodeAction = createFakeExecuteCodeActionUseCaseWithRepo(fakeActionRepository, {
      failWithError: new Error('Worker unavailable'),
    });

    const usecase = registerActionHandler(createHandleCodeActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
      executeCodeAction: fakeExecuteCodeAction,
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Worker unavailable');
    }

    mockShouldAutoExecute.mockRestore();
  });

  describe('idempotency', () => {
    it('returns success without sending notification when action already processed (idempotency)', async () => {
      const action = createAction({ status: 'awaiting_approval' });
      await fakeActionRepository.save(action);

      const usecase = registerActionHandler(createHandleCodeActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.actionId).toBe('action-123');
      }

      // Should not send WhatsApp message since action was already processed
      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe('WhatsApp message formatting', () => {
    it('uses title as prompt fallback when prompt is not a string', async () => {
      const action = createAction({
        payload: { prompt: 12345, confidence: 0.95 }, // prompt is not a string
      });
      await fakeActionRepository.save(action);

      const usecase = registerActionHandler(createHandleCodeActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
      });

      const event = createEvent({
        payload: { prompt: 12345, confidence: 0.95 },
      });

      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);

      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      // Should use title as fallback since prompt is not a string
      expect(messages[0]?.message).toContain('Fix authentication bug');
    });

    it('uses title when prompt is missing from payload', async () => {
      const action = createAction({
        payload: { confidence: 0.95 }, // prompt missing
      });
      await fakeActionRepository.save(action);

      const usecase = registerActionHandler(createHandleCodeActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
      });

      const event = createEvent({
        payload: { confidence: 0.95 },
      });

      await usecase.execute(event);

      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages[0]?.message).toContain('Fix authentication bug');
    });

    it('includes estimated cost in approval message', async () => {
      await fakeActionRepository.save(createAction());

      const usecase = registerActionHandler(createHandleCodeActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
      });

      const event = createEvent();
      await usecase.execute(event);

      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages[0]?.message).toContain('Estimated cost: $1-2');
    });
  });
});
