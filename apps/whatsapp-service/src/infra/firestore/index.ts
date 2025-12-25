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
  disconnectUserMapping,
  isUserConnected,
} from './userMappingRepository.js';

export {
  type WhatsAppMessage,
  type WhatsAppMessageMetadata,
  saveMessage,
  getMessagesByUser,
  getMessage,
  deleteMessage,
} from './messageRepository.js';
