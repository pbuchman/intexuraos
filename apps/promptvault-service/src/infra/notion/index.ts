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

// Re-export shared Notion utilities from common
export { validateNotionToken, getPageWithPreview } from '@intexuraos/common';
