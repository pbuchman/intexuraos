import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteCalendarActionUseCase } from '../domain/usecases/executeCalendarAction.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeCalendarServiceClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('executeCalendarAction usecase', () => {
  let fakeActionRepo: FakeActionRepository;
  let fakeCalendarClient: FakeCalendarServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'calendar',
    confidence: 0.9,
    title: 'Meeting with John',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepo = new FakeActionRepository();
    fakeCalendarClient = new FakeCalendarServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns error when action not found', async () => {
    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('non-existent-action');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe('Action not found');
    }
  });

  it('returns completed status for already completed action', async () => {
    const action = createAction({
      status: 'completed',
      payload: { resource_url: '/#/calendar' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('/#/calendar');
    }
  });

  it('returns error for action with invalid status', async () => {
    const action = createAction({ status: 'processing' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cannot execute action with status');
    }
  });

  it('processes calendar event and updates action to completed on success', async () => {
    const action = createAction({
      status: 'awaiting_approval',
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('/#/calendar');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['resource_url']).toBe('/#/calendar');
  });

  it('updates action to failed when calendar service returns failed status', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeCalendarClient.setNextResponse({
      status: 'failed',
      message: 'Invalid date format',
      errorCode: 'VALIDATION_ERROR',
    });

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Invalid date format');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('updates action to failed with default error message when calendar service returns failed without detailed message', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeCalendarClient.setNextResponse({
      status: 'failed',
      message: 'Unknown error',
      errorCode: 'UNKNOWN_ERROR',
    });

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Unknown error');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
    expect(updatedAction?.payload['message']).toBe('Unknown error');
  });

  it('updates action to failed when calendar service call fails', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeCalendarClient.setFailNext(true, new Error('Calendar service unavailable'));

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Calendar service unavailable');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('allows execution from failed status (retry)', async () => {
    const action = createAction({ status: 'failed' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('publishes WhatsApp notification on success', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Calendar event created');
    expect(messages[0]?.message).toContain('https://app.test.com/#/calendar');
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('passes correct action to calendar service', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const processedActions = fakeCalendarClient.getProcessedActions();
    expect(processedActions).toHaveLength(1);
    expect(processedActions[0]?.action.id).toBe('action-123');
    expect(processedActions[0]?.action.userId).toBe('user-456');
  });

  it('does not send WhatsApp notification when resourceUrl is missing', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeCalendarClient.setNextResponse({
      status: 'completed',
      message: 'Calendar event created',
    });

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(0);
  });

  it('returns completed status with message from payload for already completed action', async () => {
    const action = createAction({
      status: 'completed',
      payload: {
        resource_url: '/#/calendar',
        message: 'Previously created calendar event',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.message).toBe('Previously created calendar event');
      expect(result.value.resourceUrl).toBe('/#/calendar');
    }
  });

  it('allows execution from pending status', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });
});
