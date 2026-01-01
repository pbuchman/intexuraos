/**
 * Tests for useActionConfig hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActionConfig } from '../useActionConfig';
import type { Action } from '../../types';
import type { ActionConfig, ConditionTree } from '../../types/actionConfig';

// Mock modules
vi.mock('../../services/actionConfigLoader', () => ({
  loadActionConfig: vi.fn(),
  getFallbackConfig: vi.fn(() => ({
    actions: {
      delete: {
        endpoint: { path: '/router/actions/{actionId}', method: 'DELETE' },
        ui: { label: 'Delete', variant: 'danger', icon: 'Trash2' },
      },
    },
    types: {
      research: { actions: [{ action: 'delete', conditions: [] }] },
    },
  })),
}));

vi.mock('../../services/conditionEvaluator', () => ({
  evaluateCondition: vi.fn((action, when) => {
    // Simple mock: evaluate condition tree
    if (when === undefined) return true;

    // Handle predicate
    if ('field' in when) {
      const fieldValue = action[when.field as keyof typeof action];

      if (when.op === 'eq') {
        return fieldValue === when.value;
      }
      if (when.op === 'gt') {
        return (
          typeof fieldValue === 'number' &&
          typeof when.value === 'number' &&
          fieldValue > when.value
        );
      }
      return false;
    }

    // Handle all condition
    if ('all' in when) {
      return when.all.every((child: ConditionTree) => {
        if ('field' in child) {
          const fieldValue = action[child.field as keyof typeof action];
          if (child.op === 'eq') return fieldValue === child.value;
          if (child.op === 'gt')
            return (
              typeof fieldValue === 'number' &&
              typeof child.value === 'number' &&
              fieldValue > child.value
            );
        }
        return false;
      });
    }

    return false;
  }),
}));

describe('useActionConfig', () => {
  const mockAction: Action = {
    id: 'test-action-id',
    userId: 'test-user-id',
    commandId: 'test-command-id',
    type: 'research',
    confidence: 0.85,
    title: 'Test Action',
    status: 'pending',
    payload: { prompt: 'Test prompt' },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockConfig: ActionConfig = {
    actions: {
      delete: {
        endpoint: { path: '/router/actions/{actionId}', method: 'DELETE' },
        ui: { label: 'Delete', variant: 'danger', icon: 'Trash2' },
      },
      discard: {
        endpoint: { path: '/router/actions/{actionId}', method: 'DELETE' },
        ui: { label: 'Discard', variant: 'secondary', icon: 'XCircle' },
      },
      'approve-research': {
        endpoint: {
          path: '/router/actions/{actionId}',
          method: 'PATCH',
          body: { status: 'processing' },
        },
        ui: { label: 'Approve & Start', variant: 'primary', icon: 'Play' },
      },
    },
    types: {
      research: {
        actions: [
          { action: 'discard', when: { field: 'status', op: 'eq', value: 'pending' } },
          {
            action: 'approve-research',
            when: {
              all: [
                { field: 'status', op: 'eq', value: 'pending' },
                { field: 'confidence', op: 'gt', value: 0.8 },
              ],
            },
          },
          { action: 'delete', when: { field: 'status', op: 'eq', value: 'failed' } },
        ],
      },
      note: { actions: [] },
      todo: { actions: [] },
      link: { actions: [] },
      calendar: { actions: [] },
      reminder: { actions: [] },
      unclassified: { actions: [] },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads config and resolves buttons on mount', async () => {
    const { loadActionConfig } = await import('../../services/actionConfigLoader');
    vi.mocked(loadActionConfig).mockResolvedValue(mockConfig);

    const { result } = renderHook(() => useActionConfig(mockAction));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.buttons).toEqual([]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.buttons).toHaveLength(2);
    expect(result.current.buttons[0]?.id).toBe('discard');
    expect(result.current.buttons[1]?.id).toBe('approve-research');
    expect(result.current.error).toBeNull();
  });

  it('uses fallback config on load error', async () => {
    const { loadActionConfig, getFallbackConfig } =
      await import('../../services/actionConfigLoader');
    vi.mocked(loadActionConfig).mockRejectedValue(new Error('Load failed'));
    const fallback = vi.mocked(getFallbackConfig).mockReturnValue({
      actions: {
        delete: {
          endpoint: { path: '/router/actions/{actionId}', method: 'DELETE' },
          ui: { label: 'Delete', variant: 'danger', icon: 'Trash2' },
        },
      },
      types: {},
    });

    const { result } = renderHook(() => useActionConfig(mockAction));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.buttons).toHaveLength(1);
    expect(result.current.buttons[0]?.id).toBe('delete');
    expect(result.current.error).toBe('Load failed');
    expect(fallback).toHaveBeenCalled();
  });

  it('filters buttons based on conditions', async () => {
    const { loadActionConfig } = await import('../../services/actionConfigLoader');
    const { evaluateCondition } = await import('../../services/conditionEvaluator');

    vi.mocked(loadActionConfig).mockResolvedValue(mockConfig);
    vi.mocked(evaluateCondition).mockImplementation((action, when) => {
      // If undefined, return true
      if (when === undefined) return true;

      // Handle predicate
      if ('field' in when) {
        if (when.field === 'status' && when.op === 'eq' && when.value === 'pending') {
          return action.status === 'pending';
        }
        if (when.field === 'status' && when.op === 'eq' && when.value === 'failed') {
          return action.status === 'failed';
        }
        return false;
      }

      // Handle all condition (approve-research: pending + high confidence)
      if ('all' in when) {
        return when.all.every((child: ConditionTree) => {
          if ('field' in child && child.field === 'status' && child.op === 'eq') {
            return action.status === child.value;
          }
          if (
            'field' in child &&
            child.field === 'confidence' &&
            child.op === 'gt' &&
            typeof child.value === 'number'
          ) {
            return action.confidence > child.value;
          }
          return false;
        });
      }

      return false;
    });

    const { result } = renderHook(() => useActionConfig(mockAction));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.buttons).toHaveLength(2);
    expect(result.current.buttons.map((b) => b.id)).toEqual(['discard', 'approve-research']);
  });

  it('handles missing type configuration', async () => {
    const { loadActionConfig } = await import('../../services/actionConfigLoader');
    vi.mocked(loadActionConfig).mockResolvedValue(mockConfig);

    const unknownTypeAction = { ...mockAction, type: 'unknown' as Action['type'] };
    const { result } = renderHook(() => useActionConfig(unknownTypeAction));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should fallback to delete button
    expect(result.current.buttons).toHaveLength(1);
    expect(result.current.buttons[0]?.id).toBe('delete');
  });

  it('includes action reference in resolved buttons', async () => {
    const { loadActionConfig } = await import('../../services/actionConfigLoader');
    vi.mocked(loadActionConfig).mockResolvedValue(mockConfig);

    const { result } = renderHook(() => useActionConfig(mockAction));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.buttons[0]?.action).toBe(mockAction);
    expect(result.current.buttons[1]?.action).toBe(mockAction);
  });

  it('preserves button order from config', async () => {
    const { loadActionConfig } = await import('../../services/actionConfigLoader');
    vi.mocked(loadActionConfig).mockResolvedValue(mockConfig);

    const { result } = renderHook(() => useActionConfig(mockAction));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Order should match config: discard, approve-research (delete filtered out)
    expect(result.current.buttons.map((b) => b.id)).toEqual(['discard', 'approve-research']);
  });
});
