import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createTitleGenerationService } from '../infra/gemini/titleGenerationService.js';
import type { UserServiceClient } from '../infra/user/userServiceClient.js';

const mockGenerate = vi.fn();

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn().mockImplementation(() => ({
    generate: mockGenerate,
  })),
}));

describe('titleGenerationService', () => {
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

  describe('generateTitle', () => {
    const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

    it('returns generated title from Gemini', async () => {
      mockGenerate.mockResolvedValue(ok({ content: 'Test Generated Title', usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createTitleGenerationService(mockClient);

      const result = await service.generateTitle('user-123', 'Some test content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
      }
    });

    it('returns NO_API_KEY error when user has no API key', async () => {
      const mockClient = createMockUserServiceClient(null);
      const service = createTitleGenerationService(mockClient);

      const result = await service.generateTitle('user-123', 'Some content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
      }
    });

    it('returns USER_SERVICE_ERROR when user service fails', async () => {
      const mockClient: UserServiceClient = {
        getGeminiApiKey: vi
          .fn()
          .mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Service unavailable' })),
      };
      const service = createTitleGenerationService(mockClient);

      const result = await service.generateTitle('user-123', 'Some content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_SERVICE_ERROR');
      }
    });

    it('truncates long content to 5000 characters', async () => {
      mockGenerate.mockResolvedValue(ok({ content: 'Truncated Title', usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createTitleGenerationService(mockClient);

      const longContent = 'x'.repeat(10000);
      const result = await service.generateTitle('user-123', longContent);

      expect(result.ok).toBe(true);
    });

    it('trims generated title', async () => {
      mockGenerate.mockResolvedValue(ok({ content: '  Trimmed Title  ', usage: mockUsage }));
      const mockClient = createMockUserServiceClient();
      const service = createTitleGenerationService(mockClient);

      const result = await service.generateTitle('user-123', 'Some content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toMatch(/^\s|\s$/);
      }
    });

    it('returns GENERATION_ERROR when Gemini fails', async () => {
      mockGenerate.mockResolvedValue(err({ message: 'Gemini API error' }));
      const mockClient = createMockUserServiceClient();
      const service = createTitleGenerationService(mockClient);

      const result = await service.generateTitle('user-123', 'Some content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('Gemini API error');
      }
    });
  });
});
