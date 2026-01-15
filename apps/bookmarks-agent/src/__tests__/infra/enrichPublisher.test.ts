import pino from 'pino';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createEnrichPublisher,
  type EnrichBookmarkEvent,
} from '../../infra/pubsub/enrichPublisher.js';

vi.mock('@intexuraos/infra-pubsub', () => ({
  BasePubSubPublisher: class {
    protected projectId: string;

    constructor(config: { projectId: string; logger: { level: string } }) {
      this.projectId = config.projectId;
    }

    async publishToTopic(
      topicName: string | null,
      _data: unknown,
      _attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      if (topicName === null) {
        return { ok: false, error: { code: 'NO_TOPIC', message: 'No topic configured' } };
      }
      return { ok: true, value: undefined };
    }
  },
}));

describe('createEnrichPublisher', () => {
  const event: EnrichBookmarkEvent = {
    type: 'bookmarks.enrich',
    bookmarkId: 'bookmark-123',
    userId: 'user-456',
    url: 'https://example.com/page',
  };

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates publisher instance', () => {
    const publisher = createEnrichPublisher({
      projectId: 'test-project',
      topicName: 'bookmark-enrich-topic',
      logger: pino({ name: 'test', level: 'silent' }),
    });

    expect(publisher).toBeDefined();
    expect(typeof publisher.publishEnrichBookmark).toBe('function');
  });

  it('publishes bookmark enrich event successfully', async () => {
    const publisher = createEnrichPublisher({
      projectId: 'test-project',
      topicName: 'bookmark-enrich-topic',
      logger: pino({ name: 'test', level: 'silent' }),
    });

    const result = await publisher.publishEnrichBookmark(event);

    expect(result.ok).toBe(true);
  });

  it('returns error when topic not configured', async () => {
    const publisher = createEnrichPublisher({
      projectId: 'test-project',
      topicName: null,
      logger: pino({ name: 'test', level: 'silent' }),
    });

    const result = await publisher.publishEnrichBookmark(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_TOPIC');
    }
  });
});
