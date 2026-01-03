/**
 * Domain layer for Inbox.
 * Exports all public domain types, models, and use cases.
 */

// Models
export type { WhatsAppErrorCode, WhatsAppError, WhatsAppResult } from './models/error.js';

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
} from './ports/repositories.js';

export type { MediaStoragePort, UploadResult } from './ports/mediaStorage.js';

export type {
  WhatsAppCloudApiPort,
  MediaUrlInfo,
  SendMessageResult,
} from './ports/whatsappCloudApi.js';

export type { ThumbnailGeneratorPort, ThumbnailResult } from './ports/thumbnailGenerator.js';

export type { EventPublisherPort } from './ports/eventPublisher.js';

export type { WhatsAppMessageSender } from './ports/messageSender.js';

export type {
  SpeechTranscriptionPort,
  TranscriptionJobInput,
  TranscriptionJobSubmitResult,
  TranscriptionJobStatus,
  TranscriptionJobPollResult,
  TranscriptionTextResult,
  TranscriptionPortError,
} from './ports/transcription.js';

export type { LinkPreviewFetcherPort } from './ports/linkPreviewFetcher.js';

// Events
export type {
  AudioStoredEvent,
  CommandIngestEvent,
  ExtractLinkPreviewsEvent,
  MediaCleanupEvent,
  SendMessageEvent,
  TranscribeAudioEvent,
  TranscriptionCompletedEvent,
  WebhookProcessEvent,
  WhatsAppEvent,
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
  TranscribeAudioUseCase,
  type TranscribeAudioInput,
  type TranscribeAudioDeps,
  type TranscribeAudioLogger,
  type TranscriptionPollingConfig,
  DEFAULT_TRANSCRIPTION_POLL_CONFIG,
} from './usecases/transcribeAudio.js';

export {
  ExtractLinkPreviewsUseCase,
  type ExtractLinkPreviewsInput,
  type ExtractLinkPreviewsDeps,
  type ExtractLinkPreviewsLogger,
} from './usecases/extractLinkPreviews.js';

// Utilities
export { normalizePhoneNumber } from './utils/index.js';
