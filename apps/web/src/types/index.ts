/**
 * API Response types matching backend response format.
 */

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  diagnostics?: {
    requestId: string;
    duration?: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  diagnostics?: {
    requestId: string;
    duration?: number;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * User info from /auth/me
 */
export interface UserInfo {
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
  hasRefreshToken: boolean;
}

/**
 * Notion connection status from notion-service
 */
export interface NotionStatus {
  configured: boolean;
  connected: boolean;
  promptVaultPageId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Notion connect response
 */
export interface NotionConnectResponse {
  connected: boolean;
  promptVaultPageId: string;
  createdAt: string;
  updatedAt: string;
  pageTitle?: string;
  pageUrl?: string;
}

/**
 * WhatsApp connection status from whatsapp-service
 */
export interface WhatsAppStatus {
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * WhatsApp connect response
 */
export interface WhatsAppConnectResponse {
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * WhatsApp message media type
 */
export type WhatsAppMediaType = 'text' | 'image' | 'audio';

/**
 * Transcription status for audio messages.
 */
export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Transcription error details
 */
export interface TranscriptionError {
  code: string;
  message: string;
}

/**
 * Link preview status for messages with URLs.
 */
export type LinkPreviewStatus = 'pending' | 'completed' | 'failed';

/**
 * Link preview data extracted from Open Graph metadata.
 */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
}

/**
 * Link preview error details
 */
export interface LinkPreviewError {
  code: string;
  message: string;
}

/**
 * Link preview state for messages
 */
export interface LinkPreviewState {
  status: LinkPreviewStatus;
  previews?: LinkPreview[];
  error?: LinkPreviewError;
}

/**
 * WhatsApp message from whatsapp-service
 */
export interface WhatsAppMessage {
  id: string;
  text: string;
  fromNumber: string;
  timestamp: string;
  receivedAt: string;
  mediaType: WhatsAppMediaType;
  hasMedia: boolean;
  caption: string | null;
  transcriptionStatus?: TranscriptionStatus;
  transcription?: string;
  transcriptionError?: TranscriptionError;
  linkPreview?: LinkPreviewState;
}

/**
 * WhatsApp messages list response
 */
export interface WhatsAppMessagesResponse {
  messages: WhatsAppMessage[];
  fromNumber: string | null;
  nextCursor?: string;
}

/**
 * Application config from environment
 */
export interface AppConfig {
  auth0Domain: string;
  auth0ClientId: string;
  authAudience: string;
  authServiceUrl: string;
  promptVaultServiceUrl: string;
  whatsappServiceUrl: string;
  notionServiceUrl: string;
  mobileNotificationsServiceUrl: string;
  llmOrchestratorUrl: string;
  commandsRouterServiceUrl: string;
}

/**
 * Mobile notification from mobile-notifications-service
 */
export interface MobileNotification {
  id: string;
  source: string;
  device: string;
  app: string;
  title: string;
  text: string;
  timestamp: number;
  postTime: string;
  receivedAt: string;
}

/**
 * Mobile notifications list response
 */
export interface MobileNotificationsResponse {
  notifications: MobileNotification[];
  nextCursor?: string;
}

/**
 * Mobile notifications connect response
 */
export interface MobileNotificationsConnectResponse {
  connectionId: string;
  signature: string;
}

/**
 * Notification filter configuration.
 * Requires a unique name and at least one filter criterion.
 */
export interface NotificationFilter {
  name: string;
  app?: string;
  source?: string;
  title?: string;
}

/**
 * User settings from user-service
 */
export interface UserSettings {
  userId: string;
  notifications: {
    filters: NotificationFilter[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Command classification type from commands-router
 */
export type CommandType =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'unclassified';

/**
 * Command status
 */
export type CommandStatus = 'received' | 'classified' | 'failed';

/**
 * Command source type
 */
export type CommandSourceType = 'whatsapp_text' | 'whatsapp_voice';

/**
 * Command classification details
 */
export interface CommandClassification {
  type: CommandType;
  confidence: number;
  classifiedAt: string;
}

/**
 * Command from commands-router
 */
export interface Command {
  id: string;
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  timestamp: string;
  status: CommandStatus;
  classification?: CommandClassification;
  actionId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Action status
 */
export type ActionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Action from commands-router
 */
export interface Action {
  id: string;
  userId: string;
  commandId: string;
  type: CommandType;
  confidence: number;
  title: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Commands list response
 */
export interface CommandsResponse {
  commands: Command[];
  nextCursor?: string;
}

/**
 * Actions list response
 */
export interface ActionsResponse {
  actions: Action[];
  nextCursor?: string;
}
