/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { describe, expect, it, vi } from 'vitest';
import { ResearchDetailPage } from '../ResearchDetailPage.js';
import type { Research } from '@/services/researchAgentApi.types';
import type { ResearchDetailActions } from '@/hooks/useResearchDetailActions';

const research: Research = {
  id: 'research-1',
  userId: 'user-1',
  title: 'Cost visibility',
  prompt: 'Compare image costs',
  selectedModels: [LlmModels.GPT54],
  synthesisModel: LlmModels.GPT54,
  status: 'completed',
  llmResults: [
    {
      provider: LlmProviders.OpenAI,
      model: LlmModels.GPT54,
      status: 'completed',
      result: 'Done',
    },
  ],
  synthesizedResult: 'Summary',
  startedAt: '2026-05-05T10:00:00Z',
  totalCostUsd: 0.1234,
};

const actions: ResearchDetailActions = {
  copiedSection: null,
  copyToClipboard: vi.fn(),
  approve: { loading: false, error: null, onApprove: vi.fn() },
  retry: { loading: false, error: null, onRetry: vi.fn() },
  deleteAction: {
    loading: false,
    error: null,
    showConfirm: false,
    onShowConfirm: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  },
  unshare: {
    loading: false,
    error: null,
    showConfirm: false,
    onShowConfirm: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  },
  exportToNotion: { loading: false, error: null, successUrl: null, onExport: vi.fn(), onDismissSuccess: vi.fn() },
  shareToast: null,
  onShare: vi.fn(),
  togglingFavourite: false,
  favouriteError: null,
  onToggleFavourite: vi.fn(),
  showEnhanceModal: false,
  onShowEnhanceModal: vi.fn(),
  onCloseEnhanceModal: vi.fn(),
  handleEnhance: vi.fn(),
  partialFailure: { loading: false, error: null, onConfirm: vi.fn() },
  configuredProviders: [],
  failedProviders: new Map(),
  openRouterModels: [],
  openRouterLoading: false,
};

vi.mock('@/components', () => ({
  Card: ({ title, children }: { title?: string; children: React.ReactNode }): React.JSX.Element => (
    <section>
      {title !== undefined ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
  MarkdownContent: ({ content }: { content: string }): React.JSX.Element => <div>{content}</div>,
  PROVIDER_MODELS: [
    {
      id: LlmProviders.OpenAI,
      displayName: 'OpenAI',
      models: [{ id: LlmModels.GPT54, name: 'GPT 5.4' }],
    },
  ],
}));

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return {
    ...actual,
    useResearch: (): { research: Research; loading: boolean; error: null; refresh: () => Promise<void> } => ({
      research,
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
    useResearchDetailActions: (): ResearchDetailActions => actions,
  };
});

vi.mock('@/components/research/ResearchHeader.js', () => ({
  ResearchHeader: (): React.JSX.Element => <div>Research header</div>,
}));

vi.mock('@/components/research/ResearchActions.js', () => ({
  ResearchActions: (): React.JSX.Element => <div>Research actions</div>,
}));

describe('ResearchDetailPage', () => {
  it('renders nonzero total cost returned by the research API', () => {
    render(
      <MemoryRouter initialEntries={['/research/research-1']}>
        <Routes>
          <Route path="/research/:id" element={<ResearchDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
  });
});
