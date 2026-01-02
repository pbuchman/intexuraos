/**
 * Tests for WhatsApp Send Publisher.
 * Mocks @google-cloud/pubsub SDK to test publishing without real Pub/Sub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWhatsAppSendPublisher } from '../whatsappSendPublisher.js';
import type { WhatsAppSendPublisherConfig } from '../types.js';

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

describe('createWhatsAppSendPublisher', () => {
  const config: WhatsAppSendPublisherConfig = {
    projectId: 'test-project',
    topicName: 'test-whatsapp-send-topic',
  };

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('publishSendMessage', () => {
    it('publishes message with all required fields', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello from test',
        correlationId: 'corr-123',
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['type']).toBe('whatsapp.message.send');
      expect(publishedData['userId']).toBe('user-123');
      expect(publishedData['message']).toBe('Hello from test');
      expect(publishedData['correlationId']).toBe('corr-123');
      expect(publishedData['timestamp']).toBeDefined();
    });

    it('generates correlationId when not provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['correlationId']).toBeDefined();
      expect(typeof publishedData['correlationId']).toBe('string');
      expect((publishedData['correlationId'] as string).length).toBeGreaterThan(0);
    });

    it('includes replyToMessageId when provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Reply message',
        replyToMessageId: 'wamid.original123',
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['replyToMessageId']).toBe('wamid.original123');
    });

    it('omits replyToMessageId when not provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Simple message',
      });

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(Object.prototype.hasOwnProperty.call(publishedData, 'replyToMessageId')).toBe(false);
    });

    it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
      mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));

      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOPIC_NOT_FOUND');
        expect(result.error.message).toContain('NOT_FOUND');
      }
    });

    it('returns PERMISSION_DENIED error when access is denied', async () => {
      mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));

      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('PERMISSION_DENIED');
      }
    });

    it('returns PUBLISH_FAILED error for other failures', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));

      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('Connection timeout');
      }
    });
  });
});
