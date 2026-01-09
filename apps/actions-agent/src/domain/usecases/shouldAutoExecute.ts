import type { ActionCreatedEvent } from '../models/actionEvent.js';

/**
 * Determines whether an action should be auto-executed based on confidence
 * and action type. Currently returns false for all actions (stub implementation).
 *
 * Future implementation will evaluate:
 * - Action type (some types may always require approval)
 * - Confidence score from classification
 * - User preferences
 */
export function shouldAutoExecute(_event: ActionCreatedEvent): boolean {
  return false;
}
