/**
 * Tests for useOpenRouterModels hook.
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenRouterModels } from '../useOpenRouterModels.js';

const mockRequest = vi.fn();

vi.mock('../useApiClient.js', () => ({
  useApiClient: (): { request: typeof mockRequest; isAuthenticated: boolean } => ({
    request: mockRequest,
    isAuthenticated: true,
  }),
}));

vi.mock('../../config.js', () => ({
  config: {
    ResearchAgentUrl: 'http://test-research-agent',
  },
}));

const MOCK_MODELS = [
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    contextLength: 200000,
    pricing: { promptPerToken: 0.000003, completionPerToken: 0.000015 },
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    contextLength: 1047576,
    pricing: { promptPerToken: 0.000002, completionPerToken: 0.000008 },
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
  },
];

describe('useOpenRouterModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches models when isConfigured is true', async () => {
    mockRequest.mockResolvedValueOnce({
      models: MOCK_MODELS,
      cachedAt: '2026-03-25T00:00:00Z',
    });

    const { result } = renderHook(() => useOpenRouterModels(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.models).toStrictEqual(MOCK_MODELS);
    expect(result.current.error).toBeNull();
    expect(mockRequest).toHaveBeenCalledWith(
      'http://test-research-agent',
      '/research/openrouter/models'
    );
  });

  it('returns empty array and does not fetch when isConfigured is false', () => {
    const { result } = renderHook(() => useOpenRouterModels(false));

    expect(result.current.models).toStrictEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useOpenRouterModels(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.models).toStrictEqual([]);
    expect(result.current.error).toBe('Network error');
  });

  it('does not re-fetch on subsequent renders', async () => {
    mockRequest.mockResolvedValueOnce({
      models: MOCK_MODELS,
      cachedAt: '2026-03-25T00:00:00Z',
    });

    const { result, rerender } = renderHook(() => useOpenRouterModels(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender();
    rerender();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after unconfigure and reconfigure', async () => {
    mockRequest.mockResolvedValue({
      models: MOCK_MODELS,
      cachedAt: '2026-03-25T00:00:00Z',
    });

    let isConfigured = true;
    const { result, rerender } = renderHook(() => useOpenRouterModels(isConfigured));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // Unconfigure
    isConfigured = false;
    rerender();
    expect(result.current.models).toStrictEqual([]);

    // Reconfigure — should trigger a new fetch
    isConfigured = true;
    rerender();

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.models).toStrictEqual(MOCK_MODELS);
    });
  });

  it('refresh() triggers a new fetch after initial load', async () => {
    const firstModel = MOCK_MODELS[0] ?? MOCK_MODELS[1];
    const updatedModels = firstModel !== undefined ? [firstModel] : [];
    mockRequest
      .mockResolvedValueOnce({ models: MOCK_MODELS, cachedAt: '2026-03-25T00:00:00Z' })
      .mockResolvedValueOnce({ models: updatedModels, cachedAt: '2026-03-25T01:00:00Z' });

    const { result } = renderHook(() => useOpenRouterModels(true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.models).toStrictEqual(MOCK_MODELS);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // Call refresh to trigger a new fetch
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.current.models).toStrictEqual(updatedModels);
  });
});
