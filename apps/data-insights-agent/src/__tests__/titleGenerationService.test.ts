import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createTitleGenerationService } from '../infra/gemini/titleGenerationService.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

const mockGenerate = vi.fn();

describe('titleGenerationService', () => {
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
          getOAuthToken: vi.fn(),
      };
    }
    const mockLlmClient: LlmGenerateClient = {
      generate: mockGenerate,
    };
    return {
      getLlmClient: vi.fn().mockResolvedValue(ok(mockLlmClient)),
      getApiKeys: vi.fn(),
      reportLlmSuccess: vi.fn(),
          getOAuthToken: vi.fn(),
    };
  }

  describe('generateTitle', () => {
    const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

    it('returns generated title from LLM', async () => {
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
      const mockClient = createMockUserServiceClient(false, 'NO_API_KEY');
      const service = createTitleGenerationService(mockClient);

      const result = await service.generateTitle('user-123', 'Some content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
      }
    });

    it('returns USER_SERVICE_ERROR when user service fails', async () => {
      const mockClient = createMockUserServiceClient(false, 'API_ERROR');
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

    it('returns GENERATION_ERROR when LLM fails', async () => {
      mockGenerate.mockResolvedValue(err({ message: 'LLM API error' }));
      const mockClient = createMockUserServiceClient();
      const service = createTitleGenerationService(mockClient);

      const result = await service.generateTitle('user-123', 'Some content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('LLM API error');
      }
    });
  });
});
