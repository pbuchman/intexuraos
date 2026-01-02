import { describe, it, expect, vi } from 'vitest';
import {
  createResearchEventPublisher,
  type ResearchProcessEvent,
} from '../../../infra/pubsub/researchEventPublisher.js';

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

describe('createResearchEventPublisher', () => {
  const event: ResearchProcessEvent = {
    type: 'research.process',
    researchId: 'research-123',
    userId: 'user-456',
    triggeredBy: 'create',
  };

  it('creates publisher instance', () => {
    const publisher = createResearchEventPublisher({
      projectId: 'test-project',
      topicName: 'test-topic',
    });

    expect(publisher).toBeDefined();
    expect(typeof publisher.publishProcessResearch).toBe('function');
  });

  it('publishes research process event successfully', async () => {
    const publisher = createResearchEventPublisher({
      projectId: 'test-project',
      topicName: 'test-topic',
    });

    const result = await publisher.publishProcessResearch(event);

    expect(result.ok).toBe(true);
  });

  it('publishes approve-triggered event', async () => {
    const publisher = createResearchEventPublisher({
      projectId: 'test-project',
      topicName: 'test-topic',
    });

    const result = await publisher.publishProcessResearch({
      ...event,
      triggeredBy: 'approve',
    });

    expect(result.ok).toBe(true);
  });
});
