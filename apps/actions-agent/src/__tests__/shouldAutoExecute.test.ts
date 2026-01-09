import { describe, it, expect } from 'vitest';
import { shouldAutoExecute } from '../domain/usecases/shouldAutoExecute.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';

describe('shouldAutoExecute', () => {
  const createEvent = (overrides: Partial<ActionCreatedEvent> = {}): ActionCreatedEvent => ({
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'research',
    title: 'Test action',
    payload: {
      prompt: 'Test prompt',
      confidence: 0.95,
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  describe('current stub behavior', () => {
    it('returns false for research actions', () => {
      const event = createEvent({ actionType: 'research' });
      expect(shouldAutoExecute(event)).toBe(false);
    });

    it('returns false for todo actions', () => {
      const event = createEvent({ actionType: 'todo' });
      expect(shouldAutoExecute(event)).toBe(false);
    });

    it('returns false for note actions', () => {
      const event = createEvent({ actionType: 'note' });
      expect(shouldAutoExecute(event)).toBe(false);
    });

    it('returns false for link actions', () => {
      const event = createEvent({ actionType: 'link' });
      expect(shouldAutoExecute(event)).toBe(false);
    });

    it('returns false regardless of high confidence', () => {
      const event = createEvent({
        payload: { prompt: 'High confidence action', confidence: 0.99 },
      });
      expect(shouldAutoExecute(event)).toBe(false);
    });

    it('returns false regardless of low confidence', () => {
      const event = createEvent({
        payload: { prompt: 'Low confidence action', confidence: 0.5 },
      });
      expect(shouldAutoExecute(event)).toBe(false);
    });
  });

  describe('future implementation considerations', () => {
    it.todo('should auto-execute link actions with high confidence (>0.9)');
    it.todo('should never auto-execute research actions (high risk)');
    it.todo('should respect user auto-execute preference');
    it.todo('should return false when user has disabled auto-execute');
  });
});
