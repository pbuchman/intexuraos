/**
 * Tests for variable interpolator service.
 */

import { describe, it, expect } from 'vitest';
import { interpolateVariables } from '../variableInterpolator';
import type { Action } from '../../types';

describe('interpolateVariables', () => {
  const mockAction: Action = {
    id: 'test-action-id',
    userId: 'test-user-id',
    commandId: 'test-command-id',
    type: 'research',
    confidence: 0.85,
    title: 'Test Title',
    status: 'pending',
    payload: {
      prompt: 'Test prompt',
      description: 'Test description',
      nested: {
        value: 'nested value',
      },
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  describe('basic interpolation', () => {
    it('interpolates simple field placeholder', () => {
      const template = { title: '{{action.title}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.title).toBe('Test Title');
    });

    it('interpolates nested field placeholder', () => {
      const template = { prompt: '{{action.payload.prompt}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.prompt).toBe('Test prompt');
    });

    it('interpolates deeply nested field', () => {
      const template = { value: '{{action.payload.nested.value}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.value).toBe('nested value');
    });

    it('interpolates multiple fields', () => {
      const template = {
        title: '{{action.title}}',
        prompt: '{{action.payload.prompt}}',
      };
      const result = interpolateVariables(template, mockAction);
      expect(result.title).toBe('Test Title');
      expect(result.prompt).toBe('Test prompt');
    });
  });

  describe('string interpolation', () => {
    it('interpolates placeholder in middle of string', () => {
      const template = { text: 'Title: {{action.title}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.text).toBe('Title: Test Title');
    });

    it('interpolates multiple placeholders in same string', () => {
      const template = { text: '{{action.title}} - {{action.payload.prompt}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.text).toBe('Test Title - Test prompt');
    });

    it('interpolates placeholder with prefix and suffix', () => {
      const template = { text: 'Prefix {{action.title}} suffix' };
      const result = interpolateVariables(template, mockAction);
      expect(result.text).toBe('Prefix Test Title suffix');
    });
  });

  describe('type conversion', () => {
    it('converts numbers to strings in interpolation', () => {
      const template = { conf: 'Confidence: {{action.confidence}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.conf).toBe('Confidence: 0.85');
    });

    it('keeps non-string values as-is when not interpolating', () => {
      const template = { count: 42, enabled: true };
      const result = interpolateVariables(template, mockAction);
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
    });
  });

  describe('nested objects and arrays', () => {
    it('interpolates in nested objects', () => {
      const template = {
        metadata: {
          title: '{{action.title}}',
          prompt: '{{action.payload.prompt}}',
        },
      };
      const result = interpolateVariables(template, mockAction);
      expect(result.metadata).toEqual({
        title: 'Test Title',
        prompt: 'Test prompt',
      });
    });

    it('interpolates in arrays', () => {
      const template = {
        items: ['{{action.title}}', '{{action.payload.prompt}}', 'static value'],
      };
      const result = interpolateVariables(template, mockAction);
      expect(result.items).toEqual(['Test Title', 'Test prompt', 'static value']);
    });

    it('interpolates in deeply nested structures', () => {
      const template = {
        data: {
          items: [
            { name: '{{action.title}}' },
            { name: '{{action.payload.prompt}}' },
          ],
        },
      };
      const result = interpolateVariables(template, mockAction);
      expect(result.data).toEqual({
        items: [
          { name: 'Test Title' },
          { name: 'Test prompt' },
        ],
      });
    });
  });

  describe('edge cases', () => {
    it('handles non-existent fields gracefully', () => {
      const template = { value: '{{action.nonexistent}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.value).toBe('');
    });

    it('handles null values', () => {
      const actionWithNull = { ...mockAction, payload: { ...mockAction.payload, nullValue: null } };
      const template = { value: '{{action.payload.nullValue}}' };
      const result = interpolateVariables(template, actionWithNull);
      expect(result.value).toBe('');
    });

    it('handles undefined values', () => {
      const template = { value: '{{action.payload.undefined}}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.value).toBe('');
    });

    it('handles whitespace in placeholders', () => {
      const template = { value: '{{ action.title }}' };
      const result = interpolateVariables(template, mockAction);
      expect(result.value).toBe('Test Title');
    });

    it('preserves strings without placeholders', () => {
      const template = { static: 'No placeholders here' };
      const result = interpolateVariables(template, mockAction);
      expect(result.static).toBe('No placeholders here');
    });

    it('handles empty template', () => {
      const template = {};
      const result = interpolateVariables(template, mockAction);
      expect(result).toEqual({});
    });
  });

  describe('real-world examples', () => {
    it('interpolates research creation request body', () => {
      const template = {
        prompt: '{{action.payload.prompt}}',
        metadata: {
          source: 'action',
          actionId: '{{action.id}}',
        },
      };
      const result = interpolateVariables(template, mockAction);
      expect(result).toEqual({
        prompt: 'Test prompt',
        metadata: {
          source: 'action',
          actionId: 'test-action-id',
        },
      });
    });

    it('interpolates note creation request body', () => {
      const template = {
        title: '{{action.title}}',
        content: '{{action.payload.description}}',
      };
      const result = interpolateVariables(template, mockAction);
      expect(result).toEqual({
        title: 'Test Title',
        content: 'Test description',
      });
    });
  });
});
