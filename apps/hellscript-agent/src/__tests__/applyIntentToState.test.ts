import { describe, it, expect } from 'vitest';
import { applyIntentToState } from '../domain/services/applyIntentToState.js';
import { emptyState } from '../domain/models/materializedBufferState.js';
import type { InterpretedIntent } from '../domain/models/hellscriptEvent.js';
import type { MaterializedBufferState } from '../domain/models/materializedBufferState.js';

function stateWithThoughts(
  thoughts: { id: string; text: string }[]
): MaterializedBufferState {
  return {
    ...emptyState(),
    thoughts: thoughts.map((t) => ({
      id: t.id,
      text: t.text,
      addedAt: '2024-01-01T00:00:00.000Z',
    })),
  };
}

describe('applyIntentToState', () => {
  describe('append_thought', () => {
    it('adds a new thought to empty state', () => {
      const state = emptyState();
      const intent: InterpretedIntent = {
        kind: 'append_thought',
        payload: { text: 'My first thought' },
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts).toHaveLength(1);
      expect(result.thoughts[0]?.text).toBe('My first thought');
      expect(result.thoughts[0]?.id).toBeDefined();
      expect(result.thoughts[0]?.addedAt).toBeDefined();
    });

    it('appends thought to existing thoughts', () => {
      const state = stateWithThoughts([{ id: 'existing', text: 'First' }]);
      const intent: InterpretedIntent = {
        kind: 'append_thought',
        payload: { text: 'Second thought' },
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts).toHaveLength(2);
      expect(result.thoughts[0]?.text).toBe('First');
      expect(result.thoughts[1]?.text).toBe('Second thought');
    });

    it('handles missing text in payload', () => {
      const state = emptyState();
      const intent: InterpretedIntent = {
        kind: 'append_thought',
        payload: {},
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts).toHaveLength(1);
      expect(result.thoughts[0]?.text).toBe('');
    });

    it('converts numeric payload values to string', () => {
      const state = emptyState();
      const intent: InterpretedIntent = {
        kind: 'append_thought',
        payload: { text: 42 as unknown as string },
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts).toHaveLength(1);
      expect(result.thoughts[0]?.text).toBe('42');
    });
  });

  describe('delete_thought', () => {
    it('removes thought by ID', () => {
      const state = stateWithThoughts([
        { id: 'a', text: 'First' },
        { id: 'b', text: 'Second' },
      ]);
      const intent: InterpretedIntent = {
        kind: 'delete_thought',
        payload: { thoughtId: 'a' },
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts).toHaveLength(1);
      expect(result.thoughts[0]?.id).toBe('b');
    });

    it('returns state unchanged when thought not found', () => {
      const state = stateWithThoughts([{ id: 'a', text: 'First' }]);
      const intent: InterpretedIntent = {
        kind: 'delete_thought',
        payload: { thoughtId: 'nonexistent' },
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts).toHaveLength(1);
      expect(result).toBe(state);
    });
  });

  describe('reorder_thoughts', () => {
    it('reorders thoughts by ID array', () => {
      const state = stateWithThoughts([
        { id: 'a', text: 'First' },
        { id: 'b', text: 'Second' },
        { id: 'c', text: 'Third' },
      ]);
      const intent: InterpretedIntent = {
        kind: 'reorder_thoughts',
        payload: { thoughtIds: ['c', 'a', 'b'] },
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts[0]?.id).toBe('c');
      expect(result.thoughts[1]?.id).toBe('a');
      expect(result.thoughts[2]?.id).toBe('b');
    });

    it('returns state unchanged when IDs do not match', () => {
      const state = stateWithThoughts([
        { id: 'a', text: 'First' },
        { id: 'b', text: 'Second' },
      ]);
      const intent: InterpretedIntent = {
        kind: 'reorder_thoughts',
        payload: { thoughtIds: ['a', 'c'] },
      };

      const result = applyIntentToState(state, intent);

      expect(result).toBe(state);
    });

    it('returns state unchanged when size mismatch', () => {
      const state = stateWithThoughts([
        { id: 'a', text: 'First' },
        { id: 'b', text: 'Second' },
      ]);
      const intent: InterpretedIntent = {
        kind: 'reorder_thoughts',
        payload: { thoughtIds: ['a'] },
      };

      const result = applyIntentToState(state, intent);

      expect(result).toBe(state);
    });

    it('returns state unchanged when thoughtIds contains non-strings', () => {
      const state = stateWithThoughts([{ id: 'a', text: 'First' }]);
      const intent: InterpretedIntent = {
        kind: 'reorder_thoughts',
        payload: { thoughtIds: [1, 2] as unknown as string[] },
      };

      const result = applyIntentToState(state, intent);

      expect(result).toBe(state);
    });

    it('returns state unchanged when thoughtIds is undefined', () => {
      const state = stateWithThoughts([{ id: 'a', text: 'First' }]);
      const intent: InterpretedIntent = {
        kind: 'reorder_thoughts',
        payload: {},
      };

      const result = applyIntentToState(state, intent);

      expect(result).toBe(state);
    });
  });

  describe('update_draft', () => {
    it('returns state unchanged', () => {
      const state = stateWithThoughts([{ id: 'a', text: 'First' }]);
      const intent: InterpretedIntent = {
        kind: 'update_draft',
        payload: { text: 'Generate a blog post' },
      };

      const result = applyIntentToState(state, intent);

      expect(result).toBe(state);
    });
  });

  describe('fallback_append', () => {
    it('adds the text as a thought (same as append_thought)', () => {
      const state = emptyState();
      const intent: InterpretedIntent = {
        kind: 'fallback_append',
        payload: { text: 'Unclear intent text' },
        fallbackReason: 'Could not classify',
      };

      const result = applyIntentToState(state, intent);

      expect(result.thoughts).toHaveLength(1);
      expect(result.thoughts[0]?.text).toBe('Unclear intent text');
    });
  });

  describe('immutability', () => {
    it('does not mutate the original state', () => {
      const state = emptyState();
      const intent: InterpretedIntent = {
        kind: 'append_thought',
        payload: { text: 'New thought' },
      };

      const result = applyIntentToState(state, intent);

      expect(state.thoughts).toHaveLength(0);
      expect(result.thoughts).toHaveLength(1);
    });
  });
});
