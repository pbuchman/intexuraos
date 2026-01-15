import pino from 'pino';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActionEventPublisher } from '../infra/pubsub/actionEventPublisher.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';

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

describe('createActionEventPublisher', () => {
  const event: ActionCreatedEvent = {
    type: 'action.created',
    actionId: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    actionType: 'research',
    title: 'Test Research',
    payload: {
      prompt: 'Test prompt',
      confidence: 0.95,
    },
    timestamp: '2025-01-01T00:00:00.000Z',
  };

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'] = 'projects/test/topics/actions-queue';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates publisher instance', () => {
    const publisher = createActionEventPublisher({
      projectId: 'test-project',
      logger: pino({ name: 'test', level: 'silent' }),
    });

    expect(publisher).toBeDefined();
    expect(typeof publisher.publishActionCreated).toBe('function');
  });

  it('publishes action created event successfully', async () => {
    const publisher = createActionEventPublisher({
      projectId: 'test-project',
      logger: pino({ name: 'test', level: 'silent' }),
    });

    const result = await publisher.publishActionCreated(event);

    expect(result.ok).toBe(true);
  });

  it('returns error when queue topic not configured', async () => {
    delete process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'];

    const publisher = createActionEventPublisher({
      projectId: 'test-project',
      logger: pino({ name: 'test', level: 'silent' }),
    });

    const result = await publisher.publishActionCreated(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_TOPIC');
    }
  });
});
