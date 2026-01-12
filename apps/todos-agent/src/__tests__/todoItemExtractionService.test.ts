import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { createTodoItemExtractionService } from '../infra/gemini/todoItemExtractionService.js';
import type { UserServiceClient } from '../infra/user/userServiceClient.js';

const mockGenerate = vi.fn();

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn().mockImplementation(() => ({
    generate: mockGenerate,
  })),
}));

const fakePricingContext = new FakePricingContext();

describe('todoItemExtractionService', () => {
  let mockUserServiceClient: UserServiceClient;

  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue(
      ok({
        content: JSON.stringify({
          items: [
            {
              title: 'Buy groceries',
              priority: 'medium' as const,
              dueDate: '2025-01-15',
              reasoning: 'Urgent task mentioned',
            },
          ],
          summary: 'Extracted 1 item',
        }),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createMockUserServiceClient(
    result: 'ok' | 'no_api_key' | 'api_error' | 'network_error' = 'ok'
  ): UserServiceClient {
    switch (result) {
      case 'ok':
        return {
          getGeminiApiKey: vi.fn().mockResolvedValue(ok('test-api-key')),
        };
      case 'no_api_key':
        return {
          getGeminiApiKey: vi
            .fn()
            .mockResolvedValue(err({ code: 'NO_API_KEY' as const, message: 'No API key' })),
        };
      case 'api_error':
        return {
          getGeminiApiKey: vi
            .fn()
            .mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Service error' })),
        };
      case 'network_error':
        return {
          getGeminiApiKey: vi
            .fn()
            .mockResolvedValue(err({ code: 'NETWORK_ERROR' as const, message: 'Network error' })),
        };
    }
  }

  describe('extractItems', () => {
    const mockUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };

    it('extracts items successfully from description', async () => {
      const validResponse = JSON.stringify({
        items: [
          {
            title: 'Buy groceries',
            priority: 'high' as const,
            dueDate: '2025-01-15',
            reasoning: 'Urgent task mentioned',
          },
          {
            title: 'Call mom',
            priority: 'low' as const,
            dueDate: null,
            reasoning: 'Low priority task',
          },
        ],
        summary: 'Extracted 2 items',
      });

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Buy groceries and call mom');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.title).toBe('Buy groceries');
        expect(result.value[0]?.priority).toBe('high');
        expect(result.value[0]?.dueDate).toEqual(new Date('2025-01-15T00:00:00.000Z'));
        expect(result.value[1]?.title).toBe('Call mom');
        expect(result.value[1]?.priority).toBe('low');
        expect(result.value[1]?.dueDate).toBeNull();
      }
    });

    it('returns NO_API_KEY error when user has no API key', async () => {
      mockUserServiceClient = createMockUserServiceClient('no_api_key');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toBe('Please configure your Gemini API key in settings first');
      }
    });

    it('returns USER_SERVICE_ERROR when user service fails with API_ERROR', async () => {
      mockUserServiceClient = createMockUserServiceClient('api_error');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_SERVICE_ERROR');
        expect(result.error.message).toBe('Failed to fetch API key: Service error');
        expect(result.error.details?.userServiceError).toBe('Service error');
      }
    });

    it('returns USER_SERVICE_ERROR when user service fails with NETWORK_ERROR', async () => {
      mockUserServiceClient = createMockUserServiceClient('network_error');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_SERVICE_ERROR');
        expect(result.error.message).toBe('Failed to fetch API key: Network error');
        expect(result.error.details?.userServiceError).toBe('Network error');
      }
    });

    it('returns GENERATION_ERROR when LLM generation fails', async () => {
      mockGenerate.mockResolvedValue(err({ code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('LLM generation failed: Rate limit exceeded');
        expect(result.error.details?.llmErrorCode).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('returns INVALID_RESPONSE when JSON parsing fails', async () => {
      mockGenerate.mockResolvedValue(ok({ content: 'not valid json', usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.message).toContain('Failed to parse LLM response');
        expect(result.error.details?.parseError).toBeDefined();
        expect(result.error.details?.rawResponsePreview).toBe('not valid json');
      }
    });

    it('returns INVALID_RESPONSE when response schema validation fails', async () => {
      const invalidResponse = JSON.stringify({
        items: 'not an array',
        summary: 'Invalid',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.message).toBe('LLM returned invalid response format');
        expect(result.error.details?.parseError).toBe('Schema validation failed');
        expect(result.error.details?.rawResponsePreview).toBeDefined();
      }
    });

    it('returns INVALID_RESPONSE when items array is missing', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'No items field',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('returns INVALID_RESPONSE when item is missing required fields', async () => {
      const invalidResponse = JSON.stringify({
        items: [
          {
            // missing title
            priority: 'high',
            dueDate: '2025-01-15',
            reasoning: 'test',
          },
        ],
        summary: 'Invalid item',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('returns INVALID_RESPONSE when priority is invalid', async () => {
      const invalidResponse = JSON.stringify({
        items: [
          {
            title: 'Test',
            priority: 'invalid' as string,
            dueDate: null,
            reasoning: 'test',
          },
        ],
        summary: 'Invalid priority',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test description');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles empty items array', async () => {
      const validResponse = JSON.stringify({
        items: [],
        summary: 'No items found',
      });

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'No actionable items here');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('truncates items to MAX_ITEMS limit', async () => {
      const manyItems = Array.from({ length: 60 }, (_, i) => ({
        title: `Item ${String(i)}`,
        priority: 'medium' as const,
        dueDate: null,
        reasoning: 'test',
      }));

      const validResponse = JSON.stringify({
        items: manyItems,
        summary: 'Many items',
      });

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Many tasks');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(50); // MAX_ITEMS
      }
    });

    it('converts dueDate strings to Date objects', async () => {
      const validResponse = JSON.stringify({
        items: [
          {
            title: 'Task with date',
            priority: 'medium' as const,
            dueDate: '2025-01-20',
            reasoning: 'test',
          },
          {
            title: 'Task without date',
            priority: 'low' as const,
            dueDate: null,
            reasoning: 'test',
          },
        ],
        summary: '2 items',
      });

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.dueDate).toBeInstanceOf(Date);
        expect(result.value[1]?.dueDate).toBeNull();
      }
    });

    it('handles null priority values', async () => {
      const validResponse = JSON.stringify({
        items: [
          {
            title: 'Task',
            priority: null,
            dueDate: null,
            reasoning: 'test',
          },
        ],
        summary: '1 item',
      });

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.priority).toBeNull();
      }
    });

    it('calls user service with correct userId', async () => {
      mockGenerate.mockResolvedValue(
        ok({
          content: JSON.stringify({ items: [], summary: 'No items' }),
          usage: mockUsage,
        })
      );
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      await service.extractItems('user-abc-123', 'Test description');

      expect(mockUserServiceClient.getGeminiApiKey).toHaveBeenCalledWith('user-abc-123');
    });

    it('includes raw response preview for JSON parse errors', async () => {
      mockGenerate.mockResolvedValue(
        ok({
          content: '{invalid json',
          usage: mockUsage,
        })
      );
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createTodoItemExtractionService(mockUserServiceClient, fakePricingContext);

      const result = await service.extractItems('user-123', 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.details?.rawResponsePreview).toBe('{invalid json');
      }
    });
  });
});
