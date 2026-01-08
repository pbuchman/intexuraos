import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createHandleLinkActionUseCase } from '../domain/usecases/handleLinkAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { FakeActionServiceClient, FakeWhatsAppSendPublisher } from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('handleLinkAction usecase', () => {
  let fakeActionClient: FakeActionServiceClient;
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

  beforeEach(() => {
    fakeActionClient = new FakeActionServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('sets action to awaiting_approval and publishes WhatsApp notification', async () => {
    const usecase = createHandleLinkActionUseCase({
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
    expect(messages[0]?.message).toContain('New link ready to save');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');
  });

  it('fails when marking action as awaiting_approval fails', async () => {
    const usecase = createHandleLinkActionUseCase({
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
    const usecase = createHandleLinkActionUseCase({
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
});
