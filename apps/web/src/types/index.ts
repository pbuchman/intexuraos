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
 * User info from /v1/auth/me
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
}

/**
 * WhatsApp messages list response
 */
export interface WhatsAppMessagesResponse {
  messages: WhatsAppMessage[];
  fromNumber: string | null;
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
}
