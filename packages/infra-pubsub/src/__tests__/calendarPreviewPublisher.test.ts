/**
 * Tests for Calendar Preview Publisher.
 * Mocks @google-cloud/pubsub SDK to test publishing without real Pub/Sub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createCalendarPreviewPublisher } from '../calendarPreviewPublisher.js';
import type { CalendarPreviewPublisherConfig } from '../types.js';

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

describe('createCalendarPreviewPublisher', () => {
  const mockLogger = pino({ name: 'test', level: 'silent' });
  const config: CalendarPreviewPublisherConfig = {
    projectId: 'test-project',
    topicName: 'test-calendar-preview-topic',
    logger: mockLogger,
  };

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('publishGeneratePreview', () => {
    it('publishes calendar.preview.generate event with all required fields', async () => {
      const publisher = createCalendarPreviewPublisher(config);

      const result = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
        correlationId: 'corr-789',
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['type']).toBe('calendar.preview.generate');
      expect(publishedData['actionId']).toBe('action-123');
      expect(publishedData['userId']).toBe('user-456');
      expect(publishedData['text']).toBe('Preview my calendar');
      expect(publishedData['currentDate']).toBe('2025-01-25');
      expect(publishedData['correlationId']).toBe('corr-789');
      expect(publishedData['timestamp']).toBeDefined();
    });

    it('generates correlationId when not provided', async () => {
      const publisher = createCalendarPreviewPublisher(config);

      const result = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['correlationId']).toBeDefined();
      expect(typeof publishedData['correlationId']).toBe('string');
      expect((publishedData['correlationId'] as string).length).toBeGreaterThan(0);
    });

    it('generates unique correlationIds for each call when not provided', async () => {
      const publisher = createCalendarPreviewPublisher(config);

      const result1 = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
      });

      const result2 = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      const call1 = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const call2 = mockPublishMessage.mock.calls[1] as [{ data: Buffer }];
      const publishedData1 = JSON.parse(call1[0].data.toString()) as Record<string, unknown>;
      const publishedData2 = JSON.parse(call2[0].data.toString()) as Record<string, unknown>;

      expect(publishedData1['correlationId']).toBeDefined();
      expect(publishedData2['correlationId']).toBeDefined();
      expect(publishedData1['correlationId']).not.toBe(publishedData2['correlationId']);
    });

    it('verifies event structure has correct type', async () => {
      const publisher = createCalendarPreviewPublisher(config);

      const result = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
        correlationId: 'corr-789',
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['type']).toBe('calendar.preview.generate');
    });

    it('verifies publishToTopic called with correct arguments', async () => {
      const publisher = createCalendarPreviewPublisher(config);

      const result = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
        correlationId: 'corr-789',
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);

      const call = mockPublishMessage.mock.calls[0] as [unknown];
      expect(call[0]).toBeDefined();
    });

    it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
      mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));

      const publisher = createCalendarPreviewPublisher(config);

      const result = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOPIC_NOT_FOUND');
        expect(result.error.message).toContain('NOT_FOUND');
      }
    });

    it('returns PERMISSION_DENIED error when access is denied', async () => {
      mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));

      const publisher = createCalendarPreviewPublisher(config);

      const result = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('PERMISSION_DENIED');
      }
    });

    it('returns PUBLISH_FAILED error for other failures', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));

      const publisher = createCalendarPreviewPublisher(config);

      const result = await publisher.publishGeneratePreview({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Preview my calendar',
        currentDate: '2025-01-25',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('Connection timeout');
      }
    });
  });
});
