/**
 * Tests for processResearch usecase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  processResearch,
  type ProcessResearchDeps,
} from '../../../../domain/research/usecases/processResearch.js';
import type { Research, LlmProvider } from '../../../../domain/research/models/index.js';

function createMockDeps(): ProcessResearchDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateLlmResult: ReturnType<typeof vi.fn>;
  };
  mockProviders: Record<LlmProvider, { research: ReturnType<typeof vi.fn> }>;
  mockSynthesizer: {
    synthesize: ReturnType<typeof vi.fn>;
    generateTitle: ReturnType<typeof vi.fn>;
  };
  mockNotifier: { sendResearchComplete: ReturnType<typeof vi.fn> };
  mockReportSuccess: ReturnType<typeof vi.fn>;
} {
  const mockRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    update: vi.fn().mockResolvedValue(ok(undefined)),
    updateLlmResult: vi.fn().mockResolvedValue(ok(undefined)),
    findByUserId: vi.fn(),
    delete: vi.fn(),
  };

  const mockProviders = {
    google: { research: vi.fn() },
    openai: { research: vi.fn() },
    anthropic: { research: vi.fn() },
  };

  const mockSynthesizer = {
    synthesize: vi.fn(),
    generateTitle: vi.fn(),
  };

  const mockNotifier = {
    sendResearchComplete: vi.fn().mockResolvedValue(undefined),
  };

  const mockReportSuccess = vi.fn();

  return {
    researchRepo: mockRepo,
    llmProviders: mockProviders,
    synthesizer: mockSynthesizer,
    notificationSender: mockNotifier,
    reportLlmSuccess: mockReportSuccess,
    mockRepo,
    mockProviders,
    mockSynthesizer,
    mockNotifier,
    mockReportSuccess,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    prompt: 'Test research prompt',
    status: 'pending',
    selectedLlms: ['google', 'openai'],
    synthesisLlm: 'google',
    llmResults: [
      { provider: 'google', status: 'pending' },
      { provider: 'openai', status: 'pending' },
    ],
    startedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('processResearch', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early if research not found', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    await processResearch('nonexistent', deps);

    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });

  it('returns early on repository error', async () => {
    deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).not.toHaveBeenCalled();
  });

  it('updates status to processing', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(ok('Generated Title'));
    deps.mockProviders.google.research.mockResolvedValue(
      ok({ content: 'Google result', sources: [] })
    );
    deps.mockProviders.openai.research.mockResolvedValue(
      ok({ content: 'OpenAI result', sources: [] })
    );
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized result'));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', { status: 'processing' });
  });

  it('generates title and updates research', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(ok('Generated Title'));
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized'));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', { title: 'Generated Title' });
  });

  it('uses dedicated titleGenerator when provided', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const mockTitleGenerator = { generateTitle: vi.fn().mockResolvedValue(ok('Gemini Title')) };
    deps.titleGenerator = mockTitleGenerator;

    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized'));

    await processResearch('research-1', deps);

    expect(mockTitleGenerator.generateTitle).toHaveBeenCalledWith('Test research prompt');
    expect(deps.mockReportSuccess).toHaveBeenCalledWith('google');
  });

  it('runs LLM calls for all selected providers', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(
      ok({ content: 'Google result', sources: ['https://google.com'] })
    );
    deps.mockProviders.openai.research.mockResolvedValue(
      ok({ content: 'OpenAI result', sources: [] })
    );
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized result'));

    await processResearch('research-1', deps);

    expect(deps.mockProviders.google.research).toHaveBeenCalledWith('Test research prompt');
    expect(deps.mockProviders.openai.research).toHaveBeenCalledWith('Test research prompt');
    expect(deps.mockProviders.anthropic.research).not.toHaveBeenCalled();
  });

  it('updates LLM result to processing before calling', async () => {
    const research = createTestResearch({ selectedLlms: ['google'] });
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized'));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith(
      'research-1',
      'google',
      expect.objectContaining({ status: 'processing' })
    );
  });

  it('updates LLM result to completed on success', async () => {
    const research = createTestResearch({ selectedLlms: ['google'] });
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(
      ok({ content: 'Result content', sources: ['https://src.com'] })
    );
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized'));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith(
      'research-1',
      'google',
      expect.objectContaining({
        status: 'completed',
        result: 'Result content',
        sources: ['https://src.com'],
      })
    );
  });

  it('updates LLM result to failed on error', async () => {
    const research = createTestResearch({ selectedLlms: ['google'] });
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(
      err({ code: 'RATE_LIMITED', message: 'Too many requests' })
    );
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized'));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.updateLlmResult).toHaveBeenCalledWith(
      'research-1',
      'google',
      expect.objectContaining({
        status: 'failed',
        error: 'Too many requests',
      })
    );
  });

  it('reports LLM success for each successful provider', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesized'));

    await processResearch('research-1', deps);

    expect(deps.mockReportSuccess).toHaveBeenCalledWith('google');
    expect(deps.mockReportSuccess).toHaveBeenCalledWith('openai');
  });

  it('synthesizes successful results', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(
      ok({ content: 'Google content', sources: [] })
    );
    deps.mockProviders.openai.research.mockResolvedValue(
      ok({ content: 'OpenAI content', sources: [] })
    );
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Final synthesis'));

    await processResearch('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      expect.arrayContaining([
        expect.objectContaining({ model: 'Gemini 2.0 Flash', content: 'Google content' }),
        expect.objectContaining({ model: 'GPT-4.1', content: 'OpenAI content' }),
      ]),
      undefined
    );
  });

  it('includes external reports in synthesis', async () => {
    const research = createTestResearch({
      externalReports: [
        { content: 'External report 1', model: 'Custom Model' },
        { content: 'External report 2' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesis'));

    await processResearch('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      [{ content: 'External report 1', model: 'Custom Model' }, { content: 'External report 2' }]
    );
  });

  it('updates status to completed on successful synthesis', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Final synthesis'));

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith(
      'research-1',
      expect.objectContaining({
        status: 'completed',
        synthesizedResult: 'Final synthesis',
      })
    );
  });

  it('updates status to failed on synthesis error', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Synthesis failed' })
    );

    await processResearch('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith(
      'research-1',
      expect.objectContaining({
        status: 'failed',
        synthesisError: 'Synthesis failed',
      })
    );
  });

  it('updates status to failed when all LLM calls fail', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Google failed' })
    );
    deps.mockProviders.openai.research.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'OpenAI failed' })
    );

    await processResearch('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
    expect(deps.mockRepo.update).toHaveBeenCalledWith(
      'research-1',
      expect.objectContaining({
        status: 'failed',
        synthesisError: 'All LLM calls failed',
      })
    );
  });

  it('sends notification on completion', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById
      .mockResolvedValueOnce(ok(research))
      .mockResolvedValueOnce(ok({ ...research, title: 'Final Title', status: 'completed' }));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(ok('Final Title'));
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesis'));

    await processResearch('research-1', deps);

    expect(deps.mockNotifier.sendResearchComplete).toHaveBeenCalledWith(
      'user-1',
      'research-1',
      'Final Title'
    );
  });

  it('reports synthesis provider success on completion', async () => {
    const research = createTestResearch({ synthesisLlm: 'anthropic' });
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.generateTitle.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Failed' })
    );
    deps.mockProviders.google.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockProviders.openai.research.mockResolvedValue(ok({ content: 'Result', sources: [] }));
    deps.mockSynthesizer.synthesize.mockResolvedValue(ok('Synthesis'));

    await processResearch('research-1', deps);

    expect(deps.mockReportSuccess).toHaveBeenCalledWith('anthropic');
  });
});
