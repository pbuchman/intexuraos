/**
 * Tests for condition evaluator service.
 */

import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../conditionEvaluator';
import type { Action } from '../../types';
import type { ConditionTree } from '../../types/actionConfig';

describe('evaluateCondition', () => {
  const mockAction: Action = {
    id: 'test-action-id',
    userId: 'test-user-id',
    commandId: 'test-command-id',
    type: 'research',
    confidence: 0.85,
    title: 'Test Action',
    status: 'pending',
    payload: {
      prompt: 'Test prompt',
      tags: ['ai', 'research'],
      nested: {
        value: 42,
        name: 'nested value',
      },
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  describe('undefined condition', () => {
    it('returns true when when is undefined', () => {
      expect(evaluateCondition(mockAction, undefined)).toBe(true);
    });
  });

  describe('equality predicates (eq/neq)', () => {
    it('evaluates eq with strings', () => {
      const whenTrue: ConditionTree = { field: 'status', op: 'eq', value: 'pending' };
      const whenFalse: ConditionTree = { field: 'status', op: 'eq', value: 'completed' };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });

    it('evaluates eq with numbers', () => {
      const whenTrue: ConditionTree = { field: 'confidence', op: 'eq', value: 0.85 };
      const whenFalse: ConditionTree = { field: 'confidence', op: 'eq', value: 0.9 };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });

    it('evaluates neq with strings', () => {
      const whenTrue: ConditionTree = { field: 'status', op: 'neq', value: 'completed' };
      const whenFalse: ConditionTree = { field: 'status', op: 'neq', value: 'pending' };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });

    it('evaluates neq with numbers', () => {
      const whenTrue: ConditionTree = { field: 'confidence', op: 'neq', value: 0.9 };
      const whenFalse: ConditionTree = { field: 'confidence', op: 'neq', value: 0.85 };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });
  });

  describe('comparison predicates (gt/gte/lt/lte)', () => {
    it('evaluates gt operator', () => {
      const whenTrue: ConditionTree = { field: 'confidence', op: 'gt', value: 0.8 };
      const whenFalse: ConditionTree = { field: 'confidence', op: 'gt', value: 0.9 };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });

    it('evaluates gte operator', () => {
      const whenEqual: ConditionTree = { field: 'confidence', op: 'gte', value: 0.85 };
      const whenLess: ConditionTree = { field: 'confidence', op: 'gte', value: 0.8 };
      const whenGreater: ConditionTree = { field: 'confidence', op: 'gte', value: 0.9 };

      expect(evaluateCondition(mockAction, whenEqual)).toBe(true);
      expect(evaluateCondition(mockAction, whenLess)).toBe(true);
      expect(evaluateCondition(mockAction, whenGreater)).toBe(false);
    });

    it('evaluates lt operator', () => {
      const whenTrue: ConditionTree = { field: 'confidence', op: 'lt', value: 0.9 };
      const whenFalse: ConditionTree = { field: 'confidence', op: 'lt', value: 0.8 };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });

    it('evaluates lte operator', () => {
      const whenEqual: ConditionTree = { field: 'confidence', op: 'lte', value: 0.85 };
      const whenGreater: ConditionTree = { field: 'confidence', op: 'lte', value: 0.9 };
      const whenLess: ConditionTree = { field: 'confidence', op: 'lte', value: 0.8 };

      expect(evaluateCondition(mockAction, whenEqual)).toBe(true);
      expect(evaluateCondition(mockAction, whenGreater)).toBe(true);
      expect(evaluateCondition(mockAction, whenLess)).toBe(false);
    });

    it('returns false for comparison on non-number fields', () => {
      const when: ConditionTree = { field: 'status', op: 'gt', value: 'a' };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('returns false for comparison with non-number value', () => {
      const when: ConditionTree = { field: 'confidence', op: 'gt', value: 'not a number' };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });
  });

  describe('membership predicates (in/nin)', () => {
    it('evaluates in operator with match', () => {
      const when: ConditionTree = { field: 'status', op: 'in', value: ['pending', 'processing'] };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('evaluates in operator without match', () => {
      const when: ConditionTree = { field: 'status', op: 'in', value: ['completed', 'failed'] };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('evaluates nin operator without match', () => {
      const when: ConditionTree = { field: 'status', op: 'nin', value: ['completed', 'failed'] };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('evaluates nin operator with match', () => {
      const when: ConditionTree = { field: 'status', op: 'nin', value: ['pending', 'processing'] };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('returns false for in operator with non-array value', () => {
      const when: ConditionTree = { field: 'status', op: 'in', value: 'not an array' };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('returns false for nin operator with non-array value', () => {
      const when: ConditionTree = { field: 'status', op: 'nin', value: 'not an array' };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });
  });

  describe('existence predicate (exists)', () => {
    it('returns true for existing field with no value specified', () => {
      const when: ConditionTree = { field: 'status', op: 'exists' };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('returns false for non-existing field with no value specified', () => {
      const when: ConditionTree = { field: 'nonexistent', op: 'exists' };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('returns true for existing field when value is true', () => {
      const when: ConditionTree = { field: 'status', op: 'exists', value: true };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('returns false for existing field when value is false', () => {
      const when: ConditionTree = { field: 'status', op: 'exists', value: false };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('returns true for non-existing field when value is false', () => {
      const when: ConditionTree = { field: 'nonexistent', op: 'exists', value: false };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('returns false for non-existing field when value is true', () => {
      const when: ConditionTree = { field: 'nonexistent', op: 'exists', value: true };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });
  });

  describe('AND logic (all)', () => {
    it('returns true when all conditions are met', () => {
      const when: ConditionTree = {
        all: [
          { field: 'status', op: 'eq', value: 'pending' },
          { field: 'confidence', op: 'gt', value: 0.8 },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('returns false when one condition fails', () => {
      const when: ConditionTree = {
        all: [
          { field: 'status', op: 'eq', value: 'pending' },
          { field: 'confidence', op: 'gt', value: 0.9 },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('returns false when all conditions fail', () => {
      const when: ConditionTree = {
        all: [
          { field: 'status', op: 'eq', value: 'completed' },
          { field: 'confidence', op: 'gt', value: 0.9 },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('returns true with three conditions all met', () => {
      const when: ConditionTree = {
        all: [
          { field: 'status', op: 'eq', value: 'pending' },
          { field: 'confidence', op: 'gt', value: 0.8 },
          { field: 'type', op: 'eq', value: 'research' },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('short-circuits on first false', () => {
      const when: ConditionTree = {
        all: [
          { field: 'status', op: 'eq', value: 'completed' },
          { field: 'nonexistent', op: 'eq', value: 'value' },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });
  });

  describe('OR logic (any)', () => {
    it('returns true when one condition is met', () => {
      const when: ConditionTree = {
        any: [
          { field: 'status', op: 'eq', value: 'completed' },
          { field: 'confidence', op: 'gt', value: 0.8 },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('returns true when all conditions are met', () => {
      const when: ConditionTree = {
        any: [
          { field: 'status', op: 'eq', value: 'pending' },
          { field: 'confidence', op: 'gt', value: 0.8 },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('returns false when all conditions fail', () => {
      const when: ConditionTree = {
        any: [
          { field: 'status', op: 'eq', value: 'completed' },
          { field: 'confidence', op: 'gt', value: 0.9 },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('short-circuits on first true', () => {
      const when: ConditionTree = {
        any: [
          { field: 'status', op: 'eq', value: 'pending' },
          { field: 'nonexistent', op: 'eq', value: 'value' },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });
  });

  describe('NOT logic (not)', () => {
    it('negates a true predicate', () => {
      const when: ConditionTree = {
        not: { field: 'status', op: 'eq', value: 'pending' },
      };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('negates a false predicate', () => {
      const when: ConditionTree = {
        not: { field: 'status', op: 'eq', value: 'completed' },
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('negates an all condition', () => {
      const when: ConditionTree = {
        not: {
          all: [
            { field: 'status', op: 'eq', value: 'pending' },
            { field: 'confidence', op: 'gt', value: 0.8 },
          ],
        },
      };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('negates an any condition', () => {
      const when: ConditionTree = {
        not: {
          any: [
            { field: 'status', op: 'eq', value: 'completed' },
            { field: 'confidence', op: 'gt', value: 0.9 },
          ],
        },
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });
  });

  describe('nested combinations', () => {
    it('evaluates all with nested any', () => {
      const when: ConditionTree = {
        all: [
          { field: 'status', op: 'eq', value: 'pending' },
          {
            any: [
              { field: 'confidence', op: 'gt', value: 0.8 },
              { field: 'type', op: 'eq', value: 'manual' },
            ],
          },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('evaluates any with nested all', () => {
      const when: ConditionTree = {
        any: [
          { field: 'status', op: 'eq', value: 'completed' },
          {
            all: [
              { field: 'status', op: 'eq', value: 'pending' },
              { field: 'confidence', op: 'gt', value: 0.8 },
            ],
          },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('evaluates all with nested not', () => {
      const when: ConditionTree = {
        all: [
          { field: 'status', op: 'eq', value: 'pending' },
          {
            not: { field: 'confidence', op: 'lt', value: 0.5 },
          },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('evaluates complex 3-level tree', () => {
      const when: ConditionTree = {
        all: [
          { field: 'type', op: 'eq', value: 'research' },
          {
            any: [
              { field: 'status', op: 'eq', value: 'pending' },
              {
                all: [
                  { field: 'status', op: 'eq', value: 'processing' },
                  { field: 'confidence', op: 'gt', value: 0.9 },
                ],
              },
            ],
          },
        ],
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });
  });

  describe('nested fields with dot notation', () => {
    it('evaluates nested field', () => {
      const whenTrue: ConditionTree = { field: 'payload.prompt', op: 'eq', value: 'Test prompt' };
      const whenFalse: ConditionTree = { field: 'payload.prompt', op: 'eq', value: 'Other' };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });

    it('evaluates deeply nested field', () => {
      const whenTrue: ConditionTree = { field: 'payload.nested.value', op: 'eq', value: 42 };
      const whenFalse: ConditionTree = { field: 'payload.nested.value', op: 'eq', value: 100 };

      expect(evaluateCondition(mockAction, whenTrue)).toBe(true);
      expect(evaluateCondition(mockAction, whenFalse)).toBe(false);
    });

    it('evaluates deeply nested string field', () => {
      const when: ConditionTree = {
        field: 'payload.nested.name',
        op: 'eq',
        value: 'nested value',
      };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('returns false for non-existent nested field', () => {
      const when: ConditionTree = {
        field: 'payload.nonexistent.field',
        op: 'eq',
        value: 'value',
      };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles undefined field value', () => {
      const when: ConditionTree = { field: 'nonexistent', op: 'eq', value: 'value' };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('handles null field value', () => {
      const actionWithNull = {
        ...mockAction,
        payload: { ...mockAction.payload, nullField: null },
      };
      const when: ConditionTree = { field: 'payload.nullField', op: 'eq', value: null };

      expect(evaluateCondition(actionWithNull, when)).toBe(true);
    });

    it('handles comparison with undefined field', () => {
      const when: ConditionTree = { field: 'nonexistent', op: 'gt', value: 10 };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('handles empty all array', () => {
      const when: ConditionTree = { all: [] };

      expect(evaluateCondition(mockAction, when)).toBe(true);
    });

    it('handles empty any array', () => {
      const when: ConditionTree = { any: [] };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('handles unknown condition structure', () => {
      const when = { unknown: 'structure' } as unknown as ConditionTree;

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });

    it('handles type mismatch in equality', () => {
      const when: ConditionTree = { field: 'confidence', op: 'eq', value: '0.85' };

      expect(evaluateCondition(mockAction, when)).toBe(false);
    });
  });
});
