import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { WhatsAppStatus, WhatsAppConnectResponse, WhatsAppMessagesResponse } from '@/types';

export async function getWhatsAppStatus(accessToken: string): Promise<WhatsAppStatus | null> {
  return await apiRequest<WhatsAppStatus | null>(
    config.whatsappServiceUrl,
    '/v1/whatsapp/status',
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
    '/v1/whatsapp/connect',
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
    '/v1/whatsapp/disconnect',
    accessToken,
    { method: 'DELETE' }
  );
}

export async function getWhatsAppMessages(accessToken: string): Promise<WhatsAppMessagesResponse> {
  return await apiRequest<WhatsAppMessagesResponse>(
    config.whatsappServiceUrl,
    '/v1/whatsapp/messages',
    accessToken
  );
}

export async function deleteWhatsAppMessage(accessToken: string, messageId: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.whatsappServiceUrl,
    `/v1/whatsapp/messages/${messageId}`,
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
    `/v1/whatsapp/messages/${messageId}/media`,
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
    `/v1/whatsapp/messages/${messageId}/thumbnail`,
    accessToken
  );
}
