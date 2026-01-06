/**
 * Tests for Firestore action transition repository.
 * Tests ML training data collection for action type corrections.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreActionTransitionRepository } from '../../../infra/firestore/actionTransitionRepository.js';
import type { ActionTransitionRepository } from '../../../domain/ports/actionTransitionRepository.js';
import type { ActionTransition } from '../../../domain/models/actionTransition.js';

function createTestTransition(overrides: Partial<ActionTransition> = {}): ActionTransition {
  return {
    id: 'transition-123',
    userId: 'user-123',
    actionId: 'action-456',
    commandId: 'command-789',
    commandText: 'Research AI trends',
    originalType: 'todo',
    newType: 'research',
    originalConfidence: 0.75,
    createdAt: '2025-01-06T12:00:00.000Z',
    ...overrides,
  };
}

describe('FirestoreActionTransitionRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ActionTransitionRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createFirestoreActionTransitionRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('save', () => {
    it('saves new transition successfully', async () => {
      const transition = createTestTransition();

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.id).toBe(transition.id);
    });

    it('saves transition with all required fields', async () => {
      const transition = createTestTransition({
        id: 'trans-001',
        userId: 'user-abc',
        actionId: 'action-xyz',
        commandId: 'cmd-123',
        commandText: 'Add meeting to calendar',
        originalType: 'todo',
        newType: 'calendar',
        originalConfidence: 0.65,
        createdAt: '2025-01-06T14:30:00.000Z',
      });

      await repository.save(transition);

      const transitions = await repository.listByUserId('user-abc');
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toMatchObject({
        id: 'trans-001',
        userId: 'user-abc',
        actionId: 'action-xyz',
        commandId: 'cmd-123',
        commandText: 'Add meeting to calendar',
        originalType: 'todo',
        newType: 'calendar',
        originalConfidence: 0.65,
        createdAt: '2025-01-06T14:30:00.000Z',
      });
    });

    it('saves transition with research to todo correction', async () => {
      const transition = createTestTransition({
        originalType: 'research',
        newType: 'todo',
        commandText: 'Buy groceries',
        originalConfidence: 0.55,
      });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.originalType).toBe('research');
      expect(transitions[0]?.newType).toBe('todo');
    });

    it('saves transition with note action type', async () => {
      const transition = createTestTransition({
        originalType: 'todo',
        newType: 'note',
        commandText: 'Meeting notes from yesterday',
      });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.newType).toBe('note');
    });

    it('saves transition with link action type', async () => {
      const transition = createTestTransition({
        originalType: 'research',
        newType: 'link',
        commandText: 'Save this article for later',
      });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.newType).toBe('link');
    });

    it('saves transition with reminder action type', async () => {
      const transition = createTestTransition({
        originalType: 'todo',
        newType: 'reminder',
        commandText: 'Remind me to call mom tomorrow',
      });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.newType).toBe('reminder');
    });

    it('saves multiple transitions for same user', async () => {
      await repository.save(
        createTestTransition({ id: 'trans-1', createdAt: '2025-01-06T10:00:00.000Z' })
      );
      await repository.save(
        createTestTransition({ id: 'trans-2', createdAt: '2025-01-06T11:00:00.000Z' })
      );
      await repository.save(
        createTestTransition({ id: 'trans-3', createdAt: '2025-01-06T12:00:00.000Z' })
      );

      const transitions = await repository.listByUserId('user-123');
      expect(transitions).toHaveLength(3);
    });

    it('overwrites existing transition with same id', async () => {
      const original = createTestTransition({ commandText: 'Original text' });
      await repository.save(original);

      const updated = createTestTransition({ commandText: 'Updated text' });
      await repository.save(updated);

      const transitions = await repository.listByUserId(original.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.commandText).toBe('Updated text');
    });

    it('preserves low confidence values', async () => {
      const transition = createTestTransition({ originalConfidence: 0.15 });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.originalConfidence).toBe(0.15);
    });

    it('preserves high confidence values', async () => {
      const transition = createTestTransition({ originalConfidence: 0.99 });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.originalConfidence).toBe(0.99);
    });
  });

  describe('listByUserId', () => {
    it('returns empty array for user with no transitions', async () => {
      const transitions = await repository.listByUserId('nonexistent-user');
      expect(transitions).toEqual([]);
    });

    it('returns only transitions for specified user', async () => {
      await repository.save(createTestTransition({ id: 'trans-1', userId: 'user-A' }));
      await repository.save(createTestTransition({ id: 'trans-2', userId: 'user-B' }));
      await repository.save(createTestTransition({ id: 'trans-3', userId: 'user-A' }));

      const transitionsA = await repository.listByUserId('user-A');
      const transitionsB = await repository.listByUserId('user-B');

      expect(transitionsA).toHaveLength(2);
      expect(transitionsB).toHaveLength(1);
      expect(transitionsA.every((t) => t.userId === 'user-A')).toBe(true);
      expect(transitionsB.every((t) => t.userId === 'user-B')).toBe(true);
    });

    it('returns transitions ordered by createdAt descending', async () => {
      await repository.save(
        createTestTransition({ id: 'trans-old', createdAt: '2025-01-01T00:00:00.000Z' })
      );
      await repository.save(
        createTestTransition({ id: 'trans-mid', createdAt: '2025-01-03T00:00:00.000Z' })
      );
      await repository.save(
        createTestTransition({ id: 'trans-new', createdAt: '2025-01-06T00:00:00.000Z' })
      );

      const transitions = await repository.listByUserId('user-123');

      expect(transitions).toHaveLength(3);
      expect(transitions[0]?.id).toBe('trans-new');
      expect(transitions[1]?.id).toBe('trans-mid');
      expect(transitions[2]?.id).toBe('trans-old');
    });

    it('limits results to 100 entries', async () => {
      // Save 105 transitions
      for (let i = 0; i < 105; i++) {
        await repository.save(
          createTestTransition({
            id: `trans-${i.toString().padStart(3, '0')}`,
            createdAt: new Date(Date.now() - i * 1000).toISOString(),
          })
        );
      }

      const transitions = await repository.listByUserId('user-123');
      expect(transitions.length).toBeLessThanOrEqual(100);
    });

    it('returns correct transition structure', async () => {
      const transition = createTestTransition({
        id: 'struct-test',
        userId: 'user-struct',
        actionId: 'action-struct',
        commandId: 'cmd-struct',
        commandText: 'Structure test command',
        originalType: 'research',
        newType: 'note',
        originalConfidence: 0.82,
        createdAt: '2025-01-06T15:45:00.000Z',
      });
      await repository.save(transition);

      const transitions = await repository.listByUserId('user-struct');

      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toEqual({
        id: 'struct-test',
        userId: 'user-struct',
        actionId: 'action-struct',
        commandId: 'cmd-struct',
        commandText: 'Structure test command',
        originalType: 'research',
        newType: 'note',
        originalConfidence: 0.82,
        createdAt: '2025-01-06T15:45:00.000Z',
      });
    });

    it('handles transitions with long command text', async () => {
      const longText = 'A'.repeat(1000);
      const transition = createTestTransition({ commandText: longText });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.commandText).toBe(longText);
    });

    it('handles special characters in command text', async () => {
      const specialText = 'Test with émojis 🎉 and "quotes" & ampersands';
      const transition = createTestTransition({ commandText: specialText });

      await repository.save(transition);

      const transitions = await repository.listByUserId(transition.userId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.commandText).toBe(specialText);
    });
  });
});
