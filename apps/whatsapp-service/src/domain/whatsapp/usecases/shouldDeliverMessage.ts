/**
 * shouldDeliverMessage use case.
 *
 * Decides whether an outbound WhatsApp message should be delivered given the
 * recipient's notification level preference and the message's importance flag.
 */
import type { NotificationLevel } from '../models/NotificationPreferences.js';

export interface ShouldDeliverMessageInput {
  readonly level: NotificationLevel;
  readonly important: boolean | undefined;
}

export function shouldDeliverMessage(input: ShouldDeliverMessageInput): boolean {
  if (input.level === 'all') return true;
  return input.important === true;
}
