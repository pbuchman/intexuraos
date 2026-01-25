import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createChartDefinitionService } from '../infra/gemini/chartDefinitionService.js';
import type { UserServiceClient } from '@intexuraos/internal-clients/user-service';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

const mockGenerate = vi.fn();

describe('chartDefinitionService', () => {
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

  describe('generateChartDefinition', () => {
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
      ],
    };

    const mockTargetChartSchema = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'line',
      encoding: {
        x: { field: 'date' },
        y: { field: 'value' },
      },
    };

    const mockInsight = {
      title: 'Upward Trend',
      description: 'Values increased over time',
      trackableMetric: 'Growth rate',
      suggestedChartType: 'C1',
    };

    it('generates chart definition successfully', async () => {
      const validResponse = `CHART_CONFIG_START
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","mark":"line","encoding":{"x":{"field":"date"},"y":{"field":"value"}}}
CHART_CONFIG_END

TRANSFORM_INSTRUCTIONS_START
Filter to last 7 days and sort by date ascending
TRANSFORM_INSTRUCTIONS_END`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createChartDefinitionService(mockClient);

      const result = await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
        mockInsight
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(result.value.vegaLiteConfig).toBeDefined();
        expect(result.value.transformInstructions).toBeDefined();
      }
    });

    it('returns NO_API_KEY error when user has no API key', async () => {
      const mockClient = createMockUserServiceClient(false, 'NO_API_KEY');
      const service = createChartDefinitionService(mockClient);

      const result = await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
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
      const service = createChartDefinitionService(mockClient);

      const result = await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
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
      const service = createChartDefinitionService(mockClient);

      const result = await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('returns PARSE_ERROR when LLM response is invalid', async () => {
      mockGenerate.mockResolvedValue(ok({ content: 'INVALID RESPONSE', usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createChartDefinitionService(mockClient);

      const result = await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
        mockInsight
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
        expect(result.error.message).toContain('Failed to parse LLM response');
      }
    });

    it('calls getLlmClient and generate', async () => {
      const validResponse = `CHART_DEFINITION:
Title=Test
Description=Test chart
VegaLiteSpec={"mark":"bar"}
DataSource=data`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createChartDefinitionService(mockClient);

      await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
        mockInsight
      );

      // Verify getLlmClient was called with user ID
      expect(mockClient.getLlmClient).toHaveBeenCalledWith('user-123');
      expect(mockGenerate).toHaveBeenCalled();
    });
  });
});
