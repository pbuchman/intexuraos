import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { MobileNotificationsResponse, MobileNotificationsConnectResponse } from '@/types';

/**
 * Generate a new signature for mobile notifications.
 */
export async function connectMobileNotifications(
  accessToken: string,
  deviceLabel?: string
): Promise<MobileNotificationsConnectResponse> {
  const body = deviceLabel !== undefined ? { deviceLabel } : {};
  return await apiRequest<MobileNotificationsConnectResponse>(
    config.mobileNotificationsServiceUrl,
    '/mobile-notifications/connect',
    accessToken,
    { method: 'POST', body }
  );
}

/**
 * Get mobile notifications for the current user.
 */
export async function getMobileNotifications(
  accessToken: string,
  options?: { limit?: number; cursor?: string; source?: string; app?: string }
): Promise<MobileNotificationsResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  if (options?.source !== undefined) {
    params.set('source', options.source);
  }
  if (options?.app !== undefined) {
    params.set('app', options.app);
  }
  const queryString = params.toString();
  const path =
    queryString !== '' ? `/mobile-notifications?${queryString}` : '/mobile-notifications';

  return await apiRequest<MobileNotificationsResponse>(
    config.mobileNotificationsServiceUrl,
    path,
    accessToken
  );
}

/**
 * Delete a mobile notification.
 */
export async function deleteMobileNotification(
  accessToken: string,
  notificationId: string
): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.mobileNotificationsServiceUrl,
    `/mobile-notifications/${notificationId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

/**
 * Status response from mobile notifications service.
 */
export interface MobileNotificationsStatusResponse {
  configured: boolean;
  lastNotificationAt: string | null;
}

/**
 * Get mobile notifications status (whether signature is configured).
 */
export async function getMobileNotificationsStatus(
  accessToken: string
): Promise<MobileNotificationsStatusResponse> {
  return await apiRequest<MobileNotificationsStatusResponse>(
    config.mobileNotificationsServiceUrl,
    '/mobile-notifications/status',
    accessToken
  );
}
