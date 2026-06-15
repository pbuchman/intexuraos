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
  findRetryableWebhookEvents,
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
  findByWaMessageId,
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
  createVerificationWithChecks,
} from './phoneVerificationRepository.js';

export {
  getPreferences,
  savePreferences,
} from './notificationPreferencesRepository.js';
