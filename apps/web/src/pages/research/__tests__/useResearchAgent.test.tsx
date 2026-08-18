/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import type { OpenRouterModelInfo, Research } from '@/services/researchAgentApi.types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getResearch: vi.fn(),
  updateDraft: vi.fn(),
  openRouterState: {
    models: [] as OpenRouterModelInfo[],
    loading: true,
    error: null as string | null,
    refresh: vi.fn(),
  },
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken } => ({
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/hooks', () => ({
  useLlmKeys: (): {
    keys: {
      openrouter: null;
      accessSource: 'platform';
      testResults: { openrouter: null };
    };
    loading: false;
  } => ({
    keys: {
      openrouter: null,
      accessSource: 'platform',
      testResults: { openrouter: null },
    },
    loading: false,
  }),
  useOpenRouterModels: (): typeof mocks.openRouterState => mocks.openRouterState,
}));

vi.mock('@/services/researchAgentApi', () => ({
  getResearch: mocks.getResearch,
  updateDraft: mocks.updateDraft,
  improveInput: vi.fn(),
  saveDraft: vi.fn(),
  validateInput: vi.fn(),
}));

import { useResearchAgent } from '../useResearchAgent.js';

const retiredSynthesis = 'or:google/gemini-3-flash-preview';

function model(id: string): OpenRouterModelInfo {
  return {
    id,
    name: id,
    provider: id.split('/')[0] ?? id,
    contextLength: 100_000,
    pricing: { inputPricePerMillion: 1, outputPricePerMillion: 2 },
    inputModalities: ['text'],
    outputModalities: ['text'],
  };
}

function historicalDraft(): Research {
  return {
    id: 'research-draft',
    userId: 'user-1',
    title: 'Historical draft',
    prompt: 'A sufficiently long historical research prompt',
    selectedModels: [LlmModels.ClaudeSonnet46, retiredSynthesis],
    synthesisModel: retiredSynthesis,
    status: 'draft',
    llmResults: [],
    startedAt: '2026-08-17T10:00:00.000Z',
  };
}

describe('useResearchAgent historical draft safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.getAccessToken.mockResolvedValue('token');
    mocks.getResearch.mockResolvedValue(historicalDraft());
    mocks.updateDraft.mockResolvedValue(historicalDraft());
    mocks.openRouterState.models = [];
    mocks.openRouterState.loading = true;
    mocks.openRouterState.error = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not rewrite retired selections or auto-pick synthesis when the live catalog arrives', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <MemoryRouter>{children}</MemoryRouter>
    );
    const { result, rerender } = renderHook(
      () => useResearchAgent({ draftId: 'research-draft' }),
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.synthesisModel).toBe(retiredSynthesis);
    expect(result.current.selectedOpenRouterModels).toEqual([
      'google/gemini-3-flash-preview',
    ]);

    mocks.openRouterState.models = [
      model('openai/gpt-5.4'),
      model('minimax/minimax-m3'),
    ];
    mocks.openRouterState.loading = false;
    rerender();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(result.current.synthesisModel).toBe(retiredSynthesis);
    expect(result.current.canSubmit).toBe(false);
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it('autosaves an edited prompt without replacing untouched historical model fields', async () => {
    mocks.openRouterState.models = [model('openai/gpt-5.4')];
    mocks.openRouterState.loading = false;
    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <MemoryRouter>{children}</MemoryRouter>
    );
    const { result } = renderHook(
      () => useResearchAgent({ draftId: 'research-draft' }),
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    act(() => {
      result.current.setPrompt('An explicitly edited historical research prompt');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mocks.updateDraft).toHaveBeenCalledWith(
      'token',
      'research-draft',
      { prompt: 'An explicitly edited historical research prompt' },
    );
    expect(result.current.synthesisModel).toBe(retiredSynthesis);
    expect(result.current.canSubmit).toBe(false);
  });
});
