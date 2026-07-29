/**
 * Domain layer for Inbox.
 * Exports all public domain types, models, and use cases.
 */

// Models
export type { WhatsAppErrorCode, WhatsAppError, WhatsAppResult } from './models/error.js';

export {
  DEFAULT_NOTIFICATION_LEVEL,
  isNotificationLevel,
  type NotificationLevel,
  type NotificationPreferences,
} from './models/NotificationPreferences.js';

export type {
  WhatsAppMessage,
  WhatsAppMessageMetadata,
  WhatsAppMediaType,
  WhatsAppMediaInfo,
  TranscriptionState,
  TranscriptionStatus,
  TranscriptionApiOperation,
  TranscriptionError,
  TranscriptionApiCall,
} from './models/WhatsAppMessage.js';

export type {
  LinkPreview,
  LinkPreviewStatus,
  LinkPreviewError,
  LinkPreviewState,
} from './models/LinkPreview.js';

export type {
  PhoneVerification,
  PhoneVerificationPublic,
  PhoneVerificationStatus,
} from './models/PhoneVerification.js';

export type {
  DisablePrivateWhatsAppAccountInput,
  PrivateWhatsAppAccount,
  PrivateWhatsAppAccountStatus,
  PrivateWhatsAppChat,
  PrivateWhatsAppChatInput,
  PrivateWhatsAppChatQueryInput,
  PrivateWhatsAppChatQueryResult,
  PrivateWhatsAppChatType,
  PrivateWhatsAppDeliveryMode,
  PrivateWhatsAppAggregateRebuildInput,
  PrivateWhatsAppAggregateRebuildResult,
  PrivateWhatsAppIngestEventResult,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppIngestResult,
  PrivateWhatsAppConversationContextMessageResult,
  PrivateConversationContextMessage,
  PrivateConversationContextOmittedCounts,
  PrivateConversationContextOmittedMessage,
  PrivateConversationContextOmissionReason,
  PrivateConversationContextResponse,
  PrivateWhatsAppMediaInfo,
  PrivateWhatsAppMediaStorageStatus,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageDirection,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppMessageQueryResult,
  PrivateWhatsAppMessageInput,
  PrivateWhatsAppMessageType,
  PrivateWhatsAppReactionInfo,
  PrivateWhatsAppReactionInput,
  PrivateWhatsAppReactionQueryInput,
  PrivateWhatsAppReactionQueryResult,
  PrivateWhatsAppReactionSummary,
  PrivateWhatsAppTranscriptionError,
  PrivateWhatsAppTranscriptionState,
  PrivateWhatsAppTranscriptionStatus,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderQueryInput,
  PrivateWhatsAppSenderQueryResult,
  PrivateWhatsAppSenderDay,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderDayQueryResult,
  PrivateWhatsAppSummaryStatus,
  StorePrivateWhatsAppMessageInput,
  UpdatePrivateWhatsAppChatTranscriptionInput,
  UpdatePrivateWhatsAppMessageStoredMediaInput,
  UpdatePrivateWhatsAppMessageStoredMediaResult,
  UpdatePrivateWhatsAppMessageTranscriptionInput,
  UpdatePrivateWhatsAppMessageTranscriptionResult,
  UpsertPrivateWhatsAppAccountInput,
} from './models/PrivateWhatsApp.js';

export type {
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextChangeType,
  PrivateWhatsAppContextJournalQueryInput,
  PrivateWhatsAppContextJournalQueryResult,
  PrivateWhatsAppContextMessagesByIdsInput,
  PrivateWhatsAppContextProjection,
  PrivateWhatsAppOwnedChatInput,
} from './models/PrivateWhatsAppContextJournal.js';

export type {
  PrivateDigestChatType,
  PrivateDigestSourceError,
  PrivateDigestMessage,
  PrivateDigestMessageReferenceFactory,
  PrivateDigestMessageReferenceInput,
  PrivateDigestSourcePosition,
  PrivateDigestSourceRevisionClaims,
  QueryPrivateDigestMessagesInput,
  QueryPrivateDigestMessagesResult,
  ValidatePrivateDigestSourceInput,
  ValidatedPrivateDigestSource,
} from './models/PrivateWhatsAppDigestSource.js';

export {
  emptyPrivateWhatsAppErasureCounts,
  type PrivateWhatsAppErasureCounts,
  type PrivateWhatsAppErasureRequest,
  type PrivateWhatsAppErasureStage,
  type PrivateWhatsAppErasureStatus,
  type PrivateWhatsAppErasureWorkItem,
} from './models/PrivateWhatsAppErasure.js';

// Ports
export type {
  WhatsAppUserMapping,
  WhatsAppUserMappingPublic,
  WhatsAppUserMappingRepository,
  WebhookProcessingStatus,
  IgnoredReason,
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
  WhatsAppMessageRepository,
  PhoneVerificationRepository,
} from './ports/repositories.js';

export type {
  MediaStoragePort,
  PrivateMediaDeletionBatchInput,
  PrivateMediaDeletionBatchResult,
  UploadResult,
} from './ports/mediaStorage.js';

export type {
  WhatsAppCloudApiPort,
  MediaUrlInfo,
  SendMessageResult,
} from './ports/whatsappCloudApi.js';

export type { ThumbnailGeneratorPort, ThumbnailResult } from './ports/thumbnailGenerator.js';

export type {
  EventPublisherPort,
  MatrixCorpusPublishReceipt,
} from './ports/eventPublisher.js';

export type {
  WhatsAppMessageDigestTemplate,
  WhatsAppMessageSender,
} from './ports/messageSender.js';

