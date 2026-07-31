/**
 * Base Pub/Sub Publisher.
 * Provides common functionality for all Pub/Sub publishers.
 */
import { PubSub, type Topic } from '@google-cloud/pubsub';
import { type Logger } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { PublishError } from './types.js';
import { getRequestContext } from './requestContextShim.js';

/**
 * Configuration for BasePubSubPublisher.
 */
export interface BasePubSubPublisherConfig {
  projectId: string;
  logger: Logger;
}

/**
 * Context for logging during publish operations.
 *
 * Values are accepted for source compatibility but deliberately excluded from
 * application logs. Event payloads and identifiers may be private.
 */
export type PublishContext = Record<string, unknown>;

/**
 * Base class for Pub/Sub publishers.
 * Provides common functionality for publishing messages to topics.
 */
export abstract class BasePubSubPublisher {
  protected readonly pubsub: PubSub;
  protected readonly logger: Logger;
  private readonly topicCache = new Map<string, Topic>();

  constructor(config: BasePubSubPublisherConfig) {
    this.pubsub = new PubSub({ projectId: config.projectId });
    this.logger = config.logger;
  }

  /**
   * Publish an event to a Pub/Sub topic.
   *
   * Use this for REQUIRED topics — the calling subclass must validate the topic
   * is configured at construction time. The signature is `string` (not nullable)
   * to make misconfiguration impossible at the type level. If a topic is genuinely
   * optional, use {@link publishToOptionalTopic} instead.
   *
   * @param topicName - The topic to publish to (required, non-null)
   * @param event - The event payload (will be JSON serialized)
   * @param context - Opaque caller context; deliberately excluded from logs
   * @param eventDescription - Human-readable description for logs (e.g., "media cleanup")
   * @returns Result indicating success or failure
   */
  protected async publishToTopic(
    topicName: string,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>> {
    const result = await this.publishToTopicWithReceipt(
      topicName,
      event,
      context,
      eventDescription
    );
    return result.ok ? ok(undefined) : result;
  }

  /**
   * Publish to a required topic and return the provider acknowledgement ID. Callers must keep
   * this opaque and must not log or persist it without applying their own one-way digest.
   */
  protected async publishToTopicWithReceipt(
    topicName: string,
    event: unknown,
    _context: PublishContext,
    eventDescription: string
  ): Promise<Result<string, PublishError>> {
    try {
      const topic = this.getTopic(topicName);
      const data = Buffer.from(JSON.stringify(event));

      this.logger.info({ topic: topicName }, `Publishing ${eventDescription} event to Pub/Sub`);

      const attributes = buildPublishAttributes();

      const publicationReceipt = await topic.publishMessage({ data, attributes });

      this.logger.info({ topic: topicName }, `Successfully published ${eventDescription} event`);

      return ok(publicationReceipt);
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      this.logger.error(
        { topic: topicName, error: errorMessage },
        `Failed to publish ${eventDescription} event`
      );

      return err(this.mapError(topicName, errorMessage));
    }
  }

  /**
   * Publish to a required topic while keeping provider failures outside application
   * logs and returned errors. This is reserved for privacy-sensitive payloads whose
   * provider error may contain serialized message data.
   */
  protected async publishToTopicWithSafeReceipt(
    topicName: string,
    event: unknown,
    _context: PublishContext,
    eventDescription: string
  ): Promise<Result<string, PublishError>> {
    try {
      const topic = this.getTopic(topicName);
      const data = Buffer.from(JSON.stringify(event));

      this.logger.info({ topic: topicName }, `Publishing ${eventDescription} event to Pub/Sub`);

      const publicationReceipt = await topic.publishMessage({
        data,
        attributes: buildPublishAttributes(),
      });

      this.logger.info({ topic: topicName }, `Successfully published ${eventDescription} event`);

      return ok(publicationReceipt);
    } catch {
      this.logger.error({ topic: topicName }, `Failed to publish ${eventDescription} event`);
      return err({ code: 'PUBLISH_FAILED', message: 'Pub/Sub publication failed' });
    }
  }

  /**
   * Publish a privacy-sensitive event without exposing provider errors, payloads,
   * publication receipts, or caller context through logs and return values.
   */
  protected async publishToTopicSafely(
    topicName: string,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>> {
    const result = await this.publishToTopicWithSafeReceipt(
      topicName,
      event,
      context,
      eventDescription
    );
    return result.ok ? ok(undefined) : result;
  }

  /**
   * Publish an event to a Pub/Sub topic that may not be configured.
   *
   * Use this only for genuinely OPTIONAL topics where a `null` topic name is
   * an expected, valid runtime state (e.g., a fire-and-forget integration that
   * has not been wired up in this environment). Skips the publish and returns
   * success when `topicName` is `null`. For required topics, use
   * {@link publishToTopic} so misconfiguration cannot silently no-op.
   *
   * @param topicName - The topic to publish to, or `null` to skip
   * @param event - The event payload (will be JSON serialized)
   * @param context - Opaque caller context; deliberately excluded from logs
   * @param eventDescription - Human-readable description for logs
   * @returns Result indicating success or failure (skip is success)
   */
  protected async publishToOptionalTopic(
    topicName: string | null,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>> {
    if (topicName === null) {
      this.logger.debug({}, `Topic not configured, skipping ${eventDescription}`);
      return ok(undefined);
    }

    return await this.publishToTopic(topicName, event, context, eventDescription);
  }

  /**
   * Privacy-safe counterpart of {@link publishToOptionalTopic}.
   */
  protected async publishToOptionalTopicSafely(
    topicName: string | null,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>> {
    if (topicName === null) {
      this.logger.debug({}, `Topic not configured, skipping ${eventDescription}`);
      return ok(undefined);
    }

    return await this.publishToTopicSafely(topicName, event, context, eventDescription);
  }

  /**
   * Get or create a topic reference (cached for performance).
   */
  private getTopic(topicName: string): Topic {
    let topic = this.topicCache.get(topicName);
    if (topic === undefined) {
      topic = this.pubsub.topic(topicName);
      this.topicCache.set(topicName, topic);
    }
    return topic;
  }

  /**
   * Map error messages to PublishError codes.
   */
  private mapError(topicName: string, errorMessage: string): PublishError {
    if (errorMessage.includes('NOT_FOUND')) {
      return {
        code: 'TOPIC_NOT_FOUND',
        message: `Topic ${topicName} not found: ${errorMessage}`,
      };
    }

    if (errorMessage.includes('PERMISSION_DENIED')) {
      return {
        code: 'PERMISSION_DENIED',
        message: `Permission denied for topic ${topicName}: ${errorMessage}`,
      };
    }

    return {
      code: 'PUBLISH_FAILED',
      message: `Failed to publish message: ${errorMessage}`,
    };
  }
}

/**
 * Build the Pub/Sub message attributes for an outbound publish.
 *
 * Always sets `publisher-service` (from `INTEXURAOS_SERVICE_NAME`, falling back
 * to `'unknown'`). When a {@link RequestContext} is active, propagates
 * `x-request-id` and `x-correlation-id` so downstream subscribers can
 * extract them via `extractCorrelation`.
 */
function buildPublishAttributes(): Record<string, string> {
  const serviceName = process.env['INTEXURAOS_SERVICE_NAME'];
  const attributes: Record<string, string> = {
    'publisher-service': serviceName !== undefined && serviceName !== '' ? serviceName : 'unknown',
  };

  const ctx = getRequestContext();
  if (ctx !== undefined) {
    attributes['x-request-id'] = ctx.requestId;
    attributes['x-correlation-id'] = ctx.correlationId;
  }

  return attributes;
}
