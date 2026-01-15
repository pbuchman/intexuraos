import type { ActionCreatedEvent } from '../models/actionEvent.js';

/**
 * Determines whether an action should be auto-executed based on confidence
 * and action type.
 *
 * Current auto-execution rules:
 * - link actions with 100% confidence (1.0) are auto-executed
 *
 * Future enhancements may include:
 * - Additional action types
 * - User preferences for auto-execution threshold
 * - Different confidence thresholds for different action types
 */
export function shouldAutoExecute(event: ActionCreatedEvent): boolean {
  return event.actionType === 'link' && event.payload.confidence === 1;
}