export type { TextMessageSendResult } from './ports/messageSender.js';
export { WHATSAPP_MESSAGE_SEND_TIMEOUT_MS } from './ports/messageSender.js';

export type { LinkPreviewFetcherPort } from './ports/linkPreviewFetcher.js';

export type {
  OutboundMessage,
  OutboundDeliveryState,
  OutboundMessageRepository,
} from './ports/outboundMessageRepository.js';

export type {
  WhatsAppDeliveryReadiness,
  WhatsAppDeliveryReadinessPort,
} from './ports/whatsappDeliveryReadiness.js';

export type {
  MessageDigestDeliveryAuthorizationClient,
  MessageDigestDeliveryAuthorizationIdentity,
} from './ports/messageDigestDeliveryAuthorization.js';

export type { NotificationPreferencesRepository } from './ports/notificationPreferencesRepository.js';

export type { PrivateWhatsAppRepository } from './ports/privateWhatsAppRepository.js';

export type {
  PrivateDigestSourceCursorClaims,
  PrivateDigestSourceHighWatermarkClaims,
  PrivateDigestSourceMessageReferenceClaims,
  PrivateDigestSourceRawPage,
  PrivateDigestSourceRouteBinding,
  PrivateDigestSourceTokenCodec,
  PrivateWhatsAppDigestSourceRepository,
} from './ports/privateWhatsAppDigestSourceRepository.js';

export type {
  AdvancePrivateWhatsAppErasureResult,
  PrivateWhatsAppErasurePublisher,
  PrivateWhatsAppErasureRepository,
  StartPrivateWhatsAppErasureResult,
} from './ports/privateWhatsAppErasure.js';

export {
  createPrivateWhatsAppChatId,
  createPrivateWhatsAppMessageId,
  createPrivateWhatsAppSenderDayId,
  createPrivateWhatsAppSenderId,
} from './utils/privateWhatsAppIds.js';

export {
  projectPrivateDigestMessages,
  validatePrivateDigestSource,
  type PrivateWhatsAppDigestSourceDeps,
} from './usecases/privateWhatsAppDigestSource.js';

export {
  readPrivateWhatsAppDigestSource,
  type ReadPrivateWhatsAppDigestSourceDeps,
} from './usecases/readPrivateWhatsAppDigestSource.js';

export {
  createWhatsAppDeliveryReadiness,
  type WhatsAppDeliveryReadinessDeps,
} from './usecases/whatsappDeliveryReadiness.js';

// Events
export type {
  AudioStoredEvent,
  ConversationAssistantContextAttachmentPreparationRequestedEvent,
  ConversationAssistantPreparationRequestedEvent,
  ExtractLinkPreviewsEvent,
  IntexMessageIngestEvent,
  IntexMessageSourceType,
  MatrixCorpusSignedIngestEvent,
  MediaCleanupEvent,
  MediaTranscriptionRequestedEvent,
  SendMessageEvent,
  TranscriptionCompletedEvent,
  WebhookProcessEvent,
  WhatsAppEvent,
  WhatsAppInteractiveButton,
} from './events/index.js';

// Use cases
export {
  ProcessImageMessageUseCase,
  type ProcessImageMessageInput,
  type ProcessImageMessageResult,
  type ProcessImageMessageDeps,
  type ProcessImageMessageLogger,
  type ImageMediaInfo,
} from './usecases/processImageMessage.js';

export {
  ProcessAudioMessageUseCase,
  type ProcessAudioMessageInput,
  type ProcessAudioMessageResult,
  type ProcessAudioMessageDeps,
  type ProcessAudioMessageLogger,
  type AudioMediaInfo,
} from './usecases/processAudioMessage.js';

export {
  ProcessVideoMessageUseCase,
  type ProcessVideoMessageInput,
  type ProcessVideoMessageResult,
  type ProcessVideoMessageDeps,
  type ProcessVideoMessageLogger,
  type VideoMediaInfo,
} from './usecases/processVideoMessage.js';

export {
  ExtractLinkPreviewsUseCase,
  type ExtractLinkPreviewsInput,
  type ExtractLinkPreviewsDeps,
  type ExtractLinkPreviewsLogger,
} from './usecases/extractLinkPreviews.js';

export {
  ProcessWebhookEventUseCase,
  type ProcessWebhookEventDeps,
  type ProcessWebhookEventResult,
} from './usecases/processWebhookEventUseCase.js';

export {
  RetryPendingWebhookEventsUseCase,
  type RetryPendingWebhookEventsInput,
  type RetryPendingWebhookEventsResult,
} from './usecases/retryPendingWebhookEvents.js';

export {
  IngestPrivateWhatsAppEventsUseCase,
  type IngestPrivateWhatsAppEventInput,
  type IngestPrivateWhatsAppEventsDeps,
  type IngestPrivateWhatsAppEventsInput,
} from './usecases/ingestPrivateWhatsAppEvents.js';

export {
  BackfillPrivateWhatsAppStoredMediaUseCase,
  type BackfillPrivateWhatsAppStoredMediaDeps,
  type BackfillPrivateWhatsAppStoredMediaInput,
  type BackfillPrivateWhatsAppStoredMediaResult,
} from './usecases/backfillPrivateWhatsAppStoredMedia.js';

export {
  shouldDeliverMessage,
  type ShouldDeliverMessageInput,
} from './usecases/shouldDeliverMessage.js';

export {
  processPrivateWhatsAppErasureBatch,
  requestPrivateWhatsAppErasure,
  type PrivateWhatsAppErasureDeps,
  type RequestPrivateWhatsAppErasureResult,
} from './usecases/privateWhatsAppErasure.js';

// Utilities
export { normalizePhoneNumber } from './utils/index.js';
