import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createHandleResearchActionUseCase } from '../domain/usecases/handleResearchAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import {
  FakeActionServiceClient,
  FakeResearchServiceClient,
  FakeNotificationSender,
} from './fakes.js';

describe('handleResearchAction usecase', () => {
  let fakeActionClient: FakeActionServiceClient;
  let fakeResearchClient: FakeResearchServiceClient;
  let fakeNotificationSender: FakeNotificationSender;

  const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'research',
    title: 'Test Research',
    payload: {
      prompt: 'What is quantum computing?',
      confidence: 0.95,
    },
    timestamp: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionClient = new FakeActionServiceClient();
    fakeResearchClient = new FakeResearchServiceClient();
    fakeNotificationSender = new FakeNotificationSender();
  });

  it('successfully processes research action with all steps', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      researchServiceClient: fakeResearchClient,
      notificationSender: fakeNotificationSender,
    });

    fakeResearchClient.setNextResearchId('research-456');

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.researchId).toBe('research-456');
    }

    expect(fakeActionClient.getStatusUpdates().get('action-123')).toBe('processing');

    const actionUpdate = fakeActionClient.getActionUpdates().get('action-123');
    expect(actionUpdate?.status).toBe('completed');
    expect(actionUpdate?.payload).toEqual({ researchId: 'research-456' });

    expect(fakeResearchClient.getLastCreateDraftParams()).toEqual({
      userId: 'user-456',
      title: 'Test Research',
      prompt: 'What is quantum computing?',
      selectedLlms: ['google', 'openai', 'anthropic'],
      sourceActionId: 'action-123',
    });

    const notifications = fakeNotificationSender.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual({
      userId: 'user-456',
      researchId: 'research-456',
      title: 'Test Research',
      draftUrl: 'https://app.intexuraos.com/#/research/research-456',
    });
  });

  it('uses selected LLMs from payload when provided', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      researchServiceClient: fakeResearchClient,
      notificationSender: fakeNotificationSender,
    });

    const event = createEvent({
      payload: {
        prompt: 'Test prompt',
        confidence: 0.9,
        selectedLlms: ['google', 'anthropic'],
      },
    });

    await usecase.execute(event);

    expect(fakeResearchClient.getLastCreateDraftParams()?.selectedLlms).toEqual([
      'google',
      'anthropic',
    ]);
  });

  it('fails when marking action as processing fails', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      researchServiceClient: fakeResearchClient,
      notificationSender: fakeNotificationSender,
    });

    fakeActionClient.setFailNext(true, new Error('Database unavailable'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to mark action as processing');
    }
  });

  it('fails when creating research draft fails and marks action as failed', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      researchServiceClient: fakeResearchClient,
      notificationSender: fakeNotificationSender,
    });

    fakeResearchClient.setFailNext(true, new Error('LLM service unavailable'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to create research draft');
    }

    const actionUpdate = fakeActionClient.getActionUpdates().get('action-123');
    expect(actionUpdate?.status).toBe('failed');
    expect(actionUpdate?.payload).toEqual({ error: 'LLM service unavailable' });
  });

  it('fails when marking action as completed fails', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      researchServiceClient: fakeResearchClient,
      notificationSender: fakeNotificationSender,
    });

    let callCount = 0;
    const originalUpdateAction = fakeActionClient.updateAction.bind(fakeActionClient);
    fakeActionClient.updateAction = async (actionId, update) => {
      callCount++;
      if (callCount === 1 && update.status === 'completed') {
        return { ok: false, error: new Error('Database unavailable') };
      }
      return await originalUpdateAction(actionId, update);
    };

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to mark action as completed');
    }
  });

  it('fails when sending notification fails', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      researchServiceClient: fakeResearchClient,
      notificationSender: fakeNotificationSender,
    });

    fakeNotificationSender.setFailNext(true, new Error('WhatsApp unavailable'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to send notification');
    }
  });
});
