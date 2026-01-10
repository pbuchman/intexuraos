/**
 * Composite feed domain models.
 */

/**
 * Configuration for a notification filter within a composite feed.
 * app is multi-select (array), source is single-select (string).
 */
export interface NotificationFilterConfig {
  id: string;
  name: string;
  app?: string[];
  source?: string;
  title?: string;
}

/**
 * A composite feed aggregating static data sources and notification filters.
 */
export interface CompositeFeed {
  id: string;
  userId: string;
  name: string;
  purpose: string;
  staticSourceIds: string[];
  notificationFilters: NotificationFilterConfig[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Request to create a new composite feed.
 */
export interface CreateCompositeFeedRequest {
  purpose: string;
  staticSourceIds: string[];
  notificationFilters: NotificationFilterConfig[];
}

/**
 * Request to update an existing composite feed.
 */
export interface UpdateCompositeFeedRequest {
  purpose?: string;
  staticSourceIds?: string[];
  notificationFilters?: NotificationFilterConfig[];
}

/**
 * Maximum number of static sources allowed per composite feed.
 */
export const MAX_STATIC_SOURCES = 5;

/**
 * Maximum number of notification filters allowed per composite feed.
 */
export const MAX_NOTIFICATION_FILTERS = 3;

/**
 * Maximum length for feed name.
 */
export const MAX_FEED_NAME_LENGTH = 200;

/**
 * Maximum length for feed purpose.
 */
export const MAX_PURPOSE_LENGTH = 1000;
