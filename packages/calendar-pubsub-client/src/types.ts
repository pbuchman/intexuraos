/**
 * Types for the calendar-preview Pub/Sub client.
 */
import type { Logger } from 'pino';

/**
 * Event to generate a calendar preview.
 * This is the payload format expected by calendar-agent's Pub/Sub handler.
 */
export interface CalendarPreviewGenerateEvent {
  /**
   * Event type identifier.
   */
  type: 'calendar.preview.generate';

  /**
   * The action ID to generate preview for.
   */
  actionId: string;

  /**
   * The user who owns the action.
   */
  userId: string;

  /**
   * The natural language text to extract event from.
   */
  text: string;

  /**
   * Current date for relative date parsing (ISO 8601 date).
   */
  currentDate: string;

  /**
   * Correlation ID for tracing across services.
   */
  correlationId: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Configuration for the calendar preview publisher.
 */
export interface CalendarPreviewPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}
