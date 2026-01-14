import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getActionsQueueTopic } from '../../../infra/pubsub/config.js';

describe('getActionsQueueTopic', () => {
  const originalEnv = process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'];

  beforeEach(() => {
    delete process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'] = originalEnv;
    } else {
      delete process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'];
    }
  });

  it('returns null when env var is undefined', () => {
    expect(getActionsQueueTopic()).toBeNull();
  });

  it('returns null when env var is empty string', () => {
    process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'] = '';
    expect(getActionsQueueTopic()).toBeNull();
  });

  it('returns topic name when env var is set', () => {
    process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'] = 'test-actions-queue';
    expect(getActionsQueueTopic()).toBe('test-actions-queue');
  });
});
