import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createHandleCalendarActionUseCase } from '../domain/usecases/handleCalendarAction.js';
import { registerActionHandler } from '../domain/usecases/createIdempotentActionHandler.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import {
  FakeActionRepository,
  FakeWhatsAppSendPublisher,
  FakeCalendarPreviewPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('handleCalendarAction usecase', () => {
  let fakeActionRepository: FakeActionRepository;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;
  let fakeCalendarPreviewPublisher: FakeCalendarPreviewPublisher;

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

  const createAction = (): {
    id: 'action-123';
    userId: 'user-456';
    commandId: 'cmd-789';
    type: 'calendar';
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
    type: 'calendar' as const,
    confidence: 0.9,
    title: 'Team standup tomorrow',
    status: 'pending' as const,
    payload: {},
    createdAt: '2025-01-15T12:00:00.000Z',
    updatedAt: '2025-01-15T12:00:00.000Z',
  });

  beforeEach(() => {
    fakeActionRepository = new FakeActionRepository();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
    fakeCalendarPreviewPublisher = new FakeCalendarPreviewPublisher();
  });

  it('sets action to awaiting_approval and publishes WhatsApp notification', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarPreviewPublisher: fakeCalendarPreviewPublisher,
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
    expect(messages[0]?.message).toContain('New calendar event ready for approval');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');

    // Verify preview generation was triggered
    const previewRequests = fakeCalendarPreviewPublisher.getPublishedRequests();
    expect(previewRequests).toHaveLength(1);
    expect(previewRequests[0]?.actionId).toBe('action-123');
    expect(previewRequests[0]?.userId).toBe('user-456');
    expect(previewRequests[0]?.text).toBe('Schedule team standup for tomorrow at 10am');
  });

  it('succeeds even when preview generation fails (non-fatal)', async () => {
    await fakeActionRepository.save(createAction());

    fakeCalendarPreviewPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'Preview generation unavailable',
    });

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarPreviewPublisher: fakeCalendarPreviewPublisher,
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

  it('fails when marking action as awaiting_approval fails', async () => {
    await fakeActionRepository.save(createAction());

    fakeActionRepository.setFailNext(true, new Error('Database unavailable'));

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarPreviewPublisher: fakeCalendarPreviewPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('succeeds even when WhatsApp publish fails (best-effort notification)', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarPreviewPublisher: fakeCalendarPreviewPublisher,
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

  it('returns success without sending notification when action already processed (idempotency)', async () => {
    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarPreviewPublisher: fakeCalendarPreviewPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    await fakeActionRepository.save({
      ...createAction(),
      status: 'awaiting_approval',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  it('returns success without sending notification when action is completed', async () => {
    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarPreviewPublisher: fakeCalendarPreviewPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    await fakeActionRepository.save({
      ...createAction(),
      status: 'completed',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  it('returns success when action is not found (deleted action)', async () => {
    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarPreviewPublisher: fakeCalendarPreviewPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });
});
