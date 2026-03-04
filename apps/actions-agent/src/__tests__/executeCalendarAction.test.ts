import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteCalendarActionUseCase } from '../domain/usecases/executeCalendarAction.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeCalendarServiceClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';

import { createMockLogger } from './fakes.js';

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
      logger: createMockLogger(),
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed'); // @allow-result-access -- guarded by isOk() check above
      expect(result.value.resourceUrl).toBe('/#/calendar'); // @allow-result-access -- guarded by isOk() check above
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
      logger: createMockLogger(),
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed'); // @allow-result-access -- guarded by isOk() check above
      expect(result.value.resourceUrl).toBe('https://calendar.google.com/calendar/event?eid=fake123'); // @allow-result-access -- guarded by isOk() check above
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['resource_url']).toBe('https://calendar.google.com/calendar/event?eid=fake123');
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed'); // @allow-result-access -- guarded by isOk() check above
      expect(result.value.message).toBe('Invalid date format'); // @allow-result-access -- guarded by isOk() check above
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed'); // @allow-result-access -- guarded by isOk() check above
      expect(result.value.message).toBe('Unknown error'); // @allow-result-access -- guarded by isOk() check above
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed'); // @allow-result-access -- guarded by isOk() check above
      expect(result.value.message).toBe('Calendar service unavailable'); // @allow-result-access -- guarded by isOk() check above
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed'); // @allow-result-access -- guarded by isOk() check above
    }
  });

  it('publishes WhatsApp notification with Google Calendar URL on success', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Calendar event created');
    expect(messages[0]?.message).toContain('https://calendar.google.com/calendar/event?eid=fake123');
    // Absolute URL should NOT be prepended with webAppUrl
    expect(messages[0]?.message).not.toContain('https://app.test.com/https://');
  });

  it('publishes WhatsApp notification with relative URL prepended by webAppUrl (legacy)', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeCalendarClient.setNextResponse({
      status: 'completed',
      message: 'Calendar event created',
      resourceUrl: '/#/calendar',
    });

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed'); // @allow-result-access -- guarded by isOk() check above
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
      logger: createMockLogger(),
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
      logger: createMockLogger(),
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed'); // @allow-result-access -- guarded by isOk() check above
      expect(result.value.message).toBe('Previously created calendar event'); // @allow-result-access -- guarded by isOk() check above
      expect(result.value.resourceUrl).toBe('/#/calendar'); // @allow-result-access -- guarded by isOk() check above
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
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed'); // @allow-result-access -- guarded by isOk() check above
    }
  });

  it('passes full prompt text from payload.prompt to calendar service', async () => {
    const fullPrompt = 'Set up a weekly standup every Monday at 9:15am starting next week';
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Weekly standup',
      payload: { prompt: fullPrompt },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const processedActions = fakeCalendarClient.getProcessedActions();
    expect(processedActions).toHaveLength(1);
    expect(processedActions[0]?.text).toBe(fullPrompt);
    // Should NOT pass the short title as text
    expect(processedActions[0]?.text).not.toBe('Weekly standup');
  });

  it('falls back to title when payload.prompt is not present', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Meeting with John',
      payload: {},
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const processedActions = fakeCalendarClient.getProcessedActions();
    expect(processedActions).toHaveLength(1);
    expect(processedActions[0]?.text).toBe('Meeting with John');
  });

  it('sends rich WhatsApp completion message when preview data is available', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    fakeCalendarClient.setPreview('action-123', {
      actionId: 'action-123',
      userId: 'user-456',
      status: 'ready',
      summary: 'Meeting with John',
      start: '2025-01-15T15:00:00',
      end: '2025-01-15T16:00:00',
      duration: '1 hour',
      location: 'Office',
      isAllDay: false,
      generatedAt: '2025-01-15T10:00:00Z',
    });

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('\u2705 Calendar Event Created');
    expect(messages[0]?.message).toContain('*Meeting with John*');
    expect(messages[0]?.message).toContain('1 hour');
    expect(messages[0]?.message).toContain('Office');
    expect(messages[0]?.message).toContain('https://calendar.google.com/calendar/event?eid=fake123');
  });

  it('sends basic completion message when getPreview returns error (graceful fallback)', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    fakeCalendarClient.setFailGetPreview(true, new Error('Preview service unavailable'));

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    // Falls back to basic message format when preview fetch errors
    expect(messages[0]?.message).toContain('Calendar event created');
    expect(messages[0]?.message).toContain('https://calendar.google.com/calendar/event?eid=fake123');
  });

  it('sends basic completion message when no preview is cached (graceful fallback)', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    // No preview set — getPreview returns null by default

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    // Falls back to basic message format
    expect(messages[0]?.message).toContain('Calendar event created');
    expect(messages[0]?.message).toContain('https://calendar.google.com/calendar/event?eid=fake123');
  });

  it('falls back to title when payload.prompt is not a string', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Team sync',
      payload: { prompt: 42 },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const processedActions = fakeCalendarClient.getProcessedActions();
    expect(processedActions).toHaveLength(1);
    expect(processedActions[0]?.text).toBe('Team sync');
  });
});
