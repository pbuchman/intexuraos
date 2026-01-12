/**
 * Composite feed domain ports.
 */
import type { Result } from '@intexuraos/common-core';
import type {
  CompositeFeed,
  CreateCompositeFeedRequest,
  UpdateCompositeFeedRequest,
  NotificationFilterConfig,
} from '../models/index.js';

/**
 * Repository interface for composite feed persistence.
 */
export interface CompositeFeedRepository {
  /**
   * Create a new composite feed.
   */
  create(
    userId: string,
    name: string,
    request: CreateCompositeFeedRequest
  ): Promise<Result<CompositeFeed, string>>;

  /**
   * Get a composite feed by ID for a specific user.
   * Returns null if not found or not owned by user.
   */
  getById(id: string, userId: string): Promise<Result<CompositeFeed | null, string>>;

  /**
   * List all composite feeds for a user.
   */
  listByUserId(userId: string): Promise<Result<CompositeFeed[], string>>;

  /**
   * List ALL composite feeds across all users.
   * Used by scheduler for batch refresh operations.
   */
  listAll(): Promise<Result<CompositeFeed[], string>>;

  /**
   * Update an existing composite feed.
   * Only updates if owned by the specified user.
   */
  update(
    id: string,
    userId: string,
    request: UpdateCompositeFeedRequest
  ): Promise<Result<CompositeFeed, string>>;

  /**
   * Update data insights for a composite feed.
   * Only updates if owned by the specified user.
   */
  updateDataInsights(
    id: string,
    userId: string,
    dataInsights: import('../models/index.js').CompositeFeed['dataInsights']
  ): Promise<Result<CompositeFeed, string>>;

  /**
   * Delete a composite feed.
   * Only deletes if owned by the specified user.
   */
  delete(id: string, userId: string): Promise<Result<void, string>>;

  /**
   * Find composite feeds that reference a specific static source.
   * Used for deletion validation.
   */
  findByStaticSourceId(
    userId: string,
    staticSourceId: string
  ): Promise<Result<CompositeFeed[], string>>;
}

/**
 * Error from name generation operations.
 */
export interface NameGenerationError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR';
  message: string;
}

/**
 * Service for generating feed names using AI.
 */
export interface FeedNameGenerationService {
  /**
   * Generate a name for a composite feed based on its purpose and components.
   */
  generateName(
    userId: string,
    purpose: string,
    sourceNames: string[],
    filterNames: string[]
  ): Promise<Result<string, NameGenerationError>>;
}

/**
 * A notification item from mobile notifications.
 * (Matches the structure from mobile-notifications-service internal API)
 */
export interface MobileNotificationItem {
  id: string;
  app: string;
  title: string;
  body: string;
  timestamp: string;
  source?: string;
}

/**
 * Client for querying mobile notifications.
 */
export interface MobileNotificationsClient {
  /**
   * Query notifications matching a filter.
   */
  queryNotifications(
    userId: string,
    filter: NotificationFilterConfig
  ): Promise<Result<MobileNotificationItem[], string>>;
}
