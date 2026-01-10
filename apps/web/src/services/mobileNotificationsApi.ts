import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  MobileNotificationsConnectResponse,
  MobileNotificationsResponse,
  NotificationFiltersData,
  SavedNotificationFilter,
} from '@/types';

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
 * Filter options for notifications list.
 * app supports multi-select (comma-separated on API), source is single-select.
 */
export interface NotificationFilterOptions {
  limit?: number;
  cursor?: string;
  source?: string;
  app?: string[];
  title?: string;
}

/**
 * Get mobile notifications for the current user.
 */
export async function getMobileNotifications(
  accessToken: string,
  options?: NotificationFilterOptions
): Promise<MobileNotificationsResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  if (options?.source !== undefined && options.source.length > 0) {
    params.set('source', options.source);
  }
  if (options?.app !== undefined && options.app.length > 0) {
    params.set('app', options.app.join(','));
  }
  if (options?.title !== undefined) {
    params.set('title', options.title);
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
 * Get notification filters data (options and saved filters).
 */
export async function getNotificationFilters(
  accessToken: string
): Promise<NotificationFiltersData> {
  return await apiRequest<NotificationFiltersData>(
    config.mobileNotificationsServiceUrl,
    '/notifications/filters',
    accessToken
  );
}

/**
 * Input for creating a saved notification filter.
 * app/device are arrays for multi-select, source is single-select.
 */
export interface CreateSavedNotificationFilterInput {
  name: string;
  app?: string[];
  device?: string[];
  source?: string;
  title?: string;
}

/**
 * Create a saved notification filter.
 */
export async function createSavedNotificationFilter(
  accessToken: string,
  filter: CreateSavedNotificationFilterInput
): Promise<SavedNotificationFilter> {
  return await apiRequest<SavedNotificationFilter>(
    config.mobileNotificationsServiceUrl,
    '/notifications/filters/saved',
    accessToken,
    { method: 'POST', body: filter }
  );
}

/**
 * Delete a saved notification filter.
 */
export async function deleteSavedNotificationFilter(
  accessToken: string,
  filterId: string
): Promise<void> {
  await apiRequest<unknown>(
    config.mobileNotificationsServiceUrl,
    `/notifications/filters/saved/${encodeURIComponent(filterId)}`,
    accessToken,
    { method: 'DELETE' }
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
