import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createVisualizationAnalysisService } from '../infra/gemini/visualizationAnalysisService.js';
import type { UserServiceClient } from '../infra/user/userServiceClient.js';
import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  GenerateResult,
  LLMError,
  LLMClient,
  NormalizedUsage,
} from '@intexuraos/llm-contract';
import { LlmModels } from '@intexuraos/llm-contract';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import * as infraGemini from '@intexuraos/infra-gemini';
import type { GenerateVisualizationContentRequest } from '../domain/visualization/index.js';

vi.mock('@intexuraos/infra-gemini');

const mockUsage: NormalizedUsage = {
  inputTokens: 100,
  outputTokens: 200,
  totalTokens: 300,
  costUsd: 0.01,
};

function mockGenerateResult(content: string): Result<GenerateResult, LLMError> {
  return ok({ content, usage: mockUsage });
}

const fakePricingContext = new FakePricingContext();

describe('visualizationAnalysisService', () => {
  let mockUserServiceClient: UserServiceClient;
  let mockGenerate: Mock<(prompt: string) => Promise<Result<GenerateResult, LLMError>>>;
  const userId = 'user-123';
  const feedId = 'feed-456';
  const visualizationId = 'viz-789';

  const mockRequest: GenerateVisualizationContentRequest = {
    visualizationId,
    feedId,
    userId,
    title: 'Test Visualization',
    description: 'Test feed purpose',
    type: 'chart',
  };

  const mockSnapshotData = {
    entries: [
      { date: '2025-01-01', value: 10 },
      { date: '2025-01-02', value: 20 },
    ],
  };

  beforeEach(() => {
    mockUserServiceClient = {
      getGeminiApiKey: vi.fn().mockResolvedValue(ok('test-api-key')),
    };
    mockGenerate = vi.fn();
    vi.mocked(infraGemini.createGeminiClient).mockReturnValue({
      generate: mockGenerate,
      research: vi.fn(),
    } as unknown as LLMClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateContent', () => {
    it('generates HTML content with insights and Vega-Lite spec', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('The data shows an upward trend.'))
        .mockResolvedValueOnce(
          mockGenerateResult(
            '{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","mark":"bar","data":{"values":[]}}'
          )
        );

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(result.htmlContent).toContain('<!DOCTYPE html>');
      expect(result.htmlContent).toContain('Test Visualization');
      expect(result.htmlContent).toContain('The data shows an upward trend.');
      expect(result.htmlContent).toContain('vega.github.io');
    });

    it('escapes HTML special characters in title', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const request = {
        ...mockRequest,
        title: '<script>alert("xss")</script>',
      };
      const result = await service.generateContent(mockSnapshotData, request);

      expect(result.htmlContent).toContain('&lt;script&gt;');
      expect(result.htmlContent).not.toContain('<script>alert');
    });

    it('escapes HTML special characters in insights', async () => {
      mockGenerate
        .mockResolvedValueOnce(
          mockGenerateResult('Trend: <strong>up</strong> & "significant"')
        )
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(result.htmlContent).toContain('&lt;strong&gt;');
      expect(result.htmlContent).toContain('&amp;');
      expect(result.htmlContent).toContain('&quot;');
    });

    it('trims whitespace from insights', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('  Insights with spaces  '))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(result.htmlContent).toContain('Insights with spaces');
    });

    it('trims whitespace from Vega-Lite spec', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('  {"mark":"bar","data":{}}  '));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(result.htmlContent).toContain('{"mark":"bar","data":{}}');
    });

    it('includes Vega-Lite CDN scripts', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(result.htmlContent).toContain('vega@5');
      expect(result.htmlContent).toContain('vega-lite@5');
      expect(result.htmlContent).toContain('vega-embed@6');
    });

    it('includes vegaEmbed initialization', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(result.htmlContent).toContain("vegaEmbed('#vis'");
      expect(result.htmlContent).toContain('const spec =');
    });

    it('uses feed description as purpose in prompts', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      await service.generateContent(mockSnapshotData, mockRequest);

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Test feed purpose'));
    });

    it('passes snapshot data to prompts', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      await service.generateContent(mockSnapshotData, mockRequest);

      const firstCall = mockGenerate.mock.calls[0]?.[0] ?? '';
      expect(firstCall).toContain('2025-01-01');
      expect(firstCall).toContain('2025-01-02');
    });

    it('passes insights to Vega-Lite prompt', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Key insights here'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      await service.generateContent(mockSnapshotData, mockRequest);

      const secondCall = mockGenerate.mock.calls[1]?.[0] ?? '';
      expect(secondCall).toContain('Key insights here');
    });

    it('throws error when user has no API key', async () => {
      mockUserServiceClient.getGeminiApiKey = vi
        .fn()
        .mockResolvedValue(err({ code: 'NO_API_KEY', message: 'No API key configured' }));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );

      await expect(service.generateContent(mockSnapshotData, mockRequest)).rejects.toThrow(
        'Please configure your Gemini API key in settings first'
      );
    });

    it('throws error when user service fails', async () => {
      mockUserServiceClient.getGeminiApiKey = vi
        .fn()
        .mockResolvedValue(err({ code: 'API_ERROR', message: 'Service unavailable' }));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );

      await expect(service.generateContent(mockSnapshotData, mockRequest)).rejects.toThrow(
        'User service error: Service unavailable'
      );
    });

    it('throws error when insights generation fails', async () => {
      mockGenerate.mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Rate limit' }));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );

      await expect(service.generateContent(mockSnapshotData, mockRequest)).rejects.toThrow(
        'Failed to generate insights: Rate limit'
      );
    });

    it('throws error when Vega-Lite generation fails', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Timeout' }));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );

      await expect(service.generateContent(mockSnapshotData, mockRequest)).rejects.toThrow(
        'Failed to generate Vega-Lite spec: Timeout'
      );
    });

    it('creates Gemini client with correct configuration', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      await service.generateContent(mockSnapshotData, mockRequest);

      expect(infraGemini.createGeminiClient).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        model: LlmModels.Gemini25Flash,
        userId,
        pricing: expect.anything(),
      });
    });

    it('uses pricing context for Gemini 2.5 Flash model', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"mark":"bar","data":{}}'));

      const getPricingSpy = vi.spyOn(fakePricingContext, 'getPricing');

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      await service.generateContent(mockSnapshotData, mockRequest);

      expect(getPricingSpy).toHaveBeenCalledWith(LlmModels.Gemini25Flash);
    });

    it('throws error when LLM returns invalid JSON', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('not valid json'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );

      await expect(service.generateContent(mockSnapshotData, mockRequest)).rejects.toThrow(
        'LLM returned invalid JSON for Vega-Lite spec'
      );
    });

    it('throws error when LLM returns non-object value', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('[1, 2, 3]'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );

      await expect(service.generateContent(mockSnapshotData, mockRequest)).rejects.toThrow(
        'LLM returned non-object value for Vega-Lite spec'
      );
    });

    it('throws error when LLM returns spec without mark property', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"data":{"values":[]}}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );

      await expect(service.generateContent(mockSnapshotData, mockRequest)).rejects.toThrow(
        'Invalid Vega-Lite spec: missing required property'
      );
    });

    it('accepts spec with layer property instead of mark', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('{"layer":[{"mark":"bar"}]}'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(result.htmlContent).toContain('layer');
    });

    it('strips markdown code fences from Vega-Lite spec', async () => {
      mockGenerate
        .mockResolvedValueOnce(mockGenerateResult('Insights'))
        .mockResolvedValueOnce(mockGenerateResult('```json\n{"mark":"bar"}\n```'));

      const service = createVisualizationAnalysisService(
        mockUserServiceClient,
        fakePricingContext
      );
      const result = await service.generateContent(mockSnapshotData, mockRequest);

      expect(result.htmlContent).toContain('{"mark":"bar"}');
      expect(result.htmlContent).not.toContain('```');
    });
  });
});
