/**
 * User settings domain models.
 * Represents user preferences and configuration.
 */

/**
 * A notification filter configuration.
 * Requires a unique name and at least one filter criterion.
 */
export interface NotificationFilter {
  name: string; // Unique within user's filters
  app?: string; // e.g., "com.whatsapp"
  source?: string; // e.g., "tasker"
  title?: string; // Partial match, case-insensitive
}

/**
 * Notification-related settings.
 */
export interface NotificationSettings {
  filters: NotificationFilter[];
}

/**
 * User settings aggregate.
 */
export interface UserSettings {
  userId: string;
  notifications: NotificationSettings;
  createdAt: string;
  updatedAt: string;
}

/**
 * Creates default empty settings for a new user.
 */
export function createDefaultSettings(userId: string): UserSettings {
  const now = new Date().toISOString();
  return {
    userId,
    notifications: { filters: [] },
    createdAt: now,
    updatedAt: now,
  };
}
