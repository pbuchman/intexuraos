import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isOk, isErr, ok, err } from '@intexuraos/common-core';
import { createHandleCalendarActionUseCase } from '../domain/usecases/handleCalendarAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { FakeActionServiceClient, FakeWhatsAppSendPublisher } from './fakes.js';
import pino from 'pino';

vi.mock('../domain/usecases/shouldAutoExecute.js', () => ({
  shouldAutoExecute: vi.fn(() => false),
}));

import { shouldAutoExecute } from '../domain/usecases/shouldAutoExecute.js';

const silentLogger = pino({ level: 'silent' });

describe('handleCalendarAction usecase', () => {
  let fakeActionClient: FakeActionServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'calendar',
    title: 'Team standup tomorrow',
    payload: {
      prompt: 'Schedule team standup for tomorrow at 10am',
      confidence: 0.9,
    },
    timestamp: '2025-01-15T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionClient = new FakeActionServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('sets action to awaiting_approval and publishes WhatsApp notification', async () => {
    fakeActionClient.setAction({
      id: 'action-123',
      userId: 'user-456',
      commandId: 'cmd-789',
      type: 'calendar',
      confidence: 0.9,
      title: 'Team standup tomorrow',
      status: 'pending',
      payload: {},
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    });

    const usecase = createHandleCalendarActionUseCase({
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
    expect(messages[0]?.message).toContain('New calendar event ready for approval');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');
  });

  it('fails when marking action as awaiting_approval fails', async () => {
    fakeActionClient.setAction({
      id: 'action-123',
      userId: 'user-456',
      commandId: 'cmd-789',
      type: 'calendar',
      confidence: 0.9,
      title: 'Team standup tomorrow',
      status: 'pending',
      payload: {},
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    });

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    fakeActionClient.setFailOn('updateActionStatus', new Error('Database unavailable'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('succeeds even when WhatsApp publish fails (best-effort notification)', async () => {
    fakeActionClient.setAction({
      id: 'action-123',
      userId: 'user-456',
      commandId: 'cmd-789',
      type: 'calendar',
      confidence: 0.9,
      title: 'Team standup tomorrow',
      status: 'pending',
      payload: {},
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    });

    const usecase = createHandleCalendarActionUseCase({
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

  it('returns success when getAction fails (deleted action)', async () => {
    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    fakeActionClient.setFailOn('getAction', new Error('Database error'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }
  });

  it('returns success when action is null (deleted between creation and handling)', async () => {
    const usecase = createHandleCalendarActionUseCase({
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
  });

  it('returns success without sending notification when action already processed (idempotency)', async () => {
    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    fakeActionClient.setAction({
      id: 'action-123',
      userId: 'user-456',
      commandId: 'cmd-789',
      type: 'calendar',
      confidence: 0.9,
      title: 'Team standup tomorrow',
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    expect(fakeActionClient.getStatusUpdates().size).toBe(0);
    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  it('returns success without sending notification when action is completed', async () => {
    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    fakeActionClient.setAction({
      id: 'action-123',
      userId: 'user-456',
      commandId: 'cmd-789',
      type: 'calendar',
      confidence: 0.9,
      title: 'Team standup tomorrow',
      status: 'completed',
      payload: {},
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    expect(fakeActionClient.getStatusUpdates().size).toBe(0);
    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  describe('auto-execute flow', () => {
    beforeEach(() => {
      vi.mocked(shouldAutoExecute).mockReturnValue(true);
    });

    afterEach(() => {
      vi.mocked(shouldAutoExecute).mockReturnValue(false);
    });

    it('auto-executes when shouldAutoExecute returns true and executeCalendarAction is provided', async () => {
      fakeActionClient.setAction({
        id: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        type: 'calendar',
        confidence: 0.9,
        title: 'Team standup tomorrow',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-15T12:00:00.000Z',
        updatedAt: '2025-01-15T12:00:00.000Z',
      });

      const fakeExecuteCalendarAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, resource_url: '/#/calendar/event-123' })
      );

      const usecase = createHandleCalendarActionUseCase({
        actionServiceClient: fakeActionClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeCalendarAction: fakeExecuteCalendarAction,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);
      expect(fakeExecuteCalendarAction).toHaveBeenCalledWith('action-123');
      expect(fakeActionClient.getStatusUpdates().get('action-123')).toBeUndefined();
    });

    it('returns error when auto-execute fails', async () => {
      fakeActionClient.setAction({
        id: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        type: 'calendar',
        confidence: 0.9,
        title: 'Team standup tomorrow',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-15T12:00:00.000Z',
        updatedAt: '2025-01-15T12:00:00.000Z',
      });

      const fakeExecuteCalendarAction = vi.fn().mockResolvedValue(
        err(new Error('Calendar service unavailable'))
      );

      const usecase = createHandleCalendarActionUseCase({
        actionServiceClient: fakeActionClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.intexuraos.com',
        logger: silentLogger,
        executeCalendarAction: fakeExecuteCalendarAction,
      });

      const event = createEvent();
      const result = await usecase.execute(event);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Calendar service unavailable');
      }
    });

    it('falls back to approval flow when executeCalendarAction is not provided', async () => {
      fakeActionClient.setAction({
        id: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        type: 'calendar',
        confidence: 0.9,
        title: 'Team standup tomorrow',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-15T12:00:00.000Z',
        updatedAt: '2025-01-15T12:00:00.000Z',
      });

      const usecase = createHandleCalendarActionUseCase({
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
