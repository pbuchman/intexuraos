/**
 * Base Pub/Sub Publisher.
 * Provides common functionality for all Pub/Sub publishers.
 */
import { PubSub, type Topic } from '@google-cloud/pubsub';
import { type Logger } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { PublishError } from './types.js';

/**
 * Configuration for BasePubSubPublisher.
 */
export interface BasePubSubPublisherConfig {
  projectId: string;
  logger: Logger;
}

/**
 * Context for logging during publish operations.
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
   * @param context - Additional context for logging (e.g., { messageId, userId })
   * @param eventDescription - Human-readable description for logs (e.g., "media cleanup")
   * @returns Result indicating success or failure
   */
  protected async publishToTopic(
    topicName: string,
    event: unknown,
    context: PublishContext,
    eventDescription: string
  ): Promise<Result<void, PublishError>> {
    try {
      const topic = this.getTopic(topicName);
      const data = Buffer.from(JSON.stringify(event));

      this.logger.info(
        { topic: topicName, ...context },
        `Publishing ${eventDescription} event to Pub/Sub`
      );

      await topic.publishMessage({ data });

      this.logger.info(
        { topic: topicName, ...context },
        `Successfully published ${eventDescription} event`
      );

      return ok(undefined);
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      this.logger.error(
        { topic: topicName, ...context, error: errorMessage },
        `Failed to publish ${eventDescription} event`
      );

      return err(this.mapError(topicName, errorMessage));
    }
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
   * @param context - Additional context for logging
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
      this.logger.debug(
        { ...context, event },
        `Topic not configured, skipping ${eventDescription}`
      );
      return ok(undefined);
    }

    return await this.publishToTopic(topicName, event, context, eventDescription);
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
