/**
 * Firestore infrastructure for promptvault-service.
 */
export {
  type NotionConnectionPublic,
  type NotionError,
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
} from './notionConnectionRepository.js';
