/**
 * Notion infrastructure for promptvault-service.
 */
export {
  type Prompt,
  type PromptVaultError,
  createPrompt,
  listPrompts,
  getPrompt,
  updatePrompt,
} from './promptApi.js';

// Re-export shared Notion utilities from infra-notion
export { validateNotionToken, getPageWithPreview } from '@intexuraos/infra-notion';
