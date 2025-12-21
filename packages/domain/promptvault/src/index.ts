/**
 * @praxos/domain-promptvault
 *
 * Prompt vault domain - prompt template management and versioning.
 *
 * Structure:
 * - models/    Domain entities (Prompt, PromptVaultError)
 * - ports/     Interfaces for external dependencies (PromptRepository)
 * - usecases/  Application services (Create, List, Get, Update)
 * - policies/  Validation and business rules (future)
 */

// =============================================================================
// Domain Models
// =============================================================================
export type { Prompt, PromptId, CreatePromptInput, UpdatePromptInput } from './models/index.js';

export type { PromptVaultError, PromptVaultErrorCode } from './models/index.js';
export { createPromptVaultError } from './models/index.js';

// =============================================================================
// Domain Ports
// =============================================================================
export type { PromptRepository } from './ports/index.js';

// =============================================================================
// Use Cases
// =============================================================================
export {
  createPrompt,
  createCreatePromptUseCase,
  listPrompts,
  createListPromptsUseCase,
  getPrompt,
  createGetPromptUseCase,
  updatePrompt,
  createUpdatePromptUseCase,
} from './usecases/index.js';

export type {
  CreatePromptUseCaseInput,
  ListPromptsUseCaseInput,
  GetPromptUseCaseInput,
  UpdatePromptUseCaseInput,
} from './usecases/index.js';

// =============================================================================
// Infrastructure Support Types (for infra adapters only)
// These types are kept for backward compatibility with existing infra layer.
// New code should use the domain models above.
// =============================================================================
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
