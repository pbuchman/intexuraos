import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { createChartDefinitionService } from '../infra/gemini/chartDefinitionService.js';
import type { UserServiceClient } from '../infra/user/userServiceClient.js';

const mockGenerate = vi.fn();

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn().mockImplementation(() => ({
    generate: mockGenerate,
  })),
}));

const fakePricingContext = new FakePricingContext();

describe('chartDefinitionService', () => {
  function createMockUserServiceClient(apiKey: string | null = 'test-api-key'): UserServiceClient {
    return {
      getGeminiApiKey: vi
        .fn()
        .mockResolvedValue(
          apiKey !== null
            ? ok(apiKey)
            : err({ code: 'NO_API_KEY' as const, message: 'No API key configured' })
        ),
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
      const service = createChartDefinitionService(mockClient, fakePricingContext);

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
      const mockClient = createMockUserServiceClient(null);
      const service = createChartDefinitionService(mockClient, fakePricingContext);

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
        expect(result.error.message).toBe('Please configure your Gemini API key in settings first');
      }
    });

    it('returns USER_SERVICE_ERROR when user service fails', async () => {
      const mockClient: UserServiceClient = {
        getGeminiApiKey: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Service unavailable' })),
      };
      const service = createChartDefinitionService(mockClient, fakePricingContext);

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
        expect(result.error.message).toBe('Service unavailable');
      }
    });

    it('returns GENERATION_ERROR when LLM generation fails', async () => {
      mockGenerate.mockResolvedValue(err({ message: 'Rate limit exceeded' }));
      const mockClient = createMockUserServiceClient();
      const service = createChartDefinitionService(mockClient, fakePricingContext);

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
      const service = createChartDefinitionService(mockClient, fakePricingContext);

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

    it('creates Gemini client with correct configuration', async () => {
      const validResponse = `CHART_DEFINITION:
Title=Test
Description=Test chart
VegaLiteSpec={"mark":"bar"}
DataSource=data`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createChartDefinitionService(mockClient, fakePricingContext);

      await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
        mockInsight
      );

      // Verify Gemini client was created with user's API key
      expect(mockClient.getGeminiApiKey).toHaveBeenCalledWith('user-123');
      expect(mockGenerate).toHaveBeenCalled();
    });

    it('passes pricing context for Gemini 2.5 Flash model', async () => {
      const validResponse = `CHART_DEFINITION:
Title=Test
Description=Test chart
VegaLiteSpec={"mark":"bar"}
DataSource=data`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const getPricingSpy = vi.spyOn(fakePricingContext, 'getPricing');

      const mockClient = createMockUserServiceClient();
      const service = createChartDefinitionService(mockClient, fakePricingContext);

      await service.generateChartDefinition(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockTargetChartSchema,
        mockInsight
      );

      expect(getPricingSpy).toHaveBeenCalled();
    });
  });
});
