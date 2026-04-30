/**
 * Tests for the transcription DLQ publisher.
 *
 * Mirrors the existing publisher-test pattern (mock @google-cloud/pubsub at
 * module scope; assert published payload, error mapping). The DLQ publisher
 * is only exercised on parse / schema failures, so we cover happy-path,
 * payload preservation, and the three PublishError code branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createTranscriptionDlqPublisher } from '../../publishers/transcription-dlq-publisher.js';
import type { TranscriptionDlqPublisherConfig } from '../../publishers/transcription-dlq-publisher.js';

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

describe('createTranscriptionDlqPublisher', () => {
  const mockLogger = pino({ name: 'test', level: 'silent' });
  const config: TranscriptionDlqPublisherConfig = {
    projectId: 'test-project',
    topicName: 'intexuraos-transcription-audio-stored-dlq-test',
    logger: mockLogger,
  };

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-dlq');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('publishes envelope with type, payload, reason, and timestamp', async () => {
    const publisher = createTranscriptionDlqPublisher(config);
    const payload = { message: { data: 'base64-blob' } };

    const result = await publisher.publish(payload, 'parse_error');

    expect(result.ok).toBe(true);
    expect(mockPublishMessage).toHaveBeenCalledTimes(1);

    const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
    const decoded = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

    expect(decoded['type']).toBe('srt.transcription.dead_letter');
    expect(decoded['payload']).toEqual(payload);
    expect(decoded['reason']).toBe('parse_error');
    expect(typeof decoded['timestamp']).toBe('string');
    // ISO 8601 sanity check
    expect(Number.isNaN(Date.parse(decoded['timestamp'] as string))).toBe(false);
  });

  it('preserves arbitrary unknown payload shapes (e.g. raw strings, undefined)', async () => {
    const publisher = createTranscriptionDlqPublisher(config);

    const result = await publisher.publish(undefined, 'missing_message_data');

    expect(result.ok).toBe(true);
    const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
    const decoded = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

    // JSON.stringify(undefined) drops the key, so the envelope must still
    // carry the failure reason even when the payload is non-serializable.
    expect(decoded['reason']).toBe('missing_message_data');
    expect(decoded['type']).toBe('srt.transcription.dead_letter');
  });

  it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
    mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));
    const publisher = createTranscriptionDlqPublisher(config);

    const result = await publisher.publish({}, 'parse_error');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOPIC_NOT_FOUND');
      expect(result.error.message).toContain('NOT_FOUND');
    }
  });

  it('returns PERMISSION_DENIED when access is denied', async () => {
    mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));
    const publisher = createTranscriptionDlqPublisher(config);

    const result = await publisher.publish({}, 'parse_error');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.message).toContain('PERMISSION_DENIED');
    }
  });

  it('returns PUBLISH_FAILED for other failures', async () => {
    mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));
    const publisher = createTranscriptionDlqPublisher(config);

    const result = await publisher.publish({}, 'parse_error');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PUBLISH_FAILED');
      expect(result.error.message).toContain('Connection timeout');
    }
  });
});
