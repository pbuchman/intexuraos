import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  PrivateWhatsAppMessagesResponse,
  PrivateWhatsAppSenderDaysResponse,
  PrivateWhatsAppSendersResponse,
  WhatsAppConnectResponse,
  WhatsAppMessagesResponse,
  WhatsAppStatus,
} from '@/types';

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
    '/verify/send',
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
    '/verify/confirm',
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
    `/verify/status/${encodedPhone}`,
    accessToken
  );
}

export async function getWhatsAppStatus(accessToken: string): Promise<WhatsAppStatus | null> {
  return await apiRequest<WhatsAppStatus | null>(
    config.whatsappServiceUrl,
    '/status',
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
    '/connect',
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
    '/disconnect',
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
  const path = queryString !== '' ? `/messages?${queryString}` : '/messages';

  return await apiRequest<WhatsAppMessagesResponse>(config.whatsappServiceUrl, path, accessToken);
}

export interface ListPrivateWhatsAppSendersOptions {
  limit?: number;
  cursor?: string;
}

export interface ListPrivateWhatsAppMessagesOptions {
  senderKey: string;
  eventDayKey?: string;
  limit?: number;
  cursor?: string;
}

export interface ListPrivateWhatsAppSenderDaysOptions {
  senderKey: string;
  fromDay?: string;
  toDay?: string;
  limit?: number;
  cursor?: string;
}

function appendOptionalNumber(params: URLSearchParams, key: string, value: number | undefined): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

function appendOptionalString(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    params.set(key, value);
  }
}

export async function listPrivateWhatsAppSenders(
  accessToken: string,
  options: ListPrivateWhatsAppSendersOptions = {}
): Promise<PrivateWhatsAppSendersResponse> {
  const params = new URLSearchParams();
  appendOptionalNumber(params, 'limit', options.limit);
  appendOptionalString(params, 'cursor', options.cursor);
  const queryString = params.toString();
  const path = queryString !== '' ? `/private/senders?${queryString}` : '/private/senders';

  return await apiRequest<PrivateWhatsAppSendersResponse>(
    config.whatsappServiceUrl,
    path,
    accessToken
  );
}

export async function listPrivateWhatsAppMessages(
  accessToken: string,
  options: ListPrivateWhatsAppMessagesOptions
): Promise<PrivateWhatsAppMessagesResponse> {
  const params = new URLSearchParams();
  params.set('senderKey', options.senderKey);
  appendOptionalString(params, 'eventDayKey', options.eventDayKey);
  appendOptionalNumber(params, 'limit', options.limit);
  appendOptionalString(params, 'cursor', options.cursor);

  return await apiRequest<PrivateWhatsAppMessagesResponse>(
    config.whatsappServiceUrl,
    `/private/messages?${params.toString()}`,
    accessToken
  );
}

export async function listPrivateWhatsAppSenderDays(
  accessToken: string,
  options: ListPrivateWhatsAppSenderDaysOptions
): Promise<PrivateWhatsAppSenderDaysResponse> {
  const params = new URLSearchParams();
  params.set('senderKey', options.senderKey);
  appendOptionalString(params, 'fromDay', options.fromDay);
  appendOptionalString(params, 'toDay', options.toDay);
  appendOptionalNumber(params, 'limit', options.limit);
  appendOptionalString(params, 'cursor', options.cursor);

  return await apiRequest<PrivateWhatsAppSenderDaysResponse>(
    config.whatsappServiceUrl,
    `/private/sender-days?${params.toString()}`,
    accessToken
  );
}

export async function deleteWhatsAppMessage(accessToken: string, messageId: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.whatsappServiceUrl,
    `/messages/${messageId}`,
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
    `/messages/${messageId}/media`,
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
    `/messages/${messageId}/thumbnail`,
    accessToken
  );
}
