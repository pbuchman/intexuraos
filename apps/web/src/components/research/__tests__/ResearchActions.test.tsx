/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cleanup } from '@testing-library/react';
import { ResearchActions } from '../ResearchActions.js';
import type { Research } from '@/services/researchAgentApi.types';

vi.mock('@/components', () => ({
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
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <section>{children}</section>
  ),
  ErrorBanner: ({ message }: { message: string | null }): React.JSX.Element | null =>
    message === null ? null : <div>{message}</div>,
}));

const ACTIVE_MODEL = 'or:openai/gpt-5.4';
const RETIRED_MODEL = 'or:google/gemini-3-flash-preview';

function createResearch(overrides: Partial<Research>): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Research',
    prompt: 'A sufficiently long prompt',
    selectedModels: [ACTIVE_MODEL],
    synthesisModel: ACTIVE_MODEL,
    status: 'draft',
    llmResults: [],
    ...overrides,
  };
}

function createProps(
  research: Research,
  overrides: Partial<ComponentProps<typeof ResearchActions>> = {},
): ComponentProps<typeof ResearchActions> {
  const idle = { loading: false, error: null };
  return {
    research,
    availableModelIds: ['openai/gpt-5.4'],
    modelCatalogState: 'ready',
    onRetryModelCatalog: vi.fn(),
    approve: { ...idle, onApprove: vi.fn() },
    retry: { ...idle, onRetry: vi.fn() },
    deleteAction: {
      ...idle,
      showConfirm: false,
      onShowConfirm: vi.fn(),
      onConfirm: vi.fn(),
    },
    unshare: {
      ...idle,
      showConfirm: false,
      onShowConfirm: vi.fn(),
      onConfirm: vi.fn(),
    },
    exportToNotion: { ...idle, success: null, onExport: vi.fn() },
    onShowEnhanceModal: vi.fn(),
    onShare: vi.fn(),
    onEditDraft: vi.fn(),
    partialFailure: { ...idle, onConfirm: vi.fn() },
    ...overrides,
  };
}

afterEach(cleanup);

describe('ResearchActions model availability', () => {
  it('blocks approving a draft that contains a retired model before execution', () => {
    render(
      <ResearchActions
        {...createProps(
          createResearch({
            selectedModels: [RETIRED_MODEL],
          }),
        )}
      />,
    );

    expect(screen.getByRole('button', { name: /Start Research/ })).toBeDisabled();
    expect(screen.getByText(/Start unavailable.*Gemini 3 Flash Preview/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit Draft/ })).toBeEnabled();
  });

  it('blocks retry when any failed historical model is unavailable', () => {
    render(
      <ResearchActions
        {...createProps(
          createResearch({
            status: 'failed',
            selectedModels: [RETIRED_MODEL],
            llmResults: [
              {
                provider: 'openrouter',
                model: RETIRED_MODEL,
                status: 'failed',
                error: 'Retired',
              },
            ],
          }),
        )}
      />,
    );

    expect(screen.getByRole('button', { name: /Retry Research/ })).toBeDisabled();
    expect(screen.getByText(/Retry unavailable.*Gemini 3 Flash Preview/i)).toBeInTheDocument();
  });

  it('allows proceed but not retry when synthesis is active and the failed model retired', () => {
    render(
      <ResearchActions
        {...createProps(
          createResearch({
            status: 'awaiting_confirmation',
            selectedModels: [ACTIVE_MODEL, RETIRED_MODEL],
            partialFailure: {
              failedModels: [RETIRED_MODEL],
              successfulModels: [ACTIVE_MODEL],
              retryCount: 0,
            },
          }),
        )}
      />,
    );

    expect(screen.getByRole('button', { name: /Proceed with Available/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Retry Failed/ })).not.toBeInTheDocument();
  });

  it('shows a retryable catalog error instead of calling an active model retired', () => {
    const onRetryModelCatalog = vi.fn();
    render(
      <ResearchActions
        {...createProps(
          createResearch({
            status: 'failed',
            llmResults: [
              {
                provider: 'openrouter',
                model: ACTIVE_MODEL,
                status: 'failed',
                error: 'Temporary failure',
              },
            ],
          }),
          {
            availableModelIds: [],
            modelCatalogState: 'error',
            onRetryModelCatalog,
          },
        )}
      />,
    );

    expect(screen.getByRole('button', { name: /Retry Research/ })).toBeDisabled();
    expect(screen.getByText(/OpenRouter model catalog could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/historical models are no longer supported/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry model catalog/i }));
    expect(onRetryModelCatalog).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable access without labelling active models as retired', () => {
    render(
      <ResearchActions
        {...createProps(
          createResearch({
            status: 'failed',
            llmResults: [
              {
                provider: 'openrouter',
                model: ACTIVE_MODEL,
                status: 'failed',
                error: 'No access',
              },
            ],
          }),
          {
            availableModelIds: [],
            modelCatalogState: 'access_unavailable',
          },
        )}
      />,
    );

    expect(screen.getByText(/OpenRouter access is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/historical models are no longer supported/i)).not.toBeInTheDocument();
  });
});
