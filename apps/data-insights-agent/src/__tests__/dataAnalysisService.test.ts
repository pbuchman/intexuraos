import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { createDataAnalysisService } from '../infra/gemini/dataAnalysisService.js';
import type { UserServiceClient } from '../infra/user/userServiceClient.js';

const mockGenerate = vi.fn();

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn().mockImplementation(() => ({
    generate: mockGenerate,
  })),
}));

const fakePricingContext = new FakePricingContext();

describe('dataAnalysisService', () => {
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

  describe('analyzeData', () => {
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

    const mockChartTypes = [
      {
        id: 'C1',
        name: 'Line Chart',
        bestFor: 'Shows trends over time',
        vegaLiteSchema: { mark: 'line' },
      },
      {
        id: 'C2',
        name: 'Bar Chart',
        bestFor: 'Compares categories',
        vegaLiteSchema: { mark: 'bar' },
      },
    ];

    it('generates data insights successfully', async () => {
      const validResponse = `INSIGHT_1: Title=Upward Trend; Description=Values show consistent upward trend over the period. The growth rate is approximately 10% per day.; Trackable=Growth rate percentage; ChartType=C1
INSIGHT_2: Title=Maximum Value; Description=The highest value reached was 30 on January 3rd. This represents a 200% increase from the starting value.; Trackable=Maximum daily value; ChartType=C1`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.insights).toHaveLength(2);
        expect(result.value.insights[0]?.title).toBe('Upward Trend');
        expect(result.value.insights[0]?.suggestedChartType).toBe('C1');
        expect(result.value.noInsightsReason).toBeUndefined();
      }
    });

    it('returns NO_INSIGHTS when data has no meaningful insights', async () => {
      const validResponse = `NO_INSIGHTS: Reason=Data is too static and lacks variance for meaningful analysis`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.insights).toHaveLength(0);
        expect(result.value.noInsightsReason).toBe('Data is too static and lacks variance for meaningful analysis');
      }
    });

    it('returns NO_API_KEY error when user has no API key', async () => {
      const mockClient = createMockUserServiceClient(null);
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
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
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
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
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
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
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
        expect(result.error.message).toContain('Failed to parse LLM response');
      }
    });

    it('creates Gemini client with correct configuration', async () => {
      const validResponse = `INSIGHT_1: Title=Test Insight; Description=Test description with two sentences. Second sentence here.; Trackable=Test metric; ChartType=C1`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      await service.analyzeData('user-123', mockJsonSchema, mockSnapshotData, mockChartTypes);

      // Verify Gemini client was created with user's API key
      expect(mockClient.getGeminiApiKey).toHaveBeenCalledWith('user-123');
      expect(mockGenerate).toHaveBeenCalled();
    });

    it('passes pricing context for Gemini 2.5 Flash model', async () => {
      const validResponse = `INSIGHT_1: Title=Test; Description=Test. Test.; Trackable=Metric; ChartType=C1`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const getPricingSpy = vi.spyOn(fakePricingContext, 'getPricing');

      const mockClient = createMockUserServiceClient();
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      await service.analyzeData('user-123', mockJsonSchema, mockSnapshotData, mockChartTypes);

      expect(getPricingSpy).toHaveBeenCalled();
    });

    it('handles malformed insight response gracefully', async () => {
      const malformedResponse = `INSIGHT_1: Title=Missing fields
INSIGHT_2: Incomplete insight`;

      mockGenerate.mockResolvedValue(ok({ content: malformedResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
      }
    });

    it('handles empty insight list', async () => {
      const validResponse = `INSIGHT_1: Title=Single Insight; Description=Only one insight found. Limited data available.; Trackable=Data count; ChartType=C2`;

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createDataAnalysisService(mockClient, fakePricingContext);

      const result = await service.analyzeData(
        'user-123',
        mockJsonSchema,
        mockSnapshotData,
        mockChartTypes
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.insights).toHaveLength(1);
        expect(result.value.insights[0]?.title).toBe('Single Insight');
      }
    });
  });
});
