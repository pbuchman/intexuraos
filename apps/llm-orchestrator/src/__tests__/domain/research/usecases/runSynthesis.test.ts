/**
 * Tests for runSynthesis use case.
 * Verifies synthesis of LLM results into final research output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
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
    selectedLlms: ['google', 'openai'],
    synthesisLlm: 'google',
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
        { provider: 'openai', model: 'o4-mini-deep-research', status: 'failed', error: 'Error' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      [{ model: 'gemini-2.0-flash', content: 'Google Result' }],
      undefined
    );
  });

  it('includes external reports in synthesis', async () => {
    const research = createTestResearch({
      externalReports: [
        {
          id: 'ext-1',
          content: 'External report 1',
          model: 'external-model',
          addedAt: '2024-01-01T10:00:00Z',
        },
        { id: 'ext-2', content: 'External report 2', addedAt: '2024-01-01T10:00:00Z' },
      ],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      expect.any(Array),
      [{ content: 'External report 1', model: 'external-model' }, { content: 'External report 2' }]
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
      webAppUrl: 'https://app.example.com',
    };

    const result = await runSynthesis('research-1', minimalDeps);

    expect(result).toEqual({ ok: true });
  });

  it('handles empty result string from LLM', async () => {
    const research = createTestResearch({
      llmResults: [{ provider: 'google', model: 'gemini-2.0-flash', status: 'completed' }],
    });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    await runSynthesis('research-1', deps);

    expect(deps.mockSynthesizer.synthesize).toHaveBeenCalledWith(
      'Test research prompt',
      [{ model: 'gemini-2.0-flash', content: '' }],
      undefined
    );
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
  });
});
