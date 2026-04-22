/**
 * Notification preferences domain model.
 *
 * Controls which WhatsApp messages a user receives:
 * - 'all' (default): deliver every outbound message.
 * - 'important': only deliver messages explicitly flagged important.
 *
 * This field is PRIVATE — never returned from /whatsapp/status, never
 * published on Pub/Sub, never read by any other service.
 */

/**
 * User-facing notification importance level.
 */
export type NotificationLevel = 'all' | 'important';

/**
 * Default level applied when a user has no stored preference.
 */
export const DEFAULT_NOTIFICATION_LEVEL: NotificationLevel = 'all';

/**
 * Type guard narrowing unknown inputs to a valid NotificationLevel.
 * Used to coerce unexpected stored values back to the default.
 */
export function isNotificationLevel(value: unknown): value is NotificationLevel {
  return value === 'all' || value === 'important';
}

/**
 * Persisted notification preferences for a single user.
 */
export interface NotificationPreferences {
  readonly notificationLevel: NotificationLevel;
}
