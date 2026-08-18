/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntexAgentModels } from '@intexuraos/llm-contract';
import type { LlmKeysResponse, LlmTestResult } from '@/services/llmKeysApi.types';
import type { UseIntexAgentModelResult } from '@/hooks/useIntexAgentModel';

const {
  mockUseLlmKeys,
  mockSetKey,
  mockDeleteKey,
  mockTestKey,
  mockSetDefaultModel,
  mockSetFallbackModel,
  mockRefresh,
} = vi.hoisted(() => ({
  mockUseLlmKeys: vi.fn(),
  mockSetKey: vi.fn(),
  mockDeleteKey: vi.fn(),
  mockTestKey: vi.fn(),
  mockSetDefaultModel: vi.fn(),
  mockSetFallbackModel: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useLlmKeys: (): ReturnType<typeof mockUseLlmKeys> => mockUseLlmKeys(),
}));

vi.mock('@/components', async () => {
  const { OpenRouterKeyCard } = await vi.importActual<
    typeof import('@/components/OpenRouterKeyCard')
  >('@/components/OpenRouterKeyCard');
  return {
    OpenRouterKeyCard,
    Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
    Card: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }): React.JSX.Element => <div className={className}>{children}</div>,
  };
});

import { ApiKeysSettingsPage } from '../ApiKeysSettingsPage.js';

function createKeysResponse(overrides?: Partial<LlmKeysResponse>): LlmKeysResponse {
  return {
    defaultModel: 'or:minimax/minimax-m3',
    fallbackModel: 'or:google/gemini-3.6-flash',
    openrouter: null,
    accessSource: 'platform',
    testResults: { openrouter: null },
    intexAgentModelSelector: { status: 'unavailable' },
    ...overrides,
  };
}

type AvailableSelector = Extract<UseIntexAgentModelResult, { availability: 'available' }>;
type PageHookResult = ReturnType<(typeof import('@/hooks'))['useLlmKeys']>;

