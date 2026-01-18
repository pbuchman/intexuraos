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
    it('returns ActionFeedback on successful creation', async () => {
      nock(baseUrl)
        .post('/internal/research/draft')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Research draft created successfully',
            resourceUrl: '/#/research/draft-123',
          },
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
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Research draft created successfully');
        expect(result.value.resourceUrl).toBe('/#/research/draft-123');
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
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Research draft created successfully',
            resourceUrl: '/#/research/draft-456',
          },
        });

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

    it('returns error on non-ok HTTP response with non-JSON body', async () => {
      nock(baseUrl).post('/internal/research/draft').reply(500, 'Internal Server Error');

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

    it('returns failed ServiceFeedback with errorCode on HTTP 401', async () => {
      nock(baseUrl).post('/internal/research/draft').reply(401, {
        success: false,
        error: { code: 'TOKEN_ERROR', message: 'Token expired' },
      });

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-123',
        title: 'Test',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Token expired');
        expect(result.value.errorCode).toBe('TOKEN_ERROR');
      }
    });

    it('returns failed ServiceFeedback with default message on HTTP 401 without error body', async () => {
      nock(baseUrl).post('/internal/research/draft').reply(401, {
        error: { message: 'Unauthorized' },
      });

      const client = createResearchAgentClient({ baseUrl, internalAuthToken });
      const result = await client.createDraft({
        userId: 'user-123',
        title: 'Test',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.O4MiniDeepResearch],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Unauthorized');
        expect(result.value.errorCode).toBeUndefined();
      }
    });

    it('returns error on OK response with invalid JSON', async () => {
      nock(baseUrl).post('/internal/research/draft').reply(200, 'not valid json', {
        'Content-Type': 'text/plain',
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
        expect(result.error.message).toContain('Invalid response');
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
