import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResearchAgentServiceClient } from '../client.js';
import type { ResearchAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://research-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as ResearchAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createResearchAgentServiceClient', () => {
  it('creates drafts through the internal research endpoint', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/research/draft', {
        userId: 'user-1',
        title: 'AI Research',
        prompt: 'Research AI trends',
        originalMessage: 'Research AI trends',
        sourceActionId: 'action-1',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Research draft created successfully',
          resourceUrl: '/#/research/draft-1',
        },
      });

    const client = createResearchAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createDraft({
      userId: 'user-1',
      title: 'AI Research',
      prompt: 'Research AI trends',
      originalMessage: 'Research AI trends',
      sourceActionId: 'action-1',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Research draft created successfully',
        resourceUrl: '/#/research/draft-1',
      },
    });
  });

  it('uses the draft-specific fallback message for success=false envelopes', async () => {
    nock(BASE_URL).post('/internal/research/draft').reply(200, { success: false });

    const client = createResearchAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createDraft({
      userId: 'user-1',
      title: 'AI Research',
      prompt: 'Research AI trends',
      originalMessage: 'Research AI trends',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to create research draft');
    }
  });

  it('uses the network-specific prefix on transport failures', async () => {
    nock(BASE_URL).post('/internal/research/draft').replyWithError('Connection refused');

    const client = createResearchAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createDraft({
      userId: 'user-1',
      title: 'AI Research',
      prompt: 'Research AI trends',
      originalMessage: 'Research AI trends',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Network error: Connection refused');
    }
  });
});
