import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createHandleCalendarActionUseCase } from '../domain/usecases/handleCalendarAction.js';
import { createHandleLinearActionUseCase } from '../domain/usecases/handleLinearAction.js';
import { registerActionHandler } from '../domain/usecases/createIdempotentActionHandler.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionServiceClient,
  FakeActionRepository,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

const createAction = (overrides: Partial<Action> = {}): Action => ({
  id: 'action-123',
  userId: 'user-456',
  commandId: 'cmd-789',
  type: 'calendar',
  confidence: 0.9,
  title: 'Meeting at 2pm',
  status: 'pending',
  payload: {},
  createdAt: '2025-01-01T12:00:00.000Z',
  updatedAt: '2025-01-01T12:00:00.000Z',
  ...overrides,
});

const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
  type: 'action.created',
  actionId: 'action-123',
  userId: 'user-456',
  commandId: 'cmd-789',
  actionType: 'calendar',
  title: 'Meeting at 2pm',
  payload: {
    prompt: 'Meeting at 2pm',
    confidence: 0.9,
  },
  timestamp: '2025-01-01T12:00:00.000Z',
  ...overrides,
});

describe('handleCalendarAction usecase', () => {
  let fakeActionServiceClient: FakeActionServiceClient;
  let fakeActionRepository: FakeActionRepository;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  beforeEach(() => {
    fakeActionServiceClient = new FakeActionServiceClient();
    fakeActionRepository = new FakeActionRepository();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns ok when action lookup returns null (idempotent)', async () => {
    const event = createEvent();
    // Don't set action in the service client - getAction will return ok(null)

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }
  });

  it('returns ok when getAction fails (action deleted)', async () => {
    const event = createEvent();
    fakeActionServiceClient.setFailOn('getAction', new Error('Action not found'));

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('returns ok when action is null (idempotent)', async () => {
    const event = createEvent();
    // Don't set action - getAction will return ok(null)

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('returns ok when action status is not pending (idempotent)', async () => {
    const event = createEvent();
    const action = createAction({ status: 'awaiting_approval' });
    fakeActionServiceClient.setAction(action);

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('updates action status to awaiting_approval for pending action', async () => {
    const event = createEvent();
    const action = createAction({ status: 'pending' });
    fakeActionServiceClient.setAction(action);
    fakeActionRepository.save(action); // registerActionHandler uses repository for status updates

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);

    // registerActionHandler uses actionRepository for status updates
    const updatedAction = fakeActionRepository.getActions().get('action-123');
    expect(updatedAction?.status).toBe('awaiting_approval');
  });

  it('publishes WhatsApp approval notification', async () => {
    const event = createEvent();
    const action = createAction({ status: 'pending' });
    fakeActionServiceClient.setAction(action);
    fakeActionRepository.save(action); // registerActionHandler requires action in repository

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    await usecase.execute(event);

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('calendar event ready for approval');
    expect(messages[0]?.message).toContain('Meeting at 2pm');
    expect(messages[0]?.message).toContain('https://app.test.com/#/inbox?action=action-123');
    expect(messages[0]?.correlationId).toBe('action-calendar-approval-action-123');
  });

  it('returns error when updateActionStatus fails', async () => {
    const event = createEvent();
    const action = createAction({ status: 'pending' });
    fakeActionServiceClient.setAction(action);
    fakeActionRepository.save(action); // registerActionHandler uses repository for status updates
    fakeActionRepository.setFailNext(true, new Error('Database error'));

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('succeeds even when WhatsApp publish fails (non-fatal)', async () => {
    const event = createEvent();
    const action = createAction({ status: 'pending' });
    fakeActionServiceClient.setAction(action);
    fakeActionRepository.save(action); // registerActionHandler uses repository for status updates
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = registerActionHandler(
      createHandleCalendarActionUseCase,
      {
        actionServiceClient: fakeActionServiceClient,
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      }
    );

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });
});

describe('handleLinearAction usecase', () => {
  let fakeActionRepository: FakeActionRepository;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  beforeEach(() => {
    fakeActionRepository = new FakeActionRepository();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns ok when action not found (idempotent)', async () => {
    const event = createEvent({ actionType: 'linear' });

    const usecase = registerActionHandler(createHandleLinearActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.actionId).toBe('action-123');
    }
  });

  it('returns ok when action status is not pending (idempotent)', async () => {
    const event = createEvent({ actionType: 'linear' });
    const action = createAction({ status: 'awaiting_approval' });
    fakeActionRepository.save(action);

    const usecase = registerActionHandler(createHandleLinearActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('updates action status to awaiting_approval for pending action', async () => {
    const event = createEvent({ actionType: 'linear' });
    const action = createAction({ status: 'pending', type: 'linear' });
    fakeActionRepository.save(action);

    const usecase = registerActionHandler(createHandleLinearActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);

    const updatedAction = fakeActionRepository.getActions().get('action-123');
    expect(updatedAction?.status).toBe('awaiting_approval');
  });

  it('publishes WhatsApp approval notification for linear action', async () => {
    const event = createEvent({ actionType: 'linear', title: 'Fix authentication bug' });
    const action = createAction({ status: 'pending', type: 'linear' });
    fakeActionRepository.save(action);

    const usecase = registerActionHandler(createHandleLinearActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase.execute(event);

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Linear issue ready for approval');
    expect(messages[0]?.message).toContain('Fix authentication bug');
    expect(messages[0]?.message).toContain('https://app.test.com/#/inbox?action=action-123');
    expect(messages[0]?.correlationId).toBe('action-linear-approval-action-123');
  });

  it('returns error when updateStatusIf fails', async () => {
    const event = createEvent({ actionType: 'linear' });
    const action = createAction({ status: 'pending', type: 'linear' });
    fakeActionRepository.save(action);
    fakeActionRepository.setFailNext(true, new Error('Database error'));

    const usecase = registerActionHandler(createHandleLinearActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('succeeds even when WhatsApp publish fails (non-fatal)', async () => {
    const event = createEvent({ actionType: 'linear' });
    const action = createAction({ status: 'pending', type: 'linear' });
    fakeActionRepository.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = registerActionHandler(createHandleLinearActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });
});
