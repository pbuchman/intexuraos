import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createFeedNameGenerationService } from '../infra/gemini/feedNameGenerationService.js';
import type { UserServiceClient } from '../infra/user/userServiceClient.js';
import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  GenerateResult,
  LLMError,
  LLMClient,
  NormalizedUsage,
} from '@intexuraos/llm-contract';
import * as infraGemini from '@intexuraos/infra-gemini';

vi.mock('@intexuraos/infra-gemini');

const mockUsage: NormalizedUsage = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  costUsd: 0.001,
};

function mockGenerateResult(content: string): Result<GenerateResult, LLMError> {
  return ok({ content, usage: mockUsage });
}

describe('feedNameGenerationService', () => {
  let mockUserServiceClient: UserServiceClient;
  let mockGenerate: Mock<(prompt: string) => Promise<Result<GenerateResult, LLMError>>>;
  const userId = 'user-123';

  beforeEach(() => {
    mockUserServiceClient = {
      getGeminiApiKey: vi.fn().mockResolvedValue(ok('test-api-key')),
    };
    mockGenerate = vi.fn().mockResolvedValue(mockGenerateResult('  Test Feed Name  '));
    vi.mocked(infraGemini.createGeminiClient).mockReturnValue({
      generate: mockGenerate,
      research: vi.fn(),
    } as unknown as LLMClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateName', () => {
    it('generates a name using Gemini', async () => {
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(
        userId,
        'Track daily notifications',
        ['Daily Notes', 'Task List'],
        ['WhatsApp Work']
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Test Feed Name');
      }
      expect(mockUserServiceClient.getGeminiApiKey).toHaveBeenCalledWith(userId);
    });

    it('handles empty source names', async () => {
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(userId, 'Purpose', [], ['Filter']);

      expect(result.ok).toBe(true);
    });

    it('handles empty filter names', async () => {
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(userId, 'Purpose', ['Source'], []);

      expect(result.ok).toBe(true);
    });

    it('returns NO_API_KEY error when user has no key', async () => {
      mockUserServiceClient.getGeminiApiKey = vi
        .fn()
        .mockResolvedValue(err({ code: 'NO_API_KEY', message: 'No API key configured' }));
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(userId, 'Purpose', [], []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toBe('Please configure your Gemini API key in settings first');
      }
    });

    it('returns USER_SERVICE_ERROR for other user service errors', async () => {
      mockUserServiceClient.getGeminiApiKey = vi
        .fn()
        .mockResolvedValue(err({ code: 'INTERNAL_ERROR', message: 'Service unavailable' }));
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(userId, 'Purpose', [], []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_SERVICE_ERROR');
        expect(result.error.message).toBe('Service unavailable');
      }
    });

    it('returns GENERATION_ERROR when Gemini fails', async () => {
      mockGenerate.mockResolvedValue(err({ code: 'API_ERROR', message: 'Rate limit exceeded' }));
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(userId, 'Purpose', [], []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('trims whitespace from generated name', async () => {
      mockGenerate.mockResolvedValue(mockGenerateResult('  Trimmed Name  '));
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(userId, 'Purpose', [], []);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Trimmed Name');
        expect(result.value).not.toMatch(/^\s|\s$/);
      }
    });

    it('truncates name to max length of 200', async () => {
      const longName = 'A'.repeat(300);
      mockGenerate.mockResolvedValue(mockGenerateResult(longName));
      const service = createFeedNameGenerationService(mockUserServiceClient);

      const result = await service.generateName(userId, 'Purpose', [], []);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeLessThanOrEqual(200);
        expect(result.value.length).toBe(200);
      }
    });
  });
});
