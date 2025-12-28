/**
 * @intexuraos/infra-notion
 *
 * Notion client and adapters.
 * Depends on @intexuraos/common-core and @intexuraos/infra-firestore.
 */

// Notion client
export {
  type NotionLogger,
  type NotionErrorCode,
  type NotionError,
  type NotionPagePreview,
  mapNotionError,
  createNotionClient,
  NotionClient,
  type BlockObjectResponse,
  validateNotionToken,
  getPageWithPreview,
  extractPageTitle,
} from './notion.js';

// Notion connection repository
export {
  type NotionConnectionPublic,
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
} from './notionConnection.js';
