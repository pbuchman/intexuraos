/**
 * Tests for LlmCallPublisher.
 * Verifies Pub/Sub message publishing for individual LLM calls.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createLlmCallPublisher,
  type LlmCallEvent,
} from '../../../infra/pubsub/llmCallPublisher.js';

vi.mock('@intexuraos/infra-pubsub', () => ({
  BasePubSubPublisher: class {
    protected projectId: string;
    protected loggerName: string;

    constructor(config: { projectId: string; loggerName: string }) {
      this.projectId = config.projectId;
      this.loggerName = config.loggerName;
    }

    async publishToTopic(
      _topicName: string,
      _data: unknown,
      _attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      return { ok: true, value: undefined };
    }
  },
}));

describe('LlmCallPublisher', () => {
  const event: LlmCallEvent = {
    type: 'llm.call',
    researchId: 'research-123',
    userId: 'user-456',
    provider: 'google',
    prompt: 'Test prompt',
  };

  it('creates publisher instance', () => {
    const publisher = createLlmCallPublisher({
      projectId: 'test-project',
      topicName: 'test-topic',
    });

    expect(publisher).toBeDefined();
    expect(typeof publisher.publishLlmCall).toBe('function');
  });

  it('publishes LLM call event successfully', async () => {
    const publisher = createLlmCallPublisher({
      projectId: 'test-project',
      topicName: 'test-topic',
    });

    const result = await publisher.publishLlmCall(event);

    expect(result.ok).toBe(true);
  });

  it('publishes event for different providers', async () => {
    const publisher = createLlmCallPublisher({
      projectId: 'test-project',
      topicName: 'test-topic',
    });

    const providers: ('google' | 'openai' | 'anthropic')[] = ['google', 'openai', 'anthropic'];

    for (const provider of providers) {
      const result = await publisher.publishLlmCall({
        ...event,
        provider,
      });
      expect(result.ok).toBe(true);
    }
  });
});
