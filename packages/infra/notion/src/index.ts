/**
 * @praxos/infra-notion
 *
 * Notion infrastructure adapter - implements promptvault and actions domain ports.
 *
 * Structure:
 * - adapter.ts          NotionApiPort implementation using Notion SDK
 * - promptRepository.ts PromptRepository implementation using Notion
 * - testing/            Mock adapters for use in tests
 */

// Adapters
export { NotionApiAdapter } from './adapter.js';
export { createNotionPromptRepository } from './promptRepository.js';

// Testing utilities (for use by consuming packages)
export { MockNotionApiAdapter, type CapturedPromptVaultNote } from './testing/index.js';
