import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { GoogleCalendarStatus, GoogleCalendarInitiateResponse } from '@/types';

export async function getGoogleCalendarStatus(accessToken: string): Promise<GoogleCalendarStatus> {
  return await apiRequest<GoogleCalendarStatus>(
    config.authServiceUrl,
    '/oauth/connections/google/status',
    accessToken
  );
}

export async function initiateGoogleCalendarOAuth(accessToken: string): Promise<GoogleCalendarInitiateResponse> {
  return await apiRequest<GoogleCalendarInitiateResponse>(
    config.authServiceUrl,
    '/oauth/connections/google/initiate',
    accessToken,
    { method: 'POST' }
  );
}

export async function disconnectGoogleCalendar(accessToken: string): Promise<void> {
  await apiRequest<{ disconnected: boolean }>(
    config.authServiceUrl,
    '/oauth/connections/google',
    accessToken,
    { method: 'DELETE' }
  );
}
