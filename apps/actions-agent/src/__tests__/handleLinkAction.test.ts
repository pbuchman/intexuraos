import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isOk, isErr, ok, err } from '@intexuraos/common-core';
import { createHandleLinkActionUseCase } from '../domain/usecases/handleLinkAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { FakeActionRepository, FakeWhatsAppSendPublisher } from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('handleLinkAction usecase', () => {
  let fakeActionRepository: FakeActionRepository;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'link',
    title: 'Save this article https://example.com/article',
    payload: {
      prompt: 'https://example.com/article',
      confidence: 0.95,
    },
    timestamp: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  const createAction = (): {
    id: 'action-123';
    userId: 'user-456';
    commandId: 'cmd-789';
    type: 'link';
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
    type: 'link' as const,
    confidence: 0.95,
    title: 'Save this article https://example.com/article',
    status: 'pending' as const,
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
  });

  beforeEach(() => {
    fakeActionRepository = new FakeActionRepository();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('sets action to awaiting_approval and publishes WhatsApp notification for non-100% confidence', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = createHandleLinkActionUseCase({
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    // Default event has 0.95 confidence (< 100%), so it requires approval
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
    expect(messages[0]?.message).toContain('New link ready to save');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');
  });

  it('fails when marking action as awaiting_approval fails', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = createHandleLinkActionUseCase({
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

    const usecase = createHandleLinkActionUseCase({
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
    const usecase = createHandleLinkActionUseCase({
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

    const usecase = createHandleLinkActionUseCase({
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

  describe('auto-execute flow for 100% confidence links', () => {
    it('auto-executes when confidence is 100% and executeLinkAction is provided', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteLinkAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, resource_url: '/#/bookmarks/bookmark-123' })
      );

      const usecase = createHandleLinkActionUseCase({
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeLinkAction: fakeExecuteLinkAction,
      });

      // Event with 100% confidence triggers auto-execute
      const event = createEvent({ payload: { prompt: 'https://example.com/article', confidence: 1 } });
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);
      expect(fakeExecuteLinkAction).toHaveBeenCalledWith('action-123');

      // Action should still be pending (executeLinkAction handles status update)
      const action = await fakeActionRepository.getById('action-123');
      expect(action?.status).toBe('pending');

      // No "awaiting_approval" message should be sent for auto-executed actions
      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);
    });

    it('returns error when auto-execute fails', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteLinkAction = vi.fn().mockResolvedValue(
        err(new Error('Execution failed'))
      );

      const usecase = createHandleLinkActionUseCase({
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeLinkAction: fakeExecuteLinkAction,
      });

      const event = createEvent({ payload: { prompt: 'https://example.com/article', confidence: 1 } });
      const result = await usecase.execute(event);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Execution failed');
      }
    });

    it('falls back to approval flow when executeLinkAction is not provided', async () => {
      await fakeActionRepository.save(createAction());

      const usecase = createHandleLinkActionUseCase({
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
      });

      const event = createEvent({ payload: { prompt: 'https://example.com/article', confidence: 1 } });
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);

      // Action should be updated to awaiting_approval when executeLinkAction is not available
      const action = await fakeActionRepository.getById('action-123');
      expect(action?.status).toBe('awaiting_approval');
    });

    it('does NOT auto-execute when confidence is less than 100%', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteLinkAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, resource_url: '/#/bookmarks/bookmark-123' })
      );

      const usecase = createHandleLinkActionUseCase({
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeLinkAction: fakeExecuteLinkAction,
      });

      // Event with 99% confidence does NOT trigger auto-execute
      const event = createEvent({ payload: { prompt: 'https://example.com/article', confidence: 0.99 } });
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);
      expect(fakeExecuteLinkAction).not.toHaveBeenCalled();

      // Action should be updated to awaiting_approval
      const action = await fakeActionRepository.getById('action-123');
      expect(action?.status).toBe('awaiting_approval');

      // Approval message should be sent
      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('New link ready to save');
    });
  });
});
