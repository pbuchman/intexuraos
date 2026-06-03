import { config } from '@/config';
import { apiRequest } from './apiClient.js';

export type NotificationLevel = 'all' | 'important';

export interface WhatsAppPreferences {
  notificationLevel: NotificationLevel;
}

export async function getWhatsAppPreferences(
  accessToken: string
): Promise<WhatsAppPreferences> {
  return await apiRequest<WhatsAppPreferences>(
    config.whatsappServiceUrl,
    '/preferences',
    accessToken
  );
}

export async function updateWhatsAppPreferences(
  accessToken: string,
  body: WhatsAppPreferences
): Promise<WhatsAppPreferences> {
  return await apiRequest<WhatsAppPreferences>(
    config.whatsappServiceUrl,
    '/preferences',
    accessToken,
    { method: 'PUT', body }
  );
}
