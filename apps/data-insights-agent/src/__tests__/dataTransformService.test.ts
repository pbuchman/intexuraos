import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createDataTransformService } from '../infra/gemini/dataTransformService.js';
import type { UserServiceClient } from '@intexuraos/internal-clients/user-service';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

const mockGenerate = vi.fn();

describe('dataTransformService', () => {
  function createMockUserServiceClient(
    hasClient = true,
    errorCode?: 'NO_API_KEY' | 'API_ERROR'
  ): UserServiceClient {
    if (!hasClient) {
      return {
        getLlmClient: vi
          .fn()
          .mockResolvedValue(
            err({ code: errorCode ?? 'NO_API_KEY', message: 'No API key configured' })
          ),
        getApiKeys: vi.fn(),
        reportLlmSuccess: vi.fn(),
      };
    }
    const mockLlmClient: LlmGenerateClient = {
      generate: mockGenerate,
    };
    return {
      getLlmClient: vi.fn().mockResolvedValue(ok(mockLlmClient)),
      getApiKeys: vi.fn(),
      reportLlmSuccess: vi.fn(),
    };
  }

  describe('transformData', () => {
    const mockUsage = { inputTokens: 100, outputTokens: 200, totalTokens: 300, costUsd: 0.01 };

    const mockJsonSchema = {
      type: 'object',
      properties: {
        date: { type: 'string' },
        value: { type: 'number' },
      },
    };

    const mockSnapshotData = {
      entries: [
        { date: '2025-01-01', value: 10 },
        { date: '2025-01-02', value: 20 },
        { date: '2025-01-03', value: 30 },
      ],
    };

    const mockChartConfig = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'line',
      encoding: {
        x: { field: 'date', type: 'temporal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const mockTransformInstructions = 'Filter to last 7 days and sort by date ascending';

    const mockInsight = {
      title: 'Upward Trend',
      trackableMetric: 'Daily growth rate',
    };

    it('transforms data successfully', async () => {
      const validResponse = `DATA_START
[
  {"date":"2025-01-01","value":10},
  {"date":"2025-01-02","value":20},
  {"date":"2025-01-03","value":30}
]
DATA_END`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value[0]).toEqual({ date: '2025-01-01', value: 10 });
      }
    });

    it('returns NO_API_KEY error when user has no API key', async () => {
      const mockClient = createMockUserServiceClient(false, 'NO_API_KEY');
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toBe('Please configure your LLM API key in settings first');
      }
    });

    it('returns USER_SERVICE_ERROR when user service fails', async () => {
      const mockClient = createMockUserServiceClient(false, 'API_ERROR');
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_SERVICE_ERROR');
        expect(result.error.message).toBe('No API key configured');
      }
    });

    it('returns GENERATION_ERROR when LLM generation fails', async () => {
      mockGenerate.mockResolvedValue(err({ message: 'Rate limit exceeded' }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('returns PARSE_ERROR when LLM response is invalid', async () => {
      mockGenerate.mockResolvedValue(ok({ content: 'INVALID RESPONSE FORMAT', usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
        expect(result.error.message).toContain('Failed to parse LLM response');
      }
    });

    it('calls getLlmClient and generate', async () => {
      const validResponse = `DATA_START
[
  {"date":"2025-01-01","value":10}
]
DATA_END`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      // Verify getLlmClient was called with user ID
      expect(mockClient.getLlmClient).toHaveBeenCalledWith('user-123');
      expect(mockGenerate).toHaveBeenCalled();
    });

    it('handles malformed JSON response', async () => {
      const malformedResponse = `DATA_START
[
  {"date":"2025-01-01","value":10},
  {invalid json},
  {"date":"2025-01-03","value":30}
]
DATA_END`;

      mockGenerate.mockResolvedValue(ok({ content: malformedResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
      }
    });

    it('handles empty data array', async () => {
      const validResponse = `DATA_START
[]
DATA_END`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
        expect(result.error.message).toContain('Data array cannot be empty');
      }
    });

    it('handles single data item', async () => {
      const validResponse = `DATA_START
[
  {"date":"2025-01-01","value":10}
]
DATA_END`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({ date: '2025-01-01', value: 10 });
      }
    });

    it('handles complex nested data structures', async () => {
      const complexResponse = `DATA_START
[
  {"date":"2025-01-01","value":10,"metadata":{"source":"api","verified":true}},
  {"date":"2025-01-02","value":20,"metadata":{"source":"api","verified":false}}
]
DATA_END`;

      mockGenerate.mockResolvedValue(ok({ content: complexResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataTransformService(mockClient);

      const result = await service.transformData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartConfig,
        mockTransformInstructions,
        mockInsight
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const item = result.value[0] as { date: string; value: number; metadata: { source: string; verified: boolean } };
        expect(item.metadata).toEqual({ source: 'api', verified: true });
      }
    });
  });
});
