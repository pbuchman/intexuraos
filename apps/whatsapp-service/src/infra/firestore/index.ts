/**
 * Firestore infrastructure for whatsapp-service.
 */
export {
  type WebhookProcessingStatus,
  type IgnoredReason,
  type WhatsAppWebhookEvent,
  type InboxError,
  saveWebhookEvent,
  updateWebhookEventStatus,
  getWebhookEvent,
} from './webhookEventRepository.js';

export {
  type WhatsAppUserMappingPublic,
  saveUserMapping,
  getUserMapping,
  findUserByPhoneNumber,
  findPhoneByUserId,
  disconnectUserMapping,
  isUserConnected,
} from './userMappingRepository.js';

export {
  saveMessage,
  getMessagesByUser,
  getMessage,
  findById,
  updateTranscription,
  updateLinkPreview,
  deleteMessage,
} from './messageRepository.js';
