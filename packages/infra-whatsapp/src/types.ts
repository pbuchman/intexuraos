export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

export interface SendMessageParams {
  to: string;
  message: string;
}

export interface WhatsAppError {
  code: 'API_ERROR' | 'NETWORK_ERROR' | 'INVALID_CONFIG';
  message: string;
  statusCode?: number;
}
