import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { WhatsAppStatus, WhatsAppConnectResponse, WhatsAppMessagesResponse } from '@/types';

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
