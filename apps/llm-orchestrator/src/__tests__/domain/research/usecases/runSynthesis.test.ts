/**
 * Tests for runSynthesis use case.
 * Verifies synthesis of LLM results into final research output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err, type SynthesisContext } from '@intexuraos/common-core';
import {
  runSynthesis,
  type RunSynthesisDeps,
} from '../../../../domain/research/usecases/runSynthesis.js';
import type { Research } from '../../../../domain/research/models/index.js';
import type { ShareStoragePort } from '../../../../domain/research/ports/index.js';

function createMockDeps(): RunSynthesisDeps & {
  mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  mockSynthesizer: {
    synthesize: ReturnType<typeof vi.fn>;
    generateTitle: ReturnType<typeof vi.fn>;
  };
  mockNotificationSender: {
    sendResearchComplete: ReturnType<typeof vi.fn>;
    sendLlmFailure: ReturnType<typeof vi.fn>;
  };
  mockReportSuccess: ReturnType<typeof vi.fn>;
} {
  const mockRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    update: vi.fn().mockResolvedValue(ok(undefined)),
    updateLlmResult: vi.fn().mockResolvedValue(ok(undefined)),
    findByUserId: vi.fn(),
    clearShareInfo: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn(),
  };

  const mockSynthesizer = {
    synthesize: vi.fn().mockResolvedValue(ok('Synthesized result')),
    generateTitle: vi.fn().mockResolvedValue(ok('Generated Title')),
  };

  const mockNotificationSender = {
    sendResearchComplete: vi.fn().mockResolvedValue(ok(undefined)),
    sendLlmFailure: vi.fn().mockResolvedValue(ok(undefined)),
  };

  const mockReportSuccess = vi.fn();

  return {
    researchRepo: mockRepo,
    synthesizer: mockSynthesizer,
    notificationSender: mockNotificationSender,
    shareStorage: null,
    shareConfig: null,
    imageServiceClient: null,
    userId: 'user-1',
    webAppUrl: 'https://app.example.com',
    reportLlmSuccess: mockReportSuccess,
    mockRepo,
    mockSynthesizer,
    mockNotificationSender,
    mockReportSuccess,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test research prompt',
    status: 'processing',
    selectedModels: ['gemini-2.5-pro', 'o4-mini-deep-research'],
    synthesisModel: 'gemini-2.5-pro',
    llmResults: [
      {
        provider: 'google',
        model: 'gemini-2.0-flash',
        status: 'completed',
        result: 'Google Result',
      },
      {
        provider: 'openai',
        model: 'o4-mini-deep-research',
        status: 'completed',
        result: 'OpenAI Result',
      },
    ],
    startedAt: '2024-01-01T10:00:00Z',
    ...overrides,
  };
}

describe('runSynthesis', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns error when research not found', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    const result = await runSynthesis('nonexistent', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
    expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
  });

  it('returns error on repository error', async () => {
    deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Error' }));

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
  });

  it('updates status to synthesizing before synthesis', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'synthesizing',
    });
  });

  it('returns error when no successful LLM results', async () => {
    const research = createTestResearch({
      llmResults: [
        { provider: 'google', model: 'gemini-2.0-flash', status: 'failed', error: 'Error' },
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'failed', error: 'Error' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'No successful LLM results' });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'failed',
      synthesisError: 'No successful LLM results to synthesize',
      completedAt: '2024-01-01T12:00:00.000Z',
    });
  });

  it('synthesizes successful results only', async () => {
    const research = createTestResearch({
      llmResults: [
        {
          provider: 'google',
          model: 'gemini-2.0-flash',
          status: 'completed',
          result: 'Google Result',
        },
        {
          provider: 'anthropic',
          model: 'claude-3',
          status: 'completed',
          result: 'Claude Result',
        },
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'failed', error: 'Error' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      [
        { model: 'gemini-2.0-flash', content: 'Google Result' },
        { model: 'claude-3', content: 'Claude Result' },
      ],
      undefined,
      undefined
    );
  });

  it('includes input contexts in synthesis', async () => {
    const research = createTestResearch({
      inputContexts: [
        {
          id: 'ctx-1',
          content: 'Input context 1',
          label: 'external-model',
          addedAt: '2024-01-01T10:00:00Z',
        },
        { id: 'ctx-2', content: 'Input context 2', addedAt: '2024-01-01T10:00:00Z' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      expect.any(Array),
      [{ content: 'Input context 1', label: 'external-model' }, { content: 'Input context 2' }],
      undefined
    );
  });

  it('handles synthesis failure', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockSynthesizer.synthesize.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'Synthesis failed' })
    );

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: false, error: 'Synthesis failed' });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'failed',
      synthesisError: 'Synthesis failed',
      completedAt: '2024-01-01T12:00:00.000Z',
    });
  });

  it('completes research successfully', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await runSynthesis('research-1', deps);

    expect(result).toEqual({ ok: true });
    expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
      status: 'completed',
      synthesizedResult: 'Synthesized result',
      completedAt: '2024-01-01T12:00:00.000Z',
      totalDurationMs: 7200000,
      shareInfo: undefined,
    });
  });

  it('sends notification on completion', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockNotificationSender.sendResearchComplete).toHaveBeenCalledWith(
      'user-1',
      'research-1',
      'Test Research',
      'https://app.example.com/#/research/research-1'
    );
  });

  it('reports LLM success when callback provided', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockReportSuccess).toHaveBeenCalled();
  });

  it('works without reportLlmSuccess callback', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const minimalDeps: RunSynthesisDeps = {
      researchRepo: deps.researchRepo,
      synthesizer: deps.synthesizer,
      notificationSender: deps.notificationSender,
      shareStorage: null,
      shareConfig: null,
      imageServiceClient: null,
      userId: 'user-1',
      webAppUrl: 'https://app.example.com',
    };

    const result = await runSynthesis('research-1', minimalDeps);

    expect(result).toEqual({ ok: true });
  });

  it('handles empty result string from LLM', async () => {
    const research = createTestResearch({
      llmResults: [
        { provider: 'google', model: 'gemini-2.0-flash', status: 'completed' },
        { provider: 'openai', model: 'gpt-4', status: 'completed', result: 'OpenAI Result' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      [
        { model: 'gemini-2.0-flash', content: '' },
        { model: 'gpt-4', content: 'OpenAI Result' },
      ],
      undefined,
      undefined
    );
  });

  describe('skip synthesis logic', () => {
    it('skips synthesis when only 1 successful LLM and no input contexts', async () => {
      const research = createTestResearch({
        selectedModels: ['gemini-2.5-pro'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Single result',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
      expect(deps.mockRepo.update).toHaveBeenCalledWith('research-1', {
        status: 'completed',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
      });
    });

    it('skips synthesis when multiple LLMs selected but only 1 succeeds', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Only success',
          },
          { provider: 'openai', model: 'o4-mini-deep-research', status: 'failed', error: 'Failed' },
          { provider: 'anthropic', model: 'claude-opus', status: 'failed', error: 'Failed' },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).not.toHaveBeenCalled();
    });

    it('runs synthesis when 1 LLM succeeds with input contexts', async () => {
      const research = createTestResearch({
        selectedModels: ['gemini-2.5-pro'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Google result',
          },
        ],
        inputContexts: [
          { id: 'ctx-1', content: 'Context 1', addedAt: '2024-01-01T10:00:00Z' },
          { id: 'ctx-2', content: 'Context 2', addedAt: '2024-01-01T10:00:00Z' },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('runs synthesis when 2+ LLMs succeed without external reports', async () => {
      const research = createTestResearch({
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Google result',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'completed',
            result: 'OpenAI result',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('runs synthesis when no LLMs succeed but has input contexts', async () => {
      const research = createTestResearch({
        llmResults: [
          { provider: 'google', model: 'gemini-2.0-flash', status: 'failed', error: 'Failed' },
        ],
        inputContexts: [
          { id: 'ctx-1', content: 'Context 1', addedAt: '2024-01-01T10:00:00Z' },
          { id: 'ctx-2', content: 'Context 2', addedAt: '2024-01-01T10:00:00Z' },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const result = await runSynthesis('research-1', deps);

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalled();
    });

    it('sends notification with app URL when synthesis skipped', async () => {
      const research = createTestResearch({
        selectedModels: ['gemini-2.5-pro'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Single result',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await runSynthesis('research-1', deps);

      expect(deps.mockNotificationSender.sendResearchComplete).toHaveBeenCalledWith(
        'user-1',
        'research-1',
        'Test Research',
        'https://app.example.com/#/research/research-1'
      );
    });

    it('does not report LLM success when synthesis skipped', async () => {
      const research = createTestResearch({
        selectedModels: ['gemini-2.5-pro'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Single result',
          },
        ],
      });
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      await runSynthesis('research-1', deps);

      expect(deps.mockReportSuccess).not.toHaveBeenCalled();
    });
  });

  describe('synthesis context inference', () => {
    const mockSynthesisContext: SynthesisContext = {
      language: 'en',
      domain: 'travel',
      mode: 'standard',
      synthesis_goals: ['merge', 'summarize'],
      missing_sections: [],
      detected_conflicts: [],
      source_preference: {
        prefer_official_over_aggregators: true,
        prefer_recent_when_time_sensitive: true,
      },
      defaults_applied: [],
      assumptions: [],
      output_format: {
        wants_table: false,
        wants_actionable_summary: true,
      },
      safety: {
        high_stakes: false,
        required_disclaimers: [],
      },
      red_flags: [],
    };

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    it('infers synthesis context when contextInferrer is provided', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi.fn().mockResolvedValue(ok(mockSynthesisContext)),
      };

      await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(mockContextInferrer.inferSynthesisContext).toHaveBeenCalledWith({
        originalPrompt: 'Test research prompt',
        reports: [
          { model: 'gemini-2.0-flash', content: 'Google Result' },
          { model: 'o4-mini-deep-research', content: 'OpenAI Result' },
        ],
        additionalSources: undefined,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[4.2.2] Synthesis context inferred successfully'
      );
    });

    it('passes synthesis context to synthesizer', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi.fn().mockResolvedValue(ok(mockSynthesisContext)),
      };

      await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
        'Test research prompt',
        expect.any(Array),
        undefined,
        mockSynthesisContext
      );
    });

    it('logs error when synthesis context inference fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed to infer' })),
      };

      await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Object) }),
        '[4.2.2] Synthesis context inference failed, proceeding without context'
      );
    });

    it('proceeds without context when inference fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockContextInferrer = {
        inferResearchContext: vi.fn(),
        inferSynthesisContext: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed' })),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        contextInferrer: mockContextInferrer,
        logger: mockLogger,
      });

      expect(result).toEqual({ ok: true });
      expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
        'Test research prompt',
        expect.any(Array),
        undefined,
        undefined
      );
    });
  });

  describe('with share storage', () => {
    const shareConfig = {
      shareBaseUrl: 'https://example.com/share/research',
      staticAssetsUrl: 'https://static.example.com',
    };

    it('generates and uploads shareable HTML when share storage is configured', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockUpload = vi
        .fn()
        .mockResolvedValue(ok({ gcsPath: 'research/abc123-token-test-research.html' }));
      const mockShareStorage: ShareStoragePort = {
        upload: mockUpload,
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      expect(mockUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^research\/resear-[a-zA-Z0-9]+-test-research\.html$/),
        expect.stringContaining('<!DOCTYPE html>')
      );
    });

    it('includes shareInfo when upload succeeds', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi
          .fn()
          .mockResolvedValue(ok({ gcsPath: 'research/abc123-token-test-research.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: 'Synthesized result',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        shareInfo: expect.objectContaining({
          shareToken: expect.any(String),
          slug: 'test-research',
          shareUrl: expect.stringContaining('https://example.com/share/research/'),
          sharedAt: '2024-01-01T12:00:00.000Z',
          gcsPath: 'research/abc123-token-test-research.html',
        }),
      });
    });

    it('sends notification with share URL when share storage is configured', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi
          .fn()
          .mockResolvedValue(ok({ gcsPath: 'research/abc123-token-test-research.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(deps.mockNotificationSender.sendResearchComplete).toHaveBeenCalledWith(
        'user-1',
        'research-1',
        'Test Research',
        expect.stringContaining('https://example.com/share/research/')
      );
    });

    it('continues without shareInfo when upload fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi
          .fn()
          .mockResolvedValue(err({ code: 'STORAGE_ERROR' as const, message: 'Upload failed' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
      });

      expect(result).toEqual({ ok: true });
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: 'Synthesized result',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
      });
    });

    it('includes cover image in shareInfo when image generation succeeds', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi.fn().mockResolvedValue(ok({ prompt: 'generated prompt' })),
        generateImage: vi.fn().mockResolvedValue(
          ok({
            id: 'img-123',
            thumbnailUrl: 'https://storage.example.com/thumb.jpg',
            fullSizeUrl: 'https://storage.example.com/full.png',
          })
        ),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
      });

      expect(result).toEqual({ ok: true });
      expect(mockImageServiceClient.generatePrompt).toHaveBeenCalledWith(
        'Synthesized result',
        'gemini-2.5-pro',
        'user-1'
      );
      expect(mockImageServiceClient.generateImage).toHaveBeenCalledWith(
        'generated prompt',
        'gpt-image-1',
        'user-1'
      );
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: 'Synthesized result',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        shareInfo: expect.objectContaining({
          coverImageId: 'img-123',
        }),
      });
    });

    it('continues without cover image when prompt generation fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Failed' })),
        generateImage: vi.fn(),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
      });

      expect(result).toEqual({ ok: true });
      expect(mockImageServiceClient.generateImage).not.toHaveBeenCalled();
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: 'Synthesized result',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        shareInfo: expect.not.objectContaining({
          coverImageId: expect.anything(),
        }),
      });
    });

    it('continues without cover image when image generation fails', async () => {
      const research = createTestResearch();
      deps.mockRepo.findById.mockResolvedValue(ok(research));

      const mockShareStorage: ShareStoragePort = {
        upload: vi.fn().mockResolvedValue(ok({ gcsPath: 'research/abc123-share.html' })),
        delete: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const mockImageServiceClient = {
        generatePrompt: vi.fn().mockResolvedValue(ok({ prompt: 'generated prompt' })),
        generateImage: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Failed' })),
        deleteImage: vi.fn(),
      };

      const result = await runSynthesis('research-1', {
        ...deps,
        shareStorage: mockShareStorage,
        shareConfig,
        imageServiceClient: mockImageServiceClient,
      });

      expect(result).toEqual({ ok: true });
      expect(deps.mockRepo.update).toHaveBeenLastCalledWith('research-1', {
        status: 'completed',
        synthesizedResult: 'Synthesized result',
        completedAt: '2024-01-01T12:00:00.000Z',
        totalDurationMs: 7200000,
        shareInfo: expect.not.objectContaining({
          coverImageId: expect.anything(),
        }),
      });
    });
  });
});
