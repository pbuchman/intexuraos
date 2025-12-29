/**
 * Domain ports for notion-service integration.
 * These interfaces define what the domain needs from infrastructure
 * without depending on any external SDKs.
 */
import type { Result } from '@intexuraos/common-core';

/**
 * Notion connection configuration for a user.
 * Token is never exposed in this type.
 */
export interface NotionConnectionPublic {
  promptVaultPageId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Notion page metadata with preview.
 */
export interface NotionPagePreview {
  page: {
    id: string;
    title: string;
    url: string;
  };
  blocks: {
    type: string;
    content: string;
  }[];
}

/**
 * Domain error types for Notion operations.
 */
export type NotionErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface NotionError {
  code: NotionErrorCode;
  message: string;
  requestId?: string;
}

/**
 * Port for managing user Notion connections (persisted in Firestore).
 */
export interface ConnectionRepository {
  /**
   * Store or update a user's Notion connection.
   * Token is stored securely (encrypted/opaque).
   */
  saveConnection(
    userId: string,
    promptVaultPageId: string,
    notionToken: string
  ): Promise<Result<NotionConnectionPublic, NotionError>>;

  /**
   * Get a user's Notion connection config.
   * Returns null if not configured.
   */
  getConnection(userId: string): Promise<Result<NotionConnectionPublic | null, NotionError>>;

  /**
   * Mark a user's Notion connection as disconnected.
   */
  disconnectConnection(userId: string): Promise<Result<NotionConnectionPublic, NotionError>>;
}

/**
 * Port for Notion API operations.
 */
export interface NotionApi {
  /**
   * Validate a token by making a metadata call.
   * Used for health checks and connection validation.
   */
  validateToken(token: string): Promise<Result<boolean, NotionError>>;

  /**
   * Get page metadata and preview blocks.
   */
  getPageWithPreview(
    token: string,
    pageId: string
  ): Promise<Result<NotionPagePreview, NotionError>>;
}
