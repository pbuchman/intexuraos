/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { createOpenRouterModelId, LlmProviders } from '@intexuraos/llm-contract';
import { describe, expect, it, vi } from 'vitest';
import { ResearchResults } from '../ResearchResults.js';
import type { Research } from '@/services/researchAgentApi.types';

vi.mock('@/components', () => ({
  Card: ({ title, children }: { title?: string; children: React.ReactNode }): React.JSX.Element => (
    <section>
      {title !== undefined ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
  MarkdownContent: ({ content }: { content: string }): React.JSX.Element => <div>{content}</div>,
}));

const ACTIVE_MODEL = createOpenRouterModelId('openai/gpt-5.4');

const baseResearch: Research = {
  id: 'research-1',
  userId: 'user-1',
  title: 'Cost visibility',
  prompt: 'Compare image models',
  selectedModels: [ACTIVE_MODEL],
  synthesisModel: ACTIVE_MODEL,
  status: 'completed',
  llmResults: [
    {
      provider: LlmProviders.OpenRouter,
      model: ACTIVE_MODEL,
      status: 'completed',
      result: 'Done',
    },
  ],
  synthesizedResult: 'Summary',
  startedAt: '2026-05-05T10:00:00Z',
  totalCostUsd: 0.1234,
};

describe('ResearchResults', () => {
  it('renders nonzero total cost returned by the API', () => {
    render(
      <ResearchResults
        research={baseResearch}
        copiedSection={null}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
  });

  it('renders multiple OpenRouter results by model ID and marks retired history unavailable', () => {
    const retiredModel = createOpenRouterModelId('google/gemini-3-flash-preview');
    render(
      <ResearchResults
        research={{
          ...baseResearch,
          selectedModels: [ACTIVE_MODEL, retiredModel],
          llmResults: [
            ...baseResearch.llmResults,
            {
              provider: LlmProviders.OpenRouter,
              model: retiredModel,
              status: 'failed',
              error: 'Retired',
            },
          ],
        }}
        copiedSection={null}
        onCopy={vi.fn()}
        availableModelIds={['openai/gpt-5.4']}
        availabilityKnown
      />,
    );

    expect(screen.getByText('GPT-5.4')).toBeInTheDocument();
    expect(screen.getByText('Gemini 3 Flash Preview')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/or:google\/gemini-3-flash-preview/)).toBeInTheDocument();
  });
});
