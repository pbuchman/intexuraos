import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { WhatsAppConnectResponse, WhatsAppMessagesResponse, WhatsAppStatus } from '@/types';

export interface SendVerificationRequest {
  phoneNumber: string;
}

export interface SendVerificationResponse {
  verificationId: string;
  expiresAt: number;
  cooldownUntil?: number;
}

export interface ConfirmVerificationRequest {
  verificationId: string;
  code: string;
}

export interface ConfirmVerificationResponse {
  verified: boolean;
  phoneNumber: string;
}

export interface VerificationStatusResponse {
  phoneNumber: string;
  verified: boolean;
  verifiedAt?: string;
}

export async function sendVerificationCode(
  accessToken: string,
  request: SendVerificationRequest
): Promise<SendVerificationResponse> {
  return await apiRequest<SendVerificationResponse>(
    config.whatsappServiceUrl,
    '/whatsapp/verify/send',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function confirmVerificationCode(
  accessToken: string,
  request: ConfirmVerificationRequest
): Promise<ConfirmVerificationResponse> {
  return await apiRequest<ConfirmVerificationResponse>(
    config.whatsappServiceUrl,
    '/whatsapp/verify/confirm',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function getVerificationStatus(
  accessToken: string,
  phoneNumber: string
): Promise<VerificationStatusResponse> {
  const encodedPhone = encodeURIComponent(phoneNumber.replace(/^\+/, ''));
  return await apiRequest<VerificationStatusResponse>(
    config.whatsappServiceUrl,
    `/whatsapp/verify/status/${encodedPhone}`,
    accessToken
  );
}

export async function getWhatsAppStatus(accessToken: string): Promise<WhatsAppStatus | null> {
  return await apiRequest<WhatsAppStatus | null>(
    config.whatsappServiceUrl,
    '/whatsapp/status',
    accessToken
  );
}

export interface WhatsAppConnectRequest {
  phoneNumbers: string[];
}

export async function connectWhatsApp(
  accessToken: string,
  request: WhatsAppConnectRequest
): Promise<WhatsAppConnectResponse> {
  return await apiRequest<WhatsAppConnectResponse>(
    config.whatsappServiceUrl,
    '/whatsapp/connect',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function disconnectWhatsApp(accessToken: string): Promise<void> {
  await apiRequest<{ disconnected: boolean }>(
    config.whatsappServiceUrl,
    '/whatsapp/disconnect',
    accessToken,
    { method: 'DELETE' }
  );
}

export async function getWhatsAppMessages(
  accessToken: string,
  options?: { limit?: number; cursor?: string }
): Promise<WhatsAppMessagesResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  const queryString = params.toString();
  const path = queryString !== '' ? `/whatsapp/messages?${queryString}` : '/whatsapp/messages';

  return await apiRequest<WhatsAppMessagesResponse>(config.whatsappServiceUrl, path, accessToken);
}

export async function deleteWhatsAppMessage(accessToken: string, messageId: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.whatsappServiceUrl,
    `/whatsapp/messages/${messageId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

/**
 * Media URL response from whatsapp-service
 */
export interface MediaUrlResponse {
  url: string;
  expiresAt: string;
}

/**
 * Get signed URL for message media (original file)
 */
export async function getMessageMediaUrl(
  accessToken: string,
  messageId: string
): Promise<MediaUrlResponse> {
  return await apiRequest<MediaUrlResponse>(
    config.whatsappServiceUrl,
    `/whatsapp/messages/${messageId}/media`,
    accessToken
  );
}

/**
 * Get signed URL for message thumbnail (images only)
 */
export async function getMessageThumbnailUrl(
  accessToken: string,
  messageId: string
): Promise<MediaUrlResponse> {
  return await apiRequest<MediaUrlResponse>(
    config.whatsappServiceUrl,
    `/whatsapp/messages/${messageId}/thumbnail`,
    accessToken
  );
}
