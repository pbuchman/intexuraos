/**
 * Tests for exportResearchToNotion use case.
 * Verifies fire-and-forget Notion export behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { RepositoryError } from '../../../domain/research/ports/repository.js';
import { exportResearchToNotion } from '../exportResearchToNotionUseCase.js';
import type { Research } from '../../../domain/research/models/Research.js';
import * as notionExporter from '../notionResearchExporter.js';

// Mock the exporter module
vi.mock('../notionResearchExporter.js', () => ({
  exportResearchToNotion: vi.fn(),
}));

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createMockDeps() {
  const mockResearchRepo = {
    findById: vi.fn(),
  };

  const mockNotionServiceClient = {
    getNotionToken: vi.fn(),
  };

  const mockResearchExportSettings = {
    getResearchPageId: vi.fn(),
    saveResearchPageId: vi.fn(),
  };

  return {
    researchRepo: mockResearchRepo,
    notionServiceClient: mockNotionServiceClient,
    researchExportSettings: mockResearchExportSettings,
    logger: mockLogger,
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test research prompt',
    status: 'completed',
    selectedModels: [LlmModels.Gemini25Pro],
    synthesisModel: LlmModels.Gemini25Pro,
    llmResults: [
      {
        provider: 'google' as const,
        model: LlmModels.Gemini25Pro,
        status: 'completed',
        result: 'Test result',
      },
    ],
    startedAt: '2024-01-01T10:00:00Z',
    synthesizedResult: 'Synthesized content',
    completedAt: '2024-01-01T10:05:00Z',
    totalDurationMs: 300000,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCostUsd: 0.01,
    attributionStatus: 'complete',
    ...overrides,
  };
}

describe('exportResearchToNotion', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when research is not found', () => {
    it('should return error and log warning', async () => {
      deps.researchRepo.findById.mockResolvedValue(ok(null));

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('when research fetch fails', () => {
    it('should return error and log', async () => {
      const repoError: RepositoryError = {
        code: 'FIRESTORE_ERROR',
        message: 'Database error',
      };
      deps.researchRepo.findById.mockResolvedValue(err(repoError));

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database error');
      }
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('when research has no synthesis', () => {
    it('should silently skip and return ok', async () => {
      const baseResearch = createTestResearch();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { synthesizedResult, ...restWithoutSynthesis } = baseResearch;
      const researchWithoutSynthesis = { ...restWithoutSynthesis };
      deps.researchRepo.findById.mockResolvedValue(ok(researchWithoutSynthesis as Research));

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(true);
      expect(deps.researchExportSettings.getResearchPageId).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('when research has empty synthesis', () => {
    it('should silently skip and return ok', async () => {
      const researchWithEmptySynthesis = createTestResearch({
        synthesizedResult: '',
      });
      deps.researchRepo.findById.mockResolvedValue(ok(researchWithEmptySynthesis));

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(true);
      expect(deps.researchExportSettings.getResearchPageId).not.toHaveBeenCalled();
    });
  });

  describe('when user has no page ID configured', () => {
    it('should silently skip and return ok', async () => {
      const research = createTestResearch();
      deps.researchRepo.findById.mockResolvedValue(ok(research));
      deps.researchExportSettings.getResearchPageId.mockResolvedValue(ok(null));

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(true);
      expect(deps.notionServiceClient.getNotionToken).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('when page ID fetch fails', () => {
    it('should silently skip and return ok', async () => {
      const research = createTestResearch();
      deps.researchRepo.findById.mockResolvedValue(ok(research));
      deps.researchExportSettings.getResearchPageId.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Settings service error' })
      );

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(true);
      expect(deps.notionServiceClient.getNotionToken).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('when user has not connected Notion', () => {
    it('should silently skip and return ok', async () => {
      const research = createTestResearch();
      deps.researchRepo.findById.mockResolvedValue(ok(research));
      deps.researchExportSettings.getResearchPageId.mockResolvedValue(ok('page-123'));
      deps.notionServiceClient.getNotionToken.mockResolvedValue(
        ok({ connected: false, token: null })
      );

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('when token fetch fails', () => {
    it('should silently skip and return ok', async () => {
      const research = createTestResearch();
      deps.researchRepo.findById.mockResolvedValue(ok(research));
      deps.researchExportSettings.getResearchPageId.mockResolvedValue(ok('page-123'));
      deps.notionServiceClient.getNotionToken.mockResolvedValue(
        err({ code: 'DOWNSTREAM_ERROR', message: 'Token service error' })
      );

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('when export succeeds', () => {
    it('should return ok and log success', async () => {
      const research = createTestResearch();
      deps.researchRepo.findById.mockResolvedValue(ok(research));
      deps.researchExportSettings.getResearchPageId.mockResolvedValue(ok('page-123'));
      deps.notionServiceClient.getNotionToken.mockResolvedValue(
        ok({ connected: true, token: 'token-abc' })
      );

      // Mock the actual export function
      vi.mocked(notionExporter.exportResearchToNotion).mockResolvedValue(
        ok({
          mainPageId: 'notion-page-123',
          mainPageUrl: 'https://notion.so/page-123',
          llmReportPages: [],
        })
      );

      const result = await exportResearchToNotion('research-1', 'user-1', deps);

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});
