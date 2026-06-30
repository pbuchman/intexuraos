import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createTranscriptionCompletedPublisher } from '../../publishers/transcription-completed-publisher.js';
import type { TranscriptionCompletedPublisherConfig } from '../../publishers/transcription-completed-publisher.js';
import type { TranscriptionCompletedEvent } from '../../types.js';

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

describe('createTranscriptionCompletedPublisher', () => {
  const originalServiceName = process.env['INTEXURAOS_SERVICE_NAME'];
  const config: TranscriptionCompletedPublisherConfig = {
    projectId: 'test-project',
    topicName: 'intexuraos-transcription-completed-test',
    logger: pino({ name: 'test', level: 'silent' }),
  };
  const event: TranscriptionCompletedEvent = {
    type: 'srt.transcription.completed',
    userId: 'user-1',
    messageId: 'message-1',
    jobId: 'job-1',
    status: 'completed',
    transcript: 'hello',
    timestamp: '2026-06-30T11:15:00.000Z',
  };

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-completed');
    process.env['INTEXURAOS_SERVICE_NAME'] = 'transcription';
  });

  afterEach(() => {
    if (originalServiceName === undefined) {
      delete process.env['INTEXURAOS_SERVICE_NAME'];
    } else {
      process.env['INTEXURAOS_SERVICE_NAME'] = originalServiceName;
    }
    vi.clearAllMocks();
  });

  it('publishes transcription completion events with publisher attributes', async () => {
    const publisher = createTranscriptionCompletedPublisher(config);

    const result = await publisher.publishCompleted(event);

    expect(result.ok).toBe(true);
    expect(mockPublishMessage).toHaveBeenCalledTimes(1);

    const call = mockPublishMessage.mock.calls[0] as [
      { data: Buffer; attributes: Record<string, string> },
    ];
    expect(JSON.parse(call[0].data.toString())).toEqual(event);
    expect(call[0].attributes).toEqual({ 'publisher-service': 'transcription' });
  });

  it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
    mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));
    const publisher = createTranscriptionCompletedPublisher(config);

    const result = await publisher.publishCompleted(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOPIC_NOT_FOUND');
      expect(result.error.message).toContain('NOT_FOUND');
    }
  });

  it('returns PERMISSION_DENIED when access is denied', async () => {
    mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));
    const publisher = createTranscriptionCompletedPublisher(config);

    const result = await publisher.publishCompleted(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.message).toContain('PERMISSION_DENIED');
    }
  });

  it('returns PUBLISH_FAILED for other failures', async () => {
    mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));
    const publisher = createTranscriptionCompletedPublisher(config);

    const result = await publisher.publishCompleted(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PUBLISH_FAILED');
      expect(result.error.message).toContain('Connection timeout');
    }
  });
});
