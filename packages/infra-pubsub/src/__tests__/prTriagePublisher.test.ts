import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPRTriagePublisher } from '../prTriagePublisher.js';
import type { Logger } from 'pino';

const mockPublishMessage = vi.fn();

vi.mock('@google-cloud/pubsub', () => {
  class MockTopic {
    publishMessage = mockPublishMessage;
  }

  class MockPubSub {
    topic(): MockTopic {
      return new MockTopic();
    }
  }

  return {
    PubSub: MockPubSub,
  };
});

const stubLogger = (): Logger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => stubLogger()),
  }) as unknown as Logger;

describe('PRTriagePublisher', () => {
  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('msg-id');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds and publishes a PRTriageEvent with the supplied fields', async () => {
    const publisher = createPRTriagePublisher({
      projectId: 'p',
      topicName: 't',
      logger: stubLogger(),
    });

    const result = await publisher.publishPRTriage({
      eventId: 'evt-1',
      repository: 'pbuchman/intexuraos',
      pullRequestNumber: 1860,
      correlationId: 'corr-1',
    });

    expect(result.ok).toBe(true);
    expect(mockPublishMessage).toHaveBeenCalledTimes(1);
    const firstCall = mockPublishMessage.mock.calls[0];
    if (firstCall === undefined) throw new Error('expected publishMessage call');
    const data = JSON.parse(Buffer.from(firstCall[0].data).toString('utf-8'));
    expect(data).toMatchObject({
      type: 'code.pr.triage.requested',
      eventId: 'evt-1',
      repository: 'pbuchman/intexuraos',
      pullRequestNumber: 1860,
      correlationId: 'corr-1',
    });
    expect(typeof data.timestamp).toBe('string');
  });

  it('returns ok and skips publishing when topicName is empty', async () => {
    const logger = stubLogger();

    const publisher = createPRTriagePublisher({ projectId: 'p', topicName: '', logger });

    const result = await publisher.publishPRTriage({
      eventId: 'evt-1',
      repository: 'r/x',
      pullRequestNumber: 1,
      correlationId: 'c',
    });

    expect(result.ok).toBe(true);
    expect(mockPublishMessage).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
    mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));

    const publisher = createPRTriagePublisher({
      projectId: 'p',
      topicName: 't',
      logger: stubLogger(),
    });

    const result = await publisher.publishPRTriage({
      eventId: 'evt-2',
      repository: 'r/x',
      pullRequestNumber: 1,
      correlationId: 'c',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOPIC_NOT_FOUND');
      expect(result.error.message).toContain('NOT_FOUND');
    }
  });

  it('returns PERMISSION_DENIED error when access is denied', async () => {
    mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));

    const publisher = createPRTriagePublisher({
      projectId: 'p',
      topicName: 't',
      logger: stubLogger(),
    });

    const result = await publisher.publishPRTriage({
      eventId: 'evt-3',
      repository: 'r/x',
      pullRequestNumber: 1,
      correlationId: 'c',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.message).toContain('PERMISSION_DENIED');
    }
  });

  it('returns PUBLISH_FAILED error for other failures', async () => {
    mockPublishMessage.mockRejectedValue(new Error('boom'));

    const publisher = createPRTriagePublisher({
      projectId: 'p',
      topicName: 't',
      logger: stubLogger(),
    });

    const result = await publisher.publishPRTriage({
      eventId: 'evt-4',
      repository: 'r/x',
      pullRequestNumber: 1,
      correlationId: 'c',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PUBLISH_FAILED');
      expect(result.error.message).toContain('boom');
    }
  });
});
