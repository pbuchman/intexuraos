/**
 * @praxos/domain-promptvault
 *
 * Prompt vault domain - prompt template management and versioning.
 *
 * Structure:
 * - ports/     Interfaces for external dependencies
 * - models/    Domain entities (future)
 * - usecases/  Application services (future)
 * - policies/  Validation and business rules (future)
 */

// Ports - interfaces for external dependencies
export type {
  NotionConnectionConfig,
  NotionConnectionPublic,
  NotionPage,
  NotionBlock,
  CreatedNote,
  NotionErrorCode,
  NotionError,
  NotionConnectionRepository,
  NotionApiPort,
  IdempotencyLedger,
  CreatePromptVaultNoteParams,
} from './ports.js';
export {
  NOTION_ERROR_CODES,
  isNotionErrorCode,
  type NotionErrorCodeRuntime,
} from './notionErrorCode.js';
