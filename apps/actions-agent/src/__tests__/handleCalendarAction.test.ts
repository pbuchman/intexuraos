import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createHandleCalendarActionUseCase } from '../domain/usecases/handleCalendarAction.js';
import { registerActionHandler } from '../domain/usecases/createIdempotentActionHandler.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import type { CalendarPreview } from '../domain/ports/calendarServiceClient.js';
import {
  FakeActionRepository,
  FakeWhatsAppSendPublisher,
  FakeCalendarServiceClient,
} from './fakes.js';

import { createMockLogger } from './fakes.js';

describe('handleCalendarAction usecase', () => {
  let fakeActionRepository: FakeActionRepository;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;
  let fakeCalendarServiceClient: FakeCalendarServiceClient;

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

  const readyPreview: CalendarPreview = {
    actionId: 'action-123',
    userId: 'user-456',
    status: 'ready',
    summary: 'Team Standup',
    start: '2025-01-16T10:00:00',
    end: '2025-01-16T10:30:00',
    duration: '30 minutes',
    location: null,
    isAllDay: false,
    generatedAt: '2025-01-15T12:01:00Z',
  };

  beforeEach(() => {
    fakeActionRepository = new FakeActionRepository();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
    fakeCalendarServiceClient = new FakeCalendarServiceClient();
  });

  it('sends rich approval message when preview generation succeeds', async () => {
    await fakeActionRepository.save(createAction());
    fakeCalendarServiceClient.setGeneratePreviewResult(readyPreview);

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    const event = createEvent({ payload: { prompt: 'Schedule team standup for tomorrow at 10am', confidence: 0.85 } });
    const result = await usecase.execute(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actionId).toBe('action-123'); // @allow-result-access -- guarded by result.ok
    }

    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('awaiting_approval');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    // Rich message should contain the preview summary
    expect(messages[0]?.message).toContain('Calendar Event');
    expect(messages[0]?.message).toContain('*Team Standup*');
    expect(messages[0]?.message).toContain('30 minutes');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/#/inbox?action=action-123');

    // Verify interactive approval buttons
    expect(messages[0]?.buttons).toHaveLength(2);
    expect(messages[0]?.buttons?.[0]?.reply.id).toBe('approve:action-123');
    expect(messages[0]?.buttons?.[0]?.reply.title).toBe('Approve');
    expect(messages[0]?.buttons?.[1]?.reply.id).toBe('reject:action-123');
    expect(messages[0]?.buttons?.[1]?.reply.title).toBe('Reject');

    // Verify generatePreview was called
    const previewRequests = fakeCalendarServiceClient.getGeneratePreviewRequests();
    expect(previewRequests).toHaveLength(1);
    expect(previewRequests[0]?.actionId).toBe('action-123');
    expect(previewRequests[0]?.userId).toBe('user-456');
    expect(previewRequests[0]?.text).toBe('Schedule team standup for tomorrow at 10am');
  });

  it('falls back to basic message when preview generation fails (non-fatal)', async () => {
    await fakeActionRepository.save(createAction());

    fakeCalendarServiceClient.setFailGeneratePreview(true, new Error('Calendar-agent down'));

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    const event = createEvent({ payload: { prompt: 'Schedule team standup for tomorrow at 10am', confidence: 0.85 } });
    const result = await usecase.execute(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actionId).toBe('action-123'); // @allow-result-access -- guarded by result.ok
    }

    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('awaiting_approval');

    // Should send basic fallback message
    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('New calendar event ready for approval');
    expect(messages[0]?.message).toContain('Team standup tomorrow');
  });

  it('falls back to basic message when preview returns null', async () => {
    await fakeActionRepository.save(createAction());

    // Default: generatePreviewResult is null
    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    const event = createEvent({ payload: { prompt: 'Schedule team standup for tomorrow at 10am', confidence: 0.85 } });
    const result = await usecase.execute(event);

    expect(result.ok).toBe(true);

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('New calendar event ready for approval');
  });

  it('fails when marking action as awaiting_approval fails', async () => {
    await fakeActionRepository.save(createAction());

    fakeActionRepository.setFailNext(true, new Error('Database unavailable'));

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    const event = createEvent({ payload: { prompt: 'Schedule team standup for tomorrow at 10am', confidence: 0.85 } });
    const result = await usecase.execute(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Failed to update action status');
    }
  });

  it('succeeds even when WhatsApp publish fails (best-effort notification)', async () => {
    await fakeActionRepository.save(createAction());

    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const event = createEvent({ payload: { prompt: 'Schedule team standup for tomorrow at 10am', confidence: 0.85 } });
    const result = await usecase.execute(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actionId).toBe('action-123'); // @allow-result-access -- guarded by result.ok
    }

    const action = await fakeActionRepository.getById('action-123');
    expect(action?.status).toBe('awaiting_approval');
  });

  it('returns success without sending notification when action already processed (idempotency)', async () => {
    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    await fakeActionRepository.save({
      ...createAction(),
      status: 'awaiting_approval',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actionId).toBe('action-123'); // @allow-result-access -- guarded by result.ok
    }

    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  it('returns success without sending notification when action is completed', async () => {
    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    await fakeActionRepository.save({
      ...createAction(),
      status: 'completed',
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actionId).toBe('action-123'); // @allow-result-access -- guarded by result.ok
    }

    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  it('returns success when action is not found (deleted action)', async () => {
    const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
      actionRepository: fakeActionRepository,
      whatsappPublisher: fakeWhatsappPublisher,
      calendarServiceClient: fakeCalendarServiceClient,
      webAppUrl: 'https://app.intexuraos.com',
      logger: createMockLogger(),
    });

    const event = createEvent();
    const result = await usecase.execute(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actionId).toBe('action-123'); // @allow-result-access -- guarded by result.ok
    }

    expect(fakeWhatsappPublisher.getSentMessages()).toHaveLength(0);
  });

  describe('auto-execute flow for high confidence calendar actions', () => {
    it('auto-executes when confidence >= 90% and executeCalendarAction is provided', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteCalendarAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, message: 'Calendar event created', resourceUrl: '/#/calendar' })
      );

      const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        calendarServiceClient: fakeCalendarServiceClient,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
        executeCalendarAction: fakeExecuteCalendarAction,
      });

      // Event with 95% confidence triggers auto-execute
      const event = createEvent({ payload: { prompt: 'Schedule meeting', confidence: 0.95 } });
      const result = await usecase.execute(event);

      expect(result.ok).toBe(true);
      expect(fakeExecuteCalendarAction).toHaveBeenCalledWith('action-123');

      // No "awaiting_approval" message should be sent for auto-executed actions
      const messages = fakeWhatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);

      // Preview generation should NOT be triggered for auto-executed actions
      const previewRequests = fakeCalendarServiceClient.getGeneratePreviewRequests();
      expect(previewRequests).toHaveLength(0);
    });

    it('auto-executes at exactly 90% confidence', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteCalendarAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, message: 'Calendar event created', resourceUrl: '/#/calendar' })
      );

      const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        calendarServiceClient: fakeCalendarServiceClient,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
        executeCalendarAction: fakeExecuteCalendarAction,
      });

      const event = createEvent({ payload: { prompt: 'Schedule meeting', confidence: 0.9 } });
      const result = await usecase.execute(event);

      expect(result.ok).toBe(true);
      expect(fakeExecuteCalendarAction).toHaveBeenCalledWith('action-123');
    });

    it('returns error when auto-execute fails', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteCalendarAction = vi.fn().mockResolvedValue(
        err(new Error('Calendar API unavailable'))
      );

      const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        calendarServiceClient: fakeCalendarServiceClient,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
        executeCalendarAction: fakeExecuteCalendarAction,
      });

      const event = createEvent({ payload: { prompt: 'Schedule meeting', confidence: 0.95 } });
      const result = await usecase.execute(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Calendar API unavailable');
      }
    });

    it('falls back to approval flow when executeCalendarAction is not provided', async () => {
      await fakeActionRepository.save(createAction());

      const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        calendarServiceClient: fakeCalendarServiceClient,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
      });

      const event = createEvent({ payload: { prompt: 'Schedule meeting', confidence: 0.95 } });
      const result = await usecase.execute(event);

      expect(result.ok).toBe(true);

      // Action should be updated to awaiting_approval when executeCalendarAction is not available
      const action = await fakeActionRepository.getById('action-123');
      expect(action?.status).toBe('awaiting_approval');

      // Preview should be generated since we're in approval flow
      const previewRequests = fakeCalendarServiceClient.getGeneratePreviewRequests();
      expect(previewRequests).toHaveLength(1);
    });

    it('does NOT auto-execute when confidence is below 90%', async () => {
      await fakeActionRepository.save(createAction());

      const fakeExecuteCalendarAction = vi.fn().mockResolvedValue(
        ok({ status: 'completed' as const, message: 'Calendar event created', resourceUrl: '/#/calendar' })
      );

      const usecase = registerActionHandler(createHandleCalendarActionUseCase, {
        actionRepository: fakeActionRepository,
        whatsappPublisher: fakeWhatsappPublisher,
        calendarServiceClient: fakeCalendarServiceClient,
        webAppUrl: 'https://app.intexuraos.com',
        logger: createMockLogger(),
        executeCalendarAction: fakeExecuteCalendarAction,
      });

      // Event with 85% confidence does NOT trigger auto-execute (threshold is 90%)
      const event = createEvent({ payload: { prompt: 'Schedule meeting', confidence: 0.85 } });
      const result = await usecase.execute(event);

      expect(result.ok).toBe(true);
      expect(fakeExecuteCalendarAction).not.toHaveBeenCalled();

      // Action should be updated to awaiting_approval
      const action = await fakeActionRepository.getById('action-123');
      expect(action?.status).toBe('awaiting_approval');

      // Preview generation should be triggered via HTTP
      const previewRequests = fakeCalendarServiceClient.getGeneratePreviewRequests();
      expect(previewRequests).toHaveLength(1);
    });
  });
});
