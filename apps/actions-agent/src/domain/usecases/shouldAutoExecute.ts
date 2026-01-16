import type { ActionCreatedEvent } from '../models/actionEvent.js';

const LINK_AUTO_EXECUTE_THRESHOLD = 0.9;

/**
 * Determines whether an action should be auto-executed based on confidence
 * and action type.
 *
 * Current auto-execution rules:
 * - link actions with >= 90% confidence are auto-executed
 *
 * Future enhancements may include:
 * - Additional action types
 * - User preferences for auto-execution threshold
 * - Different confidence thresholds for different action types
 */
export function shouldAutoExecute(event: ActionCreatedEvent): boolean {
  return event.actionType === 'link' && event.payload.confidence >= LINK_AUTO_EXECUTE_THRESHOLD;
}
