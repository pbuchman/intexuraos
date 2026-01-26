/**
 * Firestore infrastructure for whatsapp-service.
 */
export {
  type WebhookProcessingStatus,
  type IgnoredReason,
  type WhatsAppWebhookEvent,
  type WhatsAppError,
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

export {
  createVerification,
  findVerificationById,
  findPendingByUserAndPhone,
  isPhoneVerified,
  updateVerificationStatus,
  incrementVerificationAttempts,
  countRecentVerificationsByPhone,
} from './phoneVerificationRepository.js';
