/**
 * Tests for GCP Pub/Sub Publisher adapter.
 * Mocks @google-cloud/pubsub SDK.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GcpPubSubPublisher, getLogLevel } from '../../infra/pubsub/index.js';

// Create mock functions that persist
const mockPublishMessage = vi.fn();

// Mock the module before any imports
vi.mock('@google-cloud/pubsub', () => {
  const mockTopicInstance = {
    publishMessage: (args: unknown): Promise<string> => mockPublishMessage(args) as Promise<string>,
  };

  class MockPubSub {
    topic(): typeof mockTopicInstance {
      return mockTopicInstance;
    }
  }

  return {
    PubSub: MockPubSub,
  };
});

describe('getLogLevel', () => {
  it('returns silent for test environment', () => {
    expect(getLogLevel('test')).toBe('silent');
  });

  it('returns info for non-test environments', () => {
    expect(getLogLevel('development')).toBe('info');
    expect(getLogLevel('production')).toBe('info');
    expect(getLogLevel(undefined)).toBe('info');
  });
});

describe('GcpPubSubPublisher', () => {
  let publisher: GcpPubSubPublisher;

  beforeEach(() => {
    mockPublishMessage.mockReset();
    publisher = new GcpPubSubPublisher('test-project', 'media-cleanup-topic');
  });

  describe('publishMediaCleanup', () => {
    it('publishes event successfully', async () => {
      mockPublishMessage.mockResolvedValue('message-id-123');

      const result = await publisher.publishMediaCleanup({
        type: 'whatsapp.media.cleanup',
        messageId: 'msg-123',
        userId: 'user-456',
        gcsPaths: ['whatsapp/user-456/msg-123/media.ogg'],
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledWith({
        data: expect.any(Buffer) as Buffer,
      });
    });

    it('returns error when publish fails', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Pub/Sub unavailable'));

      const result = await publisher.publishMediaCleanup({
        type: 'whatsapp.media.cleanup',
        messageId: 'msg-123',
        userId: 'user-456',
        gcsPaths: ['path/to/file'],
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Pub/Sub unavailable');
      }
    });
  });

  describe('publishCommandIngest', () => {
    it('skips publish when topic is not configured', async () => {
      const result = await publisher.publishCommandIngest({
        type: 'command.ingest',
        userId: 'user-123',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.abc',
        text: 'Test command',
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).not.toHaveBeenCalled();
    });

    it('publishes event when topic is configured', async () => {
      const publisherWithTopic = new GcpPubSubPublisher(
        'test-project',
        'media-cleanup-topic',
        'commands-ingest-topic'
      );
      mockPublishMessage.mockResolvedValue('message-id-456');

      const result = await publisherWithTopic.publishCommandIngest({
        type: 'command.ingest',
        userId: 'user-123',
        sourceType: 'whatsapp_voice',
        externalId: 'wamid.voice123',
        text: 'Voice transcription text',
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledWith({
        data: expect.any(Buffer) as Buffer,
      });
    });

    it('returns error when publish fails', async () => {
      const publisherWithTopic = new GcpPubSubPublisher(
        'test-project',
        'media-cleanup-topic',
        'commands-ingest-topic'
      );
      mockPublishMessage.mockRejectedValue(new Error('Topic unavailable'));

      const result = await publisherWithTopic.publishCommandIngest({
        type: 'command.ingest',
        userId: 'user-789',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.fail',
        text: 'Test',
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Topic unavailable');
      }
    });
  });
});
