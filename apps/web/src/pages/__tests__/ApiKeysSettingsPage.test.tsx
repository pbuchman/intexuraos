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
  const { Input } = await vi.importActual<typeof import('@/components/ui/Input')>(
    '@/components/ui/Input'
  );
  const { IntexAgentModelCard } = await vi.importActual<
    typeof import('@/components/IntexAgentModelCard')
  >('@/components/IntexAgentModelCard');
  return {
    Input,
    IntexAgentModelCard,
    Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
    Card: ({
      children,
      className,
      title,
    }: {
      children: React.ReactNode;
      className?: string;
      title?: string;
    }): React.JSX.Element => (
      <div className={className}>
        {title !== undefined ? <div>{title}</div> : null}
        {children}
      </div>
    ),
    Button: ({
      children,
      isLoading: _isLoading,
      variant: _variant,
      size: _size,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      isLoading?: boolean;
      variant?: string;
      size?: string;
    }): React.JSX.Element => <button {...props}>{children}</button>,
  };
});

import { ApiKeysSettingsPage } from '../ApiKeysSettingsPage.js';

function createKeysResponse(overrides?: Partial<LlmKeysResponse>): LlmKeysResponse {
  return {
    defaultModel: null,
    google: null,
    openai: null,
    anthropic: null,
    perplexity: null,
    openrouter: null,
    testResults: {
      google: null,
      openai: null,
      anthropic: null,
      perplexity: null,
      openrouter: null,
    },
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
      { id: IntexAgentModels.Gemini3FlashPreview, label: 'Gemini 3 Flash Preview' },
    ],
    savingIntexAgentModel: false,
    intexAgentModelError: null,
    setIntexAgentModel: vi.fn().mockResolvedValue('applied'),
    ...overrides,
  };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  return {
    keys: createKeysResponse(),
    defaultModel: null,
    fallbackModel: null,
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
    message: 'Connection verified',
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
  });

  afterEach(() => {
    cleanup();
  });

  it('uses provider-specific API key field semantics and auto-tests after save', async () => {
    mockUseLlmKeys.mockReturnValue(createPageHookResult());

    render(<ApiKeysSettingsPage />);

    // Index 4 = OpenRouter (order: Google, OpenAI, Anthropic, Perplexity, OpenRouter)
    const configureButtons = screen.getAllByRole('button', { name: 'Configure' });
    fireEvent.click(configureButtons[4] as HTMLButtonElement);

    const input = screen.getByLabelText('API Key');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('id', 'openrouter-api-key');
    expect(input).toHaveAttribute('name', 'openrouter-api-key');

    fireEvent.change(input, { target: { value: 'sk-or-12345678901234567890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSetKey).toHaveBeenCalledWith('openrouter', 'sk-or-12345678901234567890');
    });
    await waitFor(() => {
      expect(mockTestKey).toHaveBeenCalledWith('openrouter');
    });
    expect(await screen.findByText('Connection verified')).toBeInTheDocument();
  });

  it('shows a non-blocking message when automatic testing fails after save', async () => {
    mockTestKey.mockRejectedValue(new Error('Automatic test failed'));
    mockUseLlmKeys.mockReturnValue(createPageHookResult());

    render(<ApiKeysSettingsPage />);

    // Index 4 = OpenRouter (order: Google, OpenAI, Anthropic, Perplexity, OpenRouter)
    const configureButtons = screen.getAllByRole('button', { name: 'Configure' });
    fireEvent.click(configureButtons[4] as HTMLButtonElement);

    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-or-12345678901234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSetKey).toHaveBeenCalledWith('openrouter', 'sk-or-12345678901234567890');
    });
    await waitFor(() => {
      expect(mockTestKey).toHaveBeenCalledWith('openrouter');
    });
    expect(
      await screen.findByText('API key saved, but automatic testing failed. Use Test to retry.')
    ).toBeInTheDocument();
  });

  it('opens the actions menu upward when the trigger is near the viewport bottom', async () => {
    mockUseLlmKeys.mockReturnValue(createPageHookResult({
      keys: createKeysResponse({
        openrouter: 'sk-or-...7890',
      }),
    }));

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 320,
    });

    render(<ApiKeysSettingsPage />);

    const actionsButton = screen.getByTitle('Actions');
    actionsButton.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 280,
      width: 24,
      height: 24,
      top: 280,
      right: 24,
      bottom: 304,
      left: 0,
      toJSON: (): object => ({}),
    })) as typeof actionsButton.getBoundingClientRect;

    fireEvent.click(actionsButton);

    const testButton = await screen.findByRole('button', { name: 'Test' });
    expect(testButton.parentElement).toHaveClass('bottom-full');
  });

  it('renders the platform selector independently of BYOK keys and failed provider tests', () => {
    const setIntexAgentModel = vi.fn().mockResolvedValue('applied');
    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({
        keys: createKeysResponse({
          openrouter: null,
          testResults: { google: null, openai: null, anthropic: null, perplexity: null, openrouter: {
            status: 'failure', message: 'failed', testedAt: '2026-07-19T10:00:00.000Z',
          } },
        }),
        intexAgentModel: createIntexAgentModel({ setIntexAgentModel }),
      })
    );

    render(<ApiKeysSettingsPage />);

    const select = screen.getByLabelText('Intex Agent model');
    expect(select).toHaveValue(IntexAgentModels.DeepSeekV4Flash);
    fireEvent.change(select, { target: { value: IntexAgentModels.MiniMaxM3 } });
    expect(setIntexAgentModel).toHaveBeenCalledWith(IntexAgentModels.MiniMaxM3);
  });

  it('omits every selector surface when capability is unavailable while retaining legacy settings', () => {
    mockUseLlmKeys.mockReturnValue(createPageHookResult());

    render(<ApiKeysSettingsPage />);

    expect(screen.queryByRole('heading', { name: 'Intex Agent model' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Intex Agent model')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use default Intex Agent model/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Default Model' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fallback Model' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Configure' })).toHaveLength(5);
  });

  it('keeps Intex saving state independent from the general default model state', () => {
    const { rerender } = render(<ApiKeysSettingsPage />);
    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({ savingDefaultModel: true, intexAgentModel: createIntexAgentModel() })
    );
    rerender(<ApiKeysSettingsPage />);
    expect(screen.getByLabelText('Intex Agent model')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Intex Agent model')).toBeEnabled();

    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({ intexAgentModel: createIntexAgentModel({ savingIntexAgentModel: true }) })
    );
    rerender(<ApiKeysSettingsPage />);
    expect(screen.getByLabelText('Intex Agent model')).toHaveAttribute('aria-busy', 'true');
  });

  it('forwards an immediate explicit selection and reset only to the selector mutation', () => {
    const setIntexAgentModel = vi.fn().mockResolvedValue('applied');
    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({
        intexAgentModel: createIntexAgentModel({
          explicitModel: IntexAgentModels.Gemini3FlashPreview,
          effectiveModel: IntexAgentModels.Gemini3FlashPreview,
          setIntexAgentModel,
        }),
      })
    );

    render(<ApiKeysSettingsPage />);
    fireEvent.change(screen.getByLabelText('Intex Agent model'), {
      target: { value: IntexAgentModels.MiniMaxM3 },
    });
    fireEvent.click(screen.getByRole('button', { name: /Use default Intex Agent model/i }));

    expect(setIntexAgentModel).toHaveBeenNthCalledWith(1, IntexAgentModels.MiniMaxM3);
    expect(setIntexAgentModel).toHaveBeenNthCalledWith(2, null);
    expect(mockSetDefaultModel).not.toHaveBeenCalled();
    expect(mockSetFallbackModel).not.toHaveBeenCalled();
  });

  it('preserves the loading shell and displays only the safe selector error while available', () => {
    mockUseLlmKeys.mockReturnValue(createPageHookResult({ loading: true }));
    const { rerender } = render(<ApiKeysSettingsPage />);
    expect(screen.queryByRole('heading', { name: 'Intex Agent model' })).not.toBeInTheDocument();

    mockUseLlmKeys.mockReturnValue(
      createPageHookResult({
        error: 'legacy page error sentinel',
        intexAgentModel: createIntexAgentModel({ intexAgentModelError: 'Failed to save Intex Agent model' }),
      })
    );
    rerender(<ApiKeysSettingsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save Intex Agent model');
    expect(screen.getByText('legacy page error sentinel')).toBeInTheDocument();
  });

  it('keeps select then reset in usable order at a narrow wrapper and never focuses a removed selector', async () => {
    const deferred = createDeferred<'applied'>();
    const focus = vi.spyOn(HTMLSelectElement.prototype, 'focus');
    const available = createIntexAgentModel({
      explicitModel: IntexAgentModels.MiniMaxM3,
      effectiveModel: IntexAgentModels.MiniMaxM3,
      setIntexAgentModel: vi.fn().mockReturnValue(deferred.promise),
    });
    mockUseLlmKeys.mockReturnValue(createPageHookResult({ intexAgentModel: available }));
    const { rerender } = render(<div className="w-[320px]"><ApiKeysSettingsPage /></div>);
    const select = screen.getByLabelText('Intex Agent model');
    const reset = screen.getByRole('button', { name: /Use default Intex Agent model/i });
    expect(select.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(select.className).not.toMatch(/(?:^|\s)w-(?:\d+|\[\d+px\])(?:\s|$)/);

    fireEvent.change(select, { target: { value: IntexAgentModels.Gemini3FlashPreview } });
    mockUseLlmKeys.mockReturnValue(createPageHookResult());
    rerender(<div className="w-[320px]"><ApiKeysSettingsPage /></div>);
    deferred.resolve('applied');
    await waitFor(() => {
      expect(focus).not.toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('Intex Agent model')).not.toBeInTheDocument();
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });
});
