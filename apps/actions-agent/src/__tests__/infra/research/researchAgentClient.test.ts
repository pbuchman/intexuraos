import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { LlmModels } from '@intexuraos/llm-contract';
import { createResearchAgentClient } from '../../../infra/research/researchAgentClient.js';

describe('createResearchAgentClient', () => {
  const baseUrl = 'http://research-agent.local';
  const internalAuthToken = 'test-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('createDraft', () => {
    it('returns draft id on successful creation', async () => {
      nock(baseUrl)
        .post('/internal/research/draft')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: { id: 'draft-123' },
        });

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-456',
        title: 'AI Research',
        prompt: 'Research about artificial intelligence',
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('draft-123');
      }
    });

    it('sends correct request body', async () => {
      const scope = nock(baseUrl)
        .post('/internal/research/draft', {
          userId: 'user-789',
          title: 'Test Research',
          prompt: 'Research prompt',
          selectedModels: [LlmModels.Gemini25Pro, LlmModels.ClaudeOpus45],
          sourceActionId: 'action-111',
        })
        .reply(200, { success: true, data: { id: 'draft-456' } });

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      await client.createDraft({
        userId: 'user-789',
        title: 'Test Research',
        prompt: 'Research prompt',
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.ClaudeOpus45],
        sourceActionId: 'action-111',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('returns error on non-ok HTTP response', async () => {
      nock(baseUrl).post('/internal/research/draft').reply(500);

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-123',
        title: 'Test',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('500');
      }
    });

    it('returns error when response success is false', async () => {
      nock(baseUrl)
        .post('/internal/research/draft')
        .reply(200, {
          success: false,
          error: { message: 'User not found' },
        });

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-123',
        title: 'Test',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('User not found');
      }
    });

    it('returns error when response data is undefined', async () => {
      nock(baseUrl).post('/internal/research/draft').reply(200, {
        success: true,
      });

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-123',
        title: 'Test',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to create research draft');
      }
    });

    it('returns default error message when no error message in response', async () => {
      nock(baseUrl).post('/internal/research/draft').reply(200, {
        success: false,
      });

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-123',
        title: 'Test',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to create research draft');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl).post('/internal/research/draft').replyWithError('Connection refused');

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-123',
        title: 'Test',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Network error');
      }
    });
  });
});
