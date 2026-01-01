/**
 * Tests for condition evaluator service.
 */

import { describe, it, expect } from 'vitest';
import { evaluateConditions } from '../conditionEvaluator';
import type { Action } from '../../types';

describe('evaluateConditions', () => {
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
      nested: {
        value: 42,
      },
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  describe('equality operators', () => {
    it('evaluates == operator with strings', () => {
      expect(evaluateConditions(mockAction, ["status == 'pending'"])).toBe(true);
      expect(evaluateConditions(mockAction, ["status == 'completed'"])).toBe(false);
    });

    it('evaluates != operator with strings', () => {
      expect(evaluateConditions(mockAction, ["status != 'completed'"])).toBe(true);
      expect(evaluateConditions(mockAction, ["status != 'pending'"])).toBe(false);
    });

    it('evaluates == operator with numbers', () => {
      expect(evaluateConditions(mockAction, ['confidence == 0.85'])).toBe(true);
      expect(evaluateConditions(mockAction, ['confidence == 0.9'])).toBe(false);
    });
  });

  describe('comparison operators', () => {
    it('evaluates > operator', () => {
      expect(evaluateConditions(mockAction, ['confidence > 0.8'])).toBe(true);
      expect(evaluateConditions(mockAction, ['confidence > 0.9'])).toBe(false);
    });

    it('evaluates >= operator', () => {
      expect(evaluateConditions(mockAction, ['confidence >= 0.85'])).toBe(true);
      expect(evaluateConditions(mockAction, ['confidence >= 0.8'])).toBe(true);
      expect(evaluateConditions(mockAction, ['confidence >= 0.9'])).toBe(false);
    });

    it('evaluates < operator', () => {
      expect(evaluateConditions(mockAction, ['confidence < 0.9'])).toBe(true);
      expect(evaluateConditions(mockAction, ['confidence < 0.8'])).toBe(false);
    });

    it('evaluates <= operator', () => {
      expect(evaluateConditions(mockAction, ['confidence <= 0.85'])).toBe(true);
      expect(evaluateConditions(mockAction, ['confidence <= 0.9'])).toBe(true);
      expect(evaluateConditions(mockAction, ['confidence <= 0.8'])).toBe(false);
    });
  });

  describe('AND logic', () => {
    it('returns true when all conditions are met', () => {
      expect(
        evaluateConditions(mockAction, ["status == 'pending'", 'confidence > 0.8'])
      ).toBe(true);
    });

    it('returns false when any condition fails', () => {
      expect(
        evaluateConditions(mockAction, ["status == 'pending'", 'confidence > 0.9'])
      ).toBe(false);
    });

    it('returns false when multiple conditions fail', () => {
      expect(
        evaluateConditions(mockAction, ["status == 'completed'", 'confidence > 0.9'])
      ).toBe(false);
    });

    it('returns true with three conditions all met', () => {
      expect(
        evaluateConditions(mockAction, [
          "status == 'pending'",
          'confidence > 0.8',
          "type == 'research'",
        ])
      ).toBe(true);
    });
  });

  describe('nested fields', () => {
    it('evaluates nested field with dot notation', () => {
      expect(evaluateConditions(mockAction, ["payload.prompt == 'Test prompt'"])).toBe(true);
      expect(evaluateConditions(mockAction, ["payload.prompt == 'Other'"])).toBe(false);
    });

    it('evaluates deeply nested fields', () => {
      expect(evaluateConditions(mockAction, ['payload.nested.value == 42'])).toBe(true);
      expect(evaluateConditions(mockAction, ['payload.nested.value > 40'])).toBe(true);
    });

    it('returns false for non-existent nested fields', () => {
      expect(evaluateConditions(mockAction, ["payload.nonexistent == 'value'"])).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty conditions array (returns true)', () => {
      expect(evaluateConditions(mockAction, [])).toBe(true);
    });

    it('handles invalid condition syntax gracefully', () => {
      expect(evaluateConditions(mockAction, ['invalid condition'])).toBe(false);
    });

    it('handles conditions with extra whitespace', () => {
      expect(evaluateConditions(mockAction, ['  status   ==   "pending"  '])).toBe(true);
    });

    it('handles double quotes for strings', () => {
      expect(evaluateConditions(mockAction, ['status == "pending"'])).toBe(true);
    });

    it('handles single quotes for strings', () => {
      expect(evaluateConditions(mockAction, ["status == 'pending'"])).toBe(true);
    });
  });

  describe('type handling', () => {
    it('compares strings correctly', () => {
      expect(evaluateConditions(mockAction, ["type == 'research'"])).toBe(true);
      expect(evaluateConditions(mockAction, ["type != 'note'"])).toBe(true);
    });

    it('compares numbers correctly', () => {
      expect(evaluateConditions(mockAction, ['confidence == 0.85'])).toBe(true);
      expect(evaluateConditions(mockAction, ['payload.nested.value == 42'])).toBe(true);
    });

    it('does not compare incompatible types for comparison operators', () => {
      expect(evaluateConditions(mockAction, ["status > 'a'"])).toBe(false);
      expect(evaluateConditions(mockAction, ["type < 'z'"])).toBe(false);
    });
  });
});
