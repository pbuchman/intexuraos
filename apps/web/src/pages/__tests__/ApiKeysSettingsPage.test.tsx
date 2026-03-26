/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LlmKeysResponse, LlmTestResult } from '@/services/llmKeysApi.types';

const {
  mockUseLlmKeys,
  mockSetKey,
  mockDeleteKey,
  mockTestKey,
  mockSetDefaultModel,
  mockRefresh,
} = vi.hoisted(() => ({
  mockUseLlmKeys: vi.fn(),
  mockSetKey: vi.fn(),
  mockDeleteKey: vi.fn(),
  mockTestKey: vi.fn(),
  mockSetDefaultModel: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useLlmKeys: (): ReturnType<typeof mockUseLlmKeys> => mockUseLlmKeys(),
}));

vi.mock('@/components', async () => {
  const { Input } = await vi.importActual<typeof import('@/components/ui/Input')>(
    '@/components/ui/Input'
  );
  return {
    Input,
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
    mockRefresh.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('uses provider-specific API key field semantics and auto-tests after save', async () => {
    mockUseLlmKeys.mockReturnValue({
      keys: createKeysResponse(),
      defaultModel: null,
      loading: false,
      refreshing: false,
      error: null,
      savingDefaultModel: false,
      setKey: mockSetKey,
      deleteKey: mockDeleteKey,
      testKey: mockTestKey,
      setDefaultModel: mockSetDefaultModel,
      refresh: mockRefresh,
    });

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
    mockUseLlmKeys.mockReturnValue({
      keys: createKeysResponse(),
      defaultModel: null,
      loading: false,
      refreshing: false,
      error: null,
      savingDefaultModel: false,
      setKey: mockSetKey,
      deleteKey: mockDeleteKey,
      testKey: mockTestKey,
      setDefaultModel: mockSetDefaultModel,
      refresh: mockRefresh,
    });

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
    mockUseLlmKeys.mockReturnValue({
      keys: createKeysResponse({
        openrouter: 'sk-or-...7890',
      }),
      defaultModel: null,
      loading: false,
      refreshing: false,
      error: null,
      savingDefaultModel: false,
      setKey: mockSetKey,
      deleteKey: mockDeleteKey,
      testKey: mockTestKey,
      setDefaultModel: mockSetDefaultModel,
      refresh: mockRefresh,
    });

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
});
