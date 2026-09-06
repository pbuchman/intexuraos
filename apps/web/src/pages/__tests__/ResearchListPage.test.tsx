/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResearchSummary } from '@/services/researchAgentApi.types';

const unknownModel = 'legacy-provider/model-that-no-longer-exists';

const summary: ResearchSummary = {
  id: 'research-1',
  userId: 'user-1',
  title: 'Historical research',
  status: 'completed',
  selectedModels: [unknownModel],
  synthesisModel: unknownModel,
  startedAt: '2026-08-17T10:00:00.000Z',
  llmResultStatuses: [
    {
      provider: 'stored-legacy-provider',
      model: unknownModel,
      status: 'completed',
    },
  ],
};

vi.mock('@/hooks', () => ({
  useResearches: (): {
    researches: ResearchSummary[];
    loading: false;
    loadingMore: false;
    error: null;
    hasMore: false;
    loadMore: ReturnType<typeof vi.fn>;
    deleteResearch: ReturnType<typeof vi.fn>;
    updateResearchLocally: ReturnType<typeof vi.fn>;
  } => ({
    researches: [summary],
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    deleteResearch: vi.fn(),
    updateResearchLocally: vi.fn(),
  }),
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
  useOpenRouterModels: (): {
    models: [];
    loading: false;
    error: null;
    refresh: ReturnType<typeof vi.fn>;
  } => ({
    models: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: ReturnType<typeof vi.fn> } => ({
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }),
}));

vi.mock('@/components', () => ({
  Button: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <button>{children}</button>
  ),
  ErrorBanner: (): null => null,
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <main>{children}</main>
  ),
}));

import { ResearchListPage } from '../ResearchListPage.js';

afterEach(cleanup);

describe('ResearchListPage model history', () => {
  it('shows exact stored identity and provider for an unknown unavailable model', () => {
    render(
      <MemoryRouter>
        <ResearchListPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Model That No Longer Exists').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(`stored-legacy-provider · ${unknownModel}`).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  });
});
