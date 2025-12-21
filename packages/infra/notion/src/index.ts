/**
 * @praxos/infra-notion
 *
 * Notion infrastructure adapter - implements promptvault, actions, and inbox domain ports.
 *
 * Structure:
 * - adapter.ts            NotionApiPort implementation using Notion SDK
 * - promptRepository.ts   PromptRepository implementation using Notion
 * - inboxNotesRepository.ts InboxNotesRepository implementation using Notion
 * - testing/              Mock adapters for use in tests
 */

// Adapters
export { NotionApiAdapter, type NotionLogger } from './adapter.js';
export { createNotionPromptRepository } from './promptRepository.js';
export {
  NotionInboxNotesRepository,
  type NotionInboxNotesConfig,
} from './inboxNotesRepository.js';

// Testing utilities (for use by consuming packages)
export { MockNotionApiAdapter, type CapturedPromptVaultNote } from './testing/index.js';
