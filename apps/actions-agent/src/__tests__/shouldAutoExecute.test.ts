import { describe, it, expect } from 'vitest';
import { shouldAutoExecute } from '../domain/usecases/shouldAutoExecute.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';

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

describe('shouldAutoExecute', () => {
  describe('confidence threshold', () => {
    it('returns true when confidence is 100%', () => {
      const event = createEvent({ actionType: 'link', payload: { prompt: 'test', confidence: 1 } });
      expect(shouldAutoExecute(event)).toBe(true);
    });

    it('returns true when confidence is exactly 90%', () => {
      const event = createEvent({ actionType: 'note', payload: { prompt: 'test', confidence: 0.9 } });
      expect(shouldAutoExecute(event)).toBe(true);
    });

    it('returns true when confidence is above 90%', () => {
      const event = createEvent({ actionType: 'code', payload: { prompt: 'test', confidence: 0.95 } });
      expect(shouldAutoExecute(event)).toBe(true);
    });

    it('returns false when confidence is below 90%', () => {
      const event = createEvent({ actionType: 'link', payload: { prompt: 'test', confidence: 0.89 } });
      expect(shouldAutoExecute(event)).toBe(false);
    });

    it('returns false when confidence is 0', () => {
      const event = createEvent({ actionType: 'research', payload: { prompt: 'test', confidence: 0 } });
      expect(shouldAutoExecute(event)).toBe(false);
    });

    it('returns false when confidence is 0.5', () => {
      const event = createEvent({ actionType: 'note', payload: { prompt: 'test', confidence: 0.5 } });
      expect(shouldAutoExecute(event)).toBe(false);
    });
  });

  describe('all action types auto-execute at high confidence', () => {
    it.each([
      'link',
      'research',
      'note',
      'calendar',
      'reminder',
      'code',
      'linear',
    ] as const)('returns true for %s actions at 95% confidence', (actionType) => {
      const event = createEvent({ actionType, payload: { prompt: 'test', confidence: 0.95 } });
      expect(shouldAutoExecute(event)).toBe(true);
    });

    it.each([
      'link',
      'research',
      'note',
      'calendar',
      'reminder',
      'code',
      'linear',
    ] as const)('returns false for %s actions at 85% confidence', (actionType) => {
      const event = createEvent({ actionType, payload: { prompt: 'test', confidence: 0.85 } });
      expect(shouldAutoExecute(event)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns true with confidence slightly below 100%', () => {
      const event = createEvent({ actionType: 'code', payload: { prompt: 'test', confidence: 0.999 } });
      expect(shouldAutoExecute(event)).toBe(true);
    });

    it('returns false with confidence slightly below 90%', () => {
      const event = createEvent({ actionType: 'code', payload: { prompt: 'test', confidence: 0.899 } });
      expect(shouldAutoExecute(event)).toBe(false);
    });
  });
});
