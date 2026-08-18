/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterModelInfo, Research } from '@/services/researchAgentApi.types';
import { EnhanceModal } from '../EnhanceModal.js';

const activeSynthesis = 'or:openai/gpt-5.4';
const retiredSynthesis = 'or:google/gemini-3-flash-preview';

function catalogModel(id: string, name: string): OpenRouterModelInfo {
  return {
    id,
    name,
    provider: id.split('/')[0] ?? id,
    contextLength: 100_000,
    pricing: { inputPricePerMillion: 1, outputPricePerMillion: 2 },
    inputModalities: ['text'],
    outputModalities: ['text'],
  };
}

function research(synthesisModel: string): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Research',
    prompt: 'A sufficiently long prompt',
    selectedModels: [activeSynthesis],
    synthesisModel,
    status: 'completed',
    llmResults: [
      {
        provider: 'openrouter',
        model: activeSynthesis,
        status: 'completed',
        result: 'Done',
      },
    ],
    startedAt: '2026-08-17T10:00:00.000Z',
  };
}

function renderModal(overrides: {
  research?: Research;
  hasOpenRouterAccess?: boolean;
  onEnhance?: ReturnType<typeof vi.fn>;
} = {}): ReturnType<typeof vi.fn> {
  const onEnhance = overrides.onEnhance ?? vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <EnhanceModal
        research={overrides.research ?? research(activeSynthesis)}
        openRouterModels={[catalogModel('openai/gpt-5.4', 'GPT-5.4')]}
        openRouterLoading={false}
        openRouterError={null}
        hasOpenRouterAccess={overrides.hasOpenRouterAccess ?? true}
        onRetryModelCatalog={vi.fn()}
        onEnhance={onEnhance}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
  return onEnhance;
}

afterEach(cleanup);

describe('EnhanceModal execution guards', () => {
  it('blocks a context-only enhancement when OpenRouter access is unavailable', () => {
    renderModal({ hasOpenRouterAccess: false });

    fireEvent.click(screen.getByRole('button', { name: '+ Add context' }));
    fireEvent.change(screen.getByPlaceholderText('Paste additional reference content...'), {
      target: { value: 'Additional context' },
    });

    expect(screen.getByRole('button', { name: 'Enhance' })).toBeDisabled();
    expect(screen.getByText(/OpenRouter access is unavailable/i)).toBeInTheDocument();
  });

  it('requires an active synthesis selection when the inherited synthesis model is retired', async () => {
    const onEnhance = renderModal({ research: research(retiredSynthesis) });

    fireEvent.click(screen.getByRole('button', { name: '+ Add context' }));
    fireEvent.change(screen.getByPlaceholderText('Paste additional reference content...'), {
      target: { value: 'Additional context' },
    });
    expect(screen.getByRole('button', { name: 'Enhance' })).toBeDisabled();
    expect(screen.getByText(/select an active synthesis model/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'GPT-5.4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enhance' }));

    await waitFor(() => {
      expect(onEnhance).toHaveBeenCalledWith({
        additionalContexts: [{ content: 'Additional context' }],
        synthesisModel: activeSynthesis,
      });
    });
  });
});
