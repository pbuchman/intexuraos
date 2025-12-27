/**
 * Tests for GCP Pub/Sub Publisher adapter.
 * Mocks @google-cloud/pubsub SDK.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { GcpPubSubPublisher } from '../../infra/pubsub/publisher.js';

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
        data: expect.any(Buffer),
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
});
