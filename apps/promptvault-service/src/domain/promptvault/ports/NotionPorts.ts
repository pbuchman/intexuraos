/**
 * Domain ports for Notion integration.
 * These interfaces define what the domain needs from infrastructure
 * without depending on any external SDKs.
 */
import type { Result } from '@praxos/common';

/**
 * Notion connection configuration for a user.
 * Token is never exposed in this type.
 */
export interface NotionConnectionConfig {
  userId: string;
  promptVaultPageId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public config returned to API responses.
 * Never includes token.
 */
export type NotionConnectionPublic = Omit<NotionConnectionConfig, 'userId'>;

/**
 * Notion page metadata.
 */
export interface NotionPage {
  id: string;
  title: string;
  url: string;
}

/**
 * Notion block preview.
 */
export interface NotionBlock {
  type: string;
  content: string;
}

/**
 * Created note result.
 */
export interface CreatedNote {
  id: string;
  url: string;
  title: string;
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
export interface NotionConnectionRepository {
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

  /**
   * Check if a user has an active Notion connection.
   */
  isConnected(userId: string): Promise<Result<boolean, NotionError>>;

  /**
   * Get the user's Notion token (for internal use only).
   * This should only be called by adapters that need to make API calls.
   */
  getToken(userId: string): Promise<Result<string | null, NotionError>>;
}

/**
 * Parameters for creating a PromptVault note.
 */
export interface CreatePromptVaultNoteParams {
  token: string;
  parentPageId: string;
  title: string;
  prompt: string;
  userId: string;
}

/**
 * Port for Notion API operations.
 */
export interface NotionApiPort {
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
  ): Promise<Result<{ page: NotionPage; blocks: NotionBlock[] }, NotionError>>;

  /**
   * Create a PromptVault note with exact block structure:
   * 1. heading_2: "Prompt"
   * 2. code block (markdown): verbatim prompt content
   * 3. heading_2: "Meta"
   * 4. bulleted_list_item: "Source: GPT PromptVault"
   * 5. bulleted_list_item: "UserId: {userId}"
   */
  createPromptVaultNote(
    params: CreatePromptVaultNoteParams
  ): Promise<Result<CreatedNote, NotionError>>;

  /**
   * List all child pages under a parent page.
   * Returns page metadata for each child.
   */
  listChildPages(token: string, parentPageId: string): Promise<Result<NotionPage[], NotionError>>;

  /**
   * Get a prompt page with its full content.
   * Extracts the prompt text from the code block.
   */
  getPromptPage(
    token: string,
    pageId: string
  ): Promise<
    Result<
      { page: NotionPage; promptContent: string; createdAt?: string; updatedAt?: string },
      NotionError
    >
  >;

  /**
   * Update a prompt page's title and/or content.
   */
  updatePromptPage(
    token: string,
    pageId: string,
    update: { title?: string; promptContent?: string }
  ): Promise<Result<{ page: NotionPage; promptContent: string; updatedAt?: string }, NotionError>>;
}

/**
 * Port for idempotency ledger.
 */
export interface IdempotencyLedger {
  /**
   * Check if an operation was already performed.
   * Returns the stored result if found.
   */
  get(userId: string, idempotencyKey: string): Promise<Result<CreatedNote | null, NotionError>>;

  /**
   * Store the result of an operation.
   */
  set(
    userId: string,
    idempotencyKey: string,
    result: CreatedNote
  ): Promise<Result<void, NotionError>>;
}
