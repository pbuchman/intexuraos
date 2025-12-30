export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

export interface SendMessageParams {
  to: string;
  message: string;
  replyToMessageId?: string;
}

export interface SendMessageResult {
  messageId: string;
}

export interface MediaUrlInfo {
  url: string;
  mimeType: string;
  sha256: string;
  fileSize: number;
}

export interface WhatsAppError {
  code: 'API_ERROR' | 'NETWORK_ERROR' | 'INVALID_CONFIG' | 'TIMEOUT';
  message: string;
  statusCode?: number;
}
