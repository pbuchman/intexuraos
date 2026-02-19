import type { ActionCreatedEvent } from '../models/actionEvent.js';

const AUTO_EXECUTE_THRESHOLD = 0.9;

/**
 * Determines whether an action should be auto-executed based on confidence.
 *
 * All action types with >= 90% confidence are auto-executed.
 * Below threshold, the user is prompted for approval via WhatsApp.
 */
export function shouldAutoExecute(event: ActionCreatedEvent): boolean {
  return event.payload.confidence >= AUTO_EXECUTE_THRESHOLD;
}
