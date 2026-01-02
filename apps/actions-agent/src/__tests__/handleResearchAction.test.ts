import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createHandleResearchActionUseCase } from '../domain/usecases/handleResearchAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import {
  FakeActionServiceClient,
  FakeUserPhoneLookup,
  FakeWhatsAppSendPublisher,
} from './fakes.js';

describe('handleResearchAction usecase', () => {
  let fakeActionClient: FakeActionServiceClient;
  let fakeUserPhoneLookup: FakeUserPhoneLookup;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

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
    fakeUserPhoneLookup = new FakeUserPhoneLookup();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
    fakeUserPhoneLookup.setDefaultPhoneNumber('+1234567890');
  });

  it('sets action to awaiting_approval and sends WhatsApp notification', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      userPhoneLookup: fakeUserPhoneLookup,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }

    const actionUpdate = fakeActionClient.getActionUpdates().get('action-123');
    expect(actionUpdate?.status).toBe('awaiting_approval');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.phoneNumber).toBe('+1234567890');
    expect(messages[0]?.message).toContain('ready for approval');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');
  });

  it('succeeds when user has no phone number (skips notification)', async () => {
    fakeUserPhoneLookup.setDefaultPhoneNumber(null);

    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      userPhoneLookup: fakeUserPhoneLookup,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);

    const actionUpdate = fakeActionClient.getActionUpdates().get('action-123');
    expect(actionUpdate?.status).toBe('awaiting_approval');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(0);
  });

  it('fails when marking action as awaiting_approval fails', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      userPhoneLookup: fakeUserPhoneLookup,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
    });

    fakeActionClient.setFailNext(true, new Error('Database unavailable'));

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('fails when WhatsApp publish fails', async () => {
    const usecase = createHandleResearchActionUseCase({
      actionServiceClient: fakeActionClient,
      userPhoneLookup: fakeUserPhoneLookup,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
    });

    fakeWhatsappPublisher.setFailNext(true, { code: 'PUBLISH_FAILED', message: 'WhatsApp unavailable' });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to send WhatsApp notification');
    }
  });
});
