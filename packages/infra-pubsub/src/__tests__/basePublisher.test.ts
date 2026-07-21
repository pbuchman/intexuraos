import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { BasePubSubPublisher, type PublishContext } from '../basePublisher.js';
import { runWithRequestContext } from '../requestContextShim.js';
import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '../types.js';

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

class TestPublisher extends BasePubSubPublisher {
  async publish(
    topicName: string,
    event: unknown,
    context: PublishContext
  ): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(topicName, event, context, 'test event');
  }

  async publishOptional(
    topicName: string | null,
    event: unknown,
    context: PublishContext
  ): Promise<Result<void, PublishError>> {
    return await this.publishToOptionalTopic(topicName, event, context, 'test optional event');
  }

  async publishWithReceipt(
    topicName: string,
    event: unknown,
    context: PublishContext
  ): Promise<Result<string, PublishError>> {
    return await this.publishToTopicWithReceipt(topicName, event, context, 'test receipt event');
  }

  async publishWithSafeReceipt(
    topicName: string,
    event: unknown,
    context: PublishContext
  ): Promise<Result<string, PublishError>> {
    return await this.publishToTopicWithSafeReceipt(
      topicName,
      event,
      context,
      'test safe receipt event'
    );
  }
}

describe('BasePubSubPublisher', () => {
  let publisher: TestPublisher;
  const mockLogger = pino({ name: 'test', level: 'silent' });

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
    publisher = new TestPublisher({ projectId: 'test-project', logger: mockLogger });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('publishToTopic', () => {
    it('returns the provider publication receipt only through the explicit receipt seam', async () => {
      await expect(
        publisher.publishWithReceipt('test-topic', { data: 'test' }, {})
      ).resolves.toEqual({ ok: true, value: 'message-id-123' });
    });

    it('redacts provider failures from the safe receipt result and application logs', async () => {
      const privateProviderError = 'private-provider-error-fixture';
      const error = vi.fn();
      const safePublisher = new TestPublisher({
        projectId: 'test-project',
        logger: {
          info: vi.fn(),
          error,
        } as unknown as pino.Logger,
      });
      mockPublishMessage.mockRejectedValueOnce(new Error(privateProviderError));

      const result = await safePublisher.publishWithSafeReceipt(
        'test-topic',
        { data: 'private-payload-fixture' },
        { eventKind: 'matrix_corpus_ingest' }
      );

      expect(result).toEqual({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Pub/Sub publication failed' },
      });
      expect(JSON.stringify(error.mock.calls)).not.toContain(privateProviderError);
      expect(JSON.stringify(error.mock.calls)).not.toContain('private-payload-fixture');
    });

    it('publishes event successfully', async () => {
      const result = await publisher.publish('test-topic', { data: 'test' }, { id: '123' });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
    });

    it('caches topic references', async () => {
      await publisher.publish('test-topic', { data: '1' }, {});
      await publisher.publish('test-topic', { data: '2' }, {});

      expect(mockPublishMessage).toHaveBeenCalledTimes(2);
    });

    it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
      mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));

      const result = await publisher.publish('missing-topic', { data: 'test' }, {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOPIC_NOT_FOUND');
        expect(result.error.message).toContain('NOT_FOUND');
        expect(result.error.message).toContain('missing-topic');
      }
    });

    it('returns PERMISSION_DENIED error when access is denied', async () => {
      mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));

      const result = await publisher.publish('forbidden-topic', { data: 'test' }, {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('PERMISSION_DENIED');
        expect(result.error.message).toContain('forbidden-topic');
      }
    });

    it('returns PUBLISH_FAILED error for other failures', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));

      const result = await publisher.publish('test-topic', { data: 'test' }, {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('Connection timeout');
      }
    });
  });

  describe('publishToOptionalTopic', () => {
    it('skips publishing when topic is null', async () => {
      const result = await publisher.publishOptional(null, { data: 'test' }, { id: '123' });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).not.toHaveBeenCalled();
    });

    it('publishes when topic is provided', async () => {
      const result = await publisher.publishOptional(
        'optional-topic',
        { data: 'test' },
        { id: '456' }
      );

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
    });

    it('publishToOptionalTopic sets correlation attributes when context exists', async () => {
      await runWithRequestContext({ requestId: 'opt-r', correlationId: 'opt-c' }, async () => {
        await publisher.publishOptional('optional-topic', { data: 'test' }, {});
      });

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect(call.attributes['x-request-id']).toBe('opt-r');
      expect(call.attributes['x-correlation-id']).toBe('opt-c');
    });
  });

  describe('correlation attributes', () => {
    it('sets x-request-id and x-correlation-id from request context', async () => {
      await runWithRequestContext({ requestId: 'r-1', correlationId: 'r-1' }, async () => {
        await publisher.publish('test-topic', { data: 'test' }, {});
      });

      expect(mockPublishMessage).toHaveBeenCalledTimes(1);
      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        data: Buffer;
        attributes: Record<string, string>;
      };
      expect(call.data).toBeInstanceOf(Buffer);
      expect(call.attributes['x-request-id']).toBe('r-1');
      expect(call.attributes['x-correlation-id']).toBe('r-1');
    });

    it('omits correlation attributes outside any request context but keeps publisher-service', async () => {
      await publisher.publish('test-topic', { data: 'test' }, {});

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect('x-request-id' in call.attributes).toBe(false);
      expect('x-correlation-id' in call.attributes).toBe(false);
      expect(call.attributes['publisher-service']).toBeDefined();
    });

    it('does not publish tracing attributes when correlation context exists', async () => {
      await runWithRequestContext({ requestId: 'r-1', correlationId: 'r-1' }, async () => {
        await publisher.publish('test-topic', { data: 'test' }, {});
      });

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect('traceparent' in call.attributes).toBe(false);
    });

    it('uses INTEXURAOS_SERVICE_NAME for publisher-service when set', async () => {
      vi.stubEnv('INTEXURAOS_SERVICE_NAME', 'whatsapp-service');
      await publisher.publish('test-topic', { data: 'test' }, {});

      const call = mockPublishMessage.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect(call.attributes['publisher-service']).toBe('whatsapp-service');
    });

    it('falls back to "unknown" for publisher-service when env var is absent', async () => {
      const original = process.env['INTEXURAOS_SERVICE_NAME'];
      delete process.env['INTEXURAOS_SERVICE_NAME'];
      try {
        await publisher.publish('test-topic', { data: 'test' }, {});
        const call = mockPublishMessage.mock.calls[0]?.[0] as {
          attributes: Record<string, string>;
        };
        expect(call.attributes['publisher-service']).toBe('unknown');
      } finally {
        if (original !== undefined) {
          process.env['INTEXURAOS_SERVICE_NAME'] = original;
        } else {
          delete process.env['INTEXURAOS_SERVICE_NAME'];
        }
      }
    });
  });
});
