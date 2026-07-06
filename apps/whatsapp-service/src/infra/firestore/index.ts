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

export {
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
  PRIVATE_WHATSAPP_SENDERS_COLLECTION,
  PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
  createPrivateWhatsAppChatId,
  createPrivateWhatsAppMessageId,
  createPrivateWhatsAppSenderDayId,
  createPrivateWhatsAppSenderId,
  createPrivateWhatsAppRepository,
} from './privateWhatsAppRepository.js';

export {
  TRANSCRIPT_CHUNK_MAX_BYTES,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
  createConversationAssistantRepository,
} from './conversationAssistantRepository.js';