function createIntexAgentModel(
  overrides: Partial<AvailableSelector> = {}
): AvailableSelector {
  return {
    availability: 'available',
    writable: true,
    explicitModel: null,
    effectiveModel: IntexAgentModels.DeepSeekV4Flash,
    revision: 1,
    options: [
      { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash' },
      { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3' },
      { id: IntexAgentModels.Gemini36Flash, label: 'Gemini 3.6 Flash' },
    ],
    savingIntexAgentModel: false,
    intexAgentModelError: null,
    setIntexAgentModel: vi.fn().mockResolvedValue('applied'),
    ...overrides,
  };
}

function createPageHookResult(
  overrides: {
    keys?: LlmKeysResponse | null;
    defaultModel?: string | null;
    fallbackModel?: string | null;
    loading?: boolean;
    error?: string | null;
    savingDefaultModel?: boolean;
    intexAgentModel?: UseIntexAgentModelResult;
  } = {}
): PageHookResult {
  const keys = overrides.keys === undefined ? createKeysResponse() : overrides.keys;
  return {
    keys,
    defaultModel:
      overrides.defaultModel === undefined ? (keys?.defaultModel ?? null) : overrides.defaultModel,
    fallbackModel:
      overrides.fallbackModel === undefined
        ? (keys?.fallbackModel ?? null)
        : overrides.fallbackModel,
    loading: false,
    refreshing: false,
    error: null,
    savingDefaultModel: false,
    intexAgentModel: { availability: 'unavailable', writable: false } as const,
    setKey: mockSetKey,
    deleteKey: mockDeleteKey,
    testKey: mockTestKey,
    setDefaultModel: mockSetDefaultModel,
    setFallbackModel: mockSetFallbackModel,
    refresh: mockRefresh,
    ...overrides,
  };
}

function createTestResult(overrides?: Partial<LlmTestResult>): LlmTestResult {
  return {
    status: 'success',
    message: 'OpenRouter access verified',
    testedAt: '2026-03-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('ApiKeysSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetKey.mockResolvedValue(undefined);
    mockDeleteKey.mockResolvedValue(undefined);
    mockTestKey.mockResolvedValue(createTestResult());
    mockSetDefaultModel.mockResolvedValue(undefined);
    mockSetFallbackModel.mockResolvedValue(undefined);
    mockRefresh.mockResolvedValue(undefined);
    mockUseLlmKeys.mockReturnValue(createPageHookResult());
  });

  afterEach(() => {
    cleanup();
  });

  it('shows one OpenRouter credential surface and platform access without legacy providers', () => {
    render(<ApiKeysSettingsPage />);

    expect(screen.getByRole('heading', { name: 'OpenRouter API key' })).toBeInTheDocument();
    expect(screen.getByText('Platform access')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add personal key' })).toHaveLength(1);
    expect(screen.queryByText('Google (Gemini)')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument();
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('Perplexity')).not.toBeInTheDocument();
  });

  it('uses password-manager-safe field semantics and auto-tests after save', async () => {
    render(<ApiKeysSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add personal key' }));

    const input = screen.getByLabelText('OpenRouter API Key');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('id', 'openrouter-api-key');
    expect(input).toHaveAttribute('name', 'openrouter-api-key');

    fireEvent.change(input, { target: { value: 'sk-or-12345678901234567890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSetKey).toHaveBeenCalledWith('openrouter', 'sk-or-12345678901234567890');
      expect(mockTestKey).toHaveBeenCalledWith('openrouter');
    });
    expect(await screen.findByText(/OpenRouter access verified/)).toBeInTheDocument();
  });

  it('shows a non-blocking message when automatic testing fails after save', async () => {
    mockTestKey.mockRejectedValue(new Error('Automatic test failed'));
    render(<ApiKeysSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add personal key' }));
    fireEvent.change(screen.getByLabelText('OpenRouter API Key'), {
      target: { value: 'sk-or-12345678901234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('API key saved, but automatic testing failed. Use Test to retry.')
    ).toBeInTheDocument();
  });

  it('deletes only the personal key and leaves model preferences untouched', async () => {
    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({
        keys: createKeysResponse({
          openrouter: 'sk-or-...7890',
          accessSource: 'user',
        }),
      })
    );
    render(<ApiKeysSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/model preferences stay unchanged/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));

    await waitFor(() => expect(mockDeleteKey).toHaveBeenCalledWith('openrouter'));
    expect(mockSetDefaultModel).not.toHaveBeenCalled();
    expect(mockSetFallbackModel).not.toHaveBeenCalled();
  });

  it('offers only executable OpenRouter IDs for default and fallback', () => {
    render(<ApiKeysSettingsPage />);

    for (const label of ['Default Model', 'Fallback Model']) {
      const select = screen.getByLabelText(label);
      const executableValues = [...select.querySelectorAll('option')]
        .map((option) => option.value)
        .filter((value) => value !== '');
      expect(executableValues.length).toBeGreaterThan(0);
      expect(executableValues.every((value) => value.startsWith('or:'))).toBe(true);
    }
    expect(screen.queryByRole('option', { name: 'Gemini 2.0 Flash' })).not.toBeInTheDocument();
  });

  it('blocks preference changes only when personal OpenRouter access has failed', () => {
    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({
        keys: createKeysResponse({
          openrouter: 'sk-or-...7890',
          accessSource: 'user',
          testResults: {
            openrouter: createTestResult({ status: 'failure', message: 'Invalid key' }),
          },
        }),
      })
    );
    render(<ApiKeysSettingsPage />);

    expect(screen.getByLabelText('Default Model')).toBeDisabled();
    expect(screen.getByLabelText('Fallback Model')).toBeDisabled();
    expect(screen.getByText(/Fix or remove the failed personal key/)).toBeInTheDocument();
  });

  it('keeps the Intex Agent selector out of global LLM settings', () => {
    const setIntexAgentModel = vi.fn().mockResolvedValue('applied');
    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({
        intexAgentModel: createIntexAgentModel({ setIntexAgentModel }),
      })
    );
    render(<ApiKeysSettingsPage />);

    expect(screen.queryByLabelText('Intex Agent model')).not.toBeInTheDocument();
    expect(setIntexAgentModel).not.toHaveBeenCalled();
  });
});
