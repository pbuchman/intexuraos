/**
 * Tests for exportResearchToNotion use case.
 * Covers the Notion export error path where exportToNotion returns an error result.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { exportResearchToNotion } from '../../../infra/notion/exportResearchToNotionUseCase.js';
import {
  FakeResearchRepository,
  FakeNotionServiceClient,
  FakeResearchExportSettings,
} from '../../fakes.js';
import type { Research } from '../../../domain/research/models/Research.js';

// Mock the notionResearchExporter module to control exportToNotion behavior
vi.mock('../../../infra/notion/notionResearchExporter.js', () => ({
  exportResearchToNotion: vi.fn(),
}));

// Import the mocked function after vi.mock declaration
import { exportResearchToNotion as mockExportToNotion } from '../../../infra/notion/notionResearchExporter.js';

function createSilentLogger(): {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
} {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function createCompletedResearch(overrides?: Partial<Research>): Research {
  return {
    id: 'test-research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test prompt',
    selectedModels: [LlmModels.Gemini25Pro],
    synthesisModel: LlmModels.Gemini25Pro,
    status: 'completed',
    synthesizedResult: 'Synthesized content here',
    llmResults: [
      {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini25Pro,
        status: 'completed',
      },
    ],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('exportResearchToNotion use case', () => {
  let fakeRepo: FakeResearchRepository;
  let fakeNotionClient: FakeNotionServiceClient;
  let fakeExportSettings: FakeResearchExportSettings;
  let logger: ReturnType<typeof createSilentLogger>;

  beforeEach(() => {
    fakeRepo = new FakeResearchRepository();
    fakeNotionClient = new FakeNotionServiceClient();
    fakeExportSettings = new FakeResearchExportSettings();
    logger = createSilentLogger();
    vi.clearAllMocks();
  });

  it('returns error when Notion export fails', async () => {
    const research = createCompletedResearch();
    fakeRepo.addResearch(research);
    fakeNotionClient.setToken('fake-token');
    fakeExportSettings.setResearchPageId('user-1', 'page-123');

    const mockedFn = mockExportToNotion as ReturnType<typeof vi.fn>;
    mockedFn.mockResolvedValue(
      err({ code: 'INTERNAL_ERROR' as const, message: 'Notion API failed' })
    );

    const result = await exportResearchToNotion('test-research-1', 'user-1', {
      researchRepo: fakeRepo,
      notionServiceClient: fakeNotionClient,
      researchExportSettings: fakeExportSettings,
      logger: logger as unknown as Parameters<typeof exportResearchToNotion>[2]['logger'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('Notion API failed');
    }
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns success and saves export info when Notion export succeeds', async () => {
    const research = createCompletedResearch();
    fakeRepo.addResearch(research);
    fakeNotionClient.setToken('fake-token');
    fakeExportSettings.setResearchPageId('user-1', 'page-123');

    const mockedFn = mockExportToNotion as ReturnType<typeof vi.fn>;
    mockedFn.mockResolvedValue(
      ok({
        mainPageId: 'notion-page-id',
        mainPageUrl: 'https://notion.so/notion-page-id',
        llmReportPages: [
          { model: LlmModels.Gemini25Pro, pageId: 'report-page-id', pageUrl: 'https://notion.so/report-page-id' },
        ],
      })
    );

    const result = await exportResearchToNotion('test-research-1', 'user-1', {
      researchRepo: fakeRepo,
      notionServiceClient: fakeNotionClient,
      researchExportSettings: fakeExportSettings,
      logger: logger as unknown as Parameters<typeof exportResearchToNotion>[2]['logger'],
    });

    expect(result.ok).toBe(true);

    // Verify export info was saved to research
    const updatedResearch = fakeRepo.getAll().find((r) => r.id === 'test-research-1');
    expect(updatedResearch?.notionExportInfo).toBeDefined();
    expect(updatedResearch?.notionExportInfo?.mainPageId).toBe('notion-page-id');
    expect(updatedResearch?.notionExportInfo?.mainPageUrl).toBe('https://notion.so/notion-page-id');
  });
});
