/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
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
  PROVIDER_MODELS: [
    {
      id: LlmProviders.OpenAI,
      displayName: 'OpenAI',
      models: [{ id: LlmModels.GPT54, name: 'GPT 5.4' }],
    },
  ],
}));

const baseResearch: Research = {
  id: 'research-1',
  userId: 'user-1',
  title: 'Cost visibility',
  prompt: 'Compare image models',
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
});
