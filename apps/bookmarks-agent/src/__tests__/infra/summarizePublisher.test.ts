import pino from 'pino';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSummarizePublisher,
} from '../../infra/pubsub/summarizePublisher.js';
import type { SummarizeBookmarkEvent } from '../../domain/ports/summarizePublisher.js';

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

describe('createSummarizePublisher', () => {
  const event: SummarizeBookmarkEvent = {
    type: 'bookmarks.summarize',
    bookmarkId: 'bookmark-123',
    userId: 'user-456',
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
    const publisher = createSummarizePublisher({
      projectId: 'test-project',
      topicName: 'bookmark-summarize-topic',
      logger: pino({ name: 'test', level: 'silent' }),
    });

    expect(publisher).toBeDefined();
    expect(typeof publisher.publishSummarizeBookmark).toBe('function');
  });

  it('publishes bookmark summarize event successfully', async () => {
    const publisher = createSummarizePublisher({
      projectId: 'test-project',
      topicName: 'bookmark-summarize-topic',
      logger: pino({ name: 'test', level: 'silent' }),
    });

    const result = await publisher.publishSummarizeBookmark(event);

    expect(result.ok).toBe(true);
  });

  it('returns error when topic not configured', async () => {
    const publisher = createSummarizePublisher({
      projectId: 'test-project',
      topicName: null,
      logger: pino({ name: 'test', level: 'silent' }),
    });

    const result = await publisher.publishSummarizeBookmark(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_TOPIC');
    }
  });
});
