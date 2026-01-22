/**
 * Calendar Preview Publisher.
 * Publishes CalendarPreviewGenerateEvent to Pub/Sub for calendar-agent to process.
 */
import { type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher } from './basePublisher.js';
import type {
  PublishError,
  CalendarPreviewGenerateEvent,
  CalendarPreviewPublisherConfig,
} from './types.js';

/**
 * Interface for publishing calendar preview generation events.
 */
export interface CalendarPreviewPublisher {
  /**
   * Publish a preview generation request to Pub/Sub.
   * The event will be processed by calendar-agent's generate-preview endpoint.
   */
  publishGeneratePreview(params: {
    actionId: string;
    userId: string;
    text: string;
    currentDate: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

/**
 * Calendar preview publisher using BasePubSubPublisher.
 */
class CalendarPreviewPublisherImpl extends BasePubSubPublisher implements CalendarPreviewPublisher {
  private readonly topicName: string;

  constructor(config: CalendarPreviewPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishGeneratePreview(params: {
    actionId: string;
    userId: string;
    text: string;
    currentDate: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>> {
    const correlationId = params.correlationId ?? crypto.randomUUID();

    const event: CalendarPreviewGenerateEvent = {
      type: 'calendar.preview.generate',
      actionId: params.actionId,
      userId: params.userId,
      text: params.text,
      currentDate: params.currentDate,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    return await this.publishToTopic(
      this.topicName,
      event,
      { correlationId, userId: params.userId, actionId: params.actionId },
      'Calendar preview generate'
    );
  }
}

/**
 * Create a calendar preview publisher.
 */
export function createCalendarPreviewPublisher(
  config: CalendarPreviewPublisherConfig
): CalendarPreviewPublisher {
  return new CalendarPreviewPublisherImpl(config);
}
