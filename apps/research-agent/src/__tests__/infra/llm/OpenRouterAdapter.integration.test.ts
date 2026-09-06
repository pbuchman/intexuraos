import type { Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import nock from 'nock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterAdapter } from '../../../infra/llm/OpenRouterAdapter.js';

const EVIDENCE_MODEL = 'or:deepseek/deepseek-v4-flash';
const RAW_MODEL = 'deepseek/deepseek-v4-flash';

const logger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

describe('OpenRouterAdapter usage identity integration', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('sends a raw API model while persisting the canonical or:* evidence model', async () => {
    let requestModel: unknown;
    nock('https://openrouter.ai')
      .post('/api/v1/chat/completions', (body: unknown) => {
        requestModel = (body as { model?: unknown }).model;
        return true;
      })
      .reply(200, {
        id: 'adapter-evidence-test',
        model: RAW_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Research result' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });

    const usageSink = new FakeUsageSink();
    const adapter = new OpenRouterAdapter(
      'test-key',
      EVIDENCE_MODEL,
      'test-user',
      logger,
      usageSink
    );

    const result = await adapter.research('Find one source');

    expect(result.ok).toBe(true);
    expect(requestModel).toBe(`${RAW_MODEL}:online`);
    expect(usageSink.records).toEqual([
      expect.objectContaining({
        provider: 'openrouter',
        model: EVIDENCE_MODEL,
        callType: 'research',
        success: true,
      }),
    ]);
  });
});
