/**
 * Firestore infrastructure for notion-service.
 * Exports Notion connection repository (owned by notion-service).
 */
export {
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
} from './notionConnectionRepository.js';

export type {
  NotionConnectionPublic,
  NotionError,
} from '../../domain/integration/ports/ConnectionRepository.js';
