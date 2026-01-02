import { describe, it, expect, vi } from 'vitest';
import {
  createAnalyticsEventPublisher,
  type LlmAnalyticsEvent,
} from '../../../infra/pubsub/analyticsEventPublisher.js';

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

describe('createAnalyticsEventPublisher', () => {
  const event: LlmAnalyticsEvent = {
    type: 'llm.report',
    researchId: 'research-123',
    userId: 'user-456',
    provider: 'google',
    model: 'gemini-1.5-pro',
    inputTokens: 1500,
    outputTokens: 3000,
    durationMs: 2500,
  };

  it('creates publisher instance', () => {
    const publisher = createAnalyticsEventPublisher({
      projectId: 'test-project',
      topicName: 'test-analytics-topic',
    });

    expect(publisher).toBeDefined();
    expect(typeof publisher.publishLlmAnalytics).toBe('function');
  });

  it('publishes LLM analytics event successfully', async () => {
    const publisher = createAnalyticsEventPublisher({
      projectId: 'test-project',
      topicName: 'test-analytics-topic',
    });

    const result = await publisher.publishLlmAnalytics(event);

    expect(result.ok).toBe(true);
  });

  it('publishes analytics for different providers', async () => {
    const publisher = createAnalyticsEventPublisher({
      projectId: 'test-project',
      topicName: 'test-analytics-topic',
    });

    const openaiEvent: LlmAnalyticsEvent = {
      ...event,
      provider: 'openai',
      model: 'gpt-4o',
    };

    const result = await publisher.publishLlmAnalytics(openaiEvent);

    expect(result.ok).toBe(true);
  });
});
