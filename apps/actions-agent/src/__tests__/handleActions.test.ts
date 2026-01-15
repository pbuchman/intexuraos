import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ok, err, isOk, isErr } from '@intexuraos/common-core';
import { createHandleCalendarActionUseCase } from '../domain/usecases/handleCalendarAction.js';
import { createHandleLinearActionUseCase } from '../domain/usecases/handleLinearAction.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import type { Action } from '../domain/models/action.js';
import type { ExecuteCalendarActionUseCase } from '../domain/usecases/executeCalendarAction.js';
import type { ExecuteLinearActionUseCase } from '../domain/usecases/executeLinearAction.js';
import {
  FakeActionServiceClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

// Store original env value
const originalAutoExecuteEnabled = process.env['INTEXURAOS_AUTO_EXECUTE_ENABLED'];

afterEach(() => {
  // Reset env var after each test
  if (originalAutoExecuteEnabled === undefined) {
    delete process.env['INTEXURAOS_AUTO_EXECUTE_ENABLED'];
  } else {
    process.env['INTEXURAOS_AUTO_EXECUTE_ENABLED'] = originalAutoExecuteEnabled;
  }
});

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
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  beforeEach(() => {
    fakeActionServiceClient = new FakeActionServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns ok when action lookup returns null (idempotent)', async () => {
    const event = createEvent();
    // Don't set action in the service client - getAction will return ok(null)

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
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

  it('returns ok when getAction fails (action deleted)', async () => {
    const event = createEvent();
    fakeActionServiceClient.setFailOn('getAction', new Error('Action not found'));

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('returns ok when action is null (idempotent)', async () => {
    const event = createEvent();
    // Don't set action - getAction will return ok(null)

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('returns ok when action status is not pending (idempotent)', async () => {
    const event = createEvent();
    const action = createAction({ status: 'awaiting_approval' });
    fakeActionServiceClient.setAction(action);

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('updates action status to awaiting_approval for pending action', async () => {
    const event = createEvent();
    const action = createAction({ status: 'pending' });
    fakeActionServiceClient.setAction(action);

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);

    const statusUpdates = fakeActionServiceClient.getStatusUpdates();
    expect(statusUpdates.get('action-123')).toBe('awaiting_approval');
  });

  it('publishes WhatsApp approval notification', async () => {
    const event = createEvent();
    const action = createAction({ status: 'pending' });
    fakeActionServiceClient.setAction(action);

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

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
    fakeActionServiceClient.setFailOn('updateActionStatus', new Error('Database error'));

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
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
    const event = createEvent();
    const action = createAction({ status: 'pending' });
    fakeActionServiceClient.setAction(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createHandleCalendarActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  describe('with auto-execute enabled', () => {
    beforeEach(() => {
      process.env['INTEXURAOS_AUTO_EXECUTE_ENABLED'] = 'true';
    });

    it('auto-executes pending calendar action when enabled', async () => {
      const event = createEvent();
      const action = createAction({ status: 'pending' });
      fakeActionServiceClient.setAction(action);

      // Mock executeCalendarAction use case
      const executeCalendarAction: ExecuteCalendarActionUseCase = async () => {
        return ok({
          status: 'completed',
          resourceUrl: 'https://calendar.google.com/event/abc123',
        });
      };

      const usecase = createHandleCalendarActionUseCase({
        actionServiceClient: fakeActionServiceClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
        executeCalendarAction,
      });

      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);

      // Should NOT have updated status to awaiting_approval (auto-executed instead)
      const statusUpdates = fakeActionServiceClient.getStatusUpdates();
      expect(statusUpdates.get('action-123')).toBeUndefined();

      // Should NOT have sent WhatsApp notification (auto-executed, not awaiting approval)
      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);
    });

    it('returns error when auto-execute fails', async () => {
      const event = createEvent();
      const action = createAction({ status: 'pending' });
      fakeActionServiceClient.setAction(action);

      // Mock executeCalendarAction use case that fails
      const executeCalendarAction: ExecuteCalendarActionUseCase = async () => {
        return err(new Error('Calendar service unavailable'));
      };

      const usecase = createHandleCalendarActionUseCase({
        actionServiceClient: fakeActionServiceClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
        executeCalendarAction,
      });

      const result = await usecase.execute(event);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Calendar service unavailable');
      }
    });

    it('handles action with executeCalendarAction undefined gracefully', async () => {
      const event = createEvent();
      const action = createAction({ status: 'pending' });
      fakeActionServiceClient.setAction(action);

      // Don't provide executeCalendarAction - should fall back to awaiting_approval
      const usecase = createHandleCalendarActionUseCase({
        actionServiceClient: fakeActionServiceClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      });

      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);

      // Should have fallen back to awaiting_approval path
      const statusUpdates = fakeActionServiceClient.getStatusUpdates();
      expect(statusUpdates.get('action-123')).toBe('awaiting_approval');
    });
  });
});

describe('handleLinearAction usecase', () => {
  let fakeActionServiceClient: FakeActionServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  beforeEach(() => {
    fakeActionServiceClient = new FakeActionServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns ok when action not found (idempotent)', async () => {
    const event = createEvent({ actionType: 'linear' });

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
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

  it('returns ok when action is null (idempotent)', async () => {
    const event = createEvent({ actionType: 'linear' });
    // Don't set action - getAction will return ok(null)

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('returns ok when action status is not pending (idempotent)', async () => {
    const event = createEvent({ actionType: 'linear' });
    const action = createAction({ status: 'awaiting_approval' });
    fakeActionServiceClient.setAction(action);

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
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
    fakeActionServiceClient.setAction(action);

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);

    const statusUpdates = fakeActionServiceClient.getStatusUpdates();
    expect(statusUpdates.get('action-123')).toBe('awaiting_approval');
  });

  it('publishes WhatsApp approval notification for linear action', async () => {
    const event = createEvent({ actionType: 'linear', title: 'Fix authentication bug' });
    const action = createAction({ status: 'pending', type: 'linear' });
    fakeActionServiceClient.setAction(action);

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
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

  it('returns error when updateActionStatus fails', async () => {
    const event = createEvent({ actionType: 'linear' });
    const action = createAction({ status: 'pending', type: 'linear' });
    fakeActionServiceClient.setAction(action);
    fakeActionServiceClient.setFailOn('updateActionStatus', new Error('Database error'));

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
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
    fakeActionServiceClient.setAction(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  it('returns ok when getAction fails (action deleted)', async () => {
    const event = createEvent({ actionType: 'linear' });
    fakeActionServiceClient.setFailOn('getAction', new Error('Action not found'));

    const usecase = createHandleLinearActionUseCase({
      actionServiceClient: fakeActionServiceClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase.execute(event);

    expect(isOk(result)).toBe(true);
  });

  describe('with auto-execute enabled', () => {
    beforeEach(() => {
      process.env['INTEXURAOS_AUTO_EXECUTE_ENABLED'] = 'true';
    });

    it('auto-executes pending linear action when enabled', async () => {
      const event = createEvent({ actionType: 'linear' });
      const action = createAction({ status: 'pending', type: 'linear' });
      fakeActionServiceClient.setAction(action);

      // Mock executeLinearAction use case
      const executeLinearAction: ExecuteLinearActionUseCase = async () => {
        return ok({
          status: 'completed',
          resourceUrl: 'https://linear.app/issue/TEST-123',
          issueIdentifier: 'TEST-123',
        });
      };

      const usecase = createHandleLinearActionUseCase({
        actionServiceClient: fakeActionServiceClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
        executeLinearAction,
      });

      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);

      // Should NOT have updated status to awaiting_approval (auto-executed instead)
      const statusUpdates = fakeActionServiceClient.getStatusUpdates();
      expect(statusUpdates.get('action-123')).toBeUndefined();

      // Should NOT have sent WhatsApp notification (auto-executed, not awaiting approval)
      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);
    });

    it('returns error when auto-execute fails', async () => {
      const event = createEvent({ actionType: 'linear' });
      const action = createAction({ status: 'pending', type: 'linear' });
      fakeActionServiceClient.setAction(action);

      // Mock executeLinearAction use case that fails
      const executeLinearAction: ExecuteLinearActionUseCase = async () => {
        return err(new Error('Linear service unavailable'));
      };

      const usecase = createHandleLinearActionUseCase({
        actionServiceClient: fakeActionServiceClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
        executeLinearAction,
      });

      const result = await usecase.execute(event);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Linear service unavailable');
      }
    });

    it('handles action with executeLinearAction undefined gracefully', async () => {
      const event = createEvent({ actionType: 'linear' });
      const action = createAction({ status: 'pending', type: 'linear' });
      fakeActionServiceClient.setAction(action);

      // Don't provide executeLinearAction - should fall back to awaiting_approval
      const usecase = createHandleLinearActionUseCase({
        actionServiceClient: fakeActionServiceClient,
        whatsappPublisher: fakeWhatsappPublisher,
        webAppUrl: 'https://app.test.com',
        logger: silentLogger,
      });

      const result = await usecase.execute(event);

      expect(isOk(result)).toBe(true);

      // Should have fallen back to awaiting_approval path
      const statusUpdates = fakeActionServiceClient.getStatusUpdates();
      expect(statusUpdates.get('action-123')).toBe('awaiting_approval');
    });
  });
});
