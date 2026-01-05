import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActionTransition } from '../../domain/models/actionTransition.js';

describe('createActionTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates transition with all required fields', () => {
    const transition = createActionTransition({
      userId: 'user-1',
      actionId: 'action-1',
      commandId: 'cmd-1',
      commandText: 'Test command',
      originalType: 'note',
      newType: 'todo',
      originalConfidence: 0.85,
    });

    expect(transition).toMatchObject({
      userId: 'user-1',
      actionId: 'action-1',
      commandId: 'cmd-1',
      commandText: 'Test command',
      originalType: 'note',
      newType: 'todo',
      originalConfidence: 0.85,
    });
  });

  it('generates unique id', () => {
    const transition1 = createActionTransition({
      userId: 'user-1',
      actionId: 'action-1',
      commandId: 'cmd-1',
      commandText: 'Test',
      originalType: 'note',
      newType: 'todo',
      originalConfidence: 0.8,
    });

    const transition2 = createActionTransition({
      userId: 'user-1',
      actionId: 'action-1',
      commandId: 'cmd-1',
      commandText: 'Test',
      originalType: 'note',
      newType: 'todo',
      originalConfidence: 0.8,
    });

    expect(transition1.id).toBeDefined();
    expect(transition2.id).toBeDefined();
    expect(transition1.id).not.toBe(transition2.id);
  });

  it('sets createdAt to current timestamp', () => {
    const transition = createActionTransition({
      userId: 'user-1',
      actionId: 'action-1',
      commandId: 'cmd-1',
      commandText: 'Test',
      originalType: 'note',
      newType: 'research',
      originalConfidence: 0.9,
    });

    expect(transition.createdAt).toBe('2026-01-05T12:00:00.000Z');
  });
});
