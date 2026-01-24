/**
 * Pub/Sub infrastructure types.
 */
import type { Logger } from 'pino';

/**
 * Error returned when a publish operation fails.
 */
export interface PublishError {
  code: 'PUBLISH_FAILED' | 'TOPIC_NOT_FOUND' | 'PERMISSION_DENIED';
  message: string;
}

/**
 * Event to send a WhatsApp message.
 * This is the payload format expected by whatsapp-service's Pub/Sub handler.
 * Phone number lookup is done internally by whatsapp-service using userId.
 */
export interface SendMessageEvent {
  /**
   * Event type identifier.
   */
  type: 'whatsapp.message.send';

  /**
   * IntexuraOS user ID. whatsapp-service looks up the phone number internally.
   */
  userId: string;

  /**
   * Message text to send.
   */
  message: string;

  /**
   * Optional: WhatsApp message ID to reply to.
   */
  replyToMessageId?: string;

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
 * Configuration for the WhatsApp send publisher.
 */
export interface WhatsAppSendPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}

/**
 * Event to process a newly created todo.
 * This is the payload format expected by todos-agent's Pub/Sub handler.
 */
export interface TodoProcessingEvent {
  /**
   * Event type identifier.
   */
  type: 'todos.processing.created';

  /**
   * The ID of the todo to process.
   */
  todoId: string;

  /**
   * The user who owns the todo.
   */
  userId: string;

  /**
   * The todo title (for logging/debugging).
   */
  title: string;

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
 * Configuration for the todos processing publisher.
 */
export interface TodosProcessingPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}

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
