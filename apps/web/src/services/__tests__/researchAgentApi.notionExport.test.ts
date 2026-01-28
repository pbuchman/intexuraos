/**
 * Tests for researchAgentApi Notion export functionality.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import { exportToNotion } from '../researchAgentApi';
import type { Research } from '../researchAgentApi.types';

vi.mock('../apiClient.js');
vi.mock('../../config', () => ({
  config: {
    ResearchAgentUrl: 'http://localhost:8080',
  },
}));

describe('exportToNotion', () => {
  const mockAccessToken = 'test-token';
  const mockResearchId = 'research-123';

  const mockResearchResponse: Research = {
    id: mockResearchId,
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test prompt',
    status: 'completed',
    selectedModels: [LlmModels.Gemini25Pro],
    synthesisModel: LlmModels.Gemini25Pro,
    llmResults: [
      {
        provider: 'Google',
        model: LlmModels.Gemini25Pro,
        status: 'completed',
        result: 'Test result',
      },
    ],
    startedAt: '2024-01-01T10:00:00Z',
    synthesizedResult: 'Synthesized content',
    completedAt: '2024-01-01T10:05:00Z',
    notionExportInfo: {
      mainPageId: 'notion-page-123',
      mainPageUrl: 'https://notion.so/page-123',
      llmReportPageIds: [],
      exportedAt: '2024-01-01T10:05:00Z',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls apiRequest with correct parameters', async () => {
    const { apiRequest: apiRequestMock } = await import('../apiClient.js');
    vi.mocked(apiRequestMock).mockResolvedValue(mockResearchResponse);

    await exportToNotion(mockAccessToken, mockResearchId);

    expect(apiRequestMock).toHaveBeenCalledWith(
      'http://localhost:8080',
      `/research/${mockResearchId}/export-notion`,
      mockAccessToken,
      { method: 'POST' }
    );
  });

  it('returns the updated research with notionExportInfo', async () => {
    const { apiRequest: apiRequestMock } = await import('../apiClient.js');
    vi.mocked(apiRequestMock).mockResolvedValue(mockResearchResponse);

    const result = await exportToNotion(mockAccessToken, mockResearchId);

    expect(result).toEqual(mockResearchResponse);
    expect(result.notionExportInfo).toBeDefined();
    expect(result.notionExportInfo?.mainPageUrl).toBe('https://notion.so/page-123');
  });

  it('throws error when apiRequest fails', async () => {
    const { apiRequest: apiRequestMock } = await import('../apiClient.js');
    const mockError = new Error('NOTION_NOT_CONNECTED: User has not connected Notion');
    vi.mocked(apiRequestMock).mockRejectedValue(mockError);

    await expect(exportToNotion(mockAccessToken, mockResearchId)).rejects.toThrow(
      'NOTION_NOT_CONNECTED: User has not connected Notion'
    );
  });

  it('throws error for PAGE_NOT_CONFIGURED', async () => {
    const { apiRequest: apiRequestMock } = await import('../apiClient.js');
    const mockError = new Error(
      'PAGE_NOT_CONFIGURED: Research Export Page ID not configured'
    );
    vi.mocked(apiRequestMock).mockRejectedValue(mockError);

    await expect(exportToNotion(mockAccessToken, mockResearchId)).rejects.toThrow(
      'PAGE_NOT_CONFIGURED: Research Export Page ID not configured'
    );
  });
});
