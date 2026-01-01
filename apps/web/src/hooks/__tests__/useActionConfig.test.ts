/**
 * Tests for useActionConfig hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActionConfig } from '../useActionConfig';
import type { Action } from '../../types';
import type { ActionConfig } from '../../types/actionConfig';

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
  evaluateConditions: vi.fn((action, conditions) => {
    // Simple mock: return true if no conditions or if status is pending
    return conditions.length === 0 || action.status === 'pending';
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
          { action: 'discard', conditions: ["status == 'pending'"] },
          { action: 'approve-research', conditions: ["status == 'pending'", 'confidence > 0.8'] },
          { action: 'delete', conditions: ["status == 'failed'"] },
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
    const { loadActionConfig, getFallbackConfig } = await import('../../services/actionConfigLoader');
    vi.mocked(loadActionConfig).mockRejectedValue(new Error('Load failed'));
    const fallback = vi.mocked(getFallbackConfig).mockReturnValue({
      actions: {
        delete: {
          endpoint: { path: '/router/actions/{actionId}', method: 'DELETE' },
          ui: { label: 'Delete', variant: 'danger', icon: 'Trash2' },
        },
      },
      types: {
        research: { actions: [{ action: 'delete', conditions: [] }] },
        note: { actions: [] },
        todo: { actions: [] },
        link: { actions: [] },
        calendar: { actions: [] },
        reminder: { actions: [] },
        unclassified: { actions: [] },
      },
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
    const { evaluateConditions } = await import('../../services/conditionEvaluator');

    vi.mocked(loadActionConfig).mockResolvedValue(mockConfig);
    vi.mocked(evaluateConditions).mockImplementation((action, conditions) => {
      // Only approve-research passes (pending + high confidence)
      if (conditions.includes('confidence > 0.8') && action.status === 'pending') {
        return true;
      }
      // Discard passes (just pending)
      if (conditions.length === 1 && conditions[0] === "status == 'pending'") {
        return true;
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
