import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { registerActionHandler } from '../domain/usecases/createIdempotentActionHandler.js';
import type { ActionHandler } from '../domain/usecases/actionHandlerRegistry.js';
import type { ActionRepository, UpdateStatusIfResult } from '../domain/ports/actionRepository.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
  type: 'action.created',
  actionId: 'action-123',
  userId: 'user-456',
  commandId: 'cmd-789',
  actionType: 'todo',
  title: 'Test action',
  payload: {
    prompt: 'Test prompt',
    confidence: 0.95,
  },
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe('registerActionHandler', () => {
  let mockHandler: ActionHandler;
  let mockRepository: ActionRepository;

  beforeEach(() => {
    mockHandler = {
      execute: vi.fn().mockResolvedValue(ok({ actionId: 'action-123' })),
    };
    mockRepository = {
      getById: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listByUserId: vi.fn(),
      listByStatus: vi.fn(),
      updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'updated' } as UpdateStatusIfResult),
    };
  });

  describe('idempotency check', () => {
    it('calls updateStatusIf before executing handler', async () => {
      const factory = (): ActionHandler => mockHandler;
      const wrapped = registerActionHandler(factory, { actionRepository: mockRepository, logger: silentLogger });
      const event = createEvent();

      await wrapped.execute(event);

      expect(mockRepository.updateStatusIf).toHaveBeenCalledWith(
        'action-123',
        'awaiting_approval',
        'pending'
      );
      expect(mockHandler.execute).toHaveBeenCalledWith(event);
    });

    it('returns early when action already claimed (status_mismatch)', async () => {
      const factory = (): ActionHandler => mockHandler;
      vi.mocked(mockRepository.updateStatusIf).mockResolvedValue({
        outcome: 'status_mismatch',
        currentStatus: 'awaiting_approval',
      });

      const wrapped = registerActionHandler(factory, { actionRepository: mockRepository, logger: silentLogger });
      const event = createEvent();

      const result = await wrapped.execute(event);

      expect(result).toEqual(ok({ actionId: 'action-123' }));
      expect(mockHandler.execute).not.toHaveBeenCalled();
    });

    it('returns success when action not found (may have been deleted)', async () => {
      const factory = (): ActionHandler => mockHandler;
      vi.mocked(mockRepository.updateStatusIf).mockResolvedValue({ outcome: 'not_found' });

      const wrapped = registerActionHandler(factory, { actionRepository: mockRepository, logger: silentLogger });
      const event = createEvent();

      const result = await wrapped.execute(event);

      expect(result).toEqual(ok({ actionId: 'action-123' }));
      expect(mockHandler.execute).not.toHaveBeenCalled();
    });

    it('returns error when updateStatusIf returns error outcome', async () => {
      const factory = (): ActionHandler => mockHandler;
      vi.mocked(mockRepository.updateStatusIf).mockResolvedValue({
        outcome: 'error',
        error: new Error('Firestore error'),
      });

      const wrapped = registerActionHandler(factory, { actionRepository: mockRepository, logger: silentLogger });
      const event = createEvent();

      const result = await wrapped.execute(event);

      expect(result).toEqual(err(new Error('Failed to update action status')));
      expect(mockHandler.execute).not.toHaveBeenCalled();
    });
  });

  describe('normal execution flow', () => {
    it('executes handler when updateStatusIf returns updated', async () => {
      const factory = (): ActionHandler => mockHandler;
      vi.mocked(mockRepository.updateStatusIf).mockResolvedValue({ outcome: 'updated' });

      const wrapped = registerActionHandler(factory, { actionRepository: mockRepository, logger: silentLogger });
      const event = createEvent();

      const result = await wrapped.execute(event);

      expect(result).toEqual(ok({ actionId: 'action-123' }));
      expect(mockHandler.execute).toHaveBeenCalledWith(event);
    });

    it('propagates handler errors', async () => {
      const handlerError = new Error('Handler failed');
      const factory = (): ActionHandler => ({
        execute: vi.fn().mockResolvedValue(err(handlerError)),
      });
      vi.mocked(mockRepository.updateStatusIf).mockResolvedValue({ outcome: 'updated' });

      const wrapped = registerActionHandler(factory, { actionRepository: mockRepository, logger: silentLogger });
      const event = createEvent();

      const result = await wrapped.execute(event);

      expect(result).toEqual(err(handlerError));
    });
  });
});
