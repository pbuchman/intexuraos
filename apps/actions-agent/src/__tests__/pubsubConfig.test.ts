import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getActionsQueueTopic } from '../infra/pubsub/config.js';

describe('getActionsQueueTopic', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns topic when configured', () => {
    process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'] = 'projects/test/topics/actions-queue';

    const result = getActionsQueueTopic();

    expect(result).toBe('projects/test/topics/actions-queue');
  });

  it('returns null when topic is not configured', () => {
    delete process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'];

    const result = getActionsQueueTopic();

    expect(result).toBeNull();
  });

  it('returns null when topic is empty string', () => {
    process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'] = '';

    const result = getActionsQueueTopic();

    expect(result).toBeNull();
  });
});
