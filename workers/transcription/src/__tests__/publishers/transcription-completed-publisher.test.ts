import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  const config: TranscriptionCompletedPublisherConfig = {
    projectId: 'test-project',
    topicName: 'intexuraos-transcription-completed-test',
    logger: pino({ name: 'test', level: 'silent' }),
  };

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-completed');
  });

  it('publishes transcription completion events with publisher attributes', async () => {
    const publisher = createTranscriptionCompletedPublisher(config);
    const event: TranscriptionCompletedEvent = {
      type: 'srt.transcription.completed',
      userId: 'user-1',
      messageId: 'message-1',
      jobId: 'job-1',
      status: 'completed',
      transcript: 'hello',
      timestamp: '2026-06-30T11:15:00.000Z',
    };

    const result = await publisher.publishCompleted(event);

    expect(result.ok).toBe(true);
    expect(mockPublishMessage).toHaveBeenCalledTimes(1);

    const call = mockPublishMessage.mock.calls[0] as [
      { data: Buffer; attributes: Record<string, string> },
    ];
    expect(JSON.parse(call[0].data.toString())).toEqual(event);
    expect(call[0].attributes).toEqual({ 'publisher-service': 'unknown' });
  });
});
